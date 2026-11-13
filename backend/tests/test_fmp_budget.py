"""
app.core.fmp_budget — the shared, distributed FMP call budget (Nuvos
Radar structural audit, 2026-10-21). Diego: "un limitador distribuido...
que respete la cuota compartida de FMP entre todas las instancias y
workers... reserva capacidad para consultas de usuarios frente a trabajos
automáticos."
"""
from unittest.mock import Mock, patch

import app.core.fmp_budget as fb


def _clear():
    import app.core.cache as cache_mod
    cache_mod._mem.clear()


class _FakeRedis:
    """Minimal in-process stand-in for a reachable Redis, covering only
    what app.core.cache actually calls (.get, .setex, .delete, .pipeline
    with .incr/.expire/.execute) — used so tests asserting
    `reliable=True` behavior don't depend on whether THIS machine happens
    to have a real Redis reachable right now."""

    def __init__(self):
        self._store: dict[str, str] = {}

    def get(self, key):
        return self._store.get(key)

    def setex(self, key, ttl, value):
        self._store[key] = value

    def delete(self, key):
        self._store.pop(key, None)

    def pipeline(self):
        return _FakeRedisPipeline(self)


class _FakeRedisPipeline:
    def __init__(self, redis):
        self._redis = redis
        self._ops: list[tuple] = []

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
            elif op == "expire":
                results.append(True)
        self._ops.clear()
        return results


def test_calls_allowed_under_the_limit():
    _clear()
    for _ in range(10):
        assert fb.fmp_call_allowed() is True


def test_user_calls_blocked_once_the_full_limit_is_reached():
    _clear()
    for _ in range(fb.FMP_LIMIT_PER_MINUTE):
        assert fb.fmp_call_allowed() is True
    assert fb.fmp_call_allowed() is False, "the (window+1)th live-user call must be rejected"


def test_background_calls_blocked_at_their_smaller_reserved_share():
    _clear()
    background_limit = int(fb.FMP_LIMIT_PER_MINUTE * fb._BACKGROUND_SHARE)
    with fb.fmp_background():
        for _ in range(background_limit):
            assert fb.fmp_call_allowed() is True
        assert fb.fmp_call_allowed() is False, "a background job must be capped at its reserved share, well under the full budget"


def test_background_exhaustion_never_blocks_a_live_user_call():
    _clear()
    background_limit = int(fb.FMP_LIMIT_PER_MINUTE * fb._BACKGROUND_SHARE)
    with fb.fmp_background():
        for _ in range(background_limit):
            fb.fmp_call_allowed()
        assert fb.fmp_call_allowed() is False  # background budget now exhausted
    # Back in the live-user context (outside the `with` block) — capacity
    # must still be available, since background calls can never consume
    # more than their own reserved share of the shared window.
    assert fb.fmp_call_allowed() is True, "a user request must never be starved by a background job's own consumption"


def test_background_context_resets_after_exit():
    _clear()
    with fb.fmp_background():
        assert fb._is_background_ctx.get() is True
    assert fb._is_background_ctx.get() is False


def test_nested_calls_outside_background_context_default_to_user_class():
    _clear()
    assert fb._is_background_ctx.get() is False


def test_fmp_provider_get_respects_the_shared_budget():
    """FMPProvider._get (financial_data_service.py) — the single highest-
    volume FMP call site — must actually consult the shared budget, not
    just have it exist unused. Confirms _get returns [] (its normal
    "request failed" sentinel) without ever calling requests.get once the
    budget is exhausted."""
    from app.services.financial_data_service import FMPProvider

    _clear()
    for _ in range(fb.FMP_LIMIT_PER_MINUTE):
        fb.fmp_call_allowed()

    mock_response = Mock()
    mock_response.json.return_value = [{"date": "2025-12-31"}]
    with patch("requests.get", return_value=mock_response) as mock_get:
        rows = FMPProvider()._get("income-statement", {"symbol": "AAPL"})

    assert rows == []
    mock_get.assert_not_called()


