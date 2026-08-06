"""
Reverse DCF Engine — Fase 1, Incremento 7 (Parte I: modular reorganization),
ported to the driver-based DCF in Fase 1.5, Incremento 3 (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Answers "what is the market actually pricing in at today's price?" via
root-finding (scipy's Brent's method) — three complementary variants.

Fase 1.5, Incremento 3 — why this port happened, and why one variant is
NOT ported:

`_implied_growth_rate` and `_implied_fcf_margin_at_fixed_growth` now solve
against `dcf_engine.project_driver_based_dcf` (the same engine
`fundamental_analysis_service.py`'s `driver_based_valuation` and
`monte_carlo_engine.py` already use) instead of `legacy_dcf_core._run_dcf`.
This is a real coherence fix, not just a refactor: both answer questions
directly paired with the SAME headline valuation the rest of the app shows
(margin of safety, market-expectations panel) — solving them against a
DIFFERENT DCF model than the one producing that headline number would mean
the forward and reverse DCF disagree about which model is "the" model,
visible on the very same screen. This port had to land BEFORE the driver-
based engine replaces the legacy one in production (see the plan's Bloque
1/2 ordering) for exactly that reason.

`_implied_constant_growth_rate` (Expectations Investing / Rappaport) is
DELIBERATELY NOT ported. It answers a genuinely different question — "what
constant FCF growth, held flat with no waterfall breakdown, reconciles the
price" — using the company's latest real Owner Earnings as FCF0, already
presented to the user as its own distinct methodology with its own FCF
base (see `fundamental_analysis_service.py`'s `expectations_investing`
block). Forcing this into the multi-driver waterfall (Revenue -> Margin ->
EBIT -> NOPAT -> Reinvestment) would require every one of those layers to
also hold flat (not fade) to keep FCF growth genuinely constant, which is a
fragile, hard-to-explain approximation for no real accuracy gain over the
already-correct constant-growth annuity formula it uses today (kept below
as `_constant_growth_enterprise_value`, relocated out of `legacy_dcf_core`
so this module no longer depends on it for anything).

Root-finding note: every `equity_at(x)` below is proven monotonic in `x`
(more growth/less reinvestment -> strictly higher value), same guarantee
the original legacy-DCF version relied on — `project_driver_based_dcf`'s
own guards (`UnstableGordonGrowthError`, `ValueError` for a non-positive
terminal ROIC) depend only on the FIXED inputs (discount rate, terminal
growth, terminal ROIC), never on the search variable itself, so they either
fire for every point in the search range or none of them — checked once
via the endpoint evaluations, exactly like the original.
"""

from __future__ import annotations

from typing import Optional

from scipy.optimize import brentq

from app.services.valuation.dcf_engine import project_driver_based_dcf, _PROJECTION_YEARS


def _implied_growth_rate(
    revenue_0: float,
    operating_margin_anchor_pct: float,
    terminal_operating_margin_pct: float,
    tax_rate: float,
    reinvestment_rate_anchor_pct: float,
    terminal_roic_pct: float,
    discount_rate: float,
    terminal_growth: float,
    net_cash: float,
    shares_out: float,
    target_price: float,
    high_growth_years: int = 0,
) -> Optional[float]:
    """Reverse DCF: holding every OTHER real input fixed at Nuvos's own
    estimates, solves (Brent's method) for the year-1 revenue growth rate
    that would make the driver-based DCF's value per share equal today's
    actual market price. Returns None if no growth rate in a wide, sane
    search range reconciles the two (e.g. the market price implies a
    genuinely absurd/impossible growth rate)."""
    def equity_at(g: float) -> Optional[float]:
        result = project_driver_based_dcf(
            revenue_0=revenue_0,
            revenue_growth_1=g,
            terminal_growth=terminal_growth,
            operating_margin_anchor_pct=operating_margin_anchor_pct,
            terminal_operating_margin_pct=terminal_operating_margin_pct,
            tax_rate=tax_rate,
            reinvestment_rate_anchor_pct=reinvestment_rate_anchor_pct,
            terminal_roic_pct=terminal_roic_pct,
            discount_rate=discount_rate,
            net_cash=net_cash,
            shares_out=shares_out,
            high_growth_years=high_growth_years,
        )
        return result.value_per_share

    lo, hi = -0.30, 1.50
    v_lo, v_hi = equity_at(lo), equity_at(hi)
    if v_lo is None or v_hi is None or v_lo > target_price or v_hi < target_price:
        return None
    g_implied = brentq(lambda g: equity_at(g) - target_price, lo, hi, xtol=1e-6)
    return round(g_implied * 100, 1)


