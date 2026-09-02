"""
Paper Trading leaderboard & alias endpoints.

GET  /paper/leaderboard  — ranked list of all users by portfolio % return
POST /paper/alias        — set or update your trading alias
"""

import asyncio
import hashlib
import json
import random
import string
import logging
from concurrent.futures import ThreadPoolExecutor

_PRICES_POOL = ThreadPoolExecutor(max_workers=12, thread_name_prefix="paper-prices")

from fastapi import APIRouter, Depends, HTTPException, Request
from app.core.limiter import limiter

from app.api.deps import get_current_user_id
from app.core.cache import cache_get, cache_set
from app.core.database import get_supabase, run_query
from app.services import ai_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/paper", tags=["paper"])

PAPER_INITIAL_CASH = 10_000.0
_PRICES_TTL      = 60    # seconds — price cache
_LEADERBOARD_TTL = 30    # seconds — full leaderboard cache
_ANALYZE_CACHE_TTL = 3600  # seconds — /analyze result cache, keyed on exact portfolio state

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

    # Finnhub fallback
    try:
        from app.core.finnhub import fh_quote as _fh_quote
        q = _fh_quote(ticker)
        if q and q.get("price"):
            return ticker, float(q["price"])
    except Exception:
        pass
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

    pairs = list(_PRICES_POOL.map(_fetch_price, list(tickers)))

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


async def _build_leaderboard(user_id: str) -> list[dict]:
    db = get_supabase()

    # 1. Ensure the requesting user has an alias
    alias_row = await run_query(
        db.table("user_profiles").select("paper_alias").eq("user_id", user_id).single()
    )
    existing_alias = (alias_row.data or {}).get("paper_alias") if alias_row.data else None
    if not existing_alias:
        alias = _random_alias()
        try:
            await run_query(
                db.table("user_profiles").update({"paper_alias": alias}).eq("user_id", user_id)
            )
        except Exception:
            pass

    # 2. Fetch all REAL portfolios (not paper trading)
    portfolio_rows = await run_query(
        db.table("user_portfolio").select("user_id, positions")
    )
    if not portfolio_rows.data:
        return []

    # A user can have up to 3 portfolios (migration 018_multi_portfolio.sql),
    # so this query can return multiple rows per user_id — group them here
    # instead of treating each row as a separate leaderboard entry (that
    # previously showed the same person 2-3 times, each with only a partial
    # return, and never their true combined return).
    positions_by_user: dict[str, list[dict]] = {}
    for r in portfolio_rows.data:
        raw = r.get("positions") or {}
        pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        if pos:
            positions_by_user.setdefault(r["user_id"], []).extend(pos)
    if not positions_by_user:
        return []

    # 3. Fetch aliases for all users
    user_ids = list(positions_by_user.keys())
    profile_rows = await run_query(
        db.table("user_profiles").select("user_id, paper_alias").in_("user_id", user_ids)
    )
    alias_map: dict[str, str] = {}
    for p in (profile_rows.data or []):
        alias_map[p["user_id"]] = p.get("paper_alias") or _random_alias()

    # 4. Collect all unique tickers
    all_tickers: set[str] = set()
    for positions in positions_by_user.values():
        for pos in positions:
            t = (pos.get("ticker") or "").strip().upper()
            if t:
                all_tickers.add(t)

    # 5. Batch-fetch current prices (blocking network calls — run in thread)
    price_map = await asyncio.to_thread(_batch_prices, all_tickers)

    # 6. Compute each user's return % from their real portfolio (all
    # portfolios combined into one blended return)
    entries: list[dict] = []
    for uid, positions in positions_by_user.items():
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

    result = await _build_leaderboard(user_id)
    cache_set(ck, result, ttl=_LEADERBOARD_TTL)
    return result


@router.post("/analyze")
@limiter.limit("15/minute")
async def analyze_paper(request: Request, body: dict, user_id: str = Depends(get_current_user_id)):
    """AI analysis of the user's paper trading portfolio — premium only.

    Cost fix, Sep 2026: this used to be premium-gated on the frontend ONLY
    (any authenticated user, including free tier, could call this route
    directly) and had zero caching — every "Volver a analizar" click, or
    any repeat/scripted call with the same portfolio state, was a fresh
    Sonnet call. Rate-limited 15/min but nothing stopped that from running
    non-stop; it's shielded from a runaway bill only by the app-wide daily
    spend cap (ai_service._claude), which meant repeat/abusive use here
    could eat the whole day's shared budget and degrade Arthur/support for
    every other user. Added a real server-side premium check plus a cache
    keyed on the exact portfolio state — identical input (no new trades
    since the last analysis) now serves the prior verdict for free."""
    from app.core.subscription import is_premium_active

    db = get_supabase()
    profile_res = await run_query(
        db.table("user_profiles")
        .select("subscription_tier,trial_started_at,streak_bonus_premium_until")
        .eq("user_id", user_id)
    )
    profile = (profile_res.data or [{}])[0]
    if not is_premium_active(
        profile.get("subscription_tier"), profile.get("trial_started_at"), profile.get("streak_bonus_premium_until"),
    ):
        raise HTTPException(status_code=403, detail="Premium required")

    positions      = body.get("positions") or []
    trades         = body.get("trades") or []
    total_return   = float(body.get("total_return_pct") or 0)
    cash           = float(body.get("cash") or 0)
    portfolio_value = float(body.get("portfolio_value") or 10000)
    lang           = body.get("lang") if body.get("lang") in ("es", "en") else "es"

    state_fingerprint = hashlib.sha256(
        json.dumps(
            {"positions": positions, "trades": trades, "total_return": total_return, "cash": cash,
             "portfolio_value": portfolio_value, "lang": lang},
            sort_keys=True, default=str,
        ).encode()
    ).hexdigest()
    ck = f"paper:analyze:{user_id}:{state_fingerprint}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    result = await ai_service.analyze_paper_portfolio(
        positions=positions,
        trades=trades,
        total_return_pct=total_return,
        cash=cash,
        portfolio_value=portfolio_value,
        lang=lang,
    )
    cache_set(ck, result, ttl=_ANALYZE_CACHE_TTL)
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
        await run_query(
            db.table("user_profiles")
            .update({"paper_alias": alias})
            .eq("user_id", user_id)
        )
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Ese alias ya está en uso")
        raise HTTPException(status_code=500, detail="Error al guardar alias")

    return {"ok": True, "alias": alias}
