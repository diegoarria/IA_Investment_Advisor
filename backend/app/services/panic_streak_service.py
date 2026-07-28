"""'Racha del Inversor' — consecutive days since the user last sold a
position on a day the S&P 500 (SPY proxy) itself dropped hard. A "panic
sell" is defined purely mechanically (SPY closed down >= _RED_DAY_THRESHOLD
the same calendar day as the sell) — never an AI guess — so the streak is
always something the user can verify against their own real history.

Mirrors the Academy learning streak's milestone/bonus shape (app/api/routes/
learn.py's _PREMIUM_BONUS_DAYS) for a consistent mental model across the app,
and reuses that same streak's streak_bonus_premium_until column as the
shared "you currently have bonus premium" pool.
"""

import logging
from datetime import date, datetime, timedelta, timezone

from app.core.cache import cache_get, cache_set, cache_delete
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

_TTL_STREAK = 6 * 3600  # SPY's daily close doesn't change again until the next close
_RED_DAY_THRESHOLD = -0.015  # SPY same-day move <= -1.5% counts as a "red day"
_MILESTONES = [3, 7, 14, 30, 60, 90]
_PREMIUM_BONUS_DAYS = {30: 3, 60: 7, 90: 30}  # same scale as learn.py's Academy streak


def _parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _spy_red_days(lookback_days: int) -> set[date]:
    """Calendar dates where SPY closed down beyond _RED_DAY_THRESHOLD vs the
    previous trading day, over the last `lookback_days`. Lazy top-level
    import — worker.py is only safe to import for its helper functions
    since its scheduler only runs under `if __name__ == "__main__"`."""
    from worker import _finnhub_closes_with_dates

    closes = _finnhub_closes_with_dates("SPY", lookback_days)
    red_days: set[date] = set()
    for i in range(1, len(closes)):
        prev_close = closes[i - 1][1]
        d, close = closes[i]
        if prev_close > 0 and (close - prev_close) / prev_close <= _RED_DAY_THRESHOLD:
            red_days.add(d)
    return red_days


async def get_panic_streak(user_id: str) -> dict:
    cache_key = f"panic_streak:{user_id}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    db = get_supabase()
    profile_res = await run_query(
        db.table("user_profiles")
        .select("created_at, claimed_panic_streak_milestones")
        .eq("user_id", user_id)
        .maybe_single()
    )
    profile_row = profile_res.data if profile_res and profile_res.data else {}
    account_created = profile_row.get("created_at")
    claimed = list(profile_row.get("claimed_panic_streak_milestones") or [])

    sells_res = await run_query(
        db.table("investment_decisions")
        .select("created_at")
        .eq("user_id", user_id)
        .eq("action", "sell")
        .order("created_at", desc=True)
    )
    sells = sells_res.data or []

    last_panic_sell_date: date | None = None
    if sells:
        oldest_sell_dt = min(_parse_iso(r["created_at"]) for r in sells)
        lookback = max((datetime.now(timezone.utc) - oldest_sell_dt).days + 10, 40)
        red_days = _spy_red_days(lookback)
        for row in sells:  # already sorted desc — first hit is the most recent panic sell
            sell_date = _parse_iso(row["created_at"]).date()
            if sell_date in red_days:
                last_panic_sell_date = sell_date
                break

    if last_panic_sell_date:
        streak_start = datetime.combine(last_panic_sell_date, datetime.min.time(), tzinfo=timezone.utc)
    elif account_created:
        streak_start = _parse_iso(account_created)
    else:
        streak_start = datetime.now(timezone.utc)

    days = max((datetime.now(timezone.utc) - streak_start).days, 0)
    claimable = [m for m in _MILESTONES if days >= m and m not in claimed]
    next_milestone = next((m for m in _MILESTONES if m not in claimed and m > days), None)

    result = {
        "days": days,
        "last_panic_sell_date": last_panic_sell_date.isoformat() if last_panic_sell_date else None,
        "milestones": _MILESTONES,
        "claimed_milestones": claimed,
        "claimable_milestones": claimable,
        "next_milestone": next_milestone,
    }
    cache_set(cache_key, result, ttl=_TTL_STREAK)
    return result


async def claim_panic_streak_milestone(user_id: str, milestone_days: int) -> dict:
    if milestone_days not in _MILESTONES:
        raise ValueError("invalid milestone")

    streak = await get_panic_streak(user_id)
    if streak["days"] < milestone_days:
        raise PermissionError("milestone not reached yet")

    db = get_supabase()
    result = await run_query(
        db.table("user_profiles")
        .select("subscription_tier, claimed_panic_streak_milestones, streak_bonus_premium_until")
        .eq("user_id", user_id)
        .single()
    )
    if not result.data:
        raise LookupError("profile not found")

    data = result.data
    claimed = list(data.get("claimed_panic_streak_milestones") or [])
    tier = data.get("subscription_tier", "free")

    if milestone_days in claimed:
        return {"ok": True, "already_claimed": True, "milestone_days": milestone_days}

    update: dict = {"claimed_panic_streak_milestones": claimed + [milestone_days]}

    premium_bonus_days = None
    if tier != "premium" and milestone_days in _PREMIUM_BONUS_DAYS:
        premium_bonus_days = _PREMIUM_BONUS_DAYS[milestone_days]
        current_bonus = data.get("streak_bonus_premium_until")
        base = datetime.now(timezone.utc)
        if current_bonus:
            try:
                parsed = _parse_iso(current_bonus)
                if parsed > base:
                    base = parsed
            except Exception:
                pass
        update["streak_bonus_premium_until"] = (base + timedelta(days=premium_bonus_days)).isoformat()

    await run_query(db.table("user_profiles").update(update).eq("user_id", user_id))
    cache_delete(f"panic_streak:{user_id}")
    cache_delete(f"profile:{user_id}")

    return {
        "ok": True,
        "already_claimed": False,
        "milestone_days": milestone_days,
        "premium_bonus_days": premium_bonus_days,
    }
