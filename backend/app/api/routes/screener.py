import asyncio
from fastapi import APIRouter, Depends
import yfinance as yf
from app.api.deps import get_current_user_id
from app.services import ai_service
from app.api.routes.market import _get_user_profile
from app.core.cache import cache_get, cache_set

router = APIRouter(prefix="/market/screener", tags=["screener"])

UNIVERSE = [
    # Technology
    {"ticker": "AAPL",  "name": "Apple",           "sector": "Tech"},
    {"ticker": "MSFT",  "name": "Microsoft",        "sector": "Tech"},
    {"ticker": "NVDA",  "name": "NVIDIA",           "sector": "Tech"},
    {"ticker": "GOOGL", "name": "Alphabet",         "sector": "Tech"},
    {"ticker": "META",  "name": "Meta",             "sector": "Tech"},
    {"ticker": "AMZN",  "name": "Amazon",           "sector": "Tech"},
    {"ticker": "TSLA",  "name": "Tesla",            "sector": "Tech"},
    {"ticker": "AMD",   "name": "AMD",              "sector": "Tech"},
    {"ticker": "CRM",   "name": "Salesforce",       "sector": "Tech"},
    {"ticker": "ADBE",  "name": "Adobe",            "sector": "Tech"},
    {"ticker": "ORCL",  "name": "Oracle",           "sector": "Tech"},
    {"ticker": "PLTR",  "name": "Palantir",         "sector": "Tech"},
    {"ticker": "NFLX",  "name": "Netflix",          "sector": "Tech"},
    {"ticker": "UBER",  "name": "Uber",             "sector": "Tech"},
    {"ticker": "SHOP",  "name": "Shopify",          "sector": "Tech"},
    # Finance
    {"ticker": "JPM",   "name": "JPMorgan",         "sector": "Finance"},
    {"ticker": "GS",    "name": "Goldman Sachs",    "sector": "Finance"},
    {"ticker": "V",     "name": "Visa",             "sector": "Finance"},
    {"ticker": "MA",    "name": "Mastercard",       "sector": "Finance"},
    {"ticker": "BAC",   "name": "Bank of America",  "sector": "Finance"},
    {"ticker": "MS",    "name": "Morgan Stanley",   "sector": "Finance"},
    {"ticker": "BRK-B", "name": "Berkshire",        "sector": "Finance"},
    {"ticker": "PYPL",  "name": "PayPal",           "sector": "Finance"},
    # Healthcare
    {"ticker": "LLY",   "name": "Eli Lilly",        "sector": "Salud"},
    {"ticker": "NVO",   "name": "Novo Nordisk",     "sector": "Salud"},
    {"ticker": "JNJ",   "name": "J&J",              "sector": "Salud"},
    {"ticker": "ABBV",  "name": "AbbVie",           "sector": "Salud"},
    {"ticker": "UNH",   "name": "UnitedHealth",     "sector": "Salud"},
    {"ticker": "PFE",   "name": "Pfizer",           "sector": "Salud"},
    # Consumer
    {"ticker": "WMT",   "name": "Walmart",          "sector": "Consumo"},
    {"ticker": "MCD",   "name": "McDonald's",       "sector": "Consumo"},
    {"ticker": "KO",    "name": "Coca-Cola",        "sector": "Consumo"},
    {"ticker": "PEP",   "name": "PepsiCo",          "sector": "Consumo"},
    {"ticker": "COST",  "name": "Costco",           "sector": "Consumo"},
    {"ticker": "NKE",   "name": "Nike",             "sector": "Consumo"},
    {"ticker": "DIS",   "name": "Disney",           "sector": "Consumo"},
    # Energy
    {"ticker": "XOM",   "name": "ExxonMobil",       "sector": "Energía"},
    {"ticker": "CVX",   "name": "Chevron",          "sector": "Energía"},
    {"ticker": "COP",   "name": "ConocoPhillips",   "sector": "Energía"},
    # ETFs
    {"ticker": "SPY",   "name": "S&P 500 ETF",      "sector": "ETF"},
    {"ticker": "QQQ",   "name": "Nasdaq 100 ETF",   "sector": "ETF"},
    {"ticker": "VTI",   "name": "Total Market ETF", "sector": "ETF"},
    {"ticker": "GLD",   "name": "Gold ETF",         "sector": "ETF"},
    {"ticker": "ARKK",  "name": "ARK Innovation",   "sector": "ETF"},
]

_TTL = 4 * 3600  # 4 hours


