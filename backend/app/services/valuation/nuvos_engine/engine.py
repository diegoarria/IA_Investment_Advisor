"""
Engine — Nuvos Fair Value Engine orchestrator (plan §15).

Single entry point: `compute_nuvos_fair_value(...)`. Performs ZERO data
fetching of its own — every input is something `fundamental_analysis_
service.py` (or the caller) already computed for the DCF/quality/growth
pipeline (trends, scores, benchmarks, peer/historical P/E). This module's
job is purely to run the Block 1/Block 2 modules in the right order and
apply the Reality Gate before returning a number, per plan §11/§15:
if the gate fails or confidence is too low, `status="insufficient_data"`
is returned instead of forcing a Fair Value.

Financial-sector companies are detected and routed OUT immediately
(`status="financial_sector"`) — the caller should use the existing
`financial_engine.py` Residual Income model for those, exactly as today;
this engine's Growth+Quality+Value framework is not applied to them.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Optional

from app.services.quality.quality_engine import compute_cagr_windows
from app.services.quality.deterioration_engine import DeteriorationResult
from app.services.quality.moat_engine import MoatScoreResult

from app.services.valuation.nuvos_engine.provenance import ProvenanceLedger, build_ledger, record
from app.services.valuation.nuvos_engine.classification import classify_business, ClassificationResult, LynchCategory
from app.services.valuation.nuvos_engine.earnings_state import detect_earnings_state, EarningsStateResult
from app.services.valuation.nuvos_engine.growth_quality import decompose_eps_growth, EpsGrowthDecomposition
from app.services.valuation.nuvos_engine.growth_evidence import resolve_growth_evidence, GrowthEvidenceResult
from app.services.valuation.nuvos_engine.fair_pe import compute_fair_pe, FairPEResult
from app.services.valuation.nuvos_engine.peg_diagnostic import compute_peg, compute_pegy, PegResult, PegyResult
from app.services.valuation.nuvos_engine.fcf_quality import compute_fcf_conversion, flag_divergence, FcfQualityResult
from app.services.valuation.nuvos_engine.scenarios import build_scenarios, ScenarioSet
from app.services.valuation.nuvos_engine.divergence import explain_divergence, DivergenceExplanation
from app.services.valuation.nuvos_engine.reality_gate import run_reality_gate, RealityGateResult
from app.services.valuation.confidence_engine import compute_confidence_meter_v4, compute_uncertainty_profile
from app.services.valuation.outlier_detection_engine import detect_valuation_outliers

_DEFAULT_MIN_CONFIDENCE_SCORE = 35.0  # matches undervalued_screener_service.py's existing _MIN_CONFIDENCE_SCORE gate


@dataclass
class NuvosFairValueResult:
    status: str  # "ok" | "insufficient_data" | "financial_sector"
    classification: Optional[ClassificationResult] = None
    earnings_state: Optional[EarningsStateResult] = None
    growth_quality: Optional[EpsGrowthDecomposition] = None
    fair_pe: Optional[FairPEResult] = None
    peg: Optional[PegResult] = None
    pegy: Optional[PegyResult] = None
    fcf_quality: Optional[FcfQualityResult] = None
    scenarios: Optional[ScenarioSet] = None
    reality_gate: Optional[RealityGateResult] = None
    divergence: Optional[DivergenceExplanation] = None
    confidence_meter: Optional[dict] = None
    uncertainty_profile: Optional[dict] = None
    outlier_flags: Optional[dict] = None
    provenance: Optional[ProvenanceLedger] = None
    insufficient_data_reason: Optional[str] = None


def compute_nuvos_fair_value(
    *,
    sector: Optional[str],
    industry: Optional[str],
    is_financial_sector: bool,
    current_price: Optional[float],
    latest_eps: Optional[float],
    eps_trend: list[Optional[float]],
    revenue_trend: list[Optional[float]],
    net_margin_trend: list[Optional[float]],
    fcf_trend: list[Optional[float]],
    net_income_trend: list[Optional[float]],
    # Methodology audit (see /Users/diegoarria/.claude/plans/cosmic-
    # munching-crown.md) — FCF normalized for maintenance-vs-growth CapEx
    # (maintenance ≈ min(capex, D&A)). Used ONLY for the Fair P/E's
    # fcf_margin adjustment below, so a business mid-ramp on heavy GROWTH
    # capex isn't penalized as if its cash economics were deteriorating.
    # `fcf_trend` (FCF Reported, unchanged) still drives CAGR windows and
    # the FCF/Net-Income conversion-quality check — those are about actual
    # reported cash, not a heuristic adjustment. Defaults to `fcf_trend`
    # when not supplied, so existing callers/tests keep today's behavior.
    fcf_normalized_trend: Optional[list[Optional[float]]] = None,
    implied_shares_trend: list[Optional[float]],
    deterioration_result: DeteriorationResult,
    moat_result: MoatScoreResult,
    management_score: Optional[float],
    avg_roic_pct: Optional[float],
    cost_of_capital_pct: Optional[float],
    net_debt_to_ebitda: Optional[float],
    interest_coverage: Optional[float],
    dividend_yield_pct: Optional[float],
    industry_median_roic_pct: Optional[float],
    expected_eps_growth_pct: Optional[float],
    forward_pe: Optional[float],
    # Priority 1 (methodology audit) — the normalized-growth blend
    # growth_engine.py already computes (6 weighted real signals), used as
    # the LAST evidence tier before giving up when no forward consensus
    # AND no historical EPS/revenue CAGR are available. Optional/None-safe.
    normalized_growth_pct: Optional[float] = None,
    historical_median_pe: Optional[float] = None,
    peer_median_pe: Optional[float] = None,
    eps_low: Optional[float] = None,
    eps_high: Optional[float] = None,
    financials_response: Optional[dict] = None,
    years_available: int = 0,
    liquidity_ok: bool = True,
    business_quality_score: Optional[float] = None,
    financial_strength_score: Optional[float] = None,
    financial_statement_quality_score: Optional[float] = None,
    management_consistency_score: Optional[float] = None,
    eps_source_consistent: bool = True,
    min_confidence_score: float = _DEFAULT_MIN_CONFIDENCE_SCORE,
) -> NuvosFairValueResult:
    if is_financial_sector:
        return NuvosFairValueResult(status="financial_sector")

    ledger = build_ledger(financials_response=financials_response, headline_metrics={
        "eps_ttm": (latest_eps, "TTM"),
        "revenue_latest": (revenue_trend[-1] if revenue_trend else None, "latest"),
        "fcf_latest": (fcf_trend[-1] if fcf_trend else None, "latest"),
    })

    revenue_windows = compute_cagr_windows(revenue_trend)
    eps_windows = compute_cagr_windows(eps_trend)
    fcf_windows = compute_cagr_windows(fcf_trend)

    classification = classify_business(
        revenue_cagr_3y_pct=revenue_windows.get("3y"),
        eps_trend=eps_trend,
        deterioration=deterioration_result,
        sector_category=_industry_category(sector, industry),
        roic_avg_pct=avg_roic_pct,
        industry_median_roic_pct=industry_median_roic_pct,
        is_financial_sector=False,
        net_debt_to_ebitda=net_debt_to_ebitda,
        latest_eps=latest_eps,
    )

    earnings_state = detect_earnings_state(
        eps_trend=eps_trend, net_margin_trend=net_margin_trend,
        category=classification.category, latest_eps=latest_eps,
        deterioration=deterioration_result,
    )

    growth_quality = decompose_eps_growth(
        eps_cagr_pct=eps_windows.get("5y") or eps_windows.get("3y"),
        revenue_cagr_pct=revenue_windows.get("5y") or revenue_windows.get("3y"),
        implied_shares_trend=implied_shares_trend,
    )

    # Priority 1 (methodology audit) — resolve growth through the evidence
    # hierarchy BEFORE computing Fair P/E, instead of feeding a bare
    # (usually-unavailable) forward-consensus float directly into the
    # growth adjustment. See growth_evidence.py's own docstring for the
    # full hierarchy and why it exists.
    growth_evidence = resolve_growth_evidence(
        forward_consensus_pct=expected_eps_growth_pct,
        eps_cagr_pct=growth_quality.eps_cagr_pct,
        revenue_cagr_pct=growth_quality.revenue_cagr_pct,
        normalized_growth_pct=normalized_growth_pct,
        # Mandatory per-share Fair Value Engine (methodology audit round 5)
        # — real historical shares-outstanding CAGR, already computed by
        # decompose_eps_growth above (negative = buybacks).
        shares_cagr_pct=growth_quality.shares_cagr_pct,
    )

    _fcf_margin_source = fcf_normalized_trend if fcf_normalized_trend else fcf_trend
    fair_pe_result = compute_fair_pe(
        category=classification.category, sector=sector,
        roic_pct=avg_roic_pct, cost_of_capital_pct=cost_of_capital_pct,
        fcf_margin_pct=(_fcf_margin_source[-1] / revenue_trend[-1] * 100) if _fcf_margin_source and revenue_trend and _fcf_margin_source[-1] is not None and revenue_trend[-1] else None,
        net_debt_to_ebitda=net_debt_to_ebitda, interest_coverage=interest_coverage,
        dividend_yield_pct=dividend_yield_pct, moat_score=moat_result.moat_score,
        management_score=management_score,
        historical_median_pe=historical_median_pe, peer_median_pe=peer_median_pe,
        growth_quality=growth_quality, growth_evidence=growth_evidence,
    )

    peg = compute_peg(forward_pe, expected_eps_growth_pct)
    pegy = compute_pegy(forward_pe, expected_eps_growth_pct, dividend_yield_pct)

    latest_fcf = fcf_trend[-1] if fcf_trend else None
    latest_ni = net_income_trend[-1] if net_income_trend else None
    fcf_quality_result = compute_fcf_conversion(latest_fcf, latest_ni)
    fcf_divergence_flag = flag_divergence(eps_windows.get("5y") or eps_windows.get("3y"), fcf_windows.get("5y") or fcf_windows.get("3y"))

    normalized_eps_base = earnings_state.normalized_eps if earnings_state.normalized_eps is not None else latest_eps
    scenarios = build_scenarios(
        normalized_eps_base=normalized_eps_base, fair_pe_result=fair_pe_result,
        current_price=current_price, eps_low=eps_low, eps_high=eps_high,
    )

    growth_based_multiple = next((f.value for f in fair_pe_result.factors if f.name == "growth_based_multiple"), None)
    divergence = explain_divergence(
        fair_value=scenarios.base.fair_value_per_share if scenarios else None,
        current_price=current_price,
        earnings_state=earnings_state.state,
        fair_pe_primary_anchor=fair_pe_result.primary_anchor,
        historical_median_pe=historical_median_pe, peer_median_pe=peer_median_pe,
        growth_based_multiple=growth_based_multiple, ledger=ledger,
    )

    buyback_share = None
    # Mandatory per-share Fair Value Engine (methodology audit round 5) —
    # this Reality Gate check exists to flag EPS-CAGR-based growth that's
    # mostly buyback-driven (a real data-quality risk for that path). When
    # growth instead came from the new per-share-compounded tier, buybacks
    # are the INTENDED, explicitly-credited methodology, not a risk to
    # flag — skip the check (None passes it unconditionally) rather than
    # penalizing the exact behavior Diego mandated.
    if growth_evidence.source != "per_share_compounded" and growth_quality.from_buybacks_pct is not None and growth_quality.eps_cagr_pct:
        buyback_share = abs(growth_quality.from_buybacks_pct) / abs(growth_quality.eps_cagr_pct) * 100

    reality_gate = run_reality_gate(
        growth_adjustment_pct=None,  # growth_engine's own bound-tracking is a Block 3 wiring concern (fundamental_analysis_service integration)
        growth_adjustment_bound_pp=2.0,
        fair_pe_primary_anchor=fair_pe_result.primary_anchor,
        fair_pe_value=fair_pe_result.fair_pe,
        fair_pe_band=fair_pe_result.band,
        earnings_state=earnings_state.state,
        normalized_eps_used=earnings_state.normalized_eps is not None,
        buyback_share_of_eps_growth_pct=buyback_share,
        fcf_divergence_flag=fcf_divergence_flag,
        leverage_adjustment_applied=(net_debt_to_ebitda is not None or interest_coverage is not None),
        eps_source_consistent=eps_source_consistent,
        ledger=ledger,
        divergence=divergence,
        earnings_quality_warning=fcf_quality_result.earnings_quality_warning,
        earnings_quality_reason=fcf_quality_result.earnings_quality_reason,
        structural_evidence_count=earnings_state.structural_evidence_count,
    )

    predictability_score = moat_result.stability_score
    confidence_meter = compute_confidence_meter_v4(
        predictability_score=predictability_score,
        years_available=years_available,
        fair_value_range={
            "base": scenarios.base.fair_value_per_share if scenarios else None,
            "low": scenarios.bear.fair_value_per_share if scenarios else None,
            "high": scenarios.bull.fair_value_per_share if scenarios else None,
        },
        liquidity_ok=liquidity_ok,
        business_quality_score=business_quality_score,
        financial_strength_score=financial_strength_score,
        financial_statement_quality_score=financial_statement_quality_score,
        management_consistency_score=management_consistency_score,
        classification_confidence=classification.confidence,
        provenance_completeness=ledger.completeness_pct,
        divergence_explained=divergence.explained if divergence.material else True,
        reality_gate_pass_rate=reality_gate.pass_rate,
    )

    uncertainty_profile = asdict(compute_uncertainty_profile(
        predictability_score=predictability_score,
        years_available=years_available,
        fair_value_range={
            "base": scenarios.base.fair_value_per_share if scenarios else None,
            "low": scenarios.bear.fair_value_per_share if scenarios else None,
            "high": scenarios.bull.fair_value_per_share if scenarios else None,
        },
        business_quality_score=business_quality_score,
        financial_statement_quality_score=financial_statement_quality_score,
        classification_confidence=classification.confidence,
        provenance_completeness=ledger.completeness_pct,
        divergence_explained=divergence.explained if divergence.material else True,
        reality_gate_pass_rate=reality_gate.pass_rate,
    ))

    confidence_score = confidence_meter["score"] if confidence_meter else 0
    if scenarios is None:
        return NuvosFairValueResult(
            status="insufficient_data",
            classification=classification, earnings_state=earnings_state, growth_quality=growth_quality,
            fair_pe=fair_pe_result, peg=peg, pegy=pegy, fcf_quality=fcf_quality_result,
            reality_gate=reality_gate, divergence=divergence, confidence_meter=confidence_meter,
            uncertainty_profile=uncertainty_profile, provenance=ledger,
            insufficient_data_reason="No hay un EPS normalizado ni reportado positivo disponible — no se puede construir un Fair Value confiable.",
        )
    if not reality_gate.overall_pass or confidence_score < min_confidence_score:
        failed = "; ".join(c.detail for c in reality_gate.failed_checks) if not reality_gate.overall_pass else ""
        reason = failed or f"Confianza calculada ({confidence_score}) por debajo del mínimo requerido ({min_confidence_score:.0f})."
        return NuvosFairValueResult(
            status="insufficient_data",
            classification=classification, earnings_state=earnings_state, growth_quality=growth_quality,
            fair_pe=fair_pe_result, peg=peg, pegy=pegy, fcf_quality=fcf_quality_result,
            scenarios=scenarios, reality_gate=reality_gate, divergence=divergence,
            confidence_meter=confidence_meter, uncertainty_profile=uncertainty_profile, provenance=ledger,
            insufficient_data_reason=reason,
        )

    # Phase 4 (2026-08-13) — purely advisory "does this look economically
    # strange?" flags, never suppresses or changes the Fair Value above.
    # GQV has no DCF/terminal-value or reverse-DCF concept, so those 2
    # checks simply don't fire here (None inputs) — by design, not a gap.
    outlier_flags = asdict(detect_valuation_outliers(
        current_price=current_price,
        fair_value_bear=scenarios.bear.fair_value_per_share, fair_value_base=scenarios.base.fair_value_per_share,
        fair_value_bull=scenarios.bull.fair_value_per_share,
        avg_roic_pct=avg_roic_pct, industry_median_roic_pct=industry_median_roic_pct,
        implied_multiple=fair_pe_result.fair_pe if fair_pe_result else None,
        historical_median_pe=historical_median_pe, peer_median_pe=peer_median_pe,
    ))

    return NuvosFairValueResult(
        status="ok",
        classification=classification, earnings_state=earnings_state, growth_quality=growth_quality,
        fair_pe=fair_pe_result, peg=peg, pegy=pegy, fcf_quality=fcf_quality_result,
        scenarios=scenarios, reality_gate=reality_gate, divergence=divergence,
        confidence_meter=confidence_meter, uncertainty_profile=uncertainty_profile,
        outlier_flags=outlier_flags, provenance=ledger,
    )


def _industry_category(sector: Optional[str], industry: Optional[str]) -> str:
    from app.services.quality.industry_engine import classify_industry
    return classify_industry(sector, industry)
