"""
Nuvos Investor Recap
====================
Monthly, Spotify-Wrapped-style personal report — "este mes no solamente
invertiste, mejoraste tu proceso para tomar decisiones." See
/Users/diegoarria/.claude/plans (architecture audit, 2026-09-08) for the
full spec this implements.

Hard rule, same as investor_progress_service.py: every number here must
trace back to real, storable data. A metric that can't be computed from
what actually exists is omitted (None) — never zero-filled, guessed, or
invented. AI-generated text (see ai_service.generate_recap_insights) only
ever receives already-computed real facts, never raw access to anything.

Deliberately reuses, rather than re-derives:
  - wrapped.py's _position_returns / _cash_holdings_total_usd /
    _dividend_income_total / _company_names (the annual report's own
    real-money helpers — a monthly report must never disagree with the
    annual one about what "your portfolio value" means).
  - investor_progress_service._build_context and its private signal
    helpers (_decision_style_ratio, _avg_holding_days,
    _find_significant_drawdowns, _held_through_drawdown,
    _consecutive_months_streak) — same cross-module reuse convention
    wrapped.py itself already uses for this module.
  - investment_graph_service for research/thesis signals.
  - market._compute_portfolio_chart (extended with optional custom_start/
    custom_end — see that function's own docstring) for the real,
    benchmark-compared monthly return.

No new monthly-snapshot table: the recap is computed live and cached in
Redis (see get_monthly_recap's cache_key) — same "compute live + cache"
pattern Wrapped already uses, not a second parallel aggregation system.
The one real piece of NEW persistence is which achievements a user has
already unlocked (migration 091) — that's a fact, not a derived number.
"""
from __future__ import annotations

import asyncio
import calendar
import logging
from datetime import date, datetime, timezone
from typing import Optional

from app.core.cache import cache_get, cache_set
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

_RECAP_CACHE_TTL = 6 * 3600  # 6h — short enough that today's new decision/thesis shows up same-day


# ── Month window ─────────────────────────────────────────────────────────

def _month_bounds(year: int, month: int) -> tuple[date, date, bool]:
    """(start, end, is_current_month). `end` is clamped to today for the
    current in-progress month — a Recap for "September" viewed on Sep 12
    honestly covers Sep 1-12, never a fabricated full-month projection."""
    last_day = calendar.monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(year, month, last_day)
    today = date.today()
    is_current = (year, month) == (today.year, today.month)
    if is_current:
        end = today
    return start, end, is_current


def _in_month(iso_date: Optional[str], start: date, end: date) -> bool:
    if not iso_date:
        return False
    try:
        d = date.fromisoformat(str(iso_date)[:10])
    except Exception:
        return False
    return start <= d <= end


# ── Context filtering (for "evolution": recent vs. prior period) ───────────

def _ctx_as_of(ctx: dict, cutoff: date) -> dict:
    """Pure function: re-derives a ctx-shaped dict using only the subset of
    positions/closed_positions/decisions/snapshots dated on/before cutoff —
    lets the SAME signal helpers (investor_progress_service's private
    functions) run against "the account as it looked back then" instead of
    "the account as it looks today", without a second data-fetch."""
    def _before(item: dict, field: str) -> bool:
        d = item.get(field)
        if not d:
            return False
        try:
            return date.fromisoformat(str(d)[:10]) <= cutoff
        except Exception:
            return False

    positions = [p for p in ctx["positions"] if _before(p, "purchaseDate")]
    closed = [c for c in ctx["closed_positions"] if _before(c, "closeDate")]
    decisions = [d for d in ctx["decisions"] if (d.get("created_at") or "")[:10] <= cutoff.isoformat()]
    snapshots = [s for s in ctx["snapshots"] if (s.get("snapshot_date") or "") <= cutoff.isoformat()]

    total_operations = len(positions) + len(closed)
    capital_invested = sum(float(p.get("shares", 0) or 0) * float(p.get("avgPrice", 0) or 0) for p in positions)
    capital_invested += sum(float(c.get("shares", 0) or 0) * float(c.get("avgPrice", 0) or 0) for c in closed)

    days_since_inception = None
    if ctx.get("inception_date"):
        try:
            inc = date.fromisoformat(str(ctx["inception_date"])[:10])
            if inc <= cutoff:
                days_since_inception = (cutoff - inc).days
        except Exception:
            pass

    purchase_months = {
        (date.fromisoformat(str(item["purchaseDate"])[:10]).year, date.fromisoformat(str(item["purchaseDate"])[:10]).month)
        for item in positions + closed if item.get("purchaseDate")
    }

    return {
        **ctx,
        "positions": positions,
        "closed_positions": closed,
        "decisions": decisions,
        "snapshots": snapshots,
        "total_operations": total_operations,
        "capital_invested": capital_invested,
        "days_since_inception": days_since_inception,
        "purchase_months": purchase_months,
        "latest_snapshot": snapshots[-1] if snapshots else None,
    }


