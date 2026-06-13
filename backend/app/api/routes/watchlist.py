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
from fastapi import APIRouter, Depends, HTTPException
import httpx
from app.api.deps import get_current_user_id
from app.core.database import get_supabase
from app.core.cache import cache_get, cache_set

router = APIRouter(prefix="/watchlist", tags=["watchlist"])

_YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
}

FREE_LIMIT = 30
_PRICES_CACHE_TTL = 60  # seconds


def _fetch_extended_price(ticker: str) -> dict:
    """Fetch price + pre/post market data from Yahoo Finance V8 chart API."""
    encoded = ticker.replace(".", "-").replace("^", "%5E")
    params = {
        "range": "5d",
        "interval": "1d",
        "includePrePost": "true",
    }
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

    for domain in ("query1", "query2"):
        try:
            url = f"https://{domain}.finance.yahoo.com/v8/finance/chart/{encoded}"
            r = httpx.get(url, headers=_YF_HEADERS, params=params, timeout=10, follow_redirects=True)
            if r.status_code != 200:
                continue
            data = r.json()
            chart_result = data.get("chart", {}).get("result", [])
            if not chart_result:
                continue

            res = chart_result[0]
            meta = res.get("meta", {})

            # Basic price info
            result["name"] = meta.get("shortName") or meta.get("longName") or ticker
            result["currency"] = meta.get("currency", "USD")
            result["market_state"] = meta.get("marketState", "REGULAR")

            # Regular prices from close data
            closes = res.get("indicators", {}).get("quote", [{}])[0].get("close") or []
            closes = [c for c in closes if c is not None]
            if len(closes) >= 2:
                result["price"] = round(closes[-1], 4)
                result["prev_close"] = round(closes[-2], 4)
            elif len(closes) == 1:
                result["price"] = round(closes[0], 4)

            # Prefer regularMarketPrice from meta when available
            reg_price = meta.get("regularMarketPrice")
            if reg_price:
                result["price"] = round(float(reg_price), 4)

            prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
            if prev_close:
                result["prev_close"] = round(float(prev_close), 4)

            # Calculate regular change
            if result["price"] and result["prev_close"] and result["prev_close"] != 0:
                result["change"] = round(result["price"] - result["prev_close"], 4)
                result["change_pct"] = round(
                    (result["price"] - result["prev_close"]) / result["prev_close"] * 100, 2
                )

            # Pre-market price
            pre_price = meta.get("preMarketPrice")
            if pre_price:
                result["pre_market_price"] = round(float(pre_price), 4)
                if result["prev_close"] and result["prev_close"] != 0:
                    result["pre_market_change_pct"] = round(
                        (float(pre_price) - result["prev_close"]) / result["prev_close"] * 100, 2
                    )

            # Post-market price
            post_price = meta.get("postMarketPrice")
            if post_price:
                result["post_market_price"] = round(float(post_price), 4)
                base = result["price"] or result["prev_close"]
                if base and base != 0:
                    result["post_market_change_pct"] = round(
                        (float(post_price) - base) / base * 100, 2
                    )

            return result
        except Exception:
            continue

    return result


def _fetch_logo_url(ticker: str) -> str | None:
    """Fetch company logo URL via Yahoo Finance quoteSummary → Clearbit CDN."""
    from urllib.parse import urlparse
    encoded = ticker.replace(".", "-").replace("^", "%5E")

    # Try quoteSummary assetProfile for company website
    for domain in ("query1", "query2"):
        try:
            url = (
                f"https://{domain}.finance.yahoo.com/v10/finance/quoteSummary/{encoded}"
                f"?modules=assetProfile"
            )
            r = httpx.get(url, headers=_YF_HEADERS, timeout=8, follow_redirects=True)
            if r.status_code == 200:
                data = r.json().get("quoteSummary", {}).get("result") or []
                if data:
                    website = (data[0].get("assetProfile") or {}).get("website", "")
                    if website:
                        netloc = urlparse(website).netloc.replace("www.", "")
                        if netloc:
                            return f"https://logo.clearbit.com/{netloc}"
        except Exception:
            continue

    return None


