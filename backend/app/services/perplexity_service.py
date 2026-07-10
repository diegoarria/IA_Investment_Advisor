import os
import hashlib
import logging
import requests
from app.core.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

_SEARCH_CACHE_TTL = 300  # 5 minutes


def _needs_web_search(message: str) -> bool:
    """Return True when the message is likely asking for current/recent information."""
    msg = message.lower()
    kws = [
        # temporal
        "hoy", "ayer", "esta semana", "este mes", "ahora mismo", "en este momento",
        "reciente", "últimas noticias", "último reporte", "últimos resultados",
        "qué pasó", "qué está pasando", "qué ha pasado",
        # financial events
        "earnings", "reporte trimestral", "resultados trimestrales", "resultados del trimestre",
        "ipo próxima", "próxima ipo", "sale a bolsa",
        "adquisición", "fusión", "split de acciones", "buyback",
        "anunció", "reportó", "declaró", "presentó resultados",
        # price movement explanations
        "por qué subió", "por qué bajó", "por qué cayó", "por qué rebotó",
        "qué pasó con", "qué le pasó a",
        "rally", "crash hoy", "caída hoy",
        # macro events
        "fed hoy", "reunión de la fed", "decisión de tasas", "cpi de hoy",
        "datos de empleo", "nfp", "inflación hoy",
    ]
    return any(kw in msg for kw in kws)


def search_web(query: str, label: bool = True) -> str:
    """
    Search for real-time financial information using Perplexity API.
    Returns a formatted block ready for injection into AI context.
    Cached 5 minutes per query hash.

    `label=False` returns the raw answer with no "[Búsqueda web...]" prefix —
    for callers that feed the result into their own prompt (vs. AI chat context).
    """
    from app.core.config import settings
    api_key = getattr(settings, "perplexity_api_key", "") or os.getenv("PERPLEXITY_API_KEY", "")
    if not api_key:
        # This is a silent no-op that looks identical to "search found nothing"
        # to every caller — logging it loudly here is the only way to tell
        # "Perplexity isn't configured" apart from "there's really no news"
        # further up the stack (e.g. price-alert notifications reporting
        # NO_CATALYST far more often than expected).
        logger.warning("perplexity_service.search_web called with no API key configured — returning empty, query was: %s", query[:200])
        return ""

    cache_key = "perp:" + hashlib.md5(f"{query}|{label}".encode()).hexdigest()[:16]
    cached = cache_get(cache_key)
    if cached:
        return cached

    try:
        r = requests.post(
            "https://api.perplexity.ai/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "sonar",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Eres un asistente de búsqueda financiera. Responde en español, de forma "
                            "concisa y factual. Incluye fechas, cifras y fuentes cuando estén disponibles. "
                            "Máximo 350 palabras. Enfócate en información de mercados, empresas e inversiones."
                        ),
                    },
                    {"role": "user", "content": query},
                ],
                "max_tokens": 450,
            },
            timeout=12,
        )
        if r.status_code != 200:
            logger.warning("Perplexity API returned status %s for query: %s — body: %s", r.status_code, query[:200], r.text[:300])
            return ""
        content = (r.json().get("choices") or [{}])[0].get("message", {}).get("content", "")
        if not content:
            logger.warning("Perplexity API returned an empty answer for query: %s", query[:200])
            return ""
        result = f"**[Búsqueda web en tiempo real — Perplexity]**\n{content.strip()}" if label else content.strip()
        cache_set(cache_key, result, ttl=_SEARCH_CACHE_TTL)
        return result
    except Exception as e:
        logger.warning("Perplexity API call raised an exception for query %s: %s", query[:200], e)
        return ""
