# SQL para crear en Supabase:
# CREATE TABLE IF NOT EXISTS watchlist (
#   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
#   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
#   ticker TEXT NOT NULL,
#   name TEXT,
#   added_at TIMESTAMPTZ DEFAULT NOW(),
#   UNIQUE(user_id, ticker)
# );
# CREATE INDEX IF NOT EXISTS watchlist_user_id_idx ON watchlist(user_id);
# ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
# CREATE POLICY "Users manage own watchlist" ON watchlist FOR ALL USING (auth.uid() = user_id);

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

_PRICES_POOL = ThreadPoolExecutor(max_workers=10, thread_name_prefix="watchlist-prices")
from fastapi import APIRouter, Depends, HTTPException, Request
from app.core.limiter import limiter
import httpx
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.cache import cache_get, cache_set
from app.core.after_hours_cache import backfill_after_hours

router = APIRouter(prefix="/watchlist", tags=["watchlist"])

_YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
}

FREE_LIMIT = 25
_PRICES_CACHE_TTL = 60  # seconds


def _fetch_finnhub_quote(ticker: str) -> dict | None:
    """Fetch reliable real-time price + daily % change from Finnhub."""
    import os
    key = os.getenv("FINNHUB_API_KEY", "")
    if not key:
        return None
    try:
        r = httpx.get(
            "https://finnhub.io/api/v1/quote",
            params={"symbol": ticker, "token": key},
            timeout=6,
        )
        if r.status_code != 200:
            return None
        d = r.json()
        price = d.get("c")
        prev  = d.get("pc")
        dp    = d.get("dp")  # daily % change — Finnhub calculates this correctly
        if not price:
            return None
        change = round(float(price) - float(prev), 4) if prev else 0.0
        pct    = round(float(dp), 2) if dp is not None else (
            round(change / float(prev) * 100, 2) if prev and float(prev) != 0 else 0.0
        )
        return {"price": round(float(price), 4), "prev_close": round(float(prev), 4) if prev else None,
                "change": change, "change_pct": pct}
    except Exception:
        return None


def _fetch_extended_price(ticker: str) -> dict:
    """Fetch price + pre/post market data.
    Price / change_pct come from Finnhub (reliable, no adjusted-price bug).
    Pre/post market data comes from Yahoo Finance."""
    encoded = ticker.replace(".", "-").replace("^", "%5E")
    result = {
        "ticker": ticker,
        "name": ticker,
        "price": None,
        "prev_close": None,
        "change": 0.0,
        "change_pct": 0.0,
        "currency": "USD",
        "market_state": "REGULAR",
        "pre_market_price": None,
        "pre_market_change_pct": None,
        "post_market_price": None,
        "post_market_change_pct": None,
    }

    # ── Step 1: Finnhub for reliable price + % change ──────────────────────
    fq = _fetch_finnhub_quote(ticker)
    if fq:
        result["price"]      = fq["price"]
        result["prev_close"] = fq["prev_close"]
        result["change"]     = fq["change"]
        result["change_pct"] = fq["change_pct"]

    # ── Step 2: Yahoo for name, market state, pre/post market data ─────────
    for domain in ("query1", "query2"):
        try:
            url = f"https://{domain}.finance.yahoo.com/v8/finance/chart/{encoded}"
            r = httpx.get(url, headers=_YF_HEADERS,
                          params={"range": "1d", "interval": "1d", "includePrePost": "true"},
                          timeout=10, follow_redirects=True)
            if r.status_code != 200:
                continue
            data = r.json()
            chart_result = data.get("chart", {}).get("result", [])
            if not chart_result:
                continue

            meta = chart_result[0].get("meta", {})
            result["name"]         = meta.get("shortName") or meta.get("longName") or ticker
            result["currency"]     = meta.get("currency", "USD")
            result["market_state"] = meta.get("marketState", "REGULAR")

            # Fallback price from Yahoo if Finnhub returned nothing
            if not result["price"]:
                reg_price = meta.get("regularMarketPrice")
                if reg_price:
                    result["price"] = round(float(reg_price), 4)
                prev = (meta.get("regularMarketPreviousClose")
                        or meta.get("chartPreviousClose")
                        or meta.get("previousClose"))
                if prev:
                    result["prev_close"] = round(float(prev), 4)
                reg_chg     = meta.get("regularMarketChange")
                reg_chg_pct = meta.get("regularMarketChangePercent")
                if reg_chg is not None and reg_chg_pct is not None:
                    result["change"]     = round(float(reg_chg), 4)
                    result["change_pct"] = round(float(reg_chg_pct), 2)

            # Pre-market
            pre_price = meta.get("preMarketPrice")
            if pre_price:
                result["pre_market_price"] = round(float(pre_price), 4)
                base = result["prev_close"] or result["price"]
                if base and float(base) != 0:
                    result["pre_market_change_pct"] = round(
                        (float(pre_price) - float(base)) / float(base) * 100, 2
                    )

            # Post-market
            post_price = meta.get("postMarketPrice")
            if post_price:
                result["post_market_price"] = round(float(post_price), 4)
                base = result["price"] or result["prev_close"]
                if base and float(base) != 0:
                    result["post_market_change_pct"] = round(
                        (float(post_price) - float(base)) / float(base) * 100, 2
                    )

            backfill_after_hours(ticker, result)
            return result
        except Exception:
            continue

    backfill_after_hours(ticker, result)
    return result


