"""
Undervalued Stocks Screener
============================
Runs the real deterministic DCF/fundamental-analysis engine
(fundamental_analysis_service.get_fundamental_analysis) across the curated
ticker universe (screener.py's UNIVERSE) and caches the ones with a real
positive margin of safety — this is a genuinely different tool than the
existing screener.py endpoints, which layer an LLM narrative over live
Finnhub metrics, not the DCF engine.

Precomputed on a weekly schedule (see worker.py's job_refresh_undervalued_
screener) because get_fundamental_analysis makes several real API calls per
ticker — running it live across ~150 tickers on every request would be far
too slow. The user-facing read (get_undervalued) is cache-only, fast.

Two self-heal mechanisms guarantee the list is never empty (a fresh deploy,
a flushed cache, or a missed weekly run should never show a blank screen):
1. worker.py runs a full refresh once at startup if the cache is empty,
   instead of waiting for the next scheduled Sunday run.
2. The read path (get_undervalued, called from the API endpoint and the
   chat trigger) triggers a smaller, faster BOOTSTRAP scan (a subset of the
   universe) synchronously if the cache is still completely empty — slower
   than a normal cache read, but only ever happens once, and the full
   weekly job overwrites it with the complete/accurate scan on schedule.
"""

from __future__ import annotations

import copy
import logging
from typing import Optional

from app.core.cache import cache_set, cache_get_with_ts

logger = logging.getLogger(__name__)

# v2 — bumped for the Nuvos Fair Value Engine (Growth + Quality + Value)
# becoming PRIMARY over the DCF (see /Users/diegoarria/.claude/plans/
# cosmic-munching-crown.md): `_build_candidate` now sources
# `intrinsic_value_base`/`margin_of_safety_pct`/`confidence_meter` through
# `_primary_valuation` (GQV first, DCF fallback) instead of the DCF's own
# scenarios unconditionally. A v1 cache entry was built by the old logic —
# without this bump, Oportunidades keeps serving DCF-only candidates for up
# to 8 more days (this cache's TTL) after the code changed.
CACHE_KEY = "undervalued_screener:v3"
CACHE_TTL = 8 * 24 * 3600      # slightly over a week — one missed weekly run doesn't go stale/empty
BOOTSTRAP_TTL = 24 * 3600      # short-lived — the next full weekly/startup refresh supersedes this
_BOOTSTRAP_LIMIT = 44          # small subset so a cold-cache request stays reasonably fast — ~4 per GICS sector via _diverse_bootstrap_sample, now that UNIVERSE is the full S&P 500 (bumped from 20, which was fine for the old ~183-ticker curated list but too thin for real sector spread here)
_MAX_PER_SECTOR = 5            # never more than 5 candidates from the same sector in the results shown

_FEATURED_POOL_SIZE = 15  # rotate among the top N by composite_score — stays within "genuinely strong" candidates
_FEATURED_COUNT = 5       # how many appear first each week


_WEAK_DIMENSION_THRESHOLD = 40  # below this on any of these dimensions, flag it — a real value-trap signal, not just "cheap"
_WEAK_DIMENSIONS = [
    ("financial_strength", "Financial Strength"),
    ("predictability", "Predictability"),
]


def _reasonable_range(center: Optional[float], spread_pp: float) -> Optional[dict]:
    if center is None:
        return None
    return {"low": round(center - spread_pp, 1), "high": round(center + spread_pp, 1)}


