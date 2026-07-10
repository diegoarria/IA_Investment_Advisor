"""Shared rate limiter instance — imported by main.py and individual routers."""
import hashlib
from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request


def _rate_key(request: Request) -> str:
    """Key by the caller's own bearer token when present, otherwise by IP.

    NOTE: this previously tried to locally decode the bearer token as a JWT
    signed with this app's own `secret_key` — but real access tokens are
    signed by Supabase's own JWT secret (which this backend never holds; see
    app/api/deps.py, which verifies tokens via a Supabase round-trip instead
    of local decoding), so that decode always failed and silently fell back
    to IP-only limiting. Hashing the raw token is simpler and actually
    correct: it doesn't need to decode anything to get a stable per-session
    key, it just can't be trivially spoofed since a caller can't affect
    another user's token.
    """
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer ") and len(auth_header) > 7:
        token = auth_header[7:]
        return "tok:" + hashlib.sha256(token.encode()).hexdigest()[:32]
    return get_remote_address(request)


def _storage_uri() -> str:
    try:
        from app.core.config import settings
        if settings.redis_url:
            return settings.redis_url
    except Exception:
        pass
    return "memory://"


limiter = Limiter(key_func=_rate_key, storage_uri=_storage_uri())
