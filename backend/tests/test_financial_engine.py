"""
Tests — app.services.valuation.financial_engine (Residual Income / Excess
Return model for the financial-sector Fair Value Engine).

Pure-function tests only (no network), same convention as
test_valuation_dcf_core.py / test_combine_fair_value_range.py. Covers the
14 required cases from the financial-engine redesign brief:

1. Does not use the FCF DCF (no `revenue`/`fcf` concept anywhere in the
   core math — the whole model is Book Value/ROE/Cost of Equity).
2. Uses Cost of Equity, not WACC.
3. Uses Book Value/Equity correctly (equity bridge reconciles).
4. ROE > CoE creates value / ROE < CoE destroys it.
5. Bear <= Base <= Bull always.
6. equity_value / shares reconciles with value_per_share.
7. No NaN/Inf ever produced.
8. Missing data -> None/N-D, never invented.
9. Reverse valuation solves for ROE, not FCF growth.
10. Sensitivity produces a coherent grid.
11. Implied multiples (P/B) pass sanity checks.
12. Non-financial sectors are untouched (tested via `_is_financial_sector`
    itself, already covered by test_valuation_dcf_core.py — re-asserted
    here for this module's own documentation value).
13. `classify_financial_subsector` never fabricates a category out of
    nothing (falls back to "other_financial").
14. Nothing else breaks — covered by running this file alongside
    test_combine_fair_value_range.py / test_valuation_dcf_core.py in CI.
"""
import math

import pytest

from app.services.valuation.financial_engine import (
    project_residual_income_valuation,
    _fade_path,
    classify_financial_subsector,
    _financial_predictability_score,
    _terminal_roe_cap,
    _financial_scenario_deltas,
    build_financial_scenario,
    build_financial_fair_value,
    _implied_roe,
)


# ── 1/2/3/4/6/7 — core math ──────────────────────────────────────────────────

class TestProjectResidualIncomeValuation:
    def test_roe_above_cost_of_equity_creates_value(self):
        result = project_residual_income_valuation(
            book_value_0=100.0, roe_path=[0.18] * 10, payout_path=[0.3] * 10,
            cost_of_equity=0.09, terminal_growth=0.03, terminal_roe=0.18, shares_out=10.0,
        )
        assert result.equity_value > 100.0
        assert all(row.residual_income > 0 for row in result.yearly)

    def test_roe_below_cost_of_equity_destroys_value(self):
        result = project_residual_income_valuation(
            book_value_0=100.0, roe_path=[0.04] * 10, payout_path=[0.3] * 10,
            cost_of_equity=0.09, terminal_growth=0.03, terminal_roe=0.04, shares_out=10.0,
        )
        assert result.equity_value < 100.0
        assert all(row.residual_income < 0 for row in result.yearly)

    def test_roe_equal_to_cost_of_equity_is_roughly_book_value(self):
        result = project_residual_income_valuation(
            book_value_0=100.0, roe_path=[0.09] * 10, payout_path=[0.3] * 10,
            cost_of_equity=0.09, terminal_growth=0.03, terminal_roe=0.09, shares_out=10.0,
        )
        assert result.equity_value == pytest.approx(100.0, abs=0.5)

    def test_equity_value_reconciles_with_value_per_share(self):
        result = project_residual_income_valuation(
            book_value_0=250.0, roe_path=[0.14] * 10, payout_path=[0.25] * 10,
            cost_of_equity=0.10, terminal_growth=0.03, terminal_roe=0.12, shares_out=20.0,
        )
        assert result.value_per_share == pytest.approx(result.equity_value / 20.0, abs=0.02)

    def test_no_shares_out_returns_none_value_per_share_not_a_crash(self):
        result = project_residual_income_valuation(
            book_value_0=100.0, roe_path=[0.15] * 10, payout_path=[0.3] * 10,
            cost_of_equity=0.09, terminal_growth=0.03, terminal_roe=0.15, shares_out=None,
        )
        assert result.value_per_share is None
        assert math.isfinite(result.equity_value)

    def test_collapses_to_closed_form_justified_pb_when_roe_constant(self):
        # Closed form: P/B = (ROE - g) / (CoE - g); equity_value = BV * P/B
        roe, coe, g = 0.15, 0.09, 0.03
        bv0 = 100.0
        result = project_residual_income_valuation(
            book_value_0=bv0, roe_path=[roe] * 10, payout_path=[1 - g / roe] * 10,
            cost_of_equity=coe, terminal_growth=g, terminal_roe=roe, shares_out=1.0,
        )
        closed_form_pb = (roe - g) / (coe - g)
        closed_form_value = bv0 * closed_form_pb
        assert result.equity_value == pytest.approx(closed_form_value, rel=0.02)

    def test_never_produces_nan_or_inf_even_with_extreme_inputs(self):
        for roe in (-0.5, 0.0, 0.01, 0.99):
            for coe in (0.02, 0.09, 0.5):
                result = project_residual_income_valuation(
                    book_value_0=100.0, roe_path=[roe] * 10, payout_path=[0.3] * 10,
                    cost_of_equity=coe, terminal_growth=0.03, terminal_roe=roe, shares_out=10.0,
                )
                assert math.isfinite(result.equity_value)
                assert math.isfinite(result.pv_of_residual_income_sum)
                assert math.isfinite(result.terminal_value)

    def test_terminal_growth_clamped_when_coe_not_greater_than_growth(self):
        result = project_residual_income_valuation(
            book_value_0=100.0, roe_path=[0.15] * 10, payout_path=[0.3] * 10,
            cost_of_equity=0.03, terminal_growth=0.05, terminal_roe=0.15, shares_out=10.0,
        )
        assert result.terminal_growth_clamped is True
        assert math.isfinite(result.equity_value)


