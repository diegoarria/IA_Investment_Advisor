"""Nuvos ETF — Fase 3A: educational ETF comparator (backend).

These tests exist specifically to catch a comparison insight claiming
something the underlying data doesn't support, exactly like
test_etf_insights.py does for the single-ETF insights — Diego's explicit
2026-11 requirement extended to the comparator, including the Etapa-2
correction pass: never read an absent sector/country as 0% unless
coverage is confirmed complete, never compare performance directly, never
pad past 3 insights or repeat a dimension."""
from unittest.mock import patch

import pytest

from app.services.etf.comparison import (
    ComparisonValidationError,
    build_comparison_insights,
    build_comparison_summary,
    compare_etfs,
)
from app.services.etf.service import NotAnETFError

# Same forbidden-evaluative-language list as test_etf_insights.py, plus
# the comparator-specific ones Diego called out: no "better/safer/more
# recommendable" verdicts, and never claim duplicate/overlapping holdings.
_FORBIDDEN_WORDS = [
    "riesgoso", "riesgosa", "seguro", "segura", "mejor", "peor", "más recomendable",
    "recomendado", "recomendamos", "deberías invertir", "conviene invertir",
    "duplicad", "idéntic", "equivalente",
    "risky", "safer", "better", "worse", "more recommendable",
    "you should invest", "duplicate holdings", "identical", "equivalent",
]


def _overview(
    ticker,
    sector_top1=None, sector_pct=None, sector_bucket=1, sector_items=None,
    sector_coverage_confirmed=True,
    country_top1=None, country_pct=None, country_bucket=1, country_items=None,
    country_coverage_confirmed=True,
    expense_ratio=None, days_of_history=None, since_pct=None,
    missing_fields=None,
):
    sector_items = sector_items if sector_items is not None else (
        [{"name": sector_top1, "weight_pct": sector_pct}] if sector_top1 else []
    )
    country_items = country_items if country_items is not None else (
        [{"name": country_top1, "weight_pct": country_pct}] if country_top1 else []
    )
    return {
        "ticker": ticker,
        "identification": {"name": f"{ticker} Fund", "etf_company": "Test Co", "description": None,
                            "has_editorial_description": False, "inception_date": None, "domicile": None,
                            "exchange": None, "isin": None},
        "costs": {"expense_ratio_pct": expense_ratio, "cost_tier": None, "aum_usd": None, "nav": None, "nav_currency": None},
        "exposure": {
            "sector_weightings": sector_items, "sector_weight_sum_pct": None,
            "sector_weight_sum_in_expected_range": sector_coverage_confirmed,
            "country_weightings": country_items, "country_weight_sum_pct": None,
            "country_weight_sum_in_expected_range": country_coverage_confirmed,
            "holdings_count": None,
        },
        "diversification": {
            "by_sector": {"top1_name": sector_top1, "top1_weight_pct": sector_pct, "bucket_count": sector_bucket},
            "by_country": {"top1_name": country_top1, "top1_weight_pct": country_pct, "bucket_count": country_bucket},
        },
        "price": {"current": None, "change_pct_today": None, "year_low": None, "year_high": None, "volume": None,
                   "returns": {"ytd_pct": None, "one_year_pct": None, "five_year_pct": None,
                               "max_pct": since_pct, "max_start_date": None,
                               "max_is_full_history": days_of_history is not None}},
        "dividends": {"recent": [], "latest_yield_pct": None},
        "data_quality": {"source": "fmp", "structural_fetched_at": 1700000000.0, "price_fetched_at": 1700000100.0,
                          "missing_fields": missing_fields or [], "provider_errors": {},
                          "is_actively_trading": True, "suspicious_expense_ratio": False},
    }


def _mock_overview_map(overviews: dict):
    def fake(ticker, use_cache=True, lang="es"):
        if ticker not in overviews:
            raise NotAnETFError(ticker)
        return overviews[ticker]
    return fake


