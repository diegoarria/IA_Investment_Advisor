"""Cost-optimization recommendations #8 (response caching) + #9 (detecting
repeated questions). Deliberately conservative: only ever short-circuits
Sonnet for standalone, textbook-style educational questions with zero
personal/live-market dependency — anything with a ticker, portfolio
reference, image, or existing conversation thread always falls through to
the normal personalized path. When in doubt, this returns "not cacheable",
never the reverse — a wrong cache hit (stale/generic answer where the user
expected a personalized one) is a worse failure mode than a missed cache
opportunity (one extra Sonnet call).
"""
import hashlib
import logging
import re

from app.core.cache import cache_get, cache_set
from app.models.user import ChatMessage

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 86400  # 24h — long enough to pay off repeats, short enough that stale market commentary never lingers
_MAX_CACHEABLE_LEN = 160

# Patterns for "explain this concept" style questions — the one category of
# question where the correct answer genuinely doesn't depend on who's asking.
_GENERIC_PATTERNS = [
    r"^\s*(qu[eé] es|que significa|qu[eé] significa)\b",
    r"^\s*(what is|what does .* mean)\b",
    r"^\s*(c[oó]mo funciona)\b",
    r"^\s*(how does .* work)\b",
    r"^\s*(explica|expl[ií]came|define)\b",
    r"^\s*(explain|define)\b",
]

# Anything matching these means the question depends on live data or the
# user's specific situation — never cacheable regardless of phrasing.
_PERSONAL_OR_LIVE_PATTERNS = [
    r"\bmi (portafolio|cuenta|posici[oó]n|inversi[oó]n)\b",
    r"\bmy (portfolio|account|position)\b",
    r"\$\d",
    r"\b[A-Z]{2,5}\b.*\b(precio|price|acci[oó]n|stock)\b",
    r"\bhoy\b|\btoday\b|\bahora\b|\bnow\b",
]


def _normalize(message: str) -> str:
    # Strip leading ¿/¡ so the "starts with" patterns below still match —
    # Spanish questions almost always open with one.
    stripped = message.strip().lstrip("¿¡")
    return re.sub(r"\s+", " ", stripped.strip().lower())


def classify_and_cache_key(
    message: str,
    has_images: bool,
    history_len: int,
    language: str = "es",
) -> str | None:
    """Returns a cache key if this question is safely cacheable/genericizable,
    else None (meaning: always go through the full personalized pipeline)."""
    if has_images or history_len > 0:
        return None
    if len(message) > _MAX_CACHEABLE_LEN:
        return None
    norm = _normalize(message)
    if any(re.search(p, norm, re.IGNORECASE) for p in _PERSONAL_OR_LIVE_PATTERNS):
        return None
    if not any(re.search(p, norm, re.IGNORECASE) for p in _GENERIC_PATTERNS):
        return None
    digest = hashlib.sha256(f"{language}:{norm}".encode()).hexdigest()
    return f"genericqa:{digest}"


def get_cached_answer(cache_key: str) -> str | None:
    try:
        return cache_get(cache_key)
    except Exception as e:
        logger.warning("get_cached_answer failed: %s", e)
        return None


def store_answer(cache_key: str, answer: str) -> None:
    try:
        # Don't cache an answer that itself carries personalized artifacts
        # (action tags, a scorecard) — those shouldn't be genericized to
        # other users even if the question text matched a generic pattern.
        if "[[ACTION:" in answer or "riesgo:" in answer.lower()[:200]:
            return
        cache_set(cache_key, answer, ttl=_CACHE_TTL_SECONDS)
    except Exception as e:
        logger.warning("store_answer failed: %s", e)