def _fetch_logo_url(ticker: str) -> str | None:
    """Fetch company logo URL via Finnhub profile2 (logo field or weburl → Clearbit CDN)."""
    from urllib.parse import urlparse
    from app.core.finnhub import fh_profile

    profile = fh_profile(ticker)
    if profile:
        # Finnhub returns a direct logo URL
        logo = profile.get("logo")
        if logo:
            return logo
        # Fall back to Clearbit from weburl
        weburl = profile.get("weburl", "")
        if weburl:
            netloc = urlparse(weburl).netloc.replace("www.", "")
            if netloc:
                return f"https://logo.clearbit.com/{netloc}"

    return None


def _fetch_prices_batch(tickers: list[str]) -> dict[str, dict]:
    """Fetch extended prices for a list of tickers, with cache."""
    if not tickers:
        return {}

    cache_key = f"watchlist:prices:{','.join(sorted(tickers))}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    results = list(_PRICES_POOL.map(_fetch_extended_price, tickers))

    prices = {r["ticker"]: r for r in results}
    cache_set(cache_key, prices, ttl=_PRICES_CACHE_TTL)
    return prices


def _enrich_logos_background(items_without_logo: list[dict]) -> None:
    """Silently fetch and store logo_url for entries that don't have one yet.
    Called from a background thread — uses sync Supabase directly."""
    db = get_supabase()
    for item in items_without_logo:
        ticker = item["ticker"]
        try:
            logo = _fetch_logo_url(ticker)
            if logo:
                db.table("watchlist").update({"logo_url": logo}) \
                  .eq("id", item["id"]).execute()
        except Exception:
            pass


@router.post("/batch-prices")
@limiter.limit("30/minute")
async def get_batch_prices(request: Request, body: dict, user_id: str = Depends(get_current_user_id)):
    """Get extended prices (pre/post market) for a list of tickers."""
    tickers = [t.strip().upper() for t in body.get("tickers", []) if t]
    if not tickers:
        return {}
    prices = await asyncio.to_thread(_fetch_prices_batch, tickers[:50])
    return prices


def _extract_ticker_scores(nif_cached: dict | None, quick_cached: dict | None) -> dict:
    """Assembles one ticker's Watchlist Inteligente row purely from whatever
    is ALREADY cached (nif-dashboard/quick-analysis) — never recomputes,
    never calls an engine. Every field is None when its source cache is
    missing, which the frontend renders as "N/D", never a fabricated value."""
    pillars = (nif_cached or {}).get("pillars") or {}
    valuation_estimate = (pillars.get("valuation") or {}).get("nuvos_estimate") or {}
    conviction = (nif_cached or {}).get("conviction") or {}
    deterioration = (nif_cached or {}).get("deterioration") or {}
    catalysts_list = ((nif_cached or {}).get("catalysts") or {}).get("catalysts") or []

    margin_of_safety_pct = valuation_estimate.get("margin_of_safety_pct")
    if margin_of_safety_pct is None:
        margin_of_safety_pct = (quick_cached or {}).get("margin_of_safety_pct")

    return {
        "quality_score": (pillars.get("business_quality") or {}).get("score"),
        "conviction_score": conviction.get("score"),
        "margin_of_safety_pct": margin_of_safety_pct,
        "fair_value_range": valuation_estimate.get("fair_value_range"),
        # "Oportunidad" — deliberately aliased to the SAME composite_score
        # already used to rank /market/screener/undervalued's "Best Overall"
        # (valuation 25% + quality/growth/management pillars), not a new
        # metric invented for the watchlist.
        "opportunity_score": (quick_cached or {}).get("composite_score"),
        "deteriorating_count": deterioration.get("deteriorating_count"),
        "improving_count": deterioration.get("improving_count"),
        "top_catalysts": [c.get("catalyst") for c in catalysts_list[:2] if c.get("catalyst")],
    }


