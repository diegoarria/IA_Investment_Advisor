import asyncio
import threading
from fastapi import APIRouter, Depends, Query, Request
from concurrent.futures import ThreadPoolExecutor
import yfinance as yf
import anthropic
import json
import requests as _requests
import time as time
from app.api.deps import get_current_user_id
from app.core.config import settings
from app.core.database import get_supabase
from app.models.user import UserProfile
from app.models.market import AssetAnalysisRequest, PortfolioScenarioRequest
from app.services import market_service, ai_service
from app.core.cache import cache_get, cache_set
from app.core.limiter import limiter

# Semaphore for the sync Anthropic call in the screenshot endpoint
_screenshot_sem = threading.Semaphore(10)

router = APIRouter(prefix="/market", tags=["market"])

_NEWS_CACHE_TTL   = 900   # 15 minutes
_INDEX_CACHE_TTL  = 60    # seconds
_SEARCH_CACHE_TTL = 300   # 5 minutes

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


_YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
}


def _fetch_one_index(symbol: str) -> tuple[float | None, float | None]:
    """Returns (price, prev_close). Direct httpx call → yfinance fallback."""
    import httpx
    encoded = symbol.replace("^", "%5E")

    # Primary: direct Yahoo Finance chart API with browser headers
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?interval=1d&range=5d"
        r = httpx.get(url, headers=_YF_HEADERS, timeout=10, follow_redirects=True)
        if r.status_code == 200:
            result = r.json()["chart"]["result"][0]
            closes = [c for c in result["indicators"]["quote"][0]["close"] if c is not None]
            if len(closes) >= 2:
                return closes[-1], closes[-2]
            if len(closes) == 1:
                return closes[0], None
    except Exception:
        pass

    # Fallback: try query2 domain
    try:
        url2 = f"https://query2.finance.yahoo.com/v8/finance/chart/{encoded}?interval=1d&range=5d"
        r2 = httpx.get(url2, headers=_YF_HEADERS, timeout=10, follow_redirects=True)
        if r2.status_code == 200:
            result = r2.json()["chart"]["result"][0]
            closes = [c for c in result["indicators"]["quote"][0]["close"] if c is not None]
            if len(closes) >= 2:
                return closes[-1], closes[-2]
            if len(closes) == 1:
                return closes[0], None
    except Exception:
        pass

    # Last resort: yfinance
    try:
        t = yf.Ticker(symbol)
        fi = t.fast_info
        price = float(fi.last_price) if fi.last_price else None
        prev  = float(fi.previous_close) if fi.previous_close else None
        if price:
            return price, prev
    except Exception:
        pass

    return None, None


def _fetch_indices() -> list[dict]:
    cached = cache_get("market:indices")
    if cached:
        return cached
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
    cache_set("market:indices", result, ttl=_INDEX_CACHE_TTL)
    return result



@router.get("/indices")
async def get_indices(user_id: str = Depends(get_current_user_id)):
    import asyncio
    data = await asyncio.to_thread(_fetch_indices)
    return data


@router.get("/search")
async def search_tickers(q: str = Query(""), user_id: str = Depends(get_current_user_id)):
    q = q.strip().upper()
    if len(q) < 1:
        return {"results": []}

    ck = f"market:search:{q}"
    cached = cache_get(ck)
    if cached is not None:
        return {"results": cached}

    try:
        url = "https://query2.finance.yahoo.com/v1/finance/search"
        params = {"q": q, "lang": "en-US", "region": "US", "quotesCount": 8, "newsCount": 0, "listsCount": 0}
        headers = {"User-Agent": "Mozilla/5.0"}
        resp = _requests.get(url, params=params, headers=headers, timeout=5)
        data = resp.json()
        quotes = data.get("quotes", [])
        results = [
            {"ticker": item["symbol"], "name": item.get("longname") or item.get("shortname") or item["symbol"]}
            for item in quotes
            if item.get("symbol") and item.get("quoteType") in ("EQUITY", "ETF", "MUTUALFUND")
        ][:6]
        cache_set(ck, results, ttl=_SEARCH_CACHE_TTL)
        return {"results": results}
    except Exception:
        return {"results": []}


