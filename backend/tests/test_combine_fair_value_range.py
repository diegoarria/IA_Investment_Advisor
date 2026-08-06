"""
Tests — app.services.fundamental_analysis_service.combine_fair_value_range
(Nuvos AI Fair Value Engine redesign, Incremento 11 — THE FLIP).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md. Only the
pure combination formula is tested here — get_fundamental_analysis itself
has no direct test file (see that module's docstring), same convention.
"""
from app.services.fundamental_analysis_service import combine_fair_value_range

_FALLBACK = {"low": 80.0, "high": 120.0, "base": 100.0}


def _nuvos(bear=70.0, base=100.0, bull=130.0):
    return {
        "scenarios": {
            "bear": {"fair_value_per_share": bear},
            "base": {"fair_value_per_share": base},
            "bull": {"fair_value_per_share": bull},
        }
    }


class TestCombineFairValueRange:
    def test_uses_bear_base_bull_as_low_base_high(self):
        result = combine_fair_value_range(_nuvos(bear=70.0, base=100.0, bull=130.0), _FALLBACK)
        assert result == {"low": 70.0, "high": 130.0, "base": 100.0}

    def test_none_falls_back_to_legacy_range(self):
        result = combine_fair_value_range(None, _FALLBACK)
        assert result == _FALLBACK

    def test_missing_scenarios_key_falls_back(self):
        result = combine_fair_value_range({}, _FALLBACK)
        assert result == _FALLBACK

    def test_any_missing_scenario_value_falls_back(self):
        nuvos = _nuvos()
        nuvos["scenarios"]["bear"]["fair_value_per_share"] = None
        result = combine_fair_value_range(nuvos, _FALLBACK)
        assert result == _FALLBACK

    def test_low_never_exceeds_high_even_if_bear_and_bull_are_inverted(self):
        result = combine_fair_value_range(_nuvos(bear=130.0, base=100.0, bull=70.0), _FALLBACK)
        assert result["low"] == 70.0
        assert result["high"] == 130.0

    def test_result_always_has_the_three_keys(self):
        result = combine_fair_value_range(_nuvos(), _FALLBACK)
        assert set(result.keys()) == {"low", "high", "base"}

    def test_values_are_rounded_to_2_decimals(self):
        result = combine_fair_value_range(_nuvos(bear=70.123, base=100.456, bull=130.789), _FALLBACK)
        assert result == {"low": 70.12, "high": 130.79, "base": 100.46}
