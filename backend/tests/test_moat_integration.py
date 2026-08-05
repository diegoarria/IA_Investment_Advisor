"""
Integration test — Moat Engine (deterministic score) wiring
(Fase 2, Incremento 7).

Context: verifies the exact field-extraction logic used in
`screener.py::_build_quick_analysis` for the deterministic Moat Score
(avg_roic_pct via dcf.growth_buildup, roic_trend, operating_margin_trend,
gross_margin_trend) actually lines up with real keys on
`get_fundamental_analysis()`'s return dict, by running it end-to-end
against synthetic-but-internally-consistent financials (same technique as
test_quality_integration.py).
"""
from unittest.mock import patch

from app.services.fundamental_analysis_service import get_fundamental_analysis
from app.services.quality.moat_engine import compute_moat_score
from tests.test_quality_integration import _build_synthetic_financials_with_balance_sheet_detail


def test_moat_score_wiring_extracts_real_fields():
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
         patch("app.services.fundamental_analysis_service.get_revenue_segments", return_value=[]):
        data = get_fundamental_analysis("SYNM1")

    assert data is not None
    dcf = data["dcf"]
    growth_buildup = dcf.get("growth_buildup") or {}
    op_margin_trend = data.get("operating_margin_trend") or []
    op_margin_valid = [v for v in op_margin_trend if v is not None]
    avg_operating_margin_pct = round(sum(op_margin_valid) / len(op_margin_valid), 1) if op_margin_valid else None
    gross_margin_trend = data.get("gross_margin_trend") or []
    gross_margin_latest_pct = next((v for v in reversed(gross_margin_trend) if v is not None), None)

    result = compute_moat_score(
        avg_roic_pct=growth_buildup.get("avg_roic_pct"), roic_trend=data.get("roic_trend") or [],
        avg_operating_margin_pct=avg_operating_margin_pct, operating_margin_trend=op_margin_trend,
        gross_margin_latest_pct=gross_margin_latest_pct,
        # No real peer group in this test (no UNIVERSE mock) — degrades
        # gracefully to the stability/gross-margin-only factors, which is
        # itself part of what this test verifies (no crash, real partial score).
        industry_median_roic_pct=None, industry_median_operating_margin_pct=None,
    )

    assert result.has_any_signal is True
    assert 0 <= result.moat_score <= 100
    assert result.stability_score is not None
