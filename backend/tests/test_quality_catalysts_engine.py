"""
Tests — app.services.quality.catalysts_engine (Fase 2, Incremento 9).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import patch

import pytest

from app.services.quality.catalysts_engine import compute_catalysts, _format_segments_summary
from app.services.quality.evidence_sources import EvidenceBundle

_SEGMENTS = [
    {"name": "iPhone", "revenue": 200_000_000_000, "pct_of_total": 55.0},
    {"name": "Services", "revenue": 90_000_000_000, "pct_of_total": 25.0},
]


class TestFormatSegmentsSummary:
    def test_includes_every_segment_and_its_pct(self):
        text = _format_segments_summary(_SEGMENTS)
        assert "iPhone" in text
        assert "55.0%" in text
        assert "Services" in text
        assert "25.0%" in text

    def test_empty_segments_produces_empty_string(self):
        assert _format_segments_summary([]) == ""


class TestComputeCatalysts:
    @pytest.mark.asyncio
    async def test_returns_none_when_no_segments_and_no_evidence(self):
        empty_bundle = EvidenceBundle(ticker="ZZZ", topic="catalysts")
        with patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=empty_bundle):
            result = await compute_catalysts("ZZZ", "Unknown Co", [])
        assert result is None

    @pytest.mark.asyncio
    async def test_calls_ai_service_when_segments_present_even_without_evidence(self):
        empty_bundle = EvidenceBundle(ticker="AAPL", topic="catalysts")
        ai_result = {"catalysts": []}
        with patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=empty_bundle), \
             patch("app.services.ai_service.generate_catalysts", return_value=ai_result) as mock_ai:
            result = await compute_catalysts("AAPL", "Apple", _SEGMENTS)
        assert result == ai_result
        mock_ai.assert_called_once()

    @pytest.mark.asyncio
    async def test_calls_ai_service_when_real_evidence_exists(self):
        real_bundle = EvidenceBundle(
            ticker="AAPL", topic="catalysts",
            filing_evidence={"business": "Real text."}, search_answer="Real answer about a new product launch.",
        )
        ai_result = {
            "catalysts": [
                {"catalyst": "Nuevo producto en categoría X", "type": "producto", "evidence": "e", "time_horizon": "corto_plazo", "impact_if_realized": "i"},
            ],
        }
        with patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=real_bundle), \
             patch("app.services.ai_service.generate_catalysts", return_value=ai_result) as mock_ai:
            result = await compute_catalysts("AAPL", "Apple", [])
        assert result == ai_result
        mock_ai.assert_called_once()
