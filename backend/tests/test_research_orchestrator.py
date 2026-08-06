"""
Tests — app.services.research.research_orchestrator (Fase 3, Incremento 10).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.research.research_orchestrator import compose_research_dossier
from app.services.research.business_understanding import BusinessUnderstandingResult
from app.services.research.competitive_intelligence import CompetitiveIntelligenceResult
from app.services.research.industry_intelligence import IndustryIntelligenceResult
from app.services.research.management_intelligence import ManagementIntelligenceResult
from app.services.research.thesis_engine import ThesisDraftResult

_FAKE_DATA = {
    "ticker": "AAPL", "company_name": "Apple Inc.", "sector": "Technology",
    "dcf": {"growth_buildup": {"avg_roic_pct": 30.0}, "wacc_details": {"beta": 1.1},
            "margin_of_safety_pct": 20.0, "fair_value_range": {"low": 150, "high": 200}},
    "segments": [{"name": "iPhone", "revenue": 200_000_000_000, "pct_of_total": 55.0}],
    "roic_trend": [28.0, 29.0, 30.0, 31.0],
    "operating_margin_trend": [34.0, 35.0, 35.5, 34.5],
    "gross_margin_trend": [70.0, 71.0, 72.0, 73.0],
}

_BUSINESS_RESULT = BusinessUnderstandingResult(
    ticker="AAPL", how_it_makes_money="Vende hardware.", what_it_sells=None, who_pays=None, key_customers=None,
    growth_drivers=None, growth_limiters=None, most_profitable_segment=None, value_destroying_segment=None,
    business_change_since_last_review=None,
)
_COMPETITIVE_RESULT = CompetitiveIntelligenceResult(ticker="AAPL", peer_comparison=None, direct_competitors="MSFT.")
_INDUSTRY_RESULT = IndustryIntelligenceResult(ticker="AAPL", category="Software", industry_benchmarks=None, market_size_and_growth="Grande.")
_MANAGEMENT_RESULT = ManagementIntelligenceResult(ticker="AAPL", strategic_priorities="Foco en IA.")
_THESIS_RESULT = ThesisDraftResult(ticker="AAPL", thesis_summary="Negocio de calidad.", confidence="medium")


def _patch_all(**overrides):
    patches = {
        "app.services.fundamental_analysis_service.get_fundamental_analysis": patch(
            "app.services.fundamental_analysis_service.get_fundamental_analysis",
            return_value=overrides.get("data", _FAKE_DATA),
        ),
        "compute_industry_benchmarks": patch(
            "app.services.quality.industry_engine.compute_industry_benchmarks", return_value=None,
        ),
        "business": patch(
            "app.services.research.business_understanding.compute_and_save_business_understanding",
            new_callable=AsyncMock, return_value=overrides.get("business", _BUSINESS_RESULT),
        ),
        "competitive": patch(
            "app.services.research.competitive_intelligence.compute_and_save_competitive_intelligence",
            new_callable=AsyncMock, return_value=overrides.get("competitive", _COMPETITIVE_RESULT),
        ),
        "industry": patch(
            "app.services.research.industry_intelligence.compute_and_save_industry_intelligence",
            new_callable=AsyncMock, return_value=overrides.get("industry", _INDUSTRY_RESULT),
        ),
        "management": patch(
            "app.services.research.management_intelligence.compute_and_save_management_intelligence",
            new_callable=AsyncMock, return_value=overrides.get("management", _MANAGEMENT_RESULT),
        ),
        "thesis": patch(
            "app.services.research.thesis_engine.compute_and_save_thesis_draft",
            new_callable=AsyncMock, return_value=overrides.get("thesis", _THESIS_RESULT),
        ),
    }
    return patches


class TestComposeResearchDossier:
    @pytest.mark.asyncio
    async def test_returns_none_without_enough_real_data(self):
        with patch("app.services.fundamental_analysis_service.get_fundamental_analysis", return_value=None):
            assert await compose_research_dossier("ZZZZ") is None

    @pytest.mark.asyncio
    async def test_returns_none_when_no_dcf(self):
        with patch("app.services.fundamental_analysis_service.get_fundamental_analysis", return_value={"ticker": "ZZZZ"}):
            assert await compose_research_dossier("ZZZZ") is None

    @pytest.mark.asyncio
    async def test_composes_full_dossier_on_success(self):
        patches = _patch_all()
        with patches["app.services.fundamental_analysis_service.get_fundamental_analysis"], \
             patches["compute_industry_benchmarks"], \
             patches["business"] as mock_business, patches["competitive"] as mock_competitive, \
             patches["industry"] as mock_industry, patches["management"] as mock_management, \
             patches["thesis"] as mock_thesis:
            result = await compose_research_dossier("AAPL")

        assert result is not None
        assert result["ticker"] == "AAPL"
        assert isinstance(result["quality_score"], (int, float))  # real quality_engine computation from the fixture's partial data
        assert result["moat_score"] is not None  # real roic/margin trends given -> stability/gross-margin factors compute
        assert result["business_understanding"]["how_it_makes_money"] == "Vende hardware."
        assert result["competitive_intelligence"]["direct_competitors"] == "MSFT."
        assert result["industry_intelligence"]["market_size_and_growth"] == "Grande."
        assert result["management_intelligence"]["strategic_priorities"] == "Foco en IA."
        assert result["thesis_draft"]["thesis_summary"] == "Negocio de calidad."

        # segments/sector real data reached the sub-engines
        mock_business.assert_called_once()
        assert mock_business.call_args[0][2] == _FAKE_DATA["segments"]
        mock_competitive.assert_called_once()
        assert mock_competitive.call_args[0][2] == "Technology"
        mock_thesis.assert_called_once()

    @pytest.mark.asyncio
    async def test_one_engine_failure_degrades_that_section_only(self):
        patches = _patch_all()
        patches["business"] = patch(
            "app.services.research.business_understanding.compute_and_save_business_understanding",
            new_callable=AsyncMock, side_effect=Exception("AI down"),
        )
        with patches["app.services.fundamental_analysis_service.get_fundamental_analysis"], \
             patches["compute_industry_benchmarks"], \
             patches["business"], patches["competitive"], patches["industry"], patches["management"], patches["thesis"]:
            result = await compose_research_dossier("AAPL")

        assert result is not None
        assert result["business_understanding"] is None
        assert result["competitive_intelligence"] is not None

    @pytest.mark.asyncio
    async def test_no_signal_results_become_none(self):
        empty_business = BusinessUnderstandingResult(
            ticker="AAPL", how_it_makes_money=None, what_it_sells=None, who_pays=None, key_customers=None,
            growth_drivers=None, growth_limiters=None, most_profitable_segment=None, value_destroying_segment=None,
            business_change_since_last_review=None,
        )
        patches = _patch_all(business=empty_business)
        with patches["app.services.fundamental_analysis_service.get_fundamental_analysis"], \
             patches["compute_industry_benchmarks"], \
             patches["business"], patches["competitive"], patches["industry"], patches["management"], patches["thesis"]:
            result = await compose_research_dossier("AAPL")

        assert result["business_understanding"] is None