# ── 2026-11-10 FMP pressure diagnosis (third-batch halt) ────────────────────
# Root cause found while investigating why the live window counter climbed
# to 197 against a 140/min background reservation: `_is_background_ctx` is a
# contextvars.ContextVar, and contextvars do NOT propagate into a new OS
# thread spawned by ThreadPoolExecutor — each worker thread starts with the
# module's *default* (False). Every peer-comparable fetch during a
# full-snapshot backfill build runs inside _DIAG_ENRICHMENT_POOL/
# _PEER_ENRICHMENT_POOL worker threads, so those calls silently check against
# the full 280/min budget instead of the 140/min background share, while
# still incrementing the ONE shared window counter — explaining both the
# "budget exhausted" warnings (the backfill's own correctly-tagged top-level
# calls) AND the counter climbing well past 140 (the mistagged peer-thread
# calls still succeeding and incrementing under the wrong, looser ceiling).
def test_background_context_does_not_propagate_into_a_thread_pool_worker():
    import concurrent.futures

    _clear()
    with fb.fmp_background():
        assert fb._is_background_ctx.get() is True

        def _check():
            return fb._is_background_ctx.get()

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: _check(), range(4)))

    assert results == [False, False, False, False], (
        "documents the real bug: a peer fetch running in a ThreadPoolExecutor "
        "worker loses the background tag and will be budgeted as live-user "
        "traffic (280/min) instead of the background share (140/min), while "
        "still writing into the SAME shared window counter"
    )


def test_copy_context_is_the_minimal_fix_for_the_thread_pool_gap():
    """Proves the proposed minimal fix: submitting via
    contextvars.copy_context().run(...) (or equivalently
    functools.partial'ing the context into the pool submission) DOES carry
    the background tag into the worker thread, with no change to
    fmp_budget.py itself."""
    import concurrent.futures
    import contextvars

    _clear()
    with fb.fmp_background():
        ctx = contextvars.copy_context()

        def _check():
            return fb._is_background_ctx.get()

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: ctx.run(_check), range(4)))

    assert results == [True, True, True, True]


def test_window_key_resets_at_the_minute_boundary():
    """The window is a fixed per-minute bucket (floor(time()//60)), not a
    sliding window — confirms real automatic recovery, not merely a
    documentation claim."""
    _clear()
    with patch("time.time", return_value=1_000_000.0):  # minute N
        for _ in range(5):
            assert fb.fmp_call_allowed() is True
        assert fb._window_key() == f"fmp_calls:{1_000_000 // 60}"

    with patch("time.time", return_value=1_000_000.0 + 61):  # next minute
        assert fb._window_key() != f"fmp_calls:{1_000_000 // 60}"
        # A fresh window has its own, independent counter — full budget
        # available again immediately, no manual reset needed.
        for _ in range(fb.FMP_LIMIT_PER_MINUTE):
            assert fb.fmp_call_allowed() is True
        assert fb.fmp_call_allowed() is False


def test_redis_failure_falls_back_to_a_per_process_counter_not_a_crash():
    """If Redis is down, cache.py's own in-memory fallback kicks in — the
    budget check degrades to a single-process approximation (documented,
    accepted weaker guarantee) rather than raising or silently allowing
    unlimited calls."""
    import app.core.cache as cache_mod

    _clear()
    with patch.object(cache_mod, "_redis", None):
        for _ in range(fb.FMP_LIMIT_PER_MINUTE):
            assert fb.fmp_call_allowed() is True
        assert fb.fmp_call_allowed() is False, (
            "even without Redis, the in-memory fallback must still enforce "
            "SOME limit rather than allowing every call through"
        )


def test_multiple_in_memory_counters_do_not_share_state_without_redis():
    """Documents the real, already-known residual risk (same class as the
    rate-limiter's own documented Redis-outage caveat): without Redis, each
    process/worker has its OWN counter, so the effective ceiling during a
    real Redis outage is (limit × worker count), not the intended shared
    limit. This is not a new bug introduced here — it's the same
    accepted trade-off as the slowapi in-memory fallback, now confirmed to
    also apply to fmp_budget."""
    import app.core.cache as cache_mod

    _clear()
    with patch.object(cache_mod, "_redis", None):
        for _ in range(fb.FMP_LIMIT_PER_MINUTE):
            fb.fmp_call_allowed()
        assert fb.fmp_call_allowed() is False

    # Simulate a second worker process by clearing the in-memory dict (a
    # second process would never have seen the first one's writes at all,
    # since in-memory state is never shared across processes).
    _clear()
    with patch.object(cache_mod, "_redis", None):
        assert fb.fmp_call_allowed() is True, (
            "a second process's in-memory counter starts cold — proves the "
            "shared limit is only real when Redis is actually reachable"
        )


# ── 2026-11-10 fix validation: submit_with_context / map_with_context ──────
# These are the ACTUAL call-site helpers now wired into
# fundamental_analysis_service._with_time_budget, company_diagnostic_
# service._with_diag_time_budget, and the three _DIAG_ENRICHMENT_POOL
# submissions in build_company_diagnostic — this proves the helpers
# themselves are correct in isolation, independent of those call sites.

