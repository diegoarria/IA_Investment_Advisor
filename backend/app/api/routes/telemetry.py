"""Public intake for frontend crash reports (React error boundary /
Next.js global-error.tsx) — deliberately no auth, since the user may be
logged out or the page may be mid-crash when this fires. Rate-limited per
IP and payload-capped so it can't be abused as a free write-anything sink.
Read by GET /sentinel/client-errors for the standalone Nuvos Sentinel
monitor's "full-screen crash" detection.
"""
import logging
from fastapi import APIRouter, Request
from app.core.database import get_supabase, run_query
from app.core.limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/telemetry", tags=["telemetry"])

_MAX_FIELD_LEN = 4000


def _clip(value, max_len: int = _MAX_FIELD_LEN) -> str | None:
    if not value:
        return None
    text = str(value)
    return text[:max_len]


@router.post("/client-error")
@limiter.limit("20/minute")
async def report_client_error(request: Request, body: dict):
    """Best-effort insert — never raises, mirrors log_security_event's
    pattern (app/core/security.py): a broken telemetry sink must never be
    the reason a crash report itself fails or surfaces to the user."""
    try:
        db = get_supabase()
        await run_query(
            db.table("client_errors").insert({
                "message": _clip(body.get("message")),
                "stack": _clip(body.get("stack"), 8000),
                "url": _clip(body.get("url"), 500),
                "user_agent": _clip(body.get("user_agent"), 500),
            })
        )
    except Exception as exc:
        logger.warning("client-error report failed to persist: %s", exc)
    return {"ok": True}
