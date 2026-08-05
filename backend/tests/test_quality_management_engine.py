"""
Tests — app.services.quality.management_engine (Fase 2, Incremento 8).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import patch

import pytest

from app.services.quality.management_engine import (
    compute_management_score,
    compute_management_deep_dive,
    _format_management_score_summary,
)
from app.services.quality.evidence_sources import EvidenceBundle


class TestComputeManagementScore:
    def test_strong_signals_score_high(self):
        result = compute_management_score(
            capital_allocation_score=85.0,
            insider_sentiment_avg_mspr=60.0,
            insider_sentiment_months_covered=12,
            insider_trailing_12mo={"net_shares": 50_000, "distinct_buyers": 4, "distinct_sellers": 0},
        )
        assert result.management_score >= 70
        assert result.has_any_signal is True

    def test_weak_signals_score_low(self):
        result = compute_management_score(
            capital_allocation_score=20.0,
            insider_sentiment_avg_mspr=-60.0,
            insider_sentiment_months_covered=12,
            insider_trailing_12mo={"net_shares": -50_000, "distinct_buyers": 0, "distinct_sellers": 6},
        )
        assert result.management_score <= 35

    def test_missing_insider_data_degrades_to_capital_allocation_only(self):
        result = compute_management_score(
            capital_allocation_score=70.0,
            insider_sentiment_avg_mspr=None,
            insider_sentiment_months_covered=None,
            insider_trailing_12mo=None,
        )
        assert result.insider_sentiment_score is None
        assert result.insider_activity_score is None
        assert result.has_any_signal is True
        assert result.management_score == 70  # weighted_mean renormalizes to the one present score

    def test_no_data_at_all_produces_zero_and_no_signal(self):
        result = compute_management_score(
            capital_allocation_score=None,
            insider_sentiment_avg_mspr=None,
            insider_sentiment_months_covered=None,
            insider_trailing_12mo=None,
        )
        assert result.management_score == 0
        assert result.has_any_signal is False

    def test_score_bounded_0_100(self):
        result = compute_management_score(
            capital_allocation_score=85.0, insider_sentiment_avg_mspr=60.0,
            insider_sentiment_months_covered=12, insider_trailing_12mo={"net_shares": 1, "distinct_buyers": 4, "distinct_sellers": 0},
        )
        assert 0 <= result.management_score <= 100

    def test_every_present_factor_has_a_real_reason(self):
        result = compute_management_score(
            capital_allocation_score=85.0, insider_sentiment_avg_mspr=60.0,
            insider_sentiment_months_covered=12, insider_trailing_12mo={"net_shares": 1, "distinct_buyers": 4, "distinct_sellers": 0},
        )
        assert len(result.factors) == 3
        assert all(f.reason for f in result.factors)

    def test_zero_buyers_and_zero_sellers_produces_no_activity_signal(self):
        """No open-market transactions at all in the trailing 12mo is
        genuinely 'no signal', not a neutral/negative score — distinct from
        the 'sellers outnumber buyers' case."""
        result = compute_management_score(
            capital_allocation_score=50.0, insider_sentiment_avg_mspr=None,
            insider_sentiment_months_covered=None, insider_trailing_12mo={"net_shares": 0, "distinct_buyers": 0, "distinct_sellers": 0},
        )
        assert result.insider_activity_score is None


class TestFormatManagementScoreSummary:
    def test_includes_the_score_and_every_factor(self):
        result = compute_management_score(
            capital_allocation_score=85.0, insider_sentiment_avg_mspr=60.0,
            insider_sentiment_months_covered=12, insider_trailing_12mo={"net_shares": 1, "distinct_buyers": 4, "distinct_sellers": 0},
        )
        text = _format_management_score_summary(result)
        assert str(result.management_score) in text
        assert "capital_allocation" in text
        assert "insider_sentiment" in text
        assert "insider_buying_activity" in text


class TestComputeManagementDeepDive:
    @pytest.mark.asyncio
    async def test_returns_none_when_no_real_evidence(self):
        empty_bundle = EvidenceBundle(ticker="ZZZ", topic="management")
        with patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=empty_bundle):
            score = compute_management_score(
                capital_allocation_score=None, insider_sentiment_avg_mspr=None,
                insider_sentiment_months_covered=None, insider_trailing_12mo=None,
            )
            result = await compute_management_deep_dive("ZZZ", "Unknown Co", score)
        assert result is None

    @pytest.mark.asyncio
    async def test_calls_ai_service_when_real_evidence_exists(self):
        real_bundle = EvidenceBundle(
            ticker="AAPL", topic="management",
            filing_evidence={"business": "Real text."}, search_answer="Real answer.",
        )
        ai_result = {
            "guidance_track_record": "Cumplió guidance en los últimos 4 trimestres según la evidencia citada.",
            "governance_flags": [], "overall_assessment": "Track record consistente según la evidencia disponible.",
        }
        with patch("app.services.quality.evidence_sources.gather_evidence_bundle", return_value=real_bundle), \
             patch("app.services.ai_service.generate_management_deep_dive", return_value=ai_result) as mock_ai:
            score = compute_management_score(
                capital_allocation_score=70.0, insider_sentiment_avg_mspr=30.0,
                insider_sentiment_months_covered=12, insider_trailing_12mo={"net_shares": 1, "distinct_buyers": 2, "distinct_sellers": 1},
            )
            result = await compute_management_deep_dive("AAPL", "Apple", score)
        assert result == ai_result
        mock_ai.assert_called_once()
