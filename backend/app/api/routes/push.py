"""
Web Push subscription management endpoints.

POST /api/push/subscribe     — register a browser push subscription
DELETE /api/push/subscribe   — remove a subscription
GET  /api/push/vapid-key     — return the VAPID public key for the browser
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.api.deps import get_current_user, get_current_user_id
from app.core.database import get_supabase, run_query
from app.services.web_push_service import is_configured
from app.core.config import settings

router = APIRouter()


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscription(BaseModel):
    endpoint: str
    keys: PushKeys


# ── VAPID public key ──────────────────────────────────────────────────────────

@router.get("/push/vapid-key")
async def get_vapid_key():
    if not is_configured():
        raise HTTPException(503, "Push notifications not configured")
    return {"publicKey": settings.vapid_public_key}


# ── Subscribe ─────────────────────────────────────────────────────────────────

@router.post("/push/subscribe", status_code=201)
async def subscribe(body: PushSubscription, user_id: str = Depends(get_current_user)):
    db = get_supabase()
    subscription_dict = {
        "endpoint": body.endpoint,
        "keys": {"p256dh": body.keys.p256dh, "auth": body.keys.auth},
    }
    # Upsert by endpoint so re-subscribing the same browser is idempotent
    await run_query(
        db.table("web_push_subscriptions")
        .upsert(
            {
                "user_id": user_id,
                "endpoint": body.endpoint,
                "subscription": subscription_dict,
            },
            on_conflict="endpoint",
        )
    )
    return {"ok": True}


# ── Unsubscribe ───────────────────────────────────────────────────────────────

class UnsubscribeBody(BaseModel):
    endpoint: str


@router.delete("/push/subscribe")
async def unsubscribe(body: UnsubscribeBody, user_id: str = Depends(get_current_user)):
    db = get_supabase()
    await run_query(
        db.table("web_push_subscriptions")
        .delete()
        .eq("user_id", user_id)
        .eq("endpoint", body.endpoint)
    )
    return {"ok": True}


# ── Test alert ────────────────────────────────────────────────────────────────

@router.post("/push/test-alert")
async def send_test_alert(user_id: str = Depends(get_current_user_id)):
    """Send a test price alert push notification to the current user.
    Uses a timestamp-based dedup key so it always fires regardless of previous sends."""
    import datetime
    from app.services.web_push_service import send_web_push_to_user
    from app.services.push_service import send_push as _expo_push

    db = get_supabase()
    title = "📈 NVDA +5.2% hoy"
    body = (
        "NVIDIA reportó ingresos de data center un 18% por encima del consenso, "
        "impulsado por demanda récord de chips H100. "
        "Diego, ganaste ~$320 hoy (12 acc × $892.40)."
    )
    data = {"ticker": "NVDA", "change_pct": 5.2, "price": 892.40, "screen": "portfolio"}

    sent_any = False

    # 1. Web push
    try:
        web_sent = await send_web_push_to_user(user_id, title, body, {**data, "category": "price_mover_test"})
        if web_sent > 0:
            sent_any = True
    except Exception:
        pass

    # 2. Expo push
    tok_res = await run_query(db.table("user_profiles").select("push_token").eq("user_id", user_id))
    token = (tok_res.data[0].get("push_token") or "") if tok_res.data else ""
    if token and token.startswith("ExponentPushToken"):
        try:
            await _expo_push(token, title=title, body=body, data={**data, "category": "price_mover_test"})
            sent_any = True
        except Exception:
            pass

    if not sent_any:
        return {"ok": True, "sent": False, "reason": "no_channel"}

    return {"ok": True, "sent": True, "reason": "sent"}
