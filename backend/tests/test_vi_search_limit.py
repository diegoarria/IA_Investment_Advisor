"""
Regression test — Diego's Aug 16 Free/Premium spec, §4, later revised: Free
gets exactly 3 Valor Intrínseco / DCF searches per rolling 7-day window
(raised from the original 2 once Diego confirmed every frontend copy
already promised 3 — see _FREE_VI_SEARCH_LIMIT's own docstring in
screener.py), never more (not 5/month, not 10/month, not unlimited).
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes.screener import _check_and_increment_vi_search_limit, _FREE_VI_SEARCH_LIMIT


class TestViSearchLimit:
    def test_limit_is_exactly_three(self):
        assert _FREE_VI_SEARCH_LIMIT == 3

    @pytest.mark.asyncio
    async def test_first_search_in_a_fresh_window_is_allowed(self):
        profile = SimpleNamespace(vi_search_window_start=None, vi_search_count=0)
        mock_db = MagicMock()
        with patch("app.api.routes.screener.get_supabase", return_value=mock_db), \
             patch("app.api.routes.screener.run_query", new_callable=AsyncMock) as mock_run:
            await _check_and_increment_vi_search_limit("user1", profile)
        mock_run.assert_called_once()

    @pytest.mark.asyncio
    async def test_second_search_in_same_window_is_allowed(self):
        from datetime import datetime, timezone
        profile = SimpleNamespace(vi_search_window_start=datetime.now(timezone.utc).isoformat(), vi_search_count=1)
        mock_db = MagicMock()
        with patch("app.api.routes.screener.get_supabase", return_value=mock_db), \
             patch("app.api.routes.screener.run_query", new_callable=AsyncMock) as mock_run:
            await _check_and_increment_vi_search_limit("user1", profile)
        mock_run.assert_called_once()

    @pytest.mark.asyncio
    async def test_third_search_in_same_window_is_allowed(self):
        from datetime import datetime, timezone
        profile = SimpleNamespace(vi_search_window_start=datetime.now(timezone.utc).isoformat(), vi_search_count=2)
        mock_db = MagicMock()
        with patch("app.api.routes.screener.get_supabase", return_value=mock_db), \
             patch("app.api.routes.screener.run_query", new_callable=AsyncMock) as mock_run:
            await _check_and_increment_vi_search_limit("user1", profile)
        mock_run.assert_called_once()

    @pytest.mark.asyncio
    async def test_fourth_search_in_same_window_is_blocked(self):
        from datetime import datetime, timezone
        profile = SimpleNamespace(vi_search_window_start=datetime.now(timezone.utc).isoformat(), vi_search_count=3)
        mock_db = MagicMock()
        with patch("app.api.routes.screener.get_supabase", return_value=mock_db), \
             patch("app.api.routes.screener.run_query", new_callable=AsyncMock) as mock_run:
            with pytest.raises(HTTPException) as exc_info:
                await _check_and_increment_vi_search_limit("user1", profile)
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["code"] == "vi_search_limit"
        mock_run.assert_not_called()

    @pytest.mark.asyncio
    async def test_window_expiry_resets_the_counter(self):
        from datetime import datetime, timedelta, timezone
        stale_start = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        profile = SimpleNamespace(vi_search_window_start=stale_start, vi_search_count=3)
        mock_db = MagicMock()
        with patch("app.api.routes.screener.get_supabase", return_value=mock_db), \
             patch("app.api.routes.screener.run_query", new_callable=AsyncMock) as mock_run:
            await _check_and_increment_vi_search_limit("user1", profile)
        mock_run.assert_called_once()
        args, _ = mock_run.call_args
