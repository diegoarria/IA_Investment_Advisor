import json
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.cache import cache_get, cache_set

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])

# Cache TTL for leaderboard — expensive to compute (full table scan + yfinance)
# 5 minutes keeps data fresh enough while massively reducing DB + yfinance load.
# Each unique (period, requesting_user) pair gets its own cache entry because
# the response includes is_me / my_rank which are user-specific.
_TTL_LEADERBOARD = 300   # seconds (5 minutes)
_TTL_PRICES      = 600   # 10 minutes — yfinance price data changes slowly


def _get_prices_for_period(tickers: list[str], period: str) -> dict:
    if not tickers:
        return {}
    import yfinance as yf
    # Cache prices to avoid hammering yfinance on every leaderboard request
    sorted_tickers = ",".join(sorted(set(t.upper() for t in tickers)))
    ck = f"leaderboard:prices:{period}:{sorted_tickers[:200]}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    now = datetime.now(timezone.utc)
    if period == "ytd":
        start = datetime(now.year, 1, 1, tzinfo=timezone.utc)
    elif period == "1m":
        start = now - timedelta(days=30)
    else:  # 1w
        start = now - timedelta(days=7)

    lookback = max((now - start).days + 10, 10)
    prices: dict[str, dict] = {}
    try:
        unique = list(set(t.upper() for t in tickers))
        raw = yf.download(
            " ".join(unique),
            period=f"{lookback}d",
            interval="1d",
            auto_adjust=True,
            progress=False,
        )
        if raw.empty:
            return {}
        close = raw["Close"] if "Close" in raw else raw
        if len(unique) == 1:
            close = close.to_frame(name=unique[0])
        for ticker in unique:
            if ticker not in close.columns:
                continue
            series = close[ticker].dropna()
            if len(series) < 2:
                continue
            prices[ticker] = {
                "start": float(series.iloc[0]),
                "end": float(series.iloc[-1]),
            }
    except Exception as e:
        logger.warning(f"[leaderboard] price fetch: {e}")
    if prices:
        cache_set(ck, prices, ttl=_TTL_PRICES)
    return prices


def _calc_age(birth_date_str: str) -> int | None:
    if not birth_date_str:
        return None
    try:
        bd    = datetime.strptime(birth_date_str[:10], "%Y-%m-%d").date()
        today = datetime.now(timezone.utc).date()
        return today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))
    except Exception:
        return None


def _parse_positions(raw) -> list[dict]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and "_v" in raw:
        return raw.get("positions", [])
    return []


@router.get("")
async def get_portfolio_leaderboard(
    period: str = "ytd",
    user_id: str = Depends(get_current_user_id),
):
    """
    Compara rendimiento porcentual de portafolios entre usuarios.
    Solo métricas no monetarias: % retorno, win rate, diversificación.
    period: ytd | 1m | 1w

    Caching strategy: the leaderboard is expensive (full-table scan + yfinance).
    We cache it per period for 5 minutes. The my_rank / is_me fields are derived
    at response time from a shared cached board, avoiding per-user DB round-trips.
    """
    # Check shared (period-level) leaderboard cache first
    board_ck = f"leaderboard:board:{period}"
    cached_board = cache_get(board_ck)
    if cached_board is not None:
        # Personalize rank fields from the cached board without re-querying DB
        my_rank = None
        for entry in cached_board["leaderboard"]:
            entry["is_me"] = entry["user_id"] == user_id
            if entry["is_me"]:
                my_rank = entry["rank"]
        return {**cached_board, "my_rank": my_rank}

    db = get_supabase()

    port_res = await run_query(db.table("user_portfolio").select("user_id, positions"))
    if not port_res.data:
        return {"leaderboard": [], "period": period, "my_rank": None, "total_users": 0}

    profile_res = await run_query(
        db.table("user_profiles").select("user_id, name, subscription_tier, birth_date")
    )
    name_map: dict[str, str] = {}
    tier_map: dict[str, str] = {}
    age_map:  dict[str, int | None] = {}
    for p in (profile_res.data or []):
        uid = str(p["user_id"])
        name_map[uid] = p.get("name", "Usuario")
        tier_map[uid] = p.get("subscription_tier", "free")
        age_map[uid]  = _calc_age(p.get("birth_date") or "")

    parsed: list[dict] = []
    all_tickers: set[str] = set()
    for row in port_res.data:
        uid = str(row["user_id"])
        positions = _parse_positions(row.get("positions"))
        valid = [p for p in positions if p.get("ticker") and float(p.get("shares", 0) or 0) > 0]
        if not valid:
            continue
        parsed.append({"user_id": uid, "positions": valid})
        for p in valid:
            all_tickers.add(str(p["ticker"]).upper())

    if not parsed or not all_tickers:
        return {"leaderboard": [], "period": period, "my_rank": None, "total_users": 0}

    prices = await asyncio.to_thread(_get_prices_for_period, list(all_tickers), period)

    leaderboard: list[dict] = []
    for entry in parsed:
        uid = entry["user_id"]
        positions = entry["positions"]

        total_weight = 0.0
        weighted_return = 0.0
        wins = 0
        counted = 0
        best_ticker = None
        best_return = -999.0

        for pos in positions:
            ticker = str(pos.get("ticker", "")).upper()
            shares = float(pos.get("shares", 0) or 0)
            if ticker not in prices or shares <= 0:
                continue
            p_data = prices[ticker]
            if p_data["start"] <= 0:
                continue
            pos_ret = (p_data["end"] - p_data["start"]) / p_data["start"] * 100
            weight = shares * p_data["start"]
            weighted_return += pos_ret * weight
            total_weight += weight
            counted += 1
            if pos_ret > 0:
                wins += 1
            if pos_ret > best_return:
                best_return = pos_ret
                best_ticker = ticker

        if total_weight <= 0 or counted == 0:
            continue

        portfolio_return = weighted_return / total_weight
        win_rate = round(wins / counted * 100)

        leaderboard.append({
            "user_id":           uid,
            "display_name":      name_map.get(uid) or "Usuario",
            "age":               age_map.get(uid),
            "is_me":             uid == user_id,
            "return_pct":        round(portfolio_return, 2),
            "positions_count":   len(positions),
            "best_ticker":       best_ticker,
            "best_ticker_return": round(best_return, 2) if best_ticker else None,
            "win_rate":          win_rate,
            "is_premium":        tier_map.get(uid) == "premium",
        })

    leaderboard.sort(key=lambda x: x["return_pct"], reverse=True)
    my_rank = None
    for i, entry in enumerate(leaderboard):
        entry["rank"] = i + 1
        if entry["is_me"]:
            my_rank = i + 1

    board_data = {
        "leaderboard": leaderboard,
        "period": period,
        "my_rank": my_rank,
        "total_users": len(leaderboard),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Cache the board so subsequent requests skip the DB + yfinance round-trip.
    # my_rank is stored in the cache but overridden per-user at the top of the endpoint.
    cache_set(board_ck, board_data, ttl=_TTL_LEADERBOARD)
    return board_data
