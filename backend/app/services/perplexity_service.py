import os
import hashlib
import requests
from app.core.cache import cache_get, cache_set

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
            timeout=9,
        )
        if r.status_code != 200:
            return ""
        content = (r.json().get("choices") or [{}])[0].get("message", {}).get("content", "")
        if not content:
            return ""
        result = f"**[Búsqueda web en tiempo real — Perplexity]**\n{content.strip()}" if label else content.strip()
        cache_set(cache_key, result, ttl=_SEARCH_CACHE_TTL)
        return result
    except Exception:
        return ""
