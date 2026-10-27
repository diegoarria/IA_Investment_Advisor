"""
Nuvos Radar backfill — 2026-10-27. The read-only structural audit found
company_valuation_service.py's backfill_universe() fully built but never
actually called against the 927-ticker UNIVERSE anywhere in the codebase,
which is why only 21/927 tickers carried a persisted valuation. This file
tests the pieces added to close that gap: pending-ticker classification
(get_pending_tickers), the backoff columns (migration 115), the circuit
breaker, and job_backfill_company_valuations_batch's dry-run/enabled/
locking/circuit-breaker gating in worker.py.

Reuses the same _FakeDB/_FakeTable/_FakeRpc infra as
test_company_valuation_service.py (imported, not duplicated) so these
tests exercise the real set_current_company_valuation-equivalent
invariants, not a second, looser mock.
"""
import asyncio
import uuid

import app.services.company_valuation_service as cvs
from tests.test_company_valuation_service import _FakeDB, _current_rows


def _run(coro):
    return asyncio.run(coro)


def _clear_cache():
    import app.core.cache as cache_mod
    cache_mod._mem.clear()


class TestGetPendingTickers:
    def test_classifies_no_valuation_and_already_valid(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "AAPL", "validation_status": "valid",
            "model_version": cvs.MODEL_VERSION, "next_retry_at": None, "is_current": True,
        })
        buckets = _run(cvs.get_pending_tickers(["AAPL", "XYZ"]))
        assert buckets["already_valid"] == ["AAPL"]
        assert buckets["no_valuation"] == ["XYZ"]
        assert buckets["retry_eligible"] == []
        assert buckets["backing_off"] == []
        assert buckets["stale"] == []

    def test_classifies_stale_by_model_version(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "MSFT", "validation_status": "valid",
            "model_version": "v0-ancient", "next_retry_at": None, "is_current": True,
        })
        buckets = _run(cvs.get_pending_tickers(["MSFT"]))
        assert buckets["stale"] == ["MSFT"]
        assert buckets["already_valid"] == []

    def test_failed_row_due_for_retry_is_retry_eligible(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "GEV", "validation_status": "failed",
            "model_version": cvs.MODEL_VERSION, "next_retry_at": "2000-01-01T00:00:00+00:00",
            "is_current": True,
        })
        buckets = _run(cvs.get_pending_tickers(["GEV"]))
        assert buckets["retry_eligible"] == ["GEV"]

    def test_failed_row_inside_backoff_window_is_backing_off(self, monkeypatch):
        from datetime import datetime, timedelta, timezone
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        far_future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "CLS", "validation_status": "insufficient_data",
            "model_version": cvs.MODEL_VERSION, "next_retry_at": far_future, "is_current": True,
        })
        buckets = _run(cvs.get_pending_tickers(["CLS"]))
        assert buckets["backing_off"] == ["CLS"]
        assert buckets["retry_eligible"] == []

    def test_only_queries_is_current_rows_not_history(self, monkeypatch):
        """A ticker with old `is_current=False` failure history but no
        current row at all must still be classified no_valuation — the
        job must never think a ticker is "covered" because of stale
        history rows."""
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "SEZL", "validation_status": "failed",
            "model_version": cvs.MODEL_VERSION, "next_retry_at": None, "is_current": False,
        })
        buckets = _run(cvs.get_pending_tickers(["SEZL"]))
        assert buckets["no_valuation"] == ["SEZL"]