def _fetch_prices_batch(tickers: list[str]) -> dict[str, dict]:
    """Fetch extended prices for a list of tickers, with cache."""
    if not tickers:
        return {}

    cache_key = f"watchlist:prices:{','.join(sorted(tickers))}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    with ThreadPoolExecutor(max_workers=min(len(tickers), 10)) as pool:
        results = list(pool.map(_fetch_extended_price, tickers))

    prices = {r["ticker"]: r for r in results}
    cache_set(cache_key, prices, ttl=_PRICES_CACHE_TTL)
    return prices


def _get_user_tier(user_id: str) -> str:
    """Return subscription tier: 'free' or 'premium'."""
    try:
        db = get_supabase()
        res = db.table("user_profiles").select("subscription_tier").eq("user_id", user_id).execute()
        if res.data:
            return res.data[0].get("subscription_tier", "free") or "free"
    except Exception:
        pass
    return "free"


def _get_watchlist(user_id: str) -> list[dict]:
    db = get_supabase()
    res = db.table("watchlist").select("*").eq("user_id", user_id).order("added_at").execute()
    if res.data is None:
        # None means the DB query itself failed — raise so the endpoint returns 500
        # rather than silently returning [] which the frontend would treat as "empty list"
        raise RuntimeError("Watchlist DB query returned None — possible Supabase connectivity issue")
    return res.data


def _enrich_logos_background(items_without_logo: list[dict]) -> None:
    """Silently fetch and store logo_url for entries that don't have one yet."""
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
async def get_batch_prices(body: dict):
    """Get extended prices (pre/post market) for a list of tickers. No auth required."""
    tickers = [t.strip().upper() for t in body.get("tickers", []) if t]
    if not tickers:
        return {}
    prices = await asyncio.to_thread(_fetch_prices_batch, tickers[:50])
    return prices


@router.get("")
async def get_watchlist(user_id: str = Depends(get_current_user_id)):
    """Return user's watchlist enriched with current prices."""
    import threading
    items = await asyncio.to_thread(_get_watchlist, user_id)
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

    def _do_add():
        db = get_supabase()

        # Check tier and count
        tier = _get_user_tier(user_id)
        if tier != "premium":
            count_res = db.table("watchlist").select("id", count="exact").eq("user_id", user_id).execute()
            count = count_res.count or 0
            if count >= FREE_LIMIT:
                raise HTTPException(
                    status_code=403,
                    detail=f"Free tier limit of {FREE_LIMIT} items reached. Upgrade to Premium."
                )

        # Resolve name and logo via YF if not provided
        resolved_name = name
        resolved_logo: str | None = None
        try:
            price_data = _fetch_extended_price(ticker)
            if not resolved_name:
                resolved_name = price_data.get("name") or ticker
        except Exception:
            pass
        if not resolved_name:
            resolved_name = ticker
        try:
            resolved_logo = _fetch_logo_url(ticker)
        except Exception:
            pass

        # Insert (will raise unique constraint if duplicate)
        try:
            db.table("watchlist").insert({
                "user_id": user_id,
                "ticker": ticker,
                "name": resolved_name,
                "logo_url": resolved_logo,
            }).execute()
        except Exception as e:
            err_str = str(e).lower()
            if "unique" in err_str or "duplicate" in err_str or "23505" in err_str:
                raise HTTPException(status_code=409, detail=f"{ticker} already in watchlist")
            raise HTTPException(status_code=500, detail="Could not add to watchlist")

        return {"ticker": ticker, "name": resolved_name}

    return await asyncio.to_thread(_do_add)


@router.delete("/{ticker}")
async def remove_from_watchlist(ticker: str, user_id: str = Depends(get_current_user_id)):
    """Remove a ticker from the user's watchlist."""
    ticker = ticker.upper()

    def _do_delete():
        db = get_supabase()
        res = db.table("watchlist").delete().eq("user_id", user_id).eq("ticker", ticker).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist")
        return {"deleted": ticker}

    return await asyncio.to_thread(_do_delete)
