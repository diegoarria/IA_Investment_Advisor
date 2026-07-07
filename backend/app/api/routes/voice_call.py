"""Mentor IA — real-time voice call.

A single WebSocket carries the whole conversation: the client streams mic
audio while the user talks, tells the server when an utterance ends, and the
server replies by streaming synthesized speech back sentence-by-sentence as
soon as each sentence is ready (so the user starts hearing the answer before
the full response has even finished generating).

Barge-in: if the client detects the user talking again while the assistant's
audio is still streaming, it sends {"type":"barge_in"} and the server cancels
the in-flight LLM/TTS task immediately — this is what makes it feel like a
call instead of a walkie-talkie.

Protocol (JSON control frames + raw binary audio frames on the same socket):
  Client → Server
    {"type":"start", "mentor": "<mentor_id>"}   — once, right after connecting
    <binary audio chunk>                         — while the user is speaking
    {"type":"utterance_end"}                     — user stopped talking
    {"type":"barge_in"}                          — user started talking again
                                                    while the assistant was speaking
  Server → Client
    {"type":"ready"}
    {"type":"transcript", "text": "..."}
    {"type":"assistant_sentence", "text": "..."} followed by <binary mp3 chunk>
    {"type":"assistant_done"}
    {"type":"cancelled"}
    {"type":"error", "detail": "..."}
"""
import asyncio
import base64
import json
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.api.deps import _resolve_user, get_current_user_id
from app.core.database import get_supabase, run_query
from app.models.user import ChatMessage, UserProfile
from app.services import ai_service, fmg_service, investor_progress_service
from app.services.voice_service import transcribe_audio_bytes, synthesize_speech_bytes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/voice", tags=["voice-call"])

_MAX_HISTORY_TURNS = 20
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_MIN_SENTENCE_CHARS = 12

_VOICE_STYLE_INSTRUCTIONS = (
    "Estás en una LLAMADA DE VOZ en tiempo real, no en un chat de texto. Habla como hablaría "
    "un amigo o mentor de carne y hueso en una conversación real:\n"
    "- Respuestas CORTAS — 1 a 3 oraciones por turno como máximo. Nunca uses listas con viñetas "
    "ni numeración (suenan artificiales al escucharlas en voz alta).\n"
    "- Ve directo al grano, sin preámbulos ni resúmenes de lo que vas a decir.\n"
    "- Si el tema da para más, responde lo esencial primero y pregunta si quiere que profundices, "
    "en vez de soltarlo todo de una vez.\n"
    "- Tono cálido y natural, como una charla en persona — no como un reporte financiero."
)


async def _load_profile(user_id: str) -> UserProfile | None:
    try:
        db = get_supabase()
        res = await run_query(db.table("user_profiles").select("*").eq("user_id", user_id))
        return UserProfile(**res.data[0]) if res.data else None
    except Exception:
        return None


def _is_premium(profile: UserProfile | None) -> bool:
    return bool(profile and profile.subscription_tier in ("premium", "pro"))


async def _load_call_context(user_id: str, profile: UserProfile | None, is_premium: bool) -> dict:
    """Fetched once per call, not per utterance — a voice call has many turns
    in a few minutes and this context doesn't meaningfully change between them."""
    from app.api.routes.chat import _get_mentor_deep_context

    async def _progress_ctx():
        if not is_premium:
            return None
        return await investor_progress_service.build_progress_context_for_mentor(user_id)

    deep_ctx, fmg_ctx, progress_ctx = await asyncio.gather(
        _get_mentor_deep_context(user_id),
        fmg_service.get_fmg_context(user_id),
        _progress_ctx(),
        return_exceptions=True,
    )
    return {
        "deep_context": None if isinstance(deep_ctx, Exception) else deep_ctx,
        "fmg_context": None if isinstance(fmg_ctx, Exception) else fmg_ctx,
        "progress_context": None if isinstance(progress_ctx, Exception) else progress_ctx,
    }


