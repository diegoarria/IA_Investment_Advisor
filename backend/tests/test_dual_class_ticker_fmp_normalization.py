"""Fase 8-hotfix (2026-11-12): BRK.B stayed stuck 'unclassified_asset' in
Distribución even after the earlier transient-failure cooldown hotfix —
root cause confirmed live against FMP (not assumed): a dual-class suffix
written with a dot ("BRK.B") returns a genuinely empty /etf/info and
/profile, and a 402 "special endpoint... not available under your current
subscription" on /quote. FMP's real symbol is the hyphen form ("BRK-B").

canonicalize_ticker_suffix already existed (company_valuation_service.py,
Fase Radar 2026-10-21, same root cause for company_valuations rows) but
was never applied to portfolio_exposure's equity price/profile lookups.
These tests cover get_fmp_quote_price (financial_data_service.py) and
get_equity_profile (portfolio_exposure/equity_profile.py) — the two
remaining FMP call sites with this gap. classify_asset's own coverage
lives in test_asset_classification.py."""
from unittest.mock import patch

import pytest

from app.services.financial_data_service import get_fmp_quote_price
from app.services.portfolio_exposure.equity_profile import get_equity_profile


def _resp(status, body):
    class _R:
        status_code = status
        def json(self_inner):
            return body
    return _R()


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.core import cache as cache_module
    cache_module._mem.clear()
    yield
    cache_module._mem.clear()


class TestGetFmpQuotePriceDualClassFallback:
    def test_brk_b_retries_with_hyphen_and_returns_the_real_price(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            if params["symbol"] == "BRK.B":
                return _resp(402, {"Error Message": "Special Endpoint"})
            if params["symbol"] == "BRK-B":
                return _resp(200, [{"symbol": "BRK-B", "price": 590.08}])
            raise AssertionError(f"unexpected symbol: {params['symbol']}")

        with patch("app.services.financial_data_service.requests.get", side_effect=fake_get):
            assert get_fmp_quote_price("BRK.B") == 590.08
        assert calls == ["BRK.B", "BRK-B"]  # original first, retry only after it fails

    def test_plain_ticker_never_retried(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            return _resp(200, [{"symbol": "AAPL", "price": 150.0}])

        with patch("app.services.financial_data_service.requests.get", side_effect=fake_get):
            assert get_fmp_quote_price("AAPL") == 150.0
        assert calls == ["AAPL"]  # single call — no duplicate query

    def test_ticker_already_working_with_a_dot_shape_is_never_retried(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            return _resp(200, [{"symbol": "SOMEDOT.X", "price": 42.0}])

        with patch("app.services.financial_data_service.requests.get", side_effect=fake_get):
            assert get_fmp_quote_price("SOMEDOT.X") == 42.0
        assert calls == ["SOMEDOT.X"]

    def test_genuinely_unavailable_price_stays_none_never_fabricated(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            return _resp(200, [])

        with patch("app.services.financial_data_service.requests.get", side_effect=fake_get):
            assert get_fmp_quote_price("VOD.L") is None

    def test_result_is_cached_under_the_original_symbol_not_the_canonical_one(self):
        call_count = {"n": 0}

        def fake_get(url, params=None, headers=None, timeout=None):
            call_count["n"] += 1
            if params["symbol"] == "BRK.B":
                return _resp(402, {})
            return _resp(200, [{"symbol": "BRK-B", "price": 590.08}])

        with patch("app.services.financial_data_service.requests.get", side_effect=fake_get):
            assert get_fmp_quote_price("BRK.B") == 590.08
            assert get_fmp_quote_price("BRK.B") == 590.08  # second call: cache hit
        assert call_count["n"] == 2  # only the FIRST classify_asset("BRK.B") made real calls


class TestGetEquityProfileDualClassFallback:
    def test_brk_b_retries_with_hyphen_and_returns_the_real_profile(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            if params["symbol"] == "BRK.B":
                return _resp(200, [])
            if params["symbol"] == "BRK-B":
                return _resp(200, [{"symbol": "BRK-B", "sector": "Financial Services", "country": "US", "currency": "USD", "companyName": "Berkshire Hathaway Inc."}])
            raise AssertionError(f"unexpected symbol: {params['symbol']}")

        with patch("app.services.portfolio_exposure.equity_profile.requests.get", side_effect=fake_get):
            result = get_equity_profile("BRK.B")
        assert result["company_name"] == "Berkshire Hathaway Inc."
        assert result["currency"] == "USD"
        assert calls == ["BRK.B", "BRK-B"]

    def test_plain_adr_ticker_never_retried(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            return _resp(200, [{"symbol": "BABA", "sector": "Technology", "country": "KY", "currency": "USD", "companyName": "Alibaba Group Holding Limited"}])

        with patch("app.services.portfolio_exposure.equity_profile.requests.get", side_effect=fake_get):
            result = get_equity_profile("BABA")
        assert result["company_name"] == "Alibaba Group Holding Limited"
        assert calls == ["BABA"]

    def test_genuinely_unavailable_profile_stays_empty_dict_never_fabricated(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            return _resp(200, [])

        with patch("app.services.portfolio_exposure.equity_profile.requests.get", side_effect=fake_get):
            assert get_equity_profile("VOD.L") == {}
