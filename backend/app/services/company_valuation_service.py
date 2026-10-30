"""Nuvos Radar — durable, versioned persistence of computed intrinsic
valuations (migrations/114_company_valuations.sql). Diego, 2026-10-20:
"que Nuvos Radar almacene los valores intrínsecos... sin depender de
recalcularlos cada vez que un usuario abre una ficha."

Supabase's `company_valuations` table is the source of truth; Redis (via
app.core.cache) is a short fast-path layer in front of it, same role it
already plays everywhere else in this codebase — never the only copy.

This module computes NOTHING new: it calls the exact same
`get_fundamental_analysis` + `_primary_scenarios`/`_fallback_relative_
scenarios` the live /company-diagnostic route already uses (company_
diagnostic_service.py), so the GQV engine, the legacy DCF/financial-
sector/REIT routing, and every valuation formula are completely
untouched — this module only decides WHETHER and WHEN to persist their
output, never HOW they're computed.

Deliberately does NOT call build_company_diagnostic() or go through the
competitor/sector comparison cards — those fan out 1-10 extra peer
fetches purely for UI side panels that a backfill/refresh job has no use
for. Computing just the core scenario keeps this job's real FMP cost to
roughly one get_fundamental_analysis call per ticker (itself already
peer-enriched internally for the relative-valuation fallback, time-
boxed, 2026-10-20 cost-audit-safe).

Never generates AI/Claude narrative — this module has no import of
ai_service at all, by construction, not by a flag that could be flipped.
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.cache import acquire_lock, release_lock, cache_get, cache_set, cache_incr
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

# Bumped whenever the underlying valuation logic this table persists
# changes materially (same discipline as screener.py's company_diagnostic
# cache-key version, e.g. "v10") — a stored row from an older version is
# recognizably stale even though its number isn't literally wrong.
MODEL_VERSION = "v1"


def canonicalize_ticker_suffix(ticker: str) -> str:
    """Dot -> hyphen for dual-class share suffixes (BRK.B -> BRK-B) — FMP
    and this codebase's UNIVERSE list both use the hyphen form, never a
    dot, even though the dot form is how it's commonly written/quoted.
    Does NOT change case — screener._resolve_quick_ticker's own
    case-sensitivity check (an already-uppercase input is trusted as a
    deliberate literal ticker) depends on the original case surviving
    this step, so case normalization is a separate function below."""
    import re
    return re.sub(r'\.([A-Za-z])$', r'-\1', ticker.strip())


def normalize_ticker_symbol(ticker: str) -> str:
    """The one canonical form every persistence-layer caller (company_
    valuations reads/writes, the backfill, the future weekly refresh)
    must key on. Confirmed live 2026-10-21: before this existed, "BRK.B"
    and "BRK-B" ended up as two separate `is_current=true` rows in
    company_valuations for the same real company, because the route
    layer normalized dots to hyphens (screener._resolve_quick_ticker) but
    this module only ever did a bare `.upper()`. Any caller that writes
    or reads a persisted valuation — including a future caller that never
    goes through the route's resolver — must use this, not `.upper()`
    alone."""
    return canonicalize_ticker_suffix(ticker).upper()


_CLAIM_TTL_S = 600  # 10 min — generous for one ticker's real compute time, short enough that a crashed worker self-heals fast
_READ_CACHE_TTL_S = 3600  # Redis fast-path in front of Supabase reads; Supabase stays authoritative
_READ_CACHE_KEY = "company_valuation:v1:{ticker}"

# ── Backoff for failed/insufficient_data retries (migration 115 columns) ──
# 2026-10-27: the backfill job (worker.py job_backfill_company_valuations_
# batch) needs to tell "never attempted" apart from "failed recently, not
# due for retry yet" apart from "failed a while ago, retry now" without
# re-deriving that from the growing history table on every tick — these
# three nullable columns (attempt_count/last_attempt_at/next_retry_at) on
# the *current* row are that answer, kept in sync by persist_valuation().
_BACKOFF_BASE_MINUTES = 30
_BACKOFF_CAP_MINUTES = 24 * 60  # never wait more than a day between retries
_BACKOFF_JITTER_PCT = 0.2  # avoid every stuck ticker retrying in lockstep


def _compute_backoff(prior_attempt_count: int) -> tuple[int, Optional[str]]:
    """Returns (new_attempt_count, next_retry_at ISO string) for a failed/
    insufficient_data outcome. Exponential with jitter, capped at 24h."""
    new_attempt_count = prior_attempt_count + 1
    base_minutes = min(_BACKOFF_BASE_MINUTES * (2 ** prior_attempt_count), _BACKOFF_CAP_MINUTES)
    jitter = base_minutes * _BACKOFF_JITTER_PCT * (random.random() * 2 - 1)
    minutes = max(1.0, base_minutes + jitter)
    next_retry_at = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    return new_attempt_count, next_retry_at


# ── Circuit breaker for the backfill job ──────────────────────────────────
# 2026-10-27 Radar reliability audit: a provider-wide outage (confirmed
# live — Yahoo Finance returning 429 for AMZN/ROST/TJX during the audit)
# must pause the WHOLE backfill run, not just mark individual tickers
# failed one by one while continuing to hammer a provider that's already
# struggling. Same soft-counter pattern as app/core/fmp_budget.py
# (cache_incr, fixed window, not millisecond-precise — acceptable for a
# protective breaker, not a billing-accurate meter).
_CIRCUIT_ATTEMPTS_KEY = "company_valuation_backfill:circuit:attempts:v1"
_CIRCUIT_FAILURES_KEY = "company_valuation_backfill:circuit:failures:v1"
_CIRCUIT_OPEN_KEY = "company_valuation_backfill:circuit:open:v1"
_CIRCUIT_WINDOW_S = 900  # 15 min fixed window
_CIRCUIT_MIN_SAMPLE = 8  # don't trip on the first couple of unlucky tickers
_CIRCUIT_FAILURE_RATE_THRESHOLD = 0.5
_CIRCUIT_COOLDOWN_S = 1800  # 30 min pause once tripped


def circuit_is_open() -> bool:
    return cache_get(_CIRCUIT_OPEN_KEY) is not None


def record_backfill_outcome(validation_status: str) -> None:
    """Only call this for a REAL compute attempt (not a skip-because-
    fresh or a claimed-elsewhere no-op) — see backfill_universe below."""
    attempts = cache_incr(_CIRCUIT_ATTEMPTS_KEY, ttl=_CIRCUIT_WINDOW_S)
    if validation_status == "failed":
        failures = cache_incr(_CIRCUIT_FAILURES_KEY, ttl=_CIRCUIT_WINDOW_S)
    else:
        failures = cache_get(_CIRCUIT_FAILURES_KEY) or 0
    if attempts >= _CIRCUIT_MIN_SAMPLE and failures / attempts > _CIRCUIT_FAILURE_RATE_THRESHOLD:
        cache_set(_CIRCUIT_OPEN_KEY, True, ttl=_CIRCUIT_COOLDOWN_S)
        logger.warning(
            "backfill circuit breaker OPEN: %d/%d failures in %ds window — pausing %ds",
            failures, attempts, _CIRCUIT_WINDOW_S, _CIRCUIT_COOLDOWN_S,
        )


async def get_pending_tickers(universe_tickers: list[str]) -> dict[str, list[str]]:
    """Classifies every ticker in `universe_tickers` by querying
    company_valuations' CURRENT rows — the single source of truth both
    the backfill job's real processing and BACKFILL_DRY_RUN's report use,
    so a dry-run's bucket counts are never approximate or stale relative
    to what a real run would actually do a moment later.

    Buckets, in the job's processing priority order:
      - no_valuation: never has a current row at all (the 906/927 gap
        confirmed by the 2026-10-27 live audit).
      - retry_eligible: current row is insufficient_data/under_review and
        its backoff window (next_retry_at) has elapsed, or was never set.
      - backing_off: current row is insufficient_data/under_review but
        still inside its backoff window.
      - stale: current row is valid but computed under an older
        MODEL_VERSION than today's.
      - already_valid: current row is valid under today's MODEL_VERSION.
        refresh_if_needed will still no-op these until the real financial
        report period changes, so the backfill job never schedules them.
    """
    tickers = [normalize_ticker_symbol(t) for t in universe_tickers]
    db = get_supabase()
    result = await run_query(
        db.table("company_valuations")
        .select("ticker,validation_status,model_version,next_retry_at")
        .in_("ticker", tickers)
        .eq("is_current", True)
    )
    rows_by_ticker = {r["ticker"]: r for r in (result.data or [])}

    now = datetime.now(timezone.utc)
    buckets: dict[str, list[str]] = {
        "no_valuation": [], "retry_eligible": [], "backing_off": [], "stale": [], "already_valid": [],
    }
    for ticker in tickers:
        row = rows_by_ticker.get(ticker)
        if row is None:
            buckets["no_valuation"].append(ticker)
            continue
        status = row.get("validation_status")
        if status == "valid":
            bucket = "already_valid" if row.get("model_version") == MODEL_VERSION else "stale"
            buckets[bucket].append(ticker)
            continue
        next_retry_at_raw = row.get("next_retry_at")
        due = now
        if next_retry_at_raw:
            try:
                due = datetime.fromisoformat(next_retry_at_raw.replace("Z", "+00:00"))
            except Exception:
                due = now
        buckets["retry_eligible" if due <= now else "backing_off"].append(ticker)
    return buckets


def _claim_key(ticker: str) -> str:
    return f"company_valuation_claim:v1:{normalize_ticker_symbol(ticker)}"


def claim_ticker(ticker: str) -> Optional[str]:
    """Cross-process, self-expiring claim so two workers (the initial
    backfill and, later, the weekly refresh) never compute the same
    ticker at the same time. Returns a token to pass to release_claim(),
    or None if someone else already holds it. Reuses the exact same
    acquire_lock primitive undervalued_screener_service.py already relies
    on for its own single-flight submission lock — not reinvented here."""
    return acquire_lock(_claim_key(ticker), ttl=_CLAIM_TTL_S, fail_closed_on_redis_error=True)


def release_claim(ticker: str, token: str) -> None:
    release_lock(_claim_key(ticker), token)


def _methodology_label(scenarios: dict, dcf: dict) -> str:
    source = scenarios.get("source")
    if source == "gqv":
        return "gqv"
    if source == "relative_valuation":
        return "relative_valuation_fallback"
    if source == "dcf":
        note = dcf.get("sector_model_note") or {}
        if note.get("sector_type") == "reit":
            return "reit_ffo_affo"
        return "legacy_dcf_or_financial_sector"
    return "unknown"


def compute_numeric_valuation(ticker: str) -> dict:
    """Real core valuation only — no competitor/sector comparison, no AI.
    Returns a dict matching set_current_company_valuation's RPC params
    (minus ticker), plus `validation_status`/`error_detail`. Never raises
    — a real failure becomes `validation_status="failed"`, same "never
    fabricate, never silently succeed" discipline as the rest of this
    codebase's valuation path."""
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    try:
        # 2026-10-27 P0 latency fix: the backfill never needs relative/
        # historical/industry peer enrichment (the GQV scenarios and the
        # anomaly guard are both driven by this ticker's OWN historical
        # trend, not its peers') — and that enrichment submits work to the
        # same 8-worker pool (_PEER_ENRICHMENT_POOL) real interactive
        # requests use. Running the backfill with peer-dependent data ON
        # meant a batch of background jobs could occupy every worker with
        # abandoned-but-still-running Yahoo/FMP calls, starving a live
        # user's own 12s-budgeted enrichment attempt — confirmed as a
        # contributing factor to DLR's 273s hang during the 50-ticker
        # batch. Disabling it here removes that contention at the source.
        data = get_fundamental_analysis(ticker, _compute_peer_dependent_data=False)
    except Exception as e:
        logger.warning("compute_numeric_valuation(%s): get_fundamental_analysis raised: %s", ticker, e)
        return {"validation_status": "failed", "error_detail": f"get_fundamental_analysis raised: {e}"}

    if not data:
        return {"validation_status": "insufficient_data", "error_detail": "no fundamental data available"}

    return scenarios_from_fetched_data(ticker, data)


