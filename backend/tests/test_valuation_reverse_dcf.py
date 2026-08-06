"""
Regression tests — Reverse DCF (app.services.valuation.reverse_dcf_engine).

Context: pins current behavior of the three reverse-DCF flavors (implied
growth, implied FCF margin at fixed growth, implied constant growth /
Expectations Investing) and the sanity-check wrapper, all solved via
scipy.optimize.brentq. Part of Fase 1, Incremento 1 — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md.

Fase 1.5, Incremento 3: `_implied_growth_rate` and
`_implied_fcf_margin_at_fixed_growth` now solve against the driver-based
DCF (`dcf_engine.project_driver_based_dcf`) instead of the legacy one —
tests below build their "known value" target prices with the SAME driver-
based engine, not `_run_dcf`, so they pin the real current behavior rather
than a stale legacy-shaped expectation. `_implied_constant_growth_rate`
still uses the standalone constant-growth annuity formula (see
reverse_dcf_engine.py's module docstring for why) — its tests are
unchanged.
"""
import pytest

from app.services.valuation.dcf_engine import project_driver_based_dcf
from app.services.fundamental_analysis_service import (
    _run_dcf,
    _run_dcf_constant_growth,
    _implied_growth_rate,
    _implied_fcf_margin_at_fixed_growth,
    _implied_constant_growth_rate,
    sanity_check_reverse_dcf,
)

_DRIVER_KWARGS = dict(
    revenue_0=10_000.0,
    operating_margin_anchor_pct=0.25,
    terminal_operating_margin_pct=0.25,
    tax_rate=0.21,
    reinvestment_rate_anchor_pct=0.30,
    terminal_roic_pct=0.15,
    discount_rate=0.09,
    terminal_growth=0.025,
    net_cash=-300.0,
    shares_out=100.0,
)


class TestImpliedGrowthRate:
    def test_recovers_the_growth_rate_used_to_build_the_price(self):
        # Build a "target price" from a known growth rate via the SAME
        # driver-based forward DCF, then confirm the reverse solver
        # recovers that same rate.
        known_growth = 0.15
        fwd = project_driver_based_dcf(revenue_growth_1=known_growth, **_DRIVER_KWARGS)
        target_price = fwd.value_per_share

        implied = _implied_growth_rate(
            revenue_0=_DRIVER_KWARGS["revenue_0"],
            operating_margin_anchor_pct=_DRIVER_KWARGS["operating_margin_anchor_pct"],
            terminal_operating_margin_pct=_DRIVER_KWARGS["terminal_operating_margin_pct"],
            tax_rate=_DRIVER_KWARGS["tax_rate"],
            reinvestment_rate_anchor_pct=_DRIVER_KWARGS["reinvestment_rate_anchor_pct"],
            terminal_roic_pct=_DRIVER_KWARGS["terminal_roic_pct"],
            discount_rate=_DRIVER_KWARGS["discount_rate"],
            terminal_growth=_DRIVER_KWARGS["terminal_growth"],
            net_cash=_DRIVER_KWARGS["net_cash"],
            shares_out=_DRIVER_KWARGS["shares_out"],
            target_price=target_price,
        )
        assert implied == pytest.approx(known_growth * 100, abs=0.2)

    def test_returns_none_when_price_implies_growth_outside_search_range(self):
        # An absurdly high target price implies growth > 150%, outside the
        # solver's bracket — must return None, not raise or extrapolate.
        implied = _implied_growth_rate(
            revenue_0=1_000.0, operating_margin_anchor_pct=0.25, terminal_operating_margin_pct=0.25,
            tax_rate=0.21, reinvestment_rate_anchor_pct=0.30, terminal_roic_pct=0.15,
            discount_rate=0.09, terminal_growth=0.025, net_cash=0.0, shares_out=1.0,
            target_price=5_000_000.0,
        )
        assert implied is None

    def test_returns_none_when_price_implies_growth_below_search_floor(self):
        # value_per_share at growth=-30% (the solver's floor) for these
        # inputs is 0.0 — a negative target price is below even that.
        implied = _implied_growth_rate(
            revenue_0=1_000.0, operating_margin_anchor_pct=0.25, terminal_operating_margin_pct=0.25,
            tax_rate=0.21, reinvestment_rate_anchor_pct=0.30, terminal_roic_pct=0.15,
            discount_rate=0.09, terminal_growth=0.025, net_cash=0.0, shares_out=1_000_000.0,
            target_price=-1.0,
        )
        assert implied is None

    def test_high_growth_years_is_propagated_and_changes_the_result(self):
        known_growth = 0.15
        fwd = project_driver_based_dcf(revenue_growth_1=known_growth, high_growth_years=3, **_DRIVER_KWARGS)
        target_price = fwd.value_per_share

        # Solving WITHOUT telling the reverse solver about the plateau
        # should NOT recover the same growth rate — proves high_growth_years
        # genuinely participates in the solved model, not ignored.
        implied_no_plateau = _implied_growth_rate(
            revenue_0=_DRIVER_KWARGS["revenue_0"],
            operating_margin_anchor_pct=_DRIVER_KWARGS["operating_margin_anchor_pct"],
            terminal_operating_margin_pct=_DRIVER_KWARGS["terminal_operating_margin_pct"],
            tax_rate=_DRIVER_KWARGS["tax_rate"],
            reinvestment_rate_anchor_pct=_DRIVER_KWARGS["reinvestment_rate_anchor_pct"],
            terminal_roic_pct=_DRIVER_KWARGS["terminal_roic_pct"],
            discount_rate=_DRIVER_KWARGS["discount_rate"],
            terminal_growth=_DRIVER_KWARGS["terminal_growth"],
            net_cash=_DRIVER_KWARGS["net_cash"],
            shares_out=_DRIVER_KWARGS["shares_out"],
            target_price=target_price,
            high_growth_years=0,
        )
        assert implied_no_plateau != pytest.approx(known_growth * 100, abs=0.2)


