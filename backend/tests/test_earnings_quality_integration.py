"""
Integration test — Earnings Quality Engine wiring (Fase 2, Incremento 5).

Context: verifies the exact field-extraction logic used in
`screener.py::_build_quick_analysis` (sbc_latest, data_validation, margin/
FCF/net-income trends, years, revenue_cagr_pct/fcf_cagr_pct) actually lines
up with real keys on `get_fundamental_analysis()`'s return dict, by running
it end-to-end against synthetic-but-internally-consistent financials with
a real, non-trivial Stock Based Compensation figure (same technique as
test_quality_integration.py).
"""
from unittest.mock import patch

from app.services.fundamental_analysis_service import get_fundamental_analysis
from app.services.quality.earnings_quality_engine import compute_earnings_quality
from tests.test_quality_integration import _build_synthetic_financials_with_balance_sheet_detail


def _build_financials_with_sbc(years: int = 10):
    fin = _build_synthetic_financials_with_balance_sheet_detail(years=years)
    for cf, inc in zip(fin["cashFlow"]["annual"], fin["incomeStatement"]["annual"]):
        cf["Stock Based Compensation"] = inc["Net Income"] * 0.08  # a real, moderate SBC figure
    return fin


def test_earnings_quality_wiring_extracts_real_fields():
    fin = _build_financials_with_sbc()
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
        data = get_fundamental_analysis("SYNEQ1")

    assert data is not None
    assert data.get("sbc_latest") is not None
    assert data.get("sbc_latest") > 0

    fcf_trend = data.get("fcf_trend") or []
    revenue_trend = data.get("revenue_trend") or []
    result = compute_earnings_quality(
        sbc_latest=data.get("sbc_latest"),
        revenue_latest=(revenue_trend[-1] if revenue_trend else None),
        fcf_latest=(fcf_trend[-1] if fcf_trend else None),
        data_validation=data.get("data_validation"),
        gross_margin_trend=data.get("gross_margin_trend") or [], operating_margin_trend=data.get("operating_margin_trend") or [],
        net_margin_trend=data.get("net_margin_trend") or [],
        fcf_trend=fcf_trend, net_income_trend=data.get("net_income_trend") or [],
        years=data.get("years") or [],
        revenue_cagr_pct=data.get("revenue_cagr_pct"), fcf_cagr_pct=data.get("fcf_cagr_pct"),
    )

    # This synthetic company has clean, stable margins and a real (but
    # moderate) SBC figure — should produce real ratios and no false alerts.
    assert result.sbc_to_revenue_pct is not None
    assert result.sbc_to_revenue_pct > 0
    assert result.sbc_to_fcf_pct is not None
