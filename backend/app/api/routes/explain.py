"""'Explícame esto' — the AI mentor narrates, in voice, what's currently on
the user's screen using ONLY the real data that screen already computed.
Not an ambient always-on avatar (expensive, invasive) — a single on-demand
button per screen. Reuses the same TTS pipeline as Mentor IA voice calls
(voice_service.synthesize_speech_b64) so it's the same voice/personality
accompanying the user everywhere, not a new one.
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import get_current_user_id
from app.core.limiter import limiter
from app.core.config import settings

router = APIRouter(prefix="/explain", tags=["explain"])
logger = logging.getLogger(__name__)


@router.post("")
@limiter.limit("20/minute")
async def explain_screen(
    request: Request,
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    from app.api.routes.chat import _get_user_profile, _is_premium
    from app.services.voice_service import synthesize_speech_b64

    profile = await _get_user_profile(user_id)
    if not _is_premium(profile):
        raise HTTPException(status_code=403, detail="Esta función requiere Premium")

    screen = (body.get("screen") or "").strip()
    context = body.get("context") or {}
    lang = body.get("lang") if body.get("lang") in ("es", "en") else (getattr(profile, "preferred_language", None) or "es")
    if not screen or not isinstance(context, dict):
        raise HTTPException(status_code=422, detail="screen y context son requeridos")

    # Generate the narration text — cheap Haiku call, strictly grounded in
    # only the numbers the calling screen actually sent. Never let the model
    # invent a figure that isn't in `context` (same discipline as every
    # other AI-generated text in this app).
    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        lang_instruction = "Responde en inglés." if lang == "en" else "Responde en español."
        prompt = (
            "Eres el mentor de inversión personal del usuario dentro de la app Nuvos AI, "
            f"narrando en voz alta lo que está viendo ahora mismo en la pantalla \"{screen}\".\n\n"
            f"Estos son los datos REALES que tiene esa pantalla ahora mismo:\n{json.dumps(context, ensure_ascii=False)}\n\n"
            "Usa ÚNICAMENTE estos datos — nunca inventes una cifra, ticker o hecho que no esté "
            "arriba. Si algún dato relevante no está presente, simplemente no lo menciones.\n"
            "Escribe 2-4 oraciones cortas, conversacionales, como si se lo estuvieras explicando "
            "en voz alta a la persona en este momento — nunca genérico, siempre anclado a estos "
            "números específicos. Si mencionas un término técnico financiero (WACC, DCF, flujo de "
            "caja libre, margen de seguridad, valor intrínseco, etc.), explícalo de inmediato en "
            "lenguaje MUY simple y cotidiano, como si hablaras con alguien que nunca ha invertido — "
            f"nunca uses jerga sin explicarla. {lang_instruction}\n"
            "Responde solo con el texto a narrar, sin comillas ni texto adicional."
        )
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=250,
            messages=[{"role": "user", "content": prompt}],
        )
        from app.services.llm_usage import log_llm_usage
        import asyncio
        asyncio.create_task(log_llm_usage(user_id, "explain_screen", "claude-haiku-4-5-20251001", resp.usage))
        text = resp.content[0].text.strip() if resp.content else ""
    except Exception as e:
        logger.error("explain_screen(%s): text generation failed: %s", screen, e)
        raise HTTPException(status_code=503, detail="No pudimos generar la explicación en este momento. Intenta de nuevo.")

    if not text:
        raise HTTPException(status_code=503, detail="No pudimos generar la explicación en este momento. Intenta de nuevo.")

    # Voice is a nice-to-have layer on top of the real text above — a TTS
    # hiccup must degrade to text-only, never take down the whole request.
    audio = None
    try:
        audio = await synthesize_speech_b64(text)
    except Exception as e:
        logger.warning("explain_screen(%s): TTS failed, degrading to text-only: %s", screen, e)

    return {"text": text, "audio": audio or None}
