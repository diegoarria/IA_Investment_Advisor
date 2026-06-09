"""
Paper Trading leaderboard & alias endpoints.

GET  /paper/leaderboard  — ranked list of all users by portfolio % return
POST /paper/alias        — set or update your trading alias
"""

import asyncio
import random
import string
import logging
from concurrent.futures import ThreadPoolExecutor

import yfinance as yf
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user_id
from app.core.cache import cache_get, cache_set
from app.core.database import get_supabase
from app.services import ai_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/paper", tags=["paper"])

PAPER_INITIAL_CASH = 10_000.0
_PRICES_TTL      = 60    # seconds — price cache
_LEADERBOARD_TTL = 30    # seconds — full leaderboard cache

_YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://finance.yahoo.com/",
}

_ADJECTIVES = ["Bull", "Bear", "Golden", "Iron", "Silver", "Rocket", "Alpha",
               "Swift", "Turbo", "Smart", "Quantum", "Stellar", "Apex", "Nova"]
_NOUNS      = ["Trader", "Capital", "Investor", "Quant", "Wolf", "Eagle",
               "Shark", "Tiger", "Dragon", "Hawk", "Fox", "Viper"]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _random_alias() -> str:
    suffix = "".join(random.choices(string.digits, k=3))
    return f"{random.choice(_ADJECTIVES)}{random.choice(_NOUNS)}{suffix}"


def _ensure_alias(db, user_id: str) -> str:
    """Returns existing alias, or creates and persists a new one."""
    try:
        row = db.table("user_profiles").select("paper_alias") \
                .eq("user_id", user_id).single().execute()
        alias = row.data.get("paper_alias") if row.data else None
    except Exception:
        alias = None

    if not alias:
        alias = _random_alias()
        try:
            db.table("user_profiles") \
              .update({"paper_alias": alias}) \
              .eq("user_id", user_id).execute()
        except Exception:
            pass  # alias collision — next request will retry

    return alias


def _fetch_price(ticker: str) -> tuple[str, float | None]:
    """Fetch latest closing price for a ticker. Same pattern as market.py."""
    import httpx

    for domain in ("query1", "query2"):
        try:
            url = (f"https://{domain}.finance.yahoo.com/v8/finance/chart/"
                   f"{ticker}?interval=1d&range=5d")
            r = httpx.get(url, headers=_YF_HEADERS, timeout=8, follow_redirects=True)
            if r.status_code == 200:
                closes = [
                    c for c in
                    r.json()["chart"]["result"][0]["indicators"]["quote"][0]["close"]
                    if c is not None
                ]
                if closes:
                    return ticker, closes[-1]
        except Exception:
            pass

    # yfinance fallback
    try:
        fi = yf.Ticker(ticker).fast_info
        price = float(fi.last_price) if fi.last_price else None
        return ticker, price
    except Exception:
        return ticker, None


def _batch_prices(tickers: set[str]) -> dict[str, float | None]:
    """Fetch prices for a set of tickers with shared cache."""
    if not tickers:
        return {}

    sorted_key = ",".join(sorted(tickers))
    ck = f"paper:prices:{sorted_key}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    with ThreadPoolExecutor(max_workers=min(len(tickers), 12)) as pool:
        pairs = list(pool.map(_fetch_price, list(tickers)))

    price_map = {t: p for t, p in pairs}
    cache_set(ck, price_map, ttl=_PRICES_TTL)
    return price_map


def _calc_return_pct(positions: list, price_map: dict) -> tuple[float, str | None]:
    """Returns (return_pct, top_holding_ticker) from real portfolio positions."""
    cost_basis    = 0.0
    current_value = 0.0
    top_holding   = None
    top_val       = 0.0

    for pos in positions:
        ticker    = (pos.get("ticker") or "").upper()
        shares    = float(pos.get("shares") or 0)
        # support both camelCase (frontend) and snake_case (screenshot parser)
        avg_price = float(pos.get("avgPrice") or pos.get("avg_price") or 0)
        cur_price = price_map.get(ticker) or avg_price

        cost_basis    += shares * avg_price
        cur_val        = shares * cur_price
        current_value += cur_val

        if cur_val > top_val:
            top_val, top_holding = cur_val, ticker

    if cost_basis <= 0:
        return 0.0, top_holding

    return_pct = round((current_value - cost_basis) / cost_basis * 100, 2)
    return return_pct, top_holding


