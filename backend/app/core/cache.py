"""
Shared cache layer — uses Redis when REDIS_URL is set, falls back to
process-local dicts otherwise. The API is identical either way, so
callers don't need to know which backend is active.

Usage:
    from app.core.cache import cache_get, cache_set, cache_delete

    data = cache_get("my_key")
    if data is None:
        data = expensive_call()
        cache_set("my_key", data, ttl=300)
"""

import json
import time
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ── In-memory fallback ─────────────────────────────────────────────────────
_mem: dict[str, tuple[Any, float]] = {}  # key → (value, expires_at)


# ── Redis client (lazy init) ───────────────────────────────────────────────
_redis = None

def _get_redis():
    global _redis
    if _redis is not None:
        return _redis
    try:
        from app.core.config import settings
        if not settings.redis_url:
            return None
        import redis as redis_lib
        _redis = redis_lib.from_url(settings.redis_url, decode_responses=True, socket_timeout=2)
        _redis.ping()
        logger.info("Redis cache connected: %s", settings.redis_url)
        return _redis
    except Exception as e:
        logger.warning("Redis unavailable (%s), using in-memory cache", e)
        _redis = None
        return None


# ── Public API ─────────────────────────────────────────────────────────────

def cache_get(key: str) -> Any | None:
    r = _get_redis()
    if r:
        try:
            raw = r.get(key)
            return json.loads(raw) if raw is not None else None
        except Exception:
            pass
    # In-memory fallback
    entry = _mem.get(key)
    if entry is None:
        return None
    value, expires_at = entry
    if time.time() > expires_at:
        _mem.pop(key, None)
        return None
    return value


def cache_set(key: str, value: Any, ttl: int) -> None:
    r = _get_redis()
    if r:
        try:
            r.setex(key, ttl, json.dumps(value, default=str))
            return
        except Exception:
            pass
    # In-memory fallback
    _mem[key] = (value, time.time() + ttl)
    # Simple eviction — remove expired entries when dict grows large
    if len(_mem) > 2000:
        now = time.time()
        expired = [k for k, (_, exp) in _mem.items() if now > exp]
        for k in expired:
            _mem.pop(k, None)


def cache_delete(key: str) -> None:
    r = _get_redis()
    if r:
        try:
            r.delete(key)
        except Exception:
            pass
    _mem.pop(key, None)


def cache_get_with_ts(key: str) -> tuple[Any | None, float]:
    """Returns (value, timestamp) where timestamp is when it was cached (0 if miss)."""
    r = _get_redis()
    if r:
        try:
            raw = r.get(key)
            if raw is not None:
                data = json.loads(raw)
                ttl = r.ttl(key)
                return data, time.time() - ttl  # approximate cached_at
        except Exception:
            pass
    entry = _mem.get(key)
    if entry and time.time() <= entry[1]:
        return entry[0], entry[1]
    return None, 0
