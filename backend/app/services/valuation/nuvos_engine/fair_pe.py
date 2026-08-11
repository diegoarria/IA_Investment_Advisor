"""
Fair P/E — Nuvos Fair Value Engine, Block 2.

Replaces "Fair P/E = growth rate" with a weighted multi-factor model
whose anchor weighting depends on the business's `LynchCategory`
(plan §8) — the mechanism that makes Fair P/E evidence-anchored rather
than formula-derived, and that makes methodology genuinely differ by
business type instead of running every company through identical math.

Deliberately reuses `fair_value_engine.py`'s 6 adjustment functions
(`_growth_adjustment`, `_quality_adjustment`, `_fcf_margin_adjustment`,
`_leverage_adjustment`, `_dividend_adjustment`, `_moat_management_
adjustment`) and `sector_base_multiple` rather than re-deriving them —
that module is real, tested (`tests/test_valuation_fair_value_engine.py`),
and already a direct dependency of `exit_multiple_engine.py`; duplicating
its logic here would create two adjustment models to keep in sync for no
benefit. Explicitly NOT a PEG ratio (P/E ÷ growth) — see
`fair_value_engine.py`'s own module docstring, which this inherits.

New here: blending that growth-based justified multiple with TWO
independent real evidence anchors — the company's own historical P/E
range (`historical_valuation_service.py`) and real peer/comparable P/E
(`relative_valuation_service.py`) — with classification-aware weights, so
the final Fair P/E is never just a formula output but is checked against
what the market has actually paid for this business and its peers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.robustness import clamp
from app.services.valuation.fair_value_engine import (
    sector_base_multiple,
    _growth_adjustment,
    _quality_adjustment,
    _fcf_margin_adjustment,
    _leverage_adjustment,
    _dividend_adjustment,
    _moat_management_adjustment,
    MultipleAdjustment,
)
from app.services.valuation.nuvos_engine.classification import LynchCategory
from app.services.valuation.nuvos_engine.growth_quality import EpsGrowthDecomposition
from app.services.valuation.nuvos_engine.growth_evidence import GrowthEvidenceResult

# Classification-aware final-multiple bounds — a Cyclical or Turnaround
# should never be "justified" at a Fast-Grower multiple, and vice versa,
# no matter what the additive adjustments alone would produce. Same
# defensive-clamp philosophy as fair_value_engine.py's [5, 60] global
# bound, just tightened per business type (an honest v1 starting point,
# not backtested — flagged the same way that module flags its own table).
#
# CYCLICAL's ceiling widened 18.0 -> 26.0 after calibrating against real
# tickers: sector-based cyclical detection (industry_engine's Semiconductors/
# Airlines/Oil & Gas/Industrials/Basic Materials bucket) correctly flags
# semiconductor names as cyclical, but a generic industrial-cyclical ceiling
# (originally set with airlines/materials in mind) was unrealistically low
# for that specific sub-industry — semiconductor cyclicals have historically
# traded at meaningfully higher through-cycle multiples than industrial/
# transport cyclicals. Still well below Fast Grower's ceiling (45x): this
# doesn't remove the cyclical discount, it corrects its magnitude for one
# sub-industry the bucket was miscalibrated for. Flagged the same "honest
# v1, not backtested per sub-industry" way as the rest of this table.
_CATEGORY_BOUNDS: dict[LynchCategory, tuple[float, float]] = {
    LynchCategory.FAST_GROWER: (10.0, 45.0),
    LynchCategory.STALWART: (8.0, 30.0),
    LynchCategory.CYCLICAL: (5.0, 26.0),
    LynchCategory.SLOW_GROWER: (6.0, 20.0),
    LynchCategory.TURNAROUND: (5.0, 20.0),
    LynchCategory.ASSET_PLAY: (5.0, 15.0),
}
_DEFAULT_BOUNDS = (5.0, 60.0)

# How much weight the growth-based justified multiple vs. the two real
# market-evidence anchors (own historical P/E, peer P/E) get, per
# category. Growth-based dominates for Fast Growers (least market history
# to lean on, growth is the real story); market evidence dominates for
# Cyclicals/Turnarounds/Asset Plays (their current-period growth signal
# is the least trustworthy input for a multiple).
_ANCHOR_WEIGHTS: dict[LynchCategory, dict[str, float]] = {
    LynchCategory.FAST_GROWER: {"growth_based": 0.60, "historical": 0.20, "peer": 0.20},
    LynchCategory.STALWART: {"growth_based": 0.40, "historical": 0.35, "peer": 0.25},
    LynchCategory.CYCLICAL: {"growth_based": 0.20, "historical": 0.50, "peer": 0.30},
    LynchCategory.SLOW_GROWER: {"growth_based": 0.30, "historical": 0.45, "peer": 0.25},
    LynchCategory.TURNAROUND: {"growth_based": 0.30, "historical": 0.20, "peer": 0.50},
    LynchCategory.ASSET_PLAY: {"growth_based": 0.20, "historical": 0.40, "peer": 0.40},
}
_DEFAULT_WEIGHTS = {"growth_based": 0.40, "historical": 0.30, "peer": 0.30}

# If buybacks explain more than this share of EPS growth, the growth
# input fed to `_growth_adjustment` is discounted — buyback-driven EPS
# growth isn't nothing, but it shouldn't earn the same multiple premium
# as organic operating growth (plan §7/§8).
_BUYBACK_DISCOUNT_THRESHOLD_PCT = 40.0
_BUYBACK_DISCOUNT_FACTOR = 0.5


@dataclass
class FactorContribution:
    name: str
    value: Optional[float]
    weight: Optional[float]
    reason: str


@dataclass
class FairPEResult:
    fair_pe: float
    band: tuple[float, float]
    primary_anchor: str
    factors: list[FactorContribution] = field(default_factory=list)
    adjustments: list[MultipleAdjustment] = field(default_factory=list)
    # Priority 1 (methodology audit) — traceability for which evidence tier
    # actually fed the growth adjustment above, so "growth_reason" never
    # has to be inferred after the fact from the adjustment's own text.
    growth_source: Optional[str] = None
    growth_reason: Optional[str] = None


def _growth_input_for_adjustment(
    expected_eps_growth_pct: Optional[float],
    growth_quality: Optional[EpsGrowthDecomposition],
) -> Optional[float]:
    """Discounts the growth figure fed into the multiple's growth
    adjustment when a large share of it is buyback-driven — implements
    plan §7's "buybacks must not be mistaken for organic operating
    growth" directly at the point where growth turns into multiple
    points."""
    if expected_eps_growth_pct is None:
        return None
    if growth_quality is None or growth_quality.from_buybacks_pct is None or growth_quality.eps_cagr_pct in (None, 0):
        return expected_eps_growth_pct
    buyback_share = abs(growth_quality.from_buybacks_pct) / abs(growth_quality.eps_cagr_pct) * 100
    if buyback_share <= _BUYBACK_DISCOUNT_THRESHOLD_PCT:
        return expected_eps_growth_pct
    buyback_portion = expected_eps_growth_pct * (buyback_share / 100)
    organic_portion = expected_eps_growth_pct - buyback_portion
    return round(organic_portion + buyback_portion * _BUYBACK_DISCOUNT_FACTOR, 1)


def compute_fair_pe(
    *,
    category: LynchCategory,
    sector: Optional[str],
    roic_pct: Optional[float],
    cost_of_capital_pct: Optional[float],
    fcf_margin_pct: Optional[float],
    net_debt_to_ebitda: Optional[float],
    interest_coverage: Optional[float],
    dividend_yield_pct: Optional[float],
    moat_score: Optional[float],
    management_score: Optional[float],
    historical_median_pe: Optional[float] = None,
    peer_median_pe: Optional[float] = None,
    growth_quality: Optional[EpsGrowthDecomposition] = None,
    growth_evidence: Optional[GrowthEvidenceResult] = None,
) -> FairPEResult:
    """Single entry point. Blends a growth-based justified multiple
    (fair_value_engine.py's 6-adjustment model, with the growth input
    itself discounted for buyback-driven growth) with real historical-own
    and peer P/E anchors, weighted by business classification, and
    clamped to classification-aware bounds.

    `growth_evidence` (Priority 1, methodology audit) replaces a bare
    forward-consensus float — it already carries whichever tier of real
    evidence (forward consensus / historical EPS CAGR / historical revenue
    CAGR / normalized growth / none) `growth_evidence.resolve_growth_
    evidence` resolved, so the growth adjustment is never silently zero
    just because one specific, often-unavailable data source was missing."""
    expected_eps_growth_pct = growth_evidence.growth_pct if growth_evidence else None
    discounted_growth = _growth_input_for_adjustment(expected_eps_growth_pct, growth_quality)

    base = sector_base_multiple(sector)
    adjustments = [
        _growth_adjustment(discounted_growth),
        _quality_adjustment(roic_pct, cost_of_capital_pct),
        _fcf_margin_adjustment(fcf_margin_pct),
        _leverage_adjustment(net_debt_to_ebitda, interest_coverage),
        _dividend_adjustment(dividend_yield_pct),
        _moat_management_adjustment(moat_score, management_score),
    ]
    growth_based_multiple = base + sum(a.points for a in adjustments)

    weights = dict(_ANCHOR_WEIGHTS.get(category, _DEFAULT_WEIGHTS))
    anchors: dict[str, Optional[float]] = {
        "growth_based": growth_based_multiple,
        "historical": historical_median_pe,
        "peer": peer_median_pe,
    }

    present = {k: v for k, v in anchors.items() if v is not None and weights.get(k, 0) > 0}
    if not present:
        present = {"growth_based": growth_based_multiple}
        weights = {"growth_based": 1.0}
    total_weight = sum(weights[k] for k in present)
    blended = sum(present[k] * weights[k] for k in present) / total_weight
    primary_anchor = max(present, key=lambda k: weights[k])

    lo, hi = _CATEGORY_BOUNDS.get(category, _DEFAULT_BOUNDS)
    fair_pe = clamp(round(blended, 2), lo, hi)

    band_values = list(present.values())
    band_lo = clamp(round(min(band_values), 2), lo, hi) if len(band_values) > 1 else clamp(round(fair_pe * 0.85, 2), lo, hi)
    band_hi = clamp(round(max(band_values), 2), lo, hi) if len(band_values) > 1 else clamp(round(fair_pe * 1.15, 2), lo, hi)
    if band_lo > band_hi:
        band_lo, band_hi = band_hi, band_lo

    factors = [
        FactorContribution("growth_based_multiple", round(growth_based_multiple, 2), weights.get("growth_based"),
                            f"Múltiplo justificado por crecimiento/calidad (base sectorial {base:.1f}x + ajustes)."),
        FactorContribution("historical_own_pe", historical_median_pe, weights.get("historical"),
                            "P/E mediano histórico real de la propia empresa." if historical_median_pe is not None
                            else "P/E histórico propio no disponible (historial insuficiente)."),
        FactorContribution("peer_pe", peer_median_pe, weights.get("peer"),
                            "P/E mediano real de comparables/pares." if peer_median_pe is not None
                            else "P/E de comparables no disponible (menos de 5 pares reales)."),
    ]

    return FairPEResult(
        fair_pe=fair_pe, band=(band_lo, band_hi), primary_anchor=primary_anchor,
        factors=factors, adjustments=adjustments,
        growth_source=growth_evidence.source if growth_evidence else None,
        growth_reason=growth_evidence.reason if growth_evidence else None,
    )
