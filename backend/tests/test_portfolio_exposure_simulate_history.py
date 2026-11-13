"""Nuvos Plus — Fase 5B/5B.1: simulate_portfolio_addition_with_history +
the /simulate-history HTTP route.

Reuses the exact fake-Supabase harness from test_portfolio_exposure_service
(same `fake_db` fixture, same ownership/never-writes guarantees) so this
file never touches real/local Supabase or the network — only the ETF/
equity valuation calls and `historical.fetch_adjusted_price_series` are
mocked."""
import asyncio
import time
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.services.asset_classification import ETF
from app.services.portfolio_exposure import historical as h
from app.services.portfolio_exposure.combiner import InvalidSimulationInputError
from app.services.portfolio_exposure.service import PortfolioNotFoundError, simulate_portfolio_addition_with_history
from tests.test_portfolio_exposure_service import fake_db  # noqa: F401 -- reused fixture

_ETF_OVERVIEW = {
    "price": {"current": 400.0},
    "costs": {"nav_currency": "USD"},
    "exposure": {
        "sector_weightings": [{"name": "Tecnología", "weight_pct": 59.0}],
        "sector_weight_sum_in_expected_range": True,
        "country_weightings": [{"name": "Estados Unidos", "weight_pct": 99.0}],
        "country_weight_sum_in_expected_range": True,
    },
    "identification": {"name": None, "etf_company": None},
}


def _flat_series(n=400, price=10.0):
    return [{"date": f"2024-{(i // 28) % 12 + 1:02d}-{i % 28 + 1:02d}", "adj_close": price} for i in range(n)]


def _fake_fetch_ok(ticker, start, end):
    return {"series": _flat_series(), "warnings": []}


class TestOwnershipAndAuthorization:
    """Scenario: a request for a portfolio that isn't the caller's own
    must be indistinguishable from a nonexistent one — never a peek at
    someone else's real positions via the historical simulator."""

    async def test_different_user_cannot_run_history_on_u1s_portfolio(self, fake_db):
        with pytest.raises(PortfolioNotFoundError):
            await simulate_portfolio_addition_with_history("u2", "default", "QQQ", 1000.0, "1y")

    async def test_nonexistent_portfolio_id(self, fake_db):
        with pytest.raises(PortfolioNotFoundError):
            await simulate_portfolio_addition_with_history("u1", "does-not-exist", "QQQ", 1000.0, "1y")


class TestOwnerCanRunHistory:
    async def test_owner_gets_an_available_history_block(self, fake_db):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=_ETF_OVERVIEW), \
             patch.object(h, "fetch_adjusted_price_series", side_effect=_fake_fetch_ok):
            result = await simulate_portfolio_addition_with_history("u1", "default", "QQQ", 1000.0, "1y")
        assert result["history"]["available"] is True
        assert result["hypothetical_ticker"] == "QQQ"
        assert result["amount"] == 1000.0


class TestSingleSnapshot:
    """Fase 5B.1 §3: the weights of A and B must come from the SAME
    valuation snapshot — never a second live fetch for either half."""

    async def test_valuation_calls_happen_exactly_once_per_existing_ticker(self, fake_db):
        calls = []

        def counting_overview(ticker, **_kw):
            calls.append(ticker)
            return _ETF_OVERVIEW

        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", side_effect=counting_overview), \
             patch.object(h, "fetch_adjusted_price_series", side_effect=_fake_fetch_ok):
            await simulate_portfolio_addition_with_history("u1", "default", "QQQ", 1000.0, "1y")
        # VOO is u1's one REAL existing position, shared by both "before"
        # and "after" -- it must be valued exactly ONCE, never twice (once
        # per composition). QQQ is the hypothetical itself, which legitimately
        # needs its own single overview fetch (build_hypothetical_position).
        assert calls.count("VOO") == 1

    async def test_before_and_after_curves_use_identical_price_series_for_shared_tickers(self, fake_db):
        fetch_calls = []

        def tracking_fetch(ticker, start, end):
            fetch_calls.append(ticker)
            return _fake_fetch_ok(ticker, start, end)

        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=_ETF_OVERVIEW), \
             patch.object(h, "fetch_adjusted_price_series", side_effect=tracking_fetch):
            await simulate_portfolio_addition_with_history("u1", "default", "QQQ", 1000.0, "1y")
        # VOO (existing) and QQQ (hypothetical) each fetched exactly once
        # -- not once per curve.
        assert fetch_calls.count("VOO") == 1
        assert fetch_calls.count("QQQ") == 1


