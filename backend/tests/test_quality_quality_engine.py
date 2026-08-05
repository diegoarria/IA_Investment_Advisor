"""
Tests — app.services.quality.quality_engine (Fase 2, Incremento 2).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
import pytest

from app.services.quality.quality_engine import (
    compute_roce,
    compute_incremental_roic,
    compute_current_ratio,
    compute_quick_ratio,
    compute_net_debt_to_ebitda,
    compute_cagr_windows,
    compute_quality_score,
)


class TestComputeRoce:
    def test_normal_case(self):
        # EBIT=200, Total Assets=1500, Current Liabilities=300 -> capital employed=1200 -> 16.67%
        assert compute_roce(200.0, 1500.0, 300.0) == pytest.approx(16.7, abs=0.1)

    def test_none_when_any_input_missing(self):
        assert compute_roce(None, 1500.0, 300.0) is None
        assert compute_roce(200.0, None, 300.0) is None
        assert compute_roce(200.0, 1500.0, None) is None

    def test_none_when_capital_employed_non_positive(self):
        assert compute_roce(200.0, 300.0, 300.0) is None  # capital employed = 0


class TestComputeIncrementalRoic:
    def test_normal_case(self):
        nopat = [None, 100.0, 150.0]
        invested_capital = [None, 1000.0, 1300.0]
        # (150-100)/(1300-1000) = 50/300 = 16.67%
        assert compute_incremental_roic(nopat, invested_capital) == pytest.approx(16.7, abs=0.1)

    def test_none_with_fewer_than_2_valid_pairs(self):
        assert compute_incremental_roic([100.0], [1000.0]) is None
        assert compute_incremental_roic([], []) is None

    def test_none_when_capital_did_not_grow(self):
        assert compute_incremental_roic([100.0, 150.0], [1000.0, 900.0]) is None
        assert compute_incremental_roic([100.0, 150.0], [1000.0, 1000.0]) is None

    def test_ignores_none_entries_and_uses_first_and_last_valid(self):
        nopat = [None, 100.0, None, 200.0]
        invested_capital = [None, 1000.0, None, 1500.0]
        assert compute_incremental_roic(nopat, invested_capital) == pytest.approx((200 - 100) / (1500 - 1000) * 100, abs=0.1)


class TestComputeCurrentRatio:
    def test_normal_case(self):
        assert compute_current_ratio(300.0, 150.0) == pytest.approx(2.0)

    def test_none_when_missing(self):
        assert compute_current_ratio(None, 150.0) is None
        assert compute_current_ratio(300.0, None) is None

    def test_none_when_liabilities_zero(self):
        assert compute_current_ratio(300.0, 0.0) is None


class TestComputeQuickRatio:
    def test_normal_case(self):
        # (300-100)/150 = 1.33
        assert compute_quick_ratio(300.0, 100.0, 150.0) == pytest.approx(1.33, abs=0.01)

    def test_defaults_inventory_to_zero_when_none(self):
        assert compute_quick_ratio(300.0, None, 150.0) == pytest.approx(2.0)

    def test_none_when_current_assets_or_liabilities_missing(self):
        assert compute_quick_ratio(None, 100.0, 150.0) is None
        assert compute_quick_ratio(300.0, 100.0, None) is None


class TestComputeNetDebtToEbitda:
    def test_normal_case(self):
        assert compute_net_debt_to_ebitda(1000.0, 200.0, 400.0) == pytest.approx(2.0)

    def test_net_cash_position_is_negative(self):
        assert compute_net_debt_to_ebitda(100.0, 500.0, 400.0) == pytest.approx(-1.0)

    def test_none_when_ebitda_non_positive(self):
        assert compute_net_debt_to_ebitda(1000.0, 200.0, 0.0) is None
        assert compute_net_debt_to_ebitda(1000.0, 200.0, -50.0) is None

    def test_none_when_missing_inputs(self):
        assert compute_net_debt_to_ebitda(None, 200.0, 400.0) is None


class TestComputeCagrWindows:
    def test_computes_each_window_independently(self):
        # 11 years, revenue doubling roughly, oldest to newest
        trend = [100 * (1.10 ** i) for i in range(11)]
        windows = compute_cagr_windows(trend, windows=(3, 5, 10))
        assert windows["3y"] == pytest.approx(10.0, abs=0.5)
        assert windows["5y"] == pytest.approx(10.0, abs=0.5)
        assert windows["10y"] == pytest.approx(10.0, abs=0.5)

    def test_returns_none_for_window_longer_than_history(self):
        trend = [100.0, 110.0, 121.0]  # only 3 years
        windows = compute_cagr_windows(trend, windows=(3, 5, 10))
        assert windows["5y"] is None
        assert windows["10y"] is None

    def test_returns_none_when_endpoints_have_none(self):
        trend = [None, 100.0, 110.0, 121.0]
        windows = compute_cagr_windows(trend, windows=(3,))
        assert windows["3y"] is None  # trend[-(3+1)] = trend[0] = None


class TestComputeQualityScore:
    def _strong_inputs(self, **overrides):
        n_years = 10
        kwargs = dict(
            roic_trend=[18.0 + i * 0.3 for i in range(n_years)],
            roe_trend=[20.0 + i * 0.2 for i in range(n_years)],
            roa_trend=[12.0 + i * 0.2 for i in range(n_years)],
            nopat_trend=[100.0 + i * 15 for i in range(n_years)],
            invested_capital_trend=[500.0 + i * 40 for i in range(n_years)],
            operating_income_latest=300.0, total_assets_latest=2000.0,
            current_liabilities_latest=300.0, current_assets_latest=800.0, inventory_latest=100.0,
            gross_margin_trend=[55.0] * n_years, operating_margin_trend=[28.0] * n_years,
            net_margin_trend=[20.0] * n_years, fcf_margin_trend=[22.0] * n_years,
            fcf_trend=[100.0 + i * 12 for i in range(n_years)],
            net_income_trend=[90.0 + i * 10 for i in range(n_years)],
            revenue_trend=[500.0 * (1.12 ** i) for i in range(n_years)],
            eps_trend=[2.0 * (1.10 ** i) for i in range(n_years)],
            total_debt=200.0, cash=600.0, ebitda_latest=400.0,
            interest_coverage=20.0,
        )
        kwargs.update(overrides)
        return kwargs

    def test_strong_company_scores_high(self):
        result = compute_quality_score(**self._strong_inputs())
        assert result.quality_score >= 70

    def test_weak_company_scores_low(self):
        n_years = 10
        result = compute_quality_score(
            roic_trend=[2.0] * n_years, roe_trend=[1.0] * n_years, roa_trend=[0.5] * n_years,
            nopat_trend=[10.0] * n_years, invested_capital_trend=[1000.0] * n_years,
            operating_income_latest=5.0, total_assets_latest=2000.0,
            current_liabilities_latest=900.0, current_assets_latest=400.0, inventory_latest=200.0,
            gross_margin_trend=[8.0] * n_years, operating_margin_trend=[2.0] * n_years,
            net_margin_trend=[0.5] * n_years, fcf_margin_trend=[1.0] * n_years,
            fcf_trend=[5.0] * n_years, net_income_trend=[2.0] * n_years,
            revenue_trend=[500.0] * n_years, eps_trend=[0.05] * n_years,
            total_debt=1800.0, cash=50.0, ebitda_latest=40.0,
            interest_coverage=0.8,
        )
        # Note: this company is flat (zero real growth) but perfectly
        # STABLE at those low levels — the engine deliberately scores
        # level and stability separately (see module docstring), so a
        # weak-but-consistent business isn't scored as low as a
        # weak-and-volatile one. 45 still reflects clearly sub-par
        # profitability/leverage/coverage pulling the blend well below a
        # "good" company's score.
        assert result.quality_score <= 45

    def test_score_bounded_0_100(self):
        result = compute_quality_score(**self._strong_inputs())
        assert 0 <= result.quality_score <= 100

    def test_all_sub_scores_present_with_full_data(self):
        result = compute_quality_score(**self._strong_inputs())
        assert result.profitability_score is not None
        assert result.margins_score is not None
        assert result.cash_flow_score is not None
        assert result.growth_score is not None
        assert result.balance_sheet_score is not None

    def test_every_factor_has_a_real_reason_string(self):
        result = compute_quality_score(**self._strong_inputs())
        assert len(result.factors) > 0
        assert all(f.reason for f in result.factors)

    def test_missing_balance_sheet_data_degrades_gracefully_not_none_score(self):
        kwargs = self._strong_inputs(
            total_assets_latest=None, current_liabilities_latest=None,
            current_assets_latest=None, inventory_latest=None,
            total_debt=None, cash=None, ebitda_latest=None, interest_coverage=None,
        )
        result = compute_quality_score(**kwargs)
        assert result.balance_sheet_score is None  # no balance data at all -> None, honestly
        assert result.quality_score > 0  # but the other 4 pillars still produce a real score

    def test_empty_trends_do_not_crash_and_produce_zero_score(self):
        result = compute_quality_score(
            roic_trend=[], roe_trend=[], roa_trend=[], nopat_trend=[], invested_capital_trend=[],
            operating_income_latest=None, total_assets_latest=None, current_liabilities_latest=None,
            current_assets_latest=None, inventory_latest=None,
            gross_margin_trend=[], operating_margin_trend=[], net_margin_trend=[], fcf_margin_trend=[],
            fcf_trend=[], net_income_trend=[], revenue_trend=[], eps_trend=[],
            total_debt=None, cash=None, ebitda_latest=None,
        )
        assert result.quality_score == 0


class TestHasAnySignal:
    def test_true_when_at_least_one_sub_score_present(self):
        result = compute_quality_score(**TestComputeQualityScore()._strong_inputs())
        assert result.has_any_signal is True

    def test_false_when_every_sub_score_is_none(self):
        result = compute_quality_score(
            roic_trend=[], roe_trend=[], roa_trend=[], nopat_trend=[], invested_capital_trend=[],
            operating_income_latest=None, total_assets_latest=None, current_liabilities_latest=None,
            current_assets_latest=None, inventory_latest=None,
            gross_margin_trend=[], operating_margin_trend=[], net_margin_trend=[], fcf_margin_trend=[],
            fcf_trend=[], net_income_trend=[], revenue_trend=[], eps_trend=[],
            total_debt=None, cash=None, ebitda_latest=None,
        )
        assert result.has_any_signal is False
