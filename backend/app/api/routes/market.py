from fastapi import APIRouter, Depends, Query
from concurrent.futures import ThreadPoolExecutor
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

_INDEX_CACHE: dict = {}
_INDEX_CACHE_TTL = 60  # seconds

INDICES = {
    "S&P 500":   "^GSPC",
    "Nasdaq":    "^IXIC",
    "Dow Jones": "^DJI",
    "Russell":   "^RUT",
    "VIX":       "^VIX",
}


def _get_user_profile(user_id: str) -> UserProfile | None:
    db = get_supabase()
    result = db.table("user_profiles").select("*").eq("user_id", user_id).execute()
    if result.data:
        try:
            return UserProfile(**result.data[0])
        except Exception:
            return None
    return None


def _fetch_one_index(symbol: str) -> tuple[float | None, float | None]:
    """Returns (price, prev_close). Tries fast_info first, falls back to history."""
    t = yf.Ticker(symbol)
    # Try fast_info first (faster)
    try:
        fi = t.fast_info
        price = float(fi.last_price) if fi.last_price else None
        prev  = float(fi.previous_close) if fi.previous_close else None
        if price and prev:
            return price, prev
    except Exception:
        pass
    # Fallback to history (more reliable on restricted servers)
    try:
        hist = t.history(period="5d")
        if not hist.empty and len(hist) >= 2:
            return float(hist["Close"].iloc[-1]), float(hist["Close"].iloc[-2])
    except Exception:
        pass
    return None, None


def _fetch_indices() -> list[dict]:
    import time
    now = time.time()
    if _INDEX_CACHE.get("ts") and now - _INDEX_CACHE["ts"] < _INDEX_CACHE_TTL:
        return _INDEX_CACHE["data"]
    result = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        prices = dict(zip(INDICES.values(), pool.map(_fetch_one_index, INDICES.values())))
    for name, symbol in INDICES.items():
        entry = {"name": name, "symbol": symbol, "price": None, "change": 0.0, "change_pct": 0.0}
        price, prev = prices.get(symbol, (None, None))
        if price and prev:
            entry["price"]      = round(price, 2)
            entry["change"]     = round(price - prev, 2)
            entry["change_pct"] = round((price - prev) / prev * 100, 2)
        result.append(entry)
    _INDEX_CACHE["data"] = result
    _INDEX_CACHE["ts"]   = now
    return result


@router.get("/indices/debug")
async def debug_indices():
    """Temp debug endpoint — shows raw yfinance errors."""
    results = {}
    for name, symbol in list(INDICES.items())[:2]:
        entry = {"fast_info": None, "history": None, "fi_error": None, "hist_error": None}
        t = yf.Ticker(symbol)
        try:
            fi = t.fast_info
            entry["fast_info"] = {"last_price": fi.last_price, "prev_close": fi.previous_close}
        except Exception as e:
            entry["fi_error"] = str(e)
        try:
            hist = t.history(period="5d")
            entry["history"] = {"rows": len(hist), "last": float(hist["Close"].iloc[-1]) if not hist.empty else None}
        except Exception as e:
            entry["hist_error"] = str(e)
        results[name] = entry
    return results


@router.get("/indices")
async def get_indices(user_id: str = Depends(get_current_user_id)):
    import asyncio
    data = await asyncio.to_thread(_fetch_indices)
    return data


@router.post("/prices")
async def get_prices(request: dict, user_id: str = Depends(get_current_user_id)):
    symbols = [s.upper() for s in request.get("symbols", [])]

    def _fetch(symbol: str) -> tuple[str, dict]:
        t = yf.Ticker(symbol)
        price, prev, currency = None, None, "USD"
        # Try fast_info
        try:
            fi = t.fast_info
            price    = float(fi.last_price) if fi.last_price else None
            prev     = float(fi.previous_close) if fi.previous_close else None
            currency = fi.currency or "USD"
        except Exception:
            pass
        # Fallback to history if fast_info gave nothing
        if not price:
            try:
                hist = t.history(period="5d")
                if not hist.empty and len(hist) >= 2:
                    price = float(hist["Close"].iloc[-1])
                    prev  = float(hist["Close"].iloc[-2])
            except Exception:
                pass
        change_pct = 0.0
        if price and prev and prev != 0:
            change_pct = round((price - prev) / prev * 100, 2)
        return symbol, {
            "price":      round(price, 4) if price else None,
            "change_pct": change_pct,
            "currency":   currency,
            "name":       symbol,
        }

    with ThreadPoolExecutor(max_workers=min(len(symbols), 10)) as pool:
        pairs = list(pool.map(_fetch, symbols))
    return dict(pairs)


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


