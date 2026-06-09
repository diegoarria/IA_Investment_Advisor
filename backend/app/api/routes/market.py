import asyncio
import os
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

# ── Optional enrichment API keys ─────────────────────────────────────────────
_FINNHUB_KEY  = os.getenv("FINNHUB_API_KEY", "")
_FMP_KEY      = os.getenv("FMP_API_KEY", "")
_FINNHUB_BASE = "https://finnhub.io/api/v1"
_FMP_BASE     = "https://financialmodelingprep.com/api"
_DETAIL_TTL   = 1800   # 30 min detail cache

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
    encoded = _yf_symbol(symbol).replace("^", "%5E")

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


@router.get("/index-news")
async def get_index_news(
    symbol: str = Query(..., description="Index symbol, e.g. ^GSPC"),
    user_id: str = Depends(get_current_user_id),
):
    import asyncio
    ck = f"market:index-news:{symbol}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    articles = await asyncio.to_thread(_fetch_symbol_news, symbol)
    top3 = sorted(articles, key=lambda x: x.get("timestamp", 0), reverse=True)[:3]
    cache_set(ck, top3, ttl=_NEWS_CACHE_TTL)
    return top3


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
        encoded = _yf_symbol(symbol).replace("^", "%5E")
        price, prev, currency, name = None, None, "USD", symbol

        # Primary: direct Yahoo Finance API
        for domain in ("query1", "query2"):
            if price:
                break
            try:
                url = f"https://{domain}.finance.yahoo.com/v8/finance/chart/{encoded}?interval=1d&range=5d"
                r = httpx.get(url, headers=_YF_HEADERS, timeout=8, follow_redirects=True)
                if r.status_code == 200:
                    res = r.json()["chart"]["result"][0]
                    meta = res.get("meta", {})
                    closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
                    if closes:
                        price = closes[-1]
                        prev  = closes[-2] if len(closes) >= 2 else None
                        currency = meta.get("currency", "USD")
                        name = meta.get("shortName") or meta.get("longName") or symbol
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
            "name":       name,
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


# ── Yahoo Finance v8 direct chart (same data as Google Finance) ───────────────

_YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://finance.yahoo.com",
    "Referer": "https://finance.yahoo.com/",
}

_CHART_PERIOD_MAP = {
    "1d":  ("1d",  "5m"),
    "5d":  ("5d",  "15m"),
    "1m":  ("1mo", "1d"),
    "3m":  ("3mo", "1d"),
    "6m":  ("6mo", "1wk"),
    "ytd": ("ytd", "1wk"),
    "1y":  ("1y",  "1wk"),
    "5y":  ("5y",  "1mo"),
    "max": ("max", "3mo"),
}

def _yf_v8_chart(symbol: str, yf_range: str, interval: str) -> dict | None:
    """Call Yahoo Finance v8 chart API directly — same source as Google Finance."""
    try:
        r = _requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"interval": interval, "range": yf_range, "includePrePost": "false"},
            headers=_YF_HEADERS,
            timeout=10,
        )
        if r.status_code != 200:
            # try query2 mirror
            r = _requests.get(
                f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}",
                params={"interval": interval, "range": yf_range, "includePrePost": "false"},
                headers=_YF_HEADERS,
                timeout=10,
            )
        if r.status_code != 200:
            return None
        data   = r.json()
        result = (data.get("chart") or {}).get("result") or []
        if not result:
            return None
        chart      = result[0]
        meta       = chart.get("meta") or {}
        timestamps = chart.get("timestamp") or []
        quotes     = (chart.get("indicators") or {}).get("quote") or [{}]
        closes     = quotes[0].get("close") or []
        pairs      = [(ts, c) for ts, c in zip(timestamps, closes) if c is not None and ts is not None]
        if not pairs:
            return None
        ts_list, price_list = zip(*pairs)
        from datetime import datetime, timezone as _tz
        intraday = interval in ("1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h")
        date_strs = [
            datetime.fromtimestamp(int(t), tz=_tz.utc).strftime("%Y-%m-%d %H:%M" if intraday else "%Y-%m-%d")
            for t in ts_list
        ]
        prices      = [round(float(p), 2) for p in price_list]
        current     = round(float(meta.get("regularMarketPrice") or prices[-1]), 2)
        prev_close  = round(float(meta.get("chartPreviousClose") or meta.get("previousClose") or prices[0]), 2)
        name        = meta.get("longName") or meta.get("shortName") or symbol
        change_pct  = round((current - prev_close) / prev_close * 100, 2) if prev_close else 0
        return {"name": name, "prices": prices, "timestamps": date_strs,
                "current_price": current, "change_pct": change_pct}
    except Exception:
        return None


def _finnhub_candles(symbol: str, resolution: str, from_ts: int, to_ts: int) -> dict | None:
    """Finnhub candle data — real-time, no delay on US stocks."""
    if not _FINNHUB_KEY:
        return None
    try:
        r = _requests.get(
            f"{_FINNHUB_BASE}/stock/candle",
            params={"symbol": symbol, "resolution": resolution,
                    "from": from_ts, "to": to_ts, "token": _FINNHUB_KEY},
            timeout=8,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        if data.get("s") != "ok":
            return None
        closes, tss = data.get("c", []), data.get("t", [])
        if not closes:
            return None
        from datetime import datetime, timezone as _tz
        date_strs = [datetime.fromtimestamp(t, tz=_tz.utc).strftime("%Y-%m-%d") for t in tss]
        prices    = [round(float(p), 2) for p in closes]
        current   = prices[-1]
        change_pct = round((current - prices[0]) / prices[0] * 100, 2) if prices[0] else 0
        return {"prices": prices, "timestamps": date_strs,
                "current_price": current, "change_pct": change_pct}
    except Exception:
        return None


def _yfinance_chart_fallback(symbol: str, yf_period: str, interval: str) -> dict | None:
    """yfinance as last-resort fallback."""
    try:
        t    = yf.Ticker(symbol)
        hist = t.history(period=yf_period, interval=interval, raise_errors=False)
        if hist is None or hist.empty:
            return None
        prices     = [round(float(p), 2) for p in hist["Close"].dropna().tolist()]
        timestamps = [str(idx.date()) if hasattr(idx, "date") else str(idx)[:10] for idx in hist.index]
        if not prices:
            return None
        try:
            current = round(float(t.fast_info.last_price), 2)
        except Exception:
            current = prices[-1]
        name = (t.info or {}).get("shortName") or symbol
        change_pct = round((prices[-1] - prices[0]) / prices[0] * 100, 2) if prices[0] else 0
        return {"name": name, "prices": prices, "timestamps": timestamps,
                "current_price": current, "change_pct": change_pct}
    except Exception:
        return None


@router.get("/chart/{ticker}")
async def get_chart(
    ticker: str,
    period: str = "1y",
    user_id: str = Depends(get_current_user_id),
):
    sym = ticker.upper().strip()
    cache_key = f"chart3:{sym}:{period}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    yf_range, interval = _CHART_PERIOD_MAP.get(period, ("1y", "1wk"))

    def _fetch() -> dict | None:
        import time as _time

        # ── 1. Finnhub candles (real-time, most reliable when key is set) ──
        if _FINNHUB_KEY and period not in ("max",):
            now_ts = int(_time.time())
            range_secs = {
                "1d": 86400, "5d": 5*86400, "1m": 30*86400,
                "3m": 90*86400, "6m": 180*86400, "ytd": 365*86400,
                "1y": 365*86400, "5y": 5*365*86400,
            }
            fh_resolution = {"1d": "5", "5d": "15", "1m": "D", "3m": "D",
                             "6m": "W", "ytd": "W", "1y": "W", "5y": "M"}.get(period, "W")
            from_ts = now_ts - range_secs.get(period, 365*86400)
            result  = _finnhub_candles(sym, fh_resolution, from_ts, now_ts)
            if result:
                return result

        # ── 2. Yahoo Finance v8 direct API (Google Finance underlying source) ──
        result = _yf_v8_chart(sym, yf_range, interval)
        if result:
            return result

        # ── 3. yfinance wrapper fallback ──
        return _yfinance_chart_fallback(sym, yf_range, interval)

    result = await asyncio.to_thread(_fetch)
    if not result:
        return {"error": "No data available", "ticker": sym, "prices": [], "timestamps": [], "change_pct": 0}

    payload = {"ticker": sym, "period": period, **result}
    ttl = 60 if period == "1d" else 300 if period in ("5d", "1m") else 900
    cache_set(cache_key, payload, ttl=ttl)
    return payload


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
@limiter.limit("20/minute")
async def portfolio_from_screenshot(
    request: Request,
    body: dict,
    user_id: str = Depends(get_current_user_id)
):
    import base64 as _b64

    image_data = body.get("image", "")
    image_type = body.get("type", "image/jpeg")

    if not image_data:
        return {"positions": [], "error": "No image provided"}

    # Normalize image type — Claude only accepts jpeg, png, gif, webp
    _TYPE_MAP = {
        "image/jpg": "image/jpeg",
        "image/heic": "image/jpeg",
        "image/heif": "image/jpeg",
        "image/tiff": "image/jpeg",
        "image/bmp": "image/jpeg",
    }
    image_type = _TYPE_MAP.get(image_type.lower(), image_type)
    if image_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        image_type = "image/jpeg"

    _SYSTEM = """Eres un experto en visión por computadora especializado en extraer datos de portafolios de inversión de capturas de pantalla. Tu tarea es extraer TODOS los activos visibles y devolver un JSON estructurado. Analizas cualquier app: Robinhood, Fidelity, GBM+, Interactive Brokers, Schwab, TD Ameritrade, E*Trade, Webull, eToro, Degiro, Trading212, Kuspit, Bursanet, Bitso, Nu Invest, y cualquier otra app de inversión en cualquier idioma."""

    _PROMPT = """Analiza esta imagen de un portafolio de inversión y extrae TODAS las posiciones visibles.

Responde ÚNICAMENTE con un JSON array con este formato exacto (sin texto adicional, sin markdown):
[{"ticker":"AAPL","name":"Apple Inc.","shares":10.5,"avg_price":150.00,"current_price":187.50,"gain_loss_pct":25.0}]

CAMPOS:
- ticker: símbolo bursátil en MAYÚSCULAS (BTC-USD, ETH-USD para cripto)
- name: nombre de la empresa/activo (usa ticker si no aparece)
- shares: cantidad exacta de unidades (acepta decimales)
- avg_price: precio promedio de COMPRA por unidad (ver cálculo abajo)
- current_price: precio actual por unidad (null si no visible)
- gain_loss_pct: porcentaje de ganancia/pérdida (null si no visible)

CÓMO CALCULAR avg_price (en orden de prioridad):
1. Si ves etiquetas como "Precio Prom", "Avg Cost", "Average Cost", "Cost Per Share", "Preço Médio", "P.M." → usa ese número directamente
2. Si ves valor_total_mercado y ganancia/pérdida en color:
   - Verde/positivo: avg_price = (valor_mercado - ganancia) / shares
   - Rojo/negativo: avg_price = (valor_mercado + pérdida_absoluta) / shares
3. Si ves % de retorno y valor actual: avg_price = (valor_actual / (1 + pct/100)) / shares
4. Si ves "Invertido" o "Cost Basis" total: avg_price = monto_total / shares
5. Si no puedes calcular: avg_price = 0

NOTAS IMPORTANTES:
- En apps latinoamericanas: el punto puede ser separador de miles (1.234,56 = 1234.56)
- Incluye TODAS las posiciones visibles sin excepción
- Acciones fraccionadas son válidas (0.5 acciones, 0.00234 BTC)
- Si la lista está cortada, extrae las posiciones que SÍ están visibles
- Responde SOLO el JSON array, nada más"""

    def _extract_json(text: str) -> list:
        """Robustly extract JSON array from model response."""
        text = text.strip()
        # Remove markdown code blocks
        if "```" in text:
            import re
            match = re.search(r"```(?:json)?\s*(\[[\s\S]*?\])\s*```", text)
            if match:
                text = match.group(1)
        # Find JSON array boundaries
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end > start:
            text = text[start:end+1]
        return json.loads(text)

    def _call_claude(img_data: str, img_type: str, use_thinking: bool) -> list:
        sc = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        kwargs: dict = {
            "model": "claude-opus-4-8",
            "max_tokens": 16000 if use_thinking else 4096,
            "system": _SYSTEM,
            "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": img_type, "data": img_data}},
                {"type": "text", "text": _PROMPT},
            ]}],
        }
        if use_thinking:
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": 8000}

        msg = sc.messages.create(**kwargs)

        # Extract text from response (handles both thinking and non-thinking responses)
        raw = ""
        for block in msg.content:
            if hasattr(block, "type") and block.type == "text":
                raw = block.text
                break
        if not raw:
            raw = str(msg.content[0]) if msg.content else ""
        return _extract_json(raw)

    def _run_sync(img_data: str, img_type: str) -> dict:
        with _screenshot_sem:
            positions_raw = None
            last_error = None

            # Try with extended thinking first (most accurate)
            try:
                positions_raw = _call_claude(img_data, img_type, use_thinking=True)
            except Exception as e:
                last_error = str(e)
                # Fallback: try without thinking (broader SDK compatibility)
                try:
                    positions_raw = _call_claude(img_data, img_type, use_thinking=False)
                except Exception as e2:
                    last_error = str(e2)

            if positions_raw is None:
                return {"positions": [], "error": last_error or "Error al procesar la imagen"}

            result = []
            for p in positions_raw:
                ticker = str(p.get("ticker") or "").strip().upper()
                if not ticker:
                    continue
                avg_price = p.get("avg_price")
                result.append({
                    "ticker": ticker,
                    "name": p.get("name") or ticker,
                    "shares": float(p.get("shares") or 0),
                    "avg_price": float(avg_price) if avg_price else 0,
                })
            return {"positions": result}

    try:
        return await asyncio.to_thread(_run_sync, image_data, image_type)
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

    encoded = _yf_symbol(symbol).replace("^", "%5E")
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
                    best = max(resolutions, key=lambda r: r.get("width", 0))
                    thumbnail = best.get("url")
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