@router.post("/prices")
async def get_prices(request: dict, user_id: str = Depends(get_current_user_id)):
    symbols = [s.upper() for s in request.get("symbols", [])]

    def _fetch(symbol: str) -> tuple[str, dict]:
        import httpx
        encoded = symbol.replace("^", "%5E")
        price, prev, currency = None, None, "USD"

        # Primary: direct Yahoo Finance API
        for domain in ("query1", "query2"):
            if price:
                break
            try:
                url = f"https://{domain}.finance.yahoo.com/v8/finance/chart/{encoded}?interval=1d&range=5d"
                r = httpx.get(url, headers=_YF_HEADERS, timeout=8, follow_redirects=True)
                if r.status_code == 200:
                    res = r.json()["chart"]["result"][0]
                    closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
                    if closes:
                        price = closes[-1]
                        prev  = closes[-2] if len(closes) >= 2 else None
                        currency = res.get("meta", {}).get("currency", "USD")
            except Exception:
                pass

        # Fallback: yfinance fast_info
        if not price:
            try:
                fi = yf.Ticker(symbol).fast_info
                price    = float(fi.last_price) if fi.last_price else None
                prev     = float(fi.previous_close) if fi.previous_close else None
                currency = fi.currency or "USD"
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
@limiter.limit("6/minute")
async def portfolio_from_screenshot(
    http_request: Request,
    request: dict,
    user_id: str = Depends(get_current_user_id)
):
    image_data = request.get("image", "")
    image_type = request.get("type", "image/jpeg")

    if not image_data:
        return {"positions": [], "error": "No image provided"}

    _PROMPT = (
        "Analiza esta captura de pantalla de un portafolio de inversión y extrae todas las posiciones.\n\n"
        "Devuelve ÚNICAMENTE un JSON array con este formato exacto (sin texto adicional, sin markdown, sin bloques de código):\n"
        '[{"ticker":"AAPL","name":"Apple Inc.","shares":10.5,"avg_price":150.00}]\n\n'
        "CAMPOS REQUERIDOS:\n"
        "- ticker: símbolo bursátil en MAYÚSCULAS\n"
        "- name: nombre de la empresa (usa el ticker si no aparece)\n"
        "- shares: número de acciones/unidades\n"
        "- avg_price: precio promedio de COMPRA por acción — sigue estas reglas EN ORDEN:\n\n"
        "  REGLA 1 — Etiqueta explícita de precio de compra:\n"
        "    Busca: 'P. Prom', 'Precio Prom', 'Precio Promedio', 'Costo Promedio',\n"
        "    'Average Cost', 'Avg Cost', 'Cost Basis per Share', 'Cost Per Share',\n"
        "    'Precio Prom. Compra', 'Avg Price'. Si lo encuentras, úsalo directamente.\n\n"
        "  REGLA 2 — Número grande + número de color (patrón más común en apps móviles):\n"
        "    Muchas apps muestran por posición UN número grande y DEBAJO un número en verde o rojo.\n"
        "    La fórmula exacta para calcular el costo total (precio_compra × acciones) es:\n\n"
        "      SI el número inferior está en VERDE:\n"
        "        costo_total = número_grande + número_verde\n"
        "        avg_price   = costo_total / shares\n"
        "        EJEMPLO: grande=$1,200  verde=+$200  shares=10\n"
        "                 costo = 1200 + 200 = $1,400  →  avg_price = $140.00\n\n"
        "      SI el número inferior está en ROJO:\n"
        "        costo_total = número_grande - número_rojo (usa el valor absoluto del rojo)\n"
        "        avg_price   = costo_total / shares\n"
        "        EJEMPLO: grande=$1,200  rojo=$150  shares=10\n"
        "                 costo = 1200 - 150 = $1,050  →  avg_price = $105.00\n\n"
        "    NUNCA uses el número grande directamente como avg_price.\n"
        "    NUNCA uses el número en color directamente como avg_price.\n\n"
        "  REGLA 3 — Monto invertido total etiquetado:\n"
        "    Si ves 'Monto Invertido', 'Capital invertido' o 'Cost Basis' (total $),\n"
        "    calcula: avg_price = monto_invertido_total / shares\n\n"
        "  REGLA 4 — Sin dato de compra:\n"
        "    Si no puedes calcular el precio de compra con ninguna regla, devuelve null.\n\n"
        "REGLAS GENERALES:\n"
        "- Aplica la Regla 2 a TODAS las posiciones de TODAS las imágenes\n"
        "- Incluye TODAS las posiciones visibles aunque avg_price sea null\n"
        "- Devuelve SOLO el JSON array, sin ningún otro texto"
    )

    def _run_sync(img_data: str, img_type: str) -> dict:
        with _screenshot_sem:
            sc = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            msg = sc.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                messages=[{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": img_type, "data": img_data}},
                    {"type": "text", "text": _PROMPT},
                ]}],
            )
        raw = msg.content[0].text.strip()
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
            if avg_price is None or avg_price == 0:
                price, _ = _fetch_one_index(ticker)
                avg_price = round(price, 4) if price else 0
            result.append({
                "ticker": ticker,
                "name": p.get("name") or ticker,
                "shares": float(p.get("shares") or 0),
                "avg_price": float(avg_price or 0),
            })
        return {"positions": result}

    try:
        return await asyncio.to_thread(_run_sync, image_data, image_type)
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


