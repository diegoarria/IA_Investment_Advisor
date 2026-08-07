"""
Fair Value Engine — originally built Fase 1, Incremento 6 (Parte G of the
valuation-engine redesign) as an independent second valuation method:
"is the current price reasonable given this business's growth and
quality," separate from the DCF's "what are the cash flows worth."

Nuvos AI Fair Value Engine redesign, Incremento 16 — retired as a
standalone valuation (never shown as an independent method on web; its
mobile-only display was retired in the same increment). The module stays:
its 6 adjustment functions (`_growth_adjustment`, `_quality_adjustment`,
`_fcf_margin_adjustment`, `_leverage_adjustment`, `_dividend_adjustment`,
`_moat_management_adjustment`) are a direct dependency of
`exit_multiple_engine.py` (Incremento 1), reused verbatim to derive the
bounded adjustment applied to a real exit-multiple anchor — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md.

`compute_justified_multiple`/`compute_fair_value`/`sector_base_multiple`
(the original "Valor Razonable = EPS × Múltiplo Justificado" entry points)
are kept, still real and tested (`tests/test_valuation_fair_value_engine.py`),
even though no production caller invokes them anymore — deleting a
working, coherent public API purely because its one caller was retired
would be more destructive than useful; the module's actual dependency
surface for the current architecture is the 6 adjustment functions above.

Explicitly NOT a PEG ratio (P/E ÷ growth) — Peter Lynch's formula is never
referenced or reproduced. Growth is one of several additive point
adjustments to an industry base multiple, not a divisor.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.robustness import clamp

# ── Industry base P/E — same substring-match pattern already used for
# sector discount rates / terminal growth in dcf_engine.py's neighbor
# fundamental_analysis_service.py, so sector classification behaves
# identically across every engine in this package. These are long-run,
# widely-cited sector average multiples (illustrative anchors, not
# backtested) — the honest v1 starting point per the module docstring.
_SECTOR_BASE_PE: list[tuple[str, float]] = [
    ("utilities", 16.0),
    ("real estate", 15.0),
    ("consumer defensive", 20.0),
    ("bank", 11.0),
    ("insurance", 12.0),
    ("financial services", 12.0),
    ("healthcare", 19.0),
    ("drug", 19.0),
    ("industrials", 17.0),
    ("basic materials", 13.0),
    ("consumer cyclical", 18.0),
    ("retail", 18.0),
    ("energy", 11.0),
    ("communication services", 17.0),
    ("technology", 23.0),
    ("biotechnology", 18.0),
]
_DEFAULT_BASE_PE = 17.0

_MULTIPLE_LO, _MULTIPLE_HI = 5.0, 60.0  # sane final-multiple bounds — never present an absurd P/E as "justified"


def sector_base_multiple(sector: Optional[str]) -> float:
    if not sector:
        return _DEFAULT_BASE_PE
    s = sector.lower()
    for key, pe in _SECTOR_BASE_PE:
        if key in s:
            return pe
    return _DEFAULT_BASE_PE


@dataclass
class MultipleAdjustment:
    factor: str
    points: float
    reason: str


@dataclass
class JustifiedMultipleResult:
    sector: Optional[str]
    base_multiple: float
    adjustments: list[MultipleAdjustment]
    justified_multiple: float


def _growth_adjustment(expected_eps_growth_pct: Optional[float]) -> MultipleAdjustment:
    """+0.4 multiple points per 1pp of expected growth ABOVE a 5% baseline
    (roughly long-run nominal GDP growth — growing at that pace isn't
    doing anything a below-average business couldn't also do), capped at
    +10x; -0.3 points per 1pp BELOW that baseline, capped at -5x — a
    shrinking or barely-growing business deserves a real discount, but not
    an unbounded one (a single bad year shouldn't crater the multiple).
    Deliberately additive, not a P/E-over-growth ratio (see module
    docstring)."""
    if expected_eps_growth_pct is None:
        return MultipleAdjustment("growth", 0.0, "Crecimiento esperado no disponible — sin ajuste.")
    delta = expected_eps_growth_pct - 5.0
    pts = clamp(delta * 0.4, -5.0, 10.0) if delta >= 0 else clamp(delta * 0.3, -5.0, 10.0)
    return MultipleAdjustment(
        "growth", round(pts, 2),
        f"Crecimiento esperado {expected_eps_growth_pct:.1f}% vs. 5% base → {pts:+.1f}x",
    )


def _quality_adjustment(roic_pct: Optional[float], cost_of_capital_pct: Optional[float]) -> MultipleAdjustment:
    """+0.25 multiple points per 1pp of ROIC ABOVE the company's own cost
    of capital (the real economic-profit spread — a business earning
    meaningfully more than its cost of capital is creating real value per
    dollar invested, which is exactly what a higher multiple should
    reward), bounded [-4, +8]. Uses the SAME WACC the DCF engine computes
    for this company (not a generic industry rate), so the quality signal
    is calibrated to this specific business's actual risk."""
    if roic_pct is None or cost_of_capital_pct is None:
        return MultipleAdjustment("quality", 0.0, "ROIC o costo de capital no disponible — sin ajuste.")
    spread = roic_pct - cost_of_capital_pct
    pts = clamp(spread * 0.25, -4.0, 8.0)
    return MultipleAdjustment(
        "quality", round(pts, 2),
        f"ROIC {roic_pct:.1f}% vs. costo de capital {cost_of_capital_pct:.1f}% (spread {spread:+.1f}pp) → {pts:+.1f}x",
    )


def _fcf_margin_adjustment(fcf_margin_pct: Optional[float]) -> MultipleAdjustment:
    """+0.15 multiple points per 1pp of FCF margin ABOVE a 10% baseline
    (a reasonable "healthy cash conversion" reference point across most
    non-financial industries), bounded [-3, +5] — rewards businesses that
    convert reported earnings into REAL cash at an above-average rate,
    since GAAP earnings alone can mask working-capital or capex burdens a
    justified multiple should discount for."""
    if fcf_margin_pct is None:
        return MultipleAdjustment("fcf_margin", 0.0, "Margen de FCF no disponible — sin ajuste.")
    delta = fcf_margin_pct - 10.0
    pts = clamp(delta * 0.15, -3.0, 5.0)
    return MultipleAdjustment(
        "fcf_margin", round(pts, 2),
        f"Margen de FCF {fcf_margin_pct:.1f}% vs. 10% base → {pts:+.1f}x",
    )


def _leverage_adjustment(net_debt_to_ebitda: Optional[float], interest_coverage: Optional[float]) -> MultipleAdjustment:
    """Two independent real risk signals, each only penalizing (never
    rewarding) since balance-sheet strength is a risk REDUCER, not a
    quality creator on its own: -0.5 points per 1x of Net Debt/EBITDA
    above 2.0x (a common "comfortable leverage" reference ceiling across
    industries), capped at -5; -0.3 points per 1x that interest coverage
    falls short of 5x, capped at -3. Neither penalty applies if the
    company is actually within/above the healthy range (net cash, or
    ample coverage) — this never adds a premium for low leverage, only
    withholds the penalty."""
    pts = 0.0
    parts: list[str] = []
    if net_debt_to_ebitda is not None:
        excess = max(net_debt_to_ebitda - 2.0, 0.0)
        debt_pts = -min(excess * 0.5, 5.0)
        pts += debt_pts
        if debt_pts != 0:
            parts.append(f"Deuda neta/EBITDA {net_debt_to_ebitda:.1f}x → {debt_pts:+.1f}x")
    if interest_coverage is not None:
        shortfall = max(5.0 - interest_coverage, 0.0)
        cov_pts = -min(shortfall * 0.3, 3.0)
        pts += cov_pts
        if cov_pts != 0:
            parts.append(f"Cobertura de intereses {interest_coverage:.1f}x → {cov_pts:+.1f}x")
    if not parts:
        reason = "Apalancamiento saludable o datos no disponibles — sin penalización." if (net_debt_to_ebitda is not None or interest_coverage is not None) else "Datos de apalancamiento no disponibles — sin ajuste."
        return MultipleAdjustment("leverage", 0.0, reason)
    return MultipleAdjustment("leverage", round(pts, 2), "; ".join(parts))


def _dividend_adjustment(dividend_yield_pct: Optional[float]) -> MultipleAdjustment:
    """A small, capped premium (+0.2 points per 1pp of yield, max +2x) for
    real capital return to shareholders — deliberately modest and capped,
    since an unusually HIGH yield is at least as often a distress signal
    (market pricing in a cut) as a quality signal, and this engine has no
    dividend-sustainability model to distinguish the two in v1."""
    if dividend_yield_pct is None or dividend_yield_pct <= 0:
        return MultipleAdjustment("dividend", 0.0, "Sin dividendo real pagado — sin ajuste.")
    pts = clamp(dividend_yield_pct * 0.2, 0.0, 2.0)
    return MultipleAdjustment(
        "dividend", round(pts, 2),
        f"Dividend yield real {dividend_yield_pct:.1f}% → {pts:+.1f}x",
    )


def _moat_management_adjustment(moat_score: Optional[float], management_score: Optional[float]) -> MultipleAdjustment:
    """Reuses the 0-100 quality/predictability and management/capital-
    allocation scores already computed elsewhere in this codebase (the
    Investment Thesis Scorecard) as the "moat" and "management" signals
    the brief asks for — never a NEW invented qualitative score. 50 is
    treated as neutral (no adjustment); above/below scales at 0.06 and
    0.04 points per point of score respectively, bounded [-3,+4] for moat
    and [-2,+3] for management (moat weighted higher — a durable
    competitive advantage is structurally more valuable than good
    capital allocation on an otherwise average business)."""
    pts = 0.0
    parts: list[str] = []
    if moat_score is not None:
        p = clamp((moat_score - 50) * 0.06, -3.0, 4.0)
        pts += p
        parts.append(f"Moat/calidad {moat_score:.0f}/100 → {p:+.1f}x")
    if management_score is not None:
        p2 = clamp((management_score - 50) * 0.04, -2.0, 3.0)
        pts += p2
        parts.append(f"Gestión/capital allocation {management_score:.0f}/100 → {p2:+.1f}x")
    if not parts:
        return MultipleAdjustment("moat_management", 0.0, "Sin señales cualitativas disponibles — sin ajuste.")
    return MultipleAdjustment("moat_management", round(pts, 2), "; ".join(parts))


def compute_justified_multiple(
    sector: Optional[str],
    expected_eps_growth_pct: Optional[float],
    roic_pct: Optional[float],
    cost_of_capital_pct: Optional[float],
    fcf_margin_pct: Optional[float],
    net_debt_to_ebitda: Optional[float],
    interest_coverage: Optional[float],
    dividend_yield_pct: Optional[float],
    moat_score: Optional[float],
    management_score: Optional[float],
) -> JustifiedMultipleResult:
    """Industry base multiple + 6 independent, bounded, documented
    adjustments (growth, quality/ROIC, FCF margin, leverage, dividend,
    moat/management) — every adjustment's real-world justification is in
    its own function's docstring. Final multiple clamped to [5, 60] so a
    combination of extreme inputs can never produce an absurd "justified"
    number (same defensive philosophy as the DCF engine's own clamps)."""
    base = sector_base_multiple(sector)
    adjustments = [
        _growth_adjustment(expected_eps_growth_pct),
        _quality_adjustment(roic_pct, cost_of_capital_pct),
        _fcf_margin_adjustment(fcf_margin_pct),
        _leverage_adjustment(net_debt_to_ebitda, interest_coverage),
        _dividend_adjustment(dividend_yield_pct),
        _moat_management_adjustment(moat_score, management_score),
    ]
    raw_multiple = base + sum(a.points for a in adjustments)
    justified_multiple = clamp(raw_multiple, _MULTIPLE_LO, _MULTIPLE_HI)
    return JustifiedMultipleResult(
        sector=sector, base_multiple=base, adjustments=adjustments,
        justified_multiple=round(justified_multiple, 2),
    )


def compute_fair_value(eps: Optional[float], justified_multiple: float) -> Optional[float]:
    """Valor Razonable = EPS × Múltiplo Justificado. Returns None (never a
    fabricated value) for non-positive EPS — a loss-making company has no
    meaningful P/E-based fair value; that's real information, not a gap to
    paper over with a guess."""
    if eps is None or eps <= 0:
        return None
    return round(eps * justified_multiple, 2)
