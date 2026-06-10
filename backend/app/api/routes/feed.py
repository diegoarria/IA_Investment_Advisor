import logging
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase
from app.core.config import settings
from app.services.ai_service import _claude

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
        .select("id,title,description,video_url,thumbnail_url,speaker,tags,language,translated_caption,caption_en,duration_sec,view_count,like_count,comment_count,created_at,pre_audio_url,post_audio_url,pre_text,post_text")
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
    all_rows = (
        db.table("clip_comments")
        .select("id,user_id,text,parent_id,created_at,is_deleted")
        .eq("clip_id", clip_id)
        .order("created_at")
        .limit(100)
        .execute()
        .data or []
    )
    rows = [r for r in all_rows if not r.get("is_deleted")]

    # Fetch user profiles separately (no direct FK between clip_comments and user_profiles)
    if rows:
        user_ids = list({r["user_id"] for r in rows})
        profiles = (
            db.table("user_profiles")
            .select("user_id,name,avatar_url")
            .in_("user_id", user_ids)
            .execute()
            .data or []
        )
        profile_map = {p["user_id"]: p for p in profiles}
        for r in rows:
            p = profile_map.get(r["user_id"], {})
            r["user_profiles"] = {"name": p.get("name") or "Usuario", "avatar_url": p.get("avatar_url")}

    top = [r for r in rows if not r.get("parent_id")]
    replies: dict = {}
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


@router.delete("/clips/{clip_id}/comments/{comment_id}")
async def delete_comment(clip_id: str, comment_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    row = db.table("clip_comments").select("user_id").eq("id", comment_id).eq("clip_id", clip_id).single().execute().data
    if not row:
        raise HTTPException(404, "Comentario no encontrado")
    if row["user_id"] != user_id:
        raise HTTPException(403, "Solo puedes eliminar tus propios comentarios")
    db.table("clip_comments").update({"is_deleted": True}).eq("id", comment_id).execute()
    db.rpc("decrement_clip_comments", {"p_clip_id": clip_id}).execute()
    return {"ok": True}


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
        "caption_en":         body.get("caption_en", ""),
        "duration_sec":       body.get("duration_sec", 0),
        "status":             "draft",
        "created_by":         user_id,
    }).execute().data[0]
    return {"clip": row}


@router.patch("/admin/clips/{clip_id}")
async def update_clip(clip_id: str, body: dict, user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    allowed = {"title", "description", "video_url", "thumbnail_url", "speaker",
               "tags", "language", "translated_caption", "caption_en", "duration_sec", "status"}
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


@router.post("/admin/clips/{clip_id}/generate-audio")
async def generate_clip_audio(clip_id: str, user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    if not settings.elevenlabs_api_key:
        raise HTTPException(400, "ELEVENLABS_API_KEY no configurada en el servidor")

    db = get_supabase()
    clip = db.table("clips").select("*").eq("id", clip_id).single().execute().data
    if not clip:
        raise HTTPException(404, "Clip no encontrado")

    # 1. Generate pre/post text with Claude
    prompt = f"""Eres un narrador educativo de finanzas para Nuvos AI.
Vas a crear dos fragmentos de narración en voz para un clip de video educativo.

Clip: "{clip['title']}"
Speaker: {clip['speaker']}
Descripción: {clip.get('description') or 'Sin descripción'}
Tags: {', '.join(clip.get('tags') or [])}
Transcript/Caption: {clip.get('translated_caption') or 'No disponible'}

Genera exactamente este JSON (sin nada más):
{{
  "pre_text": "Introducción de 2-3 oraciones (máx 70 palabras). Presenta al speaker y el tema del clip. Debe sonar natural en voz alta, como si fuera narrado antes de ver el video.",
  "post_text": "Reflexión de 2-3 oraciones (máx 70 palabras). La lección clave o insight aplicable. Termina con una pregunta reflexiva para el usuario. Tono educativo y motivador."
}}"""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )
    import json, re
    raw = response.content[0].text
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if not match:
        raise HTTPException(500, "Claude no retornó JSON válido")
    texts = json.loads(match.group())
    pre_text  = texts.get("pre_text", "").strip()
    post_text = texts.get("post_text", "").strip()

    if not pre_text or not post_text:
        raise HTTPException(500, "Textos generados vacíos")

    # 2. Convert to audio via ElevenLabs TTS
    async def tts(text: str) -> bytes:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{settings.elevenlabs_voice_id}",
                headers={
                    "xi-api-key": settings.elevenlabs_api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "text": text,
                    "model_id": "eleven_multilingual_v2",
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75,
                        "speed": 1.25,
                    },
                },
            )
            if res.status_code != 200:
                raise HTTPException(502, f"ElevenLabs TTS error: {res.text[:200]}")
            return res.content

    pre_audio_bytes  = await tts(pre_text)
    post_audio_bytes = await tts(post_text)

    # 3. Upload to Supabase Storage
    def upload_audio(filename: str, data: bytes) -> str:
        try:
            db.storage.from_("clip-audio").remove([filename])
        except Exception:
            pass
        db.storage.from_("clip-audio").upload(
            path=filename,
            file=data,
            file_options={"content-type": "audio/mpeg", "upsert": "true"},
        )
        return db.storage.from_("clip-audio").get_public_url(filename)

    pre_audio_url  = upload_audio(f"{clip_id}_pre.mp3",  pre_audio_bytes)
    post_audio_url = upload_audio(f"{clip_id}_post.mp3", post_audio_bytes)

    # 4. Persist on clip record
    db.table("clips").update({
        "pre_text":       pre_text,
        "post_text":      post_text,
        "pre_audio_url":  pre_audio_url,
        "post_audio_url": post_audio_url,
    }).eq("id", clip_id).execute()

    return {
        "pre_text":       pre_text,
        "post_text":      post_text,
        "pre_audio_url":  pre_audio_url,
        "post_audio_url": post_audio_url,
    }


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
