import asyncio
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
import yfinance as yf
from app.api.deps import get_current_user_id
from app.api.routes.market import _get_user_profile
from app.core.cache import cache_get, cache_set
from app.services import ai_service

router = APIRouter(prefix="/earnings", tags=["earnings"])

_TTL_CALENDAR = 3600   # 1 hour
_TTL_ANALYSIS = 1800   # 30 minutes


def _fetch_earnings_calendar(symbols: list[str]) -> list[dict]:
    """Return upcoming + recent earnings dates for a list of symbols."""
    results = []
    today = datetime.now().date()
    window_start = today - timedelta(days=7)
    window_end   = today + timedelta(days=30)

    for symbol in symbols:
        key = f"earnings:cal:{symbol}"
        cached = cache_get(key)
        if cached:
            results.append(cached)
            continue
        try:
            t = yf.Ticker(symbol)
            cal = t.calendar
            entry: dict = {"ticker": symbol, "earnings_date": None, "status": "unknown"}
            if cal is not None and not cal.empty and "Earnings Date" in cal.index:
                raw_dates = cal.loc["Earnings Date"]
                if hasattr(raw_dates, "__iter__"):
                    dates = [d for d in raw_dates if d is not None]
                else:
                    dates = [raw_dates]
                for d in dates:
                    try:
                        dt = d.date() if hasattr(d, "date") else d
                        if window_start <= dt <= window_end:
                            entry["earnings_date"] = str(dt)
                            entry["status"] = "past" if dt <= today else "upcoming"
                            break
                    except Exception:
                        continue
            cache_set(key, entry, ttl=_TTL_CALENDAR)
            results.append(entry)
        except Exception:
            results.append({"ticker": symbol, "earnings_date": None, "status": "unknown"})
    return results


def _fetch_earnings_data(symbol: str) -> dict:
    """Fetch latest earnings figures for analysis."""
    key = f"earnings:data:{symbol}"
    cached = cache_get(key)
    if cached:
        return cached
    try:
        t = yf.Ticker(symbol)
        info = t.info or {}
        # Quarterly financials
        qf = t.quarterly_financials
        qe = t.quarterly_earnings

        eps_actual   = None
        eps_estimate = None
        rev_actual   = None
        rev_estimate = None
        highlights   = []

        if qe is not None and not qe.empty:
            latest = qe.iloc[0]
            eps_actual   = round(float(latest.get("Reported EPS", 0) or 0), 4)
            eps_estimate = round(float(latest.get("EPS Estimate",  0) or 0), 4)

        if qf is not None and not qf.empty:
            rev_row = qf[qf.index == "Total Revenue"]
            if not rev_row.empty:
                rev_val = rev_row.iloc[0, 0]
                rev_actual = round(float(rev_val) / 1e9, 2) if rev_val else None

        rev_estimate_raw = info.get("revenueEstimate", {})
        if isinstance(rev_estimate_raw, dict):
            rev_estimate = round(rev_estimate_raw.get("avg", 0) / 1e9, 2)
        elif isinstance(rev_estimate_raw, (int, float)):
            rev_estimate = round(rev_estimate_raw / 1e9, 2)

        rev_growth = info.get("revenueGrowth")
        if rev_growth:
            highlights.append(f"Crecimiento de ingresos: {round(rev_growth * 100, 1)}% YoY")
        margin = info.get("profitMargins")
        if margin:
            highlights.append(f"Margen neto: {round(margin * 100, 1)}%")
        forward_pe = info.get("forwardPE")
        if forward_pe:
            highlights.append(f"P/E forward: {round(forward_pe, 1)}x")

        data = {
            "symbol":        symbol,
            "name":          info.get("shortName", symbol),
            "current_price": round(float(info.get("currentPrice", 0) or 0), 2),
            "eps_actual":    eps_actual,
            "eps_estimate":  eps_estimate,
            "revenue_actual": rev_actual,
            "revenue_estimate": rev_estimate,
            "guidance":      info.get("forwardEps", "No disponible"),
            "highlights":    " | ".join(highlights),
        }
        cache_set(key, data, ttl=_TTL_ANALYSIS)
        return data
    except Exception as e:
        return {"symbol": symbol, "error": str(e)}


@router.get("/calendar")
async def get_earnings_calendar(
    symbols: str = "",
    user_id: str = Depends(get_current_user_id),
):
    """Return upcoming/recent earnings for user's portfolio symbols."""
    ticker_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not ticker_list:
        return {"earnings": []}

    results = await asyncio.to_thread(_fetch_earnings_calendar, ticker_list[:20])
    # Sort: upcoming first, then past, then unknown
    order = {"upcoming": 0, "past": 1, "unknown": 2}
    results.sort(key=lambda x: (order.get(x["status"], 2), x.get("earnings_date") or ""))
    return {"earnings": results}


@router.get("/analysis/{symbol}")
async def get_earnings_analysis(
    symbol: str,
    shares: float = 0,
    avg_cost: float = 0,
    user_id: str = Depends(get_current_user_id),
):
    """AI analysis of latest earnings for a symbol."""
    symbol = symbol.upper()
    cache_key = f"earnings:ai:{symbol}"
    cached = cache_get(cache_key)

    earnings_data = await asyncio.to_thread(_fetch_earnings_data, symbol)
    if "error" in earnings_data:
        return {"symbol": symbol, "analysis": "No se pudieron obtener los datos de earnings.", "earnings_data": {}}

    # Only generate new AI analysis if not cached
    if not cached:
        profile  = _get_user_profile(user_id)
        position = {"shares": shares, "avg_cost": avg_cost} if shares else None
        analysis = await ai_service.analyze_earnings(symbol, earnings_data, position, profile)
        cache_set(cache_key, analysis, ttl=_TTL_ANALYSIS)
    else:
        analysis = cached

    return {"symbol": symbol, "analysis": analysis, "earnings_data": earnings_data}