def scenarios_from_fetched_data(ticker: str, data: dict) -> dict:
    """Same result shape as compute_numeric_valuation, but takes a `data`
    dict the caller ALREADY fetched via get_fundamental_analysis — used by
    the live /company-diagnostic route (screener.py) to persist a write-
    through valuation from its own existing fetch, instead of this module
    re-fetching the same ticker a second time (2026-10-20, "sin recalcular
    innecesariamente los estados financieros")."""
    from app.services.company_diagnostic_service import _primary_scenarios, _fallback_relative_scenarios
    from app.api.routes.screener import _latest_reported_earnings_period

    dcf = data.get("dcf") or {}
    if not dcf:
        return {"validation_status": "insufficient_data", "error_detail": "no dcf block on fundamental_analysis result"}

    scenarios = _primary_scenarios(dcf)
    if not scenarios or scenarios.get("current_price") is None:
        scenarios = _fallback_relative_scenarios(dcf, data)
    if not scenarios or scenarios.get("base") is None:
        return {
            "validation_status": "insufficient_data",
            "error_detail": (
                f"no primary or relative-valuation scenario "
                f"(gqv_status={(dcf.get('gqv_fair_value') or {}).get('status')}, "
                f"legacy_dcf_present={bool(dcf.get('scenarios'))}, "
                f"relative_valuation_present={bool(dcf.get('relative_valuation'))})"
            ),
        }

    try:
        financial_report_period = _latest_reported_earnings_period(ticker) or None
    except Exception as e:
        logger.info("scenarios_from_fetched_data(%s): earnings-period lookup failed: %s", ticker, e)
        financial_report_period = None

    review_reason = _anomaly_review_reason(scenarios, dcf)
    validation_status = "under_review" if review_reason else "valid"

    return {
        "validation_status": validation_status,
        "error_detail": review_reason,
        "intrinsic_value_usd": scenarios["base"],
        "currency": "USD",
        "methodology": _methodology_label(scenarios, dcf),
        "model_version": MODEL_VERSION,
        "financial_report_period": financial_report_period,
        "assumptions": {
            # Radar legacy-engine audit, 2026-10-29: `dcf["wacc_details"]`
            # (set by `_calc_wacc`/`financial_engine.build_financial_
            # fair_value`) never carries a "wacc_pct" key — only `dcf[
            # "gqv_fair_value"]["wacc_details"]` does, for GQV-methodology
            # rows. This made every persisted row's assumptions.discount_
            # rate_pct silently NULL regardless of methodology (confirmed:
            # every row in company_valuations, GQV or legacy/financial,
            # had it null) — a real gap for anyone reviewing an under_
            # review case from Supabase without recomputing the whole
            # pipeline. `dcf["base_discount_rate_pct"]` is the real,
            # always-present field (legacy/financial engines) that this
            # should have read; GQV rows fall back to their own nested copy.
            "discount_rate_pct": (
                dcf.get("base_discount_rate_pct")
                or (dcf.get("gqv_fair_value") or {}).get("wacc_details", {}).get("wacc_pct")
            ),
            "fcf_assumptions": scenarios.get("fcf_assumptions"),
            "bear": scenarios.get("bear"),
            "bull": scenarios.get("bull"),
            "peer_count": scenarios.get("_peer_count"),
        },
    }


