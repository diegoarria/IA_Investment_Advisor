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
