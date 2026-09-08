"""
Nuvos Investor Recap — tests for the pure, DB/network-free logic:
month-boundary math, achievement conditions, ctx date-filtering, and
(the explicitly CRITICAL one, per spec) the Share Card DTO's privacy
guarantee — it must be structurally IMPOSSIBLE for a money/portfolio-
value/return field to reach the public Share Card, even if a future
change adds one upstream.
"""
from datetime import date

import pytest

from app.services.investor_recap_service import (
    _month_bounds,
    _ctx_as_of,
    ACHIEVEMENTS,
    build_share_card,
    _assert_no_forbidden_fields,
    FORBIDDEN_SHARE_FIELDS,
    _SHARE_CARD_ALLOWED_KEYS,
)


class TestMonthBounds:
    def test_past_month_covers_full_calendar_month(self):
        start, end, is_current = _month_bounds(2026, 8)
        assert start == date(2026, 8, 1)
        assert end == date(2026, 8, 31)
        assert is_current is False

    def test_february_leap_year(self):
        start, end, _ = _month_bounds(2024, 2)
        assert end == date(2024, 2, 29)

    def test_february_non_leap_year(self):
        start, end, _ = _month_bounds(2026, 2)
        assert end == date(2026, 2, 28)

    def test_current_month_clamps_end_to_today(self):
        today = date.today()
        start, end, is_current = _month_bounds(today.year, today.month)
        assert end == today
        assert is_current is True
        assert start == date(today.year, today.month, 1)


class TestCtxAsOf:
    def _base_ctx(self):
        return {
            "positions": [
                {"ticker": "AAPL", "purchaseDate": "2026-01-15", "shares": 10, "avgPrice": 150},
                {"ticker": "NVDA", "purchaseDate": "2026-06-10", "shares": 5, "avgPrice": 900},
            ],
            "closed_positions": [
                {"ticker": "TSLA", "purchaseDate": "2025-01-01", "closeDate": "2026-03-01", "shares": 2, "avgPrice": 200, "closePrice": 250},
            ],
            "decisions": [
                {"created_at": "2026-01-20T00:00:00", "action": "buy", "ticker": "AAPL"},
                {"created_at": "2026-07-01T00:00:00", "action": "buy", "ticker": "NVDA"},
            ],
            "snapshots": [
                {"snapshot_date": "2026-01-16", "total_value": 1500},
                {"snapshot_date": "2026-06-11", "total_value": 6000},
            ],
            "inception_date": "2026-01-15",
        }

    def test_excludes_positions_purchased_after_cutoff(self):
        ctx = self._base_ctx()
        filtered = _ctx_as_of(ctx, date(2026, 3, 1))
        tickers = {p["ticker"] for p in filtered["positions"]}
        assert tickers == {"AAPL"}  # NVDA bought 2026-06-10, after cutoff

    def test_excludes_closed_positions_closed_after_cutoff(self):
        ctx = self._base_ctx()
        filtered = _ctx_as_of(ctx, date(2026, 2, 1))
        assert filtered["closed_positions"] == []  # TSLA closed 2026-03-01, after cutoff

    def test_includes_closed_positions_closed_before_cutoff(self):
        ctx = self._base_ctx()
        filtered = _ctx_as_of(ctx, date(2026, 4, 1))
        assert len(filtered["closed_positions"]) == 1

    def test_excludes_decisions_after_cutoff(self):
        ctx = self._base_ctx()
        filtered = _ctx_as_of(ctx, date(2026, 3, 1))
        assert len(filtered["decisions"]) == 1
        assert filtered["decisions"][0]["ticker"] == "AAPL"

    def test_days_since_inception_none_if_inception_after_cutoff(self):
        ctx = self._base_ctx()
        filtered = _ctx_as_of(ctx, date(2026, 1, 1))  # before inception (2026-01-15)
        assert filtered["days_since_inception"] is None

    def test_total_operations_recomputed_from_filtered_lists(self):
        ctx = self._base_ctx()
        filtered = _ctx_as_of(ctx, date(2026, 12, 31))
        assert filtered["total_operations"] == 3  # AAPL + NVDA + TSLA, all before this cutoff


