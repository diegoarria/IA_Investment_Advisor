"""
Tests — scripts.validate_valuation_engine (Fase 1.5, Incremento 6).

Only the pure aggregation/reporting logic is tested here — the script's
main() does real network I/O (get_fundamental_analysis for N real tickers)
by design (it's a validation harness meant to run against live data before
the production flip, see the plan), which is out of scope for a unit test
in this suite, same convention as fundamental_analysis_service.py itself
(no direct tests — see that module's own lack of a test file).
"""
from scripts.validate_valuation_engine import (
    TickerResult,
    _distribution_stats,
    _driver_based_mos_pct,
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


def _result(ticker, legacy_mos=None, driver_mos=None, is_reit=False, error=None, sector="Technology"):
    return TickerResult(
        ticker=ticker, sector=sector, is_reit=is_reit,
        legacy_mos_pct=legacy_mos, driver_based_mos_pct=driver_mos,
        legacy_value_per_share=None, driver_based_value_per_share=None,
        price=100.0, error=error,
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
