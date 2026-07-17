"""
Investment Journal routes
==========================
List/get saved theses, and an on-demand "review" that re-fetches today's
real fundamentals and asks Claude for a then-vs-now comparison. Deliberately
no scheduler/push here — see investment_journal_service's module docstring.
"""

from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.api.routes.chat import _get_user_profile, _is_premium
from app.services import investment_journal_service

router = APIRouter(prefix="/journal", tags=["journal"])


@router.get("")
async def list_theses(ticker: str | None = None, user_id: str = Depends(get_current_user_id)):
    theses = await investment_journal_service.list_theses(user_id, ticker=ticker)
    return {"theses": theses}


@router.get("/{thesis_id}")
async def get_thesis(thesis_id: str, user_id: str = Depends(get_current_user_id)):
    thesis = await investment_journal_service.get_thesis(user_id, thesis_id)
    if not thesis:
        raise HTTPException(status_code=404, detail="Tesis no encontrada")
    return thesis


@router.post("/{thesis_id}/review")
async def review_thesis(thesis_id: str, user_id: str = Depends(get_current_user_id)):
    profile = await _get_user_profile(user_id)
    if not _is_premium(profile):
        raise HTTPException(status_code=403, detail="Revisar una tesis requiere Premium")

    thesis = await investment_journal_service.get_thesis(user_id, thesis_id)
    if not thesis:
        raise HTTPException(status_code=404, detail="Tesis no encontrada")

    from app.services.fundamental_analysis_service import get_fundamental_analysis
    from app.services import ai_service

    current = get_fundamental_analysis(thesis["ticker"])
    if not current:
        raise HTTPException(status_code=502, detail="No se pudieron obtener datos actuales para esta empresa")

    current_dcf = current.get("dcf") or {}
    current_base = (current_dcf.get("scenarios") or {}).get("base") or {}
    price_then = thesis.get("price_at_creation")
    intrinsic_then = thesis.get("intrinsic_value_base")
    price_now = current.get("current_price")
    intrinsic_now = current_base.get("intrinsic_value_per_share")

    review_text = await ai_service.review_investment_thesis(
        ticker=thesis["ticker"],
        company_name=thesis.get("company_name") or thesis["ticker"],
        created_at=thesis.get("created_at"),
        original_thesis_text=thesis.get("thesis_text", ""),
        price_then=price_then,
        price_now=price_now,
        intrinsic_then=intrinsic_then,
        intrinsic_now=intrinsic_now,
        current_fundamentals_summary=current,
    )

    return {
        "price_then": price_then,
        "price_now": price_now,
        "intrinsic_then": intrinsic_then,
        "intrinsic_now": intrinsic_now,
        "review_text": review_text,
    }
