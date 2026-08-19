"""Shared rate limiter instance — imported by main.py and individual routers."""
import hashlib
from slowapi import Limiter
from fastapi import Request


def _rate_key(request: Request) -> str:
    """Key by the caller's own bearer token when present, otherwise by the
    real client IP (or the access_token cookie, for the web app — see
    below).

    NOTE: this previously tried to locally decode the bearer token as a JWT
    signed with this app's own `secret_key` — but real access tokens are
    signed by Supabase's own JWT secret (which this backend never holds; see
    app/api/deps.py, which verifies tokens via a Supabase round-trip instead
    of local decoding), so that decode always failed and silently fell back
    to IP-only limiting. Hashing the raw token is simpler and actually
    correct: it doesn't need to decode anything to get a stable per-session
    key, it just can't be trivially spoofed since a caller can't affect
    another user's token.

    The web app never sends an Authorization header at all — it's entirely
    cookie-based (see frontend/web/src/lib/api.ts) — so without this cookie
    fallback, EVERY authenticated web request fell through to the IP-only
    branch below, which was itself broken (see next paragraph): effectively
    all authenticated web rate limiting was IP-only and shared across every
    account behind the same address.

    IP fallback: this used to be slowapi's own get_remote_address, i.e.
    request.client.host — behind Railway's edge (gunicorn with no
    --proxy-headers/ProxyHeadersMiddleware configured), that's the load
    balancer's address, not the real client, meaning the IP-only branch
    likely bucketed ALL traffic behind one shared key. app.core.security's
    client_ip() already reads X-Forwarded-For correctly (used for the real
    login-lockout brute-force protection) — reusing it here instead."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer ") and len(auth_header) > 7:
        token = auth_header[7:]
        return "tok:" + hashlib.sha256(token.encode()).hexdigest()[:32]
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        return "tok:" + hashlib.sha256(cookie_token.encode()).hexdigest()[:32]
    from app.core.security import client_ip
    return "ip:" + client_ip(request)


def _storage_uri() -> str:
    try:
        from app.core.config import settings
        if settings.redis_url:
            return settings.redis_url
    except Exception:
        pass
    return "memory://"


limiter = Limiter(key_func=_rate_key, storage_uri=_storage_uri())
