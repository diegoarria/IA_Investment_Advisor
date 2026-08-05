"""
Reverse DCF Engine — Fase 1, Incremento 7 (Parte I: modular reorganization
— see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).
Formalizes Parte E (already implemented since before Fase 1 started, just
not previously in its own module — see the Fase 1 audit).

Relocated verbatim from `fundamental_analysis_service.py` — behavior
unchanged, pinned by the Incremento 1 regression suite
(`tests/test_valuation_reverse_dcf.py`), which imports these exact
functions and passed before and after this move.

Answers "what is the market actually pricing in at today's price?" via
root-finding (scipy's Brent's method) over `legacy_dcf_core`'s forward DCF
— three complementary variants (year-1 fading growth, FCF margin at fixed
growth, constant Expectations-Investing growth), plus the mandatory sanity
check that contextualizes the implied growth against the company's own
real historical FCF CAGR rather than presenting a bare percentage.
"""

from __future__ import annotations

from typing import Optional

from scipy.optimize import brentq

from app.services.valuation.legacy_dcf_core import _run_dcf, _run_dcf_constant_growth, _PROJECTION_YEARS


def _implied_growth_rate(
    base_fcf: float, discount_rate: float, terminal_growth: float,
    total_debt: float, cash: float, shares_out: float, target_price: float,
) -> Optional[float]:
    """Reverse DCF: holding WACC and terminal growth fixed at the base
    scenario's real values, solves algebraically (Brent's method — intrinsic
    value is monotonic increasing in growth, so a bracketed root always
    exists if one is in range) for the year-1 growth rate that would make
    the DCF's intrinsic value equal today's actual market price. This
    answers "what growth is the market actually pricing in?" with a real
    computed number instead of a vague narrative guess — it's the concrete
    answer to "what is the investor buying at this price." Returns None if
    no growth rate in a wide, sane search range reconciles the two (e.g. the
    market price implies a genuinely absurd/impossible growth rate)."""
    def equity_at(g: float) -> float:
        result = _run_dcf(base_fcf, g, discount_rate, terminal_growth)
        return (result["enterprise_value"] - total_debt + cash) / shares_out

    lo, hi = -0.30, 1.50
    if equity_at(lo) > target_price or equity_at(hi) < target_price:
        return None
    g_implied = brentq(lambda g: equity_at(g) - target_price, lo, hi, xtol=1e-6)
    return round(g_implied * 100, 1)


def _implied_fcf_margin_at_fixed_growth(
    revenue: float, growth_fixed: float, discount_rate: float, terminal_growth: float,
    total_debt: float, cash: float, shares_out: float, target_price: float,
) -> Optional[float]:
    """The complementary reverse-DCF question — not "what growth is priced
    in" (that's _implied_growth_rate, which holds margin fixed via base_fcf
    and solves for growth), but "holding growth at what we actually believe
    is realistic, what FCF margin would the market need to believe in for
    this price to be fair?" Two free variables (growth, margin) and one
    equation (price = DCF value) can't both be solved from price alone —
    this is what makes it a genuinely different, complementary diagnostic
    rather than redundant with the growth version: growth is pinned at
    Nuvos's own real trend-based estimate, not backed out from price.
    Returns None if no margin in a sane range [0%, 60%] reconciles the price
    — this itself is a real signal (the price can't be justified by a
    margin assumption alone; growth must also be doing real work)."""
    def equity_at(margin: float) -> float:
        result = _run_dcf(revenue * margin, growth_fixed, discount_rate, terminal_growth)
        return (result["enterprise_value"] - total_debt + cash) / shares_out

    lo, hi = 0.0, 0.60
    if equity_at(lo) > target_price or equity_at(hi) < target_price:
        return None
    margin_implied = brentq(lambda m: equity_at(m) - target_price, lo, hi, xtol=1e-6)
    return round(margin_implied * 100, 1)


def _implied_constant_growth_rate(
    base_fcf: float, discount_rate: float, terminal_growth: float,
    total_debt: float, cash: float, shares_out: float, target_price: float,
) -> Optional[float]:
    """Reverse DCF for Expectations Investing: same algebraic (Brent's
    method) approach as _implied_growth_rate, but solving for a CONSTANT
    annual growth rate (not a year-1 rate that fades to terminal) — the
    standard formulation for "what growth rate, sustained flat for 10
    years, justifies this price." Returns None if no rate in a sane range
    reconciles the price."""
    def equity_at(g: float) -> float:
        result = _run_dcf_constant_growth(base_fcf, g, discount_rate, terminal_growth)
        return (result["enterprise_value"] - total_debt + cash) / shares_out

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
