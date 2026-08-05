"""
Tests — app.services.valuation.robustness

Part of Fase 1, Incremento 1. These are the guard primitives that will be
wired into the new DCF Engine in Incremento 2 (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).
"""
import math

import pytest

from app.services.valuation.robustness import (
    UnstableGordonGrowthError,
    validate_discount_beats_terminal_growth,
    safe_divide,
    is_finite_number,
    clamp,
    validate_positive_shares,
    validate_positive_base_fcf,
)


class TestValidateDiscountBeatsTerminalGrowth:
    def test_passes_when_spread_is_healthy(self):
        validate_discount_beats_terminal_growth(0.09, 0.025)  # should not raise

    def test_raises_when_rates_are_equal(self):
        with pytest.raises(UnstableGordonGrowthError):
            validate_discount_beats_terminal_growth(0.03, 0.03)

    def test_raises_when_terminal_growth_exceeds_discount_rate(self):
        with pytest.raises(UnstableGordonGrowthError):
            validate_discount_beats_terminal_growth(0.02, 0.03)

    def test_raises_when_spread_is_below_minimum_even_if_r_greater_than_gt(self):
        # r > gt but only by 1bp — still practically unstable
        with pytest.raises(UnstableGordonGrowthError):
            validate_discount_beats_terminal_growth(0.0301, 0.03, min_spread=0.005)

    def test_error_carries_both_rates_for_a_clear_message(self):
        with pytest.raises(UnstableGordonGrowthError) as exc_info:
            validate_discount_beats_terminal_growth(0.03, 0.03)
        assert exc_info.value.discount_rate == 0.03
        assert exc_info.value.terminal_growth == 0.03
        assert "%" in str(exc_info.value)


class TestSafeDivide:
    def test_normal_division(self):
        assert safe_divide(10.0, 2.0) == 5.0

    def test_returns_none_for_zero_denominator(self):
        assert safe_divide(10.0, 0.0) is None

    def test_returns_none_for_near_zero_denominator(self):
        assert safe_divide(10.0, 1e-12) is None

    def test_respects_custom_epsilon(self):
        assert safe_divide(10.0, 0.01, epsilon=0.1) is None
        assert safe_divide(10.0, 0.01, epsilon=0.001) == pytest.approx(1000.0)

    def test_never_returns_inf(self):
        result = safe_divide(1.0, 0.0)
        assert result != math.inf
        assert result is None


class TestIsFiniteNumber:
    def test_finite_values_are_true(self):
        assert is_finite_number(0.0) is True
        assert is_finite_number(-100.5) is True
        assert is_finite_number(1e15) is True

    def test_none_is_false(self):
        assert is_finite_number(None) is False

    def test_nan_and_inf_are_false(self):
        assert is_finite_number(float("nan")) is False
        assert is_finite_number(float("inf")) is False
        assert is_finite_number(float("-inf")) is False

    def test_non_numeric_type_is_false_not_raise(self):
        assert is_finite_number("not a number") is False  # type: ignore[arg-type]


class TestClamp:
    def test_value_within_bounds_unchanged(self):
        assert clamp(5.0, 0.0, 10.0) == 5.0

    def test_value_below_lo_is_raised_to_lo(self):
        assert clamp(-5.0, 0.0, 10.0) == 0.0

    def test_value_above_hi_is_lowered_to_hi(self):
        assert clamp(50.0, 0.0, 10.0) == 10.0

    def test_boundary_values_are_inclusive(self):
        assert clamp(0.0, 0.0, 10.0) == 0.0
        assert clamp(10.0, 0.0, 10.0) == 10.0

    def test_invalid_bounds_raise(self):
        with pytest.raises(ValueError):
            clamp(5.0, 10.0, 0.0)

    def test_matches_existing_wacc_clamp_behavior(self):
        # mirrors _calc_wacc's `max(min(wacc, 0.20), 0.04)` pattern exactly
        assert clamp(0.25, 0.04, 0.20) == 0.20
        assert clamp(0.01, 0.04, 0.20) == 0.04
        assert clamp(0.09, 0.04, 0.20) == 0.09


class TestValidatePositiveShares:
    def test_positive_shares_valid(self):
        assert validate_positive_shares(100.0) is True

    def test_zero_shares_invalid(self):
        assert validate_positive_shares(0.0) is False

    def test_negative_shares_invalid(self):
        assert validate_positive_shares(-10.0) is False

    def test_none_shares_invalid(self):
        assert validate_positive_shares(None) is False


class TestValidatePositiveBaseFcf:
    def test_positive_fcf_valid(self):
        assert validate_positive_base_fcf(1000.0) is True

    def test_zero_fcf_invalid(self):
        assert validate_positive_base_fcf(0.0) is False

    def test_negative_fcf_invalid(self):
        assert validate_positive_base_fcf(-500.0) is False

    def test_none_fcf_invalid(self):
        assert validate_positive_base_fcf(None) is False
