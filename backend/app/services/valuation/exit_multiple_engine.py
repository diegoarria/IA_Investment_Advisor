"""
Exit Multiple Engine — Nuvos AI Fair Value Engine redesign, Incremento 1
(see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Answers the two questions the terminal-value section of the new DCF needs:

1. Which multiple applies to THIS business — `select_exit_metric`. Decision
   #13: restricted to EV/Sales, EV/EBIT, EV/FCF. P/E and Price/FCF are
   explicitly excluded — `dcf_engine.project_driver_based_dcf` is an
   UNLEVERED model (EBIT -> NOPAT -> FCF, arriving at Enterprise Value,
   never net income after interest), and it never projects EBITDA (no
   separate D&A line — see dcf_engine.py's own design note 2 on why).
   Applying an equity multiple (P/E, P/FCF) to an unlevered terminal metric
   would double-count the net-cash bridge `project_driver_based_dcf`
   already applies (`equity_value = enterprise_value + net_cash`); EV/EBITDA
   isn't directly computable since the model has no D&A line.

2. How much that multiple is worth — `derive_exit_multiple`, an anchor
   (real, from this company's own history or its real peers — never
   invented) plus the same bounded, documented adjustments
   `fair_value_engine.py` already built (decision #10: reused, not
   rewritten), rescaled from P/E points to a PERCENTAGE of the anchor (the
   P/E-point calibration in `fair_value_engine.py` — base ~11-23x — makes
   no sense applied to an EV/Sales anchor of 2-6x).

No country/sovereign-risk adjustment (decision #9) — no such data source
exists anywhere in this codebase; documented here as an honest limitation,
not silently ignored.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.valuation.fair_value_engine import (
    MultipleAdjustment,
    _dividend_adjustment,
    _fcf_margin_adjustment,
    _growth_adjustment,
    _leverage_adjustment,
    _moat_management_adjustment,
    _quality_adjustment,
)
from app.services.valuation.robustness import clamp

ExitMetric = str  # "ev_sales" | "ev_ebit" | "ev_fcf"

# ── Category -> metric ──────────────────────────────────────────────────────
# Keyed on industry_engine.classify_industry's categories (decision #3 — that
# taxonomy wins over the Consensus Engine's now-retired archetype). Growth/
# scaling business models (revenue is the primary value lever, current
# profitability is a secondary signal) get EV/Sales; capital-intensive or
# margin-cyclical businesses where EBIT is the most trustworthy earnings
# signal get EV/EBIT; mature, cash-generative businesses get EV/FCF (the
# metric this engine's own DCF waterfall already produces natively).
# Financials/REIT are listed for completeness only — decision #5 means the
# orchestrator never calls this engine for those sectors.
_METRIC_BY_CATEGORY: dict[str, ExitMetric] = {
    "Software": "ev_sales",
    "Marketplace": "ev_sales",
    "Semiconductors": "ev_ebit",
    "Airlines": "ev_ebit",
    "Telecom": "ev_ebit",
    "Oil & Gas": "ev_ebit",
    "Utilities": "ev_ebit",
    "Industrials": "ev_ebit",
    "Retail": "ev_ebit",
    "Healthcare": "ev_fcf",
    "Consumer": "ev_fcf",
    "Real Estate Services": "ev_fcf",
    "Diversified": "ev_ebit",
    "Financials": "ev_ebit",
    "REIT": "ev_fcf",
}
_DEFAULT_METRIC: ExitMetric = "ev_ebit"


def select_exit_metric(category: str) -> ExitMetric:
    """Returns the exit-multiple metric for an `industry_engine.classify_
    industry` category, defaulting to EV/EBIT (the metric that degrades
    most gracefully across unknown/diversified businesses) for any category
    not in the table."""
    return _METRIC_BY_CATEGORY.get(category, _DEFAULT_METRIC)


# ── Fallback anchors by metric, same honesty disclaimer as
# fair_value_engine._SECTOR_BASE_PE: illustrative, not backtested, used
# only when no real peer/historical multiple is available. ─────────────────
_FALLBACK_ANCHOR: dict[ExitMetric, float] = {
    "ev_sales": 3.0,
    "ev_ebit": 13.0,
    "ev_fcf": 20.0,
}

# Relative clamp: the derived multiple can never land further than this
# fraction away from its real anchor, regardless of how large the bounded
# adjustments sum to — the adjustments are calibrated in P/E-equivalent
# points (see _adjustment_fraction below) and re-applied as a fraction, so
# this guards against a combination of extreme inputs producing an absurd
# multiple the way fair_value_engine's absolute [5, 60] clamp does for P/E.
_MAX_RELATIVE_ADJUSTMENT = 0.5  # anchor * [0.5, 1.5]

# P/E's own base-multiple scale (fair_value_engine._DEFAULT_BASE_PE) — the
# denominator used to convert the 6 reused adjustment functions' P/E-point
# outputs into a fraction-of-anchor, since those functions were calibrated
# assuming a ~17x P/E base.
_PE_ADJUSTMENT_SCALE = 17.0


@dataclass
class ExitMultipleResult:
    metric: ExitMetric
    anchor: float
    anchor_source: str  # "own_historical" | "peer_median" | "sector_table_fallback"
    adjustments: list[MultipleAdjustment]
    adjustment_fraction: float
    exit_multiple: float


def _bridge_to_metric(
    metric: ExitMetric,
    ev_ebitda_anchor: Optional[float],
    ev_fcf_anchor: Optional[float],
    own_ebitda: Optional[float],
    own_ebit: Optional[float],
    own_revenue: Optional[float],
    own_fcf: Optional[float],
) -> Optional[float]:
    """Translates a REAL EV-based anchor (EV/EBITDA or EV/FCF, whichever
    this company/its peers actually have) into the target metric, using
    THIS company's own real financial-statement ratios as the conversion
    factor — never a generic assumption. Since EV = anchor_multiple ×
    anchor_metric = target_multiple × target_metric for the SAME real EV,
    target_multiple = anchor_multiple × (anchor_metric / target_metric).
    Returns None when the specific real inputs needed aren't available —
    the caller falls back to the sector table, never guesses."""
    if metric == "ev_fcf" and ev_fcf_anchor is not None:
        return ev_fcf_anchor
    if ev_ebitda_anchor is None or not own_ebitda or own_ebitda <= 0:
        return None
    if metric == "ev_ebit":
        if not own_ebit or own_ebit <= 0:
            return None
        return ev_ebitda_anchor * (own_ebitda / own_ebit)
    if metric == "ev_sales":
        if not own_revenue or own_revenue <= 0:
            return None
        return ev_ebitda_anchor * (own_ebitda / own_revenue)
    if metric == "ev_fcf":
        if not own_fcf or own_fcf <= 0:
            return None
        return ev_ebitda_anchor * (own_ebitda / own_fcf)
    return None


def _resolve_anchor(
    metric: ExitMetric,
    own_historical_ev_ebitda: Optional[float], own_historical_ev_fcf: Optional[float],
    peer_median_ev_ebitda: Optional[float], peer_median_ev_fcf: Optional[float],
    own_ebitda: Optional[float], own_ebit: Optional[float],
    own_revenue: Optional[float], own_fcf: Optional[float],
) -> tuple[float, str]:
    """Preference order: this company's OWN real historical multiple >
    real peer median > sector-table fallback. Both real sources are
    bridged to the target metric via `_bridge_to_metric` before comparison,
    since neither historical_valuation_service nor relative_valuation_
    service compute EV/Sales or EV/EBIT medians directly (confirmed absent
    in the audit) — only EV/EBITDA and (peer-only) EV/FCF exist to bridge
    from."""
    own = _bridge_to_metric(metric, own_historical_ev_ebitda, own_historical_ev_fcf, own_ebitda, own_ebit, own_revenue, own_fcf)
    if own is not None and own > 0:
        return own, "own_historical"
    peer = _bridge_to_metric(metric, peer_median_ev_ebitda, peer_median_ev_fcf, own_ebitda, own_ebit, own_revenue, own_fcf)
    if peer is not None and peer > 0:
        return peer, "peer_median"
    return _FALLBACK_ANCHOR[metric], "sector_table_fallback"


def _adjustment_fraction(adjustments: list[MultipleAdjustment]) -> float:
    """Converts the sum of the 6 reused P/E-point adjustments into a
    fraction of ANY anchor, using P/E's own base scale as the reference —
    the adjustments answer "how much better/worse than a typical business
    is this one," a judgment that's metric-agnostic once expressed as a
    percentage rather than absolute points."""
    return sum(a.points for a in adjustments) / _PE_ADJUSTMENT_SCALE


def derive_exit_multiple(
    *,
    metric: ExitMetric,
    own_historical_ev_ebitda: Optional[float] = None,
    own_historical_ev_fcf: Optional[float] = None,
    peer_median_ev_ebitda: Optional[float] = None,
    peer_median_ev_fcf: Optional[float] = None,
    own_ebitda: Optional[float] = None,
    own_ebit: Optional[float] = None,
    own_revenue: Optional[float] = None,
    own_fcf: Optional[float] = None,
    expected_eps_growth_pct: Optional[float] = None,
    roic_pct: Optional[float] = None,
    cost_of_capital_pct: Optional[float] = None,
    fcf_margin_pct: Optional[float] = None,
    net_debt_to_ebitda: Optional[float] = None,
    interest_coverage: Optional[float] = None,
    dividend_yield_pct: Optional[float] = None,
    moat_score: Optional[float] = None,
    management_score: Optional[float] = None,
) -> ExitMultipleResult:
    """The single entry point. Real anchor (own history > peers > sector
    fallback, `anchor_source` always disclosed) adjusted by the same 6
    bounded, documented factors `fair_value_engine.compute_justified_
    multiple` already uses (decision #10), rescaled to a fraction of the
    anchor and clamped to `anchor * [1-_MAX_RELATIVE_ADJUSTMENT,
    1+_MAX_RELATIVE_ADJUSTMENT]` so an extreme combination of inputs can
    never send an EV/Sales or EV/EBIT multiple somewhere absurd."""
    anchor, anchor_source = _resolve_anchor(
        metric, own_historical_ev_ebitda, own_historical_ev_fcf,
        peer_median_ev_ebitda, peer_median_ev_fcf,
        own_ebitda, own_ebit, own_revenue, own_fcf,
    )
    adjustments = [
        _growth_adjustment(expected_eps_growth_pct),
        _quality_adjustment(roic_pct, cost_of_capital_pct),
        _fcf_margin_adjustment(fcf_margin_pct),
        _leverage_adjustment(net_debt_to_ebitda, interest_coverage),
        _dividend_adjustment(dividend_yield_pct),
        _moat_management_adjustment(moat_score, management_score),
    ]
    fraction = _adjustment_fraction(adjustments)
    raw_multiple = anchor * (1 + fraction)
    exit_multiple = clamp(raw_multiple, anchor * (1 - _MAX_RELATIVE_ADJUSTMENT), anchor * (1 + _MAX_RELATIVE_ADJUSTMENT))
    return ExitMultipleResult(
        metric=metric, anchor=round(anchor, 2), anchor_source=anchor_source,
        adjustments=adjustments, adjustment_fraction=round(fraction, 4),
        exit_multiple=round(exit_multiple, 2),
    )


def derive_exit_multiple_ladder(
    *,
    metric: ExitMetric,
    own_historical_ev_ebitda: Optional[float] = None,
    own_historical_ev_fcf: Optional[float] = None,
    peer_median_ev_ebitda: Optional[float] = None,
    peer_median_ev_fcf: Optional[float] = None,
    own_ebitda: Optional[float] = None,
    own_ebit: Optional[float] = None,
    own_revenue: Optional[float] = None,
    own_fcf: Optional[float] = None,
) -> dict[str, Optional[float]]:
    """"Modelo Completo" reference ladder — `_resolve_anchor` above only
    surfaces the ONE winning candidate (own history > peers > sector
    fallback) and discards the rest, which is correct for the actual
    scenario math but hides real reference points a user comparing
    multiples wants to see side by side. This exposes all 3 candidates
    that `_resolve_anchor` would have chosen between, each still bridged to
    the same target `metric` via `_bridge_to_metric` (never a raw
    cross-metric number). `None` for any candidate this ticker genuinely
    doesn't have real data for — never a filled-in guess."""
    own_historical = _bridge_to_metric(
        metric, own_historical_ev_ebitda, own_historical_ev_fcf,
        own_ebitda, own_ebit, own_revenue, own_fcf,
    )
    peer_median = _bridge_to_metric(
        metric, peer_median_ev_ebitda, peer_median_ev_fcf,
        own_ebitda, own_ebit, own_revenue, own_fcf,
    )
    return {
        "own_historical": round(own_historical, 2) if own_historical is not None else None,
        "peer_median": round(peer_median, 2) if peer_median is not None else None,
        "sector_table_fallback": round(_FALLBACK_ANCHOR[metric], 2),
    }
