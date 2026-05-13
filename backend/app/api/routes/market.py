from fastapi import APIRouter, Depends, Query
import yfinance as yf
import anthropic
import json
from app.api.deps import get_current_user_id
from app.core.config import settings
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


@router.post("/prices")
async def get_prices(request: dict, user_id: str = Depends(get_current_user_id)):
    symbols = [s.upper() for s in request.get("symbols", [])]
    result = {}
    for symbol in symbols:
        try:
            t = yf.Ticker(symbol)
            fi = t.fast_info
            price = fi.last_price
            result[symbol] = {
                "price": round(float(price), 4) if price else None,
                "currency": fi.currency or "USD",
                "name": t.info.get("shortName", symbol),
            }
        except Exception:
            result[symbol] = {"price": None, "currency": "USD", "name": symbol}
    return result


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


@router.post("/portfolio/from-screenshot")
async def portfolio_from_screenshot(
    request: dict,
    user_id: str = Depends(get_current_user_id)
):
    image_data = request.get("image", "")
    image_type = request.get("type", "image/jpeg")

    if not image_data:
        return {"positions": [], "error": "No image provided"}

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image_type,
                            "data": image_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "Analiza esta captura de pantalla de un portafolio de inversión y extrae todas las posiciones.\n\n"
                            "Devuelve ÚNICAMENTE un JSON array con este formato exacto (sin texto adicional, sin markdown, sin bloques de código):\n"
                            '[{"ticker":"AAPL","name":"Apple Inc.","shares":10.5,"avg_price":150.00}]\n\n'
                            "Reglas:\n"
                            "- ticker: símbolo bursátil en MAYÚSCULAS\n"
                            "- name: nombre completo de la empresa si es visible, si no usa el ticker\n"
                            "- shares: número de acciones o unidades (decimal permitido)\n"
                            "- avg_price: precio promedio de compra por acción si es visible, null si no aparece\n"
                            "- Incluye TODAS las posiciones visibles en la imagen\n"
                            "- Si un campo no es legible, usa null\n"
                            "- Devuelve SOLO el JSON array, sin ningún otro texto"
                        ),
                    },
                ],
            }],
        )

        raw = message.content[0].text.strip()
        # Strip markdown code fences if present
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        positions = json.loads(raw)
        result = []
        for p in positions:
            ticker = str(p.get("ticker") or "").strip().upper()
            if not ticker:
                continue
            avg_price = p.get("avg_price")
            # If avg_price missing, try fetching current price from yfinance
            if avg_price is None or avg_price == 0:
                try:
                    fi = yf.Ticker(ticker).fast_info
                    avg_price = round(float(fi.last_price), 4) if fi.last_price else 0
                except Exception:
                    avg_price = 0
            result.append({
                "ticker": ticker,
                "name": p.get("name") or ticker,
                "shares": float(p.get("shares") or 0),
                "avg_price": float(avg_price or 0),
            })

        return {"positions": result}

    except json.JSONDecodeError:
        return {"positions": [], "error": "No se pudo parsear la respuesta del modelo"}
    except Exception as e:
        return {"positions": [], "error": str(e)}


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
