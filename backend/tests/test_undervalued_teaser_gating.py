"""
Regression test — Diego's Aug 16 Free/Premium spec, §5: Oportunidades
(GET /market/screener/undervalued) is 100% Premium, no limited free
version, but Free must see a REAL, never-hardcoded count of how many
candidates exist this week — never tickers/content.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.api.routes.screener import undervalued


class TestUndervaluedTeaserGating:
    @pytest.mark.asyncio
    async def test_free_user_gets_real_count_never_tickers(self):
        full_results = {"results": [{"ticker": "AAPL"}, {"ticker": "MSFT"}, {"ticker": "GOOG"}], "generated_at": 123}
        with patch("app.api.routes.screener._get_user_profile_safe", new_callable=AsyncMock, return_value=object()), \
             patch("app.api.routes.chat._is_premium", return_value=False), \
             patch("app.services.undervalued_screener_service.get_undervalued", return_value=full_results):
            result = await undervalued(user_id="free_user")

        assert result == {"is_premium": False, "teaser_count": 3}

    @pytest.mark.asyncio
    async def test_free_user_zero_candidates_shows_real_zero(self):
        empty_results = {"results": [], "generated_at": 0}
        with patch("app.api.routes.screener._get_user_profile_safe", new_callable=AsyncMock, return_value=object()), \
             patch("app.api.routes.chat._is_premium", return_value=False), \
             patch("app.services.undervalued_screener_service.get_undervalued", return_value=empty_results), \
             patch("app.services.undervalued_screener_service.bootstrap_fill_if_empty_sync"):
            result = await undervalued(user_id="free_user")

        assert result == {"is_premium": False, "teaser_count": 0}

    @pytest.mark.asyncio
    async def test_premium_user_gets_the_full_results(self):
        full_results = {"results": [{"ticker": "AAPL"}], "generated_at": 123}
        with patch("app.api.routes.screener._get_user_profile_safe", new_callable=AsyncMock, return_value=object()), \
             patch("app.api.routes.chat._is_premium", return_value=True), \
             patch("app.services.undervalued_screener_service.get_undervalued", return_value=full_results):
            result = await undervalued(user_id="premium_user")

        assert result["is_premium"] is True
        assert result["results"] == [{"ticker": "AAPL"}]
