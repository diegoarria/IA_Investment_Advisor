"""Nuvos ETF Fase 1 — provider/normalize/metrics/service test suite."""
from unittest.mock import patch

import pytest

from app.services.etf import normalize
from app.services.etf.metrics import concentration_metrics, cost_tier, price_change_pct
from app.services.etf.provider import FMPResult, fetch
from app.services.etf.service import NotAnETFError, get_etf_overview


TEST_TICKERS = ["SPY", "VOO", "VTI", "QQQ", "VXUS", "XLK", "XLV", "VNQ", "IBB", "BOTZ"]


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.core import cache as cache_module
    cache_module._mem.clear()
    yield
    cache_module._mem.clear()


# ---------------------------------------------------------------------------
# normalize.py — unit/shape correctness (the actual landmine this phase found)
# ---------------------------------------------------------------------------

class TestNormalizeWeightings:
    def test_sector_weighting_numeric_shape(self):
        raw = [{"symbol": "SPY", "sector": "Technology", "weightPercentage": 38.62}]
        result = normalize.normalize_weightings(raw, name_key="sector")
        assert result["items"] == [{"name": "Technology", "weight_pct": 38.62}]

    def test_country_weighting_string_percent_shape(self):
        """The real landmine: country-weightings returns '97.27%' as a
        STRING, not a float like sector-weightings does."""
        raw = [{"country": "United States", "weightPercentage": "97.27%"}]
        result = normalize.normalize_weightings(raw, name_key="country")
        assert result["items"] == [{"name": "United States", "weight_pct": 97.27}]

    def test_unparseable_weight_is_dropped_not_zeroed(self):
        raw = [
            {"sector": "Technology", "weightPercentage": 38.62},
            {"sector": "Mystery", "weightPercentage": "not-a-number%"},
            {"sector": None, "weightPercentage": 10.0},
        ]
        result = normalize.normalize_weightings(raw, name_key="sector")
        assert len(result["items"]) == 1
        assert result["items"][0]["name"] == "Technology"

    def test_items_sorted_descending(self):
        raw = [
            {"sector": "Small", "weightPercentage": 5.0},
            {"sector": "Big", "weightPercentage": 50.0},
            {"sector": "Mid", "weightPercentage": 20.0},
        ]
        result = normalize.normalize_weightings(raw, name_key="sector")
        assert [i["name"] for i in result["items"]] == ["Big", "Mid", "Small"]

    def test_sum_in_expected_range_true_for_realistic_total(self):
        raw = [{"sector": "A", "weightPercentage": 60.0}, {"sector": "B", "weightPercentage": 38.0}]
        result = normalize.normalize_weightings(raw, name_key="sector")
        assert result["sum_pct"] == 98.0
        assert result["sum_in_expected_range"] is True

    def test_sum_in_expected_range_false_for_implausible_total(self):
        """A partial/stale FMP response summing to 12% should be flagged,
        not silently trusted."""
        raw = [{"sector": "A", "weightPercentage": 12.0}]
        result = normalize.normalize_weightings(raw, name_key="sector")
        assert result["sum_in_expected_range"] is False

    def test_empty_input_never_crashes(self):
        result = normalize.normalize_weightings([], name_key="sector")
        assert result == {"items": [], "sum_pct": None, "sum_in_expected_range": False}


class TestNormalizeEtfInfo:
    def test_expense_ratio_passed_through_as_percentage_points_not_multiplied(self):
        """0.09 means "0.09%" — must NOT become 9.0 or 0.0009."""
        raw = {"expenseRatio": 0.09, "name": "SPY ETF"}
        result = normalize.normalize_etf_info(raw)
        assert result["expense_ratio_pct"] == 0.09

    def test_missing_fields_become_none_not_zero(self):
        result = normalize.normalize_etf_info({})
        assert result["expense_ratio_pct"] is None
        assert result["aum_usd"] is None
        assert result["holdings_count"] is None

    def test_non_numeric_aum_does_not_crash_and_is_none(self):
        result = normalize.normalize_etf_info({"assetsUnderManagement": "not-a-number"})
        assert result["aum_usd"] is None


