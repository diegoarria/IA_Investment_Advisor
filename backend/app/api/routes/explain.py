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

# Extra instructions layered onto the base prompt for specific screens —
# things that must always be covered on that screen, not just "if mentioned".
_SCREEN_INSTRUCTIONS = {
    "home": (
        "Esta pantalla es el resumen general del portafolio. Cubre, en este orden: "
        "(1) cómo va el portafolio en total hoy, (2) cada índice de mercado presente en "
        "`market_indices` — para CADA UNO di su nombre, explica en una frase muy simple qué "
        "es ese índice (a qué empresas sigue), y menciona cuánto subió o bajó, (3) si hay "
        "`top_gainers`/`top_losers`, menciona cuáles acciones del usuario más subieron y "
        "cuáles más cayeron hoy y su porcentaje."
    ),
    "portfolio": (
        "Si `ytd_gain_pct` y `sp500_ytd_pct` están presentes, compara el rendimiento YTD del "
        "usuario contra el S&P 500 explícitamente — dile si lo está superando o no y por cuánto "
        "(la diferencia en puntos porcentuales). Dale feedback personalizado y honesto en tono "
        "de mentor: si le está ganando al mercado, felicítalo sin exagerar; si va por detrás, "
        "explícaselo sin alarmismo y anímalo a revisar su estrategia, nunca de forma genérica. "
        "`distinct_holdings` ya cuenta cada empresa UNA sola vez (comprar la misma acción en dos "
        "fechas distintas sigue siendo una sola posición) — nunca digas que tiene más posiciones "
        "que ese número. Si `risk_score` y `sector_allocation` están presentes, menciona el nivel "
        "de riesgo (`risk_level`) y en qué sector(es) está más concentrado el portafolio. Si "
        "`cash_total` está presente, menciona que además de las acciones tiene ese efectivo "
        "disponible, y que `total_value_with_cash` es su valor total real (acciones + efectivo)."
    ),
    "oportunidades_intro": (
        "Explica siempre, en una frase MUY simple cada uno (sin que el usuario tenga que "
        "preguntar): qué es el margen de seguridad, qué es el WACC, y qué es un DCF "
        "(flujo de caja descontado). Cierra invitando al usuario a intentar calcular él mismo "
        "el valor intrínseco de una acción moviendo los controles de esta pantalla — dile que "
        "con los pocos datos que ya ve (precio, crecimiento sugerido, WACC sugerido) puede "
        "jugar con los números y ver cómo cambia el resultado."
    ),
    "oportunidades_resultado": (
        "Explica siempre, en una frase MUY simple cada uno (sin que el usuario tenga que "
        "preguntar): qué es el margen de seguridad, qué es el WACC, y qué es un DCF "
        "(flujo de caja descontado) — usando los números reales de este resultado como "
        "ejemplo. Cierra invitando al usuario a mover los controles (crecimiento, WACC) él "
        "mismo para ver cómo cambia el valor intrínseco calculado."
    ),
    "oportunidades_slider_feedback": (
        "El usuario ACABA de mover uno de los controles del modelo (crecimiento, WACC o "
        "crecimiento terminal) a un nuevo valor — `context` trae el valor que eligió y el "
        "rango/sugerencia razonable para esta empresa. Como mentor, dile en 2-3 oraciones "
        "si ese número tiene sentido para esta empresa o si es demasiado optimista/pesimista, "
        "y por qué, en lenguaje simple — no repitas toda la pantalla, solo comenta este ajuste "
        "puntual, como si estuvieras mirando por encima del hombro mientras el usuario prueba "
        "distintos escenarios."
    ),
}


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
    text_only = bool(body.get("text_only"))
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
        screen_instruction = _SCREEN_INSTRUCTIONS.get(screen, "")
        prompt = (
            "Eres el mentor de inversión personal del usuario dentro de la app Nuvos AI, "
            f"narrando en voz alta lo que está viendo ahora mismo en la pantalla \"{screen}\".\n\n"
            f"Estos son los datos REALES que tiene esa pantalla ahora mismo:\n{json.dumps(context, ensure_ascii=False)}\n\n"
            "Usa ÚNICAMENTE estos datos — nunca inventes una cifra, ticker o hecho que no esté "
            "arriba. Si algún dato relevante no está presente, simplemente no lo menciones.\n"
            "Sé conciso y conversacional, como si se lo estuvieras explicando en voz alta a la "
            "persona en este momento — nunca genérico, siempre anclado a estos números "
            "específicos. Si mencionas un término técnico financiero (WACC, DCF, flujo de caja "
            "libre, margen de seguridad, valor intrínseco, etc.), explícalo de inmediato en "
            "lenguaje MUY simple y cotidiano, como si hablaras con alguien que nunca ha invertido — "
            "nunca uses jerga sin explicarla. Usa tantas oraciones cortas como necesites para "
            "cubrir todo lo que se te pide abajo, sin relleno — pero es MÁS IMPORTANTE terminar "
            "con una oración completa que ser breve: NUNCA cortes una idea a la mitad ni dejes la "
            f"última oración incompleta.{(' ' + screen_instruction) if screen_instruction else ''} "
            f"{lang_instruction}\n"
            "Responde solo con el texto a narrar, sin comillas ni texto adicional."
        )
        # Generous cap — this narration must never get cut off mid-sentence by
        # hitting the token limit (screens like home/oportunidades ask it to
        # cover several items, which can run long). Cheap model, short calls,
        # so headroom costs nothing.
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=700,
            messages=[{"role": "user", "content": prompt}],
        )
        from app.services.llm_usage import log_llm_usage
        import asyncio
        asyncio.create_task(log_llm_usage(user_id, "explain_screen", "claude-haiku-4-5-20251001", resp.usage))
        text = resp.content[0].text.strip() if resp.content else ""
        if resp.stop_reason == "max_tokens":
            logger.warning("explain_screen(%s): hit max_tokens even at 700 — narration may be cut off", screen)
    except Exception as e:
        logger.error("explain_screen(%s): text generation failed: %s", screen, e)
        raise HTTPException(status_code=503, detail="No pudimos generar la explicación en este momento. Intenta de nuevo.")

    if not text:
        raise HTTPException(status_code=503, detail="No pudimos generar la explicación en este momento. Intenta de nuevo.")

    # text_only skips TTS entirely — used for the slider-feedback tip, which
    # fires automatically (no user tap) every time an assumption changes, so
    # synthesizing audio for it every time would be pure wasted cost/latency.
    if text_only:
        return {"text": text, "audio": None}

    # Voice is a nice-to-have layer on top of the real text above — a TTS
    # hiccup must degrade to text-only, never take down the whole request.
    audio = None
    try:
        audio = await synthesize_speech_b64(text)
    except Exception as e:
        logger.warning("explain_screen(%s): TTS failed, degrading to text-only: %s", screen, e)

    return {"text": text, "audio": audio or None}
