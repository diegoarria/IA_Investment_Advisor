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


def _fetch_events_for_symbol(symbol: str) -> list[dict]:
    """Return all calendar events (earnings + dividends) for one symbol."""
    key = f"events:cal:{symbol}"
    cached = cache_get(key)
    if cached is not None:
        return cached

    today        = datetime.now().date()
    window_start = today - timedelta(days=7)
    window_end   = today + timedelta(days=90)
    events: list[dict] = []

    try:
        t    = yf.Ticker(symbol)
        info = t.info or {}

        # ── Earnings dates ────────────────────────────────────────────────────
        cal = t.calendar
        if cal is not None and not cal.empty and "Earnings Date" in cal.index:
            raw_dates = cal.loc["Earnings Date"]
            dates_iter = list(raw_dates) if hasattr(raw_dates, "__iter__") else [raw_dates]
            for d in dates_iter:
                try:
                    dt = d.date() if hasattr(d, "date") else d
                    if window_start <= dt <= window_end:
                        events.append({
                            "ticker":     symbol,
                            "event_date": str(dt),
                            "event_type": "earnings",
                            "status":     "past" if dt < today else "today" if dt == today else "upcoming",
                        })
                except Exception:
                    continue

        # ── Ex-dividend date ──────────────────────────────────────────────────
        ex_ts = info.get("exDividendDate")
        if ex_ts:
            try:
                ex_dt = datetime.utcfromtimestamp(int(ex_ts)).date()
                if window_start <= ex_dt <= window_end:
                    # Try to get dividend amount from recent history
                    div_amount: float | None = None
                    try:
                        divs = t.dividends
                        if divs is not None and not divs.empty:
                            div_amount = round(float(divs.iloc[-1]), 4)
                    except Exception:
                        pass
                    events.append({
                        "ticker":         symbol,
                        "event_date":     str(ex_dt),
                        "event_type":     "ex_dividend",
                        "status":         "past" if ex_dt < today else "today" if ex_dt == today else "upcoming",
                        "dividend_amount": div_amount,
                        "dividend_yield":  round(float(info.get("dividendYield") or 0) * 100, 2),
                    })
            except Exception:
                pass

        # ── Dividend payment date ─────────────────────────────────────────────
        pay_ts = info.get("dividendDate")
        if pay_ts:
            try:
                pay_dt = datetime.utcfromtimestamp(int(pay_ts)).date()
                if window_start <= pay_dt <= window_end:
                    events.append({
                        "ticker":     symbol,
                        "event_date": str(pay_dt),
                        "event_type": "dividend",
                        "status":     "past" if pay_dt < today else "today" if pay_dt == today else "upcoming",
                    })
            except Exception:
                pass

    except Exception:
        pass

    # Fallback: at least return an empty-date earnings entry so the ticker shows in the list
    if not events:
        events.append({"ticker": symbol, "event_date": None, "event_type": "earnings", "status": "unknown"})

    cache_set(key, events, ttl=_TTL_CALENDAR)
    return events


def _fetch_earnings_calendar(symbols: list[str]) -> list[dict]:
    """Return all calendar events for a list of symbols (earnings + dividends)."""
    all_events: list[dict] = []
    for symbol in symbols:
        all_events.extend(_fetch_events_for_symbol(symbol))
    return all_events


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
    # Sort: upcoming/today first, then past, then unknown; secondary by date
    order = {"upcoming": 0, "today": 0, "past": 1, "unknown": 2}
    results.sort(key=lambda x: (order.get(x["status"], 2), x.get("event_date") or ""))
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
