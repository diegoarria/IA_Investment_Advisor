"""
Tests — app.services.quality.moat_engine (Fase 2, Incremento 7).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import patch

import pytest

from app.services.quality.moat_engine import (
    compute_moat_score,
    compute_moat_deep_dive,
    _format_moat_score_summary,
    _format_evidence_bundle,
)
from app.services.quality.evidence_sources import EvidenceBundle, ScrapedExcerpt


class TestComputeMoatScore:
    def _strong_moat_kwargs(self, **overrides):
        kwargs = dict(
            avg_roic_pct=30.0, roic_trend=[28.0, 29.0, 30.0, 31.0, 30.0, 31.0],
            avg_operating_margin_pct=35.0, operating_margin_trend=[34.0, 35.0, 35.5, 34.5, 35.0, 35.5],
            gross_margin_latest_pct=75.0,
            industry_median_roic_pct=12.0, industry_median_operating_margin_pct=18.0,
        )
        kwargs.update(overrides)
        return kwargs

    def test_strong_durable_premium_scores_high(self):
        result = compute_moat_score(**self._strong_moat_kwargs())
        assert result.moat_score >= 70
        assert result.has_any_signal is True

    def test_no_premium_over_industry_scores_low(self):
        result = compute_moat_score(
            avg_roic_pct=12.0, roic_trend=[10.0, 15.0, 8.0, 16.0, 9.0, 14.0],  # matches industry, volatile
            avg_operating_margin_pct=18.0, operating_margin_trend=[15.0, 21.0, 14.0, 22.0, 16.0, 20.0],
            gross_margin_latest_pct=25.0,
            industry_median_roic_pct=12.0, industry_median_operating_margin_pct=18.0,
        )
        assert result.moat_score <= 40

    def test_unstable_high_roic_scores_lower_than_stable_high_roic(self):
        stable = compute_moat_score(**self._strong_moat_kwargs())
        unstable = compute_moat_score(**self._strong_moat_kwargs(
            roic_trend=[5.0, 55.0, 3.0, 60.0, 4.0, 58.0],  # same avg-ish, wildly volatile
        ))
        assert stable.moat_score > unstable.moat_score

    def test_missing_industry_benchmark_degrades_gracefully(self):
        result = compute_moat_score(
            avg_roic_pct=30.0, roic_trend=[28.0, 29.0, 30.0, 31.0, 30.0, 31.0],
            avg_operating_margin_pct=35.0, operating_margin_trend=[34.0, 35.0, 35.5, 34.5, 35.0, 35.5],
            gross_margin_latest_pct=75.0,
            industry_median_roic_pct=None, industry_median_operating_margin_pct=None,
        )
        assert result.roic_premium_score is None
        assert result.margin_premium_score is None
        # stability + gross margin level still produce a real score
        assert result.has_any_signal is True
        assert result.moat_score > 0

    def test_no_data_at_all_produces_zero_and_no_signal(self):
        result = compute_moat_score(
            avg_roic_pct=None, roic_trend=[],
            avg_operating_margin_pct=None, operating_margin_trend=[],
            gross_margin_latest_pct=None,
            industry_median_roic_pct=None, industry_median_operating_margin_pct=None,
        )
        assert result.moat_score == 0
        assert result.has_any_signal is False

    def test_score_bounded_0_100(self):
        result = compute_moat_score(**self._strong_moat_kwargs())
        assert 0 <= result.moat_score <= 100

    def test_every_present_factor_has_a_real_reason(self):
        result = compute_moat_score(**self._strong_moat_kwargs())
        assert len(result.factors) == 5
        assert all(f.reason for f in result.factors)

    def test_negative_premium_scores_at_floor_tier(self):
        result = compute_moat_score(
            avg_roic_pct=5.0, roic_trend=[5.0, 5.5, 4.5, 5.0, 5.5, 4.8],
            avg_operating_margin_pct=8.0, operating_margin_trend=[8.0, 7.5, 8.5, 8.0, 7.8, 8.2],
            gross_margin_latest_pct=20.0,
            industry_median_roic_pct=20.0, industry_median_operating_margin_pct=25.0,  # company underperforms peers
        )
        roic_factor = next(f for f in result.factors if f.name == "roic_premium_vs_industry")
        assert roic_factor.value < 0
        assert roic_factor.score == 15  # floor tier


class TestFormatMoatScoreSummary:
    def test_includes_the_score_and_every_factor(self):
        result = compute_moat_score(
            avg_roic_pct=30.0, roic_trend=[28.0, 29.0, 30.0, 31.0, 30.0, 31.0],
            avg_operating_margin_pct=35.0, operating_margin_trend=[34.0, 35.0, 35.5, 34.5, 35.0, 35.5],
            gross_margin_latest_pct=75.0,
            industry_median_roic_pct=12.0, industry_median_operating_margin_pct=18.0,
        )
        text = _format_moat_score_summary(result)
        assert str(result.moat_score) in text
        assert "roic_premium_vs_industry" in text
        assert "gross_margin_level" in text


class TestFormatEvidenceBundle:
    def test_includes_filing_search_and_scraped_content(self):
        bundle = EvidenceBundle(
            ticker="AAPL", topic="moat",
            filing_evidence={"business": "Real business text.", "source_url": "https://sec.gov/x"},
            search_answer="Real search answer with citations.",
            search_citations=[],
            scraped_excerpts=[ScrapedExcerpt(url="https://example.com/a", title="Title A", excerpt="Real excerpt text.")],
        )
        text = _format_evidence_bundle(bundle)
        assert "Real business text." in text
        assert "sec.gov/x" in text
        assert "Real search answer" in text
        assert "Real excerpt text." in text
        assert "example.com/a" in text

    def test_empty_bundle_produces_empty_string(self):
        bundle = EvidenceBundle(ticker="ZZZ", topic="moat")
        assert _format_evidence_bundle(bundle) == ""


class TestComputeMoatDeepDive:
    @pytest.mark.asyncio
    async def test_returns_none_when_no_real_evidence(self):
        empty_bundle = EvidenceBundle(ticker="ZZZ", topic="moat")
        with patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=empty_bundle):
            score = compute_moat_score(
                avg_roic_pct=None, roic_trend=[], avg_operating_margin_pct=None, operating_margin_trend=[],
                gross_margin_latest_pct=None, industry_median_roic_pct=None, industry_median_operating_margin_pct=None,
            )
            result = await compute_moat_deep_dive("ZZZ", "Unknown Co", score)
        assert result is None

    @pytest.mark.asyncio
    async def test_calls_ai_service_when_real_evidence_exists(self):
        real_bundle = EvidenceBundle(
            ticker="AAPL", topic="moat",
            filing_evidence={"business": "Real text."}, search_answer="Real answer.",
        )
        ai_result = {"moat_types": [{"type": "brand", "intensity": "alta", "evidence": "e", "explanation": "x", "risks": "r"}]}
        with patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=real_bundle), \
             patch("app.services.ai_service.generate_moat_deep_dive", return_value=ai_result) as mock_ai:
            score = compute_moat_score(
                avg_roic_pct=30.0, roic_trend=[28.0, 29.0, 30.0, 31.0], avg_operating_margin_pct=35.0,
                operating_margin_trend=[34.0, 35.0, 35.5, 34.5], gross_margin_latest_pct=75.0,
                industry_median_roic_pct=12.0, industry_median_operating_margin_pct=18.0,
            )
            result = await compute_moat_deep_dive("AAPL", "Apple", score)
        assert result == ai_result
        mock_ai.assert_called_once()
