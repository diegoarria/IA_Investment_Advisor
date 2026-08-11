"""
Tests — app.services.valuation.nuvos_engine.fcf_quality.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
from app.services.valuation.nuvos_engine.fcf_quality import compute_fcf_conversion, flag_divergence


class TestComputeFcfConversion:
    def test_positive_inputs_compute_real_ratio(self):
        result = compute_fcf_conversion(80.0, 100.0)
        assert result.fcf_conversion_pct == 80.0

    def test_missing_inputs_return_none_not_zero(self):
        assert compute_fcf_conversion(None, 100.0).fcf_conversion_pct is None
        assert compute_fcf_conversion(80.0, None).fcf_conversion_pct is None

    def test_non_positive_net_income_returns_none(self):
        assert compute_fcf_conversion(80.0, 0.0).fcf_conversion_pct is None
        assert compute_fcf_conversion(80.0, -10.0).fcf_conversion_pct is None


class TestFlagDivergence:
    def test_material_gap_is_flagged(self):
        assert flag_divergence(20.0, 5.0) is not None

    def test_small_gap_is_not_flagged(self):
        assert flag_divergence(12.0, 8.0) is None

    def test_missing_inputs_never_flag(self):
        assert flag_divergence(None, 5.0) is None
        assert flag_divergence(20.0, None) is None
