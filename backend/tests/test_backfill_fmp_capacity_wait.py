"""
2026-11-10, FMP pressure fix — PASO 3: backfill_universe() must check real
FMP background headroom before starting EACH ticker, wait for the real
window to free up rather than firing straight into an already-near-
exhausted window, never block interactive traffic, respect a configurable
max wait, and allow safe cancellation mid-wait. These tests exercise the
orchestration loop in `backfill_universe` in isolation (monkeypatching
`refresh_if_needed` and the capacity check itself) — the budget module's
own behavior (the real counter, Redis reliability, context propagation)
is covered in test_fmp_budget.py.
"""
import asyncio

import app.services.company_valuation_service as cvs


def _run(coro):
    return asyncio.run(coro)


async def _fake_refresh_ok(ticker, full_snapshot=False):
    return {"validation_status": "valid", "_backfill_attempted": True}


def test_backfill_proceeds_immediately_when_capacity_is_available(monkeypatch):
    calls = []

    async def _fake_wait(min_margin=5, max_wait_s=90.0, cancel_check=None):
        calls.append((min_margin, max_wait_s))
        return True

    monkeypatch.setattr(cvs, "_wait_for_fmp_background_capacity", _fake_wait)
    monkeypatch.setattr(cvs, "refresh_if_needed", _fake_refresh_ok)
    monkeypatch.setattr(cvs, "circuit_is_open", lambda: False)
    monkeypatch.setattr(cvs, "record_backfill_outcome", lambda status: None)

    results = _run(cvs.backfill_universe(["AAPL", "MSFT"], max_tickers_per_minute=600.0))

    assert results["valid"] == 2
    assert results["fmp_budget_stopped"] == 0
    assert len(calls) == 2, "capacity must be checked before EVERY ticker, not just once"


def test_backfill_stops_the_rest_of_the_batch_when_capacity_never_frees_up(monkeypatch):
    """If the real window never frees up within the max wait, the batch
    must stop (not silently skip just one ticker and keep going blind
    into the next) — remaining tickers are reported as fmp_budget_stopped,
    not attempted."""
    attempted = []

    async def _fake_refresh_tracks(ticker, full_snapshot=False):
        attempted.append(ticker)
        return {"validation_status": "valid", "_backfill_attempted": True}

    async def _fake_wait(min_margin=5, max_wait_s=90.0, cancel_check=None):
        # First ticker gets capacity, second does not.
        return len(attempted) == 0

    monkeypatch.setattr(cvs, "_wait_for_fmp_background_capacity", _fake_wait)
    monkeypatch.setattr(cvs, "refresh_if_needed", _fake_refresh_tracks)
    monkeypatch.setattr(cvs, "circuit_is_open", lambda: False)
    monkeypatch.setattr(cvs, "record_backfill_outcome", lambda status: None)

    results = _run(cvs.backfill_universe(["AAPL", "MSFT", "GOOGL"], max_tickers_per_minute=600.0))

    assert attempted == ["AAPL"], "only the ticker that actually got capacity should have been attempted"
    assert results["valid"] == 1
    assert results["fmp_budget_stopped"] == 2, "the remaining 2 tickers must be reported, not silently dropped"


def test_cancel_check_is_forwarded_to_the_capacity_wait(monkeypatch):
    """A batch's own cancellation signal must reach the capacity-wait
    loop, not just gate the outer per-ticker loop — otherwise a batch
    "cancelled" mid-wait would still block until max_wait_s."""
    seen_cancel_checks = []

    async def _fake_wait(min_margin=5, max_wait_s=90.0, cancel_check=None):
        seen_cancel_checks.append(cancel_check)
        return True

    monkeypatch.setattr(cvs, "_wait_for_fmp_background_capacity", _fake_wait)
    monkeypatch.setattr(cvs, "refresh_if_needed", _fake_refresh_ok)
    monkeypatch.setattr(cvs, "circuit_is_open", lambda: False)
    monkeypatch.setattr(cvs, "record_backfill_outcome", lambda status: None)

    sentinel = lambda: False
    _run(cvs.backfill_universe(["AAPL"], max_tickers_per_minute=600.0, cancel_check=sentinel))

    assert seen_cancel_checks == [sentinel]