class TestNormalizeDividendsAndHistory:
    def test_dividend_yield_passthrough(self):
        raw = [{"date": "2026-09-18", "adjDividend": 1.88883, "yield": 0.9955, "frequency": "Quarterly"}]
        result = normalize.normalize_dividends(raw)
        assert result[0]["yield_pct"] == 0.9955
        assert result[0]["amount"] == 1.88883

    def test_price_history_drops_rows_without_numeric_price(self):
        raw = [{"date": "2026-11-01", "price": 752.1}, {"date": "2026-10-31", "price": None}]
        result = normalize.normalize_price_history(raw)
        assert len(result) == 1
        assert result[0]["price"] == 752.1


# ---------------------------------------------------------------------------
# metrics.py
# ---------------------------------------------------------------------------

class TestMetrics:
    def test_concentration_metrics_basic(self):
        w = {"items": [{"name": "Tech", "weight_pct": 40.0}, {"name": "Health", "weight_pct": 20.0}, {"name": "Fin", "weight_pct": 10.0}]}
        result = concentration_metrics(w)
        assert result["top1_name"] == "Tech"
        assert result["top1_weight_pct"] == 40.0
        assert result["top3_weight_pct"] == 70.0
        assert result["bucket_count"] == 3

    def test_concentration_metrics_empty_never_crashes(self):
        result = concentration_metrics({"items": []})
        assert result["top1_name"] is None
        assert result["bucket_count"] == 0

    @pytest.mark.parametrize("ratio,expected", [
        (0.03, "muy_bajo"), (0.09, "muy_bajo"),
        (0.18, "bajo"), (0.30, "bajo"),
        (0.44, "moderado"), (0.60, "moderado"),
        (0.68, "alto"), (1.50, "alto"),
    ])
    def test_cost_tier_bands(self, ratio, expected):
        assert cost_tier(ratio) == expected

    def test_cost_tier_none_for_missing_data(self):
        assert cost_tier(None) is None

    def test_price_change_pct_computes_from_real_series(self):
        history = [{"date": "2026-11-02", "price": 110.0}, {"date": "2026-01-02", "price": 100.0}]
        result = price_change_pct(history)
        assert result["since_earliest_available_pct"] == 10.0
        assert result["days_of_history"] == 2

    def test_price_change_pct_empty_history_returns_none_not_zero(self):
        result = price_change_pct([])
        assert result["since_earliest_available_pct"] is None


# ---------------------------------------------------------------------------
# provider.py — 402 / 429 / 500 / timeout / empty / malformed
# ---------------------------------------------------------------------------

