import asyncio
import base64
import os
import concurrent.futures

_ENRICH_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="chat-enrich")
import re
import json
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.models.user import ChatRequest, UserProfile
from app.services import ai_service
from app.services.market_data_service import (
    get_market_context_for_message,
    get_global_market_context,
    detect_tickers,
)
from app.core.limiter import limiter

FREE_MSG_LIMIT    = 20
PREMIUM_MSG_LIMIT = 200
MSG_WINDOW_HOURS  = 24


def _is_premium(profile) -> bool:
    """True for premium/pro subscribers and users within their 90-day trial."""
    if profile is None:
        return False
    from datetime import datetime as _dt, timezone as _tz
    tier = getattr(profile, "subscription_tier", "") or ""
    if tier in ("premium", "pro"):
        return True
    trial = getattr(profile, "trial_started_at", None)
    if trial:
        try:
            started = _dt.fromisoformat(trial.replace("Z", "+00:00"))
            return (_dt.now(_tz.utc) - started).days < 90
        except Exception:
            pass
    return False


async def _check_and_increment_msg_limit(user_id: str, profile: UserProfile) -> None:
    is_premium = profile.subscription_tier == "premium"
    limit = PREMIUM_MSG_LIMIT if is_premium else FREE_MSG_LIMIT

    db = get_supabase()
    now = datetime.now(timezone.utc)
    window_start = None
    if profile.msg_window_start:
        try:
            window_start = datetime.fromisoformat(profile.msg_window_start.replace("Z", "+00:00"))
        except Exception:
            pass

    if window_start is None or (now - window_start) >= timedelta(hours=MSG_WINDOW_HOURS):
        await run_query(
            db.table("user_profiles").update({
                "msg_count": 1,
                "msg_window_start": now.isoformat(),
            }).eq("user_id", user_id)
        )
        return

    if profile.msg_count >= limit:
        reset_at = window_start + timedelta(hours=MSG_WINDOW_HOURS)
        mins = max(1, int((reset_at - now).total_seconds() / 60))
        if is_premium:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "msg_limit",
                    "message": "Has alcanzado tu límite diario con el mentor. Tu acceso se renueva mañana.",
                    "reset_in_minutes": mins,
                },
            )
        else:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "msg_limit",
                    "message": f"Alcanzaste el límite de {FREE_MSG_LIMIT} mensajes. Vuelve en {mins} min o activa Premium.",
                    "reset_in_minutes": mins,
                },
            )

    await run_query(
        db.table("user_profiles").update({"msg_count": profile.msg_count + 1}).eq("user_id", user_id)
    )

router = APIRouter(prefix="/chat", tags=["chat"])


async def _get_user_profile(user_id: str) -> UserProfile | None:
    try:
        db = get_supabase()
        result = await run_query(db.table("user_profiles").select("*").eq("user_id", user_id))
        if result.data:
            return UserProfile(**result.data[0])
    except Exception:
        pass
    return None


def _extract_bscore(reply: str) -> tuple[str, dict | None]:
    """Strip the hidden BSCORE tag from Claude's reply and parse it."""
    match = re.search(r'<!--\s*BSCORE:\s*(\{.*?\})\s*-->', reply, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1))
            clean = reply[:match.start()].rstrip()
            return clean, data
        except Exception:
            pass
    return reply, None


def _extract_action(reply: str) -> tuple[str, list | None]:
    """Strip the hidden ACTION tag and parse suggested actions."""
    match = re.search(r'<!--\s*ACTION:\s*(\{.*?\})\s*-->', reply, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1))
            actions = data.get("actions", [])
            clean = reply[:match.start()].rstrip()
            return clean, actions if actions else None
        except Exception:
            pass
    return reply, None


