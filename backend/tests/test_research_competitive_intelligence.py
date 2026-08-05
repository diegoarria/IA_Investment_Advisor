"""
Tests — app.services.research.competitive_intelligence (Fase 3, Incremento 4).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.research.competitive_intelligence import (
    compute_competitive_intelligence,
    compute_and_save_competitive_intelligence,
    _format_peer_tickers_summary,
    _format_peer_comparison_summary,
    _build_claims,
)
from app.services.quality.evidence_sources import EvidenceBundle

_PEER_SNAPSHOTS = [
    SimpleNamespace(ticker="MSFT", quality_score=85.0, roic_pct=30.0, operating_margin_pct=40.0, revenue_cagr_pct=12.0),
    SimpleNamespace(ticker="GOOGL", quality_score=78.0, roic_pct=25.0, operating_margin_pct=30.0, revenue_cagr_pct=10.0),
]
_PEER_RESULT = SimpleNamespace(
    peer_count=2, peers_used=["MSFT", "GOOGL"], company_quality_score=80.0,
    quality_score_percentile=50.0, quality_score_rank=2, peer_quality_scores=_PEER_SNAPSHOTS,
)
_AI_RESULT = {
    "direct_competitors": "MSFT y GOOGL compiten directamente.", "indirect_competitors": "x",
    "substitute_products": "x", "new_entrants": "x", "barriers_to_entry": "x",
    "market_share_estimate": "sin datos precisos de cuota de mercado", "competitive_advantages_vs_peers": "x",
    "structural_industry_changes": "x",
}


class TestFormatters:
    def test_peer_tickers_summary_lists_real_tickers(self):
        assert _format_peer_tickers_summary(["MSFT", "GOOGL"]) == "Peers reales del universo curado: MSFT, GOOGL."

    def test_peer_tickers_summary_empty(self):
        assert _format_peer_tickers_summary([]) == ""

    def test_peer_comparison_summary_includes_percentile_and_peers(self):
        d = {"company_quality_score": 80.0, "quality_score_percentile": 50.0, "quality_score_rank": 2, "peer_count": 2,
             "peer_quality_scores": [{"ticker": "MSFT", "quality_score": 85.0, "roic_pct": 30.0, "operating_margin_pct": 40.0, "revenue_cagr_pct": 12.0}]}
        text = _format_peer_comparison_summary(d)
        assert "percentil 50.0" in text
        assert "MSFT" in text

    def test_peer_comparison_summary_empty_when_no_percentile(self):
        assert _format_peer_comparison_summary(None) == ""
        assert _format_peer_comparison_summary({"quality_score_percentile": None}) == ""


class TestBuildClaims:
    def test_real_peer_comparison_produces_fact_claim(self):
        d = {"quality_score_percentile": 50.0, "peer_count": 2}
        claims = _build_claims(d, None, False)
        assert len(claims) == 1
        assert claims[0].kind == "fact" and claims[0].confidence == "high"

    def test_ai_fields_use_medium_confidence_with_evidence(self):
        claims = _build_claims(None, _AI_RESULT, has_real_evidence=True)
        assert len(claims) == 8
        assert all(c.confidence == "medium" for c in claims)

    def test_ai_fields_use_low_confidence_without_evidence(self):
        claims = _build_claims(None, _AI_RESULT, has_real_evidence=False)
        assert all(c.confidence == "low" for c in claims)


class TestComputeCompetitiveIntelligence:
    @pytest.mark.asyncio
    async def test_composes_peer_comparison_and_ai_narration(self):
        with patch("app.services.quality.peer_comparison_engine.compute_quality_peer_comparison", return_value=_PEER_RESULT), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_competitive_intelligence", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = _AI_RESULT
            result = await compute_competitive_intelligence("AAPL", "Apple", "Technology", "Software", 80.0)

        assert result.has_any_signal is True
        assert result.direct_competitors == _AI_RESULT["direct_competitors"]
        assert result.peer_comparison["peers_used"] == ["MSFT", "GOOGL"]
        # the real peer tickers must have reached the AI prompt
        prompt_args = mock_ai.call_args[0]
        assert "MSFT" in prompt_args[2]

    @pytest.mark.asyncio
    async def test_no_peers_still_produces_ai_result(self):
        with patch("app.services.quality.peer_comparison_engine.compute_quality_peer_comparison", return_value=None), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_competitive_intelligence", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = _AI_RESULT
            result = await compute_competitive_intelligence("AAPL", "Apple", "Technology", "Software", 80.0)

        assert result.peer_comparison is None
        assert result.direct_competitors == _AI_RESULT["direct_competitors"]

    @pytest.mark.asyncio
    async def test_peer_lookup_failure_does_not_block_ai_narration(self):
        with patch("app.services.quality.peer_comparison_engine.compute_quality_peer_comparison", side_effect=Exception("network down")), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_competitive_intelligence", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = _AI_RESULT
            result = await compute_competitive_intelligence("AAPL", "Apple", "Technology", "Software", 80.0)

        assert result.peer_comparison is None
        assert result.has_any_signal is True


class TestComputeAndSaveCompetitiveIntelligence:
    @pytest.mark.asyncio
    async def test_saves_snapshot(self):
        with patch("app.services.quality.peer_comparison_engine.compute_quality_peer_comparison", return_value=_PEER_RESULT), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.ai_service.generate_competitive_intelligence", new_callable=AsyncMock) as mock_ai, \
             patch("app.services.research.knowledge_store.save_snapshot", new_callable=AsyncMock) as mock_save:
            mock_ai.return_value = _AI_RESULT
            mock_save.return_value = {"id": "snap1"}
            await compute_and_save_competitive_intelligence("AAPL", "Apple", "Technology", "Software", 80.0)

        mock_save.assert_called_once()
        args, _ = mock_save.call_args
        assert args[1] == "competitive"