def test_fmp_capacity_margin_and_max_wait_are_configurable_per_call(monkeypatch):
    seen = []

    async def _fake_wait(min_margin=5, max_wait_s=90.0, cancel_check=None):
        seen.append((min_margin, max_wait_s))
        return True

    monkeypatch.setattr(cvs, "_wait_for_fmp_background_capacity", _fake_wait)
    monkeypatch.setattr(cvs, "refresh_if_needed", _fake_refresh_ok)
    monkeypatch.setattr(cvs, "circuit_is_open", lambda: False)
    monkeypatch.setattr(cvs, "record_backfill_outcome", lambda status: None)

    _run(cvs.backfill_universe(
        ["AAPL"], max_tickers_per_minute=600.0, fmp_capacity_margin=20, fmp_capacity_max_wait_s=15.0,
    ))

    assert seen == [(20, 15.0)]


# ── _wait_for_fmp_background_capacity itself (real budget module, no mocks
#    beyond a fake Redis so results are deterministic regardless of this
#    machine's real Redis availability) ──────────────────────────────────

class _FakeRedis:
    def __init__(self):
        self._store: dict[str, str] = {}

    def get(self, key):
        return self._store.get(key)

    def setex(self, key, ttl, value):
        self._store[key] = value

    def delete(self, key):
        self._store.pop(key, None)

    def pipeline(self):
        return _FakePipeline(self)


class _FakePipeline:
    def __init__(self, redis):
        self._redis = redis
        self._ops = []

    def incr(self, key, amount=1):
        self._ops.append(("incr", key, amount))
        return self

    def expire(self, key, ttl, nx=False):
        self._ops.append(("expire", key, ttl))
        return self

    def execute(self):
        results = []
        for op, key, arg in self._ops:
            if op == "incr":
                current = int(self._redis._store.get(key) or 0) + arg
                self._redis._store[key] = str(current)
                results.append(current)
            else:
                results.append(True)
        self._ops.clear()
        return results


def _clear():
    import app.core.cache as cache_mod
    cache_mod._mem.clear()


def test_wait_returns_immediately_when_margin_already_available(monkeypatch):
    import app.core.cache as cache_mod

    _clear()
    monkeypatch.setattr(cache_mod, "_redis", _FakeRedis())
    assert _run(cvs._wait_for_fmp_background_capacity(min_margin=5, max_wait_s=5.0)) is True


def test_wait_times_out_and_returns_false_when_budget_stays_exhausted(monkeypatch):
    """Never waits forever — a bounded max_wait_s must be honored, and a
    still-exhausted window after that point must report False (stop the
    batch), not loop indefinitely."""
    async def _always_exhausted():
        return (0, True)

    import app.core.fmp_budget as fb
    monkeypatch.setattr(fb, "remaining_background_capacity", lambda: (0, True))

    import time as _time
    t0 = _time.monotonic()
    result = _run(cvs._wait_for_fmp_background_capacity(min_margin=5, max_wait_s=3.0))
    elapsed = _time.monotonic() - t0

    assert result is False
    assert elapsed < 6.0, "must not wait meaningfully longer than max_wait_s"


def test_wait_stops_immediately_when_cancel_check_fires(monkeypatch):
    import app.core.fmp_budget as fb
    monkeypatch.setattr(fb, "remaining_background_capacity", lambda: (0, True))

    import time as _time
    t0 = _time.monotonic()
    result = _run(cvs._wait_for_fmp_background_capacity(
        min_margin=5, max_wait_s=60.0, cancel_check=lambda: True,
    ))
    elapsed = _time.monotonic() - t0

    assert result is False
    assert elapsed < 5.0, "a fired cancel_check must stop the wait promptly, not block toward max_wait_s"


def test_wait_refuses_to_proceed_blind_when_redis_is_unreachable(monkeypatch):
    """PASO 3's explicit instruction: if the shared capacity can't be
    verified reliably, stop with an explicit cause instead of guessing."""
    import app.core.fmp_budget as fb
    monkeypatch.setattr(fb, "remaining_background_capacity", lambda: (999, False))

    result = _run(cvs._wait_for_fmp_background_capacity(min_margin=5, max_wait_s=10.0))
    assert result is False
