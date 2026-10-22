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
