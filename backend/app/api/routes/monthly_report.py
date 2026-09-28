"""
Nuvos Monthly Report — GET /api/monthly-report
Monthly, Spotify-Wrapped-style personal report. See
app/services/monthly_report_service.py for the full computation (this
route is intentionally thin — auth, tier check, param validation, and
picking full/free-summary shape, nothing else).

2026-09-17: Free no longer gets a flat 403 — it gets a real 3-line
executive summary (this month's return + best/worst position) carved out
of the same computed report; the full attribution/habits/research/wealth
breakdown stays Premium-only. Unlike Wrapped (free for everyone by
design), this is an ongoing monthly feature, so the depth — not the
report's existence — is what's gated.
"""
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/monthly-report", tags=["monthly-report"])


async def _get_profile_safe(user_id: str):
    db = get_supabase()
    res = await run_query(
        db.table("user_profiles").select("subscription_tier, trial_started_at, streak_bonus_premium_until, preferred_language").eq("user_id", user_id).maybe_single()
    )
    return res.data if res else None


@router.get("")
async def get_monthly_report_route(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    lang: str | None = None,
    user_id: str = Depends(get_current_user_id),
):
    from app.core.subscription import is_premium_active
    from app.core.monthly_report_window import is_monthly_report_window_open
    # Only accessible on days 1-3 of every month (Diego, 2026-09-23). 404, not
    # 403, same contract as Wrapped: "not available yet", not "forbidden".
    if not is_monthly_report_window_open():
        raise HTTPException(status_code=404, detail={
            "code": "monthly_report_window_closed",
            "message": "Tu Nuvos Monthly Report está disponible del 1 al 3 de cada mes.",
        })
    profile = await _get_profile_safe(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    is_premium = is_premium_active(
        profile.get("subscription_tier"), profile.get("trial_started_at"), profile.get("streak_bonus_premium_until"),
    )

    if lang not in ("es", "en"):
        lang = profile.get("preferred_language") or "es"

    today = date.today()
    if (year, month) > (today.year, today.month):
        raise HTTPException(status_code=400, detail="No se puede ver el reporte de un mes futuro.")

    from app.services.monthly_report_service import get_monthly_report
    try:
        report = await get_monthly_report(user_id, year, month, lang=lang)
    except Exception:
        logger.error("get_monthly_report_route(%s, %s-%s) failed", user_id, year, month, exc_info=True)
        raise HTTPException(status_code=503, detail="No pudimos generar tu Monthly Report en este momento. Intenta de nuevo en unos segundos.")

    if is_premium or not report.get("available"):
        return {"is_premium": is_premium, **report}

    # 2026-09-17: Free no longer gets a flat 403 — a 3-line executive
    # summary (how the month went, best/worst position), same real numbers
    # a Premium user sees on the overview, with the full attribution/
    # benchmark/habits/research/wealth breakdown gated instead of the
    # report's existence itself.
    portfolio = report.get("portfolio") or {}
    return {
        "is_premium": False,
        "available": True,
        "overview": report.get("overview"),
        "summary": {
            "return_pct": portfolio.get("return_pct"),
            "benchmark_pct": portfolio.get("benchmark_pct"),
            "best_position": portfolio.get("best_position"),
            "worst_position": portfolio.get("worst_position"),
        },
    }


# ── "Avísame cuando abra" (Diego, 2026-09-27) ────────────────────────────────
# The closed-window screen offers a button to get a push + email the moment
# the report opens. Same opt-in table and recurring philosophy as Wrapped's
# notify-me (feature_notify_optins, migration 095): one row per user, kept
# across months, `notified_at` marks "already told this cycle" — so a user
# who opts in once is told on the 1st of every month until they turn it off.
# worker.py's job_monthly_report_notify_available sends it.

_NOTIFY_KEY = "monthly_report"


def next_monthly_report_open_date(today: date | None = None) -> date:
    """The next day the report opens (the 1st of next month), or today while
    the window is open."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.core.monthly_report_window import MONTHLY_REPORT_CLOSE_DAY

    today = today or datetime.now(ZoneInfo("America/New_York")).date()
    if today.day <= MONTHLY_REPORT_CLOSE_DAY:
        return today
    return date(today.year + (today.month == 12), today.month % 12 + 1, 1)


@router.get("/notify-me")
async def get_monthly_report_notify_status(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("feature_notify_optins").select("user_id")
        .eq("user_id", user_id).eq("feature_key", _NOTIFY_KEY)
    )
    return {"opted_in": bool(res.data), "opens_on": next_monthly_report_open_date().isoformat()}


@router.post("/notify-me")
async def monthly_report_notify_me(user_id: str = Depends(get_current_user_id)):
    """Idempotent opt-in. Resets notified_at so a user who turned it off and
    back on is still told on the next opening."""
    db = get_supabase()
    await run_query(
        db.table("feature_notify_optins").upsert(
            {"user_id": user_id, "feature_key": _NOTIFY_KEY, "notified_at": None},
            on_conflict="user_id,feature_key",
        )
    )
    return {"opted_in": True, "opens_on": next_monthly_report_open_date().isoformat()}


@router.delete("/notify-me")
async def monthly_report_notify_off(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    await run_query(
        db.table("feature_notify_optins").delete()
        .eq("user_id", user_id).eq("feature_key", _NOTIFY_KEY)
    )
    return {"opted_in": False, "opens_on": next_monthly_report_open_date().isoformat()}