# ── Section: Portfolio ──────────────────────────────────────────────────

# Maps the GQV engine's real Lynch-style per-company classification
# (dcf["gqv_fair_value"]["classification"]["category"]) onto the 4 buckets
# the Recap shows — never a new, independently-invented classification.
# financial + unknown fall outside the 4 named buckets (shown as "Otro" if
# present) rather than force-fit into one that doesn't really describe them.
_GQV_TO_COMPOSITION_BUCKET = {
    "fast_grower": "growth",
    "stalwart": "quality",
    "asset_play": "value",
    "cyclical": "value",
    "slow_grower": "defensive",
    "turnaround": None,   # too situational to bucket honestly
    "financial": None,
    "unknown": None,
}


async def _build_portfolio_composition(positions: list[dict]) -> Optional[dict]:
    """Weighted rollup of real per-company GQV classifications across the
    CURRENT portfolio — reuses get_fundamental_analysis (same function
    every valuation screen in the app already calls), never a new
    valuation path. None when there are no priced/classifiable positions."""
    if not positions:
        return None
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    by_ticker: dict[str, float] = {}
    for p in positions:
        t = p.get("ticker")
        if not t:
            continue
        cost = float(p.get("shares", 0) or 0) * float(p.get("avgPrice", 0) or 0)
        by_ticker[t] = by_ticker.get(t, 0.0) + cost
    total_cost = sum(by_ticker.values())
    if total_cost <= 0:
        return None

    tickers = list(by_ticker.keys())
    analyses = await asyncio.gather(
        *[asyncio.to_thread(get_fundamental_analysis, t, _compute_peer_dependent_data=False) for t in tickers],
        return_exceptions=True,
    )

    buckets = {"growth": 0.0, "quality": 0.0, "value": 0.0, "defensive": 0.0, "other": 0.0}
    classified_weight = 0.0
    for t, data in zip(tickers, analyses):
        if isinstance(data, Exception) or not data:
            continue
        category = (((data.get("dcf") or {}).get("gqv_fair_value") or {}).get("classification") or {}).get("category")
        weight = by_ticker[t] / total_cost
        bucket = _GQV_TO_COMPOSITION_BUCKET.get(category)
        buckets[bucket or "other"] += weight
        classified_weight += weight

    if classified_weight < 0.3:
        # Too little of the portfolio was classifiable to say anything
        # honest about "composition" — omit rather than describe 20% of
        # the portfolio as if it were the whole picture.
        return None
    return {k: round(v * 100, 1) for k, v in buckets.items() if v > 0}


async def _build_portfolio_section(positions: list[dict], start: date, end: date) -> dict:
    from app.api.routes.market import _compute_portfolio_chart, _PortfolioReturnsItem
    from app.api.routes.watchlist import _fetch_prices_batch

    items = [
        _PortfolioReturnsItem(
            ticker=p.get("ticker", ""), shares=float(p.get("shares", 0) or 0),
            purchase_date=p.get("purchaseDate"), avg_price=float(p.get("avgPrice", 0) or 0) or None,
        )
        for p in positions if p.get("ticker")
    ]
    result: dict = {"available": False, "return_pct": None, "benchmark_pct": None, "diff_pp": None,
                     "best_position": None, "worst_position": None, "composition": None}
    if not items:
        return result

    custom_start = datetime(start.year, start.month, start.day)
    custom_end = datetime(end.year, end.month, end.day, 23, 59, 59)
    chart = await asyncio.to_thread(_compute_portfolio_chart, items, "custom", custom_start, custom_end)
    if chart.get("history"):
        result["available"] = True
        result["return_pct"] = chart.get("period_pct")
        result["benchmark_pct"] = chart.get("spy_pct")
        if result["return_pct"] is not None and result["benchmark_pct"] is not None:
            result["diff_pp"] = round(result["return_pct"] - result["benchmark_pct"], 2)

    # Best/worst position BY PRICE MOVE this month specifically (distinct
    # from Wrapped's lifetime cost-basis "top posiciones") — real close
    # prices at month-start vs. month-end/today for each currently-held
    # ticker, from the same historical-price fetch _compute_portfolio_chart
    # itself uses.
    tickers = list(dict.fromkeys(p.get("ticker") for p in positions if p.get("ticker")))
    if tickers:
        from app.api.routes.market import _build_close_df, _safe_price
        start_ts, end_ts = int(custom_start.timestamp()), int(custom_end.timestamp())
        close_df, _ = await asyncio.to_thread(_build_close_df, tickers, start_ts, end_ts, "1d")
        if close_df is not None and not close_df.empty and len(close_df) >= 2:
            moves = []
            for t in tickers:
                if t not in close_df.columns:
                    continue
                first_p = _safe_price(close_df.iloc[0], t)
                last_p = _safe_price(close_df.iloc[-1], t)
                if first_p > 0 and last_p > 0:
                    moves.append({"ticker": t, "move_pct": round((last_p - first_p) / first_p * 100, 2)})
            if moves:
                names = await _company_names_safe([m["ticker"] for m in moves])
                moves.sort(key=lambda m: m["move_pct"], reverse=True)
                best, worst = moves[0], moves[-1]
                best["company_name"] = names.get(best["ticker"])
                worst["company_name"] = names.get(worst["ticker"])
                result["best_position"] = best
                if worst["ticker"] != best["ticker"]:
                    result["worst_position"] = worst

    result["composition"] = await _build_portfolio_composition(positions)
    return result


