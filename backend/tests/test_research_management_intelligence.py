"""
Tests — app.services.research.management_intelligence (Fase 3, Incremento 5).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.research.management_intelligence import (
    compute_management_intelligence,
    compute_and_save_management_intelligence,
    _build_claims,
)
from app.services.quality.evidence_sources import EvidenceBundle

_AI_RESULT_FIRST_RUN = {
    "strategic_priorities": "Enfoque en expansión de servicios y eficiencia operativa.",
    "capital_allocation_notes": "Recompras consistentes.",
    "guidance_track_record_note": "Sin evidencia pública suficiente.",
    "consistency_assessment": "Discurso consistente en la evidencia disponible.",
    "strategy_change_classification": "no_change",  # model got this wrong on purpose for the test
    "strategy_change_explanation": "El modelo dijo esto incorrectamente.",
}

_AI_RESULT_REAL_CHANGE = {
    "strategic_priorities": "Nuevo énfasis en IA generativa como prioridad #1.",
    "capital_allocation_notes": "x", "guidance_track_record_note": "x", "consistency_assessment": "x",
    "strategy_change_classification": "strategy_change",
    "strategy_change_explanation": "La empresa pasó de enfocarse en hardware a IA generativa.",
}


class TestBuildClaims:
    def test_text_fields_become_inference_claims(self):
        claims = _build_claims(dict(_AI_RESULT_REAL_CHANGE, strategy_change_classification="no_prior_data"), has_real_evidence=True)
        assert sum(1 for c in claims if c.kind == "inference") == 4

    def test_real_change_classification_becomes_ai_opinion_claim(self):
        claims = _build_claims(_AI_RESULT_REAL_CHANGE, has_real_evidence=True)
        opinion_claims = [c for c in claims if c.kind == "ai_opinion"]
        assert len(opinion_claims) == 1
        assert "IA generativa" in opinion_claims[0].text

    def test_no_prior_data_produces_no_opinion_claim(self):
        result = dict(_AI_RESULT_REAL_CHANGE, strategy_change_classification="no_prior_data", strategy_change_explanation=None)
        claims = _build_claims(result, has_real_evidence=True)
        assert not any(c.kind == "ai_opinion" for c in claims)

    def test_low_confidence_without_real_evidence(self):
        claims = _build_claims(_AI_RESULT_REAL_CHANGE, has_real_evidence=False)
        assert all(c.confidence == "low" for c in claims)


class TestComputeManagementIntelligence:
    @pytest.mark.asyncio
    async def test_first_run_forces_no_prior_data_even_if_model_says_otherwise(self):
        """The model in this test incorrectly returns 'no_change' with no
        prior snapshot — compute_management_intelligence must override
        this defensively, per the module's hard invariant."""
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_management_intelligence", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = _AI_RESULT_FIRST_RUN
            result = await compute_management_intelligence("AAPL", "Apple")

        assert result.strategy_change_classification == "no_prior_data"
        assert result.strategy_change_explanation is None

    @pytest.mark.asyncio
    async def test_real_prior_snapshot_is_passed_to_the_prompt(self):
        prior_snapshot = {"content": {"strategic_priorities": "Prior: hardware first."}}
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=prior_snapshot), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_management_intelligence", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = _AI_RESULT_REAL_CHANGE
            result = await compute_management_intelligence("AAPL", "Apple")

        assert result.strategy_change_classification == "strategy_change"
        prompt_args = mock_ai.call_args[0]
        assert prompt_args[3] == "Prior: hardware first."  # prior_summary

    @pytest.mark.asyncio
    async def test_ai_failure_produces_no_signal(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_management_intelligence", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = None
            result = await compute_management_intelligence("AAPL", "Apple")

        assert result.has_any_signal is False
        assert result.claims == []


class TestComputeAndSaveManagementIntelligence:
    @pytest.mark.asyncio
    async def test_saves_snapshot(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_management_intelligence", new_callable=AsyncMock) as mock_ai, \
             patch("app.services.research.knowledge_store.save_snapshot", new_callable=AsyncMock) as mock_save:
            mock_ai.return_value = _AI_RESULT_FIRST_RUN
            mock_save.return_value = {"id": "snap1"}
            await compute_and_save_management_intelligence("AAPL", "Apple")

        mock_save.assert_called_once()
        args, _ = mock_save.call_args
        assert args[1] == "management"
