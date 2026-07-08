import asyncio
import logging
import os
import threading
from fastapi import APIRouter, Depends, Form, Query, Request, UploadFile, File
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger("uvicorn.error")

_INDICES_POOL = ThreadPoolExecutor(max_workers=5, thread_name_prefix="indices")
_MARKET_POOL = ThreadPoolExecutor(max_workers=20, thread_name_prefix="market")
_NEWS_POOL = ThreadPoolExecutor(max_workers=10, thread_name_prefix="news")
import yfinance as yf
import anthropic
import json
import requests as _requests
import time as time
from app.api.deps import get_current_user_id
from app.core.config import settings
from app.core.database import get_supabase, run_query
from app.models.user import UserProfile
from app.models.market import AssetAnalysisRequest, PortfolioScenarioRequest
from app.services import market_service, ai_service
from app.core.cache import cache_get, cache_set
from app.core.limiter import limiter

# Semaphore for the sync Anthropic call in the screenshot/pdf endpoints
_screenshot_sem = threading.Semaphore(10)


def _extract_json(text: str) -> list:
    """Robustly extract a JSON array from a model response."""
    import re
    text = text.strip()
    if "```" in text:
        match = re.search(r"```(?:json)?\s*(\[[\s\S]*?\])\s*```", text)
        if match:
            text = match.group(1)
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end > start:
        text = text[start:end + 1]
    return json.loads(text)

router = APIRouter(prefix="/market", tags=["market"])

_NEWS_CACHE_TTL      = 900   # 15 minutes
_INDEX_CACHE_TTL     = 60    # seconds (market closed)
_INDEX_CACHE_TTL_RT  = 10    # seconds (market open — real-time)
_SEARCH_CACHE_TTL    = 300   # 5 minutes

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
    """Sync helper — safe to call from sync contexts (e.g. _compute_performance callers).
    For async route usage, prefer calling run_query directly."""
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


def _us_market_holidays(year: int) -> set:
    """NYSE holidays for the given year (date objects)."""
    from datetime import date, timedelta
    import calendar

    def nth_weekday(y: int, month: int, n: int, weekday: int):
        first = date(y, month, 1)
        offset = (weekday - first.weekday()) % 7
        return first + timedelta(days=offset + (n - 1) * 7)

    def last_weekday(y: int, month: int, weekday: int):
        last_day = calendar.monthrange(y, month)[1]
        last = date(y, month, last_day)
        return last - timedelta(days=(last.weekday() - weekday) % 7)

    def observed(d):
        if d.weekday() == 5: return d - timedelta(days=1)   # Sat → Fri
        if d.weekday() == 6: return d + timedelta(days=1)   # Sun → Mon
        return d

    def easter_sunday(y: int):
        a = y % 19; b = y // 100; c = y % 100
        d = b // 4; e = b % 4; f = (b + 8) // 25
        g = (b - f + 1) // 3
        h = (19 * a + b - d - g + 15) % 30
        i = c // 4; k = c % 4
        l = (32 + 2 * e + 2 * i - h - k) % 7
        m = (a + 11 * h + 22 * l) // 451
        month = (h + l - 7 * m + 114) // 31
        day = ((h + l - 7 * m + 114) % 31) + 1
        return date(y, month, day)

    holidays = set()
    holidays.add(observed(date(year, 1, 1)))                     # New Year's Day
    holidays.add(nth_weekday(year, 1, 3, 0))                     # MLK Day — 3rd Mon Jan
    holidays.add(nth_weekday(year, 2, 3, 0))                     # Presidents' Day — 3rd Mon Feb
    holidays.add(easter_sunday(year) - timedelta(days=2))        # Good Friday
    holidays.add(last_weekday(year, 5, 0))                       # Memorial Day — last Mon May
    if year >= 2022:
        holidays.add(observed(date(year, 6, 19)))                # Juneteenth — Jun 19
    holidays.add(observed(date(year, 7, 4)))                     # Independence Day
    holidays.add(nth_weekday(year, 9, 1, 0))                     # Labor Day — 1st Mon Sep
    holidays.add(nth_weekday(year, 11, 4, 3))                    # Thanksgiving — 4th Thu Nov
    holidays.add(observed(date(year, 12, 25)))                   # Christmas
    return holidays


def _is_market_open() -> bool:
    """True when US equities market is open (Mon–Fri 09:30–16:00 ET, excluding holidays)."""
    from zoneinfo import ZoneInfo
    from datetime import datetime
    now = datetime.now(ZoneInfo("America/New_York"))
    if now.weekday() >= 5:
        return False
    if now.date() in _us_market_holidays(now.year):
        return False
    mins = now.hour * 60 + now.minute
    return 9 * 60 + 30 <= mins < 16 * 60


def _fetch_one_index(symbol: str) -> tuple[float | None, float | None]:
    """Returns (regularMarketPrice, chartPreviousClose) direct from Yahoo meta."""
    import httpx
    encoded = _yf_symbol(symbol).replace("^", "%5E")

    # Use meta fields: regularMarketPrice + chartPreviousClose are always correct
    # regardless of market hours — no need to compute from bar closes.
    # Try 2m intraday first (fresher during market hours), then 1d daily as fallback.
    for interval, rng in (("2m", "1d"), ("1d", "5d")):
        for base in ("query1", "query2"):
            try:
                url = (
                    f"https://{base}.finance.yahoo.com/v8/finance/chart/{encoded}"
                    f"?interval={interval}&range={rng}"
                )
                r = httpx.get(url, headers=_YF_HEADERS, timeout=10, follow_redirects=True)
                if r.status_code != 200:
                    continue
                meta = r.json()["chart"]["result"][0].get("meta", {})
                price = meta.get("regularMarketPrice")
                prev  = meta.get("chartPreviousClose") or meta.get("previousClose")
                if price:
                    return float(price), float(prev) if prev else None
            except Exception:
                pass

    # Last resort: Finnhub quote
    try:
        from app.core.finnhub import fh_quote as _fh_quote
        q = _fh_quote(symbol)
        if q and q.get("price"):
            return q["price"], q.get("prev_close")
    except Exception:
        pass

    return None, None


def _fetch_indices() -> list[dict]:
    cached = cache_get("market:indices")
    if cached:
        return cached
    result = []
    prices = dict(zip(INDICES.values(), _INDICES_POOL.map(_fetch_one_index, INDICES.values())))
    for name, symbol in INDICES.items():
        entry = {"name": name, "symbol": symbol, "price": None, "change": 0.0, "change_pct": 0.0}
        price, prev = prices.get(symbol, (None, None))
        if price and prev:
            entry["price"]      = round(price, 2)
            entry["change"]     = round(price - prev, 2)
            entry["change_pct"] = round((price - prev) / prev * 100, 2)
        result.append(entry)
    ttl = _INDEX_CACHE_TTL_RT if _is_market_open() else _INDEX_CACHE_TTL
    cache_set("market:indices", result, ttl=ttl)
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

    # Primary: Finnhub search
    try:
        from app.core.finnhub import fh_search
        fh_results = fh_search(q)
        if fh_results:
            results = [
                {"ticker": item["symbol"], "name": item.get("name") or item["symbol"]}
                for item in fh_results
                if item.get("symbol") and item.get("type", "") in ("", "Common Stock", "ETP", "ETF")
            ][:6]
            if results:
                cache_set(ck, results, ttl=_SEARCH_CACHE_TTL)
                return {"results": results}
    except Exception:
        pass

    # Fallback: Yahoo Finance search
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

        # Primary: direct Yahoo Finance API — use regularMarketPrice (always current, no lag)
        for domain in ("query1", "query2"):
            if price:
                break
            for interval, rng in (("2m", "1d"), ("1d", "5d")):
                try:
                    url = f"https://{domain}.finance.yahoo.com/v8/finance/chart/{encoded}?interval={interval}&range={rng}"
                    r = httpx.get(url, headers=_YF_HEADERS, timeout=8, follow_redirects=True)
                    if r.status_code == 200:
                        res = r.json()["chart"]["result"][0]
                        meta = res.get("meta", {})
                        p = meta.get("regularMarketPrice")
                        if p:
                            price = float(p)
                            prev  = meta.get("chartPreviousClose") or meta.get("previousClose")
                            if prev: prev = float(prev)
                            currency = meta.get("currency", "USD")
                            name = meta.get("shortName") or meta.get("longName") or symbol
                            break
                except Exception:
                    pass
            if price:
                break

        # Fallback: Finnhub quote
        if not price:
            try:
                from app.core.finnhub import fh_quote as _fh_quote
                q = _fh_quote(symbol)
                if q and q.get("price"):
                    price = q["price"]
                    prev  = q.get("prev_close")
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

    _PRICE_TTL = 30
    cached_result: dict = {}
    uncached: list[str] = []
    for sym in symbols:
        hit = cache_get(f"price:{sym}")
        if hit is not None:
            cached_result[sym] = hit
        else:
            uncached.append(sym)

    if uncached:
        new_pairs = list(_MARKET_POOL.map(_fetch, uncached))
        for sym, data in new_pairs:
            cache_set(f"price:{sym}", data, ttl=_PRICE_TTL)
            cached_result[sym] = data

    return cached_result


@router.get("/summary")
async def get_market_summary(user_id: str = Depends(get_current_user_id)):
    return market_service.get_market_summary()


@router.get("/asset/{symbol:path}")
async def get_asset(symbol: str, user_id: str = Depends(get_current_user_id)):
    return market_service.get_asset_data(_yf_symbol(symbol.upper()))


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
            from app.core.finnhub import fh_quote as _fh_quote
            q = _fh_quote(ticker)
            if q and q.get("price"):
                entry["current_price"] = round(float(q["price"]), 2)
            # analyst targets not available via Finnhub free plan — keep as None
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

# Persistent session for quoteSummary — Yahoo Finance requires cookies + crumb
_YF_SESSION = _requests.Session()
_YF_SESSION.headers.update(_YF_HEADERS)
_yf_crumb: str | None = None
_yf_crumb_ts: float = 0.0
_yf_crumb_lock = threading.Lock()

def _get_yf_crumb() -> str | None:
    """Get (or refresh) Yahoo Finance crumb token — required for quoteSummary."""
    global _yf_crumb, _yf_crumb_ts
    with _yf_crumb_lock:
        if _yf_crumb and (time.time() - _yf_crumb_ts) < 3600:
            return _yf_crumb
        try:
            _YF_SESSION.get("https://fc.yahoo.com", timeout=6)
            r = _YF_SESSION.get(
                "https://query1.finance.yahoo.com/v1/test/getcrumb",
                timeout=6,
            )
            if r.status_code == 200 and r.text and len(r.text) < 60:
                _yf_crumb = r.text.strip()
                _yf_crumb_ts = time.time()
                return _yf_crumb
        except Exception:
            pass
        return None

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
        t    = yf.Ticker(_yf_symbol(symbol))
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


@router.get("/chart/{ticker:path}")
async def get_chart(
    ticker: str,
    period: str = "1y",
    user_id: str = Depends(get_current_user_id),
):
    sym = _yf_symbol(ticker.upper().strip())
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
    screenshot_currency = body.get("currency", "USD").upper()

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
[{"ticker":"AAPL","name":"Apple Inc.","shares":10.5,"avg_price":150.00,"current_price":187.50,"gain_loss_pct":25.0,"purchase_date":"2023-08-15"}]

CAMPOS:
- ticker: símbolo bursátil en MAYÚSCULAS (BTC-USD, ETH-USD para cripto)
- name: nombre de la empresa/activo (usa ticker si no aparece)
- shares: cantidad exacta de unidades (acepta decimales)
- avg_price: precio promedio de COMPRA por unidad (ver cálculo abajo)
- current_price: precio actual por unidad (null si no visible)
- gain_loss_pct: porcentaje de ganancia/pérdida (null si no visible)
- purchase_date: fecha de compra en formato "YYYY-MM-DD" (null si no visible)

CÓMO OBTENER avg_price (en orden de prioridad — NUNCA saltes al paso 2 si el paso 1 es visible):

1. ETIQUETA DIRECTA (máxima prioridad absoluta): Si ves CUALQUIERA de estas etiquetas junto a un número, usa ese número DIRECTAMENTE como avg_price SIN hacer ningún cálculo:
   - "Precio de compra", "Precio promedio de compra", "Precio Prom. de compra"
   - "Precio promedio", "Precio Prom", "Precio de adquisición", "Precio de entrada"
   - "Precio base", "Valor de compra", "Costo promedio", "Costo por acción"
   - "Coste medio", "Coste de adquisición", "Precio medio"
   - "Average Cost", "Avg Cost", "Avg Buy Price", "Average Buy Price"
   - "Cost Per Share", "Cost Basis Per Share", "Purchase Price", "Buy Price"
   - "Average Price", "Avg Price", "Price Paid", "Price per share paid"
   - "Break-even", "Break even price"
   - "Preço Médio", "Preço de Compra", "P.M.", "P. Médio"
   - Cualquier variante que incluya las palabras: compra / purchase / buy / cost / average / promedio / medio / adquisición
   → USA ESE NÚMERO DIRECTAMENTE. No calcules. No promedies. No transformes.

