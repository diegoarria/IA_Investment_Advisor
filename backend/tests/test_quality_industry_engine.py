"""
Tests — app.services.quality.industry_engine (Fase 2, Incremento 1).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import patch

import pytest

from app.services.quality.industry_engine import (
    classify_industry,
    compute_industry_benchmarks,
)


class TestClassifyIndustry:
    def test_reit_matches_before_real_estate(self):
        assert classify_industry("Real Estate", "REIT - Retail") == "REIT"

    def test_generic_real_estate_without_reit_falls_to_real_estate_services(self):
        assert classify_industry("Real Estate", "Real Estate Services") == "Real Estate Services"

    def test_bank_and_insurance_both_map_to_financials(self):
        assert classify_industry("Financial Services", "Banks - Regional") == "Financials"
        assert classify_industry("Financial Services", "Insurance - Life") == "Financials"

    def test_semiconductors_distinct_from_software(self):
        assert classify_industry("Technology", "Semiconductors") == "Semiconductors"
        assert classify_industry("Technology", "Software - Application") == "Software"

    def test_airline_and_telecom(self):
        assert classify_industry("Industrials", "Airlines") == "Airlines"
        assert classify_industry("Communication Services", "Telecom Services") == "Telecom"

    def test_unknown_sector_defaults_to_diversified(self):
        assert classify_industry("Something Totally Unknown", "Also Unknown") == "Diversified"
        assert classify_industry(None, None) == "Diversified"

    def test_matches_case_insensitively(self):
        assert classify_industry("technology", "SEMICONDUCTORS") == "Semiconductors"


def _fake_peer_data(roic_pct, operating_margin_pct, fcf_margin_pct, revenue_cagr_pct):
    return {
        "dcf": {
            "growth_buildup": {"avg_roic_pct": roic_pct},
            "avg_fcf_margin_pct": fcf_margin_pct,
        },
        "operating_margin_trend": [operating_margin_pct],
        "revenue_cagr_pct": revenue_cagr_pct,
    }


class TestComputeIndustryBenchmarks:
    def test_returns_none_with_fewer_than_min_peers(self):
        with patch("app.api.routes.screener.UNIVERSE", [
            {"ticker": "AAA", "sector": "Technology", "industry": "Software"},
            {"ticker": "BBB", "sector": "Technology", "industry": "Software"},
        ]):
            result = compute_industry_benchmarks("ZZZ", sector="Technology", industry="Software")
        assert result is None

    def test_computes_real_medians_from_peers(self):
        universe = [{"ticker": f"PEER{i}", "sector": "Technology", "industry": "Software"} for i in range(5)]
        analysis_cache = {
            "PEER0": _fake_peer_data(20.0, 25.0, 15.0, 10.0),
            "PEER1": _fake_peer_data(22.0, 27.0, 17.0, 12.0),
            "PEER2": _fake_peer_data(18.0, 23.0, 13.0, 8.0),
            "PEER3": _fake_peer_data(21.0, 26.0, 16.0, 11.0),
            "PEER4": _fake_peer_data(19.0, 24.0, 14.0, 9.0),
        }
        with patch("app.api.routes.screener.UNIVERSE", universe):
            result = compute_industry_benchmarks(
                "ZZZ", sector="Technology", industry="Software", analysis_cache=analysis_cache,
            )
        assert result is not None
        assert result.category == "Software"
        assert result.peer_count == 5
        assert result.median_roic_pct == pytest.approx(20.0)
        assert result.median_operating_margin_pct == pytest.approx(25.0)
        assert result.median_fcf_margin_pct == pytest.approx(15.0)
        assert result.median_revenue_cagr_pct == pytest.approx(10.0)

    def test_returns_none_when_no_peer_has_computable_data(self):
        universe = [{"ticker": f"PEER{i}", "sector": "Technology", "industry": "Software"} for i in range(5)]
        analysis_cache = {f"PEER{i}": None for i in range(5)}
        with patch("app.api.routes.screener.UNIVERSE", universe):
            result = compute_industry_benchmarks(
                "ZZZ", sector="Technology", industry="Software", analysis_cache=analysis_cache,
            )
        assert result is None

    def test_handles_partial_missing_metrics_gracefully(self):
        universe = [{"ticker": f"PEER{i}", "sector": "Technology", "industry": "Software"} for i in range(5)]
        analysis_cache = {
            "PEER0": {"dcf": {"growth_buildup": {}}, "operating_margin_trend": [], "revenue_cagr_pct": None},
            "PEER1": {"dcf": {"growth_buildup": {}}, "operating_margin_trend": [], "revenue_cagr_pct": None},
            "PEER2": {"dcf": {"growth_buildup": {}}, "operating_margin_trend": [], "revenue_cagr_pct": None},
            "PEER3": {"dcf": {"growth_buildup": {}}, "operating_margin_trend": [], "revenue_cagr_pct": None},
            "PEER4": {"dcf": {"growth_buildup": {}}, "operating_margin_trend": [], "revenue_cagr_pct": None},
        }
        with patch("app.api.routes.screener.UNIVERSE", universe):
            result = compute_industry_benchmarks(
                "ZZZ", sector="Technology", industry="Software", analysis_cache=analysis_cache,
            )
        # 5 real peers found (they're all real dicts), but zero usable metrics
        assert result is not None
        assert result.peer_count == 5
        assert result.median_roic_pct is None
        assert result.median_operating_margin_pct is None
