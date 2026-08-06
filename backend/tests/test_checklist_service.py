"""
Tests — app.services.checklist_service (Fase 4, Incremento 8).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.checklist_service import (
    DEFAULT_CHECKLIST_ITEMS,
    get_user_checklist_items,
    add_checklist_item,
    remove_checklist_item,
    get_checklist_completions,
    set_checklist_item_checked,
    get_investable_mark,
    set_investable_mark,
)


class TestGetUserChecklistItems:
    @pytest.mark.asyncio
    async def test_returns_real_defaults_when_never_customized(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[])
            items = await get_user_checklist_items("user1")

        assert [i["item_key"] for i in items] == DEFAULT_CHECKLIST_ITEMS
        assert all(i["label"] is None and i["is_custom"] is False for i in items)

    @pytest.mark.asyncio
    async def test_returns_real_custom_rows_when_present(self):
        mock_db = MagicMock()
        rows = [{"item_key": "understand_business", "label": None, "sort_order": 0},
                {"item_key": "custom_abc123", "label": "¿Confío en el CEO?", "sort_order": 1}]
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=rows)
            items = await get_user_checklist_items("user1")

        assert len(items) == 2
        assert all(i["is_custom"] is True for i in items)
        assert items[1]["label"] == "¿Confío en el CEO?"


class TestAddChecklistItem:
    @pytest.mark.asyncio
    async def test_materializes_defaults_on_first_customization(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = [
                SimpleNamespace(data=[]),  # get_user_checklist_items -> empty -> defaults
                SimpleNamespace(data=[]),  # _materialize_defaults insert
                SimpleNamespace(data=[{"item_key": k, "label": None} for k in DEFAULT_CHECKLIST_ITEMS]),  # re-fetch after materialize
                SimpleNamespace(data=[]),  # insert new custom item
                SimpleNamespace(data=[
                    *[{"item_key": k, "label": None} for k in DEFAULT_CHECKLIST_ITEMS],
                    {"item_key": "custom_x", "label": "Nuevo item"},
                ]),  # final get_user_checklist_items
            ]
            result = await add_checklist_item("user1", "Nuevo item")

        assert any(i["label"] == "Nuevo item" for i in result)
        assert len(result) == len(DEFAULT_CHECKLIST_ITEMS) + 1

    @pytest.mark.asyncio
    async def test_does_not_rematerialize_when_already_customized(self):
        mock_db = MagicMock()
        already_custom = [{"item_key": "custom_a", "label": "x", "sort_order": 0}]
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = [
                SimpleNamespace(data=already_custom),  # get_user_checklist_items -> already custom
                SimpleNamespace(data=[]),  # insert new item
                SimpleNamespace(data=already_custom + [{"item_key": "custom_b", "label": "y"}]),  # final fetch
            ]
            result = await add_checklist_item("user1", "y")

        assert mock_run.call_count == 3  # no _materialize_defaults insert in between
        assert len(result) == 2


class TestRemoveChecklistItem:
    @pytest.mark.asyncio
    async def test_materializes_then_deletes(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = [
                SimpleNamespace(data=[]),  # get_user_checklist_items -> defaults
                SimpleNamespace(data=[]),  # materialize insert
                SimpleNamespace(data=[]),  # delete
                SimpleNamespace(data=[{"item_key": k, "label": None} for k in DEFAULT_CHECKLIST_ITEMS[1:]]),  # final fetch
            ]
            result = await remove_checklist_item("user1", DEFAULT_CHECKLIST_ITEMS[0])

        assert len(result) == len(DEFAULT_CHECKLIST_ITEMS) - 1


class TestChecklistCompletions:
    @pytest.mark.asyncio
    async def test_get_checklist_completions_returns_real_checked_set(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[{"item_key": "read_thesis"}, {"item_key": "know_risks"}])
            result = await get_checklist_completions("user1", "aapl")
        assert result == {"read_thesis", "know_risks"}

    @pytest.mark.asyncio
    async def test_set_checked_true_inserts_row(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[{"id": "c1"}])
            await set_checklist_item_checked("user1", "AAPL", "read_thesis", True)
        mock_db.table.assert_called_with("checklist_completions")
        insert_kwargs = mock_db.table.return_value.insert.call_args[0][0]
        assert insert_kwargs["ticker"] == "AAPL"

    @pytest.mark.asyncio
    async def test_set_checked_true_duplicate_is_idempotent(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = Exception("duplicate key value violates unique constraint")
            await set_checklist_item_checked("user1", "AAPL", "read_thesis", True)  # must not raise

    @pytest.mark.asyncio
    async def test_set_checked_true_other_errors_raise(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = ConnectionError("db down")
            with pytest.raises(ConnectionError):
                await set_checklist_item_checked("user1", "AAPL", "read_thesis", True)

    @pytest.mark.asyncio
    async def test_set_checked_false_deletes_row(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[])
            await set_checklist_item_checked("user1", "AAPL", "read_thesis", False)
        mock_db.table.return_value.delete.assert_called_once()


class TestInvestableMark:
    @pytest.mark.asyncio
    async def test_get_investable_mark_returns_none_when_absent(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[])
            assert await get_investable_mark("user1", "AAPL") is None

    @pytest.mark.asyncio
    async def test_set_investable_mark_true_inserts(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[{"id": "m1"}])
            await set_investable_mark("user1", "AAPL", True)
        mock_db.table.assert_called_with("investable_marks")

    @pytest.mark.asyncio
    async def test_set_investable_mark_false_deletes(self):
        mock_db = MagicMock()
        with patch("app.services.checklist_service.get_supabase", return_value=mock_db), \
             patch("app.services.checklist_service.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[])
            await set_investable_mark("user1", "AAPL", False)
        mock_db.table.return_value.delete.assert_called_once()
