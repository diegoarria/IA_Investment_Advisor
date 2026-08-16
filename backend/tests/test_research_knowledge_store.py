"""
Tests — app.services.research.knowledge_store (Fase 3, Incremento 1).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.

No existing service in this codebase (fmg_service, investment_graph_service)
has direct unit tests — Supabase's fluent query builder has no established
mocking convention here. These tests mock `get_supabase`/`run_query`
directly to verify the WIRING (correct table names, correct row shape,
error-handling behavior) without needing a real database.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from datetime import datetime, timedelta, timezone

from app.services.research.knowledge_store import (
    save_snapshot,
    get_latest_snapshot,
    get_snapshot_history,
    save_timeline_event,
    get_company_timeline,
    is_snapshot_fresh,
    _headline_hash,
)


class TestHeadlineHash:
    def test_deterministic(self):
        assert _headline_hash("AAPL", "ceo_change", "New CEO named") == _headline_hash("AAPL", "ceo_change", "New CEO named")

    def test_case_and_whitespace_insensitive_on_headline(self):
        assert _headline_hash("AAPL", "ceo_change", "New CEO named") == _headline_hash("aapl", "ceo_change", "  New CEO Named  ")

    def test_different_headline_differs(self):
        assert _headline_hash("AAPL", "ceo_change", "New CEO named") != _headline_hash("AAPL", "ceo_change", "CFO resigns")

    def test_different_event_type_differs(self):
        assert _headline_hash("AAPL", "ceo_change", "x") != _headline_hash("AAPL", "ma", "x")


class TestSaveSnapshot:
    @pytest.mark.asyncio
    async def test_rejects_invalid_section_without_touching_db(self):
        with patch("app.services.research.knowledge_store.get_supabase") as mock_get_db:
            with pytest.raises(ValueError):
                await save_snapshot("AAPL", "not_a_real_section", {"claims": []})
            mock_get_db.assert_not_called()

    @pytest.mark.asyncio
    async def test_inserts_uppercased_ticker_and_returns_row(self):
        mock_db = MagicMock()
        inserted_row = {"id": "abc", "ticker": "AAPL", "section": "business_understanding"}
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[inserted_row])
            result = await save_snapshot("aapl", "business_understanding", {"claims": []}, source_period="FY2025")

        assert result == inserted_row
        mock_db.table.assert_called_with("company_knowledge_snapshots")
        insert_call_kwargs = mock_db.table.return_value.insert.call_args[0][0]
        assert insert_call_kwargs["ticker"] == "AAPL"
        assert insert_call_kwargs["section"] == "business_understanding"
        assert insert_call_kwargs["source_period"] == "FY2025"

    @pytest.mark.asyncio
    async def test_raises_on_db_failure_never_swallows(self):
        mock_db = MagicMock()
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = ConnectionError("db down")
            with pytest.raises(ConnectionError):
                await save_snapshot("AAPL", "business_understanding", {"claims": []})


class TestGetLatestSnapshot:
    @pytest.mark.asyncio
    async def test_returns_first_row(self):
        mock_db = MagicMock()
        row = {"id": "abc", "ticker": "AAPL"}
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[row])
            result = await get_latest_snapshot("AAPL", "business_understanding")
        assert result == row

    @pytest.mark.asyncio
    async def test_returns_none_when_no_prior_snapshot(self):
        mock_db = MagicMock()
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[])
            result = await get_latest_snapshot("AAPL", "business_understanding")
        assert result is None

    @pytest.mark.asyncio
    async def test_degrades_to_none_on_failure(self):
        mock_db = MagicMock()
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = ConnectionError("db down")
            result = await get_latest_snapshot("AAPL", "business_understanding")
        assert result is None


class TestGetSnapshotHistory:
    @pytest.mark.asyncio
    async def test_returns_rows(self):
        mock_db = MagicMock()
        rows = [{"id": "1"}, {"id": "2"}]
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=rows)
            result = await get_snapshot_history("AAPL", "management", limit=5)
        assert result == rows

    @pytest.mark.asyncio
    async def test_degrades_to_empty_list_on_failure(self):
        mock_db = MagicMock()
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = ConnectionError("db down")
            result = await get_snapshot_history("AAPL", "management")
        assert result == []


class TestSaveTimelineEvent:
    @pytest.mark.asyncio
    async def test_inserts_row_with_headline_hash(self):
        mock_db = MagicMock()
        inserted_row = {"id": "evt1", "ticker": "AAPL"}
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[inserted_row])
            result = await save_timeline_event("aapl", "ceo_change", "New CEO named")

        assert result == inserted_row
        mock_db.table.assert_called_with("company_timeline_events")
        insert_kwargs = mock_db.table.return_value.insert.call_args[0][0]
        assert insert_kwargs["ticker"] == "AAPL"
        assert insert_kwargs["headline_hash"] == _headline_hash("AAPL", "ceo_change", "New CEO named")

    @pytest.mark.asyncio
    async def test_duplicate_key_is_swallowed_not_raised(self):
        mock_db = MagicMock()
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = Exception("duplicate key value violates unique constraint")
            result = await save_timeline_event("AAPL", "ceo_change", "New CEO named")
        assert result is None

    @pytest.mark.asyncio
    async def test_other_errors_still_raise(self):
        mock_db = MagicMock()
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = ConnectionError("db down")
            with pytest.raises(ConnectionError):
                await save_timeline_event("AAPL", "ceo_change", "New CEO named")


class TestIsSnapshotFresh:
    """Aug 15 cost-control fix — Research Engine routes had zero caching,
    so any repeated request re-paid for real Claude calls. This gate is
    what lets the route serve a recent snapshot instead."""

    def test_none_snapshot_is_never_fresh(self):
        assert is_snapshot_fresh(None, max_age_hours=24) is False

    def test_missing_created_at_is_never_fresh(self):
        assert is_snapshot_fresh({"content": {}}, max_age_hours=24) is False

    def test_fresh_within_window(self):
        recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        assert is_snapshot_fresh({"created_at": recent}, max_age_hours=24) is True

    def test_stale_outside_window(self):
        old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        assert is_snapshot_fresh({"created_at": old}, max_age_hours=24) is False

    def test_right_at_the_boundary_is_stale(self):
        exactly_at_limit = (datetime.now(timezone.utc) - timedelta(hours=24, seconds=1)).isoformat()
        assert is_snapshot_fresh({"created_at": exactly_at_limit}, max_age_hours=24) is False

    def test_handles_z_suffix_timestamps(self):
        recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        assert is_snapshot_fresh({"created_at": recent}, max_age_hours=24) is True

    def test_malformed_timestamp_degrades_to_not_fresh_not_a_crash(self):
        assert is_snapshot_fresh({"created_at": "not-a-real-timestamp"}, max_age_hours=24) is False


class TestGetCompanyTimeline:
    @pytest.mark.asyncio
    async def test_returns_rows(self):
        mock_db = MagicMock()
        rows = [{"id": "1"}, {"id": "2"}]
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=rows)
            result = await get_company_timeline("AAPL")
        assert result == rows

    @pytest.mark.asyncio
    async def test_degrades_to_empty_list_on_failure(self):
        mock_db = MagicMock()
        with patch("app.services.research.knowledge_store.get_supabase", return_value=mock_db), \
             patch("app.services.research.knowledge_store.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = ConnectionError("db down")
            result = await get_company_timeline("AAPL")
        assert result == []