# ── Portfolio period returns ────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel
from datetime import datetime as _dt, timedelta as _td, timezone as _tz
from typing import Optional as _Opt
import pandas as _pd

class _PortfolioReturnsItem(_BaseModel):
    ticker: str
    shares: float
    purchase_date: _Opt[str] = None  # "YYYY-MM-DD"
    avg_price: _Opt[float] = None    # precio de compra promedio por acción

class _PortfolioReturnsRequest(_BaseModel):
    positions: list[_PortfolioReturnsItem]


def _infer_purchase_date(ticker: str, avg_price: float, close_df: "_pd.DataFrame") -> "_Opt[str]":
    """Find the most recent date where closing price was within 5% of avg_price."""
    if ticker not in close_df.columns or avg_price <= 0:
        return None
    series = close_df[ticker].dropna()
    if series.empty:
        return None
    diffs = (series - avg_price).abs()
    tolerance = avg_price * 0.05
    candidates = diffs[diffs <= tolerance]
    if candidates.empty:
        tolerance = avg_price * 0.15
        candidates = diffs[diffs <= tolerance]
    best_idx = candidates.index[-1] if not candidates.empty else diffs.idxmin()
    try:
        return str(best_idx.date())
    except Exception:
        return str(best_idx)[:10]

def _safe_price(row, ticker: str) -> float:
    """Safely extract a price from a pandas Series row."""
    try:
        val = row[ticker]
        if _pd.isna(val):
            return 0.0
        return float(val)
    except Exception:
        return 0.0


def _yf_symbol(ticker: str) -> str:
    """Normalize ticker for Yahoo Finance: BRK.B → BRK-B (dots become hyphens)."""
    return ticker.replace(".", "-")


def _fetch_ticker_history(
    ticker: str, period1: int, period2: int, interval: str = "1d"
) -> tuple[list[int], list[float]]:
    """Fetch historical adjusted-close prices via Yahoo Finance Chart API (same endpoint as getPrices)."""
    import httpx
    encoded = _yf_symbol(ticker).replace("^", "%5E")
    params = {"period1": period1, "period2": period2, "interval": interval, "includePrePost": "false"}
    for domain in ("query1", "query2"):
        try:
            r = httpx.get(
                f"https://{domain}.finance.yahoo.com/v8/finance/chart/{encoded}",
                headers=_YF_HEADERS, params=params, timeout=20, follow_redirects=True,
            )
            if r.status_code != 200:
                continue
            res = r.json()["chart"]["result"][0]
            ts = res.get("timestamp") or []
            # Prefer adjclose (accounts for splits + dividends)
            ac = (res.get("indicators", {}).get("adjclose") or [])
            closes = ac[0].get("adjclose") if ac else None
            if not closes:
                closes = (res.get("indicators", {}).get("quote") or [{}])[0].get("close")
            if ts and closes and len(ts) == len(closes):
                return ts, closes
        except Exception:
            continue
    return [], []


def _build_close_df(
    tickers: list[str], period1: int, period2: int, interval: str = "1d"
) -> "_pd.DataFrame":
    """Parallel fetch of historical close prices via direct Yahoo Finance API. Index is timezone-naive."""
    from concurrent.futures import ThreadPoolExecutor

    def _one(t: str) -> tuple[str, "_pd.Series | None"]:
        ts, closes = _fetch_ticker_history(t, period1, period2, interval)
        if not ts:
            return t, None
        pairs = [
            (_pd.Timestamp(s, unit="s").normalize(), float(c))
            for s, c in zip(ts, closes) if c is not None
        ]
        if not pairs:
            return t, None
        dates, vals = zip(*pairs)
        return t, _pd.Series(list(vals), index=list(dates), name=t, dtype=float)

    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        results = list(pool.map(_one, tickers))

    series = [s for _, s in results if s is not None]
    if not series:
        return _pd.DataFrame()
    return _pd.concat(series, axis=1).ffill().dropna(how="all")


