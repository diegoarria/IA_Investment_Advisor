"""Nuvos ETF Phase 0 — asset classification + the guard that keeps ETFs
out of Nuvos Radar's stock valuation engine."""
from unittest.mock import patch

import pytest

from app.services.asset_classification import (
    classify_asset,
    EQUITY,
    ETF,
    UNKNOWN,
    etf_placeholder_response,
)


def _fmp_response(status, body):
    """Builds a fake requests.Response-like object for mocking requests.get."""
    class _Resp:
        status_code = status
        def json(self_inner):
            if isinstance(body, Exception):
                raise body
            return body
    return _Resp()


@pytest.fixture(autouse=True)
def _clear_cache():
    """classify_asset caches by ticker — each test needs a clean slate so
    one test's result can't leak into another's assertion."""
    from app.core import cache as cache_module
    cache_module._mem.clear()
    yield
    cache_module._mem.clear()


class TestEquities:
    @pytest.mark.parametrize("ticker", ["AAPL", "MSFT", "NVDA"])
    def test_known_equity_classifies_as_equity(self, ticker):
        def fake_get(url, params=None, headers=None, timeout=None):
            if "/etf/info" in url:
                return _fmp_response(200, [])
            if "/profile" in url:
                return _fmp_response(200, [{"symbol": ticker, "companyName": "x"}])
            raise AssertionError(f"unexpected FMP path: {url}")

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset(ticker) == EQUITY


class TestETFs:
    @pytest.mark.parametrize("ticker", ["SPY", "QQQ", "VOO", "BOTZ"])
    def test_known_etf_classifies_as_etf(self, ticker):
        def fake_get(url, params=None, headers=None, timeout=None):
            if "/etf/info" in url:
                return _fmp_response(200, [{"symbol": ticker, "name": "some etf"}])
            raise AssertionError("should never call /profile once /etf/info has data")

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset(ticker) == ETF

    def test_etf_placeholder_response_shape(self):
        resp = etf_placeholder_response("SPY")
        assert resp["is_etf"] is True
        assert resp["ticker"] == "SPY"
        assert "ETF" in resp["message"]
        assert "dcf" not in resp  # never looks like a real valuation payload


class TestUnknownAndFailureModes:
    def test_nonexistent_ticker_is_unknown(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            return _fmp_response(200, [])  # both /etf/info and /profile empty

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("ZZZZNOTREAL99") == UNKNOWN

    def test_empty_ticker_is_unknown_without_any_fmp_call(self):
        with patch("app.services.asset_classification.requests.get") as mock_get:
            assert classify_asset("") == UNKNOWN
            assert classify_asset("   ") == UNKNOWN
            mock_get.assert_not_called()

    def test_fmp_timeout_on_etf_info_still_tries_profile_then_unknown(self):
        """A transient provider hiccup must degrade to UNKNOWN, never to a
        silent misclassification as ETF or EQUITY."""
        calls = []
        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(url)
            if "/etf/info" in url:
                raise TimeoutError("simulated FMP timeout")
            return _fmp_response(200, [])  # /profile also empty -> unknown
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("AAPL") == UNKNOWN
            assert any("/etf/info" in c for c in calls)
            assert any("/profile" in c for c in calls)

    def test_fmp_http_500_treated_as_inconclusive_not_crash(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            return _fmp_response(500, {"Error Message": "server error"})
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("AAPL") == UNKNOWN  # never raises

    def test_malformed_json_body_treated_as_inconclusive_not_crash(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            return _fmp_response(200, ValueError("not json"))
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("AAPL") == UNKNOWN  # never raises

    def test_incomplete_etf_info_dict_response_not_a_list_is_treated_as_inconclusive(self):
        """FMP occasionally returns a bare dict (e.g. an error body) instead
        of the documented array shape — must not be mistaken for ETF data."""
        def fake_get(url, params=None, headers=None, timeout=None):
            if "/etf/info" in url:
                return _fmp_response(200, {"Error Message": "something"})
            return _fmp_response(200, [{"symbol": "AAPL"}])
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("AAPL") == EQUITY

    def test_no_api_key_never_crashes(self):
        with patch("app.services.asset_classification.FMP_KEY", ""):
            assert classify_asset("AAPL") == UNKNOWN

    def test_ambiguous_ticker_both_endpoints_have_data_prefers_etf(self):
        """If FMP's own ETF-identification endpoint says yes, trust it —
        don't let a secondary signal override the purpose-built one."""
        def fake_get(url, params=None, headers=None, timeout=None):
            if "/etf/info" in url:
                return _fmp_response(200, [{"symbol": "WEIRD"}])
            return _fmp_response(200, [{"symbol": "WEIRD"}])
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("WEIRD") == ETF

    def test_result_is_cached_second_call_makes_no_fmp_request(self):
        call_count = {"n": 0}
        def fake_get(url, params=None, headers=None, timeout=None):
            call_count["n"] += 1
            if "/etf/info" in url:
                return _fmp_response(200, [{"symbol": "SPY"}])
            return _fmp_response(200, [])
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("SPY") == ETF
            assert classify_asset("SPY") == ETF
        assert call_count["n"] == 1  # second call served from cache


class TestGuardIntegration:
    """Confirms the single choke point in get_fundamental_analysis() never
    lets an ETF reach the stock valuation engine — this is the property
    the whole Phase 0 exists to guarantee."""

    def test_etf_ticker_never_calls_get_financials(self):
        from app.services import fundamental_analysis_service as fas

        with patch("app.services.asset_classification.classify_asset", return_value=ETF), \
             patch.object(fas, "get_financials") as mock_get_financials:
            result = fas.get_fundamental_analysis("SPY")

        mock_get_financials.assert_not_called()
        assert result["is_etf"] is True
        assert result["ticker"] == "SPY"
        assert "dcf" not in result

    def test_equity_ticker_unaffected_by_the_guard(self):
        """Sanity check that the guard doesn't accidentally block real
        equities — mocks classify_asset to EQUITY and confirms the normal
        path (get_financials) is still reached and its failure propagates
        as the pre-existing None-return, not an ETF placeholder."""
        from app.services import fundamental_analysis_service as fas

        with patch("app.services.asset_classification.classify_asset", return_value=EQUITY), \
             patch.object(fas, "get_financials", side_effect=RuntimeError("boom")):
            result = fas.get_fundamental_analysis("AAPL")

        assert result is None  # pre-existing behavior: exception -> None, unchanged

    def test_unknown_classification_does_not_block_a_real_ticker(self):
        """UNKNOWN (ticker exists but FMP was inconclusive, or a transient
        failure) must fail OPEN for equities — never permanently block a
        valid ticker just because classification itself couldn't be
        confirmed this one time."""
        from app.services import fundamental_analysis_service as fas

        with patch("app.services.asset_classification.classify_asset", return_value=UNKNOWN), \
             patch.object(fas, "get_financials", side_effect=RuntimeError("would have run")) as mock_gf:
            fas.get_fundamental_analysis("AAPL")

        mock_gf.assert_called_once()  # proceeded past the guard, as intended for UNKNOWN