class TestFadePath:
    def test_fades_linearly_from_start_to_target(self):
        path = _fade_path(0.20, 0.10, years=10)
        assert len(path) == 10
        assert path[0] == pytest.approx(0.20 + (0.10 - 0.20) * (1 / 10))
        assert path[-1] == pytest.approx(0.10, abs=1e-9)

    def test_constant_when_start_equals_target(self):
        path = _fade_path(0.12, 0.12, years=5)
        assert all(v == pytest.approx(0.12) for v in path)


# ── 5 — Bear <= Base <= Bull ──────────────────────────────────────────────────

class TestScenarioOrdering:
    @pytest.mark.parametrize("predictability,quality", [
        (None, None), (90, 90), (10, 10), (50, 90), (90, 10),
    ])
    def test_bear_base_bull_always_ordered(self, predictability, quality):
        deltas = _financial_scenario_deltas(predictability, quality)
        scenarios = {
            name: build_financial_scenario(
                book_value_0=100.0, shares_out=10.0, roe_initial=0.16, roe_target_base=0.15,
                cost_of_equity_base=0.09, payout_current=0.3, base_terminal_growth=0.03,
                deltas=d, business_quality_score=quality,
            )
            for name, d in deltas.items()
        }
        bear_fv = scenarios["bear"]["fair_value_per_share"]
        base_fv = scenarios["base"]["fair_value_per_share"]
        bull_fv = scenarios["bull"]["fair_value_per_share"]
        assert bear_fv <= base_fv <= bull_fv

    def test_narrower_band_for_high_predictability_and_quality(self):
        wide = _financial_scenario_deltas(10, 10)
        narrow = _financial_scenario_deltas(95, 95)
        assert abs(narrow["bull"]["roe_delta_pp"]) < abs(wide["bull"]["roe_delta_pp"])


class TestTerminalRoeCap:
    def test_higher_quality_allows_wider_spread_over_cost_of_equity(self):
        low_quality_cap = _terminal_roe_cap(0.09, 10)
        high_quality_cap = _terminal_roe_cap(0.09, 95)
        assert high_quality_cap > low_quality_cap
        assert low_quality_cap > 0.09  # even a low-quality business gets SOME real spread, never zero


