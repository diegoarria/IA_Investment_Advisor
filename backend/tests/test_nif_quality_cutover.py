"""
Integration test — NIF business_quality pillar cutover (Fase 2, Incremento 3),
the Moat Engine sibling key (Fase 2, Incremento 7), and the
management_quality pillar cutover (Fase 2, Incremento 8).

Context: verifies `nif_service.build_nif_dashboard`'s `business_quality`
pillar now sources its `score` from the real, independent Quality Engine
(`quality_engine.build_quality_score_from_analysis`) instead of
`fundamental_analysis_service`'s older `thesis_scores["business_quality"]`
formula, end-to-end, with the frontend-facing `nuvos_estimate` keys
(`roic_score`, `operating_margin_score`, etc.) still populated for
backward compatibility. Also verifies the dashboard's `moat` sibling key
(deterministic score + AI deep dive), and the `management_quality`
pillar's cutover to the Management Engine (capital allocation + insider
alignment blend + AI deep dive), are wired in. Mocks every network
boundary (get_financials/fh_quote/fh_profile/check_liquidity_gate/get_beta/
get_risk_free_rate/fh_price_target/get_revenue_segments — same as
test_valuation_engine_integration.py — plus insider data, industry
benchmarks, capital allocation, and the 5 parallel AI/evidence calls this
function makes) so the whole async orchestration actually runs, with zero
real network calls.
"""
from unittest.mock import patch

import pytest

from types import SimpleNamespace

from app.services.nif_service import build_nif_dashboard
from tests.test_quality_integration import _build_synthetic_financials_with_balance_sheet_detail

_FAKE_CAPITAL_ALLOCATION_RESULT = SimpleNamespace(capital_allocation_score=65.0)


