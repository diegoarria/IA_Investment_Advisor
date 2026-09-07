"""
Tests — app.services.notification_engine.can_send_push's fatigue-cap gate,
specifically the high-priority/noisy budget split added Sep 2026.

Real incident: a power user with a large watchlist burned through their
entire `max_push_per_week` on per-ticker price-mover alerts alone by
Thursday, silently starving out that week's `sunday_portfolio_review` and
`weekly_rituals_*` pushes with zero visibility anywhere. Fix: high-priority
categories (smart_alert_*, sunday_portfolio_review, weekly_rituals_*,
ai_insight_reversal_*/ai_insight_concentration_*) now draw from their own
small reserved budget (_HIGH_PRIORITY_DAILY_CAP/_HIGH_PRIORITY_WEEKLY_CAP)
instead of the user's configurable, noise-shared max_push_per_day/week.

Mocks `app.core.database.run_query` (same pattern as
test_smart_alerts_service.py) and `app.core.cache` so these test the real
gating logic deterministically, no network.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services.notification_engine import (
    _HIGH_PRIORITY_DAILY_CAP,
    _HIGH_PRIORITY_WEEKLY_CAP,
    _is_high_priority,
    can_send_push,
)

_DEFAULT_PREFS = {
    "snooze_until": None, "quiet_hours_start": 22, "quiet_hours_end": 8,
    "max_push_per_day": 15, "max_push_per_week": 60,
}


def _sent_rows(categories: list[str]) -> list[dict]:
    return [{"category": c} for c in categories]


async def _run_can_send_push(
    category: str,
    weekly_categories: list[str],
    daily_categories: list[str] | None = None,
    prefs: dict | None = None,
):
    """Runs can_send_push, feeding `daily_categories` (default empty — under
    every cap tested here) to the daily window's query and
    `weekly_categories` to the weekly window's, matching can_send_push's
    real call order: prefs -> daily count -> weekly count. Keeping these
    separate lets a test target exactly the weekly boundary without also
    tripping the (much smaller) daily cap on the same data, and vice versa."""
    mock_db = MagicMock()
    prefs = {**_DEFAULT_PREFS, **(prefs or {})}
    daily_categories = daily_categories if daily_categories is not None else []

    async def run_query_side_effect(query):
        run_query_side_effect.calls += 1
        if run_query_side_effect.calls == 1:
            return SimpleNamespace(data=[prefs])
        if run_query_side_effect.calls == 2:
            return SimpleNamespace(data=_sent_rows(daily_categories))
        return SimpleNamespace(data=_sent_rows(weekly_categories))

    run_query_side_effect.calls = 0

    with patch("app.core.database.run_query", side_effect=run_query_side_effect), \
         patch("app.core.cache.cache_get", return_value=None), \
         patch("app.core.cache.cache_set"), \
         patch("app.services.notification_engine.acquire_lock", return_value="ok"):
        return await can_send_push("uid-1", category, mock_db)


class TestIsHighPriority:
    def test_smart_alert_categories_are_high_priority(self):
        assert _is_high_priority("smart_alert_thesis_change")
        assert _is_high_priority("smart_alert_roic_fcf_deterioration")

    def test_weekly_rituals_and_portfolio_review_are_high_priority(self):
        assert _is_high_priority("sunday_portfolio_review")
        assert _is_high_priority("weekly_rituals_question")
        assert _is_high_priority("weekly_rituals_saturday")

    def test_ai_insight_categories_are_high_priority(self):
        assert _is_high_priority("ai_insight_reversal_NVDA")
        assert _is_high_priority("ai_insight_concentration_TSLA")

    def test_noisy_categories_are_not_high_priority(self):
        assert not _is_high_priority("price_mover_NVDA")
        assert not _is_high_priority("ex_dividend:MCD")
        assert not _is_high_priority("dividend_payment:V")
        assert not _is_high_priority("morning_brief")
        assert not _is_high_priority("market_open")
        assert not _is_high_priority("reengagement")


class TestFatigueCapSplit:
    @pytest.mark.asyncio
    async def test_noisy_flood_does_not_block_a_high_priority_category(self):
        # This is the exact real-world scenario: 60 noisy price-mover/
        # dividend pushes already sent this week (well past what would be a
        # tiny high-priority budget) — a high-priority push must still go
        # through, because it draws from its OWN separate bucket.
        noisy_flood = [f"price_mover_TICK{i}" for i in range(60)]
        allowed, reason = await _run_can_send_push(
            "sunday_portfolio_review", weekly_categories=noisy_flood,
            prefs={"max_push_per_day": 15, "max_push_per_week": 60},
        )
        assert allowed is True
        assert reason is None

    @pytest.mark.asyncio
    async def test_noisy_category_is_still_blocked_by_its_own_shared_cap(self):
        # The general noise budget must still work as before for noisy
        # categories — this isn't a "remove all caps" fix, just a split.
        # daily_categories defaults to empty (under the daily cap), isolating
        # this to the weekly boundary specifically.
        noisy_flood = [f"price_mover_TICK{i}" for i in range(60)]
        allowed, reason = await _run_can_send_push(
            "price_mover_NEWONE", weekly_categories=noisy_flood,
            prefs={"max_push_per_day": 15, "max_push_per_week": 60},
        )
        assert allowed is False
        assert reason == "weekly_cap"

    @pytest.mark.asyncio
    async def test_high_priority_category_has_its_own_small_cap(self):
        # Exactly at the high-priority weekly cap -> blocked, but with the
        # distinct reason (never confused with the general weekly_cap).
        already_sent = [f"smart_alert_thesis_change:TICK{i}" for i in range(_HIGH_PRIORITY_WEEKLY_CAP)]
        allowed, reason = await _run_can_send_push("weekly_rituals_question", weekly_categories=already_sent)
        assert allowed is False
        assert reason == "high_priority_weekly_cap"

    @pytest.mark.asyncio
    async def test_high_priority_category_allowed_under_its_cap(self):
        already_sent = [f"smart_alert_thesis_change:TICK{i}" for i in range(_HIGH_PRIORITY_WEEKLY_CAP - 1)]
        allowed, reason = await _run_can_send_push("weekly_rituals_question", weekly_categories=already_sent)
        assert allowed is True
        assert reason is None

    @pytest.mark.asyncio
    async def test_clean_slate_allows_both_kinds_of_category(self):
        allowed_noisy, _ = await _run_can_send_push("price_mover_NVDA", weekly_categories=[])
        allowed_high, _ = await _run_can_send_push("sunday_portfolio_review", weekly_categories=[])
        assert allowed_noisy is True
        assert allowed_high is True
