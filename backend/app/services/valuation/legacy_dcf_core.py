"""
Legacy DCF Core — Fase 1, Incremento 7 (Parte I: modular reorganization —
see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Relocated verbatim from `fundamental_analysis_service.py` — behavior
unchanged, pinned by the Incremento 1 regression suite
(`tests/test_valuation_dcf_core.py::TestRunDcf`/`TestProjectPath`), which
imports these exact functions and passed before and after this move.

Called "legacy" deliberately: this is the ORIGINAL two-stage FCF-fade DCF
(project the normalized FCF directly, fade growth, Gordon terminal value)
that Incremento 2's `dcf_engine.project_driver_based_dcf` was built to
eventually replace with the Revenue -> Margin -> EBIT -> NOPAT ->
Reinvestment -> FCF waterfall. It still powers the scenarios/sensitivity/
margin-of-safety numbers users see today (that live cutover is a separate,
larger change than this reorganization — see the Fase 1 plan) and the
reverse-DCF engine below depends on it, so it's kept as a real, still-load-
bearing module rather than deleted.
"""

from __future__ import annotations

_PROJECTION_YEARS = 10


def _project_path(base_value: float, growth_1: float, terminal_growth: float, years: int = _PROJECTION_YEARS) -> list[float]:
    """Projects `base_value` forward `years` periods, with growth fading
    linearly from `growth_1` (year 1) to `terminal_growth` by the final year —
    the same two-stage curve used by the DCF, applied to any metric
    (revenue, FCF, Owner Earnings)."""
    v = base_value
    path = []
    for yr in range(1, years + 1):
        g = growth_1 + (terminal_growth - growth_1) * (yr / years)
        v *= (1 + g)
        path.append(round(v, 0))
    return path


def _run_dcf(base_fcf: float, growth_1: float, discount_rate: float, terminal_growth: float) -> dict:
    """Two-stage DCF: growth fades linearly from `growth_1` (year 1) to the
    terminal growth rate by year _PROJECTION_YEARS, then a Gordon-growth
    terminal value. Returns enterprise-value components only — caller adds
    cash/debt to get equity value."""
    path = _project_path(base_fcf, growth_1, terminal_growth)
    pv_sum = sum(cf / ((1 + discount_rate) ** yr) for yr, cf in enumerate(path, start=1))
    final_cf = path[-1]
    terminal_value = final_cf * (1 + terminal_growth) / (discount_rate - terminal_growth)
    pv_terminal = terminal_value / ((1 + discount_rate) ** _PROJECTION_YEARS)
    return {
        "fcf_path": path,
        "pv_of_fcf_sum": pv_sum,
        "terminal_value": terminal_value,
        "pv_of_terminal_value": pv_terminal,
        "enterprise_value": pv_sum + pv_terminal,
    }


def _run_dcf_constant_growth(base_fcf: float, growth: float, discount_rate: float, terminal_growth: float, years: int = _PROJECTION_YEARS) -> dict:
    """Same 2-stage structure as _run_dcf (explicit years + Gordon-growth
    terminal value), but FCF grows at a CONSTANT rate every year instead of
    fading linearly toward terminal growth. This is deliberate: Expectations
    Investing (Rappaport) asks "what constant growth rate, held flat for the
    whole explicit period, reconciles today's price" — a fading path would
    answer a different, less standard question."""
    v = base_fcf
    path = []
    for _ in range(years):
        v *= (1 + growth)
        path.append(v)
    pv_sum = sum(cf / ((1 + discount_rate) ** yr) for yr, cf in enumerate(path, start=1))
    final_cf = path[-1]
    terminal_value = final_cf * (1 + terminal_growth) / (discount_rate - terminal_growth)
    pv_terminal = terminal_value / ((1 + discount_rate) ** years)
    return {
        "fcf_path": path,
        "pv_of_fcf_sum": pv_sum,
        "terminal_value": terminal_value,
        "pv_of_terminal_value": pv_terminal,
        "enterprise_value": pv_sum + pv_terminal,
    }
