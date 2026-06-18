from fastapi import APIRouter, Depends, Request
from app.api.deps import get_current_user_id
from app.api.routes.market import _get_user_profile
from app.core.limiter import limiter
from app.services import ai_service

router = APIRouter(prefix="/simulate", tags=["simulate"])


@router.post("")
@limiter.limit("10/minute")
async def whatif_simulate(
    req: Request,
    request: dict,
    user_id: str = Depends(get_current_user_id),
):
    scenario_type   = request.get("scenario_type", "custom")
    scenario_params = request.get("scenario_params", {})
    portfolio       = request.get("portfolio", [])

    if not portfolio:
        return {"error": "Se requiere el portafolio actual para simular."}

    profile = _get_user_profile(user_id)
    result  = await ai_service.simulate_whatif(scenario_type, scenario_params, portfolio, profile)
    return result


@router.post("/analyze-portfolio")
@limiter.limit("5/minute")
async def analyze_portfolio(
    req: Request,
    request: dict,
    user_id: str = Depends(get_current_user_id),
):
    """
    Deep AI portfolio analysis with score 1-100 and structured breakdown.
    Body: { positions: [{ ticker, shares, avg_price, name?, current_price? }] }
    """
    positions = request.get("positions", [])
    if not positions:
        return {"error": "No hay posiciones para analizar."}

    profile = _get_user_profile(user_id)
    result  = await ai_service.analyze_portfolio_score(positions, profile)
    return result
