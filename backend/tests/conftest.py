"""
Shared pytest fixtures.

Autouse patch for `analyst_estimates_service.get_analyst_estimates`:
unlike every other network-touching function `get_fundamental_analysis()`
calls (Finnhub/FMP, all gated behind FMP_API_KEY/FINNHUB_API_KEY — empty in
this environment, so they fail fast), this one wraps yfinance directly,
which needs no key and therefore attempts a REAL, slow network call in any
test that doesn't already patch it. Found via the Nuvos AI Fair Value
Engine redesign, Incremento 6: several integration test files that
predate that increment (test_moat_integration.py, test_quality_
integration.py, test_valuation_engine_integration.py, ...) call
get_fundamental_analysis() end-to-end without patching this function —
without this fixture they'd all silently start doing real network I/O
(confirmed: the full suite hung well past 120s until this was added).
Individual tests that want to exercise the real analyst-estimates wiring
can still override this via their own explicit `patch(...)` — this
fixture only supplies the default.
"""
from unittest.mock import patch

import pytest

from app.core.config import PRODUCTION_SUPABASE_PROJECT_REF, settings


def pytest_configure(config):
    """Refuse to even collect tests if SUPABASE_URL resolves to the known
    production project. Nuvos ETF Phase 0 (2026-11) found that local dev and
    production previously shared one Supabase project with no isolation —
    this guard makes that mistake impossible to repeat even if a future
    .env file accidentally points back at production. Checks the resolved
    `settings.supabase_url` (not a raw os.getenv) so it still catches the
    case where SUPABASE_URL only lives in a dotenv file, not the shell."""
    if PRODUCTION_SUPABASE_PROJECT_REF in settings.supabase_url:
        raise RuntimeError(
            "Refusing to run tests: SUPABASE_URL points at the production "
            f"project ({PRODUCTION_SUPABASE_PROJECT_REF}). Point ENV_FILE at "
            "an isolated dev project's .env before running tests."
        )


@pytest.fixture(autouse=True)
def _no_real_analyst_estimates_network_calls():
    with patch("app.services.analyst_estimates_service.get_analyst_estimates", return_value=None):
        yield
