"""
Regression tests — cost audit, 2026-09-11: Diego's explicit, zero-tolerance
requirement for the Oportunidades screen ("$0.000000... ni 1 solo gasto")
is that NOTHING on it may spend a real Claude token after market close.
The three cache-prewarm jobs (job_prewarm_quick_analysis_default,
job_prewarm_company_diagnostic_popular, job_prewarm_nif_dashboard_default)
fire immediately on every worker.py restart by design — a deploy at any
hour must never trigger their premium/AI-tier branch when the market is
closed. These tests lock in that gate without touching real
Finnhub/Anthropic/Redis.
"""
import worker
import app.api.routes.market as market_module
import app.api.routes.screener as screener_module
import app.services.undervalued_screener_service as undervalued_screener_service
from app.services import nif_service


def _no_cache(*args, **kwargs):
    return None


class TestWeeklyRefreshJobRespectsMarketHoursToo:
    """Diego, 2026-09-11: the absolute rule has no exception, including
    this job's own real, intentional weekly AI blurb generation. It's
    scheduled Sunday — the market is ALWAYS closed then — so as currently
    scheduled this must never submit a blurb batch; only the real, free
    DCF/roster refresh runs."""

    async def test_sunday_run_never_submits_blurbs(self, monkeypatch):
        monkeypatch.setattr(market_module, "_is_market_open", lambda: False)

        submit_blurbs_seen = []
        async def _tracking_refresh(submit_blurbs=True):
            submit_blurbs_seen.append(submit_blurbs)
        monkeypatch.setattr(undervalued_screener_service, "refresh_undervalued_screener", _tracking_refresh)

        await worker.job_refresh_undervalued_screener()

        assert submit_blurbs_seen == [False]

    async def test_run_during_market_hours_does_submit_blurbs(self, monkeypatch):
        monkeypatch.setattr(market_module, "_is_market_open", lambda: True)

        submit_blurbs_seen = []
        async def _tracking_refresh(submit_blurbs=True):
            submit_blurbs_seen.append(submit_blurbs)
        monkeypatch.setattr(undervalued_screener_service, "refresh_undervalued_screener", _tracking_refresh)

        await worker.job_refresh_undervalued_screener()

        assert submit_blurbs_seen == [True]


class TestQuickAnalysisPrewarmMarketHoursGate:
    async def test_market_closed_never_builds_the_premium_ai_tier(self, monkeypatch):
        monkeypatch.setattr(market_module, "_is_market_open", lambda: False)
        monkeypatch.setattr(worker, "_QUICK_ANALYSIS_POPULAR_TICKERS", ["AAPL"])
        monkeypatch.setattr(worker, "_cache_get_resilient", _fake_cache_get_resilient(_no_cache))

        build_calls = []
        async def _tracking_build(ticker, lang, use_ai=True):
            build_calls.append(use_ai)
            return {"ticker": ticker}
        monkeypatch.setattr(screener_module, "_build_quick_analysis", _tracking_build)
        monkeypatch.setattr(screener_module, "_quick_analysis_cache_key", lambda ticker, lang, tier: f"k:{ticker}:{lang}:{tier}")
        monkeypatch.setattr(screener_module, "_latest_reported_earnings_period", lambda ticker: "2026Q2")

        from app.core import cache as cache_module
        monkeypatch.setattr(cache_module, "cache_set", lambda *a, **k: None)

        await worker.job_prewarm_quick_analysis_default()

        # One ticker x 2 languages x free-tier-only — never use_ai=True
        assert build_calls == [False, False]

    async def test_market_open_still_builds_both_tiers(self, monkeypatch):
        monkeypatch.setattr(market_module, "_is_market_open", lambda: True)
        monkeypatch.setattr(worker, "_QUICK_ANALYSIS_POPULAR_TICKERS", ["AAPL"])
        monkeypatch.setattr(worker, "_cache_get_resilient", _fake_cache_get_resilient(_no_cache))

        build_calls = []
        async def _tracking_build(ticker, lang, use_ai=True):
            build_calls.append(use_ai)
            return {"ticker": ticker}
        monkeypatch.setattr(screener_module, "_build_quick_analysis", _tracking_build)
        monkeypatch.setattr(screener_module, "_quick_analysis_cache_key", lambda ticker, lang, tier: f"k:{ticker}:{lang}:{tier}")
        monkeypatch.setattr(screener_module, "_latest_reported_earnings_period", lambda ticker: "2026Q2")

        from app.core import cache as cache_module
        monkeypatch.setattr(cache_module, "cache_set", lambda *a, **k: None)

        await worker.job_prewarm_quick_analysis_default()

        # One ticker x 2 languages x both tiers — market is open
        assert sorted(build_calls) == [False, False, True, True]


