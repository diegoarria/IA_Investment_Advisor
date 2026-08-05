"""
Capital Allocation Engine — Fase 2, Incremento 4 (Parte C — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Evaluates HOW a company deploys its capital (buybacks, dividends,
reinvestment) — not just whether it does these things. Independent of the
DCF/valuation engines; the one place this touches price at all is to check
whether real historical buybacks happened at cheap or expensive prices
relative to today — using
`financial_data_service.get_historical_prices_near_dates`, the exact same
function Historical Valuation (Fase 1, Method 4) already uses for its own
real fiscal-year-end prices. No new price-fetching logic invented here.

Acquisitions: the brief explicitly asks whether M&A created or destroyed
value. No data source in this codebase tracks acquisition price,
synergies, or post-deal ROIC — this is a genuine, disclosed limitation,
not an invented score. `acquisitions_note` in the result says so plainly,
matching the same honesty standard already established for REITs/
financial-sector companies in the DCF engine (a clear message instead of
a fabricated number).
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

from app.services.valuation.numeric_helpers import _score, _coefficient_of_variation, STABILITY_CV_TIERS

ACQUISITIONS_NOTE = (
    "El análisis de adquisiciones (¿crearon o destruyeron valor?) requiere datos de "
    "precio pagado, sinergias esperadas y ROIC post-adquisición que no están disponibles "
    "en ninguna fuente de datos integrada actualmente — no se inventa un puntaje sin evidencia real."
)

_BUYBACK_RATE_TIERS = [(0, 30), (1, 50), (2, 65), (3, 80), (5, 90), (999, 95)]
_PAYOUT_SANITY_TIERS = [(0.6, 90), (0.8, 75), (1.0, 55), (1.2, 30), (999, 10)]  # fraction, not %
_STABILITY_CV_TIERS = STABILITY_CV_TIERS  # local alias — see numeric_helpers.py


@dataclass
class CapitalAllocationFactor:
    name: str
    value: Optional[float]
    score: Optional[float]
    reason: str


@dataclass
class BuybackYearDetail:
    fiscal_period: str
    shares_reduced_pct: float
    price_at_buyback: Optional[float]
    current_price: Optional[float]
    looks_good_in_hindsight: Optional[bool]


@dataclass
class CapitalAllocationResult:
    capital_allocation_score: int
    buyback_timing_score: Optional[float]
    dividend_consistency_score: Optional[float]
    reinvestment_quality_score: Optional[float]
    buyback_years: list[BuybackYearDetail] = field(default_factory=list)
    factors: list[CapitalAllocationFactor] = field(default_factory=list)
    acquisitions_note: str = ACQUISITIONS_NOTE

    @property
    def has_any_signal(self) -> bool:
        return any(s is not None for s in (
            self.buyback_timing_score, self.dividend_consistency_score, self.reinvestment_quality_score,
        ))


def evaluate_buyback_timing(
    ticker: str, implied_shares_trend: list[Optional[float]], fiscal_period_dates: list[Optional[str]],
    current_price: Optional[float],
) -> tuple[Optional[float], list[BuybackYearDetail]]:
    """For every year where the implied share count dropped by ≥1% (a real
    buyback, not noise), fetches the real historical price at that fiscal
    year-end and checks whether today's price is higher (the buyback
    "looks good in hindsight" — shares were retired before the price rose)
    or lower (looks expensive in hindsight). This is a real, honest,
    RETROSPECTIVE signal — it says nothing about whether management could
    have known the price would move that way, only what actually happened.
    Returns (score, per-year detail) — score is None if no real buyback
    years are found or no price data is available (never a fabricated
    default)."""
    if current_price is None or len(implied_shares_trend) < 2:
        return None, []

    buyback_years: list[BuybackYearDetail] = []
    dates_to_fetch: list[str] = []
    year_indices: list[int] = []
    for i in range(1, len(implied_shares_trend)):
        prev, curr = implied_shares_trend[i - 1], implied_shares_trend[i]
        if prev is None or curr is None or prev <= 0:
            continue
        reduction_pct = (prev - curr) / prev * 100
        if reduction_pct >= 1.0:
            period = fiscal_period_dates[i] if i < len(fiscal_period_dates) else None
            if period:
                dates_to_fetch.append(period)
                year_indices.append(i)

    if not dates_to_fetch:
        return None, []

    from app.services.financial_data_service import get_historical_prices_near_dates
    prices_by_date = get_historical_prices_near_dates(ticker, dates_to_fetch)

    good_count = 0
    evaluated_count = 0
    for i, period in zip(year_indices, dates_to_fetch):
        prev, curr = implied_shares_trend[i - 1], implied_shares_trend[i]
        reduction_pct = round((prev - curr) / prev * 100, 2)
        price_then = prices_by_date.get(period)
        looks_good = (current_price > price_then) if price_then is not None else None
        if looks_good is not None:
            evaluated_count += 1
            if looks_good:
                good_count += 1
        buyback_years.append(BuybackYearDetail(
            fiscal_period=period, shares_reduced_pct=reduction_pct,
            price_at_buyback=price_then, current_price=current_price,
            looks_good_in_hindsight=looks_good,
        ))

    if evaluated_count == 0:
        return None, buyback_years
    score = round(good_count / evaluated_count * 100, 1)
    return score, buyback_years


def evaluate_dividend_consistency(dividends_paid_trend: list[Optional[float]]) -> tuple[Optional[float], Optional[int]]:
    """Counts real year-over-year dividend CUTS (a drop of more than 10% —
    a threshold that ignores normal rounding/timing noise between fiscal
    years) — a dividend cut is one of the clearest real signals of capital-
    allocation distress, more informative than the payout ratio alone.
    Returns (score, cut_count). None score if fewer than 3 years of real
    dividend data (can't meaningfully assess consistency)."""
    valid = [(i, v) for i, v in enumerate(dividends_paid_trend) if v is not None]
    if len(valid) < 3:
        return None, None
    cuts = 0
    for (_, prev), (_, curr) in zip(valid, valid[1:]):
        if prev > 0 and (prev - curr) / prev > 0.10:
            cuts += 1
    # Each real cut is a meaningful negative signal — capped floor at 10.
    score = max(10, 95 - cuts * 30)
    return float(score), cuts


def evaluate_reinvestment_quality(reinvestment_rate_trend: list[Optional[float]]) -> Optional[float]:
    """Reuses the reinvestment-rate trend Fase 1's DCF Engine already
    computes (Capex + ΔWC − D&A) / NOPAT, per year — never re-derived here.
    Scores STABILITY (low coefficient of variation) as the quality signal:
    a reinvestment rate that swings wildly year to year is harder to trust
    as a genuine long-run capital-allocation policy than a consistent one,
    independent of whether the level itself is high or low (that's the
    DCF engine's own business — this engine only asks "is the pattern
    disciplined")."""
    cv = _coefficient_of_variation(reinvestment_rate_trend)
    if cv is None:
        return None
    return float(_score(cv, _STABILITY_CV_TIERS))


def compute_capital_allocation_score(
    *,
    ticker: str, current_price: Optional[float],
    implied_shares_trend: list[Optional[float]], fiscal_period_dates: list[Optional[str]],
    dividends_paid_trend: list[Optional[float]],
    reinvestment_rate_trend: list[Optional[float]],
    buyback_rate_pct: Optional[float], payout_ratio: Optional[float],
) -> CapitalAllocationResult:
    """The single entry point. `buyback_rate_pct` and `payout_ratio` (a
    fraction, e.g. 0.6 = 60%) are accepted as already-computed inputs
    (fundamental_analysis_service already derives them for
    thesis_scores["management_capital_allocation"]) rather than re-derived
    here — same tier tables are reused so this engine's view of "is the
    buyback rate/payout ratio reasonable" never silently disagrees with
    the existing management score."""
    factors: list[CapitalAllocationFactor] = []

    buyback_timing_score, buyback_years = evaluate_buyback_timing(
        ticker, implied_shares_trend, fiscal_period_dates, current_price,
    )
    if buyback_years:
        good = sum(1 for b in buyback_years if b.looks_good_in_hindsight)
        factors.append(CapitalAllocationFactor(
            "buyback_timing", buyback_timing_score, buyback_timing_score,
            f"{len(buyback_years)} año(s) con recompras reales detectadas; {good} de ellas se ven bien en retrospectiva "
            f"(precio actual por encima del precio histórico al momento de la recompra).",
        ))
    else:
        factors.append(CapitalAllocationFactor(
            "buyback_timing", None, None,
            "No se detectaron recompras reales (reducción de acciones ≥1% en un año) en el historial disponible.",
        ))

    buyback_rate_score = _score(buyback_rate_pct, _BUYBACK_RATE_TIERS) if buyback_rate_pct is not None else None
    factors.append(CapitalAllocationFactor(
        "buyback_rate", buyback_rate_pct, buyback_rate_score,
        f"Tasa de recompra anual implícita: {buyback_rate_pct}%." if buyback_rate_pct is not None else "Tasa de recompra no disponible.",
    ))

    payout_sanity_score = _score(payout_ratio, _PAYOUT_SANITY_TIERS) if payout_ratio is not None else None
    factors.append(CapitalAllocationFactor(
        "payout_ratio", round(payout_ratio * 100, 1) if payout_ratio is not None else None, payout_sanity_score,
        f"Payout ratio (dividendos / utilidad neta): {round(payout_ratio * 100, 1)}%." if payout_ratio is not None else "Payout ratio no disponible.",
    ))

    dividend_consistency_score, dividend_cuts = evaluate_dividend_consistency(dividends_paid_trend)
    factors.append(CapitalAllocationFactor(
        "dividend_consistency", dividend_cuts, dividend_consistency_score,
        f"{dividend_cuts} recorte(s) real(es) de dividendo (caída >10% año contra año) detectado(s) en el historial." if dividend_cuts is not None
        else "Historial de dividendos insuficiente para evaluar consistencia (menos de 3 años de datos reales).",
    ))

    reinvestment_quality_score = evaluate_reinvestment_quality(reinvestment_rate_trend)
    reinvestment_cv = _coefficient_of_variation(reinvestment_rate_trend)
    factors.append(CapitalAllocationFactor(
        "reinvestment_quality", round(reinvestment_cv, 2) if reinvestment_cv is not None else None, reinvestment_quality_score,
        f"Estabilidad de la tasa de reinversión (coeficiente de variación {round(reinvestment_cv, 2)}) — más bajo indica una política de reinversión más disciplinada."
        if reinvestment_cv is not None else "Estabilidad de reinversión no evaluable (datos insuficientes).",
    ))

    present = [
        (s, w) for s, w in [
            (buyback_timing_score, 0.25), (buyback_rate_score, 0.15), (payout_sanity_score, 0.15),
            (dividend_consistency_score, 0.20), (reinvestment_quality_score, 0.25),
        ] if s is not None
    ]
    if present:
        total_weight = sum(w for _, w in present)
        capital_allocation_score = round(sum(s * w for s, w in present) / total_weight)
    else:
        capital_allocation_score = 0

    return CapitalAllocationResult(
        capital_allocation_score=capital_allocation_score,
        buyback_timing_score=buyback_timing_score,
        dividend_consistency_score=dividend_consistency_score,
        reinvestment_quality_score=reinvestment_quality_score,
        buyback_years=buyback_years,
        factors=factors,
    )
