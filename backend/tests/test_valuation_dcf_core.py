"""
Regression tests — DCF core math (fundamental_analysis_service).

Context: this pins the CURRENT behavior of the core valuation primitives
(_run_dcf, _project_path, _calc_wacc, the sector lookup tables, and the
small numeric helpers) before any refactor of the valuation engine begins
(see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md — Fase 1,
Incremento 1). There were zero tests over any of this ~2,200-line engine
before this file. Nothing here should change behavior; it exists purely
as the regression safety net that makes the later incremental refactor
(Incremento 2: driver-based DCF) safe to do.
"""
import math

import pytest

from app.services.fundamental_analysis_service import (
    _run_dcf,
    _project_path,
    _calc_wacc,
    _sector_discount_rate,
    _sector_terminal_growth,
    _sector_cyclicality_dampener,
    _is_financial_sector,
    _num,
    _cagr,
    _score,
    _coefficient_of_variation,
    _confidence_score,
    calc_margin_of_safety,
    _DEFAULT_DISCOUNT_RATE,
    _DEFAULT_TERMINAL_GROWTH,
    _DEFAULT_CYCLICALITY_DAMPENER,
)
from app.services.valuation.numeric_helpers import derive_fcf, split_maintenance_growth_capex, combine_cash_and_long_term_investments


# ── _project_path ──────────────────────────────────────────────────────────

class TestProjectPath:
    def test_fades_linearly_from_growth_1_to_terminal_growth(self):
        # the fade formula is g(yr) = growth_1 + (terminal_growth - growth_1) * (yr/years),
        # so even "year 1" already includes one fade step (yr/years = 1/10) —
        # pinned against the exact formula. Uses a large base value since
        # _project_path rounds each year to the nearest whole unit, which
        # would otherwise dominate the error at a base of ~100.
        path = _project_path(1_000_000.0, growth_1=0.20, terminal_growth=0.02, years=10)
        assert len(path) == 10
        g_year1 = path[0] / 1_000_000.0 - 1
        expected_g_year1 = 0.20 + (0.02 - 0.20) * (1 / 10)
        assert g_year1 == pytest.approx(expected_g_year1, abs=0.0001)
        g_year10 = path[9] / path[8] - 1
        assert g_year10 == pytest.approx(0.02, abs=0.01)

    def test_constant_growth_when_growth_1_equals_terminal(self):
        path = _project_path(100.0, growth_1=0.05, terminal_growth=0.05, years=5)
        expected = 100.0
        for v in path:
            expected *= 1.05
            assert v == pytest.approx(round(expected, 0), abs=1)

    def test_negative_growth_does_not_throw(self):
        path = _project_path(100.0, growth_1=-0.10, terminal_growth=0.02, years=10)
        assert len(path) == 10
        assert all(math.isfinite(v) for v in path)


# ── _run_dcf ────────────────────────────────────────────────────────────────

class TestRunDcf:
    def test_normal_case_produces_positive_finite_values(self):
        result = _run_dcf(base_fcf=1000.0, growth_1=0.10, discount_rate=0.09, terminal_growth=0.03)
        assert result["pv_of_fcf_sum"] > 0
        assert result["pv_of_terminal_value"] > 0
        assert result["enterprise_value"] == pytest.approx(
            result["pv_of_fcf_sum"] + result["pv_of_terminal_value"]
        )
        assert math.isfinite(result["enterprise_value"])

    def test_terminal_value_dominates_enterprise_value(self):
        # documented in the module: terminal value is typically 60-70%+ of EV
        result = _run_dcf(base_fcf=1000.0, growth_1=0.08, discount_rate=0.09, terminal_growth=0.025)
        terminal_share = result["pv_of_terminal_value"] / result["enterprise_value"]
        assert terminal_share > 0.5

    def test_higher_discount_rate_reduces_enterprise_value(self):
        low_r = _run_dcf(1000.0, 0.08, 0.08, 0.025)
        high_r = _run_dcf(1000.0, 0.08, 0.14, 0.025)
        assert high_r["enterprise_value"] < low_r["enterprise_value"]

    def test_discount_rate_equal_to_terminal_growth_raises(self):
        # CURRENT (unguarded) behavior: r == gt divides by zero in the Gordon
        # growth formula and Python raises ZeroDivisionError (not inf, since
        # these are plain floats). This is the exact gap Incremento 1's
        # robustness module documents — pinned here so a later increment's
        # guarded version has a clear "before" to diff against.
        with pytest.raises(ZeroDivisionError):
            _run_dcf(1000.0, 0.08, 0.03, 0.03)

    def test_discount_rate_below_terminal_growth_yields_negative_terminal_value(self):
        # Also currently unguarded — economically nonsensical (gt >= r) but
        # does not raise today. Pinned as documentation of current behavior.
        result = _run_dcf(1000.0, 0.08, 0.02, 0.03)
        assert result["terminal_value"] < 0


