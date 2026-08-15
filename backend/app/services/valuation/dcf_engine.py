"""
DCF Engine — driver-based three-stage discounted cash flow model.

Context: Fase 1, Incremento 2 of the Nuvos AI valuation redesign, extended
in Fase 1.5 Incremento 1 (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md) to a real
three-stage growth profile. Replaces the "project FCF directly" approach of
`fundamental_analysis_service._run_dcf` with the driver waterfall the brief
asks for:

    Revenue -> Operating Margin -> EBIT -> Tax -> NOPAT -> Reinvestment -> FCF

This module is NEW and self-contained — it does not yet replace
`_run_dcf` inside `fundamental_analysis_service.py` (that live swap, plus
the frontend/API wiring described in the Fase 1.5 plan, is a separate,
larger change to the production request path and ships after this engine
is reviewed on its own).

Design notes (documented here because they're real judgment calls, not
just "the formula"):

1. Revenue growth is THREE-stage (Fase 1.5, Incremento 1): a plateau of
   `high_growth_years` at the year-1 growth rate, then a linear fade down
   to the terminal growth rate over the remaining years — never a single
   discrete jump from a high growth number straight to the terminal
   number. `high_growth_years=0` (the default) degenerates exactly to the
   original two-stage fade (immediate linear fade from year 1), so every
   existing caller is unaffected until it explicitly opts into a plateau.
   Operating Margin still uses the plain two-stage fade (`_fade`), not the
   plateau — margin expansion/compression is typically gradual from year 1
   for real companies, unlike revenue growth, which genuinely does often
   hold near its current rate for a few years before decelerating (a
   company doesn't usually go from 25% growth to 15% growth in the very
   next year). A CONSTANT (non-fading) operating margin for the whole
   projection was considered and rejected for the same reason as before:
   it would implicitly assume margin expansion/compression never happens.

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

4. Every Gordon-growth terminal value (still the ONLY terminal value method
   when `project_driver_based_dcf` is called without `exit_multiple`) is
   guarded by `valuation.robustness.validate_discount_beats_terminal_growth`
   before it's computed — this is the real fix for the gap pinned in
   `tests/test_valuation_dcf_core.py::TestRunDcf` (the old `_run_dcf` has
   no such guard). Nuvos AI Fair Value Engine redesign, Incremento 2: when
   `exit_multiple`/`exit_metric` are passed, the terminal value instead
   comes from `exit_multiple × <metric>`'s year-N value (see
   `exit_multiple_engine.py`) — Gordon growth is still computed as an
   internal sanity check when it has a valid solution, but no longer
   blocks the valuation the way it does in Gordon-only mode, since the
   two terminal-value formulas answer the same question through
   genuinely different, independently-valid math.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.robustness import (
    validate_discount_beats_terminal_growth,
    UnstableGordonGrowthError,
    safe_divide,
    clamp,
    validate_positive_shares,
)

# Nuvos AI Fair Value Engine redesign, Incremento 2 — the 3 exit-multiple
# metrics decision #13 restricts this to (see exit_multiple_engine.py's
# module docstring for why P/E, Price/FCF, and EV/EBITDA don't apply to
# this unlevered, no-separate-D&A waterfall).
_EXIT_METRICS = ("ev_sales", "ev_ebit", "ev_fcf")

# Nuvos AI Fair Value Engine redesign, Incremento 17 (calibration fix) — a
# real, anchored exit multiple (own historical or peer trading multiple)
# can still imply a terminal value wildly inconsistent with THIS specific
# run's own growth/WACC/reinvestment assumptions: a premium mega-cap
# multiple bridged onto a modest terminal growth rate, for example. The
# gate validation (Incremento 8) found 32% of tickers landing outside a
# sane Gordon-vs-exit-multiple ratio — flagged then as non-blocking, now
# enforced: the exit-multiple terminal value is clamped to stay within
# this band of what Gordon Growth (the DCF's OWN perpetuity, given its OWN
# assumptions) would imply, rather than trusting the multiple unconditionally
# just because its anchor was real. Asymmetric on purpose — exit multiples
# are expected to run somewhat above Gordon (that's the whole point of
# using one instead of a bare perpetuity), so the ceiling is looser than
# the floor.
_GORDON_SANITY_BAND = (0.5, 2.5)

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
    per-year function so it can drive operating margin AND reinvestment
    rate from one implementation instead of two."""
    return year_1_value + (terminal_value - year_1_value) * (yr / years)