def _build_close_df_range(
    tickers: list[str], range_str: str, interval: str = "1h"
) -> "_pd.DataFrame":
    """Fetch short-range intraday data (1d, 5d) via Yahoo Finance range parameter."""
    import httpx
    from concurrent.futures import ThreadPoolExecutor

    def _one(t: str) -> tuple[str, "_pd.Series | None"]:
        encoded = _yf_symbol(t).replace("^", "%5E")
        params = {"range": range_str, "interval": interval, "includePrePost": "false"}
        for domain in ("query1", "query2"):
            try:
                r = httpx.get(
                    f"https://{domain}.finance.yahoo.com/v8/finance/chart/{encoded}",
                    headers=_YF_HEADERS, params=params, timeout=15, follow_redirects=True,
                )
                if r.status_code != 200:
                    continue
                res = r.json()["chart"]["result"][0]
                ts = res.get("timestamp") or []
                closes = (res.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
                pairs = [(s, float(c)) for s, c in zip(ts, closes) if c is not None]
                if pairs:
                    dates, vals = zip(*pairs)
                    return t, _pd.Series(list(vals), index=[_pd.Timestamp(d, unit="s") for d in dates], name=t)
            except Exception:
                continue
        return t, None

    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        results = list(pool.map(_one, tickers))

    series = [s for _, s in results if s is not None]
    if not series:
        return _pd.DataFrame()
    return _pd.concat(series, axis=1).ffill().dropna(how="all")


def _compute_portfolio_returns(positions: list[_PortfolioReturnsItem]) -> dict:
    if not positions:
        return {}

    tickers = [p.ticker.upper() for p in positions]
    shares_map = {p.ticker.upper(): p.shares for p in positions}
    avg_price_map = {p.ticker.upper(): p.avg_price for p in positions if p.avg_price and p.avg_price > 0}
    purchase_date_map = {p.ticker.upper(): p.purchase_date for p in positions if p.purchase_date}

    today = _dt.now()
    # Include SPY as benchmark
    all_tickers = list(dict.fromkeys(tickers + ["SPY"]))

    # Fetch 5+ years via direct Yahoo Finance Chart API (same as getPrices — guaranteed to work)
    today_ts = int(today.timestamp())
    start_ts = int((today - _td(days=1835)).timestamp())
    close = _build_close_df(all_tickers, start_ts, today_ts, interval="1d")

    # Infer purchase dates for positions that have avg_price but no purchase_date
    inferred_dates: dict[str, str] = {}
    for t in tickers:
        if t not in purchase_date_map and t in avg_price_map and t in close.columns:
            inferred = _infer_purchase_date(t, avg_price_map[t], close)
            if inferred:
                purchase_date_map[t] = inferred
                inferred_dates[t] = inferred

    if close.empty:
        return {}

    # Bail if none of the user's tickers returned data
    if not any(t in close.columns for t in tickers):
        return {}

    # Ensure all portfolio tickers are present (SPY might be missing in some envs)
    missing = [t for t in tickers if t not in close.columns]
    if missing == tickers:   # none of the user tickers found — bail
        return {}

    current_row = close.iloc[-1]
    current_val = sum(
        shares_map.get(t, 0) * _safe_price(current_row, t)
        for t in tickers if t in close.columns
    )
    if current_val <= 0:
        return {}

    spy_current = _safe_price(current_row, "SPY") if "SPY" in close.columns else 0.0

    # All cutoffs use timezone-naive today (index is also timezone-naive from _build_close_df)
    ytd_start = _pd.Timestamp(f"{today.year}-01-01")

    PERIODS: list[tuple[str, _td | None]] = [
        ("1d",  _td(days=2)),
        ("5d",  _td(days=8)),
        ("1mo", _td(days=35)),
        ("3mo", _td(days=95)),
        ("6mo", _td(days=185)),
        ("ytd", None),
        ("1y",  _td(days=370)),
        ("3y",  _td(days=1100)),
        ("5y",  _td(days=1835)),
    ]

    results: dict[str, dict] = {}

    # "Desde compra" — weighted by each position's individual purchase date
    if purchase_date_map:
        try:
            total_cost = 0.0; total_gain = 0.0
            breakdown: dict[str, float] = {}
            oldest_date_str: _Opt[str] = None
            spy_start_buy = 0.0

            for t in tickers:
                pd_str = purchase_date_map.get(t)
                if not pd_str or t not in close.columns:
                    continue
                cutoff = _pd.Timestamp(pd_str)
                subset = close[close.index >= cutoff]
                if subset.empty:
                    continue
                # Use avg_price (real cost paid) when available — more accurate than historical close
                sp = avg_price_map.get(t) or _safe_price(subset.iloc[0], t)
                cp = _safe_price(current_row, t)
                if sp > 0 and cp > 0:
                    shares = shares_map.get(t, 0)
                    total_cost += shares * sp
                    total_gain += shares * (cp - sp)
                    breakdown[t] = round((cp - sp) / sp * 100, 2)
                    if oldest_date_str is None or pd_str < oldest_date_str:
                        oldest_date_str = pd_str
                        if "SPY" in close.columns:
                            spy_start_buy = _safe_price(subset.iloc[0], "SPY")

            if total_cost > 0:
                spy_pct_buy = round((spy_current - spy_start_buy) / spy_start_buy * 100, 2) if spy_start_buy > 0 else None
                avg_pct = round(sum(breakdown.values()) / len(breakdown), 2) if breakdown else None
                results["since_purchase"] = {
                    "pct": round(total_gain / total_cost * 100, 2),
                    "avg_pct": avg_pct,
                    "amount": round(total_gain, 2),
                    "date": oldest_date_str,
                    "breakdown": breakdown,
                    **({"spy_pct": spy_pct_buy} if spy_pct_buy is not None else {}),
                }
        except Exception:
            pass

    for key, delta in PERIODS:
        try:
            if key == "ytd":
                cutoff = ytd_start
            else:
                cutoff = _pd.Timestamp(today - delta)

            subset = close[close.index >= cutoff]
            if subset.empty:
                continue

            start_row = subset.iloc[0]

            # For each position, use its own cost basis:
            # - Bought BEFORE period start → price at period start (normal)
            # - Bought AFTER period start  → avg_price paid (only counts from purchase)
            # For 1D/5D: ALWAYS use period-start price — avg_price as cost basis
            # only makes sense for longer periods where a position clearly didn't exist.
            short_period = key in ("1d", "5d")
            start_cost = 0.0
            end_value  = 0.0
            breakdown  = {}
            for t in tickers:
                if t not in close.columns:
                    continue
                shares = shares_map.get(t, 0)
                cp = _safe_price(current_row, t)
                pd_str = purchase_date_map.get(t)
                if not short_period and pd_str and _pd.Timestamp(pd_str) > cutoff:
                    # Bought mid-period (only for periods > 5D): cost is what we actually paid
                    sp = avg_price_map.get(t) or _safe_price(
                        close[close.index >= _pd.Timestamp(pd_str)].iloc[0], t
                    )
                else:
                    # Use price at start of period (always for 1D/5D)
                    sp = _safe_price(start_row, t)
                if sp > 0 and cp > 0:
                    start_cost += shares * sp
                    end_value  += shares * cp
                    breakdown[t] = round((cp - sp) / sp * 100, 2)

            if start_cost <= 0:
                continue

            # SPY benchmark (always from period start, independent of positions)
            spy_pct = None
            if spy_current > 0 and "SPY" in close.columns:
                spy_start = _safe_price(start_row, "SPY")
                if spy_start > 0:
                    spy_pct = round((spy_current - spy_start) / spy_start * 100, 2)

            results[key] = {
                "pct":    round((end_value - start_cost) / start_cost * 100, 2),
                "amount": round(end_value - start_cost, 2),
                "breakdown": breakdown,
                **({"spy_pct": spy_pct} if spy_pct is not None else {}),
            }
        except Exception:
            continue

    return results, inferred_dates


@router.post("/portfolio-returns")
async def get_portfolio_returns(
    body: _PortfolioReturnsRequest,
    user_id: str = Depends(get_current_user_id),
):
    data, inferred_dates = await asyncio.to_thread(_compute_portfolio_returns, body.positions)
    return {"returns": data, "inferred_dates": inferred_dates}


# ─── Portfolio historical chart ───────────────────────────────────────────────

class _PortfolioChartRequest(_BaseModel):
    positions: list[_PortfolioReturnsItem]
    period: str = "1y"  # "1d","5d","1mo","3mo","6mo","ytd","1y","3y","5y","max","since_purchase"


def _compute_portfolio_chart(positions: list[_PortfolioReturnsItem], period: str) -> dict:
    if not positions:
        return {"history": []}

    tickers = [p.ticker.upper() for p in positions]
    shares_map = {p.ticker.upper(): p.shares for p in positions}
    avg_price_map = {p.ticker.upper(): p.avg_price for p in positions if p.avg_price and p.avg_price > 0}
    purchase_date_map = {p.ticker.upper(): p.purchase_date for p in positions if p.purchase_date}

    today = _dt.now()
    today_ts = int(today.timestamp())

    # Pre-fetch 5y to infer purchase dates from avg_price before deciding chart range
    if any(t not in purchase_date_map and t in avg_price_map for t in tickers):
        all_tickers_inf = list(dict.fromkeys(tickers))
        start_inf = int((today - _td(days=1835)).timestamp())
        close_inf = _build_close_df(all_tickers_inf, start_inf, today_ts, interval="1d")
        for t in tickers:
            if t not in purchase_date_map and t in avg_price_map and t in close_inf.columns:
                inferred = _infer_purchase_date(t, avg_price_map[t], close_inf)
                if inferred:
                    purchase_date_map[t] = inferred

    # Use direct Yahoo Finance API — same as getPrices (guaranteed to work)
    if period in ("1d", "5d"):
        range_str = "2d" if period == "1d" else "5d"
        close = _build_close_df_range(tickers, range_str, interval="1h")
        intraday = True
    elif period == "since_purchase":
        if not purchase_date_map:
            return {"history": []}
        oldest_str = min(v for v in purchase_date_map.values() if v)
        try:
            oldest_dt = _dt.fromisoformat(oldest_str)
            days_held = (today - oldest_dt).days
            interval = "1wk" if days_held > 1800 else "1d"
        except Exception:
            interval = "1d"
        start_ts = int(_dt.fromisoformat(oldest_str).timestamp())
        close = _build_close_df(tickers, start_ts, today_ts, interval=interval)
        intraday = False
    else:
        PERIOD_CFG: dict[str, tuple[int, str]] = {
            "1mo": (35,   "1d"),
            "3mo": (95,   "1d"),
            "6mo": (185,  "1d"),
            "ytd": (0,    "1d"),   # days=0 handled below
            "1y":  (370,  "1d"),
            "3y":  (1100, "1wk"),
            "5y":  (1835, "1wk"),
            "max": (9999, "1mo"),
        }
        days_back, interval = PERIOD_CFG.get(period, (370, "1d"))
        if period == "ytd":
            start_ts = int(_dt(today.year, 1, 1).timestamp())
        elif period == "max":
            start_ts = int(_dt(1993, 1, 1).timestamp())
        else:
            start_ts = int((today - _td(days=days_back)).timestamp())
        close = _build_close_df(tickers, start_ts, today_ts, interval=interval)
        intraday = False

    if close is None or close.empty:
        return {"history": []}

    if not any(t in close.columns for t in tickers):
        return {"history": []}

    # For 1D: keep only today's session (or last trading day)
    if period == "1d":
        today_str = today.strftime("%Y-%m-%d")
        mask = [str(idx)[:10] == today_str for idx in close.index]
        if any(mask):
            close = close.iloc[[i for i, m in enumerate(mask) if m]]
        elif len(close) > 0:
            last_day = str(close.index[-1])[:10]
            close = close.iloc[[i for i, idx in enumerate(close.index) if str(idx)[:10] == last_day]]

    if close.empty or len(close) < 2:
        return {"history": []}

    # Build portfolio value time series — each position only counts from its own purchase date
    fmt = "%Y-%m-%d %H:%M" if intraday else "%Y-%m-%d"
    purchase_ts_map = {
        t: _pd.Timestamp(pd_str)
        for t, pd_str in purchase_date_map.items()
        if pd_str
    }
    history: list[dict] = []
    for idx, row in close.iterrows():
        val = 0.0
        for t in tickers:
            if t not in close.columns:
                continue
            # Skip if position wasn't purchased yet at this date
            if t in purchase_ts_map and idx < purchase_ts_map[t]:
                continue
            val += shares_map.get(t, 0) * _safe_price(row, t)
        if val > 0:
            try:
                date_str = idx.strftime(fmt)
            except Exception:
                date_str = str(idx)[:16]
            history.append({"date": date_str, "value": round(val, 2)})

    if len(history) < 2:
        return {"history": []}

    start_val = history[0]["value"]
    end_val   = history[-1]["value"]

    if period == "since_purchase":
        # Base = what you actually paid for all positions
        total_cost = sum(
            shares_map.get(t, 0) * avg_price_map[t]
            for t in tickers if t in avg_price_map
        )
        base = total_cost if total_cost > 0 else start_val
    else:
        # For other periods: base = start_val + cost of positions bought mid-period.
        # history[0] only includes positions held at period start, so mid-period
        # purchases aren't in the denominator — we add their cost to fix this.
        first_chart_ts = close.index[0] if len(close) > 0 else None
        extra_cost = 0.0
        if first_chart_ts is not None:
            for t, ts in purchase_ts_map.items():
                if ts > first_chart_ts and avg_price_map.get(t):
                    extra_cost += shares_map.get(t, 0) * avg_price_map[t]
        base = (start_val + extra_cost) if (start_val + extra_cost) > 0 else start_val

    for h in history:
        h["pct"] = round((h["value"] - base) / base * 100, 4) if base > 0 else 0.0

    period_pct    = round((end_val - base) / base * 100, 2) if base > 0 else 0.0
    period_amount = round(end_val - base, 2)

    return {
        "history": history,
        "period_pct": period_pct,
        "period_amount": period_amount,
        "inferred_dates": {t: purchase_date_map[t] for t in tickers if t in purchase_date_map},
    }


@router.post("/portfolio-chart")
async def get_portfolio_chart(
    body: _PortfolioChartRequest,
    user_id: str = Depends(get_current_user_id),
):
    data = await asyncio.to_thread(_compute_portfolio_chart, body.positions, body.period)
    return data


_QUOTE_DETAILS_TTL = 120  # 2 min cache

_YF_HEADERS_QUOTE = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://finance.yahoo.com/",
}


