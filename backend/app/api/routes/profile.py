import re
import json
import asyncio
import base64
import anthropic
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user_id, get_current_user
from app.core.database import get_supabase, run_query
from app.models.user import UserProfile, UserProfileCreate, UserProfileUpdate, AvatarUpload
from app.services import ai_service
from app.core.cache import cache_get, cache_set, cache_delete
from app.core.config import settings
from datetime import datetime, timezone

router = APIRouter(prefix="/profile", tags=["profile"])

_AVATAR_MAX_SIDE = 512  # px — avatars are only ever shown small (comment threads, sidebar)


def _resize_avatar(image_bytes: bytes) -> bytes:
    """Downscale + recompress an avatar before it ever reaches Supabase
    Storage. Uploads were previously stored at whatever resolution the
    client sent — often multi-MB straight off a phone camera — and
    Storage re-serves that same file to every viewer of every comment or
    profile this user appears on, with no CDN cache shared across
    different users' browsers. That repeated full-resolution egress was
    the single biggest driver behind blowing past the Supabase Free
    Plan's Cached Egress quota with only a couple dozen users."""
    from PIL import Image
    import io

    img = Image.open(io.BytesIO(image_bytes))
    img = img.convert("RGB")  # normalize PNG-with-alpha/CMYK/etc. to plain JPEG-safe RGB
    if max(img.size) > _AVATAR_MAX_SIDE:
        img.thumbnail((_AVATAR_MAX_SIDE, _AVATAR_MAX_SIDE), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue()


async def _get_profile_or_404(user_id: str) -> dict:
    db = get_supabase()
    result = await run_query(db.table("user_profiles").select("*").eq("user_id", user_id))
    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    return result.data[0]


_TABLES_WITH_USER_ID = [
    "user_profiles", "watchlist", "user_portfolio",
    "investment_decisions", "notification_preferences", "chat_history", "user_sync",
]


async def _migrate_profile_by_email(db, new_user_id: str, email: str) -> dict | None:
    """
    Google OAuth creates a new user_id even when the email already exists.
    Find the original account's profile and migrate all user data to the new id.
    """
    try:
        all_users = await asyncio.to_thread(lambda: db.auth.admin.list_users())
        old_ids = [
            u.id for u in all_users
            if getattr(u, "email", None) == email and u.id != new_user_id
        ]
        if not old_ids:
            return None
        existing = await run_query(
            db.table("user_profiles").select("*").in_("user_id", old_ids)
        )
        if not existing.data:
            return None
        old_id = existing.data[0]["user_id"]
        for table in _TABLES_WITH_USER_ID:
            try:
                await run_query(
                    db.table(table).update({"user_id": new_user_id}).eq("user_id", old_id)
                )
            except Exception:
                pass
        # Re-fetch after migration
        migrated = await run_query(
            db.table("user_profiles").select("*").eq("user_id", new_user_id)
        )
        return migrated.data[0] if migrated.data else None
    except Exception:
        return None


_DB_PROFILE_FIELDS = {
    "name", "birth_date", "monthly_income", "monthly_contribution",
    "risk_tolerance", "quiz_answers", "mentor",
    "investment_goal", "investment_goal_amount", "investment_horizon", "knowledge_level",
    "country", "initial_capital", "has_broker", "broker_name", "has_investments",
    # terms_accepted_at and terms_version require adding those columns in Supabase first
}

@router.post("", response_model=UserProfile)
async def create_profile(
    data: UserProfileCreate,
    user_id: str = Depends(get_current_user_id),
):
    db = get_supabase()
    db_data = {k: v for k, v in data.model_dump().items() if k in _DB_PROFILE_FIELDS and v is not None}
    if data.language:
        # "language" isn't in _DB_PROFILE_FIELDS because the payload's field
        # name doesn't match the DB column (preferred_language) — set it
        # directly instead of adding it to that whitelist.
        db_data["preferred_language"] = data.language

    existing = await run_query(db.table("user_profiles").select("id").eq("user_id", user_id))
    now = datetime.now(timezone.utc).isoformat()
    if existing.data:
        result = await run_query(
            db.table("user_profiles").update({**db_data, "updated_at": now}).eq("user_id", user_id)
        )
    else:
        record = {"user_id": user_id, **db_data, "created_at": now, "updated_at": now}
        result = await run_query(db.table("user_profiles").insert(record))
        # Send welcome email to new users (fire-and-forget)
        try:
            from app.services.email_service import build_welcome_html, send_email
            auth_res = await asyncio.to_thread(lambda: db.auth.admin.get_user_by_id(user_id))
            email_addr = getattr(getattr(auth_res, "user", None), "email", None)
            if email_addr:
                name_val = db_data.get("name", "Inversor")
                html = build_welcome_html(name_val, data.language)
                subject = (
                    "🚀 Welcome to Nuvos AI! With Nuvos, invest without fear."
                    if data.language == "en"
                    else "🚀 ¡Bienvenido a Nuvos AI! Con Nuvos, invierte sin miedo."
                )
                asyncio.create_task(send_email(email_addr, subject, html))
        except Exception:
            pass
        # Create default notification preferences for new users
        existing_prefs = await run_query(
            db.table("notification_preferences").select("user_id").eq("user_id", user_id)
        )
        if not existing_prefs.data:
            await run_query(db.table("notification_preferences").insert({
                "user_id": user_id,
                "push_market_open": True, "push_market_close": True,
                "push_news_general": True, "push_portfolio_alerts": True,
                "push_watchlist_alerts": True, "push_ai_recommendations": True,
                "push_milestones": True, "push_volatility": True,
                "email_daily_summary": True, "email_weekly_summary": True,
                "max_push_per_day": 5, "max_push_per_week": 20,
                "quiet_hours_start": 22, "quiet_hours_end": 8,
                "consecutive_ignores": 0,
            }))
    cache_delete(f"profile:{user_id}")
    return UserProfile(**result.data[0])


@router.get("", response_model=UserProfile)
async def get_profile(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    email = current_user.get("email")
    cache_key = f"profile:{user_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return UserProfile(**cached)

    db = get_supabase()
    result = await run_query(db.table("user_profiles").select("*").eq("user_id", user_id))
    if result.data:
        data = result.data[0]
    elif email:
        # Google OAuth created a new user_id — try to find and migrate existing profile
        data = await _migrate_profile_by_email(db, user_id, email)
        if data is None:
            raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")
    else:
        raise HTTPException(status_code=404, detail="Profile not found. Complete onboarding first.")

    if not data.get("avatar_url"):
        try:
            path = f"{user_id}.jpg"
            url = await asyncio.to_thread(lambda: db.storage.from_("avatars").get_public_url(path))
            if url:
                data["avatar_url"] = url
        except Exception:
            pass
    cache_set(cache_key, data, ttl=120)
    return UserProfile(**data)


@router.get("/insights")
async def get_ai_insights(lang: str | None = None, user_id: str = Depends(get_current_user_id)):
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
            db.table("user_profiles").select("risk_tolerance,mentor,subscription_tier,preferred_language,trial_started_at").eq("user_id", user_id)
        )
        profile_data = profile_row_res.data[0] if profile_row_res.data else {}
        declared_risk = profile_data.get("risk_tolerance", "moderate")
        from app.core.subscription import is_premium_active
        is_premium = is_premium_active(profile_data.get("subscription_tier"), profile_data.get("trial_started_at"))
        if lang not in ("es", "en"):
            lang = profile_data.get("preferred_language") or "es"

        # Premium: 50 msgs, deeper analysis; Free: 20 msgs, basic analysis
        min_msgs = 5 if is_premium else 8
        msgs = msgs[:50] if is_premium else msgs[:20]
        if len(msgs) < min_msgs:
            return {"ready": False, "reason": "few_messages"}

        combined = "\n".join(f"- {m['content'][:200]}" for m in msgs)
        lang_directive = (
            "IMPORTANT: Write every text value in this JSON entirely in English, regardless of the language of the instructions below.\n\n"
            if lang == "en" else ""
        )

        if is_premium:
            if lang == "en":
                prompt = f"""{lang_directive}Deeply analyze an investor's messages and produce a complete psychological-financial profile.
Declared profile: {declared_risk}

MESSAGES:
{combined}

Reply ONLY with this JSON:
{{
  "topics": ["up to 6 most frequent topics"],
  "risk_behavior": "conservative|moderate|aggressive",
  "risk_match": true/false,
  "risk_note": "if it doesn't match {declared_risk}, explain what behavior this reveals",
  "interests": ["up to 5 sectors or assets mentioned most"],
  "suggestion": "personalized, specific recommendation of what they should study or do",
  "maturity_signal": "beginner|intermediate|advanced",
  "behavioral_biases": ["up to 3 detected biases (e.g. FOMO, loss aversion, overconfidence)"],
  "evolution_note": "1 sentence on how their investor thinking has evolved",
  "next_level_tip": "concrete advice to take their thinking to the next level"
}}"""
            else:
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
            if lang == "en":
                prompt = f"""{lang_directive}Analyze an investing app user's messages and detect basic patterns.
Declared profile: {declared_risk}

MESSAGES:
{combined}

Reply ONLY with this JSON:
{{
  "topics": ["up to 4 most frequent topics they ask about"],
  "risk_behavior": "conservative|moderate|aggressive",
  "risk_match": true/false,
  "risk_note": "if it doesn't match {declared_risk}, explain in 1 sentence what behavior this reveals",
  "interests": ["up to 3 sectors or assets mentioned most"],
  "suggestion": "1-sentence personalized recommendation of what they should explore or learn",
  "maturity_signal": "beginner|intermediate|advanced"
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

        response = await ai_service.generate_simple_completion(prompt, max_tokens=500)

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

    try:
        image_bytes = await asyncio.to_thread(_resize_avatar, image_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="No se pudo procesar la imagen")

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
