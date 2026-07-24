"""Personalized-message endpoint for the Home/Patrimonio banner.

The rest of the Investor Progress Engine (the /progress dashboard — summary,
milestones, decisions-that-helped) was cut since the screen was orphaned
(no entry point on web or mobile pointed to it anymore). This endpoint
survives because it powers a DIFFERENT, still-live feature: the
PersonalizedMessageBanner shown on Home and Patrimonio on both platforms.
Do not delete investor_progress_service.py — its other functions are used
by billing.py (Duo), chat.py/voice_call.py (mentor context), benchmark.py,
wrapped.py, admin.py, and worker.py's job_compute_benchmarks."""

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user_id
from app.api.routes.upsells import _effective_tier
from app.core.database import get_supabase, run_query
from app.services import investor_progress_service as progress_service

router = APIRouter(prefix="/progress", tags=["progress"])


async def _require_premium(user_id: str) -> None:
    db = get_supabase()
    res = await run_query(
        db.table("user_profiles")
        .select("subscription_tier, trial_started_at")
        .eq("user_id", user_id)
        .limit(1)
    )
    profile = res.data[0] if res.data else {}
    tier = _effective_tier(profile.get("subscription_tier", "free"), profile.get("trial_started_at"))
    if tier != "premium":
        raise HTTPException(status_code=403, detail="Tu evolución como inversionista es exclusiva de Premium")


# ── GET /api/progress/personalized-message ────────────────────────────────────
@router.get("/personalized-message")
async def get_personalized_message(user_id: str = Depends(get_current_user_id)):
    """One grounded sentence for a Home/Patrimonio banner, or null on an
    ordinary day. Deliberately its own light endpoint (no network-bound
    since-inception calc) since it's meant to be checked on every Home load."""
    await _require_premium(user_id)
    message = await progress_service.get_personalized_message(user_id)
    return {"message": message}
