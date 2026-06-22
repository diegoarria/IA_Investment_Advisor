"""
Upsell system: Annual Report, Family Plan, 1:1 Session with Diego.
Trigger evaluation runs server-side; frontend decides when to call based on user events.
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
import stripe
import logging

from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.config import settings

router = APIRouter(prefix="/upsells", tags=["upsells"])
logger = logging.getLogger(__name__)

PRIORITY = ["session", "annual_report", "family_plan"]

_PROMO_DAYS = 90


def _effective_tier(raw_tier: str, trial_started_at: str | None) -> str:
    """Return 'premium' if user is paid premium OR within 90-day promo trial."""
    if raw_tier == "premium":
        return "premium"
    if not trial_started_at:
        return raw_tier
    try:
        started = datetime.fromisoformat(trial_started_at.replace("Z", "+00:00"))
        if (datetime.now(timezone.utc) - started).total_seconds() / 86400 < _PROMO_DAYS:
            return "premium"
    except Exception:
        pass
    return raw_tier

PRICES = {
    "annual_report": {"free": 34.99, "premium": 19.99},
    "session":       {"free": 149.0, "premium": 99.0, "bundle": 247.0},
    "family_plan":   {"monthly": 19.99, "yearly": 199.99},
}

DISMISS_COOLDOWN_DAYS = 14


def _price_id_for(offer: str, tier: str, variant: str = "default") -> str:
    mapping = {
        ("annual_report", "free"):    settings.stripe_price_annual_report_free,
        ("annual_report", "premium"): settings.stripe_price_annual_report_premium,
        ("session", "free"):          settings.stripe_price_session_free,
        ("session", "premium"):       settings.stripe_price_session_premium,
        ("session", "bundle"):        settings.stripe_price_session_bundle,
        ("family_plan", "monthly"):   settings.stripe_price_family_monthly,
        ("family_plan", "yearly"):    settings.stripe_price_family_yearly,
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

    if offer == "annual_report":
        # Available at month 11 of account age (330+ days) OR every December
        is_december = datetime.now(timezone.utc).month == 12
        return account_days >= 330 or is_december or trigger_source == "annual_renewal"

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
        .select("subscription_tier, trial_started_at, created_at, subscription_started_at")
        .eq("user_id", user_id)
        .single()
    )
    profile = profile_res.data or {}
    tier = _effective_tier(profile.get("subscription_tier", "free"), profile.get("trial_started_at"))
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
    if offer_type not in ("annual_report", "family_plan", "session"):
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
    Create Stripe one-time checkout for annual_report or session.
    Family Plan uses /billing/family-plan endpoint (subscription upgrade).
    """
    offer = body.get("offer")
    variant = body.get("variant", "default")  # 'bundle' | 'monthly' | 'yearly' | tier

    if offer not in ("annual_report", "session", "family_plan"):
        return {"error": "Invalid offer"}

    if not settings.stripe_secret_key:
        return {"error": "Pagos no configurados"}

    stripe.api_key = settings.stripe_secret_key
    db = get_supabase()

    profile_res = await run_query(
        db.table("user_profiles")
        .select("stripe_customer_id, subscription_tier, trial_started_at")
        .eq("user_id", user_id)
        .single()
    )
    profile = profile_res.data or {}
    tier = _effective_tier(profile.get("subscription_tier", "free"), profile.get("trial_started_at"))
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
    params: dict = {
        "mode": mode,
        "payment_method_types": ["card"],
        "line_items": [{"price": price_id, "quantity": 1}],
        "client_reference_id": user_id,
        "metadata": {"offer": offer, "variant": key, "user_tier": tier},
        "success_url": f"{base}/upsell-success?offer={offer}&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/profile",
    }
    if customer_id:
        params["customer"] = customer_id

    session = stripe.checkout.Session.create(**params)

    await _track(db, user_id, "upsell_converted", offer, tier, body.get("trigger_source"), {"variant": key})
    return {"url": session.url}


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
