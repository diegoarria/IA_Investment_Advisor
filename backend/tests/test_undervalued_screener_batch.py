"""
Regression tests — cost-optimization work (see /Users/diegoarria/
.claude/plans/cosmic-munching-crown.md): the earnings-based skip/reuse
decision for the weekly Oportunidades refresh, and the Batch API
submit/parse functions that replaced the sequential per-call blurb loop.
None of these hit a real Finnhub or Anthropic call — the earnings-period
lookup and the Anthropic batch client are both faked/mocked.

Also covers the Aug 15 math/blurb cache split (Diego's request: tuning
the Fair Value formula bumps CACHE_KEY often right now, and that must
never force the AI blurb to regenerate too) — the math partition
(_partition_featured_by_earnings, tied to CACHE_KEY's old_by_ticker) and
the blurb partition (_partition_featured_by_blurb_cache, its own
CACHE_KEY-independent cache) are now two separate, independently-tested
decisions.
"""
import app.services.ai_service as ai_service
import app.services.undervalued_screener_service as screener_service
from app.services.undervalued_screener_service import (
    _partition_featured_by_earnings,
    _partition_featured_by_blurb_cache,
    _REUSABLE_MATH_FIELDS,
    _REUSABLE_BLURB_FIELDS,
    _blurb_cache_key,
    poll_and_finalize_undervalued_screener_batch,
)


class TestPartitionFeaturedByEarnings:
    """MATH ONLY — deliberately tied to CACHE_KEY's own old_by_ticker,
    since a CACHE_KEY bump means the math methodology changed."""

    def test_reuses_old_entry_verbatim_when_earnings_period_unchanged(self):
        old_by_ticker = {
            "AAPL": {
                "ticker": "AAPL",
                "_earnings_period": "2026Q2",
                "relative_valuation": {"score": 42},
                "historical_valuation": {"score": 7},
                "momentum": {"trend": "up"},
            }
        }
        featured = [{"ticker": "AAPL", "price": 200}]
        to_recompute = _partition_featured_by_earnings(featured, old_by_ticker, lambda t: "2026Q2")

        assert to_recompute == []
        assert featured[0]["relative_valuation"] == {"score": 42}
        assert featured[0]["_earnings_period"] == "2026Q2"

    def test_never_touches_blurb_fields_even_when_present_in_old_entry(self):
        # The math partition must be blind to blurb state entirely — that's
        # the whole point of the split. An old entry WITH a real blurb
        # still only contributes math fields here.
        old_by_ticker = {
            "AAPL": {
                "ticker": "AAPL",
                "_earnings_period": "2026Q2",
                "relative_valuation": {"score": 42},
                "blurb_by_lang": {"es": "old blurb"},
            }
        }
        featured = [{"ticker": "AAPL", "price": 200}]
        to_recompute = _partition_featured_by_earnings(featured, old_by_ticker, lambda t: "2026Q2")

        assert to_recompute == []
        assert "blurb_by_lang" not in featured[0]

    def test_recomputes_when_earnings_period_changed(self):
        old_by_ticker = {
            "AAPL": {"ticker": "AAPL", "_earnings_period": "2026Q1", "relative_valuation": {"score": 42}},
        }
        featured = [{"ticker": "AAPL", "price": 200}]
        to_recompute = _partition_featured_by_earnings(featured, old_by_ticker, lambda t: "2026Q2")

        assert to_recompute == featured
        assert "relative_valuation" not in featured[0]
        assert featured[0]["_earnings_period"] == "2026Q2"

    def test_recomputes_when_no_old_entry(self):
        featured = [{"ticker": "NEW", "price": 50}]
        to_recompute = _partition_featured_by_earnings(featured, {}, lambda t: "2026Q2")

        assert to_recompute == featured
        assert featured[0]["_earnings_period"] == "2026Q2"

    def test_recomputes_when_earnings_period_lookup_fails(self):
        old_by_ticker = {"AAPL": {"ticker": "AAPL", "_earnings_period": "2026Q2", "relative_valuation": {"score": 42}}}
        featured = [{"ticker": "AAPL", "price": 200}]

        def _boom(ticker):
            raise RuntimeError("finnhub down")

        to_recompute = _partition_featured_by_earnings(featured, old_by_ticker, _boom)

        assert to_recompute == featured
        assert featured[0]["_earnings_period"] is None

    def test_reusable_fields_never_leak_non_reusable_state(self):
        old_by_ticker = {
            "AAPL": {
                "ticker": "AAPL",
                "_earnings_period": "2026Q2",
                "relative_valuation": {"score": 42},
                "price": 999,
                "dcf_assumptions": {"stale": True},
            }
        }
        featured = [{"ticker": "AAPL", "price": 200}]
        _partition_featured_by_earnings(featured, old_by_ticker, lambda t: "2026Q2")

        assert featured[0]["price"] == 200
        assert "dcf_assumptions" not in featured[0]
        assert set(_REUSABLE_MATH_FIELDS) == {"relative_valuation", "historical_valuation", "momentum"}


