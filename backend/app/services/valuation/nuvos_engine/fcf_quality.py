"""
FCF Quality — Nuvos Fair Value Engine, Block 2 (Priority 5 + 6 fixes — see
/Users/diegoarria/.claude/plans/cosmic-munching-crown.md methodology
audit).

Wires the gap the audit found: `financial_engine.py:442` hardcodes
`fcf_conversion_pct = None` unconditionally inside the financial-sector
Residual Income model (where the concept genuinely doesn't apply — fine),
but nothing in the DCF/production path ever called the real, working
`FCF/Net Income` computation that already exists inline in
`quality/quality_engine.py:283-284`. This module extracts that exact
formula (`safe_divide` guard included) into a standalone, reusable call
so both this engine and `financial_engine.py` can call one real function
instead of financial_engine silently defaulting to None for every case,
non-financial included.

Per the user's explicit instruction: FCF/EPS divergence affects
CONFIDENCE only here, never a valuation adjustment by itself.

Priority 6: the raw ratio is never modified (never re-derived from
different inputs, never clamped in place) — `raw_fcf_conversion_pct`
always carries the real, unmodified arithmetic. A SEPARATE
`display_fcf_conversion_pct`/`fcf_conversion_meaningful` pair tells a
caller whether that raw number is actually interpretable as a "quality"
signal at its magnitude (confirmed real production values ranged from
-612.6% to +1,754.7% — technically correct, not meaningful at that scale
without a tiny/volatile net-income base skewing it).

Priority 5: the same extreme-conversion signal doubles as an honest,
already-computed proxy for GAAP EPS being severely distorted by SBC or
heavy intangible amortization (confirmed real cases: DDOG, SHOP, AMD,
AXON) — FCF running far above net income is exactly the observable
symptom of "GAAP earnings understate real cash-generating power." This
never changes EPS itself (no adjusted-EPS substitution, per the user's
explicit instruction) — it only raises a transparency flag that lowers
confidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.valuation.robustness import safe_divide

# Same tiers already used inline in quality_engine.py — reused verbatim
# (not re-derived) so both call sites score conversion identically.
_CONVERSION_SCORE_TIERS = [(50, 25), (70, 50), (80, 75), (130, 95), (999, 85)]

# EPS growth exceeding FCF growth by more than this many percentage
# points is flagged as a material divergence — evidence-anchored to the
# same "don't overreact to small wobbles" tolerance this codebase already
# uses elsewhere (deterioration_engine's 10pp direction threshold).
_DIVERGENCE_THRESHOLD_PP = 10.0

# Priority 6 — bounds for calling a conversion ratio economically
# interpretable. Below 0% (opposite signs — FCF and Net Income disagree in
# direction) or above 200% (FCF more than double net income) is real
# arithmetic, but not a meaningful "quality" read without a much smaller
# or more volatile net-income base skewing the ratio.
_MEANINGFUL_LO_PCT = 0.0
_MEANINGFUL_HI_PCT = 200.0

# Priority 5 — same 200% ceiling doubles as the earnings-quality-warning
# trigger: FCF running more than double GAAP net income is the observable
# symptom of heavy SBC/amortization/D&A distorting GAAP EPS downward
# relative to real cash earning power.
_EARNINGS_QUALITY_WARNING_HI_PCT = 200.0


@dataclass
class FcfQualityResult:
    fcf_conversion_pct: Optional[float]  # kept for backward compatibility — same as raw_fcf_conversion_pct
    reason: str
    raw_fcf_conversion_pct: Optional[float] = None
    display_fcf_conversion_pct: Optional[float] = None
    fcf_conversion_meaningful: bool = True
    earnings_quality_warning: bool = False
    earnings_quality_reason: Optional[str] = None


def compute_fcf_conversion(latest_fcf: Optional[float], latest_net_income: Optional[float]) -> FcfQualityResult:
    if latest_fcf is None or latest_net_income is None or latest_net_income <= 0:
        return FcfQualityResult(
            fcf_conversion_pct=None, raw_fcf_conversion_pct=None, display_fcf_conversion_pct=None,
            fcf_conversion_meaningful=False,
            reason="FCF o utilidad neta no disponibles (o utilidad neta no positiva) — sin cálculo de conversión de FCF.",
        )
    conversion = safe_divide(latest_fcf, latest_net_income)
    if conversion is None:
        return FcfQualityResult(
            fcf_conversion_pct=None, raw_fcf_conversion_pct=None, display_fcf_conversion_pct=None,
            fcf_conversion_meaningful=False, reason="No se pudo calcular la conversión de FCF.",
        )
    raw_pct = round(conversion * 100, 1)

    meaningful = _MEANINGFUL_LO_PCT <= raw_pct <= _MEANINGFUL_HI_PCT
    if meaningful:
        display_pct = raw_pct
        reason = f"FCF / Utilidad Neta = {raw_pct}%."
    else:
        display_pct = None
        reason = (
            f"FCF / Utilidad Neta = {raw_pct}% (dato real, sin modificar) — fuera de un rango económicamente "
            "interpretable como señal de 'calidad de conversión'; probablemente refleja una base de utilidad "
            "neta inusualmente pequeña o volátil, no una conversión de efectivo extraordinaria o negativa real."
        )

    warning = False
    warning_reason = None
    if raw_pct > _EARNINGS_QUALITY_WARNING_HI_PCT:
        warning = True
        warning_reason = (
            f"El FCF real supera a la utilidad neta GAAP por {raw_pct - 100:.0f} puntos porcentuales "
            f"(conversión {raw_pct}%) — señal de que el EPS GAAP probablemente subestima el poder real de "
            "generación de ganancias (compensación en acciones, amortización de intangibles u otro efecto no-caja "
            "material). El EPS no se modifica ni se sustituye por uno ajustado; esto solo reduce la confianza y "
            "queda documentado para que el usuario lo sepa."
        )

    return FcfQualityResult(
        fcf_conversion_pct=raw_pct, raw_fcf_conversion_pct=raw_pct, display_fcf_conversion_pct=display_pct,
        fcf_conversion_meaningful=meaningful, reason=reason,
        earnings_quality_warning=warning, earnings_quality_reason=warning_reason,
    )


def flag_divergence(eps_growth_pct: Optional[float], fcf_growth_pct: Optional[float]) -> Optional[str]:
    """Returns a human-readable flag when EPS growth materially exceeds
    FCF growth, else None. Confidence-only signal — never adjusts the
    valuation itself, per the user's explicit instruction."""
    if eps_growth_pct is None or fcf_growth_pct is None:
        return None
    gap = eps_growth_pct - fcf_growth_pct
    if gap > _DIVERGENCE_THRESHOLD_PP:
        return (
            f"El crecimiento de EPS ({eps_growth_pct:.1f}%) supera al de FCF ({fcf_growth_pct:.1f}%) "
            f"por {gap:.1f}pp — las ganancias reportadas están creciendo más rápido que el efectivo real generado."
        )
    return None
