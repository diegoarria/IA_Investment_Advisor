"""
Tests — app.services.saved_valuation_service (margin-of-safety alerts,
revived for the current Nuvos AI Fair Value Engine, 2026-08-19).

Only the pure _reached_threshold/_with_live_data logic is tested here —
no network I/O (get_live_margin_of_safety/run_milestone_check's Supabase
calls) is exercised.
"""
from app.services.saved_valuation_service import _reached_threshold, _with_live_data


class TestReachedThreshold:
    def test_fires_at_or_above_target(self):
        assert _reached_threshold(25.0, 20.0) is True
        assert _reached_threshold(20.0, 20.0) is True

    def test_does_not_fire_below_target(self):
        assert _reached_threshold(19.9, 20.0) is False
        assert _reached_threshold(-5.0, 20.0) is False

    def test_none_margin_or_target_never_fires(self):
        assert _reached_threshold(None, 20.0) is False
        assert _reached_threshold(25.0, None) is False
        assert _reached_threshold(None, None) is False


class TestWithLiveData:
    def test_merges_row_and_live_data(self):
        row = {
            "ticker": "AAPL", "company_name": "Apple Inc.",
            "target_margin_of_safety_pct": 20.0, "notified_at": None,
        }
        live = {
            "company_name": "Apple Inc.", "sector": "Technology", "exchange": "NASDAQ",
            "current_price": 227.5, "margin_of_safety_pct": 12.3,
        }
        merged = _with_live_data(row, live)
        assert merged["ticker"] == "AAPL"
        assert merged["target_margin_of_safety_pct"] == 20.0
        assert merged["margin_of_safety_pct"] == 12.3
        assert merged["current_price"] == 227.5
        assert merged["stale"] is False

    def test_missing_live_data_marks_stale_without_crashing(self):
        row = {"ticker": "XYZ", "company_name": "Old Co", "target_margin_of_safety_pct": 15.0, "notified_at": None}
        merged = _with_live_data(row, None)
        assert merged["stale"] is True
        assert merged["margin_of_safety_pct"] is None
        assert merged["current_price"] is None
