"""
Regression tests — Reverse DCF (fundamental_analysis_service).

Context: pins current behavior of the three reverse-DCF flavors (implied
growth, implied FCF margin at fixed growth, implied constant growth /
Expectations Investing) and the sanity-check wrapper, all solved via
scipy.optimize.brentq. Part of Fase 1, Incremento 1 — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md. These are
genuinely useful today (Parte E of the brief) but currently have zero
frontend exposure and zero tests.
"""
import pytest

from app.services.fundamental_analysis_service import (
    _run_dcf,
    _run_dcf_constant_growth,
    _implied_growth_rate,
    _implied_fcf_margin_at_fixed_growth,
    _implied_constant_growth_rate,
    sanity_check_reverse_dcf,
)


class TestImpliedGrowthRate:
    def test_recovers_the_growth_rate_used_to_build_the_price(self):
        # Build a "target price" from a known growth rate via the forward
        # DCF, then confirm the reverse solver recovers that same rate.
        base_fcf, r, gt = 1000.0, 0.09, 0.025
        total_debt, cash, shares_out = 500.0, 200.0, 100.0
        known_growth = 0.15
        fwd = _run_dcf(base_fcf, known_growth, r, gt)
        target_price = (fwd["enterprise_value"] - total_debt + cash) / shares_out

        implied = _implied_growth_rate(base_fcf, r, gt, total_debt, cash, shares_out, target_price)
        assert implied == pytest.approx(known_growth * 100, abs=0.2)

    def test_returns_none_when_price_implies_growth_outside_search_range(self):
        # An absurdly high target price implies growth > 150%, outside the
        # solver's bracket — must return None, not raise or extrapolate.
        # (EV at growth=150% for these inputs is ~1.2M, so 5M is out of range.)
        implied = _implied_growth_rate(
            base_fcf=1000.0, discount_rate=0.09, terminal_growth=0.025,
            total_debt=0, cash=0, shares_out=1.0, target_price=5_000_000.0,
        )
        assert implied is None

    def test_returns_none_when_price_implies_growth_below_search_floor(self):
        # EV at growth=-30% for these inputs is ~4354, i.e. ~0.0044/share at
        # 1M shares — 0.001 is below that floor, so no root exists in range.
        implied = _implied_growth_rate(
            base_fcf=1000.0, discount_rate=0.09, terminal_growth=0.025,
            total_debt=0, cash=0, shares_out=1_000_000.0, target_price=0.001,
        )
        assert implied is None


class TestImpliedFcfMarginAtFixedGrowth:
    def test_recovers_the_margin_used_to_build_the_price(self):
        revenue, growth_fixed, r, gt = 10_000.0, 0.08, 0.09, 0.025
        total_debt, cash, shares_out = 500.0, 200.0, 100.0
        known_margin = 0.20
        fwd = _run_dcf(revenue * known_margin, growth_fixed, r, gt)
        target_price = (fwd["enterprise_value"] - total_debt + cash) / shares_out

        implied = _implied_fcf_margin_at_fixed_growth(
            revenue, growth_fixed, r, gt, total_debt, cash, shares_out, target_price
        )
        assert implied == pytest.approx(known_margin * 100, abs=0.2)

    def test_returns_none_outside_0_to_60_pct_margin_range(self):
        implied = _implied_fcf_margin_at_fixed_growth(
            revenue=10_000.0, growth_fixed=0.08, discount_rate=0.09, terminal_growth=0.025,
            total_debt=0, cash=0, shares_out=1.0, target_price=1_000_000.0,
        )
        assert implied is None


class TestRunDcfConstantGrowth:
    def test_constant_growth_grows_every_year_at_the_same_rate(self):
        result = _run_dcf_constant_growth(1000.0, growth=0.10, discount_rate=0.09, terminal_growth=0.025, years=5)
        path = result["fcf_path"]
        assert len(path) == 5
        for i in range(1, len(path)):
            assert path[i] / path[i - 1] == pytest.approx(1.10, abs=1e-9)

    def test_differs_from_fading_dcf_when_growth_1_not_equal_terminal(self):
        fading = _run_dcf(1000.0, 0.15, 0.09, 0.025)
        constant = _run_dcf_constant_growth(1000.0, 0.15, 0.09, 0.025)
        assert fading["enterprise_value"] != pytest.approx(constant["enterprise_value"])


class TestImpliedConstantGrowthRate:
    def test_recovers_the_constant_growth_rate_used_to_build_the_price(self):
        base_fcf, r, gt = 1000.0, 0.09, 0.025
        total_debt, cash, shares_out = 500.0, 200.0, 100.0
        known_growth = 0.12
        fwd = _run_dcf_constant_growth(base_fcf, known_growth, r, gt)
        target_price = (fwd["enterprise_value"] - total_debt + cash) / shares_out

        implied = _implied_constant_growth_rate(base_fcf, r, gt, total_debt, cash, shares_out, target_price)
        assert implied == pytest.approx(known_growth * 100, abs=0.2)

    def test_returns_none_when_out_of_range(self):
        # EV at growth=150% (constant, not fading) is ~70.7M for these
        # inputs — 100M is out of range.
        implied = _implied_constant_growth_rate(
            base_fcf=1000.0, discount_rate=0.09, terminal_growth=0.025,
            total_debt=0, cash=0, shares_out=1.0, target_price=100_000_000.0,
        )
        assert implied is None


class TestSanityCheckReverseDcf:
    def test_flags_regime_change_when_implied_more_than_double_historical(self):
        result = sanity_check_reverse_dcf(implied_growth_pct=30.0, fcf_base=1000.0, historical_fcf_cagr_pct=10.0)
        assert result["regime_change_flag"] is True
        assert result["vs_cagr_historico_propio"] == "mayor"

    def test_does_not_flag_when_implied_close_to_historical(self):
        result = sanity_check_reverse_dcf(implied_growth_pct=11.0, fcf_base=1000.0, historical_fcf_cagr_pct=10.0)
        assert result["regime_change_flag"] is False
        assert result["vs_cagr_historico_propio"] == "similar"

    def test_flags_menor_when_implied_well_below_historical(self):
        result = sanity_check_reverse_dcf(implied_growth_pct=5.0, fcf_base=1000.0, historical_fcf_cagr_pct=10.0)
        assert result["vs_cagr_historico_propio"] == "menor"

    def test_returns_none_when_missing_inputs(self):
        assert sanity_check_reverse_dcf(None, 1000.0, 10.0) is None
        assert sanity_check_reverse_dcf(10.0, 1000.0, None) is None

    def test_handles_zero_or_negative_historical_cagr(self):
        result = sanity_check_reverse_dcf(implied_growth_pct=10.0, fcf_base=1000.0, historical_fcf_cagr_pct=-5.0)
        assert result["vs_cagr_historico_propio"] == "mayor"
        assert result["regime_change_flag"] is False