async def _company_names_safe(tickers: list[str]) -> dict[str, Optional[str]]:
    from app.core.finnhub import fh_profile
    profiles = await asyncio.gather(*[asyncio.to_thread(fh_profile, t) for t in tickers], return_exceptions=True)
    return {t: ((p or {}).get("name") if not isinstance(p, Exception) else None) for t, p in zip(tickers, profiles)}


# ── Section: Decisions ───────────────────────────────────────────────────

async def _build_decisions_section(user_id: str, positions: list[dict], closed_positions: list[dict], start: date, end: date) -> dict:
    from app.api.routes.decisions import _get_decisions

    buys = [p for p in positions + closed_positions if _in_month(p.get("purchaseDate"), start, end)]
    sells = [c for c in closed_positions if _in_month(c.get("closeDate"), start, end)]
    # "Held" = currently-open positions that already existed BEFORE this
    # month and are still open — a real, observable state (persisted
    # through the month unchanged), never a fabricated "decision to hold".
    holds = [p for p in positions if p.get("purchaseDate") and not _in_month(p.get("purchaseDate"), start, end)
             and date.fromisoformat(str(p["purchaseDate"])[:10]) < start]

    all_decisions = await _get_decisions(user_id, limit=500)
    month_decisions = [d for d in all_decisions if _in_month(d.get("created_at"), start, end)]

    facts = {
        "buys": [{"ticker": b.get("ticker"), "shares": b.get("shares")} for b in buys],
        "sells": [{"ticker": s.get("ticker"), "shares": s.get("shares"),
                    "pnl_pct": round((float(s.get("closePrice", 0) or 0) - float(s.get("avgPrice", 0) or 0)) / float(s["avgPrice"]) * 100, 1)
                    if s.get("avgPrice") else None} for s in sells],
        "holds_count": len(holds),
        "logged_decisions": [
            {"action": d.get("action"), "ticker": d.get("ticker"), "trigger": d.get("trigger")}
            for d in month_decisions
        ],
    }

    return {
        "total": len(buys) + len(sells) + len(holds),
        "buys_count": len(buys),
        "sells_count": len(sells),
        "holds_count": len(holds),
        "facts": facts,  # fed to generate_recap_insights, never shown raw to the user
        "has_activity": bool(buys or sells),
    }


# ── Section: Research ────────────────────────────────────────────────────

_CATEGORY_LABEL = {
    "fast_grower": "Growth", "stalwart": "Quality", "cyclical": "Cíclica",
    "asset_play": "Value", "slow_grower": "Defensiva", "turnaround": "Turnaround",
    "financial": "Financiera", "unknown": None,
}


async def _build_research_section(user_id: str, year: int, month: int) -> dict:
    from app.services import investment_graph_service
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    companies = await investment_graph_service.get_most_analyzed_companies_in_month(user_id, year, month, limit=5)
    top = companies["top"]
    total = companies["total_companies"]

    # Real research pattern: the GQV classification of each distinct
    # ticker analyzed this month, in the real chronological order they
    # were first analyzed — never an invented narrative sequence.
    pattern: Optional[list[str]] = None
    chron = companies.get("chronological_tickers") or []
    if len(chron) >= 2:
        analyses = await asyncio.gather(
            *[asyncio.to_thread(get_fundamental_analysis, t, _compute_peer_dependent_data=False) for t in chron[:6]],
            return_exceptions=True,
        )
        labels = []
        for data in analyses:
            if isinstance(data, Exception) or not data:
                continue
            category = (((data.get("dcf") or {}).get("gqv_fair_value") or {}).get("classification") or {}).get("category")
            label = _CATEGORY_LABEL.get(category)
            if label and (not labels or labels[-1] != label):  # collapse consecutive repeats
                labels.append(label)
        if len(labels) >= 2:
            pattern = labels

    return {
        "companies_researched": total,
        "top_companies": top,
        "favorite_company": top[0] if top else None,
        "research_pattern": pattern,  # e.g. ["Growth", "Quality"] — None if not derivable
    }


# ── Section: Wealth (PRIVATE — never in the share card) ────────────────────

