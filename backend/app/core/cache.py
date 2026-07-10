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
        pool = redis_lib.BlockingConnectionPool.from_url(
            settings.redis_url,
            max_connections=100,
            timeout=5,
            decode_responses=True,
            socket_timeout=2,
        )
        _redis = redis_lib.Redis(connection_pool=pool)
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


def cache_incr(key: str, ttl: int) -> int:
    """Atomically increment a counter, setting its expiry only on first creation.

    Used for rate limiting, brute-force attempt counting, and any other
    "how many times has X happened in this window" check. Truly atomic (and
    therefore safe across multiple backend processes/replicas) only when
    Redis is configured — the in-memory fallback is a best-effort
    single-process approximation, correct enough for local dev but not a
    substitute for Redis in a horizontally-scaled deployment.
    """
    r = _get_redis()
    if r:
        try:
            pipe = r.pipeline()
            pipe.incr(key, 1)
            pipe.expire(key, ttl, nx=True)  # only set TTL if key has none yet
            count, _ = pipe.execute()
            return int(count)
        except Exception:
            pass
    # In-memory fallback — good enough for single-process local dev.
    entry = _mem.get(key)
    now = time.time()
    if entry is None or now > entry[1]:
        _mem[key] = (1, now + ttl)
        return 1
    count = int(entry[0]) + 1
    _mem[key] = (count, entry[1])
    return count


_RELEASE_LUA = """
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
"""

_locks_mem: dict[str, tuple[str, float]] = {}  # key -> (token, expires_at) — in-memory fallback


def acquire_lock(key: str, ttl: int = 30) -> str | None:
    """Distributed single-flight lock. Returns a token to pass to release_lock()
    if acquired, or None if someone else already holds it.

    Purpose: when N concurrent requests all want the same expensive resource
    (e.g. "fetch AAPL's 5y history"), only the request that wins the lock
    does the real work; everyone else should back off and read the cache
    that the winner is about to populate. Only truly cross-process safe when
    Redis is configured — the in-memory fallback only dedupes within a
    single worker process, which is still a meaningful reduction (most
    request storms hit whichever process/thread pool is under load) but not
    a full guarantee under multiple gunicorn workers without Redis.
    """
    import uuid
    token = uuid.uuid4().hex
    r = _get_redis()
    if r:
        try:
            if r.set(key, token, nx=True, ex=ttl):
                return token
            return None
        except Exception:
            pass
    now = time.time()
    held = _locks_mem.get(key)
    if held is None or now > held[1]:
        _locks_mem[key] = (token, now + ttl)
        return token
    return None


def release_lock(key: str, token: str) -> None:
    """Release a lock acquired via acquire_lock(), only if we still hold it
    (compare-and-delete — never release a lock some other holder acquired
    after ours expired)."""
    r = _get_redis()
    if r:
        try:
            r.eval(_RELEASE_LUA, 1, key, token)
            return
        except Exception:
            pass
    held = _locks_mem.get(key)
    if held and held[0] == token:
        _locks_mem.pop(key, None)


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