class TestCompanyDiagnosticPrewarmMarketHoursGate:
    async def test_market_closed_never_builds_the_premium_ai_tier(self, monkeypatch):
        monkeypatch.setattr(market_module, "_is_market_open", lambda: False)
        monkeypatch.setattr(worker, "_QUICK_ANALYSIS_POPULAR_TICKERS", ["AAPL"])
        monkeypatch.setattr(worker, "_cache_get_resilient", _fake_cache_get_resilient(_no_cache))

        result_calls = []
        async def _tracking_result(ticker, lang, user_id, use_ai=True):
            result_calls.append(use_ai)
            return {"ticker": ticker}
        monkeypatch.setattr(screener_module, "_company_diagnostic_result", _tracking_result)
        monkeypatch.setattr(screener_module, "_company_diagnostic_cache_key", lambda ticker, lang, tier: f"k:{ticker}:{lang}:{tier}")
        monkeypatch.setattr(screener_module, "_latest_reported_earnings_period", lambda ticker: "2026Q2")

        await worker.job_prewarm_company_diagnostic_popular()

        assert result_calls == [False, False]  # 2 languages, free-tier-only


class TestNifDashboardPrewarmMarketHoursGate:
    async def test_market_closed_skips_the_whole_job(self, monkeypatch):
        # build_nif_dashboard has no free/deterministic tier at all — it's
        # always 3 real AI calls, so the whole job must no-op outside
        # market hours, not just one branch of it.
        monkeypatch.setattr(market_module, "_is_market_open", lambda: False)

        build_calls = []
        async def _tracking_build(ticker, lang):
            build_calls.append(ticker)
            return {"ticker": ticker}
        monkeypatch.setattr(nif_service, "build_nif_dashboard", _tracking_build)

        await worker.job_prewarm_nif_dashboard_default()

        assert build_calls == []

    async def test_market_open_runs_normally(self, monkeypatch):
        monkeypatch.setattr(market_module, "_is_market_open", lambda: True)
        monkeypatch.setattr(worker, "_cache_get_resilient", _fake_cache_get_resilient(_no_cache))
        monkeypatch.setattr(screener_module, "_nif_dashboard_cache_key", lambda ticker, lang: f"k:{ticker}:{lang}")
        monkeypatch.setattr(screener_module, "_latest_reported_earnings_period", lambda ticker: "2026Q2")

        build_calls = []
        async def _tracking_build(ticker, lang):
            build_calls.append(ticker)
            return {"ticker": ticker, "_earnings_period": "2026Q2"}
        monkeypatch.setattr(nif_service, "build_nif_dashboard", _tracking_build)

        from app.core import cache as cache_module
        monkeypatch.setattr(cache_module, "cache_set", lambda *a, **k: None)

        await worker.job_prewarm_nif_dashboard_default()

        assert len(build_calls) == 2  # once per supported language


def _fake_cache_get_resilient(fn):
    """Wraps a plain sync function as the async signature
    _cache_get_resilient(cache_get_fn, key) expects, always returning
    `fn`'s result regardless of args — a stand-in for "cache is empty"
    across every ticker/lang/tier combo without touching Redis."""
    async def _wrapped(cache_get_fn, key):
        return fn(key)
    return _wrapped