async def _build_wealth_section(user_id: str, positions: list[dict], start: date, end: date, is_current: bool) -> dict:
    from app.api.routes.wrapped import _cash_holdings_total_usd, _dividend_income_total
    from app.api.routes.market import _compute_portfolio_chart, _PortfolioReturnsItem, _build_close_df, _safe_price

    items = [
        _PortfolioReturnsItem(ticker=p.get("ticker", ""), shares=float(p.get("shares", 0) or 0),
                               purchase_date=p.get("purchaseDate"), avg_price=float(p.get("avgPrice", 0) or 0) or None)
        for p in positions if p.get("ticker")
    ]
    cash_value, dividend_value = await asyncio.gather(
        _cash_holdings_total_usd(user_id), _dividend_income_total(user_id),
    )

    stocks_value_now = 0.0
    stocks_value_month_start = None
    if items:
        tickers = list(dict.fromkeys(p.ticker for p in items))
        end_dt = datetime(end.year, end.month, end.day, 23, 59, 59)
        start_dt = datetime(start.year, start.month, start.day)
        close_df, rt_prices = await asyncio.to_thread(_build_close_df, tickers, int(start_dt.timestamp()), int(end_dt.timestamp()), "1d")
        if close_df is not None and not close_df.empty:
            last_row = close_df.iloc[-1]
            first_row = close_df.iloc[0]
            for p in items:
                t = p.ticker
                if t not in close_df.columns:
                    continue
                end_price = rt_prices.get(t) if (is_current and rt_prices and t in rt_prices) else _safe_price(last_row, t)
                stocks_value_now += p.shares * (end_price or 0)
            stocks_value_month_start = sum(p.shares * _safe_price(first_row, p.ticker) for p in items if p.ticker in close_df.columns)

    portfolio_value = round(stocks_value_now + cash_value + dividend_value, 2)
    variation_pct = None
    if stocks_value_month_start and stocks_value_month_start > 0:
        variation_pct = round((stocks_value_now - stocks_value_month_start) / stocks_value_month_start * 100, 2)

    return {
        "available": bool(items or cash_value or dividend_value),
        "portfolio_value": portfolio_value if (items or cash_value or dividend_value) else None,
        "variation_pct": variation_pct,
        "stocks_value": round(stocks_value_now, 2) if items else None,
        "cash_value": round(cash_value, 2) if cash_value else None,
        "dividend_value": round(dividend_value, 2) if dividend_value else None,
    }


# ── Section: Habits ───────────────────────────────────────────────────────

_WEEKDAY_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

# Which investment_graph event types + decision-log entries count as real
# "activity" for streak/day-count purposes — explicitly NEVER just opening
# the app (Diego's spec: "no contar simplemente abrir la aplicación").
_ACTIVITY_EVENT_TYPES = {"thesis", "question", "watchlist_add", "watchlist_remove"}


async def _build_habits_section(user_id: str, start: date, end: date, decisions_this_month: list[dict]) -> dict:
    from app.services.investment_graph_service import _fetch_graph_events

    events = await _fetch_graph_events(user_id, None, limit=1000)
    month_events = [e for e in events if _in_month(e.get("occurred_at"), start, end) and e.get("event_type") in _ACTIVITY_EVENT_TYPES]

    active_dates: set[date] = set()
    for e in month_events:
        try:
            active_dates.add(date.fromisoformat(str(e["occurred_at"])[:10]))
        except Exception:
            pass
    for d in decisions_this_month:
        try:
            active_dates.add(date.fromisoformat(str(d["created_at"])[:10]))
        except Exception:
            pass

    active_days = len(active_dates)

    # Longest run of consecutive active days within the month — real, from
    # the same active_dates set, never the (unrelated) Academy streak.
    longest_streak = 0
    if active_dates:
        sorted_dates = sorted(active_dates)
        run = 1
        longest_streak = 1
        for prev, curr in zip(sorted_dates, sorted_dates[1:]):
            if (curr - prev).days == 1:
                run += 1
                longest_streak = max(longest_streak, run)
            else:
                run = 1

    weekday_counts = [0] * 7
    for d in active_dates:
        weekday_counts[d.weekday()] += 1
    favorite_weekday = _WEEKDAY_ES[weekday_counts.index(max(weekday_counts))] if active_days else None

    activity_breakdown = {
        "analizar": sum(1 for e in month_events if e["event_type"] in ("thesis", "question")),
        "seguimiento": sum(1 for e in month_events if e["event_type"] in ("watchlist_add", "watchlist_remove")),
        "decisiones": len(decisions_this_month),
    }

    return {
        "active_days": active_days,
        "longest_streak": longest_streak,
        "favorite_weekday": favorite_weekday,
        "activity_breakdown": activity_breakdown,
    }


# ── Section: Evolution — Investor Recap Archetype (distinct from Wrapped's) ─

