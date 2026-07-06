"""Personal Financial Library — the permanent, compounding record of saved
analyses, notes, investment theses, earnings summaries, and uploads.
The switching-cost feature: portable watchlists are cheap, eighteen months
of a user's own saved thinking is not."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Literal, Optional

from datetime import datetime, timezone

from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query

router = APIRouter(prefix="/library", tags=["library"])

ITEM_TYPES = ("analysis", "note", "thesis", "earnings_summary", "upload", "bookmark")


# ── GET /api/library ───────────────────────────────────────────────────────────
@router.get("")
async def list_items(
    ticker: Optional[str] = None,
    item_type: Optional[str] = None,
    limit: int = 50,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    q = (
        db.table("library_items")
        .select("id, item_type, ticker, title, body, source, file_url, metadata, created_at, updated_at")
        .eq("user_id", user_id)
    )
    if ticker:
        q = q.eq("ticker", ticker.upper())
    if item_type:
        q = q.eq("item_type", item_type)
    q = q.order("created_at", desc=True).limit(min(limit, 200))
    res = await run_query(q)
    return {"items": res.data or []}


# ── GET /api/library/{item_id} ────────────────────────────────────────────────
@router.get("/{item_id}")
async def get_item(item_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("library_items").select("*").eq("id", item_id).eq("user_id", user_id).limit(1)
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Elemento no encontrado")
    return res.data[0]


# ── POST /api/library ──────────────────────────────────────────────────────────
class LibraryItemCreate(BaseModel):
    item_type: Literal[*ITEM_TYPES]
    title: str = Field(..., min_length=1, max_length=160)
    body: Optional[str] = Field(None, max_length=20000)
    ticker: Optional[str] = Field(None, max_length=12)
    source: Literal["user", "ai"] = "user"
    file_url: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


@router.post("", status_code=201)
async def save_item(body: LibraryItemCreate, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("library_items").insert({
            "user_id":   user_id,
            "item_type": body.item_type,
            "title":     body.title.strip(),
            "body":      body.body,
            "ticker":    body.ticker.upper() if body.ticker else None,
            "source":    body.source,
            "file_url":  body.file_url,
            "metadata":  body.metadata,
        })
    )
    return {"id": res.data[0]["id"] if res.data else None}


# ── PATCH /api/library/{item_id} — edit a note/thesis ─────────────────────────
class LibraryItemUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=160)
    body: Optional[str] = Field(None, max_length=20000)


@router.patch("/{item_id}")
async def update_item(
    item_id: str,
    patch: LibraryItemUpdate,
    user_id: str = Depends(get_current_user_id),
):
    update = {k: v for k, v in patch.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    db = get_supabase()
    res = await run_query(
        db.table("library_items").update(update).eq("id", item_id).eq("user_id", user_id)
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Elemento no encontrado")
    return {"updated": True}


# ── DELETE /api/library/{item_id} ─────────────────────────────────────────────
@router.delete("/{item_id}")
async def delete_item(item_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("library_items").delete().eq("id", item_id).eq("user_id", user_id)
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Elemento no encontrado")
    return {"deleted": True}