class TestImpliedFcfMarginAtFixedGrowth:
    def test_recovers_a_margin_that_reproduces_the_target_price(self):
        growth_fixed = 0.08
        known_reinvestment_rate = 0.35
        fwd = project_driver_based_dcf(
            revenue_growth_1=growth_fixed, reinvestment_rate_anchor_pct=known_reinvestment_rate,
            **{k: v for k, v in _DRIVER_KWARGS.items() if k != "reinvestment_rate_anchor_pct"},
        )
        target_price = fwd.value_per_share
        expected_margin_pct = round(fwd.yearly[0].fcf / fwd.yearly[0].revenue * 100, 1)

        implied = _implied_fcf_margin_at_fixed_growth(
            revenue_0=_DRIVER_KWARGS["revenue_0"],
            growth_fixed=growth_fixed,
            operating_margin_anchor_pct=_DRIVER_KWARGS["operating_margin_anchor_pct"],
            terminal_operating_margin_pct=_DRIVER_KWARGS["terminal_operating_margin_pct"],
            tax_rate=_DRIVER_KWARGS["tax_rate"],
            terminal_roic_pct=_DRIVER_KWARGS["terminal_roic_pct"],
            discount_rate=_DRIVER_KWARGS["discount_rate"],
            terminal_growth=_DRIVER_KWARGS["terminal_growth"],
            net_cash=_DRIVER_KWARGS["net_cash"],
            shares_out=_DRIVER_KWARGS["shares_out"],
            target_price=target_price,
        )
        assert implied == pytest.approx(expected_margin_pct, abs=0.3)

    def test_returns_none_outside_search_range(self):
        implied = _implied_fcf_margin_at_fixed_growth(
            revenue_0=10_000.0, growth_fixed=0.08, operating_margin_anchor_pct=0.25,
            terminal_operating_margin_pct=0.25, tax_rate=0.21, terminal_roic_pct=0.15,
            discount_rate=0.09, terminal_growth=0.025, net_cash=0.0, shares_out=1.0,
            target_price=1_000_000.0,
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
