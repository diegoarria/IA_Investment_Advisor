from fastapi import APIRouter, Depends
from app.api.deps import get_current_user_id
from app.api.routes.market import _get_user_profile
from app.services import ai_service

router = APIRouter(prefix="/simulate", tags=["simulate"])


@router.post("")
async def whatif_simulate(
    request: dict,
    user_id: str = Depends(get_current_user_id),
):
    """
    ¿Qué pasa si? simulator.

    Body:
      scenario_type: "swap" | "add_monthly" | "macro" | "custom"
      scenario_params: dict with scenario-specific fields
      portfolio: list of { ticker, name, shares, avg_cost, current_price, value }
    """
    scenario_type   = request.get("scenario_type", "custom")
    scenario_params = request.get("scenario_params", {})
    portfolio       = request.get("portfolio", [])

    if not portfolio:
        return {"error": "Se requiere el portafolio actual para simular."}

    profile = _get_user_profile(user_id)
    result  = await ai_service.simulate_whatif(scenario_type, scenario_params, portfolio, profile)
    return result
