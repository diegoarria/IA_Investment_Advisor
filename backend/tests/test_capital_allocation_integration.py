"""
Integration test — Capital Allocation Engine wiring (Fase 2, Incremento 4).

Context: verifies the exact field-extraction logic used in
`screener.py::_build_quick_analysis` (implied_shares_trend,
fiscal_period_dates, dividends_paid_trend, reinvestment_rate_trend, and
the buyback_rate_pct/payout_ratio_pct sourced from
checklist_evidence["management_capital_allocation"]) actually lines up
with real keys on `get_fundamental_analysis()`'s return dict, by running
it end-to-end against synthetic-but-internally-consistent financials with
a real declining share count and growing dividend (same technique as
test_quality_integration.py).
"""
from unittest.mock import patch

from app.services.fundamental_analysis_service import get_fundamental_analysis
from app.services.quality.capital_allocation_engine import compute_capital_allocation_score
from tests.test_quality_integration import _build_synthetic_financials_with_balance_sheet_detail


def _build_financials_with_buybacks_and_dividends(years: int = 10):
    """Extends the Quality Engine's synthetic fixture with a real,
    gradually-declining diluted share count (simulated via a shrinking
    Diluted EPS denominator effect is NOT how implied_shares_trend is
    derived — it's Net Income / Diluted EPS — so a buyback is simulated by
    holding Net Income growth below Diluted EPS growth) and a real growing
    dividend."""
    fin = _build_synthetic_financials_with_balance_sheet_detail(years=years)
    income = fin["incomeStatement"]["annual"]
    cashflow = fin["cashFlow"]["annual"]
    shares_start = 100_000_000.0
    for i, (inc, cf) in enumerate(zip(income, cashflow)):
        # Real declining share count: 1.5%/year buyback
        shares_i = shares_start * (0.985 ** i)
        inc["Diluted EPS"] = inc["Net Income"] / shares_i
        cf["Dividends Paid"] = -(inc["Net Income"] * 0.15 * (1.05 ** i))  # growing dividend, no cuts
    return fin


def test_capital_allocation_wiring_extracts_real_fields():
    fin = _build_financials_with_buybacks_and_dividends()
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
        data = get_fundamental_analysis("SYNCA1")

    assert data is not None
    assert data.get("implied_shares_trend")
    assert data.get("fiscal_period_dates")
    assert data.get("dividends_paid_trend")
    assert data.get("reinvestment_rate_trend")

    mgmt_evidence = (data.get("checklist_evidence") or {}).get("management_capital_allocation") or {}
    payout_ratio_pct = mgmt_evidence.get("payout_ratio_pct")

    with patch(
        "app.services.financial_data_service.get_historical_prices_near_dates",
        return_value={d: 60.0 for d in data["fiscal_period_dates"] if d},
    ):
        result = compute_capital_allocation_score(
            ticker="SYNCA1", current_price=data.get("current_price"),
            implied_shares_trend=data["implied_shares_trend"],
            fiscal_period_dates=data["fiscal_period_dates"],
            dividends_paid_trend=data["dividends_paid_trend"],
            reinvestment_rate_trend=data["reinvestment_rate_trend"],
            buyback_rate_pct=mgmt_evidence.get("buyback_rate_pct"),
            payout_ratio=(payout_ratio_pct / 100) if payout_ratio_pct is not None else None,
        )

    # Real declining share count -> real buyback years detected.
    assert len(result.buyback_years) > 0
    # No dividend cuts were simulated -> consistency score should reflect that.
    assert result.dividend_consistency_score is not None
    assert result.dividend_consistency_score >= 80
    assert 0 <= result.capital_allocation_score <= 100
    assert result.has_any_signal is True