_RECAP_ARCHETYPES = {
    "analyst": {"key": "analyst", "name": "THE ANALYST", "emoji": "🧠",
                "tagline": "Entiendes un negocio antes de tocarlo.",
                "traits": ["🧠 Analítico", "📊 Metódico", "🔍 Curioso"]},
    "compounder": {"key": "compounder", "name": "THE COMPOUNDER", "emoji": "📈",
                   "tagline": "Piensas en décadas, no en días.",
                   "traits": ["⏳ Largo plazo", "🧘 Paciente", "🏗️ Constructor"]},
    "hunter": {"key": "hunter", "name": "THE HUNTER", "emoji": "🦅",
               "tagline": "Siempre estás buscando la próxima idea.",
               "traits": ["🔭 Explorador", "⚡ Curioso", "🌐 Amplio"]},
    "quality_seeker": {"key": "quality_seeker", "name": "THE QUALITY SEEKER", "emoji": "💎",
                        "tagline": "Prefieres pagar más por un negocio mejor.",
                        "traits": ["💎 Selectivo", "🏰 Busca moats", "🎯 Exigente"]},
    "patient_one": {"key": "patient_one", "name": "THE PATIENT ONE", "emoji": "🦉",
                     "tagline": "No te apuras a decidir.",
                     "traits": ["🦉 Reflexivo", "⏱️ Deliberado", "🧘 Calmado"]},
    "contrarian": {"key": "contrarian", "name": "THE CONTRARIAN", "emoji": "🦈",
                   "tagline": "Cuando otros venden con miedo, tú miras con calma.",
                   "traits": ["🦈 Oportunista", "🧊 Frío bajo presión", "🎯 Independiente"]},
    "builder": {"key": "builder", "name": "THE BUILDER", "emoji": "🏗️",
                "tagline": "Construyes tu patrimonio mes a mes, sin pausa.",
                "traits": ["🏗️ Constante", "🧱 Disciplinado", "📅 Consistente"]},
}


async def _classify_recap_archetype(user_id: str, ctx: dict, portfolio_composition: Optional[dict]) -> Optional[dict]:
    """Deterministic — same scoring-dict-then-argmax pattern as investor_
    progress_service's own archetype classifiers, reusing its private
    signal helpers instead of re-deriving them. A NEW, separate 7-label
    system (not investor_progress_service's 4 or 5) per the Recap spec —
    but built from the exact same class of real signals, just different
    labels/thresholds, so it's additive, not a duplicate data pipeline."""
    from app.services import investment_graph_service
    from app.services.investor_progress_service import (
        _avg_holding_days, _decision_style_ratio, _find_significant_drawdowns,
        _held_through_drawdown, _consecutive_months_streak,
    )

    if ctx["total_operations"] < 3:
        return None

    graph_metrics = await investment_graph_service.compute_metrics(user_id)
    avg_holding_days = _avg_holding_days(ctx)
    style_ratio = _decision_style_ratio(ctx["decisions"])
    drawdowns = _find_significant_drawdowns(ctx["snapshots"])
    held_through_drawdown = bool(drawdowns) and _held_through_drawdown(ctx, drawdowns[0]["peak_date"])
    bought_during_drawdown = False
    if drawdowns:
        dd = drawdowns[0]
        for item in ctx["positions"] + ctx["closed_positions"]:
            pd = item.get("purchaseDate")
            if pd and dd["peak_date"] <= str(pd)[:10] <= dd["trough_date"]:
                bought_during_drawdown = True
                break
    consecutive_months = _consecutive_months_streak(ctx["purchase_months"])
    quality_weight = ((portfolio_composition or {}).get("quality", 0) + (portfolio_composition or {}).get("value", 0)) / 100

    thesis_count = graph_metrics.get("total_theses") or 0
    thesis_accuracy = graph_metrics.get("thesis_accuracy_pct")
    analyzed_never_bought = graph_metrics.get("analyzed_never_bought") or 0
    avg_deliberation_days = graph_metrics.get("avg_deliberation_days")

    scores = {
        "analyst": (2 if thesis_count >= 10 else 1 if thesis_count >= 3 else 0)
                 + (1 if thesis_accuracy is not None and thesis_accuracy >= 60 else 0),
        "compounder": (2 if avg_holding_days and avg_holding_days >= 365 else 1 if avg_holding_days and avg_holding_days >= 180 else 0)
                    + (1 if style_ratio is not None and style_ratio < 0.2 else 0),
        "hunter": 2 if analyzed_never_bought >= 5 else (1 if analyzed_never_bought >= 2 else 0),
        "quality_seeker": 2 if quality_weight >= 0.5 else (1 if quality_weight >= 0.3 else 0),
        "patient_one": (2 if avg_deliberation_days and avg_deliberation_days >= 14 else 1 if avg_deliberation_days and avg_deliberation_days >= 5 else 0)
                     + (1 if held_through_drawdown else 0),
        "contrarian": 2 if bought_during_drawdown else 0,
        "builder": 2 if consecutive_months >= 6 else (1 if consecutive_months >= 3 else 0),
    }
    if not any(scores.values()):
        return None
    return _RECAP_ARCHETYPES[max(scores, key=scores.get)]