def _fade_growth_with_plateau(
    year_1_value: float, terminal_value: float, yr: int, years: int, high_growth_years: int,
) -> float:
    """Revenue growth's three-stage profile (Fase 1.5, Incremento 1): flat
    at `year_1_value` for `high_growth_years`, then linear fade to
    `terminal_value` over the remaining years. With `high_growth_years=0`
    this is IDENTICAL to `_fade` (the `(yr-0)/(years-0)` reduces to
    `yr/years`) — the two-stage model is the zero-plateau special case of
    this one, not a separate code path to keep in sync."""
    if yr <= high_growth_years:
        return year_1_value
    remaining_years = years - high_growth_years
    return year_1_value + (terminal_value - year_1_value) * ((yr - high_growth_years) / remaining_years)


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
    high_growth_years: int = 0,
    exit_multiple: Optional[float] = None,
    exit_metric: Optional[str] = None,
    shares_path: Optional[list[float]] = None,
) -> DriverBasedDcfResult:
    """The core driver-based DCF: projects Revenue -> Operating Margin ->
    EBIT -> Tax -> NOPAT -> Reinvestment -> FCF for `years`, discounts
    each year's FCF, and adds a terminal value on the final year.

    Nuvos AI Fair Value Engine redesign, Incremento 2 — `exit_multiple`/
    `exit_metric` (both `None` by default, reproducing today's Gordon-
    growth-only behavior with ZERO change for every existing caller):
    when both are given, the terminal value becomes `exit_multiple ×
    <exit_metric's year-`years` value>` (`exit_metric` one of "ev_sales"/
    "ev_ebit"/"ev_fcf" — see exit_multiple_engine.py for why only these
    three) instead of the Gordon-growth perpetuity. Gordon is still
    computed as an internal sanity check whenever it has a valid solution
    (`gordon_terminal_value`/`gordon_sanity_check_ratio` in `assumptions`)
    but a spread too thin for a stable Gordon solution (`discount_rate`
    not comfortably above `terminal_growth`) no longer blocks the
    valuation in exit-multiple mode — it only means the sanity check isn't
    available for that run, since `validate_discount_beats_terminal_
    growth`'s failure mode (see robustness.py) is specific to the Gordon-
    growth perpetuity formula, not to an exit-multiple terminal value at
    all. In Gordon-only mode (`exit_multiple=None`) that validation is
    still called up front, unchanged.

    All rate inputs are decimals (0.08 = 8%), all money inputs share one
    currency unit (the caller's choice — typically millions, matching
    `dcfCalculator.ts`'s convention).

    `high_growth_years` (Fase 1.5, Incremento 1): how many years revenue
    growth stays flat at `revenue_growth_1` before it starts fading toward
    `terminal_growth`. Default `0` reproduces the original two-stage
    (immediate fade) model exactly. Must be in `[0, years)` — raises
    `ValueError` otherwise (a plateau covering the entire projection or
    longer would leave zero years for the fade to actually reach
    `terminal_growth`, silently breaking the terminal-value consistency
    the rest of this engine relies on).

    Raises `valuation.robustness.UnstableGordonGrowthError` in Gordon-only
    mode (`exit_multiple=None`) if `discount_rate` does not exceed
    `terminal_growth` by a healthy margin — never returns a silently-wrong
    (negative or divide-by-zero) terminal value. In exit-multiple mode this
    same condition never raises (see above). Raises `ValueError` if
    `exit_multiple` is given without a valid `exit_metric`, or if
    `terminal_roic_pct` is not positive, since the terminal reinvestment
    rate (`terminal_growth / terminal_roic_pct`) has no meaningful value
    otherwise — a business that can't sustain a positive terminal ROIC also
    can't have a stable perpetuity growing at `terminal_growth`, which is
    precisely the "no valid solution" case this should surface clearly
    rather than silently compute a nonsensical reinvestment rate (this
    still governs the reinvestment-rate fade in exit-multiple mode too,
    independent of which terminal-value formula is used).

    `shares_path` (mandatory per-share Fair Value Engine, methodology audit
    round 5 — see /Users/diegoarria/.claude/plans/cosmic-munching-crown.md):
    an optional real per-year projected diluted-share-count series (length
    `years`, built from the company's own historical buyback yield
    compounding forward, never invented). Revenue/margin/EBIT/NOPAT stay
    AGGREGATE (corporate-level concepts with no per-share analogue) but
    each year's resulting FCF is divided by THAT YEAR's real, shrinking
    share count BEFORE discounting — the buyback-driven denominator
    compounds year over year, instead of today's default (aggregate FCF
    discounted, divided by one static/averaged share count at the very
    end). When given, `pv_of_fcf_sum`/`terminal_value`/`enterprise_value`/
    `value_per_share` all become PER-SHARE dollar figures, and `net_cash`
    is bridged in per Diego's NFPps formula (`net_cash / shares_out`, using
    TODAY's real share count — net cash is a snapshot, not a growing
    stream — added directly, never divided again; `shares_out` is only
    REQUIRED alongside `shares_path` when `net_cash` is also given, same
    as the existing aggregate-mode bridge below). Only valid in
    Gordon-growth terminal-value mode (`exit_multiple=None`) — exit
    multiples are aggregate market comparables (EV/Sales, EV/EBIT) with no
    clean per-share equivalent. Omitted (None, the default): byte-for-byte
    identical aggregate-dollar behavior for every existing caller.
    """
    if shares_path is not None and exit_multiple is not None:
        raise ValueError("shares_path (modo per-share) no es compatible con exit_multiple — los múltiplos de salida son comparables agregados, sin equivalente por acción.")
    if shares_path is not None and len(shares_path) != years:
        raise ValueError(f"shares_path debe tener exactamente {years} elementos (uno por año proyectado), recibido {len(shares_path)}.")
    if shares_path is not None and net_cash is not None and not validate_positive_shares(shares_out):
        raise ValueError("shares_path (modo per-share) con net_cash requiere un shares_out real y positivo — necesario para el ajuste de caja neta por acción (NFPps).")

    if exit_multiple is None:
        validate_discount_beats_terminal_growth(discount_rate, terminal_growth)
    elif exit_metric not in _EXIT_METRICS:
        raise ValueError(f"exit_metric debe ser uno de {_EXIT_METRICS} cuando se pasa exit_multiple, no {exit_metric!r}.")

    if revenue_0 <= 0:
        raise ValueError("revenue_0 debe ser positivo — no hay una base real desde la cual proyectar.")

    if high_growth_years < 0 or high_growth_years >= years:
        raise ValueError(
            f"high_growth_years debe estar en [0, {years}) — un valor de {high_growth_years} no deja "
            "años reales para desacelerar hacia el crecimiento terminal."
        )

    if terminal_roic_pct <= 0:
        raise ValueError(
            "terminal_roic_pct debe ser positivo: el reinvestment rate terminal "
            "(terminal_growth / terminal_ROIC) no tiene una solución económica "
            "válida para un ROIC terminal no positivo."
        )
    terminal_reinvestment_rate = terminal_growth / terminal_roic_pct

    # Per-share mode (shares_path given) produces small per-share dollar
    # figures (cents matter) — rounding to whole units, appropriate for
    # aggregate corporate dollars, would collapse all precision.
    _round_ndigits = 2 if shares_path is not None else 0

    yearly: list[YearlyDriverRow] = []
    revenue_prev = revenue_0
    pv_sum = 0.0
    for yr in range(1, years + 1):
        growth = _fade_growth_with_plateau(revenue_growth_1, terminal_growth, yr, years, high_growth_years)
        revenue = revenue_prev * (1 + growth)

        operating_margin = _fade(operating_margin_anchor_pct, terminal_operating_margin_pct, yr, years)
        ebit = revenue * operating_margin
        nopat = ebit * (1 - tax_rate)

        reinvestment_rate = _fade(reinvestment_rate_anchor_pct, terminal_reinvestment_rate, yr, years)
        reinvestment = nopat * reinvestment_rate
        fcf = nopat - reinvestment

        # Per-share denominator shrinks year over year via the REAL
        # buyback-yield-derived shares_path when given (see docstring) —
        # `fcf` itself stays the real aggregate figure in `yearly` for
        # transparency; only what gets discounted changes.
        fcf_for_discounting = (fcf / shares_path[yr - 1]) if shares_path is not None else fcf
        discounted_fcf = fcf_for_discounting / ((1 + discount_rate) ** yr)
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
            discounted_fcf=round(discounted_fcf, _round_ndigits),
        ))
        revenue_prev = revenue

    final_row = yearly[-1]
    final_fcf = final_row.fcf  # always aggregate — used for the (aggregate) implied FCF margin below regardless of mode

    gordon_terminal_value: Optional[float] = None
    gordon_sanity_check_ratio: Optional[float] = None
    if exit_multiple is None:
        terminal_value_method = "gordon"
        final_fcf_for_terminal = (final_fcf / shares_path[-1]) if shares_path is not None else final_fcf
        terminal_value = final_fcf_for_terminal * (1 + terminal_growth) / (discount_rate - terminal_growth)
    else:
        terminal_value_method = "exit_multiple"
        metric_value = {"ev_sales": final_row.revenue, "ev_ebit": final_row.ebit, "ev_fcf": final_fcf}[exit_metric]
        raw_terminal_value = exit_multiple * metric_value
        # Gordon computed as an internal sanity check whenever it has a
        # valid solution — never blocks the exit-multiple valuation (see
        # docstring). Since Incremento 17 it also BOUNDS the exit-multiple
        # terminal value to _GORDON_SANITY_BAND (see that constant's
        # comment) instead of only reporting the ratio after the fact.
        try:
            validate_discount_beats_terminal_growth(discount_rate, terminal_growth)
            gordon_terminal_value = final_fcf * (1 + terminal_growth) / (discount_rate - terminal_growth)
        except UnstableGordonGrowthError:
            pass
        if gordon_terminal_value and gordon_terminal_value > 0:
            lo = gordon_terminal_value * _GORDON_SANITY_BAND[0]
            hi = gordon_terminal_value * _GORDON_SANITY_BAND[1]
            terminal_value = clamp(raw_terminal_value, lo, hi)
            gordon_sanity_check_ratio = round(terminal_value / gordon_terminal_value, 2)
        else:
            terminal_value = raw_terminal_value

    pv_terminal = terminal_value / ((1 + discount_rate) ** years)
    enterprise_value = pv_sum + pv_terminal
    implied_fcf_margin_pct_year_n = round(final_fcf / final_row.revenue * 100, 2) if final_row.revenue else None

    result = DriverBasedDcfResult(
        yearly=yearly,
        pv_of_fcf_sum=round(pv_sum, _round_ndigits),
        terminal_value=round(terminal_value, _round_ndigits),
        pv_of_terminal_value=round(pv_terminal, _round_ndigits),
        enterprise_value=round(enterprise_value, _round_ndigits),
        assumptions={
            "revenue_growth_1_pct": round(revenue_growth_1 * 100, 2),
            "high_growth_years": high_growth_years,
            "terminal_growth_pct": round(terminal_growth * 100, 2),
            "operating_margin_anchor_pct": round(operating_margin_anchor_pct * 100, 2),
            "terminal_operating_margin_pct": round(terminal_operating_margin_pct * 100, 2),
            "tax_rate_pct": round(tax_rate * 100, 2),
            "reinvestment_rate_anchor_pct": round(reinvestment_rate_anchor_pct * 100, 2),
            "terminal_reinvestment_rate_pct": round(terminal_reinvestment_rate * 100, 2),
            "discount_rate_pct": round(discount_rate * 100, 2),
            "terminal_value_method": terminal_value_method,
            "exit_multiple": round(exit_multiple, 2) if exit_multiple is not None else None,
            "exit_metric": exit_metric,
            "gordon_terminal_value": round(gordon_terminal_value, 0) if gordon_terminal_value is not None else None,
            "gordon_sanity_check_ratio": gordon_sanity_check_ratio,
            "implied_fcf_margin_pct_year_n": implied_fcf_margin_pct_year_n,
        },
    )

    if net_cash is not None and validate_positive_shares(shares_out):
        if shares_path is not None:
            # `enterprise_value` here is already a PER-SHARE dollar figure
            # (see docstring) — add net cash per share directly (Diego's
            # NFPps formula), never divide by shares_out again. "Equity
            # value" as one aggregate dollar figure has no meaning in this
            # mode, so it's left unset rather than reporting a mixed unit.
            net_cash_per_share = net_cash / shares_out
            value_per_share = enterprise_value + net_cash_per_share
            result.value_per_share = round(value_per_share, 2)
        else:
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
