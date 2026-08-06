"""
Tests — app.services.research.benchmark_engine (Fase 3, Incremento 11).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.research.benchmark_engine import (
    aggregate_benchmark_report,
    compute_benchmark_report,
    get_industry_reliability_note,
    _accuracy_pct,
    _group_by,
)


def _row(outcome, industry=None, sector=None, claim_type="critical_variable"):
    return {"outcome": outcome, "industry": industry, "sector": sector, "claim_type": claim_type, "claim_text": "x"}


class TestAccuracyPct:
    def test_computes_real_ratio(self):
        assert _accuracy_pct(7, 3) == 70.0

    def test_none_when_nothing_decisive(self):
        assert _accuracy_pct(0, 0) is None

    def test_all_confirmed(self):
        assert _accuracy_pct(5, 0) == 100.0


class TestGroupBy:
    def test_groups_and_computes_per_key_accuracy(self):
        rows = [
            _row("confirmed", industry="Software"), _row("confirmed", industry="Software"), _row("refuted", industry="Software"),
            _row("confirmed", industry="Retail"), _row("refuted", industry="Retail"), _row("refuted", industry="Retail"),
        ]
        groups = _group_by(rows, "industry", min_sample=1)
        by_key = {g.key: g for g in groups}
        assert by_key["Software"].accuracy_pct == round(2 / 3 * 100, 1)
        assert by_key["Retail"].accuracy_pct == round(1 / 3 * 100, 1)

    def test_below_min_sample_is_excluded(self):
        rows = [_row("confirmed", industry="Software")]
        assert _group_by(rows, "industry", min_sample=3) == []

    def test_rows_without_the_key_are_skipped(self):
        rows = [_row("confirmed", industry=None), _row("confirmed", industry="Software")]
        groups = _group_by(rows, "industry", min_sample=1)
        assert len(groups) == 1
        assert groups[0].key == "Software"

    def test_pending_outcome_not_counted_as_evaluated(self):
        rows = [_row(None, industry="Software"), _row("confirmed", industry="Software")]
        groups = _group_by(rows, "industry", min_sample=1)
        assert groups[0].evaluated_count == 1


class TestAggregateBenchmarkReport:
    def test_no_rows_produces_no_signal(self):
        report = aggregate_benchmark_report([])
        assert report.has_any_signal is False
        assert report.accuracy_pct is None

    def test_counts_pending_vs_evaluated(self):
        rows = [_row(None), _row(None), _row("confirmed"), _row("refuted")]
        report = aggregate_benchmark_report(rows)
        assert report.pending_count == 2
        assert report.total_evaluated == 2
        assert report.total_rows == 4

    def test_inconclusive_excluded_from_accuracy_but_counted(self):
        rows = [_row("confirmed"), _row("refuted"), _row("inconclusive")]
        report = aggregate_benchmark_report(rows)
        assert report.total_inconclusive == 1
        assert report.accuracy_pct == 50.0  # only confirmed/refuted count toward accuracy

    def test_weakest_and_strongest_industries_ranked_correctly(self):
        rows = (
            [_row("refuted", industry="Weak")] * 3
            + [_row("confirmed", industry="Strong")] * 3
        )
        report = aggregate_benchmark_report(rows, min_sample_for_ranking=3)
        assert report.weakest_industries[0] == "Weak"
        assert report.strongest_industries[0] == "Strong"

    def test_thin_sample_industry_excluded_from_ranking(self):
        rows = [_row("refuted", industry="OneOff")]
        report = aggregate_benchmark_report(rows, min_sample_for_ranking=3)
        assert report.weakest_industries == []
        assert report.by_industry == []

    def test_by_claim_type_never_requires_min_sample(self):
        rows = [_row("confirmed", claim_type="risk")]
        report = aggregate_benchmark_report(rows)
        assert len(report.by_claim_type) == 1
        assert report.by_claim_type[0].key == "risk"


class TestComputeBenchmarkReport:
    @pytest.mark.asyncio
    async def test_fetches_and_aggregates(self):
        rows = [_row("confirmed", industry="Software"), _row("refuted", industry="Software")]
        mock_db = None
        with patch("app.core.database.get_supabase") as mock_get_db, \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=rows)
            report = await compute_benchmark_report()
        assert report.total_rows == 2
        assert report.total_evaluated == 2


class TestGetIndustryReliabilityNote:
    @pytest.mark.asyncio
    async def test_returns_none_when_accuracy_is_healthy(self):
        rows = [_row("confirmed", industry="Software")] * 3
        with patch("app.core.database.get_supabase"), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=rows)
            note = await get_industry_reliability_note("Software")
        assert note is None

    @pytest.mark.asyncio
    async def test_returns_a_real_caveat_when_accuracy_is_low(self):
        rows = [_row("refuted", industry="Retail")] * 3
        with patch("app.core.database.get_supabase"), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=rows)
            note = await get_industry_reliability_note("Retail")
        assert note is not None
        assert "Retail" in note
        assert "0.0%" in note

    @pytest.mark.asyncio
    async def test_returns_none_when_no_data_for_industry(self):
        with patch("app.core.database.get_supabase"), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[])
            note = await get_industry_reliability_note("Unknown")
        assert note is None
