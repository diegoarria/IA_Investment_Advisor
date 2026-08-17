"""
Nuvos Weekly Rituals — thin routes over app.services.weekly_rituals_service.
See that module's docstring and migration 070_weekly_rituals.sql for the
full feature (daily question, Sunday prep, Saturday reflection).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user_id
from app.api.routes.market import _get_user_profile

router = APIRouter(prefix="/weekly-rituals", tags=["weekly_rituals"])


async def _profile_lang_and_tier(user_id: str) -> tuple[str, bool]:
    from app.api.routes.chat import _is_premium

    profile = await _get_user_profile(user_id)
    lang = getattr(profile, "preferred_language", None) or "es"
    return lang, _is_premium(profile)


@router.get("/question")
async def get_question_route(lang: str | None = None, user_id: str = Depends(get_current_user_id)):
    from app.services.weekly_rituals_service import get_today_question

    profile_lang, _ = await _profile_lang_and_tier(user_id)
    result = await get_today_question(user_id, lang if lang in ("es", "en") else profile_lang)
    if result is None:
        raise HTTPException(status_code=404, detail="No hay pregunta del día disponible")
    return result


@router.post("/question/vote")
async def vote_question_route(body: dict, user_id: str = Depends(get_current_user_id)):
    from app.services.weekly_rituals_service import record_vote

    choice = (body.get("choice") or "").strip().lower()
    if choice not in ("a", "b"):
        raise HTTPException(status_code=400, detail="choice debe ser 'a' o 'b'")
    try:
        return await record_vote(user_id, choice)
    except Exception as exc:
        # UNIQUE(user_id, date) violation — the honest "you already voted
        # today" case, not a server error.
        if "duplicate key" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Ya votaste la pregunta de hoy")
        raise


@router.get("/sunday-prep")
async def sunday_prep_route(user_id: str = Depends(get_current_user_id)):
    from app.services.weekly_rituals_service import get_sunday_prep

    _, is_premium = await _profile_lang_and_tier(user_id)
    return await get_sunday_prep(user_id, is_premium)


@router.post("/reflection")
async def save_reflection_route(body: dict, user_id: str = Depends(get_current_user_id)):
    from app.services.weekly_rituals_service import save_reflection

    return await save_reflection(
        user_id,
        body.get("went_well"),
        body.get("learned"),
        body.get("would_do_differently"),
    )


@router.get("/reflection/history")
async def reflection_history_route(user_id: str = Depends(get_current_user_id)):
    from app.services.weekly_rituals_service import get_reflection_history

    return {"reflections": await get_reflection_history(user_id)}


@router.get("/portfolio-review")
async def portfolio_review_route(user_id: str = Depends(get_current_user_id)):
    from app.services.weekly_rituals_service import get_portfolio_review

    result = await get_portfolio_review(user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="No hay datos de portafolio disponibles todavía")
    return result
