"""
Tests — app.services.valuation.monte_carlo_engine (Fase 1, Incremento 3).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
import pytest

from app.services.valuation.monte_carlo_engine import (
    DistributionInput,
    MonteCarloAssumptions,
    run_monte_carlo_dcf,
    build_distribution_from_trend,
    _percentile,
)


def _base_assumptions(**overrides) -> MonteCarloAssumptions:
    kwargs = dict(
        revenue_growth_1=DistributionInput(mean=0.12, stdev=0.03, lo=-0.20, hi=0.60),
        operating_margin=DistributionInput(mean=0.25, stdev=0.02, lo=0.0, hi=0.60),
        discount_rate=DistributionInput(mean=0.09, stdev=0.01, lo=0.04, hi=0.20),
        terminal_growth=DistributionInput(mean=0.025, stdev=0.003, lo=0.01, hi=0.03),
        reinvestment_rate=DistributionInput(mean=0.30, stdev=0.05, lo=-0.5, hi=1.5),
        shares_out=DistributionInput(mean=100.0, stdev=1.0, lo=50.0, hi=150.0),
        tax_rate=0.21,
        terminal_roic_pct=0.15,
        net_cash=500.0,
        revenue_0=10_000.0,
    )
    kwargs.update(overrides)
    return MonteCarloAssumptions(**kwargs)


class TestDistributionInput:
    def test_sample_is_clamped_to_bounds(self):
        import random
        dist = DistributionInput(mean=0.09, stdev=10.0, lo=0.04, hi=0.20)  # huge stdev to force clamping
        rng = random.Random(42)
        samples = [dist.sample(rng) for _ in range(200)]
        assert all(0.04 <= s <= 0.20 for s in samples)

    def test_sample_is_reproducible_with_same_seed(self):
        import random
        dist = DistributionInput(mean=0.09, stdev=0.02, lo=0.0, hi=1.0)
        s1 = dist.sample(random.Random(7))
        s2 = dist.sample(random.Random(7))
        assert s1 == s2


class TestPercentile:
    def test_median_of_odd_length(self):
        assert _percentile([1.0, 2.0, 3.0], 0.5) == 2.0

    def test_min_and_max(self):
        values = [1.0, 5.0, 10.0, 15.0, 20.0]
        assert _percentile(values, 0.0) == 1.0
        assert _percentile(values, 1.0) == 20.0

    def test_single_value(self):
        assert _percentile([42.0], 0.5) == 42.0


class TestRunMonteCarloDcf:
    def test_produces_a_full_distribution_for_a_normal_company(self):
        result = run_monte_carlo_dcf(_base_assumptions(), current_price=100.0, n_simulations=500, seed=42)
        assert result.n_valid > 0
        assert result.min <= result.p10 <= result.p25 <= result.median <= result.p75 <= result.p90 <= result.max

    def test_is_reproducible_with_same_seed(self):
        r1 = run_monte_carlo_dcf(_base_assumptions(), current_price=100.0, n_simulations=300, seed=123)
        r2 = run_monte_carlo_dcf(_base_assumptions(), current_price=100.0, n_simulations=300, seed=123)
        assert r1.median == r2.median
        assert r1.p10 == r2.p10
        assert r1.n_valid == r2.n_valid

    def test_different_seeds_produce_different_results(self):
        r1 = run_monte_carlo_dcf(_base_assumptions(), n_simulations=300, seed=1)
        r2 = run_monte_carlo_dcf(_base_assumptions(), n_simulations=300, seed=2)
        assert r1.median != r2.median

    def test_probability_undervalued_is_none_without_a_price(self):
        result = run_monte_carlo_dcf(_base_assumptions(), current_price=None, n_simulations=200, seed=1)
        assert result.probability_undervalued_pct is None

    def test_probability_undervalued_is_100_when_price_is_absurdly_low(self):
        result = run_monte_carlo_dcf(_base_assumptions(), current_price=0.01, n_simulations=300, seed=1)
        assert result.probability_undervalued_pct == pytest.approx(100.0, abs=1.0)

    def test_probability_undervalued_is_near_zero_when_price_is_absurdly_high(self):
        result = run_monte_carlo_dcf(_base_assumptions(), current_price=1_000_000.0, n_simulations=300, seed=1)
        assert result.probability_undervalued_pct == pytest.approx(0.0, abs=1.0)

    def test_discards_draws_where_sampled_discount_rate_undershoots_terminal_growth(self):
        # force overlapping ranges so some draws WILL produce r <= gt
        assumptions = _base_assumptions(
            discount_rate=DistributionInput(mean=0.025, stdev=0.02, lo=0.005, hi=0.05),
            terminal_growth=DistributionInput(mean=0.025, stdev=0.005, lo=0.01, hi=0.04),
        )
        result = run_monte_carlo_dcf(assumptions, n_simulations=500, seed=1)
        assert result.n_discarded > 0
        assert result.n_valid + result.n_discarded == 500

    def test_returns_empty_result_when_every_draw_is_invalid(self):
        # terminal_roic_pct <= 0 makes every single draw raise ValueError
        assumptions = _base_assumptions(terminal_roic_pct=0.0)
        result = run_monte_carlo_dcf(assumptions, n_simulations=50, seed=1)
        assert result.n_valid == 0
        assert result.n_discarded == 50
        assert result.median is None
        assert result.probability_undervalued_pct is None

    def test_wider_stdev_produces_a_wider_spread(self):
        tight = run_monte_carlo_dcf(
            _base_assumptions(revenue_growth_1=DistributionInput(mean=0.12, stdev=0.005, lo=-0.2, hi=0.6)),
            n_simulations=500, seed=1,
        )
        wide = run_monte_carlo_dcf(
            _base_assumptions(revenue_growth_1=DistributionInput(mean=0.12, stdev=0.08, lo=-0.2, hi=0.6)),
            n_simulations=500, seed=1,
        )
        assert (wide.max - wide.min) > (tight.max - tight.min)


class TestBuildDistributionFromTrend:
    def test_uses_real_historical_stdev_when_enough_data(self):
        trend = [0.20, 0.25, 0.30, 0.22, 0.28]  # real spread, stdev well above the floor
        dist = build_distribution_from_trend(trend, anchor=0.25, lo=0.0, hi=1.0, variable_key="operating_margin")
        assert dist.mean == 0.25
        import statistics as _stats
        assert dist.stdev == pytest.approx(_stats.pstdev(trend), abs=1e-9)

    def test_falls_back_to_floor_when_too_few_data_points(self):
        dist = build_distribution_from_trend([0.25, 0.25], anchor=0.25, lo=0.0, hi=1.0, variable_key="operating_margin")
        assert dist.stdev == 0.02  # the documented floor for operating_margin

    def test_falls_back_to_floor_when_trend_is_flat(self):
        trend = [0.25, 0.25, 0.25, 0.25]  # zero real variance
        dist = build_distribution_from_trend(trend, anchor=0.25, lo=0.0, hi=1.0, variable_key="operating_margin")
        assert dist.stdev == 0.02

    def test_unknown_variable_key_uses_default_floor(self):
        dist = build_distribution_from_trend([1.0, 1.0], anchor=1.0, lo=0.0, hi=2.0, variable_key="not_a_real_key")
        assert dist.stdev == 0.01

    def test_ignores_none_values_in_trend(self):
        trend = [0.20, None, 0.30, None, 0.25]
        dist = build_distribution_from_trend(trend, anchor=0.25, lo=0.0, hi=1.0, variable_key="operating_margin")
        import statistics as _stats
        assert dist.stdev == pytest.approx(_stats.pstdev([0.20, 0.30, 0.25]), abs=1e-9)
