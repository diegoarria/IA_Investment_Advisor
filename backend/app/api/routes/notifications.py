import asyncio
from fastapi import APIRouter, Depends
from app.api.deps import get_current_user_id
from app.services import notification_service
from app.core.cache import cache_get, cache_set, cache_delete

router = APIRouter(prefix="/notifications", tags=["notifications"])


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
    from app.core.database import get_supabase
    db = get_supabase()
    await asyncio.to_thread(
        lambda: db.table("notifications").update({"read": True}).eq("user_id", user_id).eq("read", False).execute()
    )
    cache_delete(f"notif:{user_id}")
    return {"marked_all_read": True}