class TestPartitionFeaturedByBlurbCache:
    """AI BLURB ONLY — the Aug 15 fix. Independent of CACHE_KEY entirely,
    so a formula/CACHE_KEY bump (math changed) never forces a real Claude
    call to regenerate blurb text that never changed."""

    def test_reuses_blurb_from_independent_cache_regardless_of_cache_key(self, monkeypatch):
        cached_blurb = {
            "_earnings_period": "2026Q2",
            "blurb_by_lang": {"es": "buena empresa"},
            "business_understanding_by_lang": {"es": "old"},
            "checklist_reasons_by_lang": {"es": {}},
        }
        monkeypatch.setattr(screener_service, "cache_get", lambda key: cached_blurb if key == _blurb_cache_key("AAPL") else None)

        featured = [{"ticker": "AAPL", "price": 200}]
        to_recompute = _partition_featured_by_blurb_cache(featured, lambda t: "2026Q2", screener_service.cache_get)

        assert to_recompute == []
        assert featured[0]["blurb_by_lang"] == {"es": "buena empresa"}

    def test_recomputes_when_earnings_period_changed_even_if_blurb_cache_has_an_entry(self, monkeypatch):
        cached_blurb = {"_earnings_period": "2026Q1", "blurb_by_lang": {"es": "old"}}
        monkeypatch.setattr(screener_service, "cache_get", lambda key: cached_blurb)

        featured = [{"ticker": "AAPL", "price": 200}]
        to_recompute = _partition_featured_by_blurb_cache(featured, lambda t: "2026Q2", screener_service.cache_get)

        assert to_recompute == featured
        assert "blurb_by_lang" not in featured[0]

    def test_recomputes_when_nothing_cached(self, monkeypatch):
        monkeypatch.setattr(screener_service, "cache_get", lambda key: None)
        featured = [{"ticker": "NEW", "price": 50}]
        to_recompute = _partition_featured_by_blurb_cache(featured, lambda t: "2026Q2", screener_service.cache_get)

        assert to_recompute == featured

    def test_recomputes_when_earnings_period_lookup_fails(self, monkeypatch):
        monkeypatch.setattr(screener_service, "cache_get", lambda key: {"_earnings_period": "2026Q2", "blurb_by_lang": {"es": "x"}})
        featured = [{"ticker": "AAPL", "price": 200}]

        def _boom(ticker):
            raise RuntimeError("finnhub down")

        to_recompute = _partition_featured_by_blurb_cache(featured, _boom, screener_service.cache_get)

        assert to_recompute == featured

    def test_survives_a_cache_key_bump_the_whole_point_of_the_split(self, monkeypatch):
        # Simulates Diego's exact scenario: the Fair Value FORMULA changed
        # (so the math partition — a separate call — would recompute this
        # ticker from scratch), but the blurb partition, being fully
        # independent of CACHE_KEY, still reuses the real blurb generated
        # under the OLD CACHE_KEY days ago. Zero Claude spend for this
        # ticker's blurb despite the formula change.
        cached_blurb = {
            "_earnings_period": "2026Q2",
            "blurb_by_lang": {"es": "buena empresa", "en": "good company"},
            "business_understanding_by_lang": {"es": {}, "en": {}},
            "checklist_reasons_by_lang": {"es": {}, "en": {}},
        }
        monkeypatch.setattr(screener_service, "cache_get", lambda key: cached_blurb)

        # Math partition sees an EMPTY old_by_ticker (new CACHE_KEY, no data yet)
        featured = [{"ticker": "AAPL", "price": 200}]
        math_to_recompute = _partition_featured_by_earnings(featured, {}, lambda t: "2026Q2")
        assert math_to_recompute == featured  # math genuinely needs recompute

        # Blurb partition still reuses — unaffected by the CACHE_KEY bump
        blurb_to_recompute = _partition_featured_by_blurb_cache(featured, lambda t: "2026Q2", screener_service.cache_get)
        assert blurb_to_recompute == []
        assert featured[0]["blurb_by_lang"] == {"es": "buena empresa", "en": "good company"}