def _fetch_position_data(positions: list) -> list[dict]:
    """Fetch current price and analyst targets for each position."""
    enriched = []
    for pos in positions:
        ticker = pos.ticker.upper()
        entry = {
            "ticker": ticker,
            "name": pos.name or ticker,
            "shares": pos.shares,
            "avg_price": pos.avg_price,
            "current_price": None,
            "analyst_target": None,
            "analyst_low": None,
            "analyst_high": None,
            "recommendation": None,
        }
        try:
            t = yf.Ticker(ticker)
            fi = t.fast_info
            entry["current_price"] = round(float(fi.last_price), 2) if fi.last_price else None
            targets = t.analyst_price_targets
            if targets is not None and not targets.empty:
                entry["analyst_target"] = round(float(targets.get("mean", 0) or 0), 2) or None
                entry["analyst_low"]    = round(float(targets.get("low",  0) or 0), 2) or None
                entry["analyst_high"]   = round(float(targets.get("high", 0) or 0), 2) or None
            rec = t.recommendations_summary
            if rec is not None and not rec.empty:
                cols = rec.columns.tolist()
                row = rec.iloc[0]
                buy_cols  = [c for c in cols if "buy"  in c.lower() and "strong" not in c.lower()]
                sbuy_cols = [c for c in cols if "strongbuy"   in c.lower() or "strong buy" in c.lower()]
                hold_cols = [c for c in cols if "hold" in c.lower()]
                sell_cols = [c for c in cols if "sell" in c.lower() and "strong" not in c.lower()]
                buys  = int(sum(row[c] for c in sbuy_cols + buy_cols  if c in row.index) or 0)
                holds = int(sum(row[c] for c in hold_cols if c in row.index) or 0)
                sells = int(sum(row[c] for c in sell_cols if c in row.index) or 0)
                entry["recommendation"] = f"{buys} buy / {holds} hold / {sells} sell"
        except Exception:
            pass
        enriched.append(entry)
    return enriched


@router.get("/chart/{ticker}")
async def get_chart(
    ticker: str,
    period: str = "1y",
    user_id: str = Depends(get_current_user_id)
):
    import asyncio

    def _fetch():
        period_map = {
            "1d":  ("1d",  "5m"),
            "5d":  ("5d",  "30m"),
            "1m":  ("1mo", "1d"),
            "6m":  ("6mo", "1wk"),
            "ytd": ("ytd", "1wk"),
            "1y":  ("1y",  "1wk"),
            "5y":  ("5y",  "1mo"),
            "max": ("max", "3mo"),
        }
        yf_period, interval = period_map.get(period, ("1y", "1wk"))
        t = yf.Ticker(ticker.upper())
        hist = t.history(period=yf_period, interval=interval)
        if hist is None or hist.empty:
            return None
        prices     = [round(float(p), 2) for p in hist["Close"].tolist()]
        timestamps = [str(idx.date()) if hasattr(idx, "date") else str(idx)[:10] for idx in hist.index]
        fi         = t.fast_info
        current    = round(float(fi.last_price), 2) if fi.last_price else prices[-1]
        info       = t.info or {}
        name       = info.get("shortName") or ticker.upper()
        change_pct = round((prices[-1] - prices[0]) / prices[0] * 100, 2) if prices[0] else 0
        return {"ticker": ticker.upper(), "name": name, "prices": prices,
                "timestamps": timestamps, "current_price": current,
                "change_pct": change_pct, "period": period}

    result = await asyncio.to_thread(_fetch)
    if result is None:
        return {"error": "No data", "ticker": ticker.upper()}
    return result


@router.post("/portfolio")
async def simulate_portfolio(
    request: PortfolioScenarioRequest,
    user_id: str = Depends(get_current_user_id)
):
    import asyncio
    profile = _get_user_profile(user_id)

    enriched_positions = None
    if request.positions:
        enriched_positions = await asyncio.to_thread(_fetch_position_data, request.positions)

    scenario_analysis = await ai_service.generate_portfolio_scenario(
        scenario=request.scenario,
        capital=request.capital,
        profile=profile,
        focus_sectors=request.focus_sectors,
        positions=enriched_positions,
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
