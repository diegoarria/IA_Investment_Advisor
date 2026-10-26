"""Background-job/system failure log — migration 118. See that migration's
header for exactly what is and isn't recorded here (push failures live in
notification_log already, not here).

Fire-and-forget by design, same as subscription_audit.py: logging a
failure must never itself raise or block the job/request it's describing.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def _insert(event_type: str, detail: str | None, user_id: str | None) -> None:
    try:
        from app.core.database import get_supabase, run_query
        db = get_supabase()
        await run_query(
            db.table("system_event_log").insert({
                "event_type": event_type, "detail": detail, "user_id": user_id,
            })
        )
    except Exception as e:
        logger.warning("system_health: failed to log event_type=%s: %s", event_type, e)


def log_system_event(event_type: str, detail: str | None = None, user_id: str | None = None) -> None:
    """Schedules the insert and returns immediately. Safe to call from any
    async context; never raises."""
    try:
        asyncio.create_task(_insert(event_type, detail, user_id))
    except RuntimeError:
        logger.warning("system_health: no running event loop, skipping event_type=%s", event_type)