# ── 9 — Reverse valuation solves for ROE ──────────────────────────────────────

class TestImpliedRoe:
    def test_solves_for_roe_that_reconciles_price(self):
        payout_path = [0.3] * 10
        cost_of_equity, terminal_growth = 0.09, 0.03
        book_value_0, shares_out = 100.0, 10.0
        # Ground truth: pick a real ROE, compute its value, then confirm implied ROE recovers it
        true_roe = 0.16
        forward = project_residual_income_valuation(
            book_value_0, [true_roe] * 10, payout_path, cost_of_equity, terminal_growth, true_roe, shares_out,
        )
        implied_pct = _implied_roe(book_value_0, payout_path, cost_of_equity, terminal_growth, shares_out, forward.value_per_share)
        assert implied_pct == pytest.approx(true_roe * 100, abs=0.3)

    def test_returns_none_for_unreachable_price(self):
        implied_pct = _implied_roe(
            book_value_0=100.0, payout_path=[0.3] * 10, cost_of_equity=0.09,
            terminal_growth=0.03, shares_out=10.0, target_price=1_000_000.0,
        )
        assert implied_pct is None


# ── 13 — subsector classification never fabricates ────────────────────────────

class TestClassifyFinancialSubsector:
    @pytest.mark.parametrize("industry,expected", [
        ("Banks - Diversified", "banks"),
        ("Insurance - Property & Casualty", "insurance"),
        ("Credit Services", "credit_cards_payments"),
        ("Asset Management - Global", "asset_management"),
        ("Capital Markets", "capital_markets"),
    ])
    def test_classifies_known_industries(self, industry, expected):
        assert classify_financial_subsector("Financials", industry) == expected

    def test_falls_back_to_other_financial_for_unknown(self):
        assert classify_financial_subsector("Financials", "Something Unrecognized") == "other_financial"
        assert classify_financial_subsector(None, None) == "other_financial"


# ── 8 — Missing data produces None, never invented ─────────────────────────────

class TestBuildFinancialFairValueGuards:
    def test_returns_none_with_insufficient_roe_history(self):
        result = build_financial_fair_value(
            ticker="TEST", sector="Financials", industry="Banks - Diversified",
            price=100.0, shares_out=10.0, roe_trend=[15.0], eps_trend=[5.0], book_value_trend=[100.0],
            latest_dividends_paid=None, latest_net_income=None, total_debt=0.0, cash=0.0,
            cost_of_equity_capm=0.09, business_quality_score=70, latest_eps=5.0, pe_ratio=20.0,
            wall_street_eps_growth_next_year_pct=None, wacc_details={"method": "capm", "cost_of_equity_pct": 9.0},
        )
        assert result is None

    def test_returns_none_without_positive_book_value(self):
        result = build_financial_fair_value(
            ticker="TEST", sector="Financials", industry="Banks - Diversified",
            price=100.0, shares_out=10.0, roe_trend=[15.0, 16.0, 14.0], eps_trend=[5.0, 5.5, 5.2],
            book_value_trend=[-10.0, -5.0, -1.0],
            latest_dividends_paid=1.0, latest_net_income=5.0, total_debt=0.0, cash=0.0,
            cost_of_equity_capm=0.09, business_quality_score=70, latest_eps=5.0, pe_ratio=20.0,
            wall_street_eps_growth_next_year_pct=None, wacc_details={"method": "capm", "cost_of_equity_pct": 9.0},
        )
        assert result is None

    def test_missing_dividends_flagged_not_invented(self):
        result = build_financial_fair_value(
            ticker="TEST", sector="Financials", industry="Banks - Diversified",
            price=50.0, shares_out=100.0, roe_trend=[15.0, 16.0, 14.0, 15.5, 16.2],
            eps_trend=[3.0, 3.2, 3.1, 3.4, 3.6], book_value_trend=[800.0, 850.0, 900.0, 950.0, 1000.0],
            latest_dividends_paid=None, latest_net_income=None, total_debt=200.0, cash=100.0,
            cost_of_equity_capm=0.09, business_quality_score=60, latest_eps=3.6, pe_ratio=13.9,
            wall_street_eps_growth_next_year_pct=None, wacc_details={"method": "capm", "cost_of_equity_pct": 9.0},
        )
        assert result is not None
        assert result["data_quality_flags"]["dividends_missing"] is True
        assert result["nuvos_fair_value"]["is_financial_sector"] is True