class TestBackoffTracking:
    def test_failed_result_sets_attempt_count_and_future_retry(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        row = _run(cvs.persist_valuation("IREN", {"validation_status": "failed", "error_detail": "timeout"}, prior_attempt_count=0))
        assert row["attempt_count"] == 1
        assert row["next_retry_at"] is not None

    def test_repeated_failures_increase_attempt_count(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        row1 = _run(cvs.persist_valuation("BE", {"validation_status": "failed", "error_detail": "e1"}, prior_attempt_count=0))
        row2 = _run(cvs.persist_valuation("BE", {"validation_status": "failed", "error_detail": "e2"}, prior_attempt_count=row1["attempt_count"]))
        assert row2["attempt_count"] == 2

    def test_backoff_grows_with_attempt_count(self):
        from datetime import datetime, timezone
        _, retry_0 = cvs._compute_backoff(0)
        _, retry_5 = cvs._compute_backoff(5)
        now = datetime.now(timezone.utc)
        minutes_0 = (datetime.fromisoformat(retry_0) - now).total_seconds() / 60
        minutes_5 = (datetime.fromisoformat(retry_5) - now).total_seconds() / 60
        assert minutes_5 > minutes_0, "a ticket that has failed 5 times must wait longer than one failing for the first time"

    def test_backoff_is_capped(self):
        _, retry = cvs._compute_backoff(50)  # would be astronomically large uncapped
        from datetime import datetime, timezone
        minutes = (datetime.fromisoformat(retry) - datetime.now(timezone.utc)).total_seconds() / 60
        assert minutes <= cvs._BACKOFF_CAP_MINUTES * (1 + cvs._BACKOFF_JITTER_PCT) + 1

    def test_valid_result_resets_backoff_to_zero(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        row = _run(cvs.persist_valuation("LITE", {
            "validation_status": "valid", "intrinsic_value_usd": 50.0, "currency": "USD",
            "methodology": "gqv", "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q3",
            "assumptions": {},
        }, prior_attempt_count=4))
        assert row["attempt_count"] == 0
        assert row["next_retry_at"] is None

    def test_a_failed_result_never_overwrites_an_existing_valid_current_row(self, monkeypatch):
        """Application-level restatement of migration 114's own DB CHECK
        (NOT (validation_status='failed' AND is_current)) — persist_valuation
        must insert the failure as plain history and leave the valid row
        exactly as it was, backoff columns included."""
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        good = _run(cvs.persist_valuation("IONQ", {
            "validation_status": "valid", "intrinsic_value_usd": 42.0, "currency": "USD",
            "methodology": "gqv", "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q2",
            "assumptions": {},
        }))
        _run(cvs.persist_valuation("IONQ", {"validation_status": "failed", "error_detail": "provider down"}, prior_attempt_count=0))

        current = _current_rows(db, "IONQ")
        assert len(current) == 1
        assert current[0]["validation_status"] == "valid"
        assert current[0]["intrinsic_value_usd"] == 42.0
        assert current[0]["id"] == good["id"], "the original valid row's identity must be untouched by the failed attempt"


class TestCircuitBreaker:
    def test_closed_by_default(self):
        _clear_cache()
        assert cvs.circuit_is_open() is False

    def test_opens_after_failure_rate_threshold_in_window(self):
        _clear_cache()
        # 8 is _CIRCUIT_MIN_SAMPLE; 5/8 > 0.5 threshold.
        for _ in range(5):
            cvs.record_backfill_outcome("failed")
        for _ in range(3):
            cvs.record_backfill_outcome("valid")
        assert cvs.circuit_is_open() is True

    def test_stays_closed_below_min_sample_even_at_100pct_failure(self):
        _clear_cache()
        for _ in range(3):  # below _CIRCUIT_MIN_SAMPLE (8)
            cvs.record_backfill_outcome("failed")
        assert cvs.circuit_is_open() is False

    def test_stays_closed_when_failure_rate_is_low(self):
        _clear_cache()
        for _ in range(1):
            cvs.record_backfill_outcome("failed")
        for _ in range(9):
            cvs.record_backfill_outcome("valid")
        assert cvs.circuit_is_open() is False

    def test_backfill_universe_stops_issuing_new_attempts_once_open(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()

        attempted = []

        def fake_compute(ticker):
            attempted.append(ticker)
            return {"validation_status": "failed", "error_detail": "provider down"}

        monkeypatch.setattr(cvs, "compute_numeric_valuation", fake_compute)
        import app.api.routes.screener as screener_mod
        monkeypatch.setattr(screener_mod, "_latest_reported_earnings_period", lambda t: "2026-Q3")

        universe = [f"T{i}" for i in range(20)]
        result = _run(cvs.backfill_universe(universe, max_tickers_per_minute=100000))

        # The breaker must have tripped partway through (8 failures hits
        # the min-sample threshold at 100% failure rate) and the function
        # must stop making new attempts for the remainder of the list.
        assert len(attempted) < len(universe), "must stop early once the circuit breaker trips, not grind through all 20"
        assert result["circuit_breaker_skipped"] > 0
        assert len(attempted) + result["failed"] + result["circuit_breaker_skipped"] >= len(universe) - 1


class TestBackfillJobGating:
    """job_backfill_company_valuations_batch (worker.py) — env-var gating,
    dry-run safety, and locking. Imports `worker` directly, same pattern
    as tests/test_prewarm_market_hours_gate.py."""

    def test_disabled_by_default_makes_no_calls(self, monkeypatch):
        import worker
        monkeypatch.delenv("BACKFILL_ENABLED", raising=False)
        monkeypatch.delenv("BACKFILL_DRY_RUN", raising=False)

        called = []
        monkeypatch.setattr(
            "app.services.company_valuation_service.get_pending_tickers",
            lambda *a, **k: called.append("get_pending_tickers") or {},
        )
        _run(worker.job_backfill_company_valuations_batch())
        assert called == [], "with both env vars unset, the job must return immediately without touching the DB"

    def test_dry_run_computes_buckets_but_makes_no_writes_or_external_calls(self, monkeypatch):
        import worker
        monkeypatch.setenv("BACKFILL_DRY_RUN", "true")
        monkeypatch.delenv("BACKFILL_ENABLED", raising=False)

        async def fake_pending(tickers):
            return {
                "no_valuation": ["AAA"], "retry_eligible": [], "backing_off": [],
                "stale": [], "already_valid": [],
            }

        backfill_called = []
        monkeypatch.setattr("app.services.company_valuation_service.get_pending_tickers", fake_pending)
        monkeypatch.setattr(
            "app.services.company_valuation_service.backfill_universe",
            lambda *a, **k: backfill_called.append(1),
        )
        _run(worker.job_backfill_company_valuations_batch())
        assert backfill_called == [], "BACKFILL_DRY_RUN must never call backfill_universe (zero external calls, zero writes)"

    def test_enabled_run_respects_open_circuit_breaker(self, monkeypatch):
        import worker
        monkeypatch.setenv("BACKFILL_ENABLED", "true")
        monkeypatch.delenv("BACKFILL_DRY_RUN", raising=False)

        async def fake_pending(tickers):
            return {"no_valuation": ["AAA"], "retry_eligible": [], "backing_off": [], "stale": [], "already_valid": []}

        backfill_called = []
        monkeypatch.setattr("app.services.company_valuation_service.get_pending_tickers", fake_pending)
        monkeypatch.setattr("app.services.company_valuation_service.circuit_is_open", lambda: True)
        monkeypatch.setattr(
            "app.services.company_valuation_service.backfill_universe",
            lambda *a, **k: backfill_called.append(1),
        )
        _run(worker.job_backfill_company_valuations_batch())
        assert backfill_called == [], "an open circuit breaker must prevent the job from starting new work this tick"

    def test_enabled_run_with_nothing_pending_is_a_noop(self, monkeypatch):
        import worker
        monkeypatch.setenv("BACKFILL_ENABLED", "true")
        monkeypatch.delenv("BACKFILL_DRY_RUN", raising=False)

        async def fake_pending(tickers):
            return {"no_valuation": [], "retry_eligible": [], "backing_off": [], "stale": [], "already_valid": ["AAA"]}

        backfill_called = []
        monkeypatch.setattr("app.services.company_valuation_service.get_pending_tickers", fake_pending)
        monkeypatch.setattr(
            "app.services.company_valuation_service.backfill_universe",
            lambda *a, **k: backfill_called.append(1),
        )
        _run(worker.job_backfill_company_valuations_batch())
        assert backfill_called == []

    def test_allowlist_excludes_everything_not_listed(self, monkeypatch):
        """2026-10-27 pilot: BACKFILL_TICKER_ALLOWLIST must restrict
        classification itself, not just deprioritize — a ticker outside
        the list must never even be passed to get_pending_tickers."""
        import worker
        monkeypatch.setenv("BACKFILL_DRY_RUN", "true")
        monkeypatch.delenv("BACKFILL_ENABLED", raising=False)
        monkeypatch.setenv("BACKFILL_TICKER_ALLOWLIST", "APP,ROST,ADM")

        seen_tickers = []

        async def fake_pending(tickers):
            seen_tickers.extend(tickers)
            return {"no_valuation": list(tickers), "retry_eligible": [], "backing_off": [], "stale": [], "already_valid": []}

        monkeypatch.setattr("app.services.company_valuation_service.get_pending_tickers", fake_pending)
        _run(worker.job_backfill_company_valuations_batch())
        assert set(seen_tickers) == {"APP", "ROST", "ADM"}, (
            f"allowlist must categorically exclude every other ticker, got {seen_tickers}"
        )

    def test_concurrent_tick_is_skipped_via_lock(self, monkeypatch):
        import worker
        import app.core.cache as cache_mod
        _clear_cache()
        monkeypatch.setenv("BACKFILL_ENABLED", "true")
        monkeypatch.delenv("BACKFILL_DRY_RUN", raising=False)

        async def fake_pending(tickers):
            return {"no_valuation": ["AAA"], "retry_eligible": [], "backing_off": [], "stale": [], "already_valid": []}

        monkeypatch.setattr("app.services.company_valuation_service.get_pending_tickers", fake_pending)
        monkeypatch.setattr("app.services.company_valuation_service.circuit_is_open", lambda: False)

        async def slow_backfill(*a, **k):
            # Hold the lock long enough that a second tick, fired while
            # this one is "in flight", observes it still held.
            return {"valid": 1}

        monkeypatch.setattr("app.services.company_valuation_service.backfill_universe", slow_backfill)

        # Pre-acquire the lock exactly as a real in-flight tick would hold it.
        token = worker.acquire_lock(worker._BACKFILL_LOCK_KEY, ttl=60) if hasattr(worker, "acquire_lock") else None
        from app.core.cache import acquire_lock as _acquire_lock, release_lock as _release_lock
        held_token = _acquire_lock(worker._BACKFILL_LOCK_KEY, ttl=60)
        assert held_token is not None

        calls = []
        monkeypatch.setattr("app.services.company_valuation_service.backfill_universe", lambda *a, **k: calls.append(1))
        _run(worker.job_backfill_company_valuations_batch())
        assert calls == [], "a concurrent tick must be skipped while the lock is already held"
        _release_lock(worker._BACKFILL_LOCK_KEY, held_token)
