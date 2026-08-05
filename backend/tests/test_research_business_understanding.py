"""
Tests — app.services.research.business_understanding (Fase 3, Incremento 3).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.research.business_understanding import (
    BusinessUnderstandingResult,
    compute_business_understanding,
    compute_and_save_business_understanding,
    _build_claims,
)

_SEGMENTS = [{"name": "iPhone", "revenue": 200_000_000_000, "pct_of_total": 55.0}]

_AI_RESULT = {
    "how_it_makes_money": "Vende hardware con alto margen y servicios recurrentes.",
    "what_it_sells": "Smartphones, computadoras y servicios digitales.",
    "who_pays": "Consumidores finales y empresas.",
    "key_customers": "Consumidores globales.",
    "growth_drivers": "Expansión de servicios.",
    "growth_limiters": "Saturación del mercado de smartphones.",
    "most_profitable_segment": "Services.",
    "value_destroying_segment": "ninguno identificado con la evidencia disponible",
    "business_change_since_last_review": None,
}

_DOCUMENT_INTEL_SNAPSHOT = {
    "content": {"filing_10k": {"business": "Real business text from the 10-K."}},
    "source_period": "2025-11-01",
}


class TestBuildClaims:
    def test_grounded_in_real_filing_text_uses_medium_confidence(self):
        claims = _build_claims(_AI_RESULT, grounded_in_real_filing_text=True)
        assert all(c.confidence == "medium" for c in claims)
        assert all(c.kind == "inference" for c in claims)

    def test_segments_only_uses_low_confidence(self):
        claims = _build_claims(_AI_RESULT, grounded_in_real_filing_text=False)
        assert all(c.confidence == "low" for c in claims)

    def test_null_business_change_produces_no_extra_claim(self):
        claims = _build_claims(_AI_RESULT, grounded_in_real_filing_text=True)
        assert not any("revisión anterior" in (c.source or "") for c in claims)

    def test_real_business_change_produces_a_claim(self):
        result = dict(_AI_RESULT, business_change_since_last_review="Nuevo segmento de servicios de salud.")
        claims = _build_claims(result, grounded_in_real_filing_text=True)
        assert any("revisión anterior" in (c.source or "") for c in claims)

    def test_number_of_claims_matches_populated_fields(self):
        claims = _build_claims(_AI_RESULT, grounded_in_real_filing_text=True)
        assert len(claims) == 8  # 8 populated _CLAIM_FIELDS, business_change is None


class TestComputeBusinessUnderstanding:
    @pytest.mark.asyncio
    async def test_grounds_prompt_in_real_filing_text_and_prior_snapshot(self):
        prior_snapshot = {"content": {"how_it_makes_money": "Prior description."}}
        with patch("app.services.research.knowledge_store.get_latest_snapshot", side_effect=[_DOCUMENT_INTEL_SNAPSHOT, prior_snapshot]), \
             patch("app.services.ai_service.generate_business_understanding", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = _AI_RESULT
            result = await compute_business_understanding("AAPL", "Apple", _SEGMENTS)

        assert result.has_any_signal is True
        assert result.how_it_makes_money == _AI_RESULT["how_it_makes_money"]
        mock_ai.assert_called_once()
        args = mock_ai.call_args[0]
        assert args[3] == "Real business text from the 10-K."  # filing_business_text
        assert args[4] == "Prior description."  # prior_summary

    @pytest.mark.asyncio
    async def test_first_ever_run_has_no_prior_summary(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", side_effect=[None, None]), \
             patch("app.services.ai_service.generate_business_understanding", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = _AI_RESULT
            await compute_business_understanding("AAPL", "Apple", _SEGMENTS)

        args = mock_ai.call_args[0]
        assert args[3] == ""  # no document_intel snapshot -> empty filing text
        assert args[4] is None  # no prior snapshot

    @pytest.mark.asyncio
    async def test_ai_failure_degrades_to_no_signal(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", side_effect=[None, None]), \
             patch("app.services.ai_service.generate_business_understanding", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = None
            result = await compute_business_understanding("AAPL", "Apple", _SEGMENTS)

        assert result.has_any_signal is False
        assert result.claims == []


class TestComputeAndSaveBusinessUnderstanding:
    @pytest.mark.asyncio
    async def test_saves_snapshot_using_document_intel_source_period(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", side_effect=[_DOCUMENT_INTEL_SNAPSHOT, None, _DOCUMENT_INTEL_SNAPSHOT]), \
             patch("app.services.ai_service.generate_business_understanding", new_callable=AsyncMock) as mock_ai, \
             patch("app.services.research.knowledge_store.save_snapshot", new_callable=AsyncMock) as mock_save:
            mock_ai.return_value = _AI_RESULT
            mock_save.return_value = {"id": "snap1"}
            result = await compute_and_save_business_understanding("AAPL", "Apple", _SEGMENTS)

        assert result.how_it_makes_money == _AI_RESULT["how_it_makes_money"]
        mock_save.assert_called_once()
        args, kwargs = mock_save.call_args
        assert args[0] == "AAPL"
        assert args[1] == "business_understanding"
        assert kwargs["source_period"] == "2025-11-01"