# Backfill-pilot audit, 2026-10-27 (AXON) — a completed, non-failing
# computation can still be untrustworthy. These two triggers never adjust
# a single number the engine produced; they only decide whether that
# number is allowed to present as `valid` or must wait for human review
# as `under_review`. Deliberately conservative (wide bands) — this must
# never fire on the normal 12-27% intrinsic-vs-price spread already seen
# across this universe's real tickers.
_REVIEW_GAP_RATIO_LOW = 0.20   # intrinsic < 20% of price
_REVIEW_GAP_RATIO_HIGH = 5.0   # intrinsic > 5x price


def _anomaly_review_reason(scenarios: dict, dcf: dict) -> Optional[str]:
    """None when the valuation is trustworthy; otherwise a human-readable
    reason to store in error_detail and surface as validation_status=
    'under_review' instead of 'valid'."""
    if dcf.get("operating_margin_anchor_reliable") is False:
        return dcf.get("operating_margin_anchor_warning") or (
            "operating_margin_anchor computed from a thin mixed-regime trend — unreliable 10-year anchor"
        )

    base = scenarios.get("base")
    price = scenarios.get("current_price")
    if base is not None and price and price > 0:
        ratio = base / price
        if ratio < _REVIEW_GAP_RATIO_LOW or ratio > _REVIEW_GAP_RATIO_HIGH:
            return (
                f"intrinsic/price ratio {ratio:.3f}x fuera del rango esperado "
                f"({_REVIEW_GAP_RATIO_LOW}x-{_REVIEW_GAP_RATIO_HIGH}x) — requiere revisión manual antes de publicarse como válida"
            )
    return None


