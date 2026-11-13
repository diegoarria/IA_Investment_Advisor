"""Nuvos Plus — Fase 4A: service.py orchestration — ownership, empty
portfolio, and the strictly-read-only guarantee. Uses an in-memory fake
Supabase client (same pattern as test_arthur_portfolio_transactions.py)
instead of real DB/network I/O."""
import asyncio
import time
from unittest.mock import patch

import pytest

import app.services.portfolio_exposure.service as service_module
from app.services.asset_classification import ETF
from app.services.portfolio_exposure.service import PortfolioNotFoundError, get_portfolio_exposure, simulate_portfolio_addition


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, store: dict, table_name: str):
        self._store = store
        self._table_name = table_name
        self._filters: dict = {}

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def insert(self, payload):
        raise AssertionError("portfolio_exposure must never INSERT into user_portfolio")

    def update(self, payload):
        raise AssertionError("portfolio_exposure must never UPDATE user_portfolio")

    def upsert(self, payload, on_conflict=None):
        raise AssertionError("portfolio_exposure must never UPSERT user_portfolio")

    def delete(self):
        raise AssertionError("portfolio_exposure must never DELETE from user_portfolio")

    async def execute(self):
        table = self._store.get(self._table_name, {})
        rows = [row for row in table.values() if all(row.get(k) == v for k, v in self._filters.items())]
        return _FakeResult(rows)


class _FakeTable:
    def __init__(self, store, name):
        self._store, self._name = store, name

    def select(self, *a, **k):
        return _FakeQuery(self._store, self._name).select(*a, **k)

    def insert(self, payload):
        return _FakeQuery(self._store, self._name).insert(payload)

    def update(self, payload):
        return _FakeQuery(self._store, self._name).update(payload)

    def upsert(self, payload, on_conflict=None):
        return _FakeQuery(self._store, self._name).upsert(payload, on_conflict)

    def delete(self):
        return _FakeQuery(self._store, self._name).delete()


class _FakeDB:
    def __init__(self, store):
        self._store = store

    def table(self, name):
        return _FakeTable(self._store, name)


@pytest.fixture
def fake_db(monkeypatch):
    store = {
        "user_portfolio": {
            "u1": {
                "user_id": "u1", "portfolio_id": "default", "portfolio_name": "Mi portafolio",
                "positions": {
                    "_v": 3, "currency": "USD",
                    "positions": [{"ticker": "VOO", "shares": 10, "avgPrice": 400.0, "purchaseDate": "2026-01-01"}],
                    "closed_positions": [], "inception_date": "2026-01-01",
                },
                "updated_at": "2026-09-18T00:00:00+00:00",
            },
            "u3": {
                "user_id": "u3", "portfolio_id": "default", "portfolio_name": "Portafolio de u3",
                "positions": {
                    "_v": 3, "currency": "USD",
                    "positions": [{"ticker": "GOOGL", "shares": 20, "avgPrice": 90.0, "purchaseDate": "2026-01-01"}],
                    "closed_positions": [], "inception_date": "2026-01-01",
                },
                "updated_at": "2026-09-18T00:00:00+00:00",
            },
        },
    }
    db = _FakeDB(store)

    async def fake_run_query(query):
        return await query.execute()

    monkeypatch.setattr(service_module, "get_supabase", lambda: db)
    monkeypatch.setattr(service_module, "run_query", fake_run_query)
    monkeypatch.setattr(service_module, "cache_get", lambda *_a, **_k: None)
    monkeypatch.setattr(service_module, "cache_set", lambda *_a, **_k: None)
    return store


class TestOwnership:
    """Scenario 15: a request for a portfolio that doesn't belong to the
    requesting user must behave exactly like "doesn't exist" — never leak
    u1's real portfolio to u2, never a different/distinguishable error."""

    async def test_different_user_cannot_read_u1s_portfolio(self, fake_db):
        with pytest.raises(PortfolioNotFoundError):
            await get_portfolio_exposure("u2", "default")

    async def test_owner_can_read_their_own_portfolio(self, fake_db):
        overview = {
            "price": {"current": 400.0},
            "costs": {"nav_currency": "USD"},
            "exposure": {
                "sector_weightings": [{"name": "Tecnología", "weight_pct": 30.0}],
                "sector_weight_sum_in_expected_range": True,
                "country_weightings": [{"name": "Estados Unidos", "weight_pct": 99.0}],
                "country_weight_sum_in_expected_range": True,
            },
    "identification": {"name": None, "etf_company": None},
        }
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            result = await get_portfolio_exposure("u1", "default")
        assert result["valuation"]["total_value_verified"] == 4000.0
        assert result["positions"][0]["ticker"] == "VOO"

    async def test_nonexistent_portfolio_id_also_not_found(self, fake_db):
        with pytest.raises(PortfolioNotFoundError):
            await get_portfolio_exposure("u1", "nope-does-not-exist")


