"""
Tests — app.services.fundamental_analysis_service.combine_fair_value_range
(Fase 1.5, Incremento 10).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md. Only the
pure combination formula is tested here — get_fundamental_analysis itself
has no direct test file (see that module's docstring), same convention.
"""
from app.services.fundamental_analysis_service import combine_fair_value_range

_FALLBACK = {"low": 80.0, "high": 120.0, "base": 100.0}


def _monte_carlo(p25=90.0, median=100.0, p75=110.0):
    return {"p25": p25, "median": median, "p75": p75}


def _consensus(values, base):
    return {
        "methods_used": {f"m{i}": {"value": v} for i, v in enumerate(values)},
        "consensus_fair_value": base,
    }


class TestCombineFairValueRange:
    def test_both_sources_present_widens_to_the_union(self):
        mc = _monte_carlo(p25=90.0, median=100.0, p75=110.0)
        consensus = _consensus([70.0, 130.0], 105.0)
        result = combine_fair_value_range(mc, consensus, _FALLBACK)
        assert result["low"] == 70.0
        assert result["high"] == 130.0
        assert result["base"] == round((100.0 + 105.0) / 2, 2)

    def test_monte_carlo_only_uses_its_percentiles(self):
        mc = _monte_carlo(p25=85.0, median=95.0, p75=115.0)
        result = combine_fair_value_range(mc, None, _FALLBACK)
        assert result == {"low": 85.0, "high": 115.0, "base": 95.0}

    def test_consensus_only_uses_its_method_spread(self):
        consensus = _consensus([60.0, 90.0, 75.0], 78.0)
        result = combine_fair_value_range(None, consensus, _FALLBACK)
        assert result == {"low": 60.0, "high": 90.0, "base": 78.0}

    def test_neither_source_falls_back_to_legacy_range(self):
        result = combine_fair_value_range(None, None, _FALLBACK)
        assert result == _FALLBACK

    def test_consensus_with_no_methods_used_falls_back_for_spread(self):
        consensus = {"methods_used": {}, "consensus_fair_value": None}
        result = combine_fair_value_range(None, consensus, _FALLBACK)
        assert result == _FALLBACK

    def test_low_never_exceeds_high_even_with_inverted_inputs(self):
        mc = _monte_carlo(p25=150.0, median=140.0, p75=130.0)
        result = combine_fair_value_range(mc, None, _FALLBACK)
        assert result["low"] <= result["high"]

    def test_result_always_has_the_three_keys(self):
        result = combine_fair_value_range(_monte_carlo(), _consensus([50.0], 60.0), _FALLBACK)
        assert set(result.keys()) == {"low", "high", "base"}
