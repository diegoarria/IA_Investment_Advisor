"""
Regression test — Diego's Aug 16 Free/Premium spec, §6: this route used to
return the FULL Morning Brief to any authenticated user, free or Premium,
despite the module docstring always saying "Premium-only." Free users must
now get a real-number teaser (counts only, never news/event content).
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.api.routes.morning_brief import get_morning_brief_route


FULL_RESULT = {
    "portfolio_value": 15000.0, "change_usd": 250.0, "change_pct": 1.7,
    "news": [{"headline": "Apple beats earnings"}, {"headline": "Fed holds rates"}],
    "events": [{"title": "AAPL earnings call"}],
    "top_mover": {"ticker": "AAPL", "change_pct": 3.2},
}


class TestMorningBriefRouteGating:
    @pytest.mark.asyncio
    async def test_free_user_gets_teaser_counts_never_the_content(self):
        with patch("app.api.routes.chat._get_user_profile", new_callable=AsyncMock, return_value=object()), \
             patch("app.api.routes.chat._is_premium", return_value=False), \
             patch("app.services.morning_brief_service.get_morning_brief", new_callable=AsyncMock, return_value=FULL_RESULT):
            result = await get_morning_brief_route(user_id="free_user")

        assert result["is_premium"] is False
        assert result["news_count"] == 2
        assert result["events_count"] == 1
        assert result["portfolio_value"] == 15000.0
        assert "news" not in result
        assert "events" not in result
        assert "top_mover" not in result

    @pytest.mark.asyncio
    async def test_premium_user_gets_the_full_content(self):
        with patch("app.api.routes.chat._get_user_profile", new_callable=AsyncMock, return_value=object()), \
             patch("app.api.routes.chat._is_premium", return_value=True), \
             patch("app.services.morning_brief_service.get_morning_brief", new_callable=AsyncMock, return_value=FULL_RESULT):
            result = await get_morning_brief_route(user_id="premium_user")

        assert result["is_premium"] is True
        assert result["news"] == FULL_RESULT["news"]
        assert result["events"] == FULL_RESULT["events"]
        assert result["top_mover"] == FULL_RESULT["top_mover"]

    @pytest.mark.asyncio
    async def test_no_brief_available_yet_raises_404_regardless_of_tier(self):
        from fastapi import HTTPException

        with patch("app.api.routes.chat._get_user_profile", new_callable=AsyncMock, return_value=object()), \
             patch("app.api.routes.chat._is_premium", return_value=True), \
             patch("app.services.morning_brief_service.get_morning_brief", new_callable=AsyncMock, return_value=None):
            with pytest.raises(HTTPException) as exc_info:
                await get_morning_brief_route(user_id="user1")
        assert exc_info.value.status_code == 404
