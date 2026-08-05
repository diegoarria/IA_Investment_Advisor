"""
Tests — app.services.research.change_detection (Fase 3, Incremento 6).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.quality.deterioration_engine import DeteriorationFactor, DeteriorationResult
from app.services.research.change_detection import (
    compute_change_detection,
    compute_and_save_change_detection,
    _format_deterioration_summary,
    _format_management_change_note,
    _build_detected_changes,
)

_DETERIORATION_WITH_SIGNAL = DeteriorationResult(
    deteriorating_count=1, improving_count=0, stable_count=4, highest_concern="operating_margin",
    factors=[
        DeteriorationFactor("roic", "estable", 2.0, "ROIC estable."),
        DeteriorationFactor("operating_margin", "deteriorando", -18.0, "Margen operativo cayendo."),
    ],
)
_DETERIORATION_ALL_STABLE = DeteriorationResult(
    deteriorating_count=0, improving_count=0, stable_count=2, highest_concern=None,
    factors=[DeteriorationFactor("roic", "estable", 1.0, "ROIC estable.")],
)

_AI_EVENTS_RESULT = {
    "events": [
        {"event_type": "margin_shift", "headline": "Margen operativo en deterioro",
         "what_changed_fact": "Margen operativo cayendo -18%.", "why_inference": "Posible presión competitiva de precios."},
    ],
}


class TestFormatDeteriorationSummary:
    def test_only_includes_moving_factors(self):
        text = _format_deterioration_summary(_DETERIORATION_WITH_SIGNAL)
        assert "operating_margin" in text
        assert "roic" not in text  # estable, excluded

    def test_all_stable_produces_empty_string(self):
        assert _format_deterioration_summary(_DETERIORATION_ALL_STABLE) == ""

    def test_none_produces_empty_string(self):
        assert _format_deterioration_summary(None) == ""


class TestFormatManagementChangeNote:
    def test_real_change_produces_a_note(self):
        content = {"strategy_change_classification": "strategy_change", "strategy_change_explanation": "Nuevo foco en IA."}
        note = _format_management_change_note(content)
        assert "strategy_change" in note and "Nuevo foco en IA" in note

    def test_no_prior_data_produces_none(self):
        assert _format_management_change_note({"strategy_change_classification": "no_prior_data"}) is None

    def test_no_change_produces_none(self):
        assert _format_management_change_note({"strategy_change_classification": "no_change"}) is None

    def test_empty_content_produces_none(self):
        assert _format_management_change_note(None) is None
        assert _format_management_change_note({}) is None


class TestBuildDetectedChanges:
    def test_grounded_event_produces_fact_and_inference_claims(self):
        changes = _build_detected_changes(_AI_EVENTS_RESULT, has_real_deterioration_signal=True, has_real_business_or_management_signal=False)
        assert len(changes) == 1
        kinds = [c.kind for c in changes[0].claims]
        assert kinds == ["fact", "inference"]
        assert changes[0].claims[0].confidence == "high"  # grounded in real deterioration
        assert changes[0].claims[1].confidence == "high"  # min_confidence caps at the fact's own confidence

    def test_qualitative_only_signal_uses_medium_fact_confidence(self):
        changes = _build_detected_changes(_AI_EVENTS_RESULT, has_real_deterioration_signal=False, has_real_business_or_management_signal=True)
        assert changes[0].claims[0].confidence == "medium"

    def test_no_events_returns_empty_list(self):
        assert _build_detected_changes({"events": []}, True, False) == []
        assert _build_detected_changes(None, True, False) == []

    def test_event_missing_required_fields_is_skipped(self):
        result = {"events": [{"event_type": "other", "headline": None, "what_changed_fact": "x"}]}
        assert _build_detected_changes(result, True, False) == []


class TestComputeChangeDetection:
    @pytest.mark.asyncio
    async def test_combines_all_three_signals_into_the_prompt(self):
        business_snapshot = {"content": {"business_change_since_last_review": "Nuevo segmento de salud."}}
        management_snapshot = {"content": {"strategy_change_classification": "strategy_change", "strategy_change_explanation": "Foco en IA."}}
        with patch("app.services.research.knowledge_store.get_latest_snapshot", side_effect=[business_snapshot, management_snapshot]), \
             patch("app.services.ai_service.generate_change_interpretation", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = _AI_EVENTS_RESULT
            result = await compute_change_detection("AAPL", "Apple", _DETERIORATION_WITH_SIGNAL)

        assert result.has_any_signal is True
        prompt_args = mock_ai.call_args[0]
        assert "operating_margin" in prompt_args[2]  # deterioration_summary
        assert "Nuevo segmento de salud" in prompt_args[3]  # business_change_note
        assert "strategy_change" in prompt_args[4]  # management_change_note

    @pytest.mark.asyncio
    async def test_no_real_signal_at_all_produces_empty_events_prompt(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", side_effect=[None, None]), \
             patch("app.services.ai_service.generate_change_interpretation", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = {"events": []}
            result = await compute_change_detection("AAPL", "Apple", _DETERIORATION_ALL_STABLE)

        assert result.has_any_signal is False
        assert result.detected_changes == []

    @pytest.mark.asyncio
    async def test_ai_failure_produces_no_signal(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", side_effect=[None, None]), \
             patch("app.services.ai_service.generate_change_interpretation", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = None
            result = await compute_change_detection("AAPL", "Apple", _DETERIORATION_WITH_SIGNAL)

        assert result.has_any_signal is False


class TestComputeAndSaveChangeDetection:
    @pytest.mark.asyncio
    async def test_saves_one_timeline_event_per_detected_change(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", side_effect=[None, None]), \
             patch("app.services.ai_service.generate_change_interpretation", new_callable=AsyncMock) as mock_ai, \
             patch("app.services.research.knowledge_store.save_timeline_event", new_callable=AsyncMock) as mock_save:
            mock_ai.return_value = _AI_EVENTS_RESULT
            mock_save.return_value = {"id": "evt1"}
            result = await compute_and_save_change_detection("AAPL", "Apple", _DETERIORATION_WITH_SIGNAL)

        assert len(result.detected_changes) == 1
        mock_save.assert_called_once()
        args, kwargs = mock_save.call_args
        assert args[0] == "AAPL"
        assert args[1] == "margin_shift"
        assert kwargs["source_claim"]["kind"] == "fact"
