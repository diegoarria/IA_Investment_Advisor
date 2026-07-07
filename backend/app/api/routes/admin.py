"""Read-only admin panel — lets an admin (you) look up any user by email and
see their complete profile, portfolio, watchlist, progress, and behavioral
memory in one view. Deliberately NOT a real "log in as" — that would mean
generating a second active session in the same browser, which is exactly
the kind of cross-account data collision that caused accounts to show each
other's data (fixed separately). This is a one-way, read-only snapshot
instead: safer, simpler, and sufficient for support/debugging."""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_supabase, run_query
from app.services import fmg_service, investor_progress_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_emails() -> set[str]:
    return {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}


async def _require_admin(user: dict) -> None:
    if (user.get("email") or "").lower() not in _admin_emails():
        raise HTTPException(status_code=403, detail="No autorizado")


async def _find_user_by_email(email: str, db) -> dict | None:
    try:
        users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
        for u in users:
            if (u.email or "").lower() == email.lower():
                return {"id": u.id, "email": u.email}
    except Exception as e:
        logger.warning("_find_user_by_email failed: %s", e)
    return None


def _agg_positions(rows: list[dict]) -> list:
    """Same aggregation used across worker.py — a user can have positions
    spread across multiple portfolio rows (premium multi-portfolio)."""
    positions: list = []
    for row in rows:
        raw = row.get("positions", [])
        if isinstance(raw, dict) and "_v" in raw:
            raw = raw.get("positions", [])
        if isinstance(raw, list):
            positions.extend(raw)
    return positions


@router.get("/user-snapshot")
async def get_user_snapshot(email: str, user: dict = Depends(get_current_user)):
    await _require_admin(user)

    db = get_supabase()
    target = await _find_user_by_email(email, db)
    if not target:
        raise HTTPException(status_code=404, detail="No existe un usuario con ese correo")
    target_id = target["id"]

    profile_res, portfolio_res, watchlist_res, fmg_res = await asyncio.gather(
        run_query(db.table("user_profiles").select("*").eq("user_id", target_id).limit(1)),
        run_query(db.table("user_portfolio").select("positions").eq("user_id", target_id)),
        run_query(db.table("watchlist").select("ticker,name,added_at").eq("user_id", target_id)),
        fmg_service.get_fmg_context(target_id),
        return_exceptions=True,
    )

    profile = {} if isinstance(profile_res, Exception) or not profile_res.data else profile_res.data[0]
    positions = [] if isinstance(portfolio_res, Exception) else _agg_positions(portfolio_res.data or [])
    watchlist = [] if isinstance(watchlist_res, Exception) else (watchlist_res.data or [])

    try:
        progress = await investor_progress_service.compute_progress_summary(target_id)
    except Exception as e:
        logger.warning("Admin snapshot: progress summary failed for %s: %s", target_id, e)
        progress = {}

    memories_res, patterns_res, events_res = await asyncio.gather(
        run_query(
            db.table("fmg_memories").select("type,content,times_reinforced")
            .eq("user_id", target_id).eq("is_active", True).order("times_reinforced", desc=True).limit(30)
        ),
        run_query(
            db.table("fmg_behavioral_patterns").select("pattern_key,description,confidence,times_observed,is_positive")
            .eq("user_id", target_id).order("confidence", desc=True).limit(20)
        ),
        run_query(
            db.table("fmg_events").select("event_type,title,description,occurred_at")
            .eq("user_id", target_id).order("occurred_at", desc=True).limit(15)
        ),
        return_exceptions=True,
    )

    return {
        "user_id": target_id,
        "email": target["email"],
        "profile": profile,
        "positions": positions,
        "watchlist": watchlist,
        "progress": progress,
        "fmg": {
            "memories": [] if isinstance(memories_res, Exception) else (memories_res.data or []),
            "patterns": [] if isinstance(patterns_res, Exception) else (patterns_res.data or []),
            "events": [] if isinstance(events_res, Exception) else (events_res.data or []),
        },
    }
