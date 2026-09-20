"""Per-user economic protection for Premium (Sep 2026 COGS work).

Premium users are gated by a daily MESSAGE count (chat.py), but a message
doesn't cost a fixed amount: a 48K-token prompt on Sonnet with two tool
rounds and a long answer can cost 10x a greeting. This module tracks each
user's REAL month-to-date and day-to-date LLM spend (from llm_usage_log,
mirrored in the cache so the per-message check isn't a DB round trip) and
maps it onto levels:

    NORMAL           below warning
    WARNING          >= guard_warning_pct   of price  — log only
    HIGH_USAGE       >= guard_high_usage_pct         — log only, visible in admin
    COST_PROTECTION  >= guard_protection_pct         — Arthur silently uses the cheaper model
    HARD_STOP        >= guard_hard_stop_pct (month) or daily cap — friendly pause message

Every threshold is a fraction of the Premium price in app.core.config, so
nothing here hardcodes a dollar amount. A guard failure ALWAYS fails open
(never blocks a paying user because monitoring hiccuped).
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from app.core.cache import cache_get, cache_incr_float, cache_set
from app.core.config import settings

logger = logging.getLogger(__name__)

# Short TTL on purpose: with 4 gunicorn workers and no Redis the in-memory
# cache is per-process, so re-seeding from the DB every couple of minutes
# keeps every worker close to the true total.
_SEED_TTL_SECONDS = 120


class GuardLevel(str, Enum):
    NORMAL = "normal"
    WARNING = "warning"
    HIGH_USAGE = "high_usage"
    COST_PROTECTION = "cost_protection"
    HARD_STOP = "hard_stop"


@dataclass(frozen=True)
class GuardDecision:
    level: GuardLevel
    month_cost_usd: float
    day_cost_usd: float
    degrade_model: bool
    block: bool
    reason: str = ""


def thresholds_usd() -> dict[str, float]:
    p = settings.premium_price_usd
    return {
        "warning": round(p * settings.guard_warning_pct, 4),
        "high_usage": round(p * settings.guard_high_usage_pct, 4),
        "cost_protection": round(p * settings.guard_protection_pct, 4),
        "hard_stop": round(p * settings.guard_hard_stop_pct, 4),
        "daily_cap": round(p * settings.guard_daily_cap_pct, 4),
    }


def classify(month_cost: float, day_cost: float) -> GuardLevel:
    t = thresholds_usd()
    if month_cost >= t["hard_stop"] or day_cost >= t["daily_cap"]:
        return GuardLevel.HARD_STOP
    if month_cost >= t["cost_protection"]:
        return GuardLevel.COST_PROTECTION
    if month_cost >= t["high_usage"]:
        return GuardLevel.HIGH_USAGE
    if month_cost >= t["warning"]:
        return GuardLevel.WARNING
    return GuardLevel.NORMAL


def _period_keys(now: datetime | None = None) -> tuple[str, str]:
    now = now or datetime.now(timezone.utc)
    return now.strftime("%Y-%m"), now.strftime("%Y-%m-%d")


def month_key(user_id: str, period: str) -> str:
    return f"llm_user_month:{user_id}:{period}"


def day_key(user_id: str, day: str) -> str:
    return f"llm_user_day:{user_id}:{day}"


def record_spend(user_id: str | None, cost_usd: float) -> None:
    """Called from log_llm_usage after every priced call. Only bumps a
    counter that is already seeded — an unseeded key is seeded from the DB
    (which includes this call once its row lands) by the next evaluate()."""
    if not user_id or cost_usd <= 0:
        return
    try:
        month, day = _period_keys()
        for key, ttl in ((month_key(user_id, month), 35 * 86400), (day_key(user_id, day), 26 * 3600)):
            if cache_get(key) is not None:
                cache_incr_float(key, cost_usd, ttl=ttl)
    except Exception as exc:  # never let bookkeeping break logging
        logger.debug("cost_guard.record_spend failed: %s", exc)


async def _seed_from_db(user_id: str, month: str, day: str) -> tuple[float, float]:
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    month_start = f"{month}-01T00:00:00+00:00"
    res = await run_query(
        db.table("llm_usage_log").select("cost_usd,created_at")
        .eq("user_id", user_id).gte("created_at", month_start)
    )
    rows = res.data or []
    month_total = sum(float(r.get("cost_usd") or 0) for r in rows)
    day_total = sum(float(r.get("cost_usd") or 0) for r in rows if str(r.get("created_at", ""))[:10] == day)
    return month_total, day_total


async def spend_for(user_id: str) -> tuple[float, float]:
    """(month_to_date, day_to_date) real LLM spend for one user."""
    month, day = _period_keys()
    mk, dk = month_key(user_id, month), day_key(user_id, day)
    m, d = cache_get(mk), cache_get(dk)
    if m is None or d is None:
        m, d = await _seed_from_db(user_id, month, day)
        cache_set(mk, m, ttl=_SEED_TTL_SECONDS)
        cache_set(dk, d, ttl=_SEED_TTL_SECONDS)
    return float(m), float(d)


async def evaluate(user_id: str) -> GuardDecision:
    """Fail-open: any error yields a NORMAL decision."""
    if not settings.guard_enabled:
        return GuardDecision(GuardLevel.NORMAL, 0.0, 0.0, False, False, "guard disabled")
    try:
        month_cost, day_cost = await spend_for(user_id)
    except Exception as exc:
        logger.warning("cost_guard.evaluate failed open for %s: %s", user_id, exc)
        return GuardDecision(GuardLevel.NORMAL, 0.0, 0.0, False, False, "lookup failed")

    level = classify(month_cost, day_cost)
    if level in (GuardLevel.HIGH_USAGE, GuardLevel.COST_PROTECTION, GuardLevel.HARD_STOP):
        logger.warning(
            "cost_guard: user=%s level=%s month=$%.2f day=$%.2f thresholds=%s",
            user_id, level.value, month_cost, day_cost, thresholds_usd(),
        )
    return GuardDecision(
        level=level,
        month_cost_usd=round(month_cost, 4),
        day_cost_usd=round(day_cost, 4),
        degrade_model=level == GuardLevel.COST_PROTECTION,
        block=level == GuardLevel.HARD_STOP,
        reason=(
            "daily_cap" if level == GuardLevel.HARD_STOP and month_cost < thresholds_usd()["hard_stop"]
            else level.value
        ),
    )
