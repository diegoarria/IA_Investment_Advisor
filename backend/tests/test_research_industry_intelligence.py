"""
Tests — app.services.research.industry_intelligence (Fase 3, Incremento 4).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.research.industry_intelligence import (
    compute_industry_intelligence,
    compute_and_save_industry_intelligence,
    _format_benchmarks_summary,
    _build_claims,
)
from app.services.quality.evidence_sources import EvidenceBundle

_BENCHMARKS = SimpleNamespace(
    category="Software", peer_count=6, median_roic_pct=18.0,
    median_operating_margin_pct=25.0, median_fcf_margin_pct=20.0, median_revenue_cagr_pct=14.0,
)
_AI_RESULT = {
    "market_size_and_growth": "x", "trends": "x", "disruptive_technologies": "x",
    "industry_leaders": "x", "industry_10_years_ago": "x", "industry_in_10_years": "x", "structural_risks": "x",
}


class TestFormatBenchmarksSummary:
    def test_includes_real_numbers(self):
        d = {"category": "Software", "peer_count": 6, "median_roic_pct": 18.0,
             "median_operating_margin_pct": 25.0, "median_fcf_margin_pct": 20.0, "median_revenue_cagr_pct": 14.0}
        text = _format_benchmarks_summary(d)
        assert "18.0%" in text and "Software" in text

    def test_empty_when_no_benchmarks(self):
        assert _format_benchmarks_summary(None) == ""
        assert _format_benchmarks_summary({"median_roic_pct": None, "median_revenue_cagr_pct": None}) == ""


class TestBuildClaims:
    def test_category_produces_fact_claim(self):
        claims = _build_claims("Software", None, None, False)
        assert len(claims) == 1
        assert claims[0].kind == "fact"

    def test_benchmarks_add_a_second_fact_claim(self):
        d = {"peer_count": 6, "median_revenue_cagr_pct": 14.0}
        claims = _build_claims("Software", d, None, False)
        assert len(claims) == 2
        assert all(c.kind == "fact" for c in claims)

    def test_ai_fields_produce_inference_claims(self):
        claims = _build_claims(None, None, _AI_RESULT, has_real_evidence=True)
        assert len(claims) == 7
        assert all(c.kind == "inference" and c.confidence == "medium" for c in claims)


class TestComputeIndustryIntelligence:
    @pytest.mark.asyncio
    async def test_composes_classification_benchmarks_and_ai(self):
        with patch("app.services.quality.industry_engine.classify_industry", return_value="Software"), \
             patch("app.services.quality.industry_engine.compute_industry_benchmarks", return_value=_BENCHMARKS), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_industry_intelligence", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = _AI_RESULT
            result = await compute_industry_intelligence("AAPL", "Apple", "Technology", "Software")

        assert result.has_any_signal is True
        assert result.category == "Software"
        assert result.industry_benchmarks["median_roic_pct"] == 18.0
        assert result.market_size_and_growth == "x"

    @pytest.mark.asyncio
    async def test_benchmarks_failure_does_not_block_ai_narration(self):
        with patch("app.services.quality.industry_engine.classify_industry", return_value="Software"), \
             patch("app.services.quality.industry_engine.compute_industry_benchmarks", side_effect=Exception("network down")), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_industry_intelligence", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = _AI_RESULT
            result = await compute_industry_intelligence("AAPL", "Apple", "Technology", "Software")

        assert result.industry_benchmarks is None
        assert result.has_any_signal is True

    @pytest.mark.asyncio
    async def test_ai_failure_produces_no_signal(self):
        with patch("app.services.quality.industry_engine.classify_industry", return_value="Software"), \
             patch("app.services.quality.industry_engine.compute_industry_benchmarks", return_value=None), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_industry_intelligence", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = None
            result = await compute_industry_intelligence("AAPL", "Apple", "Technology", "Software")

        assert result.has_any_signal is False


class TestComputeAndSaveIndustryIntelligence:
    @pytest.mark.asyncio
    async def test_saves_snapshot(self):
        with patch("app.services.quality.industry_engine.classify_industry", return_value="Software"), \
             patch("app.services.quality.industry_engine.compute_industry_benchmarks", return_value=_BENCHMARKS), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_industry_intelligence", new_callable=AsyncMock) as mock_ai, \
             patch("app.services.research.knowledge_store.save_snapshot", new_callable=AsyncMock) as mock_save:
            mock_ai.return_value = _AI_RESULT
            mock_save.return_value = {"id": "snap1"}
            await compute_and_save_industry_intelligence("AAPL", "Apple", "Technology", "Software")

        mock_save.assert_called_once()
        args, _ = mock_save.call_args
        assert args[1] == "industry"