class TestValidation:
    def test_rejects_single_ticker(self):
        with pytest.raises(ComparisonValidationError):
            compare_etfs(["VOO"])

    def test_rejects_more_than_three(self):
        with pytest.raises(ComparisonValidationError):
            compare_etfs(["VOO", "QQQ", "VXUS", "XLK"])

    def test_rejects_duplicate_tickers(self):
        with pytest.raises(ComparisonValidationError):
            compare_etfs(["VOO", "voo"])  # case-insensitive duplicate

    def test_accepts_two(self):
        overviews = {
            "VOO": _overview("VOO", expense_ratio=0.03),
            "QQQ": _overview("QQQ", expense_ratio=0.2),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "QQQ"])
        assert len(result["etfs"]) == 2
        assert result["comparison_ready"] is True

    def test_accepts_three(self):
        overviews = {t: _overview(t) for t in ("VOO", "QQQ", "VXUS")}
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "QQQ", "VXUS"])
        assert len(result["etfs"]) == 3
        assert result["comparison_ready"] is True


class TestUnavailableTickersNeverDropped:
    def test_non_etf_ticker_reported_not_dropped(self):
        overviews = {"VOO": _overview("VOO", expense_ratio=0.03)}
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "AAPL"])
        assert len(result["etfs"]) == 1
        assert result["unavailable"] == [{"ticker": "AAPL", "reason": "not_etf"}]

    def test_provider_exception_reported_not_dropped(self):
        def fake(ticker, use_cache=True, lang="es"):
            if ticker == "BAD":
                raise RuntimeError("boom")
            return _overview(ticker, expense_ratio=0.1)
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=fake):
            result = compare_etfs(["VOO", "BAD"])
        assert result["unavailable"] == [{"ticker": "BAD", "reason": "unavailable"}]

    def test_comparison_not_ready_when_fewer_than_two_available(self):
        """Explicit requirement: never present an incomplete comparison
        (only 1 valid ETF) as if it were finished."""
        overviews = {"VOO": _overview("VOO", expense_ratio=0.03)}
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "AAPL"])
        assert result["comparison_ready"] is False
        assert result["comparison_insights"] == []


class TestNoForbiddenLanguage:
    def test_qqq_vs_xlk_tech_heavy_pair(self):
        overviews = {
            "QQQ": _overview("QQQ", sector_top1="Technology", sector_pct=59.2, sector_bucket=9,
                              country_top1="United States", country_pct=99.0, country_bucket=3, expense_ratio=0.2,
                              days_of_history=250, since_pct=15.0),
            "XLK": _overview("XLK", sector_top1="Technology", sector_pct=85.3, sector_bucket=1,
                              country_top1="United States", country_pct=99.5, country_bucket=1, expense_ratio=0.09,
                              days_of_history=248, since_pct=18.0),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["QQQ", "XLK"])
        for insight in result["comparison_insights"]:
            lowered = insight["text"].lower()
            for word in _FORBIDDEN_WORDS:
                assert word not in lowered, f"forbidden word {word!r} found in: {insight['text']}"

    def test_voo_vs_vxus_international_pair(self):
        overviews = {
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=38.6, sector_bucket=11,
                              country_top1="United States", country_pct=99.0, country_bucket=1, expense_ratio=0.03,
                              days_of_history=260, since_pct=12.0),
            "VXUS": _overview("VXUS", sector_top1="Financial Services", sector_pct=22.3, sector_bucket=11,
                               country_top1="Japan", country_pct=16.1, country_bucket=20, expense_ratio=0.05,
                               days_of_history=260, since_pct=6.0),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "VXUS"])
        for insight in result["comparison_insights"]:
            lowered = insight["text"].lower()
            for word in _FORBIDDEN_WORDS:
                assert word not in lowered, f"forbidden word {word!r} found in: {insight['text']}"

    def test_never_claims_duplicate_holdings_even_with_identical_dominant_sector(self):
        overviews = {
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=35.0, sector_bucket=11, expense_ratio=0.03),
            "SPY": _overview("SPY", sector_top1="Technology", sector_pct=35.0, sector_bucket=11, expense_ratio=0.09),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "SPY"])
        for insight in result["comparison_insights"]:
            lowered = insight["text"].lower()
            assert "posicion" not in lowered and "holding" not in lowered


