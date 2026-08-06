"""
Tests — scripts.validate_valuation_engine (Fase 1.5, Incremento 6; extended
to 3 bands in the Nuvos AI Fair Value Engine redesign, Incremento 7).

Only the pure aggregation/reporting logic is tested here — the script's
main() does real network I/O (get_fundamental_analysis for N real tickers)
by design (it's a validation harness meant to run against live data before
the production flip, see the plan), which is out of scope for a unit test
in this suite, same convention as fundamental_analysis_service.py itself
(no direct tests — see that module's own lack of a test file).
"""
import pytest

from scripts.validate_valuation_engine import (
    TickerResult,
    _distribution_stats,
    _driver_based_mos_pct,
    _scenario_mos_pct,
    build_report,
    _EXTREME_MOS_THRESHOLD_PCT,
)


class TestDriverBasedMosPct:
    def test_computes_margin_of_safety_from_value_per_share(self):
        assert _driver_based_mos_pct({"value_per_share": 120.0}, 100.0) == 16.7

    def test_none_when_no_driver_based_valuation(self):
        assert _driver_based_mos_pct(None, 100.0) is None

    def test_none_when_no_price(self):
        assert _driver_based_mos_pct({"value_per_share": 120.0}, None) is None
        assert _driver_based_mos_pct({"value_per_share": 120.0}, 0) is None

    def test_none_when_value_per_share_missing_or_non_positive(self):
        assert _driver_based_mos_pct({"value_per_share": None}, 100.0) is None
        assert _driver_based_mos_pct({"value_per_share": 0}, 100.0) is None
        assert _driver_based_mos_pct({"value_per_share": -5.0}, 100.0) is None


class TestDistributionStats:
    def test_empty_list_returns_all_none(self):
        stats = _distribution_stats([])
        assert stats["n"] == 0
        assert stats["mean"] is None

    def test_single_value(self):
        stats = _distribution_stats([42.0])
        assert stats["n"] == 1
        assert stats["mean"] == 42.0
        assert stats["stdev"] == 0.0

    def test_real_distribution(self):
        stats = _distribution_stats([10.0, 20.0, -5.0, 50.0])
        assert stats["n"] == 4
        assert stats["mean"] == 18.8
        assert stats["median"] == 15.0
        assert stats["min"] == -5.0
        assert stats["max"] == 50.0


class TestScenarioMosPct:
    def test_computes_margin_of_safety_from_fair_value_per_share(self):
        assert _scenario_mos_pct({"fair_value_per_share": 120.0}, 100.0) == 16.7

    def test_none_when_no_scenario(self):
        assert _scenario_mos_pct(None, 100.0) is None

    def test_none_when_no_price(self):
        assert _scenario_mos_pct({"fair_value_per_share": 120.0}, None) is None
        assert _scenario_mos_pct({"fair_value_per_share": 120.0}, 0) is None

    def test_none_when_fair_value_missing_or_non_positive(self):
        assert _scenario_mos_pct({"fair_value_per_share": None}, 100.0) is None
        assert _scenario_mos_pct({"fair_value_per_share": 0}, 100.0) is None
        assert _scenario_mos_pct({"fair_value_per_share": -5.0}, 100.0) is None


def _result(
    ticker, legacy_mos=None, driver_mos=None, is_reit=False, error=None, sector="Technology",
    nuvos_bear=None, nuvos_base=None, nuvos_bull=None, anchor_source=None, gordon_ratio=None,
):
    return TickerResult(
        ticker=ticker, sector=sector, is_reit=is_reit,
        legacy_mos_pct=legacy_mos, driver_based_mos_pct=driver_mos,
        legacy_value_per_share=None, driver_based_value_per_share=None,
        price=100.0, error=error,
        nuvos_bear_mos_pct=nuvos_bear, nuvos_base_mos_pct=nuvos_base, nuvos_bull_mos_pct=nuvos_bull,
        exit_multiple_anchor_source=anchor_source, gordon_sanity_check_ratio=gordon_ratio,
    )


