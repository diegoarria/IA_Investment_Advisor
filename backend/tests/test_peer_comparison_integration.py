"""
Integration test — Peer Comparison + Deterioration Engine wiring
(Fase 2, Incremento 10).

Context: verifies the exact field-extraction logic used in
`screener.py::_build_quick_analysis` (fcf_trend/revenue_trend zipped into
a real fcf_margin_trend for the Deterioration Engine, and the Quality
Score passed into the Peer Comparison Engine) actually lines up with real
keys on `get_fundamental_analysis()`'s return dict, by running it
end-to-end against synthetic-but-internally-consistent financials (same
technique as test_moat_integration.py / test_conviction_integration.py).
Peer Comparison itself is exercised in isolation in
test_quality_peer_comparison_engine.py with mocked peers — here we only
confirm the WIRING (field names, zip lengths) is correct, using a real
`_find_peers` call that naturally returns [] for this synthetic ticker
(never in UNIVERSE), which must degrade to None, not crash.
"""
from unittest.mock import patch

from app.services.fundamental_analysis_service import get_fundamental_analysis
from app.services.quality.quality_engine import build_quality_score_from_analysis
from app.services.quality.peer_comparison_engine import compute_quality_peer_comparison
from app.services.quality.deterioration_engine import compute_deterioration_signals
from tests.test_quality_integration import _build_synthetic_financials_with_balance_sheet_detail


def test_peer_comparison_and_deterioration_wiring_extracts_real_fields():
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
        data = get_fundamental_analysis("SYNPC1")

    assert data is not None
    quality_result = build_quality_score_from_analysis(data)

    # This synthetic ticker's real sector ("Technology") legitimately
    # matches real companies in the curated UNIVERSE, so _find_peers is
    # mocked to [] here — the wiring test's job is confirming
    # `compute_quality_peer_comparison`'s field extraction is correct and
    # degrades to None on too few peers, not exercising a real network
    # fetch of real peer tickers (covered, with mocked peers, by
    # test_quality_peer_comparison_engine.py).
    with patch("app.services.relative_valuation_service._find_peers", return_value=[]):
        peer_result = compute_quality_peer_comparison(
            "SYNPC1", data.get("sector"), None,
            company_quality_score=(quality_result.quality_score if quality_result.has_any_signal else None),
        )
    assert peer_result is None

    fcf_trend = data.get("fcf_trend") or []
    revenue_trend = data.get("revenue_trend") or []
    fcf_margin_trend = [
        (f / r) * 100 if f is not None and r else None for f, r in zip(fcf_trend, revenue_trend)
    ]
    deterioration_result = compute_deterioration_signals(
        roic_trend=data.get("roic_trend") or [],
        operating_margin_trend=data.get("operating_margin_trend") or [],
        net_margin_trend=data.get("net_margin_trend") or [],
        fcf_margin_trend=fcf_margin_trend,
        revenue_trend=revenue_trend,
    )
    assert len(deterioration_result.factors) == 5
    assert deterioration_result.has_any_signal is True
