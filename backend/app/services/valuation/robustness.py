"""
Robustness — shared numeric guards for the valuation engine.

Context: the DCF math in `fundamental_analysis_service.py` (the two-stage
Gordon-growth model) already handles most edge cases *somewhere* in its
~2,200 lines — but the guards are inline and scattered (a clamp here, a
None-check there), and one real gap was found during the Fase 1 audit:
`_run_dcf` has no guard against `discount_rate <= terminal_growth`, which
either raises `ZeroDivisionError` (`r == gt`) or silently returns a
*negative* terminal value (`r < gt`) — see
`tests/test_valuation_dcf_core.py::TestRunDcf` for the pinned "before"
behavior.

This module exists to give every future valuation engine (dcf_engine,
fair_value_engine, exit_multiple_engine, ...) ONE well-tested place for these
checks, instead of re-deriving them per module. It does not change
`fundamental_analysis_service.py`'s current behavior — it is deliberately
new code, wired into the new `dcf_engine` in Incremento 2, so Incremento 1
stays a zero-behavior-change increment (see the Fase 1 plan).

All formulas/thresholds here match the brief's explicit rules:
"Nunca permitir: gt >= r. Nunca permitir tasas irreales. Si la solución
matemática deja de ser estable, mostrar un mensaje claro en lugar de
generar resultados incorrectos."
"""

from __future__ import annotations

import math
from typing import Optional


class UnstableGordonGrowthError(ValueError):
    """Raised when a Gordon-growth terminal value has no valid solution —
    the perpetuity formula `CF * (1+gt) / (r - gt)` requires `r > gt`
    strictly; `r == gt` divides by zero, `r < gt` implies a business that
    outgrows its own discount rate forever (an infinite terminal value in
    the limit), which is never a real answer. Carries the two rates so the
    caller can build a clear user-facing message instead of propagating a
    raw ZeroDivisionError or a silently-negative "value"."""

    def __init__(self, discount_rate: float, terminal_growth: float):
        self.discount_rate = discount_rate
        self.terminal_growth = terminal_growth
        super().__init__(
            f"Tasa de descuento ({discount_rate:.2%}) debe ser mayor que el "
            f"crecimiento terminal ({terminal_growth:.2%}) para que el modelo "
            f"de Gordon tenga una solución estable."
        )


def validate_discount_beats_terminal_growth(
    discount_rate: float, terminal_growth: float, min_spread: float = 0.005,
) -> None:
    """Raises UnstableGordonGrowthError unless `discount_rate` exceeds
    `terminal_growth` by at least `min_spread` (default 50bps). The spread
    requirement (not just `>`) matters because a spread of, say, 0.0001
    produces a mathematically "valid" but practically absurd terminal value
    (dividing by a near-zero denominator) — the same failure mode as
    equality, just not caught by a strict `<=` check. Call this BEFORE
    running any Gordon-growth terminal value calculation."""
    if discount_rate - terminal_growth < min_spread:
        raise UnstableGordonGrowthError(discount_rate, terminal_growth)


def safe_divide(numerator: float, denominator: float, epsilon: float = 1e-9) -> Optional[float]:
    """Returns `numerator / denominator`, or None (never raises, never
    returns inf/-inf) when `denominator` is within `epsilon` of zero. For
    valuation math, a "the answer is infinity" result is never meaningful —
    it always means an input combination that shouldn't have reached this
    point, and the caller should treat None the same as "could not compute
    a valuation", not silently propagate an infinite value downstream."""
    if abs(denominator) < epsilon:
        return None
    return numerator / denominator


def is_finite_number(value: Optional[float]) -> bool:
    """True only for a real, finite, non-NaN number. None-safe (None is not
    a finite number, but also does not raise) — meant to be the single
    final gate before any computed value is returned to a caller/API
    response, so NaN/inf never leaks into a JSON payload or a UI."""
    if value is None:
        return False
    try:
        return math.isfinite(value)
    except TypeError:
        return False


def clamp(value: float, lo: float, hi: float) -> float:
    """Bounds `value` to [lo, hi]. This is the same pattern already used
    ad hoc throughout fundamental_analysis_service.py (beta clamped to
    [0.3, 3.0], WACC floored/capped to [0.04, 0.20], cost of debt bounded to
    [0.03, 0.15], justified P/B capped at 8x, etc.) — formalized here as one
    reusable primitive instead of a `max(min(x, hi), lo)` one-liner repeated
    at every call site."""
    if lo > hi:
        raise ValueError(f"clamp: lo ({lo}) must be <= hi ({hi})")
    return max(min(value, hi), lo)


def validate_positive_shares(shares_out: Optional[float]) -> bool:
    """A share count of zero or fewer makes "value per share" undefined —
    this is the exact case dcfCalculator.ts already guards against on the
    frontend (`if (!shares || shares <= 0) return null`); formalized here so
    the backend enforces the identical rule before ever dividing by
    `shares_out`."""
    return shares_out is not None and shares_out > 0


def validate_positive_base_fcf(base_fcf: Optional[float]) -> bool:
    """A non-positive base FCF/cash-flow-driver makes a DCF's explicit
    projection period meaningless (there's nothing real to compound
    forward) — matches the existing rule in fundamental_analysis_service.py
    (`avg_fcf_margin > 0` gates whether `dcf` is computed at all)."""
    return base_fcf is not None and base_fcf > 0