class TestProviderErrorHandling:
    def test_rejects_endpoint_outside_fase1_allowlist(self):
        with pytest.raises(ValueError):
            fetch("/etf/holdings", "SPY")

    def test_402_restricted(self):
        class Resp:
            status_code = 402
        with patch("app.services.etf.provider.requests.get", return_value=Resp()), \
             patch("app.services.etf.provider.FMP_KEY", "fake-key"):
            result = fetch("/etf/info", "SPY")
        assert result.ok is False
        assert result.reason == "restricted_402"

    def test_429_rate_limited(self):
        class Resp:
            status_code = 429
        with patch("app.services.etf.provider.requests.get", return_value=Resp()), \
             patch("app.services.etf.provider.FMP_KEY", "fake-key"):
            result = fetch("/etf/info", "SPY")
        assert result.reason == "rate_limited_429"

    def test_500_server_error(self):
        class Resp:
            status_code = 500
        with patch("app.services.etf.provider.requests.get", return_value=Resp()), \
             patch("app.services.etf.provider.FMP_KEY", "fake-key"):
            result = fetch("/etf/info", "SPY")
        assert result.reason == "server_error_5xx"

    def test_empty_200_response(self):
        class Resp:
            status_code = 200
            def json(self): return []
        with patch("app.services.etf.provider.requests.get", return_value=Resp()), \
             patch("app.services.etf.provider.FMP_KEY", "fake-key"):
            result = fetch("/etf/info", "SPY")
        assert result.ok is False
        assert result.reason == "empty"

    def test_malformed_json_body(self):
        class Resp:
            status_code = 200
            def json(self): raise ValueError("not json")
        with patch("app.services.etf.provider.requests.get", return_value=Resp()), \
             patch("app.services.etf.provider.FMP_KEY", "fake-key"):
            result = fetch("/etf/info", "SPY")
        assert result.reason == "malformed_body"

    def test_timeout(self):
        import requests
        with patch("app.services.etf.provider.requests.get", side_effect=requests.exceptions.Timeout()), \
             patch("app.services.etf.provider.FMP_KEY", "fake-key"):
            result = fetch("/etf/info", "SPY")
        assert result.reason == "timeout"

    def test_no_api_key_never_calls_requests(self):
        with patch("app.services.etf.provider.FMP_KEY", ""), \
             patch("app.services.etf.provider.requests.get") as mock_get:
            result = fetch("/etf/info", "SPY")
        assert result.reason == "no_api_key"
        mock_get.assert_not_called()

    def test_success_returns_parsed_data(self):
        class Resp:
            status_code = 200
            def json(self): return [{"symbol": "SPY"}]
        with patch("app.services.etf.provider.requests.get", return_value=Resp()), \
             patch("app.services.etf.provider.FMP_KEY", "fake-key"):
            result = fetch("/etf/info", "SPY")
        assert result.ok is True
        assert result.data == [{"symbol": "SPY"}]


# ---------------------------------------------------------------------------
# service.py — the orchestrator, including the Radar-separation requirement
# ---------------------------------------------------------------------------

def _mock_fetch_all_ok():
    def fake_fetch(path, symbol, **kw):
        if path == "/etf/info":
            return FMPResult(ok=True, data=[{
                "name": f"{symbol} ETF", "expenseRatio": 0.09, "assetsUnderManagement": 1e9,
                "nav": 100.0, "navCurrency": "USD", "inceptionDate": "2000-01-01",
                "holdingsCount": 500, "isActivelyTrading": True, "updatedAt": "2026-11-01",
            }])
        if path == "/etf/sector-weightings":
            return FMPResult(ok=True, data=[{"sector": "Technology", "weightPercentage": 40.0}, {"sector": "Health", "weightPercentage": 50.0}])
        if path == "/etf/country-weightings":
            return FMPResult(ok=True, data=[{"country": "United States", "weightPercentage": "95.0%"}])
        if path == "/profile":
            return FMPResult(ok=True, data=[{"symbol": symbol, "price": 100.0, "exchange": "AMEX", "isin": "US0000000000"}])
        if path == "/quote":
            return FMPResult(ok=True, data=[{"price": 100.0, "changePercentage": 1.0, "yearLow": 90.0, "yearHigh": 110.0, "volume": 1000}])
        if path == "/dividends":
            return FMPResult(ok=True, data=[{"date": "2026-09-01", "adjDividend": 1.0, "yield": 1.0, "frequency": "Quarterly"}])
        if path == "/historical-price-eod/light":
            return FMPResult(ok=True, data=[{"date": "2026-11-01", "price": 100.0}, {"date": "2026-01-01", "price": 90.0}])
        raise AssertionError(f"unexpected path {path}")
    return fake_fetch