async def _build_evolution_section(user_id: str, ctx: dict, portfolio_composition: Optional[dict]) -> dict:
    from dateutil.relativedelta import relativedelta

    current = await _classify_recap_archetype(user_id, ctx, portfolio_composition)
    cutoff = date.today() - relativedelta(months=6)
    past_ctx = _ctx_as_of(ctx, cutoff)
    past = await _classify_recap_archetype(user_id, past_ctx, None) if past_ctx["total_operations"] >= 3 else None

    changed = bool(current and past and current["key"] != past["key"])
    return {
        "current_archetype": current,
        "past_archetype": past if changed else None,  # only shown when it's a genuine change
        "months_compared": 6 if past else None,
    }


# ── Section: Next month ──────────────────────────────────────────────────

_MISSION_BY_WEAK_SUBSCORE = {
    "analisis": {"key": "investiga", "title": "Investiga",
                 "text": "Analiza al menos 3 empresas antes de tu próxima compra."},
    "paciencia": {"key": "documenta", "title": "Documenta",
                  "text": "Registra tu tesis antes de cada nueva decisión."},
    "diversificacion": {"key": "diversifica", "title": "Diversifica",
                         "text": "Explora una empresa fuera de tu sector principal este mes."},
    "educacion": {"key": "aprende", "title": "Aprende",
                  "text": "Completa un módulo nuevo en Academy."},
}


async def _build_next_month_section(investor_score: Optional[dict]) -> dict:
    missions = []
    if investor_score and investor_score.get("sub_scores"):
        # Lowest 3 sub-scores → the 3 missions, matching the spec's "no
        # recomendar algo en lo que el usuario ya es excelente por default".
        weakest = sorted(investor_score["sub_scores"].items(), key=lambda kv: kv[1])[:3]
        for key, _ in weakest:
            m = _MISSION_BY_WEAK_SUBSCORE.get(key)
            if m:
                missions.append(m)
    return {
        "missions": missions,  # [] when there's no score yet — frontend shows a generic-but-honest empty state
        "next_milestone": "Construir una tesis de inversión completa" if not missions else None,
    }


# ── Section: Achievements ────────────────────────────────────────────────

ACHIEVEMENTS = [
    {"id": "analista", "name": "ANALISTA", "description": "Analizaste tu primera empresa de principio a fin.",
     "icon": "🔬", "condition": lambda s: (s["total_theses"] or 0) >= 1},
    {"id": "constante", "name": "CONSTANTE", "description": "Mantuviste actividad durante 7 días consecutivos.",
     "icon": "🔥", "condition": lambda s: (s["longest_activity_streak"] or 0) >= 7},
    {"id": "explorador", "name": "EXPLORADOR", "description": "Investigaste 5 empresas nuevas.",
     "icon": "🧭", "condition": lambda s: (s["companies_analyzed_lifetime"] or 0) >= 5},
    {"id": "alumno", "name": "ALUMNO", "description": "Completaste 10 lecciones.",
     "icon": "🎓", "condition": lambda s: (s["lessons_completed"] or 0) >= 10},
    {"id": "disciplinado", "name": "DISCIPLINADO", "description": "Registraste tus decisiones antes de ejecutarlas.",
     "icon": "📝", "condition": lambda s: s["avg_deliberation_days"] is not None},
    {"id": "conviction", "name": "CONVICTION", "description": "Construiste y mantuviste una tesis de inversión.",
     "icon": "🛡️", "condition": lambda s: (s["longest_conviction_days"] or 0) >= 90},
]