def _fetch_one(entry: dict) -> dict:
    ticker = entry["ticker"]
    cached = cache_get(f"screener:{ticker}")
    if cached:
        return cached
    try:
        t  = yf.Ticker(ticker)
        fi = t.fast_info
        info = t.info or {}
        price    = float(fi.last_price)   if fi.last_price    else None
        prev     = float(fi.previous_close) if fi.previous_close else None
        chg_pct  = round((price - prev) / prev * 100, 2) if price and prev else None
        mkt_cap  = info.get("marketCap")
        pe       = info.get("trailingPE")
        fwd_pe   = info.get("forwardPE")
        rev_gr   = info.get("revenueGrowth")      # e.g. 0.15 = 15%
        margin   = info.get("profitMargins")
        div_yield= info.get("dividendYield")
        recom    = info.get("recommendationKey", "")

        # Simple composite score 0-100
        score = 50
        if rev_gr   and rev_gr   > 0.20: score += 15
        elif rev_gr and rev_gr   > 0.10: score += 8
        if margin   and margin   > 0.20: score += 15
        elif margin and margin   > 0.10: score += 8
        if fwd_pe:
            if fwd_pe < 20:  score += 15
            elif fwd_pe < 30: score += 8
            elif fwd_pe > 50: score -= 10
        if recom in ("strong_buy", "buy"): score += 10
        elif recom in ("sell", "strong_sell"): score -= 15
        score = max(0, min(100, score))

        data = {
            "ticker":    ticker,
            "name":      entry["name"],
            "sector":    entry["sector"],
            "price":     round(price, 2) if price else None,
            "change_pct": chg_pct,
            "market_cap": mkt_cap,
            "pe":         round(pe, 1)     if pe     else None,
            "fwd_pe":     round(fwd_pe, 1) if fwd_pe else None,
            "rev_growth": round(rev_gr * 100, 1) if rev_gr else None,
            "margin":     round(margin * 100, 1)  if margin else None,
            "div_yield":  round(div_yield * 100, 2) if div_yield else None,
            "recom":      recom,
            "score":      score,
        }
        cache_set(f"screener:{ticker}", data, ttl=_TTL)
        return data
    except Exception:
        return {**entry, "price": None, "score": 0}


def _fetch_batch(entries: list[dict]) -> list[dict]:
    results = [_fetch_one(e) for e in entries]
    return [r for r in results if r.get("price") is not None]


@router.post("")
async def screen(request: dict, user_id: str = Depends(get_current_user_id)):
    sector  = request.get("sector")   # None = all
    query   = request.get("query", "").strip()

    subset = [s for s in UNIVERSE if not sector or s["sector"] == sector]

    # Fetch up to 20 stocks (cached after first call)
    stocks = await asyncio.to_thread(_fetch_batch, subset[:20])
    stocks.sort(key=lambda x: x.get("score", 0), reverse=True)

    ai_insight = None
    if query and stocks:
        profile = _get_user_profile(user_id)
        ai_insight = await ai_service.screen_stocks(stocks, query, profile)

    return {"results": stocks[:15], "ai_insight": ai_insight}


@router.get("/weekly")
async def weekly_picks(
    tickers: str = "",
    user_id: str = Depends(get_current_user_id),
):
    """Return 5 personalized weekly picks based on user profile and existing portfolio."""
    from datetime import datetime as _dt
    existing = [t.strip().upper() for t in tickers.split(",") if t.strip()]

    # Cache per user per week (Mon–Sun)
    week_num  = _dt.now().isocalendar()[1]
    year      = _dt.now().year
    cache_key = f"screener:weekly:{user_id}:{year}:{week_num}"
    cached    = cache_get(cache_key)
    if cached:
        return cached

    # Fetch all universe stocks (cached 4h by _fetch_one)
    stocks = await asyncio.to_thread(_fetch_batch, UNIVERSE)
    stocks.sort(key=lambda x: x.get("score", 0), reverse=True)
    # Filter out stocks already in portfolio
    candidates = [s for s in stocks if s["ticker"] not in existing]

    profile = _get_user_profile(user_id)
    result  = await ai_service.generate_weekly_picks(candidates, profile, existing)
    result["generated_at"] = _dt.now().isoformat()

    cache_set(cache_key, result, ttl=_TTL)  # 4h, refreshes once a day at most
    return result


@router.post("/alert-context")
async def alert_context(request: dict, user_id: str = Depends(get_current_user_id)):
    """Return AI context for a price alert (called when user taps an alert)."""
    ticker    = request.get("ticker", "").upper()
    change_pct = request.get("change_pct", 0)
    profile   = _get_user_profile(user_id)
    direction = "subió" if change_pct >= 0 else "cayó"
    event     = f"{ticker} {direction} {abs(change_pct):.1f}% hoy"
    insight   = await ai_service.generate_alert_context(ticker, change_pct, profile)
    return {"ticker": ticker, "change_pct": change_pct, "insight": insight}
