import stripe
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel
from typing import Literal
from app.api.deps import get_current_user_id
from app.core.config import settings
from app.core.database import get_supabase

router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    plan: Literal["monthly", "yearly"] = "monthly"


def _stripe():
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Pagos no configurados aún")
    stripe.api_key = settings.stripe_secret_key
    return stripe


def _price_id(plan: str) -> str:
    if plan == "yearly":
        price_id = settings.stripe_price_id_yearly
    else:
        price_id = settings.stripe_price_id_monthly
    if not price_id:
        raise HTTPException(status_code=503, detail="Precio no configurado")
    return price_id


@router.post("/create-checkout")
async def create_checkout(body: CheckoutRequest, user_id: str = Depends(get_current_user_id)):
    s = _stripe()
    db = get_supabase()

    result = db.table("user_profiles").select("stripe_customer_id").eq("user_id", user_id).single().execute()
    customer_id = result.data.get("stripe_customer_id") if result.data else None

    success_url = "https://nuvo.app/premium-success"
    cancel_url  = "https://nuvo.app/premium-cancel"
    if settings.frontend_url not in ("*", ""):
        success_url = f"{settings.frontend_url}/premium-success"
        cancel_url  = f"{settings.frontend_url}/premium-cancel"

    params: dict = {
        "mode": "subscription",
        "payment_method_types": ["card"],
        "line_items": [{"price": _price_id(body.plan), "quantity": 1}],
        "client_reference_id": user_id,
        "success_url": success_url + "?session_id={CHECKOUT_SESSION_ID}",
        "cancel_url": cancel_url,
    }
    if customer_id:
        params["customer"] = customer_id

    session = s.checkout.Session.create(**params)
    return {"url": session.url}


@router.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Webhook no configurado")

    try:
        stripe.api_key = settings.stripe_secret_key
        event = stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Firma inválida")

    db = get_supabase()

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = session.get("client_reference_id")
        customer_id = session.get("customer")
        if user_id:
            db.table("user_profiles").update({
                "subscription_tier": "premium",
                "stripe_customer_id": customer_id,
            }).eq("user_id", user_id).execute()

    elif event["type"] in ("customer.subscription.deleted", "customer.subscription.paused"):
        customer_id = event["data"]["object"].get("customer")
        if customer_id:
            db.table("user_profiles").update({
                "subscription_tier": "free",
            }).eq("stripe_customer_id", customer_id).execute()

    elif event["type"] == "invoice.payment_failed":
        customer_id = event["data"]["object"].get("customer")
        if customer_id:
            db.table("user_profiles").update({
                "subscription_tier": "free",
            }).eq("stripe_customer_id", customer_id).execute()

    return {"received": True}


@router.get("/status")
async def get_status(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = db.table("user_profiles").select(
        "subscription_tier, msg_count, msg_window_start"
    ).eq("user_id", user_id).single().execute()
    if not result.data:
        return {"tier": "free", "msg_count": 0, "msg_window_start": None}
    return {
        "tier": result.data.get("subscription_tier", "free"),
        "msg_count": result.data.get("msg_count", 0),
        "msg_window_start": result.data.get("msg_window_start"),
    }
