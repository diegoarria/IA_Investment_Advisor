from fastapi import APIRouter, Depends
from app.api.deps import get_current_user_id
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def get_notifications(
    limit: int = 20,
    user_id: str = Depends(get_current_user_id)
):
    notifications = await notification_service.get_user_notifications(user_id, limit=limit)
    unread_count = sum(1 for n in notifications if not n.get("read"))
    return {"notifications": notifications, "unread_count": unread_count}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    user_id: str = Depends(get_current_user_id)
):
    await notification_service.mark_notification_read(notification_id)
    return {"marked_read": True}


@router.post("/mark-all-read")
async def mark_all_read(user_id: str = Depends(get_current_user_id)):
    from app.core.database import get_supabase
    db = get_supabase()
    db.table("notifications").update({"read": True}).eq("user_id", user_id).eq("read", False).execute()
    return {"marked_all_read": True}