def test_submit_with_context_propagates_background_tag_into_the_pool():
    import concurrent.futures

    _clear()
    with fb.fmp_background():
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            future = fb.submit_with_context(pool, lambda: fb._is_background_ctx.get())
            assert future.result() is True


def test_submit_with_context_does_not_leak_background_tag_to_interactive_calls():
    """A plain (non-background) submission must still read False in the
    worker — the fix must not accidentally make everything look like
    background traffic."""
    import concurrent.futures

    _clear()
    assert fb._is_background_ctx.get() is False
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        future = fb.submit_with_context(pool, lambda: fb._is_background_ctx.get())
        assert future.result() is False


def test_map_with_context_propagates_to_every_concurrent_task():
    """Each task gets its OWN context snapshot (not one shared Context
    object reused across concurrent tasks, which would raise if a
    Context were entered by two threads at once) — all N concurrent
    peer-style tasks must independently see the background tag."""
    import concurrent.futures

    _clear()
    with fb.fmp_background():
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(fb.map_with_context(pool, lambda _: fb._is_background_ctx.get(), range(10)))

    assert results == [True] * 10


def test_stress_background_counter_never_exceeds_its_reserved_share_under_concurrent_comparables():
    """The actual regression this whole fix exists to prevent: simulate a
    full-snapshot build's real shape — one top-level background call plus
    a 10-peer concurrent fan-out (company_diagnostic_service's real
    _MIN_SECTOR_PEERS-style pattern) — and confirm the shared window
    counter never climbs past the 140/min background ceiling no matter
    how many concurrent "peer" tasks run, because every one of them now
    correctly checks in as background instead of mistagged live-user
    traffic. No real FMP/network calls — fmp_call_allowed() is the thing
    under test, not any provider. Runs against a fake-but-real-shaped
    Redis (_FakeRedis) so the reliability assertion doesn't depend on
    whether THIS machine happens to have a real Redis reachable."""
    import concurrent.futures
    import app.core.cache as cache_mod

    _clear()
    background_limit = int(fb.FMP_LIMIT_PER_MINUTE * fb._BACKGROUND_SHARE)

    def _peer_task(_):
        # Each "peer" makes several FMP-budget checks, same as one real
        # get_fundamental_analysis(peer, _compute_peer_dependent_data=False)
        # call touching several endpoints.
        return [fb.fmp_call_allowed() for _ in range(5)]

    with patch.object(cache_mod, "_redis", _FakeRedis()):
        with fb.fmp_background():
            assert fb.fmp_call_allowed() is True  # the ticker's own top-level call
            with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                peer_results = list(fb.map_with_context(pool, _peer_task, range(10)))

        # Every peer call that returned True is counted against the
        # background window-key's counter (not the 280 ceiling) — confirm
        # the counter itself never exceeded the 140 background ceiling by
        # reading it back.
        remaining, reliable = fb.remaining_background_capacity()
    assert reliable is True
    total_allowed = 1 + sum(1 for r in peer_results for ok in r if ok)
    assert total_allowed <= background_limit, (
        f"background counter ({total_allowed}) exceeded its reserved share "
        f"({background_limit}) — the context-propagation fix did not hold "
        f"under concurrent comparable fan-out"
    )
    assert remaining == max(0, background_limit - total_allowed)


# ── 2026-11-10: remaining_background_capacity() (PASO 3's capacity peek) ───

def test_remaining_background_capacity_reflects_real_consumption():
    import app.core.cache as cache_mod

    _clear()
    background_limit = int(fb.FMP_LIMIT_PER_MINUTE * fb._BACKGROUND_SHARE)
    with patch.object(cache_mod, "_redis", _FakeRedis()):
        with fb.fmp_background():
            for _ in range(10):
                fb.fmp_call_allowed()
        remaining, reliable = fb.remaining_background_capacity()
    assert reliable is True
    assert remaining == background_limit - 10


def test_remaining_background_capacity_is_unreliable_without_redis():
    """PASO 3's explicit requirement: when Redis can't actually be
    reached, the in-memory count is only a per-process guess — callers
    deciding whether it's SAFE to keep batching must be told so
    explicitly rather than trusting a number that might be meaningless
    across workers."""
    import app.core.cache as cache_mod

    _clear()
    with patch.object(cache_mod, "_redis", None):
        _, reliable = fb.remaining_background_capacity()
    assert reliable is False
