import asyncio
import logging
import stripe
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel
from typing import Literal
from app.api.deps import get_current_user_id
from app.core.config import settings
from app.core.database import get_supabase, run_query
from app.services import investor_progress_service

logger = logging.getLogger(__name__)

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

    try:
        session = await asyncio.to_thread(s.checkout.Session.create, **params)
    except Exception as e:
        logger.error("Stripe checkout session creation failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
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
        metadata = session.get("metadata") or {}

        # Annual report one-time purchase: log for on-demand generation
        if metadata.get("offer") == "annual_report" and user_id:
            logger.info("annual_report purchased by %s", user_id)

        if user_id and session.get("mode") == "subscription":
            from datetime import datetime, timezone
            update = {
                "subscription_tier": "premium",
                "stripe_customer_id": customer_id,
                "subscription_started_at": datetime.now(timezone.utc).isoformat(),
            }
            if metadata.get("offer") == "family_plan":
                update["duo_plan_purchased_at"] = datetime.now(timezone.utc).isoformat()
            await run_query(
                db.table("user_profiles").update(update).eq("user_id", user_id)
            )

    elif event["type"] in ("customer.subscription.deleted", "customer.subscription.paused"):
        customer_id = event["data"]["object"].get("customer")
        if customer_id:
            await run_query(
                db.table("user_profiles").update({
                    "subscription_tier": "free",
                }).eq("stripe_customer_id", customer_id)
            )
            await _revoke_duo_secondary(customer_id, db)

    elif event["type"] == "invoice.payment_failed":
        customer_id = event["data"]["object"].get("customer")
        if customer_id:
            await run_query(
                db.table("user_profiles").update({
                    "subscription_tier": "free",
                }).eq("stripe_customer_id", customer_id)
            )
            await _revoke_duo_secondary(customer_id, db)

    elif event["type"] == "invoice.payment_succeeded":
        # Restore premium if a previously failed payment recovered
        customer_id = event["data"]["object"].get("customer")
        billing_reason = event["data"]["object"].get("billing_reason", "")
        if customer_id and billing_reason in ("subscription_cycle", "subscription_update"):
            await run_query(
                db.table("user_profiles").update({
                    "subscription_tier": "premium",
                }).eq("stripe_customer_id", customer_id)
            )

    return {"received": True}


# ── Broker call checkout ──────────────────────────────────────────────────────
# price_1TlvyGRo7dTEppnh1uqgftWt → $49 USD (oferta 24h, default)
# price_1TlvypRo7dTEppnh6ojeqUU7 → $89 USD (precio normal, post-expiración)
_BROKER_CALL_PRICE_49 = "price_1TlvyGRo7dTEppnh1uqgftWt"
_BROKER_CALL_PRICE_89 = "price_1TlvypRo7dTEppnh6ojeqUU7"


@router.post("/broker-call-checkout")
async def broker_call_checkout(
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    """Create a Stripe Checkout Session for the 1:1 broker onboarding call.
    Body: { "offer": "49" | "89" }  — frontend sends based on countdown state.
    """
    s = _stripe()
    offer = str(body.get("offer", "49"))
    price_id = _BROKER_CALL_PRICE_49 if offer == "49" else _BROKER_CALL_PRICE_89

    base = settings.frontend_url if settings.frontend_url not in ("*", "", None) else "https://nuvosai.com"
    try:
        session = await asyncio.to_thread(
            s.checkout.Session.create,
            mode="payment",
            payment_method_types=["card"],
            line_items=[{"price": price_id, "quantity": 1}],
            client_reference_id=user_id,
            metadata={"offer": "broker_call", "price": offer},
            success_url="https://calendly.com/nuvosai/onboarding",
            cancel_url=f"{base}/home",
        )
    except Exception as e:
        logger.error("Stripe broker-call checkout failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
    return {"url": session.url}


_PROMO_DAYS = 90


@router.get("/status")
async def get_status(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    result = await run_query(
        db.table("user_profiles").select(
            "subscription_tier, msg_count, msg_window_start, trial_started_at, stripe_customer_id, broker_offer_seen_at, duo_plan_purchased_at, duo_secondary_email, streak_bonus_premium_until, claimed_streak_milestones"
        ).eq("user_id", user_id).maybe_single()
    )

    if not result or not result.data:
        return {"tier": "free", "msg_count": 0, "msg_window_start": None}

    data            = result.data
    tier            = data.get("subscription_tier", "free")
    trial_started   = data.get("trial_started_at")
    has_stripe      = bool(data.get("stripe_customer_id"))

    # Auto-start 90-day promo for any non-premium user who hasn't started a trial yet
    if tier != "premium" and not trial_started:
        trial_started = datetime.now(timezone.utc).isoformat()
        await run_query(
            db.table("user_profiles")
            .update({"trial_started_at": trial_started})
            .eq("user_id", user_id)
        )

    # Compute effective tier: premium if paid OR within 90-day promo window OR streak bonus active
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

    # Streak bonus premium (free users who earned days via streaks)
    streak_bonus_until = data.get("streak_bonus_premium_until")
    streak_bonus_active = False
    if effective_tier != "premium" and streak_bonus_until:
        try:
            bonus_end = datetime.fromisoformat(streak_bonus_until.replace("Z", "+00:00"))
            if bonus_end > datetime.now(timezone.utc):
                effective_tier = "premium"
                streak_bonus_active = True
        except Exception:
            pass

    duo_purchased = data.get("duo_plan_purchased_at")
    duo_secondary = data.get("duo_secondary_email")

    return {
        "tier":                      effective_tier,
        "is_trial":                  is_trial,
        "trial_days_left":           days_left,
        "msg_count":                 data.get("msg_count", 0),
        "msg_window_start":          data.get("msg_window_start"),
        "trial_started_at":          trial_started,
        "broker_offer_seen_at":      data.get("broker_offer_seen_at"),
        "duo_setup_pending":         bool(duo_purchased and not duo_secondary),
        "duo_secondary_email":       duo_secondary,
        "streak_bonus_premium_until": streak_bonus_until,
        "streak_bonus_active":       streak_bonus_active,
        "claimed_streak_milestones": list(data.get("claimed_streak_milestones") or []),
    }


@router.post("/broker-offer-seen")
async def broker_offer_seen(user_id: str = Depends(get_current_user_id)):
    """Mark the first time a user sees the broker call offer.
    Idempotent — only sets the timestamp once; never overwrites.
    Returns the canonical seen_at so all clients use the same clock."""
    db = get_supabase()
    result = await run_query(
        db.table("user_profiles")
        .select("broker_offer_seen_at")
        .eq("user_id", user_id)
        .single()
    )
    seen_at = result.data.get("broker_offer_seen_at") if result.data else None
    if not seen_at:
        seen_at = datetime.now(timezone.utc).isoformat()
        await run_query(
            db.table("user_profiles")
            .update({"broker_offer_seen_at": seen_at})
            .eq("user_id", user_id)
        )
    return {"broker_offer_seen_at": seen_at}


async def _find_user_id_by_email(email: str, db) -> str | None:
    """Return Supabase user_id for a given email, or None if not found."""
    try:
        users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
        for u in users:
            if (u.email or "").lower() == email.lower():
                return u.id
    except Exception as e:
        logger.warning("_find_user_id_by_email failed: %s", e)
    return None


async def _revoke_duo_secondary(primary_customer_id: str, db):
    """When a duo subscription ends, revoke premium from the linked secondary
    account and clear the bidirectional link on both sides — otherwise a
    cancelled pairing would leave stale duo_primary_user_id/duo_secondary_user_id
    pointing at an account that's no longer actually linked."""
    try:
        primary_res = await run_query(
            db.table("user_profiles")
            .select("user_id, duo_secondary_email, duo_secondary_user_id")
            .eq("stripe_customer_id", primary_customer_id)
        )
        primary_row = primary_res.data[0] if primary_res.data else None
        secondary_email = (primary_row.get("duo_secondary_email") or "") if primary_row else ""
        if not primary_row or not secondary_email:
            return
        secondary_id = primary_row.get("duo_secondary_user_id") or await _find_user_id_by_email(secondary_email, db)
        if secondary_id:
            await run_query(
                db.table("user_profiles")
                .update({"subscription_tier": "free", "duo_primary_user_id": None})
                .eq("user_id", secondary_id)
            )
            logger.info("Duo secondary %s reverted to free", secondary_email)
        await run_query(
            db.table("user_profiles")
            .update({"duo_secondary_user_id": None})
            .eq("user_id", primary_row["user_id"])
        )
    except Exception as e:
        logger.warning("_revoke_duo_secondary failed: %s", e)


@router.post("/duo-setup")
async def duo_setup(body: dict, user_id: str = Depends(get_current_user_id)):
    """Save the secondary account email for a Duo plan and grant them premium access.
    Validates that the secondary email belongs to an existing Nuvos account."""
    secondary_email = (body.get("secondary_email") or "").strip().lower()
    if not secondary_email or "@" not in secondary_email:
        raise HTTPException(status_code=422, detail="Email del segundo usuario inválido")

    db = get_supabase()

    # 1. Verify duo plan was purchased
    check = await run_query(
        db.table("user_profiles").select("duo_plan_purchased_at").eq("user_id", user_id).maybe_single()
    )
    if not (check and check.data and check.data.get("duo_plan_purchased_at")):
        raise HTTPException(status_code=403, detail="No tienes un plan Dúo activo")

    # 2. Validate secondary email exists in Nuvos
    secondary_id = await _find_user_id_by_email(secondary_email, db)
    if not secondary_id:
        raise HTTPException(
            status_code=404,
            detail="Ese email no tiene cuenta en Nuvos AI. El segundo usuario debe registrarse primero.",
        )
    if secondary_id == user_id:
        raise HTTPException(status_code=422, detail="No puedes agregar tu propia cuenta como segundo usuario")

    # 3. Grant premium to secondary account + link back to the primary, so the
    # secondary can look up its own partner instead of the link only working
    # one-directional (primary -> secondary by email).
    await run_query(
        db.table("user_profiles")
        .update({"subscription_tier": "premium", "duo_primary_user_id": user_id})
        .eq("user_id", secondary_id)
    )

    # 4. Save secondary email + resolved id on primary profile (caching the id
    # avoids re-scanning all auth users by email on every future lookup).
    await run_query(
        db.table("user_profiles")
        .update({"duo_secondary_email": secondary_email, "duo_secondary_user_id": secondary_id})
        .eq("user_id", user_id)
    )

    logger.info("Duo setup: primary=%s granted premium to secondary=%s (%s)", user_id, secondary_email, secondary_id)
    return {"ok": True, "duo_secondary_email": secondary_email}


@router.get("/duo-partner")
async def get_duo_partner(user_id: str = Depends(get_current_user_id)):
    """
    Side-by-side progress comparison for a paired Duo account — works from
    either side of the pairing (primary or secondary), since duo_setup now
    writes the link both ways. Reuses compute_progress_summary exactly as
    the solo dashboard does, so a missing field means "not enough data",
    never zero, on either side.
    """
    db = get_supabase()
    res = await run_query(
        db.table("user_profiles")
        .select("duo_primary_user_id, duo_secondary_user_id")
        .eq("user_id", user_id)
        .limit(1)
    )
    row = res.data[0] if res.data else {}
    partner_id = row.get("duo_secondary_user_id") or row.get("duo_primary_user_id")
    if not partner_id:
        return {"paired": False}

    partner_res = await run_query(
        db.table("user_profiles").select("full_name").eq("user_id", partner_id).limit(1)
    )
    partner_name = (partner_res.data[0].get("full_name") if partner_res.data else None) or "Tu pareja"

    my_summary, partner_summary = await asyncio.gather(
        investor_progress_service.compute_progress_summary(user_id),
        investor_progress_service.compute_progress_summary(partner_id),
    )

    return {
        "paired": True,
        "partner_name": partner_name,
        "my_summary": my_summary,
        "partner_summary": partner_summary,
    }