def build_dcf_guidance(dcf: Optional[dict], thesis_scores: Optional[dict]) -> Optional[dict]:
    """Grounds the DCF calculator's growth/discount/terminal-growth sliders
    in the SAME real numbers Nuvos's own valuation engine already computed
    for this ticker — never a generic placeholder, never fabricated
    "Buffett wisdom" text. Two methodologies exist (see
    valuation.financial_engine.build_financial_fair_value — Residual
    Income/Excess Return — for banks/insurers vs. the standard two-stage
    FCF DCF for everyone else), normalized here into one shape so the
    frontend doesn't need to special-case which one ran.

    Also computes a "reasonable range" (low/high, in percentage points) per
    assumption — the basis for the assumption assistant's 🟢🟡🔴 stoplight,
    which the frontend evaluates live as the user drags a slider (no
    round-trip per drag):
    - Growth: width scales INVERSELY with predictability — a highly
      predictable business (100/100) gets a tight ±1.5pp band; an
      unpredictable one gets up to ±5pp. Never a fixed number for every
      company, per the "no reglas fijas" requirement.
    - Discount rate: fixed ±1.5pp — WACC is already objectively computed
      (real CAPM inputs), so it doesn't get less certain just because the
      business quality is lower; a lower-quality company's higher risk is
      already reflected IN the WACC itself (higher beta/leverage), not in
      how wide a band we draw around it.
    - Terminal growth: fixed ±0.5pp — perpetual growth above roughly 4-5%
      (exceeding real long-run GDP forever) is a classic DCF modeling error
      regardless of which company it is, so this band stays deliberately
      narrow for everyone.

    Returns None only when `dcf` itself is missing — every field inside is
    already a real, previously-computed number (or None if that specific
    sub-computation wasn't available), never guessed here."""
    if not dcf:
        return None
    scenarios = dcf.get("scenarios") or {}
    base = scenarios.get("base") or {}
    growth_buildup = dcf.get("growth_buildup") or {}
    market_expectations = dcf.get("market_expectations") or {}
    thesis_scores = thesis_scores or {}

    suggested_g = base.get("stage1_growth_pct")
    suggested_r = base.get("discount_rate_pct") or dcf.get("base_discount_rate_pct")
    suggested_gt = dcf.get("terminal_growth_pct")
    predictability = thesis_scores.get("predictability")

    g_spread = 1.5 + (100 - predictability) / 100 * 3.5 if predictability is not None else 3.0

    return {
        "methodology": dcf.get("methodology", "two_stage_fcf"),
        "suggested_g": suggested_g,
        "suggested_r": suggested_r,
        "suggested_gt": suggested_gt,
        "g_range": _reasonable_range(suggested_g, g_spread),
        "r_range": _reasonable_range(suggested_r, 1.5),
        "gt_range": _reasonable_range(suggested_gt, 0.5),
        "historical_growth_pct": growth_buildup.get("historical_growth_pct"),
        "moat_adjustment_pct": growth_buildup.get("moat_adjustment_pct"),
        "avg_roic_pct": growth_buildup.get("avg_roic_pct"),
        "avg_roe_pct": dcf.get("avg_roe_pct"),
        "market_implied_growth_pct": market_expectations.get("market_implied_growth_pct"),
        "business_quality": thesis_scores.get("business_quality"),
        "predictability": predictability,
        "financial_strength": thesis_scores.get("financial_strength"),
        "growth_outlook": thesis_scores.get("growth_outlook"),
        "management_capital_allocation": thesis_scores.get("management_capital_allocation"),
    }


def _weak_dimension(thesis_scores: Optional[dict]) -> Optional[dict]:
    """Real signal (from the same Investment Thesis Scorecard already
    computed, not a new estimate) that a high margin of safety might be a
    value trap rather than a genuine bargain — flags the weakest dimension
    below the threshold. Returns the raw {label, score} instead of a
    formatted string so the caller can render it in the requested language
    at read time (see _format_weak_dimension_warning) rather than baking a
    single language in at scan time."""
    if not thesis_scores:
        return None
    worst_label, worst_score = None, 100
    for key, label in _WEAK_DIMENSIONS:
        score = thesis_scores.get(key)
        if score is not None and score < _WEAK_DIMENSION_THRESHOLD and score < worst_score:
            worst_label, worst_score = label, score
    return {"label": worst_label, "score": worst_score} if worst_label else None


def _format_weak_dimension_warning(weak_dimension: Optional[dict], lang: str) -> Optional[str]:
    if not weak_dimension:
        return None
    suffix = "low" if lang == "en" else "bajo"
    return f"{weak_dimension['label']} {suffix} ({weak_dimension['score']}/100)"


# Below this Confidence Meter score (see confidence_engine.py, whose own
# "Especulativo" label starts at 45), the fair-value number is too uncertain
# to publish as a Nuvos "Oportunidad" — mostly thin/short data, not a real
# signal. Combined with debt_cash_missing (financial statements the provider
# genuinely didn't send, not real zeros — see fundamental_analysis_service.py's
# debt/cash read), this is the data-quality gate: better to show fewer,
# trustworthy candidates than many with a possibly-wrong intrinsic value.
_MIN_CONFIDENCE_SCORE = 35
_SCAN_MAX_WORKERS = 10  # bounded concurrency for the S&P 500-sized scan — see _scan's docstring


def _passes_quality_gate(confidence_meter: Optional[dict], data_quality_flags: Optional[dict]) -> bool:
    confidence = confidence_meter or {}
    score = confidence.get("score")
    if score is not None and score < _MIN_CONFIDENCE_SCORE:
        return False
    if (data_quality_flags or {}).get("debt_cash_missing"):
        return False
    return True


