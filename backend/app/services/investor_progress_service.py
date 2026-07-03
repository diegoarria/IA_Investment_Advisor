"""
Investor Progress Engine
=========================
Turns the Financial Memory Graph's stored data into a continuous, quantified
demonstration of how the user has grown as an investor — not just what they
believe or hold, but how their wealth, discipline and decision-making have
evolved since day one.

Hard rule: every number here must trace back to real, storable data. A metric
that can't be computed from what actually exists is omitted from the result —
never zero-filled, inferred, or exaggerated.

Fase 2 adds: API routes (progress.py), milestone push notifications, and
Mentor IA context wiring. This module stays the single source of truth for
the computation — routes and the chat pipeline just call into it.
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from datetime import date, datetime, timezone

from app.api.routes.decisions import _get_decisions
from app.api.routes.market import (
    _ClosedPositionItem,
    _PortfolioReturnsItem,
    _compute_portfolio_returns,
)
from app.api.routes.sync import _parse_portfolio
from app.core.cache import cache_get, cache_set
from app.core.database import get_supabase, run_query
from app.services import fmg_service

log = logging.getLogger(__name__)


# ── Data gathering ──────────────────────────────────────────────────────────

async def _get_raw_portfolio(user_id: str) -> dict:
    """Positions/closed_positions/inception_date exactly as stored — camelCase
    field names, straight from user_portfolio.positions JSONB."""
    db = get_supabase()
    res = await run_query(
        db.table("user_portfolio").select("positions").eq("user_id", user_id)
    )
    if not res.data:
        return {"currency": "USD", "positions": [], "closed_positions": [], "inception_date": None}
    return _parse_portfolio(res.data[0]["positions"])


async def _get_account_created_at(user_id: str) -> str | None:
    db = get_supabase()
    res = await run_query(
        db.table("user_profiles").select("created_at").eq("user_id", user_id).limit(1)
    )
    if res.data:
        return res.data[0].get("created_at")
    return None


async def _get_snapshots(user_id: str) -> list[dict]:
    """Full snapshot history, oldest first — needed for max/best-year/worst-year
    and behavior-evolution comparisons."""
    db = get_supabase()
    res = await run_query(
        db.table("fmg_portfolio_snapshots")
        .select("snapshot_date, total_value, top_sector, sector_weights")
        .eq("user_id", user_id)
        .order("snapshot_date", desc=False)
        .limit(3650)  # ~10 years of daily snapshots
    )
    return res.data or []


async def _get_existing_milestone_keys(user_id: str) -> set[str]:
    db = get_supabase()
    res = await run_query(
        db.table("fmg_events")
        .select("milestone_key")
        .eq("user_id", user_id)
        .not_.is_("milestone_key", "null")
    )
    return {r["milestone_key"] for r in (res.data or []) if r.get("milestone_key")}


# ── Context builder (shared by summary + milestones) ────────────────────────

async def _build_context(user_id: str) -> dict:
    portfolio, snapshots, decisions = await asyncio.gather(
        _get_raw_portfolio(user_id),
        _get_snapshots(user_id),
        _get_decisions(user_id, limit=500),
    )

    positions = portfolio["positions"]
    closed = portfolio["closed_positions"]
    inception_date = portfolio["inception_date"]

    today = date.today()
    days_since_inception = None
    if inception_date:
        try:
            days_since_inception = (today - date.fromisoformat(inception_date[:10])).days
        except Exception:
            days_since_inception = None

    total_operations = len(positions) + len(closed)

    capital_invested = 0.0
    for p in positions:
        capital_invested += float(p.get("shares", 0) or 0) * float(p.get("avgPrice", 0) or 0)
    for c in closed:
        capital_invested += float(c.get("shares", 0) or 0) * float(c.get("avgPrice", 0) or 0)

    values = [s["total_value"] for s in snapshots if s.get("total_value") is not None]
    max_patrimonio = max(values) if values else None

    latest_snapshot = snapshots[-1] if snapshots else None
    is_new_ath = False
    if latest_snapshot and len(snapshots) > 1:
        prior_max = max(
            (s["total_value"] for s in snapshots[:-1] if s.get("total_value") is not None),
            default=None,
        )
        if prior_max is not None and latest_snapshot["total_value"] > prior_max:
            is_new_ath = True

    # Months with at least one purchase (open or closed) — used for both the
    # "meses consecutivos aportando" metric and the current investing streak.
    purchase_months: set[tuple[int, int]] = set()
    for item in positions + closed:
        pd = item.get("purchaseDate")
        if pd:
            try:
                d = date.fromisoformat(pd[:10])
                purchase_months.add((d.year, d.month))
            except Exception:
                pass

    return {
        "portfolio": portfolio,
        "positions": positions,
        "closed_positions": closed,
        "inception_date": inception_date,
        "days_since_inception": days_since_inception,
        "total_operations": total_operations,
        "capital_invested": capital_invested,
        "snapshots": snapshots,
        "max_patrimonio": max_patrimonio,
        "latest_snapshot": latest_snapshot,
        "is_new_ath": is_new_ath,
        "purchase_months": purchase_months,
        "decisions": decisions,
    }


# ── Milestone definitions ────────────────────────────────────────────────────
# Fase 1 only includes milestones computable from data that already exists
# somewhere in the app. Deliberately excluded, not forgotten:
#   - first_dividend: no dividend tracking exists anywhere in the codebase yet.
#   - first_etf: detectable via a known-ETF ticker list, but deferred — a
#     prioritization choice for a later phase, not a data-availability gap.

def _check_first_investment(ctx: dict) -> dict | None:
    if not ctx["inception_date"]:
        return None
    return {
        "key": "first_investment",
        "event_type": "first_investment",
        "title": "Tu primera inversión",
        "description": f"Hiciste tu primera inversión el {ctx['inception_date']}.",
    }


def _check_first_year(ctx: dict) -> dict | None:
    days = ctx["days_since_inception"]
    if days is None or days < 365:
        return None
    return {
        "key": "first_year_investing",
        "event_type": "milestone",
        "title": "Un año invirtiendo",
        "description": "Cumpliste un año completo invirtiendo con Nuvos AI.",
    }


def _check_ops_100(ctx: dict) -> dict | None:
    if ctx["total_operations"] < 100:
        return None
    return {
        "key": "ops_100",
        "event_type": "milestone",
        "title": "100 operaciones",
        "description": "Realizaste 100 operaciones de inversión registradas en tu portafolio.",
    }


def _make_patrimonio_check(threshold: float, key: str, label: str):
    def _check(ctx: dict) -> dict | None:
        if ctx["max_patrimonio"] is None or ctx["max_patrimonio"] < threshold:
            return None
        return {
            "key": key,
            "event_type": "milestone",
            "title": f"Patrimonio superior a {label}",
            "description": f"Tu patrimonio superó {label}.",
        }
    return _check


def _check_new_ath(ctx: dict) -> dict | None:
    if not ctx["is_new_ath"] or not ctx["latest_snapshot"]:
        return None
    snap = ctx["latest_snapshot"]
    # Repeatable milestone — a new all-time high can legitimately happen many
    # times, so the key is per-date instead of a one-time flag.
    return {
        "key": f"ath_{snap['snapshot_date']}",
        "event_type": "milestone",
        "title": "Nuevo máximo histórico",
        "description": f"Tu patrimonio alcanzó un nuevo máximo: ${snap['total_value']:,.0f}.",
    }


_ONE_TIME_CHECKS = [
    _check_first_investment,
    _check_first_year,
    _check_ops_100,
    _make_patrimonio_check(10_000, "patrimonio_10k", "$10,000"),
    _make_patrimonio_check(100_000, "patrimonio_100k", "$100,000"),
]

_REPEATABLE_CHECKS = [
    _check_new_ath,
]


async def detect_new_milestones(user_id: str) -> list[dict]:
    """
    Evaluate all milestone definitions against the user's current data and
    record any newly-achieved ones in fmg_events (permanent timeline).
    Returns only the milestones that were newly recorded in this call — later
    phases use this return value to fire a notification.
    """
    ctx = await _build_context(user_id)
    existing_keys = await _get_existing_milestone_keys(user_id)

    newly_achieved: list[dict] = []

    for check in _ONE_TIME_CHECKS:
        candidate = check(ctx)
        if candidate and candidate["key"] not in existing_keys:
            newly_achieved.append(candidate)

    for check in _REPEATABLE_CHECKS:
        candidate = check(ctx)
        if candidate and candidate["key"] not in existing_keys:
            newly_achieved.append(candidate)

    for m in newly_achieved:
        await fmg_service.log_event(
            user_id,
            event_type=m["event_type"],
            title=m["title"],
            description=m["description"],
            milestone_key=m["key"],
        )

    if newly_achieved:
        await _notify_milestones(user_id, newly_achieved)

    return newly_achieved


async def _notify_milestones(user_id: str, milestones: list[dict]) -> None:
    """
    Push a notification per newly-achieved milestone. The existing fatigue
    control in notification_engine.send_push already dedupes by
    (user_id, category, day) — so if several milestones land the same day,
    only the first push actually sends; the rest are logged as "skipped"
    rather than spamming the user. That's intentional, not a bug to fix here.
    """
    try:
        from app.core.database import get_supabase as _get_db
        from app.services.notification_engine import send_push

        db = _get_db()
        prefs_res = await run_query(
            db.table("notification_preferences").select("push_milestones").eq("user_id", user_id).limit(1)
        )
        # Default to opted-in, matching notification_engine's own default prefs.
        enabled = prefs_res.data[0].get("push_milestones", True) if prefs_res.data else True
        if not enabled:
            return

        for m in milestones:
            await send_push(
                user_id,
                "milestone_reached",
                f"🏆 {m['title']}",
                m["description"],
                {"screen": "profile", "section": "progress", "milestone_key": m["key"]},
                db,
            )
    except Exception as exc:
        log.debug("Milestone notification failed for %s: %s", user_id, exc)


# ── Behavior evolution ("antes vs ahora") ────────────────────────────────────

def _decision_style_ratio(decisions: list[dict]) -> float | None:
    """Fraction of decisions triggered by fomo/panic vs the total that have a
    known trigger. None if there's no trigger data to judge by."""
    known = [d for d in decisions if d.get("trigger") in
             ("fomo", "panic", "research", "manual", "alert", "mentor")]
    if not known:
        return None
    impulsive = sum(1 for d in known if d.get("trigger") in ("fomo", "panic"))
    return impulsive / len(known)