class TestEveryNumberMatchesSupportingData:
    def test_sector_difference_numbers_match(self):
        overviews = {
            "QQQ": _overview("QQQ", sector_top1="Technology", sector_pct=59.2, sector_bucket=9),
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=38.6, sector_bucket=11),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["QQQ", "VOO"])
        sector_insight = next(i for i in result["comparison_insights"] if i["category"] in ("sector_exposure_difference", "concentration_difference"))
        assert "59.2" in sector_insight["text"] and "38.6" in sector_insight["text"]

    def test_cost_difference_numbers_match(self):
        overviews = {
            "VOO": _overview("VOO", expense_ratio=0.03),
            "BOTZ": _overview("BOTZ", expense_ratio=0.68),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "BOTZ"])
        insight = next(i for i in result["comparison_insights"] if i["category"] == "cost_difference")
        assert "0.68" in insight["text"] and "0.03" in insight["text"]
        assert insight["supporting_data"]["higher_ticker"] == "BOTZ"
        assert insight["supporting_data"]["lower_ticker"] == "VOO"


class TestThresholdsNeverOverstateSmallDifferences:
    def test_small_cost_gap_produces_no_cost_insight(self):
        overviews = {
            "VOO": _overview("VOO", expense_ratio=0.03),
            "IVV": _overview("IVV", expense_ratio=0.035),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "IVV"])
        assert not any(i["category"] == "cost_difference" for i in result["comparison_insights"])

    def test_small_sector_gap_produces_no_sector_insight(self):
        overviews = {
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=38.0, sector_bucket=11),
            "SPY": _overview("SPY", sector_top1="Technology", sector_pct=40.0, sector_bucket=11),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "SPY"])
        assert not any(i["category"] in ("sector_exposure_difference", "concentration_difference") for i in result["comparison_insights"])


class TestMissingDataNeverTreatedAsZero:
    def test_failed_sector_fetch_stays_none_not_zero(self):
        overviews = {
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=38.0, sector_bucket=11,
                              sector_items=[{"name": "Technology", "weight_pct": 38.0}], sector_coverage_confirmed=True),
            "QQQ": _overview("QQQ", sector_top1=None, sector_pct=None, sector_items=[],
                              missing_fields=["sector_weightings"], sector_coverage_confirmed=False),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "QQQ"])
        row = next(r for r in result["exposure_comparison"]["sectors"] if r["name"] == "Technology")
        assert row["VOO"] == 38.0
        assert row["QQQ"] is None  # unknown — fetch failed, never a fabricated 0

    def test_sector_absent_from_confirmed_complete_fetch_is_a_real_zero(self):
        """XLK's weightings list simply doesn't mention 'Energy', AND its
        weights summed within the expected ~100% range (coverage
        confirmed complete) — so Energy really is ~0% of XLK."""
        overviews = {
            "XLE": _overview("XLE", sector_top1="Energy", sector_pct=95.0,
                              sector_items=[{"name": "Energy", "weight_pct": 95.0}], sector_coverage_confirmed=True),
            "XLK": _overview("XLK", sector_top1="Technology", sector_pct=98.0,
                              sector_items=[{"name": "Technology", "weight_pct": 98.0}], sector_coverage_confirmed=True),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["XLE", "XLK"])
        row = next(r for r in result["exposure_comparison"]["sectors"] if r["name"] == "Energy")
        assert row["XLE"] == 95.0
        assert row["XLK"] == 0.0

    def test_sector_absent_but_coverage_not_confirmed_stays_unknown(self):
        """Diego's Etapa-2 correction: a 200 response alone (fetch
        'succeeded') is NOT enough to call an absent sector 0% — if the
        weights didn't sum close to 100%, coverage isn't confirmed
        complete, so an absent name must stay unknown, not zero."""
        overviews = {
            "XLE": _overview("XLE", sector_top1="Energy", sector_pct=95.0,
                              sector_items=[{"name": "Energy", "weight_pct": 95.0}], sector_coverage_confirmed=True),
            "PARTIAL": _overview("PARTIAL", sector_top1="Technology", sector_pct=12.0,
                                   sector_items=[{"name": "Technology", "weight_pct": 12.0}],
                                   sector_coverage_confirmed=False),  # e.g. a stale/partial provider response
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["XLE", "PARTIAL"])
        row = next(r for r in result["exposure_comparison"]["sectors"] if r["name"] == "Energy")
        assert row["XLE"] == 95.0
        assert row["PARTIAL"] is None  # NOT 0.0 — coverage unconfirmed


