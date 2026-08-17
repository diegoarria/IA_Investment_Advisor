"""
Tests — app.services.smart_alerts_service (Fase 4, Incremento 10, Parte J).
See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.smart_alerts_service import (
    _detect_thesis_or_guidance,
    _detect_roic_fcf_direction,
    _detect_new_risks,
    _detect_price_in_range,
    _serialize_risks,
    _alert_copy,
    run_smart_alerts_check,
)


class TestDetectThesisOrGuidance:
    def test_no_matching_events_returns_none(self):
        events = [{"id": "1", "event_type": "ceo_change", "headline": "x"}]
        assert _detect_thesis_or_guidance(events, "strategy_change") is None

    def test_returns_the_most_recent_matching_event(self):
        events = [
            {"id": "2", "event_type": "strategy_change", "headline": "Newer strategy shift"},
            {"id": "1", "event_type": "strategy_change", "headline": "Older strategy shift"},
        ]
        result = _detect_thesis_or_guidance(events, "strategy_change")
        assert result == ("2", "Newer strategy shift")

    def test_ignores_other_event_types(self):
        events = [{"id": "1", "event_type": "guidance_change", "headline": "Guidance cut"}]
        assert _detect_thesis_or_guidance(events, "strategy_change") is None
        assert _detect_thesis_or_guidance(events, "guidance_change") == ("1", "Guidance cut")


class TestDetectRoicFcfDirection:
    def test_no_deterioration_data_returns_none(self):
        assert _detect_roic_fcf_direction(None) is None
        assert _detect_roic_fcf_direction({}) is None

    def test_deteriorating_roic_wins(self):
        nif = {"deterioration": {"factors": [
            {"name": "roic", "direction": "deteriorando"},
            {"name": "fcf_margin", "direction": "mejorando"},
        ]}}
        assert _detect_roic_fcf_direction(nif) == "deteriorando"

    def test_both_improving_returns_mejorando(self):
        nif = {"deterioration": {"factors": [
            {"name": "roic", "direction": "mejorando"},
            {"name": "fcf_margin", "direction": "estable"},
        ]}}
        assert _detect_roic_fcf_direction(nif) == "mejorando"

    def test_stable_returns_none(self):
        nif = {"deterioration": {"factors": [
            {"name": "roic", "direction": "estable"},
            {"name": "fcf_margin", "direction": "estable"},
        ]}}
        assert _detect_roic_fcf_direction(nif) is None

    def test_unrelated_metric_deteriorating_is_ignored(self):
        nif = {"deterioration": {"factors": [{"name": "revenue", "direction": "deteriorando"}]}}
        assert _detect_roic_fcf_direction(nif) is None


class TestDetectNewRisks:
    def test_no_previous_state_returns_none_never_pushes_on_first_sight(self):
        assert _detect_new_risks(["Riesgo A"], None) is None

    def test_no_current_risks_returns_none(self):
        assert _detect_new_risks([], "Riesgo A") is None

    def test_new_risk_text_is_detected(self):
        current = ["Riesgo A", "Riesgo B"]
        previous = _serialize_risks(["Riesgo A"])
        assert _detect_new_risks(current, previous) == ["Riesgo B"]

    def test_no_new_risks_returns_none(self):
        current = ["Riesgo A"]
        previous = _serialize_risks(["Riesgo A"])
        assert _detect_new_risks(current, previous) is None


class TestDetectPriceInRange:
    def test_missing_price_or_range_returns_none(self):
        assert _detect_price_in_range(None, {"low": 10, "high": 20}) is None
        assert _detect_price_in_range(15, None) is None
        assert _detect_price_in_range(15, {"low": None, "high": 20}) is None

    def test_price_inside_range(self):
        assert _detect_price_in_range(15, {"low": 10, "high": 20}) == "in_range"

    def test_price_outside_range(self):
        assert _detect_price_in_range(25, {"low": 10, "high": 20}) == "out_of_range"

    def test_price_at_boundary_is_in_range(self):
        assert _detect_price_in_range(20, {"low": 10, "high": 20}) == "in_range"


class TestAlertCopy:
    def test_every_category_has_real_spanish_and_english_copy(self):
        from app.services.smart_alerts_service import CATEGORIES
        for category in CATEGORIES:
            for lang in ("es", "en"):
                title, body = _alert_copy("AAPL", category, {}, lang)
                assert title and "AAPL" in title
                assert body

    def test_headline_kwarg_is_used_when_present(self):
        title, body = _alert_copy("AAPL", "thesis_change", {"headline": "Real headline text"}, "es")
        assert body == "Real headline text"


class TestRunSmartAlertsCheck:
    @pytest.mark.asyncio
    async def test_no_users_with_any_toggle_enabled_is_a_noop(self):
        mock_db = MagicMock()
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run, \
             patch("app.services.notification_engine.send_push", new_callable=AsyncMock) as mock_push:
            mock_run.return_value = SimpleNamespace(data=[])
            await run_smart_alerts_check()
        mock_push.assert_not_called()

    @pytest.mark.asyncio
    async def test_free_user_never_gets_a_push_but_state_and_teaser_log_still_happen(self):
        """Diego's Aug 16 Free/Premium spec, §7 + §16: Smart Alerts is
        100% Premium, enforced in the backend job itself, not just the
        route layer — a free user's real detection must never trigger an
        actual push, but a real (never fabricated) teaser record should
        still be written so get_smart_alerts_teaser has something honest
        to count."""
        mock_db = MagicMock()
        prefs_row = {
            "user_id": "free_user", "push_thesis_changes": True, "push_guidance_changes": False,
            "push_roic_fcf_deterioration": False, "push_new_risks": False, "push_price_in_range": False,
        }
        watchlist_rows = [{"user_id": "free_user", "ticker": "AAPL"}]
        lang_rows = [{"user_id": "free_user", "preferred_language": "es"}]
        tier_rows = [{"user_id": "free_user", "subscription_tier": "free", "trial_started_at": None, "streak_bonus_premium_until": None}]
        state_rows: list[dict] = []

        run_query_calls = {
            "prefs": SimpleNamespace(data=[prefs_row]),
            "watchlist": SimpleNamespace(data=watchlist_rows),
            "lang": SimpleNamespace(data=lang_rows),
            "tier": SimpleNamespace(data=tier_rows),
            "state": SimpleNamespace(data=state_rows),
        }
        call_order = ["prefs", "watchlist", "lang", "tier", "state"]

        async def run_query_side_effect(*_args, **_kwargs):
            if call_order:
                return run_query_calls[call_order.pop(0)]
            return SimpleNamespace(data=[])

        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", side_effect=run_query_side_effect), \
             patch("app.services.notification_engine.send_push", new_callable=AsyncMock) as mock_push, \
             patch("app.services.notification_engine._log_notification", new_callable=AsyncMock) as mock_log, \
             patch(
                 "app.services.smart_alerts_service._gather_ticker_signals",
                 new_callable=AsyncMock,
                 return_value={
                     "thesis_change": ("evt-1", "AAPL shifted strategy toward services"),
                     "guidance_change": None, "roic_fcf_deterioration": None,
                     "new_risks_current": [], "price_in_range_current": None,
                 },
             ):
            await run_smart_alerts_check()

        mock_push.assert_not_called()
        mock_log.assert_called_once()
        args, _ = mock_log.call_args
        assert args[1] == "free_user"
        assert args[3] == "smart_alert_thesis_change"

    @pytest.mark.asyncio
    async def test_new_thesis_change_event_triggers_exactly_one_push(self):
        mock_db = MagicMock()
        prefs_row = {
            "user_id": "user1", "push_thesis_changes": True, "push_guidance_changes": False,
            "push_roic_fcf_deterioration": False, "push_new_risks": False, "push_price_in_range": False,
        }
        watchlist_rows = [{"user_id": "user1", "ticker": "AAPL"}]
        lang_rows = [{"user_id": "user1", "preferred_language": "es"}]
        tier_rows = [{"user_id": "user1", "subscription_tier": "premium", "trial_started_at": None, "streak_bonus_premium_until": None}]
        state_rows: list[dict] = []  # no prior state — this is a genuinely new event

        run_query_calls = {
            "prefs": SimpleNamespace(data=[prefs_row]),
            "watchlist": SimpleNamespace(data=watchlist_rows),
            "lang": SimpleNamespace(data=lang_rows),
            "tier": SimpleNamespace(data=tier_rows),
            "state": SimpleNamespace(data=state_rows),
            "upsert": SimpleNamespace(data=[]),
        }

        call_order = ["prefs", "watchlist", "lang", "tier", "state"]

        async def run_query_side_effect(*_args, **_kwargs):
            if call_order:
                return run_query_calls[call_order.pop(0)]
            return run_query_calls["upsert"]

        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", side_effect=run_query_side_effect), \
             patch("app.services.notification_engine.send_push", new_callable=AsyncMock) as mock_push, \
             patch(
                 "app.services.smart_alerts_service._gather_ticker_signals",
                 new_callable=AsyncMock,
                 return_value={
                     "thesis_change": ("evt-1", "AAPL shifted strategy toward services"),
                     "guidance_change": None,
                     "roic_fcf_deterioration": None,
                     "new_risks_current": [],
                     "price_in_range_current": None,
                 },
             ):
            await run_smart_alerts_check()

        mock_push.assert_called_once()
        args, _ = mock_push.call_args
        assert args[0] == "user1"
        assert args[1] == "smart_alert_thesis_change"
        assert "AAPL shifted strategy toward services" == args[3]

    @pytest.mark.asyncio
    async def test_same_event_id_as_prior_state_does_not_repush(self):
        mock_db = MagicMock()
        prefs_row = {"user_id": "user1", "push_thesis_changes": True, "push_guidance_changes": False,
                     "push_roic_fcf_deterioration": False, "push_new_risks": False, "push_price_in_range": False}
        watchlist_rows = [{"user_id": "user1", "ticker": "AAPL"}]
        state_rows = [{"user_id": "user1", "ticker": "AAPL", "category": "thesis_change", "last_value": "evt-1"}]
        tier_rows = [{"user_id": "user1", "subscription_tier": "premium", "trial_started_at": None, "streak_bonus_premium_until": None}]

        run_query_calls = {
            "prefs": SimpleNamespace(data=[prefs_row]),
            "watchlist": SimpleNamespace(data=watchlist_rows),
            "lang": SimpleNamespace(data=[]),
            "tier": SimpleNamespace(data=tier_rows),
            "state": SimpleNamespace(data=state_rows),
        }
        call_order = ["prefs", "watchlist", "lang", "tier", "state"]

        async def run_query_side_effect(*_args, **_kwargs):
            if call_order:
                return run_query_calls[call_order.pop(0)]
            return SimpleNamespace(data=[])

        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", side_effect=run_query_side_effect), \
             patch("app.services.notification_engine.send_push", new_callable=AsyncMock) as mock_push, \
             patch(
                 "app.services.smart_alerts_service._gather_ticker_signals",
                 new_callable=AsyncMock,
                 return_value={
                     "thesis_change": ("evt-1", "Same event as before"),
                     "guidance_change": None, "roic_fcf_deterioration": None,
                     "new_risks_current": [], "price_in_range_current": None,
                 },
             ):
            await run_smart_alerts_check()

        mock_push.assert_not_called()


class TestGetSmartAlertsTeaser:
    @pytest.mark.asyncio
    async def test_returns_real_count_from_notification_log(self):
        from app.services.smart_alerts_service import get_smart_alerts_teaser

        mock_db = MagicMock()
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[{"id": "1"}, {"id": "2"}, {"id": "3"}], count=3)
            result = await get_smart_alerts_teaser("user1")
        assert result == 3

    @pytest.mark.asyncio
    async def test_zero_detections_returns_zero_never_fabricated(self):
        from app.services.smart_alerts_service import get_smart_alerts_teaser

        mock_db = MagicMock()
        with patch("app.core.database.get_supabase", return_value=mock_db), \
             patch("app.core.database.run_query", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = SimpleNamespace(data=[], count=0)
            result = await get_smart_alerts_teaser("user1")
        assert result == 0