async def get_persisted_valuation(ticker: str) -> Optional[dict]:
    """The current (is_current=true) row for `ticker`, or None if it has
    never been computed. Redis fast-path in front of Supabase, same role
    Redis already plays everywhere in this codebase — Supabase stays the
    source of truth; a cache miss or expiry always falls through to it."""
    ticker = normalize_ticker_symbol(ticker)
    cache_key = _READ_CACHE_KEY.format(ticker=ticker)
    cached = cache_get(cache_key)
    if cached is not None:
        return cached or None  # a cached explicit "no row" is stored as {} below

    db = get_supabase()
    try:
        result = await run_query(
            db.table("company_valuations").select("*").eq("ticker", ticker).eq("is_current", True).limit(1)
        )
    except Exception:
        # 2026-10-28 P0: this was the ONLY unguarded Supabase call on the
        # /company-diagnostic cache-miss path (screener.py's
        # _company_diagnostic_result calls this unconditionally, before
        # _attempt_build even starts) — a transient Postgrest/connection
        # hiccup under concurrent load (confirmed reproducible for NVDA:
        # ~75% failure in a 10-request burst, same "fast <1s generic 500"
        # signature as the AAPL incident this same day) propagated straight
        # past every fallback below it into main.py's generic 500 handler.
        # Treat a failed read exactly like "no row cached yet" — callers
        # already handle None/falsy by either retrying the live build or
        # degrading honestly, never by fabricating a valuation.
        logger.exception("get_persisted_valuation(%s): Supabase read failed", ticker)
        return None
    row = (result.data or [None])[0]
    cache_set(cache_key, row or {}, ttl=_READ_CACHE_TTL_S)
    return row