def _implied_fcf_margin_at_fixed_growth(
    revenue_0: float,
    growth_fixed: float,
    operating_margin_anchor_pct: float,
    terminal_operating_margin_pct: float,
    tax_rate: float,
    terminal_roic_pct: float,
    discount_rate: float,
    terminal_growth: float,
    net_cash: float,
    shares_out: float,
    target_price: float,
    high_growth_years: int = 0,
) -> Optional[float]:
    """The complementary reverse-DCF question — not "what growth is priced
    in" (growth pinned at Nuvos's own real trend estimate here), but
    "holding growth fixed, what FCF margin would the market need to
    believe in for this price to be fair?"

    The driver-based waterfall has no single "FCF margin" input the way the
    old flat FCF-only model did (FCF margin there = the only lever; here
    FCF/Revenue is a compound result of operating margin AND reinvestment
    rate). Operating margin is held fixed at Nuvos's own real estimate —
    that lever is `_implied_growth_rate`'s and (from Fase 1.5, Incremento
    12 onward) its own dedicated "implied operating margin" reverse-DCF
    question, not this one. The free variable solved for here is the
    REINVESTMENT RATE anchor (mirroring the anchor across the projection's
    start — it still fades toward the same real terminal reinvestment rate
    implied by `terminal_roic_pct`), since reinvestment intensity is what
    actually determines how much of NOPAT converts to FCF — the direct
    analog of "FCF margin" as a lever, complementary to operating margin.
    The number reported back is the resulting YEAR-1 FCF/Revenue implied by
    that solved reinvestment rate, so the external meaning of
    `implied_margin_pct` ("what FCF margin does the price require") is
    unchanged even though the underlying free variable is not literally
    "margin" anymore.

    Returns None if no reinvestment rate in [-50%, 150%] (the same sane
    range `dcf_engine.compute_reinvestment_rate_anchor` already clamps to)
    reconciles the price."""
    def equity_and_margin_at(reinv_rate: float) -> tuple[Optional[float], Optional[float]]:
        result = project_driver_based_dcf(
            revenue_0=revenue_0,
            revenue_growth_1=growth_fixed,
            terminal_growth=terminal_growth,
            operating_margin_anchor_pct=operating_margin_anchor_pct,
            terminal_operating_margin_pct=terminal_operating_margin_pct,
            tax_rate=tax_rate,
            reinvestment_rate_anchor_pct=reinv_rate,
            terminal_roic_pct=terminal_roic_pct,
            discount_rate=discount_rate,
            net_cash=net_cash,
            shares_out=shares_out,
            high_growth_years=high_growth_years,
        )
        year_1 = result.yearly[0]
        implied_margin = year_1.fcf / year_1.revenue if year_1.revenue else None
        return result.value_per_share, implied_margin

    lo, hi = -0.50, 1.50
    v_lo, _ = equity_and_margin_at(lo)
    v_hi, _ = equity_and_margin_at(hi)
    # Unlike growth (strictly increasing in value), value is DECREASING in
    # reinvestment rate — more reinvestment means less FCF today. The
    # bracket check is direction-agnostic (min/max) rather than assuming
    # v_lo < v_hi, so it stays correct either way.
    if v_lo is None or v_hi is None or not (min(v_lo, v_hi) <= target_price <= max(v_lo, v_hi)):
        return None

    def equity_only(reinv_rate: float) -> float:
        v, _ = equity_and_margin_at(reinv_rate)
        return v - target_price

    reinv_implied = brentq(equity_only, lo, hi, xtol=1e-6)
    _, margin_implied = equity_and_margin_at(reinv_implied)
    return round(margin_implied * 100, 1) if margin_implied is not None else None


