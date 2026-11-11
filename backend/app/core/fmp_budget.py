"""
Shared, distributed FMP call budget — Diego, 2026-10-21: "un limitador
distribuido... que respete la cuota compartida de FMP entre todas las
instancias y workers... reserva capacidad para consultas de usuarios
frente a trabajos automáticos."

Root problem this exists for (Nuvos Radar structural audit, 2026-10-21):
no cross-request FMP throttle existed anywhere in the codebase — the
documented 300-calls/min FMP Starter-plan cap was only ever a comment,
never enforced. A single company-diagnostic view already costs ~42+ live
FMP calls; under concurrent user traffic or a batch job (the 927-ticker
backfill, the weekly refresh), nothing stopped the account's real quota
from being exhausted, which is indistinguishable downstream from FMP
being "down" and a direct contributor to "Valoración no disponible."

Uses `app.core.cache.cache_incr` (atomic Redis INCR+EXPIRE, same
primitive the daily-spend circuit breaker and brute-force counters
already rely on) for a plain fixed-window-per-minute counter — no new
infrastructure. A peek-then-increment check (not a single atomic
compare-and-increment) is a deliberate, acceptable race for a SOFT
budget: the goal is protecting the account's real external quota from
gross overuse, not millisecond-precise fairness, and a worst case of a
couple of calls slipping past the limit in the same window is harmless.

Wired into FMPProvider._get (financial_data_service.py) — the single
real HTTP call every FMP-backed fundamental-analysis fetch funnels
through, which is what both the live /company-diagnostic route and the
backfill/weekly-refresh jobs (via compute_numeric_valuation) actually
use. Scoped to that path deliberately, not every FMP call site in the
codebase (macro calendar, corporate actions, market quotes have their
own, separate, much lower-volume FMP usage) — touching those would be
unrelated scope creep onto features this task was never about.
"""
import contextvars
import logging
import time

from app.core.cache import cache_get, cache_incr

logger = logging.getLogger(__name__)

# A bit under FMP's documented 300/min Starter-plan cap — headroom for
# clock-skew jitter across workers and for the in-memory-fallback mode
# (no Redis configured) being only a single-process approximation.
FMP_LIMIT_PER_MINUTE = 280

# Background jobs (the 927-ticker backfill, the future weekly refresh)
# may only ever consume this fraction of the shared budget in any given
# minute — the remainder is permanently reserved for live user requests,
# so a batch job can never starve the thing users are actually waiting
# on right now.
_BACKGROUND_SHARE = 0.5

_WINDOW_TTL_S = 65  # a touch over 60s so a read right at the window boundary still sees the right count

# Set around a background job's real compute call (see fmp_background())
# so every FMP request it triggers, however many layers deep, is counted
# against the background share rather than the live-user share. Plain
# user/live-route calls never set this — default is always "user."
_is_background_ctx: "contextvars.ContextVar[bool]" = contextvars.ContextVar(
    "fmp_budget_is_background", default=False
)


class fmp_background():
    """Context manager — wrap a background job's real compute call
    (e.g. `compute_numeric_valuation`) so every FMP request it makes is
    counted against the background share of the shared budget, not the
    live-user share. Usage:

        with fmp_background():
            data = get_fundamental_analysis(ticker)
    """

    def __enter__(self):
        self._token = _is_background_ctx.set(True)
        return self

    def __exit__(self, *exc):
        _is_background_ctx.reset(self._token)
        return False


def _window_key() -> str:
    # Minute-aligned window, same convention as other fixed-window
    # counters in this codebase.
    return f"fmp_calls:{int(time.time() // 60)}"


def submit_with_context(pool, fn, *args, **kwargs):
    """Diego, 2026-11-10 (third backfill batch halted on FMP pressure):
    `pool.submit(fn, ...)` does NOT propagate contextvars into the new OS
    thread ThreadPoolExecutor spawns — confirmed empirically, a worker
    thread reads `_is_background_ctx` as its bare default (False), never
    whatever the submitting thread had set. Every peer/comparable fetch
    during a full-snapshot build runs inside `_DIAG_ENRICHMENT_POOL`/
    `_PEER_ENRICHMENT_POOL` workers, so those FMP calls were silently
    mis-tagged as live-user traffic (280/min ceiling) instead of the
    background share (140/min) while still incrementing the one shared
    window counter — explaining both the "budget exhausted" warnings on
    the backfill's own correctly-tagged top-level calls AND the counter
    climbing well past 140.

    Fix: capture `contextvars.copy_context()` in the CALLING thread (where
    the real `_is_background_ctx` value lives) and hand the pool
    `ctx.run(fn, ...)` instead of `fn` directly — same pattern Python's own
    `asyncio.to_thread` uses internally, which is why the single call this
    task's wrapping relies on (`asyncio.to_thread` in
    `company_valuation_service.refresh_if_needed`) was never affected by
    this bug in the first place. A fresh `Context` per call — a `Context`
    object raises if entered concurrently by two threads, so callers doing
    several submissions (e.g. a map-style fan-out) must get their own copy
    per task, never one shared copy reused across a batch; see
    `map_with_context` below for that case."""
    ctx = contextvars.copy_context()
    return pool.submit(ctx.run, fn, *args, **kwargs)


def map_with_context(pool, fn, iterable):
    """Context-preserving equivalent of `pool.map(fn, iterable)` — see
    `submit_with_context` for why a plain `pool.map()` loses the
    background tag. Submits one task per item (each with its own
    `copy_context()`, captured in the calling thread before submission)
    and yields results in input order, same contract as `pool.map()`."""
    futures = [submit_with_context(pool, fn, item) for item in iterable]
    for future in futures:
        yield future.result()


def remaining_background_capacity() -> tuple[int, bool]:
    """Peek-only read (never increments) of the CURRENT window's shared
    counter, returning `(remaining_background_slots, reliable)`.

    `reliable` is False when Redis isn't actually reachable right now —
    `cache_get`'s in-memory fallback is only a per-process approximation
    of the count, not the real cross-worker shared state every other
    process/replica is also writing to, so a caller deciding whether it's
    SAFE to keep firing a multi-ticker batch at FMP must treat
    `reliable=False` as "cannot verify, don't proceed blindly" rather
    than trusting a number that might be meaningless across workers."""
    from app.core.cache import _get_redis
    reliable = _get_redis() is not None
    current = cache_get(_window_key()) or 0
    background_limit = FMP_LIMIT_PER_MINUTE * _BACKGROUND_SHARE
    remaining = max(0, int(background_limit - current))
    return remaining, reliable


def fmp_call_allowed() -> bool:
    """Call this immediately before making a real FMP HTTP request.
    Returns False when the shared per-minute budget (or, for a
    background-job call, its smaller reserved share) is exhausted — the
    caller must then behave exactly as it already does for any other FMP
    failure (empty result, fall through to the next provider), never add
    a new retry/backoff of its own ("no agregues reintentos que
    multipliquen innecesariamente el consumo" — this function's whole
    point is reducing consumption, not adding more of it)."""
    key = _window_key()
    current = cache_get(key) or 0
    is_background = _is_background_ctx.get()
    limit = FMP_LIMIT_PER_MINUTE * _BACKGROUND_SHARE if is_background else FMP_LIMIT_PER_MINUTE
    if current >= limit:
        logger.warning(
            "fmp_call_allowed: shared FMP budget exhausted for this window (count=%s, limit=%s, background=%s)",
            current, limit, is_background,
        )
        return False
    cache_incr(key, ttl=_WINDOW_TTL_S)
    return True