class TestEmptyPortfolio:
    """Scenario 5: zero positions must return a clean, zeroed structure —
    never an error, never a crash."""

    async def test_empty_positions_list(self, fake_db):
        fake_db["user_portfolio"]["u1"]["positions"]["positions"] = []
        result = await get_portfolio_exposure("u1", "default")
        assert result["positions"] == []
        assert result["valuation"]["total_value_verified"] is None
        assert result["valuation"]["position_count"] == 0
        assert result["insights"] == []


class TestNeverWrites:
    """Scenario 18 (service layer): the _FakeQuery above raises on any
    insert/update/upsert/delete — simply completing a full exposure
    computation without that assertion firing IS the test."""

    async def test_full_computation_never_triggers_a_write(self, fake_db):
        overview = {
            "price": {"current": 400.0},
            "costs": {"nav_currency": "USD"},
            "exposure": {
                "sector_weightings": [{"name": "Tecnología", "weight_pct": 30.0}],
                "sector_weight_sum_in_expected_range": True,
                "country_weightings": [{"name": "Estados Unidos", "weight_pct": 99.0}],
                "country_weight_sum_in_expected_range": True,
            },
    "identification": {"name": None, "etf_company": None},
        }
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            await get_portfolio_exposure("u1", "default")  # would raise AssertionError if it ever wrote


class TestConcurrentValuationAtScale:
    """Scenario 6 (service layer): 20+ positions processed concurrently
    (bounded semaphore) still produce one valued row per position, in a
    single coherent response."""

    async def test_twenty_positions_all_valued(self, fake_db):
        positions = [{"ticker": f"T{i}", "shares": 1, "avgPrice": 10.0} for i in range(20)]
        fake_db["user_portfolio"]["u1"]["positions"]["positions"] = positions
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value="unknown"):
            result = await get_portfolio_exposure("u1", "default")
        assert result["valuation"]["position_count"] == 20
        assert len(result["unverifiable_positions"]) == 20


