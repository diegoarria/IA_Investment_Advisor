"""
Tests — app.services.valuation.nuvos_engine.engine (orchestrator).

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md. Integration-
level: exercises the real Block 1/Block 2 modules together (no mocking of
this package's own internals), pinning the 3 real code paths verified
manually during development (a clean Stalwart-like company, a negative-
EPS/short-history company, and financial-sector routing).
"""
from app.services.quality.deterioration_engine import compute_deterioration_signals
from app.services.quality.moat_engine import compute_moat_score
from app.services.valuation.nuvos_engine.classification import LynchCategory
from app.services.valuation.nuvos_engine.engine import compute_nuvos_fair_value


def _stalwart_fixture_kwargs(**overrides):
    revenue_trend = [80, 85, 90, 96, 102, 108, 114, 120, 127, 134]
    eps_trend = [2.0, 2.15, 2.3, 2.5, 2.65, 2.8, 3.0, 3.15, 3.3, 3.5]
    net_margin_trend = [10, 10.2, 10.1, 10.4, 10.3, 10.5, 10.6, 10.5, 10.7, 10.8]
    fcf_trend = [7, 7.5, 8, 8.6, 9, 9.6, 10.2, 10.7, 11.3, 12]
    net_income_trend = [8, 8.6, 9.2, 10, 10.6, 11.2, 12, 12.6, 13.2, 14]
    implied_shares_trend = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91]
    roic_trend = [14, 14.2, 14, 14.5, 14.3, 14.6, 14.7, 14.5, 14.8, 15]
    om_trend = [15, 15.1, 15, 15.3, 15.2, 15.4, 15.5, 15.4, 15.6, 15.7]

    moat = compute_moat_score(
        avg_roic_pct=14.5, roic_trend=roic_trend, avg_operating_margin_pct=15.3,
        operating_margin_trend=om_trend, gross_margin_latest_pct=40.0,
        industry_median_roic_pct=11.0, industry_median_operating_margin_pct=13.0,
    )
    det = compute_deterioration_signals(
        roic_trend=roic_trend, operating_margin_trend=om_trend, net_margin_trend=net_margin_trend,
        fcf_margin_trend=[f / r * 100 for f, r in zip(fcf_trend, revenue_trend)], revenue_trend=revenue_trend,
    )

    kwargs = dict(
        sector="Technology", industry="Software", is_financial_sector=False,
        current_price=50.0, latest_eps=3.5, eps_trend=eps_trend, revenue_trend=revenue_trend,
        net_margin_trend=net_margin_trend, fcf_trend=fcf_trend, net_income_trend=net_income_trend,
        implied_shares_trend=implied_shares_trend, deterioration_result=det, moat_result=moat,
        management_score=70.0, avg_roic_pct=14.5, cost_of_capital_pct=9.0,
        net_debt_to_ebitda=1.0, interest_coverage=12.0, dividend_yield_pct=0.5,
        industry_median_roic_pct=11.0, expected_eps_growth_pct=9.0, forward_pe=18.0,
        historical_median_pe=20.0, peer_median_pe=19.0,
        financials_response={"provider": "fmp", "fetchedAt": "2026-08-10T00:00:00Z"},
        years_available=10, liquidity_ok=True, business_quality_score=75.0, financial_strength_score=80.0,
        financial_statement_quality_score=100.0, management_consistency_score=70.0,
    )
    kwargs.update(overrides)
    return kwargs


def _empty_trend_moat_and_deterioration():
    trend = [None, None]
    moat = compute_moat_score(
        avg_roic_pct=None, roic_trend=trend, avg_operating_margin_pct=None,
        operating_margin_trend=trend, gross_margin_latest_pct=None,
        industry_median_roic_pct=None, industry_median_operating_margin_pct=None,
    )
    det = compute_deterioration_signals(
        roic_trend=trend, operating_margin_trend=trend, net_margin_trend=[-10, -4],
        fcf_margin_trend=trend, revenue_trend=[10, 12],
    )
    return moat, det


class TestCleanStalwartCompany:
    def test_status_is_ok_with_a_real_scenario_set(self):
        result = compute_nuvos_fair_value(**_stalwart_fixture_kwargs())
        assert result.status == "ok"
        assert result.scenarios is not None
        assert result.scenarios.base.fair_value_per_share > 0
        assert result.classification.category == LynchCategory.STALWART

    def test_reality_gate_passes_on_clean_data(self):
        result = compute_nuvos_fair_value(**_stalwart_fixture_kwargs())
        assert result.reality_gate.overall_pass is True

    def test_confidence_meter_is_populated(self):
        result = compute_nuvos_fair_value(**_stalwart_fixture_kwargs())
        assert result.confidence_meter is not None
        assert 0 <= result.confidence_meter["score"] <= 100


class TestNegativeEpsShortHistory:
    def test_returns_insufficient_data_never_a_fabricated_number(self):
        moat, det = _empty_trend_moat_and_deterioration()
        result = compute_nuvos_fair_value(
            sector="Technology", industry="Software", is_financial_sector=False,
            current_price=10.0, latest_eps=-0.5, eps_trend=[-1.0, -0.5], revenue_trend=[10, 12],
            net_margin_trend=[-10, -4], fcf_trend=[-2, -1], net_income_trend=[-1.2, -0.6],
            implied_shares_trend=[50, 52], deterioration_result=det, moat_result=moat,
            management_score=None, avg_roic_pct=None, cost_of_capital_pct=None,
            net_debt_to_ebitda=None, interest_coverage=None, dividend_yield_pct=None,
            industry_median_roic_pct=None, expected_eps_growth_pct=None, forward_pe=None,
            years_available=2, liquidity_ok=True,
        )
        assert result.status == "insufficient_data"
        assert result.insufficient_data_reason is not None
        assert result.scenarios is None


class TestFinancialSectorRouting:
    def test_routes_out_immediately_without_running_the_gqv_framework(self):
        moat, det = _empty_trend_moat_and_deterioration()
        result = compute_nuvos_fair_value(
            sector="Financial Services", industry="Banks", is_financial_sector=True,
            current_price=10.0, latest_eps=1.0, eps_trend=[1, 1, 1], revenue_trend=[1, 1, 1],
            net_margin_trend=[1, 1, 1], fcf_trend=[1, 1, 1], net_income_trend=[1, 1, 1],
            implied_shares_trend=[1, 1, 1], deterioration_result=det, moat_result=moat,
            management_score=None, avg_roic_pct=None, cost_of_capital_pct=None,
            net_debt_to_ebitda=None, interest_coverage=None, dividend_yield_pct=None,
            industry_median_roic_pct=None, expected_eps_growth_pct=None, forward_pe=None,
            years_available=2, liquidity_ok=True,
        )
        assert result.status == "financial_sector"
        assert result.classification is None
        assert result.scenarios is None


class TestConfidenceThreshold:
    def test_below_min_confidence_returns_insufficient_data_even_with_a_real_scenario_set(self):
        result = compute_nuvos_fair_value(**_stalwart_fixture_kwargs(min_confidence_score=99.0))
        assert result.status == "insufficient_data"
        assert result.scenarios is not None  # computed, just withheld as the headline number
