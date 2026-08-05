"""
Deterioration Engine — Fase 2, Incremento 10 (Parte K — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

100% deterministic, real, zero AI, zero network — mechanical trend-
DIRECTION analysis over the same multi-year arrays every other Fase 2
engine already reuses (roic_trend, margin trends, revenue_trend). No new
data fetched here at all.

Deliberately NOT a duplicate of the Quality Engine's stability signal
(`numeric_helpers._coefficient_of_variation` / `STABILITY_CV_TIERS`,
reused verbatim by the Moat Engine's stability factors): stability asks
"how NOISY is this series year to year" (a non-directional question — a
metric that bounces between 20% and 30% every other year is "unstable"
even if it never trends anywhere), while Deterioration asks "which
DIRECTION is it actually moving" (a metric can be perfectly smooth and
still be sliding downward every single year — low CV, but clearly
deteriorating). Both signals matter and neither substitutes for the
other; this engine computes only the direction one, splitting each
series into a real first-half vs. second-half average — never a
single-point year-over-year comparison, which would be too noisy to
trust as "the company is deteriorating."
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

# A first-half vs. second-half swing smaller than this is treated as noise,
# not a real directional move — same "don't overreact to small wobbles"
# philosophy already used throughout this codebase's tier tables.
_DIRECTION_THRESHOLD_PCT = 10.0

_METRIC_LABELS = {
    "roic": "ROIC",
    "operating_margin": "Margen operativo",
    "net_margin": "Margen neto",
    "fcf_margin": "Margen de FCF",
    "revenue": "Ingresos",
}


@dataclass
class DeteriorationFactor:
    name: str
    direction: Optional[str]  # "mejorando" | "deteriorando" | "estable" | None (no signal)
    change_pct: Optional[float]
    reason: str


@dataclass
class DeteriorationResult:
    deteriorating_count: int
    improving_count: int
    stable_count: int
    highest_concern: Optional[str]  # name of the metric with the worst (most negative) real change, if any
    factors: list[DeteriorationFactor] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return any(f.direction is not None for f in self.factors)


def _trend_direction(values: list[Optional[float]]) -> Optional[tuple[str, float]]:
    """Real first-half-average vs. second-half-average comparison — needs
    at least 4 real (non-None) data points to split into two halves that
    mean anything; fewer than that returns None (no fabricated direction
    off 2-3 noisy points)."""
    valid = [v for v in values if v is not None]
    if len(valid) < 4:
        return None
    mid = len(valid) // 2
    first_avg = statistics.mean(valid[:mid])
    second_avg = statistics.mean(valid[mid:])
    if first_avg == 0:
        return None
    change_pct = (second_avg - first_avg) / abs(first_avg) * 100
    if change_pct >= _DIRECTION_THRESHOLD_PCT:
        direction = "mejorando"
    elif change_pct <= -_DIRECTION_THRESHOLD_PCT:
        direction = "deteriorando"
    else:
        direction = "estable"
    return direction, round(change_pct, 1)


def compute_deterioration_signals(
    *,
    roic_trend: list[Optional[float]],
    operating_margin_trend: list[Optional[float]],
    net_margin_trend: list[Optional[float]],
    fcf_margin_trend: list[Optional[float]],
    revenue_trend: list[Optional[float]],
) -> DeteriorationResult:
    """The single entry point. Every trend is accepted as an already-
    computed real array (from `fundamental_analysis_service`/other Fase 2
    engines) — this function performs zero fetching and zero re-derivation
    of the underlying numbers, only direction analysis on top of them."""
    metric_trends = {
        "roic": roic_trend, "operating_margin": operating_margin_trend,
        "net_margin": net_margin_trend, "fcf_margin": fcf_margin_trend,
        "revenue": revenue_trend,
    }
    factors: list[DeteriorationFactor] = []
    for key, trend in metric_trends.items():
        label = _METRIC_LABELS[key]
        result = _trend_direction(trend)
        if result is None:
            factors.append(DeteriorationFactor(
                key, None, None,
                f"Historial insuficiente para evaluar la dirección de {label} (se requieren al menos 4 años reales de datos).",
            ))
            continue
        direction, change_pct = result
        factors.append(DeteriorationFactor(
            key, direction, change_pct,
            f"{label}: comparando el promedio de la primera mitad del historial disponible contra la segunda mitad → "
            f"cambio real de {change_pct:+.1f}% ({direction}).",
        ))

    deteriorating = [f for f in factors if f.direction == "deteriorando"]
    improving = [f for f in factors if f.direction == "mejorando"]
    stable = [f for f in factors if f.direction == "estable"]

    highest_concern = None
    if deteriorating:
        worst = min(deteriorating, key=lambda f: f.change_pct)
        highest_concern = worst.name

    return DeteriorationResult(
        deteriorating_count=len(deteriorating), improving_count=len(improving), stable_count=len(stable),
        highest_concern=highest_concern, factors=factors,
    )
