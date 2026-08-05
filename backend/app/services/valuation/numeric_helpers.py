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