def _primary_valuation(dcf: dict) -> dict:
    """Nuvos Fair Value Engine (Growth + Quality + Value) — see
    /Users/diegoarria/.claude/plans/cosmic-munching-crown.md — is primary
    for Oportunidades when it produced a real, gate-passed result for this
    ticker; falls back to the DCF + exit-multiple model's own numbers
    otherwise. Never silently drops a ticker from consideration just
    because GQV alone couldn't value it (negative EPS, short history,
    financial sector) when the DCF still can — a thinner Oportunidades
    list is a worse outcome than showing the best available real number."""
    gqv = dcf.get("gqv_fair_value")
    if gqv and gqv.get("status") == "ok" and gqv.get("scenarios"):
        return {
            "intrinsic_value_base": gqv["scenarios"]["base"]["fair_value_per_share"],
            "margin_of_safety_pct": gqv["scenarios"].get("margin_of_safety_pct"),
            "confidence_meter": gqv.get("confidence_meter"),
            "valuation_source": "gqv",
        }
    # Priority 3 (methodology audit) — `dcf["scenarios"]` can now genuinely
    # be None (GQV-without-DCF fallback path, e.g. MU, when GQV ALSO
    # couldn't produce a result) — `.get()` chains, never direct indexing,
    # so a double-failure degrades to honest Nones instead of a KeyError.
    return {
        "intrinsic_value_base": (dcf.get("scenarios") or {}).get("base", {}).get("intrinsic_value_per_share"),
        "margin_of_safety_pct": dcf.get("margin_of_safety_pct"),
        "confidence_meter": dcf.get("confidence_meter"),
        "valuation_source": "dcf",
    }


def _build_candidate(entry: dict, data: Optional[dict]) -> Optional[dict]:
    """Turns one ticker's raw get_fundamental_analysis() result into an
    Oportunidades candidate, or None when it doesn't qualify — either no
    real positive margin of safety, or the data-quality gate above rejects
    it. Split out of _scan so the threaded scan below can call this from
    worker threads without touching shared state."""
    dcf = data.get("dcf") if data else None
    if not dcf:
        return None
    primary = _primary_valuation(dcf)
    mos = primary["margin_of_safety_pct"]
    if mos is None or mos <= 0 or not _passes_quality_gate(primary["confidence_meter"], dcf.get("data_quality_flags")):
        return None
    thesis_scores = data.get("thesis_scores")
    _fcf_trend_vals = [v for v in (data.get("fcf_trend") or []) if v is not None]
    price = data.get("current_price")
    shares_out = dcf.get("shares_outstanding")
    market_cap = price * shares_out if price and shares_out else None
    return {
        "ticker": entry["ticker"],
        "company_name": data.get("company_name"),
        "sector": entry.get("sector"),
        "price": price,
        "change_pct": data.get("change_pct"),
        "exchange": data.get("exchange"),
        "market_cap": market_cap,
        "intrinsic_value_base": primary["intrinsic_value_base"],
        "margin_of_safety_pct": mos,
        "valuation_source": primary["valuation_source"],
        "composite_score": data.get("composite_score"),
        "fair_value_range": dcf.get("fair_value_range"),
        "confidence_meter": primary["confidence_meter"],
        "implied_growth_pct": dcf.get("implied_growth_pct"),
        "market_expectations": dcf.get("market_expectations"),
        "yearly_detail": dcf.get("yearly_detail"),
        "pv_of_fcf_sum": dcf.get("pv_of_fcf_sum"),
        "pv_of_terminal_value": dcf.get("pv_of_terminal_value"),
        "enterprise_value": dcf.get("enterprise_value"),
        "total_debt": dcf.get("total_debt"),
        "cash": dcf.get("cash"),
        "current_fcf": _fcf_trend_vals[-1] if _fcf_trend_vals else None,
        "net_cash": (dcf.get("cash") or 0) - (dcf.get("total_debt") or 0),
        "shares_outstanding": shares_out,
        "dcf_assumptions": build_dcf_guidance(dcf, thesis_scores),
        "momentum": None,  # only computed in the full weekly refresh (see refresh_undervalued_screener) — real historical-price fetch, too costly for the bootstrap subset scan
        "thesis_scores": thesis_scores,
        "weak_dimension": _weak_dimension(thesis_scores),
        "liquidity_gate": data.get("liquidity_gate"),
        # AI text (blurb + checklist reasons), keyed by language —
        # filled in during the full weekly refresh only (see
        # refresh_undervalued_screener). get_undervalued() reads
        # the requested language at serve time.
        "blurb_by_lang": {},
        "business_understanding_by_lang": {},
        "checklist_reasons_by_lang": {},
        "checklist_items_real": data.get("checklist_items_real") or [],
    }


