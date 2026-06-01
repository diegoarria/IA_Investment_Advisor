"""
Paper trading league service.

Builds the global leaderboard and sends rank-change notifications.
Called by the background worker every 2 hours.
"""

import logging
from concurrent.futures import ThreadPoolExecutor

import yfinance as yf

from app.core.cache import cache_get, cache_set
from app.core.database import get_supabase
from app.services.notification_service import create_notification

logger = logging.getLogger(__name__)

PAPER_INITIAL_CASH = 10_000.0
_PRICES_TTL    = 60    # seconds
_SNAPSHOT_TTL  = 10 * 3600  # 10 hours — "previous rank" window

_YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://finance.yahoo.com/",
}


def _fetch_price(ticker: str) -> tuple[str, float | None]:
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
    try:
        fi = yf.Ticker(ticker).fast_info
        return ticker, float(fi.last_price) if fi.last_price else None
    except Exception:
        return ticker, None


def build_global_leaderboard() -> list[dict]:
    """
    Returns all users ranked by paper portfolio % return.
    Each entry: { user_id, alias, return_pct, rank, top_holding }
    """
    db = get_supabase()

    portfolio_rows = db.table("user_portfolio") \
                       .select("user_id, positions").execute()
    if not portfolio_rows.data:
        return []

    portfolio_rows.data = [r for r in portfolio_rows.data if r.get("positions")]
    if not portfolio_rows.data:
        return []

    user_ids = [r["user_id"] for r in portfolio_rows.data]
    profile_rows = db.table("user_profiles") \
                     .select("user_id, paper_alias") \
                     .in_("user_id", user_ids).execute()
    alias_map = {r["user_id"]: r.get("paper_alias") or "Inversor"
                 for r in (profile_rows.data or [])}

    all_tickers: set[str] = set()
    for row in portfolio_rows.data:
        for pos in (row.get("positions") or []):
            t = (pos.get("ticker") or "").strip().upper()
            if t:
                all_tickers.add(t)

    price_map: dict[str, float | None] = {}
    if all_tickers:
        ck = f"paper:prices:{','.join(sorted(all_tickers))}"
        price_map = cache_get(ck) or {}
        if not price_map:
            with ThreadPoolExecutor(max_workers=min(len(all_tickers), 12)) as pool:
                price_map = dict(pool.map(_fetch_price, list(all_tickers)))
            cache_set(ck, price_map, ttl=_PRICES_TTL)

    entries: list[dict] = []
    for row in portfolio_rows.data:
        uid       = row["user_id"]
        positions = row.get("positions") or []
        if not positions:
            continue

        cost_basis = current_value = 0.0
        top_holding, top_val = None, 0.0
        for pos in positions:
            ticker    = (pos.get("ticker") or "").upper()
            shares    = float(pos.get("shares") or 0)
            avg_price = float(pos.get("avgPrice") or pos.get("avg_price") or 0)
            cur_price = price_map.get(ticker) or avg_price
            cost_basis    += shares * avg_price
            pv             = shares * cur_price
            current_value += pv
            if pv > top_val:
                top_val, top_holding = pv, ticker

        if cost_basis <= 0:
            continue
        return_pct = round((current_value - cost_basis) / cost_basis * 100, 2)
        entries.append({
            "user_id":     uid,
            "alias":       alias_map.get(uid, "Inversor"),
            "return_pct":  return_pct,
            "top_holding": top_holding or "—",
        })

    entries.sort(key=lambda e: e["return_pct"], reverse=True)
    for i, e in enumerate(entries):
        e["rank"] = i + 1

    return entries


async def notify_rank_changes() -> None:
    """
    Compares the current leaderboard to the snapshot from the last run.
    Sends an in-app notification to any user whose rank got worse (someone passed them).
    """
    SNAPSHOT_KEY = "paper:rank_snapshot"

    try:
        current = build_global_leaderboard()
    except Exception as e:
        logger.error("notify_rank_changes: failed to build leaderboard: %s", e)
        return

    if not current:
        return

    previous: list[dict] = cache_get(SNAPSHOT_KEY) or []

    # Save current snapshot for next run
    cache_set(SNAPSHOT_KEY, current, ttl=_SNAPSHOT_TTL)

    if not previous:
        logger.info("notify_rank_changes: no previous snapshot yet — skipping notifications")
        return

    # Build lookup: user_id → previous rank
    prev_rank: dict[str, int] = {e["user_id"]: e["rank"] for e in previous}

    notified = 0
    for entry in current:
        uid       = entry["user_id"]
        new_rank  = entry["rank"]
        old_rank  = prev_rank.get(uid)

        if old_rank is None or new_rank <= old_rank:
            continue  # rank improved or no previous data — no notification

        positions_lost = new_rank - old_rank
        total = len(current)

        # Find who passed this user (person now at old_rank)
        passer = next((e for e in current if e["rank"] == old_rank), None)
        passer_alias = passer["alias"] if passer else "otro inversor"

        title   = "📉 Te superaron en la Liga"
        message = (
            f"{passer_alias} te arrebató el puesto #{old_rank} "
            f"y ahora estás en #{new_rank} de {total}. "
            f"Ajusta tu portafolio para recuperar {'tu posición' if positions_lost == 1 else f'{positions_lost} posiciones'}."
        )

        try:
            await create_notification(
                user_id=uid,
                notification_type="league_rank_down",
                title=title,
                message=message,
                data={"new_rank": new_rank, "old_rank": old_rank, "passer": passer_alias},
            )
            notified += 1
        except Exception as e:
            logger.warning("notify_rank_changes: failed to notify %s: %s", uid, e)

    logger.info("notify_rank_changes: %d notifications sent (total users: %d)", notified, len(current))
