"""
Shared helpers for price-move alert notifications.
Used by both the background worker and the admin trigger endpoint.
"""
import asyncio
import logging
from datetime import datetime, timezone

from app.core.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

# Sentinel returned when no specific catalyst is found — callers should skip the notification.
NO_CATALYST = "__NO_CATALYST__"


async def should_send_price_alert(user_id: str, ticker: str, db) -> bool:
    """
    Hard cap of ONE price-mover push per ticker per user per day.

    Checked against notification_log (persistent DB table), NOT the Redis/
    in-memory cache — this used to be cache-only, which meant every worker
    restart or redeploy silently reset the "already notified today" state,
    letting the same ticker re-notify the same day. notification_log already
    gets a row written on every real send (see notification_engine.send_push
    / _log_notification), so this survives any number of restarts for free.
    """
    from app.core.database import run_query
    import zoneinfo

    today_et_start = (
        datetime.now(zoneinfo.ZoneInfo("America/New_York"))
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .astimezone(timezone.utc)
        .isoformat()
    )
    category = f"price_mover_{ticker}"
    try:
        res = await run_query(
            db.table("notification_log")
            .select("id")
            .eq("user_id", user_id)
            .eq("category", category)
            .gte("sent_at", today_et_start)
            .limit(1)
        )
        return not res.data
    except Exception as e:
        # If the check itself fails, err toward NOT sending — a missed alert
        # is far less bad than spamming the same mover repeatedly that day.
        logger.warning("should_send_price_alert(%s, %s) DB check failed: %s — skipping to be safe", user_id, ticker, e)
        return False


def fetch_ticker_news(ticker: str) -> list[dict]:
    """
    Return up to 5 recent news items for a ticker via Finnhub — a secondary/
    background source now. Perplexity (search_price_catalyst) is the primary
    source for the WHY pipeline (see get_price_move_why); this just adds
    supplementary headlines/summaries when Finnhub happens to have them.
    Each item: {headline, summary}

    yfinance was removed as a fallback here — Yahoo's news endpoint has been
    unreliable (frequently raising "Failed to retrieve the news" errors) and
    added latency/failure surface for a source that's now secondary anyway.
    """
    items: list[dict] = []
    try:
        from app.core.finnhub import fh_news
        fh_items = fh_news(ticker, days=3) or []
        for n in fh_items[:5]:
            h = (n.get("headline") or "").strip()
            s = (n.get("summary") or "").strip()
            if h and len(h) > 10:
                items.append({"headline": h, "summary": s[:300] if s else ""})
    except Exception as e:
        logger.warning("Finnhub news fetch failed for %s (non-fatal, Perplexity is primary): %s", ticker, e)

    return items[:5]


async def search_price_catalyst(ticker: str, change_pct: float) -> str:
    """
    Real-time web search (Perplexity) for why a ticker moved today — the
    PRIMARY source for the WHY pipeline (see get_price_move_why). Finnhub is
    only a secondary/background source now, since it frequently doesn't have
    same-day breaking news indexed yet. Returns "" if no API key configured
    or the search comes back empty; callers should treat that as "still no
    catalyst" (Finnhub's headlines, if any, are tried as a last resort).
    """
    from app.services.perplexity_service import search_web

    direction = "cayó" if change_pct < 0 else "subió"
    query = (
        f"¿Por qué {direction} la acción {ticker} hoy ({change_pct:+.1f}%)? "
        f"Busca la noticia, anuncio o evento específico de hoy o de los últimos días que "
        f"explique el movimiento — considera declaraciones de directivos (CEO/CFO/junta), "
        f"decisiones o negociaciones de gobiernos/reguladores, noticias del sector o de "
        f"competidores, acciones de analistas o bancos de inversión (upgrades/downgrades/"
        f"precio objetivo), movimientos de fondos institucionales, earnings, demandas, o "
        f"cualquier otro factor externo relevante. Da fecha y fuente si es posible."
    )
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(search_web, query, False),
            timeout=35.0,
        )
        if not result:
            # search_web() itself already logs the specific reason (missing key,
            # non-200 response, exception) — this just makes it visible at the
            # call site too, since an empty string here is what silently turns
            # into "no news" in the push notification the user actually sees.
            logger.warning("Perplexity returned no catalyst text for %s (%+.1f%%) — query: %s", ticker, change_pct, query)
        return result
    except asyncio.TimeoutError:
        logger.warning("Perplexity price catalyst search TIMED OUT for %s (>35s) — falling back to NO_CATALYST", ticker)
        return ""
    except Exception as e:
        logger.warning("Perplexity price catalyst search failed for %s: %s", ticker, e)
        return ""