async def _build_achievements_section(user_id: str, ctx: dict, year: int, month: int, habits: dict) -> dict:
    from app.services import investment_graph_service

    db = get_supabase()
    graph_metrics = await investment_graph_service.compute_metrics(user_id)
    all_time_companies = await investment_graph_service.get_most_analyzed_companies(user_id, date.today().year, limit=1000)

    prof_res = await run_query(db.table("user_profiles").select("completed_topic_ids, longest_streak_count").eq("user_id", user_id).maybe_single())
    prof = (prof_res.data if prof_res else None) or {}

    signals = {
        "total_theses": graph_metrics.get("total_theses"),
        "longest_activity_streak": habits.get("longest_streak"),
        "companies_analyzed_lifetime": all_time_companies.get("total_companies"),
        "lessons_completed": len(prof.get("completed_topic_ids") or []),
        "avg_deliberation_days": graph_metrics.get("avg_deliberation_days"),
        "longest_conviction_days": graph_metrics.get("longest_conviction_days"),
    }

    existing_res = await run_query(db.table("investor_recap_achievements").select("achievement_id").eq("user_id", user_id))
    already_unlocked = {r["achievement_id"] for r in (existing_res.data or [])}

    newly_unlocked = []
    to_insert = []
    for a in ACHIEVEMENTS:
        if a["id"] in already_unlocked:
            continue
        try:
            if a["condition"](signals):
                newly_unlocked.append(a)
                to_insert.append({"user_id": user_id, "achievement_id": a["id"], "recap_year": year, "recap_month": month})
        except Exception:
            logger.warning("investor_recap: achievement condition for %s failed to evaluate for %s", a["id"], user_id, exc_info=True)

    if to_insert:
        try:
            await run_query(db.table("investor_recap_achievements").insert(to_insert))
        except Exception:
            logger.warning("investor_recap: failed to persist newly-unlocked achievements for %s", user_id, exc_info=True)

    unlocked_ids = already_unlocked | {a["id"] for a in newly_unlocked}
    next_achievement = next((a for a in ACHIEVEMENTS if a["id"] not in unlocked_ids), None)

    return {
        "unlocked_this_month": [{"id": a["id"], "name": a["name"], "description": a["description"], "icon": a["icon"]} for a in newly_unlocked],
        "total_unlocked": len(unlocked_ids),
        "total_available": len(ACHIEVEMENTS),
        "next_achievement": ({"id": next_achievement["id"], "name": next_achievement["name"],
                               "description": next_achievement["description"], "icon": next_achievement["icon"]}
                              if next_achievement else None),
    }


# ── Section: Share Card DTO (STRICT privacy allowlist) ──────────────────

# Every key the Share Card is allowed to carry — anything not in this list
# never reaches build_share_card's return value, even if a future section
# adds new fields upstream. This is the single enforcement point tests
# should target (see tests/test_investor_recap.py).
_SHARE_CARD_ALLOWED_KEYS = {
    "month_label", "archetype", "achievement", "favorite_activity",
    "research_obsession", "current_focus", "strongest_skill", "active_days",
}

# Field names that must NEVER appear anywhere in a share card value, even
# nested — a defense-in-depth check, not the primary mechanism (the
# allowlist above is). Kept in sync with the spec's explicit ban list.
FORBIDDEN_SHARE_FIELDS = {
    "money", "portfolio_value", "profit", "loss", "return", "return_pct",
    "account_balance", "net_worth", "position_size", "purchase_price",
    "sell_price", "variation_pct", "benchmark_pct", "diff_pp", "pnl", "pnl_pct",
    "stocks_value", "cash_value", "dividend_value", "invested", "current_value",
}


def build_share_card(month_label: str, evolution: dict, achievements: dict, habits: dict, research: dict) -> dict:
    """Builds the PUBLIC, safe-to-post-anywhere Share Card DTO from already-
    computed section results — takes ONLY the specific fields it needs from
    each (never the whole section dict), so a future field added to e.g.
    the wealth section can't silently leak in here. See
    tests/test_investor_recap.py::test_share_card_never_contains_money for
    the enforcement test."""
    archetype = evolution.get("current_archetype")
    unlocked = achievements.get("unlocked_this_month") or []

    card = {
        "month_label": month_label,
        "archetype": ({"name": archetype["name"], "emoji": archetype["emoji"], "tagline": archetype["tagline"], "traits": archetype["traits"]}
                       if archetype else None),
        "achievement": ({"name": unlocked[0]["name"], "icon": unlocked[0]["icon"]} if unlocked else None),
        "favorite_activity": "Analizar empresas" if (research.get("companies_researched") or 0) > 0 else None,
        "research_obsession": (research.get("favorite_company") or {}).get("company_name") or (research.get("favorite_company") or {}).get("ticker"),
        "current_focus": None,  # filled by the caller from next_month's top mission title, kept generic (no financial detail)
        "strongest_skill": None,  # filled by the caller from investor_score's highest sub-score label, no numeric score included
        "active_days": habits.get("active_days"),
    }

    # Defense-in-depth: assert no forbidden key/substring made it in, even
    # nested — raises rather than silently ships a privacy bug.
    _assert_no_forbidden_fields(card)
    return card


def _assert_no_forbidden_fields(obj, path: str = "", top_level: bool = True) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            key_lower = str(k).lower()
            if top_level and key_lower not in _SHARE_CARD_ALLOWED_KEYS:
                raise ValueError(f"Share Card contains a non-allowlisted top-level key: {k}")
            if key_lower in FORBIDDEN_SHARE_FIELDS:
                raise ValueError(f"Share Card contains a forbidden field: {path}.{k}")
            _assert_no_forbidden_fields(v, f"{path}.{k}", top_level=False)
    elif isinstance(obj, (list, tuple)):
        for item in obj:
            _assert_no_forbidden_fields(item, path, top_level=False)


# ── Orchestrator ──────────────────────────────────────────────────────────

_MONTH_LABEL_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
                   "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


