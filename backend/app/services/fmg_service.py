"""
Portfolio progress tracking service (formerly "Financial Memory Graph").

The conversational-memory layer (fmg_memories, fmg_behavioral_patterns, and
the per-message Claude extraction that fed them) has been removed — it was
a per-chat-message token cost with no proven retention impact. What remains
here is the portfolio-history plumbing that the Investor Progress Engine
depends on:
  - fmg_events             → immutable timeline of milestones (achievements)
  - fmg_portfolio_snapshots → daily wealth snapshots for longitudinal analysis

Table names are unchanged (no migration needed) even though this file no
longer implements a "memory graph".
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.core.database import get_supabase, run_query

log = logging.getLogger(__name__)


# ── Public event logger (called from other routes) ────────────────────────────

async def log_event(
    user_id: str,
    event_type: str,
    title: str,
    description: str = "",
    metadata: dict | None = None,
    milestone_key: str | None = None,
) -> None:
    """
    Manually log a timeline event from any part of the system.
    e.g. first portfolio position added, goal achieved, etc.

    Pass milestone_key for one-time achievements (e.g. "first_investment") —
    the (user_id, milestone_key) unique index makes this idempotent, so
    calling it again for an already-recorded milestone is a no-op insert error
    that's safely swallowed rather than a duplicate row.
    """
    try:
        db = get_supabase()
        await run_query(
            db.table("fmg_events").insert({
                "user_id":    user_id,
                "event_type": event_type,
                "title":      title,
                "description": description or None,
                "metadata":   metadata or {},
                "occurred_at": datetime.now(timezone.utc).isoformat(),
                **({"milestone_key": milestone_key} if milestone_key else {}),
            })
        )
    except Exception as exc:
        log.debug("FMG log_event failed: %s", exc)


# ── Portfolio snapshot (called daily from worker) ─────────────────────────────

async def take_portfolio_snapshot(user_id: str) -> None:
    """
    Save today's portfolio value as a permanent snapshot.
    Called once per day per user from the background worker.
    """
    try:
        from app.services.sector_lookup import get_sector_group_es

        db = get_supabase()
        today = datetime.now(timezone.utc).date().isoformat()

        # Check if already snapshotted today
        existing = await run_query(
            db.table("fmg_portfolio_snapshots")
            .select("id")
            .eq("user_id", user_id)
            .eq("snapshot_date", today)
            .limit(1)
        )
        if existing.data:
            return

        # Fetch current portfolio. A user can have up to 3 portfolios
        # (premium), so this can return multiple rows — sync.py's get_all
        # picking "default" is only a backward-compat shim for its legacy
        # `portfolio` (singular) field; it also returns a full `portfolios`
        # array with everything, which is the real behavior to match here.
        # Snapshotting only "default" silently excluded every non-default
        # (2nd/3rd broker) portfolio from total_value, sector_weights and
        # everything downstream (Investor Progress milestones).
        res = await run_query(
            db.table("user_portfolio").select("portfolio_id, positions").eq("user_id", user_id)
        )
        if not res.data:
            return

        raw: list = []
        for row in res.data:
            r = row.get("positions", [])
            if isinstance(r, dict):
                r = r.get("positions", [])
            if isinstance(r, list):
                raw.extend(r)
        if not raw:
            return

        total_value     = 0.0
        sector_totals: dict[str, float] = {}

        for pos in raw:
            # Stored positions use the frontend's camelCase field names (shares,
            # avgPrice) — this previously read "quantity"/"current_price"/"avg_price",
            # none of which exist on a position, so every snapshot recorded $0.
            # avgPrice is cost basis, not live market price — no cheap way to get a
            # real-time quote for every ticker of every user in a nightly batch job
            # without hammering the market data APIs, so this is an approximation.
            qty   = float(pos.get("shares", 0) or 0)
            price = float(pos.get("avgPrice", 0) or 0)
            value = qty * price
            total_value += value
            # Diego, 2026-08-30: real sector (one of the 11 GICS groups),
            # never a fabricated "Other" — see sector_lookup.py. A position
            # whose ticker genuinely has no resolvable sector is left out
            # of sector_totals entirely rather than dumped into a fake
            # bucket; total_value above already includes it, so it's still
            # counted in the portfolio total, just not attributed to a
            # sector slice.
            ticker = pos.get("ticker")
            sector = get_sector_group_es(ticker) if ticker else None
            if sector:
                sector_totals[sector] = sector_totals.get(sector, 0) + value

        sector_weights: dict[str, float] = {}
        if total_value > 0:
            sector_weights = {
                k: round(v / total_value, 4) for k, v in sector_totals.items()
            }
        top_sector = max(sector_totals, key=sector_totals.get) if sector_totals else None

        await run_query(
            db.table("fmg_portfolio_snapshots").insert({
                "user_id":        user_id,
                "snapshot_date":  today,
                "total_value":    round(total_value, 2),
                "positions_count": len(raw),
                "top_sector":     top_sector,
                "sector_weights": sector_weights,
            })
        )

        # Milestones accumulate daily so the Investor Progress Engine's API
        # (a later phase) doesn't start from a cold, empty timeline.
        try:
            from app.services.investor_progress_service import detect_new_milestones
            await detect_new_milestones(user_id)
        except Exception as exc:
            log.debug("Milestone detection failed for %s: %s", user_id, exc)
    except Exception as exc:
        log.debug("FMG snapshot failed for %s: %s", user_id, exc)


# ── Snapshot all active users (called from worker) ────────────────────────────

async def snapshot_all_active_users() -> None:
    """
    Take a portfolio snapshot for every user who has positions today.
    Called once per day from the background worker at market close.
    """
    try:
        db = get_supabase()
        result = await run_query(
            db.table("user_portfolio").select("user_id").limit(5000)
        )
        if not result.data:
            return

        user_ids = [r["user_id"] for r in result.data]
        log.info("FMG: snapshotting %d users", len(user_ids))

        # Process in batches to avoid hammering Supabase
        batch_size = 50
        for i in range(0, len(user_ids), batch_size):
            batch = user_ids[i : i + batch_size]
            await asyncio.gather(
                *[take_portfolio_snapshot(uid) for uid in batch],
                return_exceptions=True,
            )
            await asyncio.sleep(0.5)

    except Exception as exc:
        log.error("FMG snapshot_all_active_users failed: %s", exc)
