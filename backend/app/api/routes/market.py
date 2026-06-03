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
@limiter.limit("6/minute")
async def portfolio_from_screenshot(
    request: Request,
    body: dict,
    user_id: str = Depends(get_current_user_id)
):
    image_data = body.get("image", "")
    image_type = body.get("type", "image/jpeg")

    if not image_data:
        return {"positions": [], "error": "No image provided"}

    _SYSTEM = (
        "Eres el sistema de extracción de portafolios más preciso del mundo. "
        "Tienes visión computacional de nivel experto y extraes datos financieros con precisión quirúrgica "
        "de cualquier app de inversión: Robinhood, Fidelity, Schwab, IBKR, GBM+, Kuspit, Bursanet, Bitso, "
        "TD Ameritrade, Vanguard, E*Trade, Webull, Alpaca, Nu Invest, XTB, Trading212, Degiro, "
        "eToro, Wealthsimple, Stake, Freetrade, Libertex, Plus500, y cualquier otra app o broker. "
        "Entiendes layouts en español, inglés y portugués. "
        "REGLA DE ORO: Nunca inventas datos. Si un valor no es claramente visible, devuelves null."
    )

    _PROMPT = (
        "Examina METICULOSAMENTE esta imagen y extrae TODAS las posiciones del portafolio que veas.\n\n"
        "━━━ SALIDA REQUERIDA ━━━\n"
        "Devuelve ÚNICAMENTE un JSON array. Sin markdown, sin bloques de código, sin explicaciones.\n"
        "Formato exacto:\n"
        '[{"ticker":"AAPL","name":"Apple Inc.","shares":10.5,"avg_price":150.00,"current_price":187.50,"gain_loss_pct":25.0}]\n\n'
        "━━━ DEFINICIÓN DE CAMPOS ━━━\n"
        "ticker        → Símbolo en MAYÚSCULAS. Cripto: BTC-USD, ETH-USD, SOL-USD. ETFs: SPY, QQQ, VOO.\n"
        "name          → Nombre completo visible. Si no aparece, usa el ticker.\n"
        "shares        → Cantidad de unidades/acciones. Acepta decimales (ej: 0.00145 BTC).\n"
        "avg_price     → Precio promedio de COMPRA por unidad. Ver algoritmo de cálculo abajo.\n"
        "current_price → Precio actual de mercado por unidad visible en pantalla. null si no aparece.\n"
        "gain_loss_pct → % de ganancia (+) o pérdida (-) visible. null si no aparece.\n\n"
        "━━━ ALGORITMO PARA avg_price — APLICA EN ORDEN ESTRICTO ━━━\n\n"
        "① ETIQUETA DIRECTA (más confiable)\n"
        "   Busca exactamente estas etiquetas y copia el número que las acompaña:\n"
        "   ES: 'P. Prom', 'Precio Prom', 'Precio Promedio', 'Precio de Compra', 'Costo Promedio',\n"
        "       'Costo por Acción', 'Precio Medio', 'Comprado a', 'Precio Medio de Compra'\n"
        "   EN: 'Avg Cost', 'Average Cost', 'Cost Basis/Share', 'Cost Per Share', 'Avg Price',\n"
        "       'Average Price', 'Purchase Price', 'Book Value/Share', 'Break-even Price'\n"
        "   PT: 'Preço Médio', 'Custo Médio', 'PM'\n\n"
        "② CÁLCULO DESDE VALOR TOTAL + GANANCIA/PÉRDIDA COLOREADA\n"
        "   La mayoría de apps muestran: [valor_mercado_total] y un número coloreado [+/- diferencia]\n"
        "   • Si el número adicional es VERDE o tiene '+': es ganancia\n"
        "     costo_total = valor_mercado - ganancia → avg_price = costo_total / shares\n"
        "     Ej: valor=$2,100 | ganancia=+$600 | shares=12 → costo=$1,500 → avg=$125.00\n"
        "   • Si el número adicional es ROJO o tiene '-': es pérdida\n"
        "     costo_total = valor_mercado + |pérdida| → avg_price = costo_total / shares\n"
        "     Ej: valor=$800 | pérdida=-$200 | shares=5 → costo=$1,000 → avg=$200.00\n\n"
        "③ CÁLCULO DESDE % DE RETORNO + VALOR ACTUAL\n"
        "   Si ves el porcentaje de ganancia/pérdida y el valor de mercado actual:\n"
        "   costo_total = valor_actual / (1 + pct/100)\n"
        "   avg_price = costo_total / shares\n"
        "   Ej: valor=$1,320 | +32% | 8 shares → costo=$1,000 → avg=$125.00\n\n"
        "④ MONTO INVERTIDO ETIQUETADO\n"
        "   Si ves 'Invertido', 'Capital Invertido', 'Monto Invertido', 'Invested', 'Cost Basis' (total):\n"
        "   avg_price = monto_invertido_total / shares\n\n"
        "⑤ SIN DATOS SUFICIENTES → avg_price = null\n\n"
        "━━━ INSTRUCCIONES CRÍTICAS ━━━\n"
        "✓ Extrae CADA posición visible — ni una sola excepción\n"
        "✓ Si la lista tiene scroll (imagen cortada abajo), extrae todas las que SÍ están visibles\n"
        "✓ Lee con precisión: '1,234.56' es mil doscientos treinta y cuatro punto cincuenta y seis\n"
        "✓ En apps latinas el punto separa miles y la coma los decimales: '1.234,56' = 1234.56\n"
        "✓ Acciones fraccionadas son válidas: 0.5 shares de AAPL, 0.00234 BTC\n"
        "✓ Si ves múltiples cuentas/carteras en la misma pantalla, extrae todas\n"
        "✓ Fondos de inversión, ETFs, REITs, bonos — extrae igual que acciones\n"
        "✓ Para criptos con valor muy bajo (SHIB, PEPE), mantén todos los decimales\n"
        "✗ NUNCA uses el precio actual como avg_price salvo como último recurso\n"
        "✗ NUNCA redondees shares — mantén la precisión exacta de la imagen\n"
        "✗ NUNCA incluyas texto fuera del JSON array"
    )

    def _run_sync(img_data: str, img_type: str) -> dict:
        with _screenshot_sem:
            sc = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            msg = sc.messages.create(
                model="claude-opus-4-8",
                max_tokens=16000,
                # Extended thinking: Claude reasons step-by-step before answering
                # This dramatically improves accuracy for complex images
                thinking={"type": "enabled", "budget_tokens": 10000},
                system=_SYSTEM,
                messages=[{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": img_type, "data": img_data}},
                    {"type": "text", "text": _PROMPT},
                ]}],
            )

        # With extended thinking, response has multiple blocks (thinking + text)
        # We only need the final text block which contains the JSON
        raw = ""
        for block in msg.content:
            if block.type == "text":
                raw = block.text.strip()
                break

        if not raw:
            return {"positions": [], "error": "No se recibió respuesta del modelo"}

        # Strip markdown code blocks if present
        if "```" in raw:
            parts = raw.split("```")
            for i, part in enumerate(parts):
                if i % 2 == 1:  # inside a code block
                    candidate = part.lstrip("json").strip()
                    if candidate.startswith("["):
                        raw = candidate
                        break
        raw = raw.strip()

        # Find the JSON array if there's surrounding text
        start = raw.find("[")
        end = raw.rfind("]")
        if start != -1 and end != -1 and end > start:
            raw = raw[start:end+1]

        positions = json.loads(raw)
        result = []
        for p in positions:
            ticker = str(p.get("ticker") or "").strip().upper()
            if not ticker:
                continue
            avg_price = p.get("avg_price")
            # Return the price exactly as read from the screenshot — never fabricate
            result.append({
                "ticker": ticker,
                "name": p.get("name") or ticker,
                "shares": float(p.get("shares") or 0),
                "avg_price": float(avg_price) if avg_price is not None else 0,
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


# ── Portfolio period returns ────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel
from datetime import datetime as _dt, timedelta as _td, timezone as _tz
from typing import Optional as _Opt
import pandas as _pd

class _PortfolioReturnsItem(_BaseModel):
    ticker: str
    shares: float
    purchase_date: _Opt[str] = None  # "YYYY-MM-DD"

class _PortfolioReturnsRequest(_BaseModel):
    positions: list[_PortfolioReturnsItem]

def _compute_portfolio_returns(positions: list[_PortfolioReturnsItem]) -> dict:
    if not positions:
        return {}
    tickers = [p.ticker.upper() for p in positions]
    shares_map = {p.ticker.upper(): p.shares for p in positions}

    # Earliest purchase date across all positions (to determine how long portfolio held)
    purchase_dates = [p.purchase_date for p in positions if p.purchase_date]
    oldest_date: _Opt[_dt] = None
    if purchase_dates:
        try:
            oldest_date = min(_dt.fromisoformat(d) for d in purchase_dates).replace(tzinfo=_tz.utc)
        except Exception:
            oldest_date = None

    today = _dt.now(_tz.utc)
    holding_days = (today - oldest_date).days if oldest_date else 99999

    # Download enough history (from oldest purchase date or 5y max)
    dl_period = "max" if oldest_date and holding_days > 1800 else "5y"
    try:
        raw = yf.download(tickers, period=dl_period, interval="1d", auto_adjust=True, progress=False)
        if raw.empty:
            return {}
        if isinstance(raw.columns, _pd.MultiIndex):
            close = raw["Close"] if "Close" in raw.columns.get_level_values(0) else raw.xs("Close", axis=1, level=0)
        else:
            close = raw[["Close"]] if "Close" in raw.columns else raw
            if len(tickers) == 1:
                close.columns = tickers
    except Exception:
        return {}

    close = close.dropna(how="all")
    if close.empty:
        return {}

    current_row = close.iloc[-1]
    current_val = sum(shares_map.get(t, 0) * float(current_row.get(t, 0) or 0) for t in tickers)
    if current_val <= 0:
        return {}

    ytd_start = _dt(today.year, 1, 1, tzinfo=_tz.utc)

    # Standard periods — only show if holding_days >= period threshold
    PERIODS: list[tuple[str, _td | None, int]] = [
        ("1d",  _td(days=2),    1),
        ("5d",  _td(days=8),    5),
        ("1mo", _td(days=35),   28),
        ("3mo", _td(days=95),   85),
        ("6mo", _td(days=185),  175),
        ("ytd", None,           (today - ytd_start).days),
        ("1y",  _td(days=370),  355),
        ("3y",  _td(days=1100), 1080),
        ("5y",  _td(days=1835), 1800),
    ]

    results: dict[str, dict] = {}

    # "Desde compra" — if purchase_date provided, calculate return from that date
    if oldest_date:
        try:
            cutoff_str = oldest_date.strftime("%Y-%m-%d")
            subset = close[close.index >= cutoff_str]
            if not subset.empty:
                start_row = subset.iloc[0]
                start_val = sum(shares_map.get(t, 0) * float(start_row.get(t, 0) or 0) for t in tickers)
                if start_val > 0:
                    results["since_purchase"] = {
                        "pct": round((current_val - start_val) / start_val * 100, 2),
                        "amount": round(current_val - start_val, 2),
                        "date": cutoff_str,
                    }
        except Exception:
            pass

    for key, delta, min_days in PERIODS:
        if holding_days < min_days:
            continue  # skip periods longer than user's holding time
        try:
            if key == "ytd":
                cutoff = ytd_start
            else:
                cutoff = today - delta  # type: ignore[operator]
            cutoff_str = cutoff.strftime("%Y-%m-%d")
            subset = close[close.index >= cutoff_str]
            if subset.empty:
                continue
            start_row = subset.iloc[0]
            start_val = sum(shares_map.get(t, 0) * float(start_row.get(t, 0) or 0) for t in tickers)
            if start_val <= 0:
                continue
            results[key] = {"pct": round((current_val - start_val) / start_val * 100, 2), "amount": round(current_val - start_val, 2)}
        except Exception:
            continue

    return results


@router.post("/portfolio-returns")
async def get_portfolio_returns(
    body: _PortfolioReturnsRequest,
    user_id: str = Depends(get_current_user_id),
):
    data = await asyncio.to_thread(_compute_portfolio_returns, body.positions)
    return {"returns": data}