async def get_monthly_recap(user_id: str, year: int, month: int, lang: str = "es") -> dict:
    """Public entrypoint — GET /api/recap/monthly. Returns the FULL private
    recap (see recap.py's route for how the public Share Card gets carved
    out of this via build_share_card). Cached in Redis per (user, year,
    month) — a real recomputation is 5-10 real network calls (prices,
    fundamentals per held/researched ticker), not something to redo on
    every screen view within the same session."""
    cache_key = f"investor_recap:{user_id}:{year}:{month:02d}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    start, end, is_current = _month_bounds(year, month)
    if start > date.today():
        return {"available": False, "reason": "future_month"}

    from app.services import investor_progress_service

    ctx = await investor_progress_service._build_context(user_id)
    positions = ctx["positions"]

    # A month before the account even existed has nothing real to show —
    # honest empty state, never a zero-filled report.
    if ctx.get("inception_date"):
        try:
            inception = date.fromisoformat(str(ctx["inception_date"])[:10])
            if end < inception:
                return {"available": False, "reason": "before_account_inception"}
        except Exception:
            pass

    closed_this_period = ctx["closed_positions"]

    portfolio_task = _build_portfolio_section(positions, start, end)
    decisions_task = _build_decisions_section(user_id, positions, closed_this_period, start, end)
    research_task = _build_research_section(user_id, year, month)
    wealth_task = _build_wealth_section(user_id, positions, start, end, is_current)
    investor_score_task = investor_progress_service.compute_investor_score(user_id, ctx=ctx)

    portfolio, decisions, research, wealth, investor_score = await asyncio.gather(
        portfolio_task, decisions_task, research_task, wealth_task, investor_score_task,
    )

    habits = await _build_habits_section(user_id, start, end, decisions["facts"]["logged_decisions"])
    evolution = await _build_evolution_section(user_id, ctx, portfolio.get("composition"))
    next_month = await _build_next_month_section(investor_score)
    achievements = await _build_achievements_section(user_id, ctx, year, month, habits)

    # ── AI insights — ONE call, only real computed facts, never raw access ──
    from app.services.ai_service import generate_recap_insights
    ai_facts = {
        "portfolio_composition": portfolio.get("composition"),
        "decisions": decisions["facts"],
        "research_pattern": research.get("research_pattern"),
        "most_analyzed": research.get("top_companies"),
        "evolution": {
            "current_archetype": (evolution.get("current_archetype") or {}).get("name"),
            "past_archetype": (evolution.get("past_archetype") or {}).get("name"),
        } if evolution.get("current_archetype") else None,
    }
    try:
        insights = await generate_recap_insights(ai_facts, lang=lang)
    except Exception:
        logger.warning("investor_recap: generate_recap_insights failed for %s", user_id, exc_info=True)
        insights = {"portfolio_insight": None, "decision_highlight": None, "decision_improvement": None, "research_insight": None, "evolution_insight": None}

    month_label = f"{_MONTH_LABEL_ES[month - 1].upper()} {year}"
    overview = {
        "month_label": month_label,
        "year": year, "month": month, "is_current_month": is_current,
        "decisions_count": decisions["total"],
        "companies_researched": research["companies_researched"],
        "active_days": habits["active_days"],
    }

    private_recap = {
        "available": True,
        "overview": overview,
        "portfolio": {**portfolio, "insight": insights["portfolio_insight"]},
        "decisions": {k: v for k, v in decisions.items() if k != "facts"} | {
            "highlight": insights["decision_highlight"], "improvement_tip": insights["decision_improvement"],
        },
        "research": {**research, "insight": insights["research_insight"]},
        "wealth": wealth,  # PRIVATE — never passed to build_share_card
        "habits": habits,
        "evolution": {**evolution, "insight": insights["evolution_insight"]},
        "next_month": next_month,
        "achievements": achievements,
    }

    share_card = build_share_card(month_label, evolution, achievements, habits, research)
    if next_month.get("missions"):
        share_card["current_focus"] = next_month["missions"][0]["title"]
    if investor_score and investor_score.get("sub_scores"):
        best_key = max(investor_score["sub_scores"].items(), key=lambda kv: kv[1])[0]
        share_card["strongest_skill"] = {"analisis": "Investigación", "paciencia": "Paciencia",
                                          "diversificacion": "Diversificación", "educacion": "Aprendizaje"}.get(best_key)
    # Re-validate AFTER these two post-hoc field fills too — build_share_card's
    # own internal check only covers what IT set; without this second call,
    # a bug in either fill line above (e.g. someone later wiring a raw dict
    # into current_focus instead of a plain string) would silently bypass
    # the privacy guarantee entirely.
    _assert_no_forbidden_fields(share_card)
    private_recap["share_card"] = share_card

    cache_set(cache_key, private_recap, _RECAP_CACHE_TTL if is_current else _RECAP_CACHE_TTL * 20)
    return private_recap
