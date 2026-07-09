"""
Real year-by-year portfolio backtest (1985-today).

Applies the user's CURRENT portfolio weights retroactively to each real
calendar year, using actual per-ticker annual returns. For years before a
held ticker existed (no price data that far back), that position's slice
falls back to the S&P 500 return for that year.
"""

import asyncio
import logging
from datetime import datetime, timezone
from collections import defaultdict

from app.core.cache import cache_get, cache_set

logger = logging.getLogger("uvicorn.error")

BACKTEST_START_YEAR = 1985
_ANNUAL_PX_TTL = 7 * 86400  # 7 days — closed years never change

# S&P 500 total annual return (price + dividends), %, 1985-2025.
SP500_ANNUAL_RETURNS: dict[int, float] = {
    1985: 31.7, 1986: 18.7, 1987: 5.3, 1988: 16.6, 1989: 31.7,
    1990: -3.1, 1991: 30.5, 1992: 7.6, 1993: 10.1, 1994: 1.3,
    1995: 37.6, 1996: 23.0, 1997: 33.4, 1998: 28.6, 1999: 21.0,
    2000: -9.1, 2001: -11.9, 2002: -22.1, 2003: 28.7, 2004: 10.9,
    2005: 4.9, 2006: 15.8, 2007: 5.5, 2008: -37.0, 2009: 26.5,
    2010: 15.1, 2011: 2.1, 2012: 16.0, 2013: 32.4, 2014: 13.7,
    2015: 1.4, 2016: 12.0, 2017: 21.8, 2018: -4.4, 2019: 31.5,
    2020: 18.4, 2021: 28.7, 2022: -18.1, 2023: 26.3, 2024: 25.0,
    2025: 20.0,  # partial/estimated if run before year-end
}


def _current_year() -> int:
    return datetime.now(timezone.utc).year


def _fetch_max_history(symbol: str) -> dict | None:
    """Full price history for a ticker, reusing the same fallback chain as /market/chart."""
    from app.api.routes.market import _yf_v8_chart, _yfinance_chart_fallback, _yf_symbol

    sym = _yf_symbol(symbol.upper().strip())
    result = _yf_v8_chart(sym, "max", "3mo")
    if result:
        return result
    return _yfinance_chart_fallback(sym, "max", "3mo")


def get_annual_prices(ticker: str) -> dict[int, float]:
    """Year-end (last available) close price per calendar year, cached."""
    cache_key = f"annual_px:{ticker.upper()}"
    cached = cache_get(cache_key)
    if cached is not None:
        return {int(y): p for y, p in cached.items()}

    result = _fetch_max_history(ticker)
    if not result:
        cache_set(cache_key, {}, ttl=3600)  # short TTL on failure — allow retry soon
        return {}

    year_price: dict[int, float] = {}
    for ts_str, price in zip(result["timestamps"], result["prices"]):
        try:
            year = int(ts_str[:4])
        except (ValueError, TypeError):
            continue
        year_price[year] = price  # last write wins — points arrive in chronological order

    cache_set(cache_key, year_price, ttl=_ANNUAL_PX_TTL)
    return year_price


def compute_ticker_annual_returns(ticker: str) -> dict[int, float]:
    """% return for each year where both this year's and last year's price exist."""
    prices = get_annual_prices(ticker)
    if not prices:
        return {}
    returns: dict[int, float] = {}
    for year in prices:
        prev = prices.get(year - 1)
        cur = prices.get(year)
        if prev and cur and prev != 0:
            returns[year] = round((cur / prev - 1) * 100, 2)
    return returns


async def run_historical_backtest(positions: list[dict]) -> dict:
    """
    positions: [{ticker, shares, avg_price}]
    Returns {"years": [{year, portfolio_return_pct, sp500_return_pct, substituted}, ...]}
    sorted most-recent year first.
    """
    valued = []
    total = 0.0
    for p in positions:
        ticker = str(p.get("ticker", "")).upper().strip()
        shares = float(p.get("shares") or 0)
        avg_price = float(p.get("avg_price") or 0)
        invested = shares * avg_price
        if not ticker or invested <= 0:
            continue
        valued.append({"ticker": ticker, "invested": invested})
        total += invested

    if not valued or total <= 0:
        return {"years": []}

    for v in valued:
        v["weight"] = v["invested"] / total

    tickers = [v["ticker"] for v in valued]
    returns_by_ticker = await asyncio.gather(
        *(asyncio.to_thread(compute_ticker_annual_returns, t) for t in tickers)
    )
    returns_map = dict(zip(tickers, returns_by_ticker))

    end_year = _current_year()
    years_out = []
    for year in range(end_year, BACKTEST_START_YEAR - 1, -1):
        sp500_return = SP500_ANNUAL_RETURNS.get(year)
        if sp500_return is None:
            continue

        portfolio_return = 0.0
        substituted = False
        for v in valued:
            ticker_return = returns_map.get(v["ticker"], {}).get(year)
            if ticker_return is None:
                ticker_return = sp500_return
                substituted = True
            portfolio_return += v["weight"] * ticker_return

        years_out.append({
            "year": year,
            "portfolio_return_pct": round(portfolio_return, 2),
            "sp500_return_pct": sp500_return,
            "substituted": substituted,
        })

    return {"years": years_out}