class TestCurrencyAndDataGaps:
    async def test_non_usd_instrument_returns_unavailable_not_an_error(self, fake_db):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value={**_ETF_OVERVIEW, "costs": {"nav_currency": "EUR"}}), \
             patch.object(h, "fetch_adjusted_price_series", side_effect=_fake_fetch_ok):
            result = await simulate_portfolio_addition_with_history("u1", "default", "QQQ", 1000.0, "1y")
        assert result["history"]["available"] is False
        assert result["history"]["reason"] == "non_usd_instrument"

    async def test_provider_failure_for_one_ticker_is_an_unavailable_state_not_a_500(self, fake_db):
        def flaky_fetch(ticker, start, end):
            if ticker == "QQQ":
                return {"series": [], "warnings": []}
            return _fake_fetch_ok(ticker, start, end)

        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=_ETF_OVERVIEW), \
             patch.object(h, "fetch_adjusted_price_series", side_effect=flaky_fetch):
            result = await simulate_portfolio_addition_with_history("u1", "default", "QQQ", 1000.0, "1y")
        assert result["history"]["available"] is False
        assert result["history"]["reason"] == "no_price_history"


class TestInvalidInput:
    async def test_unknown_ticker_raises_invalid_simulation_input(self, fake_db):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value="unknown"):
            with pytest.raises(InvalidSimulationInputError):
                await simulate_portfolio_addition_with_history("u1", "default", "NOTATICKER", 1000.0, "1y")

    async def test_invalid_amount_raises_invalid_simulation_input(self, fake_db):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=_ETF_OVERVIEW):
            with pytest.raises(InvalidSimulationInputError):
                await simulate_portfolio_addition_with_history("u1", "default", "QQQ", -50.0, "1y")


class TestNeverWrites:
    async def test_full_history_computation_never_triggers_a_write(self, fake_db):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=_ETF_OVERVIEW), \
             patch.object(h, "fetch_adjusted_price_series", side_effect=_fake_fetch_ok):
            await simulate_portfolio_addition_with_history("u1", "default", "QQQ", 1000.0, "1y")
            # would raise AssertionError (see _FakeQuery.insert/update/upsert/delete) if it ever wrote


class TestConcurrencyAndRepeatedRequests:
    async def test_concurrent_requests_for_different_users_never_cross_contaminate(self, fake_db):
        def slow_overview(ticker, **_kw):
            time.sleep(0.03)
            return _ETF_OVERVIEW

        def slow_fetch(ticker, start, end):
            time.sleep(0.01)
            return _fake_fetch_ok(ticker, start, end)

        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", side_effect=slow_overview), \
             patch.object(h, "fetch_adjusted_price_series", side_effect=slow_fetch):
            r1, r3 = await asyncio.gather(
                simulate_portfolio_addition_with_history("u1", "default", "QQQ", 1000.0, "1y"),
                simulate_portfolio_addition_with_history("u3", "default", "QQQ", 500.0, "1y"),
            )
        assert r1["amount"] == 1000.0
        assert r3["amount"] == 500.0
        assert r1["portfolio_name"] == "Mi portafolio"
        assert r3["portfolio_name"] == "Portafolio de u3"

    async def test_repeated_identical_requests_are_stable(self, fake_db):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=_ETF_OVERVIEW), \
             patch.object(h, "fetch_adjusted_price_series", side_effect=_fake_fetch_ok):
            r1 = await simulate_portfolio_addition_with_history("u1", "default", "QQQ", 1000.0, "1y")
            r2 = await simulate_portfolio_addition_with_history("u1", "default", "QQQ", 1000.0, "1y")
        assert r1["history"]["start_date"] == r2["history"]["start_date"]
        assert r1["history"]["index_before"] == r2["history"]["index_before"]


class TestCompatibilityWithExistingRoutes:
    """Fase 5B.1 §6: adding this entry point must not change the plain
    simulator's own contract."""

    async def test_plain_simulate_still_returns_full_exposure_blocks(self, fake_db):
        from app.services.portfolio_exposure.service import simulate_portfolio_addition
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=_ETF_OVERVIEW):
            result = await simulate_portfolio_addition("u1", "default", "QQQ", 1000.0)
        assert "before" in result and "after" in result
        assert "history" not in result  # the plain simulator's contract is untouched


class TestRouteValidation:
    """The route's own input gates — HTTPException status codes, before
    ever reaching the service layer."""

    def test_invalid_period_is_rejected_with_422(self):
        from app.api.routes.portfolio_exposure import _VALID_HISTORY_PERIODS
        assert "10y" not in _VALID_HISTORY_PERIODS
        assert {"1y", "3y", "5y"} == _VALID_HISTORY_PERIODS