class TestServiceOrchestration:
    @pytest.mark.parametrize("ticker", TEST_TICKERS)
    def test_all_test_tickers_build_a_complete_overview(self, ticker):
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=_mock_fetch_all_ok()):
            overview = get_etf_overview(ticker, use_cache=False)
        assert overview["ticker"] == ticker
        assert overview["data_quality"]["missing_fields"] == []
        assert overview["costs"]["expense_ratio_pct"] == 0.09
        assert overview["diversification"]["by_sector"]["top1_name"] == "Health"

    def test_suspicious_expense_ratio_flagged_not_hidden(self):
        """A real ETF charging >5% would be essentially unheard of — if
        FMP's expenseRatio field were ever misread as a different scale,
        this is the backstop that surfaces it instead of silently
        displaying a wrong number as if it were normal."""
        def fake_fetch(path, symbol, **kw):
            if path == "/etf/info":
                return FMPResult(ok=True, data=[{"name": "Weird ETF", "expenseRatio": 9.0}])
            return _mock_fetch_all_ok()(path, symbol, **kw)
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=fake_fetch):
            overview = get_etf_overview("SPY", use_cache=False)
        assert overview["data_quality"]["suspicious_expense_ratio"] is True
        assert overview["costs"]["expense_ratio_pct"] == 9.0  # still reported, just flagged

    def test_structural_and_price_cached_independently(self):
        """Fase 2A requirement: price data must refresh independently of
        structural data, not share one blended cache entry."""
        from app.services.etf.service import _fetch_structural, _fetch_price_data
        with patch("app.services.etf.service.fetch", side_effect=_mock_fetch_all_ok()) as mock_fetch:
            _fetch_structural("SPY", use_cache=True)
            _fetch_structural("SPY", use_cache=True)
        assert mock_fetch.call_count == 4  # only the 4 structural endpoints, cached on 2nd call
        with patch("app.services.etf.service.fetch", side_effect=_mock_fetch_all_ok()) as mock_fetch:
            _fetch_price_data("SPY", use_cache=True)
            _fetch_price_data("SPY", use_cache=True)
        assert mock_fetch.call_count == 3  # only the 3 price endpoints, cached on 2nd call

    def test_non_etf_ticker_raises(self):
        with patch("app.services.etf.service.classify_asset", return_value="equity"):
            with pytest.raises(NotAnETFError):
                get_etf_overview("AAPL", use_cache=False)

    def test_partial_provider_failure_is_tracked_not_hidden(self):
        def fake_fetch(path, symbol, **kw):
            if path == "/etf/info":
                return FMPResult(ok=False, reason="restricted_402")
            return _mock_fetch_all_ok()(path, symbol, **kw)
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=fake_fetch):
            overview = get_etf_overview("SPY", use_cache=False)
        assert "info" in overview["data_quality"]["missing_fields"]
        assert overview["data_quality"]["provider_errors"]["info"] == "restricted_402"
        assert overview["costs"]["expense_ratio_pct"] is None  # never fabricated

    def test_total_provider_outage_is_not_cached(self):
        def fake_fetch(path, symbol, **kw):
            return FMPResult(ok=False, reason="server_error_5xx")
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=fake_fetch) as mock_fetch:
            get_etf_overview("SPY", use_cache=True)
            get_etf_overview("SPY", use_cache=True)  # must NOT be served from cache
        assert mock_fetch.call_count == 14  # 7 endpoints x 2 full attempts, nothing cached in between

    def test_result_is_cached_on_success(self):
        """Fase 2A: structural and price groups are cached independently
        (not the whole overview as one unit) — classify_asset() itself
        runs every call (cheap, has its own 24h cache internally from
        Phase 0), but the 7 real FMP fetches must not repeat."""
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=_mock_fetch_all_ok()) as mock_fetch:
            get_etf_overview("SPY", use_cache=True)
            get_etf_overview("SPY", use_cache=True)
        assert mock_fetch.call_count == 7  # second call served entirely from cache

    def test_radar_valuation_pipeline_never_imported_by_etf_package(self):
        """Structural separation check: the ETF package must not import
        Nuvos Radar's valuation/quality engines."""
        import app.services.etf.service as svc
        import app.services.etf.provider as prov
        import app.services.etf.normalize as norm
        import app.services.etf.metrics as met
        import inspect

        for mod in (svc, prov, norm, met):
            src = inspect.getsource(mod)
            assert "app.services.valuation" not in src
            assert "app.services.quality" not in src
            assert "fundamental_analysis_service" not in src
