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
Arthur context wiring. This module stays the single source of truth for
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
    field names, straight from user_portfolio.positions JSONB, merged across
    every one of the user's portfolios (up to 3, premium).

    Previously this picked only the "default" row, on the mistaken premise
    that sync.py's get_all does the same — it doesn't: get_all's default-only
    field is a backward-compat shim alongside a full `portfolios` array with
    everything. Picking only "default" here silently excluded any 2nd/3rd
    broker portfolio from every Investor Progress milestone (diversification,
    position-count achievements, inception date, etc.)."""
    db = get_supabase()
    res = await run_query(
        db.table("user_portfolio").select("portfolio_id, positions").eq("user_id", user_id)
    )
    rows = res.data or []
    if not rows:
        return {"currency": "USD", "positions": [], "closed_positions": [], "inception_date": None}

    merged_positions: list = []
    merged_closed: list = []
    inception_dates: list = []
    currency = "USD"
    default_row = next((r for r in rows if r.get("portfolio_id") == "default"), None)
    if default_row:
        currency = _parse_portfolio(default_row["positions"]).get("currency", "USD")
    for row in rows:
        parsed = _parse_portfolio(row["positions"])
        merged_positions.extend(parsed["positions"])
        merged_closed.extend(parsed["closed_positions"])
        if parsed["inception_date"]:
            inception_dates.append(parsed["inception_date"])

    return {
        "currency": currency,
        "positions": merged_positions,
        "closed_positions": merged_closed,
        "inception_date": min(inception_dates) if inception_dates else None,
    }


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


async def detect_behavior_evolution(user_id: str, ctx: dict | None = None) -> list[dict]:
    """
    Compare the earliest available signal against the most recent one.
    Only emits a statement when there are genuinely two separated points in
    time to compare — otherwise stays silent rather than inventing a "before".

    Pass an already-built ctx (from _build_context) when the caller has one,
    to avoid re-fetching the same portfolio/snapshots/decisions twice.
    """
    ctx = ctx if ctx is not None else await _build_context(user_id)
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

def _compute_year_returns(snapshots: list[dict]) -> dict[int, float]:
    """% change from the first to the last snapshot of each calendar year.
    Only includes years with at least 2 snapshots — shared by
    compute_progress_summary (best/worst year) and the Wrapped annual report
    (this year's growth) so both use the exact same definition of 'year return'."""
    by_year: dict[int, list[dict]] = {}
    for s in snapshots:
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
    return year_returns


async def compute_progress_summary(user_id: str, ctx: dict | None = None) -> dict:
    """
    Build every metric for "Tu evolución como inversionista". Each key is
    present only when there's enough real data to support it — the frontend
    should treat a missing key as "not enough data yet", never as zero.

    Pass an already-built ctx to avoid re-fetching the same data twice.
    """
    ctx = ctx if ctx is not None else await _build_context(user_id)
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
                # Current patrimonio, not a historical max: everything ever put
                # in, plus everything ever gained or lost (realized from sales
                # + unrealized from what's still held) — computed from real
                # market prices via the same call, not the cost-basis
                # approximation the daily snapshot job has to use.
                if ctx["capital_invested"] > 0:
                    summary["current_patrimonio"] = round(
                        ctx["capital_invested"] + since_purchase["amount"], 2
                    )
        except Exception as exc:
            log.debug("compute_progress_summary: since_purchase failed for %s: %s", user_id, exc)

    # Best / worst calendar year — only years with a snapshot at both the
    # start and end of that year (or account creation, whichever is later).
    year_returns = _compute_year_returns(ctx["snapshots"])
    if year_returns:
        best_year = max(year_returns, key=year_returns.get)
        worst_year = min(year_returns, key=year_returns.get)
        summary["best_year"] = {"year": best_year, "pct": round(year_returns[best_year], 2)}
        summary["worst_year"] = {"year": worst_year, "pct": round(year_returns[worst_year], 2)}

    # Consecutive months with at least one purchase, ending this month.
    streak = _consecutive_months_streak(ctx["purchase_months"])
    if streak > 0:
        summary["consecutive_months_contributing"] = streak

    return summary


def _consecutive_months_streak(purchase_months: set[tuple[int, int]]) -> int:
    """Consecutive (year, month) pairs with at least one purchase, ending this
    month."""
    if not purchase_months:
        return 0
    today = date.today()
    streak = 0
    y, m = today.year, today.month
    while (y, m) in purchase_months:
        streak += 1
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return streak


# ── Decisions that avoided costly mistakes ───────────────────────────────────

def _is_impulsive_hold(d: dict) -> bool:
    return d.get("action") == "hold" and d.get("trigger") in ("fomo", "panic")


_MIN_DRAWDOWN_PCT = 10.0  # peak-to-trough decline worth calling a "real drawdown"


def _find_significant_drawdowns(snapshots: list[dict]) -> list[dict]:
    """
    Peak-to-trough declines of at least _MIN_DRAWDOWN_PCT in the snapshot
    history — a simple running-peak scan, not a statistical model. Each
    result is a real, dated period the user's own patrimonio actually lived
    through, not a hypothetical.
    """
    drawdowns: list[dict] = []
    if len(snapshots) < 2:
        return drawdowns

    peak_val = snapshots[0]["total_value"]
    peak_date = snapshots[0]["snapshot_date"]
    trough_val = peak_val
    trough_date = peak_date
    in_drawdown = False

    def _maybe_record():
        if in_drawdown and peak_val > 0:
            drop_pct = (peak_val - trough_val) / peak_val * 100
            if drop_pct >= _MIN_DRAWDOWN_PCT:
                drawdowns.append({
                    "peak_date": peak_date, "peak_value": peak_val,
                    "trough_date": trough_date, "trough_value": trough_val,
                    "drop_pct": drop_pct,
                })

    for s in snapshots[1:]:
        val = s.get("total_value")
        if val is None:
            continue
        if val > peak_val:
            _maybe_record()
            peak_val, peak_date = val, s["snapshot_date"]
            trough_val, trough_date = val, s["snapshot_date"]
            in_drawdown = False
        elif val < trough_val:
            trough_val, trough_date = val, s["snapshot_date"]
            in_drawdown = True

    _maybe_record()  # capture a drawdown still in progress at the end of history
    drawdowns.sort(key=lambda d: d["drop_pct"], reverse=True)
    return drawdowns


def _held_through_drawdown(ctx: dict, peak_date: str) -> bool:
    """True if the user still holds a position that was already open before
    the drawdown's peak — i.e. they didn't fully bail out during the drop."""
    for p in ctx["positions"]:
        purchase_date = p.get("purchaseDate")
        if purchase_date and purchase_date <= peak_date:
            return True
    return False


async def get_decisions_that_helped(user_id: str) -> list[dict]:
    """
    Grounded "decisiones que evitaron errores costosos" — never a dollar figure
    that can't be demonstrated, only the decision, why it mattered, and what
    it shows. Three real signals, all already in storage:
      1. A decision explicitly logged as "hold" with trigger fomo/panic — the
         user recorded, in the moment, that they resisted an impulsive urge.
      2. A real peak-to-trough drawdown in the user's own patrimonio history
         where they still held a position opened before the drop — evidence
         they didn't panic-sell, with no dependency on the manual decision
         diary most users never touch.
      3. A meaningful drop in portfolio sector concentration over time
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

    for dd in _find_significant_drawdowns(ctx["snapshots"])[:3]:
        if _held_through_drawdown(ctx, dd["peak_date"]):
            items.append({
                "key": f"drawdown_{dd['peak_date']}_{dd['trough_date']}",
                "title": "Mantuviste tu inversión durante una caída real",
                "description": (
                    f"Entre el {dd['peak_date']} y el {dd['trough_date']} tu patrimonio cayó "
                    f"{round(dd['drop_pct'])}%, y no vendiste — mantuviste tu estrategia en vez "
                    f"de liquidar por pánico."
                ),
            })

    evolution = await detect_behavior_evolution(user_id, ctx=ctx)
    for e in evolution:
        if e["key"] == "sector_concentration":
            items.append({
                "key": "sector_concentration",
                "title": "Redujiste tu concentración excesiva",
                "description": f"{e['before']} {e['after']}",
            })

    return items


# ── Investor archetype (Wrapped screen 4) ────────────────────────────────────

_DEFENSIVE_SECTORS = {"Utilities", "Healthcare", "Consumer Defensive", "Real Estate"}
_GROWTH_SECTORS = {"Technology", "Communication Services"}

_ARCHETYPES = {
    "business_owner": {
        "key": "business_owner", "name": "EL ASIGNADOR DE CAPITAL",
        "tagline": "No buscaste solamente ganar dinero. Buscaste poner tu capital a trabajar.",
        "traits": ["Mantienes posiciones a largo plazo", "Analizas ventajas competitivas reales", "Ignoras el ruido del mercado"],
    },
    "growth_hunter": {
        "key": "growth_hunter", "name": "EL OPORTUNISTA",
        "tagline": "Cuando otros veían una caída, tú veías una oportunidad.",
        "traits": ["Concentrado en sectores de crecimiento", "Tolerancia alta a la volatilidad", "Buscas la próxima gran historia"],
    },
    "defender": {
        "key": "defender", "name": "EL PACIENTE",
        "tagline": "Mientras otros pensaban en días, tú pensabas en años.",
        "traits": ["Priorizas sectores defensivos", "Buscas estabilidad sobre velocidad", "Proteges el capital primero"],
    },
    "value_seeker": {
        "key": "value_seeker", "name": "EL CAZADOR DE CALIDAD",
        "tagline": "Buscaste precio, pero nunca sacrificaste calidad.",
        "traits": ["Analizas antes de decidir", "Rotación de cartera activa", "Buscas precio, no solo calidad"],
    },
}


def _avg_holding_days(ctx: dict) -> float | None:
    """Average holding period across CLOSED positions (a real, completed
    hold) — falls back to 'how long the oldest still-open position has
    been held' when nothing has been closed yet, so a long-term holder
    who has never sold isn't misread as having no signal at all. Shared by
    classify_investor_archetype and classify_investor_type so both read
    the same real number even though they act on it differently."""
    holding_days: list[float] = []
    for c in ctx["closed_positions"]:
        try:
            p = date.fromisoformat(str(c["purchaseDate"])[:10])
            cl = date.fromisoformat(str(c["closeDate"])[:10])
            holding_days.append((cl - p).days)
        except Exception:
            pass
    if not holding_days and ctx["days_since_inception"] is not None:
        holding_days = [ctx["days_since_inception"]]
    return sum(holding_days) / len(holding_days) if holding_days else None


async def classify_investor_archetype(user_id: str, ctx: dict | None = None) -> dict | None:
    """One of 4 investor archetypes for Wrapped screen 1 ("tu personalidad
    como inversionista") — the serious/professional read, derived entirely
    from real signals already collected elsewhere in this module (decision
    triggers, real holding periods, real sector concentration) — never a
    new tracked field, never a guess. None when there isn't enough real
    signal yet (e.g. a brand-new account with almost no history) rather
    than defaulting to an arbitrary archetype."""
    ctx = ctx if ctx is not None else await _build_context(user_id)

    if ctx["total_operations"] < 3:
        return None

    style_ratio = _decision_style_ratio(ctx["decisions"])  # impulsive fraction, or None
    avg_holding_days = _avg_holding_days(ctx)

    latest_snap = ctx["snapshots"][-1] if ctx["snapshots"] else None
    sector_weights = (latest_snap or {}).get("sector_weights") or {}
    defensive_weight = sum(w for s, w in sector_weights.items() if s in _DEFENSIVE_SECTORS)
    growth_weight = sum(w for s, w in sector_weights.items() if s in _GROWTH_SECTORS)

    scores = {
        "business_owner": (1 if avg_holding_days and avg_holding_days >= 365 else 0)
                         + (1 if style_ratio is not None and style_ratio < 0.3 else 0),
        "growth_hunter": 2 if growth_weight >= 0.4 else (1 if growth_weight >= 0.25 else 0),
        "defender": 2 if defensive_weight >= 0.4 else (1 if defensive_weight >= 0.25 else 0),
        "value_seeker": (1 if style_ratio is not None and style_ratio < 0.4 else 0)
                       + (1 if avg_holding_days and avg_holding_days < 365 else 0),
    }
    if not any(scores.values()):
        return None
    return _ARCHETYPES[max(scores, key=scores.get)]


_INVESTOR_TYPES = {
    "whale": {
        "key": "whale", "emoji": "🐋", "name": "LA BALLENA",
        "tagline": "No te asustan las posiciones grandes.",
    },
    "zen": {
        "key": "zen", "emoji": "🧘", "name": "EL INVERSIONISTA ZEN",
        "tagline": "El mercado podía caer. Tú ni te inmutabas.",
    },
    "opportunist": {
        "key": "opportunist", "emoji": "🦈", "name": "EL OPORTUNISTA",
        "tagline": "Cuando otros veían una caída, tú veías una oportunidad.",
    },
    "patient": {
        "key": "patient", "emoji": "🦉", "name": "EL PACIENTE",
        "tagline": "Mientras otros pensaban en días, tú pensabas en años.",
    },
    "tech": {
        "key": "tech", "emoji": "🤖", "name": "EL INVERSIONISTA TECH",
        "tagline": "Si tenía chips, software o IA, probablemente la conocías.",
    },
}


async def classify_investor_type(user_id: str, ctx: dict | None = None) -> dict | None:
    """A second, deliberately different and more shareable read on Wrapped
    screen 7 ("tu tipo de inversionista") — same real signals as screen 1's
    classify_investor_archetype, but different rules and higher/different
    thresholds so the two never just re-skin the same score under two
    names. Never contradicts screen 1 (they measure different axes:
    conviction size, calm-under-drawdown, contrarian timing — not the same
    long-term-vs-short-term or sector split screen 1 already covers).
    None when there isn't enough signal, same gate as screen 1."""
    ctx = ctx if ctx is not None else await _build_context(user_id)

    if ctx["total_operations"] < 3:
        return None

    # Real cost basis (shares * avgPrice), not a "value" field — positions
    # never actually carry one from the frontend, so anything reading it
    # (including this app's own older sector-weight code) silently falls
    # back to a per-position default instead of a real dollar amount.
    positions = ctx["positions"]
    position_costs = [float(p.get("shares", 0) or 0) * float(p.get("avgPrice", 0) or 0) for p in positions]
    total_value = sum(position_costs)
    max_position_value = max(position_costs, default=0)
    whale_weight = (max_position_value / total_value) if total_value > 0 else 0

    style_ratio = _decision_style_ratio(ctx["decisions"])
    drawdowns = _find_significant_drawdowns(ctx["snapshots"])
    held_through_drawdown = bool(drawdowns) and _held_through_drawdown(ctx, drawdowns[0]["peak_date"])

    # Bought (any lot, open or closed) during a real drawdown window — a
    # contrarian-timing signal distinct from "held through" one.
    bought_during_drawdown = False
    if drawdowns:
        dd = drawdowns[0]
        for item in positions + ctx["closed_positions"]:
            pd = item.get("purchaseDate")
            if pd and dd["peak_date"] <= str(pd)[:10] <= dd["trough_date"]:
                bought_during_drawdown = True
                break

    latest_snap = ctx["snapshots"][-1] if ctx["snapshots"] else None
    sector_weights = (latest_snap or {}).get("sector_weights") or {}
    tech_weight = sum(w for s, w in sector_weights.items() if s in _GROWTH_SECTORS)

    scores = {
        "whale": 2 if whale_weight >= 0.4 else 0,
        "zen": (2 if style_ratio is not None and style_ratio < 0.15 else 0)
             + (1 if held_through_drawdown else 0),
        "opportunist": 2 if bought_during_drawdown else 0,
        "patient": (1 if held_through_drawdown else 0)
                 + (1 if style_ratio is not None and style_ratio < 0.3 else 0),
        "tech": 2 if tech_weight >= 0.5 else (1 if tech_weight >= 0.35 else 0),
    }
    if not any(scores.values()):
        return None
    return _INVESTOR_TYPES[max(scores, key=scores.get)]


def worst_closed_position(ctx: dict) -> dict | None:
    """The single worst realized $ loss among CLOSED positions — Wrapped
    screen 6's 'peor decisión', a completed buy-then-sell with a real,
    computable P&L (no stored realized-gain field needed: shares *
    (closePrice - avgPrice) is exact). None when there's no closed
    position with an actual loss — callers should fall back to the worst
    *unrealized* return among open positions instead of inventing one."""
    worst: dict | None = None
    for c in ctx["closed_positions"]:
        try:
            shares = float(c.get("shares", 0) or 0)
            avg_price = float(c.get("avgPrice", 0) or 0)
            close_price = float(c.get("closePrice", 0) or 0)
            if shares <= 0 or avg_price <= 0:
                continue
        except Exception:
            continue
        pnl = (close_price - avg_price) * shares
        if worst is None or pnl < worst["pnl"]:
            worst = {
                "ticker": c.get("ticker"),
                "pnl": round(pnl, 2),
                "pnl_pct": round((close_price - avg_price) / avg_price * 100, 2),
                "purchase_date": c.get("purchaseDate"),
                "close_date": c.get("closeDate"),
                "realized": True,
            }
    if worst and worst["pnl"] < 0:
        return worst
    return None


# ── Investor Score (Wrapped screen 10) ───────────────────────────────────────

async def compute_investor_score(user_id: str, ctx: dict | None = None) -> dict | None:
    """0-100 composite Investor Score for Wrapped, with 4 real sub-scores.
    Every sub-score is a simple, explainable normalization of data already
    collected elsewhere in this module / investment_graph_service — no new
    tracking, no fabricated numbers. A sub-score that lacks enough real
    signal is simply omitted (never zero-filled); the composite itself is
    None only when EVERY sub-score is unavailable."""
    from app.services import investment_graph_service

    ctx = ctx if ctx is not None else await _build_context(user_id)
    sub: dict[str, int] = {}

    # Educación — topics completed, capped at a reasonable full-marks bar.
    db = get_supabase()
    prof_res = await run_query(
        db.table("user_profiles").select("completed_topic_ids").eq("user_id", user_id).maybe_single()
    )
    topics = len((prof_res.data or {}).get("completed_topic_ids") or [])
    if topics > 0:
        sub["educacion"] = min(100, round(topics / 20 * 100))

    # Paciencia — inverse of the impulsive (fomo/panic) decision ratio, with
    # a small real-evidence bonus for having held through an actual drawdown.
    style_ratio = _decision_style_ratio(ctx["decisions"])
    if style_ratio is not None:
        paciencia = round((1 - style_ratio) * 100)
        drawdowns = _find_significant_drawdowns(ctx["snapshots"])[:1]
        if drawdowns and _held_through_drawdown(ctx, drawdowns[0]["peak_date"]):
            paciencia = min(100, paciencia + 10)
        sub["paciencia"] = paciencia

    # Diversificación — inverse of the dominant sector's concentration.
    latest_snap = ctx["snapshots"][-1] if ctx["snapshots"] else None
    sector_weights = (latest_snap or {}).get("sector_weights") or {}
    if sector_weights:
        sub["diversificacion"] = round((1 - max(sector_weights.values())) * 100)

    # Análisis — from the Investment Graph's own real engagement metrics.
    graph_metrics = await investment_graph_service.compute_metrics(user_id)
    if graph_metrics.get("total_theses"):
        analisis = min(100, round(graph_metrics["total_theses"] / 30 * 100))
        if graph_metrics.get("thesis_accuracy_pct") is not None:
            analisis = round((analisis + graph_metrics["thesis_accuracy_pct"]) / 2)
        sub["analisis"] = analisis

    if not sub:
        return None
    return {"score": round(sum(sub.values()) / len(sub)), "sub_scores": sub}


# ── Arthur context (Fase 2: wired into ai_service.py's dynamic addendum) ──

_MENTOR_CONTEXT_TTL = 3600  # 1h — since_purchase computation is network-bound


async def build_progress_context_for_mentor(user_id: str) -> str | None:
    """
    Short paragraph summarizing the user's real progress, injected into the
    Arthur's dynamic system prompt addendum on every chat turn. Cached
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
    ctx = await _build_context(user_id)
    summary = await compute_progress_summary(user_id, ctx=ctx)
    if not summary:
        return None

    parts: list[str] = []

    if "days_since_first_investment" in summary:
        parts.append(f"Lleva {summary['days_since_first_investment']} días invirtiendo desde su primera posición.")
    if "total_operations" in summary:
        parts.append(f"Ha realizado {summary['total_operations']} operaciones en total.")
    if "cumulative_return_pct" in summary:
        parts.append(f"Su retorno acumulado desde el inicio es de {summary['cumulative_return_pct']}%.")
    if "current_patrimonio" in summary:
        parts.append(f"Su patrimonio actual es ${summary['current_patrimonio']:,.0f}.")
    if "consecutive_months_contributing" in summary:
        parts.append(f"Lleva {summary['consecutive_months_contributing']} meses consecutivos aportando capital.")

    evolution = await detect_behavior_evolution(user_id, ctx=ctx)
    for e in evolution:
        parts.append(f"{e['before']} {e['after']}")

    if not parts:
        return None

    return "## 📈 EVOLUCIÓN DEL USUARIO COMO INVERSIONISTA\n\n" + " ".join(parts)
