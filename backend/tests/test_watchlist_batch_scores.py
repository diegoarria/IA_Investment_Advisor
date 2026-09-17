"""
Tests — app.api.routes.watchlist's Watchlist Inteligente helpers (Fase 4,
Incremento 9, Parte I). See /Users/diegoarria/.claude/plans/stateful-
painting-flurry.md.

Only the pure/cache-reading helpers are tested here (`_extract_ticker_scores`,
`_fetch_thesis_status_batch`) — no FastAPI TestClient/route-level tests exist
anywhere in this suite (mocking Supabase's fluent query builder end-to-end
through a real HTTP call is avoided throughout, per test_premium_gating.py's
own docstring), so this follows the same established convention.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.routes.watchlist import _extract_ticker_scores, _fetch_thesis_status_batch, _select_featured_ticker


class TestExtractTickerScores:
    def test_both_caches_missing_returns_all_none(self):
        row = _extract_ticker_scores(None, None)
        assert row == {
            "quality_score": None,
            "conviction_score": None,
            "margin_of_safety_pct": None,
            "fair_value_range": None,
            "opportunity_score": None,
            "deteriorating_count": None,
            "improving_count": None,
            "top_catalysts": [],
        }

    def test_pulls_real_fields_from_nif_dashboard_cache(self):
        nif_cached = {
            "pillars": {
                "business_quality": {"score": 78},
                "valuation": {"nuvos_estimate": {
                    "fair_value_range": {"low": 100, "high": 140},
                    "margin_of_safety_pct": 12.5,
                }},
            },
            "conviction": {"score": 65},
            "deterioration": {"deteriorating_count": 1, "improving_count": 2},
            "catalysts": {"catalysts": [
                {"catalyst": "Nuevo producto X"}, {"catalyst": "Expansión en Y"}, {"catalyst": "Tercero"},
            ]},
        }
        row = _extract_ticker_scores(nif_cached, None)
        assert row["quality_score"] == 78
        assert row["conviction_score"] == 65
        assert row["margin_of_safety_pct"] == 12.5
        assert row["fair_value_range"] == {"low": 100, "high": 140}
        assert row["deteriorating_count"] == 1
        assert row["improving_count"] == 2
        # only the top 2, never fabricated beyond what's cached
        assert row["top_catalysts"] == ["Nuevo producto X", "Expansión en Y"]

    def test_opportunity_score_comes_from_quick_analysis_composite_score(self):
        row = _extract_ticker_scores(None, {"composite_score": 71.4})
        assert row["opportunity_score"] == 71.4

    def test_margin_of_safety_falls_back_to_quick_analysis_when_nif_missing(self):
        row = _extract_ticker_scores(None, {"margin_of_safety_pct": 8.0})
        assert row["margin_of_safety_pct"] == 8.0

    def test_nif_margin_of_safety_wins_over_quick_analysis_when_both_present(self):
        nif_cached = {"pillars": {"valuation": {"nuvos_estimate": {"margin_of_safety_pct": 20.0}}}}
        row = _extract_ticker_scores(nif_cached, {"margin_of_safety_pct": 8.0})
        assert row["margin_of_safety_pct"] == 20.0

    def test_catalysts_without_catalyst_text_are_skipped(self):
        nif_cached = {"catalysts": {"catalysts": [{"type": "producto"}, {"catalyst": "Real one"}]}}
        row = _extract_ticker_scores(nif_cached, None)
        assert row["top_catalysts"] == ["Real one"]


class TestSelectFeaturedTicker:
    """Free's one real Smart Score per week (2026-09-17) — no flat 403
    anymore, one ticker gets a full real row, rotating weekly."""

    def test_deterministic_within_the_same_week(self):
        tickers = ["AAPL", "MSFT", "GOOG", "TSLA"]
        first = _select_featured_ticker("user1", tickers)
        second = _select_featured_ticker("user1", tickers)
        assert first == second
        assert first in tickers

    def test_different_users_can_get_different_featured_tickers(self):
        tickers = ["AAPL", "MSFT", "GOOG", "TSLA", "NFLX", "AMZN"]
        picks = {_select_featured_ticker(f"user{i}", tickers) for i in range(20)}
        # not a hard guarantee for any single hash, but 20 distinct users
        # over 6 slots should not all collapse onto the same one ticker
        assert len(picks) > 1

    def test_single_ticker_watchlist_always_returns_it(self):
        assert _select_featured_ticker("user1", ["AAPL"]) == "AAPL"


class TestFetchThesisStatusBatch:
    @pytest.mark.asyncio
    async def test_no_thesis_when_neither_table_has_a_row(self):
        mock_db = MagicMock()
        with patch("app.api.routes.watchlist.get_supabase", return_value=mock_db), \
             patch("app.api.routes.watchlist.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = [SimpleNamespace(data=[]), SimpleNamespace(data=[])]
            result = await _fetch_thesis_status_batch("user1", ["AAPL"])
        assert result == {"AAPL": {"thesis_status": "no_thesis", "top_risks": []}}

    @pytest.mark.asyncio
    async def test_draft_only_when_shared_draft_exists_but_no_user_thesis(self):
        mock_db = MagicMock()
        drafts = [{"ticker": "AAPL", "key_risks": [{"text": "Riesgo de márgenes"}, {"text": "Competencia"}]}]
        with patch("app.api.routes.watchlist.get_supabase", return_value=mock_db), \
             patch("app.api.routes.watchlist.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = [SimpleNamespace(data=drafts), SimpleNamespace(data=[])]
            result = await _fetch_thesis_status_batch("user1", ["AAPL"])
        assert result["AAPL"]["thesis_status"] == "draft_only"
        assert result["AAPL"]["top_risks"] == ["Riesgo de márgenes", "Competencia"]

    @pytest.mark.asyncio
    async def test_user_thesis_wins_over_draft_only(self):
        mock_db = MagicMock()
        drafts = [{"ticker": "AAPL", "key_risks": [{"text": "Riesgo"}]}]
        mine = [{"ticker": "AAPL"}]
        with patch("app.api.routes.watchlist.get_supabase", return_value=mock_db), \
             patch("app.api.routes.watchlist.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = [SimpleNamespace(data=drafts), SimpleNamespace(data=mine)]
            result = await _fetch_thesis_status_batch("user1", ["AAPL"])
        assert result["AAPL"]["thesis_status"] == "user_thesis"

    @pytest.mark.asyncio
    async def test_multiple_tickers_each_get_their_own_real_status(self):
        mock_db = MagicMock()
        drafts = [{"ticker": "AAPL", "key_risks": []}]
        mine = [{"ticker": "MSFT"}]
        with patch("app.api.routes.watchlist.get_supabase", return_value=mock_db), \
             patch("app.api.routes.watchlist.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.side_effect = [SimpleNamespace(data=drafts), SimpleNamespace(data=mine)]
            result = await _fetch_thesis_status_batch("user1", ["AAPL", "MSFT", "GOOG"])
        assert result["AAPL"]["thesis_status"] == "draft_only"
        assert result["MSFT"]["thesis_status"] == "user_thesis"
        assert result["GOOG"]["thesis_status"] == "no_thesis"
