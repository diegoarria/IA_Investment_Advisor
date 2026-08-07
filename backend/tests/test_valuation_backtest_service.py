"""
Tests — app.services.valuation_backtest_service (Modelo Completo follow-up,
see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).
"""
from unittest.mock import patch

from app.services.valuation_backtest_service import (
    _classify_ticker,
    _classify_universe,
    _build_equal_weighted_basket,
    _build_benchmark_series,
    compute_valuation_backtest,
)


def _make_data(price, fair_value, ticker="XXX", company_name="X Corp"):
    return {
        "current_price": price,
        "company_name": company_name,
        "dcf": {"nuvos_fair_value": {"scenarios": {"base": {"fair_value_per_share": fair_value}}}},
    }


class TestClassifyTicker:
    def test_undervalued_uses_value_denominator_margin_of_safety(self):
        result = _classify_ticker("AAA", _make_data(price=80.0, fair_value=100.0))
        assert result["verdict"] == "undervalued"
        assert result["pct"] == 20.0  # (100-80)/100

    def test_overvalued_uses_price_denominator_premium(self):
        result = _classify_ticker("BBB", _make_data(price=124.0, fair_value=100.0))
        assert result["verdict"] == "overvalued"
        assert result["pct"] == round((124 - 100) / 124 * 100, 1)

    def test_within_band_is_fair_not_a_verdict(self):
        result = _classify_ticker("CCC", _make_data(price=102.0, fair_value=100.0))
        assert result["verdict"] == "fair"

    def test_missing_data_returns_none(self):
        assert _classify_ticker("DDD", None) is None

    def test_missing_fair_value_returns_none(self):
        data = {"current_price": 100.0, "company_name": "X", "dcf": {"nuvos_fair_value": None}}
        assert _classify_ticker("EEE", data) is None

    def test_non_positive_price_returns_none(self):
        assert _classify_ticker("FFF", _make_data(price=0.0, fair_value=100.0)) is None


class TestClassifyUniverse:
    def test_splits_and_sorts_by_most_extreme_first(self):
        analysis_cache = {
            "CHEAP1": _make_data(price=50.0, fair_value=100.0),   # 50% undervalued
            "CHEAP2": _make_data(price=90.0, fair_value=100.0),   # 10% undervalued
            "PRICEY1": _make_data(price=200.0, fair_value=100.0),  # 50% overvalued
            "PRICEY2": _make_data(price=110.0, fair_value=100.0),  # ~9% overvalued
            "FAIRVAL": _make_data(price=101.0, fair_value=100.0),  # inside the band
            "BROKEN": None,
        }
        undervalued, overvalued = _classify_universe(analysis_cache)
        assert [c["ticker"] for c in undervalued] == ["CHEAP1", "CHEAP2"]
        assert [c["ticker"] for c in overvalued] == ["PRICEY1", "PRICEY2"]


