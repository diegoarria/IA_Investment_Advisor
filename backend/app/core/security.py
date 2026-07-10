"""
Brute-force protection and suspicious-activity logging for authentication.

Design:
  - Failed attempts are counted per (identity, ip) AND per identity alone, so
    an attacker can't dodge the lockout just by rotating IPs, and a shared
    office/NAT IP can't lock out everyone behind it just because of one
    attacker targeting a different account.
  - Counters live in the shared cache (Redis when configured — see
    app/core/cache.py) so the lockout is real across all gunicorn workers,
    not per-process.
  - Every meaningful security event (failed login, lockout triggered,
    password-reset requested/failed, account-enumeration-shaped traffic) is
    persisted to the `security_events` table (see migrations/033) — cheap
    insurance so a real incident has an audit trail instead of only
    scattered log lines that rotate away.
"""

import logging
import time
from typing import Optional

from app.core.cache import cache_get, cache_set, cache_incr

logger = logging.getLogger(__name__)

# Tuned to stop automated brute-forcing while never locking out a real user
# who just mistypes their password a few times.
LOGIN_MAX_ATTEMPTS = 8
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_LOCKOUT_SECONDS = 15 * 60

RESET_CODE_MAX_ATTEMPTS = 5
RESET_CODE_WINDOW_SECONDS = 15 * 60  # matches the reset code's own TTL

# Coarser IP-wide ceiling — catches credential-stuffing across many different
# target emails from the same source, which per-identity counters can't see.
IP_MAX_ATTEMPTS = 30
IP_WINDOW_SECONDS = 15 * 60


def _lockout_key(kind: str, identity: str) -> str:
    return f"lockout:{kind}:{identity}"


def _attempt_key(kind: str, identity: str) -> str:
    return f"attempts:{kind}:{identity}"


def is_locked_out(kind: str, identity: str) -> Optional[int]:
    """Returns seconds remaining if locked out, else None."""
    until = cache_get(_lockout_key(kind, identity))
    if until is None:
        return None
    remaining = int(until - time.time())
    return remaining if remaining > 0 else None


def record_failure(kind: str, identity: str, *, max_attempts: int, window: int, lockout: int) -> Optional[int]:
    """Record one failed attempt for `identity` under `kind`. If this trips
    the threshold, locks it out and returns the lockout duration in seconds
    (else None)."""
    count = cache_incr(_attempt_key(kind, identity), ttl=window)
    if count >= max_attempts:
        cache_set(_lockout_key(kind, identity), time.time() + lockout, ttl=lockout)
        return lockout
    return None


def clear_attempts(kind: str, identity: str) -> None:
    """Call on a successful auth to reset the counter for that identity."""
    from app.core.cache import cache_delete
    cache_delete(_attempt_key(kind, identity))
    cache_delete(_lockout_key(kind, identity))


def check_login_lockout(email: str, ip: str) -> None:
    """Raises HTTPException(429) if this email or IP is currently locked out."""
    from fastapi import HTTPException
    for kind, identity in ((f"login:email", email), (f"login:ip", ip)):
        remaining = is_locked_out(kind, identity)
        if remaining:
            raise HTTPException(
                status_code=429,
                detail=f"Demasiados intentos fallidos. Intenta de nuevo en {max(1, remaining // 60)} minuto(s).",
            )


def record_login_failure(email: str, ip: str) -> None:
    record_failure(f"login:email", email, max_attempts=LOGIN_MAX_ATTEMPTS,
                   window=LOGIN_WINDOW_SECONDS, lockout=LOGIN_LOCKOUT_SECONDS)
    record_failure(f"login:ip", ip, max_attempts=IP_MAX_ATTEMPTS,
                   window=IP_WINDOW_SECONDS, lockout=LOGIN_LOCKOUT_SECONDS)
    log_security_event("login_failed", email=email, ip=ip)


def record_login_success(email: str, ip: str) -> None:
    clear_attempts(f"login:email", email)
    clear_attempts(f"login:ip", ip)


def check_reset_code_lockout(identity: str) -> None:
    """identity = normalized email or phone the reset code was issued to."""
    from fastapi import HTTPException
    remaining = is_locked_out("reset_code", identity)
    if remaining:
        raise HTTPException(
            status_code=429,
            detail=f"Demasiados intentos. Solicita un nuevo código en {max(1, remaining // 60)} minuto(s).",
        )


def record_reset_code_failure(identity: str) -> None:
    locked = record_failure("reset_code", identity, max_attempts=RESET_CODE_MAX_ATTEMPTS,
                             window=RESET_CODE_WINDOW_SECONDS, lockout=RESET_CODE_WINDOW_SECONDS)
    log_security_event("password_reset_code_failed", email=identity)
    if locked:
        # Also burn the code itself — a locked-out attacker shouldn't be able
        # to keep guessing once a new window starts; they must request fresh.
        from app.core.cache import cache_delete
        cache_delete(f"reset_code:email:{identity}")
        cache_delete(f"reset_code:phone:{identity}")
        log_security_event("password_reset_lockout", email=identity)


def record_reset_code_success(identity: str) -> None:
    clear_attempts("reset_code", identity)


def log_security_event(event_type: str, *, email: str | None = None, ip: str | None = None,
                        user_id: str | None = None, detail: str | None = None) -> None:
    """Best-effort audit trail insert — never raises, never blocks the
    request path it's called from. A missing/broken security_events table
    (e.g. before migration 033 is applied) degrades to a log line only."""
    try:
        logger.warning("security_event=%s email=%s ip=%s user_id=%s detail=%s",
                        event_type, email, ip, user_id, detail)
        from app.core.database import get_supabase
        db = get_supabase()
        db.table("security_events").insert({
            "event_type": event_type,
            "email": email,
            "ip_address": ip,
            "user_id": user_id,
            "detail": detail,
        }).execute()
    except Exception:
        # Logging a security event must never be the reason a request fails.
        pass


def client_ip(request) -> str:
    """Best-effort real client IP, respecting a trusted reverse proxy header
    (Railway/most PaaS terminate TLS and forward via X-Forwarded-For)."""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