# ── _calc_wacc ──────────────────────────────────────────────────────────────

class TestCalcWacc:
    def test_falls_back_to_sector_rate_when_beta_missing(self):
        wacc, meta = _calc_wacc(
            beta=None, risk_free_rate=0.04, market_cap=1e9, total_debt=0,
            interest_expense=0, tax_rate=0.21, sector="Technology",
        )
        assert wacc == _sector_discount_rate("Technology")
        assert meta["method"] == "sector_fallback (beta o tasa libre de riesgo no disponibles)"

    def test_falls_back_to_sector_rate_when_market_cap_missing(self):
        wacc, meta = _calc_wacc(
            beta=1.1, risk_free_rate=0.04, market_cap=0,
            total_debt=0, interest_expense=0, tax_rate=0.21, sector=None,
        )
        assert wacc == _DEFAULT_DISCOUNT_RATE

    def test_capm_with_no_debt_uses_risk_free_plus_spread_for_cost_of_debt(self):
        wacc, meta = _calc_wacc(
            beta=1.0, risk_free_rate=0.04, market_cap=1e9,
            total_debt=0, interest_expense=0, tax_rate=0.21, sector="Technology",
        )
        assert meta["method"] == "capm"
        # cost_of_equity = 0.04 + 1.0*0.046 = 0.086; with zero debt, WACC == cost_of_equity
        assert wacc == pytest.approx(0.086, abs=1e-6)

    def test_beta_is_clamped_to_sane_range(self):
        wacc_extreme, _ = _calc_wacc(
            beta=10.0, risk_free_rate=0.04, market_cap=1e9,
            total_debt=0, interest_expense=0, tax_rate=0.21, sector="Technology",
        )
        wacc_at_clamp, _ = _calc_wacc(
            beta=3.0, risk_free_rate=0.04, market_cap=1e9,
            total_debt=0, interest_expense=0, tax_rate=0.21, sector="Technology",
        )
        assert wacc_extreme == wacc_at_clamp

    def test_wacc_is_floored_and_capped(self):
        # extremely low beta + low risk-free rate should still floor at 4%
        wacc_low, _ = _calc_wacc(
            beta=0.05, risk_free_rate=0.0, market_cap=1e9,
            total_debt=0, interest_expense=0, tax_rate=0.21, sector=None,
        )
        assert wacc_low >= 0.04
        # extreme beta + high risk-free should still cap at 20%
        wacc_high, _ = _calc_wacc(
            beta=3.0, risk_free_rate=0.15, market_cap=1e9,
            total_debt=0, interest_expense=0, tax_rate=0.21, sector=None,
        )
        assert wacc_high <= 0.20

    def test_cost_of_debt_is_bounded_by_min_and_max(self):
        # interest_expense/total_debt implausibly small -> floored at 3%
        wacc_min_debt, meta = _calc_wacc(
            beta=1.0, risk_free_rate=0.04, market_cap=1e9,
            total_debt=1e9, interest_expense=1, tax_rate=0.21, sector=None,
        )
        assert meta["method"] == "capm"
        # interest_expense/total_debt implausibly large -> capped at 15%
        wacc_max_debt, _ = _calc_wacc(
            beta=1.0, risk_free_rate=0.04, market_cap=1e9,
            total_debt=1e6, interest_expense=1e6, tax_rate=0.21, sector=None,
        )
        assert math.isfinite(wacc_min_debt) and math.isfinite(wacc_max_debt)

    def test_qualitative_adjustment_requires_reason(self):
        with pytest.raises(ValueError):
            _calc_wacc(
                beta=1.0, risk_free_rate=0.04, market_cap=1e9,
                total_debt=0, interest_expense=0, tax_rate=0.21, sector=None,
                qualitative_adjustment_pct=1.0, qualitative_adjustment_reason=None,
            )

    def test_qualitative_adjustment_out_of_range_raises(self):
        with pytest.raises(ValueError):
            _calc_wacc(
                beta=1.0, risk_free_rate=0.04, market_cap=1e9,
                total_debt=0, interest_expense=0, tax_rate=0.21, sector=None,
                qualitative_adjustment_pct=5.0, qualitative_adjustment_reason="test",
            )

    def test_qualitative_adjustment_within_range_shifts_cost_of_equity(self):
        wacc_base, _ = _calc_wacc(
            beta=1.0, risk_free_rate=0.04, market_cap=1e9,
            total_debt=0, interest_expense=0, tax_rate=0.21, sector=None,
        )
        wacc_adj, _ = _calc_wacc(
            beta=1.0, risk_free_rate=0.04, market_cap=1e9,
            total_debt=0, interest_expense=0, tax_rate=0.21, sector=None,
            qualitative_adjustment_pct=1.0, qualitative_adjustment_reason="test justification",
        )
        assert wacc_adj == pytest.approx(wacc_base + 0.01, abs=1e-6)


