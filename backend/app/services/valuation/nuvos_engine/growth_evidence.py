"""
Growth Evidence — Nuvos Fair Value Engine, Priority 1 fix (methodology
audit, see /Users/diegoarria/.claude/plans/cosmic-munching-crown.md).

The audit's most important finding: `fair_pe.py`'s growth adjustment only
ever read live forward-analyst-consensus EPS growth
(`expected_eps_growth_pct`, sourced from yfinance), which was unavailable
in 100% of a 111-company validation run — silently zeroing out the
"Growth" third of "Growth + Quality + Value" for every company, including
NVDA (206.6% EPS CAGR) and MA (17.3%).

This module resolves a single growth figure through an evidence
hierarchy, falling back to real signals the engine already computes
before giving up — never fabricating a number, never silently defaulting
to zero when real evidence exists elsewhere in the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.valuation.numeric_helpers import compound_per_share_growth

GrowthSource = str  # "per_share_compounded" | "forward_consensus" | "historical_eps_cagr" | "historical_revenue_cagr" | "normalized_growth" | "insufficient"


@dataclass
class GrowthEvidenceResult:
    growth_pct: Optional[float]
    source: GrowthSource
    reason: str


def resolve_growth_evidence(
    *,
    forward_consensus_pct: Optional[float] = None,
    eps_cagr_pct: Optional[float] = None,
    revenue_cagr_pct: Optional[float] = None,
    normalized_growth_pct: Optional[float] = None,
    shares_cagr_pct: Optional[float] = None,
) -> GrowthEvidenceResult:
    """Single entry point. Hierarchy (mandatory per-share Fair Value Engine,
    methodology audit round 5 — see /Users/diegoarria/.claude/plans/cosmic-
    munching-crown.md):
    0. Per-share compounded growth (real revenue CAGR × real historical
       buyback yield), when BOTH real inputs are available — Diego's
       mandated methodology, takes priority over forward consensus since
       it's the company's own real history, not an external estimate.
    1. Forward EPS growth consensus, when real.
    2. Historical EPS CAGR.
    3. Historical revenue CAGR.
    4. Normalized growth already blended by growth_engine.py (6 weighted
       real signals — recent trend, incremental ROIC, moat stability,
       deterioration direction, capital allocation, industry comparison).
    5. None — `source="insufficient"`. Never invents a rate."""
    if revenue_cagr_pct is not None and shares_cagr_pct is not None:
        buyback_yield_pct = -shares_cagr_pct  # shares_cagr_pct: negative = buybacks, positive = dilution — flip sign to a "yield" (positive when shares shrink)
        g_ps = compound_per_share_growth(revenue_cagr_pct, buyback_yield_pct)
        return GrowthEvidenceResult(
            round(g_ps, 1), "per_share_compounded",
            f"Crecimiento por acción compuesto: ingresos ({revenue_cagr_pct:+.1f}%) × yield de recompra real "
            f"({buyback_yield_pct:+.1f}%) = {g_ps:+.1f}%.",
        )
    if forward_consensus_pct is not None:
        return GrowthEvidenceResult(
            forward_consensus_pct, "forward_consensus",
            f"Consenso de analistas (crecimiento de EPS forward): {forward_consensus_pct:.1f}%.",
        )
    if eps_cagr_pct is not None:
        return GrowthEvidenceResult(
            eps_cagr_pct, "historical_eps_cagr",
            f"Sin consenso forward disponible — se usa el CAGR histórico real de EPS: {eps_cagr_pct:.1f}%.",
        )
    if revenue_cagr_pct is not None:
        return GrowthEvidenceResult(
            revenue_cagr_pct, "historical_revenue_cagr",
            f"Sin consenso forward ni CAGR de EPS disponibles — se usa el CAGR histórico real de ingresos: {revenue_cagr_pct:.1f}%.",
        )
    if normalized_growth_pct is not None:
        return GrowthEvidenceResult(
            normalized_growth_pct, "normalized_growth",
            f"Sin consenso forward ni CAGR histórico disponibles — se usa el crecimiento normalizado "
            f"(blend multi-señal de growth_engine.py): {normalized_growth_pct:.1f}%.",
        )
    return GrowthEvidenceResult(
        None, "insufficient",
        "No hay evidencia real de crecimiento disponible (ni consenso forward, ni CAGR histórico de EPS o "
        "ingresos, ni crecimiento normalizado) — el ajuste de crecimiento queda en 0; no se fabrica un número.",
    )
