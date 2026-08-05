"""
Tests — app.services.research.timeline_engine (Fase 3, Incremento 6).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.research.timeline_engine import (
    get_company_timeline,
    format_timeline_for_prompt,
    filter_by_event_type,
)

_EVENTS = [
    {"event_type": "margin_shift", "headline": "Margen en deterioro", "event_date": "2026-02-01"},
    {"event_type": "ceo_change", "headline": "Nuevo CEO nombrado", "event_date": None},
]


class TestGetCompanyTimeline:
    @pytest.mark.asyncio
    async def test_delegates_to_knowledge_store(self):
        with patch("app.services.research.knowledge_store.get_company_timeline", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = _EVENTS
            result = await get_company_timeline("AAPL", limit=50)
        assert result == _EVENTS
        mock_get.assert_called_once_with("AAPL", 50)


class TestFormatTimelineForPrompt:
    def test_includes_every_event(self):
        text = format_timeline_for_prompt(_EVENTS)
        assert "margin_shift" in text and "Margen en deterioro" in text
        assert "ceo_change" in text and "Nuevo CEO nombrado" in text

    def test_empty_events_produces_empty_string(self):
        assert format_timeline_for_prompt([]) == ""

    def test_respects_max_events(self):
        many = [{"event_type": "other", "headline": f"e{i}", "event_date": None} for i in range(30)]
        text = format_timeline_for_prompt(many, max_events=5)
        assert text.count("- ") == 5


class TestFilterByEventType:
    def test_filters_correctly(self):
        result = filter_by_event_type(_EVENTS, "ceo_change")
        assert len(result) == 1
        assert result[0]["headline"] == "Nuevo CEO nombrado"

    def test_no_match_returns_empty(self):
        assert filter_by_event_type(_EVENTS, "spinoff") == []
