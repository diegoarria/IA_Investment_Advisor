from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.core.subscription import is_premium_active
from app.services import saved_valuation_service

router = APIRouter(prefix="/saved-valuations", tags=["saved-valuations"])


async def _require_premium(user_id: str) -> None:
    db = get_supabase()
    res = await run_query(
        db.table("user_profiles").select("subscription_tier,trial_started_at,streak_bonus_premium_until").eq("user_id", user_id)
    )
    row = res.data[0] if res.data else {}
    if not is_premium_active(row.get("subscription_tier"), row.get("trial_started_at"), row.get("streak_bonus_premium_until")):
        raise HTTPException(status_code=403, detail="Función exclusiva para usuarios Premium")


@router.get("")
async def list_saved_valuations(user_id: str = Depends(get_current_user_id)):
    await _require_premium(user_id)
    return await saved_valuation_service.list_with_live_data(user_id)


@router.post("")
async def create_saved_valuation(body: dict, user_id: str = Depends(get_current_user_id)):
    await _require_premium(user_id)
    ticker = (body.get("ticker") or "").strip()
    growth_pct = body.get("growth_pct")
    discount_rate_pct = body.get("discount_rate_pct")
    terminal_growth_pct = body.get("terminal_growth_pct")
    if not ticker or growth_pct is None or discount_rate_pct is None or terminal_growth_pct is None:
        raise HTTPException(status_code=422, detail="ticker, growth_pct, discount_rate_pct y terminal_growth_pct son requeridos")
    try:
        return await saved_valuation_service.save_valuation(
            user_id, ticker, float(growth_pct), float(discount_rate_pct), float(terminal_growth_pct)
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.delete("/{ticker}")
async def remove_saved_valuation(ticker: str, user_id: str = Depends(get_current_user_id)):
    await _require_premium(user_id)
    deleted = await saved_valuation_service.delete_valuation(user_id, ticker)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"No hay un valor intrínseco guardado para {ticker}")
    return {"deleted": ticker.upper()}