async def detect_behavior_evolution(user_id: str) -> list[dict]:
    """
    Compare the earliest available signal against the most recent one.
    Only emits a statement when there are genuinely two separated points in
    time to compare — otherwise stays silent rather than inventing a "before".
    """
    ctx = await _build_context(user_id)
    statements: list[dict] = []

    # Decision style: impulsive (fomo/panic) vs deliberate (research/manual/alert)
    decisions = ctx["decisions"]  # newest first, per _get_decisions ordering
    if len(decisions) >= 6:
        midpoint = len(decisions) // 2
        recent_half = decisions[:midpoint]       # newest
        older_half = decisions[midpoint:]        # oldest
        recent_ratio = _decision_style_ratio(recent_half)
        older_ratio = _decision_style_ratio(older_half)
        if recent_ratio is not None and older_ratio is not None and older_ratio > recent_ratio:
            statements.append({
                "key": "decision_style",
                "before": f"Antes, {round(older_ratio * 100)}% de tus decisiones venían de FOMO o pánico.",
                "after": f"Hoy, solo el {round(recent_ratio * 100)}% siguen ese patrón.",
            })

    # Sector concentration: earliest snapshot with sector data vs latest
    snaps_with_sectors = [s for s in ctx["snapshots"] if s.get("sector_weights")]
    if len(snaps_with_sectors) >= 2:
        earliest = snaps_with_sectors[0]
        latest = snaps_with_sectors[-1]
        earliest_max = max(earliest["sector_weights"].values(), default=0)
        latest_max = max(latest["sector_weights"].values(), default=0)
        if earliest_max - latest_max >= 0.15:  # at least 15pp less concentrated
            statements.append({
                "key": "sector_concentration",
                "before": f"Antes concentrabas el {round(earliest_max * 100)}% de tu patrimonio en un solo sector.",
                "after": f"Hoy tu cartera está más diversificada ({round(latest_max * 100)}% en tu sector principal).",
            })

    return statements