async def _invalidate_read_cache(ticker: str) -> None:
    from app.core.cache import cache_delete
    cache_delete(_READ_CACHE_KEY.format(ticker=normalize_ticker_symbol(ticker)))


async def persist_valuation(
    ticker: str, computed: dict, prior_attempt_count: int = 0,
    diagnostic_snapshot: dict | None = None, snapshot_schema_version: int | None = None,
) -> dict:
    """Writes `compute_numeric_valuation`'s output to Supabase. A 'valid'
    or 'insufficient_data' result atomically becomes the new current row
    (via the set_current_company_valuation RPC — see migrations/114's own
    docstring for why this needs to be one DB transaction, not two
    separate calls from here). A 'failed' result is logged as plain
    history (is_current=false) and NEVER touches the existing current
    row — a transient FMP/Finnhub hiccup can never erase a real,
    previously-valid valuation.

    `prior_attempt_count` (the existing current row's attempt_count, 0 if
    none) drives the migration-115 backoff columns: a 'valid' result
    resets the backoff entirely; 'failed'/'insufficient_data' advance it.
    These columns are maintained here, not in the migration-114 RPC
    itself, so that RPC's original atomicity guarantee needs no change —
    a crash between the RPC and this follow-up update only leaves retry
    *timing* stale, never the valuation itself, which already committed."""
    ticker = normalize_ticker_symbol(ticker)
    db = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    if computed["validation_status"] == "failed":
        new_attempt_count, next_retry_at = _compute_backoff(prior_attempt_count)
        row = {
            "ticker": ticker,
            "currency": "USD",
            "methodology": "n/a",
            "model_version": MODEL_VERSION,
            "validation_status": "failed",
            "error_detail": computed.get("error_detail"),
            "is_current": False,
            "attempt_count": new_attempt_count,
            "last_attempt_at": now_iso,
            "next_retry_at": next_retry_at,
        }
        await run_query(db.table("company_valuations").insert(row))
        return row

    result = await run_query(
        db.rpc("set_current_company_valuation", {
            "p_ticker": ticker,
            "p_intrinsic_value_usd": computed.get("intrinsic_value_usd"),
            "p_currency": computed.get("currency", "USD"),
            "p_methodology": computed.get("methodology") or "n/a",
            "p_model_version": computed.get("model_version", MODEL_VERSION),
            "p_financial_report_period": computed.get("financial_report_period"),
            "p_assumptions": computed.get("assumptions"),
            "p_validation_status": computed["validation_status"],
        })
    )
    row = (result.data or [{}])[0] if isinstance(result.data, list) else result.data

    if computed["validation_status"] in ("insufficient_data", "under_review"):
        new_attempt_count, next_retry_at = _compute_backoff(prior_attempt_count)
    else:  # 'valid' — a real success resets backoff entirely
        new_attempt_count, next_retry_at = 0, None
    try:
        row_id = row.get("id") if isinstance(row, dict) else None
        if row_id:
            follow_up = {
                "attempt_count": new_attempt_count,
                "last_attempt_at": now_iso,
                "next_retry_at": next_retry_at,
                # set_current_company_valuation's RPC signature (migration
                # 114/116) has no p_error_detail param, so a 'valid'/
                # 'under_review'/'insufficient_data' row written through it
                # never got the human-readable review reason persisted —
                # found 2026-10-27 during the Fase-2 50-ticker batch, where
                # PLTR/F landed under_review with error_detail=NULL despite
                # _anomaly_review_reason() computing a real reason. Folded
                # into this already-existing follow-up UPDATE rather than
                # widening the RPC, since this column update is already
                # unconditional.
                "error_detail": computed.get("error_detail"),
            }
            # migration 117: only written when a caller actually has a full
            # rich diagnostic in hand (today: the live-build write-through
            # path) — never overwrites an existing snapshot with NULL, so a
            # backfill-only write (no snapshot) can't erase a snapshot a
            # real user visit already persisted for this ticker.
            if diagnostic_snapshot is not None:
                follow_up["diagnostic_snapshot"] = diagnostic_snapshot
                follow_up["snapshot_schema_version"] = snapshot_schema_version
            await run_query(
                db.table("company_valuations").update(follow_up).eq("id", row_id)
            )
            row = {**row, **follow_up}
    except Exception as e:
        logger.warning("persist_valuation(%s): backoff-tracking update failed (non-fatal): %s", ticker, e)

    await _invalidate_read_cache(ticker)
    return row


