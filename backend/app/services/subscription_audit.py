"""Audit trail for subscription_tier/subscription_source/premium_until
changes — migration 117. Diego, 2026-10-26: after repeatedly asking "why
did this flip to Free" with no way to answer except grepping Railway logs,
every write site that changes a user's tier now also calls one of the two
functions below, so the answer becomes a query (see GET
/admin/subscription-audit-log) instead of a log dive.

Fire-and-forget by design: logging this must NEVER block or fail the real
billing/admin write it's describing. Every entry point swallows its own
exceptions.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def _insert(user_id: str, actor: str, tier: str | None, source: str | None,
                   premium_until: str | None, reason: str | None) -> None:
    try:
        from app.core.database import get_supabase, run_query
        db = get_supabase()
        await run_query(
            db.table("subscription_audit_log").insert({
                "user_id": user_id,
                "actor": actor,
                "tier": tier,
                "source": source,
                "premium_until": premium_until,
                "reason": reason,
            })
        )
    except Exception as e:
        logger.warning("subscription_audit: failed to log change for user=%s actor=%s: %s", user_id, actor, e)


def log_subscription_change(
    user_id: str, actor: str, tier: str | None = None, source: str | None = None,
    premium_until: str | None = None, reason: str | None = None,
) -> None:
    """Schedules the audit insert and returns immediately — call this right
    after (not instead of) the real user_profiles update, with the exact
    values that update just wrote. Safe to call from sync or async code;
    never raises."""
    try:
        asyncio.create_task(_insert(user_id, actor, tier, source, premium_until, reason))
    except RuntimeError:
        # No running event loop (e.g. a script/test context) — this is
        # best-effort telemetry, not critical path, so just skip it.
        logger.warning("subscription_audit: no running event loop, skipping log for user=%s actor=%s", user_id, actor)


async def log_subscription_change_by_customer_id(
    db, customer_id: str, actor: str, tier: str | None = None, source: str | None = None,
    premium_until: str | None = None, reason: str | None = None,
) -> None:
    """Same as log_subscription_change, for the Stripe webhook handlers that
    only have stripe_customer_id in scope (not user_id) — resolves every
    user_profiles row on that customer first (normally exactly one)."""
    try:
        from app.core.database import run_query
        res = await run_query(
            db.table("user_profiles").select("user_id").eq("stripe_customer_id", customer_id)
        )
        for row in (res.data or []):
            log_subscription_change(row["user_id"], actor, tier, source, premium_until, reason)
    except Exception as e:
        logger.warning("subscription_audit: failed to resolve user_id for customer=%s actor=%s: %s", customer_id, actor, e)
