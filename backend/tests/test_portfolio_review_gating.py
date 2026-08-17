"""
Regression test — Diego's Aug 16 Free/Premium spec, §9: Sunday Portfolio
Review is Premium-only content (the AI-written `insight` sentence). Free
users keep the real numbers (they already own that data) but never get
`insight` — same pattern as weekly_rituals_service.get_sunday_prep.
"""
from unittest.mock import AsyncMock, MagicMock, patch
from types import SimpleNamespace

import pytest

from app.services.weekly_rituals_service import get_portfolio_review


class TestGetPortfolioReviewGating:
    @pytest.mark.asyncio
    async def test_free_user_gets_real_numbers_but_no_insight(self):
        numbers = {"total_value": 15000.0, "change_usd": 250.0, "change_pct": 1.7, "top_sector": "Technology"}
        with patch("app.services.weekly_rituals_service._portfolio_review_numbers", new_callable=AsyncMock, return_value=numbers):
            result = await get_portfolio_review("user1", is_premium=False)

        assert result["total_value"] == 15000.0
        assert result["change_usd"] == 250.0
        assert result["insight"] is None
        assert result["is_premium"] is False

    @pytest.mark.asyncio
    async def test_premium_user_gets_the_real_insight_text(self):
        numbers = {"total_value": 15000.0, "change_usd": 250.0, "change_pct": 1.7, "top_sector": "Technology"}
        mock_db = MagicMock()
        log_res = SimpleNamespace(data=[{"body": "Tu portafolio subió gracias a AAPL", "sent_at": "2026-08-16T12:00:00Z"}])
        with patch("app.services.weekly_rituals_service._portfolio_review_numbers", new_callable=AsyncMock, return_value=numbers), \
             patch("app.services.weekly_rituals_service.get_supabase", return_value=mock_db), \
             patch("app.services.weekly_rituals_service.run_query", new_callable=AsyncMock, return_value=log_res):
            result = await get_portfolio_review("user1", is_premium=True)

        assert result["insight"] == "Tu portafolio subió gracias a AAPL"
        assert result["is_premium"] is True

    @pytest.mark.asyncio
    async def test_no_snapshot_returns_none_regardless_of_tier(self):
        with patch("app.services.weekly_rituals_service._portfolio_review_numbers", new_callable=AsyncMock, return_value=None):
            assert await get_portfolio_review("user1", is_premium=True) is None
            assert await get_portfolio_review("user1", is_premium=False) is None