class TestAchievements:
    def _signals(self, **overrides):
        base = {
            "total_theses": 0, "longest_activity_streak": 0, "companies_analyzed_lifetime": 0,
            "lessons_completed": 0, "avg_deliberation_days": None, "longest_conviction_days": 0,
        }
        base.update(overrides)
        return base

    def _condition(self, achievement_id):
        return next(a["condition"] for a in ACHIEVEMENTS if a["id"] == achievement_id)

    def test_analista_unlocks_on_first_thesis(self):
        assert self._condition("analista")(self._signals(total_theses=1)) is True
        assert self._condition("analista")(self._signals(total_theses=0)) is False

    def test_constante_requires_seven_day_streak(self):
        assert self._condition("constante")(self._signals(longest_activity_streak=7)) is True
        assert self._condition("constante")(self._signals(longest_activity_streak=6)) is False

    def test_explorador_requires_five_companies(self):
        assert self._condition("explorador")(self._signals(companies_analyzed_lifetime=5)) is True
        assert self._condition("explorador")(self._signals(companies_analyzed_lifetime=4)) is False

    def test_alumno_requires_ten_lessons(self):
        assert self._condition("alumno")(self._signals(lessons_completed=10)) is True
        assert self._condition("alumno")(self._signals(lessons_completed=9)) is False

    def test_disciplinado_requires_real_deliberation_data_not_zero(self):
        # None (no data) must NOT unlock — only a real, even-if-small, value.
        assert self._condition("disciplinado")(self._signals(avg_deliberation_days=None)) is False
        assert self._condition("disciplinado")(self._signals(avg_deliberation_days=0.5)) is True

    def test_conviction_requires_ninety_days(self):
        assert self._condition("conviction")(self._signals(longest_conviction_days=90)) is True
        assert self._condition("conviction")(self._signals(longest_conviction_days=89)) is False

    def test_every_achievement_id_is_unique(self):
        ids = [a["id"] for a in ACHIEVEMENTS]
        assert len(ids) == len(set(ids))


class TestShareCardPrivacy:
    """The CRITICAL test the spec calls out explicitly: financial/monetary
    data must be structurally impossible to leak into the Share Card."""

    def _evolution(self, with_archetype=True):
        return {
            "current_archetype": {"name": "THE COMPOUNDER", "emoji": "📈", "tagline": "You think in decades.", "traits": ["a", "b", "c"]} if with_archetype else None,
            "past_archetype": None,
            "months_compared": None,
        }

    def _achievements(self):
        return {"unlocked_this_month": [{"id": "analista", "name": "ANALISTA", "icon": "🔬"}], "total_unlocked": 1, "total_available": 6, "next_achievement": None}

    def _habits(self):
        return {"active_days": 12, "longest_streak": 5, "favorite_weekday": "Domingo", "activity_breakdown": {}}

    def _research(self):
        return {"companies_researched": 3, "favorite_company": {"ticker": "AMZN", "company_name": "Amazon"}}

    def test_share_card_contains_no_forbidden_field_names(self):
        card = build_share_card("SEPTIEMBRE 2026", self._evolution(), self._achievements(), self._habits(), self._research())
        card_str = str(card).lower()
        for forbidden in FORBIDDEN_SHARE_FIELDS:
            assert forbidden not in card_str.replace("_", ""), f"Share card leaked forbidden concept: {forbidden}"

    def test_share_card_only_has_allowlisted_top_level_keys(self):
        card = build_share_card("SEPTIEMBRE 2026", self._evolution(), self._achievements(), self._habits(), self._research())
        assert set(card.keys()) <= _SHARE_CARD_ALLOWED_KEYS

    def test_share_card_works_with_no_archetype_yet(self):
        card = build_share_card("SEPTIEMBRE 2026", self._evolution(with_archetype=False), self._achievements(), self._habits(), self._research())
        assert card["archetype"] is None

    def test_assert_no_forbidden_fields_raises_on_injected_money_field(self):
        poisoned = {"month_label": "x", "portfolio_value": 50000}
        with pytest.raises(ValueError):
            _assert_no_forbidden_fields(poisoned)

    def test_assert_no_forbidden_fields_raises_on_nested_money_field(self):
        poisoned = {"month_label": "x", "archetype": {"name": "X", "return_pct": 12.5}}
        with pytest.raises(ValueError):
            _assert_no_forbidden_fields(poisoned)

    def test_assert_no_forbidden_fields_raises_on_non_allowlisted_top_level_key(self):
        poisoned = {"month_label": "x", "some_new_field_nobody_reviewed": "value"}
        with pytest.raises(ValueError):
            _assert_no_forbidden_fields(poisoned)

    def test_assert_no_forbidden_fields_passes_clean_card(self):
        clean = {"month_label": "x", "archetype": None, "achievement": None,
                  "favorite_activity": None, "research_obsession": None,
                  "current_focus": None, "strongest_skill": None, "active_days": 5}
        _assert_no_forbidden_fields(clean)  # must not raise
