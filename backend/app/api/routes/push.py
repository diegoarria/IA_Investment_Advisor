"""
Web Push subscription management endpoints.

POST /api/push/subscribe     — register a browser push subscription
DELETE /api/push/subscribe   — remove a subscription
GET  /api/push/vapid-key     — return the VAPID public key for the browser
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.api.deps import get_current_user
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