# ── Progress summary (dashboard) ─────────────────────────────────────────────

async def compute_progress_summary(user_id: str) -> dict:
    """
    Build every metric for "Tu evolución como inversionista". Each key is
    present only when there's enough real data to support it — the frontend
    should treat a missing key as "not enough data yet", never as zero.
    """
    ctx = await _build_context(user_id)
    summary: dict = {}

    created_at = await _get_account_created_at(user_id)
    if created_at:
        try:
            days_using_nuvos = (
                datetime.now(timezone.utc)
                - datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            ).days
            summary["days_using_nuvos"] = days_using_nuvos
        except Exception:
            pass

    if ctx["inception_date"]:
        summary["inception_date"] = ctx["inception_date"]
        summary["days_since_first_investment"] = ctx["days_since_inception"]

    if ctx["total_operations"] > 0:
        summary["total_operations"] = ctx["total_operations"]

    if ctx["capital_invested"] > 0:
        summary["capital_invested"] = round(ctx["capital_invested"], 2)

    if ctx["max_patrimonio"] is not None:
        summary["max_patrimonio"] = round(ctx["max_patrimonio"], 2)

    # Since-inception return — reuses the existing, already-correct computation
    # from market.py instead of re-deriving it. Network-bound, so only ever
    # called per-request for a single user, never in a batch loop.
    if ctx["positions"] or ctx["closed_positions"]:
        try:
            positions_items = [
                _PortfolioReturnsItem(
                    ticker=p["ticker"],
                    shares=float(p.get("shares", 0) or 0),
                    purchase_date=p.get("purchaseDate"),
                    avg_price=float(p.get("avgPrice", 0) or 0) or None,
                )
                for p in ctx["positions"]
            ]
            closed_items = [
                _ClosedPositionItem(
                    ticker=c["ticker"],
                    shares=float(c.get("shares", 0) or 0),
                    avg_price=float(c.get("avgPrice", 0) or 0),
                    close_price=float(c.get("closePrice", 0) or 0),
                    purchase_date=c.get("purchaseDate"),
                    close_date=c.get("closeDate"),
                )
                for c in ctx["closed_positions"]
            ]
            results, _ = await asyncio.to_thread(
                _compute_portfolio_returns, positions_items, closed_items, ctx["inception_date"]
            )
            since_purchase = results.get("since_purchase")
            if since_purchase:
                summary["cumulative_return_pct"] = since_purchase["pct"]
                summary["cumulative_return_amount"] = since_purchase["amount"]
        except Exception as exc:
            log.debug("compute_progress_summary: since_purchase failed for %s: %s", user_id, exc)

    # Best / worst calendar year — only years with a snapshot at both the
    # start and end of that year (or account creation, whichever is later).
    by_year: dict[int, list[dict]] = {}
    for s in ctx["snapshots"]:
        try:
            year = date.fromisoformat(s["snapshot_date"]).year
            by_year.setdefault(year, []).append(s)
        except Exception:
            pass
    year_returns: dict[int, float] = {}
    for year, snaps in by_year.items():
        snaps_sorted = sorted(snaps, key=lambda s: s["snapshot_date"])
        start_val = snaps_sorted[0]["total_value"]
        end_val = snaps_sorted[-1]["total_value"]
        if start_val and start_val > 0 and len(snaps_sorted) >= 2:
            year_returns[year] = (end_val - start_val) / start_val * 100
    if year_returns:
        best_year = max(year_returns, key=year_returns.get)
        worst_year = min(year_returns, key=year_returns.get)
        summary["best_year"] = {"year": best_year, "pct": round(year_returns[best_year], 2)}
        summary["worst_year"] = {"year": worst_year, "pct": round(year_returns[worst_year], 2)}

    # Consecutive months with at least one purchase, ending this month.
    months = ctx["purchase_months"]
    if months:
        today = date.today()
        streak = 0
        y, m = today.year, today.month
        while (y, m) in months:
            streak += 1
            m -= 1
            if m == 0:
                m = 12
                y -= 1
        if streak > 0:
            summary["consecutive_months_contributing"] = streak

    return summary


