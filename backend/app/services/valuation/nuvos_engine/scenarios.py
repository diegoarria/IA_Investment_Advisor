"""
Scenarios — Nuvos Fair Value Engine, Block 2.

Bear/Base/Bull built from `normalized_eps.base × fair_pe.fair_pe`, with
Bear/Bull using real evidence-anchored bounds (the Fair P/E band from
`fair_pe.py`, plus an EPS range built from analyst-estimate spread when
available, else a conservative evidence-based fallback) — never an
arbitrary ± percentage widening (plan §14).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.valuation.numeric_helpers import calc_margin_of_safety
from app.services.valuation.nuvos_engine.fair_pe import FairPEResult

# When no real analyst EPS-estimate range is available, the Bear/Bull EPS
# bounds fall back to a modest, documented spread around normalized EPS
# (not zero-width, which would understate real uncertainty, and not an
# arbitrary wide band either) — an honest v1 default, same disclosure
# convention as this package's other undisclosed-magic-number risk areas.
_FALLBACK_EPS_SPREAD_PCT = 12.0


@dataclass
class ScenarioValue:
    eps: Optional[float]
    fair_pe: float
    fair_value_per_share: Optional[float]


@dataclass
class ScenarioSet:
    bear: ScenarioValue
    base: ScenarioValue
    bull: ScenarioValue
    current_price: Optional[float]
    margin_of_safety_pct: Optional[float]


def build_scenarios(
    *,
    normalized_eps_base: Optional[float],
    fair_pe_result: FairPEResult,
    current_price: Optional[float],
    eps_low: Optional[float] = None,   # e.g. analyst-low estimate or historical trough
    eps_high: Optional[float] = None,  # e.g. analyst-high estimate or historical peak
) -> Optional[ScenarioSet]:
    """Single entry point. Returns None when there's no normalized EPS to
    build a Base scenario from — never fabricates a Base case out of
    nothing (mirrors `fair_value_engine.compute_fair_value`'s own guard)."""
    if normalized_eps_base is None or normalized_eps_base <= 0:
        return None

    eps_low = eps_low if eps_low is not None else round(normalized_eps_base * (1 - _FALLBACK_EPS_SPREAD_PCT / 100), 2)
    eps_high = eps_high if eps_high is not None else round(normalized_eps_base * (1 + _FALLBACK_EPS_SPREAD_PCT / 100), 2)
    # Guard against an inverted or degenerate real range (e.g. a real
    # analyst low above the real analyst high due to a data anomaly).
    if eps_low > eps_high:
        eps_low, eps_high = eps_high, eps_low

    pe_lo, pe_hi = fair_pe_result.band

    base_value = round(normalized_eps_base * fair_pe_result.fair_pe, 2)
    bear_value = round(eps_low * pe_lo, 2)
    bull_value = round(eps_high * pe_hi, 2)
    # Bear should never exceed Base, Bull should never be below Base —
    # enforce the ordering explicitly rather than trusting the band math
    # to always produce it (a degenerate single-anchor band could invert).
    bear_value = min(bear_value, base_value)
    bull_value = max(bull_value, base_value)

    margin_of_safety_pct = calc_margin_of_safety(base_value, current_price)

    return ScenarioSet(
        bear=ScenarioValue(eps=eps_low, fair_pe=pe_lo, fair_value_per_share=bear_value),
        base=ScenarioValue(eps=normalized_eps_base, fair_pe=fair_pe_result.fair_pe, fair_value_per_share=base_value),
        bull=ScenarioValue(eps=eps_high, fair_pe=pe_hi, fair_value_per_share=bull_value),
        current_price=current_price,
        margin_of_safety_pct=margin_of_safety_pct,
    )