2. Si ves valor_total_mercado y ganancia/pérdida en color:
   - Verde/positivo: avg_price = (valor_mercado - ganancia) / shares
   - Rojo/negativo: avg_price = (valor_mercado + pérdida_absoluta) / shares
3. Si ves % de retorno y valor actual: avg_price = (valor_actual / (1 + pct/100)) / shares
4. Si ves "Invertido", "Cost Basis", "Capital invertido", "Monto invertido" total: avg_price = monto_total / shares
5. Si no puedes calcular: avg_price = 0

CÓMO ENCONTRAR purchase_date:
- Busca cualquier etiqueta de fecha junto a la posición: "Fecha de compra", "Date acquired", "Bought on", "Open date", "Trade date", "Fecha de apertura", "Since", "Purchase date", "Fecha", "Comprado el", "Adquirido"
- Busca fechas en formato visual (ej: "15 ene 2024", "Jan 15, 2024", "01/15/2024", "2024-01-15") y conviértelas a YYYY-MM-DD
- Si la pantalla muestra el detalle de la posición con una sola fecha, es la fecha de compra
- Si hay múltiples fechas (por ejemplo historial de transacciones), usa la más antigua (primera compra)
- Si no aparece ninguna fecha para esta posición → null

NOTAS IMPORTANTES:
- En apps latinoamericanas: el punto puede ser separador de miles (1.234,56 = 1234.56)
- Incluye TODAS las posiciones visibles sin excepción
- Acciones fraccionadas son válidas (0.5 acciones, 0.00234 BTC)
- Si la lista está cortada, extrae las posiciones que SÍ están visibles
- Responde SOLO el JSON array, nada más"""

    # Inject currency hint so the AI knows not to convert prices
    _PROMPT += f"\n- MONEDA DE LOS PRECIOS: El usuario indicó que los precios en esta captura están en {screenshot_currency}. Extrae avg_price exactamente como aparece, sin convertir."

    def _call_claude(img_data: str, img_type: str) -> list:
        import logging as _log
        sc = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = sc.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            system=_SYSTEM,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": img_type, "data": img_data}},
                {"type": "text", "text": _PROMPT},
            ]}],
        )
        _log.getLogger(__name__).info(
            "OCR screenshot: in=%d out=%d cost≈$%.4f",
            msg.usage.input_tokens, msg.usage.output_tokens,
            msg.usage.input_tokens / 1e6 * 0.80 + msg.usage.output_tokens / 1e6 * 4.0,
        )
        raw = next((b.text for b in msg.content if hasattr(b, "type") and b.type == "text"), "")
        return _extract_json(raw)

    def _run_sync(img_data: str, img_type: str) -> dict:
        with _screenshot_sem:
            positions_raw = None
            last_error = None

            try:
                positions_raw = _call_claude(img_data, img_type)
            except Exception as e:
                last_error = str(e)

            if positions_raw is None:
                return {"positions": [], "error": last_error or "Error al procesar la imagen"}

            result = []
            for p in positions_raw:
                ticker = str(p.get("ticker") or "").strip().upper()
                if not ticker:
                    continue
                avg_price = p.get("avg_price")
                raw_date = p.get("purchase_date")
                purchase_date = None
                if raw_date and isinstance(raw_date, str):
                    import re as _re
                    if _re.match(r"^\d{4}-\d{2}-\d{2}$", raw_date.strip()):
                        purchase_date = raw_date.strip()
                result.append({
                    "ticker": ticker,
                    "name": p.get("name") or ticker,
                    "shares": float(p.get("shares") or 0),
                    "avg_price": float(avg_price) if avg_price else 0,
                    "purchase_date": purchase_date,
                })
            return {"positions": result}

    try:
        return await asyncio.to_thread(_run_sync, image_data, image_type)
    except Exception as e:
        return {"positions": [], "error": str(e)}


@router.post("/portfolio/from-pdf")
@limiter.limit("10/minute")
async def portfolio_from_pdf(
    request: Request,
    file: UploadFile = File(...),
    currency: str = Form("USD"),
    user_id: str = Depends(get_current_user_id),
):
    import base64 as _b64

    screenshot_currency = currency.upper()

    if not file.content_type == "application/pdf" and not (file.filename or "").lower().endswith(".pdf"):
        return {"positions": [], "error": "Solo se aceptan archivos PDF"}

    pdf_bytes = await file.read()
    if len(pdf_bytes) > 32 * 1024 * 1024:
        return {"positions": [], "error": "El PDF es demasiado grande (máx. 32 MB)"}

    pdf_b64 = _b64.b64encode(pdf_bytes).decode("utf-8")

    _SYSTEM = (
        "Eres un experto en extracción de datos de estados de cuenta de inversión. "
        "Analizas documentos de GBM+, Actinver, Kuspit, Bursanet, Interactive Brokers, "
        "Fidelity, Schwab, Vanguard, BBVA Bancomer Fondos, y cualquier otra casa de bolsa "
        "o broker en México, LATAM, EEUU y Europa. "
        "Extraes TODAS las posiciones de inversión y devuelves un JSON estructurado."
    )

    _PROMPT = """Analiza este estado de cuenta de inversión y extrae TODAS las posiciones visibles.

Responde ÚNICAMENTE con un JSON array con este formato exacto (sin texto adicional, sin markdown):
[{"ticker":"AAPL","name":"Apple Inc.","shares":10.5,"avg_price":150.00}]

CAMPOS:
- ticker: símbolo bursátil en MAYÚSCULAS. Para la BMV usa el sufijo MX si es necesario (AMXL.MX).
- name: nombre completo de la emisora, fondo o instrumento.
- shares: número de títulos o unidades (acepta decimales).
- avg_price: precio promedio de compra por título (0 si no aparece en el documento).

GUÍA POR BROKER:
• GBM+: sección "Posiciones" o "Mi portafolio" — columnas Título, Cantidad, P.M. (precio medio)
• Actinver: sección "Posiciones en valores" o "Cartera de valores" — columnas Emisora, Títulos, Precio Promedio
• Kuspit / Bursanet: tabla de cartera con columnas similares
• Brokers EEUU (Fidelity, Schwab, etc.): columnas Shares, Average Cost / Cost Basis Per Share

FORMATO DE NÚMEROS MEXICO:
  El punto es separador de miles y la coma es decimal: 1.234,56 → 1234.56

