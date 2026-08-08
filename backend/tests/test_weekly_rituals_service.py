"""
Tests — app.services.weekly_rituals_service pure logic (Nuvos Weekly
Rituals: daily question never-repeat selection, week-start-Monday math,
multi-broker position aggregation). DB-touching functions (ensure_todays_
question, get_sunday_prep, save_reflection, ...) aren't covered here —
same convention as get_fundamental_analysis/job_events_alerts: no direct
tests for the Supabase-orchestration layer itself, only the pure functions
it's built from.
"""
from datetime import date

from app.services.weekly_rituals_service import (
    pick_next_question_row,
    _week_start_monday,
    _agg_positions,
)


class TestPickNextQuestionRow:
    def test_never_used_question_wins_over_any_used_one(self):
        rows = [
            {"id": "used-recent", "active": True, "last_used_at": "2026-08-01T00:00:00Z"},
            {"id": "never-used", "active": True, "last_used_at": None},
            {"id": "used-old", "active": True, "last_used_at": "2020-01-01T00:00:00Z"},
        ]
        picked = pick_next_question_row(rows)
        assert picked["id"] == "never-used"

    def test_among_used_questions_the_oldest_wins(self):
        rows = [
            {"id": "used-recent", "active": True, "last_used_at": "2026-08-01T00:00:00Z"},
            {"id": "used-oldest", "active": True, "last_used_at": "2020-01-01T00:00:00Z"},
            {"id": "used-middle", "active": True, "last_used_at": "2023-06-15T00:00:00Z"},
        ]
        picked = pick_next_question_row(rows)
        assert picked["id"] == "used-oldest"

    def test_ignores_inactive_questions(self):
        rows = [
            {"id": "inactive-never-used", "active": False, "last_used_at": None},
            {"id": "active-used", "active": True, "last_used_at": "2020-01-01T00:00:00Z"},
        ]
        picked = pick_next_question_row(rows)
        assert picked["id"] == "active-used"

    def test_returns_none_when_bank_is_empty(self):
        assert pick_next_question_row([]) is None

    def test_returns_none_when_every_question_is_inactive(self):
        rows = [{"id": "x", "active": False, "last_used_at": None}]
        assert pick_next_question_row(rows) is None

    def test_never_repeats_across_successive_picks(self):
        # Simulates the real cron loop: pick, mark used, pick again — with
        # only 3 questions, 3 successive picks must be 3 DISTINCT ids.
        rows = [
            {"id": "q1", "active": True, "last_used_at": None},
            {"id": "q2", "active": True, "last_used_at": None},
            {"id": "q3", "active": True, "last_used_at": None},
        ]
        picked_ids = []
        for day in range(3):
            picked = pick_next_question_row(rows)
            picked_ids.append(picked["id"])
            for r in rows:
                if r["id"] == picked["id"]:
                    r["last_used_at"] = f"2026-01-0{day + 1}T00:00:00Z"
        assert len(set(picked_ids)) == 3


class TestWeekStartMonday:
    def test_monday_returns_itself(self):
        monday = date(2026, 8, 3)  # a real Monday
        assert _week_start_monday(monday) == monday

    def test_sunday_returns_previous_monday(self):
        sunday = date(2026, 8, 9)
        assert _week_start_monday(sunday) == date(2026, 8, 3)

    def test_wednesday_returns_that_weeks_monday(self):
        wednesday = date(2026, 8, 5)
        assert _week_start_monday(wednesday) == date(2026, 8, 3)


class TestAggPositions:
    def test_flattens_dict_shaped_positions(self):
        rows = [{"positions": {"positions": [{"ticker": "AAPL", "shares": 10}]}}]
        result = _agg_positions(rows)
        assert result == [{"ticker": "AAPL", "shares": 10}]

    def test_flattens_bare_list_shaped_positions(self):
        rows = [{"positions": [{"ticker": "MSFT", "shares": 5}]}]
        result = _agg_positions(rows)
        assert result == [{"ticker": "MSFT", "shares": 5}]

    def test_aggregates_across_multiple_broker_rows(self):
        rows = [
            {"positions": {"positions": [{"ticker": "AAPL", "shares": 10}]}},
            {"positions": {"positions": [{"ticker": "MSFT", "shares": 5}]}},
        ]
        result = _agg_positions(rows)
        tickers = {p["ticker"] for p in result}
        assert tickers == {"AAPL", "MSFT"}

    def test_empty_rows_returns_empty_list(self):
        assert _agg_positions([]) == []

    def test_missing_positions_key_does_not_raise(self):
        assert _agg_positions([{}]) == []