class _FakeBatch:
    def __init__(self, batch_id: str):
        self.id = batch_id


class _FakeBatchesAPI:
    def __init__(self):
        self.create_calls: list[dict] = []
        self._results: list = []

    async def create(self, requests):
        self.create_calls.append(requests)
        return _FakeBatch("batch_123")

    async def results(self, batch_id):
        for item in self._results:
            yield item


def _fake_result_item(custom_id: str, result_type: str, text: str = ""):
    result = type("Result", (), {"type": result_type})()
    if result_type == "succeeded":
        block = type("Block", (), {"text": text})()
        message = type("Message", (), {"content": [block]})()
        result.message = message
    return type("Item", (), {"custom_id": custom_id, "result": result})()


class TestSubmitCandidateBlurbBatch:
    async def test_builds_one_request_per_entry_per_lang_with_unique_custom_ids(self, monkeypatch):
        fake_batches = _FakeBatchesAPI()
        monkeypatch.setattr(ai_service.client, "messages", type("M", (), {"batches": fake_batches})())

        entries = [
            {"ticker": "AAPL", "price": 200, "checklist_items_real": []},
            {"ticker": "MSFT", "price": 400, "checklist_items_real": []},
        ]
        batch_id = await ai_service.submit_candidate_blurb_batch(entries, langs=("es", "en"))

        assert batch_id == "batch_123"
        assert len(fake_batches.create_calls) == 1
        requests = fake_batches.create_calls[0]
        assert len(requests) == 4
        custom_ids = {r["custom_id"] for r in requests}
        assert custom_ids == {"AAPL:es", "AAPL:en", "MSFT:es", "MSFT:en"}
        for r in requests:
            assert r["params"]["system"][0]["cache_control"] == {"type": "ephemeral"}
            assert r["params"]["system"][0]["text"] == ai_service._BLURB_STATIC_INSTRUCTIONS


class TestParseCandidateBlurbBatchResults:
    async def test_maps_succeeded_results_back_by_ticker_and_lang(self, monkeypatch):
        fake_batches = _FakeBatchesAPI()
        fake_batches._results = [
            _fake_result_item("AAPL:es", "succeeded", '{"blurb": "buena empresa", "checklist_reasons": {}}'),
            _fake_result_item("AAPL:en", "succeeded", '{"blurb": "good company", "checklist_reasons": {}}'),
        ]
        monkeypatch.setattr(ai_service.client, "messages", type("M", (), {"batches": fake_batches})())

        results = await ai_service.parse_candidate_blurb_batch_results("batch_123")

        assert set(results.keys()) == {"AAPL:es", "AAPL:en"}
        assert results["AAPL:es"]["blurb"] == "buena empresa"
        assert results["AAPL:en"]["blurb"] == "good company"

    async def test_a_failed_request_is_omitted_without_crashing_the_finalize_step(self, monkeypatch):
        fake_batches = _FakeBatchesAPI()
        fake_batches._results = [
            _fake_result_item("AAPL:es", "succeeded", '{"blurb": "buena empresa", "checklist_reasons": {}}'),
            _fake_result_item("MSFT:es", "errored"),
        ]
        monkeypatch.setattr(ai_service.client, "messages", type("M", (), {"batches": fake_batches})())

        results = await ai_service.parse_candidate_blurb_batch_results("batch_123")

        assert set(results.keys()) == {"AAPL:es"}

    async def test_a_truncated_response_falls_back_to_empty_blurb_not_a_crash(self, monkeypatch):
        fake_batches = _FakeBatchesAPI()
        fake_batches._results = [
            _fake_result_item("AAPL:es", "succeeded", '{"blurb": "buena empresa"'),  # truncated JSON
        ]
        monkeypatch.setattr(ai_service.client, "messages", type("M", (), {"batches": fake_batches})())

        results = await ai_service.parse_candidate_blurb_batch_results("batch_123")

        assert results["AAPL:es"]["blurb"] == ""