# ── Sector lookup tables ──────────────────────────────────────────────────

class TestSectorLookups:
    def test_discount_rate_matches_by_substring(self):
        assert _sector_discount_rate("Consumer Electronics - Technology") == _sector_discount_rate("Technology")

    def test_discount_rate_defaults_when_no_match(self):
        assert _sector_discount_rate("Totally Unknown Sector") == _DEFAULT_DISCOUNT_RATE
        assert _sector_discount_rate(None) == _DEFAULT_DISCOUNT_RATE

    def test_terminal_growth_defaults_when_no_match(self):
        assert _sector_terminal_growth("Totally Unknown Sector") == _DEFAULT_TERMINAL_GROWTH
        assert _sector_terminal_growth(None) == _DEFAULT_TERMINAL_GROWTH

    def test_terminal_growth_never_exceeds_sane_bound(self):
        # every sector-specific terminal growth must stay under ~3% (nominal
        # GDP growth ceiling) — a real invariant the module docstring claims
        from app.services.fundamental_analysis_service import _SECTOR_TERMINAL_GROWTH
        for _, rate in _SECTOR_TERMINAL_GROWTH:
            assert 0 < rate <= 0.03

    def test_cyclicality_dampener_defaults_and_bounds(self):
        assert _sector_cyclicality_dampener(None) == _DEFAULT_CYCLICALITY_DAMPENER
        from app.services.fundamental_analysis_service import _SECTOR_CYCLICALITY_DAMPENER
        for _, factor in _SECTOR_CYCLICALITY_DAMPENER:
            assert 0.9 <= factor <= 1.0

    def test_is_financial_sector_matches_known_keys(self):
        assert _is_financial_sector("Insurance—Property & Casualty") is True
        assert _is_financial_sector("Banks—Regional") is True
        assert _is_financial_sector("Software—Infrastructure") is False
        assert _is_financial_sector(None) is False


# ── Small numeric helpers ───────────────────────────────────────────────────

class TestNumericHelpers:
    def test_num_filters_none_nan_and_overflow(self):
        assert _num(None) is None
        assert _num(float("nan")) is None
        assert _num(1e19) is None
        assert _num("42.5") == 42.5
        assert _num("not a number") is None

    def test_cagr_requires_positive_values_and_years(self):
        assert _cagr(100, 200, 5) == pytest.approx(14.9, abs=0.1)
        assert _cagr(None, 200, 5) is None
        assert _cagr(-100, 200, 5) is None
        assert _cagr(100, 200, 0) is None

    def test_score_picks_first_tier_value_is_at_or_below(self):
        tiers = [(5, 95), (10, 80), (999, 10)]
        assert _score(3, tiers) == 95
        assert _score(5, tiers) == 95
        assert _score(7, tiers) == 80
        assert _score(500, tiers) == 10
        assert _score(None, tiers) is None

    def test_coefficient_of_variation_needs_at_least_3_values(self):
        assert _coefficient_of_variation([1.0, 2.0]) is None
        assert _coefficient_of_variation([10.0, 10.0, 10.0]) == pytest.approx(0.0)
        assert _coefficient_of_variation([5.0, 15.0, 10.0]) is not None

    def test_coefficient_of_variation_none_when_mean_is_zero(self):
        assert _coefficient_of_variation([-5.0, 5.0, 0.0]) is None

    # Fase 1.5, Incremento 14 (dedup) — single source of truth for margin
    # of safety, replacing 5 independently-drifted inline copies.
    def test_calc_margin_of_safety_divides_by_intrinsic_value(self):
        # (150 - 100) / 150, NOT / 100 — the convention 4 of the 5 original
        # sites already used; the lone holdout (saved_valuation_service.py)
        # was migrated to this, not the other way around.
        assert calc_margin_of_safety(150.0, 100.0) == pytest.approx(33.3, abs=0.1)

    def test_calc_margin_of_safety_negative_when_overpriced(self):
        assert calc_margin_of_safety(80.0, 100.0) == pytest.approx(-25.0, abs=0.1)