def _fetch_quote_details(tickers: list[str]) -> dict[str, dict]:
    """Batch-fetch extended quote data via Yahoo Finance v7 quote API."""
    if not tickers:
        return {}

    # Check cache first
    missing = []
    cached: dict[str, dict] = {}
    for t in tickers:
        hit = cache_get(f"qdetail:{t}")
        if hit:
            cached[t] = hit
        else:
            missing.append(t)

    if not missing:
        return cached

    results: dict[str, dict] = dict(cached)

    # Batch request via Yahoo Finance v7
    import httpx
    symbols_str = ",".join(t.replace(".", "-") for t in missing)
    fields = (
        "regularMarketPrice,regularMarketChangePercent,"
        "regularMarketVolume,marketCap,trailingPE,forwardPE,"
        "fiftyTwoWeekLow,fiftyTwoWeekHigh,"
        "preMarketPrice,preMarketChangePercent,"
        "postMarketPrice,postMarketChangePercent,"
        "marketState,earningsTimestamp"
    )

    for domain in ("query1", "query2"):
        try:
            url = f"https://{domain}.finance.yahoo.com/v7/finance/quote"
            r = httpx.get(
                url,
                params={"symbols": symbols_str, "fields": fields},
                headers=_YF_HEADERS_QUOTE,
                timeout=10,
                follow_redirects=True,
            )
            if r.status_code != 200:
                continue
            quotes = r.json().get("quoteResponse", {}).get("result") or []

            for q in quotes:
                sym = q.get("symbol", "").replace("-", ".")
                price = q.get("regularMarketPrice")
                wk52lo = q.get("fiftyTwoWeekLow")

                # % above 52-week low
                w52_pct = None
                if price and wk52lo and wk52lo > 0:
                    w52_pct = round((price - wk52lo) / wk52lo * 100, 2)

                # earnings date from timestamp
                earnings_ts = q.get("earningsTimestamp")
                earnings_date = None
                if earnings_ts:
                    try:
                        from datetime import datetime, timezone
                        earnings_date = datetime.fromtimestamp(
                            earnings_ts, tz=timezone.utc
                        ).strftime("%Y-%m-%d")
                    except Exception:
                        pass

                # pre vs post
                mstate = (q.get("marketState") or "").upper()
                ext_price, ext_pct, ext_label = None, None, None
                if mstate in ("PRE", "PREPRE"):
                    ext_price = q.get("preMarketPrice")
                    ext_pct   = q.get("preMarketChangePercent")
                    ext_label = "Pre"
                elif mstate in ("POST", "POSTPOST", "CLOSED"):
                    ext_price = q.get("postMarketPrice")
                    ext_pct   = q.get("postMarketChangePercent")
                    ext_label = "Post"

                entry = {
                    "volume":        q.get("regularMarketVolume"),
                    "market_cap":    q.get("marketCap"),
                    "pe":            q.get("trailingPE") or q.get("forwardPE"),
                    "week_52_low":   wk52lo,
                    "week_52_high":  q.get("fiftyTwoWeekHigh"),
                    "week_52_pct":   w52_pct,
                    "earnings_date": earnings_date,
                    "ext_price":     round(float(ext_price), 4) if ext_price else None,
                    "ext_pct":       round(float(ext_pct), 2) if ext_pct else None,
                    "ext_label":     ext_label,
                }
                results[sym] = entry
                cache_set(f"qdetail:{sym}", entry, ttl=_QUOTE_DETAILS_TTL)

            # Fill any still-missing with empty entry
            for t in missing:
                if t not in results:
                    results[t] = {}
            break
        except Exception:
            continue

    return results


@router.get("/quote-details")
async def get_quote_details(
    symbols: str = "",
    user_id: str = Depends(get_current_user_id),
):
    """Extended quote data: volume, market cap, P/E, 52-week range, earnings date."""
    tickers = [s.strip().upper() for s in symbols.split(",") if s.strip()][:30]
    if not tickers:
        return {}
    data = await asyncio.to_thread(_fetch_quote_details, tickers)
    return data


# ─── Stock Detail ──────────────────────────────────────────────────────────────

_DETAIL_TTL = 1800  # 30 min


def _fmt_number(v) -> float | None:
    try:
        f = float(v)
        return None if (f != f) else round(f, 4)  # NaN check
    except Exception:
        return None


def _df_to_periods(df, rows: list[str], limit: int = 5) -> list[dict]:
    """Convert a yfinance financial DataFrame to a list of period dicts."""
    if df is None or df.empty:
        return []
    results = []
    for col in df.columns:
        try:
            period = str(col.date()) if hasattr(col, "date") else str(col)[:10]
        except Exception:
            period = str(col)[:10]
        entry = {"period": period}
        for row in rows:
            val = None
            if row in df.index:
                val = _fmt_number(df.loc[row, col])
            else:
                matches = [i for i in df.index if row.lower() in str(i).lower()]
                if matches:
                    val = _fmt_number(df.loc[matches[0], col])
            entry[row] = val
        results.append(entry)
    return results[:limit]


# ── FMP helpers ───────────────────────────────────────────────────────────────

def _fmp_income(symbol: str) -> list[dict]:
    """Fetch income statements from FMP (10 years)."""
    try:
        r = _requests.get(
            f"{_FMP_BASE}/v3/income-statement/{symbol}",
            params={"limit": 10, "apikey": _FMP_KEY},
            timeout=8,
        )
        data = r.json() if r.status_code == 200 else []
        result = []
        for d in data:
            result.append({
                "period":        d.get("date", "")[:7],
                "Total Revenue": _fmt_number(d.get("revenue")),
                "Gross Profit":  _fmt_number(d.get("grossProfit")),
                "Operating Income": _fmt_number(d.get("operatingIncome")),
                "EBITDA":        _fmt_number(d.get("ebitda")),
                "Net Income":    _fmt_number(d.get("netIncome")),
                "Diluted EPS":   _fmt_number(d.get("epsdiluted")),
            })
        return result
    except Exception:
        return []


def _fmp_balance(symbol: str) -> list[dict]:
    try:
        r = _requests.get(
            f"{_FMP_BASE}/v3/balance-sheet-statement/{symbol}",
            params={"limit": 10, "apikey": _FMP_KEY},
            timeout=8,
        )
        data = r.json() if r.status_code == 200 else []
        result = []
        for d in data:
            result.append({
                "period":        d.get("date", "")[:7],
                "Total Assets":  _fmt_number(d.get("totalAssets")),
                "Current Assets":_fmt_number(d.get("totalCurrentAssets")),
                "Cash And Cash Equivalents": _fmt_number(d.get("cashAndCashEquivalents")),
                "Total Debt":    _fmt_number(d.get("totalDebt")),
                "Total Liabilities Net Minority Interest": _fmt_number(d.get("totalLiabilities")),
                "Stockholders Equity": _fmt_number(d.get("totalStockholdersEquity")),
            })
        return result
    except Exception:
        return []


def _fmp_cashflow(symbol: str) -> list[dict]:
    try:
        r = _requests.get(
            f"{_FMP_BASE}/v3/cash-flow-statement/{symbol}",
            params={"limit": 10, "apikey": _FMP_KEY},
            timeout=8,
        )
        data = r.json() if r.status_code == 200 else []
        result = []
        for d in data:
            result.append({
                "period":        d.get("date", "")[:7],
                "Operating Cash Flow": _fmt_number(d.get("operatingCashFlow")),
                "Capital Expenditure": _fmt_number(d.get("capitalExpenditure")),
                "Free Cash Flow":      _fmt_number(d.get("freeCashFlow")),
                "Dividends Paid":      _fmt_number(d.get("dividendsPaid")),
            })
        return result
    except Exception:
        return []


