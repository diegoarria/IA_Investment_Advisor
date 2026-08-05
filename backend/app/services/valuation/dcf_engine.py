"""
DCF Engine — driver-based two-stage discounted cash flow model.

Context: Fase 1, Incremento 2 of the Nuvos AI valuation redesign (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md). Replaces the
"project FCF directly" approach of `fundamental_analysis_service._run_dcf`
with the driver waterfall the brief asks for:

    Revenue -> Operating Margin -> EBIT -> Tax -> NOPAT -> Reinvestment -> FCF

This module is NEW and self-contained — it does not yet replace
`_run_dcf` inside `fundamental_analysis_service.py` (that live swap, plus
the frontend/API wiring described in the Fase 1 plan's Incremento 2, is a
separate, larger change to the production request path and ships after
this engine is reviewed on its own).

Design notes (documented here because they're real judgment calls, not
just "the formula"):

1. Revenue and Operating Margin both fade linearly from a year-1 value to
   a terminal value over the projection window — the same two-stage fade
   `_project_path` already uses for the old FCF-based model, just applied
   one level up the waterfall. A CONSTANT operating margin was considered
   and rejected: it would implicitly assume margin expansion/compression
   never happens, which is false for almost every real company's 10-year
   history.

2. Reinvestment is modeled as ONE aggregate number (Capex + Delta-Working-
   Capital - D&A, i.e. "net reinvestment"), not three independently
   forecast line items (Capex, D&A, Working Capital), even though the
   brief lists those as separate projection rows. Reasoning: Capex, D&A,
   and Working Capital don't have independent, individually-forecastable
   trends in the data available here (no capex-guidance, no maintenance-
   vs-growth split, no reliable working-capital-as-%-of-revenue signal
   distinct from noise) — forecasting all three separately would mean
   inventing three separate arbitrary trends instead of one. Instead, the
   REINVESTMENT RATE (net reinvestment / NOPAT) is what's projected, and
   it is anchored two ways:
     - Year 1: the company's own real recency-weighted historical average
       reinvestment rate (same weighting technique already proven in
       fundamental_analysis_service's avg_fcf_margin).
     - Terminal year: Damodaran's stable-growth identity
       `reinvestment_rate = terminal_growth / terminal_ROIC` — this is
       the standard corporate-finance consistency check that a perpetuity
       growing at `gt` forever must be reinvesting enough (at the
       terminal ROIC) to actually sustain that growth. Many simpler DCFs
       skip this and let terminal growth and reinvestment be mutually
       inconsistent; enforcing it here is a real precision improvement,
       not just restructuring.
   The reinvestment rate fades linearly between these two anchors, same
   fade mechanism as revenue/margin.

3. `discount_rate` is a plain input, not computed here — this module
   deliberately has no opinion on WACC vs. the user's own required return.
   See `select_discount_rate()` below, which keeps that choice explicit
   and never blends the two (per the brief: "Nunca mezclar ambos
   conceptos").

4. Every Gordon-growth terminal value is guarded by
   `valuation.robustness.validate_discount_beats_terminal_growth` before
   it's computed — this is the real fix for the gap pinned in
   `tests/test_valuation_dcf_core.py::TestRunDcf` (the old `_run_dcf` has
   no such guard).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.robustness import (
    validate_discount_beats_terminal_growth,
    safe_divide,
    clamp,
    validate_positive_shares,
)

_PROJECTION_YEARS = 10

# REITs don't generate a normal operating-company "free cash flow" the way
# this waterfall assumes — depreciation on real property is a real economic
# cost accounting standards overstate (buildings typically appreciate, not
# depreciate, over a REIT's holding period), so NOPAT/reinvestment built on
# GAAP D&A systematically understates a REIT's true cash-generating power.
# FFO/AFFO (Funds From Operations) is the standard REIT-specific metric —
# not built here (that's future-phase work per the Fase 1 plan's "fuera de
# alcance" section) but detected and excluded rather than silently misapplied.
_REIT_INDUSTRY_KEY = "reit"


def is_reit_sector(sector: Optional[str]) -> bool:
    """True if `sector` (typically Finnhub's `finnhubIndustry`, e.g.
    "REIT - Retail", "REIT - Residential") identifies a REIT. Deliberately
    matches on "reit" rather than the broader "real estate" (which also
    matches non-REIT real-estate service/brokerage companies that DO have
    a normal operating FCF) — see module docstring."""
    if not sector:
        return False
    return _REIT_INDUSTRY_KEY in sector.lower()


def recency_weighted_average(pairs: list[tuple[int, float]]) -> Optional[float]:
    """Weighted average where weight = index+1 (oldest=1, newest=n) — the
    same technique `fundamental_analysis_service.py` already uses for
    `avg_fcf_margin` (see its docstring for the full rationale: a flat
    average lets old, no-longer-representative years distort a genuinely
    improving trend; the single latest year alone is too noisy to anchor
    a 10-year projection on). Factored out here as a shared primitive so
    operating margin and reinvestment rate use the identical, already-
    proven weighting instead of a second hand-rolled copy of the formula.

    `pairs` is a list of (original_index, value) — NOT required to be
    contiguous or start at 0, so callers can skip years with missing data
    without shifting the weights of the years that DO have data."""
    if not pairs:
        return None
    weight_sum = sum(i + 1 for i, _ in pairs)
    if weight_sum <= 0:
        return None
    return sum((i + 1) * v for i, v in pairs) / weight_sum


def _fade(year_1_value: float, terminal_value: float, yr: int, years: int) -> float:
    """Same linear fade `_project_path` uses, extracted as a pure
    per-year function so it can drive revenue growth, operating margin,
    AND reinvestment rate from one implementation instead of three."""
    return year_1_value + (terminal_value - year_1_value) * (yr / years)


@dataclass
class YearlyDriverRow:
    """One projected year of the Revenue -> ... -> FCF waterfall. Every
    field here is meant to be shown to the user in a "Level 3" full-model
    table (mirroring what `FullModelModal` on the frontend already does
    for the old FCF-only projection) — the point of the driver-based
    model is that each of these numbers is now a real, inspectable step,
    not just an opaque FCF figure."""
    year: int
    revenue: float
    revenue_growth_pct: float
    operating_margin_pct: float
    ebit: float
    tax_rate_pct: float
    nopat: float
    reinvestment_rate_pct: float
    reinvestment: float
    fcf: float
    discounted_fcf: float


@dataclass
class DriverBasedDcfResult:
    yearly: list[YearlyDriverRow]
    pv_of_fcf_sum: float
    terminal_value: float
    pv_of_terminal_value: float
    enterprise_value: float
    equity_value: Optional[float] = None
    value_per_share: Optional[float] = None
    assumptions: dict = field(default_factory=dict)


def project_driver_based_dcf(
    revenue_0: float,
    revenue_growth_1: float,
    terminal_growth: float,
    operating_margin_anchor_pct: float,
    terminal_operating_margin_pct: float,
    tax_rate: float,
    reinvestment_rate_anchor_pct: float,
    terminal_roic_pct: float,
    discount_rate: float,
    net_cash: Optional[float] = None,
    shares_out: Optional[float] = None,
    years: int = _PROJECTION_YEARS,
) -> DriverBasedDcfResult:
    """The core driver-based DCF: projects Revenue -> Operating Margin ->
    EBIT -> Tax -> NOPAT -> Reinvestment -> FCF for `years`, discounts
    each year's FCF, and adds a Gordon-growth terminal value on the final
    year's FCF.

    All rate inputs are decimals (0.08 = 8%), all money inputs share one
    currency unit (the caller's choice — typically millions, matching
    `dcfCalculator.ts`'s convention).

    Raises `valuation.robustness.UnstableGordonGrowthError` if
    `discount_rate` does not exceed `terminal_growth` by a healthy margin
    — never returns a silently-wrong (negative or divide-by-zero) terminal
    value. Raises `ValueError` if `terminal_roic_pct` is not positive,
    since the terminal reinvestment rate (`terminal_growth /
    terminal_roic_pct`) has no meaningful value otherwise — a business
    that can't sustain a positive terminal ROIC also can't have a stable
    perpetuity growing at `terminal_growth`, which is precisely the "no
    valid solution" case this should surface clearly rather than silently
    compute a nonsensical reinvestment rate.
    """
    validate_discount_beats_terminal_growth(discount_rate, terminal_growth)

    if revenue_0 <= 0:
        raise ValueError("revenue_0 debe ser positivo — no hay una base real desde la cual proyectar.")

    if terminal_roic_pct <= 0:
        raise ValueError(
            "terminal_roic_pct debe ser positivo: el reinvestment rate terminal "
            "(terminal_growth / terminal_ROIC) no tiene una solución económica "
            "válida para un ROIC terminal no positivo."
        )
    terminal_reinvestment_rate = terminal_growth / terminal_roic_pct

    yearly: list[YearlyDriverRow] = []
    revenue_prev = revenue_0
    pv_sum = 0.0
    for yr in range(1, years + 1):
        growth = _fade(revenue_growth_1, terminal_growth, yr, years)
        revenue = revenue_prev * (1 + growth)

        operating_margin = _fade(operating_margin_anchor_pct, terminal_operating_margin_pct, yr, years)
        ebit = revenue * operating_margin
        nopat = ebit * (1 - tax_rate)

        reinvestment_rate = _fade(reinvestment_rate_anchor_pct, terminal_reinvestment_rate, yr, years)
        reinvestment = nopat * reinvestment_rate
        fcf = nopat - reinvestment

        discounted_fcf = fcf / ((1 + discount_rate) ** yr)
        pv_sum += discounted_fcf

        yearly.append(YearlyDriverRow(
            year=yr,
            revenue=round(revenue, 0),
            revenue_growth_pct=round(growth * 100, 2),
            operating_margin_pct=round(operating_margin * 100, 2),
            ebit=round(ebit, 0),
            tax_rate_pct=round(tax_rate * 100, 2),
            nopat=round(nopat, 0),
            reinvestment_rate_pct=round(reinvestment_rate * 100, 2),
            reinvestment=round(reinvestment, 0),
            fcf=round(fcf, 0),
            discounted_fcf=round(discounted_fcf, 0),
        ))
        revenue_prev = revenue

    final_fcf = yearly[-1].fcf
    terminal_value = final_fcf * (1 + terminal_growth) / (discount_rate - terminal_growth)
    pv_terminal = terminal_value / ((1 + discount_rate) ** years)
    enterprise_value = pv_sum + pv_terminal

    result = DriverBasedDcfResult(
        yearly=yearly,
        pv_of_fcf_sum=round(pv_sum, 0),
        terminal_value=round(terminal_value, 0),
        pv_of_terminal_value=round(pv_terminal, 0),
        enterprise_value=round(enterprise_value, 0),
        assumptions={
            "revenue_growth_1_pct": round(revenue_growth_1 * 100, 2),
            "terminal_growth_pct": round(terminal_growth * 100, 2),
            "operating_margin_anchor_pct": round(operating_margin_anchor_pct * 100, 2),
            "terminal_operating_margin_pct": round(terminal_operating_margin_pct * 100, 2),
            "tax_rate_pct": round(tax_rate * 100, 2),
            "reinvestment_rate_anchor_pct": round(reinvestment_rate_anchor_pct * 100, 2),
            "terminal_reinvestment_rate_pct": round(terminal_reinvestment_rate * 100, 2),
            "discount_rate_pct": round(discount_rate * 100, 2),
        },
    )

    if net_cash is not None and validate_positive_shares(shares_out):
        equity_value = enterprise_value + net_cash
        result.equity_value = round(equity_value, 0)
        value_per_share = safe_divide(equity_value, shares_out)
        result.value_per_share = round(value_per_share, 2) if value_per_share is not None else None

    return result


def select_discount_rate(
    wacc: float, required_return: Optional[float], use_required_return: bool,
) -> tuple[float, str]:
    """The WACC vs. Required Return toggle the brief requires: returns
    EXACTLY one of the two rates, never a blend, plus a label identifying
    which one was used (so the UI/explanation layer can say "usando tu
    retorno requerido del X%" vs. "usando el WACC calculado del Y%").

    `use_required_return=True` with `required_return=None` raises
    `ValueError` rather than silently falling back to WACC — a caller
    that explicitly asked for their own required return but didn't
    provide one is a bug at the call site, not a case to paper over."""
    if use_required_return:
        if required_return is None:
            raise ValueError("use_required_return=True requiere un valor real en required_return.")
        return required_return, "required_return"
    return wacc, "wacc"


def compute_reinvestment_rate_anchor(
    reinvestment_trend_pairs: list[tuple[int, float]],
) -> Optional[float]:
    """Convenience wrapper: applies `recency_weighted_average` to a list of
    (year_index, net_reinvestment / NOPAT) pairs, then clamps the result to
    a sane [-0.5, 1.5] range — a reinvestment rate below -50% (the business
    is massively net-disinvesting, e.g. selling off capacity) or above 150%
    (reinvesting far more than its entire NOPAT) is almost always a data
    artifact (a one-off asset sale or acquisition) rather than a
    representative long-run rate, so it's bounded rather than trusted
    verbatim — same philosophy as the beta/WACC clamps elsewhere in this
    engine."""
    avg = recency_weighted_average(reinvestment_trend_pairs)
    if avg is None:
        return None
    return clamp(avg, -0.5, 1.5)
