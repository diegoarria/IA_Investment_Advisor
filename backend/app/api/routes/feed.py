import logging
from fastapi import APIRouter, Depends, Query, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/feed", tags=["feed"])


# ── Public feed ──────────────────────────────────────────────────────────────

@router.get("/clips")
async def get_clips(
    cursor: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=20),
    speaker: str | None = Query(None),
    tag: str | None = Query(None),
    sort: str = Query("recent", pattern="^(recent|trending)$"),
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    q = (
        db.table("clips")
        .select("id,title,description,video_url,thumbnail_url,speaker,tags,language,translated_caption,duration_sec,view_count,like_count,comment_count,created_at")
        .eq("status", "published")
    )
    if speaker:
        q = q.ilike("speaker", f"%{speaker}%")
    if tag:
        q = q.contains("tags", [tag])
    if sort == "trending":
        q = q.order("like_count", desc=True)
    else:
        q = q.order("created_at", desc=True)

    clips = q.range(cursor, cursor + limit - 1).execute().data or []

    # Attach per-user liked/saved state in one batch query
    if clips:
        ids = [c["id"] for c in clips]
        liked = {
            r["clip_id"]
            for r in (db.table("clip_likes").select("clip_id").eq("user_id", user_id).in_("clip_id", ids).execute().data or [])
        }
        saved = {
            r["clip_id"]
            for r in (db.table("clip_saves").select("clip_id").eq("user_id", user_id).in_("clip_id", ids).execute().data or [])
        }
        for c in clips:
            c["liked"] = c["id"] in liked
            c["saved"] = c["id"] in saved

    return {"clips": clips, "next_cursor": cursor + len(clips) if len(clips) == limit else None}


@router.post("/clips/{clip_id}/view")
async def track_view(clip_id: str, body: dict, user_id: str = Depends(get_current_user_id)):
    watched_pct = min(100, max(0, int(body.get("watched_pct", 0))))
    db = get_supabase()
    try:
        db.table("clip_views").upsert(
            {"user_id": user_id, "clip_id": clip_id, "watched_pct": watched_pct},
            on_conflict="user_id,clip_id",
        ).execute()
        if watched_pct >= 10:
            db.rpc("increment_clip_views", {"p_clip_id": clip_id}).execute()
    except Exception as e:
        logger.warning("view track failed: %s", e)
    return {"ok": True}


@router.post("/clips/{clip_id}/like")
async def toggle_like(clip_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    existing = db.table("clip_likes").select("id").eq("user_id", user_id).eq("clip_id", clip_id).execute().data
    if existing:
        db.table("clip_likes").delete().eq("user_id", user_id).eq("clip_id", clip_id).execute()
        db.rpc("decrement_clip_likes", {"p_clip_id": clip_id}).execute()
        return {"liked": False}
    else:
        db.table("clip_likes").insert({"user_id": user_id, "clip_id": clip_id}).execute()
        db.rpc("increment_clip_likes", {"p_clip_id": clip_id}).execute()
        return {"liked": True}


@router.post("/clips/{clip_id}/save")
async def toggle_save(clip_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    existing = db.table("clip_saves").select("id").eq("user_id", user_id).eq("clip_id", clip_id).execute().data
    if existing:
        db.table("clip_saves").delete().eq("user_id", user_id).eq("clip_id", clip_id).execute()
        return {"saved": False}
    else:
        db.table("clip_saves").insert({"user_id": user_id, "clip_id": clip_id}).execute()
        return {"saved": True}


@router.get("/clips/{clip_id}/comments")
async def get_comments(clip_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    rows = (
        db.table("clip_comments")
        .select("id,user_id,text,parent_id,created_at,user_profiles(name)")
        .eq("clip_id", clip_id)
        .eq("is_deleted", False)
        .order("created_at")
        .limit(100)
        .execute()
        .data or []
    )
    top = [r for r in rows if not r.get("parent_id")]
    replies = {}
    for r in rows:
        if r.get("parent_id"):
            replies.setdefault(r["parent_id"], []).append(r)
    for c in top:
        c["replies"] = replies.get(c["id"], [])
    return {"comments": top}


@router.post("/clips/{clip_id}/comments")
async def post_comment(clip_id: str, body: dict, user_id: str = Depends(get_current_user_id)):
    text = (body.get("text") or "").strip()
    if not text or len(text) > 500:
        raise HTTPException(400, "Comentario inválido (máx 500 caracteres)")
    parent_id = body.get("parent_id")
    db = get_supabase()
    row = db.table("clip_comments").insert({
        "user_id": user_id, "clip_id": clip_id,
        "text": text, "parent_id": parent_id,
    }).execute().data[0]
    db.rpc("increment_clip_comments", {"p_clip_id": clip_id}).execute()
    return {"comment": row}


@router.get("/liked")
async def get_liked_clips(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    likes = (
        db.table("clip_likes")
        .select("clip_id, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
        .data or []
    )
    if not likes:
        return {"clips": []}
    ids = [r["clip_id"] for r in likes]
    clips = (
        db.table("clips")
        .select("id,title,thumbnail_url,speaker,duration_sec,view_count,like_count")
        .eq("status", "published")
        .in_("id", ids)
        .execute()
        .data or []
    )
    order = {r["clip_id"]: i for i, r in enumerate(likes)}
    clips.sort(key=lambda c: order.get(c["id"], 999))
    return {"clips": clips}


# ── Admin endpoints ───────────────────────────────────────────────────────────

def _require_admin(user_id: str):
    db = get_supabase()
    row = db.table("user_profiles").select("is_admin").eq("user_id", user_id).single().execute().data
    if not row or not row.get("is_admin"):
        raise HTTPException(403, "Solo admins pueden gestionar clips")


@router.post("/admin/clips")
async def create_clip(body: dict, user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    required = ("title", "video_url", "speaker")
    for f in required:
        if not body.get(f):
            raise HTTPException(400, f"Campo requerido: {f}")
    db = get_supabase()
    row = db.table("clips").insert({
        "title":              body["title"],
        "description":        body.get("description", ""),
        "video_url":          body["video_url"],
        "thumbnail_url":      body.get("thumbnail_url", ""),
        "speaker":            body["speaker"],
        "tags":               body.get("tags", []),
        "language":           body.get("language", "es"),
        "translated_caption": body.get("translated_caption", ""),
        "duration_sec":       body.get("duration_sec", 0),
        "status":             "draft",
        "created_by":         user_id,
    }).execute().data[0]
    return {"clip": row}


@router.patch("/admin/clips/{clip_id}")
async def update_clip(clip_id: str, body: dict, user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    allowed = {"title", "description", "video_url", "thumbnail_url", "speaker",
               "tags", "language", "translated_caption", "duration_sec", "status"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "Nada que actualizar")
    db = get_supabase()
    row = db.table("clips").update(updates).eq("id", clip_id).execute().data[0]
    return {"clip": row}


@router.delete("/admin/clips/{clip_id}")
async def delete_clip(clip_id: str, user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    db = get_supabase()
    db.table("clips").delete().eq("id", clip_id).execute()
    return {"ok": True}


@router.get("/admin/clips")
async def list_all_clips(
    status: str = Query("draft"),
    user_id: str = Depends(get_current_user_id),
):
    _require_admin(user_id)
    db = get_supabase()
    rows = (
        db.table("clips")
        .select("*")
        .eq("status", status)
        .order("created_at", desc=True)
        .execute()
        .data or []
    )
    return {"clips": rows}
