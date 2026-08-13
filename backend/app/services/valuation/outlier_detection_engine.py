"""
Outlier Detection Engine — Nuvos Fair Value Engine V2, Phase 4.

PURELY ADVISORY. Answers "does this result look economically strange?"
over already-computed, already-trusted values (fair value scenarios,
terminal value, ROIC, implied multiple, reverse-DCF sanity check) — never
fetches, never recomputes an underlying number, and NEVER suppresses or
changes a Fair Value/DCF/GQV/scenario/confidence output. Per the V2 spec
(§33): "Do not automatically reject outliers. Investigate them. Sometimes
the market really is wrong." See
/Users/diegoarria/.claude/plans/cosmic-munching-crown.md.

Lives at the top of `valuation/` (sibling to `confidence_engine.py`, not
nested in `nuvos_engine/`) because it serves BOTH the legacy DCF and GQV
callers from one shared implementation.

Every threshold below is a genuinely new heuristic (§40 Parameter
Governance) — each is labeled `v2 heuristic — requires empirical
validation` in its own detail text rather than presented as settled.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

_HEURISTIC_TAG = "v2 heuristic — requires empirical validation"


@dataclass
class OutlierFlag:
    name: str
    flagged: bool
    detail: str
    severity: str  # "info" | "warning" — advisory only, never "critical"/blocking


@dataclass
class OutlierDetectionResult:
    flags: list[OutlierFlag] = field(default_factory=list)
    flagged_count: int = 0
    material_flags: list[str] = field(default_factory=list)


def _flag(name: str, flagged: bool, detail: str, severity: str) -> OutlierFlag:
    return OutlierFlag(name=name, flagged=flagged, detail=detail, severity=severity)


def detect_valuation_outliers(
    *,
    current_price: Optional[float],
    fair_value_bear: Optional[float],
    fair_value_base: Optional[float],
    fair_value_bull: Optional[float],
    avg_roic_pct: Optional[float] = None,
    industry_median_roic_pct: Optional[float] = None,
    implied_multiple: Optional[float] = None,
    historical_median_pe: Optional[float] = None,
    peer_median_pe: Optional[float] = None,
    pv_of_terminal_value: Optional[float] = None,
    enterprise_value: Optional[float] = None,
    regime_change_flag: Optional[bool] = None,
    regime_change_detail: Optional[str] = None,
) -> OutlierDetectionResult:
    flags: list[OutlierFlag] = []

    if current_price is not None and current_price > 0 and fair_value_base is not None:
        flags.append(_flag(
            "fair_value_over_3x_price", fair_value_base > 3 * current_price,
            f"Fair Value base (${fair_value_base:.2f}) es más de 3x el precio actual (${current_price:.2f}) — "
            "una brecha de esta magnitud merece revisión adicional antes de confiar en el número.",
            "warning",
        ))
        flags.append(_flag(
            "fair_value_under_30pct_price", fair_value_base < 0.3 * current_price,
            f"Fair Value base (${fair_value_base:.2f}) es menos del 30% del precio actual (${current_price:.2f}) — "
            "una brecha de esta magnitud merece revisión adicional antes de confiar en el número.",
            "warning",
        ))

    if pv_of_terminal_value is not None and enterprise_value is not None and enterprise_value > 0:
        terminal_pct = pv_of_terminal_value / enterprise_value
        flags.append(_flag(
            "terminal_value_dominates", terminal_pct > 0.90,
            f"El valor terminal representa {terminal_pct * 100:.0f}% del enterprise value — "
            "más del 90% significa que casi toda la valoración depende de supuestos de largo plazo, no del negocio actual.",
            "warning",
        ))

    if regime_change_flag is not None:
        flags.append(_flag(
            "implied_growth_regime_change", regime_change_flag,
            regime_change_detail or "El crecimiento implícito por el precio actual es más del doble del CAGR histórico real de FCF de la empresa.",
            "warning",
        ))

    if avg_roic_pct is not None and industry_median_roic_pct is not None:
        roic_gap = avg_roic_pct - industry_median_roic_pct
        flags.append(_flag(
            "roic_inconsistent_with_industry", roic_gap > 20,
            f"ROIC promedio ({avg_roic_pct:.1f}%) supera la mediana de la industria ({industry_median_roic_pct:.1f}%) "
            f"por {roic_gap:.1f} puntos porcentuales — {_HEURISTIC_TAG}.",
            "info",
        ))

    if implied_multiple is not None and (historical_median_pe is not None or peer_median_pe is not None):
        reference = max(v for v in [historical_median_pe, peer_median_pe] if v is not None)
        flags.append(_flag(
            "multiple_above_historical_range", implied_multiple > reference * 1.5,
            f"El múltiplo implícito ({implied_multiple:.1f}x) supera en más de 50% la referencia histórica/de pares "
            f"más alta ({reference:.1f}x) — {_HEURISTIC_TAG}.",
            "info",
        ))

    if current_price is not None and current_price > 0 and fair_value_bear is not None:
        flags.append(_flag(
            "bear_above_current_price", fair_value_bear > current_price,
            f"El escenario Bear (${fair_value_bear:.2f}) está por encima del precio actual (${current_price:.2f}) — "
            "incluso el caso pesimista implica que el mercado está subvalorando la acción.",
            "warning",
        ))

    if fair_value_base is not None and fair_value_bull is not None:
        flags.append(_flag(
            "bull_below_base", fair_value_bull < fair_value_base,
            f"El escenario Bull (${fair_value_bull:.2f}) está por debajo del escenario Base (${fair_value_base:.2f}) — "
            "inconsistencia estructural en la construcción de los escenarios.",
            "warning",
        ))

    if fair_value_bear is not None and fair_value_bull is not None and fair_value_base is not None and fair_value_base > 0:
        spread_pct = (fair_value_bull - fair_value_bear) / fair_value_base
        flags.append(_flag(
            "scenarios_too_compressed", spread_pct < 0.10,
            f"El rango Bear-Bull (${fair_value_bear:.2f} - ${fair_value_bull:.2f}) es menor al 10% del Fair Value base — "
            f"{_HEURISTIC_TAG}. Un rango tan estrecho puede subestimar la incertidumbre real del negocio.",
            "info",
        ))
        flags.append(_flag(
            "scenarios_too_wide", spread_pct > 2.0,
            f"El rango Bear-Bull (${fair_value_bear:.2f} - ${fair_value_bull:.2f}) supera 200% del Fair Value base — "
            f"{_HEURISTIC_TAG}. Un rango tan amplio aporta poca capacidad de decisión.",
            "info",
        ))

    flagged_names = [f.name for f in flags if f.flagged]
    return OutlierDetectionResult(flags=flags, flagged_count=len(flagged_names), material_flags=flagged_names)
