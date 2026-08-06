"""
Investment Checklist Service — Fase 4, Incremento 8 (Parte H — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Minimal backend support (migration 065) for a customizable checklist that
must be completed before a user marks a company "Invertible" — no new
financial/scoring logic, purely persistence for a UI gate (Decisión 3).

Default items are NOT rows in the database until a user customizes their
list — `get_user_checklist_items` returns `DEFAULT_CHECKLIST_ITEMS` (with
`label=None`, meaning "use the frontend's i18n translation for this key")
whenever `user_checklist_items` is empty for that user. The first add/
remove action "materializes" the real defaults into rows first
(`_materialize_defaults`), so personalization is always additive on top
of the real default set, never a from-scratch rebuild.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from app.core.database import get_supabase, run_query

# Matches the brief's own examples (Parte H) — labels live in the
# frontend's i18n (subvaluadas.investableChecklist.items.*), same
# convention as the existing 7-point checklist's
# subvaluadas.checklist.items.*.
DEFAULT_CHECKLIST_ITEMS = [
    "understand_business",
    "know_risks",
    "read_thesis",
    "margin_of_safety",
    "moat_still_valid",
    "loss_scenario",
]


async def get_user_checklist_items(user_id: str) -> list[dict]:
    """The user's real personalized item list, or the real default set
    (never fabricated rows) when they've never customized it. Each item:
    `{"item_key": str, "label": str | None, "is_custom": bool}` —
    `label=None` on a default item tells the frontend to use its own
    i18n translation for `item_key`."""
    db = get_supabase()
    res = await run_query(
        db.table("user_checklist_items").select("*").eq("user_id", user_id).order("sort_order")
    )
    rows = res.data or []
    if not rows:
        return [{"item_key": k, "label": None, "is_custom": False} for k in DEFAULT_CHECKLIST_ITEMS]
    return [{"item_key": r["item_key"], "label": r["label"], "is_custom": True} for r in rows]


async def _materialize_defaults(user_id: str) -> None:
    db = get_supabase()
    rows = [
        {"user_id": user_id, "item_key": key, "label": None, "sort_order": i}
        for i, key in enumerate(DEFAULT_CHECKLIST_ITEMS)
    ]
    await run_query(db.table("user_checklist_items").insert(rows))


async def add_checklist_item(user_id: str, label: str) -> list[dict]:
    """Adds one real, user-authored custom item. Materializes the
    defaults first if this is the user's first-ever customization, so the
    new item is additive to the real default set, not a replacement of it."""
    current = await get_user_checklist_items(user_id)
    if not any(item["is_custom"] for item in current):
        await _materialize_defaults(user_id)
        current = await get_user_checklist_items(user_id)

    db = get_supabase()
    new_key = f"custom_{uuid.uuid4().hex[:8]}"
    await run_query(
        db.table("user_checklist_items").insert({
            "user_id": user_id, "item_key": new_key, "label": label.strip(), "sort_order": len(current),
        })
    )
    return await get_user_checklist_items(user_id)


async def remove_checklist_item(user_id: str, item_key: str) -> list[dict]:
    """Removes one item (default or custom) from the user's personalized
    list. Materializes the defaults first if needed, same reasoning as
    `add_checklist_item` — you can't remove a default item that was never
    a real row without first making it one."""
    current = await get_user_checklist_items(user_id)
    if not any(item["is_custom"] for item in current):
        await _materialize_defaults(user_id)

    db = get_supabase()
    await run_query(
        db.table("user_checklist_items").delete().eq("user_id", user_id).eq("item_key", item_key)
    )
    return await get_user_checklist_items(user_id)


async def get_checklist_completions(user_id: str, ticker: str) -> set[str]:
    """The real set of item_keys checked for this (user, ticker) — a
    missing key means unchecked, never a fabricated default."""
    db = get_supabase()
    res = await run_query(
        db.table("checklist_completions").select("item_key").eq("user_id", user_id).eq("ticker", ticker.upper())
    )
    return {r["item_key"] for r in (res.data or [])}


async def set_checklist_item_checked(user_id: str, ticker: str, item_key: str, checked: bool) -> None:
    """A row's existence IS the checked state — same pattern as
    watchlist/price_alerts. Idempotent both ways: checking an
    already-checked item or unchecking an already-unchecked one is a
    harmless no-op, never an error."""
    db = get_supabase()
    if checked:
        try:
            await run_query(
                db.table("checklist_completions").insert({
                    "user_id": user_id, "ticker": ticker.upper(), "item_key": item_key,
                })
            )
        except Exception as exc:
            if "duplicate" not in str(exc).lower() and "unique" not in str(exc).lower():
                raise
    else:
        await run_query(
            db.table("checklist_completions").delete()
            .eq("user_id", user_id).eq("ticker", ticker.upper()).eq("item_key", item_key)
        )


async def get_investable_mark(user_id: str, ticker: str) -> Optional[dict]:
    db = get_supabase()
    res = await run_query(
        db.table("investable_marks").select("*").eq("user_id", user_id).eq("ticker", ticker.upper()).limit(1)
    )
    return res.data[0] if res.data else None


async def set_investable_mark(user_id: str, ticker: str, marked: bool) -> None:
    """The caller (the route) is responsible for verifying every current
    checklist item is checked before calling this with `marked=True` —
    this function only persists the state, it never re-validates the
    gate itself, keeping the real business rule ("all items checked") in
    exactly one place (the route)."""
    db = get_supabase()
    if marked:
        try:
            await run_query(
                db.table("investable_marks").insert({
                    "user_id": user_id, "ticker": ticker.upper(),
                    "marked_at": datetime.now(timezone.utc).isoformat(),
                })
            )
        except Exception as exc:
            if "duplicate" not in str(exc).lower() and "unique" not in str(exc).lower():
                raise
    else:
        await run_query(
            db.table("investable_marks").delete().eq("user_id", user_id).eq("ticker", ticker.upper())
        )
