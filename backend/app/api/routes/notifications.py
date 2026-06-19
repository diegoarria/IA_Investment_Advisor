from fastapi import APIRouter, Depends
from app.api.deps import get_current_user_id
from app.services import notification_service
from app.core.cache import cache_get, cache_set, cache_delete
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.post("/test")
async def send_test_notification(user_id: str = Depends(get_current_user_id)):
    """Send a test push + email to verify the notification pipeline is working."""
    from app.services.notification_engine import send_push
    from app.services.email_service import send_email
    from app.core.config import settings
    import asyncio

    db = get_supabase()
    results: dict = {}

    # Test push
    try:
        await send_push(
            user_id, "test",
            "Nuvos AI — Test de notificación",
            "Si ves esto, las notificaciones push funcionan correctamente.",
            {"screen": "home", "test": True},
            db,
        )
        results["push"] = "sent"
    except Exception as e:
        results["push"] = f"error: {e}"

    # Test email
    if settings.resend_api_key:
        try:
            users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
            email = next((u.email for u in users if u.id == user_id), None)
            if email:
                ok = await send_email(
                    email,
                    "Nuvos AI — Test de email",
                    "<h2>Si recibes este email, el sistema de emails funciona correctamente.</h2>",
                )
                results["email"] = "sent" if ok else "send_email_returned_false"
            else:
                results["email"] = "user_email_not_found"
        except Exception as e:
            results["email"] = f"error: {e}"
    else:
        results["email"] = "RESEND_API_KEY_not_set"

    # Check push token
    try:
        tok_res = await run_query(db.table("user_profiles").select("push_token").eq("user_id", user_id))
        token = (tok_res.data[0].get("push_token") or "") if tok_res.data else ""
        results["push_token"] = token[:30] + "..." if len(token) > 30 else (token or "NOT_SET")
    except Exception:
        results["push_token"] = "error_reading"

    return results


@router.get("")
async def get_notifications(
    limit: int = 20,
    user_id: str = Depends(get_current_user_id)
):
    cache_key = f"notif:{user_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    notifications = await notification_service.get_user_notifications(user_id, limit=limit)
    unread_count = sum(1 for n in notifications if not n.get("read"))
    result = {"notifications": notifications, "unread_count": unread_count}
    cache_set(cache_key, result, ttl=30)
    return result


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    user_id: str = Depends(get_current_user_id)
):
    await notification_service.mark_notification_read(notification_id)
    cache_delete(f"notif:{user_id}")
    return {"marked_read": True}


@router.post("/mark-all-read")
async def mark_all_read(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    await run_query(
        db.table("notifications").update({"read": True}).eq("user_id", user_id).eq("read", False)
    )
    cache_delete(f"notif:{user_id}")
    return {"marked_all_read": True}