Responde SOLO el JSON array, nada más."""

    _PROMPT += f"\n- MONEDA DE LOS PRECIOS: El usuario indicó que los precios en este documento están en {screenshot_currency}. Extrae avg_price exactamente como aparece, sin convertir."

    def _call_claude_pdf(pdf_data: str) -> list:
        import logging as _log
        sc = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = sc.beta.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            betas=["pdfs-2024-09-25"],
            system=_SYSTEM,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_data}},
                    {"type": "text", "text": _PROMPT},
                ],
            }],
        )
        _log.getLogger(__name__).info(
            "OCR PDF: in=%d out=%d cost≈$%.4f",
            msg.usage.input_tokens, msg.usage.output_tokens,
            msg.usage.input_tokens / 1e6 * 0.80 + msg.usage.output_tokens / 1e6 * 4.0,
        )
        raw = next((b.text for b in msg.content if hasattr(b, "type") and b.type == "text"), "")
        return _extract_json(raw)

    def _run_sync_pdf(pdf_data: str) -> dict:
        with _screenshot_sem:
            try:
                positions_raw = _call_claude_pdf(pdf_data)
            except Exception as e:
                return {"positions": [], "error": str(e)}

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
        return await asyncio.to_thread(_run_sync_pdf, pdf_b64)
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

    results = list(_NEWS_POOL.map(_fetch_symbol_news, tickers))

    for articles in results:
        for a in articles:
            if a["uuid"] and a["uuid"] not in seen_uuids:
                seen_uuids.add(a["uuid"])
                all_articles.append(a)

    all_articles.sort(key=lambda x: x["timestamp"], reverse=True)
    cache_set(ck, all_articles, ttl=_NEWS_CACHE_TTL)
    return all_articles


_BOT_BLOCK_MARKERS = (
    "enable javascript", "please enable js", "verify you are human",
    "access denied", "are you a robot", "checking your browser",
    "attention required", "cloudflare", "subscribe to continue",
    "subscribe now to read", "sign in to continue",
)


def _extract_article_text(html: str) -> str:
    """Extract the main article body from raw HTML, filtering out bot-block/paywall shells."""
    import re as _re
    import trafilatura

    extracted = trafilatura.extract(
        html, include_comments=False, include_tables=False, favor_precision=True
    )
    text = (extracted or "").strip()

    # Fall back to meta description if trafilatura found nothing usable
    if len(text) < 80:
        m = _re.search(r'(?:og:description|name="description")[^>]*content="([^"]{40,})"', html, _re.IGNORECASE)
        if not m:
            m = _re.search(r'content="([^"]{40,})"[^>]*(?:og:description|name="description")', html, _re.IGNORECASE)
        if m:
            text = m.group(1).strip()

    # A bot-block/paywall interstitial often masquerades as "content" — reject it
    # rather than let the AI treat it as the real article.
    lowered = text.lower()
    if len(text) < 80 or any(marker in lowered for marker in _BOT_BLOCK_MARKERS):
        return ""

    return _re.sub(r"\s+", " ", text).strip()[:6000]


@router.post("/summarize-news")
async def summarize_news(body: dict, user_id: str = Depends(get_current_user_id)):
    """AI summary of a news article — premium-only, enforced on the frontend."""
    import httpx
    title = (body.get("title") or "").strip()
    url   = (body.get("url") or "").strip()
    if not title:
        return {"summary": "No se pudo resumir: falta el titular."}

    # Attempt to extract readable article text — this is the actual content the AI
    # summarizes. If the source blocks scraping (paywall/bot-detection), we tell the
    # user honestly instead of letting the AI guess from the headline alone.
    content = ""
    if url:
        _HEADERS = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "es-419,en-US;q=0.7",
            # No explicit Accept-Encoding — httpx already negotiates the correct
            # set based on what's actually installed (brotli isn't, so forcing
            # "br" here would risk an undecodable response).
            "Referer": "https://www.google.com/",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "cross-site",
            "Upgrade-Insecure-Requests": "1",
        }
        # One retry — a cloud server's outbound IP can get transiently rate-limited
        # by finance sites in a way a single request wouldn't recover from otherwise.
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                    r = await client.get(url, headers=_HEADERS)
                if r.status_code == 200:
                    content = _extract_article_text(r.text)
                else:
                    logger.warning("summarize-news fetch got HTTP %s for %s", r.status_code, url)
                break
            except Exception as e:
                logger.warning("summarize-news fetch failed (attempt %s) for %s: %s", attempt + 1, url, e)
                if attempt == 0:
                    await asyncio.sleep(1)

    language = "es"
    try:
        db = get_supabase()
        prof_res = await run_query(db.table("user_profiles").select("preferred_language").eq("user_id", user_id))
        if prof_res.data:
            language = prof_res.data[0].get("preferred_language") or "es"
    except Exception:
        pass

    summary = await ai_service.summarize_news_article(title, content, language=language)
    return {"summary": summary}


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

class _ClosedPositionItem(_BaseModel):
    """A fully or partially sold position — realized gain/loss is already known
    (no market data lookup needed), unlike a currently-held position."""
    ticker: str
    shares: float
    avg_price: float          # cost basis paid per share
    close_price: float        # price it was sold at
    purchase_date: _Opt[str] = None
    close_date: _Opt[str] = None

class _PortfolioReturnsRequest(_BaseModel):
    positions: list[_PortfolioReturnsItem]
    closed_positions: list[_ClosedPositionItem] = []
    inception_date: _Opt[str] = None


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
    """Normalize ticker for Yahoo Finance.

    BRK.B → BRK-B  (single-letter class suffix: dot → hyphen)
    ENB.TO → ENB.TO (exchange suffix with 2+ letters: unchanged)
    """
    import re
    return re.sub(r'\.([A-Z])$', r'-\1', ticker)


def _fetch_ticker_history(
    ticker: str, period1: int, period2: int, interval: str = "1d"
) -> tuple[list[int], list[float], float | None]:
    """Fetch historical adjusted-close prices + regularMarketPrice via Yahoo Finance Chart API.

    Returns (timestamps, closes, rt_price) where rt_price is always the current real-time price
    from the meta field — regardless of what the historical bars show (which can lag one day).
    """
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
            meta = res.get("meta", {})
            rt_price = meta.get("regularMarketPrice")
            ts = res.get("timestamp") or []
            # Prefer adjclose (accounts for splits + dividends)
            ac = (res.get("indicators", {}).get("adjclose") or [])
            closes = ac[0].get("adjclose") if ac else None
            if not closes:
                closes = (res.get("indicators", {}).get("quote") or [{}])[0].get("close")
            if ts and closes and len(ts) == len(closes):
                return ts, closes, float(rt_price) if rt_price else None
        except Exception:
            continue
    return [], [], None


def _build_close_df(
    tickers: list[str], period1: int, period2: int, interval: str = "1d"
) -> "tuple[_pd.DataFrame, dict[str, float]]":
    """Parallel fetch of historical close prices via direct Yahoo Finance API. Index is timezone-naive.

    Returns (df, rt_prices) where rt_prices maps ticker → regularMarketPrice (always current).
    Historical adjclose can lag one day; rt_prices is always up to date.
    """

    def _one(t: str) -> "tuple[str, _pd.Series | None, float | None]":
        ts, closes, rt_price = _fetch_ticker_history(t, period1, period2, interval)
        if not ts:
            return t, None, rt_price
        pairs = [
            (_pd.Timestamp(s, unit="s").normalize(), float(c))
            for s, c in zip(ts, closes) if c is not None
        ]
        if not pairs:
            return t, None, rt_price
        dates, vals = zip(*pairs)
        return t, _pd.Series(list(vals), index=list(dates), name=t, dtype=float), rt_price

    results = list(_MARKET_POOL.map(_one, tickers))

    rt_prices: dict[str, float] = {t: rt for t, _, rt in results if rt is not None}
    series = [s for _, s, _ in results if s is not None]
    if not series:
        return _pd.DataFrame(), rt_prices
    return _pd.concat(series, axis=1).ffill().dropna(how="all"), rt_prices


def _build_close_df_range(
    tickers: list[str], range_str: str, interval: str = "1h"
) -> "_pd.DataFrame":
    """Fetch short-range intraday data (1d, 5d) via Yahoo Finance range parameter."""
    import httpx

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

    results = list(_MARKET_POOL.map(_one, tickers))

    series = [s for _, s in results if s is not None]
    if not series:
        return _pd.DataFrame()
    return _pd.concat(series, axis=1).ffill().dropna(how="all")


def _compute_portfolio_returns(
    positions: list[_PortfolioReturnsItem],
    closed_positions: list[_ClosedPositionItem] | None = None,
    inception_date: _Opt[str] = None,
) -> tuple[dict, dict]:
    closed_positions = closed_positions or []
    if not positions and not closed_positions:
        return {}, {}

    # Realized gain/loss from positions already sold never needs market data —
    # the price they were sold at is already fixed. This is what lets
    # "since_purchase" reflect true since-inception performance instead of
    # forgetting everything the moment a position is no longer held.
    realized_cost = sum(c.shares * c.avg_price for c in closed_positions)
    realized_gain = sum(c.shares * (c.close_price - c.avg_price) for c in closed_positions)

    if not positions:
        # Everything was sold — since_purchase is purely realized performance.
        results: dict[str, dict] = {}
        if realized_cost > 0:
            results["since_purchase"] = {
                "pct": round(realized_gain / realized_cost * 100, 2),
                "amount": round(realized_gain, 2),
                "date": inception_date,
            }
        return results, {}

    tickers = [p.ticker.upper() for p in positions]
    shares_map = {p.ticker.upper(): p.shares for p in positions}
    avg_price_map = {p.ticker.upper(): p.avg_price for p in positions if p.avg_price and p.avg_price > 0}
    purchase_date_map = {p.ticker.upper(): p.purchase_date for p in positions if p.purchase_date}

    today = _dt.now()
    # Include ^GSPC (S&P 500 index) as benchmark — preferred over SPY because the index
    # has no dividends so adjclose == regular close, eliminating the adjclose/price mismatch.
    # SPY is included as fallback in case ^GSPC fetch fails.
    all_tickers = list(dict.fromkeys(tickers + ["^GSPC", "SPY"]))

    # Fetch 5+ years via direct Yahoo Finance Chart API (same as getPrices — guaranteed to work)
    today_ts = int(today.timestamp())
    start_ts = int((today - _td(days=1835)).timestamp())
    close, rt_prices = _build_close_df(all_tickers, start_ts, today_ts, interval="1d")

    # Infer purchase dates for positions that have avg_price but no purchase_date
    inferred_dates: dict[str, str] = {}
    for t in tickers:
        if t not in purchase_date_map and t in avg_price_map and t in close.columns:
            inferred = _infer_purchase_date(t, avg_price_map[t], close)
            if inferred:
                purchase_date_map[t] = inferred
                inferred_dates[t] = inferred

    if close.empty and not rt_prices:
        return {}, inferred_dates

    # Bail if none of the user's tickers returned data
    if not any(t in close.columns or t in rt_prices for t in tickers):
        return {}, inferred_dates

    # Ensure all portfolio tickers are present (SPY might be missing in some envs)
    missing = [t for t in tickers if t not in close.columns and t not in rt_prices]
    if missing == tickers:
        return {}, inferred_dates

    current_row = close.iloc[-1] if not close.empty else None

    # rt_prices contains regularMarketPrice — always current (adjclose can lag one session).
    # Use it for the "current" side of every calculation; fall back to last historical row only
    # if the real-time fetch failed for a specific ticker.
    def _cp(t: str) -> float:
        if t in rt_prices:
            return rt_prices[t]
        return _safe_price(current_row, t) if current_row is not None else 0.0

    current_val = sum(
        shares_map.get(t, 0) * _cp(t)
        for t in tickers if t in close.columns or t in rt_prices
    )
    if current_val <= 0:
        return {}, inferred_dates

    # Prefer ^GSPC (pure price index, no dividend distortion) over SPY as benchmark
    _BENCH = "^GSPC" if ("^GSPC" in close.columns or "^GSPC" in rt_prices) else "SPY"
    spy_current = _cp(_BENCH) if (_BENCH in close.columns or _BENCH in rt_prices) else 0.0

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

    # "Desde compra" — weighted by each position's individual purchase date,
    # plus realized gain/loss from anything already sold (closed_positions).
    if purchase_date_map or closed_positions:
        try:
            total_cost = 0.0; total_gain = 0.0
            breakdown: dict[str, float] = {}
            oldest_date_str: _Opt[str] = None

            for t in tickers:
                pd_str = purchase_date_map.get(t)
                if not pd_str or (t not in close.columns and t not in rt_prices):
                    continue
                cutoff = _pd.Timestamp(pd_str)
                subset = close[close.index >= cutoff] if not close.empty else _pd.DataFrame()
                if subset.empty and t not in rt_prices:
                    continue
                # Use avg_price (real cost paid) when available — more accurate than historical close
                sp = avg_price_map.get(t) or (_safe_price(subset.iloc[0], t) if not subset.empty else 0.0)
                cp = _cp(t)
                if sp > 0 and cp > 0:
                    shares = shares_map.get(t, 0)
                    total_cost += shares * sp
                    total_gain += shares * (cp - sp)
                    breakdown[t] = round((cp - sp) / sp * 100, 2)
                    if oldest_date_str is None or pd_str < oldest_date_str:
                        oldest_date_str = pd_str

            # Fold in realized performance from positions no longer held — this
            # is what keeps "since inception" accurate after a sale, instead of
            # forgetting it the moment the position leaves the current list.
            total_cost += realized_cost
            total_gain += realized_gain

            # The displayed anchor date is the frozen inception date the client
            # sends (set once, the first position ever added) — not whichever
            # currently-held position happens to be oldest, which would shift
            # every time an older position is edited or sold.
            benchmark_date = inception_date or oldest_date_str
            spy_start_buy = 0.0
            if benchmark_date and _BENCH in close.columns:
                bench_subset = close[close.index >= _pd.Timestamp(benchmark_date)]
                if not bench_subset.empty:
                    spy_start_buy = _safe_price(bench_subset.iloc[0], _BENCH)

            if total_cost > 0:
                spy_pct_buy = round((spy_current - spy_start_buy) / spy_start_buy * 100, 2) if spy_start_buy > 0 else None
                avg_pct = round(sum(breakdown.values()) / len(breakdown), 2) if breakdown else None
                results["since_purchase"] = {
                    "pct": round(total_gain / total_cost * 100, 2),
                    "avg_pct": avg_pct,
                    "amount": round(total_gain, 2),
                    "date": benchmark_date,
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
                if t not in close.columns and t not in rt_prices:
                    continue
                shares = shares_map.get(t, 0)
                cp = _cp(t)
                pd_str = purchase_date_map.get(t)
                if not short_period and pd_str and _pd.Timestamp(pd_str) > cutoff:
                    # Bought mid-period (only for periods > 5D): cost is what we actually paid
                    mid_subset = close[close.index >= _pd.Timestamp(pd_str)] if not close.empty else _pd.DataFrame()
                    sp = avg_price_map.get(t) or (_safe_price(mid_subset.iloc[0], t) if not mid_subset.empty else 0.0)
                else:
                    # Use price at start of period (always for 1D/5D)
                    sp = _safe_price(start_row, t) if not close.empty else 0.0
                if sp > 0 and cp > 0:
                    start_cost += shares * sp
                    end_value  += shares * cp
                    breakdown[t] = round((cp - sp) / sp * 100, 2)

            if start_cost <= 0:
                continue

            # S&P 500 benchmark (always from period start, independent of positions)
            spy_pct = None
            if spy_current > 0 and _BENCH in close.columns:
                spy_start = _safe_price(start_row, _BENCH)
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
    data, inferred_dates = await asyncio.to_thread(
        _compute_portfolio_returns, body.positions, body.closed_positions, body.inception_date
    )
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
        close_inf, _ = _build_close_df(all_tickers_inf, start_inf, today_ts, interval="1d")
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
        close, rt_prices = _build_close_df(tickers, start_ts, today_ts, interval=interval)
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
        close, rt_prices = _build_close_df(tickers, start_ts, today_ts, interval=interval)
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

    # For non-intraday charts, replace the last data point with real-time prices so the
    # chart always ends at the current price (adjclose from daily bars lags one session).
    if not intraday and rt_prices:
        rt_end_val = sum(
            shares_map.get(t, 0) * rt_prices[t]
            for t in tickers
            if t in rt_prices
            and (t not in purchase_ts_map or (close.index[-1] if not close.empty else _pd.Timestamp.now()) >= purchase_ts_map[t])
        )
        if rt_end_val > 0:
            history[-1]["value"] = round(rt_end_val, 2)

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


def _fetch_quote_light(symbol: str) -> dict | None:
    """Per-ticker quoteSummary with only market-data modules — works from cloud IPs."""
    modules = "price,summaryDetail,calendarEvents"
    crumb = _get_yf_crumb()
    params: dict[str, str] = {"modules": modules, "corsDomain": "finance.yahoo.com"}
    if crumb:
        params["crumb"] = crumb
    for host in ("query2", "query1"):
        try:
            r = _YF_SESSION.get(
                f"https://{host}.finance.yahoo.com/v10/finance/quoteSummary/{symbol.replace('.', '-')}",
                params=params,
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json().get("quoteSummary", {}).get("result", [])
                if data:
                    return data[0]
            elif r.status_code in (401, 403):
                global _yf_crumb
                _yf_crumb = None
        except Exception:
            pass
    return None


def _parse_quote_light(qs: dict) -> dict:
    """Extract quote detail fields from a lightweight quoteSummary result."""
    def _r(obj, key):
        v = (obj or {}).get(key)
        return v.get("raw") if isinstance(v, dict) else v

    price_m   = qs.get("price") or {}
    summary_m = qs.get("summaryDetail") or {}
    cal_m     = qs.get("calendarEvents") or {}

    reg_price = _r(price_m, "regularMarketPrice")
    chg_abs   = _r(price_m, "regularMarketChange")
    # quoteSummary returns change percent as decimal fraction (e.g. -0.0028 = -0.28%)
    chg_frac  = _r(price_m, "regularMarketChangePercent")
    volume    = _r(price_m, "regularMarketVolume")
    mkt_cap   = _r(price_m, "marketCap")
    mstate    = (price_m.get("marketState") or "").upper()

    wk52hi = _r(summary_m, "fiftyTwoWeekHigh")
    wk52lo = _r(summary_m, "fiftyTwoWeekLow")
    w52_pct = None
    if reg_price and wk52lo and float(wk52lo) > 0:
        w52_pct = round((float(reg_price) - float(wk52lo)) / float(wk52lo) * 100, 2)

    pe = _r(summary_m, "trailingPE") or _r(summary_m, "forwardPE")

    # Earnings date from calendarEvents
    earnings_date = None
    earnings_list = (cal_m.get("earnings") or {}).get("earningsDate") or []
    if earnings_list:
        ed = earnings_list[0]
        if isinstance(ed, dict):
            earnings_date = ed.get("fmt")
        elif isinstance(ed, (int, float)):
            try:
                from datetime import datetime, timezone
                earnings_date = datetime.fromtimestamp(float(ed), tz=timezone.utc).strftime("%Y-%m-%d")
            except Exception:
                pass

    # Pre/post-market
    ext_price, ext_pct_frac, ext_label = None, None, None
    if mstate in ("PRE", "PREPRE"):
        ext_price    = _r(price_m, "preMarketPrice")
        ext_pct_frac = _r(price_m, "preMarketChangePercent")
        ext_label    = "Pre"
    elif mstate in ("POST", "POSTPOST", "CLOSED"):
        ext_price    = _r(price_m, "postMarketPrice")
        ext_pct_frac = _r(price_m, "postMarketChangePercent")
        ext_label    = "Post"

    ext_price_f = round(float(ext_price), 4) if ext_price else None
    ext_change  = round(float(ext_price_f) - float(reg_price), 4) if (ext_price_f and reg_price) else None

    return {
        "price":       round(float(reg_price), 4) if reg_price else None,
        "change":      round(float(chg_abs), 4) if chg_abs is not None else None,
        "changePct":   round(float(chg_frac) * 100, 2) if chg_frac is not None else None,
        "volume":      volume,
        "marketCap":   mkt_cap,
        "pe":          pe,
        "week52Low":   wk52lo,
        "week52High":  wk52hi,
        "week52Pct":   w52_pct,
        "earningsDate": earnings_date,
        "extPrice":    ext_price_f,
        "extPct":      round(float(ext_pct_frac) * 100, 2) if ext_pct_frac else None,
        "extChange":   ext_change,
        "extLabel":    ext_label,
        "marketState": mstate,
        "companyName": price_m.get("shortName") or price_m.get("longName"),
        "currency":    price_m.get("currency") or "USD",
    }


def _fetch_quote_details(tickers: list[str]) -> dict[str, dict]:
    """Batch-fetch extended quote data using quoteSummary v10 (works from cloud IPs).

    Yahoo Finance v7 /quote is blocked from datacenter IPs (Railway, AWS, etc.).
    quoteSummary v10 with crumb auth is the same API used for financial statements
    and is reliably accessible from server environments.
    """
    if not tickers:
        return {}

    missing = []
    cached: dict[str, dict] = {}
    for t in tickers:
        hit = cache_get(f"qdetailv2:{t}")
        if hit:
            cached[t] = hit
        else:
            missing.append(t)

    if not missing:
        return cached

    results: dict[str, dict] = dict(cached)

    from concurrent.futures import as_completed
    futures = {_MARKET_POOL.submit(_fetch_quote_light, t): t for t in missing}
    for fut in as_completed(futures):
        sym = futures[fut]
        try:
            qs = fut.result()
            if qs:
                entry = _parse_quote_light(qs)
                results[sym] = entry
                cache_set(f"qdetailv2:{sym}", entry, ttl=_QUOTE_DETAILS_TTL)
            else:
                results[sym] = {}
        except Exception:
            results[sym] = {}

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


@router.get("/ws-token")
async def get_ws_token(user_id: str = Depends(get_current_user_id)):
    """Returns the Finnhub WebSocket token so the frontend can connect without
    exposing the key in client-side env vars."""
    if not _FINNHUB_KEY:
        return {"token": None}
    return {"token": _FINNHUB_KEY}


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
    # Pre-build normalized (no-space, no-underscore, lowercase) index map
    # This handles both "Gross Profit" and "GrossProfit" (yfinance version differences)
    idx_norm: dict[str, object] = {
        str(i).lower().replace(" ", "").replace("_", ""): i for i in df.index
    }
    results = []
    for col in df.columns:
        try:
            period = str(col.date()) if hasattr(col, "date") else str(col)[:10]
        except Exception:
            period = str(col)[:10]
        entry: dict[str, object] = {"period": period}
        for row in rows:
            val = None
            row_norm = row.lower().replace(" ", "").replace("_", "")
            if row in df.index:
                val = _fmt_number(df.loc[row, col])
            elif row_norm in idx_norm:
                val = _fmt_number(df.loc[idx_norm[row_norm], col])
            else:
                matches = [i for i in df.index if row.lower() in str(i).lower()
                           or row_norm in str(i).lower().replace(" ", "").replace("_", "")]
                if matches:
                    val = _fmt_number(df.loc[matches[0], col])
            entry[row] = val
        # Derive Gross Profit = Revenue − COGS if not found directly
        if entry.get("Gross Profit") is None:
            rev = entry.get("Total Revenue")
            cogs_key = next(
                (i for i in df.index if "cost" in str(i).lower()
                 and any(w in str(i).lower() for w in ("revenue", "goods", "sales"))),
                None,
            )
            if cogs_key is not None and rev is not None:
                cogs = _fmt_number(df.loc[cogs_key, col])
                if cogs is not None:
                    entry["Gross Profit"] = round(float(rev) - float(cogs), 4)
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
            revenue  = _fmt_number(d.get("revenue"))
            cost_rev = _fmt_number(d.get("costOfRevenue"))
            gross    = _fmt_number(d.get("grossProfit"))
            # Derive gross profit from revenue − COGS when FMP returns missing/zero
            if not gross and revenue is not None and cost_rev is not None and cost_rev != 0:
                gross = round(float(revenue) - float(cost_rev), 4)
                op_income = _fmt_number(d.get("operatingIncome"))
            net_income = _fmt_number(d.get("netIncome"))
            # Derive margin %
            gross_margin  = round(float(gross) / float(revenue) * 100, 2) if gross and revenue else None
            op_margin     = round(float(op_income) / float(revenue) * 100, 2) if op_income and revenue else None
            net_margin    = round(float(net_income) / float(revenue) * 100, 2) if net_income and revenue else None
            result.append({
                "period":              d.get("date", "")[:7],
                "Total Revenue":       revenue,
                "Cost Of Revenue":     cost_rev,
                "Gross Profit":        gross,
                "Gross Margin %":      gross_margin,
                "Operating Expenses":  _fmt_number(d.get("totalOperatingExpenses") or d.get("operatingExpenses")),
                "Operating Income":    op_income,
                "Operating Margin %":  op_margin,
                "EBITDA":              _fmt_number(d.get("ebitda")),
                "Net Income":          net_income,
                "Net Margin %":        net_margin,
                "Diluted EPS":         _fmt_number(d.get("epsdiluted")),
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
            ca = d.get("totalCurrentAssets")
            cl = d.get("totalCurrentLiabilities")
            wc = round(float(ca) - float(cl), 4) if (ca is not None and cl is not None) else None
            result.append({
                "period": d.get("date", "")[:7],
                # ── Current Assets ──────────────────────────────────
                "Cash And Cash Equivalents":          _fmt_number(d.get("cashAndCashEquivalents")),
                "Short Term Investments":             _fmt_number(d.get("shortTermInvestments")),
                "Cash And Short Term Investments":    _fmt_number(d.get("cashAndShortTermInvestments")),
                "Net Receivables":                    _fmt_number(d.get("netReceivables")),
                "Inventory":                          _fmt_number(d.get("inventory")),
                "Other Current Assets":               _fmt_number(d.get("otherCurrentAssets")),
                "Current Assets":                     _fmt_number(ca),
                # ── Non-Current Assets ───────────────────────────────
                "Net PPE":                            _fmt_number(d.get("propertyPlantEquipmentNet")),
                "Goodwill":                           _fmt_number(d.get("goodwill")),
                "Intangible Assets":                  _fmt_number(d.get("intangibleAssets")),
                "Goodwill And Other Intangible Assets": _fmt_number(d.get("goodwillAndIntangibleAssets")),
                "Long Term Investments":              _fmt_number(d.get("longTermInvestments")),
                "Tax Assets":                         _fmt_number(d.get("taxAssets")),
                "Other Non Current Assets":           _fmt_number(d.get("otherNonCurrentAssets")),
                "Total Non Current Assets":           _fmt_number(d.get("totalNonCurrentAssets")),
                "Total Assets":                       _fmt_number(d.get("totalAssets")),
                # ── Current Liabilities ──────────────────────────────
                "Accounts Payable":                   _fmt_number(d.get("accountPayables")),
                "Short Term Debt":                    _fmt_number(d.get("shortTermDebt")),
                "Tax Payables":                       _fmt_number(d.get("taxPayables")),
                "Deferred Revenue":                   _fmt_number(d.get("deferredRevenue")),
                "Other Current Liabilities":          _fmt_number(d.get("otherCurrentLiabilities")),
                "Current Liabilities":                _fmt_number(cl),
                # ── Non-Current Liabilities ──────────────────────────
                "Long Term Debt":                     _fmt_number(d.get("longTermDebt")),
                "Capital Lease Obligations":          _fmt_number(d.get("capitalLeaseObligations")),
                "Deferred Tax Liabilities":           _fmt_number(d.get("deferredTaxLiabilitiesNonCurrent")),
                "Minority Interest":                  _fmt_number(d.get("minorityInterest")),
                "Other Non Current Liabilities":      _fmt_number(d.get("otherNonCurrentLiabilities")),
                "Total Non Current Liabilities":      _fmt_number(d.get("totalNonCurrentLiabilities")),
                "Total Liabilities Net Minority Interest": _fmt_number(d.get("totalLiabilities")),
                # ── Equity ───────────────────────────────────────────
                "Preferred Stock":                        _fmt_number(d.get("preferredStock")),
                "Common Stock":                           _fmt_number(d.get("commonStock")),
                "Additional Paid In Capital":             _fmt_number(d.get("additionalPaidInCapital")),
                "Retained Earnings":                      _fmt_number(d.get("retainedEarnings")),
                "Accumulated Other Comprehensive Income": _fmt_number(d.get("accumulatedOtherComprehensiveIncomeLoss")),
                "Other Stockholder Equity":               _fmt_number(d.get("othertotalStockholdersEquity")),
                "Stockholders Equity":                    _fmt_number(d.get("totalStockholdersEquity")),
                # ── Summary ──────────────────────────────────────────
                "Total Debt":                         _fmt_number(d.get("totalDebt")),
                "Net Debt":                           _fmt_number(d.get("netDebt")),
                "Working Capital":                    _fmt_number(wc),
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
                "period": d.get("date", "")[:7],
                # ── Operating Activities ─────────────────────────────
                "Net Income":                         _fmt_number(d.get("netIncome")),
                "Depreciation And Amortization":      _fmt_number(d.get("depreciationAndAmortization")),
                "Stock Based Compensation":           _fmt_number(d.get("stockBasedCompensation")),
                "Deferred Income Tax":                _fmt_number(d.get("deferredIncomeTax")),
                "Change In Working Capital":          _fmt_number(d.get("changeInWorkingCapital")),
                "Accounts Receivables Change":        _fmt_number(d.get("accountsReceivables")),
                "Inventory Change":                   _fmt_number(d.get("inventory")),
                "Accounts Payables Change":           _fmt_number(d.get("accountsPayables")),
                "Other Working Capital":              _fmt_number(d.get("otherWorkingCapital")),
                "Other Non Cash Items":               _fmt_number(d.get("otherNonCashItems")),
                "Operating Cash Flow":                _fmt_number(d.get("operatingCashFlow")),
                # ── Investing Activities ─────────────────────────────
                "Capital Expenditure":                _fmt_number(d.get("capitalExpenditure")),
                "Acquisitions Net":                   _fmt_number(d.get("acquisitionsNet")),
                "Purchases Of Investments":           _fmt_number(d.get("purchasesOfInvestments")),
                "Sales Maturities Of Investments":    _fmt_number(d.get("salesMaturitiesOfInvestments")),
                "Other Investing Activities":         _fmt_number(d.get("otherInvestingActivites")),
                "Investing Cash Flow":                _fmt_number(d.get("netCashUsedForInvestingActivites")),
                # ── Financing Activities ─────────────────────────────
                "Issuance Of Common Stock":           _fmt_number(d.get("commonStockIssued")),
                "Repurchase Of Capital Stock":        _fmt_number(d.get("commonStockRepurchased")),
                "Issuance Of Debt":                   _fmt_number(d.get("debtIssuance") or d.get("longTermDebtIssuance")),
                "Repayment Of Debt":                  _fmt_number(d.get("debtRepayment")),
                "Dividends Paid":                     _fmt_number(d.get("dividendsPaid")),
                "Other Financing Activities":         _fmt_number(d.get("otherFinancingActivites")),
                "Financing Cash Flow":                _fmt_number(d.get("netCashUsedProvidedByFinancingActivities")),
                # ── Summary ──────────────────────────────────────────
                "Free Cash Flow":                     _fmt_number(d.get("freeCashFlow")),
                "Effect Of Forex Changes On Cash":    _fmt_number(d.get("effectOfForexChangesOnCash")),
                "Net Change In Cash":                 _fmt_number(d.get("netChangeInCash")),
                "Cash At Beginning Of Period":        _fmt_number(d.get("cashAtBeginningOfPeriod")),
                "Cash At End Of Period":              _fmt_number(d.get("cashAtEndOfPeriod")),
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


# ── Yahoo Finance quoteSummary (direct HTTP — more reliable than yfinance lib) ─

def _yf_quote_summary(symbol: str) -> dict:
    """Call YF v10 quoteSummary directly with browser headers + crumb auth."""
    modules = ",".join([
        "price", "summaryProfile", "summaryDetail",
        "financialData", "defaultKeyStatistics",
        "incomeStatementHistory", "incomeStatementHistoryQuarterly",
        "balanceSheetHistory", "balanceSheetHistoryQuarterly",
        "cashflowStatementHistory", "cashflowStatementHistoryQuarterly",
        "recommendationTrend", "earningsTrend", "earningsHistory",
    ])
    crumb = _get_yf_crumb()
    params: dict = {"modules": modules, "corsDomain": "finance.yahoo.com"}
    if crumb:
        params["crumb"] = crumb
    for host in ("query2", "query1"):
        try:
            r = _YF_SESSION.get(
                f"https://{host}.finance.yahoo.com/v10/finance/quoteSummary/{symbol}",
                params=params,
                timeout=14,
            )
            if r.status_code == 200:
                data = r.json().get("quoteSummary", {}).get("result", [])
                if data:
                    return data[0]
            elif r.status_code in (401, 403):
                # Crumb likely expired — force refresh next call
                global _yf_crumb
                _yf_crumb = None
        except Exception:
            pass
    return {}


def _qs_raw(obj: dict | None, key: str):
    if not obj:
        return None
    v = obj.get(key)
    if isinstance(v, dict):
        return v.get("raw")
    return v


def _parse_qs_income(qs: dict, quarterly: bool = False, n: int = 5) -> list[dict]:
    key = "incomeStatementHistoryQuarterly" if quarterly else "incomeStatementHistory"
    sub = "incomeStatementHistory"
    rows = (qs.get(key) or {}).get(sub, [])
    result = []
    for row in rows[:n]:
        period   = ((row.get("endDate") or {}).get("fmt") or "")[:7]
        rev      = _qs_raw(row, "totalRevenue")
        cost_rev = _qs_raw(row, "costOfRevenue")
        gross    = _qs_raw(row, "grossProfit")
        # Derive gross profit from revenue − COGS when quoteSummary has missing value
        if not gross and rev is not None and cost_rev is not None:
            try:
                gross = float(rev) - float(cost_rev)
            except (TypeError, ValueError):
                pass
        op_income_raw = _qs_raw(row, "operatingIncome") or _qs_raw(row, "ebit")
        net_income_raw = _qs_raw(row, "netIncome")
        op_income  = _fmt_number(op_income_raw)
        net_income = _fmt_number(net_income_raw)
        gross_fmt  = _fmt_number(gross)
        rev_fmt    = _fmt_number(rev)
        try:
            gross_margin = round(float(gross) / float(rev) * 100, 2) if gross and rev else None
        except Exception:
            gross_margin = None
        try:
            op_margin = round(float(op_income_raw) / float(rev) * 100, 2) if op_income_raw and rev else None
        except Exception:
            op_margin = None
        try:
            net_margin = round(float(net_income_raw) / float(rev) * 100, 2) if net_income_raw and rev else None
        except Exception:
            net_margin = None
        result.append({
            "period":                         period,
            "Total Revenue":                  rev_fmt,
            "Cost Of Revenue":                _fmt_number(cost_rev),
            "Gross Profit":                   gross_fmt,
            "Gross Margin %":                 gross_margin,
            "Operating Expenses":             _fmt_number(_qs_raw(row, "totalOperatingExpenses") or _qs_raw(row, "operatingExpenses")),
            "Operating Income":               op_income,
            "Operating Margin %":             op_margin,
            "EBITDA":                         _fmt_number(_qs_raw(row, "ebitda")),
            "Net Income":                     net_income,
            "Net Margin %":                   net_margin,
            "Diluted EPS":                    _fmt_number(_qs_raw(row, "dilutedEps")),
            "Research And Development":       _fmt_number(_qs_raw(row, "researchDevelopment")),
            "Selling General Administrative": _fmt_number(_qs_raw(row, "sellingGeneralAdministrative")),
            "Interest Expense":               _fmt_number(_qs_raw(row, "interestExpense")),
            "Tax Provision":                  _fmt_number(_qs_raw(row, "incomeTaxExpense")),
        })
    return result


def _parse_qs_balance(qs: dict, quarterly: bool = False, n: int = 5) -> list[dict]:
    key = "balanceSheetHistoryQuarterly" if quarterly else "balanceSheetHistory"
    sub = "balanceSheetStatements"
    rows = (qs.get(key) or {}).get(sub, [])
    result = []
    for row in rows[:n]:
        period = ((row.get("endDate") or {}).get("fmt") or "")[:7]
        long_debt  = _qs_raw(row, "longTermDebt") or 0
        short_debt = _qs_raw(row, "shortTermDebt") or _qs_raw(row, "currentDebt") or 0
        total_debt = _qs_raw(row, "totalDebt") or ((long_debt + short_debt) if (long_debt or short_debt) else None)
        ca = _qs_raw(row, "totalCurrentAssets")
        cl = _qs_raw(row, "totalCurrentLiabilities")
        wc = round(float(ca) - float(cl), 4) if (ca is not None and cl is not None) else None
        result.append({
            "period":                                      period,
            # Current Assets
            "Cash And Cash Equivalents":                   _qs_raw(row, "cash"),
            "Short Term Investments":                      _qs_raw(row, "shortTermInvestments"),
            "Net Receivables":                             _qs_raw(row, "netReceivables"),
            "Inventory":                                   _qs_raw(row, "inventory"),
            "Other Current Assets":                        _qs_raw(row, "otherCurrentAssets"),
            "Current Assets":                              ca,
            # Non-Current Assets
            "Net PPE":                                     _qs_raw(row, "propertyPlantEquipment"),
            "Goodwill":                                    _qs_raw(row, "goodWill"),
            "Intangible Assets":                           _qs_raw(row, "intangibleAssets"),
            "Goodwill And Other Intangible Assets":        _qs_raw(row, "goodWill"),
            "Long Term Investments":                       _qs_raw(row, "longTermInvestments"),
            "Other Non Current Assets":                    _qs_raw(row, "otherAssets"),
            "Total Non Current Assets":                    _qs_raw(row, "totalNonCurrentAssets"),
            "Total Assets":                                _qs_raw(row, "totalAssets"),
            # Current Liabilities
            "Accounts Payable":                            _qs_raw(row, "accountsPayable"),
            "Short Term Debt":                             short_debt or None,
            "Deferred Revenue":                            _qs_raw(row, "deferredRevenue"),
            "Other Current Liabilities":                   _qs_raw(row, "otherCurrentLiab"),
            "Current Liabilities":                         cl,
            # Non-Current Liabilities
            "Long Term Debt":                              long_debt or None,
            "Deferred Tax Liabilities":                    _qs_raw(row, "deferredLongTermLiab"),
            "Other Non Current Liabilities":               _qs_raw(row, "otherLiab"),
            "Total Liabilities Net Minority Interest":     _qs_raw(row, "totalLiab"),
            # Equity
            "Preferred Stock":                             _qs_raw(row, "preferredStock"),
            "Common Stock":                                _qs_raw(row, "commonStock"),
            "Additional Paid In Capital":                  _qs_raw(row, "additionalPaidInCapital"),
            "Retained Earnings":                           _qs_raw(row, "retainedEarnings"),
            "Accumulated Other Comprehensive Income":      _qs_raw(row, "otherStockholderEquity"),
            "Stockholders Equity":                         _qs_raw(row, "totalStockholderEquity"),
            "Minority Interest":                           _qs_raw(row, "minorityInterest"),
            # Summary
            "Total Debt":                                  total_debt,
            "Net Debt":                                    _qs_raw(row, "netDebt"),
            "Working Capital":                             wc,
        })
    return result


def _parse_qs_cashflow(qs: dict, quarterly: bool = False, n: int = 5) -> list[dict]:
    key = "cashflowStatementHistoryQuarterly" if quarterly else "cashflowStatementHistory"
    sub = "cashflowStatements"
    rows = (qs.get(key) or {}).get(sub, [])
    result = []
    for row in rows[:n]:
        period = ((row.get("endDate") or {}).get("fmt") or "")[:7]
        op_cf  = _qs_raw(row, "totalCashFromOperatingActivities")
        capex  = _qs_raw(row, "capitalExpenditures")
        fcf    = round(float(op_cf) + float(capex), 4) if (op_cf is not None and capex is not None) else None
        result.append({
            "period":                           period,
            # Operating
            "Net Income":                       _qs_raw(row, "netIncome"),
            "Depreciation And Amortization":    _qs_raw(row, "depreciation"),
            "Change In Working Capital":        _qs_raw(row, "changeToNetWorkingCapital") or _qs_raw(row, "changeToAccountReceivables"),
            "Accounts Receivables Change":      _qs_raw(row, "changeToAccountReceivables"),
            "Inventory Change":                 _qs_raw(row, "changeToInventory"),
            "Other Working Capital":            _qs_raw(row, "changeToOperatingActivities"),
            "Other Non Cash Items":             _qs_raw(row, "otherCashflowsFromOperatingActivities"),
            "Operating Cash Flow":              op_cf,
            # Investing
            "Capital Expenditure":              capex,
            "Acquisitions Net":                 _qs_raw(row, "acquisitions"),
            "Purchases Of Investments":         _qs_raw(row, "investments"),
            "Other Investing Activities":       _qs_raw(row, "otherCashflowsFromInvestingActivities"),
            "Investing Cash Flow":              _qs_raw(row, "totalCashflowsFromInvestingActivities"),
            # Financing
            "Issuance Of Common Stock":         _qs_raw(row, "issuanceOfStock"),
            "Repurchase Of Capital Stock":      _qs_raw(row, "repurchaseOfStock"),
            "Issuance Of Debt":                 _qs_raw(row, "longTermDebtIssuance"),
            "Repayment Of Debt":                _qs_raw(row, "longTermDebtPayments"),
            "Dividends Paid":                   _qs_raw(row, "dividendsPaid"),
            "Other Financing Activities":       _qs_raw(row, "otherCashflowsFromFinancingActivities"),
            "Financing Cash Flow":              _qs_raw(row, "totalCashFromFinancingActivities"),
            # Summary
            "Free Cash Flow":                   fcf,
            "Effect Of Forex Changes On Cash":  _qs_raw(row, "effectOfExchangeRate"),
            "Net Change In Cash":               _qs_raw(row, "changeInCash"),
        })
    return result


# ── Main detail fetcher ───────────────────────────────────────────────────────

def _fetch_stock_detail(symbol: str) -> dict:
    symbol = _yf_symbol(symbol)
    cache_key = f"detail2:{symbol}"
    cached = cache_get(cache_key)
    # Discard stale cache entries where name wasn't resolved (empty data bug)
    if cached and cached.get("name") and cached.get("name") != symbol:
        return cached

    t = yf.Ticker(symbol)
    _qs: dict = {}  # quoteSummary — fetched lazily, at most once

    # t.info is the most common failure point (Yahoo Finance rate limits)
    # Wrap it so we never throw a 500 — fall back to quoteSummary instead.
    try:
        info = t.info or {}
    except Exception:
        info = {}

    # If yfinance returned empty/minimal info, use quoteSummary for profile data
    if not info.get("shortName") and not info.get("longName"):
        _qs = _yf_quote_summary(symbol)
        if _qs:
            _p   = _qs.get("price") or {}
            _sd  = _qs.get("summaryDetail") or {}
            _sp  = _qs.get("summaryProfile") or {}
            _fd  = _qs.get("financialData") or {}
            _ks  = _qs.get("defaultKeyStatistics") or {}
            def _rv(d, k):
                v = d.get(k)
                return v.get("raw") if isinstance(v, dict) else v
            info = {
                "shortName":                     _p.get("shortName") or _p.get("longName") or symbol,
                "longName":                       _p.get("longName"),
                "sector":                         _sp.get("sector"),
                "industry":                       _sp.get("industry"),
                "longBusinessSummary":            _sp.get("longBusinessSummary"),
                "fullTimeEmployees":              _sp.get("fullTimeEmployees"),
                "website":                        _sp.get("website"),
                "country":                        _sp.get("country"),
                "city":                           _sp.get("city"),
                "exchange":                       _p.get("exchange"),
                "currentPrice":                   _rv(_p, "regularMarketPrice"),
                "regularMarketPrice":             _rv(_p, "regularMarketPrice"),
                "regularMarketPreviousClose":     _rv(_p, "regularMarketPreviousClose"),
                "regularMarketOpen":              _rv(_p, "regularMarketOpen"),
                "regularMarketDayHigh":           _rv(_p, "regularMarketDayHigh"),
                "regularMarketDayLow":            _rv(_p, "regularMarketDayLow"),
                "regularMarketVolume":            _rv(_p, "regularMarketVolume"),
                "marketCap":                      _rv(_p, "marketCap"),
                "enterpriseValue":                _rv(_ks, "enterpriseValue"),
                "trailingPE":                     _rv(_sd, "trailingPE"),
                "forwardPE":                      _rv(_sd, "forwardPE"),
                "pegRatio":                       _rv(_ks, "pegRatio"),
                "priceToSalesTrailing12Months":   _rv(_sd, "priceToSalesTrailing12Months"),
                "priceToBook":                    _rv(_ks, "priceToBook"),
                "enterpriseToEbitda":             _rv(_ks, "enterpriseToEbitda"),
                "enterpriseToRevenue":            _rv(_ks, "enterpriseToRevenue"),
                "trailingEps":                    _rv(_ks, "trailingEps"),
                "forwardEps":                     _rv(_ks, "forwardEps"),
                "bookValue":                      _rv(_ks, "bookValue"),
                "dividendYield":                  _rv(_sd, "dividendYield"),
                "dividendRate":                   _rv(_sd, "dividendRate"),
                "payoutRatio":                    _rv(_sd, "payoutRatio"),
                "beta":                           _rv(_ks, "beta"),
                "fiftyTwoWeekHigh":               _rv(_sd, "fiftyTwoWeekHigh"),
                "fiftyTwoWeekLow":                _rv(_sd, "fiftyTwoWeekLow"),
                "fiftyDayAverage":                _rv(_sd, "fiftyDayAverage"),
                "twoHundredDayAverage":           _rv(_sd, "twoHundredDayAverage"),
                "averageVolume":                  _rv(_sd, "averageVolume"),
                "averageVolume10days":            _rv(_sd, "averageVolume10days"),
                "floatShares":                    _rv(_ks, "floatShares"),
                "sharesOutstanding":              _rv(_ks, "sharesOutstanding"),
                "shortRatio":                     _rv(_ks, "shortRatio"),
                "shortPercentOfFloat":            _rv(_ks, "shortPercentOfFloat"),
                "targetMeanPrice":                _rv(_fd, "targetMeanPrice"),
                "targetLowPrice":                 _rv(_fd, "targetLowPrice"),
                "targetHighPrice":                _rv(_fd, "targetHighPrice"),
                "recommendationKey":              _fd.get("recommendationKey"),
                "numberOfAnalystOpinions":        _rv(_fd, "numberOfAnalystOpinions"),
                "revenueGrowth":                  _rv(_fd, "revenueGrowth"),
                "earningsGrowth":                 _rv(_fd, "earningsGrowth"),
                "profitMargins":                  _rv(_fd, "profitMargins"),
                "grossMargins":                   _rv(_fd, "grossMargins"),
                "operatingMargins":               _rv(_fd, "operatingMargins"),
                "ebitdaMargins":                  _rv(_fd, "ebitdaMargins"),
                "returnOnAssets":                 _rv(_fd, "returnOnAssets"),
                "returnOnEquity":                 _rv(_fd, "returnOnEquity"),
                "debtToEquity":                   _rv(_fd, "debtToEquity"),
                "currentRatio":                   _rv(_fd, "currentRatio"),
                "quickRatio":                     _rv(_fd, "quickRatio"),
                "totalCash":                      _rv(_fd, "totalCash"),
                "totalDebt":                      _rv(_fd, "totalDebt"),
                "freeCashflow":                   _rv(_fd, "freeCashflow"),
                "operatingCashflow":              _rv(_fd, "operatingCashflow"),
                "totalRevenue":                   _rv(_fd, "totalRevenue"),
                "ebitda":                         _rv(_fd, "ebitda"),
            }

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
        "Total Revenue", "Cost Of Revenue", "Gross Profit", "Gross Margin %",
        "Operating Expenses", "Operating Income", "Operating Margin %",
        "EBITDA", "Net Income", "Net Margin %", "Diluted EPS",
        "Research And Development", "Selling General Administrative",
        "Interest Expense", "Tax Provision",
    ]
    BS_ROWS = [
        # Current Assets
        "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments",
        "Other Short Term Investments", "Short Term Investments",
        "Net Receivables", "Receivables", "Accounts Receivable",
        "Inventory", "Other Current Assets", "Prepaid Assets",
        "Current Assets",
        # Non-Current Assets
        "Net PPE", "Gross PPE", "Net Property Plant And Equipment",
        "Goodwill", "Intangible Assets", "Other Intangible Assets",
        "Goodwill And Other Intangible Assets",
        "Long Term Investments", "Investments And Advances",
        "Other Non Current Assets", "Total Non Current Assets",
        "Total Assets",
        # Current Liabilities
        "Accounts Payable", "Payables And Accrued Expenses",
        "Short Term Debt", "Current Debt", "Current Debt And Capital Lease Obligation",
        "Short Long Term Debt",
        "Current Deferred Revenue", "Deferred Revenue",
        "Tax Payables", "Other Current Liabilities", "Current Liabilities",
        # Non-Current Liabilities
        "Long Term Debt", "Long Term Debt And Capital Lease Obligation",
        "Non Current Deferred Taxes Liabilities",
        "Other Non Current Liabilities",
        "Total Non Current Liabilities Net Minority Interest",
        "Total Liabilities Net Minority Interest",
        # Equity
        "Common Stock", "Additional Paid In Capital",
        "Retained Earnings",
        "Accumulated Other Comprehensive Income",
        "Stockholders Equity", "Common Stock Equity",
        "Minority Interest",
        # Summary
        "Total Debt", "Net Debt",
    ]
    CF_ROWS = [
        # Operating
        "Net Income From Continuing Operations", "Net Income",
        "Depreciation And Amortization", "Depreciation Amortization Depletion",
        "Stock Based Compensation",
        "Deferred Tax", "Deferred Income Tax",
        "Change In Working Capital", "Changes In Working Capital",
        "Change In Receivables", "Changes In Account Receivables",
        "Change In Inventory",
        "Change In Payables And Accrued Expense", "Change In Payable",
        "Other Working Capital Changes",
        "Other Non Cash Items",
        "Operating Cash Flow", "Cash Flow From Continuing Operating Activities",
        # Investing
        "Capital Expenditure", "Purchase Of Ppe",
        "Net Business Purchase And Sale", "Purchase Of Business",
        "Net Investment Purchase And Sale", "Purchases Of Investments",
        "Net Other Investing Changes",
        "Investing Cash Flow", "Cash Flow From Continuing Investing Activities",
        # Financing
        "Common Stock Issuance", "Issuance Of Capital Stock",
        "Common Stock Payments", "Repurchase Of Capital Stock",
        "Long Term Debt Issuance", "Issuance Of Debt",
        "Long Term Debt Payments", "Repayment Of Debt",
        "Common Dividends", "Cash Dividends Paid", "Dividends Paid",
        "Other Financing Cash Flows",
        "Financing Cash Flow", "Cash Flow From Continuing Financing Activities",
        # Summary
        "Free Cash Flow",
        "Changes In Cash", "Net Change In Cash",
        "Beginning Cash Position",
        "End Cash Position",
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
        # Fill quarterly gaps with quoteSummary if yfinance failed
        if not income_quarterly:
            _qs = _qs or _yf_quote_summary(symbol)
            income_quarterly  = _parse_qs_income(_qs, quarterly=True, n=6)
            balance_quarterly = _parse_qs_balance(_qs, quarterly=True, n=6)
            cf_quarterly      = _parse_qs_cashflow(_qs, quarterly=True, n=6)
    else:
        # Income: yfinance DataFrame row names are stable here
        try:
            income_annual     = _df_to_periods(t.income_stmt, IS_ROWS, 5)
            income_quarterly  = _df_to_periods(t.quarterly_income_stmt, IS_ROWS, 6)
        except Exception:
            income_annual = income_quarterly = []

        # Balance & cashflow: yfinance DataFrame row names change across versions
        # and frequently don't match BS_ROWS/CF_ROWS → use quoteSummary (stable schema)
        _qs = _qs or _yf_quote_summary(symbol)
        balance_annual    = _parse_qs_balance(_qs, quarterly=False, n=5)
        balance_quarterly = _parse_qs_balance(_qs, quarterly=True,  n=6)
        cashflow_annual   = _parse_qs_cashflow(_qs, quarterly=False, n=5)
        cf_quarterly      = _parse_qs_cashflow(_qs, quarterly=True,  n=6)

        # Fallback income to quoteSummary if yfinance DataFrame also failed
        if not income_annual:
            income_annual    = _parse_qs_income(_qs, quarterly=False, n=5)
            income_quarterly = _parse_qs_income(_qs, quarterly=True,  n=6)

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

    # ── quoteSummary fallback for analyst data when yfinance library fails ─────
    _no_ratings  = sum(ratings.values()) == 0
    _no_targets  = not target_mean
    _no_eps_est  = not eps_estimates
    _no_rev_est  = not revenue_estimates
    _no_eps_surp = not eps_surprises
    if _no_ratings or _no_targets or _no_eps_est or _no_rev_est or _no_eps_surp:
        _qs = _qs or _yf_quote_summary(symbol)
        if _qs:
            # Ratings from recommendationTrend
            if _no_ratings:
                trend = (_qs.get("recommendationTrend") or {}).get("trend", [])
                if trend:
                    row = trend[0]
                    ratings = {
                        "strong_buy":  int(row.get("strongBuy", 0) or 0),
                        "buy":         int(row.get("buy", 0) or 0),
                        "hold":        int(row.get("hold", 0) or 0),
                        "sell":        int(row.get("sell", 0) or 0),
                        "strong_sell": int(row.get("strongSell", 0) or 0),
                    }
            # Price targets from financialData
            fd = _qs.get("financialData") or {}
            if _no_targets:
                target_mean = _qs_raw(fd, "targetMeanPrice") or target_mean
                target_low  = _qs_raw(fd, "targetLowPrice")  or target_low
                target_high = _qs_raw(fd, "targetHighPrice") or target_high
                n_analysts  = int(_qs_raw(fd, "numberOfAnalystOpinions") or n_analysts or 0)
            # EPS / revenue estimates from earningsTrend
            et = (_qs.get("earningsTrend") or {}).get("trend", [])
            if et:
                for item in et:
                    end_date = item.get("endDate") or item.get("period", "")
                    ee  = item.get("earningsEstimate") or {}
                    re_ = item.get("revenueEstimate") or {}
                    if _no_eps_est:
                        eps_estimates.append({
                            "period": end_date,
                            "avg":    _qs_raw(ee, "avg"),
                            "low":    _qs_raw(ee, "low"),
                            "high":   _qs_raw(ee, "high"),
                            "growth": (_qs_raw(ee, "growth") or 0) * 100,
                        })
                    if _no_rev_est:
                        revenue_estimates.append({
                            "period": end_date,
                            "avg":    _qs_raw(re_, "avg"),
                            "low":    _qs_raw(re_, "low"),
                            "high":   _qs_raw(re_, "high"),
                            "growth": (_qs_raw(re_, "growth") or 0) * 100,
                        })
            # EPS surprises from earningsHistory
            if _no_eps_surp:
                hist = (_qs.get("earningsHistory") or {}).get("history", [])
                for item in hist[:8]:
                    q = (item.get("quarter") or {})
                    period = q.get("fmt") or q.get("raw", "")
                    if isinstance(period, (int, float)):
                        from datetime import datetime as _dt
                        period = _dt.utcfromtimestamp(int(period)).strftime("%Y-%m-%d")
                    eps_surprises.append({
                        "period":       str(period)[:7],
                        "actual":       _qs_raw(item, "epsActual"),
                        "estimate":     _qs_raw(item, "epsEstimate"),
                        "surprise":     _qs_raw(item, "epsDifference"),
                        "surprise_pct": (_qs_raw(item, "surprisePercent") or 0) * 100,
                    })
                eps_surprises = list(reversed(eps_surprises))

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


@router.get("/stock-detail/{symbol:path}")
async def get_stock_detail(
    symbol: str,
    include_score: bool = Query(False),
    user_id: str = Depends(get_current_user_id),
):
    """Full stock detail: profile, financial statements, analyst data."""
    result = await asyncio.to_thread(_fetch_stock_detail, symbol.upper())
    if include_score:
        sym = symbol.upper()
        score_cache_key = f"score5:{sym}"
        cached_score = cache_get(score_cache_key)
        if cached_score:
            return {**result, "score": cached_score}
        score_data = _compute_stock_score(result)
        cache_set(score_cache_key, score_data, ttl=3600)
        return {**result, "score": score_data}
    return result


@router.get("/peers/{symbol:path}")
async def get_peers(
    symbol: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return peer/competitor companies using Finnhub + basic price info."""
    sym = _yf_symbol(symbol.upper())
    cache_key = f"peers:{sym}"
    if cached := await redis_get(cache_key):
        return cached

    def _fetch():
        peers = []
        # 1. Get peer tickers from Finnhub
        if _FINNHUB_KEY:
            try:
                r = _requests.get(
                    f"{_FINNHUB_BASE}/stock/peers",
                    params={"symbol": sym},
                    headers={"X-Finnhub-Token": _FINNHUB_KEY},
                    timeout=6,
                )
                if r.status_code == 200:
                    tickers = [t for t in r.json() if t != sym][:7]
                    for t in tickers:
                        try:
                            from app.core.finnhub import fh_quote as _fh_q, fh_profile as _fh_p
                            q = _fh_q(t)
                            pr = _fh_p(t)
                            name = (pr or {}).get("name") or t
                            peers.append({
                                "ticker": t,
                                "name":   name,
                                "price":  round(q["price"], 2) if q and q.get("price") else None,
                                "change_pct": q["change_pct"] if q else None,
                            })
                        except Exception:
                            peers.append({"ticker": t, "name": t, "price": None, "change_pct": None})
            except Exception:
                pass
        return peers

    result = await asyncio.to_thread(_fetch)
    await redis_set(cache_key, result, ttl=3600)
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


