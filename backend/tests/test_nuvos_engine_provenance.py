"""
Tests — app.services.valuation.nuvos_engine.provenance.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.
"""
from app.services.valuation.nuvos_engine.provenance import (
    ProvenanceLedger, record, note_discrepancy, build_ledger,
)


class TestRecord:
    def test_real_value_gets_labeled_provider(self):
        ledger = ProvenanceLedger()
        record(ledger, metric="eps_ttm", value=3.5, period="TTM", provider="fmp", as_of="2026-01-01T00:00:00Z")
        dp = ledger.points["eps_ttm"]
        assert dp.value == 3.5
        assert dp.source == "FMP"
        assert dp.as_of == "2026-01-01T00:00:00Z"

    def test_missing_value_is_honestly_unavailable_not_fabricated(self):
        ledger = ProvenanceLedger()
        record(ledger, metric="fcf_ttm", value=None, provider="fmp")
        dp = ledger.points["fcf_ttm"]
        assert dp.source == "unavailable"
        assert dp.as_of is None

    def test_unknown_provider_label_falls_through_unchanged(self):
        ledger = ProvenanceLedger()
        record(ledger, metric="x", value=1.0, provider="some_new_provider")
        assert ledger.points["x"].source == "some_new_provider"


class TestCompletenessPct:
    def test_empty_ledger_is_100_never_falsely_tanks_confidence(self):
        assert ProvenanceLedger().completeness_pct == 100.0

    def test_partial_availability_computed_correctly(self):
        ledger = ProvenanceLedger()
        record(ledger, metric="a", value=1.0, provider="fmp")
        record(ledger, metric="b", value=None, provider="fmp")
        assert ledger.completeness_pct == 50.0

    def test_all_available_is_100(self):
        ledger = ProvenanceLedger()
        record(ledger, metric="a", value=1.0, provider="fmp")
        record(ledger, metric="b", value=2.0, provider="fmp")
        assert ledger.completeness_pct == 100.0


class TestStaleOrMissing:
    def test_lists_only_missing_metrics(self):
        ledger = ProvenanceLedger()
        record(ledger, metric="a", value=1.0, provider="fmp")
        record(ledger, metric="b", value=None, provider="fmp")
        assert ledger.stale_or_missing() == ["b"]

    def test_empty_when_everything_present(self):
        ledger = ProvenanceLedger()
        record(ledger, metric="a", value=1.0, provider="fmp")
        assert ledger.stale_or_missing() == []


class TestNoteDiscrepancy:
    def test_appends_human_readable_note(self):
        ledger = ProvenanceLedger()
        note_discrepancy(ledger, "FMP said X, YFinance said Y")
        assert ledger.discrepancies == ["FMP said X, YFinance said Y"]


class TestBuildLedger:
    def test_no_financials_response_returns_empty_ledger(self):
        ledger = build_ledger(financials_response=None, headline_metrics={"eps_ttm": (3.5, "TTM")})
        assert ledger.points == {}

    def test_stamps_every_headline_metric_with_the_fetch_providers_info(self):
        response = {"provider": "fmp", "fetchedAt": "2026-01-01T00:00:00Z"}
        ledger = build_ledger(
            financials_response=response,
            headline_metrics={"eps_ttm": (3.5, "TTM"), "revenue_latest": (100.0, "FY2025")},
        )
        assert ledger.points["eps_ttm"].source == "FMP"
        assert ledger.points["eps_ttm"].as_of == "2026-01-01T00:00:00Z"
        assert ledger.points["revenue_latest"].period == "FY2025"
