from fastapi import APIRouter, Depends, Query
from app.api.deps import get_current_user_id
from app.core.database import get_supabase
from app.models.user import UserProfile
from app.models.market import AssetAnalysisRequest, PortfolioScenarioRequest
from app.services import market_service, ai_service

router = APIRouter(prefix="/market", tags=["market"])


def _get_user_profile(user_id: str) -> UserProfile | None:
    db = get_supabase()
    result = db.table("user_profiles").select("*").eq("user_id", user_id).execute()
    if result.data:
        try:
            return UserProfile(**result.data[0])
        except Exception:
            return None
    return None


@router.get("/summary")
async def get_market_summary(user_id: str = Depends(get_current_user_id)):
    return market_service.get_market_summary()


@router.get("/asset/{symbol}")
async def get_asset(symbol: str, user_id: str = Depends(get_current_user_id)):
    return market_service.get_asset_data(symbol.upper())


@router.post("/analyze")
async def analyze_assets(
    request: AssetAnalysisRequest,
    user_id: str = Depends(get_current_user_id)
):
    symbols = [s.upper() for s in request.symbols]
    market_data = market_service.get_multiple_assets(symbols)
    profile = _get_user_profile(user_id)
    analysis = await ai_service.analyze_assets(symbols, market_data, profile)
    return {
        "symbols": symbols,
        "market_data": market_data,
        "ai_analysis": analysis
    }


@router.post("/portfolio")
async def simulate_portfolio(
    request: PortfolioScenarioRequest,
    user_id: str = Depends(get_current_user_id)
):
    profile = _get_user_profile(user_id)
    scenario_analysis = await ai_service.generate_portfolio_scenario(
        scenario=request.scenario,
        capital=request.capital,
        profile=profile,
        focus_sectors=request.focus_sectors
    )
    return {
        "scenario": request.scenario,
        "analysis": scenario_analysis
    }


@router.get("/earnings")
async def get_upcoming_earnings(
    symbols: list[str] = Query(default=None),
    user_id: str = Depends(get_current_user_id)
):
    return market_service.get_upcoming_earnings(symbols)


@router.get("/movers")
async def get_significant_movers(
    threshold: float = Query(default=3.0, ge=0.5, le=20.0),
    user_id: str = Depends(get_current_user_id)
):
    return market_service.detect_significant_moves(threshold_pct=threshold)