async def _save_transcript(
    user_id: str,
    mentor_id: str | None,
    started_at: datetime,
    history: list[ChatMessage],
) -> None:
    """Persist the call's text transcript — not audio — once the call ends.
    Skips near-empty calls (just the greeting, no real exchange)."""
    if len(history) < 2:
        return
    try:
        db = get_supabase()
        ended_at = datetime.now(timezone.utc)
        await run_query(
            db.table("voice_call_transcripts").insert({
                "user_id":          user_id,
                "mentor":           mentor_id,
                "started_at":       started_at.isoformat(),
                "ended_at":         ended_at.isoformat(),
                "duration_seconds": max(0, int((ended_at - started_at).total_seconds())),
                "turns":            [{"role": m.role, "text": m.content} for m in history],
            })
        )
    except Exception as e:
        logger.warning("Voice call transcript save failed for %s: %s", user_id, e)


# ── GET /api/voice/calls — list past call transcripts ─────────────────────────
@router.get("/calls")
async def list_calls(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("voice_call_transcripts")
        .select("id, mentor, started_at, duration_seconds")
        .eq("user_id", user_id)
        .order("started_at", desc=True)
        .limit(100)
    )
    return {"calls": res.data or []}


# ── GET /api/voice/calls/{id} — full transcript ───────────────────────────────
@router.get("/calls/{call_id}")
async def get_call(call_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("voice_call_transcripts").select("*")
        .eq("id", call_id).eq("user_id", user_id).limit(1)
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Llamada no encontrada")
    return res.data[0]


# ── DELETE /api/voice/calls/{id} ───────────────────────────────────────────────
@router.delete("/calls/{call_id}")
async def delete_call(call_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    res = await run_query(
        db.table("voice_call_transcripts").delete().eq("id", call_id).eq("user_id", user_id)
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Llamada no encontrada")
    return {"deleted": True}


@router.websocket("/call/ws")
async def voice_call_ws(websocket: WebSocket, token: str = ""):
    try:
        user = await _resolve_user(f"Bearer {token}")
    except Exception:
        await websocket.close(code=4401)
        return
    user_id = user["id"]

    await websocket.accept()
    send_lock = asyncio.Lock()

    async def _send_json(payload: dict):
        async with send_lock:
            await websocket.send_json(payload)

    profile = await _load_profile(user_id)
    is_premium = _is_premium(profile)
    ctx = await _load_call_context(user_id, profile, is_premium)
    mentor_id = profile.mentor if profile else None

    call_started_at = datetime.now(timezone.utc)
    history: list[ChatMessage] = []
    audio_buffer = bytearray()
    current_task: asyncio.Task | None = None

    async def _run_turn(user_audio: bytes, mime: str = "audio/webm"):
        try:
            ext = mime.split("/")[-1] or "webm"
            user_text = await transcribe_audio_bytes(user_audio, filename=f"utterance.{ext}", content_type=mime)
            user_text = (user_text or "").strip()
            if not user_text:
                await _send_json({"type": "assistant_done"})
                return
            await _send_json({"type": "transcript", "text": user_text})

            full_reply = ""
            sentence_buf = ""
            async for chunk in ai_service.chat_stream(
                message=user_text,
                conversation_history=history,
                profile=profile,
                mentor=mentor_id,
                memory_context=None,
                deep_context=ctx["deep_context"],
                fmg_context=ctx["fmg_context"],
                progress_context=ctx["progress_context"],
                is_premium=is_premium,
                style_instructions=_VOICE_STYLE_INSTRUCTIONS,
            ):
                full_reply += chunk
                sentence_buf += chunk
                parts = _SENTENCE_SPLIT_RE.split(sentence_buf)
                if len(parts) > 1:
                    # Everything but the last (possibly incomplete) fragment is ready to speak
                    *ready, sentence_buf = parts
                    for sentence in ready:
                        sentence = sentence.strip()
                        if len(sentence) < _MIN_SENTENCE_CHARS:
                            continue
                        audio = await synthesize_speech_bytes(sentence)
                        await _send_json({
                            "type": "assistant_sentence",
                            "text": sentence,
                            "audio_b64": base64.b64encode(audio).decode() if audio else None,
                        })

            tail = sentence_buf.strip()
            if tail:
                audio = await synthesize_speech_bytes(tail)
                await _send_json({
                    "type": "assistant_sentence",
                    "text": tail,
                    "audio_b64": base64.b64encode(audio).decode() if audio else None,
                })

            await _send_json({"type": "assistant_done"})

            history.append(ChatMessage(role="user", content=user_text))
            history.append(ChatMessage(role="assistant", content=full_reply))
            del history[:-_MAX_HISTORY_TURNS * 2]

            user_name = getattr(profile, "name", None) if profile else None
            asyncio.create_task(
                fmg_service.extract_from_conversation(user_id, user_text, full_reply, user_name, is_premium=is_premium)
            )

        except asyncio.CancelledError:
            await _send_json({"type": "cancelled"})
            raise
        except Exception as e:
            logger.warning("Voice call turn failed for %s: %s", user_id, e)
            try:
                await _send_json({"type": "error", "detail": "No pude procesar ese audio, intenta de nuevo."})
            except Exception:
                pass

    async def _send_greeting():
        first_name = (getattr(profile, "name", None) or "").split()[0] if profile and getattr(profile, "name", None) else None
        greeting = (
            f"Hola {first_name}, soy tu mentor financiero y es un placer atenderte y poder "
            f"conversar contigo. Cuéntame, ¿cómo puedo ayudarte?"
            if first_name else
            "Hola, soy tu mentor financiero y es un placer atenderte y poder conversar contigo. "
            "Cuéntame, ¿cómo puedo ayudarte?"
        )
        try:
            audio = await synthesize_speech_bytes(greeting)
            await _send_json({
                "type": "assistant_sentence",
                "text": greeting,
                "audio_b64": base64.b64encode(audio).decode() if audio else None,
            })
            await _send_json({"type": "assistant_done"})
            history.append(ChatMessage(role="assistant", content=greeting))
        except Exception as e:
            logger.warning("Voice call greeting failed for %s: %s", user_id, e)
            await _send_json({"type": "assistant_done"})

    try:
        await _send_json({"type": "ready"})
        await _send_greeting()
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            raw_bytes = message.get("bytes")
            raw_text = message.get("text")

            if raw_bytes is not None:
                audio_buffer.extend(raw_bytes)
                continue

            if raw_text is None:
                continue

            try:
                data = json.loads(raw_text)
            except Exception:
                continue
            msg_type = data.get("type")

            if msg_type == "utterance_end":
                if current_task and not current_task.done():
                    continue  # already processing a turn — ignore stray end signals
                audio = bytes(audio_buffer)
                audio_buffer.clear()
                if not audio:
                    continue
                current_task = asyncio.create_task(_run_turn(audio))

            elif msg_type == "utterance_audio":
                # Mobile path: whole utterance as one base64 JSON message instead of
                # raw binary chunks + utterance_end (React Native has no easy way to
                # get an ArrayBuffer out of a recording file URI for a binary WS send).
                if current_task and not current_task.done():
                    continue
                b64 = data.get("audio_b64")
                if not b64:
                    continue
                try:
                    audio = base64.b64decode(b64)
                except Exception:
                    continue
                mime = data.get("mime") or "audio/m4a"
                current_task = asyncio.create_task(_run_turn(audio, mime=mime))

            elif msg_type == "barge_in":
                audio_buffer.clear()
                if current_task and not current_task.done():
                    current_task.cancel()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("Voice call websocket error for %s: %s", user_id, e)
    finally:
        if current_task and not current_task.done():
            current_task.cancel()
        await _save_transcript(user_id, mentor_id, call_started_at, history)