def _constant_growth_enterprise_value(
    base_fcf: float, growth: float, discount_rate: float, terminal_growth: float, years: int = _PROJECTION_YEARS,
) -> float:
    """Expectations Investing (Rappaport): FCF grows at a CONSTANT rate
    every explicit year (never fading, unlike the driver-based waterfall's
    revenue growth), then a Gordon-growth terminal value at `terminal_growth`
    beyond year `years`. Relocated verbatim from
    `legacy_dcf_core._run_dcf_constant_growth` — see this module's
    docstring for why `_implied_constant_growth_rate` keeps this simple
    formula instead of the driver-based waterfall."""
    v = base_fcf
    path = []
    for _ in range(years):
        v *= (1 + growth)
        path.append(v)
    pv_sum = sum(cf / ((1 + discount_rate) ** yr) for yr, cf in enumerate(path, start=1))
    final_cf = path[-1]
    terminal_value = final_cf * (1 + terminal_growth) / (discount_rate - terminal_growth)
    pv_terminal = terminal_value / ((1 + discount_rate) ** years)
    return pv_sum + pv_terminal


def _implied_constant_growth_rate(
    base_fcf: float, discount_rate: float, terminal_growth: float,
    total_debt: float, cash: float, shares_out: float, target_price: float,
) -> Optional[float]:
    """Reverse DCF for Expectations Investing: solves (Brent's method) for
    the CONSTANT annual growth rate (not a year-1 rate that fades to
    terminal) that reconciles today's price — the standard formulation for
    "what growth rate, sustained flat for 10 years, justifies this price."
    Returns None if no rate in a sane range reconciles the price. See this
    module's docstring for why this variant does not use the driver-based
    waterfall the other two now use."""
    def equity_at(g: float) -> float:
        ev = _constant_growth_enterprise_value(base_fcf, g, discount_rate, terminal_growth)
        return (ev - total_debt + cash) / shares_out

    lo, hi = -0.30, 1.50
    if equity_at(lo) > target_price or equity_at(hi) < target_price:
        return None
    g_implied = brentq(lambda g: equity_at(g) - target_price, lo, hi, xtol=1e-6)
    return round(g_implied * 100, 1)


def sanity_check_reverse_dcf(
    implied_growth_pct: Optional[float], fcf_base: float,
    historical_fcf_cagr_pct: Optional[float], years: int = _PROJECTION_YEARS,
) -> Optional[dict]:
    """Automatic sanity check for the reverse-DCF's implied growth rate —
    never let a raw percentage stand alone without context. Projects FCF
    forward `years` at the implied rate and compares it explicitly against
    the company's OWN real historical FCF CAGR (already computed elsewhere
    in this module, never a peer/industry average) — flagging when the
    market is pricing in more than 2x that pace, which signals "the price
    requires a regime change, not just continuation" rather than a simple
    extrapolation. Returns None if there isn't enough real data (no implied
    growth solved, or no historical CAGR to compare against)."""
    if implied_growth_pct is None or historical_fcf_cagr_pct is None or fcf_base is None:
        return None
    g = implied_growth_pct / 100
    fcf_projected_year_n = round(fcf_base * (1 + g) ** years, 0)
    hist_cagr = historical_fcf_cagr_pct / 100
    if hist_cagr > 0:
        ratio = g / hist_cagr
        vs_historical = "mayor" if ratio > 1.15 else "menor" if ratio < 0.85 else "similar"
    else:
        vs_historical = "mayor" if g > 0 else "similar"
    regime_change_flag = hist_cagr > 0 and g > 2 * hist_cagr
    return {
        "fcf_projected_year_n": fcf_projected_year_n,
        "years": years,
        "vs_cagr_historico_propio": vs_historical,
        "regime_change_flag": regime_change_flag,
        "detalle": (
            f"El crecimiento implícito ({implied_growth_pct}%) es más del doble del CAGR histórico real de FCF de la "
            f"propia empresa ({historical_fcf_cagr_pct}%) — el precio actual exige un cambio de régimen de crecimiento, "
            f"no solo continuidad del historial."
            if regime_change_flag else
            f"Crecimiento implícito ({implied_growth_pct}%) {vs_historical} al CAGR histórico real de FCF de la empresa ({historical_fcf_cagr_pct}%)."
        ),
    }
