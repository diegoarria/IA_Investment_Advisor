"""
Regression tests — cost audit, 2026-09-11. Two rounds of fixes on the
Oportunidades screen's cache-prewarm jobs:

Round 1 (superseded by round 2 for job_prewarm_quick_analysis_default and
job_prewarm_company_diagnostic_popular, kept live for job_refresh_
undervalued_screener): gate any AI/Premium-tier work to real market hours
(_is_market_open()).

Round 2 (this file's current state): even market-hours-gated, a cold-cache
prewarm run of the Premium/AI tier across 20 tickers x 2 langs was real,
unavoidable spend (~$1.30 confirmed live the moment it fired) — Diego's
call was to stop prewarming Premium's AI narrative on a schedule
entirely. job_prewarm_quick_analysis_default and job_prewarm_company_
diagnostic_popular now only ever prewarm the FREE/deterministic tier
(zero Claude cost, no market-hours gate needed). job_prewarm_nif_
dashboard_default (100% AI, no free tier at all) is disabled outright —
no longer registered with the scheduler.

job_refresh_undervalued_screener (the Sunday weekly Oportunidades
refresh) is untouched by round 2 — it's real, budgeted, admin-visible
spend, not a background prewarm — and still gates its AI blurb batch to
market hours (it's scheduled Sunday, when the market is always closed,
so as currently scheduled it never submits one automatically).
"""
import worker
import app.api.routes.market as market_module
import app.api.routes.screener as screener_module
import app.services.undervalued_screener_service as undervalued_screener_service


def _no_cache(*args, **kwargs):
    return None


def _fake_cache_get_resilient(fn):
    """Wraps a plain sync function as the async signature
    _cache_get_resilient(cache_get_fn, key) expects, always returning
    `fn`'s result regardless of args — a stand-in for "cache is empty"
    across every ticker/lang combo without touching Redis."""
    async def _wrapped(cache_get_fn, key):
        return fn(key)
    return _wrapped


class TestWeeklyRefreshJobRespectsMarketHoursToo:
    """The absolute rule has no exception, including this job's own real,
    intentional weekly AI blurb generation. It's scheduled Sunday — the
    market is ALWAYS closed then — so as currently scheduled this must
    never submit a blurb batch; only the real, free DCF/roster refresh
    runs."""

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


class TestQuickAnalysisPrewarmNeverSpendsClaudeAnymore:
    async def test_only_ever_builds_the_free_tier(self, monkeypatch):
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

        # One ticker x 2 languages x free-tier-only — never use_ai=True,
        # regardless of market hours (no gate needed: zero cost either way).
        assert build_calls == [False, False]


class TestCompanyDiagnosticPrewarmNeverSpendsClaudeAnymore:
    async def test_only_ever_builds_the_free_tier(self, monkeypatch):
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


class TestNifDashboardPrewarmIsDisabled:
    """No longer registered with the scheduler at all (see main()) — this
    just documents why: it's 100% AI, no free tier, so there was no way to
    make scheduled prewarming of it cost nothing."""

    def test_not_registered_in_the_scheduler_main_source(self):
        import inspect
        source = inspect.getsource(worker.main)
        assert "job_prewarm_nif_dashboard_default" not in source
