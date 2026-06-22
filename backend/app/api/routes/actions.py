from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/actions", tags=["actions"])


@router.post("/commit")
async def commit_action(body: dict, user_id: str = Depends(get_current_user_id)):
    """User explicitly commits to a mentor-suggested action — triggers a push reminder later."""
    db = get_supabase()
    now = datetime.now(timezone.utc)
    due_at = now + timedelta(hours=int(body.get("remind_in_hours", 24)))
    await run_query(
        db.table("pending_actions").insert({
            "user_id": user_id,
            "action_type": body.get("type", "general"),
            "action_label": body.get("label", ""),
            "action_data": body.get("data", {}),
            "status": "committed",
            "due_at": due_at.isoformat(),
        })
    )
    return {"ok": True}


@router.patch("/{action_id}")
async def update_action(action_id: str, body: dict, user_id: str = Depends(get_current_user_id)):
    """Mark action as done, dismissed, or snoozed."""
    db = get_supabase()
    status = body.get("status", "done")
    update: dict = {"status": status}
    if status == "done":
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
    elif status == "snoozed":
        snooze_hours = int(body.get("snooze_hours", 48))
        update["due_at"] = (datetime.now(timezone.utc) + timedelta(hours=snooze_hours)).isoformat()
        update["notified_at"] = None
    await run_query(
        db.table("pending_actions")
        .update(update)
        .eq("id", action_id)
        .eq("user_id", user_id)
    )
    return {"ok": True}


@router.post("/test-reminder")
async def test_reminder(user_id: str = Depends(get_current_user_id)):
    """Dev/QA — immediately sends a sample action follow-up push to the current user."""
    from app.services.notification_engine import send_push
    db = get_supabase()
    await send_push(
        user_id, "action_followup",
        "¿Agregaste VTI a tu watchlist?",
        "Ayer hablaste con tu mentor sobre diversificar con ETFs. ¿Ya lo hiciste?",
        {"screen": "chat", "suggested_message": "¿Es buen momento para agregar VTI a mi portafolio?"},
        db,
    )
    return {"ok": True, "message": "Push enviado — revisa tu dispositivo."}


@router.get("/")
async def list_actions(user_id: str = Depends(get_current_user_id)):
    """List user's pending committed actions."""
    db = get_supabase()
    res = await run_query(
        db.table("pending_actions")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "committed")
        .order("due_at")
        .limit(20)
    )
    return {"actions": res.data or []}
