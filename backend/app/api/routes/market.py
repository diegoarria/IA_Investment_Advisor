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
