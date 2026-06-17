"""
Notification settings API.
GET/PUT /api/notification-settings         — user preferences
POST    /api/notification-settings/track   — track open/click events
GET     /api/notification-settings/analytics — admin engagement metrics
POST    /api/notifications/send-test       — dev only
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.cache import cache_get, cache_set, cache_delete

router = APIRouter(tags=["notification-settings"])

_ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04"

_DEFAULT_PREFS = {
    "push_market_open": True, "push_market_close": True,
    "push_news_general": True, "push_portfolio_alerts": True,
    "push_watchlist_alerts": True, "push_ai_recommendations": True,
    "push_milestones": True, "push_volatility": True,
    "email_daily_summary": True, "email_weekly_summary": True,
    "max_push_per_day": 5, "max_push_per_week": 20,
    "quiet_hours_start": 22, "quiet_hours_end": 8,
    "consecutive_ignores": 0, "snooze_until": None,
}


class PrefsUpdate(BaseModel):
    push_market_open:        Optional[bool] = None
    push_market_close:       Optional[bool] = None
    push_news_general:       Optional[bool] = None
    push_portfolio_alerts:   Optional[bool] = None
    push_watchlist_alerts:   Optional[bool] = None
    push_ai_recommendations: Optional[bool] = None
    push_milestones:         Optional[bool] = None
    push_volatility:         Optional[bool] = None
    email_daily_summary:     Optional[bool] = None
    email_weekly_summary:    Optional[bool] = None
    max_push_per_day:        Optional[int]  = None
    max_push_per_week:       Optional[int]  = None
    quiet_hours_start:       Optional[int]  = None
    quiet_hours_end:         Optional[int]  = None
    snooze_until:            Optional[str]  = None


class TrackEvent(BaseModel):
    notification_id: str
    event_type: str  # 'opened' | 'clicked'


@router.get("/notification-settings")
async def get_notification_settings(user_id: str = Depends(get_current_user_id)):
    ck = f"notif_prefs:{user_id}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    db = get_supabase()
    res = await run_query(db.table("notification_preferences").select("*").eq("user_id", user_id))
    prefs = res.data[0] if res.data else {**_DEFAULT_PREFS, "user_id": user_id}
    cache_set(ck, prefs, ttl=300)
    return prefs


@router.put("/notification-settings")
async def update_notification_settings(
    body: PrefsUpdate,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        return {"ok": True}
    update_data["user_id"] = user_id
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await run_query(
        db.table("notification_preferences").upsert(update_data, on_conflict="user_id")
    )
    cache_delete(f"notif_prefs:{user_id}")
    return {"ok": True}


@router.post("/notification-settings/track")
async def track_notification_event(
    body: TrackEvent,
    user_id: str = Depends(get_current_user_id),
):
    from app.services.notification_engine import track_event
    db = get_supabase()
    await track_event(body.notification_id, body.event_type, db)
    return {"ok": True}


@router.get("/notification-settings/analytics")
async def get_analytics(user_id: str = Depends(get_current_user_id)):
    if user_id != _ADMIN_UID:
        raise HTTPException(status_code=403, detail="Admin only")
    db = get_supabase()
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    week_start  = (now - timedelta(days=7)).isoformat()
    month_start = (now - timedelta(days=30)).isoformat()

    today_res = await run_query(
        db.table("notification_log").select("id", count="exact")
        .gte("sent_at", today_start).eq("status", "sent")
    )
    week_res = await run_query(
        db.table("notification_log").select("id", count="exact")
        .gte("sent_at", week_start).eq("status", "sent")
    )
    month_res = await run_query(
        db.table("notification_log").select("id", count="exact")
        .gte("sent_at", month_start).eq("status", "sent")
    )

    logs_res = await run_query(
        db.table("notification_log").select("category,status,opened_at,type")
        .gte("sent_at", month_start).eq("type", "push")
    )
    category_stats: dict = {}
    for row in (logs_res.data or []):
        cat = row["category"]
        if cat not in category_stats:
            category_stats[cat] = {"sent": 0, "opened": 0}
        category_stats[cat]["sent"] += 1
        if row.get("opened_at"):
            category_stats[cat]["opened"] += 1

    open_rates = sorted([
        {
            "category":  cat,
            "sent":      v["sent"],
            "opened":    v["opened"],
            "open_rate": round(v["opened"] / v["sent"] * 100, 1) if v["sent"] else 0,
        }
        for cat, v in category_stats.items()
    ], key=lambda x: x["open_rate"], reverse=True)

    return {
        "totals": {
            "today": today_res.count or 0,
            "week":  week_res.count  or 0,
            "month": month_res.count or 0,
        },
        "open_rates_by_category": open_rates,
    }


@router.post("/notifications/send-test")
async def send_test_notification(
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    from app.core.config import settings
    if settings.environment != "development":
        raise HTTPException(status_code=403, detail="Dev only")
    from app.services.notification_engine import send_push
    db = get_supabase()
    await send_push(
        user_id,
        body.get("category", "test"),
        body.get("title", "Test"),
        body.get("body", "Notificación de prueba"),
        body.get("data", {}),
        db,
    )
    return {"ok": True}
