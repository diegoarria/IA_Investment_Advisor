"""
Valuation Backtest — "What $10,000 became" panel (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

IMPORTANT HONESTY CONSTRAINT: this codebase has never stored a historical
record of which tickers Nuvos's valuation engine flagged as under/
overvalued at any PAST point in time (confirmed by inspection — no
migration/table for it, the weekly undervalued screener only overwrites a
single Redis key with today's result). A genuine point-in-time signal
backtest ("if you'd bought what the signal said 5 years ago") is therefore
NOT reconstructible from real data.

What IS real and honest: applying TODAY's real classification (from the
redesigned Nuvos AI Fair Value Engine, see fundamental_analysis_service.py's
`nuvos_fair_value`) to 5 real years of monthly closing prices (yfinance),
for an equal-weighted basket of real curated-universe tickers, vs. a real
SPY-tracked S&P 500 basket. This is "what would $10,000 be worth today if
you'd bought today's undervalued/overvalued picks 5 years ago" — a
different, weaker methodology than a true backtest (survivorship/hindsight
bias: today's "cheap" bucket over-represents past winners), which the
frontend MUST label accordingly, never as "backtest" implying a genuine
historical signal.

Computed weekly, piggy-backing on undervalued_screener_service.
refresh_undervalued_screener()'s own already-paid-for full-universe scan
(same `analysis_cache` — zero extra get_fundamental_analysis calls) — see
that function's tail call into refresh_valuation_backtest() below.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from app.core.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

CACHE_KEY = "valuation_backtest:v1"
CACHE_TTL = 8 * 24 * 3600  # slightly over a week, same reasoning as undervalued_screener_service

_BASKET_SIZE = 15          # equal-weighted names per bucket — enough to diversify away single-ticker noise
_MIN_BASKET_SIZE = 5        # never publish a "basket" built from too few real survivors
_MONTHS_WINDOW = 61         # ~5 years of monthly closes ("5y"/"1mo" from yfinance, trimmed to a clean window)
_VERDICT_THRESHOLD_PCT = 5.0  # same ±5% "fair value" band as shared.tsx's _valuationStatus


def _classify_ticker(ticker: str, data: Optional[dict]) -> Optional[dict]:
    """Same asymmetric formula as frontend/web's `_valuationStatus` (shared.tsx)
    — value-denominator margin of safety when undervalued, price-denominator
    premium when overvalued — applied here so the backend's bucket
    assignment matches exactly what a user sees on that ticker's own page.
    Returns None (never a guess) when this ticker's real price or real
    Nuvos base-scenario fair value isn't available."""
    if not data:
        return None
    price = data.get("current_price")
    nuvos = ((data.get("dcf") or {}).get("nuvos_fair_value") or {})
    base = (nuvos.get("scenarios") or {}).get("base") or {}
    fair_value = base.get("fair_value_per_share")
    if not price or price <= 0 or not fair_value or fair_value <= 0:
        return None

    if price > fair_value:
        pct = (price - fair_value) / price * 100
        verdict = "overvalued" if pct >= _VERDICT_THRESHOLD_PCT else "fair"
    else:
        pct = (fair_value - price) / fair_value * 100
        verdict = "undervalued" if pct >= _VERDICT_THRESHOLD_PCT else "fair"

    return {
        "ticker": ticker,
        "company_name": data.get("company_name"),
        "price": round(price, 2),
        "fair_value": round(fair_value, 2),
        "pct": round(pct, 1),
        "verdict": verdict,
    }


def _classify_universe(analysis_cache: dict[str, Optional[dict]]) -> tuple[list[dict], list[dict]]:
    """Undervalued/overvalued lists, each sorted most-extreme first — the
    same `analysis_cache` refresh_undervalued_screener() already built by
    scanning the WHOLE curated universe, so this costs zero extra network
    calls."""
    classified = [c for t, d in analysis_cache.items() if (c := _classify_ticker(t, d)) is not None]
    undervalued = sorted((c for c in classified if c["verdict"] == "undervalued"), key=lambda c: c["pct"], reverse=True)
    overvalued = sorted((c for c in classified if c["verdict"] == "overvalued"), key=lambda c: c["pct"], reverse=True)
    return undervalued, overvalued


def _monthly_closes(symbol: str) -> Optional[dict]:
    """Real monthly closes over the last ~5 years — same Yahoo Finance v8
    chart endpoint (with yfinance-wrapper fallback) already used by
    /market/chart, just requested at "5y"/"1mo" instead of live-chart's
    period/interval. One HTTP call per symbol; caller is responsible for
    not calling this more than once per symbol per refresh."""
    from app.api.routes.market import _yf_v8_chart, _yfinance_chart_fallback, _yf_symbol

    sym = _yf_symbol(symbol.upper().strip())
    result = _yf_v8_chart(sym, "5y", "1mo")
    if not result:
        result = _yfinance_chart_fallback(sym, "5y", "1mo")
    if not result or not result.get("prices") or not result.get("timestamps"):
        return None
    return result


