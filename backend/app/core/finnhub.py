"""
Centralized Finnhub API helpers.

All functions are synchronous (call via asyncio.to_thread when needed).
They use caching and return None/[] on any error — never raise.
"""

import os
import logging
import time as _time
from datetime import date, timedelta

import httpx

from app.core.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

_BASE = "https://finnhub.io/api/v1"


def _key() -> str:
    return os.getenv("FINNHUB_API_KEY", "")


def _get(path: str, params: dict) -> dict | None:
    """Make a GET request to Finnhub. Returns parsed JSON or None on failure."""
    k = _key()
    if not k:
        return None
    try:
        r = httpx.get(
            f"{_BASE}{path}",
            params={**params, "token": k},
            timeout=8,
        )
        if r.status_code != 200:
            return None
        return r.json()
    except Exception as e:
        logger.debug("Finnhub %s error: %s", path, e)
        return None


# ── Public helpers ─────────────────────────────────────────────────────────────

def fh_quote(ticker: str) -> dict | None:
    """
    Real-time quote for a ticker.

    Returns:
        {price, prev_close, change, change_pct, open, high, low, volume, timestamp}
        or None if no data / no key / error.
    """
    ck = f"fh:quote:{ticker}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    d = _get("/quote", {"symbol": ticker})
    if not d:
        return None

    price = d.get("c")
    if not price:
        return None  # zero price = no data

    prev = d.get("pc")
    change = d.get("d")
    change_pct = d.get("dp")
    result = {
        "price":      round(float(price), 4),
        "prev_close": round(float(prev), 4) if prev else None,
        "change":     round(float(change), 4) if change is not None else 0.0,
        "change_pct": round(float(change_pct), 2) if change_pct is not None else 0.0,
        "open":       d.get("o"),
        "high":       d.get("h"),
        "low":        d.get("l"),
        "volume":     d.get("v"),
        "timestamp":  d.get("t"),
    }
    cache_set(ck, result, ttl=60)
    return result


def fh_candles(symbol: str, resolution: str, from_ts: int, to_ts: int) -> list[dict] | None:
    """
    OHLCV candle history.

    resolution: "1" | "5" | "15" | "30" | "60" | "D" | "W" | "M"
    Returns list of {t, o, h, l, c, v} or None if no_data / error.
    """
    ck = f"fh:candle:{symbol}:{resolution}:{from_ts}:{to_ts}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    d = _get("/stock/candle", {
        "symbol": symbol,
        "resolution": resolution,
        "from": from_ts,
        "to": to_ts,
    })
    if not d or d.get("s") == "no_data":
        return None

    ts_list = d.get("t") or []
    c_list  = d.get("c") or []
    o_list  = d.get("o") or []
    h_list  = d.get("h") or []
    l_list  = d.get("l") or []
    v_list  = d.get("v") or []

    if not ts_list or not c_list:
        return None

    result = []
    for i, ts in enumerate(ts_list):
        result.append({
            "t": ts,
            "o": o_list[i] if i < len(o_list) else None,
            "h": h_list[i] if i < len(h_list) else None,
            "l": l_list[i] if i < len(l_list) else None,
            "c": c_list[i] if i < len(c_list) else None,
            "v": v_list[i] if i < len(v_list) else None,
        })

    cache_set(ck, result, ttl=300)
    return result


def fh_profile(symbol: str) -> dict | None:
    """
    Company profile2.

    Returns dict with keys: name, ticker, country, currency, exchange,
    ipo, logo, marketCapitalization, shareOutstanding, weburl, finnhubIndustry
    or None on error.
    """
    ck = f"fh:profile:{symbol}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    d = _get("/stock/profile2", {"symbol": symbol})
    if not d or not d.get("name"):
        return None

    cache_set(ck, d, ttl=86400)
    return d


def fh_search(query: str) -> list[dict]:
    """
    Symbol search.

    Returns list of {symbol, name, type} (max ~10 results).
    Returns [] on error.
    """
    ck = f"fh:search:{query}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    d = _get("/search", {"q": query})
    if not d:
        return []

    items = d.get("result") or []
    result = [
        {
            "symbol": item.get("displaySymbol") or item.get("symbol", ""),
            "name":   item.get("description", ""),
            "type":   item.get("type", ""),
        }
        for item in items
        if item.get("symbol")
    ]

    cache_set(ck, result, ttl=3600)
    return result


def fh_metrics(symbol: str) -> dict:
    """
    Fundamental metrics for a symbol.

    Returns the inner `metric` dict from /stock/metric?metric=all.
    Returns {} on error.
    Keys include: peBasicExclExtraTTM, pegRatio, revenueGrowthTTMYoy,
    netProfitMarginTTM, dividendYieldIndicatedAnnual, marketCapitalization, etc.
    """
    ck = f"fh:metrics:{symbol}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    d = _get("/stock/metric", {"symbol": symbol, "metric": "all"})
    if not d:
        return {}

    result = d.get("metric") or {}
    cache_set(ck, result, ttl=3600)
    return result


def fh_news(symbol: str, days: int = 7) -> list[dict]:
    """
    Company news for the last `days` days.

    Returns list of {headline, summary, url, datetime} (unix timestamp).
    Returns [] on error.
    """
    ck = f"fh:news:{symbol}:{days}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    today = date.today()
    from_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    to_date   = today.strftime("%Y-%m-%d")

    d = _get("/company-news", {"symbol": symbol, "from": from_date, "to": to_date})
    if not d or not isinstance(d, list):
        return []

    result = [
        {
            "headline": item.get("headline", ""),
            "summary":  item.get("summary", ""),
            "url":      item.get("url", ""),
            "datetime": item.get("datetime"),
        }
        for item in d
        if item.get("headline")
    ]

    cache_set(ck, result, ttl=1800)
    return result
