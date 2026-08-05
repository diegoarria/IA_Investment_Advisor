"""
Timeline Engine — Fase 3, Incremento 6 (Parte L — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

A thin READ layer over `company_timeline_events` — the table Change
Detection (Parte K, same increment, `change_detection.py`) writes to.
Deliberately NOT re-implementing storage/dedup logic here: that already
lives in `knowledge_store.save_timeline_event`/`get_company_timeline`
(Incremento 1). This module's job is presenting that data as the "company
evolution" context the brief asks for (new CEO, M&A, spin-offs, launches,
new segments, regulatory changes, margin/ROIC shifts) — not storing it.

Not to be confused with `investment_graph_service.get_company_timeline
(user_id, ticker)` — that is one USER's own activity log (their questions,
theses, watchlist actions). This is the company's own OBJECTIVE event
history, shared across every user, with no `user_id` at all. Same naming,
deliberately different shape, per the Fase 3 audit's confirmed gap.
"""

from __future__ import annotations

from typing import Optional


async def get_company_timeline(ticker: str, limit: int = 100) -> list[dict]:
    """The single entry point. A thin pass-through to `knowledge_store.
    get_company_timeline` — kept as its own function (rather than callers
    reaching into `knowledge_store` directly) so this module is the one,
    documented public surface for "Parte L" per the package's `__init__.py`
    module map, and so future filtering/formatting logic (e.g. limiting to
    a date range, or grouping by `event_type`) has a natural home that
    doesn't leak into the generic storage layer."""
    from app.services.research.knowledge_store import get_company_timeline as _get_company_timeline
    return await _get_company_timeline(ticker, limit)


def format_timeline_for_prompt(events: list[dict], max_events: int = 20) -> str:
    """Renders a real timeline into prompt-ready text — used by the Thesis
    Engine (Incremento 7) and Investment Memo (Incremento 9) so a
    company's real event history is available as grounding context without
    either of those re-querying/re-formatting `company_timeline_events`
    themselves."""
    if not events:
        return ""
    lines = ["Línea de tiempo real de eventos de la empresa (más recientes primero):"]
    for e in events[:max_events]:
        date_part = f"{e.get('event_date')} — " if e.get("event_date") else ""
        lines.append(f"- {date_part}[{e.get('event_type')}] {e.get('headline')}")
    return "\n".join(lines)


def filter_by_event_type(events: list[dict], event_type: str) -> list[dict]:
    """Convenience filter — e.g. isolating every real 'ceo_change' or
    'margin_shift' event for a company without a second query, reusing
    the single real fetch `get_company_timeline` already made."""
    return [e for e in events if e.get("event_type") == event_type]
