"""
Stage F (onboarding 2.0 integration, 2026-11): age/consent validation for
NEW profiles, prepared with tests but OFF by default
(settings.enforce_onboarding_eligibility) — Diego asked for the mechanism
to exist, not to go live without a separate review of the acceptance
mechanism and eligibility policy. See create_profile's new-profile branch
in app/api/routes/profile.py for where this is actually wired in.

Pure logic only — no DB, no network. Safe to run in any environment.
"""
from datetime import datetime, timedelta, timezone

from app.api.routes.profile import _is_valid_adult_birth_date, _CURRENT_TERMS_VERSION


def _birth_date_for_age(years: float) -> str:
    dt = datetime.now(timezone.utc) - timedelta(days=years * 365.25)
    return dt.strftime("%Y-%m-%d")


class TestIsValidAdultBirthDate:
    def test_rejects_none(self):
        assert _is_valid_adult_birth_date(None) is False

    def test_rejects_empty_string(self):
        assert _is_valid_adult_birth_date("") is False

    def test_rejects_garbage(self):
        assert _is_valid_adult_birth_date("not-a-date") is False

    def test_rejects_wrong_format(self):
        assert _is_valid_adult_birth_date("01/01/2000") is False

    def test_rejects_someone_17_years_old(self):
        assert _is_valid_adult_birth_date(_birth_date_for_age(17)) is False

    def test_accepts_someone_exactly_18(self):
        # A day past the boundary, not exactly on it — avoids a flaky
        # same-second edge case at the 18-year threshold itself.
        assert _is_valid_adult_birth_date(_birth_date_for_age(18.01)) is True

    def test_accepts_someone_40_years_old(self):
        assert _is_valid_adult_birth_date(_birth_date_for_age(40)) is True

    def test_rejects_someone_121_years_old(self):
        assert _is_valid_adult_birth_date(_birth_date_for_age(121)) is False

    def test_rejects_a_future_date(self):
        future = (datetime.now(timezone.utc) + timedelta(days=365)).strftime("%Y-%m-%d")
        assert _is_valid_adult_birth_date(future) is False


class TestCurrentTermsVersionPolicy:
    def test_current_version_is_not_any_historical_client_value(self):
        # The whole point: turning the flag on must not silently grandfather
        # in whatever string a client already happens to send today.
        historical_values = {"2026-06", "2026-11-quick", "2026-11-quick-mobile"}
        assert _CURRENT_TERMS_VERSION not in historical_values
