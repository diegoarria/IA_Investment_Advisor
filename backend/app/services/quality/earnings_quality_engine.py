"""
Earnings Quality Engine — Fase 2, Incremento 5 (Parte E — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Detects real, computable signals of low earnings quality. Deliberately
does NOT fabricate detection for signals this codebase has no real data
for — "¿las adquisiciones se usaron para inflar el crecimiento?" needs
M&A price/synergy data no provider here has, so it's disclosed as
unscoreable (same honesty pattern already established for
`capital_allocation_engine.ACQUISITIONS_NOTE`), not guessed.

Reuses, never re-derives:
- `data_validation.requiere_revision_manual` (Fase 1's real Revenue−COGS−
  OpEx vs. reported Operating Income cross-check) for "cambios contables".
- The margin/FCF/revenue/net-income trends already computed elsewhere.

Newly activated: Stock-Based Compensation as % of Revenue and % of FCF —
the raw SBC field has been fetched into every financial statement row
since before this project started (see `financial_data_service.py`), but
nothing downstream ever read it until now.

Every alert carries a severity ("low"/"medium"/"high") and a plain-
language explanation grounded in the real numbers that triggered it —
never a bare flag with no evidence (brief rule 6/7).
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

ACQUISITIONS_GROWTH_NOTE = (
    "Detectar si las adquisiciones se usaron para inflar artificialmente el crecimiento reportado "
    "requiere datos de ingresos pre/post-adquisición desglosados por transacción, que no están "
    "disponibles en ninguna fuente de datos integrada actualmente — no se infiere sin evidencia real."
)

_SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2}


@dataclass
class EarningsQualityAlert:
    key: str
    severity: str  # "low" | "medium" | "high"
    description: str
    evidence: Optional[str] = None


@dataclass
class EarningsQualityResult:
    alerts: list[EarningsQualityAlert] = field(default_factory=list)
    sbc_to_revenue_pct: Optional[float] = None
    sbc_to_fcf_pct: Optional[float] = None
    acquisitions_note: str = ACQUISITIONS_GROWTH_NOTE

    @property
    def highest_severity(self) -> Optional[str]:
        if not self.alerts:
            return None
        return max(self.alerts, key=lambda a: _SEVERITY_ORDER[a.severity]).severity

    @property
    def alert_count(self) -> int:
        return len(self.alerts)


def evaluate_sbc_dilution(
    sbc_latest: Optional[float], revenue_latest: Optional[float], fcf_latest: Optional[float],
) -> tuple[Optional[float], Optional[float], list[EarningsQualityAlert]]:
    """Stock-Based Compensation is a REAL non-cash expense that dilutes
    shareholders even though it never appears in reported FCF the way
    other non-cash items do (SBC is added BACK to operating cash flow, so
    a high-SBC company's FCF can look strong while shareholders are being
    diluted underneath it) — this is exactly why it's tracked as % of
    Revenue AND % of FCF separately: the first measures "how much of the
    business's own economics goes to compensation via dilution instead of
    cash," the second measures "how large is SBC relative to the cash
    flow being celebrated." Thresholds: >5% of revenue is elevated (medium),
    >10% is high; >30% of FCF is elevated (medium), >60% is high — a
    company where SBC exceeds 60% of its FCF is arguably not generating
    much REAL free cash flow for shareholders once dilution is priced in."""
    alerts: list[EarningsQualityAlert] = []
    sbc_to_revenue_pct = round(sbc_latest / revenue_latest * 100, 1) if sbc_latest and revenue_latest else None
    sbc_to_fcf_pct = round(sbc_latest / fcf_latest * 100, 1) if sbc_latest and fcf_latest and fcf_latest > 0 else None

    if sbc_to_revenue_pct is not None:
        if sbc_to_revenue_pct >= 10:
            alerts.append(EarningsQualityAlert(
                "sbc_high_vs_revenue", "high",
                f"Stock-Based Compensation representa {sbc_to_revenue_pct}% del revenue — nivel de dilución elevado.",
                evidence=f"SBC/Revenue: {sbc_to_revenue_pct}%",
            ))
        elif sbc_to_revenue_pct >= 5:
            alerts.append(EarningsQualityAlert(
                "sbc_elevated_vs_revenue", "medium",
                f"Stock-Based Compensation representa {sbc_to_revenue_pct}% del revenue — vale la pena monitorear la dilución.",
                evidence=f"SBC/Revenue: {sbc_to_revenue_pct}%",
            ))
    if sbc_to_fcf_pct is not None:
        if sbc_to_fcf_pct >= 60:
            alerts.append(EarningsQualityAlert(
                "sbc_high_vs_fcf", "high",
                f"Stock-Based Compensation equivale a {sbc_to_fcf_pct}% del FCF reportado — gran parte del FCF 'real' "
                f"depende de que este gasto no sea en efectivo, no de que la dilución no exista.",
                evidence=f"SBC/FCF: {sbc_to_fcf_pct}%",
            ))
        elif sbc_to_fcf_pct >= 30:
            alerts.append(EarningsQualityAlert(
                "sbc_elevated_vs_fcf", "medium",
                f"Stock-Based Compensation equivale a {sbc_to_fcf_pct}% del FCF reportado.",
                evidence=f"SBC/FCF: {sbc_to_fcf_pct}%",
            ))
    return sbc_to_revenue_pct, sbc_to_fcf_pct, alerts


def evaluate_accounting_consistency(data_validation: Optional[dict]) -> list[EarningsQualityAlert]:
    """Reuses Fase 1's real accounting cross-validation
    (Revenue−COGS−OpEx vs. reported Operating Income per year) — never a
    new check, just surfaced here as an earnings-quality alert instead of
    only living in the AI prompt context."""
    if not data_validation or not data_validation.get("requiere_revision_manual"):
        return []
    years_flagged = data_validation.get("years_flagged") or []
    return [EarningsQualityAlert(
        "accounting_inconsistency", "high",
        f"Los años {', '.join(years_flagged)} muestran inconsistencias reales entre Revenue-COGS-OpEx y el "
        f"Operating Income reportado — podrían reflejar cargos especiales, reclasificaciones contables, o un error del proveedor de datos.",
        evidence=f"Años marcados: {', '.join(years_flagged)}" if years_flagged else None,
    )]


def _z_scores(trend: list[Optional[float]]) -> list[Optional[float]]:
    """Population z-scores per year. Known, disclosed limitation: with a
    single extreme outlier among only ~5 data points, that outlier's own
    magnitude inflates the population stdev enough that its z-score can
    never mathematically clear a threshold around 2.0 (the "masking
    effect" — the theoretical ceiling for one outlier among n points is
    ≈sqrt(n-1)). This means a genuinely anomalous year may go undetected
    for a company with only 3-5 years of statement history — a real,
    honest limitation of the technique with thin history, not a bug to
    silently patch by lowering the threshold (which would instead start
    flagging normal noise for companies with more history)."""
    valid = [(i, v) for i, v in enumerate(trend) if v is not None]
    if len(valid) < 4:
        return [None] * len(trend)
    values = [v for _, v in valid]
    mean, stdev = statistics.mean(values), statistics.pstdev(values)
    if stdev == 0:
        return [0.0 if v is not None else None for v in trend]
    result: list[Optional[float]] = [None] * len(trend)
    for i, v in valid:
        result[i] = (v - mean) / stdev
    return result


def evaluate_margin_anomalies(
    margin_trend: list[Optional[float]], years: list[str], margin_name: str, z_threshold: float = 2.0,
) -> list[EarningsQualityAlert]:
    """Flags any year where a margin deviates more than `z_threshold`
    standard deviations from the company's OWN historical average margin
    — a real, computed statistical outlier, not a narrative guess. This is
    a proxy for "something unusual happened this year" (a one-time gain,
    a write-down, a divestiture) — the engine reports the anomaly and its
    magnitude, never claims to know the specific cause (no data source
    for that exists here)."""
    alerts: list[EarningsQualityAlert] = []
    z_scores = _z_scores(margin_trend)
    for i, z in enumerate(z_scores):
        if z is None or abs(z) < z_threshold:
            continue
        year_label = years[i] if i < len(years) else f"año #{i + 1}"
        direction = "muy por encima" if z > 0 else "muy por debajo"
        alerts.append(EarningsQualityAlert(
            f"margin_anomaly_{margin_name}_{year_label}",
            "high" if abs(z) >= 3.0 else "medium",
            f"El {margin_name.replace('_', ' ')} de {year_label} ({margin_trend[i]}%) está {direction} del "
            f"promedio histórico propio de la empresa — posible partida inusual o no recurrente ese año.",
            evidence=f"z-score: {round(z, 2)}",
        ))
    return alerts


def evaluate_fcf_net_income_divergence(
    fcf_trend: list[Optional[float]], net_income_trend: list[Optional[float]], years: list[str], z_threshold: float = 2.0,
) -> list[EarningsQualityAlert]:
    """Same statistical-outlier technique as margin anomalies, applied to
    the FCF/Net Income ratio per year — flags a specific year where cash
    generation diverged sharply from reported earnings (either direction),
    a real signal distinct from the Quality Engine's own FCF-conversion
    LEVEL (which looks at the latest year only, not per-year anomalies)."""
    ratios: list[Optional[float]] = []
    for fcf, ni in zip(fcf_trend, net_income_trend):
        ratios.append(fcf / ni if fcf is not None and ni is not None and ni > 0 else None)
    z_scores = _z_scores(ratios)
    alerts: list[EarningsQualityAlert] = []
    for i, z in enumerate(z_scores):
        if z is None or abs(z) < z_threshold:
            continue
        year_label = years[i] if i < len(years) else f"año #{i + 1}"
        direction = "mucho más alto" if z > 0 else "mucho más bajo"
        alerts.append(EarningsQualityAlert(
            f"fcf_ni_divergence_{year_label}", "high" if abs(z) >= 3.0 else "medium",
            f"En {year_label}, el FCF fue {direction} de lo habitual en relación a la Utilidad Neta reportada "
            f"(FCF/UN = {round(ratios[i], 2)}x) — vale la pena revisar qué generó esa divergencia.",
            evidence=f"z-score: {round(z, 2)}",
        ))
    return alerts


def evaluate_revenue_fcf_growth_gap(
    revenue_cagr_pct: Optional[float], fcf_cagr_pct: Optional[float], gap_threshold_pp: float = 10.0,
) -> list[EarningsQualityAlert]:
    """A sustained gap where revenue grows meaningfully faster than FCF
    (over the same multi-year period) is a real, computable signal that
    top-line growth isn't converting into cash at the same pace — could
    be legitimate (heavy growth-stage reinvestment) or a quality concern
    (aggressive revenue recognition, deteriorating collections) — the
    alert states the gap, not the cause."""
    if revenue_cagr_pct is None or fcf_cagr_pct is None:
        return []
    gap = revenue_cagr_pct - fcf_cagr_pct
    if gap < gap_threshold_pp:
        return []
    severity = "high" if gap >= 20 else "medium"
    return [EarningsQualityAlert(
        "revenue_fcf_growth_gap", severity,
        f"El revenue creció {revenue_cagr_pct}% (CAGR) mientras el FCF creció {fcf_cagr_pct}% — una brecha de "
        f"{round(gap, 1)} puntos porcentuales. Puede ser reinversión legítima en una etapa de crecimiento, o una señal "
        f"de que el crecimiento reportado no se está convirtiendo en efectivo real al mismo ritmo.",
        evidence=f"Revenue CAGR {revenue_cagr_pct}% vs. FCF CAGR {fcf_cagr_pct}% (brecha {round(gap, 1)}pp)",
    )]


def compute_earnings_quality(
    *,
    sbc_latest: Optional[float], revenue_latest: Optional[float], fcf_latest: Optional[float],
    data_validation: Optional[dict],
    gross_margin_trend: list[Optional[float]], operating_margin_trend: list[Optional[float]], net_margin_trend: list[Optional[float]],
    fcf_trend: list[Optional[float]], net_income_trend: list[Optional[float]],
    years: list[str],
    revenue_cagr_pct: Optional[float], fcf_cagr_pct: Optional[float],
) -> EarningsQualityResult:
    """The single entry point — aggregates every alert-generating check
    above into one result. Pure function over already-computed real
    inputs, same pattern as every other engine in this package."""
    sbc_to_revenue_pct, sbc_to_fcf_pct, sbc_alerts = evaluate_sbc_dilution(sbc_latest, revenue_latest, fcf_latest)

    alerts: list[EarningsQualityAlert] = []
    alerts.extend(sbc_alerts)
    alerts.extend(evaluate_accounting_consistency(data_validation))
    alerts.extend(evaluate_margin_anomalies(gross_margin_trend, years, "margen_bruto"))
    alerts.extend(evaluate_margin_anomalies(operating_margin_trend, years, "margen_operativo"))
    alerts.extend(evaluate_margin_anomalies(net_margin_trend, years, "margen_neto"))
    alerts.extend(evaluate_fcf_net_income_divergence(fcf_trend, net_income_trend, years))
    alerts.extend(evaluate_revenue_fcf_growth_gap(revenue_cagr_pct, fcf_cagr_pct))

    return EarningsQualityResult(
        alerts=alerts, sbc_to_revenue_pct=sbc_to_revenue_pct, sbc_to_fcf_pct=sbc_to_fcf_pct,
    )