class _FakeRetrieveClient:
    def __init__(self, processing_status: str):
        async def _retrieve(batch_id):
            return type("Batch", (), {"id": batch_id, "processing_status": processing_status})()
        self.messages = type("M", (), {"batches": type("B", (), {"retrieve": staticmethod(_retrieve)})()})()


class TestPollAndFinalizeUndervaluedScreenerBatch:
    """Mocked end-to-end dry-run of the submit -> poll -> finalize pipeline
    — no real Finnhub/Anthropic calls, so it costs nothing to run, unlike
    an actual live smoke test against /admin/refresh-undervalued-screener
    would (a real batch submission is real Anthropic spend)."""

    async def test_returns_false_when_nothing_pending(self, monkeypatch):
        monkeypatch.setattr(screener_service, "cache_get", lambda key: None)
        assert await poll_and_finalize_undervalued_screener_batch() is False

    async def test_returns_true_and_leaves_cache_untouched_while_batch_still_processing(self, monkeypatch):
        pending = {"batch_id": "batch_123", "all_results": [{"ticker": "AAPL", "featured": True}]}
        monkeypatch.setattr(screener_service, "cache_get", lambda key: pending)
        monkeypatch.setattr(ai_service, "client", _FakeRetrieveClient("in_progress"))
        cache_set_calls = []
        monkeypatch.setattr(screener_service, "cache_set", lambda *a, **k: cache_set_calls.append(a))

        result = await poll_and_finalize_undervalued_screener_batch()

        assert result is True
        assert cache_set_calls == []

    async def test_finalizes_cache_when_batch_ended(self, monkeypatch):
        entry = {
            "ticker": "AAPL", "featured": True,
            "blurb_by_lang": {"es": None, "en": None},
            "business_understanding_by_lang": {"es": {}, "en": {}},
            "checklist_reasons_by_lang": {"es": {}, "en": {}},
        }
        pending = {"batch_id": "batch_123", "all_results": [entry]}
        monkeypatch.setattr(screener_service, "cache_get", lambda key: pending)
        monkeypatch.setattr(ai_service, "client", _FakeRetrieveClient("ended"))

        async def _fake_parse(batch_id):
            return {
                "AAPL:es": {"blurb": "buena empresa", "business_understanding_stars": 4, "business_understanding_reason": "x", "checklist_reasons": {}},
                "AAPL:en": {"blurb": "good company", "business_understanding_stars": 4, "business_understanding_reason": "x", "checklist_reasons": {}},
            }
        monkeypatch.setattr(ai_service, "parse_candidate_blurb_batch_results", _fake_parse)

        cache_set_calls = []
        cache_delete_calls = []
        monkeypatch.setattr(screener_service, "cache_set", lambda *a, **k: cache_set_calls.append(a))
        monkeypatch.setattr(screener_service, "cache_delete", lambda *a, **k: cache_delete_calls.append(a))

        result = await poll_and_finalize_undervalued_screener_batch()

        assert result is True
        # Two writes now: the independent per-ticker blurb cache (Aug 15
        # split, survives future CACHE_KEY bumps) AND the finalized
        # CACHE_KEY list itself.
        assert len(cache_set_calls) == 2
        keys_written = {call[0] for call in cache_set_calls}
        assert keys_written == {screener_service.CACHE_KEY, screener_service._blurb_cache_key("AAPL")}

        cache_key_call = next(c for c in cache_set_calls if c[0] == screener_service.CACHE_KEY)
        finalized_results = cache_key_call[1]
        assert finalized_results[0]["blurb_by_lang"] == {"es": "buena empresa", "en": "good company"}

        blurb_cache_call = next(c for c in cache_set_calls if c[0] == screener_service._blurb_cache_key("AAPL"))
        assert blurb_cache_call[1]["blurb_by_lang"] == {"es": "buena empresa", "en": "good company"}

        assert cache_delete_calls == [(screener_service._PENDING_BATCH_CACHE_KEY,)]


