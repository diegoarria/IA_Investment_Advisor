"""
Tests — app.services.valuation.nuvos_engine.peg_diagnostic.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
import pytest

from app.services.valuation.nuvos_engine.peg_diagnostic import compute_peg, compute_pegy


class TestComputePeg:
    def test_missing_inputs_returns_none_not_zero(self):
        assert compute_peg(None, 10.0).peg is None
        assert compute_peg(20.0, None).peg is None

    def test_negative_or_zero_growth_returns_none(self):
        assert compute_peg(20.0, 0.0).peg is None
        assert compute_peg(20.0, -5.0).peg is None

    def test_bands_match_the_documented_thresholds(self):
        assert compute_peg(14.0, 20.0).band == "very_attractive"   # 0.7
        assert compute_peg(18.0, 20.0).band == "attractive"        # 0.9
        assert compute_peg(22.0, 20.0).band == "reasonable"        # 1.1
        assert compute_peg(28.0, 20.0).band == "demanding"         # 1.4
        assert compute_peg(40.0, 20.0).band == "expensive"         # 2.0

    def test_never_named_after_any_investor_in_its_output(self):
        result = compute_peg(20.0, 20.0)
        assert "lynch" not in result.reason.lower()


class TestComputePegy:
    def test_no_dividend_returns_none_never_fabricated(self):
        assert compute_pegy(20.0, 10.0, None).pegy is None
        assert compute_pegy(20.0, 10.0, 0.0).pegy is None

    def test_real_dividend_produces_a_value(self):
        result = compute_pegy(20.0, 10.0, 2.0)
        assert result.pegy == pytest.approx(20.0 / 12.0, abs=0.01)
