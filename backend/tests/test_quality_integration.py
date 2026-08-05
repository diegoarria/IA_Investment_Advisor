"""
Integration test — Quality Engine wiring (Fase 2, Incrementos 2-3).

Context: verifies `quality_engine.build_quality_score_from_analysis` (the
shared field-extraction helper both `screener.py::_build_quick_analysis`
and `nif_service.py::build_nif_dashboard` call — see Incremento 3) actually
lines up against real keys on `get_fundamental_analysis()`'s return dict,
by running it end-to-end against synthetic-but-internally-consistent
financials (same technique as test_valuation_engine_integration.py). A
full mock of `_build_quick_analysis`/`build_nif_dashboard` themselves
(async, pull in ai_service, undervalued_screener_service, UNIVERSE-based
peer lookups) is out of scope here — this targets exactly the risk that
matters: did every dict key the Quality Engine wiring reads actually get
produced by `fundamental_analysis_service.py`.
"""
from unittest.mock import patch

from app.services.fundamental_analysis_service import get_fundamental_analysis
from app.services.quality.quality_engine import build_quality_score_from_analysis


def _build_synthetic_financials_with_balance_sheet_detail(years: int = 10, revenue_0: float = 10_000_000_000.0, growth: float = 0.10):
    """Same generator as test_valuation_engine_integration.py's, extended
    with Current Assets/Current Liabilities/Inventory — the 3 new balance-
    sheet fields the Quality Engine needs that the Fase 1 fixture didn't
    populate (they were irrelevant to the DCF)."""
    income, balance, cashflow = [], [], []
    for i in range(years):
        period = f"{2015 + i}-12-31"
        revenue = revenue_0 * ((1 + growth) ** i)
        operating_income = revenue * 0.25
        pretax_income = operating_income * 0.95
        tax_provision = pretax_income * 0.21
        net_income = pretax_income - tax_provision
        shares = 100_000_000
        diluted_eps = net_income / shares

        da = revenue * 0.05
        capex = -(revenue * 0.08)
        ocf = net_income + da * 1.1
        working_capital = revenue * 0.10
        current_assets = revenue * 0.30
        current_liabilities = revenue * 0.18
        inventory = revenue * 0.05

        income.append({
            "period": period, "Total Revenue": revenue, "Gross Profit": revenue * 0.55,
            "Operating Income": operating_income, "Net Income": net_income, "Diluted EPS": diluted_eps,
            "Pretax Income": pretax_income, "Tax Provision": tax_provision, "Interest Expense": revenue * 0.01,
        })
        balance.append({
            "Stockholders Equity": revenue * 0.6, "Total Assets": revenue * 1.8,
            "Long Term Debt": revenue * 0.25, "Short Term Debt": revenue * 0.02,
            "Cash And Short Term Investments": revenue * 0.15, "Working Capital": working_capital,
            "Current Assets": current_assets, "Current Liabilities": current_liabilities, "Inventory": inventory,
        })
        cashflow.append({
            "Operating Cash Flow": ocf, "Capital Expenditure": capex,
            "Depreciation And Amortization": da, "Dividends Paid": -(net_income * 0.2),
        })

    return {
        "incomeStatement": {"annual": income}, "balanceSheet": {"annual": balance},
        "cashFlow": {"annual": cashflow}, "provider": "synthetic-test",
    }


def test_quality_engine_wiring_extracts_real_fields_and_produces_a_sane_score():
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
        data = get_fundamental_analysis("SYNQ1")

    assert data is not None

    # Fase 2, Incremento 3: both screener.py and nif_service.py now call
    # this exact shared helper — no more duplicated field-extraction logic.
    result = build_quality_score_from_analysis(data)

    # This synthetic company is real (25% operating margin, low leverage,
    # steady 10% growth, positive FCF) — every pillar should be computable,
    # not None, and the overall score should land in a healthy range.
    assert result.profitability_score is not None
    assert result.margins_score is not None
    assert result.cash_flow_score is not None
    assert result.growth_score is not None
    assert result.balance_sheet_score is not None
    assert 50 <= result.quality_score <= 100
    assert len(result.factors) > 10
