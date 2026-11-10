"""
Tests — app.services.analyst_estimates_service (Nuvos AI Fair Value Engine
redesign, Incremento 3; P0 latency/resilience fix, 2026-11-10).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md. Mocks
yfinance entirely — no real network calls.
"""
import concurrent.futures
import time
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

import app.services.analyst_estimates_service as aes
from app.services.analyst_estimates_service import get_analyst_estimates, _next_year_growth


def _estimate_df(rows: dict[str, dict]) -> pd.DataFrame:
    """Builds a DataFrame shaped like yfinance's earnings_estimate/
    revenue_estimate — index = period label, columns avg/low/high/growth."""
    return pd.DataFrame.from_dict(rows, orient="index")


@pytest.fixture(autouse=True)
def _clear_analyst_estimates_cache():
    """2026-11-10: get_analyst_estimates now writes a "last known good"
    cache entry and a failure-cooldown marker (both keyed only by ticker,
    via app.core.cache's process-local in-memory fallback in this test
    environment). Several tests below reuse "AAPL" — without clearing
    these keys between tests, a cache entry written by one test (e.g. the
    first, successful fetch) would leak into a later test expecting a
    clean None (e.g. the "yfinance raised, no prior good data" case),
    exactly the failure mode this fixture prevents."""
    from app.core.cache import _mem
    def _clear():
        for k in list(_mem.keys()):
            if k.startswith("analyst_est:"):
                del _mem[k]
    _clear()
    yield
    _clear()


class TestGetAnalystEstimates:
    def test_returns_normalized_estimates_from_yfinance(self):
        eps_df = _estimate_df({
            "0y": {"avg": 5.0, "low": 4.5, "high": 5.5, "growth": 0.05},
            "+1y": {"avg": 5.5, "low": 5.0, "high": 6.0, "growth": 0.10},
        })
        rev_df = _estimate_df({
            "0y": {"avg": 1000.0, "low": 900.0, "high": 1100.0, "growth": 0.03},
            "+1y": {"avg": 1100.0, "low": 1000.0, "high": 1200.0, "growth": 0.10},
        })
        mock_ticker = MagicMock()
        mock_ticker.earnings_estimate = eps_df
        mock_ticker.revenue_estimate = rev_df
        mock_ticker.info = {"numberOfAnalystOpinions": 12}

        with patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_analyst_estimates("AAPL")

        assert result is not None
        assert result.source == "yfinance"
        assert len(result.eps_estimates) == 2
        assert len(result.revenue_estimates) == 2
        assert result.n_analysts == 12
        assert result.revenue_growth_next_year_pct == pytest.approx(10.0)
        assert result.eps_growth_next_year_pct == pytest.approx(10.0)

    def test_returns_none_when_yfinance_has_nothing(self):
        mock_ticker = MagicMock()
        mock_ticker.earnings_estimate = pd.DataFrame()
        mock_ticker.revenue_estimate = pd.DataFrame()
        mock_ticker.info = {}

        with patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_analyst_estimates("OBSCURETICKER")

        assert result is None

    def test_returns_none_on_yfinance_exception_never_raises(self):
        with patch("yfinance.Ticker", side_effect=Exception("network down")):
            result = get_analyst_estimates("AAPL")
        assert result is None

    def test_degrades_gracefully_when_only_eps_estimate_available(self):
        eps_df = _estimate_df({"+1y": {"avg": 5.5, "low": 5.0, "high": 6.0, "growth": 0.08}})
        mock_ticker = MagicMock()
        mock_ticker.earnings_estimate = eps_df
        mock_ticker.revenue_estimate = pd.DataFrame()
        mock_ticker.info = {}

        with patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_analyst_estimates("AAPL")

        assert result is not None
        assert result.eps_growth_next_year_pct == pytest.approx(8.0)
        assert result.revenue_growth_next_year_pct is None


