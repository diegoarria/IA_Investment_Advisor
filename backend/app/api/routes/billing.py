import asyncio
import logging
import stripe
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel
from typing import Literal
from app.api.deps import get_current_user_id, get_current_user
from app.core.config import settings
from app.core.database import get_supabase, get_fresh_supabase, run_query
from app.core.cache import cache_delete
from app.core.stripe_retry import stripe_call as _stripe_call
from app.services import investor_progress_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    plan: Literal["monthly", "yearly"] = "monthly"
    # The currency the paywall SHOWED the user (from GET /billing/pricing). Honored
    # for "mxn" so what is displayed is always what is charged, even if the
    # server-side profile lookup below hiccups (a silent USD fallback there is
    # exactly what charged a Mexican user $14.99 USD while the paywall said $259 MXN).
    currency: Literal["usd", "mxn"] | None = None


def _stripe():
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Pagos no configurados aún")
    stripe.api_key = settings.stripe_secret_key
    return stripe


def _price_id(plan: str, mexico: bool = False) -> str:
    # Mexican users get the MXN price (falls back to USD if not configured) —
    # see app/core/pricing_region.py for why.
    from app.core.pricing_region import subscription_price_id
    price_id = subscription_price_id(plan, mexico, settings)
    if not price_id:
        raise HTTPException(status_code=503, detail="Precio no configurado")
    return price_id


def _adaptive_available() -> bool:
    """Adaptive Pricing checkout is only offered when explicitly enabled AND the
    MXN Premium prices it is anchored on are configured."""
    return bool(
        getattr(settings, "checkout_adaptive_pricing", False)
        and getattr(settings, "stripe_price_id_monthly_mxn", "")
        and getattr(settings, "stripe_price_id_yearly_mxn", "")
    )


@router.get("/pricing")
async def get_pricing(user_id: str = Depends(get_current_user_id)):
    """Which currency this user will be charged in, plus the real amounts, so
    the paywall shows what Stripe will actually bill. Mexican users are
    charged in MXN when the MXN prices are configured (many Mexican cards
    reject USD); everyone else — and any failure here — gets USD."""
    from app.core.cache import cache_get, cache_set

    usd = {"currency": "usd"}
    adaptive = _adaptive_available()
    # Diego, 2026-09-23: the paywall shows MXN by default for EVERYONE, not
    # just Mexican users. The client echoes the shown currency back on
    # checkout (CheckoutRequest.currency == "mxn" is honored below), so what
    # is displayed is what is charged. If the MXN prices aren't configured
    # or the Stripe lookup fails, this still falls back to USD (display and
    # charge stay consistent either way).

    ids = {
        "monthly": settings.stripe_price_id_monthly_mxn,
        "yearly": settings.stripe_price_id_yearly_mxn,
        "duo_monthly": getattr(settings, "stripe_price_family_monthly_mxn", ""),
        "duo_yearly": getattr(settings, "stripe_price_family_yearly_mxn", ""),
        "session_free": getattr(settings, "stripe_price_session_free_mxn", ""),
        "session_premium": getattr(settings, "stripe_price_session_premium_mxn", ""),
        "session_bundle": getattr(settings, "stripe_price_session_bundle_mxn", ""),
        "broker_call": getattr(settings, "stripe_price_broker_call_mxn", ""),
    }
    if not ids["monthly"] or not ids["yearly"]:
        return usd  # MXN checkout isn't configured for Premium -> checkout will charge USD too
    cache_key = "pricing:mxn:v2:adaptive" if adaptive else "pricing:mxn:v1"
    cached = cache_get(cache_key)
    if cached:
        return cached
    try:
        s = _stripe()
        out: dict = {"currency": "mxn", **({"adaptive": True} if adaptive else {})}
        for key, price_id in ids.items():
            if not price_id:
                continue
            price = await _stripe_call(s.Price.retrieve, price_id)
            out[key] = (price.get("unit_amount") or 0) / 100
    except Exception as e:
        logger.warning("get_pricing: Stripe price lookup failed: %s", e)
        return usd
    cache_set(cache_key, out, ttl=3600)
    return out


@router.post("/sync-subscription")
async def sync_subscription_endpoint(user: dict = Depends(get_current_user)):
    """Activates Premium straight from Stripe for a user who has paid — the
    safety net for a missed/unmatched webhook (see app/services/subscription_sync.py).
    Called by the post-payment success page. Idempotent; only ever upgrades."""
    from app.services.subscription_sync import sync_subscription
    db = get_fresh_supabase()
    try:
        return await sync_subscription(db, user["id"], user.get("email"))
    except Exception as e:
        logger.error("sync_subscription failed for user %s: %s", user["id"], e)
        raise HTTPException(status_code=503, detail="No se pudo verificar tu pago. Intenta de nuevo en unos segundos.")


@router.post("/create-checkout")
async def create_checkout(body: CheckoutRequest, user_id: str = Depends(get_current_user_id)):
    s = _stripe()
    db = get_supabase()

    try:
        result = await run_query(
            db.table("user_profiles").select("stripe_customer_id, country, phone_number").eq("user_id", user_id).single()
        )
    except Exception as e:
        # Was unguarded — a real Postgrest error here (or `.single()`
        # raising on a missing/duplicate profile row) escaped as a raw,
        # unlogged 500. Same bug class Diego confirmed 2026-09-16 in
        # upsells.py's checkout endpoints — fixed there but missed here,
        # the endpoint behind the MAIN Premium paywall's "No se pudo abrir
        # el pago." Degrade gracefully instead: proceed as if there's no
        # linked Stripe customer yet (Stripe.Customer.create below still
        # runs), same as a genuinely new customer.
        logger.error("create_checkout: profile lookup failed for user %s: %s", user_id, e)
        result = None
    customer_id = result.data.get("stripe_customer_id") if result and result.data else None
    from app.core.pricing_region import is_mexico
    mexico = bool(result and result.data and is_mexico(result.data.get("country"), result.data.get("phone_number")))
    mexico = mexico or body.currency == "mxn"

    success_url = "https://nuvo.app/premium-success"
    cancel_url  = "https://nuvo.app/premium-cancel"
    if settings.frontend_url not in ("*", ""):
        success_url = f"{settings.frontend_url}/premium-success"
        cancel_url  = f"{settings.frontend_url}/premium-cancel"

    price_id = _price_id(body.plan, mexico)
    params: dict = {
        "mode": "subscription",
        "payment_method_types": ["card"],
        "line_items": [{"price": price_id, "quantity": 1}],
        "client_reference_id": user_id,
        "success_url": success_url + "?session_id={CHECKOUT_SESSION_ID}",
        "cancel_url": cancel_url,
    }
    if customer_id:
        params["customer"] = customer_id

    try:
        session = await _stripe_call(s.checkout.Session.create, **params)
    except Exception as e:
        # 2026-09-24, Diego: a real Premium checkout failed outright ("Pagos
        # temporalmente no disponibles") right after the MXN price path
        # started being selected for him (this fix's own is_mexico() check
        # matching country/phone_number for the first time) — the MXN price
        # id itself was bad/misconfigured in Stripe, a real, permanent
        # InvalidRequestError, not the transient blip stripe_call already
        # retries. Never let a broken/misconfigured MXN price hard-block a
        # sale when the USD price is right there and known-good: retry once
        # with USD before giving up, same "a real number beats a hard
        # failure" instinct as everywhere else this session.
        if mexico:
            logger.error(
                "create_checkout: MXN price %s failed for user %s, retrying with USD: %s",
                price_id, user_id, e,
            )
            try:
                params["line_items"] = [{"price": _price_id(body.plan, False), "quantity": 1}]
                session = await _stripe_call(s.checkout.Session.create, **params)
            except Exception as e2:
                logger.error("create_checkout: USD fallback also failed for user %s: %s", user_id, e2)
                raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
        else:
            logger.error("Stripe checkout session creation failed for user %s: %s", user_id, e)
            raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
    return {"url": session.url}