def _scan(tickers: list[dict], analysis_cache: Optional[dict[str, Optional[dict]]] = None) -> list[dict]:
    """Runs the real DCF engine over the given ticker entries, keeps only
    positive-margin-of-safety results that also pass the data-quality gate
    (_passes_quality_gate), sorted descending. Per-ticker try/except — one
    bad ticker must never abort the whole batch.

    Parallelized with a bounded thread pool (_SCAN_MAX_WORKERS) — this scan
    now covers the full S&P 500 (~500+ tickers, see screener.py's UNIVERSE),
    and each ticker is several real blocking HTTP calls; sequential would
    make the weekly refresh job's duration scale linearly with universe
    size. Callers on the async side must still wrap this in asyncio.to_thread
    (it blocks until every worker thread finishes).

    `analysis_cache`, when passed, is populated with EVERY scanned ticker's
    full analysis (not just the positive-margin-of-safety survivors kept in
    the return value) — a scan of the whole curated universe already
    computes most of what Method 3 (Relative Valuation)'s peer lookups need
    later in the same refresh, so this avoids re-fetching a same-sector
    peer that just isn't itself undervalued right now."""
    import concurrent.futures
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    def _fetch_one(entry: dict):
        try:
            # _compute_peer_dependent_data=False — this scan already runs get_fundamental_
            # analysis for the ENTIRE curated universe (~500+ tickers); doing
            # peer-fetching Consensus for every one of them here would fan out
            # into thousands of extra requests and duplicate the real Consensus
            # pass this module already does below (refresh_undervalued_screener,
            # lines ~325-391), on the smaller already-capped candidate list.
            data = get_fundamental_analysis(entry["ticker"], _compute_peer_dependent_data=False)
            return entry, data, None
        except Exception as exc:
            return entry, None, exc

    results = []
    excluded_by_quality_gate = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=_SCAN_MAX_WORKERS) as executor:
        futures = [executor.submit(_fetch_one, entry) for entry in tickers]
        for future in concurrent.futures.as_completed(futures):
            entry, data, exc = future.result()
            if exc is not None:
                logger.warning("undervalued_screener_service: %s failed: %s", entry["ticker"], exc)
                continue
            if analysis_cache is not None:
                analysis_cache[entry["ticker"]] = data
            dcf = data.get("dcf") if data else None
            if dcf:
                primary = _primary_valuation(dcf)
                mos = primary["margin_of_safety_pct"]
                if mos is not None and mos > 0 and not _passes_quality_gate(primary["confidence_meter"], dcf.get("data_quality_flags")):
                    excluded_by_quality_gate += 1
            candidate = _build_candidate(entry, data)
            if candidate is not None:
                results.append(candidate)
    if excluded_by_quality_gate:
        logger.info(
            "undervalued_screener_service: %d candidate(s) had a real positive margin of safety but were "
            "excluded by the data-quality gate (confidence < %d or missing debt/cash data)",
            excluded_by_quality_gate, _MIN_CONFIDENCE_SCORE,
        )
    # "Best Overall" default — the composite score (real business quality +
    # financial strength + predictability + growth + management, not just
    # discount) beats sorting by margin of safety alone, which rewards a
    # value trap just as readily as a real opportunity. Falls back to
    # margin of safety only for the rare case composite_score couldn't be
    # computed (missing thesis_scores), so a result is never silently
    # dropped for lack of one derived field.
    results.sort(key=lambda r: (r["composite_score"] if r["composite_score"] is not None else -1, r["margin_of_safety_pct"]), reverse=True)
    return results


_CHECKLIST_REASON_KEYS = ["moat", "business_quality", "management_capital_allocation", "financial_strength", "growth_predictability", "valuation"]
_SUPPORTED_LANGS = ("es", "en")


def _finalize_checklist(entry: dict, business_understanding: Optional[dict] = None, checklist_reasons: Optional[dict] = None, lang: str = "es") -> None:
    """Merges checklist item 1 ("Entender el negocio"/"Understanding the
    business" — Claude's judgment, or None if not evaluated) with items 2-7
    (real "stars" ratings, 1-5, computed by fundamental_analysis_service.
    _build_checklist_items) into the final 7-item checklist + average-stars
    score, mutating `entry` in place. If Claude returned `checklist_reasons`
    (see ai_service._CHECKLIST_INSTRUCTIONS), those nuanced ~70-word
    explanations OVERWRITE items 2-7's templated "reason" text — never their
    "stars" rating, which stays the real, deterministic value. The
    internal-only `evidence` field (raw numbers fed to Claude) is stripped
    before the checklist reaches the frontend. Only called on a per-request
    COPY of a cached entry (see get_undervalued) — never on the shared
    cached object, since it destructively pops `checklist_items_real` and
    this needs to run once per requested language, not once ever.

    Uses average stars (not "X/7 passed") deliberately — counting pass/fail
    made an excellent-but-currently-expensive business (e.g. PepsiCo: real
    moat, real quality, just not cheap right now) read as "mediocre" to
    users, the opposite of what the underlying scores say. See
    fundamental_analysis_service._stars_from_score's docstring."""
    items = list(entry.pop("checklist_items_real", []))
    checklist_reasons = checklist_reasons or {}
    for item, key in zip(items, _CHECKLIST_REASON_KEYS):
        reason_text = checklist_reasons.get(key)
        if reason_text:
            item["reason"] = reason_text
        item.pop("evidence", None)
    items.insert(0, business_understanding or {
        "key": "business_understanding",
        "name": "Entender el negocio" if lang != "en" else "Understanding the business",
        "stars": None,
        "reason": "No evaluado en esta carga rápida." if lang != "en" else "Not evaluated in this quick load.",
    })
    rated = [it["stars"] for it in items if it.get("stars") is not None]
    avg_stars = round(sum(rated) / len(rated), 1) if rated else None
    entry["checklist"] = {"items": items, "avg_stars": avg_stars}


