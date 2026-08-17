"""
Regression test — Diego's Aug 16 Free/Premium spec, §8: Thesis Tracker
(`POST /research-engine/company/{ticker}/thesis/review`) is 100% Premium.
Previously ungated entirely (the file's own docstring said gating was
"left for later, not invented here").
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes.research_engine import review_thesis_route


class TestThesisReviewGating:
    @pytest.mark.asyncio
    async def test_free_user_gets_402_never_reaches_the_real_compute(self):
        with patch("app.api.routes.chat._get_user_profile", new_callable=AsyncMock, return_value=object()), \
             patch("app.api.routes.chat._is_premium", return_value=False), \
             patch("app.services.research.thesis_tracker.compute_and_save_thesis_review", new_callable=AsyncMock) as mock_compute:
            with pytest.raises(HTTPException) as exc_info:
                await review_thesis_route(ticker="AAPL", user_id="free_user")

        assert exc_info.value.status_code == 402
        mock_compute.assert_not_called()

    @pytest.mark.asyncio
    async def test_premium_user_reaches_the_real_compute(self):
        from types import SimpleNamespace

        fake_data = {"company_name": "Apple", "sector": "Technology", "dcf": {}}
        fake_result = SimpleNamespace(
            has_any_signal=True, what_changed=["x"], thesis_change_explanation="y", new_thesis_version={"id": "v2"},
        )
        with patch("app.api.routes.chat._get_user_profile", new_callable=AsyncMock, return_value=object()), \
             patch("app.api.routes.chat._is_premium", return_value=True), \
             patch("app.services.fundamental_analysis_service.get_fundamental_analysis", return_value=fake_data), \
             patch("app.api.routes.screener.UNIVERSE", [{"ticker": "AAPL", "industry": "Consumer Electronics"}]), \
             patch("app.services.research.thesis_tracker.compute_and_save_thesis_review", new_callable=AsyncMock, return_value=fake_result) as mock_compute:
            result = await review_thesis_route(ticker="AAPL", user_id="premium_user")

        mock_compute.assert_called_once()
        assert result["new_thesis_version"] == {"id": "v2"}
