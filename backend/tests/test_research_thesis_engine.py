"""
Tests — app.services.research.thesis_engine (Fase 3, Incremento 7).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.research.thesis_engine import (
    ThesisDraftResult,
    compute_thesis_draft,
    compute_and_save_thesis_draft,
    save_thesis_draft,
    get_thesis_draft,
    get_user_current_thesis,
    get_user_thesis_history,
    create_thesis_version,
    fork_thesis_from_draft,
    format_real_inputs_summary,
)

_AI_RESULT = {
    "thesis_summary": "Negocio de alta calidad con moat real y valuación razonable.",
    "strengths": ["ROIC consistentemente alto.", "Moat real medido vs. peers."],
    "critical_variables": ["El margen de Services debe mantenerse sobre 25%."],
    "key_risks": ["Concentración de ingresos en un segmento."],
    "invalidation_events": ["Pérdida sostenida de cuota de mercado en el segmento principal."],
    "confidence": "medium",
}


class TestFormatRealInputsSummary:
    def test_includes_scores_and_valuation(self):
        text = format_real_inputs_summary(
            85.0, 70.0, 75.0, 20.0, {"low": 100, "high": 150}, None, None, None, None, "",
        )
        assert "85.0/100" in text and "20.0%" in text and "$100" in text

    def test_includes_business_and_management_snapshots(self):
        text = format_real_inputs_summary(
            None, None, None, None, None,
            {"how_it_makes_money": "Vende hardware y servicios."},
            None, None,
            {"strategic_priorities": "Foco en IA.", "strategy_change_classification": "strategy_change", "strategy_change_explanation": "Nuevo enfoque en IA."},
            "",
        )
        assert "Vende hardware y servicios" in text
        assert "Nuevo enfoque en IA" in text

    def test_no_prior_data_management_change_not_included(self):
        text = format_real_inputs_summary(
            None, None, None, None, None, None, None, None,
            {"strategic_priorities": "x", "strategy_change_classification": "no_prior_data"}, "",
        )
        assert "Cambio de estrategia detectado" not in text


class TestComputeThesisDraft:
    @pytest.mark.asyncio
    async def test_builds_result_from_ai_and_real_inputs(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_thesis_draft", new_callable=AsyncMock) as mock_ai:
            mock_timeline.return_value = []
            mock_ai.return_value = _AI_RESULT
            result = await compute_thesis_draft("AAPL", "Apple", 85.0, 70.0, 75.0, 20.0, {"low": 100, "high": 150})

        assert result.has_any_signal is True
        assert result.thesis_summary == _AI_RESULT["thesis_summary"]
        assert len(result.strengths) == 2
        assert all(c.confidence == "medium" for c in result.strengths)

    @pytest.mark.asyncio
    async def test_ai_failure_produces_no_signal(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_thesis_draft", new_callable=AsyncMock) as mock_ai:
            mock_timeline.return_value = []
            mock_ai.return_value = None
            result = await compute_thesis_draft("AAPL", "Apple", None, None, None, None, None)

        assert result.has_any_signal is False


class TestThesisDraftResultToRow:
    def test_row_shape(self):
        result = ThesisDraftResult(
            ticker="AAPL", thesis_summary="x", confidence="high",
            strengths=[], critical_variables=[], key_risks=[], invalidation_events=[],
        )
        row = result.to_row(based_on_snapshot_id="snap1")
        assert row["ticker"] == "AAPL"
        assert row["based_on_snapshot_id"] == "snap1"
        assert row["confidence"] == "high"


class TestSaveAndGetThesisDraft:
    @pytest.mark.asyncio
    async def test_save_upserts_on_ticker(self):
        result = ThesisDraftResult(ticker="AAPL", thesis_summary="x", confidence="medium")
        mock_db = MagicMock()
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[{"id": "draft1"}])
            saved = await save_thesis_draft(result)

        assert saved == {"id": "draft1"}
        mock_db.table.assert_called_with("research_thesis_drafts")
        upsert_call = mock_db.table.return_value.upsert
        assert upsert_call.call_args.kwargs["on_conflict"] == "ticker"

    @pytest.mark.asyncio
    async def test_get_thesis_draft_returns_row(self):
        mock_db = MagicMock()
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[{"id": "draft1", "ticker": "AAPL"}])
            result = await get_thesis_draft("aapl")
        assert result == {"id": "draft1", "ticker": "AAPL"}

    @pytest.mark.asyncio
    async def test_get_thesis_draft_returns_none_when_absent(self):
        mock_db = MagicMock()
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[])
            assert await get_thesis_draft("AAPL") is None


class TestComputeAndSaveThesisDraft:
    @pytest.mark.asyncio
    async def test_saves_only_when_signal_present(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_thesis_draft", new_callable=AsyncMock) as mock_ai, \
             patch("app.services.research.thesis_engine.save_thesis_draft", new_callable=AsyncMock) as mock_save:
            mock_timeline.return_value = []
            mock_ai.return_value = None
            await compute_and_save_thesis_draft("AAPL", "Apple", None, None, None, None, None)
        mock_save.assert_not_called()

    @pytest.mark.asyncio
    async def test_saves_when_signal_present(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_thesis_draft", new_callable=AsyncMock) as mock_ai, \
             patch("app.services.research.thesis_engine.save_thesis_draft", new_callable=AsyncMock) as mock_save:
            mock_timeline.return_value = []
            mock_ai.return_value = _AI_RESULT
            await compute_and_save_thesis_draft("AAPL", "Apple", 80.0, 70.0, 75.0, 15.0, None)
        mock_save.assert_called_once()


class TestUserThesisVersioning:
    @pytest.mark.asyncio
    async def test_create_thesis_version_first_time_has_no_parent(self):
        mock_db = MagicMock()
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = [
                SimpleNamespace(data=[]),  # get_user_current_thesis -> none
                SimpleNamespace(data=[{"id": "t1", "version": 1, "parent_thesis_id": None}]),  # insert
            ]
            result = await create_thesis_version("user1", "AAPL", "x", [], [], [], [])

        insert_kwargs = mock_db.table.return_value.insert.call_args[0][0]
        assert insert_kwargs["version"] == 1
        assert insert_kwargs["parent_thesis_id"] is None
        assert result["id"] == "t1"

    @pytest.mark.asyncio
    async def test_create_thesis_version_chains_and_clears_prior_is_current(self):
        mock_db = MagicMock()
        prior = {"id": "t1", "version": 1}
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = [
                SimpleNamespace(data=[prior]),  # get_user_current_thesis
                SimpleNamespace(data=[{"id": "t2"}]),  # update is_current=False
                SimpleNamespace(data=[{"id": "t2", "version": 2, "parent_thesis_id": "t1"}]),  # insert
            ]
            result = await create_thesis_version("user1", "AAPL", "x", [], [], [], [])

        assert result["version"] == 2
        assert result["parent_thesis_id"] == "t1"
        # the update call only touches is_current, never thesis content
        update_call_kwargs = mock_db.table.return_value.update.call_args[0][0]
        assert update_call_kwargs == {"is_current": False}

    @pytest.mark.asyncio
    async def test_get_user_current_thesis_returns_none_when_absent(self):
        mock_db = MagicMock()
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[])
            assert await get_user_current_thesis("user1", "AAPL") is None


class TestGetUserThesisHistory:
    @pytest.mark.asyncio
    async def test_returns_every_real_version_most_recent_first(self):
        mock_db = MagicMock()
        rows = [{"id": "t2", "version": 2}, {"id": "t1", "version": 1}]
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=rows)
            result = await get_user_thesis_history("user1", "AAPL")

        assert result == rows
        mock_db.table.assert_called_with("user_investment_theses")
        order_call = mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.order
        order_call.assert_called_once_with("version", desc=True)

    @pytest.mark.asyncio
    async def test_returns_empty_list_when_no_thesis_ever_created(self):
        mock_db = MagicMock()
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[])
            assert await get_user_thesis_history("user1", "AAPL") == []


class TestForkThesisFromDraft:
    @pytest.mark.asyncio
    async def test_returns_none_when_no_draft_exists(self):
        with patch("app.services.research.thesis_engine.get_thesis_draft", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = None
            result = await fork_thesis_from_draft("user1", "AAPL")
        assert result is None

    @pytest.mark.asyncio
    async def test_forks_real_draft_content(self):
        draft = {
            "id": "draft1", "thesis_summary": "x", "strengths": [], "critical_variables": [],
            "key_risks": [], "invalidation_events": [],
        }
        with patch("app.services.research.thesis_engine.get_thesis_draft", new_callable=AsyncMock) as mock_get, \
             patch("app.services.research.thesis_engine.create_thesis_version", new_callable=AsyncMock) as mock_create:
            mock_get.return_value = draft
            mock_create.return_value = {"id": "t1", "forked_from_draft_id": "draft1"}
            result = await fork_thesis_from_draft("user1", "AAPL")

        assert result["forked_from_draft_id"] == "draft1"
        mock_create.assert_called_once()
        assert mock_create.call_args.kwargs["forked_from_draft_id"] == "draft1"
