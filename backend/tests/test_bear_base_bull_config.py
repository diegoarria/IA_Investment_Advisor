"""
Tests — app.services.fundamental_analysis_service.BEAR_BASE_BULL /
bear_base_bull_growth_cap_pct (Nuvos AI Fair Value Engine redesign,
Incremento 5).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md. Pure
configuration/function tests — no network, no DCF computation.
"""
import pytest

from app.services.fundamental_analysis_service import BEAR_BASE_BULL, bear_base_bull_growth_cap_pct

_MONOTONIC_INCREASING_KEYS = [
    "growth_delta_pp",
    "operating_margin_start_delta_pp",
    "operating_margin_terminal_delta_pp",
    "exit_multiple_delta_fraction",
    "high_growth_years",
]
_MONOTONIC_DECREASING_KEYS = ["discount_rate_delta_pct"]


class TestBearBaseBullConfigShape:
    def test_exactly_three_scenarios_named_bear_base_bull(self):
        assert set(BEAR_BASE_BULL.keys()) == {"bear", "base", "bull"}

    def test_every_scenario_has_the_same_parameter_set(self):
        keys_per_scenario = [set(v.keys()) for v in BEAR_BASE_BULL.values()]
        assert keys_per_scenario[0] == keys_per_scenario[1] == keys_per_scenario[2]

    def test_base_scenario_is_neutral(self):
        base = BEAR_BASE_BULL["base"]
        assert base["growth_delta_pp"] == 0.0
        assert base["discount_rate_delta_pct"] == 0.0
        assert base["operating_margin_start_delta_pp"] == 0.0
        assert base["operating_margin_terminal_delta_pp"] == 0.0
        assert base["exit_multiple_delta_fraction"] == 0.0


class TestBearBaseBullMonotonicity:
    @pytest.mark.parametrize("key", _MONOTONIC_INCREASING_KEYS)
    def test_increases_bear_to_base_to_bull(self, key):
        assert BEAR_BASE_BULL["bear"][key] <= BEAR_BASE_BULL["base"][key] <= BEAR_BASE_BULL["bull"][key]

    @pytest.mark.parametrize("key", _MONOTONIC_DECREASING_KEYS)
    def test_decreases_bear_to_base_to_bull(self, key):
        assert BEAR_BASE_BULL["bear"][key] >= BEAR_BASE_BULL["base"][key] >= BEAR_BASE_BULL["bull"][key]

    def test_margin_start_and_terminal_deltas_differ_in_at_least_one_scenario(self):
        # The whole point of Incremento 5: margins are allowed to evolve
        # (start != terminal), unlike every current production call site.
        assert any(
            v["operating_margin_start_delta_pp"] != v["operating_margin_terminal_delta_pp"]
            for v in BEAR_BASE_BULL.values()
        )


class TestGrowthCapScalesWithQuality:
    def test_higher_quality_score_yields_a_higher_cap(self):
        low = bear_base_bull_growth_cap_pct(business_quality_score=20.0, scenario="base")
        high = bear_base_bull_growth_cap_pct(business_quality_score=90.0, scenario="base")
        assert high > low

    def test_never_a_flat_cap_across_quality_levels(self):
        # Structural difference from FCF_DCF_SCENARIOS' static
        # revenue_growth_cap_pct — same scenario, different quality, must
        # produce a different cap.
        caps = {q: bear_base_bull_growth_cap_pct(business_quality_score=q, scenario="bull") for q in (10.0, 50.0, 95.0)}
        assert len(set(caps.values())) == 3

    def test_none_quality_score_falls_back_to_neutral_midpoint(self):
        neutral = bear_base_bull_growth_cap_pct(business_quality_score=None, scenario="base")
        midpoint = bear_base_bull_growth_cap_pct(business_quality_score=50.0, scenario="base")
        assert neutral == midpoint

    def test_cap_ordering_across_scenarios_at_equal_quality(self):
        q = 50.0
        assert (
            bear_base_bull_growth_cap_pct(q, "bear")
            < bear_base_bull_growth_cap_pct(q, "base")
            < bear_base_bull_growth_cap_pct(q, "bull")
        )

    def test_cap_never_goes_below_a_sane_floor(self):
        assert bear_base_bull_growth_cap_pct(business_quality_score=0.0, scenario="bear") >= 5.0
