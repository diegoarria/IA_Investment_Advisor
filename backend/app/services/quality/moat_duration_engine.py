"""
Moat Duration Engine — Nuvos Fair Value Engine V2, Phase 1.

Translates the static, single-snapshot Moat Score (`moat_engine.
compute_moat_score`) plus its trend direction (`deterioration_engine.
compute_deterioration_signals`) into a bounded, documented DURATION
bucket — how many years this business's above-peer economics can
reasonably be assumed to persist for valuation purposes, not just "how
good are they today." A business capable of earning 30% ROIC for 15
years is not the same valuation case as one capable of earning 30% ROIC
for 3 years, and nothing in this codebase distinguished the two before
this module — `moat_score` was a cosmetic 0-100 number that never fed
any assumption.

Zero AI, zero network, zero new fetches — reuses `MoatScoreResult`/
`DeteriorationResult`, both already computed elsewhere in the pipeline.
Deliberately kept separate from `moat_engine.py` (a static snapshot
score has a different responsibility than translating that score +
its trend into a persistence estimate) — same one-module-per-concern
convention as the rest of this codebase's quality/valuation engines.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from app.services.quality.moat_engine import MoatScoreResult
from app.services.quality.deterioration_engine import DeteriorationResult

# moat_score bands → duration bucket. Same "0-100 tier table with
# documented edges" convention as moat_engine.py's own _ROIC_PREMIUM_TIERS/
# _MARGIN_PREMIUM_TIERS. A moat_score below 20 means the company shows
# essentially no real, stable ROIC/margin premium over its real industry
# peers — no basis to assume ANY durable edge, hence the shortest bucket.
# Above 80 means a large, stable premium AND a structurally high gross
# margin — the profile of the small set of businesses that have
# historically defended a premium for 15+ years. Honest v1 — not
# backtested against a panel of real moat-duration outcomes; flagged
# explicitly, same disclosure as every other tier table in this codebase.
_DURATION_TIERS: list[tuple[int, str]] = [
    (20, "0_3"), (40, "3_5"), (60, "5_10"), (80, "10_15"), (999, "15_plus"),
]
_BUCKET_ORDER = ["0_3", "3_5", "5_10", "10_15", "15_plus"]
_BUCKET_MIDPOINT_YEARS = {"0_3": 2, "3_5": 4, "5_10": 7, "10_15": 12, "15_plus": 18}

# Fewer than this many real years of ROIC history is too short a track
# record to defend a multi-year persistence claim — same
# _MIN_YEARS_FOR_NORMALIZATION=4 bar earnings_state.py already uses for
# "is there enough history to trust a derived number at all."
_MIN_YEARS_FOR_DURATION_CONFIDENCE = 4

# Same 3 profitability-specific metric names earnings_state.py's
# structural-evidence check uses — consistent evidence bar across both
# Phase 1 mechanisms.
_STRUCTURAL_METRICS = {"roic", "operating_margin", "net_margin"}


class MoatDurationBucket(str, Enum):
    YEARS_0_3 = "0_3"
    YEARS_3_5 = "3_5"
    YEARS_5_10 = "5_10"
    YEARS_10_15 = "10_15"
    YEARS_15_PLUS = "15_plus"


@dataclass
class MoatDurationResult:
    bucket: MoatDurationBucket
    years_point_estimate: int  # bucket midpoint — feeds DCF high_growth_years
    confidence: float  # 0-100
    reason: str
    factors: list[str] = field(default_factory=list)


def estimate_moat_duration(
    *,
    moat_result: MoatScoreResult,
    deterioration: DeteriorationResult,
    years_of_real_roic_history: int,
) -> MoatDurationResult:
    """Single entry point. `years_of_real_roic_history` is caller-supplied
    (count of non-None entries in the same roic_trend array already fed
    to `compute_moat_score`/`compute_deterioration_signals`) — this
    function performs zero re-derivation of that count."""
    factors: list[str] = []

    base_bucket = next(b for edge, b in _DURATION_TIERS if moat_result.moat_score <= edge)
    factors.append(f"Moat Score = {moat_result.moat_score}/100 → bucket base '{base_bucket}'.")
    idx = _BUCKET_ORDER.index(base_bucket)

    relevant = [f for f in deterioration.factors if f.name in _STRUCTURAL_METRICS]
    improving = sum(1 for f in relevant if f.direction == "mejorando")
    deteriorating = sum(1 for f in relevant if f.direction == "deteriorando")

    if deteriorating >= 2:
        idx = max(0, idx - 1)
        factors.append(f"{deteriorating}/3 métricas de rentabilidad deteriorando — moat en erosión, bucket bajado un nivel.")
    elif improving >= 2 and moat_result.moat_score >= 40:
        idx = min(len(_BUCKET_ORDER) - 1, idx + 1)
        factors.append(f"{improving}/3 métricas de rentabilidad mejorando con Moat Score ya sólido — bucket subido un nivel.")

    bucket_value = _BUCKET_ORDER[idx]

    # Confidence — capped hard when the real track record is short. A
    # moat_score of 85 computed off 4 barely-qualifying years is not the
    # same evidence as 85 sustained for a decade; the score alone can't
    # tell the difference, so duration confidence must.
    thin_history = years_of_real_roic_history < _MIN_YEARS_FOR_DURATION_CONFIDENCE
    if thin_history:
        # Never claim 15+ years of durability off a track record shorter
        # than the module's own minimum-evidence bar.
        capped_idx = min(idx, _BUCKET_ORDER.index("10_15"))
        bucket_value = _BUCKET_ORDER[capped_idx]
        confidence = 30.0
        factors.append(
            f"Solo {years_of_real_roic_history} años reales de historial de ROIC "
            f"(< {_MIN_YEARS_FOR_DURATION_CONFIDENCE}) — confianza limitada, bucket máximo capado en '10_15'."
        )
    else:
        confidence = min(90.0, 40.0 + moat_result.moat_score * 0.5) if moat_result.has_any_signal else 20.0

    bucket = MoatDurationBucket(bucket_value)
    return MoatDurationResult(
        bucket=bucket,
        years_point_estimate=_BUCKET_MIDPOINT_YEARS[bucket.value],
        confidence=round(confidence, 1),
        reason=f"Duración de ventaja competitiva estimada: {bucket.value.replace('_', '-')} años (confianza {confidence:.0f}/100).",
        factors=factors,
    )
