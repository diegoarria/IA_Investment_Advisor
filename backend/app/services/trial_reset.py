"""Official-launch trial reset — 2026-09-24 00:05 ET.

Diego, 2026-09-23: "a partir de mañana, todos los usuarios actuales vuelvan a
tener su prueba de 30 días premium". Same product decision as migration 038
(2026-07-16), but automated: every existing user who is NOT a paying/comp
premium subscriber gets trial_started_at = now, i.e. a fresh TRIAL_DAYS (30)
window starting at launch.

Idempotent per user: a notification_log row (type='grant',
category='trial_reset_2026_09_24') is written BEFORE the update and removed
again if the update fails, so a restart/misfire re-run never resets anyone's
clock a second time.
"""
import logging
from datetime import datetime, timezone

from app.services.launch_emails import _fetch_all

logger = logging.getLogger(__name__)

CATEGORY = "trial_reset_2026_09_24"
_PAID_TIERS = {"premium", "pro"}
_CHUNK = 200


async def reset_trials_for_launch() -> None:
    from app.core.database import get_supabase, run_query
    from app.core.cache import cache_delete

    db = get_supabase()
    try:
        profiles = await _fetch_all(lambda: db.table("user_profiles").select("user_id,subscription_tier").order("user_id"))
        done_rows = await _fetch_all(
            lambda: db.table("notification_log").select("id,user_id").eq("category", CATEGORY).eq("type", "grant").order("id"))
        done = {r["user_id"] for r in done_rows}
        eligible = [
            r["user_id"] for r in profiles
            if (r.get("subscription_tier") or "free") not in _PAID_TIERS and r["user_id"] not in done
        ]
        reset = 0
        for i in range(0, len(eligible), _CHUNK):
            chunk = eligible[i:i + _CHUNK]
            claimed = False
            try:
                await run_query(db.table("notification_log").insert(
                    [{"user_id": u, "type": "grant", "category": CATEGORY, "title": "launch trial reset",
                      "body": "", "data": {}, "status": "sent"} for u in chunk]))
                claimed = True
                now = datetime.now(timezone.utc).isoformat()
                await run_query(db.table("user_profiles").update({"trial_started_at": now}).in_("user_id", chunk))
            except Exception as e:
                logger.error("trial reset chunk %d failed: %s", i // _CHUNK, e)
                if claimed:
                    try:
                        await run_query(db.table("notification_log").delete().eq("category", CATEGORY).eq("type", "grant").in_("user_id", chunk))
                    except Exception:
                        pass
                continue
            for u in chunk:
                cache_delete(f"profile:{u}")
                cache_delete(f"sync:all:{u}")
            reset += len(chunk)
        logger.info("launch trial reset: %d/%d eligible users reset", reset, len(eligible))
    except Exception as e:
        logger.error("launch trial reset failed: %s", e)
