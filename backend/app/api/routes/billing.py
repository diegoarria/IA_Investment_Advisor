import stripe
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel
from typing import Literal
from app.api.deps import get_current_user_id
from app.core.config import settings
from app.core.database import get_supabase, run_query

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

    result = await run_query(
        db.table("user_profiles").select("stripe_customer_id").eq("user_id", user_id).single()
    )
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
            await run_query(
                db.table("user_profiles").update({
                    "subscription_tier": "premium",
                    "stripe_customer_id": customer_id,
                }).eq("user_id", user_id)
            )

    elif event["type"] in ("customer.subscription.deleted", "customer.subscription.paused"):
        customer_id = event["data"]["object"].get("customer")
        if customer_id:
            await run_query(
                db.table("user_profiles").update({
                    "subscription_tier": "free",
                }).eq("stripe_customer_id", customer_id)
            )

    elif event["type"] == "invoice.payment_failed":
        customer_id = event["data"]["object"].get("customer")
        if customer_id:
            await run_query(
                db.table("user_profiles").update({
                    "subscription_tier": "free",
                }).eq("stripe_customer_id", customer_id)
            )

    return {"received": True}


_PROMO_DAYS = 90


@router.get("/status")
async def get_status(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(
        db.table("user_profiles").select(
            "subscription_tier, msg_count, msg_window_start, trial_started_at, stripe_customer_id"
        ).eq("user_id", user_id).single()
    )

    if not result.data:
        return {"tier": "free", "msg_count": 0, "msg_window_start": None}

    data            = result.data
    tier            = data.get("subscription_tier", "free")
    trial_started   = data.get("trial_started_at")
    has_stripe      = bool(data.get("stripe_customer_id"))

    # Auto-start 90-day promo for any user who hasn't paid and hasn't started a trial yet
    if tier != "premium" and not trial_started and not has_stripe:
        trial_started = datetime.now(timezone.utc).isoformat()
        await run_query(
            db.table("user_profiles")
            .update({"trial_started_at": trial_started})
            .eq("user_id", user_id)
        )

    # Compute effective tier: premium if paid OR within 90-day promo window
    effective_tier = tier
    is_trial       = False
    days_left      = 0
    if tier != "premium" and trial_started:
        try:
            started   = datetime.fromisoformat(trial_started.replace("Z", "+00:00"))
            elapsed   = (datetime.now(timezone.utc) - started).total_seconds() / 86400
            remaining = _PROMO_DAYS - elapsed
            if remaining > 0:
                effective_tier = "premium"
                is_trial       = True
                days_left      = int(remaining)
        except Exception:
            pass

    return {
        "tier":             effective_tier,
        "is_trial":         is_trial,
        "trial_days_left":  days_left,
        "msg_count":        data.get("msg_count", 0),
        "msg_window_start": data.get("msg_window_start"),
        "trial_started_at": trial_started,
    }