@pytest.mark.asyncio
async def test_business_quality_pillar_uses_the_new_quality_engine_score():
    fin = _build_synthetic_financials_with_balance_sheet_detail()
    with patch("app.services.fundamental_analysis_service.get_financials", return_value=fin), \
         patch("app.services.fundamental_analysis_service.fh_quote", return_value={"price": 100.0}), \
         patch("app.services.fundamental_analysis_service.fh_profile", return_value={
             "finnhubIndustry": "Technology", "shareOutstanding": 100.0,
         }), \
         patch("app.services.fundamental_analysis_service.check_liquidity_gate", return_value={
             "paso": True, "avg_volume_30d": 1_000_000, "free_float_pct": 80.0, "analyst_coverage": 10, "detalle": "OK",
         }), \
         patch("app.services.fundamental_analysis_service.get_beta", return_value=1.1), \
         patch("app.services.fundamental_analysis_service.get_risk_free_rate", return_value=0.04), \
         patch("app.services.fundamental_analysis_service.fh_price_target", return_value=None), \
         patch("app.services.fundamental_analysis_service.get_revenue_segments", return_value=[]), \
         patch("app.services.nif_service.fh_insider_transactions", return_value=None), \
         patch("app.services.nif_service.fh_insider_sentiment", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_business_quality_explanation", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_management_quality_explanation", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_quick_valuation_summary", return_value={"checklist_reasons": {}}), \
         patch("app.services.nif_service.compute_industry_benchmarks", return_value=None), \
         patch("app.services.nif_service.compute_moat_deep_dive", return_value=None), \
         patch("app.services.nif_service.compute_capital_allocation_score", return_value=_FAKE_CAPITAL_ALLOCATION_RESULT), \
         patch("app.services.nif_service.compute_management_deep_dive", return_value=None), \
         patch("app.services.nif_service.compute_catalysts", return_value=None):
        dashboard = await build_nif_dashboard("SYNNIF1")

    assert dashboard is not None
    bq_pillar = dashboard["pillars"]["business_quality"]

    # The pillar's headline score is now the Quality Engine's real,
    # independent 0-100 score (never None for this profitable synthetic
    # company — has_any_signal must be True).
    assert bq_pillar["score"] is not None
    assert 0 <= bq_pillar["score"] <= 100
    assert bq_pillar["nuvos_estimate"]["composite_score"] == bq_pillar["score"]

    # Backward-compatible keys the frontend's buildNifRows already reads
    # are still populated (not silently dropped by the cutover).
    estimate = bq_pillar["nuvos_estimate"]
    assert estimate["roic_score"] is not None
    assert estimate["operating_margin_score"] is not None
    assert estimate["growth_score"] is not None

    # New, richer breakdown is additive and present.
    assert estimate["profitability_score"] is not None
    assert estimate["balance_sheet_score"] is not None
    assert len(estimate["factors"]) > 10

    # Overall NIF score still blends business_quality in — the cutover
    # didn't silently disconnect it from compute_overall_nif_score.
    assert dashboard["overall_nif_score"] is not None

    # Fase 2, Incremento 7: Moat Engine's deterministic score is a SIBLING
    # key, not folded into overall_nif_score's weighted blend.
    moat = dashboard["moat"]
    assert 0 <= moat["score"] <= 100
    assert len(moat["factors"]) > 0
    assert moat["deep_dive"] is None  # mocked to None above — degrades cleanly, doesn't break the dashboard

    # Fase 2, Incremento 8: management_quality's score is now the
    # Management Engine's real, independent blend (capital allocation +
    # insider alignment) instead of the old thesis formula.
    mgmt_pillar = dashboard["pillars"]["management_quality"]
    assert mgmt_pillar["score"] is not None
    assert 0 <= mgmt_pillar["score"] <= 100
    assert mgmt_pillar["nuvos_estimate"]["capital_allocation_score"] == 65.0
    assert len(mgmt_pillar["nuvos_estimate"]["factors"]) == 3
    assert mgmt_pillar["deep_dive"] is None  # mocked to None above — degrades cleanly

    # Fase 2, Incremento 9: Conviction Engine's deterministic score is a
    # SIBLING key (same placement as Moat), synthesizing quality/moat/
    # stability/beta — never touches price/valuation.
    conviction = dashboard["conviction"]
    assert 0 <= conviction["score"] <= 100
    assert len(conviction["factors"]) == 4

    # Fase 2, Incremento 9: Catalysts Engine degrades cleanly to None when
    # there's no real segment data or evidence (mocked to None above).
    assert dashboard["catalysts"] is None


@pytest.mark.asyncio
async def test_moat_deep_dive_is_included_when_available():
    fin = _build_synthetic_financials_with_balance_sheet_detail()
    fake_deep_dive = {"moat_types": [{"type": "brand", "intensity": "media", "evidence": "e", "explanation": "x", "risks": "r"}]}
    with patch("app.services.fundamental_analysis_service.get_financials", return_value=fin), \
         patch("app.services.fundamental_analysis_service.fh_quote", return_value={"price": 100.0}), \
         patch("app.services.fundamental_analysis_service.fh_profile", return_value={
             "finnhubIndustry": "Technology", "shareOutstanding": 100.0,
         }), \
         patch("app.services.fundamental_analysis_service.check_liquidity_gate", return_value={
             "paso": True, "avg_volume_30d": 1_000_000, "free_float_pct": 80.0, "analyst_coverage": 10, "detalle": "OK",
         }), \
         patch("app.services.fundamental_analysis_service.get_beta", return_value=1.1), \
         patch("app.services.fundamental_analysis_service.get_risk_free_rate", return_value=0.04), \
         patch("app.services.fundamental_analysis_service.fh_price_target", return_value=None), \
         patch("app.services.fundamental_analysis_service.get_revenue_segments", return_value=[]), \
         patch("app.services.nif_service.fh_insider_transactions", return_value=None), \
         patch("app.services.nif_service.fh_insider_sentiment", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_business_quality_explanation", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_management_quality_explanation", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_quick_valuation_summary", return_value={"checklist_reasons": {}}), \
         patch("app.services.nif_service.compute_industry_benchmarks", return_value=None), \
         patch("app.services.nif_service.compute_moat_deep_dive", return_value=fake_deep_dive), \
         patch("app.services.nif_service.compute_capital_allocation_score", return_value=_FAKE_CAPITAL_ALLOCATION_RESULT), \
         patch("app.services.nif_service.compute_management_deep_dive", return_value=None), \
         patch("app.services.nif_service.compute_catalysts", return_value=None):
        dashboard = await build_nif_dashboard("SYNNIF2")

    assert dashboard["moat"]["deep_dive"] == fake_deep_dive


@pytest.mark.asyncio
async def test_management_deep_dive_is_included_when_available():
    fin = _build_synthetic_financials_with_balance_sheet_detail()
    fake_deep_dive = {
        "guidance_track_record": "Cumplió guidance en los últimos 4 trimestres según la evidencia citada.",
        "governance_flags": [], "overall_assessment": "Track record consistente.",
    }
    with patch("app.services.fundamental_analysis_service.get_financials", return_value=fin), \
         patch("app.services.fundamental_analysis_service.fh_quote", return_value={"price": 100.0}), \
         patch("app.services.fundamental_analysis_service.fh_profile", return_value={
             "finnhubIndustry": "Technology", "shareOutstanding": 100.0,
         }), \
         patch("app.services.fundamental_analysis_service.check_liquidity_gate", return_value={
             "paso": True, "avg_volume_30d": 1_000_000, "free_float_pct": 80.0, "analyst_coverage": 10, "detalle": "OK",
         }), \
         patch("app.services.fundamental_analysis_service.get_beta", return_value=1.1), \
         patch("app.services.fundamental_analysis_service.get_risk_free_rate", return_value=0.04), \
         patch("app.services.fundamental_analysis_service.fh_price_target", return_value=None), \
         patch("app.services.fundamental_analysis_service.get_revenue_segments", return_value=[]), \
         patch("app.services.nif_service.fh_insider_transactions", return_value=None), \
         patch("app.services.nif_service.fh_insider_sentiment", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_business_quality_explanation", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_management_quality_explanation", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_quick_valuation_summary", return_value={"checklist_reasons": {}}), \
         patch("app.services.nif_service.compute_industry_benchmarks", return_value=None), \
         patch("app.services.nif_service.compute_moat_deep_dive", return_value=None), \
         patch("app.services.nif_service.compute_capital_allocation_score", return_value=_FAKE_CAPITAL_ALLOCATION_RESULT), \
         patch("app.services.nif_service.compute_management_deep_dive", return_value=fake_deep_dive), \
         patch("app.services.nif_service.compute_catalysts", return_value=None):
        dashboard = await build_nif_dashboard("SYNNIF3")

    assert dashboard["pillars"]["management_quality"]["deep_dive"] == fake_deep_dive


@pytest.mark.asyncio
async def test_catalysts_are_included_when_available():
    fin = _build_synthetic_financials_with_balance_sheet_detail()
    fake_catalysts = {"catalysts": [
        {"catalyst": "c", "type": "producto", "evidence": "e", "time_horizon": "corto_plazo", "impact_if_realized": "i"},
    ]}
    with patch("app.services.fundamental_analysis_service.get_financials", return_value=fin), \
         patch("app.services.fundamental_analysis_service.fh_quote", return_value={"price": 100.0}), \
         patch("app.services.fundamental_analysis_service.fh_profile", return_value={
             "finnhubIndustry": "Technology", "shareOutstanding": 100.0,
         }), \
         patch("app.services.fundamental_analysis_service.check_liquidity_gate", return_value={
             "paso": True, "avg_volume_30d": 1_000_000, "free_float_pct": 80.0, "analyst_coverage": 10, "detalle": "OK",
         }), \
         patch("app.services.fundamental_analysis_service.get_beta", return_value=1.1), \
         patch("app.services.fundamental_analysis_service.get_risk_free_rate", return_value=0.04), \
         patch("app.services.fundamental_analysis_service.fh_price_target", return_value=None), \
         patch("app.services.fundamental_analysis_service.get_revenue_segments", return_value=[]), \
         patch("app.services.nif_service.fh_insider_transactions", return_value=None), \
         patch("app.services.nif_service.fh_insider_sentiment", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_business_quality_explanation", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_management_quality_explanation", return_value=None), \
         patch("app.services.nif_service.ai_service.generate_quick_valuation_summary", return_value={"checklist_reasons": {}}), \
         patch("app.services.nif_service.compute_industry_benchmarks", return_value=None), \
         patch("app.services.nif_service.compute_moat_deep_dive", return_value=None), \
         patch("app.services.nif_service.compute_capital_allocation_score", return_value=_FAKE_CAPITAL_ALLOCATION_RESULT), \
         patch("app.services.nif_service.compute_management_deep_dive", return_value=None), \
         patch("app.services.nif_service.compute_catalysts", return_value=fake_catalysts):
        dashboard = await build_nif_dashboard("SYNNIF4")

    assert dashboard["catalysts"] == fake_catalysts