# ── Decisions that avoided costly mistakes ───────────────────────────────────

def _is_impulsive_hold(d: dict) -> bool:
    return d.get("action") == "hold" and d.get("trigger") in ("fomo", "panic")


async def get_decisions_that_helped(user_id: str) -> list[dict]:
    """
    Grounded "decisiones que evitaron errores costosos" — never a dollar figure
    that can't be demonstrated, only the decision, why it mattered, and what
    it shows. Two real signals, both already in storage:
      1. A decision explicitly logged as "hold" with trigger fomo/panic — the
         user recorded, in the moment, that they resisted an impulsive urge.
      2. A meaningful drop in portfolio sector concentration over time
         (reuses the same signal as detect_behavior_evolution, reframed here).
    """
    ctx = await _build_context(user_id)
    items: list[dict] = []

    impulsive_holds = [d for d in ctx["decisions"] if _is_impulsive_hold(d)]
    for d in impulsive_holds[:10]:
        trigger_label = "pánico" if d["trigger"] == "panic" else "FOMO"
        items.append({
            "key": f"decision_{d['id']}",
            "title": "Mantuviste tu inversión bajo presión",
            "description": (
                f"El {str(d.get('created_at', ''))[:10]} sentiste {trigger_label} por "
                f"{d.get('ticker', 'una posición')}, pero decidiste mantenerla en vez de "
                f"reaccionar por impulso."
            ),
        })

    evolution = await detect_behavior_evolution(user_id)
    for e in evolution:
        if e["key"] == "sector_concentration":
            items.append({
                "key": "sector_concentration",
                "title": "Redujiste tu concentración excesiva",
                "description": f"{e['before']} {e['after']}",
            })

    return items


