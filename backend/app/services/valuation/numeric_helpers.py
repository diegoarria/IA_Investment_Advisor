"""
Numeric Helpers — Fase 1, Incremento 7 (Parte I: modular reorganization —
see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Relocated verbatim from `fundamental_analysis_service.py` (behavior
unchanged — pinned by the Incremento 1 regression suite in
`tests/test_valuation_dcf_core.py::TestNumericHelpers`, which imports
these exact functions and passed before and after this move). No logic
changed here — this file exists so these small, genuinely reusable
primitives live in the shared `valuation` package instead of being
private to one 2,200-line service file, since every engine in this
package (dcf_engine, monte_carlo_engine, fair_value_engine,
confidence_engine) needs some subset of them.
"""

from __future__ import annotations

import statistics
from typing import Optional


def _num(v) -> Optional[float]:
    if v is None:
        return None
    try:
        n = float(v)
        return n if n == n and abs(n) < 1e18 else None  # excludes NaN/overflow
    except (TypeError, ValueError):
        return None


def _cagr(first: Optional[float], last: Optional[float], years: int) -> Optional[float]:
    if first is None or last is None or first <= 0 or last <= 0 or years <= 0:
        return None
    return round(((last / first) ** (1 / years) - 1) * 100, 1)


def _score(value: Optional[float], tiers: list[tuple[float, int]]) -> Optional[int]:
    if value is None:
        return None
    for threshold, score in tiers:
        if value <= threshold:
            return score
    return tiers[-1][1]


def _coefficient_of_variation(values: list[Optional[float]]) -> Optional[float]:
    """Real (not eyeballed) measure of how volatile a series is: stdev/|mean|.
    Used so 'is this company's FCF stable or all over the place' is a
    computed number, not a narrative guess — a low-volatility FCF series
    (Coca-Cola-like) should genuinely produce a higher confidence than a
    choppy one (early-stage/capex-supercycle company), and now it does."""
    valid = [v for v in values if v is not None]
    if len(valid) < 3:
        return None
    mean = statistics.mean(valid)
    if mean == 0:
        return None
    return abs(statistics.pstdev(valid) / mean)


# Shared "lower coefficient of variation = higher stability score" tier
# table — Fase 2, Incremento 7: was independently duplicated in
# quality_engine.py and capital_allocation_engine.py (identical values);
# consolidated here so moat_engine.py becomes the third real user without
# a third copy, and any future recalibration only happens in one place.
STABILITY_CV_TIERS = [(0.10, 95), (0.25, 80), (0.45, 60), (0.70, 35), (999, 15)]


def weighted_mean(scored: list[tuple[Optional[float], float]]) -> Optional[float]:
    """Mean of (score, weight) pairs, skipping any with score=None and
    renormalizing by the weights actually used — so a missing component
    never silently counts as zero and drags the blend down. Same
    philosophy as `consensus_valuation_service.compute_consensus_fair_value`
    (Fase 1). Fase 2, Incremento 7: promoted here from
    `quality_engine._weighted_mean` (which becomes a thin alias) so
    `moat_engine.py` and every future score-blending engine share one
    implementation instead of each re-deriving it."""
    present = [(s, w) for s, w in scored if s is not None]
    if not present:
        return None
    total_weight = sum(w for _, w in present)
    return sum(s * w for s, w in present) / total_weight