class TestRefreshUndervaluedScreenerSkipsDuplicateBatchSubmission:
    """A real duplicate-spend risk found during audit: nothing previously
    stopped refresh_undervalued_screener() from submitting a SECOND full
    Batch API call (real Anthropic spend) while an earlier batch from this
    same screener was still pending — e.g. an admin re-triggering
    /admin/refresh-undervalued-screener before the first batch finalizes.
    This locks in the guard that skips resubmission whenever
    _PENDING_BATCH_CACHE_KEY is already occupied."""

    async def test_skips_batch_submission_when_a_batch_is_already_pending(self, monkeypatch):
        candidate = {"ticker": "AAPL", "sector": "Technology", "price": 200, "featured": True}

        monkeypatch.setattr(screener_service, "_scan", lambda tickers, analysis_cache=None: [candidate])
        monkeypatch.setattr(screener_service, "_cap_per_sector", lambda results, max_per_sector: results)
        monkeypatch.setattr(screener_service, "cache_get_with_ts", lambda key: (None, None))

        already_pending = {"batch_id": "batch_OLD", "all_results": [candidate]}
        monkeypatch.setattr(screener_service, "cache_get", lambda key: already_pending)

        import app.api.routes.screener as screener_routes
        monkeypatch.setattr(screener_routes, "_latest_reported_earnings_period", lambda ticker: "2026Q2")
        monkeypatch.setattr(screener_routes, "UNIVERSE", [{"ticker": "AAPL", "industry": "Software"}])

        import app.services.fundamental_analysis_service as fundamental_analysis_service
        monkeypatch.setattr(fundamental_analysis_service, "get_financials", lambda ticker, limit=10: {})
        monkeypatch.setattr(screener_service, "_compute_momentum", lambda ticker, price: None)

        submit_calls = []
        async def _fake_submit(entries, langs=("es", "en")):
            submit_calls.append(entries)
            return "batch_NEW"
        monkeypatch.setattr(ai_service, "submit_candidate_blurb_batch", _fake_submit)

        cache_set_calls = []
        monkeypatch.setattr(screener_service, "cache_set", lambda *a, **k: cache_set_calls.append(a))

        async def _noop_backtest(analysis_cache):
            return None
        import app.services.valuation_backtest_service as valuation_backtest_service
        monkeypatch.setattr(valuation_backtest_service, "refresh_valuation_backtest", _noop_backtest)

        await screener_service.refresh_undervalued_screener()

        assert submit_calls == []  # never submitted a second batch
        # CACHE_KEY itself must NOT be finalized here either — the pending
        # batch (whichever candidates it covers) is still the source of truth.
        assert all(call[0] != screener_service.CACHE_KEY for call in cache_set_calls)