def _build_leaderboard(user_id: str) -> list[dict]:
    db = get_supabase()

    # 1. Ensure the requesting user has an alias
    _ensure_alias(db, user_id)

    # 2. Fetch all REAL portfolios (not paper trading)
    portfolio_rows = db.table("user_portfolio") \
                       .select("user_id, positions") \
                       .execute()
    if not portfolio_rows.data:
        return []

    # Only include users who have at least one position
    portfolio_rows.data = [r for r in portfolio_rows.data if r.get("positions")]
    if not portfolio_rows.data:
        return []

    # 3. Fetch aliases for all users
    user_ids = [r["user_id"] for r in portfolio_rows.data]
    profile_rows = db.table("user_profiles") \
                     .select("user_id, paper_alias") \
                     .in_("user_id", user_ids) \
                     .execute()
    alias_map: dict[str, str] = {}
    for p in (profile_rows.data or []):
        alias_map[p["user_id"]] = p.get("paper_alias") or _random_alias()

    # 4. Collect all unique tickers
    all_tickers: set[str] = set()
    for row in portfolio_rows.data:
        for pos in (row.get("positions") or []):
            t = (pos.get("ticker") or "").strip().upper()
            if t:
                all_tickers.add(t)

    # 5. Batch-fetch current prices
    price_map = _batch_prices(all_tickers)

    # 6. Compute each user's return % from their real portfolio
    entries: list[dict] = []
    for row in portfolio_rows.data:
        uid       = row["user_id"]
        positions = row.get("positions") or []

        return_pct, top_holding = _calc_return_pct(positions, price_map)

        entries.append({
            "user_id":     uid,
            "alias":       alias_map.get(uid) or "Inversor",
            "return_pct":  return_pct,
            "top_holding": top_holding or "—",
            "rank_change": 0,
            "is_me":       uid == user_id,
        })

    # 7. Sort by return_pct, assign rank, strip internal user_id
    entries.sort(key=lambda e: e["return_pct"], reverse=True)
    for i, entry in enumerate(entries):
        entry["rank"] = i + 1
        del entry["user_id"]

    return entries


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/leaderboard")
async def get_leaderboard(user_id: str = Depends(get_current_user_id)):
    """
    Returns all users ranked by paper trading portfolio % return.
    Cached for 30 s; each user's own entry is marked with is_me=true.
    """
    # Per-user cache key so is_me is always correct
    ck = f"paper:leaderboard:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    result = await asyncio.to_thread(_build_leaderboard, user_id)
    cache_set(ck, result, ttl=_LEADERBOARD_TTL)
    return result


@router.post("/analyze")
async def analyze_paper(body: dict, user_id: str = Depends(get_current_user_id)):
    """AI analysis of the user's paper trading portfolio — premium only (enforced on frontend)."""
    positions      = body.get("positions") or []
    trades         = body.get("trades") or []
    total_return   = float(body.get("total_return_pct") or 0)
    cash           = float(body.get("cash") or 0)
    portfolio_value = float(body.get("portfolio_value") or 10000)

    result = await ai_service.analyze_paper_portfolio(
        positions=positions,
        trades=trades,
        total_return_pct=total_return,
        cash=cash,
        portfolio_value=portfolio_value,
    )
    return result


@router.post("/alias")
async def set_alias(body: dict, user_id: str = Depends(get_current_user_id)):
    """Set or update the user's anonymous paper trading alias."""
    alias = (body.get("alias") or "").strip()

    if len(alias) < 3 or len(alias) > 20:
        raise HTTPException(status_code=400, detail="El alias debe tener entre 3 y 20 caracteres")

    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
    if not all(c in allowed for c in alias):
        raise HTTPException(status_code=400, detail="Solo letras, números, _ y -")

    db = get_supabase()
    try:
        db.table("user_profiles") \
          .update({"paper_alias": alias}) \
          .eq("user_id", user_id).execute()
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Ese alias ya está en uso")
        raise HTTPException(status_code=500, detail="Error al guardar alias")

    return {"ok": True, "alias": alias}
