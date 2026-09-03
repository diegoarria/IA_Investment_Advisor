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
from app.core.cache import cache_delete
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
            cache_delete(f"profile:{user_id}")
            cache_delete(f"sync:all:{user_id}")

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
            await run_query(
                db.table("user_profiles").update({
                    "subscription_tier": "premium",
                }).eq("stripe_customer_id", customer_id)
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
        # Restore premium if a previously failed payment recovered
        customer_id = event["data"]["object"].get("customer")
        billing_reason = event["data"]["object"].get("billing_reason", "")
        if customer_id and billing_reason in ("subscription_cycle", "subscription_update"):
            await run_query(
                db.table("user_profiles").update({
                    "subscription_tier": "premium",
                }).eq("stripe_customer_id", customer_id)
            )
            await _invalidate_profile_cache_by_customer(customer_id, db)

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
    primary-customer-id downgrade path in commit bd722446), or (b) a real,
    separate paying subscriber under their OWN stripe_customer_id (e.g.
    they bought their own individual plan, or lead their own duo pairing,
    independent of being someone else's secondary). Neither case has
    anything to do with the duo plan being cancelled/reassigned, so
    neither should ever be touched by that event."""
    res = await run_query(
        db.table("user_profiles").select("subscription_source, stripe_customer_id").eq("user_id", secondary_id).maybe_single()
    )
    row = res.data or {}
    if row.get("subscription_source") == "manual_comp":
        return False
    if row.get("stripe_customer_id"):
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
        session = await asyncio.to_thread(
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


from app.core.subscription import TRIAL_DAYS as _PROMO_DAYS


@router.get("/status")
async def get_status(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()

    def _query():
        return db.table("user_profiles").select(
            "subscription_tier, msg_count, msg_window_start, trial_started_at, stripe_customer_id, broker_offer_seen_at, duo_plan_purchased_at, duo_secondary_email, duo_invite_status, streak_bonus_premium_until, claimed_streak_milestones"
        ).eq("user_id", user_id).maybe_single()

    result = await run_query(_query())

    # A transient PostgREST/replica hiccup can return an empty result for a
    # user whose profile row genuinely exists — this used to fall straight
    # through to "tier": "free" below, which is exactly how a real trial/
    # premium user (and, under load, many users at once) would suddenly get
    # downgraded to free for no real reason. Retry a couple of times before
    # concluding the profile truly doesn't exist.
    if not result or not result.data:
        for _ in range(2):
            await asyncio.sleep(0.3)
            result = await run_query(_query())
            if result and result.data:
                break

    if not result or not result.data:
        logger.warning("billing.get_status: no user_profiles row for user %s after retries — returning free", user_id)
        return {"tier": "free", "msg_count": 0, "msg_window_start": None}

    data            = result.data
    tier            = data.get("subscription_tier", "free")
    trial_started   = data.get("trial_started_at")
    has_stripe      = bool(data.get("stripe_customer_id"))

    # Auto-start 30-day promo for any non-premium user who hasn't started a trial yet
    if tier != "premium" and not trial_started:
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
    if tier != "premium" and trial_started and is_premium_active(tier, trial_started):
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

