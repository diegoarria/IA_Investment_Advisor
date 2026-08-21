"""
Upsell system: Family Plan, 1:1 Session with Diego, Deep Research.
Trigger evaluation runs server-side; frontend decides when to call based on user events.
"""
import asyncio
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
import stripe
import logging

from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.config import settings

router = APIRouter(prefix="/upsells", tags=["upsells"])
logger = logging.getLogger(__name__)

PRIORITY = ["session", "family_plan"]


def _effective_tier(raw_tier: str, trial_started_at: str | None, streak_bonus_premium_until: str | None = None) -> str:
    """Return 'premium' if user is paid premium, within their active trial,
    OR currently covered by a streak/referral premium bonus. Delegates to
    app.core.subscription.is_premium_active — the single canonical
    trial-window check shared across the whole app. Reused by
    benchmark.py, progress.py, and wrapped.py."""
    from app.core.subscription import is_premium_active
    return "premium" if is_premium_active(raw_tier, trial_started_at, streak_bonus_premium_until) else raw_tier

PRICES = {
    "session":       {"free": 149.0, "premium": 99.0, "bundle": 247.0},
    "family_plan":   {"monthly": 23.99, "yearly": 224.99},
    "deep_research": {"free": 19.99, "premium": 9.99},
}

DISMISS_COOLDOWN_DAYS = 14


def _price_id_for(offer: str, tier: str, variant: str = "default") -> str:
    mapping = {
        ("session", "free"):          settings.stripe_price_session_free,
        ("session", "premium"):       settings.stripe_price_session_premium,
        ("session", "bundle"):        settings.stripe_price_session_bundle,
        ("family_plan", "monthly"):   settings.stripe_price_family_monthly,
        ("family_plan", "yearly"):    settings.stripe_price_family_yearly,
        ("deep_research", "free"):    settings.stripe_price_deep_research_free,
        ("deep_research", "premium"): settings.stripe_price_deep_research_premium,
    }
    if offer == "family_plan":
        key = variant          # "monthly" or "yearly"
    elif variant == "bundle":
        key = "bundle"         # 3-session pack
    else:
        key = tier             # "free" or "premium"
    return mapping.get((offer, key), "")


def _account_days(created_at: str | None) -> int:
    if not created_at:
        return 0
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except Exception:
        return 0