# ── Mentor IA context (Fase 2: wired into ai_service.py's dynamic addendum) ──

_MENTOR_CONTEXT_TTL = 3600  # 1h — since_purchase computation is network-bound


async def build_progress_context_for_mentor(user_id: str) -> str | None:
    """
    Short paragraph summarizing the user's real progress, injected into the
    Mentor IA's dynamic system prompt addendum on every chat turn. Cached
    because compute_progress_summary() calls into the same network-bound
    since-inception calculation used by /market/portfolio-returns — without
    caching, every single chat message would trigger a live market data fetch.
    """
    cache_key = f"progress_mentor_ctx:{user_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached or None  # cache_set below stores "" for "no context yet"

    result = await _build_progress_context_for_mentor_uncached(user_id)
    cache_set(cache_key, result or "", ttl=_MENTOR_CONTEXT_TTL)
    return result


async def _build_progress_context_for_mentor_uncached(user_id: str) -> str | None:
    summary = await compute_progress_summary(user_id)
    if not summary:
        return None

    parts: list[str] = []

    if "days_since_first_investment" in summary:
        parts.append(f"Lleva {summary['days_since_first_investment']} días invirtiendo desde su primera posición.")
    if "total_operations" in summary:
        parts.append(f"Ha realizado {summary['total_operations']} operaciones en total.")
    if "cumulative_return_pct" in summary:
        parts.append(f"Su retorno acumulado desde el inicio es de {summary['cumulative_return_pct']}%.")
    if "max_patrimonio" in summary:
        parts.append(f"Su máximo patrimonio alcanzado es ${summary['max_patrimonio']:,.0f}.")
    if "consecutive_months_contributing" in summary:
        parts.append(f"Lleva {summary['consecutive_months_contributing']} meses consecutivos aportando capital.")

    evolution = await detect_behavior_evolution(user_id)
    for e in evolution:
        parts.append(f"{e['before']} {e['after']}")

    if not parts:
        return None

    return "## 📈 EVOLUCIÓN DEL USUARIO COMO INVERSIONISTA\n\n" + " ".join(parts)
