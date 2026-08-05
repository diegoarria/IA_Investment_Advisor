"""
Integration test — NIF business_quality pillar cutover (Fase 2, Incremento 3).

Context: verifies `nif_service.build_nif_dashboard`'s `business_quality`
pillar now sources its `score` from the real, independent Quality Engine
(`quality_engine.build_quality_score_from_analysis`) instead of
`fundamental_analysis_service`'s older `thesis_scores["business_quality"]`
formula, end-to-end, with the frontend-facing `nuvos_estimate` keys
(`roic_score`, `operating_margin_score`, etc.) still populated for
backward compatibility. Mocks every network boundary
(get_financials/fh_quote/fh_profile/check_liquidity_gate/get_beta/
get_risk_free_rate/fh_price_target/get_revenue_segments — same as
test_valuation_engine_integration.py — plus insider data and the 3 AI
narration calls this function makes) so the whole async orchestration
actually runs.
"""
from unittest.mock import patch

import pytest

from app.services.nif_service import build_nif_dashboard
from tests.test_quality_integration import _build_synthetic_financials_with_balance_sheet_detail


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
         patch("app.services.nif_service.ai_service.generate_quick_valuation_summary", return_value={"checklist_reasons": {}}):
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