def _fmp_analyst(symbol: str) -> dict:
    """Analyst recommendations + price targets from FMP."""
    try:
        rt = _requests.get(
            f"{_FMP_BASE}/v3/price-target-consensus/{symbol}",
            params={"apikey": _FMP_KEY},
            timeout=5,
        )
        pt = (rt.json() or [{}])[0] if rt.status_code == 200 else {}

        rr = _requests.get(
            f"{_FMP_BASE}/v3/analyst-stock-recommendations/{symbol}",
            params={"limit": 10, "apikey": _FMP_KEY},
            timeout=5,
        )
        recs = rr.json() if rr.status_code == 200 else []

        ratings = {"strong_buy": 0, "buy": 0, "hold": 0, "sell": 0, "strong_sell": 0}
        for rec in recs:
            sb = int(rec.get("analystRatingsStrongBuy") or 0)
            b  = int(rec.get("analystRatingsBuy") or 0)
            h  = int(rec.get("analystRatingsHold") or 0)
            ss = int(rec.get("analystRatingsStrongSell") or 0)
            s  = int(rec.get("analystRatingsSell") or 0)
            ratings["strong_buy"]  += sb
            ratings["buy"]         += b
            ratings["hold"]        += h
            ratings["sell"]        += s
            ratings["strong_sell"] += ss
            break  # only most recent period

        return {
            "ratings": ratings,
            "target_mean":  _fmt_number(pt.get("targetConsensus")),
            "target_high":  _fmt_number(pt.get("targetHigh")),
            "target_low":   _fmt_number(pt.get("targetLow")),
        }
    except Exception:
        return {}


# ── Finnhub helpers ───────────────────────────────────────────────────────────

def _finnhub_analyst(symbol: str) -> dict:
    """Analyst recommendations + EPS surprises from Finnhub."""
    if not _FINNHUB_KEY:
        return {}
    headers = {"X-Finnhub-Token": _FINNHUB_KEY}
    try:
        # Recommendations
        rr = _requests.get(
            f"{_FINNHUB_BASE}/stock/recommendation",
            params={"symbol": symbol},
            headers=headers,
            timeout=5,
        )
        recs = rr.json() if rr.status_code == 200 else []
        ratings = {"strong_buy": 0, "buy": 0, "hold": 0, "sell": 0, "strong_sell": 0}
        if recs:
            latest = recs[0]
            ratings["strong_buy"]  = int(latest.get("strongBuy", 0))
            ratings["buy"]         = int(latest.get("buy", 0))
            ratings["hold"]        = int(latest.get("hold", 0))
            ratings["sell"]        = int(latest.get("sell", 0))
            ratings["strong_sell"] = int(latest.get("strongSell", 0))

        # Price target
        ptr = _requests.get(
            f"{_FINNHUB_BASE}/stock/price-target",
            params={"symbol": symbol},
            headers=headers,
            timeout=5,
        )
        pt = ptr.json() if ptr.status_code == 200 else {}

        # EPS surprises
        esr = _requests.get(
            f"{_FINNHUB_BASE}/stock/earnings",
            params={"symbol": symbol, "limit": 8},
            headers=headers,
            timeout=5,
        )
        surprises_raw = esr.json() if esr.status_code == 200 else []
        surprises = [
            {
                "period":     s.get("period", ""),
                "actual":     _fmt_number(s.get("actual")),
                "estimate":   _fmt_number(s.get("estimate")),
                "surprise":   _fmt_number(s.get("surprise")),
                "surprise_pct": _fmt_number(s.get("surprisePercent")),
            }
            for s in surprises_raw[:8]
        ]

        return {
            "ratings":     ratings,
            "target_mean": _fmt_number(pt.get("targetMean")),
            "target_high": _fmt_number(pt.get("targetHigh")),
            "target_low":  _fmt_number(pt.get("targetLow")),
            "n_analysts":  int(pt.get("targetNumberAnalysts", 0)),
            "eps_surprises": surprises,
        }
    except Exception:
        return {}


def _finnhub_insiders(symbol: str) -> list[dict]:
    if not _FINNHUB_KEY:
        return []
    try:
        r = _requests.get(
            f"{_FINNHUB_BASE}/stock/insider-transactions",
            params={"symbol": symbol},
            headers={"X-Finnhub-Token": _FINNHUB_KEY},
            timeout=5,
        )
        data = (r.json() or {}).get("data", []) if r.status_code == 200 else []
        result = []
        for tx in sorted(data, key=lambda x: x.get("transactionDate", ""), reverse=True)[:15]:
            result.append({
                "name":        tx.get("name", ""),
                "title":       tx.get("officerTitle", ""),
                "transaction": tx.get("transactionCode", ""),
                "shares":      int(tx.get("share", 0) or 0),
                "value":       _fmt_number(tx.get("value")),
                "price":       _fmt_number(tx.get("transactionPrice")),
                "date":        tx.get("transactionDate", ""),
            })
        return result
    except Exception:
        return []


# ── Main detail fetcher ───────────────────────────────────────────────────────

