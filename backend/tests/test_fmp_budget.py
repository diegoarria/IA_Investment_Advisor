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