class TestBatchFailureNeverFallsBackToRealClaudeCalls:
    """The Aug 15 real-money incident: when submit_candidate_blurb_batch
    failed for any reason, this used to silently fall back to a real,
    unlogged, per-call Claude loop (_fill_blurbs_sequentially) — meaning a
    Batch API hiccup on ANY worker restart, with zero real users involved,
    could burn real Anthropic credits nobody could see. That fallback
    function no longer exists in this module at all, and this test proves
    it structurally: it fails loudly (AssertionError from the tracking
    stub, not a silent pass) if `_claude` — the one chokepoint every real
    Anthropic call in this codebase goes through — is ever invoked during
    a failed batch submission."""

    async def test_no_fallback_function_exists_in_the_module(self):
        assert not hasattr(screener_service, "_fill_blurbs_sequentially")

    async def test_batch_submission_failure_makes_zero_real_claude_calls(self, monkeypatch):
        candidate = {"ticker": "AAPL", "sector": "Technology", "price": 200, "featured": True}

        monkeypatch.setattr(screener_service, "_scan", lambda tickers, analysis_cache=None: [candidate])
        monkeypatch.setattr(screener_service, "_cap_per_sector", lambda results, max_per_sector: results)
        monkeypatch.setattr(screener_service, "cache_get_with_ts", lambda key: (None, None))
        monkeypatch.setattr(screener_service, "cache_get", lambda key: None)  # nothing pending

        import app.api.routes.screener as screener_routes
        monkeypatch.setattr(screener_routes, "_latest_reported_earnings_period", lambda ticker: "2026Q2")
        monkeypatch.setattr(screener_routes, "UNIVERSE", [{"ticker": "AAPL", "industry": "Software"}])

        import app.services.fundamental_analysis_service as fundamental_analysis_service
        monkeypatch.setattr(fundamental_analysis_service, "get_financials", lambda ticker, limit=10: {})
        monkeypatch.setattr(screener_service, "_compute_momentum", lambda ticker, price: None)

        async def _fake_submit_that_fails(entries, langs=("es", "en")):
            raise RuntimeError("simulated Batch API outage")
        monkeypatch.setattr(ai_service, "submit_candidate_blurb_batch", _fake_submit_that_fails)

        real_claude_calls = []
        async def _tracking_claude_stub(**kwargs):
            real_claude_calls.append(kwargs)
            raise AssertionError("a real Claude call happened after a failed batch submission — the Aug 15 bug is back")
        monkeypatch.setattr(ai_service, "_claude", _tracking_claude_stub)

        cache_set_calls = []
        monkeypatch.setattr(screener_service, "cache_set", lambda *a, **k: cache_set_calls.append(a))

        async def _noop_backtest(analysis_cache):
            return None
        import app.services.valuation_backtest_service as valuation_backtest_service
        monkeypatch.setattr(valuation_backtest_service, "refresh_valuation_backtest", _noop_backtest)

        await screener_service.refresh_undervalued_screener()

        assert real_claude_calls == []
        # the refresh must still finish and cache SOMETHING (candidates
        # keep whatever blurb they had — reused or none) instead of hanging
        # or crashing the whole weekly refresh over one batch outage.
        assert any(call[0] == screener_service.CACHE_KEY for call in cache_set_calls)


class TestStartupSelfHealNeverTriggersAISpendForBacktestAlone:
    """The other half of the Aug 15 incident: refresh_if_empty_on_startup()
    used to run the FULL, AI-heavy screener refresh whenever the UNRELATED
    valuation-backtest cache was empty, even if the screener's own cache
    was fine — meaning a redeploy that had nothing to do with the screener
    could still trigger real, repeated Claude spend on every restart, with
    zero real users involved. This proves the AI-heavy path
    (refresh_undervalued_screener) is never called when only the backtest
    cache is missing — only the cheap, LLM-free repair runs."""

    async def test_backtest_cache_empty_alone_never_calls_the_ai_heavy_refresh(self, monkeypatch):
        # Screener's own cache IS populated (truthy timestamp) — only the
        # backtest cache is empty, e.g. right after this feature was added.
        monkeypatch.setattr(screener_service, "cache_get_with_ts", lambda key: (
            (["fake", "screener", "data"], 1234567890.0) if key == screener_service.CACHE_KEY else (None, None)
        ))

        ai_heavy_refresh_calls = []
        async def _tracking_refresh():
            ai_heavy_refresh_calls.append(True)
        monkeypatch.setattr(screener_service, "refresh_undervalued_screener", _tracking_refresh)

        monkeypatch.setattr(screener_service, "_scan", lambda tickers, analysis_cache=None: [])

        import app.api.routes.screener as screener_routes
        monkeypatch.setattr(screener_routes, "UNIVERSE", [])

        backtest_repair_calls = []
        async def _tracking_backtest_repair(analysis_cache):
            backtest_repair_calls.append(True)
        import app.services.valuation_backtest_service as valuation_backtest_service
        monkeypatch.setattr(valuation_backtest_service, "refresh_valuation_backtest", _tracking_backtest_repair)

        await screener_service.refresh_if_empty_on_startup()

        assert ai_heavy_refresh_calls == []  # the expensive, AI-spending path was never touched
        assert backtest_repair_calls == [True]  # only the cheap, LLM-free repair ran
