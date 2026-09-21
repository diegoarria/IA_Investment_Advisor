"""Stripe-verified Premium activation that does NOT depend on a webhook.

Why this exists (2026-09-20): a user paid for Premium and stayed Free. Premium
was only ever granted by webhooks that find the profile by `stripe_customer_id`
— but the payment had been made by a DIFFERENT Stripe customer than the one
saved on the profile (a checkout attempt had created a second customer whose
id was never persisted), so the webhook matched nobody and nothing happened.

`sync_subscription()` asks Stripe directly: it finds every Stripe customer
that belongs to this user (the one on the profile, any created with
metadata.user_id, and — only when they carry no user_id of their own — any with
the user's email), looks for an active/trialing subscription, and if one exists
grants Premium and repairs `stripe_customer_id`. It only ever UPGRADES (never
downgrades or touches manual/comp grants) and is idempotent.
"""
import asyncio
import logging
from datetime import datetime, timezone

import stripe

from app.core.cache import cache_delete
from app.core.config import settings
from app.core.database import run_query
from app.core.stripe_retry import stripe_call

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = ("active", "trialing")


async def _customer_ids_for_user(user_id: str, email: str | None, known_customer_id: str | None) -> list[str]:
    ids: list[str] = []
    if known_customer_id:
        ids.append(known_customer_id)
    try:
        found = await stripe_call(stripe.Customer.search, query=f"metadata['user_id']:'{user_id}'", limit=20)
        ids += [c["id"] for c in (found.get("data") or [])]
    except Exception as e:
        logger.warning("subscription_sync: customer search failed for %s: %s", user_id, e)
    if email:
        try:
            found = await stripe_call(stripe.Customer.list, email=email, limit=20)
            for c in found.get("data") or []:
                owner = (c.get("metadata") or {}).get("user_id")
                # Never adopt a customer that explicitly belongs to someone else.
                if not owner or owner == user_id:
                    ids.append(c["id"])
        except Exception as e:
            logger.warning("subscription_sync: customer list by email failed for %s: %s", user_id, e)
    seen: set[str] = set()
    return [i for i in ids if not (i in seen or seen.add(i))]


async def sync_subscription(db, user_id: str, email: str | None = None) -> dict:
    """Returns {"premium": bool, "customer_id": str|None, "status": str|None}."""
    if not settings.stripe_secret_key:
        return {"premium": False, "customer_id": None, "status": None}
    stripe.api_key = settings.stripe_secret_key

    prof = await run_query(
        db.table("user_profiles")
        .select("stripe_customer_id, subscription_started_at, duo_plan_purchased_at")
        .eq("user_id", user_id).maybe_single()
    )
    profile = (prof.data if prof else None) or {}

    best = None  # (current_period_end, customer_id, subscription)
    for cid in await _customer_ids_for_user(user_id, email, profile.get("stripe_customer_id")):
        try:
            subs = await stripe_call(stripe.Subscription.list, customer=cid, status="all", limit=10)
        except Exception as e:
            logger.warning("subscription_sync: subscription list failed for customer %s: %s", cid, e)
            continue
        for sub in subs.get("data") or []:
            if sub.get("status") in ACTIVE_STATUSES:
                end = sub.get("current_period_end") or 0
                if best is None or end > best[0]:
                    best = (end, cid, sub)
    if best is None:
        return {"premium": False, "customer_id": profile.get("stripe_customer_id"), "status": None}

    end, cid, sub = best
    now = datetime.now(timezone.utc).isoformat()
    update = {"subscription_tier": "premium", "subscription_source": "stripe", "stripe_customer_id": cid}
    if end:
        update["premium_until"] = datetime.fromtimestamp(end, tz=timezone.utc).isoformat()
    if not profile.get("subscription_started_at"):
        update["subscription_started_at"] = now
    if (sub.get("metadata") or {}).get("offer") == "family_plan" and not profile.get("duo_plan_purchased_at"):
        update["duo_plan_purchased_at"] = now
    await run_query(db.table("user_profiles").update(update).eq("user_id", user_id))
    cache_delete(f"profile:{user_id}")
    cache_delete(f"sync:all:{user_id}")
    logger.warning(
        "subscription_sync: activated Premium for user=%s from Stripe (customer=%s, previously linked=%s, status=%s)",
        user_id, cid, profile.get("stripe_customer_id"), sub.get("status"),
    )
    return {"premium": True, "customer_id": cid, "status": sub.get("status")}