def _build_equal_weighted_basket(candidates: list[dict], month_labels: list[str]) -> Optional[list[float]]:
    """Equal-weighted $10,000 basket, mark-to-market at each of
    `month_labels`. A candidate only enters the basket if it has a REAL
    price for every single month in the window — no interpolation, no
    partial-history padding; a ticker missing history (e.g. a recent IPO)
    is simply skipped, never estimated. Scans up to 2x `_BASKET_SIZE`
    candidates to allow for some being skipped this way."""
    included_series: list[list[float]] = []
    for c in candidates[: _BASKET_SIZE * 2]:
        result = _monthly_closes(c["ticker"])
        if not result:
            continue
        price_by_month = dict(zip((ts[:7] for ts in result["timestamps"]), result["prices"]))
        if not all(m in price_by_month for m in month_labels):
            continue
        included_series.append([price_by_month[m] for m in month_labels])
        if len(included_series) >= _BASKET_SIZE:
            break

    if len(included_series) < _MIN_BASKET_SIZE:
        return None

    n = len(included_series)
    per_position = 10000.0 / n
    shares = [per_position / series[0] for series in included_series]
    return [round(sum(sh * series[i] for sh, series in zip(shares, included_series)), 2) for i in range(len(month_labels))]


def _build_benchmark_series(month_labels: list[str]) -> Optional[list[float]]:
    """Real S&P 500 exposure via SPY (dividends not included — the ETF's
    price return, same simplification /market/chart already makes for
    every other chart in this codebase, disclosed in the frontend copy)."""
    result = _monthly_closes("SPY")
    if not result:
        return None
    price_by_month = dict(zip((ts[:7] for ts in result["timestamps"]), result["prices"]))
    if not all(m in price_by_month for m in month_labels):
        return None
    prices = [price_by_month[m] for m in month_labels]
    shares = 10000.0 / prices[0]
    return [round(shares * p, 2) for p in prices]


def _return_pct(series: list[float]) -> float:
    return round((series[-1] / series[0] - 1) * 100, 1)


def compute_valuation_backtest(analysis_cache: dict[str, Optional[dict]]) -> Optional[dict]:
    """Returns None (never a partial/fabricated result) if there aren't
    enough real undervalued/overvalued survivors, or SPY's own real history
    can't be fetched — the caller (refresh_valuation_backtest) then simply
    leaves the previous week's cached result in place rather than
    overwriting it with something worse."""
    undervalued, overvalued = _classify_universe(analysis_cache)
    if len(undervalued) < _MIN_BASKET_SIZE or len(overvalued) < _MIN_BASKET_SIZE:
        logger.warning(
            "valuation_backtest_service: too few classified candidates (undervalued=%d, overvalued=%d)",
            len(undervalued), len(overvalued),
        )
        return None

    spy = _monthly_closes("SPY")
    if not spy:
        logger.warning("valuation_backtest_service: SPY history not available")
        return None
    month_labels = [ts[:7] for ts in spy["timestamps"]][-_MONTHS_WINDOW:]

    undervalued_series = _build_equal_weighted_basket(undervalued, month_labels)
    overvalued_series = _build_equal_weighted_basket(overvalued, month_labels)
    sp500_series = _build_benchmark_series(month_labels)
    if not undervalued_series or not overvalued_series or not sp500_series:
        logger.warning("valuation_backtest_service: one or more real baskets could not be built")
        return None

    return {
        "generated_at": int(time.time()),
        "months": month_labels,
        "undervalued_series": undervalued_series,
        "overvalued_series": overvalued_series,
        "sp500_series": sp500_series,
        "undervalued_return_pct": _return_pct(undervalued_series),
        "overvalued_return_pct": _return_pct(overvalued_series),
        "sp500_return_pct": _return_pct(sp500_series),
        # Sample of real classified tickers for the "Descubra más" strip —
        # same real price/fair_value/pct/verdict a user sees on that
        # ticker's own page, never a separately-fabricated summary.
        "discover_more": (undervalued[:8] + overvalued[:8]),
    }


async def refresh_valuation_backtest(analysis_cache: dict[str, Optional[dict]]) -> None:
    """Computes and caches the backtest — real network calls (SPY + up to
    ~60 basket candidates' monthly history), so runs on a thread like the
    rest of the weekly refresh pipeline. Leaves the existing cache entry
    untouched (rather than clearing it) when the real computation can't
    produce a valid result this run — a stale-but-real week-old chart beats
    an empty one."""
    import asyncio

    result = await asyncio.to_thread(compute_valuation_backtest, analysis_cache)
    if result:
        cache_set(CACHE_KEY, result, CACHE_TTL)
        logger.info(
            "valuation_backtest_service: refreshed (undervalued=%.1f%%, overvalued=%.1f%%, sp500=%.1f%%)",
            result["undervalued_return_pct"], result["overvalued_return_pct"], result["sp500_return_pct"],
        )
    else:
        logger.warning("valuation_backtest_service: refresh produced no valid result — cache left untouched")


def get_valuation_backtest() -> Optional[dict]:
    return cache_get(CACHE_KEY)