def _fetch_stock_detail(symbol: str) -> dict:
    cache_key = f"detail2:{symbol}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    t = yf.Ticker(symbol)
    info = t.info or {}

    # ── Profile ──────────────────────────────────────────────────────────────
    profile = {
        "name":            info.get("shortName") or info.get("longName") or symbol,
        "sector":          info.get("sector"),
        "industry":        info.get("industry"),
        "description":     info.get("longBusinessSummary"),
        "employees":       info.get("fullTimeEmployees"),
        "website":         info.get("website"),
        "country":         info.get("country"),
        "city":            info.get("city"),
        "exchange":        info.get("exchange") or info.get("fullExchangeName"),
        "quote_type":      info.get("quoteType"),
        "market_cap":      _fmt_number(info.get("marketCap")),
        "enterprise_value":_fmt_number(info.get("enterpriseValue")),
        "current_price":   _fmt_number(info.get("currentPrice") or info.get("regularMarketPrice")),
        "open":            _fmt_number(info.get("regularMarketOpen") or info.get("open")),
        "day_high":        _fmt_number(info.get("dayHigh") or info.get("regularMarketDayHigh")),
        "day_low":         _fmt_number(info.get("dayLow") or info.get("regularMarketDayLow")),
        "prev_close":      _fmt_number(info.get("regularMarketPreviousClose") or info.get("previousClose")),
        "volume":          _fmt_number(info.get("regularMarketVolume") or info.get("volume")),
        "currency":        info.get("currency", "USD"),
        "pe_ratio":        _fmt_number(info.get("trailingPE")),
        "forward_pe":      _fmt_number(info.get("forwardPE")),
        "peg_ratio":       _fmt_number(info.get("pegRatio")),
        "ps_ratio":        _fmt_number(info.get("priceToSalesTrailing12Months")),
        "pb_ratio":        _fmt_number(info.get("priceToBook")),
        "ev_to_ebitda":    _fmt_number(info.get("enterpriseToEbitda")),
        "ev_to_revenue":   _fmt_number(info.get("enterpriseToRevenue")),
        "eps":             _fmt_number(info.get("trailingEps")),
        "forward_eps":     _fmt_number(info.get("forwardEps")),
        "book_value":      _fmt_number(info.get("bookValue")),
        "dividend_yield":  _fmt_number((info.get("dividendYield") or 0) * 100),
        "dividend_rate":   _fmt_number(info.get("dividendRate")),
        "ex_dividend_date":str(info.get("exDividendDate") or ""),
        "payout_ratio":    _fmt_number((info.get("payoutRatio") or 0) * 100),
        "beta":            _fmt_number(info.get("beta")),
        "week_52_high":    _fmt_number(info.get("fiftyTwoWeekHigh")),
        "week_52_low":     _fmt_number(info.get("fiftyTwoWeekLow")),
        "sma_50":          _fmt_number(info.get("fiftyDayAverage")),
        "sma_200":         _fmt_number(info.get("twoHundredDayAverage")),
        "avg_volume":      _fmt_number(info.get("averageVolume")),
        "avg_volume_10d":  _fmt_number(info.get("averageVolume10days")),
        "float_shares":    _fmt_number(info.get("floatShares")),
        "shares_outstanding": _fmt_number(info.get("sharesOutstanding")),
        "short_ratio":     _fmt_number(info.get("shortRatio")),
        "short_pct_float": _fmt_number((info.get("shortPercentOfFloat") or 0) * 100),
        "target_mean":     _fmt_number(info.get("targetMeanPrice")),
        "target_low":      _fmt_number(info.get("targetLowPrice")),
        "target_high":     _fmt_number(info.get("targetHighPrice")),
        "recommendation":  info.get("recommendationKey"),
        "number_of_analysts": info.get("numberOfAnalystOpinions"),
        "revenue_growth":  _fmt_number((info.get("revenueGrowth") or 0) * 100),
        "earnings_growth": _fmt_number((info.get("earningsGrowth") or 0) * 100),
        "revenue_quarterly_growth": _fmt_number((info.get("revenueQuarterlyGrowth") or 0) * 100),
        "profit_margins":  _fmt_number((info.get("profitMargins") or 0) * 100),
        "gross_margins":   _fmt_number((info.get("grossMargins") or 0) * 100),
        "operating_margins": _fmt_number((info.get("operatingMargins") or 0) * 100),
        "ebitda_margins":  _fmt_number((info.get("ebitdaMargins") or 0) * 100),
        "return_on_assets": _fmt_number((info.get("returnOnAssets") or 0) * 100),
        "return_on_equity": _fmt_number((info.get("returnOnEquity") or 0) * 100),
        "debt_to_equity":  _fmt_number(info.get("debtToEquity")),
        "current_ratio":   _fmt_number(info.get("currentRatio")),
        "quick_ratio":     _fmt_number(info.get("quickRatio")),
        "total_cash":      _fmt_number(info.get("totalCash")),
        "total_debt":      _fmt_number(info.get("totalDebt")),
        "free_cashflow":   _fmt_number(info.get("freeCashflow")),
        "operating_cashflow": _fmt_number(info.get("operatingCashflow")),
        "revenue_ttm":     _fmt_number(info.get("totalRevenue")),
        "ebitda_ttm":      _fmt_number(info.get("ebitda")),
    }

    # ── Financial Statements ─────────────────────────────────────────────────
    IS_ROWS = [
        "Total Revenue", "Gross Profit", "Operating Income",
        "EBITDA", "Net Income", "Diluted EPS",
        "Research And Development", "Selling General Administrative",
        "Interest Expense", "Tax Provision",
    ]
    BS_ROWS = [
        "Total Assets", "Current Assets", "Cash And Cash Equivalents",
        "Total Debt", "Long Term Debt", "Current Debt",
        "Total Liabilities Net Minority Interest",
        "Stockholders Equity", "Retained Earnings",
        "Goodwill And Other Intangible Assets",
    ]
    CF_ROWS = [
        "Operating Cash Flow", "Capital Expenditure",
        "Free Cash Flow", "Dividends Paid",
        "Repurchase Of Capital Stock", "Issuance Of Debt", "Repayment Of Debt",
    ]

    # Prefer FMP (10 years) over yfinance (4 years) when key is available
    if _FMP_KEY:
        income_annual    = _fmp_income(symbol)
        balance_annual   = _fmp_balance(symbol)
        cashflow_annual  = _fmp_cashflow(symbol)
        # yfinance for quarterly (FMP quarterly needs paid plan)
        try:
            income_quarterly  = _df_to_periods(t.quarterly_income_stmt, IS_ROWS, 6)
            balance_quarterly = _df_to_periods(t.quarterly_balance_sheet, BS_ROWS, 6)
            cf_quarterly      = _df_to_periods(t.quarterly_cash_flow, CF_ROWS, 6)
        except Exception:
            income_quarterly = balance_quarterly = cf_quarterly = []
    else:
        try:
            income_annual     = _df_to_periods(t.income_stmt, IS_ROWS, 5)
            income_quarterly  = _df_to_periods(t.quarterly_income_stmt, IS_ROWS, 6)
        except Exception:
            income_annual = income_quarterly = []
        try:
            balance_annual    = _df_to_periods(t.balance_sheet, BS_ROWS, 5)
            balance_quarterly = _df_to_periods(t.quarterly_balance_sheet, BS_ROWS, 6)
        except Exception:
            balance_annual = balance_quarterly = []
        try:
            cashflow_annual   = _df_to_periods(t.cash_flow, CF_ROWS, 5)
            cf_quarterly      = _df_to_periods(t.quarterly_cash_flow, CF_ROWS, 6)
        except Exception:
            cashflow_annual = cf_quarterly = []

    financials = {
        "income":   {"annual": income_annual,   "quarterly": income_quarterly},
        "balance":  {"annual": balance_annual,  "quarterly": balance_quarterly},
        "cashflow": {"annual": cashflow_annual, "quarterly": cf_quarterly},
        "source":   "fmp" if _FMP_KEY else "yfinance",
    }

    # ── Analyst Data — priority: Finnhub > FMP > yfinance ────────────────────
    ratings = {"strong_buy": 0, "buy": 0, "hold": 0, "sell": 0, "strong_sell": 0}
    target_mean = profile["target_mean"]
    target_low  = profile["target_low"]
    target_high = profile["target_high"]
    eps_surprises: list[dict] = []
    n_analysts = profile["number_of_analysts"] or 0

    if _FINNHUB_KEY:
        fh = _finnhub_analyst(symbol)
        if fh.get("ratings"):
            ratings = fh["ratings"]
        if fh.get("target_mean"):
            target_mean = fh["target_mean"]
            target_low  = fh.get("target_low") or target_low
            target_high = fh.get("target_high") or target_high
            n_analysts  = fh.get("n_analysts") or n_analysts
        eps_surprises = fh.get("eps_surprises", [])
    elif _FMP_KEY:
        fa = _fmp_analyst(symbol)
        if fa.get("ratings"):
            ratings = fa["ratings"]
        if fa.get("target_mean"):
            target_mean = fa["target_mean"]
            target_low  = fa.get("target_low") or target_low
            target_high = fa.get("target_high") or target_high
    else:
        # yfinance recommendations summary
        try:
            rec = t.recommendations_summary
            if rec is not None and not rec.empty:
                row = rec.iloc[0]
                for c in rec.columns.tolist():
                    cl = c.lower().replace(" ", "_")
                    if "strongbuy" in cl or "strong_buy" in cl:
                        ratings["strong_buy"]  += int(row[c] or 0)
                    elif "buy" in cl:
                        ratings["buy"]         += int(row[c] or 0)
                    elif "hold" in cl:
                        ratings["hold"]        += int(row[c] or 0)
                    elif "strongsell" in cl or "strong_sell" in cl:
                        ratings["strong_sell"] += int(row[c] or 0)
                    elif "sell" in cl:
                        ratings["sell"]        += int(row[c] or 0)
        except Exception:
            pass

    eps_estimates = []
    try:
        ee = t.earnings_estimate
        if ee is not None and not ee.empty:
            for idx, r in ee.iterrows():
                eps_estimates.append({
                    "period": str(idx),
                    "avg":    _fmt_number(r.get("avg")),
                    "low":    _fmt_number(r.get("low")),
                    "high":   _fmt_number(r.get("high")),
                    "growth": _fmt_number((r.get("growth") or 0) * 100),
                })
    except Exception:
        pass

    revenue_estimates = []
    try:
        re_df = t.revenue_estimate
        if re_df is not None and not re_df.empty:
            for idx, r in re_df.iterrows():
                revenue_estimates.append({
                    "period": str(idx),
                    "avg":    _fmt_number(r.get("avg")),
                    "low":    _fmt_number(r.get("low")),
                    "high":   _fmt_number(r.get("high")),
                    "growth": _fmt_number((r.get("growth") or 0) * 100),
                })
    except Exception:
        pass

    # EPS surprises from yfinance if Finnhub not available
    if not eps_surprises:
        try:
            eh = t.earnings_history
            if eh is not None and not eh.empty:
                for idx, r in eh.iterrows():
                    period = str(idx.date()) if hasattr(idx, "date") else str(idx)[:10]
                    eps_surprises.append({
                        "period":       period,
                        "actual":       _fmt_number(r.get("epsActual")),
                        "estimate":     _fmt_number(r.get("epsEstimate")),
                        "surprise":     _fmt_number(r.get("epsDifference")),
                        "surprise_pct": _fmt_number(r.get("surprisePercent")),
                    })
                eps_surprises = list(reversed(eps_surprises))[:8]
        except Exception:
            pass

    analyst = {
        "ratings":           ratings,
        "price_target":      {
            "mean":    target_mean,
            "low":     target_low,
            "high":    target_high,
            "current": profile["current_price"],
        },
        "n_analysts":        n_analysts,
        "eps_estimates":     eps_estimates,
        "revenue_estimates": revenue_estimates,
        "eps_surprises":     eps_surprises,
    }

    # ── Institutional Holders ─────────────────────────────────────────────────
    holders_inst: list[dict] = []
    holders_major: dict = {}
    try:
        ih = t.institutional_holders
        if ih is not None and not ih.empty:
            for _, row in ih.head(10).iterrows():
                holders_inst.append({
                    "holder":  str(row.get("Holder", "")),
                    "shares":  int(row.get("Shares", 0) or 0),
                    "value":   _fmt_number(row.get("Value")),
                    "pct_held":_fmt_number(row.get("% Out")),
                })
    except Exception:
        pass

    try:
        mh = t.major_holders
        if mh is not None and not mh.empty:
            for _, row in mh.iterrows():
                key = str(row.iloc[1] if len(row) > 1 else "").strip()
                val = _fmt_number(row.iloc[0] if len(row) > 0 else None)
                if val is not None and key:
                    holders_major[key] = val
    except Exception:
        pass

    holders = {"institutional": holders_inst, "major": holders_major}

    # ── Insider Transactions ──────────────────────────────────────────────────
    insiders: list[dict] = []
    if _FINNHUB_KEY:
        insiders = _finnhub_insiders(symbol)
    else:
        try:
            it = t.insider_transactions
            if it is not None and not it.empty:
                for _, row in it.head(15).iterrows():
                    dt = row.get("Start Date") or row.get("Date")
                    insiders.append({
                        "name":        str(row.get("Insider", "") or row.get("Name", "")),
                        "title":       str(row.get("Title", "") or ""),
                        "transaction": str(row.get("Transaction", "") or row.get("Type", "")),
                        "shares":      int(row.get("Shares", 0) or 0),
                        "value":       _fmt_number(row.get("Value")),
                        "price":       _fmt_number(row.get("Price")),
                        "date":        str(dt.date() if hasattr(dt, "date") else dt or ""),
                    })
        except Exception:
            pass

    # ── Dividend History ──────────────────────────────────────────────────────
    dividends: list[dict] = []
    try:
        dh = t.dividends
        if dh is not None and len(dh) > 0:
            for dt, amount in dh.tail(12).items():
                dividends.append({
                    "date":   str(dt.date() if hasattr(dt, "date") else dt)[:10],
                    "amount": _fmt_number(amount),
                })
            dividends.reverse()
    except Exception:
        pass

    result = {
        "profile":    profile,
        "financials": financials,
        "analyst":    analyst,
        "holders":    holders,
        "insiders":   insiders,
        "dividends":  dividends,
        "sources": {
            "financials": "fmp" if _FMP_KEY else "yfinance",
            "analyst":    "finnhub" if _FINNHUB_KEY else ("fmp" if _FMP_KEY else "yfinance"),
            "insiders":   "finnhub" if _FINNHUB_KEY else "yfinance",
        },
    }
    cache_set(cache_key, result, ttl=_DETAIL_TTL)
    return result


@router.get("/stock-detail/{symbol}")
async def get_stock_detail(
    symbol: str,
    user_id: str = Depends(get_current_user_id),
):
    """Full stock detail: profile, financial statements, analyst data."""
    result = await asyncio.to_thread(_fetch_stock_detail, symbol.upper())
    return result


