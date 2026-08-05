"""
Tests — app.services.research.bull_bear_engine (Fase 3, Incremento 7).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.quality.deterioration_engine import DeteriorationFactor, DeteriorationResult
from app.services.research.bull_bear_engine import (
    compute_bull_bear,
    _format_catalysts_summary,
    _format_deterioration_summary,
    _claims_from_points,
)

_CATALYSTS = {"catalysts": [
    {"catalyst": "Lanzamiento de nuevo producto", "time_horizon": "corto_plazo", "evidence": "Evidencia real citada."},
]}
_DETERIORATION = DeteriorationResult(
    deteriorating_count=1, improving_count=0, stable_count=1, highest_concern="operating_margin",
    factors=[
        DeteriorationFactor("operating_margin", "deteriorando", -15.0, "Margen operativo cayendo."),
        DeteriorationFactor("roic", "estable", 1.0, "ROIC estable."),
    ],
)
_AI_RESULT = {
    "bull_points": [{"text": "Nuevo producto con evidencia real de lanzamiento.", "category": "catalizador"}],
    "bear_points": [{"text": "Margen operativo en deterioro real.", "category": "deterioro"}],
}


class TestFormatCatalystsSummary:
    def test_includes_real_catalysts(self):
        text = _format_catalysts_summary(_CATALYSTS)
        assert "Lanzamiento de nuevo producto" in text

    def test_empty_when_no_catalysts(self):
        assert _format_catalysts_summary(None) == ""
        assert _format_catalysts_summary({"catalysts": []}) == ""


class TestFormatDeteriorationSummary:
    def test_only_includes_moving_factors(self):
        text = _format_deterioration_summary(_DETERIORATION)
        assert "operating_margin" in text
        assert "roic" not in text

    def test_empty_when_none(self):
        assert _format_deterioration_summary(None) == ""


class TestClaimsFromPoints:
    def test_builds_claims_with_category_in_source(self):
        claims = _claims_from_points([{"text": "x", "category": "riesgo"}], "medium", "base source")
        assert len(claims) == 1
        assert "riesgo" in claims[0].source

    def test_skips_points_without_text(self):
        claims = _claims_from_points([{"category": "riesgo"}], "medium", "base")
        assert claims == []


class TestComputeBullBear:
    @pytest.mark.asyncio
    async def test_composes_catalysts_and_deterioration_into_both_sides(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_bull_bear_case", new_callable=AsyncMock) as mock_ai:
            mock_timeline.return_value = []
            mock_ai.return_value = _AI_RESULT
            result = await compute_bull_bear(
                "AAPL", "Apple", 85.0, 70.0, 75.0, 20.0, None, _CATALYSTS, _DETERIORATION,
            )

        assert result.has_any_signal is True
        assert len(result.bull_case) == 1
        assert len(result.bear_case) == 1
        # both catalysts and deterioration signals must have reached the prompt
        prompt_summary = mock_ai.call_args[0][2]
        assert "Lanzamiento de nuevo producto" in prompt_summary
        assert "operating_margin" in prompt_summary

    @pytest.mark.asyncio
    async def test_ai_failure_produces_no_signal(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.research.timeline_engine.get_company_timeline", new_callable=AsyncMock) as mock_timeline, \
             patch("app.services.ai_service.generate_bull_bear_case", new_callable=AsyncMock) as mock_ai:
            mock_timeline.return_value = []
            mock_ai.return_value = None
            result = await compute_bull_bear("AAPL", "Apple", None, None, None, None, None, None, None)

        assert result.has_any_signal is False
        assert result.bull_case == [] and result.bear_case == []