def _parse_fin(val) -> float | None:
    """Parse formatted financial number (e.g. '$1.2B', '450M') to float."""
    if val is None:
        return None
    try:
        return float(
            str(val).replace("$","").replace(",","")
                    .replace("B","e9").replace("M","e6")
                    .replace("T","e12").replace("K","e3")
        )
    except Exception:
        return None


# Sector-specific P/E tiers: (threshold, score) — lower P/E → higher score within each sector's norms
_SECTOR_PE_TIERS: dict[str, list] = {
    # Tech & growth: higher P/E is normal; 25-35 is "fair"
    "Technology":             [(12,96),(18,88),(25,80),(30,72),(38,60),(50,44),(70,28),(999,14)],
    "Communication Services": [(12,95),(18,87),(24,78),(30,68),(38,55),(50,38),(70,22),(999,12)],
    # Healthcare: moderate-high P/E acceptable; 20-28 fair
    "Healthcare":             [(12,95),(16,87),(22,78),(28,68),(35,55),(45,38),(60,22),(999,12)],
    # Consumer Cyclical: 15-22 fair
    "Consumer Cyclical":      [(10,96),(14,88),(18,80),(22,70),(28,56),(36,38),(50,22),(999,12)],
    # Consumer Defensive / Staples: 14-20 fair
    "Consumer Defensive":     [(10,96),(14,90),(18,82),(22,72),(27,57),(35,38),(999,18)],
    # Industrials: 14-20 fair
    "Industrials":            [(10,96),(14,88),(18,80),(22,70),(28,55),(36,36),(999,15)],
    # Financials: P/E 8-14 normal; use P/B too
    "Financial Services":     [(7,97),(10,90),(13,82),(16,70),(20,55),(26,36),(999,15)],
    # Materials: 10-16 fair, cyclical
    "Basic Materials":        [(8,96),(12,88),(16,80),(20,68),(25,52),(32,34),(999,14)],
    # Real Estate: 20-30 fair (FFO-based)
    "Real Estate":            [(12,94),(18,86),(24,77),(30,66),(40,48),(55,28),(999,12)],
    # Utilities: 12-18 fair, stable
    "Utilities":              [(10,96),(14,90),(18,82),(23,70),(28,53),(36,32),(999,12)],
    # Energy: cyclical, 8-14 fair
    "Energy":                 [(7,96),(10,88),(14,80),(18,68),(23,52),(30,32),(999,12)],
}
_DEFAULT_PE_TIERS = [(10,95),(15,85),(20,75),(25,65),(30,55),(40,40),(50,28),(999,15)]


