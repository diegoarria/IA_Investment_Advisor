"""
Analyst Estimates Service — Nuvos AI Fair Value Engine redesign,
Incremento 3 (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Forward-looking Wall Street revenue/EPS estimates existed in this codebase
before this module (yfinance's `earnings_estimate`/`revenue_estimate`,
already fetched inline inside `app/api/routes/market.py::_fetch_stock_detail`
for the `/stock-detail` endpoint) but were never consumable by the
valuation engine — `fundamental_analysis_service.py` never imported
anything from `market.py`. This module MOVES that fetch (the primary
yfinance path, not `market.py`'s own crumb-authenticated quoteSummary
fallback — see below) into a real, importable function so
`assumptions_engine.py` (Incremento 4) can use it too, while
`_fetch_stock_detail` keeps its exact current response shape by calling
this module instead of doing the fetch inline.

Real, honest limitations, declared here rather than hidden:
- Coverage is typically 1-2 fiscal years/quarters ahead — never a real
  10-year Wall Street consensus (no such data source exists anywhere).
- No FCF estimate exists from ANY source integrated in this codebase —
  only revenue and EPS. `revenue_growth_next_year_pct`/
  `eps_growth_next_year_pct` are the only two signals this module can
  offer the Assumptions Engine.
- `market.py`'s OWN earningsTrend fallback (crumb-authenticated
  quoteSummary, used when the primary yfinance call returns nothing) is
  deliberately NOT duplicated here — it's tightly coupled to market.py's
  broader stock-detail fetch (shared session/crumb state, many unrelated
  modules pulled in the same call) and stays market.py's own fallback for
  that endpoint's robustness. `get_analyst_estimates` returns `None` when
  the primary yfinance path has nothing, and callers (the Assumptions
  Engine) degrade gracefully exactly like any other missing signal
  (`weighted_mean` renormalizes over what IS available).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


def _fmt_number(v) -> Optional[float]:
    """Identical to market.py's own `_fmt_number` — same rounding, same
    NaN guard — so a value moved through this service is byte-identical
    to what `/stock-detail` showed before this module existed."""
    try:
        f = float(v)
        return None if (f != f) else round(f, 4)  # NaN check
    except Exception:
        return None


@dataclass
class AnalystEstimates:
    eps_estimates: list[dict]          # [{period, avg, low, high, growth}, ...] — same shape /stock-detail already returns
    revenue_estimates: list[dict]      # same shape
    n_analysts: Optional[int]
    source: str                        # "yfinance"
    revenue_growth_next_year_pct: Optional[float]
    eps_growth_next_year_pct: Optional[float]


def _extract_estimates(df) -> list[dict]:
    """Same normalization `market.py::_fetch_stock_detail` already applied
    inline to `t.earnings_estimate`/`t.revenue_estimate` — extracted
    verbatim, not re-derived, so both callers see identical numbers."""
    rows: list[dict] = []
    if df is None or df.empty:
        return rows
    for idx, r in df.iterrows():
        rows.append({
            "period": str(idx),
            "avg":    _fmt_number(r.get("avg")),
            "low":    _fmt_number(r.get("low")),
            "high":   _fmt_number(r.get("high")),
            "growth": _fmt_number((r.get("growth") or 0) * 100),
        })
    return rows


def _next_year_growth(estimates: list[dict]) -> Optional[float]:
    """yfinance's estimate tables are typically indexed ["0y", "+1y"] (or
    similarly for quarters) — "0y" is the CURRENT fiscal year (already
    mostly known, not a real forward-looking estimate), "+1y" is next
    year, the real forward signal. Rather than pattern-match the exact
    index label (which varies: dates, "+1y", quarter labels depending on
    the fallback path), this takes the SECOND entry when at least two are
    present (current year, then next year, in the order yfinance already
    returns them) — falling back to the first/only entry when there's
    just one. Documented heuristic, not exact period-matching; the
    caller (Assumptions Engine) already treats this as one of four
    factors, never the sole input."""
    if len(estimates) >= 2:
        return estimates[1].get("growth")
    if estimates:
        return estimates[0].get("growth")
    return None


def get_analyst_estimates(ticker: str) -> Optional[AnalystEstimates]:
    """Real forward EPS/revenue estimates from yfinance, or None (never a
    fabricated growth rate) when yfinance has nothing for this ticker —
    common for thinly-covered or recently-listed companies. Never raises;
    a transient yfinance failure degrades to None like any other missing
    signal."""
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)

        eps_estimates: list[dict] = []
        try:
            eps_estimates = _extract_estimates(t.earnings_estimate)
        except Exception as exc:
            logger.debug("get_analyst_estimates(%s): earnings_estimate failed: %s", ticker, exc)

        revenue_estimates: list[dict] = []
        try:
            revenue_estimates = _extract_estimates(t.revenue_estimate)
        except Exception as exc:
            logger.debug("get_analyst_estimates(%s): revenue_estimate failed: %s", ticker, exc)

        if not eps_estimates and not revenue_estimates:
            return None

        n_analysts = None
        try:
            info = t.info or {}
            n_analysts = info.get("numberOfAnalystOpinions")
        except Exception:
            pass

        return AnalystEstimates(
            eps_estimates=eps_estimates,
            revenue_estimates=revenue_estimates,
            n_analysts=n_analysts,
            source="yfinance",
            revenue_growth_next_year_pct=_next_year_growth(revenue_estimates),
            eps_growth_next_year_pct=_next_year_growth(eps_estimates),
        )
    except Exception as exc:
        logger.warning("get_analyst_estimates(%s): failed entirely: %s", ticker, exc)
        return None