class TestGeographicInsight:
    def test_same_dominant_country_is_similarity_not_difference(self):
        overviews = {
            "VOO": _overview("VOO", country_top1="United States", country_pct=99.0, country_bucket=1),
            "SPY": _overview("SPY", country_top1="United States", country_pct=98.5, country_bucket=1),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "SPY"])
        geo = next(i for i in result["comparison_insights"] if i["category"].startswith("geographic"))
        assert geo["category"] == "geographic_similarity"

    def test_different_dominant_country_is_difference(self):
        overviews = {
            "VOO": _overview("VOO", country_top1="United States", country_pct=99.0, country_bucket=1),
            "VXUS": _overview("VXUS", country_top1="Japan", country_pct=16.1, country_bucket=20),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "VXUS"])
        geo = next(i for i in result["comparison_insights"] if i["category"].startswith("geographic"))
        assert geo["category"] == "geographic_difference"


class TestPerformanceNeverComparedDirectly:
    def test_no_performance_category_ever_appears_in_insights(self):
        overviews = {
            "VOO": _overview("VOO", expense_ratio=0.03, days_of_history=260, since_pct=20.0),
            "QQQ": _overview("QQQ", expense_ratio=0.2, days_of_history=60, since_pct=5.0),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "QQQ"])
        assert all("performance" not in i["category"] for i in result["comparison_insights"])

    def test_performance_note_always_present_regardless_of_window_match(self):
        """No 'comparable' boolean, no implied equivalence — a plain
        disclosure note every time, whether windows happen to match or
        not, since matching day-counts alone never guarantees identical
        periods/methodology/dividend treatment."""
        overviews_matching = {
            "VOO": _overview("VOO", days_of_history=260),
            "QQQ": _overview("QQQ", days_of_history=255),
        }
        overviews_mismatched = {
            "VOO": _overview("VOO", days_of_history=260),
            "QQQ": _overview("QQQ", days_of_history=40),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews_matching)):
            result_a = compare_etfs(["VOO", "QQQ"])
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews_mismatched)):
            result_b = compare_etfs(["VOO", "QQQ"])
        assert result_a["performance_note"] == result_b["performance_note"]
        assert result_a["performance_note"] is not None
        assert "performance_comparable" not in result_a

    def test_each_etf_still_shows_its_own_performance_data(self):
        overviews = {
            "VOO": _overview("VOO", days_of_history=260, since_pct=20.0),
            "QQQ": _overview("QQQ", days_of_history=60, since_pct=5.0),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "QQQ"])
        voo = next(e for e in result["etfs"] if e["ticker"] == "VOO")
        qqq = next(e for e in result["etfs"] if e["ticker"] == "QQQ")
        assert voo["performance"]["max_pct"] == 20.0
        assert qqq["performance"]["max_pct"] == 5.0


class TestMaxThreeInsightsOnePerDimension:
    def test_never_more_than_three(self):
        overviews = {
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=30.0, sector_bucket=11,
                              country_top1="United States", country_pct=99.0, country_bucket=1, expense_ratio=0.03),
            "BOTZ": _overview("BOTZ", sector_top1="Technology", sector_pct=90.0, sector_bucket=1,
                               country_top1="Japan", country_pct=40.0, country_bucket=10, expense_ratio=0.68),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "BOTZ"])
        assert len(result["comparison_insights"]) <= 3

    def test_never_two_insights_about_the_same_sector_dimension(self):
        """Both the named-sector exposure gap and the raw top1-magnitude
        gap would qualify here (same dominant sector, same numbers) — the
        comparator must emit exactly one, not a redundant pair."""
        overviews = {
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=30.0, sector_bucket=11),
            "BOTZ": _overview("BOTZ", sector_top1="Technology", sector_pct=90.0, sector_bucket=1),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "BOTZ"])
        sector_dimension_insights = [i for i in result["comparison_insights"] if i["category"] in ("sector_exposure_difference", "concentration_difference")]
        assert len(sector_dimension_insights) == 1

    def test_zero_insights_when_data_too_thin(self):
        overviews = {"A": _overview("A"), "B": _overview("B")}
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["A", "B"])
        assert result["comparison_insights"] == []


