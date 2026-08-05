import os
import hashlib
import logging
import requests
from app.core.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

_SEARCH_CACHE_TTL = 300  # 5 minutes


def _needs_web_search(message: str) -> bool:
    """Return True when the message is likely asking for current/recent information.

    Deliberately narrow: standalone words like "hoy"/"reciente"/"anunció" used
    to be in here, but they fire on ordinary conversational Spanish that has
    nothing to do with live info ("hoy me siento inseguro de mi portafolio")
    — each false positive is a real Perplexity call plus extra tokens injected
    into the Claude call for no reason. Every phrase below is specific enough
    that it's actually asking for something live.
    """
    msg = message.lower()
    kws = [
        # temporal — specific asks, not standalone "hoy"/"reciente"
        "esta semana", "este mes",
        "últimas noticias", "último reporte", "últimos resultados",
        "qué pasó", "qué está pasando", "qué ha pasado",
        # financial events
        "earnings", "reporte trimestral", "resultados trimestrales", "resultados del trimestre",
        "ipo próxima", "próxima ipo", "sale a bolsa",
        "adquisición", "fusión", "split de acciones", "buyback",
        "presentó resultados",
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
            timeout=30,
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


# ── Fase 2, Incremento 6 ─────────────────────────────────────────────────
# search_web() above only ever returned the synthesized answer text — the
# `citations`/`search_results` arrays the "sonar" model's API response
# already includes were fetched over the wire and then simply discarded.
# This is a real, honest "search result + real link" evidence source for
# the Moat/Management/Catalysts engines (Incrementos 7-9): every citation
# is a real URL Perplexity's own web search actually found, not a link the
# LLM invented. New function, not a change to search_web()'s existing
# behavior/callers — zero risk to anything already using it.

_CITED_SEARCH_CACHE_TTL = 3600  # 1h — longer than search_web's 5min: this
# feeds evidence gathering for scores that don't need to react to the
# newest headline the way a chat "what happened today" answer does.


def search_web_with_citations(query: str, system_prompt: str | None = None, max_tokens: int = 600) -> dict:
    """Same Perplexity "sonar" call as `search_web`, but returns the real
    citation URLs alongside the answer instead of discarding them:
    `{"answer": str, "citations": list[{"url": str, "title": str | None}]}`.
    Returns `{"answer": "", "citations": []}` (never a fabricated citation)
    on any failure — same fail-empty philosophy as `search_web`."""
    from app.core.config import settings
    api_key = getattr(settings, "perplexity_api_key", "") or os.getenv("PERPLEXITY_API_KEY", "")
    empty: dict = {"answer": "", "citations": []}
    if not api_key:
        logger.warning("perplexity_service.search_web_with_citations called with no API key configured — query was: %s", query[:200])
        return empty

    cache_key = "perp:cited:" + hashlib.md5(f"{query}|{system_prompt}".encode()).hexdigest()[:16]
    cached = cache_get(cache_key)
    if cached:
        return cached

    try:
        r = requests.post(
            "https://api.perplexity.ai/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "sonar",
                "messages": [
                    {"role": "system", "content": system_prompt or (
                        "Eres un asistente de búsqueda financiera. Responde en español, de forma "
                        "concisa y factual. Máximo 350 palabras."
                    )},
                    {"role": "user", "content": query},
                ],
                "max_tokens": max_tokens,
            },
            timeout=30,
        )
        if r.status_code != 200:
            logger.warning("Perplexity API (cited) returned status %s for query: %s", r.status_code, query[:200])
            return empty
        body = r.json()
        content = (body.get("choices") or [{}])[0].get("message", {}).get("content", "")
        # "search_results" (richer: title+url+date) is preferred when
        # present; falls back to the plainer "citations" (URL-only) array
        # — both are real fields the sonar model's API response includes,
        # never previously read by this codebase.
        raw_results = body.get("search_results") or []
        citations = [
            {"url": item.get("url"), "title": item.get("title")}
            for item in raw_results if item.get("url")
        ]
        if not citations:
            citations = [{"url": u, "title": None} for u in (body.get("citations") or []) if u]
        result = {"answer": content.strip(), "citations": citations}
        cache_set(cache_key, result, ttl=_CITED_SEARCH_CACHE_TTL)
        return result
    except Exception as e:
        logger.warning("Perplexity API (cited) call raised an exception for query %s: %s", query[:200], e)
        return empty
