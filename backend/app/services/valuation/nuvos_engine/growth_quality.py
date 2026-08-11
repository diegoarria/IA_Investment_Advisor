"""
Growth Quality — Nuvos Fair Value Engine, Block 1 (Priority 4 fix — see
/Users/diegoarria/.claude/plans/cosmic-munching-crown.md methodology
audit).

Decomposes EPS growth into revenue growth / margin expansion / buybacks /
unexplained-other, so the engine can tell "the business is actually
growing" apart from "EPS is growing because the company bought back
shares." Buybacks aren't penalized as bad — they just don't get credited
as organic operating growth in `fair_pe.py`'s weighting.

The audit found `_shares_cagr` effectively non-functional in production:
requiring a rigid, gap-free 5-year lookback meant only 1 of 76 real
companies in a validation run produced a real `from_buybacks_pct`. This
version tries the longest real continuous window available (6/5/4/3
years) instead of requiring one fixed length, and never fills a gap with
an estimate — a shorter real window beats no window, but a window is
never fabricated.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.quality.quality_engine import compute_cagr_windows

# Minimum window Nuvos will still call "real evidence" for a shares CAGR —
# below this, a 2-year span is too noisy (one buyback-heavy or one
# dilutive year alone shouldn't be read as a trend).
_MIN_SHARES_CAGR_YEARS = 3
_SHARES_CAGR_WINDOWS = (6, 5, 4, 3)  # longest-available-first, per Priority 4

# A growth-decomposition residual this large relative to the EPS CAGR
# itself is a real signal the underlying EPS CAGR is corrupted by a
# corporate action (spinoff, major M&A, share-class reorg) rather than a
# normal — if noisy — business signal. Confirmed real case: GE's +472pp
# residual around the GE HealthCare / GE Vernova spinoffs.
_CORPORATE_ACTION_RESIDUAL_THRESHOLD_PP = 150.0


@dataclass
class EpsGrowthDecomposition:
    eps_cagr_pct: Optional[float]
    revenue_cagr_pct: Optional[float]
    shares_cagr_pct: Optional[float]  # negative = net buybacks, positive = net dilution
    from_revenue_pct: Optional[float]
    from_margin_expansion_pct: Optional[float]
    from_buybacks_pct: Optional[float]
    from_unexplained_pct: Optional[float]
    reason: str
    # Priority 4 additions — traceability for which window backed the
    # shares CAGR, and an explicit flag when the residual is too large to
    # trust as an ordinary business signal.
    shares_cagr_period_years: Optional[int] = None
    shares_cagr_source: str = "insufficient"  # "{n}y_window" | "insufficient"
    buyback_evidence_status: str = "insufficient"  # "available" | "insufficient"
    corporate_action_distortion: bool = False


def _shares_cagr(implied_shares_trend: list[Optional[float]]) -> tuple[Optional[float], Optional[int], str]:
    """Tries the longest real continuous window first (6y), falling back to
    shorter real windows (5y/4y/3y) rather than requiring one fixed
    length. Never fills a gap — `compute_cagr_windows` already returns
    None for any window whose endpoints aren't both real, so a window is
    only accepted when both ends are genuine reported data."""
    windows = compute_cagr_windows(implied_shares_trend, windows=_SHARES_CAGR_WINDOWS)
    for years in _SHARES_CAGR_WINDOWS:
        value = windows.get(f"{years}y")
        if value is not None and years >= _MIN_SHARES_CAGR_YEARS:
            return value, years, f"{years}y_window"
    return None, None, "insufficient"


def decompose_eps_growth(
    *,
    eps_cagr_pct: Optional[float],
    revenue_cagr_pct: Optional[float],
    implied_shares_trend: list[Optional[float]],
) -> EpsGrowthDecomposition:
    """Single entry point. Additive decomposition: EPS growth ≈ revenue
    growth + margin-expansion effect (residual) − share-count CAGR
    (buyback effect), with whatever doesn't reconcile recorded as
    `from_unexplained_pct` rather than silently folded into "organic" —
    an unexplained residual is real information (data noise, one-time
    items, tax effects) that should lower confidence, not be hidden."""
    if eps_cagr_pct is None:
        return EpsGrowthDecomposition(
            eps_cagr_pct=None, revenue_cagr_pct=revenue_cagr_pct, shares_cagr_pct=None,
            from_revenue_pct=None, from_margin_expansion_pct=None, from_buybacks_pct=None,
            from_unexplained_pct=None,
            reason="EPS CAGR no disponible — no se puede descomponer el crecimiento.",
        )

    shares_cagr, shares_years, shares_source = _shares_cagr(implied_shares_trend)
    from_buybacks = round(-shares_cagr, 1) if shares_cagr is not None else None
    buyback_status = "available" if shares_cagr is not None else "insufficient"

    if revenue_cagr_pct is None:
        # Can still attribute the buyback slice if we have shares data,
        # but revenue/margin split is impossible without revenue CAGR.
        remaining = eps_cagr_pct - (from_buybacks or 0.0)
        return EpsGrowthDecomposition(
            eps_cagr_pct=eps_cagr_pct, revenue_cagr_pct=None, shares_cagr_pct=shares_cagr,
            from_revenue_pct=None, from_margin_expansion_pct=None,
            from_buybacks_pct=from_buybacks,
            from_unexplained_pct=round(remaining, 1) if from_buybacks is not None else round(eps_cagr_pct, 1),
            reason="CAGR de ingresos no disponible — solo se pudo aislar el efecto de recompras (si hay datos de acciones); el resto queda como no explicado.",
            shares_cagr_period_years=shares_years, shares_cagr_source=shares_source,
            buyback_evidence_status=buyback_status,
            corporate_action_distortion=abs(remaining) > _CORPORATE_ACTION_RESIDUAL_THRESHOLD_PP,
        )

    from_revenue = round(revenue_cagr_pct, 1)
    residual_after_revenue_and_buybacks = eps_cagr_pct - from_revenue - (from_buybacks or 0.0)
    # Residual attributed to margin expansion (or contraction, if
    # negative) — this is a plug, explicitly labeled, not re-derived from
    # an independent margin-trend calculation, since the codebase's
    # margin-trend data isn't always available at this call site; when a
    # caller HAS a real margin-expansion figure, they should prefer that
    # and treat this as a cross-check.
    from_margin = round(residual_after_revenue_and_buybacks, 1)

    # If the margin-expansion residual is implausibly large relative to
    # revenue+buyback effects, don't claim confidence in the split — move
    # the excess into "unexplained" instead of overstating a margin story.
    unexplained = 0.0
    if abs(from_margin) > abs(eps_cagr_pct) * 0.75 and abs(eps_cagr_pct) > 1.0:
        unexplained = from_margin
        from_margin = 0.0

    is_distorted = abs(unexplained) > _CORPORATE_ACTION_RESIDUAL_THRESHOLD_PP
    reason = (
        f"EPS CAGR {eps_cagr_pct:.1f}% ≈ ingresos {from_revenue:+.1f}pp"
        + (f" + recompras {from_buybacks:+.1f}pp" if from_buybacks is not None else "")
        + f" + expansión de margen {from_margin:+.1f}pp"
        + (f" + no explicado {unexplained:+.1f}pp" if unexplained else "")
        + "."
    )
    if is_distorted:
        reason += (
            f" El residual no explicado ({unexplained:+.1f}pp) es demasiado grande para ser una señal de "
            "negocio normal — probablemente el EPS CAGR base está distorsionado por una acción corporativa "
            "(spinoff, fusión/adquisición mayor, reorganización de clases de acciones). No se presenta como "
            "una señal económica normal."
        )

    return EpsGrowthDecomposition(
        eps_cagr_pct=eps_cagr_pct, revenue_cagr_pct=revenue_cagr_pct, shares_cagr_pct=shares_cagr,
        from_revenue_pct=from_revenue,
        from_margin_expansion_pct=from_margin,
        from_buybacks_pct=from_buybacks,
        from_unexplained_pct=round(unexplained, 1),
        reason=reason,
        shares_cagr_period_years=shares_years, shares_cagr_source=shares_source,
        buyback_evidence_status=buyback_status,
        corporate_action_distortion=is_distorted,
    )
