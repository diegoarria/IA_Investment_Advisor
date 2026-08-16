"""
Regression tests — Aug 15 real-money incident, final safety net: a hard,
platform-wide daily spend circuit breaker in `ai_service._claude()` (and
`submit_candidate_blurb_batch`, which bypasses `_claude()` entirely).
Once today's real, tracked spend crosses `settings.daily_llm_spend_cap_usd`,
every new Claude call — regardless of which feature/user triggered it —
is refused until the next day. Diego's explicit ask: "no puedo gastar esa
cantidad de dinero en 1 solo día."
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

import app.services.ai_service as ai_service
from app.services.ai_service import LLMDailySpendCapExceeded, _daily_spend_cache_key


class _FakeUsage:
    def __init__(self, input_tokens=1000, output_tokens=500):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class _FakeResponse:
    def __init__(self, usage=None):
        self.content = [SimpleNamespace(text="ok")]
        self.usage = usage or _FakeUsage()


class TestClaudeDailySpendCap:
    async def test_allows_the_call_when_under_the_cap(self, monkeypatch):
        monkeypatch.setattr(ai_service.settings, "daily_llm_spend_cap_usd", 5.0)

        with patch("app.core.cache.cache_get", return_value=0.0), \
             patch("app.core.cache.cache_incr_float", return_value=0.001) as mock_incr, \
             patch.object(ai_service.client.messages, "create", new_callable=AsyncMock) as mock_create:
            mock_create.return_value = _FakeResponse()
            resp = await ai_service._claude(model="claude-haiku-4-5-20251001", max_tokens=100, messages=[])

        assert resp is not None
        mock_create.assert_called_once()
        mock_incr.assert_called_once()

    async def test_blocks_the_call_when_at_or_over_the_cap(self, monkeypatch):
        monkeypatch.setattr(ai_service.settings, "daily_llm_spend_cap_usd", 5.0)

        with patch("app.core.cache.cache_get", return_value=5.00), \
             patch.object(ai_service.client.messages, "create", new_callable=AsyncMock) as mock_create:
            with pytest.raises(LLMDailySpendCapExceeded):
                await ai_service._claude(model="claude-haiku-4-5-20251001", max_tokens=100, messages=[])

        mock_create.assert_not_called()

    async def test_blocks_exactly_at_the_boundary_not_only_above_it(self, monkeypatch):
        # cache_get returns EXACTLY the cap — must still block (>=, not >).
        monkeypatch.setattr(ai_service.settings, "daily_llm_spend_cap_usd", 2.50)

        with patch("app.core.cache.cache_get", return_value=2.50), \
             patch.object(ai_service.client.messages, "create", new_callable=AsyncMock) as mock_create:
            with pytest.raises(LLMDailySpendCapExceeded):
                await ai_service._claude(model="claude-haiku-4-5-20251001", max_tokens=100, messages=[])
        mock_create.assert_not_called()

    async def test_increments_the_running_total_by_the_real_computed_cost(self, monkeypatch):
        monkeypatch.setattr(ai_service.settings, "daily_llm_spend_cap_usd", 5.0)

        with patch("app.core.cache.cache_get", return_value=1.0), \
             patch("app.core.cache.cache_incr_float", return_value=1.01) as mock_incr, \
             patch.object(ai_service.client.messages, "create", new_callable=AsyncMock) as mock_create:
            # 1000 input + 500 output tokens on Haiku ($1/$5 per Mtok) = $0.001 + $0.0025 = $0.0035
            mock_create.return_value = _FakeResponse(_FakeUsage(1000, 500))
            await ai_service._claude(model="claude-haiku-4-5-20251001", max_tokens=100, messages=[])

        args, kwargs = mock_incr.call_args
        key, amount, ttl = args[0], args[1], kwargs.get("ttl", args[2] if len(args) > 2 else None)
        assert key == _daily_spend_cache_key()
        assert amount == pytest.approx(0.0035, abs=1e-6)


class TestSubmitCandidateBlurbBatchDailySpendCap:
    async def test_refuses_to_submit_a_batch_when_cap_already_reached(self, monkeypatch):
        monkeypatch.setattr(ai_service.settings, "daily_llm_spend_cap_usd", 5.0)

        with patch("app.core.cache.cache_get", return_value=5.5), \
             patch.object(ai_service.client.messages, "batches", create=True) as mock_batches:
            with pytest.raises(LLMDailySpendCapExceeded):
                await ai_service.submit_candidate_blurb_batch([{"ticker": "AAPL", "checklist_items_real": []}])
        mock_batches.create.assert_not_called()

    async def test_submits_normally_when_under_the_cap(self, monkeypatch):
        monkeypatch.setattr(ai_service.settings, "daily_llm_spend_cap_usd", 5.0)

        fake_batch = SimpleNamespace(id="batch_123")
        with patch("app.core.cache.cache_get", return_value=0.0), \
             patch.object(ai_service.client.messages, "batches", create=True) as mock_batches:
            mock_batches.create = AsyncMock(return_value=fake_batch)
            batch_id = await ai_service.submit_candidate_blurb_batch([{"ticker": "AAPL", "checklist_items_real": []}])

        assert batch_id == "batch_123"
        mock_batches.create.assert_called_once()


class TestDailySpendCacheKeyRollsOverAtMidnightET:
    def test_key_is_date_scoped(self, monkeypatch):
        import datetime as real_datetime
        import zoneinfo

        class _FixedDatetime(real_datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return real_datetime.datetime(2026, 8, 15, 23, 0, tzinfo=zoneinfo.ZoneInfo("America/New_York"))

        monkeypatch.setattr(ai_service, "datetime", _FixedDatetime)
        assert _daily_spend_cache_key() == "llm_daily_spend:2026-08-15"
