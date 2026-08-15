"""
Regression tests — cost-optimization work (see /Users/diegoarria/
.claude/plans/cosmic-munching-crown.md): the earnings-based skip/reuse
decision for the weekly Oportunidades refresh, and the Batch API
submit/parse functions that replaced the sequential per-call blurb loop.
None of these hit a real Finnhub or Anthropic call — the earnings-period
lookup and the Anthropic batch client are both faked/mocked.
"""
import app.services.ai_service as ai_service
import app.services.undervalued_screener_service as screener_service
from app.services.undervalued_screener_service import (
    _partition_featured_by_earnings,
    _REUSABLE_EARNINGS_FIELDS,
    poll_and_finalize_undervalued_screener_batch,
)


class TestPartitionFeaturedByEarnings:
    def test_reuses_old_entry_verbatim_when_earnings_period_unchanged(self):
        old_by_ticker = {
            "AAPL": {
                "ticker": "AAPL",
                "_earnings_period": "2026Q2",
                "blurb_by_lang": {"es": "old blurb"},
                "relative_valuation": {"score": 42},
                "historical_valuation": {"score": 7},
                "momentum": {"trend": "up"},
                "business_understanding_by_lang": {"es": "old"},
                "checklist_reasons_by_lang": {"es": {}},
            }
        }
        featured = [{"ticker": "AAPL", "price": 200}]
        to_recompute = _partition_featured_by_earnings(featured, old_by_ticker, lambda t: "2026Q2")

        assert to_recompute == []
        assert featured[0]["blurb_by_lang"] == {"es": "old blurb"}
        assert featured[0]["relative_valuation"] == {"score": 42}
        assert featured[0]["_earnings_period"] == "2026Q2"

    def test_recomputes_when_earnings_period_changed(self):
        old_by_ticker = {
            "AAPL": {
                "ticker": "AAPL",
                "_earnings_period": "2026Q1",
                "blurb_by_lang": {"es": "old blurb"},
            }
        }
        featured = [{"ticker": "AAPL", "price": 200}]
        to_recompute = _partition_featured_by_earnings(featured, old_by_ticker, lambda t: "2026Q2")

        assert to_recompute == featured
        assert "blurb_by_lang" not in featured[0]
        assert featured[0]["_earnings_period"] == "2026Q2"

    def test_recomputes_when_no_old_entry(self):
        featured = [{"ticker": "NEW", "price": 50}]
        to_recompute = _partition_featured_by_earnings(featured, {}, lambda t: "2026Q2")

        assert to_recompute == featured
        assert featured[0]["_earnings_period"] == "2026Q2"

    def test_recomputes_when_earnings_period_lookup_fails(self):
        old_by_ticker = {"AAPL": {"ticker": "AAPL", "_earnings_period": "2026Q2", "blurb_by_lang": {"es": "x"}}}
        featured = [{"ticker": "AAPL", "price": 200}]

        def _boom(ticker):
            raise RuntimeError("finnhub down")

        to_recompute = _partition_featured_by_earnings(featured, old_by_ticker, _boom)

        assert to_recompute == featured
        assert featured[0]["_earnings_period"] is None

    def test_recomputes_when_old_entry_never_got_a_blurb(self):
        old_by_ticker = {
            "AAPL": {"ticker": "AAPL", "_earnings_period": "2026Q2", "blurb_by_lang": None},
        }
        featured = [{"ticker": "AAPL", "price": 200}]
        to_recompute = _partition_featured_by_earnings(featured, old_by_ticker, lambda t: "2026Q2")

        assert to_recompute == featured

    def test_reusable_fields_never_leak_non_reusable_state(self):
        old_by_ticker = {
            "AAPL": {
                "ticker": "AAPL",
                "_earnings_period": "2026Q2",
                "blurb_by_lang": {"es": "x"},
                "price": 999,
                "dcf_assumptions": {"stale": True},
            }
        }
        featured = [{"ticker": "AAPL", "price": 200}]
        _partition_featured_by_earnings(featured, old_by_ticker, lambda t: "2026Q2")

        assert featured[0]["price"] == 200
        assert "dcf_assumptions" not in featured[0]
        assert set(_REUSABLE_EARNINGS_FIELDS) == {
            "relative_valuation", "historical_valuation", "momentum",
            "blurb_by_lang", "business_understanding_by_lang", "checklist_reasons_by_lang",
        }


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
        assert len(cache_set_calls) == 1
        finalized_key, finalized_results = cache_set_calls[0][0], cache_set_calls[0][1]
        assert finalized_key == screener_service.CACHE_KEY
        assert finalized_results[0]["blurb_by_lang"] == {"es": "buena empresa", "en": "good company"}
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