async def refresh_if_needed(ticker: str, force: bool = False) -> dict:
    """The one entry point both the initial backfill and the future
    per-ticker refresh use. Idempotent: if the persisted row already
    reflects the same financial_report_period under the current
    MODEL_VERSION, this is a no-op (returns the existing row) unless
    `force=True` — never re-spends real FMP quota recomputing a ticker
    that hasn't actually changed. Claims a short cross-process lock first
    so a concurrent caller for the same ticker backs off instead of
    duplicating the real work."""
    ticker = normalize_ticker_symbol(ticker)
    token = claim_ticker(ticker)
    if token is None:
        existing = await get_persisted_valuation(ticker)
        row = existing or {"ticker": ticker, "validation_status": "claimed_elsewhere"}
        # Not a real compute attempt — the backfill job's circuit breaker
        # must never count this (see backfill_universe below).
        return {**row, "_backfill_attempted": False}

    try:
        # Fetched regardless of `force` — even a forced recompute must
        # never let a fresh "insufficient_data" result demote a real
        # previously-valid row (see the check right before persist()
        # below); only the SKIP logic right below this is conditional on
        # `not force`.
        existing = await get_persisted_valuation(ticker)
        if not force and existing and existing.get("model_version") == MODEL_VERSION:
            from app.api.routes.screener import _latest_reported_earnings_period
            try:
                current_period = _latest_reported_earnings_period(ticker)
            except Exception:
                current_period = None
            if current_period and current_period == existing.get("financial_report_period"):
                return {**existing, "_backfill_attempted": False}
            # The earnings-period signal itself is unavailable right now
            # (Finnhub plan/outage — confirmed happens for real, not just
            # in tests) — rather than always recomputing blindly (which
            # would defeat quota protection every time this signal is
            # down), fall back to a plain time-based freshness check: a
            # row computed within the last 24h is still trusted as-is.
            if current_period is None and existing.get("computed_at"):
                try:
                    computed_at = datetime.fromisoformat(existing["computed_at"].replace("Z", "+00:00"))
                    age_hours = (datetime.now(timezone.utc) - computed_at).total_seconds() / 3600
                except Exception:
                    age_hours = None
                if age_hours is not None and age_hours < 24:
                    return {**existing, "_backfill_attempted": False}
        # compute_numeric_valuation does real blocking HTTP calls — off the
        # event loop, same convention the live /company-diagnostic route
        # already uses for get_fundamental_analysis. Wrapped in
        # fmp_background() so every FMP call this triggers (however many
        # layers deep) draws from the shared budget's background share,
        # not the live-user share — refresh_if_needed is what both the
        # 927-ticker backfill and the future weekly refresh call, neither
        # of which should be able to starve a real user's own request.
        from app.core.fmp_budget import fmp_background
        with fmp_background():
            computed = await asyncio.to_thread(compute_numeric_valuation, ticker)
        # 2026-10-20, confirmed live for BRK.B: all 3 financial-data
        # providers (FMP/Fiscal.ai/yfinance) transiently empty at once is
        # a real, observed outage pattern, indistinguishable at this layer
        # from "this company genuinely has <3 years of statements." If a
        # real VALID valuation already exists, treat a fresh "no data"
        # result as a transient failure instead — never let a provider
        # hiccup demote a real previous value to "insufficient data." Only
        # when there's no prior valid row at all is "insufficient_data"
        # the honest, legitimate classification (we've simply never had
        # enough data for this ticker).
        if computed["validation_status"] == "insufficient_data" and existing and existing.get("validation_status") == "valid":
            computed = {"validation_status": "failed", "error_detail": f"demoted from insufficient_data (prior valid row exists): {computed.get('error_detail')}"}
        prior_attempt_count = (existing or {}).get("attempt_count") or 0
        row = await persist_valuation(ticker, computed, prior_attempt_count=prior_attempt_count)
        return {**row, "_backfill_attempted": True}
    finally:
        release_claim(ticker, token)


