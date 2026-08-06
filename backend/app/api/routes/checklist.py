"""
Investment Checklist — Fase 4, Incremento 8 (Parte H — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Thin routes over app.services.checklist_service. The one real business rule
this layer owns (not the service, per checklist_service.set_investable_mark's
own docstring): a ticker can only be marked "Invertible" once every one of
the user's CURRENT checklist items is checked.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user_id

router = APIRouter(prefix="/checklist", tags=["checklist"])


@router.get("/items")
async def get_checklist_items_route(user_id: str = Depends(get_current_user_id)):
    from app.services.checklist_service import get_user_checklist_items

    items = await get_user_checklist_items(user_id)
    return {"items": items}


@router.post("/items")
async def add_checklist_item_route(body: dict, user_id: str = Depends(get_current_user_id)):
    from app.services.checklist_service import add_checklist_item

    label = (body.get("label") or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="El item necesita una descripción.")
    items = await add_checklist_item(user_id, label)
    return {"items": items}


@router.delete("/items/{item_key}")
async def remove_checklist_item_route(item_key: str, user_id: str = Depends(get_current_user_id)):
    from app.services.checklist_service import remove_checklist_item

    items = await remove_checklist_item(user_id, item_key)
    return {"items": items}


@router.get("/{ticker}")
async def get_checklist_for_ticker_route(ticker: str, user_id: str = Depends(get_current_user_id)):
    """Items + which are checked for this ticker + current investable mark —
    everything the checklist UI for one company needs in one call."""
    from app.services.checklist_service import (
        get_user_checklist_items,
        get_checklist_completions,
        get_investable_mark,
    )

    items = await get_user_checklist_items(user_id)
    checked = await get_checklist_completions(user_id, ticker)
    mark = await get_investable_mark(user_id, ticker)
    return {
        "ticker": ticker.upper(),
        "items": [{**item, "checked": item["item_key"] in checked} for item in items],
        "is_investable": mark is not None,
        "marked_at": mark["marked_at"] if mark else None,
    }


@router.post("/{ticker}/{item_key}")
async def toggle_checklist_item_route(
    ticker: str, item_key: str, body: dict, user_id: str = Depends(get_current_user_id)
):
    from app.services.checklist_service import set_checklist_item_checked

    checked = bool(body.get("checked", True))
    await set_checklist_item_checked(user_id, ticker, item_key, checked)
    return {"ok": True}


@router.post("/{ticker}/investable")
async def set_investable_route(ticker: str, body: dict, user_id: str = Depends(get_current_user_id)):
    from app.services.checklist_service import (
        get_user_checklist_items,
        get_checklist_completions,
        set_investable_mark,
    )

    marked = bool(body.get("marked", True))
    if marked:
        items = await get_user_checklist_items(user_id)
        checked = await get_checklist_completions(user_id, ticker)
        pending = [i["item_key"] for i in items if i["item_key"] not in checked]
        if pending:
            raise HTTPException(
                status_code=400,
                detail="Todavía hay items del checklist sin completar para poder marcar esta empresa como Invertible.",
            )
    await set_investable_mark(user_id, ticker, marked)
    return {"ok": True, "is_investable": marked}