class TestResilienceAgainstYahooRateLimiting:
    """2026-11-10 P0: Yahoo was observed returning 429 on earningsTrend
    broadly (not ticker-specific), costing 12-22s+ per call under
    yfinance's own internal retry. These confirm the fix bounds the wait,
    preserves a prior good answer with its real date, and recovers
    automatically once the cooldown expires — matching PASO 5's listed
    scenarios (Yahoo normal / 429 / hanging >20s / provider recovering)."""

    def test_timeout_budget_is_respected_when_yahoo_hangs(self, monkeypatch):
        monkeypatch.setattr(aes, "ANALYST_ESTIMATES_TIMEOUT_S", 0.2)

        def _hangs(*a, **k):
            time.sleep(5)  # simulates Yahoo hanging past the 8s+ yfinance retries this session observed live
            raise AssertionError("should never reach this far inside the timeout window")

        with patch("yfinance.Ticker", side_effect=_hangs):
            started = time.monotonic()
            result = get_analyst_estimates("AAPL")
            elapsed = time.monotonic() - started

        assert result is None  # no prior good cache exists yet in this test
        assert elapsed < 1.0, "must not wait anywhere close to the simulated 5s hang"

    def test_timeout_does_not_cancel_the_underlying_thread(self, monkeypatch):
        """Honest verification of the documented caveat: future.result(timeout=...)
        stops the CALLER from waiting, it does not kill the worker thread —
        the submitted task keeps running to completion in the background.
        This confirms that behavior explicitly rather than assuming it."""
        monkeypatch.setattr(aes, "ANALYST_ESTIMATES_TIMEOUT_S", 0.1)
        finished = {"done": False}

        def _slow_but_finishes(*a, **k):
            time.sleep(0.4)
            finished["done"] = True
            return None

        with patch("yfinance.Ticker", side_effect=_slow_but_finishes):
            get_analyst_estimates("AAPL")
            assert finished["done"] is False, "the call should not have finished yet right after the 0.1s timeout"
            time.sleep(0.6)
            assert finished["done"] is True, "the underlying thread kept running in the background after the caller gave up"

    def test_429_falls_back_to_last_known_good_with_its_real_date(self, monkeypatch):
        eps_df = _estimate_df({"+1y": {"avg": 5.5, "low": 5.0, "high": 6.0, "growth": 0.08}})
        mock_ticker = MagicMock()
        mock_ticker.earnings_estimate = eps_df
        mock_ticker.revenue_estimate = pd.DataFrame()
        mock_ticker.info = {}
        with patch("yfinance.Ticker", return_value=mock_ticker):
            good = get_analyst_estimates("AAPL")
        assert good is not None and good.stale is False
        real_as_of = good.as_of

        # Now Yahoo starts 429ing (simulated as a raised exception from the client).
        with patch("yfinance.Ticker", side_effect=Exception("HTTPError: 429 Too Many Requests")):
            degraded = get_analyst_estimates("AAPL")

        assert degraded is not None, "must serve the last known good estimate instead of nothing"
        assert degraded.stale is True
        assert degraded.as_of == real_as_of, "the date must be the REAL original fetch date, not fabricated/refreshed"
        assert degraded.eps_growth_next_year_pct == pytest.approx(8.0)  # the real number, not zero, not invented

    def test_no_prior_good_data_degrades_to_none_not_zero(self):
        with patch("yfinance.Ticker", side_effect=Exception("HTTPError: 429 Too Many Requests")):
            result = get_analyst_estimates("BRANDNEWTICKER")
        assert result is None  # never a fabricated 0% growth

    def test_failure_sets_a_cooldown_that_skips_the_next_yahoo_attempt(self, monkeypatch):
        calls = {"n": 0}

        def _always_fails(*a, **k):
            calls["n"] += 1
            raise Exception("429")

        with patch("yfinance.Ticker", side_effect=_always_fails):
            get_analyst_estimates("AAPL")
            assert calls["n"] == 1
            get_analyst_estimates("AAPL")  # within the cooldown window — must NOT call yfinance again
            assert calls["n"] == 1, "a second request during the cooldown must not hit Yahoo again (no thundering herd)"

    def test_provider_recovering_after_cooldown_expires(self, monkeypatch):
        monkeypatch.setattr(aes, "ANALYST_ESTIMATES_FAILURE_COOLDOWN_S", 0.05)
        with patch("yfinance.Ticker", side_effect=Exception("429")):
            get_analyst_estimates("AAPL")

        time.sleep(0.1)  # let the short cooldown expire

        eps_df = _estimate_df({"+1y": {"avg": 9.0, "low": 8.0, "high": 10.0, "growth": 0.20}})
        mock_ticker = MagicMock()
        mock_ticker.earnings_estimate = eps_df
        mock_ticker.revenue_estimate = pd.DataFrame()
        mock_ticker.info = {}
        with patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_analyst_estimates("AAPL")

        assert result is not None and result.stale is False, "recovery must be automatic once the cooldown TTL expires — no manual reset"
        assert result.eps_growth_next_year_pct == pytest.approx(20.0)

    def test_genuinely_no_coverage_does_not_set_a_cooldown(self, monkeypatch):
        """Distinguishes 'yfinance answered, there's just no analyst
        coverage for this ticker' (not a failure) from a transient
        provider error — PASO 2's explicit requirement. A legitimate empty
        result must not suppress the NEXT call the way a real failure does."""
        mock_ticker = MagicMock()
        mock_ticker.earnings_estimate = pd.DataFrame()
        mock_ticker.revenue_estimate = pd.DataFrame()
        mock_ticker.info = {}
        calls = {"n": 0}

        def _empty(*a, **k):
            calls["n"] += 1
            return mock_ticker

        with patch("yfinance.Ticker", side_effect=_empty):
            get_analyst_estimates("NOANALYSTCOVERAGE")
            get_analyst_estimates("NOANALYSTCOVERAGE")

        assert calls["n"] == 2, "a legitimate empty result must not trip the failure cooldown — each call should really ask again"

    def test_concurrent_requests_to_the_same_ticker_do_not_crash_or_duplicate_cooldown_writes(self):
        """PASO 5: 'varias solicitudes concurrentes al mismo ticker' — the
        shared pool + cache must tolerate genuine concurrent callers, not
        just sequential ones."""
        import concurrent.futures as cf

        with patch("yfinance.Ticker", side_effect=Exception("429")):
            with cf.ThreadPoolExecutor(max_workers=8) as ex:
                results = list(ex.map(lambda _: get_analyst_estimates("AAPL"), range(8)))

        assert all(r is None for r in results)  # no prior good cache, every caller gets a clean None, nothing raised

    def test_no_new_threadpool_created_per_request(self):
        """PASO 1 explicit constraint: no ThreadPoolExecutor per call — the
        shared, module-level pool is created exactly once at import."""
        pool_before = aes._ESTIMATES_TIMEOUT_POOL
        assert isinstance(pool_before, concurrent.futures.ThreadPoolExecutor)
        with patch("yfinance.Ticker", side_effect=Exception("429")):
            get_analyst_estimates("AAPL")
            get_analyst_estimates("AAPL")
        assert aes._ESTIMATES_TIMEOUT_POOL is pool_before, "the pool instance must be unchanged across calls"


class TestNextYearGrowth:
    def test_prefers_second_entry_when_two_present(self):
        assert _next_year_growth([{"growth": 3.0}, {"growth": 10.0}]) == 10.0

    def test_falls_back_to_first_entry_when_only_one_present(self):
        assert _next_year_growth([{"growth": 7.0}]) == 7.0

    def test_none_when_no_entries(self):
        assert _next_year_growth([]) is None