async def backfill_universe(
    tickers: list[str], max_tickers_per_minute: float = 2.0, limit: Optional[int] = None,
) -> dict:
    """Processes `tickers` in small, paced batches instead of one
    unbounded sweep (Diego, 2026-10-20: "con un límite global de llamadas
    FMP que respete la cuota compartida con las solicitudes de
    usuarios"). Each ticker's own real compute costs roughly 15-100+ FMP
    calls depending on how much peer enrichment it needs (2026-10-20 cost
    audit) — `max_tickers_per_minute` defaults conservatively, well under
    the documented 300-calls/min FMP Starter-plan cap, leaving headroom
    for live user traffic sharing the same key.

    Resumable by construction, not by any extra bookkeeping here:
    refresh_if_needed() already skips a ticker whose persisted row
    reflects the current MODEL_VERSION and financial_report_period, so
    re-running this after an interruption (crash, redeploy, manual stop)
    never re-spends quota on tickers already completed — it just picks
    up wherever it left off. Saves each ticker's result the moment that
    ticker finishes (inside refresh_if_needed/persist_valuation), never
    batching writes, so a stop at ticker 400 of 927 leaves exactly 400
    real, durable rows behind.

    Never calls build_company_diagnostic or ai_service — no competitor/
    sector comparison fan-out, no AI narrative, for any ticker, ever.

    2026-10-27: now circuit-breaker aware — if a provider-wide outage has
    tripped the breaker (record_backfill_outcome, above), this stops
    issuing NEW real compute attempts for the remainder of `tickers` and
    reports them as `circuit_breaker_skipped` rather than quietly working
    through a list while a provider is clearly struggling. Only counts a
    REAL attempt (row["_backfill_attempted"] is True, set by
    refresh_if_needed) toward the breaker — a claimed-elsewhere or
    already-fresh skip carries no provider-health signal."""
    if limit:
        tickers = tickers[:limit]
    results: dict[str, int] = {
        "valid": 0, "insufficient_data": 0, "failed": 0,
        "skipped_claimed": 0, "unchanged": 0, "circuit_breaker_skipped": 0,
    }
    batch_interval = 60.0 / max_tickers_per_minute if max_tickers_per_minute > 0 else 0.0

    for i, ticker in enumerate(tickers):
        if circuit_is_open():
            logger.warning(
                "backfill_universe: circuit breaker open — stopping at ticker %d/%d (%s)",
                i, len(tickers), ticker,
            )
            results["circuit_breaker_skipped"] += len(tickers) - i
            break

        t0 = time.monotonic()
        try:
            row = await refresh_if_needed(ticker)
            status = row.get("validation_status")
            if row.get("_backfill_attempted"):
                record_backfill_outcome(status)
            if status == "claimed_elsewhere":
                results["skipped_claimed"] += 1
            elif status == "valid":
                results["valid"] += 1
            elif status == "insufficient_data":
                results["insufficient_data"] += 1
            elif status == "failed":
                results["failed"] += 1
            else:
                results["unchanged"] += 1
            logger.info("backfill_universe(%s): %s", ticker, status)
        except Exception:
            logger.exception("backfill_universe(%s): unexpected error", ticker)
            record_backfill_outcome("failed")
            results["failed"] += 1

        elapsed = time.monotonic() - t0
        sleep_s = max(0.0, batch_interval - elapsed)
        if sleep_s:
            await asyncio.sleep(sleep_s)

    return results


