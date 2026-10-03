import hashlib
from fastapi import Cookie, Header, HTTPException
from app.core.database import get_supabase, run_auth
from app.core.cache import cache_get, cache_set

_TOKEN_CACHE_TTL = 60  # seconds — token revocation propagates within this window


def is_definitive_auth_rejection(exc: Exception) -> bool:
    """True only when Supabase Auth itself answered "this token/session is
    not valid" (bad/expired JWT, refresh token unknown/already used/revoked,
    user gone). Network errors, timeouts, 5xx and rate limits are NOT —
    those must never end a user's session."""
    try:
        from gotrue.errors import AuthApiError, AuthInvalidJwtError, AuthSessionMissingError
    except Exception:  # pragma: no cover — package rename safety
        return False
    if isinstance(exc, (AuthInvalidJwtError, AuthSessionMissingError)):
        return True
    if isinstance(exc, AuthApiError):
        status = getattr(exc, "status", None) or 0
        return 400 <= status < 500 and status != 429
    return False


async def _resolve_user_token(token: str) -> dict:
    """Resolve a raw bearer token string → {id, email}. Cached by token hash."""
    if not token:
        raise HTTPException(status_code=401, detail="Invalid token format")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    ck = f"auth:user:{token_hash}"
    cached = cache_get(ck)
    if cached:
        return cached
    try:
        db = get_supabase()
        result = await run_auth(db.auth.get_user, token)
        if result.user is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_data = {"id": result.user.id, "email": getattr(result.user, "email", None)}
        cache_set(ck, user_data, ttl=_TOKEN_CACHE_TTL)
        return user_data
    except HTTPException:
        raise
    except Exception as e:
        # Diego, 2026-10-02: "deja la sesión iniciada siempre". Only a token
        # Supabase actually REJECTED is a 401 — a network blip or Supabase
        # hiccup used to be reported as 401 too, which sent the clients
        # through a refresh (and, when that also hiccuped, a forced logout)
        # for a perfectly valid session. Transient failures are 503 now, so
        # the clients just retry and the user stays signed in.
        if is_definitive_auth_rejection(e):
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        raise HTTPException(status_code=503, detail="Auth temporarily unavailable, retry")


async def _resolve_user(authorization: str) -> dict:
    """Back-compat wrapper — resolve from a raw 'Authorization: Bearer <token>' string."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token format")
    return await _resolve_user_token(authorization.split(" ")[1])


def _extract_token(authorization: str, access_token_cookie: str | None) -> str:
    """Mobile (SecureStore) sends the Authorization header — unchanged, always
    wins if present. Web sends an httpOnly `access_token` cookie instead, so the
    token is never readable by JS (XSS can't exfiltrate it from localStorage
    anymore). Falling back to the cookie only when there's no header keeps both
    platforms working through the exact same dependency."""
    if authorization.startswith("Bearer "):
        return authorization.split(" ")[1]
    return access_token_cookie or ""


async def get_current_user_id(
    authorization: str = Header(default=""),
    access_token: str | None = Cookie(default=None),
) -> str:
    user = await _resolve_user_token(_extract_token(authorization, access_token))
    # Attribute every LLM call made while serving this request to the user
    # (see app/core/request_context.py).
    from app.core.request_context import current_user_id
    current_user_id.set(user["id"])
    return user["id"]


async def get_current_user(
    authorization: str = Header(default=""),
    access_token: str | None = Cookie(default=None),
) -> dict:
    """Returns {'id': str, 'email': str | None}."""
    user = await _resolve_user_token(_extract_token(authorization, access_token))
    from app.core.request_context import current_user_id
    current_user_id.set(user["id"])
    return user
