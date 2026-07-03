"""Financial Memory Graph — REST API endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Literal

from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.services import fmg_service

router = APIRouter(prefix="/fmg", tags=["fmg"])


# ── GET /api/fmg/memories ─────────────────────────────────────────────────────
@router.get("/memories")
async def get_memories(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("fmg_memories")
        .select("id, type, content, source, confidence, times_reinforced, created_at")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .order("times_reinforced", desc=True)
        .limit(100)
    )
    return {"memories": res.data or []}


# ── GET /api/fmg/patterns ─────────────────────────────────────────────────────
@router.get("/patterns")
async def get_patterns(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("fmg_behavioral_patterns")
        .select("id, pattern_key, description, confidence, times_observed, is_positive, first_detected_at, last_detected_at")
        .eq("user_id", user_id)
        .order("confidence", desc=True)
        .limit(50)
    )
    return {"patterns": res.data or []}


# ── GET /api/fmg/timeline ─────────────────────────────────────────────────────
@router.get("/timeline")
async def get_timeline(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("fmg_events")
        .select("id, event_type, title, description, metadata, occurred_at")
        .eq("user_id", user_id)
        .order("occurred_at", desc=True)
        .limit(50)
    )
    return {"events": res.data or []}


# ── GET /api/fmg/snapshots ────────────────────────────────────────────────────
@router.get("/snapshots")
async def get_snapshots(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("fmg_portfolio_snapshots")
        .select("snapshot_date, total_value, positions_count, top_sector, sector_weights")
        .eq("user_id", user_id)
        .order("snapshot_date", desc=True)
        .limit(365)
    )
    return {"snapshots": res.data or []}


# ── GET /api/fmg/summary ──────────────────────────────────────────────────────
@router.get("/summary")
async def get_summary(user_id: str = Depends(get_current_user_id)):
    """Full FMG summary for the profile Memory tab."""
    db = get_supabase()
    import asyncio
    memories_res, patterns_res, events_res, snapshots_res = await asyncio.gather(
        run_query(
            db.table("fmg_memories")
            .select("id, type, content, times_reinforced, created_at")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .order("times_reinforced", desc=True)
            .limit(50)
        ),
        run_query(
            db.table("fmg_behavioral_patterns")
            .select("id, pattern_key, description, confidence, times_observed, is_positive, last_detected_at")
            .eq("user_id", user_id)
            .order("confidence", desc=True)
            .limit(20)
        ),
        run_query(
            db.table("fmg_events")
            .select("id, event_type, title, description, occurred_at")
            .eq("user_id", user_id)
            .order("occurred_at", desc=True)
            .limit(30)
        ),
        run_query(
            db.table("fmg_portfolio_snapshots")
            .select("snapshot_date, total_value, top_sector")
            .eq("user_id", user_id)
            .order("snapshot_date", desc=True)
            .limit(30)
        ),
        return_exceptions=True,
    )
    return {
        "memories":  [] if isinstance(memories_res,  Exception) else (memories_res.data  or []),
        "patterns":  [] if isinstance(patterns_res,  Exception) else (patterns_res.data  or []),
        "events":    [] if isinstance(events_res,    Exception) else (events_res.data    or []),
        "snapshots": [] if isinstance(snapshots_res, Exception) else (snapshots_res.data or []),
    }


# ── POST /api/fmg/memories ────────────────────────────────────────────────────
class MemoryCreate(BaseModel):
    type: Literal["belief","preference","rule","lesson","bias","goal","insight"]
    content: str = Field(..., min_length=3, max_length=200)

@router.post("/memories", status_code=201)
async def add_memory(
    body: MemoryCreate,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    res = await run_query(
        db.table("fmg_memories").insert({
            "user_id":  user_id,
            "type":     body.type,
            "content":  body.content.strip(),
            "source":   "manual",
            "confidence": 1.0,
            "times_reinforced": 1,
            "is_active": True,
        })
    )
    return {"id": res.data[0]["id"] if res.data else None}


# ── DELETE /api/fmg/memories/{id} ────────────────────────────────────────────
@router.delete("/memories/{memory_id}")
async def delete_memory(
    memory_id: str,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    res = await run_query(
        db.table("fmg_memories")
        .update({"is_active": False})
        .eq("id", memory_id)
        .eq("user_id", user_id)
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"deleted": True}
