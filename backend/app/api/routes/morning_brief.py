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
    """Real production gap found Aug 16 (Diego's Free/Premium redesign
    audit): this route computed and returned the FULL Morning Brief —
    portfolio, top mover, news, today's events — to any authenticated
    user, free or Premium. The module docstring always said "Premium-
    only" but nothing enforced it. Free users now get a real-number
    teaser (how many news items / events exist today, never the content
    itself) instead of the full breakdown — same pattern
    weekly_rituals_service.get_sunday_prep already uses for Free vs.
    Premium."""
    from app.services.morning_brief_service import get_morning_brief
    from app.api.routes.chat import _get_user_profile, _is_premium  # the real async one — see weekly_rituals.py's fix for why not market.py's

    profile = await _get_user_profile(user_id)
    lang = getattr(profile, "preferred_language", None) or "es"
    result = await get_morning_brief(user_id, lang=lang)
    if result is None:
        raise HTTPException(status_code=404, detail="No hay Morning Brief disponible todavía hoy")

    if not _is_premium(profile):
        return {
            "is_premium": False,
            "portfolio_value": result.get("portfolio_value"),
            "change_usd": result.get("change_usd"),
            "change_pct": result.get("change_pct"),
            "news_count": len(result.get("news") or []),
            "events_count": len(result.get("events") or []),
        }
    return {"is_premium": True, **result}
