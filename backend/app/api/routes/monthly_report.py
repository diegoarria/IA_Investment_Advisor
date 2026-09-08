"""
Nuvos Monthly Report — GET /api/monthly-report
Monthly, Spotify-Wrapped-style personal report. See
app/services/monthly_report_service.py for the full computation (this
route is intentionally thin — auth, premium gate, param validation, and
picking private vs. public shape, nothing else).

Premium-gated (unlike Wrapped, which is free for everyone by design) —
this is an ongoing monthly feature, not a once-a-year universal moment.
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
    profile = await _get_profile_safe(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    is_premium = is_premium_active(
        profile.get("subscription_tier"), profile.get("trial_started_at"), profile.get("streak_bonus_premium_until"),
    )
    if not is_premium:
        raise HTTPException(status_code=403, detail={
            "code": "premium_required",
            "message": "Tu Nuvos Monthly Report es exclusivo para Premium.",
        })

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

    return report
