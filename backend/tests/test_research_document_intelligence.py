"""
Tests — app.services.research.document_intelligence (Fase 3, Incremento 2).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.research.document_intelligence import (
    DocumentIntelligenceResult,
    compute_document_intelligence,
    compute_and_save_document_intelligence,
    _build_claims,
)
from app.services.quality.evidence_sources import EvidenceBundle, ScrapedExcerpt

_FAKE_10K = {
    "ticker": "AAPL", "form_type": "10-K", "filing_date": "2025-11-01",
    "source_url": "https://sec.gov/10k", "business": "Real business text.",
    "risk_factors": "Real risk text.", "mda": "Real MDA text.",
}
_FAKE_10Q = {
    "ticker": "AAPL", "form_type": "10-Q", "filing_date": "2026-02-01",
    "source_url": "https://sec.gov/10q", "risk_factors": "Real quarterly risk text.", "mda": "Real quarterly MDA text.",
}


class TestBuildClaims:
    def test_claims_for_every_real_10k_section(self):
        claims = _build_claims(_FAKE_10K, None, None)
        assert len(claims) == 3
        assert all(c.kind == "fact" and c.confidence == "high" for c in claims)

    def test_10q_has_no_business_claim(self):
        claims = _build_claims(None, _FAKE_10Q, None)
        assert len(claims) == 2
        assert not any("Business" in c.text for c in claims)

    def test_no_sources_produces_no_claims(self):
        assert _build_claims(None, None, None) == []

    def test_evidence_bundle_with_real_evidence_adds_one_claim(self):
        bundle = {"search_answer": "real answer", "scraped_excerpts": [{"url": "x"}], "has_any_real_evidence": True}
        claims = _build_claims(None, None, bundle)
        assert len(claims) == 1
        assert claims[0].confidence == "medium"

    def test_empty_evidence_bundle_adds_no_claim(self):
        bundle = {"search_answer": "", "scraped_excerpts": [], "has_any_real_evidence": False}
        assert _build_claims(None, None, bundle) == []


class TestDocumentIntelligenceResult:
    def test_has_any_signal_true_with_10k_only(self):
        result = DocumentIntelligenceResult(ticker="AAPL", filing_10k=_FAKE_10K, filing_10q=None, evidence_bundle=None)
        assert result.has_any_signal is True

    def test_has_any_signal_false_when_everything_empty(self):
        result = DocumentIntelligenceResult(ticker="AAPL", filing_10k=None, filing_10q=None, evidence_bundle=None)
        assert result.has_any_signal is False

    def test_most_recent_filing_date_prefers_10q(self):
        result = DocumentIntelligenceResult(ticker="AAPL", filing_10k=_FAKE_10K, filing_10q=_FAKE_10Q, evidence_bundle=None)
        assert result.most_recent_filing_date == "2026-02-01"

    def test_most_recent_filing_date_falls_back_to_10k(self):
        result = DocumentIntelligenceResult(ticker="AAPL", filing_10k=_FAKE_10K, filing_10q=None, evidence_bundle=None)
        assert result.most_recent_filing_date == "2025-11-01"

    def test_to_snapshot_content_shape(self):
        result = DocumentIntelligenceResult(ticker="AAPL", filing_10k=_FAKE_10K, filing_10q=None, evidence_bundle=None)
        content = result.to_snapshot_content()
        assert content["filing_10k"] == _FAKE_10K
        assert content["claims"] == []


class TestComputeDocumentIntelligence:
    @pytest.mark.asyncio
    async def test_composes_all_three_real_sources(self):
        real_bundle = EvidenceBundle(
            ticker="AAPL", topic="document intel",
            search_answer="Real answer.", search_citations=[{"url": "https://x.com", "title": "X"}],
            scraped_excerpts=[ScrapedExcerpt(url="https://x.com", title="X", excerpt="Real excerpt.")],
        )
        with patch("app.services.sec_edgar_service.fetch_filing_text_sections", side_effect=[_FAKE_10K, _FAKE_10Q]), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=real_bundle):
            result = await compute_document_intelligence("AAPL", "Apple")

        assert result.filing_10k == _FAKE_10K
        assert result.filing_10q == _FAKE_10Q
        assert result.evidence_bundle["has_any_real_evidence"] is True
        assert len(result.claims) == 3 + 2 + 1  # 10-K sections + 10-Q sections + evidence bundle

    @pytest.mark.asyncio
    async def test_one_failed_source_does_not_block_the_others(self):
        with patch("app.services.sec_edgar_service.fetch_filing_text_sections", side_effect=[_FAKE_10K, Exception("SEC down")]), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")):
            result = await compute_document_intelligence("AAPL", "Apple")

        assert result.filing_10k == _FAKE_10K
        assert result.filing_10q is None
        assert result.has_any_signal is True

    @pytest.mark.asyncio
    async def test_everything_missing_produces_no_signal(self):
        with patch("app.services.sec_edgar_service.fetch_filing_text_sections", return_value=None), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="ZZZ", topic="x")):
            result = await compute_document_intelligence("ZZZ", "Unknown Co")

        assert result.has_any_signal is False
        assert result.claims == []


class TestComputeAndSaveDocumentIntelligence:
    @pytest.mark.asyncio
    async def test_saves_snapshot_with_correct_section_and_period(self):
        with patch("app.services.sec_edgar_service.fetch_filing_text_sections", side_effect=[_FAKE_10K, _FAKE_10Q]), \
             patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=EvidenceBundle(ticker="AAPL", topic="x")), \
             patch("app.services.research.knowledge_store.save_snapshot", new_callable=AsyncMock) as mock_save:
            mock_save.return_value = {"id": "snap1"}
            result = await compute_and_save_document_intelligence("AAPL", "Apple")

        assert result.filing_10k == _FAKE_10K
        mock_save.assert_called_once()
        args, kwargs = mock_save.call_args
        assert args[0] == "AAPL"
        assert args[1] == "document_intel"
        assert kwargs["source_period"] == "2026-02-01"  # the 10-Q's filing_date, more recent
