"""
Knowledge Store — Fase 3, Incremento 1 (Parte J, "Knowledge Base Engine" —
see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

The persistence layer over `company_knowledge_snapshots` and
`company_timeline_events` (migration 060) — a permanent, per-COMPANY (never
per-user) knowledge base, so no Fase 3 engine ever has to re-research a
ticker from scratch. Confirmed gap in the Fase 3 audit: every prior
timeline/history table in this codebase (`fmg_events`,
`investment_graph_events`, `investment_decisions`) is scoped to `user_id` —
it tracks what a USER did/thought, never the company's own objective
history. This module is the opposite shape on purpose: shared, append-only.

`company_knowledge_snapshots` is NEVER updated in place — `save_snapshot`
always INSERTs a new row. "Incremental" (per the brief) means "a new row
each time there's new signal," not "mutate the existing row." This is what
lets Change Detection (Incremento 6) diff row N against row N-1 for the
same (ticker, section) without losing the prior state.

Every function here is best-effort on READ (returns None/[] on failure,
mirroring `investment_graph_service`'s conventions) but RAISES on WRITE
failure — a silently-dropped knowledge-base write would leave downstream
engines diffing against stale data with no way to know it happened, unlike
`investment_graph_service.log_event`'s fire-and-forget logging (which is
allowed to lose an event; losing a knowledge snapshot is not equivalent).
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

KNOWLEDGE_SECTIONS = (
    "document_intel", "business_understanding", "competitive", "industry", "management",
)


def _headline_hash(ticker: str, event_type: str, headline: str) -> str:
    """md5(ticker+event_type+headline) — same dedup shape as
    `major_news_events.headline_hash` (migration 036), the established
    precedent for deduping shared/global event rows in this codebase."""
    raw = f"{ticker.upper()}|{event_type}|{headline.strip().lower()}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


# ── company_knowledge_snapshots ─────────────────────────────────────────────

async def save_snapshot(
    ticker: str, section: str, content: dict, source_period: Optional[str] = None,
) -> dict:
    """Inserts a NEW snapshot row — never an update. Raises on failure (see
    module docstring for why this isn't fire-and-forget like
    `investment_graph_service.log_event`). Returns the inserted row."""
    if section not in KNOWLEDGE_SECTIONS:
        raise ValueError(f"section must be one of {KNOWLEDGE_SECTIONS}, got {section!r}")
    db = get_supabase()
    res = await run_query(
        db.table("company_knowledge_snapshots").insert({
            "ticker": ticker.upper(),
            "section": section,
            "content": content,
            "source_period": source_period,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    )
    return res.data[0] if res.data else {}


async def get_latest_snapshot(ticker: str, section: str) -> Optional[dict]:
    """The most recent snapshot for (ticker, section), or None if this
    company/section has never been researched — the caller (e.g. Business
    Understanding on its first-ever run for a ticker) must treat None as
    "start from scratch," not as an error."""
    try:
        db = get_supabase()
        res = await run_query(
            db.table("company_knowledge_snapshots")
            .select("*")
            .eq("ticker", ticker.upper()).eq("section", section)
            .order("created_at", desc=True)
            .limit(1)
        )
        return res.data[0] if res.data else None
    except Exception as exc:
        logger.warning("get_latest_snapshot(%s, %s) failed: %s", ticker, section, exc)
        return None


async def get_snapshot_history(ticker: str, section: str, limit: int = 20) -> list[dict]:
    """Every snapshot for (ticker, section), most recent first — used by
    Change Detection (Incremento 6) when a diff needs more than just the
    immediately-prior row (e.g. detecting a multi-quarter drift)."""
    try:
        db = get_supabase()
        res = await run_query(
            db.table("company_knowledge_snapshots")
            .select("*")
            .eq("ticker", ticker.upper()).eq("section", section)
            .order("created_at", desc=True)
            .limit(limit)
        )
        return res.data or []
    except Exception as exc:
        logger.warning("get_snapshot_history(%s, %s) failed: %s", ticker, section, exc)
        return []


# ── company_timeline_events ─────────────────────────────────────────────────

async def save_timeline_event(
    ticker: str, event_type: str, headline: str,
    event_date: Optional[str] = None, detail: Optional[dict] = None,
    detected_from_snapshot_id: Optional[str] = None, source_claim: Optional[dict] = None,
) -> Optional[dict]:
    """Inserts a new company-level timeline event. Idempotent via the
    (ticker, event_type, headline_hash) unique index (migration 060) —
    reprocessing the same quarter's Change Detection run must never
    duplicate an already-recorded event, so a unique-violation here is
    swallowed and treated as "already recorded," not an error (unlike
    `save_snapshot`, which has no dedup concept and always raises)."""
    db = get_supabase()
    row = {
        "ticker": ticker.upper(),
        "event_type": event_type,
        "headline": headline,
        "event_date": event_date,
        "detail": detail or {},
        "detected_from_snapshot_id": detected_from_snapshot_id,
        "source_claim": source_claim,
        "headline_hash": _headline_hash(ticker, event_type, headline),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        res = await run_query(db.table("company_timeline_events").insert(row))
        return res.data[0] if res.data else None
    except Exception as exc:
        # A unique-violation on (ticker, event_type, headline_hash) means
        # this exact event was already recorded — that's success, not
        # failure, for an idempotent re-run. Any other error re-raises.
        if "duplicate key" in str(exc).lower() or "unique" in str(exc).lower():
            logger.info("save_timeline_event(%s): already recorded (%s)", ticker, headline)
            return None
        raise


async def get_company_timeline(ticker: str, limit: int = 100) -> list[dict]:
    """Every real, objective event recorded for this company, most recent
    first — NOT to be confused with `investment_graph_service.
    get_company_timeline(user_id, ticker)`, which is one user's own
    activity log. This one has no `user_id` at all; it's shared across
    every user who ever looks at this ticker."""
    try:
        db = get_supabase()
        res = await run_query(
            db.table("company_timeline_events")
            .select("*")
            .eq("ticker", ticker.upper())
            .order("event_date", desc=True, nullsfirst=False)
            .limit(limit)
        )
        return res.data or []
    except Exception as exc:
        logger.warning("get_company_timeline(%s) failed: %s", ticker, exc)
        return []