class TestThreeWayComparison:
    def test_three_etfs_simultaneously(self):
        overviews = {
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=38.6, expense_ratio=0.03,
                              country_top1="United States", country_pct=99.0),
            "QQQ": _overview("QQQ", sector_top1="Technology", sector_pct=59.2, expense_ratio=0.2,
                              country_top1="United States", country_pct=99.0),
            "VXUS": _overview("VXUS", sector_top1="Financial Services", sector_pct=22.3, expense_ratio=0.05,
                               country_top1="Japan", country_pct=16.1),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "QQQ", "VXUS"])
        assert {e["ticker"] for e in result["etfs"]} == {"VOO", "QQQ", "VXUS"}
        assert len(result["comparison_insights"]) <= 3


class TestDifferentSectorCategoriesBetweenFunds:
    def test_no_common_dominant_sector_still_produces_valid_rows(self):
        overviews = {
            "XLV": _overview("XLV", sector_top1="Healthcare", sector_pct=99.0,
                              sector_items=[{"name": "Healthcare", "weight_pct": 99.0}]),
            "XLE": _overview("XLE", sector_top1="Energy", sector_pct=98.0,
                              sector_items=[{"name": "Energy", "weight_pct": 98.0}]),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["XLV", "XLE"])
        names = {r["name"] for r in result["exposure_comparison"]["sectors"]}
        assert names == {"Healthcare", "Energy"}


class TestEtfWithoutCostData:
    def test_missing_expense_ratio_produces_no_cost_insight_but_others_unaffected(self):
        overviews = {
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=60.0, expense_ratio=None),
            "XLK": _overview("XLK", sector_top1="Technology", sector_pct=98.0, expense_ratio=None),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "XLK"])
        assert not any(i["category"] == "cost_difference" for i in result["comparison_insights"])


class TestProviderErrors:
    def test_both_tickers_failing_entirely_returns_both_unavailable(self):
        def fake(ticker, use_cache=True, lang="es"):
            raise RuntimeError("timeout")
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=fake):
            result = compare_etfs(["VOO", "QQQ"])
        assert result["etfs"] == []
        assert {u["ticker"] for u in result["unavailable"]} == {"VOO", "QQQ"}
        assert result["comparison_insights"] == []
        assert result["comparison_ready"] is False


class TestBuildComparisonInsightsDirectly:
    def test_fewer_than_two_etfs_returns_empty(self):
        assert build_comparison_insights([_overview("VOO")]) == []
        assert build_comparison_insights([]) == []