async def _get_memory_context(user_id: str) -> str | None:
    """Fetch last 10 messages from chat_history to inject as memory."""
    try:
        db = get_supabase()
        result = await run_query(
            db.table("chat_history")
            .select("role, content, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(10)
        )
        msgs = list(reversed(result.data or []))
        if not msgs:
            return None
        lines = []
        for m in msgs:
            role = "Usuario" if m["role"] == "user" else "Nuvos"
            content = m["content"][:300] + ("..." if len(m["content"]) > 300 else "")
            lines.append(f"{role}: {content}")
        return "\n".join(lines)
    except Exception:
        return None


async def _get_mentor_deep_context(user_id: str) -> str | None:
    """Fetch portfolio, decisions, watchlist and extended profile in parallel for the mentor."""
    try:
        db = get_supabase()
        portfolio_res, decisions_res, watchlist_res, extended_res = await asyncio.gather(
            run_query(db.table("user_portfolio").select("positions").eq("user_id", user_id)),
            run_query(
                db.table("investment_decisions")
                .select("action, ticker, trigger, notes, created_at")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(20)
            ),
            run_query(db.table("watchlist").select("ticker, name").eq("user_id", user_id).order("added_at")),
            run_query(
                db.table("user_profiles")
                .select("behavioral_risk_score, maturity_score, streak_count, last_learn_date, investment_goal, investment_goal_amount, investment_horizon, knowledge_level")
                .eq("user_id", user_id)
            ),
            return_exceptions=True,
        )

        # Parse positions
        positions: list[dict] = []
        if not isinstance(portfolio_res, Exception) and portfolio_res.data:
            raw = portfolio_res.data[0].get("positions", [])
            if isinstance(raw, list):
                positions = raw
            elif isinstance(raw, dict) and "_v" in raw:
                positions = raw.get("positions", [])

        decisions: list[dict] = [] if isinstance(decisions_res, Exception) else (decisions_res.data or [])
        watchlist: list[dict] = [] if isinstance(watchlist_res, Exception) else (watchlist_res.data or [])
        extended: dict = {}
        if not isinstance(extended_res, Exception) and extended_res.data:
            extended = extended_res.data[0]

        return ai_service.build_deep_user_context(extended, positions, decisions, watchlist)
    except Exception:
        return None


def _enrich_message(message: str, timeout: float = 3.0) -> str:
    """Prepend global market context + append per-company context. Both fetched in parallel."""
    f_global  = _ENRICH_POOL.submit(get_global_market_context)
    f_company = _ENRICH_POOL.submit(get_market_context_for_message, message)
    global_ctx  = ""
    company_ctx = ""
    try:
        global_ctx = f_global.result(timeout=timeout)
    except Exception:
        pass
    try:
        company_ctx = f_company.result(timeout=timeout)
    except Exception:
        pass
    parts = [message]
    if global_ctx:
        parts.append("\n\n" + global_ctx)
    if company_ctx:
        parts.append(company_ctx)
    return "\n".join(parts) if len(parts) > 1 else message


@router.post("/stream")
@limiter.limit("20/minute")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    user_id: str = Depends(get_current_user_id)
):
    has_images = bool(body.images or body.image_data)

    # Normalize: merge legacy single-image into the images list
    images = [{"data": img.data, "type": img.type} for img in body.images] if body.images else None
    if not images and body.image_data:
        images = [{"data": body.image_data, "type": body.image_type or "image/jpeg"}]

    # Fetch profile first (needed for premium check + enrichment timeout)
    profile = await _get_user_profile(user_id)
    premium = _is_premium(profile)
    enrich_timeout = 4.0 if premium else 2.5

    async def _safe_enrich():
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_enrich_message, body.message, enrich_timeout),
                timeout=enrich_timeout + 1.0,
            )
        except Exception:
            return body.message

    if has_images:
        memory, deep_ctx = await asyncio.gather(
            _get_memory_context(user_id),
            _get_mentor_deep_context(user_id),
        )
        enriched = body.message
    else:
        memory, deep_ctx, enriched = await asyncio.gather(
            _get_memory_context(user_id),
            _get_mentor_deep_context(user_id),
            _safe_enrich(),
        )

    async def generate():
        async for chunk in ai_service.chat_stream(
            message=enriched,
            conversation_history=body.conversation_history,
            profile=profile,
            mentor=body.mentor,
            images=images,
            memory_context=memory,
            notification_context=body.notification_context,
            deep_context=deep_ctx,
            is_premium=premium,
        ):
            yield chunk

    return StreamingResponse(generate(), media_type="text/plain")