class TestBuildEqualWeightedBasket:
    def test_normalizes_to_10000_at_month_zero_and_marks_to_market(self):
        months = ["2025-01", "2025-02", "2025-03"]
        # 5 candidates (_MIN_BASKET_SIZE) — AAA/BBB move, the other 3 stay flat,
        # so the expected math below only has to reason about two movers.
        candidates = [{"ticker": "AAA"}, {"ticker": "BBB"}, {"ticker": "CCC"}, {"ticker": "DDD"}, {"ticker": "EEE"}]

        def fake_monthly_closes(symbol):
            series = {
                "AAA": [10.0, 20.0, 10.0], "BBB": [100.0, 100.0, 200.0],
                "CCC": [50.0, 50.0, 50.0], "DDD": [50.0, 50.0, 50.0], "EEE": [50.0, 50.0, 50.0],
            }[symbol]
            return {"prices": series, "timestamps": [f"{m}-01" for m in months]}

        with patch("app.services.valuation_backtest_service._monthly_closes", side_effect=fake_monthly_closes):
            basket = _build_equal_weighted_basket(candidates, months)

        assert basket[0] == 10000.0
        # Each of 5 positions starts at $2000. AAA doubles (2000->4000), BBB
        # flat (2000), the other 3 flat (2000 each) at month 1.
        assert basket[1] == 12000.0
        # AAA back to its original price 10 (still 2000), BBB doubles again to 200 (4000), rest flat at month 2.
        assert basket[2] == 12000.0

    def test_skips_candidates_missing_full_history_never_interpolates(self):
        months = ["2025-01", "2025-02", "2025-03"]
        candidates = [{"ticker": "PARTIAL"}, {"ticker": "FULL1"}, {"ticker": "FULL2"},
                      {"ticker": "FULL3"}, {"ticker": "FULL4"}, {"ticker": "FULL5"}]

        def fake_monthly_closes(symbol):
            if symbol == "PARTIAL":
                return {"prices": [10.0, 20.0], "timestamps": ["2025-02-01", "2025-03-01"]}
            return {"prices": [10.0, 10.0, 10.0], "timestamps": [f"{m}-01" for m in months]}

        with patch("app.services.valuation_backtest_service._monthly_closes", side_effect=fake_monthly_closes):
            basket = _build_equal_weighted_basket(candidates, months)

        assert basket is not None
        assert basket[0] == 10000.0  # PARTIAL excluded entirely, never padded/interpolated

    def test_returns_none_below_minimum_basket_size(self):
        months = ["2025-01", "2025-02"]
        candidates = [{"ticker": "ONLY1"}, {"ticker": "ONLY2"}]

        def fake_monthly_closes(symbol):
            return {"prices": [10.0, 12.0], "timestamps": [f"{m}-01" for m in months]}

        with patch("app.services.valuation_backtest_service._monthly_closes", side_effect=fake_monthly_closes):
            basket = _build_equal_weighted_basket(candidates, months)

        assert basket is None


class TestBuildBenchmarkSeries:
    def test_none_when_spy_history_unavailable(self):
        with patch("app.services.valuation_backtest_service._monthly_closes", return_value=None):
            assert _build_benchmark_series(["2025-01"]) is None

    def test_normalizes_spy_to_10000_at_month_zero(self):
        months = ["2025-01", "2025-02"]
        with patch(
            "app.services.valuation_backtest_service._monthly_closes",
            return_value={"prices": [400.0, 440.0], "timestamps": [f"{m}-01" for m in months]},
        ):
            series = _build_benchmark_series(months)
        assert series == [10000.0, 11000.0]


class TestComputeValuationBacktest:
    def test_none_when_too_few_classified_candidates(self):
        analysis_cache = {"A": _make_data(price=50.0, fair_value=100.0)}
        assert compute_valuation_backtest(analysis_cache) is None

    def test_none_when_spy_unavailable(self):
        analysis_cache = {
            f"U{i}": _make_data(price=50.0, fair_value=100.0) for i in range(6)
        } | {
            f"O{i}": _make_data(price=200.0, fair_value=100.0) for i in range(6)
        }
        with patch("app.services.valuation_backtest_service._monthly_closes", return_value=None):
            assert compute_valuation_backtest(analysis_cache) is None

    def test_full_happy_path_returns_real_series_and_returns_pct(self):
        analysis_cache = {
            f"U{i}": _make_data(price=50.0, fair_value=100.0) for i in range(6)
        } | {
            f"O{i}": _make_data(price=200.0, fair_value=100.0) for i in range(6)
        }
        months = [f"2025-{m:02d}" for m in range(1, 4)]

        def fake_monthly_closes(symbol):
            # every symbol (including SPY) doubles from month 0 to month 2
            return {"prices": [10.0, 15.0, 20.0], "timestamps": [f"{m}-01" for m in months]}

        with patch("app.services.valuation_backtest_service._monthly_closes", side_effect=fake_monthly_closes):
            result = compute_valuation_backtest(analysis_cache)

        assert result is not None
        assert result["undervalued_return_pct"] == 100.0
        assert result["overvalued_return_pct"] == 100.0
        assert result["sp500_return_pct"] == 100.0
        assert len(result["discover_more"]) == 12
