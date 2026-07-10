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


def should_send_price_alert(user_id: str, ticker: str, has_catalyst: bool) -> tuple[bool, bool]:
    """
    Decide whether THIS specific price-mover push should go out, allowing up
    to two sends per ticker per user per day:
      1. The first alert today for this ticker, whatever its content.
      2. Exactly ONE follow-up "we found out why" correction — only when the
         first alert went out with no catalyst and a real one has since been
         found (the same 5-min job re-checks Perplexity every cycle a ticker
         stays a mover, so a catalyst that breaks 10-20 min after the initial
         alert is now something the user actually gets told about, instead of
         being stuck with "no news" for the rest of the day).

    A ticker that already got a real-catalyst alert never sends again that
    day (nothing new to say), and a second no-catalyst ping is also
    suppressed (still nothing new to say). State is tracked separately from
    notification_engine's generic per-category dedup — this is price-alert-
    specific "have we already told this user why, and how well."

    Returns (should_send, is_correction).
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    state_key = f"pricealert_state:{user_id}:{ticker}:{today}"
    state = cache_get(state_key)  # None | "no_catalyst" | "catalyst"

    if state is None:
        cache_set(state_key, "catalyst" if has_catalyst else "no_catalyst", ttl=26 * 3600)
        return True, False

    if state == "no_catalyst" and has_catalyst:
        cache_set(state_key, "catalyst", ttl=26 * 3600)
        logger.info("Sending price-alert CORRECTION for user %s / %s — catalyst found after an earlier no-catalyst alert today", user_id, ticker)
        return True, True

    return False, False


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
La notificación push YA incluye una primera oración con el nombre de la empresa, el
movimiento y el porcentaje (ej. "NVIDIA hoy está subiendo un +4.58%."). Tu trabajo es
escribir SOLO la razón que sigue a esa oración — no repitas el nombre de la empresa, el
verbo de movimiento (subió/bajó/está subiendo/está cayendo) ni el porcentaje, eso ya
está cubierto.

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

3. Si hay catalizador (aunque sea parcial):
   - Empieza con algo como "La razón principal es que..." / "Esto pasó después de que..." /
     "Esto se debe a..." — una transición natural, como si un amigo te estuviera explicando
   - Menciona el catalizador específico en 1 oración directa
   - Tono: como un amigo explicándote qué pasó, sin jerga financiera
   - Máximo 170 caracteres
   - Sin emojis, sin mencionar "Nuvos AI", sin repetir el ticker/porcentaje
   - Solo el texto, nada más

EJEMPLOS BUENOS (recuerda: esto es SOLO la razón, la oración del movimiento va aparte):
"La razón principal es que reportó ingresos de $124B en Q2, superando las estimaciones de Wall Street."
"Esto pasó después de que Jensen Huang anunciara la arquitectura Blackwell Ultra para centros de datos IA."
"Esto se debe a que la FTC presentó una demanda antimonopolio por sus prácticas en AWS."
"La razón principal es que el gobierno chino está negociando permitir la venta de sus chips H200 en China."
"Esto se debe a que un competidor clave (TSMC) reportó guidance débil para todo el sector de semiconductores."
"Esto pasó después de que Goldman Sachs subiera su precio objetivo citando mejores márgenes esperados."
"La razón principal es la renuncia sorpresiva de su CFO, lo que generó incertidumbre entre los inversores."

EJEMPLO MALO → responde NO_CATALYST en este caso (no hay ningún hecho concreto detrás):
"Esto se debe al sentimiento positivo del mercado y expectativas generales de los inversores."

Responde solo con el texto de la razón o con NO_CATALYST."""

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

        if len(result) > 230:
            result = result[:227] + "..."
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