@router.post("/message")
@limiter.limit("30/minute")
async def chat_message(
    request: Request,
    body: ChatRequest,
    user_id: str = Depends(get_current_user_id)
):
    profile = await _get_user_profile(user_id)
    if profile:
        await _check_and_increment_msg_limit(user_id, profile)
    premium = _is_premium(profile)
    enrich_timeout = 4.0 if premium else 2.5
    tickers  = await asyncio.to_thread(detect_tickers, body.message)
    has_images = bool(body.images or body.image_data)
    enriched = await asyncio.to_thread(_enrich_message, body.message, enrich_timeout) if not has_images else body.message
    images = [{"data": img.data, "type": img.type} for img in body.images] if body.images else None
    if not images and body.image_data:
        images = [{"data": body.image_data, "type": body.image_type or "image/jpeg"}]
    memory, deep_ctx = await asyncio.gather(
        _get_memory_context(user_id),
        _get_mentor_deep_context(user_id),
    )
    full = ""
    async for chunk in ai_service.chat_stream(
        message=enriched,
        conversation_history=body.conversation_history,
        profile=profile,
        mentor=body.mentor,
        images=images,
        memory_context=memory,
        notification_context=body.notification_context,
        deep_context=deep_ctx,
        is_premium=premium,
    ):
        full += chunk
    clean_reply, bscore = _extract_bscore(full)
    clean_reply, actions = _extract_action(clean_reply)
    return {"reply": clean_reply, "risk_assessment": bscore, "tickers": tickers, "actions": actions}


@router.post("/save-message")
async def save_message(
    request: dict,
    user_id: str = Depends(get_current_user_id)
):
    try:
        from datetime import datetime
        db = get_supabase()
        record = {
            "user_id": user_id,
            "role": request.get("role"),
            "content": request.get("content"),
            "created_at": datetime.utcnow().isoformat(),
            "session_id": request.get("session_id"),
        }
        await run_query(db.table("chat_history").insert(record))
    except Exception:
        pass
    return {"saved": True}


@router.post("/transcribe")
@limiter.limit("30/minute")
async def transcribe_audio(
    request: Request,
    audio: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """Convert voice recording to text using OpenAI Whisper."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Servicio de voz no configurado")
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key)
        audio_bytes = await audio.read()
        filename = audio.filename or "audio.m4a"
        content_type = audio.content_type or "audio/m4a"
        transcript = await client.audio.transcriptions.create(
            model="whisper-1",
            file=(filename, audio_bytes, content_type),
            language="es",
        )
        return {"text": transcript.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al transcribir: {str(e)}")


@router.post("/speak")
@limiter.limit("30/minute")
async def speak_text(
    request: Request,
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    """Convert text to speech. Uses ElevenLabs if configured, else OpenAI TTS."""
    text = (body.get("text") or "").strip()[:2000]
    if not text:
        raise HTTPException(status_code=400, detail="text requerido")

    eleven_key = os.getenv("ELEVENLABS_API_KEY")
    if eleven_key:
        voice_id = os.getenv("ELEVENLABS_VOICE_ID", "SOYHLrjzK2X1ezoPC6cr")
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        payload = {
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.45, "similarity_boost": 0.80, "style": 0.20, "use_speaker_boost": True},
        }
        headers = {"xi-api-key": eleven_key, "Content-Type": "application/json", "Accept": "audio/mpeg"}
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                audio_b64 = base64.b64encode(resp.content).decode()
                return {"audio": audio_b64}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error ElevenLabs: {str(e)}")

    # Fallback: OpenAI TTS
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Servicio de voz no configurado")
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key)
        response = await client.audio.speech.create(
            model="tts-1",
            voice="nova",
            input=text,
        )
        audio_b64 = base64.b64encode(response.content).decode()
        return {"audio": audio_b64}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al generar voz: {str(e)}")


@router.get("/history")
async def get_history(
    limit: int = 500,
    since: str | None = None,
    user_id: str = Depends(get_current_user_id)
):
    try:
        db = get_supabase()
        q = (
            db.table("chat_history")
            .select("id, role, content, created_at, session_id")
            .eq("user_id", user_id)
        )
        if since:
            q = q.gt("created_at", since).order("created_at", desc=False)
        else:
            q = q.order("created_at", desc=True).limit(limit)
        result = await run_query(q)
        msgs = result.data if since else list(reversed(result.data))
        return {"messages": msgs}
    except Exception:
        return {"messages": []}
