"""
Integration test — Quality Engine wiring (Fase 2, Incremento 2).

Context: verifies the exact field-extraction logic used in
`screener.py::_build_quick_analysis` (roic_trend, nopat_trend,
invested_capital_trend, total_assets_trend, etc. — all real keys on
`get_fundamental_analysis()`'s return dict) actually lines up, by running
`get_fundamental_analysis()` end-to-end against synthetic-but-internally-
consistent financials (same technique as
test_valuation_engine_integration.py) and then replicating the screener's
own extraction + `compute_quality_score` call. A full mock of
`_build_quick_analysis` itself (async, pulls in ai_service,
undervalued_screener_service, UNIVERSE-based peer lookups) is out of scope
here — this targets exactly the risk that matters: did every dict key the
Quality Engine wiring reads actually get produced by
`fundamental_analysis_service.py`.
"""
from unittest.mock import patch

from app.services.fundamental_analysis_service import get_fundamental_analysis
from app.services.quality.quality_engine import compute_quality_score


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
    dcf = data["dcf"]

    # Exact same extraction logic as screener.py::_build_quick_analysis
    def latest_of(key):
        trend = data.get(key) or []
        return next((v for v in reversed(trend) if v is not None), None)

    fcf_trend = data.get("fcf_trend") or []
    revenue_trend = data.get("revenue_trend") or []
    fcf_margin_trend = [
        round(f / r * 100, 1) if f is not None and r else None for f, r in zip(fcf_trend, revenue_trend)
    ]
    latest_om = latest_of("operating_margin_trend")
    latest_rev = latest_of("revenue_trend")
    operating_income_latest = (latest_om / 100 * latest_rev) if latest_om is not None and latest_rev else None

    result = compute_quality_score(
        roic_trend=data.get("roic_trend") or [], roe_trend=data.get("roe_trend") or [], roa_trend=data.get("roa_trend") or [],
        nopat_trend=data.get("nopat_trend") or [], invested_capital_trend=data.get("invested_capital_trend") or [],
        operating_income_latest=operating_income_latest,
        total_assets_latest=latest_of("total_assets_trend"),
        current_liabilities_latest=latest_of("current_liabilities_trend"),
        current_assets_latest=latest_of("current_assets_trend"),
        inventory_latest=latest_of("inventory_trend"),
        gross_margin_trend=data.get("gross_margin_trend") or [], operating_margin_trend=data.get("operating_margin_trend") or [],
        net_margin_trend=data.get("net_margin_trend") or [], fcf_margin_trend=fcf_margin_trend,
        fcf_trend=fcf_trend, net_income_trend=data.get("net_income_trend") or [],
        revenue_trend=revenue_trend, eps_trend=data.get("eps_trend") or [],
        total_debt=dcf.get("total_debt"), cash=dcf.get("cash"), ebitda_latest=data.get("ebitda"),
        interest_coverage=data.get("interest_coverage"),
    )

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
