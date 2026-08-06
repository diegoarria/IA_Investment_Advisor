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


@pytest.fixture(autouse=True)
def _no_real_analyst_estimates_network_calls():
    with patch("app.services.analyst_estimates_service.get_analyst_estimates", return_value=None):
        yield
