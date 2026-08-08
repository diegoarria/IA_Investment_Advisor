"""
Regression tests for premium/trial gating.

Context: this exact bug class ("a user still inside their real trial gets
treated as free") recurred twice — first because several endpoints
reimplemented the 30-day trial-window math ad hoc (and drifted: one used 90
days, one used 7, one skipped the trial check entirely), then again because
a handful of newer endpoints copy-pasted the same ad hoc pattern instead of
importing the canonical `is_premium_active()` from app.core.subscription.

These tests exist so that drift can't happen a third time silently:
1. Exhaustively test the boundaries of is_premium_active() itself.
2. Test every route module's own premium-check wrapper against a simulated
   trial user (day 15 of 30 — clearly mid-trial) to confirm they all agree
   with the canonical function, without needing a real database or HTTP
   client (mocking Supabase's fluent query builder is complex, and pure
   logic wrappers/checks are what actually varied module to module).
3. A "no reimplemented trial math" guard that greps every route file for
   the old ad hoc pattern (`datetime.fromisoformat(...)` + `days <` outside
   of app/core/subscription.py) — if this test starts failing, someone
   copy-pasted the bug back in.
"""
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.subscription import TRIAL_DAYS, is_premium_active

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _iso_days_ago(days: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


class TestIsPremiumActive:
    def test_paid_premium_always_true_even_with_no_trial_data(self):
        assert is_premium_active("premium", None) is True

    def test_paid_pro_always_true(self):
        assert is_premium_active("pro", None) is True

    def test_paid_premium_true_even_if_trial_data_looks_expired(self):
        # A paying user's tier must win regardless of whatever trial_started_at
        # still happens to be sitting in their row (e.g. left over from before
        # they upgraded) — this is the "pagué, me debo quedar premium para
        # siempre" guarantee.
        assert is_premium_active("premium", _iso_days_ago(9999)) is True

    def test_free_tier_mid_trial_day_15_is_premium(self):
        assert is_premium_active("free", _iso_days_ago(15)) is True

    def test_free_tier_day_zero_is_premium(self):
        assert is_premium_active("free", _iso_days_ago(0)) is True

    def test_free_tier_day_before_boundary_is_premium(self):
        assert is_premium_active("free", _iso_days_ago(TRIAL_DAYS - 1)) is True

    def test_free_tier_at_boundary_day_is_expired(self):
        # days < TRIAL_DAYS, so exactly TRIAL_DAYS days elapsed is expired.
        assert is_premium_active("free", _iso_days_ago(TRIAL_DAYS)) is False

    def test_free_tier_past_boundary_is_expired(self):
        assert is_premium_active("free", _iso_days_ago(TRIAL_DAYS + 1)) is False

    def test_free_tier_no_trial_started_is_not_premium(self):
        assert is_premium_active("free", None) is False

    def test_none_tier_no_trial_is_not_premium(self):
        assert is_premium_active(None, None) is False

    def test_malformed_trial_date_does_not_crash_and_is_not_premium(self):
        assert is_premium_active("free", "not-a-real-date") is False

    def test_z_suffix_iso_format_is_handled(self):
        # Supabase timestamps commonly come back with a literal "Z" suffix
        # rather than "+00:00" — must not be treated as malformed.
        started = (datetime.now(timezone.utc) - timedelta(days=15)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        assert is_premium_active("free", started) is True

    def test_streak_bonus_active_grants_premium_with_no_trial(self):
        # A user whose ONLY premium entitlement is a streak/referral bonus —
        # never trialed, never paid — must still pass every gate, not just
        # /billing/status (which is what actually happened before: the UI
        # said "Premium" while chat/watchlist/price alerts/learn all
        # rejected them).
        assert is_premium_active("free", None, _iso_days_ago(-5)) is True

    def test_streak_bonus_expired_is_not_premium(self):
        assert is_premium_active("free", None, _iso_days_ago(1)) is False

    def test_streak_bonus_ignored_when_omitted(self):
        # Backward compatibility: every pre-existing 2-arg call site must
        # keep behaving exactly as before.
        assert is_premium_active("free", None) is False

    def test_trial_wins_even_if_streak_bonus_already_expired(self):
        assert is_premium_active("free", _iso_days_ago(15), _iso_days_ago(1)) is True

    def test_malformed_streak_bonus_does_not_crash_and_is_not_premium(self):
        assert is_premium_active("free", None, "not-a-real-date") is False


class TestRouteWrappersAgreeWithCanonical:
    """Each of these route modules keeps its own thin wrapper around
    is_premium_active() (for its own parameter shape — a UserProfile object,
    a raw dict, etc.) — confirm every single one still agrees for a
    day-15-of-30 trial user, the exact scenario that broke before."""

    def test_chat_is_premium(self):
        from app.api.routes.chat import _is_premium

        profile = SimpleNamespace(subscription_tier="free", trial_started_at=_iso_days_ago(15))
        assert _is_premium(profile) is True

        expired_profile = SimpleNamespace(subscription_tier="free", trial_started_at=_iso_days_ago(45))
        assert _is_premium(expired_profile) is False

        assert _is_premium(None) is False

    def test_voice_call_is_premium(self):
        from app.api.routes.voice_call import _is_premium

        profile = SimpleNamespace(subscription_tier="free", trial_started_at=_iso_days_ago(15))
        assert _is_premium(profile) is True

        expired_profile = SimpleNamespace(subscription_tier="free", trial_started_at=_iso_days_ago(45))
        assert _is_premium(expired_profile) is False

    def test_upsells_effective_tier(self):
        from app.api.routes.upsells import _effective_tier

        assert _effective_tier("free", _iso_days_ago(15)) == "premium"
        assert _effective_tier("free", _iso_days_ago(45)) == "free"
        assert _effective_tier("premium", _iso_days_ago(45)) == "premium"

    @pytest.mark.asyncio
    async def test_learn_is_premium(self, monkeypatch):
        from app.api.routes import learn

        async def fake_profile_raw(user_id: str):
            return {"subscription_tier": "free", "trial_started_at": _iso_days_ago(15)}

        monkeypatch.setattr(learn, "_get_profile_raw", fake_profile_raw)
        assert await learn._is_premium("fake-user-id") is True

        async def fake_expired_profile_raw(user_id: str):
            return {"subscription_tier": "free", "trial_started_at": _iso_days_ago(45)}

        monkeypatch.setattr(learn, "_get_profile_raw", fake_expired_profile_raw)
        assert await learn._is_premium("fake-user-id") is False


class TestFetchFreshSubscriptionFields:
    @pytest.mark.asyncio
    async def test_returns_row_data_on_success(self, monkeypatch):
        from app.core import subscription

        class FakeResult:
            data = {"subscription_tier": "free", "trial_started_at": _iso_days_ago(15), "streak_bonus_premium_until": None}

        async def fake_run_query(query):
            return FakeResult()

        monkeypatch.setattr("app.core.database.run_query", fake_run_query)
        monkeypatch.setattr("app.core.database.get_supabase", lambda: SimpleNamespace(
            table=lambda name: SimpleNamespace(
                select=lambda cols: SimpleNamespace(
                    eq=lambda k, v: SimpleNamespace(maybe_single=lambda: None)
                )
            )
        ))
        result = await subscription.fetch_fresh_subscription_fields("fake-user-id")
        assert result["subscription_tier"] == "free"
        assert result["trial_started_at"] is not None

    @pytest.mark.asyncio
    async def test_db_failure_returns_empty_dict_not_an_exception(self, monkeypatch):
        # Callers merge this into an already-cached blob — a transient DB
        # hiccup here must degrade to "keep serving the cached value" rather
        # than crashing the whole request.
        from app.core import subscription

        async def failing_run_query(query):
            raise Exception("simulated transient DB error")

        monkeypatch.setattr("app.core.database.run_query", failing_run_query)
        monkeypatch.setattr("app.core.database.get_supabase", lambda: SimpleNamespace(
            table=lambda name: SimpleNamespace(
                select=lambda cols: SimpleNamespace(
                    eq=lambda k, v: SimpleNamespace(maybe_single=lambda: None)
                )
            )
        ))
        result = await subscription.fetch_fresh_subscription_fields("fake-user-id")
        assert result == {}


class TestNoReimplementedTrialMath:
    """Guards against the exact regression that kept happening: a route file
    reimplementing `datetime.fromisoformat(...)` + `days < N` trial-window
    math locally instead of importing is_premium_active(). If this fails,
    find the offending file:line printed in the assertion and replace the ad
    hoc block with `from app.core.subscription import is_premium_active`."""

    _SUSPECT_PATTERN = re.compile(r"days\s*<\s*\d+")

    def test_no_ad_hoc_trial_window_math_in_routes(self):
        offenders: list[str] = []
        routes_dir = BACKEND_ROOT / "app" / "api" / "routes"
        for path in routes_dir.glob("*.py"):
            text = path.read_text(encoding="utf-8")
            for i, line in enumerate(text.splitlines(), start=1):
                if self._SUSPECT_PATTERN.search(line):
                    offenders.append(f"{path.relative_to(BACKEND_ROOT)}:{i}: {line.strip()}")
        assert not offenders, (
            "Found ad hoc trial-window math outside app/core/subscription.py — "
            "use is_premium_active() instead:\n" + "\n".join(offenders)
        )

    def test_no_ad_hoc_trial_window_math_in_worker(self):
        worker_path = BACKEND_ROOT / "worker.py"
        text = worker_path.read_text(encoding="utf-8")
        offenders = [
            f"worker.py:{i}: {line.strip()}"
            for i, line in enumerate(text.splitlines(), start=1)
            if self._SUSPECT_PATTERN.search(line)
        ]
        assert not offenders, (
            "Found ad hoc trial-window math in worker.py — use is_premium_active() instead:\n"
            + "\n".join(offenders)
        )

    # app/services/*.py legitimately contains other "days < N" comparisons
    # that have nothing to do with premium/trial (thesis staleness windows,
    # a 365-day lookback, etc.) — unlike app/api/routes and worker.py, where
    # every such comparison has in practice been trial-window math. Require
    # the line to also mention trial/premium so this doesn't flag unrelated
    # business logic.
    _SUSPECT_PATTERN_TRIAL_SCOPED = re.compile(r"days\s*<\s*\d+.*(trial|premium)|(trial|premium).*days\s*<\s*\d+", re.IGNORECASE)

    def test_no_ad_hoc_trial_window_math_in_services(self):
        # Same guard as the routes/worker ones above, extended to
        # app/services/*.py — this directory was the actual blind spot: it
        # was never scanned, and it's where notification_engine.py's
        # analytics tracker quietly used raw subscription_tier instead of
        # is_premium_active for months.
        offenders: list[str] = []
        services_dir = BACKEND_ROOT / "app" / "services"
        for path in services_dir.glob("*.py"):
            text = path.read_text(encoding="utf-8")
            for i, line in enumerate(text.splitlines(), start=1):
                if self._SUSPECT_PATTERN_TRIAL_SCOPED.search(line):
                    offenders.append(f"{path.relative_to(BACKEND_ROOT)}:{i}: {line.strip()}")
        assert not offenders, (
            "Found ad hoc trial-window math outside app/core/subscription.py — "
            "use is_premium_active() instead:\n" + "\n".join(offenders)
        )

    def test_profile_cache_hit_refetches_subscription_fields_fresh(self):
        # GET /profile serves most of the row from a cache that can be up to
        # 120s stale AND, without Redis configured, is only ever invalidated
        # on the ONE gunicorn worker process that handled the write — every
        # other process keeps serving the old tier/trial_started_at for the
        # rest of its TTL. Guards against that exact cache-hit branch ever
        # returning `cached` without overwriting the subscription fields.
        path = BACKEND_ROOT / "app" / "api" / "routes" / "profile.py"
        text = path.read_text(encoding="utf-8")
        cache_hit_block = text.split("cached = cache_get(cache_key)", 1)[1].split("return UserProfile(**cached)", 1)[0]
        assert "fetch_fresh_subscription_fields" in cache_hit_block, (
            "app/api/routes/profile.py's GET /profile cache-hit branch no longer refreshes "
            "subscription_tier/trial_started_at before returning — this is exactly how a "
            "trial/premium user can flicker to free depending on which backend process "
            "answers the request. Call fetch_fresh_subscription_fields() and merge it in."
        )

    def test_sync_all_cache_hit_refetches_subscription_fields_fresh(self):
        path = BACKEND_ROOT / "app" / "api" / "routes" / "sync.py"
        text = path.read_text(encoding="utf-8")
        cache_hit_block = text.split('ck = f"sync:all:{user_id}"', 1)[1].split("db = get_supabase()", 1)[0]
        assert "fetch_fresh_subscription_fields" in cache_hit_block, (
            "app/api/routes/sync.py's GET /sync/all cache-hit branch no longer refreshes "
            "the trial/tier fields before returning — same flicker risk as GET /profile. "
            "Call fetch_fresh_subscription_fields() and rebuild the `trial` object from it."
        )

    _TIER_ONLY_PATTERN = re.compile(r'subscription_tier["\']?\s*\)?\s*==\s*["\']premium["\']')

    def test_no_tier_only_premium_check_in_worker(self):
        # The far more common recurring bug than reimplemented date math:
        # `subscription_tier == "premium"` with no trial_started_at or
        # streak_bonus_premium_until check at all — silently excludes every
        # trial/bonus user from whatever this gates (in worker.py's case,
        # historically: weekly emails, the AI-recommendations screener push,
        # and two proactive push jobs). A few call sites legitimately mean
        # "already paid" (e.g. referral.py's "don't grant a bonus to a
        # paying user") — those live in app/api/routes, not worker.py, so
        # this guard is scoped to worker.py only to avoid false positives.
        worker_path = BACKEND_ROOT / "worker.py"
        text = worker_path.read_text(encoding="utf-8")
        offenders = [
            f"worker.py:{i}: {line.strip()}"
            for i, line in enumerate(text.splitlines(), start=1)
            if self._TIER_ONLY_PATTERN.search(line)
        ]
        assert not offenders, (
            "Found a tier-only premium check in worker.py (ignores trial/streak-bonus users) — "
            "use _is_premium_user()/is_premium_active() instead:\n" + "\n".join(offenders)
        )