def _rotate_featured_order(results: list[dict]) -> list[dict]:
    """Rotates which _FEATURED_COUNT candidates appear FIRST each week, so
    the same 5 tickers aren't glued to the top of "Oportunidades" every
    single week — cycles through the top _FEATURED_POOL_SIZE candidates
    (already sorted by composite_score, so still all genuinely strong
    picks) in fixed-size slices.

    Deliberately stateless: the slice to feature is purely a function of
    the ISO week number, so this needs no extra DB row and is naturally
    idempotent if the weekly refresh job ever reruns mid-week (same week
    number → same featured slice, not a fresh shuffle). Only reorders the
    pool — every real candidate that qualified is still in the list, just
    not always in the first 5 positions."""
    if len(results) <= _FEATURED_COUNT:
        return results
    from datetime import datetime
    import zoneinfo

    pool = results[:_FEATURED_POOL_SIZE]
    rest = results[_FEATURED_POOL_SIZE:]
    num_slices = max(1, len(pool) // _FEATURED_COUNT)
    iso_week = datetime.now(zoneinfo.ZoneInfo("America/New_York")).isocalendar().week
    slice_idx = iso_week % num_slices
    start = slice_idx * _FEATURED_COUNT
    featured = pool[start:start + _FEATURED_COUNT]
    featured_tickers = {r["ticker"] for r in featured}
    remaining_pool = [r for r in pool if r["ticker"] not in featured_tickers]
    return featured + remaining_pool + rest


async def refresh_undervalued_screener() -> None:
    """Full weekly refresh — the entire curated universe (now the real S&P
    500, see screener.py's UNIVERSE). Caches EVERY real positive-margin-of-
    safety + data-quality-gate-passing candidate (potentially 100-200+ once
    the universe grew from ~183 to the full index), not just a handful —
    that full list is what the Oportunidades screen browses/filters. Only
    the per-sector-capped subset (_MAX_PER_SECTOR, `featured=True`) gets the
    expensive per-candidate enrichment below (Relative/Historical Valuation,
    AI blurb in both languages) — that cost stays bounded regardless of how
    large the universe grows, since _MAX_PER_SECTOR × sector count doesn't
    change with it. Non-featured candidates are still real, still DCF-backed
    (see _scan/_build_candidate), just shown with a simpler card (no blurb,
    no relative/historical reference points) — see get_undervalued()'s
    `per_sector_cap` param and OpportunitiesListPanel.tsx on the frontend.

    Generates the AI text (blurb, business-understanding judgment, checklist
    reasons) ONCE PER SUPPORTED LANGUAGE per FEATURED candidate — doubling
    the Claude calls here (still a weekly batch job, not a live request) is
    how English UI users get real, non-mixed-language checklist text instead
    of either always seeing Spanish or paying for a live translation call
    per read. Nothing is finalized into a single "checklist" here — that
    merge happens per-request, per-language, in get_undervalued()."""
    from app.api.routes.screener import UNIVERSE
    analysis_cache: dict[str, Optional[dict]] = {}
    all_results = _scan(UNIVERSE, analysis_cache=analysis_cache)
    featured = _cap_per_sector(all_results, _MAX_PER_SECTOR)
    featured_tickers = {r["ticker"] for r in featured}
    for entry in all_results:
        entry["featured"] = entry["ticker"] in featured_tickers

    # Relative/Historical Valuation — deliberately only run here, on the
    # featured (per-sector-capped, ~30-55 tickers) subset, never in the live
    # quick-analysis path: Relative alone means a full analysis per real
    # peer, and Historical means a real historical-price fetch — exactly the
    # kind of per-request cost this weekly batch job exists to amortize
    # instead. Consensus Engine (which used to blend these with Conservative/
    # Professional DCF here) is retired — Incremento 12, Nuvos AI Fair Value
    # Engine redesign; the single engine's Bear/Base/Bull is what's shown.
    from app.services.relative_valuation_service import compute_relative_valuation
    from app.services.historical_valuation_service import compute_historical_valuation
    from app.services.fundamental_analysis_service import get_financials

    for entry in featured:
        try:
            candidate_data = analysis_cache.get(entry["ticker"]) or {}
            dcf = candidate_data.get("dcf") or {}
            thesis_scores = candidate_data.get("thesis_scores") or {}
            price = entry.get("price")
            shares_out = dcf.get("shares_outstanding") or dcf.get("shares_out")
            total_debt = candidate_data.get("total_debt") or 0
            cash = candidate_data.get("cash") or 0
            sector = entry.get("sector")

            fin = get_financials(entry["ticker"], limit=10)
            income = fin.get("incomeStatement", {}).get("annual", [])
            balance = fin.get("balanceSheet", {}).get("annual", [])
            cashflow = fin.get("cashFlow", {}).get("annual", [])
            n = min(len(income), len(balance), len(cashflow))
            income, balance, cashflow = income[-n:], balance[-n:], cashflow[-n:]
            latest_income = income[-1] if income else {}
            latest_eps = latest_income.get("Diluted EPS") or latest_income.get("Basic EPS")
            latest_ebitda = latest_income.get("EBITDA")
            fcf_trend_vals = [v for v in (candidate_data.get("fcf_trend") or []) if v is not None]
            latest_fcf = fcf_trend_vals[-1] if fcf_trend_vals else None
            industry = next((u["industry"] for u in UNIVERSE if u["ticker"] == entry["ticker"]), None)

            relative = None
            historical = None
            if price and shares_out:
                relative = compute_relative_valuation(
                    entry["ticker"], price, shares_out, latest_eps, latest_ebitda, latest_fcf,
                    total_debt, cash, sector, industry, analysis_cache=analysis_cache,
                )
                if n >= 5:
                    historical = compute_historical_valuation(
                        entry["ticker"], income, balance, cashflow, price, shares_out, total_debt, cash,
                        latest_eps, latest_ebitda, latest_fcf,
                    )

            entry["relative_valuation"] = relative
            entry["historical_valuation"] = historical
            # Nuvos AI Fair Value Engine redesign, Incremento 11 (THE FLIP) —
            # `fair_value_range` is now just this candidate's own Bear/Base/
            # Bull scenarios (already computed by get_fundamental_analysis,
            # on `dcf["nuvos_fair_value"]`); no longer refreshed from this
            # loop's Consensus. Same helper as everywhere else this range
            # is built.
            from app.services.fundamental_analysis_service import combine_fair_value_range
            entry["fair_value_range"] = combine_fair_value_range(dcf.get("nuvos_fair_value"), entry.get("fair_value_range") or {})
        except Exception as exc:
            # NOTE: deliberately does NOT touch entry["current_fcf"] /
            # "net_cash" / "shares_outstanding" / "dcf_assumptions" here —
            # _scan() already set those correctly for every entry, before
            # this relative/historical valuation enrichment step ever runs.
            # A single rate-limited get_financials() call in this loop used
            # to null out the DCF calculator's real inputs for every ticker
            # after it, even though nothing was wrong with them — this
            # except is only about relative/historical valuation failing.
            logger.warning("undervalued_screener_service: valuation engine (relative/historical) failed for %s: %s", entry["ticker"], exc)
            entry["relative_valuation"] = None
            entry["historical_valuation"] = None

        try:
            entry["momentum"] = _compute_momentum(entry["ticker"], entry.get("price"))
        except Exception as exc:
            logger.warning("undervalued_screener_service: momentum failed for %s: %s", entry["ticker"], exc)
            entry["momentum"] = None

    from app.services.ai_service import generate_candidate_blurb
    for entry in featured:
        for lang in _SUPPORTED_LANGS:
            # One retry on a genuine failure (network hiccup, rate limit) —
            # get_undervalued used to silently fall back to the Spanish
            # blurb when the English one was simply missing here, showing
            # Spanish text under an English UI with no indication. Retrying
            # once means that gap is rare, and get_undervalued no longer
            # crosses languages at all (see its own fix below), so a
            # still-missing blurb now shows nothing rather than the wrong
            # language.
            for attempt in range(2):
                try:
                    blurb_result = await generate_candidate_blurb(entry, lang=lang)
                    entry["blurb_by_lang"][lang] = blurb_result.get("blurb")
                    entry["business_understanding_by_lang"][lang] = {
                        "key": "business_understanding",
                        "name": "Entender el negocio" if lang == "es" else "Understanding the business",
                        "stars": blurb_result.get("business_understanding_stars"),
                        "reason": blurb_result.get("business_understanding_reason", ""),
                    }
                    entry["checklist_reasons_by_lang"][lang] = blurb_result.get("checklist_reasons") or {}
                    break
                except Exception as exc:
                    logger.warning("undervalued_screener_service: blurb (%s) attempt %d failed for %s: %s", lang, attempt + 1, entry["ticker"], exc)

    all_results = _rotate_featured_order(all_results)
    cache_set(CACHE_KEY, all_results, CACHE_TTL)
    logger.info(
        "undervalued_screener_service: refreshed, %d/%d tickers had a real positive margin of safety "
        "(%d featured/enriched)", len(all_results), len(UNIVERSE), len(featured),
    )

    # Valuation Backtest panel ("What $10,000 became") — reuses THIS scan's
    # own analysis_cache (every ticker in UNIVERSE, not just the positive-MoS
    # survivors kept in `results`), so it costs zero extra get_fundamental_
    # analysis calls. See valuation_backtest_service.py's module docstring
    # for why this is real-data-honest despite not being a true point-in-time
    # backtest. Its own failure must never affect the screener refresh above.
    try:
        from app.services.valuation_backtest_service import refresh_valuation_backtest
        await refresh_valuation_backtest(analysis_cache)
    except Exception as exc:
        logger.warning("undervalued_screener_service: valuation backtest refresh failed: %s", exc)


async def refresh_if_empty_on_startup() -> None:
    """Called once when worker.py boots — if EITHER this screener's own
    cache OR the valuation-backtest cache (piggy-backed onto this same
    refresh, see its tail above) is empty, do the FULL refresh immediately
    instead of waiting for the next scheduled Sunday run. A no-op only when
    both already have data — this is what lets a newly-added dependent
    cache (like the backtest one) self-heal on the next worker restart
    after a deploy, without needing an admin to manually trigger
    /admin/refresh-undervalued-screener."""
    from app.services.valuation_backtest_service import CACHE_KEY as _BACKTEST_CACHE_KEY

    _, screener_ts = cache_get_with_ts(CACHE_KEY)
    _, backtest_ts = cache_get_with_ts(_BACKTEST_CACHE_KEY)
    if screener_ts and backtest_ts:
        return
    logger.info(
        "undervalued_screener_service: cache empty at worker startup (screener=%s, backtest=%s), refreshing now",
        bool(screener_ts), bool(backtest_ts),
    )
    await refresh_undervalued_screener()


def _diverse_bootstrap_sample(universe: list[dict], limit: int) -> list[dict]:
    """Round-robins across sectors instead of taking `universe[:limit]` —
    real bug found in production: UNIVERSE is now the real S&P 500 list,
    grouped and sorted alphabetically by sector (see screener.py), so a
    plain prefix slice used to silently return only "Communication
    Services" tickers (that sector sorts first alphabetically) whenever the
    cache went cold — the emergency fallback showing 5 candidates, all the
    same sector, was this bug, not a data problem. Distributing round-robin
    guarantees every sector gets a fair shot at the small bootstrap sample
    regardless of how UNIVERSE happens to be ordered."""
    by_sector: dict[str, list[dict]] = {}
    for entry in universe:
        by_sector.setdefault(entry.get("sector") or "", []).append(entry)
    buckets = list(by_sector.values())
    sample: list[dict] = []
    i = 0
    while len(sample) < limit and any(buckets):
        bucket = buckets[i % len(buckets)]
        if bucket:
            sample.append(bucket.pop(0))
        i += 1
        if i > limit * len(buckets):  # safety valve — every bucket exhausted
            break
    return sample


def bootstrap_fill_if_empty_sync() -> None:
    """Blocking. Called from the read path (API endpoint / chat trigger)
    when the cache is completely empty — scans a small subset of the
    universe so the screener never shows a blank list, even before the
    worker's startup/weekly refresh has had a chance to run. Cached with a
    short TTL so the next full refresh (worker startup or the Sunday job)
    overwrites it with the complete, accurate scan."""
    from app.api.routes.screener import UNIVERSE
    results = _scan(_diverse_bootstrap_sample(UNIVERSE, _BOOTSTRAP_LIMIT))
    results = _cap_per_sector(results, _MAX_PER_SECTOR)
    for entry in results:
        entry["featured"] = True  # every bootstrap entry stayed within the cap — same shape as a full refresh's featured candidates
    # Deliberately NOT finalized here (no AI calls, no language pref known
    # yet at this layer) — left in the same un-finalized shape as a full
    # refresh's results, so get_undervalued()'s per-request/per-language
    # finalize step works identically regardless of which path populated
    # the cache. Real checklist "reason" text still shows the deterministic
    # Python templates until the next full refresh replaces this bootstrap
    # entry with real AI-generated text in both languages.
    if results:
        cache_set(CACHE_KEY, results, BOOTSTRAP_TTL)
        logger.info("undervalued_screener_service: bootstrap-filled %d results from a %d-ticker subset", len(results), _BOOTSTRAP_LIMIT)


def _compute_momentum(ticker: str, current_price: Optional[float]) -> Optional[dict]:
    """Real short/medium-term price-momentum signal for the "Momentum Turns"
    ranking lens, computed from actual historical closes (financial_data_
    service.get_historical_prices_near_dates — the same real FMP historical-
    price endpoint Method 4 uses), never invented. `turn_score` is
    return_1m_pct - return_6m_pct: positive when a stock has been recovering
    recently (up over the last month) after a longer decline (down over the
    last six months) — a genuine "turning around while still cheap" signal,
    distinct from raw momentum-chasing. Returns None (never a fabricated 0)
    if either real historical price is unavailable."""
    if not current_price:
        return None
    import datetime
    from app.services.financial_data_service import get_historical_prices_near_dates

    today = datetime.date.today()
    date_1m = (today - datetime.timedelta(days=30)).isoformat()
    date_6m = (today - datetime.timedelta(days=182)).isoformat()
    try:
        prices = get_historical_prices_near_dates(ticker, [date_1m, date_6m])
    except Exception:
        return None
    price_1m, price_6m = prices.get(date_1m), prices.get(date_6m)
    if not price_1m or not price_6m:
        return None
    return_1m_pct = round((current_price - price_1m) / price_1m * 100, 1)
    return_6m_pct = round((current_price - price_6m) / price_6m * 100, 1)
    return {
        "return_1m_pct": return_1m_pct,
        "return_6m_pct": return_6m_pct,
        "turn_score": round(return_1m_pct - return_6m_pct, 1),
    }


def _cap_per_sector(results: list[dict], max_per_sector: int) -> list[dict]:
    """Keeps at most `max_per_sector` entries per sector — results are
    already sorted by margin of safety descending, so this keeps each
    sector's BEST candidates, not an arbitrary subset. A sector with fewer
    than max_per_sector real candidates just contributes fewer — never
    padded to reach the cap."""
    counts: dict[str, int] = {}
    capped = []
    for r in results:
        sector = r.get("sector") or "N/D"
        counts[sector] = counts.get(sector, 0) + 1
        if counts[sector] <= max_per_sector:
            capped.append(r)
    return capped


def get_undervalued(limit: int = 60, sector: Optional[str] = None, lang: str = "es", per_sector_cap: Optional[int] = _MAX_PER_SECTOR) -> dict:
    """Fast, cache-only read. `generated_at` (unix timestamp, 0 if the cache
    is empty) lets callers disclose honestly how stale the snapshot is.
    Callers should call bootstrap_fill_if_empty_sync() first if they need a
    guarantee of non-empty results (see screener.py's endpoint and chat.py's
    context-block builder).

    `per_sector_cap` defaults to _MAX_PER_SECTOR (5) — every EXISTING caller
    (chat.py's context block, the weekly-picks-adjacent callers) keeps
    exactly the old "top ~5 per sector, fully AI-enriched" behavior without
    passing anything. Pass `per_sector_cap=None` (or a higher number) to
    browse the full real, DCF-backed universe cached by refresh_undervalued_
    screener — every candidate is a genuine positive-margin-of-safety result
    that passed the data-quality gate, but only the `featured=True` ones
    (still capped at 5/sector) carry the AI blurb and relative/historical
    valuation; the rest serve their real numeric fields with those as null
    (see refresh_undervalued_screener's docstring) — the frontend's
    OpportunitiesListPanel renders a simpler card for those instead of
    inventing text.

    The cache stores AI text keyed by language (see refresh_undervalued_
    screener) — this is where the requested `lang` is actually applied,
    on a per-request DEEP COPY of each cached entry (never mutating the
    shared cached object, since the same cache entry is finalized
    differently for an "es" request and an "en" request)."""
    lang = lang if lang in _SUPPORTED_LANGS else "es"
    results, ts = cache_get_with_ts(CACHE_KEY)
    results = results or []
    if sector:
        results = [r for r in results if (r.get("sector") or "").lower() == sector.lower()]
    if per_sector_cap is not None:
        results = _cap_per_sector(results, per_sector_cap)

    finalized = []
    for r in results[:limit]:
        # One malformed/stale cached entry (e.g. from an older cache-schema
        # version) must never take down the entire list — same "one bad
        # ticker can't abort the batch" rule already used in _scan().
        try:
            entry = copy.deepcopy(r)
            blurb_by_lang = entry.pop("blurb_by_lang", {}) or {}
            business_understanding_by_lang = entry.pop("business_understanding_by_lang", {}) or {}
            checklist_reasons_by_lang = entry.pop("checklist_reasons_by_lang", {}) or {}
            weak_dimension = entry.pop("weak_dimension", None)

            # Never cross languages — a missing English blurb used to
            # silently fall back to the Spanish one, showing Spanish text
            # under an English UI with no indication. Better to show nothing
            # for that one entry than the wrong language.
            entry["blurb"] = blurb_by_lang.get(lang)
            entry["weak_dimension_warning"] = _format_weak_dimension_warning(weak_dimension, lang)
            # checklist_items_real may already be gone if this entry was
            # finalized once by an older cache version — nothing to merge in
            # that case, "checklist" (if present) is left as-is.
            if "checklist_items_real" in entry:
                _finalize_checklist(
                    entry,
                    business_understanding_by_lang.get(lang),
                    checklist_reasons_by_lang.get(lang),
                    lang=lang,
                )
            finalized.append(entry)
        except Exception as exc:
            logger.warning("get_undervalued: skipping malformed cached entry for %s: %s", r.get("ticker"), exc)

    return {"results": finalized, "generated_at": ts}
