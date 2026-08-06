"""
AI Assumptions Engine — Nuvos AI Fair Value Engine redesign, Incremento 4
(see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

The brief's "Motor de supuestos AI": blends historical (30%), industry
(25%), Wall Street consensus (25%), and business quality (20%) into a
single assumption — used for revenue growth (year 1), terminal operating
margin, and terminal ROIC (Incremento 6 wires all three; this module is the
shared, dimension-agnostic blending mechanism, called once per dimension).

Genuinely different mechanism than `growth_engine.py` (Fase 1.5, Incremento
8), not a rename of it:

- `growth_engine.py` treats historical CAGR as the ANCHOR and blends 6
  signals into a bounded +-2.0pp ADJUSTMENT on top of it (`_MAX_ADJUSTMENT_PP`)
  — industry there weighs 5% of that small adjustment, Wall Street doesn't
  exist as a factor at all. This module computes a real WEIGHTED MEAN of 4
  independent VALUES (all already expressed in the same unit — decimal
  growth rate, or percentage points for margin/ROIC), so industry and Wall
  Street genuinely move the result, not just nudge it. `growth_engine.py`
  itself is left untouched (Fase 1.5's decision comment there still holds,
  and it keeps feeding the legacy model until Incremento 12's teardown) —
  the `business_quality` factor here can reuse `growth_engine.py`'s own
  output as ONE real signal (a single coherent quality-adjusted view is
  more meaningful than re-deriving moat/ROIC/deterioration/capital-
  allocation blending a second time), but this module never re-implements
  that blend itself.

Same `{name, value, score, reason}` factor shape every other Fase 2/1.5
engine uses (`growth_engine.GrowthFactor`, `moat_engine.MoatFactor`, ...) —
zero adapter code needed for `ExplainableValue.tsx`. Here `score` and
`value` are deliberately the SAME number (the real value in its native
unit, not a normalized -100..100 signal) — this module blends real values
directly via `weighted_mean`, it doesn't normalize-then-rescale the way
`growth_engine.py` does, since the result IS the assumption itself, not a
bounded delta applied to a separate anchor.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.numeric_helpers import weighted_mean

_WEIGHTS = {
    "historical": 0.30,
    "industry": 0.25,
    "wall_street": 0.25,
    "business_quality": 0.20,
}


@dataclass
class AssumptionFactor:
    name: str
    value: Optional[float]
    score: Optional[float]  # identical to `value` here — see module docstring
    reason: str


@dataclass
class WeightedAssumptionResult:
    dimension: str
    blended_value_pct: Optional[float]
    factors: list[AssumptionFactor] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return any(f.value is not None for f in self.factors)


def compute_weighted_assumption(
    *,
    dimension: str,
    historical_value_pct: Optional[float],
    industry_value_pct: Optional[float],
    wall_street_value_pct: Optional[float],
    business_quality_value_pct: Optional[float],
    historical_reason: Optional[str] = None,
    industry_reason: Optional[str] = None,
    wall_street_reason: Optional[str] = None,
    business_quality_reason: Optional[str] = None,
) -> WeightedAssumptionResult:
    """The single entry point — dimension-agnostic (`dimension` is just a
    label used in the default reason text and the result, e.g.
    "revenue_growth_1"/"terminal_operating_margin"/"terminal_roic"; the
    caller supplies each factor's real value already computed in whatever
    unit that dimension uses). Missing factors (a ticker with no real
    Wall Street coverage, or no live peer benchmarks) are excluded and
    `weighted_mean` renormalizes over whatever IS available — never treats
    a missing signal as zero (same philosophy `growth_engine.py`/every
    Fase 2 engine already uses). Returns `blended_value_pct=None` only
    when NONE of the 4 factors have a real value — never a fabricated
    default."""
    def _default_reason(label: str, value: Optional[float], missing_reason: str) -> str:
        return f"{label}: {value:.1f}%." if value is not None else missing_reason

    factors = [
        AssumptionFactor(
            "historical", historical_value_pct, historical_value_pct,
            historical_reason or _default_reason(
                "Valor histórico real", historical_value_pct, "Dato histórico no disponible para este cálculo.",
            ),
        ),
        AssumptionFactor(
            "industry", industry_value_pct, industry_value_pct,
            industry_reason or _default_reason(
                "Mediana real de industria (peers reales)", industry_value_pct,
                "Benchmark de industria no disponible (peers reales insuficientes).",
            ),
        ),
        AssumptionFactor(
            "wall_street", wall_street_value_pct, wall_street_value_pct,
            wall_street_reason or _default_reason(
                "Estimado de consenso de Wall Street", wall_street_value_pct,
                "Sin cobertura real de analistas para este ticker.",
            ),
        ),
        AssumptionFactor(
            "business_quality", business_quality_value_pct, business_quality_value_pct,
            business_quality_reason or _default_reason(
                "Vista ajustada por calidad del negocio", business_quality_value_pct,
                "Señales de calidad de negocio insuficientes para este cálculo.",
            ),
        ),
    ]

    factor_by_name = {f.name: f for f in factors}
    blended = weighted_mean([(factor_by_name[name].value, weight) for name, weight in _WEIGHTS.items()])

    return WeightedAssumptionResult(
        dimension=dimension,
        blended_value_pct=round(blended, 4) if blended is not None else None,
        factors=factors,
    )