def _subscription_days(sub_started_at: str | None) -> int:
    if not sub_started_at:
        return 0
    try:
        dt = datetime.fromisoformat(sub_started_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except Exception:
        return 0


def _is_eligible(offer: str, tier: str, account_days: int, sub_days: int, trigger_source: str) -> bool:
    if offer == "session":
        if tier == "free":
            # Show when hitting chat limit (6th attempt = msg_limit_hit)
            return trigger_source == "msg_limit_hit"
        else:
            # Premium: after 5+ deep chats, stress test, or month 1 anniversary
            return trigger_source in ("deep_chats", "stress_test_done", "month_1_premium")

    if offer == "family_plan":
        if tier != "premium":
            return False
        # 30 days of active Premium subscription
        return sub_days >= 30 or trigger_source == "annual_renewal"

    return False


@router.get("/check")
async def check_upsell(
    trigger_source: str = Query(default="session_start"),
    user_id: str = Depends(get_current_user_id),
):
    """
    Returns the highest-priority upsell offer the user is eligible for,
    or null if none apply. Called by frontend trigger engine.
    """
    db = get_supabase()

    profile_res = await run_query(
        db.table("user_profiles")
        .select("subscription_tier, trial_started_at, created_at, subscription_started_at, streak_bonus_premium_until")
        .eq("user_id", user_id)
        .single()
    )
    profile = profile_res.data or {}
    tier = _effective_tier(profile.get("subscription_tier", "free"), profile.get("trial_started_at"), profile.get("streak_bonus_premium_until"))
    account_days = _account_days(profile.get("created_at"))
    sub_days = _subscription_days(profile.get("subscription_started_at"))

    # Load dismissals in the last 14 days
    cutoff = (datetime.now(timezone.utc) - timedelta(days=DISMISS_COOLDOWN_DAYS)).isoformat()
    dismiss_res = await run_query(
        db.table("upsell_dismissals")
        .select("offer_type")
        .eq("user_id", user_id)
        .gte("dismissed_at", cutoff)
    )
    dismissed = {r["offer_type"] for r in (dismiss_res.data or [])}

    # Find highest-priority eligible offer not recently dismissed
    for offer in PRIORITY:
        if offer in dismissed:
            continue
        if _is_eligible(offer, tier, account_days, sub_days, trigger_source):
            prices = PRICES[offer].copy()
            return {
                "offer": offer,
                "user_tier": tier,
                "prices": prices,
                "trigger_source": trigger_source,
            }

    return {"offer": None, "user_tier": tier}


@router.post("/dismiss")
async def dismiss_upsell(body: dict, user_id: str = Depends(get_current_user_id)):
    """Record that user dismissed an offer. Won't re-show for 14 days."""
    offer_type = body.get("offer_type", "")
    if offer_type not in ("family_plan", "session"):
        return {"ok": False, "error": "invalid offer_type"}
    db = get_supabase()
    await run_query(
        db.table("upsell_dismissals").upsert({
            "user_id": user_id,
            "offer_type": offer_type,
            "dismissed_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="user_id,offer_type")
    )
    await _track(db, user_id, "upsell_dismissed", offer_type, body.get("user_tier"), body.get("trigger_source"))
    return {"ok": True}


@router.post("/checkout")
async def upsell_checkout(body: dict, user_id: str = Depends(get_current_user_id)):
    """
    Create Stripe one-time checkout for session.
    Family Plan uses /billing/family-plan endpoint (subscription upgrade).
    """
    offer = body.get("offer")
    variant = body.get("variant", "default")  # 'bundle' | 'monthly' | 'yearly' | tier

    if offer not in ("session", "family_plan", "deep_research"):
        return {"error": "Invalid offer"}

    if not settings.stripe_secret_key:
        return {"error": "Pagos no configurados"}

    stripe.api_key = settings.stripe_secret_key
    db = get_supabase()

    profile_res = await run_query(
        db.table("user_profiles")
        .select("stripe_customer_id, subscription_tier, trial_started_at, streak_bonus_premium_until")
        .eq("user_id", user_id)
        .single()
    )
    profile = profile_res.data or {}
    tier = _effective_tier(profile.get("subscription_tier", "free"), profile.get("trial_started_at"), profile.get("streak_bonus_premium_until"))
    customer_id = profile.get("stripe_customer_id")

    if offer == "family_plan":
        key = variant if variant in ("monthly", "yearly") else "monthly"
    elif variant == "bundle":
        key = "bundle"
    else:
        key = tier
    price_id = _price_id_for(offer, tier, key)
    if not price_id:
        return {"error": "Precio no configurado en Stripe"}

    base = settings.frontend_url.rstrip("/") if settings.frontend_url not in ("*", "") else "https://nuvosai.com"
    mode = "subscription" if offer == "family_plan" else "payment"
    metadata = {"offer": offer, "variant": key, "user_tier": tier}
    # Deep Research's plan is already persisted as a research_jobs row before
    # checkout (see /api/research/plan) — carry its id through so the success
    # redirect can resume the exact request that was priced/confirmed, rather
    # than re-deriving anything from Stripe metadata alone.
    if offer == "deep_research":
        job_id = body.get("job_id", "")
        metadata["job_id"] = job_id
        success_url = f"{base}/research?job_id={job_id}&session_id={{CHECKOUT_SESSION_ID}}"
    else:
        success_url = f"{base}/upsell-success?offer={offer}&session_id={{CHECKOUT_SESSION_ID}}"
    params: dict = {
        "mode": mode,
        "payment_method_types": ["card"],
        "line_items": [{"price": price_id, "quantity": 1}],
        "client_reference_id": user_id,
        "metadata": metadata,
        "success_url": success_url,
        "cancel_url": f"{base}/profile",
    }
    if customer_id:
        params["customer"] = customer_id

    try:
        session = await asyncio.to_thread(stripe.checkout.Session.create, **params)
    except Exception as e:
        logger.error("Stripe upsell checkout failed for user %s (offer=%s): %s", user_id, offer, e)
        return {"error": "Pagos temporalmente no disponibles. Intenta de nuevo en unos minutos."}

    await _track(db, user_id, "upsell_converted", offer, tier, body.get("trigger_source"), {"variant": key})
    return {"url": session.url}


# ── 1:1 session payment verification (migration 081) ───────────────────────
# Paying for a 1:1 session ("session" offer here, or billing.py's flat-$20
# "broker_call") used to hand the user the exact same PUBLIC Calendly link
# shown to non-paying users too — nothing recorded that a specific Stripe
# payment happened, so booking had zero automated verification (Diego,
# 2026-08-20 audit: 100% manual reconciliation against the Stripe
# dashboard). These two endpoints close that gap: verify grants a durable
# credit the instant the user lands back from checkout (same live
# stripe.checkout.Session.retrieve pattern as research.py's /research/start,
# not the async webhook, so there's no race with Stripe's webhook delivery
# delay), and redeem spends exactly one credit before the frontend reveals
# the Calendly booking link.

@router.post("/verify-1on1-payment")
async def verify_1on1_payment(body: dict, user_id: str = Depends(get_current_user_id)):
    """Verifies a completed Stripe checkout for a 1:1 session offer and
    grants the corresponding credit(s) to paid_1on1_sessions. Idempotent
    per stripe_session_id — redeemed_1on1_checkouts' primary key means
    re-verifying the same checkout (page reload, double call) never
    double-grants, it just reports the existing balance back."""
    stripe_session_id = body.get("stripe_session_id")
    if not stripe_session_id:
        raise HTTPException(status_code=400, detail="stripe_session_id es requerido")
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Pagos no configurados")

    db = get_supabase()
    stripe.api_key = settings.stripe_secret_key
    try:
        session = await asyncio.to_thread(stripe.checkout.Session.retrieve, stripe_session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="No se pudo verificar el pago — intenta de nuevo en unos segundos")

    metadata = session.get("metadata") or {}
    offer = metadata.get("offer")
    if (
        session.get("payment_status") != "paid"
        or session.get("client_reference_id") != user_id
        or offer not in ("session", "broker_call")
    ):
        raise HTTPException(status_code=402, detail="Pago no confirmado para esta sesión")

    credits = 3 if metadata.get("variant") == "bundle" else 1

    try:
        await run_query(
            db.table("redeemed_1on1_checkouts").insert({
                "stripe_session_id": stripe_session_id,
                "user_id": user_id,
                "offer": offer,
                "credits_granted": credits,
            })
        )
    except Exception:
        # Unique-violation on stripe_session_id — already credited by an
        # earlier call for this exact checkout. Report the current balance
        # instead of granting a second time.
        row = await run_query(
            db.table("user_profiles").select("paid_1on1_sessions").eq("user_id", user_id).maybe_single()
        )
        balance = int(((row.data if row else None) or {}).get("paid_1on1_sessions") or 0)
        return {"ok": True, "granted": 0, "balance": balance}

    row = await run_query(
        db.table("user_profiles").select("paid_1on1_sessions").eq("user_id", user_id).maybe_single()
    )
    current = int(((row.data if row else None) or {}).get("paid_1on1_sessions") or 0)
    new_balance = current + credits
    await run_query(
        db.table("user_profiles").update({"paid_1on1_sessions": new_balance}).eq("user_id", user_id)
    )
    return {"ok": True, "granted": credits, "balance": new_balance}


@router.post("/redeem-1on1-session")
async def redeem_1on1_session(user_id: str = Depends(get_current_user_id)):
    """Spend one paid 1:1 session credit so the frontend can reveal the
    Calendly booking link. Compare-and-swap on the exact value just read
    (same fix as referral.py's redeem-session) — two concurrent calls
    reading the same balance can't both decrement from the same stale
    read and double-spend a single credit."""
    db = get_supabase()
    row = await run_query(
        db.table("user_profiles").select("paid_1on1_sessions").eq("user_id", user_id).maybe_single()
    )
    count = int(((row.data if row else None) or {}).get("paid_1on1_sessions") or 0)
    if count <= 0:
        raise HTTPException(status_code=400, detail="No tienes sesiones 1:1 pagadas disponibles")

    result = await run_query(
        db.table("user_profiles")
        .update({"paid_1on1_sessions": count - 1})
        .eq("user_id", user_id)
        .eq("paid_1on1_sessions", count)
    )
    if not result.data:
        raise HTTPException(status_code=409, detail="Ese crédito ya fue redimido, intenta de nuevo")
    return {"ok": True, "remaining": count - 1}


@router.post("/events")
async def track_event(body: dict, user_id: str = Depends(get_current_user_id)):
    """Track upsell analytics events (triggered, viewed, dismissed, converted, upgrade_to_premium)."""
    db = get_supabase()
    await _track(
        db, user_id,
        body.get("event_type", "upsell_viewed"),
        body.get("offer_type"),
        body.get("user_tier"),
        body.get("trigger_source"),
        body.get("metadata", {}),
    )
    return {"ok": True}


async def _track(db, user_id: str, event_type: str, offer_type=None, user_tier=None, trigger_source=None, metadata=None):
    try:
        await run_query(
            db.table("upsell_events").insert({
                "user_id": user_id,
                "event_type": event_type,
                "offer_type": offer_type,
                "user_tier": user_tier,
                "trigger_source": trigger_source,
                "metadata": metadata or {},
            })
        )
    except Exception as e:
        logger.warning("upsell event tracking failed: %s", e)
