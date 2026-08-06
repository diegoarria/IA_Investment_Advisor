"""
Tests — app.services.research.thesis_tracker (Fase 3, Incremento 8).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.research.thesis_tracker import (
    compute_thesis_review,
    compute_and_save_thesis_review,
    _texts_from_jsonb,
)

_PRIOR_THESIS = {
    "id": "t1", "created_at": "2026-01-01T00:00:00Z", "forked_from_draft_id": "draft1",
    "thesis_summary": "Negocio de calidad con moat real.",
    "critical_variables": [{"text": "El margen de Services debe mantenerse sobre 25%.", "kind": "inference", "confidence": "medium"}],
    "key_risks": [{"text": "Concentración en un solo proveedor.", "kind": "inference", "confidence": "medium"}],
    "invalidation_events": [{"text": "Pérdida del cliente principal.", "kind": "inference", "confidence": "medium"}],
}

_RECENT_EVENTS = [
    {"event_type": "margin_shift", "headline": "Margen de Services cae", "event_date": "2026-02-01", "created_at": "2026-02-01T00:00:00Z"},
]

_AI_RESULT = {
    "what_changed": "El margen de Services cayó por debajo del 25%.",
    "confirmed_variables": [], "broken_variables": ["El margen de Services debe mantenerse sobre 25%."],
    "still_valid_risks": ["Concentración en un solo proveedor."], "invalidated_risks": [], "new_risks": ["Nueva competencia regional."],
    "thesis_change_explanation": "El margen cayó por presión competitiva real.",
    "updated_thesis_summary": "Negocio de calidad, pero el margen de Services bajo presión.",
    "updated_strengths": ["Moat real medido vs. peers."],
    "updated_critical_variables": ["El margen de Services debe recuperar 25% en 2 trimestres."],
    "updated_key_risks": ["Concentración en un solo proveedor.", "Nueva competencia regional."],
    "updated_invalidation_events": ["Pérdida del cliente principal."],
}


class TestTextsFromJsonb:
    def test_extracts_text_field(self):
        assert _texts_from_jsonb([{"text": "a"}, {"text": "b"}]) == ["a", "b"]

    def test_empty_or_none(self):
        assert _texts_from_jsonb(None) == []
        assert _texts_from_jsonb([]) == []


class TestComputeThesisReview:
    @pytest.mark.asyncio
    async def test_no_prior_thesis_produces_no_signal(self):
        with patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_prior:
            mock_prior.return_value = None
            result = await compute_thesis_review("user1", "AAPL", "Apple")
        assert result.has_any_signal is False

    @pytest.mark.asyncio
    async def test_recent_events_produce_medium_confidence_review(self):
        with patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_prior, \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_thesis_review", new_callable=AsyncMock) as mock_ai:
            mock_prior.return_value = _PRIOR_THESIS
            mock_timeline.return_value = _RECENT_EVENTS
            mock_ai.return_value = _AI_RESULT
            result = await compute_thesis_review("user1", "AAPL", "Apple")

        assert result.has_any_signal is True
        assert result.what_changed == _AI_RESULT["what_changed"]
        assert all(c.confidence == "medium" for c in result.broken_variables)
        assert len(result.updated_critical_variables) == 1

        # the real prior variable text must have reached the prompt
        prompt_args = mock_ai.call_args[0]
        assert "El margen de Services debe mantenerse sobre 25%" in prompt_args[3]

    @pytest.mark.asyncio
    async def test_events_older_than_prior_thesis_are_excluded(self):
        old_event = {"event_type": "other", "headline": "Evento viejo", "event_date": "2025-06-01", "created_at": "2025-06-01T00:00:00Z"}
        with patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_prior, \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_thesis_review", new_callable=AsyncMock) as mock_ai:
            mock_prior.return_value = _PRIOR_THESIS
            mock_timeline.return_value = [old_event]
            mock_ai.return_value = dict(_AI_RESULT, what_changed="Sin eventos reales nuevos.")
            await compute_thesis_review("user1", "AAPL", "Apple")

        prompt_args = mock_ai.call_args[0]
        assert "Evento viejo" not in prompt_args[6]  # timeline_summary

    @pytest.mark.asyncio
    async def test_no_recent_events_produces_low_confidence(self):
        with patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_prior, \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_thesis_review", new_callable=AsyncMock) as mock_ai:
            mock_prior.return_value = _PRIOR_THESIS
            mock_timeline.return_value = []
            mock_ai.return_value = _AI_RESULT
            result = await compute_thesis_review("user1", "AAPL", "Apple")

        assert all(c.confidence == "low" for c in result.broken_variables)

    @pytest.mark.asyncio
    async def test_ai_failure_produces_no_signal(self):
        with patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_prior, \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_thesis_review", new_callable=AsyncMock) as mock_ai:
            mock_prior.return_value = _PRIOR_THESIS
            mock_timeline.return_value = _RECENT_EVENTS
            mock_ai.return_value = None
            result = await compute_thesis_review("user1", "AAPL", "Apple")
        assert result.has_any_signal is False


class TestComputeAndSaveThesisReview:
    @pytest.mark.asyncio
    async def test_no_signal_persists_nothing(self):
        with patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_prior, \
             patch("app.services.research.thesis_engine.create_thesis_version", new_callable=AsyncMock) as mock_create:
            mock_prior.return_value = None
            result = await compute_and_save_thesis_review("user1", "AAPL", "Apple")
        assert result.has_any_signal is False
        mock_create.assert_not_called()

    @pytest.mark.asyncio
    async def test_signal_creates_new_version_and_records_outcomes(self):
        mock_db = MagicMock()
        with patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_prior, \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_thesis_review", new_callable=AsyncMock) as mock_ai, \
             patch("app.services.research.thesis_engine.create_thesis_version", new_callable=AsyncMock) as mock_create, \
             patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_prior.return_value = _PRIOR_THESIS
            mock_timeline.return_value = _RECENT_EVENTS
            mock_ai.return_value = _AI_RESULT
            mock_create.return_value = {"id": "t2", "version": 2}
            mock_run.return_value = SimpleNamespace(data=[{"id": "outcome1"}])

            result = await compute_and_save_thesis_review("user1", "AAPL", "Apple")

        assert result.new_thesis_version == {"id": "t2", "version": 2}
        mock_create.assert_called_once()
        assert mock_create.call_args.kwargs["forked_from_draft_id"] == "draft1"

        insert_rows = mock_db.table.return_value.insert.call_args[0][0]
        outcomes_by_text = {r["claim_text"]: r["outcome"] for r in insert_rows}
        assert outcomes_by_text["El margen de Services debe mantenerse sobre 25%."] == "refuted"
        assert outcomes_by_text["Concentración en un solo proveedor."] in ("confirmed", None)  # appears as both still_valid_risk and updated_key_risk
        assert outcomes_by_text["El margen de Services debe recuperar 25% en 2 trimestres."] is None
        assert all(r["ticker"] == "AAPL" for r in insert_rows)
        assert all(r["source_thesis_id"] == "draft1" for r in insert_rows)

    @pytest.mark.asyncio
    async def test_sector_and_industry_propagate_into_outcome_rows(self):
        mock_db = MagicMock()
        with patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_prior, \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_thesis_review", new_callable=AsyncMock) as mock_ai, \
             patch("app.services.research.thesis_engine.create_thesis_version", new_callable=AsyncMock) as mock_create, \
             patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_prior.return_value = _PRIOR_THESIS
            mock_timeline.return_value = _RECENT_EVENTS
            mock_ai.return_value = _AI_RESULT
            mock_create.return_value = {"id": "t2", "version": 2}
            mock_run.return_value = SimpleNamespace(data=[{"id": "outcome1"}])

            await compute_and_save_thesis_review("user1", "AAPL", "Apple", sector="Technology", industry="Software")

        insert_rows = mock_db.table.return_value.insert.call_args[0][0]
        assert all(r["sector"] == "Technology" and r["industry"] == "Software" for r in insert_rows)