class TestComparisonSummary:
    """Etapa-2 visual refinement (2nd pass), point 2: a short, CONCRETE
    synthesis built entirely from comparison_insights' own already-
    verified supporting_data — names the actual tickers/sector/country
    involved, never a generic 'differences found in: sector, cost' line,
    never a number (those stay in the detailed insight text), never a
    recommendation or an unsupported conclusion."""

    def test_no_insights_means_no_summary(self):
        assert build_comparison_summary([]) is None

    def test_summary_names_dimensions_not_detailed_text(self):
        overviews = {
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=30.0, expense_ratio=0.03,
                              country_top1="United States", country_pct=99.0),
            "BOTZ": _overview("BOTZ", sector_top1="Technology", sector_pct=90.0, expense_ratio=0.68,
                               country_top1="Japan", country_pct=40.0),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "BOTZ"])
        assert result["comparison_summary"] is not None
        # the summary must never contain an actual number — that belongs
        # only to the detailed comparison_insights text
        assert not any(ch.isdigit() for ch in result["comparison_summary"])
        for insight in result["comparison_insights"]:
            assert insight["text"] not in result["comparison_summary"]

    def test_summary_present_only_when_insights_exist(self):
        overviews = {"A": _overview("A"), "B": _overview("B")}
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["A", "B"])
        assert result["comparison_insights"] == []
        assert result["comparison_summary"] is None

    def test_summary_never_contains_a_verdict(self):
        overviews = {
            "VOO": _overview("VOO", expense_ratio=0.03),
            "BOTZ": _overview("BOTZ", expense_ratio=0.68),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "BOTZ"])
        lowered = (result["comparison_summary"] or "").lower()
        for word in _FORBIDDEN_WORDS:
            assert word not in lowered

    def test_english_variant(self):
        overviews = {
            "VOO": _overview("VOO", expense_ratio=0.03),
            "BOTZ": _overview("BOTZ", expense_ratio=0.68),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "BOTZ"], lang="en")
        assert result["comparison_summary"] is not None
        assert "fee" in result["comparison_summary"].lower()

    def test_matches_diego_requested_example_shape(self):
        """QQQ has more tech exposure AND a higher fee than VOO, both
        concentrate in the US — Diego's literal example: 'QQQ tiene una
        mayor exposición tecnológica y una comisión anual superior a VOO.
        Ambos concentran su exposición geográfica en Estados Unidos.'

        Sector/country names are passed here already translated
        ("Tecnología", "Estados Unidos") because that's what the real
        overview actually contains by the time compare_etfs sees it —
        service.py translates sector/country names before comparison.py
        ever runs (see translations.py), so this mirrors production data,
        not the untranslated literals the other fixtures in this file use
        for brevity."""
        overviews = {
            "VOO": _overview("VOO", sector_top1="Tecnología", sector_pct=38.6, sector_bucket=11,
                              sector_items=[{"name": "Tecnología", "weight_pct": 38.6}],
                              country_top1="Estados Unidos", country_pct=99.0, country_bucket=1,
                              country_items=[{"name": "Estados Unidos", "weight_pct": 99.0}],
                              expense_ratio=0.03),
            "QQQ": _overview("QQQ", sector_top1="Tecnología", sector_pct=59.2, sector_bucket=9,
                              sector_items=[{"name": "Tecnología", "weight_pct": 59.2}],
                              country_top1="Estados Unidos", country_pct=99.0, country_bucket=1,
                              country_items=[{"name": "Estados Unidos", "weight_pct": 99.0}],
                              expense_ratio=0.20),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "QQQ"])
        summary = result["comparison_summary"]
        assert summary is not None
        # concrete and specific: names the actual tickers and the actual
        # sector/country involved, not a generic dimension list
        assert "QQQ tiene" in summary
        assert "Tecnología" in summary
        assert "comisión anual superior a VOO" in summary
        assert "Ambos concentran su exposición geográfica en Estados Unidos" in summary
        # never the generic old phrasing
        assert "Se detectaron diferencias relevantes en" not in summary
        assert not any(ch.isdigit() for ch in summary)

    def test_different_dominant_countries_produce_a_concrete_geographic_sentence(self):
        overviews = {
            "VOO": _overview("VOO", country_top1="Estados Unidos", country_pct=99.0, country_bucket=1),
            "VXUS": _overview("VXUS", country_top1="Japón", country_pct=16.1, country_bucket=20),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "VXUS"])
        summary = result["comparison_summary"]
        assert summary is not None
        assert "VOO" in summary and "VXUS" in summary
        assert "Estados Unidos" in summary and "Japón" in summary

    def test_asymmetric_subjects_produce_two_sentences(self):
        """VOO has more tech exposure than XLK is impossible (XLK is
        nearly pure tech) — use a case where the HIGHER ticker genuinely
        differs between the sector and cost comparisons, so the summary
        must not falsely merge them into one 'X has A and B than Y'
        sentence when X isn't the subject of both."""
        overviews = {
            "VOO": _overview("VOO", sector_top1="Technology", sector_pct=20.0, sector_bucket=11, expense_ratio=0.68),
            "XLK": _overview("XLK", sector_top1="Technology", sector_pct=98.0, sector_bucket=1, expense_ratio=0.09),
        }
        with patch("app.services.etf.comparison.get_etf_overview", side_effect=_mock_overview_map(overviews)):
            result = compare_etfs(["VOO", "XLK"])
        summary = result["comparison_summary"]
        assert summary is not None
        # XLK is the higher-exposure subject, VOO is the higher-fee
        # subject — both facts must appear, each attributed correctly
        assert "XLK tiene" in summary
        assert "VOO tiene" in summary
