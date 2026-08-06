"""
Growth Engine — Fase 1.5, Incremento 8 (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Fills the exact gap the audit found: `fundamental_analysis_service.py`'s
`growth_buildup` still projects future growth from a single-period
historical CAGR alone (`base_historical_growth`), with `moat_adjustment`
permanently pinned at `0.0` — the original moat-based bonus (up to +3pp for
avg_roic_pct >= 40%) was removed after real testing (TSM/Adobe/Intuit)
showed it stacking with the terminal-growth ceiling to produce 55-67%
"margin of safety" that didn't hold up (see that removal's own comment,
`fundamental_analysis_service.py` around the `moat_adjustment = 0.0` line).

This module is a deliberately more disciplined replacement, not a return to
the old one-directional bonus:

1. BOUNDED both ways. `_MAX_ADJUSTMENT_PP` caps the total adjustment at
   +-2.0 percentage points (smaller than the old one-directional +3pp), and
   the blended signal can genuinely be NEGATIVE — a company with
   deteriorating trends or below-average incremental returns gets growth
   pulled DOWN, not just occasionally boosted up. The old adjustment could
   only ever add.

2. MULTI-FACTOR, not "high ROIC alone." The exact trap the removed
   adjustment fell into was rewarding a single input (sustained high ROIC)
   without checking whether anything else corroborated a durable, ongoing
   growth story. This blends six independent real signals (see `_WEIGHTS`)
   — a high-ROIC company with a decelerating recent trend or deteriorating
   margins does NOT get the same treatment as one where every signal agrees.

3. Consumes real Fase 2 engine outputs (`moat_engine`, `deterioration_engine`,
   plus `quality_engine`'s multi-window CAGR/incremental ROIC) instead of
   re-deriving anything — this module performs zero fetching and zero
   re-scoring math of its own beyond blending already-computed signals.
   `capital_allocation_score` and `industry_median_revenue_cagr_pct` are
   OPTIONAL: both require network I/O (peer fetches, historical price
   lookups) that `fundamental_analysis_service.py`'s otherwise-synchronous,
   already-fetched-data computation deliberately does not add — when a
   caller doesn't have them, `weighted_mean` renormalizes over whatever
   signals ARE available (same "never let a missing component silently
   count as zero" philosophy the rest of Fase 2 already uses), never
   fabricating an industry comparison from nothing.

Every factor is emitted in the same `{name, value, score, reason}` shape
`quality_engine`/`moat_engine`/`capital_allocation_engine` already use (no
shared base class exists in this codebase — each engine defines its own
structurally-identical Factor dataclass, so this one does too, matching
the established pattern rather than introducing a new shared type) — this
is what lets `ExplainableValue.tsx`/`src/lib/explainability.ts` render it
on the frontend with zero adapter code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.numeric_helpers import weighted_mean
from app.services.valuation.robustness import clamp
from app.services.quality.moat_engine import MoatScoreResult
from app.services.quality.deterioration_engine import DeteriorationResult

# Deliberately smaller than the removed moat_adjustment's one-directional
# +3pp ceiling, and applied to a BLENDED multi-factor signal rather than a
# single input — see module docstring point 1.
_MAX_ADJUSTMENT_PP = 2.0

_WEIGHTS = {
    "recent_growth_trend": 0.25,
    "incremental_roic_vs_average": 0.20,
    "moat_stability": 0.20,
    "deterioration_direction": 0.20,
    "capital_allocation": 0.10,
    "industry_growth_comparison": 0.05,
}


@dataclass
class GrowthFactor:
    name: str
    value: Optional[float]
    # Normalized signal in [-100, 100] — NOT a 0-100 quality tier like the
    # other Fase 2 engines' `score` fields. Deliberate: this factor can
    # argue for LESS growth than the historical base, which a 0-100-only
    # scale can't represent. Documented here since it's a real deviation
    # from the established convention, not an oversight.
    score: Optional[float]
    reason: str


@dataclass
class GrowthEngineResult:
    historical_growth_pct: float
    quality_adjusted_growth_pct: float
    total_adjustment_pct: float
    factors: list[GrowthFactor] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return any(f.score is not None for f in self.factors)


def compute_weighted_growth(
    *,
    historical_growth_pct: float,
    cagr_windows: dict[str, Optional[float]],
    avg_roic_pct: Optional[float],
    incremental_roic_pct: Optional[float],
    moat_result: MoatScoreResult,
    deterioration_result: DeteriorationResult,
    capital_allocation_score: Optional[int] = None,
    industry_median_revenue_cagr_pct: Optional[float] = None,
) -> GrowthEngineResult:
    """The single entry point. `historical_growth_pct` is a DECIMAL (0.14 =
    14%, matching `dcf_engine.project_driver_based_dcf`'s own convention for
    `revenue_growth_1`) — every other `_pct`-suffixed input here is in real
    percentage POINTS (0-100 scale), matching how `quality_engine`/
    `moat_engine`/`deterioration_engine` already report them. Returns
    `quality_adjusted_growth_pct` as a decimal too, ready to feed straight
    into `project_driver_based_dcf`'s `revenue_growth_1`."""
    historical_pct = historical_growth_pct * 100
    factors: list[GrowthFactor] = []

    # 1. Recent growth trend — is the 3-year CAGR accelerating or
    # decelerating relative to the full 10-year history? A real signal of
    # momentum the single-period historical CAGR alone can't see.
    cagr_3y = cagr_windows.get("3y")
    cagr_10y = cagr_windows.get("10y")
    trend_diff = round(cagr_3y - cagr_10y, 1) if cagr_3y is not None and cagr_10y is not None else None
    trend_score = clamp(trend_diff / 10 * 100, -100, 100) if trend_diff is not None else None
    factors.append(GrowthFactor(
        "recent_growth_trend", trend_diff, trend_score,
        f"CAGR de ingresos 3 años ({cagr_3y}%) vs. 10 años ({cagr_10y}%) → diferencia de {trend_diff:+.1f}pp — "
        f"{'acelerando' if trend_diff and trend_diff > 0 else 'desacelerando' if trend_diff and trend_diff < 0 else 'estable'} "
        "respecto a su propio historial." if trend_diff is not None
        else "Historial insuficiente para comparar CAGR reciente vs. de largo plazo.",
    ))

    # 2. Incremental ROIC vs. average ROIC — is NEW capital being deployed
    # at better or worse returns than the company's own historical average?
    # Directly answers "will more growth actually be worth reinvesting in."
    roic_diff = (
        round(incremental_roic_pct - avg_roic_pct, 1)
        if incremental_roic_pct is not None and avg_roic_pct is not None else None
    )
    roic_score = clamp(roic_diff / 20 * 100, -100, 100) if roic_diff is not None else None
    factors.append(GrowthFactor(
        "incremental_roic_vs_average", roic_diff, roic_score,
        f"ROIC incremental ({incremental_roic_pct}%) vs. ROIC promedio histórico ({avg_roic_pct}%) → "
        f"{'el capital nuevo rinde MÁS' if roic_diff and roic_diff > 0 else 'el capital nuevo rinde MENOS' if roic_diff and roic_diff < 0 else 'rinde igual'} "
        f"que el capital ya desplegado ({roic_diff:+.1f}pp)." if roic_diff is not None
        else "No hay suficiente historial de capital invertido para medir el ROIC incremental.",
    ))

    # 3. Moat stability — a durable, STABLE moat (not just a high ROIC
    # level, which the removed adjustment rewarded on its own) supports
    # more confidence the current trend continues. Deliberately uses only
    # `stability_score` here, never `roic_premium_score` — the level of the
    # premium is a QUALITY signal (already reflected in Business Quality/
    # Moat Score elsewhere), not a growth-DURATION signal on its own.
    moat_stability = moat_result.stability_score
    moat_score_norm = clamp((moat_stability - 50) / 50 * 100, -100, 100) if moat_stability is not None else None
    factors.append(GrowthFactor(
        "moat_stability", moat_stability, moat_score_norm,
        f"Estabilidad del moat (ROIC/margen consistentes en el tiempo): {moat_stability}/100 — "
        f"{'sostiene' if moat_score_norm and moat_score_norm > 0 else 'no sostiene' if moat_score_norm and moat_score_norm < 0 else 'es neutral para'} "
        "la confianza en que el crecimiento reciente continúe." if moat_stability is not None
        else "Historial insuficiente para evaluar estabilidad del moat.",
    ))

    # 4. Deterioration direction — real, mechanical trend direction (never
    # re-derived here, straight from deterioration_engine) across ROIC,
    # margins, and revenue. This is the signal most directly able to pull
    # growth DOWN even for a historically high-ROIC company — the exact gap
    # in the removed adjustment, which only ever looked at the ROIC LEVEL,
    # never whether it was trending the wrong way.
    net_direction = deterioration_result.improving_count - deterioration_result.deteriorating_count
    deterioration_score = (
        clamp(net_direction / 5 * 100, -100, 100) if deterioration_result.has_any_signal else None
    )
    factors.append(GrowthFactor(
        "deterioration_direction", float(net_direction) if deterioration_result.has_any_signal else None, deterioration_score,
        f"{deterioration_result.improving_count} factor(es) mejorando vs. {deterioration_result.deteriorating_count} deteriorando "
        f"(de {deterioration_result.improving_count + deterioration_result.deteriorating_count + deterioration_result.stable_count} medidos) — "
        + (f"la tendencia reciente pesa {'a favor' if net_direction > 0 else 'en contra'} de sostener el crecimiento." if net_direction != 0
           else "tendencia neutral.")
        if deterioration_result.has_any_signal
        else "Historial insuficiente para medir dirección de tendencia (se requieren al menos 4 años reales).",
    ))

    # 5. Capital allocation — OPTIONAL (requires network: real buyback-timing
    # price lookups). A management team allocating capital well is more
    # likely to keep deploying growth capital effectively.
    capital_allocation_norm = (
        clamp((capital_allocation_score - 50) / 50 * 100, -100, 100) if capital_allocation_score is not None else None
    )
    factors.append(GrowthFactor(
        "capital_allocation", float(capital_allocation_score) if capital_allocation_score is not None else None,
        capital_allocation_norm,
        f"Capital Allocation Score: {capital_allocation_score}/100 — informa qué tan bien el management históricamente "
        "desplegó capital, incluido el que financiaría crecimiento futuro." if capital_allocation_score is not None
        else "Capital Allocation Score no disponible para este cálculo (requiere datos de red no obtenidos en este flujo).",
    ))

    # 6. Industry growth comparison — OPTIONAL (requires network: real peer
    # fetches). Is this company's own historical growth ahead of or behind
    # its real industry peers' median?
    industry_diff = (
        round(historical_pct - industry_median_revenue_cagr_pct, 1)
        if industry_median_revenue_cagr_pct is not None else None
    )
    industry_score = clamp(industry_diff / 10 * 100, -100, 100) if industry_diff is not None else None
    factors.append(GrowthFactor(
        "industry_growth_comparison", industry_diff, industry_score,
        f"CAGR de ingresos propio ({historical_pct:.1f}%) vs. mediana real de la industria ({industry_median_revenue_cagr_pct}%) "
        f"→ {'por encima' if industry_diff and industry_diff > 0 else 'por debajo' if industry_diff and industry_diff < 0 else 'en línea con'} "
        "sus pares reales." if industry_diff is not None
        else "Benchmark de industria no disponible para este cálculo (requiere datos de red no obtenidos en este flujo).",
    ))

    factor_by_name = {f.name: f for f in factors}
    blended_signal = weighted_mean([
        (factor_by_name[name].score, weight) for name, weight in _WEIGHTS.items()
    ])

    if blended_signal is None:
        total_adjustment_pct = 0.0
    else:
        total_adjustment_pct = round((blended_signal / 100) * _MAX_ADJUSTMENT_PP, 2)

    quality_adjusted_pct = max(historical_pct + total_adjustment_pct, 0.0)

    return GrowthEngineResult(
        historical_growth_pct=round(historical_pct, 1),
        quality_adjusted_growth_pct=round(quality_adjusted_pct / 100, 4),
        total_adjustment_pct=total_adjustment_pct,
        factors=factors,
    )