def _fetch_symbol_news(symbol: str) -> list[dict]:
    """Fetch recent news for a symbol via Yahoo Finance search API."""
    import httpx, time

    encoded = symbol.replace("^", "%5E")
    cutoff  = time.time() - 7 * 86400  # 7 days ago
    results = []

    for domain in ("query1", "query2"):
        try:
            url = (
                f"https://{domain}.finance.yahoo.com/v1/finance/search"
                f"?q={encoded}&newsCount=20&enableFuzzyQuery=false&enableCb=false"
            )
            r = httpx.get(url, headers=_YF_HEADERS, timeout=8, follow_redirects=True)
            if r.status_code != 200:
                continue
            articles = r.json().get("news", [])
            for a in articles:
                ts = a.get("providerPublishTime", 0)
                if ts < cutoff:
                    continue
                thumbnail = None
                resolutions = a.get("thumbnail", {}).get("resolutions", [])
                if resolutions:
                    thumbnail = resolutions[0].get("url")
                results.append({
                    "uuid":      a.get("uuid", ""),
                    "title":     a.get("title", ""),
                    "publisher": a.get("publisher", ""),
                    "url":       a.get("link", ""),
                    "timestamp": ts,
                    "symbol":    symbol,
                    "thumbnail": thumbnail,
                })
            if results:
                break
        except Exception:
            continue

    return results


@router.get("/news")
async def get_portfolio_news(
    symbols: str = Query(..., description="Comma-separated tickers, e.g. AAPL,NVDA"),
    user_id: str = Depends(get_current_user_id)
):
    import asyncio, time

    tickers = [s.strip().upper() for s in symbols.split(",") if s.strip()][:20]
    if not tickers:
        return []

    ck = f"market:news:{','.join(sorted(tickers))}"
    cached = cache_get(ck)
    if cached is not None:
        return cached

    all_articles: list[dict] = []
    seen_uuids: set = set()

    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        results = list(pool.map(_fetch_symbol_news, tickers))

    for articles in results:
        for a in articles:
            if a["uuid"] and a["uuid"] not in seen_uuids:
                seen_uuids.add(a["uuid"])
                all_articles.append(a)

    all_articles.sort(key=lambda x: x["timestamp"], reverse=True)
    cache_set(ck, all_articles, ttl=_NEWS_CACHE_TTL)
    return all_articles
