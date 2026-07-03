"""Investor Progress Engine — REST API. Premium-exclusive per user decision:
reinforces that leaving Nuvos means losing a demonstrated history of growth."""

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


# ── GET /api/progress/summary ─────────────────────────────────────────────────
@router.get("/summary")
async def get_summary(user_id: str = Depends(get_current_user_id)):
    """Dashboard metrics for 'Tu evolución como inversionista'. Every key is
    present only when there's enough real data — a missing key means 'not
    enough history yet', never zero."""
    await _require_premium(user_id)
    summary = await progress_service.compute_progress_summary(user_id)
    return {"summary": summary}


# ── GET /api/progress/milestones ──────────────────────────────────────────────
@router.get("/milestones")
async def get_milestones(user_id: str = Depends(get_current_user_id)):
    """Permanent timeline of achieved milestones, newest first."""
    await _require_premium(user_id)
    db = get_supabase()
    res = await run_query(
        db.table("fmg_events")
        .select("event_type, title, description, occurred_at, milestone_key")
        .eq("user_id", user_id)
        .not_.is_("milestone_key", "null")
        .order("occurred_at", desc=True)
        .limit(200)
    )
    return {"milestones": res.data or []}


# ── GET /api/progress/decisions-that-helped ───────────────────────────────────
@router.get("/decisions-that-helped")
async def get_decisions_that_helped(user_id: str = Depends(get_current_user_id)):
    """Grounded 'decisiones que evitaron errores costosos' — decision + why it
    mattered + what it shows. Never a dollar figure that can't be demonstrated."""
    await _require_premium(user_id)
    items = await progress_service.get_decisions_that_helped(user_id)
    return {"decisions": items}


# ── GET /api/progress/personalized-message ────────────────────────────────────
@router.get("/personalized-message")
async def get_personalized_message(user_id: str = Depends(get_current_user_id)):
    """One grounded sentence for a Home/Patrimonio banner, or null on an
    ordinary day. Deliberately its own light endpoint (no network-bound
    since-inception calc) since it's meant to be checked on every Home load."""
    await _require_premium(user_id)
    message = await progress_service.get_personalized_message(user_id)
    return {"message": message}
