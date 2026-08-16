"""
Regression tests — real production bug (Aug 16): "Internal server error"
on the LAST step of onboarding, reported by multiple users on web and
mobile. Root cause: `UserProfile.risk_tolerance` is a required `str`
with no default, but the shortened 2026 onboarding never collects it and
relies on the DB COLUMN's own default ('moderate') — Pydantic can't see
a DB-level default, so any row where Supabase actually returns
`risk_tolerance: None` raised an unguarded ValidationError, surfaced to
the user as a raw 500. `coerce_profile_row` (app/models/user.py) is the
fix, applied at every `UserProfile(**row)` call site in the backend.
"""
import pytest

from app.models.user import UserProfile, coerce_profile_row

_MINIMAL_ROW = {
    "id": "row-1",
    "user_id": "user-1",
    "name": "Diego",
}


class TestCoerceProfileRow:
    def test_fills_in_moderate_when_risk_tolerance_is_none(self):
        row = {**_MINIMAL_ROW, "risk_tolerance": None}
        coerced = coerce_profile_row(row)
        assert coerced["risk_tolerance"] == "moderate"

    def test_fills_in_moderate_when_risk_tolerance_key_is_missing_entirely(self):
        row = dict(_MINIMAL_ROW)
        assert "risk_tolerance" not in row
        coerced = coerce_profile_row(row)
        assert coerced["risk_tolerance"] == "moderate"

    def test_never_overwrites_a_real_risk_tolerance_value(self):
        row = {**_MINIMAL_ROW, "risk_tolerance": "aggressive"}
        coerced = coerce_profile_row(row)
        assert coerced["risk_tolerance"] == "aggressive"

    def test_does_not_mutate_the_original_dict(self):
        row = {**_MINIMAL_ROW, "risk_tolerance": None}
        coerce_profile_row(row)
        assert row["risk_tolerance"] is None  # original untouched

    def test_leaves_every_other_field_untouched(self):
        row = {**_MINIMAL_ROW, "risk_tolerance": None, "country": "MX", "subscription_tier": "premium"}
        coerced = coerce_profile_row(row)
        assert coerced["country"] == "MX"
        assert coerced["subscription_tier"] == "premium"


class TestUserProfileConstructionReproducesTheRealBugThenFixesIt:
    def test_raw_construction_with_null_risk_tolerance_crashes_without_the_fix(self):
        # Proves the bug is real: constructing UserProfile directly from a
        # row shaped exactly like what Supabase returns for a freshly
        # onboarded user (risk_tolerance never collected, column default
        # not applied) raises — this is the exact unguarded call FastAPI
        # was turning into "Internal server error."
        row = {**_MINIMAL_ROW, "risk_tolerance": None}
        with pytest.raises(Exception):
            UserProfile(**row)

    def test_construction_succeeds_once_the_row_is_coerced(self):
        row = {**_MINIMAL_ROW, "risk_tolerance": None}
        profile = UserProfile(**coerce_profile_row(row))
        assert profile.risk_tolerance == "moderate"
        assert profile.name == "Diego"


class TestProfileRouteHelperDegradesInsteadOfCrashing:
    async def test_to_user_profile_succeeds_on_the_exact_onboarding_row_shape(self):
        from app.api.routes.profile import _to_user_profile

        # Exactly what create_profile's insert branch produces for the
        # shortened onboarding payload shown in the bug report: name,
        # birth_date, terms fields, phone, investment_goal,
        # market_perception — no risk_tolerance.
        row = {
            "id": "row-1", "user_id": "user-1", "name": "Diego",
            "birth_date": "1990-01-01", "terms_accepted_at": "2026-08-16T00:00:00Z",
            "terms_version": "2026-06", "phone_number": "+525512345678",
            "investment_goal": "retirement", "market_perception": ["other"],
            "market_perception_other": "no sé", "has_broker": None, "has_investments": None,
            "risk_tolerance": None, "trial_started_at": "2026-08-16T00:00:00Z",
            "created_at": "2026-08-16T00:00:00Z", "updated_at": "2026-08-16T00:00:00Z",
        }
        profile = _to_user_profile(row)
        assert profile.risk_tolerance == "moderate"
        assert profile.name == "Diego"