# ── Stock Score / Veredicto ───────────────────────────────────────────────────

def _score_val(v, tiers):
    """Apply tier list [(threshold, score), ...] ascending. Returns last score if above all."""
    if v is None:
        return None
    for threshold, score in tiers:
        if v <= threshold:
            return score
    return tiers[-1][1]


def _compute_stock_score(detail: dict) -> dict:
    p = detail.get("profile", {})
    fin = detail.get("financials", {})
    analyst = detail.get("analyst", {})

    # ── Valuation metrics ──────────────────────────────────────────────────────
    pe = p.get("pe_ratio")
    fpe = p.get("forward_pe")
    ev_ebitda = p.get("ev_to_ebitda")
    ps = p.get("ps_ratio")
    pb = p.get("pb_ratio")

    # P/E score (lower is better; negative = unprofitable)
    if pe is not None and pe < 0:
        pe_score = 20
    else:
        pe_score = _score_val(pe, [(10,95),(15,85),(20,75),(25,65),(30,55),(40,40),(50,28),(999,15)])
    fpe_score = _score_val(fpe, [(10,95),(15,85),(20,75),(25,65),(30,55),(40,40),(50,28),(999,15)]) if fpe and fpe > 0 else pe_score
    ev_score  = _score_val(ev_ebitda, [(8,95),(12,85),(16,75),(20,60),(25,45),(35,28),(999,15)])
    ps_score  = _score_val(ps,  [(1,95),(2,85),(4,70),(8,55),(15,35),(999,20)])
    pb_score  = _score_val(pb,  [(1,90),(2,85),(3,75),(5,60),(10,40),(999,25)])

    val_scores = [s for s in [pe_score, fpe_score, ev_score, ps_score, pb_score] if s is not None]
    val_score  = round(sum(val_scores) / len(val_scores)) if val_scores else 50

    # Trend data for valuation (P/E over annual income periods)
    pe_trend, fcf_multiple_trend = [], []
    income_annual = fin.get("income", {}).get("annual", [])
    cashflow_annual = fin.get("cashflow", {}).get("annual", [])
    price = p.get("current_price") or 0
    shares = p.get("shares_outstanding") or 0
    mktcap = p.get("market_cap") or (price * shares)

    for row in reversed(income_annual[-5:]):
        period = str(row.get("period", ""))[:7]
        eps_raw = row.get("Diluted EPS") or row.get("Basic EPS")
        if eps_raw and price:
            try:
                eps_val = float(str(eps_raw).replace("$","").replace(",",""))
                if eps_val > 0:
                    pe_trend.append({"year": period, "value": round(price / eps_val, 1)})
            except Exception:
                pass

    for row in reversed(cashflow_annual[-5:]):
        period = str(row.get("period", ""))[:7]
        fcf_raw = row.get("Free Cash Flow") or row.get("Capital Expenditures")
        if fcf_raw and mktcap:
            try:
                fcf_val = float(str(fcf_raw).replace("$","").replace(",","").replace("B","e9").replace("M","e6").replace("T","e12"))
                if fcf_val > 0:
                    pe_trend.append({"year": period, "value": round(mktcap / fcf_val, 1)})
            except Exception:
                pass

    # ── Growth metrics ─────────────────────────────────────────────────────────
    rev_growth = p.get("revenue_growth")      # decimal e.g. 0.12
    earn_growth = p.get("earnings_growth")

    rev_score  = _score_val(rev_growth,  [(-0.1,10),(-0.05,20),(0,35),(0.05,50),(0.1,65),(0.15,75),(0.2,85),(0.3,92),(1,100)])
    earn_score = _score_val(earn_growth, [(-0.1,10),(-0.05,20),(0,35),(0.05,50),(0.1,65),(0.15,75),(0.2,85),(0.3,92),(1,100)])

    grow_scores = [s for s in [rev_score, earn_score] if s is not None]
    grow_score  = round(sum(grow_scores) / len(grow_scores)) if grow_scores else 50

    # Revenue trend bars from income annual
    rev_trend, fcf_trend = [], []
    for row in reversed(income_annual[-5:]):
        period = str(row.get("period", ""))[:7]
        raw = row.get("Total Revenue")
        if raw:
            try:
                v = float(str(raw).replace("$","").replace(",","").replace("B","e9").replace("M","e6").replace("T","e12").replace("K","e3"))
                rev_trend.append({"year": period, "value": round(v / 1e9, 2)})
            except Exception:
                pass
    for row in reversed(cashflow_annual[-5:]):
        period = str(row.get("period", ""))[:7]
        raw = row.get("Free Cash Flow")
        if raw:
            try:
                v = float(str(raw).replace("$","").replace(",","").replace("B","e9").replace("M","e6").replace("T","e12").replace("K","e3"))
                fcf_trend.append({"year": period, "value": round(v / 1e9, 2)})
            except Exception:
                pass

    # ── Quality metrics ────────────────────────────────────────────────────────
    gm  = p.get("gross_margins")        # decimal
    om  = p.get("operating_margins")
    nm  = p.get("profit_margins")
    roe = p.get("return_on_equity")
    roa = p.get("return_on_assets")

    gm_score  = _score_val(gm,  [(-1,10),(0,25),(0.1,40),(0.2,55),(0.3,65),(0.4,75),(0.5,85),(0.6,92),(1,100)])
    om_score  = _score_val(om,  [(-1,10),(0,25),(0.05,45),(0.1,60),(0.15,70),(0.2,80),(0.25,90),(1,100)])
    nm_score  = _score_val(nm,  [(-1,10),(0,25),(0.05,50),(0.1,65),(0.15,75),(0.2,85),(0.3,92),(1,100)])
    roe_score = _score_val(roe, [(-1,10),(0,25),(0.05,40),(0.1,55),(0.15,65),(0.2,78),(0.25,88),(0.35,95),(1,100)])
    roa_score = _score_val(roa, [(-1,10),(0,25),(0.03,40),(0.05,55),(0.08,65),(0.12,78),(0.18,90),(1,100)])

    qual_scores = [s for s in [gm_score, om_score, nm_score, roe_score, roa_score] if s is not None]
    qual_score  = round(sum(qual_scores) / len(qual_scores)) if qual_scores else 50

    # Margin trend from income annual
    margin_trend = []
    for row in reversed(income_annual[-5:]):
        period = str(row.get("period", ""))[:7]
        try:
            rev_raw = float(str(row.get("Total Revenue","0")).replace("$","").replace(",","").replace("B","e9").replace("M","e6").replace("T","e12").replace("K","e3"))
            ni_raw  = float(str(row.get("Net Income","0")).replace("$","").replace(",","").replace("B","e9").replace("M","e6").replace("T","e12").replace("K","e3"))
            if rev_raw > 0:
                margin_trend.append({"year": period, "value": round(ni_raw / rev_raw * 100, 1)})
        except Exception:
            pass

    # Shares dilution trend
    dilution_trend = []
    balance_annual = fin.get("balance", {}).get("annual", [])
    for row in reversed(balance_annual[-5:]):
        period = str(row.get("period", ""))[:7]
        raw = row.get("Total Stockholder Equity") or row.get("Stockholders Equity")
        if raw:
            try:
                v = float(str(raw).replace("$","").replace(",","").replace("B","e9").replace("M","e6").replace("T","e12").replace("K","e3"))
                dilution_trend.append({"year": period, "value": round(v / 1e9, 2)})
            except Exception:
                pass

    # ── Financial health metrics ───────────────────────────────────────────────
    de   = p.get("debt_to_equity")
    cr   = p.get("current_ratio")
    fcf_val = p.get("free_cashflow")

    de_score  = _score_val(de,  [(0,100),(20,95),(50,88),(100,75),(150,60),(200,45),(300,30),(999,15)]) if de is not None else None
    cr_score  = _score_val(cr,  [(0.5,20),(0.8,35),(1.0,50),(1.3,65),(1.5,75),(2.0,85),(3.0,92),(99,100)])
    fcf_score = 80 if fcf_val and fcf_val > 0 else (40 if fcf_val is not None else None)

    health_scores = [s for s in [de_score, cr_score, fcf_score] if s is not None]
    health_score  = round(sum(health_scores) / len(health_scores)) if health_scores else 50

    # Debt vs equity bars
    capital_trend = []
    for row in reversed(balance_annual[-5:]):
        period = str(row.get("period", ""))[:7]
        try:
            debt_raw   = row.get("Long Term Debt") or row.get("Total Debt") or "0"
            equity_raw = row.get("Total Stockholder Equity") or row.get("Stockholders Equity") or "0"
            debt_v   = float(str(debt_raw).replace("$","").replace(",","").replace("B","e9").replace("M","e6").replace("T","e12").replace("K","e3"))
            equity_v = float(str(equity_raw).replace("$","").replace(",","").replace("B","e9").replace("M","e6").replace("T","e12").replace("K","e3"))
            capital_trend.append({"year": period, "debt": round(debt_v/1e9,2), "equity": round(equity_v/1e9,2)})
        except Exception:
            pass

    # ROE trend
    roe_trend = []
    for i, row in enumerate(reversed(income_annual[-5:])):
        period = str(row.get("period", ""))[:7]
        if i < len(balance_annual):
            try:
                ni_raw  = float(str(row.get("Net Income","0")).replace("$","").replace(",","").replace("B","e9").replace("M","e6").replace("T","e12").replace("K","e3"))
                eq_raw  = float(str((list(reversed(balance_annual[-5:]))[i]).get("Total Stockholder Equity","1") or "1").replace("$","").replace(",","").replace("B","e9").replace("M","e6").replace("T","e12").replace("K","e3"))
                if eq_raw > 0:
                    roe_trend.append({"year": period, "value": round(ni_raw / eq_raw * 100, 1)})
            except Exception:
                pass

    # ── Shares dilution score ──────────────────────────────────────────────────
    shares_now  = p.get("shares_outstanding") or p.get("float_shares")
    # Look for shares change in the trend
    dilution_score = 70  # default neutral

    # ── Overall score (weighted) ───────────────────────────────────────────────
    weights = {"val": 0.25, "grow": 0.25, "qual": 0.30, "health": 0.20}
    overall = round(
        val_score   * weights["val"]   +
        grow_score  * weights["grow"]  +
        qual_score  * weights["qual"]  +
        health_score * weights["health"]
    )

    # Grade
    if overall >= 85:   grade, signal = "A+", "COMPRA FUERTE"
    elif overall >= 75: grade, signal = "A",  "COMPRA"
    elif overall >= 65: grade, signal = "B+", "COMPRA"
    elif overall >= 55: grade, signal = "B",  "MANTENER"
    elif overall >= 45: grade, signal = "C",  "MANTENER"
    elif overall >= 35: grade, signal = "D",  "VENDER"
    else:               grade, signal = "F",  "VENTA FUERTE"

    # ── Claude AI verdict ─────────────────────────────────────────────────────
    verdict_short = ""
    verdict_long  = ""
    try:
        _ant_key = os.getenv("ANTHROPIC_API_KEY", "")
        if _ant_key:
            name = p.get("name", "Esta empresa")
            sector = p.get("sector", "")
            client_ant = anthropic.Anthropic(api_key=_ant_key)
            prompt = (
                f"Eres un analista financiero experto. Analiza '{name}' ({sector}) con estos datos:\n"
                f"- Score general: {overall}/100 (Valoración:{val_score} Crecimiento:{grow_score} Calidad:{qual_score} Salud:{health_score})\n"
                f"- P/E: {pe}, Forward P/E: {fpe}, EV/EBITDA: {ev_ebitda}\n"
                f"- Margen bruto: {round((gm or 0)*100,1)}%, Margen operativo: {round((om or 0)*100,1)}%, Margen neto: {round((nm or 0)*100,1)}%\n"
                f"- Crecimiento de ingresos: {round((rev_growth or 0)*100,1)}%, Crecimiento de ganancias: {round((earn_growth or 0)*100,1)}%\n"
                f"- ROE: {round((roe or 0)*100,1)}%, ROA: {round((roa or 0)*100,1)}%\n"
                f"- Deuda/Capital: {de}, Ratio corriente: {cr}\n"
                f"- Recomendación: {signal}\n\n"
                "Responde en español con exactamente DOS partes:\n"
                "CORTO: Una sola oración de 15-20 palabras resumiendo la calidad del negocio (NO menciones el precio).\n"
                "LARGO: Dos oraciones de análisis: primero los puntos fuertes, luego los riesgos o debilidades clave."
            )
            msg = client_ant.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=220,
                messages=[{"role": "user", "content": prompt}],
            )
            text = msg.content[0].text.strip()
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            for line in lines:
                if line.upper().startswith("CORTO:"):
                    verdict_short = line[6:].strip()
                elif line.upper().startswith("LARGO:"):
                    verdict_long = line[6:].strip()
            if not verdict_short and lines:
                verdict_short = lines[0]
            if not verdict_long and len(lines) > 1:
                verdict_long = " ".join(lines[1:])
    except Exception:
        pass

    # Fallback text if Claude not available
    if not verdict_short:
        parts = []
        if qual_score >= 75:  parts.append("márgenes sólidos")
        if grow_score >= 70:  parts.append("crecimiento saludable")
        if health_score >= 75: parts.append("balance robusto")
        if val_score >= 75:   parts.append("valoración atractiva")
        if not parts:         parts = ["métricas mixtas"]
        verdict_short = f"{p.get('name','Empresa')} muestra {', '.join(parts)}."
    if not verdict_long:
        verdict_long = f"Score de calidad {qual_score}/100. Crecimiento {grow_score}/100. Salud financiera {health_score}/100. Valoración {val_score}/100."

    return {
        "overall_score": overall,
        "grade": grade,
        "signal": signal,
        "verdict_short": verdict_short,
        "verdict_long": verdict_long,
        "categories": [
            {
                "key": "valuation",
                "name": "Valoración",
                "score": val_score,
                "metrics": [
                    {
                        "name": "Múltiplo de Ganancias (P/E)",
                        "value": f"{pe:.1f}x" if pe else "—",
                        "score": pe_score,
                        "label": _pe_label(pe),
                        "trend": pe_trend,
                        "chart_type": "line",
                        "lower_is_better": True,
                    },
                    {
                        "name": "Múltiplo EV/EBITDA",
                        "value": f"{ev_ebitda:.1f}x" if ev_ebitda else "—",
                        "score": ev_score,
                        "label": _ev_label(ev_ebitda),
                        "trend": fcf_trend,
                        "chart_type": "line",
                        "lower_is_better": True,
                    },
                ],
            },
            {
                "key": "growth",
                "name": "Crecimiento",
                "score": grow_score,
                "metrics": [
                    {
                        "name": "Crecimiento de Ingresos",
                        "value": f"+{rev_growth*100:.1f}%" if rev_growth and rev_growth >= 0 else (f"{rev_growth*100:.1f}%" if rev_growth else "—"),
                        "score": rev_score,
                        "label": _growth_label(rev_growth),
                        "trend": rev_trend,
                        "chart_type": "bar",
                        "lower_is_better": False,
                    },
                    {
                        "name": "Flujo de Caja Libre",
                        "value": f"${p.get('free_cashflow',0)/1e9:.1f}B" if p.get("free_cashflow") else "—",
                        "score": fcf_score,
                        "label": "FCF positivo y creciente" if (fcf_val or 0) > 0 else "FCF negativo o sin datos",
                        "trend": fcf_trend,
                        "chart_type": "bar",
                        "lower_is_better": False,
                    },
                ],
            },
            {
                "key": "quality",
                "name": "Calidad del Negocio",
                "score": qual_score,
                "metrics": [
                    {
                        "name": "Tendencia de Márgenes",
                        "value": f"{round((nm or 0)*100,1)}%" if nm is not None else "—",
                        "score": nm_score,
                        "label": _margin_label(nm),
                        "trend": margin_trend,
                        "chart_type": "line",
                        "lower_is_better": False,
                    },
                    {
                        "name": "Retorno sobre Capital (ROE)",
                        "value": f"{round((roe or 0)*100,1)}%" if roe is not None else "—",
                        "score": roe_score,
                        "label": _roe_label(roe),
                        "trend": roe_trend,
                        "chart_type": "line",
                        "lower_is_better": False,
                    },
                ],
            },
            {
                "key": "health",
                "name": "Salud Financiera",
                "score": health_score,
                "metrics": [
                    {
                        "name": "Estructura de Capital",
                        "value": f"{de:.1f}x D/E" if de is not None else "—",
                        "score": de_score,
                        "label": _de_label(de),
                        "trend": capital_trend,
                        "chart_type": "stacked_bar",
                        "lower_is_better": True,
                    },
                    {
                        "name": "Dilución de Acciones",
                        "value": f"{round((p.get('revenue_quarterly_growth') or 0)*100,1)}%" if p.get("shares_outstanding") else "—",
                        "score": dilution_score,
                        "label": "Recompras netas o dilución mínima",
                        "trend": dilution_trend,
                        "chart_type": "bar",
                        "lower_is_better": False,
                    },
                ],
            },
        ],
    }


