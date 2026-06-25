import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["feedback"])

_FIRST_SHOW_DAYS = 7
_REPEAT_DAYS = 30


@router.get("/status")
async def feedback_status(user_id: str = Depends(get_current_user_id)):
    """Return whether to show the feedback prompt to this user."""
    db = get_supabase()
    result = await run_query(
        db.table("user_profiles")
        .select("feedback_last_shown_at, created_at")
        .eq("user_id", user_id)
        .single()
    )
    if not result.data:
        return {"should_show": False}

    now = datetime.now(timezone.utc)
    last_shown = result.data.get("feedback_last_shown_at")

    if last_shown:
        # Already shown at least once — wait 30 days
        try:
            last_dt = datetime.fromisoformat(last_shown.replace("Z", "+00:00"))
            return {"should_show": (now - last_dt).days >= _REPEAT_DAYS}
        except Exception:
            return {"should_show": False}

    # Never shown — wait 7 days from profile creation
    profile_created = result.data.get("created_at")
    if not profile_created:
        return {"should_show": False}
    try:
        created_dt = datetime.fromisoformat(profile_created.replace("Z", "+00:00"))
        return {"should_show": (now - created_dt).days >= _FIRST_SHOW_DAYS}
    except Exception:
        return {"should_show": False}


@router.post("/seen")
async def feedback_seen(user_id: str = Depends(get_current_user_id)):
    """Mark the prompt as shown (dismissed without submitting). Resets the 30-day timer."""
    db = get_supabase()
    await run_query(
        db.table("user_profiles")
        .update({"feedback_last_shown_at": datetime.now(timezone.utc).isoformat()})
        .eq("user_id", user_id)
    )
    return {"ok": True}


@router.post("/submit")
async def feedback_submit(body: dict, user_id: str = Depends(get_current_user_id)):
    """Save user rating + message and reset the 30-day timer."""
    rating = body.get("rating")
    message = (body.get("message") or "").strip() or None

    if not isinstance(rating, int) or not (1 <= rating <= 5):
        raise HTTPException(status_code=422, detail="Rating debe ser entre 1 y 5")

    db = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    await run_query(
        db.table("user_feedback").insert({
            "user_id": user_id,
            "rating": rating,
            "message": message,
            "created_at": now,
        })
    )
    await run_query(
        db.table("user_profiles")
        .update({"feedback_last_shown_at": now})
        .eq("user_id", user_id)
    )
    logger.info("Feedback received: user=%s rating=%d", user_id, rating)
    return {"ok": True}
