import re
import json
import asyncio
import base64
import anthropic
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.models.user import UserProfile, UserProfileCreate, UserProfileUpdate, AvatarUpload
from app.services import ai_service
from app.core.cache import cache_get, cache_set, cache_delete
from app.core.config import settings
from datetime import datetime, timezone

router = APIRouter(prefix="/profile", tags=["profile"])


async def _get_profile_or_404(user_id: str) -> dict:
    db = get_supabase()
    result = await run_query(db.table("user_profiles").select("*").eq("user_id", user_id))
    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    return result.data[0]


_DB_PROFILE_FIELDS = {
    "name", "birth_date", "monthly_income", "monthly_contribution",
    "risk_tolerance", "quiz_answers", "mentor",
    "investment_goal", "investment_goal_amount", "investment_horizon", "knowledge_level",
}

@router.post("", response_model=UserProfile)
async def create_profile(
    data: UserProfileCreate,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    db_data = {k: v for k, v in data.model_dump().items() if k in _DB_PROFILE_FIELDS and v is not None}

    existing = await run_query(db.table("user_profiles").select("id").eq("user_id", user_id))
    now = datetime.now(timezone.utc).isoformat()
    if existing.data:
        result = await run_query(
            db.table("user_profiles").update({**db_data, "updated_at": now}).eq("user_id", user_id)
        )
    else:
        record = {"user_id": user_id, **db_data, "created_at": now, "updated_at": now}
        result = await run_query(db.table("user_profiles").insert(record))
    cache_delete(f"profile:{user_id}")
    return UserProfile(**result.data[0])


@router.get("", response_model=UserProfile)
async def get_profile(user_id: str = Depends(get_current_user_id)):
    cache_key = f"profile:{user_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return UserProfile(**cached)
    data = await _get_profile_or_404(user_id)
    if not data.get("avatar_url"):
        try:
            db = get_supabase()
            path = f"{user_id}.jpg"
            url = await asyncio.to_thread(lambda: db.storage.from_("avatars").get_public_url(path))
            if url:
                data["avatar_url"] = url
        except Exception:
            pass
    cache_set(cache_key, data, ttl=120)
    return UserProfile(**data)


@router.get("/insights")
async def get_ai_insights(user_id: str = Depends(get_current_user_id)):
    """Analyze chat history to detect behavioral patterns and suggest profile updates."""
    try:
        db = get_supabase()
        result = await run_query(
            db.table("chat_history")
            .select("content")
            .eq("user_id", user_id)
            .eq("role", "user")
            .order("created_at", desc=True)
            .limit(40)
        )
        msgs = result.data
        profile_row_res = await run_query(
            db.table("user_profiles").select("risk_tolerance,mentor,subscription_tier").eq("user_id", user_id)
        )
        profile_data = profile_row_res.data[0] if profile_row_res.data else {}
        declared_risk = profile_data.get("risk_tolerance", "moderate")
        is_premium = profile_data.get("subscription_tier") == "premium"

        # Premium: 50 msgs, deeper analysis; Free: 20 msgs, basic analysis
        min_msgs = 5 if is_premium else 8
        msgs = msgs[:50] if is_premium else msgs[:20]
        if len(msgs) < min_msgs:
            return {"ready": False, "reason": "few_messages"}

        combined = "\n".join(f"- {m['content'][:200]}" for m in msgs)

        if is_premium:
            prompt = f"""Analiza en profundidad los mensajes de un inversor y genera un perfil psicológico-financiero completo.
Perfil declarado: {declared_risk}

MENSAJES:
{combined}

Responde SOLO con este JSON:
{{
  "topics": ["max 6 temas más frecuentes"],
  "risk_behavior": "conservative|moderate|aggressive",
  "risk_match": true/false,
  "risk_note": "si no coincide con {declared_risk}, explica qué comportamiento revela",
  "interests": ["max 5 sectores o activos que más menciona"],
  "suggestion": "recomendación personalizada y específica de qué debería estudiar o hacer",
  "maturity_signal": "beginner|intermediate|advanced",
  "behavioral_biases": ["max 3 sesgos detectados (ej: FOMO, aversión pérdida, sobreconfianza)"],
  "evolution_note": "1 oración sobre cómo ha evolucionado su pensamiento inversor",
  "next_level_tip": "consejo concreto para llevar su pensamiento al siguiente nivel"
}}"""
        else:
            prompt = f"""Analiza los mensajes de un usuario de una app de inversión y detecta patrones básicos.
Perfil declarado: {declared_risk}

MENSAJES:
{combined}

Responde SOLO con este JSON:
{{
  "topics": ["max 4 temas más frecuentes que pregunta"],
  "risk_behavior": "conservative|moderate|aggressive",
  "risk_match": true/false,
  "risk_note": "si no coincide con {declared_risk}, explica en 1 oración qué comportamiento revela",
  "interests": ["max 3 sectores o activos que más menciona"],
  "suggestion": "recomendación personalizada de 1 oración sobre qué debería explorar o aprender",
  "maturity_signal": "beginner|intermediate|advanced"
}}"""

        response = ""
        async for chunk in ai_service.chat_stream(
            message=prompt, conversation_history=[], profile=None, mentor=None,
        ):
            response += chunk

        match = re.search(r'\{.*\}', response, re.DOTALL)
        if match:
            data = json.loads(match.group())
            return {"ready": True, "declared_risk": declared_risk, **data}
    except Exception:
        pass
    return {"ready": False, "reason": "error"}


@router.put("", response_model=UserProfile)
async def update_profile(
    data: UserProfileUpdate,
    user_id: str = Depends(get_current_user_id),
):
    await _get_profile_or_404(user_id)
    db = get_supabase()
    updates = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await run_query(
        db.table("user_profiles").update(updates).eq("user_id", user_id)
    )
    cache_delete(f"profile:{user_id}")
    return UserProfile(**result.data[0])


# ─── Avatar ───────────────────────────────────────────────────────────────────

@router.post("/avatar")
async def upload_avatar(
    data: AvatarUpload,
    user_id: str = Depends(get_current_user_id),
):
    try:
        image_bytes = base64.b64decode(data.image_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    db = get_supabase()
    path = f"{user_id}.jpg"

    try:
        await asyncio.to_thread(
            lambda: db.storage.from_("avatars").upload(
                path=path,
                file=image_bytes,
                file_options={"content-type": "image/jpeg", "upsert": "true"},
            )
        )
    except Exception:
        # Try update if file already exists (some supabase-py versions raise on upsert)
        try:
            await asyncio.to_thread(
                lambda: db.storage.from_("avatars").update(
                    path=path,
                    file=image_bytes,
                    file_options={"content-type": "image/jpeg"},
                )
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail="Failed to upload avatar")

    avatar_url = await asyncio.to_thread(lambda: db.storage.from_("avatars").get_public_url(path))

    await run_query(
        db.table("user_profiles").update({
            "avatar_url": avatar_url,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("user_id", user_id)
    )

    return {"avatar_url": avatar_url}


@router.delete("/avatar")
async def delete_avatar(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()
    path = f"{user_id}.jpg"
    try:
        await asyncio.to_thread(lambda: db.storage.from_("avatars").remove([path]))
    except Exception:
        pass  # File may not exist, continue to clear DB field

    await run_query(
        db.table("user_profiles").update({
            "avatar_url": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("user_id", user_id)
    )

    return {"ok": True}


# ─── Mentor Letter ────────────────────────────────────────────────────────────

MENTOR_VOICES = {
    "Warren Buffett": {
        "title": "El Oráculo de Omaha",
        "style": "Cálido, directo, usa analogías simples del mundo real, menciona el largo plazo y el margen de seguridad. Firma como 'Warren'.",
    },
    "Ray Dalio": {
        "title": "Fundador de Bridgewater",
        "style": "Analítico, habla de 'principios', ciclos económicos, diversificación y mecanismos de mercado. Firma como 'Ray'.",
    },
    "Bill Ackman": {
        "title": "CEO de Pershing Square",
        "style": "Directo, confiado, activista, habla de convicción en las posiciones y de entender profundamente cada empresa. Firma como 'Bill'.",
    },
}

@router.get("/mentor-letter")
async def get_mentor_letter(user_id: str = Depends(get_current_user_id)):
    """
    Generates a personalized monthly letter from the user's mentor.
    Cached per user per calendar month — only calls Claude once/month per user.
    """
    profile = await _get_profile_or_404(user_id)
    mentor_name = profile.get("mentor")
    if not mentor_name or mentor_name not in MENTOR_VOICES:
        raise HTTPException(status_code=400, detail="No tienes un mentor configurado.")

    month_key = datetime.now(timezone.utc).strftime("%Y-%m")
    cache_key = f"mentor_letter:{user_id}:{month_key}"

    cached = cache_get(cache_key)
    if cached:
        return cached

    mentor = MENTOR_VOICES[mentor_name]
    name = profile.get("name", "Inversor").split()[0]
    risk = profile.get("risk_tolerance", "moderate")
    maturity = profile.get("maturity_score", 0)
    history = profile.get("maturity_history", [])

    # Build behavioral summary from history
    recent_signals = []
    for ev in (history or [])[-10:]:
        for sig in (ev.get("signals") or []):
            recent_signals.append(sig.replace("_", " "))

    signals_text = ", ".join(recent_signals[-6:]) if recent_signals else "aún sin señales registradas"
    maturity_label = (
        "Aprendiz" if maturity < 30 else
        "Principiante" if maturity < 50 else
        "En Desarrollo" if maturity < 65 else
        "Maduro" if maturity < 80 else "Experto"
    )
    month_name = datetime.now(timezone.utc).strftime("%B %Y").capitalize()

    prompt = f"""Eres {mentor_name}, {mentor['title']}.
Escribe una carta personal de 180-220 palabras en español a {name}, tu estudiante de inversiones.

Datos del estudiante este mes ({month_name}):
- Perfil de riesgo: {risk}
- Nivel de madurez inversora: {maturity}/100 ({maturity_label})
- Señales de comportamiento recientes: {signals_text}

Estilo: {mentor['style']}

La carta debe:
1. Comenzar con "Estimado {name},"
2. Comentar 1-2 comportamientos específicos observados (usa las señales reales)
3. Dar 1 consejo concreto y accionable para el próximo mes
4. Terminar con una frase motivadora y la firma

Escribe SOLO la carta, sin título ni encabezado adicional."""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model=settings.claude_model,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        letter = response.content[0].text.strip()
        result = {
            "letter": letter,
            "mentor": mentor_name,
            "month": month_name,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        cache_set(cache_key, result, ttl=28 * 24 * 3600)  # 28 days
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No se pudo generar la carta: {str(e)}")
