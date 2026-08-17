"""
Smart Alerts — 100% Premium (Diego's Aug 16 Free/Premium spec, §7). No GET
route existed for this feature before (detection only ran inside
worker.py's daily job, pushing directly) — this is the read-side companion
that lets Free users see a real teaser count without exposing any alert
content, and lets Premium users query their own alert history.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user_id

router = APIRouter(prefix="/smart-alerts", tags=["smart_alerts"])


@router.get("/teaser")
async def get_smart_alerts_teaser_route(user_id: str = Depends(get_current_user_id)):
    """Real count of smart-alert-worthy detections in the trailing 7 days —
    same number regardless of tier (sourced from notification_log, which
    now logs a real row for Free users too, just without ever delivering
    the push — see smart_alerts_service.run_smart_alerts_check). Content
    itself (ticker, category, copy) is never included here."""
    from app.services.smart_alerts_service import get_smart_alerts_teaser

    count = await get_smart_alerts_teaser(user_id)
    return {"count": count}
