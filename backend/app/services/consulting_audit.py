"""Audit trail for MY NUVOS (Nuvos Consulting) — migration 119's
consulting_audit_log. Identical pattern to app/services/subscription_audit.py
and app/services/system_health.py: fire-and-forget, never blocks or fails
the real write it's describing.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def _insert(actor: str, action: str, enrollment_id: str | None, detail: str | None) -> None:
    try:
        from app.core.database import get_supabase, run_query
        db = get_supabase()
        await run_query(
            db.table("consulting_audit_log").insert({
                "actor": actor, "action": action, "enrollment_id": enrollment_id, "detail": detail,
            })
        )
    except Exception as e:
        logger.warning("consulting_audit: failed to log action=%s actor=%s: %s", action, actor, e)


def log_consulting_action(actor: str, action: str, enrollment_id: str | None = None, detail: str | None = None) -> None:
    """Schedules the audit insert and returns immediately. Safe to call
    from any async context; never raises."""
    try:
        asyncio.create_task(_insert(actor, action, enrollment_id, detail))
    except RuntimeError:
        logger.warning("consulting_audit: no running event loop, skipping action=%s", action)