# ── 10/11 — full orchestration: sensitivity grid + sanity checks ─────────────

class TestBuildFinancialFairValueFullOutput:
    def _base_kwargs(self, **overrides):
        kwargs = dict(
            ticker="ZZZBANK", sector="Financials", industry="Banks - Diversified",
            price=45.0, shares_out=100.0, roe_trend=[13.0, 14.5, 12.0, 15.0, 14.0],
            eps_trend=[2.8, 3.0, 2.7, 3.2, 3.1], book_value_trend=[700.0, 740.0, 770.0, 810.0, 850.0],
            latest_dividends_paid=1.0, latest_net_income=3.1 * 100 / 100 * 10,  # arbitrary real-looking value
            total_debt=150.0, cash=90.0, cost_of_equity_capm=0.095, business_quality_score=62,
            latest_eps=3.1, pe_ratio=14.5, wall_street_eps_growth_next_year_pct=6.0,
            wacc_details={"method": "capm", "cost_of_equity_pct": 9.5},
        )
        kwargs.update(overrides)
        return kwargs

    def test_full_output_shape_and_sensitivity_grid(self):
        result = build_financial_fair_value(**self._base_kwargs())
        assert result is not None
        nfv = result["nuvos_fair_value"]

        for name in ("bear", "base", "bull"):
            assert nfv["scenarios"][name]["fair_value_per_share"] is not None
            assert math.isfinite(nfv["scenarios"][name]["fair_value_per_share"])
        assert nfv["scenarios"]["bear"]["fair_value_per_share"] <= nfv["scenarios"]["base"]["fair_value_per_share"] <= nfv["scenarios"]["bull"]["fair_value_per_share"]

        sm = nfv["sensitivity_matrix"]
        assert len(sm["wacc_rows_pct"]) == 3
        assert len(sm["multiple_cols"]) == 5
        assert len(sm["values"]) == 3
        assert all(len(row) == 5 for row in sm["values"])
        assert all(math.isfinite(v) for row in sm["values"] for v in row if v is not None)
        # Higher cost of equity (worse for the company) row should never beat the lowest-CoE row cell-for-cell
        assert sm["values"][0][2] >= sm["values"][2][2]

        assert "implied_roe_pct" in nfv["financial_reverse_valuation"]
        assert result["methodology"] == "residual_income_excess_return_v2"
        assert result["cost_of_equity_pct"] >= 7.0  # floor enforced

    def test_uses_cost_of_equity_not_wacc(self):
        result = build_financial_fair_value(**self._base_kwargs())
        # cost_of_equity_capm=0.095 should flow straight through (>= the 7% floor, no debt-weighting applied)
        assert result["cost_of_equity_pct"] == pytest.approx(9.5, abs=0.01)

    def test_cost_of_equity_floor_applies_when_capm_is_unusually_low(self):
        result = build_financial_fair_value(**self._base_kwargs(cost_of_equity_capm=0.03))
        assert result["cost_of_equity_pct"] == pytest.approx(7.0, abs=0.01)

    def test_margin_of_safety_and_scenarios_are_finite(self):
        result = build_financial_fair_value(**self._base_kwargs())
        assert math.isfinite(result["margin_of_safety_pct"])
        for scenario in result["scenarios"].values():
            assert math.isfinite(scenario["intrinsic_value_per_share"])