async def get_price_move_why(
    ticker: str,
    change_pct: float,
    price: float,
    news_items: list[dict],
) -> str:
    """
    Orchestrates the full WHY pipeline for a price move. Perplexity (live web
    search) is now the PRIMARY source — it runs on every call, since it's the
    only source that reliably surfaces same-day breaking news, government/
    regulatory decisions, analyst actions, etc. Finnhub's headlines (if any
    were passed in via news_items) are included as background/supplementary
    context in the same call rather than as a separate fallback pass — this
    also means only ONE Claude call per ticker now instead of up to two.

    Falls back to Finnhub-only context if Perplexity itself returns nothing
    (missing API key, timeout, or a genuinely empty search) — better to try
    with whatever's available than to give up immediately.
    """
    web_context = await search_price_catalyst(ticker, change_pct)
    if not web_context and not news_items:
        return NO_CATALYST
    return await generate_price_alert_why(ticker, change_pct, price, news_items, extra_context=web_context)


async def generate_price_alert_why(
    ticker: str,
    change_pct: float,
    price: float,
    news_items: list[dict],
    extra_context: str = "",
) -> str:
    """
    Generate a WHY explanation for a price move via Claude.

    Returns just the reason clause (e.g. "La razón principal es que...") when a real
    catalyst is found — NOT the full notification body, callers prepend the "{company}
    hoy está subiendo/cayendo un {pct}%." sentence themselves — or NO_CATALYST when the
    news is too generic.

    Called once per ticker and reused across all users.
    """
    import anthropic
    from app.core.config import settings

    # Support both old list[str] callers and new list[dict] callers
    if news_items and isinstance(news_items[0], str):
        news_items = [{"headline": h, "summary": ""} for h in news_items]  # type: ignore[assignment]

    if news_items:
        news_str = "\n".join(
            f"- {n['headline']}" + (f"\n  Detalle: {n['summary']}" if n.get("summary") else "")
            for n in news_items
        )
    else:
        news_str = ""

    web_section = (
        f"BÚSQUEDA WEB EN TIEMPO REAL (fuente principal):\n{extra_context}"
        if extra_context
        else "BÚSQUEDA WEB EN TIEMPO REAL (fuente principal):\n(sin resultados)"
    )
    news_section = f"\n\nNOTICIAS DE FINNHUB (fuente secundaria, últimas 72h):\n{news_str or '(sin noticias disponibles)'}"

    prompt = f"""Eres el sistema de notificaciones push de Nuvos AI.

DATOS DEL MOVIMIENTO:
- Ticker: {ticker}
- Movimiento: {change_pct:+.2f}% hoy, precio actual ${price:.2f}

{web_section}{news_section}

TU TAREA:
La notificación push YA incluye "{{emoji}} {{Empresa}} {{+/-X.X}}% " al inicio (ej.
"📈 NVIDIA +4.58% "). Tu trabajo es escribir SOLO la continuación que sigue a ese
porcentaje, como una frase que fluye naturalmente después — no repitas el nombre de la
empresa ni el porcentaje, eso ya está cubierto. La notificación completa (emoji+empresa+
%+tu texto) debe caber en ~90-120 caracteres, así que tu parte tiene que ser muy breve:
máximo ~70 caracteres.

REGLAS:
1. Escribe una razón si las noticias mencionan CUALQUIERA de estas fuentes/tipos de catalizador
   real — la lista es intencionalmente amplia, no hace falta un nombre propio ni que el hecho
   sea exclusivo de hoy, con que esté claramente conectado a esta empresa alcanza:
   - DIRECTIVA de la empresa: CEO, CFO, junta directiva, cambios de liderazgo, declaraciones
     de ejecutivos, renuncias/contrataciones
   - GOBIERNOS y reguladores: decisiones, negociaciones, aranceles, permisos de exportación/
     importación, aprobaciones regulatorias, demandas, sanciones, políticas de cualquier país
     que afecten a esta empresa o su industria
   - SECTOR/INDUSTRIA: noticias de competidores, proveedores, clientes clave, tendencias de
     toda la industria que expliquen razonablemente el movimiento de ESTA empresa
   - ANALISTAS: upgrades, downgrades, cambios de precio objetivo, iniciaciones de cobertura,
     notas de research de cualquier casa de análisis
   - BANCOS y instituciones financieras: cambios de rating, comentarios de bancos de inversión,
     fondos importantes tomando o vendiendo posiciones, movimientos de instituciones grandes
   - Anuncios, productos, acuerdos, negociaciones, fusiones/adquisiciones, earnings, revenue,
     guidance, litigios, huelgas, problemas de cadena de suministro
   - Cualquier otro factor externo real (macroeconómico, geopolítico, climático, tecnológico,
     de mercado) que esté conectado de forma creíble al movimiento de esta empresa específica

2. Usa NO_CATALYST únicamente cuando las noticias disponibles NO mencionan absolutamente ningún
   hecho, evento, declaración o decisión relacionada con la empresa, su sector, o alguno de los
   factores de la lista de arriba — es decir, cuando genuinamente no hay nada, más allá de
   frases vagas tipo "sentimiento del mercado" o "expectativas" sin ningún hecho detrás. Ante
   la duda, prefiere usar la noticia disponible en vez de responder NO_CATALYST — es mejor dar
   un contexto real aunque sea parcial o indirecto que decir que no hay noticias cuando sí las
   hay.

   IMPORTANTE — no confundas una DESCRIPCIÓN del movimiento con una EXPLICACIÓN de por qué
   ocurrió: "aumento de volumen de operaciones", "alta volatilidad", "mayor actividad de
   trading" NO son catalizadores — son solo otra forma de describir el mismo movimiento de
   precio que ya se está explicando, no dicen POR QUÉ pasó. Si eso es lo único que hay en las
   noticias (sin ningún hecho concreto de la lista de arriba detrás), responde NO_CATALYST.

3. Si hay catalizador (aunque sea parcial):
   - Empieza con un conector corto y minúscula: "tras...", "por...", "gracias a...",
     "luego de...", "después de..." — fluye directo después del "%", no es una oración
     nueva con mayúscula ni sujeto propio
   - Menciona el catalizador específico, lo más comprimido posible — sustantivos, no
     oraciones completas si se puede evitar
   - Tono: directo y claro, sin jerga financiera, sin relleno
   - LÍMITE DURO: ~70 caracteres. Prioriza cortar adjetivos/detalles secundarios antes que
     quedarte sin decir el catalizador central
   - Sin emojis, sin mencionar "Nuvos AI", sin repetir el ticker/porcentaje, sin punto final
   - Solo el texto, nada más

EJEMPLOS BUENOS (recuerda: esto es SOLO lo que sigue después de "{{emoji}} {{Empresa}} {{%}} "):
"tras superar expectativas de ingresos impulsada por demanda de chips de IA"
"tras el anuncio de Blackwell Ultra para centros de datos de IA"
"por la demanda antimonopolio de la FTC sobre sus prácticas en AWS"
"por la negociación de EE.UU. para permitir venta de chips H200 en China"
"tras guidance débil de TSMC para todo el sector de semiconductores"
"después de que Goldman Sachs subiera su precio objetivo"
"tras la renuncia sorpresiva de su CFO"

EJEMPLO MALO → responde NO_CATALYST en este caso (no hay ningún hecho concreto detrás):
"por el sentimiento positivo del mercado y expectativas generales de los inversores"

Responde solo con el texto de la razón (sin punto final) o con NO_CATALYST."""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        resp = await asyncio.wait_for(
            client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=180,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=15.0,
        )
        result = resp.content[0].text.strip().strip('"').strip("'")

        if result.startswith("NO_CATALYST"):
            logger.info(
                "No specific catalyst for %s (%+.1f%%, has_news=%s, has_web_context=%s) — "
                "this is a genuine 'no catalyst found' from Claude, not an API failure",
                ticker, change_pct, bool(news_items), bool(extra_context),
            )
            return NO_CATALYST

        # Hard safety net in case the model ignores the ~70-char guidance above —
        # tightened from the old 230-char cap now that the full notification
        # (emoji+empresa+%+esto) targets ~90-120 characters total.
        if len(result) > 85:
            truncated = result[:82].rsplit(" ", 1)[0]
            result = truncated + "..."
        return result

    except asyncio.TimeoutError:
        # Distinguishing this from "genuinely no catalyst" (above) is the whole
        # point — a timeout here silently used to look identical to a real
        # NO_CATALYST in the notification the user sees, making it impossible
        # to tell "there really was no news" from "the API was just slow."
        logger.warning("Claude price alert WHY call TIMED OUT for %s (>15s) — treating as NO_CATALYST but this is a failure, not a real finding", ticker)
        return NO_CATALYST
    except Exception as e:
        logger.warning("Claude price alert WHY call FAILED for %s: %s — treating as NO_CATALYST but this is a failure, not a real finding", ticker, e)
        return NO_CATALYST


async def translate_why_to_english(why_es: str) -> str:
    """Translates an already-generated Spanish WHY clause (from
    generate_price_alert_why) to a natural-sounding English equivalent —
    kept as a cheap, separate call rather than adding an English branch to
    the main prompt above, since that prompt's NO_CATALYST judgment logic
    was carefully tuned this session and duplicating it risks drifting the
    two languages out of sync. Only ever called with a real (non-NO_CATALYST)
    clause. Falls back to the Spanish text if the call fails — better than
    silently dropping the WHY entirely."""
    import anthropic
    from app.core.config import settings

    prompt = f"""Translate this short English push-notification clause fragment from Spanish to natural English. It follows a "{{emoji}} {{Ticker}} rose/fell {{X.XX}}%" prefix, so it must flow as a continuation (lowercase start, no period at the end, ~70 characters max).

Spanish: "{why_es}"

Reply with ONLY the English translation, nothing else."""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        resp = await asyncio.wait_for(
            client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=100,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=10.0,
        )
        result = resp.content[0].text.strip().strip('"').strip("'")
        return result or why_es
    except Exception as e:
        logger.warning("WHY translation to English failed: %s — falling back to Spanish text", e)
        return why_es