def _pe_label(v):
    if v is None: return "Sin datos"
    if v < 0:     return "Empresa no rentable"
    if v < 10:    return "Valoración muy atractiva"
    if v < 15:    return "Por debajo de 15x, atractivo"
    if v < 20:    return "Valoración razonable"
    if v < 25:    return "Ligeramente elevado"
    if v < 35:    return "Prima de crecimiento"
    return "Valoración exigente"


def _ev_label(v):
    if v is None: return "Sin datos"
    if v < 8:     return "Muy atractivo"
    if v < 12:    return "Por debajo de 12x, razonable"
    if v < 16:    return "Valoración justa"
    if v < 20:    return "Ligeramente por encima"
    return "Múltiplo elevado"


def _growth_label(v):
    if v is None:  return "Sin datos"
    if v >= 0.3:   return f"Crecimiento excepcional +{v*100:.0f}%"
    if v >= 0.15:  return f"Crecimiento sólido +{v*100:.0f}%"
    if v >= 0.05:  return f"Crecimiento moderado +{v*100:.0f}%"
    if v >= 0:     return f"Crecimiento lento +{v*100:.1f}%"
    return f"Ingresos en contracción {v*100:.1f}%"


def _margin_label(v):
    if v is None: return "Sin datos"
    if v >= 0.25: return f"Márgenes excelentes {v*100:.1f}%"
    if v >= 0.15: return f"Márgenes sólidos {v*100:.1f}%"
    if v >= 0.05: return f"Márgenes aceptables {v*100:.1f}%"
    if v >= 0:    return f"Márgenes ajustados {v*100:.1f}%"
    return "Pérdidas netas"


def _roe_label(v):
    if v is None: return "Sin datos"
    if v >= 0.25: return f"Retorno excepcional {v*100:.1f}%"
    if v >= 0.15: return f"Por encima del 15%, eficiente"
    if v >= 0.08: return f"Retorno moderado {v*100:.1f}%"
    if v >= 0:    return f"Retorno bajo {v*100:.1f}%"
    return "Capital destruido"


def _de_label(v):
    if v is None: return "Sin datos"
    if v < 20:    return "Deuda mínima, muy sólido"
    if v < 50:    return "Apalancamiento moderado"
    if v < 100:   return "Deuda manejable"
    if v < 200:   return "Apalancamiento elevado"
    return "Deuda muy alta, riesgo"


@router.get("/stock-score/{symbol}")
async def get_stock_score(
    symbol: str,
    user_id: str = Depends(get_current_user_id),
):
    """AI quality score + verdict for a stock (0-100, 8 metrics, 4 categories)."""
    sym = symbol.upper()
    cache_key = f"score3:{sym}"
    cached = cache_get(cache_key)
    if cached:
        return cached
    detail = await asyncio.to_thread(_fetch_stock_detail, sym)
    result = _compute_stock_score(detail)
    cache_set(cache_key, result, ttl=3600)
    return result