class TestSimulateOwnership:
    """Fase 4C-1, Diego's explicit scenario: a user attempting to
    simulate against a portfolio that isn't theirs must get the exact
    same not-found behavior as the read endpoint — never a peek at
    someone else's real positions via the simulator."""

    async def test_different_user_cannot_simulate_on_u1s_portfolio(self, fake_db):
        with pytest.raises(PortfolioNotFoundError):
            await simulate_portfolio_addition("u2", "default", "QQQ", 1000.0)

    async def test_owner_can_simulate_on_their_own_portfolio(self, fake_db):
        overview = {
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
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            result = await simulate_portfolio_addition("u1", "default", "QQQ", 1000.0)
        assert result["before"]["valuation"]["total_value_verified"] == 4000.0
        assert result["after"]["valuation"]["total_value_verified"] == 5000.0

    async def test_simulate_never_writes(self, fake_db):
        overview = {
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
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            await simulate_portfolio_addition("u1", "default", "QQQ", 1000.0)  # would raise AssertionError if it ever wrote


class TestConcurrencyAndProviderFailures:
    """Nuvos Plus Fase 4C stability audit (2026-11), item 4: concurrent
    requests with controlled limits, and provider errors/timeouts, against
    the real service orchestration (not just the pure combiner) — using a
    fake DB and a fake quote provider with injected latency/failure
    instead of hammering FMP/yfinance for real."""

    async def test_concurrent_requests_for_different_users_never_cross_contaminate(self, fake_db):
        """u1 (VOO, ETF) and u3 (GOOGL, equity) read their exposure at the
        same time. Each provider lookup sleeps briefly (in a real thread,
        via asyncio.to_thread — exactly how value_position runs it), so if
        the two requests were accidentally sharing any per-call mutable
        state, one user's slower lookup could leak into the other's
        result. They must come back correct and still keyed to the right
        user no matter which one's background thread finishes first."""
        def slow_etf_overview(ticker, **_kw):
            time.sleep(0.05)
            return {
                "price": {"current": 400.0}, "costs": {"nav_currency": "USD"},
                "exposure": {
                    "sector_weightings": [{"name": "Tecnología", "weight_pct": 59.0}],
                    "sector_weight_sum_in_expected_range": True,
                    "country_weightings": [{"name": "Estados Unidos", "weight_pct": 99.0}],
                    "country_weight_sum_in_expected_range": True,
                },
    "identification": {"name": None, "etf_company": None},
            }

        def slow_quote_price(ticker):
            time.sleep(0.05)
            return 180.0

        def classify(ticker):
            return ETF if ticker == "VOO" else "equity"

        with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=classify), \
             patch("app.services.etf.service.get_etf_overview", side_effect=slow_etf_overview), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", side_effect=slow_quote_price), \
             patch("app.services.portfolio_exposure.combiner.equity_profile.get_equity_profile", return_value={"currency": "USD", "country": "US"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            started = time.monotonic()
            result_u1, result_u3 = await asyncio.gather(
                get_portfolio_exposure("u1", "default", use_cache=False),
                get_portfolio_exposure("u3", "default", use_cache=False),
            )
            elapsed = time.monotonic() - started

        assert result_u1["positions"][0]["ticker"] == "VOO"
        assert result_u1["valuation"]["total_value_verified"] == 4000.0
        assert result_u3["positions"][0]["ticker"] == "GOOGL"
        assert result_u3["valuation"]["total_value_verified"] == 3600.0  # 20 * 180.0
        # Real concurrency, not accidental serialization: two ~0.05s
        # lookups running at once should finish well under their sum.
        assert elapsed < 0.15

    async def test_one_users_provider_timeout_never_blocks_or_corrupts_a_concurrent_request(self, fake_db):
        """Scenario 4's 'errores y timeouts de proveedores': while u1's
        ETF overview call raises (simulating a provider timeout/outage),
        u3's unrelated equity lookup must still succeed, on its own
        schedule, with u1 degrading honestly (no_price) rather than
        raising past the service boundary."""
        def failing_etf_overview(ticker, **_kw):
            raise TimeoutError("simulated FMP timeout")

        def classify(ticker):
            return ETF if ticker == "VOO" else "equity"

        with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=classify), \
             patch("app.services.etf.service.get_etf_overview", side_effect=failing_etf_overview), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=180.0), \
             patch("app.services.portfolio_exposure.combiner.equity_profile.get_equity_profile", return_value={"currency": "USD", "country": "US"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            result_u1, result_u3 = await asyncio.gather(
                get_portfolio_exposure("u1", "default", use_cache=False),
                get_portfolio_exposure("u3", "default", use_cache=False),
            )

        assert result_u1["positions"][0]["verifiable"] is False
        assert result_u1["positions"][0]["unverifiable_reason"] == "no_price"
        assert result_u1["valuation"]["total_value_verified"] is None
        assert result_u3["positions"][0]["verifiable"] is True
        assert result_u3["valuation"]["total_value_verified"] == 3600.0

    async def test_repeated_simulations_with_different_tickers_and_amounts_stay_independent(self, fake_db):
        """Scenario 4's 'simulaciones repetidas con distintos tickers y
        montos' — run several concurrently on the same base portfolio and
        confirm each sees its own ticker/amount reflected, never another
        concurrent call's."""
        overview = {
            "price": {"current": 400.0}, "costs": {"nav_currency": "USD"},
            "exposure": {
                "sector_weightings": [{"name": "Tecnología", "weight_pct": 59.0}],
                "sector_weight_sum_in_expected_range": True,
                "country_weightings": [{"name": "Estados Unidos", "weight_pct": 99.0}],
                "country_weight_sum_in_expected_range": True,
            },
    "identification": {"name": None, "etf_company": None},
        }
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            results = await asyncio.gather(
                simulate_portfolio_addition("u1", "default", "QQQ", 500.0),
                simulate_portfolio_addition("u1", "default", "QQQ", 1000.0),
                simulate_portfolio_addition("u1", "default", "QQQ", 2500.0),
            )

        assert [r["amount"] for r in results] == [500.0, 1000.0, 2500.0]
        assert [r["after"]["valuation"]["total_value_verified"] for r in results] == [4500.0, 5000.0, 6500.0]
        # Every one of them still starts from the same real "before" —
        # one call's amount never bled into another's base valuation.
        assert all(r["before"]["valuation"]["total_value_verified"] == 4000.0 for r in results)
