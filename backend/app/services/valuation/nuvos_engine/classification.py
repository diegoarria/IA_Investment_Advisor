"""
Classification — Nuvos Fair Value Engine, Block 1.

Business-lifecycle classification, built entirely on real signals this
codebase already computes (`quality_engine.compute_cagr_windows`,
`quality/deterioration_engine.DeteriorationResult`, `numeric_helpers.
_coefficient_of_variation`/`STABILITY_CV_TIERS`, `quality/industry_engine.
classify_industry`) — no new data fetch, no invented thresholds beyond a
documented, evidence-motivated decision tree.

This is the mechanism that makes downstream methodology genuinely differ
by business type (`fair_pe.py` weights, `earnings_state.py` branch,
`scenarios.py` bounds) instead of running every company through identical
math. A deterministic decision tree, not a black box — every branch has a
`reason` string a user (or an engineer debugging a bad classification)
can read.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from app.services.valuation.numeric_helpers import _coefficient_of_variation, STABILITY_CV_TIERS
from app.services.quality.deterioration_engine import DeteriorationResult

# Sector categories (from `industry_engine.classify_industry`) with
# structurally lumpy, macro-driven earnings — the same categories a Lynch-
# style investor would call "cyclical" on sight. Substring-matched against
# the category string industry_engine already returns, so no new
# taxonomy is introduced.
_CYCLICAL_CATEGORIES = {"Semiconductors", "Airlines", "Oil & Gas", "Industrials", "Basic Materials"}

# Evidence-motivated, documented thresholds (not backtested magic numbers,
# same honest-v1 disclosure convention as fair_value_engine.py's sector
# base-P/E table) — a company sustaining >12% revenue CAGR for its own
# recent 3y window is unambiguously a "fast grower" by any common
# definition of the term; below ~3% is unambiguously "slow."
_FAST_GROWER_CAGR_PCT = 12.0
_SLOW_GROWER_CAGR_PCT = 3.0

# Priority 2 (methodology audit) — absolute ROIC fallback thresholds, used
# ONLY when a real peer-relative comparison (`industry_median_roic_pct`)
# isn't available (a live peer-benchmark fetch that can fail on rate
# limits or thin coverage — confirmed real cases: KO, CAT, MELI, MCD all
# fell through to the generic low-confidence default for exactly this
# reason in the validation run). 15% is comfortably above a typical
# 9-10% cost of capital across sectors — a real, if less precise, signal
# of durable economic returns even without a peer comparison.
_ABSOLUTE_ROIC_STALWART_PCT = 15.0


class LynchCategory(str, Enum):
    SLOW_GROWER = "slow_grower"
    STALWART = "stalwart"
    FAST_GROWER = "fast_grower"
    CYCLICAL = "cyclical"
    TURNAROUND = "turnaround"
    ASSET_PLAY = "asset_play"
    FINANCIAL = "financial"
    # Priority 2 — a genuine "we don't have enough evidence" outcome,
    # distinct from any real category. Never silently relabeled as
    # "stalwart" (or any other category) when the evidence doesn't
    # actually support it — see `classification_method="insufficient_data"`.
    UNKNOWN = "unknown"


# Priority 2 — how the classification was actually reached, kept for
# backend traceability (the audit's explicit ask: "necesitamos distinguir
# claramente classification_method=peer_relative de fallback_absolute_roic
# de insufficient_data"). Not necessarily shown in the UI, but always
# present in the backend result.
ClassificationMethod = str  # "direct_evidence" | "peer_relative" | "fallback_absolute_roic" | "insufficient_data"


@dataclass
class ClassificationResult:
    category: LynchCategory
    confidence: float  # 0-100, how clean the deciding signal was
    secondary_category: Optional[LynchCategory]
    reason: str
    factors: list[str] = field(default_factory=list)
    method: ClassificationMethod = "direct_evidence"


def classify_business(
    *,
    revenue_cagr_3y_pct: Optional[float],
    eps_trend: list[Optional[float]],
    deterioration: DeteriorationResult,
    sector_category: str,
    roic_avg_pct: Optional[float],
    industry_median_roic_pct: Optional[float],
    is_financial_sector: bool,
    net_debt_to_ebitda: Optional[float] = None,
    latest_eps: Optional[float] = None,
) -> ClassificationResult:
    """Single entry point. Never forces a confident label out of thin
    evidence — when signals disagree or history is too short, `confidence`
    drops and `secondary_category` records the runner-up instead of
    silently picking one."""
    factors: list[str] = []

    # 1. Financial-sector companies always route to the existing
    # financial_engine.py Residual Income model — that routing already
    # exists in this codebase (financial_engine.classify_financial_
    # subsector), this classifier just needs to defer to it, not
    # reproduce it.
    if is_financial_sector:
        return ClassificationResult(
            category=LynchCategory.FINANCIAL, confidence=100.0, secondary_category=None,
            reason="Empresa financiera — se aplica el modelo de Residual Income, no el marco Growth+Quality+Value.",
            factors=["is_financial_sector=True"],
        )

    # 2. Turnaround: real, mechanical evidence of recovery off a
    # depressed/negative base — never inferred from a single good quarter.
    depressed_base = latest_eps is not None and latest_eps <= 0
    recovering = deterioration.has_any_signal and deterioration.improving_count > deterioration.deteriorating_count
    if depressed_base and recovering:
        factors.append(f"EPS actual no positivo ({latest_eps}) con {deterioration.improving_count} factor(es) mejorando vs. {deterioration.deteriorating_count} deteriorando.")
        return ClassificationResult(
            category=LynchCategory.TURNAROUND, confidence=70.0 if deterioration.has_any_signal else 40.0,
            secondary_category=LynchCategory.CYCLICAL if sector_category in _CYCLICAL_CATEGORIES else None,
            reason="Ganancias deprimidas o negativas con evidencia real de mejora reciente — clasificado como Turnaround.",
            factors=factors,
        )
    if depressed_base and not recovering:
        factors.append(f"EPS actual no positivo ({latest_eps}) sin evidencia clara de recuperación.")
        return ClassificationResult(
            category=LynchCategory.TURNAROUND, confidence=25.0,
            secondary_category=None,
            reason="Ganancias deprimidas o negativas sin evidencia de recuperación — clasificado como Turnaround de baja confianza (candidato a Insufficient Data en la valuación).",
            factors=factors,
        )

    # 3. Cyclical: high earnings volatility AND a sector known to be
    # structurally lumpy — either signal alone is not enough (a volatile
    # non-cyclical sector is more likely a data-quality problem than a
    # real cyclical business).
    cv = _coefficient_of_variation(eps_trend)
    low_stability = cv is not None and cv >= 0.45  # STABILITY_CV_TIERS: 0.45 is where the score tier drops to 60/35
    sector_is_cyclical = sector_category in _CYCLICAL_CATEGORIES
    if low_stability and sector_is_cyclical:
        factors.append(f"Coeficiente de variación del EPS = {cv:.2f} (alta volatilidad) en sector cíclico ({sector_category}).")
        return ClassificationResult(
            category=LynchCategory.CYCLICAL, confidence=75.0, secondary_category=None,
            reason="Ganancias volátiles en un sector estructuralmente cíclico — clasificado como Cyclical.",
            factors=factors,
        )

    # 4. Fast Grower: sustained, real revenue CAGR above threshold with
    # earnings that are at least moderately stable (a company growing
    # >12%/yr with wildly unstable earnings is closer to Cyclical/
    # Turnaround than a clean Fast Grower).
    if revenue_cagr_3y_pct is not None and revenue_cagr_3y_pct >= _FAST_GROWER_CAGR_PCT and not low_stability:
        factors.append(f"CAGR de ingresos 3 años = {revenue_cagr_3y_pct:.1f}% (>= {_FAST_GROWER_CAGR_PCT}%), ganancias razonablemente estables.")
        return ClassificationResult(
            category=LynchCategory.FAST_GROWER, confidence=80.0, secondary_category=None,
            reason="Crecimiento de ingresos sostenido y real por encima del umbral, con ganancias estables — clasificado como Fast Grower.",
            factors=factors,
        )

    # 5. Stalwart: real returns on capital, with growth below the Fast
    # Grower bar — deliberately NO lower growth bound here (calibration
    # finding: a mature, capital-light compounder earning far above its
    # industry's ROIC — e.g. Apple, Coca-Cola — is a textbook Stalwart even
    # at low-single-digit or flat growth; excluding low-growth-but-high-
    # ROIC names here was misrouting them into Asset Play below, which is
    # meant for WEAK-return balance-sheet stories, not high-quality earners
    # that simply aren't growing fast anymore).
    #
    # Priority 2 (methodology audit): TWO evidence tiers, not one.
    # `industry_median_roic_pct` depends on a live peer-benchmark fetch
    # (`industry_engine.compute_industry_benchmarks`, needs >=5 real peers)
    # that isn't always available — confirmed real cases: KO, CAT, MELI,
    # MCD all fell through to the generic low-confidence default in the
    # validation run purely because that fetch didn't succeed that
    # request, not because the evidence disagreed. A real absolute-ROIC
    # fallback (lower confidence than a peer-relative call, but still real
    # evidence, not a coin flip) closes that gap.
    if revenue_cagr_3y_pct is not None and revenue_cagr_3y_pct < _FAST_GROWER_CAGR_PCT:
        if roic_avg_pct is not None and industry_median_roic_pct is not None and roic_avg_pct >= industry_median_roic_pct:
            factors.append(f"CAGR de ingresos 3 años = {revenue_cagr_3y_pct:.1f}% (crecimiento moderado), ROIC {roic_avg_pct:.1f}% >= mediana de industria {industry_median_roic_pct:.1f}%.")
            return ClassificationResult(
                category=LynchCategory.STALWART, confidence=75.0, secondary_category=None,
                reason="Crecimiento moderado y consistente con retornos sobre capital reales en línea o por encima de sus pares — clasificado como Stalwart.",
                factors=factors, method="peer_relative",
            )
        if roic_avg_pct is not None and roic_avg_pct >= _ABSOLUTE_ROIC_STALWART_PCT:
            factors.append(
                f"CAGR de ingresos 3 años = {revenue_cagr_3y_pct:.1f}% (crecimiento moderado), ROIC {roic_avg_pct:.1f}% "
                f">= {_ABSOLUTE_ROIC_STALWART_PCT:.0f}% absoluto (benchmark de pares no disponible — se usó evidencia absoluta)."
            )
            return ClassificationResult(
                category=LynchCategory.STALWART, confidence=55.0, secondary_category=None,
                reason=(
                    "Crecimiento moderado con ROIC absoluto real muy por encima de un costo de capital típico — "
                    "clasificado como Stalwart usando evidencia absoluta (no fue posible comparar contra pares reales)."
                ),
                factors=factors, method="fallback_absolute_roic",
            )

    # 6. Asset Play: weak/negative earnings-based signal AND weak-or-
    # unknown returns on capital, but a real balance-sheet cushion (low
    # leverage) — flagged as the lowest-confidence bucket per the spec
    # (needs the most manual scrutiny), never fully automated with the
    # same confidence as the others. The `roic` condition was added after
    # calibration: without it, a low-growth but HIGH-ROIC company (already
    # routed to Stalwart in step 5 when industry data was available) still
    # fell through here whenever industry_median_roic_pct was simply
    # missing — an Asset Play is a weak-EARNINGS, real-ASSETS story, not
    # "any low-growth company with low debt."
    weak_or_unknown_roic = (
        roic_avg_pct is None or industry_median_roic_pct is None or roic_avg_pct < industry_median_roic_pct
    )
    if (
        (revenue_cagr_3y_pct is None or revenue_cagr_3y_pct <= _SLOW_GROWER_CAGR_PCT)
        and net_debt_to_ebitda is not None and net_debt_to_ebitda <= 0.5
        and weak_or_unknown_roic
    ):
        factors.append(f"Crecimiento débil/plano con apalancamiento muy bajo (Deuda neta/EBITDA = {net_debt_to_ebitda:.2f}x) — posible valor de activos no reflejado en las ganancias.")
        return ClassificationResult(
            category=LynchCategory.ASSET_PLAY, confidence=40.0,
            secondary_category=LynchCategory.SLOW_GROWER,
            reason="Señal de ganancias débil pero balance muy sólido — clasificado como Asset Play de baja confianza; requiere revisión adicional del valor de activos.",
            factors=factors,
        )

    # 7. Slow Grower: default for low/flat, stable growth that didn't
    # qualify as Stalwart (ROIC below peers) or Asset Play.
    if revenue_cagr_3y_pct is not None and revenue_cagr_3y_pct <= _SLOW_GROWER_CAGR_PCT:
        factors.append(f"CAGR de ingresos 3 años = {revenue_cagr_3y_pct:.1f}% (<= {_SLOW_GROWER_CAGR_PCT}%).")
        return ClassificationResult(
            category=LynchCategory.SLOW_GROWER, confidence=60.0, secondary_category=None,
            reason="Crecimiento bajo o plano, sin señales de deterioro agudo ni de recuperación — clasificado como Slow Grower.",
            factors=factors,
        )

    # 8. Fallback: evidence didn't cleanly sort into any bucket above (e.g.
    # missing revenue_cagr_3y_pct entirely, or moderate growth with no ROIC
    # evidence at all — neither peer-relative nor absolute).
    #
    # Priority 2 (methodology audit): this used to silently return
    # `category=STALWART` at confidence 20 — indistinguishable from a real,
    # evidenced Stalwart call by anyone reading only the `category` field.
    # `UNKNOWN` makes the "we genuinely don't have enough evidence" case
    # honest and traceable — never presented as if it were a real
    # classification.
    factors.append("Evidencia insuficiente o mixta para una clasificación clara (sin ROIC de pares ni absoluto suficiente, o sin CAGR de ingresos).")
    return ClassificationResult(
        category=LynchCategory.UNKNOWN, confidence=0.0,
        secondary_category=LynchCategory.SLOW_GROWER,
        reason="Datos insuficientes o señales contradictorias — no se pudo determinar una clasificación económica real.",
        factors=factors, method="insufficient_data",
    )
