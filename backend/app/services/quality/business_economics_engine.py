"""
Business Economics Engine — Nuvos Fair Value Engine V2, Phase 2.

PURELY ADDITIVE. Reads already-computed, already-trusted trends
(`roic_trend`/`nopat_trend`/`invested_capital_trend` from
`fundamental_analysis_service.py`, `compute_fcf_conversion` from
`nuvos_engine/fcf_quality.py`, `compute_reinvestment_rate_anchor` from
`valuation/dcf_engine.py`) as INPUT and produces a new, separate
`BusinessEconomicsResult` for informational/explainability purposes —
see /Users/diegoarria/.claude/plans/cosmic-munching-crown.md. It is NOT
consumed by `compute_nuvos_fair_value`, the DCF, Fair P/E,
Classification, or Moat Score in this phase; wiring these signals into
any valuation formula is explicitly deferred to a future phase. Zero
fetching, zero AI, zero re-derivation of ROIC/NOPAT/invested-capital/
reinvestment (all pass-through) — this module computes exactly three
genuinely new things: CROIC, capital intensity, and a multi-year value-
creation trend.

Same "quality/" package boundary as `moat_engine.py`/
`deterioration_engine.py`/`moat_duration_engine.py`: deterministic
signals computed off already-existing real trends, never touching price
or producing a per-share number.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict, field
from typing import Optional

from app.services.valuation.dcf_engine import recency_weighted_average
from app.services.quality.quality_engine import compute_incremental_roic
from app.services.quality.deterioration_engine import trend_direction
from app.services.valuation.nuvos_engine.fcf_quality import compute_fcf_conversion

# Minimum real years for the value-creation CONSISTENCY classification —
# deliberately lower than trend_direction's own 4-point bar, since
# "was every valid year positive?" is a simple count question, not a
# noisy first-half-vs-second-half comparison. Years below the 4-point
# confidence bar still compute a consistency label, but the reason text
# explicitly flags reduced confidence rather than blocking the
# computation entirely.
_MIN_YEARS_FOR_CONSISTENCY = 2
_MIN_YEARS_FOR_CONSISTENCY_CONFIDENCE = 4

_DIRECTION_LABEL = {"mejorando": "increasing", "deteriorando": "decreasing", "estable": "stable"}


@dataclass
class BusinessEconomicsResult:
    # ROIC — pass-through only, for one-stop convenience (never recomputed).
    roic_avg_pct: Optional[float]
    roic_trend_pct: list[Optional[float]]

    # CROIC — NEW.
    croic_avg_pct: Optional[float]
    croic_trend_pct: list[Optional[float]]
    croic_reason: str

    # Incremental ROIC — pass-through (quality_engine.compute_incremental_roic).
    incremental_roic_pct: Optional[float]

    # Capital intensity — NEW.
    capital_intensity_avg_pct: Optional[float]
    capital_intensity_trend_pct: list[Optional[float]]
    capital_intensity_direction: Optional[str]  # "increasing" | "decreasing" | "stable" | None
    capital_intensity_reason: str

    # FCF conversion — pass-through (nuvos_engine.fcf_quality.compute_fcf_conversion).
    fcf_conversion: Optional[dict]

    # Reinvestment — pass-through.
    reinvestment_rate_anchor_pct: Optional[float]

    # Value creation — spread math + a NEW multi-year consistency/direction read.
    value_creation_spread_avg_pct: Optional[float]
    value_creation_trend_pct: list[Optional[float]]
    value_creation_direction: Optional[str]  # "mejorando" | "deteriorando" | "estable" | None
    value_creation_consistency: Optional[str]  # "consistent_positive" | "consistent_negative" | "intermittent" | None
    value_creation_years_positive: int
    value_creation_years_total: int
    value_creation_reason: str

    factors: list[str] = field(default_factory=list)
    insufficient_data_reason: Optional[str] = None


def _compute_croic_trend(fcf_trend: list[Optional[float]], invested_capital_trend: list[Optional[float]]) -> list[Optional[float]]:
    """FCF / Invested Capital — reuses the SAME invested_capital_trend
    ROIC already uses (equity + LT debt + ST debt - cash, point-in-time,
    not a beginning/end average) rather than a different capital-base
    definition, so CROIC stays directly comparable to ROIC — the whole
    reason to compute it alongside ROIC in the first place. roic_trend[i]
    and fcf_trend[i] are missing under INDEPENDENT preconditions (ROIC
    needs Operating Income + Stockholders Equity; FCF needs Operating
    Cash Flow + CapEx) — never assume one being real implies the other
    is."""
    out: list[Optional[float]] = []
    for f, ic in zip(fcf_trend, invested_capital_trend):
        if f is not None and ic is not None and ic > 0:
            out.append(round(f / ic * 100, 1))
        else:
            out.append(None)
    return out


def _compute_capital_intensity_trend(invested_capital_trend: list[Optional[float]], revenue_trend: list[Optional[float]]) -> list[Optional[float]]:
    """Invested Capital / Revenue (a stock ratio — how much capital is
    currently deployed to generate a dollar of revenue), not CapEx/
    Revenue (a flow ratio, noisy from single-year capex spikes). Reuses
    the already-index-aligned invested_capital_trend rather than
    introducing a new missing-data gate. Neutral by design — capital
    intensity is a business-model fact (semiconductors/utilities run
    structurally higher than software), not inherently good or bad; it
    only becomes informative paired with ROIC/CROIC."""
    out: list[Optional[float]] = []
    for ic, r in zip(invested_capital_trend, revenue_trend):
        if ic is not None and ic > 0 and r:
            out.append(round(ic / r * 100, 1))
        else:
            out.append(None)
    return out


def _avg(trend: list[Optional[float]]) -> Optional[float]:
    pairs = [(i, v) for i, v in enumerate(trend) if v is not None]
    if not pairs:
        return None
    result = recency_weighted_average(pairs)
    return round(result, 1) if result is not None else None


def _compute_value_creation_trend(roic_trend: list[Optional[float]], cost_of_capital_pct: Optional[float]) -> list[Optional[float]]:
    """Per-year roic_trend[i] - cost_of_capital_pct, holding
    cost_of_capital_pct CONSTANT at today's single blended WACC across
    every historical year. No historical WACC trend exists anywhere in
    this codebase, and fabricating one would violate the "never invent a
    number" rule — this is a disclosed simplification (see
    _value_creation_reason), not a reconstruction of each year's real
    cost of capital."""
    if cost_of_capital_pct is None:
        return [None] * len(roic_trend)
    return [round(v - cost_of_capital_pct, 1) if v is not None else None for v in roic_trend]


def _classify_value_creation_consistency(spread_trend: list[Optional[float]]) -> tuple[Optional[str], int, int]:
    valid = [v for v in spread_trend if v is not None]
    if len(valid) < _MIN_YEARS_FOR_CONSISTENCY:
        return None, 0, 0
    positive = sum(1 for v in valid if v > 0)
    total = len(valid)
    if positive == total:
        return "consistent_positive", positive, total
    if positive == 0:
        return "consistent_negative", positive, total
    return "intermittent", positive, total


def _croic_reason(croic_avg: Optional[float], roic_avg: Optional[float], n_years: int) -> str:
    if croic_avg is None:
        return "FCF y/o capital invertido no disponibles en años suficientes — sin CROIC calculable."
    base = f"CROIC promedio (FCF / capital invertido): {croic_avg:.1f}%, sobre {n_years} año(s) real(es)."
    if roic_avg is None:
        return base
    if croic_avg < roic_avg - 2:
        return base + f" ROIC promedio ({roic_avg:.1f}%) es mayor — la conversión de utilidad operativa a efectivo real es menor a la conversión a capital invertido, posiblemente por capital de trabajo o gasto de capital elevados."
    if croic_avg > roic_avg + 2:
        return base + f" ROIC promedio ({roic_avg:.1f}%) es menor — la conversión a efectivo real supera a la conversión a capital invertido, posiblemente por dinámicas favorables de capital de trabajo (ej. ingresos diferidos)."
    return base + f" En línea con el ROIC promedio ({roic_avg:.1f}%) — la utilidad operativa se convierte en efectivo real de forma consistente."


def _capital_intensity_reason(avg: Optional[float], direction: Optional[str], n_years: int) -> str:
    if avg is None:
        return "Capital invertido y/o ingresos no disponibles en años suficientes — sin intensidad de capital calculable."
    base = f"Capital invertido / Ingresos promedio: {avg:.1f}%, sobre {n_years} año(s) real(es)."
    if direction is None:
        return base + " Historial insuficiente (menos de 4 años reales) para determinar tendencia."
    label = _DIRECTION_LABEL.get(direction, direction)
    return base + f" Tendencia: {label}. Un dato del modelo de negocio, no un juicio de valor — solo es informativo en conjunto con el ROIC/CROIC."


def _value_creation_reason(
    spread_avg: Optional[float], consistency: Optional[str], years_positive: int, years_total: int,
    cost_of_capital_pct: Optional[float],
) -> str:
    if cost_of_capital_pct is None:
        return "Costo de capital no disponible — no se puede calcular el spread de creación de valor."
    disclosure = (
        f"Spread ROIC − costo de capital calculado usando el WACC actual ({cost_of_capital_pct:.1f}%) "
        f"aplicado a cada año histórico por igual — el WACC histórico real no está disponible; esta es "
        f"una simplificación honesta, no una reconstrucción del costo de capital de cada año."
    )
    if spread_avg is None or consistency is None:
        return disclosure + " Historial insuficiente para evaluar consistencia de creación de valor."
    consistency_text = {
        "consistent_positive": f"creó valor (ROIC > costo de capital) en los {years_total} año(s) reales evaluados",
        "consistent_negative": f"NO creó valor (ROIC < costo de capital) en ninguno de los {years_total} año(s) reales evaluados",
        "intermittent": f"creó valor en {years_positive} de {years_total} año(s) reales evaluados, de forma intermitente",
    }[consistency]
    confidence_note = "" if years_total >= _MIN_YEARS_FOR_CONSISTENCY_CONFIDENCE else f" (confianza limitada — solo {years_total} año(s) de evidencia)."
    return f"{disclosure} El negocio {consistency_text}{confidence_note}"


def compute_business_economics(
    *,
    roic_trend: list[Optional[float]],
    nopat_trend: list[Optional[float]],
    invested_capital_trend: list[Optional[float]],
    fcf_trend: list[Optional[float]],
    revenue_trend: list[Optional[float]],
    net_income_trend: list[Optional[float]],
    avg_roic_pct: Optional[float],
    reinvestment_rate_anchor: Optional[float],
    cost_of_capital_pct: Optional[float],
) -> BusinessEconomicsResult:
    """Single entry point. All inputs are already-computed arrays/scalars
    the caller (fundamental_analysis_service.py) already has in scope —
    see the wiring point in cosmic-munching-crown.md."""
    if not any(v is not None for v in roic_trend):
        return BusinessEconomicsResult(
            roic_avg_pct=None, roic_trend_pct=list(roic_trend),
            croic_avg_pct=None, croic_trend_pct=[None] * len(roic_trend), croic_reason="Sin datos de ROIC — no se puede calcular CROIC.",
            incremental_roic_pct=None,
            capital_intensity_avg_pct=None, capital_intensity_trend_pct=[None] * len(roic_trend),
            capital_intensity_direction=None, capital_intensity_reason="Sin datos suficientes — no se puede calcular intensidad de capital.",
            fcf_conversion=None, reinvestment_rate_anchor_pct=None,
            value_creation_spread_avg_pct=None, value_creation_trend_pct=[None] * len(roic_trend),
            value_creation_direction=None, value_creation_consistency=None,
            value_creation_years_positive=0, value_creation_years_total=0,
            value_creation_reason="Sin datos de ROIC — no se puede calcular creación de valor.",
            insufficient_data_reason="Historial de ROIC insuficiente o no disponible — no se pudo calcular la mayoría de las métricas de este motor.",
        )

    croic_trend = _compute_croic_trend(fcf_trend, invested_capital_trend)
    croic_avg = _avg(croic_trend)
    croic_n_years = sum(1 for v in croic_trend if v is not None)

    incremental_roic = compute_incremental_roic(nopat_trend, invested_capital_trend)

    capital_intensity_trend = _compute_capital_intensity_trend(invested_capital_trend, revenue_trend)
    capital_intensity_avg = _avg(capital_intensity_trend)
    capital_intensity_n_years = sum(1 for v in capital_intensity_trend if v is not None)
    capital_intensity_dir_result = trend_direction(capital_intensity_trend)
    capital_intensity_direction = _DIRECTION_LABEL.get(capital_intensity_dir_result[0]) if capital_intensity_dir_result else None

    fcf_conversion_result = None
    if fcf_trend and net_income_trend:
        latest_fcf = next((v for v in reversed(fcf_trend) if v is not None), None)
        latest_ni = next((v for v in reversed(net_income_trend) if v is not None), None)
        fcf_conversion_result = asdict(compute_fcf_conversion(latest_fcf, latest_ni))

    value_creation_trend = _compute_value_creation_trend(roic_trend, cost_of_capital_pct)
    value_creation_avg = _avg(value_creation_trend)
    consistency, years_positive, years_total = _classify_value_creation_consistency(value_creation_trend)
    value_creation_dir_result = trend_direction(value_creation_trend)
    value_creation_direction = value_creation_dir_result[0] if value_creation_dir_result else None

    factors = [
        _croic_reason(croic_avg, avg_roic_pct, croic_n_years),
        _capital_intensity_reason(capital_intensity_avg, capital_intensity_direction, capital_intensity_n_years),
        _value_creation_reason(value_creation_avg, consistency, years_positive, years_total, cost_of_capital_pct),
    ]

    return BusinessEconomicsResult(
        roic_avg_pct=avg_roic_pct, roic_trend_pct=list(roic_trend),
        croic_avg_pct=croic_avg, croic_trend_pct=croic_trend,
        croic_reason=_croic_reason(croic_avg, avg_roic_pct, croic_n_years),
        incremental_roic_pct=incremental_roic,
        capital_intensity_avg_pct=capital_intensity_avg, capital_intensity_trend_pct=capital_intensity_trend,
        capital_intensity_direction=capital_intensity_direction,
        capital_intensity_reason=_capital_intensity_reason(capital_intensity_avg, capital_intensity_direction, capital_intensity_n_years),
        fcf_conversion=fcf_conversion_result,
        reinvestment_rate_anchor_pct=round(reinvestment_rate_anchor * 100, 1) if reinvestment_rate_anchor is not None else None,
        value_creation_spread_avg_pct=value_creation_avg, value_creation_trend_pct=value_creation_trend,
        value_creation_direction=value_creation_direction, value_creation_consistency=consistency,
        value_creation_years_positive=years_positive, value_creation_years_total=years_total,
        value_creation_reason=_value_creation_reason(value_creation_avg, consistency, years_positive, years_total, cost_of_capital_pct),
        factors=factors,
    )