# Methodology audit round 2 (see /Users/diegoarria/.claude/plans/cosmic-
# munching-crown.md) — net cash now includes Long Term Investments, fixing
# understated real liquidity for companies (Apple is the canonical example)
# that hold long-duration marketable securities in a separate balance-sheet
# line from "Cash And Short Term Investments."
class TestCombineCashAndLongTermInvestments:
    def test_adds_long_term_investments_to_short_term_cash(self):
        assert combine_cash_and_long_term_investments(50.0, 30.0) == 80.0

    def test_missing_long_term_investments_falls_back_to_old_behavior(self):
        assert combine_cash_and_long_term_investments(50.0, None) == 50.0

    def test_missing_short_term_cash_still_counts_long_term_investments(self):
        assert combine_cash_and_long_term_investments(None, 30.0) == 30.0

    def test_both_missing_returns_zero_never_none(self):
        assert combine_cash_and_long_term_investments(None, None) == 0.0

    def test_zero_long_term_investments_is_a_no_op(self):
        assert combine_cash_and_long_term_investments(50.0, 0.0) == 50.0


# Methodology audit (see /Users/diegoarria/.claude/plans/cosmic-munching-
# crown.md) — maintenance-vs-growth CapEx split, the fix for the FCF-margin
# bug that penalized capex-heavy growth companies (data centers, AI infra)
# as if their cash economics were deteriorating.
class TestSplitMaintenanceGrowthCapex:
    def test_growth_heavy_year_capex_exceeds_da(self):
        # $500M total capex, $200M D&A -> $200M maintenance, $300M growth.
        maintenance, growth = split_maintenance_growth_capex(-500.0, 200.0)
        assert maintenance == 200.0
        assert growth == 300.0

    def test_pure_maintenance_year_capex_below_da(self):
        # $150M capex, $200M D&A -> all of it counts as maintenance, zero growth.
        maintenance, growth = split_maintenance_growth_capex(-150.0, 200.0)
        assert maintenance == 150.0
        assert growth == 0.0

    def test_missing_da_falls_back_to_old_undifferentiated_behavior(self):
        maintenance, growth = split_maintenance_growth_capex(-300.0, None)
        assert maintenance == 300.0
        assert growth == 0.0

    def test_zero_or_negative_da_falls_back_same_as_missing(self):
        maintenance, growth = split_maintenance_growth_capex(-300.0, 0.0)
        assert maintenance == 300.0
        assert growth == 0.0

    def test_missing_capex_returns_none_maintenance_zero_growth(self):
        maintenance, growth = split_maintenance_growth_capex(None, 200.0)
        assert maintenance is None
        assert growth == 0.0

    def test_handles_positive_capex_sign_convention_too(self):
        # Some providers may report capex as a positive magnitude already —
        # the split should be sign-agnostic (uses abs() internally).
        maintenance, growth = split_maintenance_growth_capex(500.0, 200.0)
        assert maintenance == 200.0
        assert growth == 300.0

    def test_calc_margin_of_safety_none_for_non_positive_intrinsic_value(self):
        assert calc_margin_of_safety(0.0, 100.0) is None
        assert calc_margin_of_safety(-10.0, 100.0) is None
        assert calc_margin_of_safety(None, 100.0) is None

    def test_calc_margin_of_safety_none_when_price_missing(self):
        assert calc_margin_of_safety(150.0, None) is None

    # Fase 1.5, Incremento 14 (dedup) — single source of truth for
    # FCF = CFO + Capex, replacing independent copies in
    # financial_data_service.py and market_data_service.py.
    def test_derive_fcf_adds_cfo_and_capex(self):
        # Capex is a negative outflow, same as every provider reports it.
        assert derive_fcf(1000.0, -300.0) == 700.0

    def test_derive_fcf_none_when_either_input_missing(self):
        assert derive_fcf(None, -300.0) is None
        assert derive_fcf(1000.0, None) is None


# ── _confidence_score ───────────────────────────────────────────────────────

class TestConfidenceScore:
    def test_stable_fcf_and_roic_yields_high_confidence(self):
        score = _confidence_score(fcf_cv=0.03, roic_trend=[20.0, 21.0, 19.5, 20.5], years_available=10)
        assert score >= 85

    def test_volatile_fcf_and_roic_yields_low_confidence(self):
        score = _confidence_score(fcf_cv=1.2, roic_trend=[5.0, 40.0, -10.0, 60.0], years_available=3)
        assert score <= 40

    def test_missing_data_falls_back_to_midpoint(self):
        score = _confidence_score(fcf_cv=None, roic_trend=[], years_available=10)
        # fcf_stability defaults to 50, roic_stability defaults to 50 (fewer than 3 valid points)
        assert score == pytest.approx(round(50 * 0.4 + 50 * 0.4 + 100 * 0.2))

    def test_score_is_bounded_0_to_100(self):
        score = _confidence_score(fcf_cv=0.0, roic_trend=[20.0, 20.0, 20.0], years_available=10)
        assert 0 <= score <= 100
