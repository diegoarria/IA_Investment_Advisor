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


class TestTransientFailuresNeverPersistAsNegative:
    """Fase 8-hotfix: the real production incident — a genuine 429 from
    FMP's own rate limit must never turn into a 10-minute-wrong "not an
    ETF" for a real ETF. Covers section 4's 12-point test list."""

    def test_1_etf_classifies_as_etf(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            if "/etf/info" in url:
                return _fmp_response(200, [{"symbol": "SPY"}])
            raise AssertionError("should never call /profile once /etf/info has data")
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("SPY") == ETF

    def test_2_equity_classifies_as_equity(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            if "/etf/info" in url:
                return _fmp_response(200, [])
            return _fmp_response(200, [{"symbol": "AAPL"}])
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("AAPL") == EQUITY

    def test_3_genuinely_unknown_ticker_both_confirmed_empty(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            return _fmp_response(200, [])  # a real 200, genuinely no match either way
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("ZZZZNOTREAL99") == UNKNOWN

    def test_4_http_429_does_not_cache_a_persistent_negative(self):
        """The exact production incident: FMP's real 300/min cap trips,
        returns 429 — must fall back (here, to UNKNOWN, no prior known
        classification) via the short cooldown, never the 10-minute
        confirmed-unknown TTL a real 'not found' would get."""
        def fake_get(url, params=None, headers=None, timeout=None):
            return _fmp_response(429, {"Error Message": "Limit Reach"})
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("SPY") == UNKNOWN
        # Confirm it's the SHORT cooldown, not the 10-minute confirmed-unknown
        # cache, by checking which key actually got set.
        from app.core import cache as cache_module
        assert cache_module.cache_get("asset_class:SPY") is None
        assert cache_module.cache_get("asset_class_cooldown:SPY") is True

    def test_5_timeout_does_not_cache_a_persistent_negative(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            raise TimeoutError("simulated timeout")
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("SPY") == UNKNOWN
        from app.core import cache as cache_module
        assert cache_module.cache_get("asset_class:SPY") is None

    def test_6_http_5xx_does_not_cache_a_persistent_negative(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            return _fmp_response(503, {"error": "upstream unavailable"})
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("SPY") == UNKNOWN
        from app.core import cache as cache_module
        assert cache_module.cache_get("asset_class:SPY") is None

    def test_7_shared_fmp_budget_exhausted_blocks_the_request_and_falls_back(self):
        """Integrates with app.core.fmp_budget — never makes a real HTTP
        call once the shared budget says no, and degrades the same way
        as any other transient failure."""
        with patch("app.core.fmp_budget.fmp_call_allowed", return_value=False), \
             patch("app.services.asset_classification.requests.get") as mock_get:
            assert classify_asset("SPY") == UNKNOWN
        mock_get.assert_not_called()

    def test_8_recovers_immediately_once_fmp_recovers(self):
        """After a transient failure, a fresh attempt (cooldown expired)
        that now succeeds must classify normally and cache the real
        answer — never stuck on the old failure."""
        from app.core import cache as cache_module
        state = {"fail": True}

        def fake_get(url, params=None, headers=None, timeout=None):
            if state["fail"]:
                return _fmp_response(429, {"Error Message": "Limit Reach"})
            if "/etf/info" in url:
                return _fmp_response(200, [{"symbol": "SPY"}])
            raise AssertionError("unreachable once etf/info confirms ETF")

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("SPY") == UNKNOWN
            # Simulate the cooldown window elapsing.
            cache_module.cache_delete("asset_class_cooldown:SPY")
            state["fail"] = False
            assert classify_asset("SPY") == ETF

    def test_9_falls_back_to_previously_confirmed_classification_during_an_outage(self):
        """A ticker confirmed ETF yesterday, then hit by a transient FMP
        failure today, must keep showing as ETF — never flip to UNKNOWN
        just because of a momentary provider hiccup. This is the exact
        user-visible harm from the real incident: SPY/QQQ/VOO going from
        working to 'not an ETF' and back, instead of just staying ETF."""
        from app.core import cache as cache_module
        cache_module.cache_set("asset_class_last_known:SPY", ETF, ttl=86400)

        def fake_get(url, params=None, headers=None, timeout=None):
            return _fmp_response(429, {"Error Message": "Limit Reach"})

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("SPY") == ETF

    def test_10_concurrent_requests_during_an_outage_all_get_a_safe_answer(self):
        """Several 'concurrent' calls (simulated sequentially, same net
        effect for this cache-backed design) during one outage must all
        resolve safely, whether or not every one of them happened to hit
        FMP — none may crash, and none may wait indefinitely."""
        def fake_get(url, params=None, headers=None, timeout=None):
            return _fmp_response(429, {"Error Message": "Limit Reach"})

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            results = [classify_asset("SPY") for _ in range(20)]
        assert all(r == UNKNOWN for r in results)

    def test_11_cooldown_prevents_a_retry_storm_against_fmp(self):
        """Section 3: once one request records a transient failure, 19
        more requests for the same ticker within the cooldown window must
        NOT each hit FMP again — only the first one does."""
        call_count = {"n": 0}

        def fake_get(url, params=None, headers=None, timeout=None):
            call_count["n"] += 1
            return _fmp_response(429, {"Error Message": "Limit Reach"})

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            for _ in range(20):
                classify_asset("SPY")
        # First call: 2 real HTTP attempts (etf/info, then profile, both
        # 429). Every subsequent call within the cooldown must short-
        # circuit on the cooldown key alone, making zero further calls.
        assert call_count["n"] == 2

    def test_12_no_regression_radar_etf_explorer_distribucion_still_call_classify_asset_the_same_way(self):
        """Confirms the public contract (function name, return values,
        call signature) every existing caller — Radar's fundamental-
        analysis guard, ETF Explorer, Distribución's combiner — depends on
        is unchanged. The callers' own test suites (test_asset_classification
        TestGuardIntegration, test_etf_service.py, test_portfolio_exposure_
        combiner.py) already exercise this against the real function, not
        a mock, so a signature/behavior break there would fail those too."""
        import inspect
        sig = inspect.signature(classify_asset)
        assert list(sig.parameters) == ["ticker"]

        def fake_get(url, params=None, headers=None, timeout=None):
            if "/etf/info" in url:
                return _fmp_response(200, [])
            return _fmp_response(200, [{"symbol": "AAPL"}])
        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("AAPL") in (EQUITY, ETF, UNKNOWN)


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


class TestDualClassTickerSuffixFallback:
    """Fase 8-hotfix (2026-11-12): confirmed live against FMP — a dual-
    class suffix written with a dot ("BRK.B") is genuinely unrecognized
    by /etf/info, /profile AND /quote (402 "special endpoint" there);
    the real symbol is the hyphen form ("BRK-B"). These tests cover
    section 3's exact list: BRK.B, BRK.A, plain tickers, ADRs, ETFs,
    exchange-suffixed tickers, correct classification, no duplicate
    queries for tickers that already work."""

    def test_brk_b_retries_with_hyphen_and_classifies_as_equity(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append((url, params["symbol"]))
            if params["symbol"] == "BRK.B":
                return _fmp_response(200, [])  # genuinely empty, both endpoints
            if params["symbol"] == "BRK-B":
                if "/etf/info" in url:
                    return _fmp_response(200, [])
                return _fmp_response(200, [{"symbol": "BRK-B", "companyName": "Berkshire Hathaway Inc."}])
            raise AssertionError(f"unexpected symbol queried: {params['symbol']}")

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("BRK.B") == EQUITY

        # Exactly 4 calls: 2 for the original (both empty), 2 for the
        # canonical retry (etf/info empty, profile real) — never more.
        assert len(calls) == 4
        assert ("BRK.B" in [s for _, s in calls])
        assert ("BRK-B" in [s for _, s in calls])

    def test_brk_a_same_pattern_as_brk_b(self):
        """Confirms the fix is general (any single-letter dual-class
        suffix), not hardcoded to 'B' specifically."""
        def fake_get(url, params=None, headers=None, timeout=None):
            if params["symbol"] == "BRK.A":
                return _fmp_response(200, [])
            if params["symbol"] == "BRK-A":
                if "/etf/info" in url:
                    return _fmp_response(200, [])
                return _fmp_response(200, [{"symbol": "BRK-A", "companyName": "Berkshire Hathaway Inc."}])
            raise AssertionError(f"unexpected symbol: {params['symbol']}")

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("BRK.A") == EQUITY

    def test_plain_ticker_without_dot_never_triggers_a_retry(self):
        """A ticker with no suffix at all (the overwhelming majority)
        must never generate a second request — canonicalize_ticker_suffix
        is a no-op for it."""
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            if "/etf/info" in url:
                return _fmp_response(200, [])
            return _fmp_response(200, [{"symbol": "AAPL", "companyName": "Apple Inc."}])

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("AAPL") == EQUITY
        assert calls == ["AAPL", "AAPL"]  # etf/info + profile, never a 3rd/4th call

    def test_ticker_that_already_works_as_entered_is_never_retried(self):
        """A dot-suffixed symbol that classifies successfully on the
        FIRST attempt (e.g. a real ETF) must never trigger the fallback
        — never 'fixes' something that wasn't broken."""
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            if "/etf/info" in url:
                return _fmp_response(200, [{"symbol": "SOMEDOT.X", "name": "Some Real Fund"}])
            raise AssertionError("must never call /profile once /etf/info confirms ETF")

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("SOMEDOT.X") == ETF
        assert calls == ["SOMEDOT.X"]  # single call, no retry attempted

    def test_adr_classifies_normally_no_dot_suffix_involved(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            if "/etf/info" in url:
                return _fmp_response(200, [])
            return _fmp_response(200, [{"symbol": "BABA", "companyName": "Alibaba Group Holding Limited"}])

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("BABA") == EQUITY

    def test_etf_classifies_normally_no_dot_suffix_involved(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            if "/etf/info" in url:
                return _fmp_response(200, [{"symbol": "VOO", "name": "Vanguard S&P 500 ETF"}])
            raise AssertionError("should never call /profile once /etf/info has data")

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("VOO") == ETF

    def test_exchange_suffixed_ticker_that_genuinely_has_no_match_stays_unknown_not_fabricated(self):
        """A ticker shaped like a dual-class suffix (single letter after
        a dot) but that ISN'T really one — both the original AND the
        canonicalized retry genuinely fail — must land on an honest
        UNKNOWN, never a fabricated classification."""
        def fake_get(url, params=None, headers=None, timeout=None):
            return _fmp_response(200, [])  # every symbol, every endpoint — genuinely nothing

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("VOD.L") == UNKNOWN

    def test_retry_does_not_happen_when_original_failure_was_transient(self):
        """A transient failure (429/timeout/5xx) on the ORIGINAL symbol
        must go through the existing cooldown/last-known path, never the
        dot-suffix retry — the retry only exists for a CONFIRMED empty
        result, not an inconclusive one."""
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            return _fmp_response(429, {"Error Message": "Limit Reach"})

        with patch("app.services.asset_classification.requests.get", side_effect=fake_get):
            assert classify_asset("BRK.B") == UNKNOWN
        # Only the original symbol was ever queried — the dot-suffix
        # retry path is for confirmed-empty, not transient, failures.
        assert set(calls) == {"BRK.B"}