class TestBuildReport:
    def test_counts_reits_separately_from_universe_size(self):
        results = [
            _result("O", is_reit=True, error=None),
            _result("AAPL", legacy_mos=10.0, driver_mos=12.0),
        ]
        report = build_report(results)
        assert report["universe_size"] == 2
        assert report["reit_excluded"] == 1
        assert report["both_models_computed"] == 1

    def test_errored_tickers_excluded_from_both_computed(self):
        results = [
            _result("XYZ", error="no real data"),
            _result("AAPL", legacy_mos=10.0, driver_mos=12.0),
        ]
        report = build_report(results)
        assert report["errored_or_no_dcf"] == 1
        assert report["both_models_computed"] == 1

    def test_flags_extreme_valuations_beyond_threshold(self):
        results = [
            _result("A", legacy_mos=_EXTREME_MOS_THRESHOLD_PCT + 1, driver_mos=10.0),
            _result("B", legacy_mos=10.0, driver_mos=-(_EXTREME_MOS_THRESHOLD_PCT + 5)),
            _result("C", legacy_mos=5.0, driver_mos=5.0),
        ]
        report = build_report(results)
        assert report["legacy_extreme_count"] == 1
        assert "A" in report["legacy_extreme_tickers"]
        assert report["driver_based_extreme_count"] == 1
        assert "B" in report["driver_based_extreme_tickers"]

    def test_delta_distribution_reflects_real_differences(self):
        results = [
            _result("A", legacy_mos=10.0, driver_mos=15.0),
            _result("B", legacy_mos=20.0, driver_mos=18.0),
        ]
        report = build_report(results)
        assert report["mos_delta_distribution"]["n"] == 2

    def test_largest_delta_tickers_sorted_by_absolute_delta_desc(self):
        results = [
            _result("SMALL_DELTA", legacy_mos=10.0, driver_mos=11.0),
            _result("BIG_DELTA", legacy_mos=10.0, driver_mos=40.0),
        ]
        report = build_report(results)
        assert report["largest_delta_tickers"][0]["ticker"] == "BIG_DELTA"

    def test_empty_results_do_not_crash(self):
        report = build_report([])
        assert report["universe_size"] == 0
        assert report["both_models_computed"] == 0
        assert report["legacy_mos_distribution"]["n"] == 0


class TestBuildReportNuvosFairValue:
    """Nuvos AI Fair Value Engine redesign, Incremento 7 — the 3rd band."""

    def test_nuvos_computed_counts_only_tickers_with_a_real_base_scenario(self):
        results = [
            _result("A", legacy_mos=10.0, driver_mos=12.0, nuvos_base=8.0, nuvos_bear=-5.0, nuvos_bull=25.0),
            _result("B", legacy_mos=10.0, driver_mos=12.0),  # no nuvos data
        ]
        report = build_report(results)
        assert report["nuvos_computed"] == 1
        assert report["nuvos_base_mos_distribution"]["n"] == 1

    def test_flags_extreme_nuvos_valuations(self):
        results = [
            _result("A", nuvos_base=_EXTREME_MOS_THRESHOLD_PCT + 1),
            _result("B", nuvos_base=5.0),
        ]
        report = build_report(results)
        assert report["nuvos_extreme_count"] == 1
        assert "A" in report["nuvos_extreme_tickers"]

    def test_bear_bull_spread_reflects_real_range(self):
        results = [
            _result("A", nuvos_bear=-10.0, nuvos_base=5.0, nuvos_bull=30.0),
            _result("B", nuvos_bear=0.0, nuvos_base=10.0, nuvos_bull=20.0),
        ]
        report = build_report(results)
        assert report["bear_bull_spread_distribution"]["n"] == 2
        # A: 30 - (-10) = 40; B: 20 - 0 = 20
        assert report["bear_bull_spread_distribution"]["max"] == 40.0

    def test_anchor_source_counts_and_real_anchor_pct(self):
        results = [
            _result("A", nuvos_base=5.0, anchor_source="own_historical"),
            _result("B", nuvos_base=5.0, anchor_source="peer_median"),
            _result("C", nuvos_base=5.0, anchor_source="sector_table_fallback"),
        ]
        report = build_report(results)
        assert report["exit_multiple_anchor_source_counts"] == {
            "own_historical": 1, "peer_median": 1, "sector_table_fallback": 1,
        }
        assert report["exit_multiple_real_anchor_pct"] == pytest.approx(66.7, abs=0.1)

    def test_real_anchor_pct_none_when_no_anchors_at_all(self):
        report = build_report([_result("A", legacy_mos=10.0, driver_mos=10.0)])
        assert report["exit_multiple_real_anchor_pct"] is None

    def test_gordon_out_of_band_flags_ratios_far_from_one(self):
        results = [
            _result("A", nuvos_base=5.0, gordon_ratio=0.1),  # out of [0.4, 2.5]
            _result("B", nuvos_base=5.0, gordon_ratio=1.1),  # in band
            _result("C", nuvos_base=5.0, gordon_ratio=3.0),  # out of band
        ]
        report = build_report(results)
        assert report["gordon_out_of_band_count"] == 2
        assert set(report["gordon_out_of_band_tickers"]) == {"A", "C"}

    def test_nuvos_fields_absent_do_not_crash_the_report(self):
        report = build_report([_result("A", legacy_mos=10.0, driver_mos=10.0)])
        assert report["nuvos_computed"] == 0
        assert report["bear_bull_spread_distribution"]["n"] == 0
        assert report["gordon_out_of_band_count"] == 0