async def _fetch_thesis_status_batch(user_id: str, tickers: list[str]) -> dict[str, dict]:
    """One `IN (...)` query per table (never N+1) for thesis status + top
    risks — real DB reads, not AI calls, so this is cheap enough to run on
    every watchlist load."""
    db = get_supabase()
    drafts_res, mine_res = await asyncio.gather(
        run_query(db.table("research_thesis_drafts").select("ticker,key_risks").in_("ticker", tickers)),
        run_query(
            db.table("user_investment_theses").select("ticker")
            .eq("user_id", user_id).eq("is_current", True).in_("ticker", tickers)
        ),
    )
    drafts_by_ticker = {row["ticker"]: row for row in (drafts_res.data or [])}
    user_thesis_tickers = {row["ticker"] for row in (mine_res.data or [])}

    result = {}
    for ticker in tickers:
        draft = drafts_by_ticker.get(ticker)
        if ticker in user_thesis_tickers:
            status = "user_thesis"
        elif draft:
            status = "draft_only"
        else:
            status = "no_thesis"
        risks = [r.get("text") for r in (draft.get("key_risks") or [])[:2]] if draft else []
        result[ticker] = {"thesis_status": status, "top_risks": [r for r in risks if r]}
    return result


@router.post("/batch-scores")
@limiter.limit("20/minute")
async def get_batch_scores(request: Request, body: dict, lang: str = "es", user_id: str = Depends(get_current_user_id)):
    """Fase 4, Incremento 9 (Watchlist Inteligente, Parte I) — Quality/
    Conviction/opportunity scores, margin of safety, thesis status, top
    risks/catalysts for N watchlist tickers in one call.

    Deliberately cache-ONLY: reads whatever /market/screener/nif-dashboard
    and /market/screener/quick-analysis already cached for these tickers
    (screener.py's `nif_dashboard:v1:*` / `quick_analysis:v2:*` keys) and
    returns null fields for tickers with no cached analysis — it NEVER
    triggers a fresh engine run, so opening the watchlist is always cheap
    regardless of how many tickers are on it. Premium-only, same gate as
    /nif-dashboard itself (the scores this surfaces are a premium feature)."""
    from app.api.routes.chat import _is_premium
    from app.api.routes.screener import _nif_dashboard_cache_key, _quick_analysis_cache_key, _get_user_profile_safe

    profile = await _get_user_profile_safe(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    if not _is_premium(profile):
        raise HTTPException(status_code=403, detail={
            "code": "premium_required",
            "message": "Los scores de Watchlist Inteligente son exclusivos para Premium.",
        })

    tickers = [t.strip().upper() for t in body.get("tickers", []) if t][:50]
    if not tickers:
        return {}
    if lang not in ("es", "en"):
        lang = "es"

    thesis_status = await _fetch_thesis_status_batch(user_id, tickers)

    result = {}
    for ticker in tickers:
        nif_cached = cache_get(_nif_dashboard_cache_key(ticker, lang))
        quick_cached = cache_get(_quick_analysis_cache_key(ticker, lang))
        row = _extract_ticker_scores(nif_cached, quick_cached)
        row.update(thesis_status.get(ticker, {"thesis_status": "no_thesis", "top_risks": []}))
        result[ticker] = row
    return result


@router.get("")
async def get_watchlist(user_id: str = Depends(get_current_user_id)):
    """Return user's watchlist enriched with current prices."""
    import threading
    db = get_supabase()
    res = await run_query(db.table("watchlist").select("*").eq("user_id", user_id).order("added_at"))
    items = res.data
    if items is None:
        raise RuntimeError("Watchlist DB query returned None — possible Supabase connectivity issue")
    if not items:
        return []

    tickers = [item["ticker"] for item in items]
    try:
        prices = await asyncio.to_thread(_fetch_prices_batch, tickers)
    except Exception:
        prices = {}  # price fetch failed — return items with null prices, not a 500

    result = []
    missing_logos = []
    for item in items:
        ticker = item["ticker"]
        price_data = prices.get(ticker, {})
        logo_url = item.get("logo_url")
        if not logo_url:
            missing_logos.append(item)
        result.append({
            "ticker": ticker,
            "name": price_data.get("name") or item.get("name") or ticker,
            "logo_url": logo_url,
            "price": price_data.get("price"),
            "prev_close": price_data.get("prev_close"),
            "change": price_data.get("change", 0.0),
            "change_pct": price_data.get("change_pct", 0.0),
            "currency": price_data.get("currency", "USD"),
            "market_state": price_data.get("market_state", "REGULAR"),
            "pre_market_price": price_data.get("pre_market_price"),
            "pre_market_change_pct": price_data.get("pre_market_change_pct"),
            "post_market_price": price_data.get("post_market_price"),
            "post_market_change_pct": price_data.get("post_market_change_pct"),
            "added_at": item.get("added_at"),
        })

    # Enrich missing logos in background — next GET will return them
    if missing_logos:
        threading.Thread(
            target=_enrich_logos_background,
            args=(missing_logos,),
            daemon=True,
        ).start()

    return result


@router.post("")
async def add_to_watchlist(body: dict, user_id: str = Depends(get_current_user_id)):
    """Add a ticker to watchlist. Enforces free tier limit of 30."""
    ticker = (body.get("ticker") or "").strip().upper()
    name = (body.get("name") or "").strip() or None

    if not ticker:
        raise HTTPException(status_code=422, detail="ticker is required")

    db = get_supabase()

    # Check tier + active trial + current count — wrapped so a hiccup on
    # either query (anything run_query's own transient-error retry doesn't
    # catch) fails OPEN rather than blocking the add entirely. Worst case a
    # free user occasionally sneaks one item past the limit during an
    # infra blip; that beats "add to watchlist" throwing a hard error over a
    # check that has nothing to do with the actual write.
    try:
        tier_res = await run_query(
            db.table("user_profiles")
            .select("subscription_tier, trial_started_at, streak_bonus_premium_until")
            .eq("user_id", user_id)
        )
        row = tier_res.data[0] if tier_res.data else {}
        from app.core.subscription import is_premium_active
        is_premium = is_premium_active(row.get("subscription_tier"), row.get("trial_started_at"), row.get("streak_bonus_premium_until"))

        if not is_premium:
            count_res = await run_query(
                db.table("watchlist").select("id", count="exact").eq("user_id", user_id)
            )
            count = count_res.count or 0
            if count >= FREE_LIMIT:
                raise HTTPException(
                    status_code=403,
                    detail={"code": "limit_reached", "limit": FREE_LIMIT,
                            "message": f"Límite de {FREE_LIMIT} acciones en watchlist. Activa Premium para agregar más."}
                )
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger(__name__).warning("watchlist tier/limit check failed, allowing add through: %s", e)

    # Insert immediately with whatever name the client already had (search
    # results always carry one) — resolving name/logo used to sit in front of
    # this insert as two sequential blocking calls (Finnhub + Yahoo, up to
    # ~10s each), so a slow/flaky quote provider made "add to watchlist" fail
    # with a timeout even though the actual database write is instant. Name
    # falls back to the ticker itself and gets backfilled below.
    resolved_name = name or ticker

    try:
        await run_query(db.table("watchlist").insert({
            "user_id": user_id,
            "ticker": ticker,
            "name": resolved_name,
            "logo_url": None,
        }))
    except Exception as e:
        err_str = str(e).lower()
        if "unique" in err_str or "duplicate" in err_str or "23505" in err_str:
            raise HTTPException(status_code=409, detail=f"{ticker} already in watchlist")
        raise HTTPException(status_code=500, detail="Could not add to watchlist")

    from app.services import investment_graph_service as graph_service
    asyncio.create_task(graph_service.log_event(user_id, ticker, "watchlist_add", payload={"name": resolved_name}))

    if not name:
        asyncio.create_task(_backfill_watchlist_name_and_logo(user_id, ticker))

    return {"ticker": ticker, "name": resolved_name}


async def _backfill_watchlist_name_and_logo(user_id: str, ticker: str) -> None:
    """Runs after the response is already sent — fills in the real company
    name/logo (only reached when the client didn't already have a name to
    pass) without making the user wait on Finnhub/Yahoo for the add itself."""
    db = get_supabase()
    update: dict = {}
    try:
        price_data = await asyncio.to_thread(_fetch_extended_price, ticker)
        real_name = price_data.get("name")
        if real_name and real_name != ticker:
            update["name"] = real_name
    except Exception:
        pass
    try:
        logo = await asyncio.to_thread(_fetch_logo_url, ticker)
        if logo:
            update["logo_url"] = logo
    except Exception:
        pass
    if update:
        try:
            await run_query(db.table("watchlist").update(update).eq("user_id", user_id).eq("ticker", ticker))
        except Exception:
            pass


@router.delete("/{ticker}")
async def remove_from_watchlist(ticker: str, user_id: str = Depends(get_current_user_id)):
    """Remove a ticker from the user's watchlist. Idempotent on purpose — a
    ticker that's already gone (a double-tap, a retried request, a stale
    client cache) is still "not in the watchlist" either way, so this never
    404s just because there was nothing left to delete."""
    ticker = ticker.upper()
    db = get_supabase()
    await run_query(
        db.table("watchlist").delete().eq("user_id", user_id).eq("ticker", ticker)
    )

    from app.services import investment_graph_service as graph_service
    asyncio.create_task(graph_service.log_event(user_id, ticker, "watchlist_remove"))

    return {"deleted": ticker}
