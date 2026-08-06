"""
Shared async resilience wrapper — Fase 3, Incremento 10 (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Promoted here from `nif_service._safe` (Fase 2) now that
`research_orchestrator.py` becomes a second real consumer of the exact
same pattern — every sub-call in a multi-engine dashboard/dossier
orchestrator must degrade independently, so one slow/failed engine can
never take down the whole response. `nif_service._safe` becomes a thin
alias that keeps its original (ticker-first) signature for its many
existing call sites.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, TypeVar

_log = logging.getLogger(__name__)

T = TypeVar("T")


async def safe_call(coro: Awaitable[T], fallback: T, label: str, timeout: float = 20.0, context: str = "") -> T:
    """Awaits `coro` with a timeout; on ANY exception (including timeout),
    logs a warning and returns `fallback` instead of propagating — the
    caller's whole response must never fail because one sub-call did.
    `context` is free-form (e.g. a ticker) prefixed onto the log line."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except Exception as e:
        prefix = f"({context}) " if context else ""
        _log.warning("safe_call %s%s failed: %s", prefix, label, e)
        return fallback