def _compute_stock_score(detail: dict) -> dict:
    p = detail.get("profile", {})
    fin = detail.get("financials", {})
    analyst = detail.get("analyst", {})

    sector = p.get("sector", "") or ""

    # ── Valuation metrics ──────────────────────────────────────────────────────
    pe = p.get("pe_ratio")
    fpe = p.get("forward_pe")
    ev_ebitda = p.get("ev_to_ebitda")
    ps = p.get("ps_ratio")
    pb = p.get("pb_ratio")

    # P/E score — sector-adjusted tiers (tech P/E 30 ≠ bank P/E 30)
    pe_tiers = _SECTOR_PE_TIERS.get(sector, _DEFAULT_PE_TIERS)
    if pe is not None and pe < 0:
        pe_score = 20
    else:
        pe_score = _score_val(pe, pe_tiers)
    fpe_score = _score_val(fpe, pe_tiers) if fpe and fpe > 0 else pe_score
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
    # Profile stores these as percentages (×100 from yfinance decimal) — convert back to decimal
    _raw_rg  = p.get("revenue_growth")
    _raw_eg  = p.get("earnings_growth")
    rev_growth  = _raw_rg  / 100 if _raw_rg  is not None else None
    earn_growth = _raw_eg  / 100 if _raw_eg  is not None else None

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
    # Profile stores these as percentages (×100 from yfinance decimal) — convert back to decimal
    _raw_gm  = p.get("gross_margins")
    _raw_om  = p.get("operating_margins")
    _raw_nm  = p.get("profit_margins")
    _raw_roe = p.get("return_on_equity")
    _raw_roa = p.get("return_on_assets")
    gm  = _raw_gm  / 100 if _raw_gm  is not None else None
    om  = _raw_om  / 100 if _raw_om  is not None else None
    nm  = _raw_nm  / 100 if _raw_nm  is not None else None
    roe = _raw_roe / 100 if _raw_roe is not None else None
    roa = _raw_roa / 100 if _raw_roa is not None else None

    gm_score  = _score_val(gm,  [(-1,10),(0,25),(0.1,40),(0.2,55),(0.3,65),(0.4,75),(0.5,85),(0.6,92),(1,100)])
    om_score  = _score_val(om,  [(-1,10),(0,25),(0.05,45),(0.1,60),(0.15,70),(0.2,80),(0.25,90),(1,100)])
    nm_score  = _score_val(nm,  [(-1,10),(0,25),(0.05,50),(0.1,65),(0.15,75),(0.2,85),(0.3,92),(1,100)])
    roe_score = _score_val(roe, [(-1,10),(0,25),(0.05,40),(0.1,55),(0.15,65),(0.2,78),(0.25,88),(0.35,95),(1,100)])
    roa_score = _score_val(roa, [(-1,10),(0,25),(0.03,40),(0.05,55),(0.08,65),(0.12,78),(0.18,90),(1,100)])

    # ── ROIC — must be computed before qual_scores ────────────────────────────
    _bal_annual_q = fin.get("balance", {}).get("annual", [])
    roic: float | None = None
    roic_pct: float | None = None
    roic_trend: list[dict] = []
    roic_score: int | None = None
    is_financial = "Financial" in sector or "Insurance" in sector or "Bank" in sector
    if not is_financial and income_annual and _bal_annual_q:
        inc_rows = list(reversed(income_annual[-5:]))
        bal_rows = list(reversed(_bal_annual_q[-5:]))
        for i, inc_row in enumerate(inc_rows):
            if i >= len(bal_rows):
                break
            bal_row = bal_rows[i]
            period  = str(inc_row.get("period", ""))[:7]
            op_inc  = _parse_fin(inc_row.get("Operating Income"))
            tax_p   = _parse_fin(inc_row.get("Tax Provision"))
            net_inc = _parse_fin(inc_row.get("Net Income"))
            equity  = _parse_fin(bal_row.get("Total Stockholder Equity") or bal_row.get("Stockholders Equity"))
            t_debt  = _parse_fin(bal_row.get("Total Debt") or bal_row.get("Long Term Debt"))
            cash    = _parse_fin(bal_row.get("Cash And Cash Equivalents") or bal_row.get("Cash And Short Term Investments"))
            if op_inc is None or equity is None:
                continue
            pretax = (net_inc or 0) + (tax_p or 0) if net_inc is not None else None
            if pretax and pretax > 0 and tax_p is not None and tax_p >= 0:
                tax_rate = min(max(tax_p / pretax, 0.0), 0.40)
            else:
                tax_rate = 0.21
            nopat   = op_inc * (1 - tax_rate)
            inv_cap = equity + (t_debt or 0) - (cash or 0)
            if inv_cap > 0:
                r = round(nopat / inv_cap * 100, 1)
                roic_trend.append({"year": period, "value": r})
                if i == 0:
                    roic     = nopat / inv_cap
                    roic_pct = r
        if roic is not None:
            roic_score = _score_val(roic, [
                (0.04,12),(0.07,28),(0.10,48),(0.12,62),(0.15,74),(0.20,86),(0.25,94),(999,100)
            ])

    qual_scores = [s for s in [gm_score, om_score, nm_score, roe_score, roa_score, roic_score] if s is not None]
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
                f"Eres un asesor financiero que explica inversiones a personas sin experiencia en finanzas. Analiza '{name}' ({sector}) con estos datos internos (NO los menciones directamente):\n"
                f"- Score general: {overall}/100 (Valoración:{val_score} Crecimiento:{grow_score} Calidad:{qual_score} Salud:{health_score})\n"
                f"- P/E: {pe}, Forward P/E: {fpe}, EV/EBITDA: {ev_ebitda}\n"
                f"- Margen bruto: {round((gm or 0)*100,1)}%, Margen operativo: {round((om or 0)*100,1)}%, Margen neto: {round((nm or 0)*100,1)}%\n"
                f"- Crecimiento de ingresos: {round((rev_growth or 0)*100,1)}%, Crecimiento de ganancias: {round((earn_growth or 0)*100,1)}%\n"
                f"- ROE: {round((roe or 0)*100,1)}%, ROA: {round((roa or 0)*100,1)}%\n"
                f"- Deuda/Capital: {de}, Ratio corriente: {cr}\n"
                f"- Recomendación: {signal}\n\n"
                "REGLAS ESTRICTAS:\n"
                "- Usa lenguaje simple que entienda alguien que nunca ha invertido\n"
                "- PROHIBIDO mencionar: P/E, EV/EBITDA, ROE, ROA, ratio corriente, deuda/capital, márgenes operativos, ni ningún término técnico financiero\n"
                "- Traduce los datos a ideas concretas: en vez de 'P/E alto' di 'la acción está cara comparada con lo que gana'; en vez de 'ROE alto' di 'la empresa es muy eficiente generando ganancias'\n"
                "- Sé directo y conversacional, como si le explicaras a un amigo\n\n"
                "Responde en español con exactamente DOS partes:\n"
                "CORTO: Una sola oración de máximo 20 palabras resumiendo si el negocio es bueno o no (sin mencionar precios ni términos técnicos).\n"
                "LARGO: Dos oraciones en lenguaje simple: primero qué tiene de bueno la empresa, luego qué riesgo tiene o por qué hay que tener cuidado."
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

    # ── Entry range ───────────────────────────────────────────────────────────
    _SECTOR_PE = {
        "Technology": 28, "Communication Services": 22, "Healthcare": 22,
        "Consumer Cyclical": 20, "Consumer Defensive": 19, "Industrials": 20,
        "Financial Services": 14, "Basic Materials": 15, "Real Estate": 20,
        "Utilities": 16, "Energy": 14,
    }
    entry_ranges: list[dict] = []
    try:
        analyst_target = analyst.get("price_target", {}).get("mean") if isinstance(analyst.get("price_target"), dict) else None
        if not analyst_target:
            analyst_target = analyst.get("target_mean")

        if analyst_target:
            try:
                analyst_target = float(str(analyst_target).replace("$", "").replace(",", ""))
            except Exception:
                analyst_target = None

        # Fair value calculation
        # 1. Analyst consensus target — most reliable, use directly
        # 2. PEG-adjusted intrinsic value:
        #    fair_pe = sector_pe × growth_mult × quality_mult
        #    growth_mult: companies growing faster than market (10%) deserve higher P/E
        #    quality_mult: high ROIC/margins deserve a premium
        #    This prevents "everything is cheap" when P/E < sector median
        fair_value = analyst_target
        fair_value_src = "analyst"
        if not fair_value and price:
            base_pe = _SECTOR_PE.get(sector, 20)
            # Growth premium/discount vs 10% market norm (capped at ±100%)
            eg = earn_growth if earn_growth is not None else 0.0
            growth_mult = max(0.5, min(2.0, 1.0 + (eg - 0.10) * 3))
            # Quality premium: score 75+ adds 10%, score <45 subtracts 15%
            qual_mult = 1.10 if qual_score >= 75 else (0.85 if qual_score < 45 else 1.0)
            fair_pe = base_pe * growth_mult * qual_mult

            if fpe and fpe > 0:
                # Forward earnings already priced in — compare fair_pe vs actual fpe
                eps_fwd = price / fpe
                fair_value = round(eps_fwd * fair_pe, 2)
                fair_value_src = "P/E ajustado (fwd)"
            elif pe and pe > 0:
                eps = price / pe
                fair_value = round(eps * fair_pe, 2)
                fair_value_src = "P/E ajustado"

        if fair_value and fair_value > 0 and price:
            fv = fair_value
            price_ratio = price / fv

            def _rng(lo, hi):
                return (None if lo is None else round(lo, 2),
                        None if hi is None else round(hi, 2))

            tiers = [
                {"label": "Muy cara",              "signal": "avoid",   "color": "#ef4444", "lo": fv * 1.15, "hi": None},
                {"label": "Cara, esperar bajada",  "signal": "wait",    "color": "#f97316", "lo": fv * 1.05, "hi": fv * 1.15},
                {"label": "Precio justo",          "signal": "neutral", "color": "#f59e0b", "lo": fv * 0.95, "hi": fv * 1.05},
                {"label": "Buen rango para entrar","signal": "good",    "color": "#22c55e", "lo": fv * 0.80, "hi": fv * 0.95},
                {"label": "Barata, oportunidad",   "signal": "strong",  "color": "#10b981", "lo": None,      "hi": fv * 0.80},
            ]
            for t in tiers:
                lo, hi = t["lo"], t["hi"]
                is_current = (
                    (lo is None or price >= lo) and
                    (hi is None or price < hi)
                )
                entry_ranges.append({
                    "label":      t["label"],
                    "signal":     t["signal"],
                    "color":      t["color"],
                    "min":        round(lo, 2) if lo is not None else None,
                    "max":        round(hi, 2) if hi is not None else None,
                    "is_current": is_current,
                })

            entry_ranges_meta = {
                "fair_value":     round(fair_value, 2),
                "fair_value_src": fair_value_src,
                "current_price":  round(price, 2),
            }
        else:
            entry_ranges_meta = None
    except Exception:
        entry_ranges_meta = None

    return {
        "overall_score": overall,
        "grade": grade,
        "signal": signal,
        "verdict_short": verdict_short,
        "verdict_long": verdict_long,
        "entry_ranges": entry_ranges,
        "entry_ranges_meta": entry_ranges_meta,
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
                        "label": _pe_label(pe, sector),
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
                    *([{
                        "name": "Retorno sobre Capital Invertido (ROIC)",
                        "value": f"{roic_pct:.1f}%" if roic_pct is not None else "—",
                        "score": roic_score,
                        "label": _roic_label(roic),
                        "trend": roic_trend,
                        "chart_type": "line",
                        "lower_is_better": False,
                    }] if roic_score is not None else []),
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


def _pe_label(v, sector: str = "") -> str:
    if v is None: return "Sin datos"
    if v < 0:     return "Empresa no rentable"
    # Use sector-aware thresholds for descriptive labels
    tech_like = sector in ("Technology", "Communication Services")
    fin_like  = "Financial" in sector
    if fin_like:
        if v < 8:   return "Muy barato para el sector"
        if v < 12:  return "Valoración atractiva"
        if v < 16:  return "Valoración razonable"
        if v < 22:  return "Ligeramente elevado"
        return "Caro para el sector financiero"
    if tech_like:
        if v < 15:  return "Muy barato para tecnología"
        if v < 25:  return "Valoración razonable"
        if v < 35:  return "Prima de crecimiento normal"
        if v < 50:  return "Valoración exigente"
        return "Muy caro, descuenta mucho crecimiento"
    # Default
    if v < 10:    return "Valoración muy atractiva"
    if v < 15:    return "Por debajo de 15x, atractivo"
    if v < 20:    return "Valoración razonable"
    if v < 25:    return "Ligeramente elevado"
    if v < 35:    return "Prima de crecimiento"
    return "Valoración exigente"


def _roic_label(v: float | None) -> str:
    if v is None: return "Sin datos"
    if v >= 0.25: return "Excepcional — ventaja competitiva clara"
    if v >= 0.20: return "Muy alto — negocio de alta calidad"
    if v >= 0.15: return "Sólido — genera valor por encima del costo de capital"
    if v >= 0.12: return "Bueno — por encima del promedio del mercado"
    if v >= 0.08: return "Aceptable — cerca del costo de capital"
    if v >= 0.04: return "Bajo — destruye poco o nada de valor"
    return "Negativo — destruye valor para los accionistas"


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


@router.get("/stock-score/{symbol:path}")
async def get_stock_score(
    symbol: str,
    user_id: str = Depends(get_current_user_id),
):
    """AI quality score + verdict for a stock (0-100, 8 metrics, 4 categories)."""
    sym = _yf_symbol(symbol.upper())
    cache_key = f"score5:{sym}"
    cached = cache_get(cache_key)
    if cached:
        return cached
    detail = await asyncio.to_thread(_fetch_stock_detail, sym)
    result = _compute_stock_score(detail)
    cache_set(cache_key, result, ttl=3600)
    return result


@router.get("/stock-income-analysis/{symbol:path}")
async def get_stock_income_analysis(
    symbol: str,
    user_id: str = Depends(get_current_user_id),
):
    """AI-generated analysis of a stock's income statement trends (cached 12h)."""
    sym = _yf_symbol(symbol.upper())
    cache_key = f"income_ai:{sym}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    detail = await asyncio.to_thread(_fetch_stock_detail, sym)
    income_rows = detail.get("financials", {}).get("income", {}).get("annual", [])
    name = detail.get("profile", {}).get("name", sym)

    if not income_rows:
        return {"analysis": ""}

    def _fmt(v):
        if v is None:
            return "N/A"
        try:
            n = float(v)
            if abs(n) >= 1e12: return f"${n/1e12:.1f}T"
            if abs(n) >= 1e9:  return f"${n/1e9:.1f}B"
            if abs(n) >= 1e6:  return f"${n/1e6:.1f}M"
            return f"${n:,.0f}"
        except Exception:
            return str(v)

    def _pct(v):
        try:
            return f"{float(v):.1f}%" if v is not None else "N/A"
        except Exception:
            return "N/A"

    rows_text = []
    for r in income_rows[-5:]:
        period = str(r.get("period", ""))[:4]
        rows_text.append(
            f"{period}: Ingresos={_fmt(r.get('Total Revenue'))} | "
            f"Utilidad Bruta={_fmt(r.get('Gross Profit'))} ({_pct(r.get('Gross Margin %'))}) | "
            f"EBITDA={_fmt(r.get('EBITDA'))} | "
            f"Utilidad Neta={_fmt(r.get('Net Income'))} ({_pct(r.get('Net Margin %'))})"
        )

    prompt = (
        f"Eres un analista financiero experto. Analiza el Estado de Resultados de {name} ({sym}):\n\n"
        + "\n".join(rows_text)
        + "\n\nEscribe un análisis en español de 3-4 oraciones para inversionistas. Cubre: "
        "1) Tendencia de ingresos, 2) Evolución de márgenes, 3) Una señal positiva y un riesgo. "
        "Sé concreto con cifras. No uses bullet points."
    )

    analysis = ""
    try:
        _ant_key = os.getenv("ANTHROPIC_API_KEY", "")
        if _ant_key:
            client_ant = anthropic.Anthropic(api_key=_ant_key)
            msg = client_ant.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=320,
                messages=[{"role": "user", "content": prompt}],
            )
            analysis = msg.content[0].text.strip()
    except Exception:
        pass

    result = {"analysis": analysis}
    cache_set(cache_key, result, ttl=43200)
    return result


