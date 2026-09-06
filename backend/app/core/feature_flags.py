"""AI kill switch — lets Diego pause every AI feature (Arthur chat, support,
paper-trading analysis, learn debates, deep research planning, screen
explanations, profile insights) from /admin/ai-toggle without a deploy: a
suspected attack, planned maintenance, or any other reason. Durable in
Supabase (migration 090) so it survives a restart;
cached briefly (SHORT_TTL) so a chat message doesn't pay a DB round-trip on
every single request.

Fails OPEN (AI stays enabled) on any read error — a Supabase hiccup should
never silently take Arthur down; that's the opposite of what this switch is
for. Toggling it off is a deliberate, visible action from the panel, not
something that should ever happen by accident.
"""
import logging
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.cache import cache_get, cache_set
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

_CACHE_KEY = "system_settings:ai_enabled"
_SHORT_TTL = 10  # seconds — bounds how long a toggle takes to propagate across gunicorn workers

_MAINTENANCE_MESSAGE = {
    "es": "Arthur está en pausa temporalmente por mantenimiento o revisión de seguridad. Vuelve a intentarlo en unos minutos.",
    "en": "Arthur is temporarily paused for maintenance or a security review. Please try again in a few minutes.",
}


async def is_ai_enabled() -> bool:
    cached = cache_get(_CACHE_KEY)
    if cached is not None:
        return bool(cached["enabled"])
    try:
        db = get_supabase()
        result = await run_query(db.table("system_settings").select("value").eq("key", "ai_enabled").limit(1))
        rows = result.data or []
        enabled = bool(rows[0]["value"]) if rows else True
        cache_set(_CACHE_KEY, {"enabled": enabled}, ttl=_SHORT_TTL)
        return enabled
    except Exception as e:
        logger.warning("is_ai_enabled: read failed, defaulting to enabled: %s", e)
        return True


async def get_ai_status() -> dict:
    try:
        db = get_supabase()
        result = await run_query(
            db.table("system_settings").select("value, reason, updated_at, updated_by").eq("key", "ai_enabled").limit(1)
        )
        rows = result.data or []
        if not rows:
            return {"enabled": True, "reason": None, "updated_at": None, "updated_by": None}
        row = rows[0]
        return {"enabled": bool(row["value"]), "reason": row.get("reason"), "updated_at": row.get("updated_at"), "updated_by": row.get("updated_by")}
    except Exception as e:
        logger.warning("get_ai_status failed: %s", e)
        return {"enabled": True, "reason": None, "updated_at": None, "updated_by": None, "error": str(e)}


async def set_ai_enabled(enabled: bool, reason: str | None = None, actor: str | None = None) -> None:
    db = get_supabase()
    await run_query(
        db.table("system_settings").upsert({
            "key": "ai_enabled",
            "value": enabled,
            "reason": reason,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": actor,
        })
    )
    # Update immediately rather than waiting out the TTL — a deliberate
    # pause/resume from the panel should take effect right away, not up to
    # _SHORT_TTL seconds later.
    cache_set(_CACHE_KEY, {"enabled": enabled}, ttl=_SHORT_TTL)

    from app.core.security import log_security_event
    log_security_event("ai_toggled", detail=f"enabled={enabled} reason={reason} actor={actor}")


async def require_ai_enabled(lang: str = "es") -> None:
    """FastAPI dependency — add to any route that talks to an LLM with
    free-form user text. Raises 503 with a user-facing pause message when
    the switch is off, instead of letting the request reach the model."""
    if not await is_ai_enabled():
        raise HTTPException(status_code=503, detail=_MAINTENANCE_MESSAGE.get(lang, _MAINTENANCE_MESSAGE["es"]))
