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
    "max_push_per_day": 15, "max_push_per_week": 60,
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
    if res.data:
        prefs = res.data[0]
    else:
        # First time — insert defaults so the worker can find this user
        prefs = {**_DEFAULT_PREFS, "user_id": user_id}
        try:
            await run_query(db.table("notification_preferences").insert(prefs))
        except Exception:
            pass
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


@router.post("/admin/send-notification")
async def admin_send_notification(
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    """Admin-only: send a custom push notification to yourself."""
    if user_id != _ADMIN_UID:
        raise HTTPException(status_code=403, detail="Admin only")
    from app.services.notification_engine import send_push
    db = get_supabase()
    await send_push(
        user_id,
        body.get("category", "admin_test"),
        body.get("title", "Test"),
        body.get("body", ""),
        body.get("data", {}),
        db,
    )
    return {"ok": True}


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


class PricePayload(BaseModel):
    prices: dict  # {ticker: {curr: float, prev: float}}

@router.post("/admin/trigger-price-alerts")
async def trigger_price_alerts(
    body: PricePayload,
    user_id: str = Depends(get_current_user_id),
):
    """Admin-only: fan out push notifications using caller-provided prices.
    Prices are fetched locally (yfinance works there) and POSTed here,
    bypassing Railway IP blocks on Yahoo Finance."""
    if user_id != _ADMIN_UID:
        raise HTTPException(status_code=403, detail="Admin only")
    from app.core.database import run_query
    from app.services.notification_engine import send_push

    db = get_supabase()

    # 1. Compute moves from provided prices
    moves: dict = {}
    for t, px in body.prices.items():
        prev = px.get("prev", 0)
        curr = px.get("curr", 0)
        if prev and prev > 0:
            pct = round((curr - prev) / prev * 100, 2)
            if abs(pct) >= 3.0:
                moves[t] = {"pct": pct, "price": curr}

    if not moves:
        return {"error": "no movers ≥3% in provided prices", "prices_received": len(body.prices)}

    # 2. Get all users' portfolio + watchlist tickers
    prefs_res = await run_query(
        db.table("notification_preferences")
        .select("user_id,push_portfolio_alerts,push_watchlist_alerts")
        .or_("push_portfolio_alerts.eq.true,push_watchlist_alerts.eq.true")
    )
    if not prefs_res.data:
        return {"error": "no users with prefs"}

    user_tickers: dict = {}
    for p in prefs_res.data:
        uid = p["user_id"]
        port_set: set = set()
        watch_set: set = set()
        if p.get("push_portfolio_alerts"):
            port_res = await run_query(db.table("user_portfolio").select("positions").eq("user_id", uid))
            if port_res.data:
                raw = port_res.data[0].get("positions") or {}
                pos = raw.get("positions", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                port_set = {x["ticker"] for x in pos if x.get("ticker")}
        if p.get("push_watchlist_alerts"):
            w_res = await run_query(db.table("watchlist").select("ticker").eq("user_id", uid))
            watch_set = {r["ticker"] for r in (w_res.data or [])} - port_set
        if port_set or watch_set:
            user_tickers[uid] = {"port": port_set, "watch": watch_set}

    # 3. Fan out — one push per ticker per band per user
    sent_pushes = []
    for uid, sets in user_tickers.items():
        combined = (sets["port"] | sets["watch"]) & moves.keys()
        for ticker in sorted(combined, key=lambda t: abs(moves[t]["pct"]), reverse=True):
            pct   = moves[ticker]["pct"]
            price = moves[ticker]["price"]
            direction = "bajando" if pct < 0 else "subiendo"
            title = f"{ticker} Price Alert"
            body  = f"{ticker} está {direction} {pct:+.2f}% a ${price:.2f}"
            band  = 15 if abs(pct) >= 15 else (10 if abs(pct) >= 10 else (8 if abs(pct) >= 8 else (5 if abs(pct) >= 5 else 3)))
            await send_push(uid, f"price_mover_{ticker}_band{band}", title, body,
                            {"ticker": ticker, "change_pct": pct, "price": price,
                             "screen": "portfolio" if ticker in sets["port"] else "watchlist"}, db)
            sent_pushes.append({"user": uid[:8], "ticker": ticker, "pct": pct, "price": price, "body": body})

    return {
        "movers": {t: v for t, v in sorted(moves.items(), key=lambda x: abs(x[1]["pct"]), reverse=True)},
        "pushes_sent": sent_pushes,
    }