async def persist_from_fetched_data(
    ticker: str, data: dict, diagnostic: dict | None = None, snapshot_schema_version: int | None = None,
) -> None:
    """Write-through save for the live /company-diagnostic route (2026-10-
    20): once a real, successful card build already has `data` in hand,
    persist its numeric valuation too — no second fetch (uses
    scenarios_from_fetched_data, not compute_numeric_valuation), so this
    costs one cheap Supabase write, nothing more. Meant to be fired via
    asyncio.create_task — never awaited inline, since a slow/failed
    Supabase write must never delay or fail the user's own response.
    Swallows its own errors for the same reason; logs instead of raising.

    `diagnostic` (migration 117, 2026-10-29): the FULL rendered diagnostic
    dict the route already built for this request (score, competitor
    comparison, sector comparison, fair-PE breakdown — everything
    CompanyDiagnosticCard.tsx renders), passed through unchanged so a
    future fallback/read can serve the exact same rich ficha with zero
    recomputation. Optional and additive — omitting it just means no
    snapshot gets persisted this time, same as before this migration."""
    try:
        computed = scenarios_from_fetched_data(ticker, data)
        if computed["validation_status"] != "valid":
            return  # don't persist insufficient_data here — that's a genuine
            # "couldn't build a diagnostic at all" case the route already
            # handles separately; this path only fires after a successful
            # card build, so a non-valid result here would be surprising
            # and isn't the case this write-through exists for.
        await persist_valuation(
            ticker, computed,
            diagnostic_snapshot=diagnostic, snapshot_schema_version=snapshot_schema_version,
        )
    except Exception as e:
        logger.info("persist_from_fetched_data(%s): skipped, non-fatal: %s", ticker, e)
