"""
Morning Brief — thin route over app.services.morning_brief_service. See
that module's docstring for the full feature (Premium-only, Mon-Fri
9:15am ET push, zero Claude calls by design).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user_id

router = APIRouter(prefix="/morning-brief", tags=["morning_brief"])


@router.get("")
async def get_morning_brief_route(user_id: str = Depends(get_current_user_id)):
    from app.services.morning_brief_service import get_morning_brief
    from app.api.routes.chat import _get_user_profile  # the real async one — see weekly_rituals.py's fix for why not market.py's

    profile = await _get_user_profile(user_id)
    lang = getattr(profile, "preferred_language", None) or "es"
    result = await get_morning_brief(user_id, lang=lang)
    if result is None:
        raise HTTPException(status_code=404, detail="No hay Morning Brief disponible todavía hoy")
    return result