@router.post("/create-adaptive-checkout")
async def create_adaptive_checkout(body: CheckoutRequest, user: dict = Depends(get_current_user)):
    """Premium individual via a Checkout Session (ui_mode="elements") with
    Stripe Adaptive Pricing, so customers see and pay in their local currency
    (Stripe guarantees the rate for 24h; foreign customers bear a 2-4%
    conversion fee, not Nuvos). Unlike the embedded flow above, Adaptive
    Pricing is NOT supported on the PaymentIntents API — hence a Checkout Session.

    The price is always the MXN one: this account settles only in MXN (multi-
    currency settlement isn't available in Mexico) and Adaptive Pricing
    requires the price currency to be a settlement currency.

    Premium is granted by the existing webhook (checkout.session.completed
    with client_reference_id, then invoice.payment_succeeded) — no change
    there. Returns 404 when the feature is off so the client falls back."""
    if not _adaptive_available():
        raise HTTPException(status_code=404, detail="Adaptive Pricing no disponible.")
    s = _stripe()
    db = get_supabase()
    user_id = user["id"]

    customer_id = None
    try:
        res = await run_query(db.table("user_profiles").select("stripe_customer_id").eq("user_id", user_id).single())
        customer_id = res.data.get("stripe_customer_id") if res and res.data else None
    except Exception as e:
        logger.error("create_adaptive_checkout: profile lookup failed for user %s: %s", user_id, e)
    if not customer_id:
        try:
            customer = await _stripe_call(s.Customer.create, email=user.get("email"), metadata={"user_id": user_id})
        except Exception as e:
            logger.error("Stripe customer creation failed for user %s: %s", user_id, e)
            raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
        customer_id = customer.id
        try:
            await run_query(db.table("user_profiles").update({"stripe_customer_id": customer_id}).eq("user_id", user_id))
        except Exception as e:
            logger.error("create_adaptive_checkout: failed to persist stripe_customer_id for user %s: %s", user_id, e)

    price_id = _price_id(body.plan, True)
    base = settings.frontend_url.rstrip("/") if settings.frontend_url not in ("*", "", None) else "https://nuvosai.com"
    logger.info("create_adaptive_checkout: user=%s plan=%s price=%s", user_id, body.plan, price_id)
    try:
        session = await _stripe_call(
            s.checkout.Session.create,
            stripe_version=settings.stripe_checkout_api_version,
            mode="subscription",
            ui_mode="elements",
            customer=customer_id,
            client_reference_id=user_id,
            line_items=[{"price": price_id, "quantity": 1}],
            adaptive_pricing={"enabled": True},
            return_url=f"{base}/premium-success?session_id={{CHECKOUT_SESSION_ID}}",
        )
    except Exception as e:
        logger.error("Stripe adaptive checkout session creation failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
    return {"client_secret": session.client_secret, "session_id": session.id}


@router.post("/create-embedded-subscription")
async def create_embedded_subscription(body: CheckoutRequest, user: dict = Depends(get_current_user)):
    """Diego, 2026-09-15: "que se vea como un paywall personalizado de
    Nuvos" — the embedded-Elements counterpart to /create-checkout, which
    redirects to a Stripe-hosted page. Instead of a Checkout Session, this
    creates the Subscription directly (payment_behavior=default_incomplete)
    and hands the frontend a PaymentIntent client_secret to mount Stripe's
    Payment Element inside Nuvos's own PricingModal — the user never leaves
    nuvosai.com. Stripe still does 100% of the actual card handling/PCI
    compliance via its Elements iframe; only the checkout UI around it is
    Nuvos's.

    stripe_customer_id is saved HERE, synchronously, before the user even
    enters a card — the webhook's invoice.payment_succeeded (billing_reason
    == "subscription_create") grants premium by looking up this same
    customer_id, so it must already be linked by the time that event
    arrives."""
    s = _stripe()
    db = get_supabase()
    user_id = user["id"]

    try:
        result = await run_query(
            db.table("user_profiles").select("stripe_customer_id, country, phone_number").eq("user_id", user_id).single()
        )
    except Exception as e:
        # Was unguarded — a real Postgrest error here (or `.single()`
        # raising on a missing/duplicate profile row) escaped as a raw,
        # unlogged 500, which EmbeddedCheckout.tsx (this IS the endpoint
        # behind the main "Nuvos AI Premium" paywall) surfaces as the
        # generic, undiagnosable "No se pudo abrir el pago." Confirmed
        # 2026-09-17 from a live screenshot of exactly this. Same bug class
        # already fixed in upsells.py's checkout endpoints 2026-09-16 —
        # missed here. Degrade gracefully: proceed as if there's no linked
        # Stripe customer yet, so the block below creates one fresh —
        # worst case is one duplicate Stripe customer, never a blocked
        # payment.
        logger.error("create_embedded_subscription: profile lookup failed for user %s: %s", user_id, e)
        result = None
    customer_id = result.data.get("stripe_customer_id") if result and result.data else None
    from app.core.pricing_region import is_mexico
    mexico = bool(result and result.data and is_mexico(result.data.get("country"), result.data.get("phone_number")))
    mexico = mexico or body.currency == "mxn"

    if not customer_id:
        try:
            customer = await _stripe_call(
                s.Customer.create, email=user.get("email"), metadata={"user_id": user_id},
            )
        except Exception as e:
            logger.error("Stripe customer creation failed for user %s: %s", user_id, e)
            raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
        customer_id = customer.id
        try:
            await run_query(
                db.table("user_profiles").update({"stripe_customer_id": customer_id}).eq("user_id", user_id)
            )
        except Exception as e:
            # Best-effort — the webhook's premium grant re-derives
            # customer_id from Stripe's own event payload by this same
            # eq("stripe_customer_id", ...) lookup, so a failed write here
            # would (rarely) delay that grant, not block it forever the
            # next time this profile is read/written. Blocking the payment
            # FORM from ever opening over a non-critical persistence write
            # is strictly worse — the user is already mid-checkout with a
            # real Stripe customer created.
            logger.error("create_embedded_subscription: failed to persist stripe_customer_id for user %s: %s", user_id, e)

    price_id = _price_id(body.plan, mexico)
    logger.info(
        "create_embedded_subscription: user=%s plan=%s mexico=%s requested_currency=%s price=%s",
        user_id, body.plan, mexico, body.currency, price_id,
    )
    try:
        subscription = await _stripe_call(
            s.Subscription.create,
            customer=customer_id,
            items=[{"price": price_id}],
            payment_behavior="default_incomplete",
            payment_settings={"save_default_payment_method": "on_subscription"},
            expand=["latest_invoice.payment_intent"],
        )
    except Exception as e:
        # 2026-09-24, Diego: a real Premium checkout failed outright right
        # after the MXN price path started being selected for him (this
        # fix's own is_mexico() check matching country/phone_number for the
        # first time) — this IS the endpoint behind the main paywall (see
        # this function's own docstring). Never let a broken/misconfigured
        # MXN price hard-block a sale when the USD price is right there and
        # known-good — retry once with USD before giving up, same fallback
        # already added to /create-checkout above.
        if mexico:
            logger.error(
                "create_embedded_subscription: MXN price %s failed for user %s, retrying with USD: %s",
                price_id, user_id, e,
            )
            try:
                price_id = _price_id(body.plan, False)
                subscription = await _stripe_call(
                    s.Subscription.create,
                    customer=customer_id,
                    items=[{"price": price_id}],
                    payment_behavior="default_incomplete",
                    payment_settings={"save_default_payment_method": "on_subscription"},
                    expand=["latest_invoice.payment_intent"],
                )
            except Exception as e2:
                logger.error("create_embedded_subscription: USD fallback also failed for user %s: %s", user_id, e2)
                raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
        else:
            logger.error("Stripe embedded subscription creation failed for user %s: %s", user_id, e)
            raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")

    client_secret = subscription.latest_invoice.payment_intent.client_secret
    return {"client_secret": client_secret, "subscription_id": subscription.id}


@router.post("/create-portal-session")
async def create_portal_session(user_id: str = Depends(get_current_user_id)):
    """Diego, 2026-09-15: there was previously NO way for a user to cancel
    their subscription — not in-app, not via Stripe's hosted portal, not
    anything. This is the fix: Stripe's Customer Portal, a hosted page
    (brandable in the Stripe Dashboard) where a real Stripe subscriber can
    cancel, change plans, update their card, or view invoices — all
    without Nuvos having to build or own any of that lifecycle logic
    itself. Returns a redirect URL; unlike the payment flows, this is
    account MANAGEMENT, not a purchase, so leaving the app for it is the
    normal, expected pattern (this is exactly what redirecting to
    nuvosai.com already does for mobile's "Administrar suscripción")."""
    s = _stripe()
    db = get_supabase()
    try:
        result = await run_query(
            db.table("user_profiles").select("stripe_customer_id").eq("user_id", user_id).single()
        )
    except Exception as e:
        # Was unguarded — same bug class as create_embedded_subscription
        # above: a transient Postgrest/`.single()` error here escaped as an
        # uncaught 500 instead of the honest "try again" message every
        # other failure path in this file already gives.
        logger.error("create_portal_session: profile lookup failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="No se pudo abrir el portal de suscripción. Intenta de nuevo en unos segundos.")
    customer_id = result.data.get("stripe_customer_id") if result.data else None
    if not customer_id:
        raise HTTPException(status_code=404, detail="No tienes una suscripción de Stripe que administrar.")

    base = settings.frontend_url.rstrip("/") if settings.frontend_url not in ("*", "") else "https://nuvosai.com"
    try:
        session = await asyncio.to_thread(
            s.billing_portal.Session.create,
            customer=customer_id,
            return_url=f"{base}/profile",
        )
    except Exception as e:
        logger.error("Stripe portal session creation failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="No se pudo abrir el portal de suscripción. Intenta de nuevo en unos minutos.")
    return {"url": session.url}


async def _get_customer_id_or_404(user_id: str, db) -> str:
    try:
        result = await run_query(
            db.table("user_profiles").select("stripe_customer_id").eq("user_id", user_id).single()
        )
    except Exception as e:
        # Was unguarded — same bug class as create_embedded_subscription
        # above (see its comment). This helper backs subscription-details/
        # cancel/resume, so an uncaught error here read as "no subscription
        # to manage" would have been actively misleading, not just a crash.
        logger.error("_get_customer_id_or_404: profile lookup failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="No pudimos verificar tu suscripción. Intenta de nuevo en unos segundos.")
    customer_id = result.data.get("stripe_customer_id") if result.data else None
    if not customer_id:
        raise HTTPException(status_code=404, detail="No tienes una suscripción de Stripe que administrar.")
    return customer_id


def _current_subscription(s, customer_id: str):
    """The one subscription that actually matters for the account —
    active/trialing/past_due (still has access), preferring the most
    recently created if there's somehow more than one. No stripe_
    subscription_id is stored anywhere in Supabase (only stripe_customer_id
    is), so every cancel/resume/details call looks this up live rather than
    needing a schema change to track it."""
    subs = s.Subscription.list(customer=customer_id, status="all", limit=10)
    live = [sub for sub in subs.data if sub.status in ("active", "trialing", "past_due")]
    if not live:
        return None
    live.sort(key=lambda sub: sub.created, reverse=True)
    return live[0]


@router.get("/subscription-details")
async def get_subscription_details(user_id: str = Depends(get_current_user_id)):
    """Diego, 2026-09-15: "no se puede cancelar dentro de la web app?" —
    real numbers (renewal/cancellation date, plan interval, amount) so the
    Profile page can show its own cancel/resume UI instead of sending the
    user to Stripe's portal and hoping they find the right button there."""
    s = _stripe()
    db = get_supabase()
    customer_id = await _get_customer_id_or_404(user_id, db)

    try:
        sub = await asyncio.to_thread(_current_subscription, s, customer_id)
    except Exception as e:
        logger.error("Stripe subscription lookup failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="No se pudo consultar tu suscripción. Intenta de nuevo en unos minutos.")
    if not sub:
        raise HTTPException(status_code=404, detail="No se encontró una suscripción activa.")

    item = sub["items"]["data"][0] if sub["items"]["data"] else None
    price = item["price"] if item else None
    return {
        "status": sub.status,
        "cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
        "current_period_end": sub.get("current_period_end"),
        "cancel_at": sub.get("cancel_at"),
        "plan_interval": (price.get("recurring") or {}).get("interval") if price else None,
        "amount": (price.get("unit_amount") or 0) / 100 if price else None,
        "currency": price.get("currency") if price else None,
    }


@router.post("/cancel-subscription")
async def cancel_subscription(user_id: str = Depends(get_current_user_id)):
    """Cancels AT PERIOD END, not immediately — same "keep access until the
    period you already paid for ends, no refund needed" behavior as
    ChatGPT/Spotify, and consistent with the checkout's own "cancela cuando
    quieras" copy. subscription_tier itself isn't touched here — the
    webhook's customer.subscription.updated/deleted handling (unchanged)
    is still the only thing allowed to downgrade access, once Stripe
    actually ends the subscription at the period boundary."""
    s = _stripe()
    db = get_supabase()
    customer_id = await _get_customer_id_or_404(user_id, db)

    try:
        sub = await asyncio.to_thread(_current_subscription, s, customer_id)
        if not sub:
            raise HTTPException(status_code=404, detail="No se encontró una suscripción activa.")
        updated = await asyncio.to_thread(
            s.Subscription.modify, sub.id, cancel_at_period_end=True,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Stripe subscription cancellation failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="No se pudo cancelar tu suscripción. Intenta de nuevo en unos minutos.")
    return {"ok": True, "cancel_at_period_end": True, "current_period_end": updated.get("current_period_end")}


@router.post("/resume-subscription")
async def resume_subscription(user_id: str = Depends(get_current_user_id)):
    """Undoes a pending cancel_at_period_end — "me arrepentí" before the
    period actually ends. Once Stripe has genuinely ended a subscription
    there's nothing left to resume; the user would need to re-subscribe
    through the normal checkout instead."""
    s = _stripe()
    db = get_supabase()
    customer_id = await _get_customer_id_or_404(user_id, db)

    try:
        sub = await asyncio.to_thread(_current_subscription, s, customer_id)
        if not sub:
            raise HTTPException(status_code=404, detail="No se encontró una suscripción activa.")
        await asyncio.to_thread(
            s.Subscription.modify, sub.id, cancel_at_period_end=False,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Stripe subscription resume failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="No se pudo reactivar tu suscripción. Intenta de nuevo en unos minutos.")
    return {"ok": True, "cancel_at_period_end": False}


@router.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Webhook no configurado")

    # An env var pasted with a trailing space/newline or wrapped in quotes fails
    # signature verification exactly like a wrong secret — tolerate both.
    webhook_secret = settings.stripe_webhook_secret.strip().strip("\"'").strip()
    try:
        stripe.api_key = settings.stripe_secret_key
        event = stripe.Webhook.construct_event(payload, sig, webhook_secret)
    except stripe.error.SignatureVerificationError as e:
        # Say WHY without exposing the secret, so a 400 in Stripe's delivery log can be
        # diagnosed from the Railway logs instead of guessed at.
        import time as _time
        ts = None
        try:
            ts = int(dict(p.split("=", 1) for p in sig.split(",") if "=" in p).get("t", ""))
        except Exception:
            pass
        logger.error(
            "stripe webhook signature FAILED: %s | secret_len=%d starts_with_whsec=%s had_outer_whitespace_or_quotes=%s "
            "signature_header_present=%s timestamp_skew_s=%s body_bytes=%d",
            e, len(webhook_secret), webhook_secret.startswith("whsec_"),
            webhook_secret != settings.stripe_webhook_secret, bool(sig),
            (int(_time.time()) - ts) if ts else None, len(payload),
        )
        raise HTTPException(status_code=400, detail="Firma inválida")

    db = get_supabase()

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = session.get("client_reference_id")
        customer_id = session.get("customer")
        metadata = session.get("metadata") or {}

        if user_id and session.get("mode") == "subscription":
            from datetime import datetime, timezone
            is_duo = metadata.get("offer") == "family_plan"
            update = {
                "subscription_tier": "premium",
                # migration 100, 2026-09-16: distinguishes a real Stripe
                # subscriber from a manual_comp grant (subscription_source
                # was previously only ever written for manual_comp, leaving
                # every real subscriber's row NULL and indistinguishable
                # from "unknown"). premium_until itself isn't set here —
                # invoice.payment_succeeded fires moments later for this
                # same new subscription (billing_reason="subscription_create")
                # and sets it from the real period end there.
                "subscription_source": "stripe",
                "stripe_customer_id": customer_id,
                "subscription_started_at": datetime.now(timezone.utc).isoformat(),
            }
            if is_duo:
                update["duo_plan_purchased_at"] = datetime.now(timezone.utc).isoformat()
            await run_query(
                db.table("user_profiles").update(update).eq("user_id", user_id)
            )
            cache_delete(f"profile:{user_id}")
            cache_delete(f"sync:all:{user_id}")

            # Admin purchase notification — Diego, 2026-09-15. Best-effort
            # interval lookup (monthly/yearly) via the subscription Stripe
            # already created for this checkout; never blocks the webhook
            # if it fails.
            interval_label = "?"
            subscription_id = session.get("subscription")
            if subscription_id:
                try:
                    sub = await asyncio.to_thread(stripe.Subscription.retrieve, subscription_id)
                    interval = ((sub["items"]["data"][0]["price"].get("recurring") or {}).get("interval"))
                    interval_label = {"month": "Mensual", "year": "Anual"}.get(interval, interval or "?")
                except Exception as e:
                    logger.warning("webhook: could not read subscription %s interval for admin notify: %s", subscription_id, e)
            from app.services.email_service import notify_admin_purchase
            asyncio.create_task(notify_admin_purchase(
                user_id,
                "Plan Duo" if is_duo else "Premium Individual",
                f"{interval_label} · checkout.session.completed",
            ))

    elif event["type"] in ("customer.subscription.deleted", "customer.subscription.paused"):
        customer_id = event["data"]["object"].get("customer")
        if customer_id:
            await _downgrade_by_customer_id(customer_id, db)
            await _invalidate_profile_cache_by_customer(customer_id, db)
            await _revoke_duo_secondary(customer_id, db)

    elif event["type"] == "customer.subscription.updated":
        # Stripe keeps a subscription "active" through several automatic
        # Smart Retries (and through the brief window where a renewal is
        # pending 3D Secure authentication) before it ever reaches a final
        # unpaid/canceled state — that whole retry window used to be
        # invisible here because we downgraded on the FIRST
        # invoice.payment_failed instead (see below), which is exactly what
        # made a still-paying subscriber's badge flip free/premium/free as
        # each retry attempt failed then the next one (or the 3DS
        # confirmation) succeeded. `status` is the one field Stripe considers
        # authoritative for "is this subscription actually not paid for
        # anymore" — only downgrade once it says so.
        sub = event["data"]["object"]
        customer_id = sub.get("customer")
        status = sub.get("status")
        if customer_id and status in ("unpaid", "canceled", "incomplete_expired"):
            await _downgrade_by_customer_id(customer_id, db)
            await _invalidate_profile_cache_by_customer(customer_id, db)
            await _revoke_duo_secondary(customer_id, db)
        elif customer_id and status == "active":
            # A subscription that climbed back to "active" after being
            # past_due (a retry succeeded) needs premium restored the same
            # way invoice.payment_succeeded does below — otherwise a user
            # downgraded by a prior past_due window stays stuck on free
            # until their next billing cycle's invoice.payment_succeeded.
            update = {"subscription_tier": "premium", "subscription_source": "stripe"}
            # migration 100: this event already carries the full
            # subscription object (unlike invoice.payment_succeeded, which
            # only has the invoice) — current_period_end is right here, no
            # extra Stripe API call needed.
            period_end = sub.get("current_period_end")
            if period_end:
                update["premium_until"] = datetime.fromtimestamp(period_end, tz=timezone.utc).isoformat()
            await run_query(
                db.table("user_profiles").update(update).eq("stripe_customer_id", customer_id)
            )
            await _invalidate_profile_cache_by_customer(customer_id, db)

    elif event["type"] == "invoice.payment_failed":
        # Deliberately a no-op for subscription_tier: a failed invoice alone
        # doesn't mean the subscription is lost — Stripe auto-retries for
        # days (Smart Retries) and 3D Secure authentication can surface as a
        # transient "failure" that resolves seconds later. Downgrading here
        # was what caused premium users to flicker to free and back on every
        # retry/auth cycle. The subscription's actual status (handled via
        # customer.subscription.updated/deleted above) is the only thing
        # allowed to change subscription_tier.
        pass

    elif event["type"] == "invoice.payment_succeeded":
        # Restore premium if a previously failed payment recovered, OR (as
        # of the embedded Payment Element checkout, 2026-09-15) grant it
        # for the very first time — "subscription_create" is this event's
        # billing_reason on a brand-new subscription's first invoice.
        # /billing/create-embedded-subscription has no Checkout Session
        # (that flow's premium grant is checkout.session.completed, above),
        # so this is the only place premium ever gets granted for it.
        # stripe_customer_id is already linked (saved synchronously by that
        # endpoint before the card was even entered), so the same
        # eq("stripe_customer_id", ...) lookup works for all three reasons.
        customer_id = event["data"]["object"].get("customer")
        billing_reason = event["data"]["object"].get("billing_reason", "")
        if customer_id and billing_reason in ("subscription_cycle", "subscription_update", "subscription_create"):
            from datetime import datetime, timezone
            update = {"subscription_tier": "premium", "subscription_source": "stripe"}
            # migration 100: the invoice's own line item already carries the
            # period this payment covers — no extra Stripe API call needed.
            # This is what makes premium_until correct for BOTH a renewal
            # (subscription_cycle) and this subscription's very first
            # invoice (subscription_create, which checkout.session.completed
            # deliberately left unset, expecting this event to fill it in
            # moments later).
            try:
                period_end = event["data"]["object"]["lines"]["data"][0]["period"]["end"]
                if period_end:
                    update["premium_until"] = datetime.fromtimestamp(period_end, tz=timezone.utc).isoformat()
            except (KeyError, IndexError, TypeError) as e:
                logger.warning("webhook: could not read invoice line period for premium_until (customer=%s): %s", customer_id, e)
            is_duo = False
            interval_label = "?"
            if billing_reason == "subscription_create":
                update["subscription_started_at"] = datetime.now(timezone.utc).isoformat()
                # The embedded Duo (family_plan) subscription created by
                # /upsells/checkout-embedded has no Checkout Session either
                # (same gap as the individual plan above) — the ONLY place
                # that flow's offer is recorded is the Subscription's own
                # metadata, so a brand-new subscription's first invoice
                # needs one extra retrieve to check it and set
                # duo_plan_purchased_at the same way checkout.session.
                # completed already does for the hosted-redirect flow.
                subscription_id = event["data"]["object"].get("subscription")
                if subscription_id:
                    try:
                        sub = await asyncio.to_thread(stripe.Subscription.retrieve, subscription_id)
                        is_duo = (sub.get("metadata") or {}).get("offer") == "family_plan"
                        if is_duo:
                            update["duo_plan_purchased_at"] = update["subscription_started_at"]
                        interval = ((sub["items"]["data"][0]["price"].get("recurring") or {}).get("interval"))
                        interval_label = {"month": "Mensual", "year": "Anual"}.get(interval, interval or "?")
                    except Exception as e:
                        logger.warning("webhook: could not check subscription %s metadata for family_plan: %s", subscription_id, e)
            updated = await run_query(
                db.table("user_profiles").update(update).eq("stripe_customer_id", customer_id)
            )
            if not (updated and updated.data):
                # No profile is linked to THIS Stripe customer — the payment came
                # from a customer whose id was never saved on the profile (a checkout
                # attempt created a second customer). Find the owner via the
                # customer's own metadata.user_id (set at creation) and link it,
                # instead of silently dropping a paid subscription.
                try:
                    cust = await asyncio.to_thread(stripe.Customer.retrieve, customer_id)
                    owner_id = (cust.get("metadata") or {}).get("user_id")
                    if not owner_id and cust.get("email"):
                        owner_id = await _find_user_id_by_email(cust.get("email"), db)
                    if owner_id:
                        logger.warning("webhook: invoice.payment_succeeded for unlinked customer %s — linking to user %s", customer_id, owner_id)
                        await run_query(
                            db.table("user_profiles").update({**update, "stripe_customer_id": customer_id}).eq("user_id", owner_id)
                        )
                        cache_delete(f"profile:{owner_id}")
                        cache_delete(f"sync:all:{owner_id}")
                    else:
                        logger.error("webhook: paid invoice for customer %s but no user could be resolved", customer_id)
                except Exception as e:
                    logger.error("webhook: could not resolve owner of paid customer %s: %s", customer_id, e)
            await _invalidate_profile_cache_by_customer(customer_id, db)

            if billing_reason == "subscription_create":
                # Admin purchase notification — Diego, 2026-09-15. This
                # branch only ever fires once per subscription (Stripe
                # sends "subscription_create" exactly once, on the first
                # invoice), so no extra idempotency guard is needed here.
                try:
                    user_row = await run_query(
                        db.table("user_profiles").select("user_id").eq("stripe_customer_id", customer_id).limit(1)
                    )
                    notify_user_id = user_row.data[0]["user_id"] if user_row.data else None
                except Exception as e:
                    logger.warning("webhook: could not resolve user_id for customer %s admin notify: %s", customer_id, e)
                    notify_user_id = None
                if notify_user_id:
                    from app.services.email_service import notify_admin_purchase
                    asyncio.create_task(notify_admin_purchase(
                        notify_user_id,
                        "Plan Duo" if is_duo else "Premium Individual",
                        f"{interval_label} · invoice.payment_succeeded (embedded)",
                    ))

    return {"received": True}


async def _downgrade_by_customer_id(customer_id: str, db) -> None:
    """Sets subscription_tier='free' for every profile on this Stripe
    customer, EXCEPT rows manually granted permanent premium
    (subscription_source='manual_comp', see migration 079). Those users
    have no real Stripe subscription backing their premium — the only way
    stripe_customer_id could ever be set on one of them is stray Stripe
    activity unrelated to why they're premium (e.g. a checkout session
    that got as far as creating a customer, or leftover test-mode data).
    A plain `.eq("stripe_customer_id", ...).update(...)` doesn't know
    that and downgrades them anyway the next time ANY webhook fires for
    that customer — confirmed live (2026-08-20, Diego): manually-comp'd
    accounts kept flipping back to free with no code change on our side.
    `.neq("subscription_source", "manual_comp")` would NOT work here —
    Postgres's NULL != 'manual_comp' evaluates to NULL, not true, so it
    would silently exclude every real Stripe subscriber too (none of
    them have subscription_source set at all). Filtering in Python after
    a plain select is the only correct way to exclude just the comp'd
    rows while still downgrading everyone else."""
    res = await run_query(
        db.table("user_profiles").select("user_id, subscription_source").eq("stripe_customer_id", customer_id)
    )
    user_ids = [r["user_id"] for r in (res.data or []) if r.get("subscription_source") != "manual_comp"]
    if not user_ids:
        return
    await run_query(
        db.table("user_profiles").update({"subscription_tier": "free"}).in_("user_id", user_ids)
    )


async def _safe_to_downgrade_duo_secondary(secondary_id: str, db) -> bool:
    """True unless downgrading this specific user_id to free would strip
    premium they're not actually getting from the duo pairing being
    revoked. Both duo-secondary revocation call sites (a cancelled/
    reassigned duo plan) used to blindly set subscription_tier='free' on
    the secondary by user_id alone — with no awareness that this exact
    account could independently be: (a) manually comp'd permanent premium
    (subscription_source='manual_comp', same class of bug fixed for the
    primary-customer-id downgrade path in commit bd722446), (b) a real,
    separate paying subscriber under their OWN stripe_customer_id (e.g.
    they bought their own individual plan, or lead their own duo pairing,
    independent of being someone else's secondary), or (c) in the middle
    of their own 30-day trial (trial_started_at set, no Stripe customer
    yet) — a trial has nothing to do with a duo plan either, so writing
    subscription_tier='free' here stomps it, leaving the row's tier out
    of sync with is_premium_active() for the rest of the trial window.
    None of these cases has anything to do with the duo plan being
    cancelled/reassigned, so none should ever be touched by that event."""
    res = await run_query(
        db.table("user_profiles").select(
            "subscription_source, stripe_customer_id, subscription_tier, trial_started_at, streak_bonus_premium_until"
        ).eq("user_id", secondary_id).maybe_single()
    )
    row = res.data or {}
    if row.get("subscription_source") == "manual_comp":
        return False
    if row.get("stripe_customer_id"):
        return False
    from app.core.subscription import is_premium_active
    if is_premium_active(row.get("subscription_tier", "free"), row.get("trial_started_at"), row.get("streak_bonus_premium_until")):
        return False
    return True


async def _invalidate_profile_cache_by_customer(customer_id: str, db):
    """Webhook branches that key their update by stripe_customer_id (rather
    than user_id) don't have the user_id in scope to invalidate the
    /profile or /sync/all caches directly — without this, a tier change
    from Stripe could be masked by a stale cached response for up to 120s
    (or 20s for sync:all). Belt-and-suspenders: GET /profile and GET
    /sync/all now always re-read subscription fields fresh regardless (see
    fetch_fresh_subscription_fields), so this mainly guards any other
    cached field that keys off this same blob."""
    try:
        res = await run_query(
            db.table("user_profiles").select("user_id").eq("stripe_customer_id", customer_id)
        )
        for row in (res.data or []):
            cache_delete(f"profile:{row['user_id']}")
            cache_delete(f"sync:all:{row['user_id']}")
    except Exception as e:
        logger.warning("_invalidate_profile_cache_by_customer failed: %s", e)


# ── Broker call checkout ──────────────────────────────────────────────────────
# Free for the first 24h after broker_offer_seen_at (frontend links straight to
# Calendly during that window, no Stripe involved at all). Once the window
# expires, booking the call goes through this $20 flat checkout instead.


@router.post("/broker-call-checkout")
async def broker_call_checkout(user_id: str = Depends(get_current_user_id)):
    """Create a Stripe Checkout Session for the 1:1 broker onboarding call
    ($20 flat, only reached once the 24h free window has expired)."""
    s = _stripe()
    if not settings.stripe_price_broker_call:
        raise HTTPException(status_code=503, detail="Precio no configurado")

    base = settings.frontend_url if settings.frontend_url not in ("*", "", None) else "https://nuvosai.com"
    try:
        session = await _stripe_call(
            s.checkout.Session.create,
            mode="payment",
            payment_method_types=["card"],
            line_items=[{"price": settings.stripe_price_broker_call, "quantity": 1}],
            client_reference_id=user_id,
            metadata={"offer": "broker_call"},
            # Was a direct link to the public Calendly URL — no payment
            # verification ever happened for this flow at all (not even the
            # weak "same link shown to everyone" the "session" offer had).
            # Routes through /upsell-success now so verify-1on1-payment can
            # actually confirm this specific checkout before the Calendly
            # link is revealed (2026-08-20 audit).
            success_url=f"{base}/upsell-success?offer=broker_call&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base}/home",
        )
    except Exception as e:
        logger.error("Stripe broker-call checkout failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
    return {"url": session.url}


@router.post("/create-embedded-broker-call")
async def create_embedded_broker_call(body: dict | None = None, user_id: str = Depends(get_current_user_id)):
    """Embedded-Elements counterpart to /broker-call-checkout — same $20
    flat one-time payment, but returns a PaymentIntent client_secret
    instead of a Stripe-hosted redirect URL."""
    s = _stripe()
    if not settings.stripe_price_broker_call:
        raise HTTPException(status_code=503, detail="Precio no configurado")

    db = get_supabase()
    try:
        result = await run_query(
            db.table("user_profiles").select("stripe_customer_id, country, phone_number").eq("user_id", user_id).single()
        )
    except Exception as e:
        # Was unguarded — same bug class as create_embedded_subscription
        # above. Degrade gracefully instead of an uncaught 500: proceed as
        # if there's no linked Stripe customer yet.
        logger.error("create_embedded_broker_call: profile lookup failed for user %s: %s", user_id, e)
        result = None
    # MXN when the paywall/products screen SHOWED MXN (the client echoes its
    # currency, same contract as create_embedded_subscription) or the profile
    # says Mexico — and only if the MXN price is configured; else USD.
    from app.core.pricing_region import is_mexico
    prof = (result.data if result and result.data else {}) or {}
    wants_mxn = str((body or {}).get("currency") or "").lower() == "mxn" or is_mexico(prof.get("country"), prof.get("phone_number"))
    mxn_price_id = getattr(settings, "stripe_price_broker_call_mxn", "")
    broker_price_id = mxn_price_id if (wants_mxn and mxn_price_id) else settings.stripe_price_broker_call
    customer_id = result.data.get("stripe_customer_id") if result and result.data else None

    if not customer_id:
        try:
            customer = await _stripe_call(s.Customer.create, metadata={"user_id": user_id})
        except Exception as e:
            logger.error("Stripe customer creation failed for user %s: %s", user_id, e)
            raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
        customer_id = customer.id
        await run_query(
            db.table("user_profiles").update({"stripe_customer_id": customer_id}).eq("user_id", user_id)
        )

    try:
        price = await _stripe_call(s.Price.retrieve, broker_price_id)
        intent = await _stripe_call(
            s.PaymentIntent.create,
            amount=price.unit_amount,
            currency=price.currency,
            customer=customer_id,
            metadata={"offer": "broker_call", "user_id": user_id},
            automatic_payment_methods={"enabled": True},
        )
    except Exception as e:
        logger.error("Stripe embedded broker-call checkout failed for user %s: %s", user_id, e)
        raise HTTPException(status_code=503, detail="Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos.")
    return {"client_secret": intent.client_secret}


from app.core.subscription import TRIAL_DAYS as _PROMO_DAYS


@router.get("/status")
async def get_status(user_id: str = Depends(get_current_user_id)):
    # 2026-09-17: was get_supabase() (the process-wide singleton) — Diego
    # reported msg_count under-counting right after hitting the free
    # 15/24h chat limit (refresh, or opening a new chat, showed "1 message
    # left" instead of 0). msg_count changes on every single chat message,
    # far more often than tier/trial fields, so it's the field most likely
    # to be read moments after a write — exactly the stale-pinned-
    # connection window get_supabase()'s own docstring describes (a write
    # that's already committed on the primary but not yet visible through
    # a connection still pinned to a lagging replica). This endpoint is
    # "the single endpoint every client trusts for its subscription
    # state" (see below) AND the one both platforms use to decide whether
    # the chat input is still enabled — a stale read here doesn't just
    # show a wrong badge, it lets a Free user who already hit their limit
    # send another message client-side (server-side enforcement in
    # chat.py's atomic RPC still blocks it, but the UX is exactly the
    # "gives me one more" bug reported). A fresh, non-singleton client per
    # call avoids that entirely for a per-page-load endpoint like this one.
    db = get_fresh_supabase()

    def _query():
        return db.table("user_profiles").select(
            "subscription_tier, msg_count, msg_window_start, trial_started_at, stripe_customer_id, broker_offer_seen_at, duo_plan_purchased_at, duo_secondary_email, duo_invite_status, streak_bonus_premium_until, claimed_streak_milestones, has_seen_welcome_card, premium_until, subscription_source"
        ).eq("user_id", user_id).maybe_single()

    result = await run_query(_query())

    # A transient PostgREST/replica hiccup can return an empty result for a
    # user whose profile row genuinely exists — retry a few times (bumped
    # from 2 to 4 and the gap widened, 2026-09-16: confirmed LIVE against
    # production that 2 retries at 0.3s wasn't enough — 3 of 10 rapid,
    # back-to-back calls for the SAME real trial account still came back
    # empty) before concluding anything.
    if not result or not result.data:
        for attempt in range(4):
            await asyncio.sleep(0.3 * (attempt + 1))
            result = await run_query(_query())
            if result and result.data:
                break

    if not result or not result.data:
        # THIS is the actual fix, not just the extra retries above: this
        # used to `return {"tier": "free", ...}` here — answering with
        # total confidence that the user is free when what actually
        # happened is "we couldn't confirm anything." Confirmed live
        # 2026-09-16: this is exactly what was still causing a real trial
        # user to intermittently see Free after all of today's earlier
        # fixes (connection recycling, the client-side generation guard) —
        # none of those help when the SERVER itself fails closed instead of
        # failing open. A 503 makes the client's own fetchStatus() retry
        # loop (already built for exactly this) try again on a fresh
        # connection instead of the server confidently lying. The one
        # legitimate case this also covers — a user who genuinely hasn't
        # finished onboarding yet, so this row truly doesn't exist — behaves
        # identically from the client's point of view either way: retries
        # exhaust, hasFetchedStatus flips true, tier stays at its default
        # ("free"), which is correct for that case too.
        logger.error("billing.get_status: no user_profiles row for user %s after retries — degrading to a retryable error instead of asserting free", user_id)
        raise HTTPException(status_code=503, detail="No se pudo verificar tu estado de suscripción. Intenta de nuevo en unos segundos.")

    data            = result.data

    # Self-heal for a paid-but-still-Free account (missed/unmatched webhook —
    # see app/services/subscription_sync.py). Only for users who already have a
    # Stripe customer (i.e. have opened checkout), and throttled per user so a
    # free user's status polling can't turn into a Stripe call every request.
    if data.get("subscription_tier") == "free" and data.get("stripe_customer_id"):
        from app.core.cache import cache_get, cache_set
        heal_key = f"sub_heal:{user_id}"
        if not cache_get(heal_key):
            cache_set(heal_key, 1, ttl=300)
            try:
                from app.services.subscription_sync import sync_subscription
                healed = await sync_subscription(db, user_id, None)
                if healed.get("premium"):
                    result = await run_query(_query())
                    data = result.data or data
            except Exception as e:
                logger.warning("get_status: subscription self-heal failed for %s: %s", user_id, e)
    tier            = data.get("subscription_tier", "free")
    trial_started   = data.get("trial_started_at")
    has_stripe      = bool(data.get("stripe_customer_id"))

    # Auto-start 30-day promo for any non-premium user who hasn't started a trial yet
    if tier not in ("premium", "pro") and not trial_started:
        trial_started = datetime.now(timezone.utc).isoformat()
        await run_query(
            db.table("user_profiles")
            .update({"trial_started_at": trial_started})
            .eq("user_id", user_id)
        )
        cache_delete(f"profile:{user_id}")
        cache_delete(f"sync:all:{user_id}")

    # Compute effective tier: premium if paid OR within the trial window OR streak
    # bonus active. is_trial/effective_tier defer to the canonical
    # is_premium_active() so this — the single endpoint every client trusts for
    # its subscription state — can never drift from the trial-window math used
    # everywhere else in the app.
    from app.core.subscription import is_premium_active
    effective_tier = tier
    is_trial       = False
    days_left      = 0
    premium_until  = data.get("premium_until")

    # migration 100, 2026-09-16: a stored expiration on a real paid
    # subscription (set by the webhook on checkout/renewal) is the safety
    # net for a missed or delayed webhook — cancellation/expiry already
    # flips subscription_tier='free' directly via the webhook, so this
    # only ever matters in that gap. NULL premium_until (a permanent
    # manual_comp grant, or a paid row from before this migration that
    # hasn't hit its next renewal event yet) means "no expiration," never
    # "already expired" — see is_premium_active's own docstring.
    if tier == "premium" and not is_premium_active(tier, trial_started, data.get("streak_bonus_premium_until"), premium_until):
        effective_tier = "free"
    elif tier != "premium" and trial_started and is_premium_active(tier, trial_started):
        effective_tier = "premium"
        is_trial       = True
        try:
            started   = datetime.fromisoformat(trial_started.replace("Z", "+00:00"))
            elapsed   = (datetime.now(timezone.utc) - started).total_seconds() / 86400
            days_left = max(0, int(_PROMO_DAYS - elapsed))
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
        except Exception as exc:
            # This is the canonical subscription-status endpoint every
            # client trusts — a malformed streak_bonus_premium_until used
            # to silently demote a user who legitimately earned premium
            # via a streak back to free, with zero trace (2026-08-26
            # full-sweep audit).
            logger.error("billing status: malformed streak_bonus_premium_until=%r: %s", streak_bonus_until, exc)

    duo_purchased = data.get("duo_plan_purchased_at")
    duo_secondary = data.get("duo_secondary_email")
    duo_invite_status = data.get("duo_invite_status")

    return {
        "tier":                      effective_tier,
        "is_trial":                  is_trial,
        "trial_days_left":           days_left,
        "msg_count":                 data.get("msg_count", 0),
        "msg_window_start":          data.get("msg_window_start"),
        "trial_started_at":          trial_started,
        "broker_offer_seen_at":      data.get("broker_offer_seen_at"),
        # Diego, 2026-09-15: the frontend needs this to know whether
        # "Administrar suscripción" (Stripe Customer Portal) makes sense to
        # show at all — a manual_comp or trial-only user has no real Stripe
        # subscription to manage, so there'd be nothing for the portal to do.
        "has_stripe_customer":       has_stripe,
        "duo_setup_pending":         bool(duo_purchased and not duo_secondary),
        "duo_secondary_email":       duo_secondary,
        # Consent-flow fix, Sep 2026: distinguishes "invited, waiting on the
        # secondary to respond" from "they accepted" — the frontend shows a
        # different state for each (duo_setup_pending above only means "you
        # haven't invited anyone yet", unrelated to this).
        "duo_invite_status":         duo_invite_status,
        "streak_bonus_premium_until": streak_bonus_until,
        "streak_bonus_active":       streak_bonus_active,
        "claimed_streak_milestones": list(data.get("claimed_streak_milestones") or []),
        # Once-ever welcome/trial card (migration 098) — this endpoint is
        # already fetched reliably on cold start/foreground-resume on both
        # platforms, so it's the single source of truth for this instead of
        # a second round-trip the card would have to wait on.
        "has_seen_welcome_card":     bool(data.get("has_seen_welcome_card")),
        # migration 100, 2026-09-16: NULL for a permanent grant or a trial
        # (trial's own expiration is trial_started_at + trial_days_left
        # above, not this field) — only set for a real paid subscription.
        # Exposed so a future UI can show "se renueva/vence el ..." without
        # a second round-trip; not required for the tier decision itself,
        # which is already resolved into `tier` above.
        "premium_until":             premium_until,
        "subscription_source":       data.get("subscription_source"),
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
        from app.core.database import find_auth_user
        u = await find_auth_user(db, email=email)
        return u.id if u else None
    except Exception as e:
        logger.warning("_find_user_id_by_email failed: %s", e)
    return None


async def _revoke_duo_secondary(primary_customer_id: str, db):
    """When a duo subscription ends, revoke premium from the linked secondary
    account and clear the bidirectional link on both sides — otherwise a
    cancelled pairing would leave stale duo_primary_user_id/duo_secondary_user_id
    pointing at an account that's no longer actually linked.

    Skips the downgrade (still clears the stale link) when the secondary
    is independently premium on their own — see
    _safe_to_downgrade_duo_secondary."""
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
            # The pairing itself always ends here regardless of tier —
            # only whether we also reset THEIR tier back to free depends
            # on whether that tier actually came from this pairing.
            update = {"duo_primary_user_id": None}
            if await _safe_to_downgrade_duo_secondary(secondary_id, db):
                update["subscription_tier"] = "free"
                logger.info("Duo secondary %s reverted to free", secondary_email)
            else:
                logger.info("Duo secondary %s unlinked but kept premium (independently premium)", secondary_email)
            await run_query(
                db.table("user_profiles").update(update).eq("user_id", secondary_id)
            )
            cache_delete(f"profile:{secondary_id}")
            cache_delete(f"sync:all:{secondary_id}")
        await run_query(
            db.table("user_profiles")
            .update({"duo_secondary_user_id": None, "duo_invite_status": None})
            .eq("user_id", primary_row["user_id"])
        )
    except Exception as e:
        logger.warning("_revoke_duo_secondary failed: %s", e)


async def _notify_duo(user_id: str, category: str, title: str, body: str, data: dict) -> None:
    """Fire-and-forget push for a duo invite/response — never let a
    notification failure break the actual billing/consent operation."""
    try:
        from app.services.notification_engine import send_push
        db = get_supabase()
        await send_push(user_id, category, title, body, data, db)
    except Exception as e:
        logger.warning("_notify_duo(%s, %s) failed: %s", user_id, category, e)


@router.post("/duo-setup")
async def duo_setup(body: dict, user_id: str = Depends(get_current_user_id)):
    """Invite a secondary account to a Duo plan pairing.

    Security fix, Sep 2026: this used to grant the secondary account
    premium AND expose their investing-progress data to the primary
    (GET /duo-partner) immediately, with no consent step at all — the
    secondary never approved being paired. Now this only creates a
    PENDING invite; nothing is granted or shared until the secondary
    calls POST /duo-accept themselves (see that route, and GET
    /duo-invite which is how they find out an invite exists)."""
    secondary_email = (body.get("secondary_email") or "").strip().lower()
    if not secondary_email or "@" not in secondary_email:
        raise HTTPException(status_code=422, detail="Email del segundo usuario inválido")

    db = get_supabase()

    # 1. Verify duo plan was purchased
    check = await run_query(
        db.table("user_profiles")
        .select("duo_plan_purchased_at, duo_secondary_user_id, duo_secondary_email, full_name, name")
        .eq("user_id", user_id).maybe_single()
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

    # 2b. Re-running setup (typo fix, swapping partners) used to leave the
    # PREVIOUS secondary permanently premium — this only ever revoked via the
    # Stripe cancellation webhook, which looks up the secondary through the
    # primary's CURRENT duo_secondary_email, so once it's overwritten below
    # the old secondary becomes unreachable and un-revokable by any code
    # path. Revoke the old secondary here, before linking the new one, so a
    # duo plan can never grant premium to more than one secondary at a time.
    # (Safe even if the old pairing was only ever "pending" — the downgrade
    # check below is a no-op for an account that was never actually granted
    # premium by this pairing.)
    old_secondary_id = check.data.get("duo_secondary_user_id")
    if old_secondary_id and old_secondary_id != secondary_id:
        # Same independently-premium check as _revoke_duo_secondary — the
        # old secondary's pairing always ends here, but their tier only
        # resets if it actually came from this pairing.
        update: dict = {"duo_primary_user_id": None}
        if await _safe_to_downgrade_duo_secondary(old_secondary_id, db):
            update["subscription_tier"] = "free"
            logger.info("Duo setup: revoked stale secondary=%s for primary=%s (replaced by %s)", old_secondary_id, user_id, secondary_id)
        else:
            logger.info("Duo setup: unlinked stale secondary=%s but kept premium (independently premium)", old_secondary_id)
        await run_query(
            db.table("user_profiles").update(update).eq("user_id", old_secondary_id)
        )
        cache_delete(f"profile:{old_secondary_id}")
        cache_delete(f"sync:all:{old_secondary_id}")

    # 3. Record the invite as PENDING — no premium grant, no bidirectional
    # link yet. Those only happen when the secondary accepts.
    await run_query(
        db.table("user_profiles")
        .update({"duo_secondary_email": secondary_email, "duo_secondary_user_id": secondary_id, "duo_invite_status": "pending"})
        .eq("user_id", user_id)
    )
    cache_delete(f"profile:{user_id}")
    cache_delete(f"sync:all:{user_id}")

    primary_name = (check.data.get("full_name") or check.data.get("name") or "Alguien").split()[0]
    await _notify_duo(
        secondary_id, "duo_invite",
        "Invitación al plan Dúo 👥",
        f"{primary_name} te invitó a compartir su plan Dúo en Nuvos — acepta para activar tu Premium gratis.",
        {"screen": "profile", "duo_invite": "pending"},
    )

    logger.info("Duo setup: primary=%s sent PENDING invite to secondary=%s (%s)", user_id, secondary_email, secondary_id)
    return {"ok": True, "status": "pending", "duo_secondary_email": secondary_email}


@router.get("/duo-invite")
async def get_duo_invite(user_id: str = Depends(get_current_user_id)):
    """Does the caller have a pending Duo invite waiting on THEM to accept
    or decline? This is the secondary's-eye view — duo_setup only ever
    writes the pending state on the primary's row, so this looks up
    'who invited me' rather than 'who did I invite'."""
    db = get_supabase()
    res = await run_query(
        db.table("user_profiles")
        .select("user_id, full_name, name")
        .eq("duo_secondary_user_id", user_id)
        .eq("duo_invite_status", "pending")
        .limit(1)
    )
    if not res.data:
        return {"pending": False}
    row = res.data[0]
    return {
        "pending": True,
        "primary_user_id": row["user_id"],
        "primary_name": row.get("full_name") or row.get("name") or "Alguien",
    }


@router.post("/duo-accept")
async def accept_duo_invite(user_id: str = Depends(get_current_user_id)):
    """Secondary explicitly accepts a pending Duo invite — this is the ONLY
    place that grants premium via a duo pairing and establishes the
    bidirectional link GET /duo-partner reads. Idempotency: re-accepting an
    already-accepted invite is a no-op success (not an error), since a
    double-tap/retry must never fail confusingly."""
    db = get_supabase()
    res = await run_query(
        db.table("user_profiles")
        .select("user_id, full_name, name, duo_invite_status")
        .eq("duo_secondary_user_id", user_id)
        .in_("duo_invite_status", ["pending", "accepted"])
        .limit(1)
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="No tienes una invitación de Dúo pendiente")
    primary_row = res.data[0]
    primary_id = primary_row["user_id"]

    await run_query(
        db.table("user_profiles")
        .update({"subscription_tier": "premium", "duo_primary_user_id": primary_id})
        .eq("user_id", user_id)
    )
    cache_delete(f"profile:{user_id}")
    cache_delete(f"sync:all:{user_id}")

    if primary_row.get("duo_invite_status") != "accepted":
        await run_query(
            db.table("user_profiles").update({"duo_invite_status": "accepted"}).eq("user_id", primary_id)
        )
        cache_delete(f"profile:{primary_id}")
        cache_delete(f"sync:all:{primary_id}")

        secondary_res = await run_query(
            db.table("user_profiles").select("full_name, name").eq("user_id", user_id).maybe_single()
        )
        secondary_name = "Tu pareja"
        if secondary_res and secondary_res.data:
            secondary_name = (secondary_res.data.get("full_name") or secondary_res.data.get("name") or secondary_name).split()[0]
        await _notify_duo(
            primary_id, "duo_accepted",
            "¡Invitación aceptada! 🎉",
            f"{secondary_name} aceptó tu invitación al plan Dúo — ya pueden comparar su progreso.",
            {"screen": "profile"},
        )

    logger.info("Duo accept: secondary=%s accepted invite from primary=%s", user_id, primary_id)
    return {"ok": True}


@router.post("/duo-decline")
async def decline_duo_invite(user_id: str = Depends(get_current_user_id)):
    """Secondary declines a pending Duo invite — resets the primary's
    invite state (no premium was ever granted, since that only happens on
    accept) so the primary can invite someone else."""
    db = get_supabase()
    res = await run_query(
        db.table("user_profiles")
        .select("user_id")
        .eq("duo_secondary_user_id", user_id)
        .eq("duo_invite_status", "pending")
        .limit(1)
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="No tienes una invitación de Dúo pendiente")
    primary_id = res.data[0]["user_id"]

    await run_query(
        db.table("user_profiles")
        .update({"duo_secondary_email": None, "duo_secondary_user_id": None, "duo_invite_status": None})
        .eq("user_id", primary_id)
    )
    cache_delete(f"profile:{primary_id}")
    cache_delete(f"sync:all:{primary_id}")

    await _notify_duo(
        primary_id, "duo_declined",
        "Invitación al plan Dúo",
        "Tu invitación al plan Dúo no fue aceptada. Puedes invitar a otra persona desde tu perfil.",
        {"screen": "profile"},
    )

    logger.info("Duo decline: secondary=%s declined invite from primary=%s", user_id, primary_id)
    return {"ok": True}


@router.get("/duo-partner")
async def get_duo_partner(user_id: str = Depends(get_current_user_id)):
    """
    Side-by-side progress comparison for a paired Duo account — works from
    either side of the pairing (primary or secondary). Only returns
    paired=True once the secondary has explicitly ACCEPTED (duo-accept):
    - Secondary side: duo_primary_user_id is only ever set at accept time,
      so its mere presence already implies acceptance.
    - Primary side: duo_secondary_user_id is set as soon as the invite is
      sent (pending), so it alone is NOT enough — duo_invite_status must
      also be 'accepted', or a pending invite would incorrectly read as
      an active pairing before the secondary ever agreed to anything.
    Reuses compute_progress_summary exactly as the solo dashboard does, so
    a missing field means "not enough data", never zero, on either side.
    """
    db = get_supabase()
    res = await run_query(
        db.table("user_profiles")
        .select("duo_primary_user_id, duo_secondary_user_id, duo_invite_status")
        .eq("user_id", user_id)
        .limit(1)
    )
    row = res.data[0] if res.data else {}
    partner_id = row.get("duo_primary_user_id")
    if not partner_id and row.get("duo_invite_status") == "accepted":
        partner_id = row.get("duo_secondary_user_id")
    if not partner_id:
        pending = bool(row.get("duo_secondary_user_id")) and row.get("duo_invite_status") == "pending"
        return {"paired": False, "pending": pending}

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