_FX_FALLBACK_RATES: dict[str, float] = {
    "MXN": 18.5,  "EUR": 0.92, "GBP": 0.79, "CAD": 1.38,
    "ARS": 1150,  "BRL": 5.7,  "COP": 4200, "CLP": 960,
    "PEN": 3.75,  "JPY": 155,  "AUD": 1.55, "CHF": 0.89,
    "NZD": 1.68,  "INR": 83.5, "CNY": 7.25, "HKD": 7.82,
    "SGD": 1.35,  "TRY": 32.5, "ZAR": 18.8, "SEK": 10.6,
    "NOK": 10.8,  "DKK": 6.85, "PLN": 4.05, "HUF": 365,
    "CZK": 22.8,  "KRW": 1360, "THB": 35.5, "PHP": 56.5,
}


@router.get("/fx-rate")
async def get_fx_rate(to: str = "USD"):
    """Real-time USD → {to} exchange rate. Cached 1 hour.

    Source priority:
    1. open.er-api.com  — free, no key, 1500+ currencies, updated every 24h
    2. frankfurter.app  — ECB official rates (EUR-centric, covers ~30 currencies)
    3. yfinance         — market FX tick (slow on Railway, kept as last live option)
    4. hardcoded fallback — always returns something reasonable
    """
    if to.upper() == "USD":
        return {"rate": 1.0, "pair": "USD/USD", "source": "exact"}

    to = to.upper()
    cache_key = f"fx:USD:{to}:v2"
    cached = cache_get(cache_key)
    if cached:
        return cached

    result = None
    import httpx as _httpx

    # 1. open.er-api.com — free, no auth, covers ARS/COP/CLP/PEN/etc.
    if not result:
        try:
            async with _httpx.AsyncClient(timeout=6) as client:
                resp = await client.get("https://open.er-api.com/v6/latest/USD")
                d = resp.json()
                if d.get("result") == "success":
                    rate = (d.get("rates") or {}).get(to)
                    if rate and float(rate) > 0:
                        result = {"rate": round(float(rate), 6), "pair": f"USD/{to}", "source": "open.er-api"}
        except Exception:
            pass

    # 2. frankfurter.app — ECB rates, ~30 currencies
    if not result:
        try:
            async with _httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"https://api.frankfurter.app/latest?from=USD&to={to}")
                d = resp.json()
                rate = (d.get("rates") or {}).get(to)
                if rate and float(rate) > 0:
                    result = {"rate": round(float(rate), 6), "pair": f"USD/{to}", "source": "frankfurter"}
        except Exception:
            pass

    # 3. yfinance — market FX tick (slow, last live resort)
    if not result:
        try:
            import asyncio as _asyncio

            def _yf_rate():
                t = yf.Ticker(f"USD{to}=X")
                try:
                    rate = t.fast_info.last_price
                    if rate and float(rate) > 0:
                        return float(rate)
                except Exception:
                    pass
                try:
                    hist = t.history(period="5d", interval="1d")
                    if not hist.empty:
                        return float(hist["Close"].iloc[-1])
                except Exception:
                    pass
                return None

            rate = await _asyncio.to_thread(_yf_rate)
            if rate:
                result = {"rate": round(rate, 6), "pair": f"USD/{to}", "source": "yfinance"}
        except Exception:
            pass

    # 4. Hardcoded fallback — always returns something
    if not result and to in _FX_FALLBACK_RATES:
        result = {"rate": _FX_FALLBACK_RATES[to], "pair": f"USD/{to}", "source": "fallback"}

    if result:
        ttl = 3600 if result["source"] not in ("fallback",) else 300
        cache_set(cache_key, result, ttl=ttl)
        return result

    return {"rate": _FX_FALLBACK_RATES.get(to, 1.0), "pair": f"USD/{to}", "source": "fallback"}
