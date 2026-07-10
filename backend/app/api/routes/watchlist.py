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
from concurrent.futures import ThreadPoolExecutor

_PRICES_POOL = ThreadPoolExecutor(max_workers=10, thread_name_prefix="watchlist-prices")
from fastapi import APIRouter, Depends, HTTPException, Request
from app.core.limiter import limiter
import httpx
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.cache import cache_get, cache_set

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

            return result
        except Exception:
            continue

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

    # Check tier + active trial
    tier_res = await run_query(
        db.table("user_profiles")
        .select("subscription_tier, trial_started_at")
        .eq("user_id", user_id)
    )
    row = tier_res.data[0] if tier_res.data else {}
    tier  = row.get("subscription_tier", "free") or "free"
    trial = row.get("trial_started_at")

    is_premium = tier in ("premium", "pro")
    if not is_premium and trial:
        try:
            from datetime import datetime as _dt, timezone as _tz
            started = _dt.fromisoformat(trial.replace("Z", "+00:00"))
            is_premium = (_dt.now(_tz.utc) - started).days < 90
        except Exception:
            pass

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

    # Resolve name and logo via YF if not provided (these are blocking network calls)
    resolved_name = name
    resolved_logo: str | None = None
    try:
        price_data = await asyncio.to_thread(_fetch_extended_price, ticker)
        if not resolved_name:
            resolved_name = price_data.get("name") or ticker
    except Exception:
        pass
    if not resolved_name:
        resolved_name = ticker
    try:
        resolved_logo = await asyncio.to_thread(_fetch_logo_url, ticker)
    except Exception:
        pass

    # Insert (will raise unique constraint if duplicate)
    try:
        await run_query(db.table("watchlist").insert({
            "user_id": user_id,
            "ticker": ticker,
            "name": resolved_name,
            "logo_url": resolved_logo,
        }))
    except Exception as e:
        err_str = str(e).lower()
        if "unique" in err_str or "duplicate" in err_str or "23505" in err_str:
            raise HTTPException(status_code=409, detail=f"{ticker} already in watchlist")
        raise HTTPException(status_code=500, detail="Could not add to watchlist")

    return {"ticker": ticker, "name": resolved_name}


@router.delete("/{ticker}")
async def remove_from_watchlist(ticker: str, user_id: str = Depends(get_current_user_id)):
    """Remove a ticker from the user's watchlist."""
    ticker = ticker.upper()
    db = get_supabase()
    res = await run_query(
        db.table("watchlist").delete().eq("user_id", user_id).eq("ticker", ticker)
    )
    if not res.data:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")
    return {"deleted": ticker}
