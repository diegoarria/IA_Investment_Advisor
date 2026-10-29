"""Shared rate limiter instance — imported by main.py and individual routers."""
import hashlib
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
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


limiter = Limiter(
    key_func=_rate_key,
    storage_uri=_storage_uri(),
    # NOT setting headers_enabled=True: slowapi's wrapper calls
    # `_inject_headers` directly on an endpoint's RAW return value when
    # that's on, BEFORE FastAPI serializes it — but every one of this app's
    # ~50 `@limiter.limit`-decorated routes returns a plain dict, not a
    # Starlette Response, so the global flag makes slowapi raise
    # "parameter `response` must be an instance of starlette.responses.
    # Response" on every SUCCESSFUL (under-limit) request to any of them —
    # confirmed locally, would have been a much bigger regression than the
    # bug being fixed here. Retry-After is still added below, but only on
    # the already-a-real-Response 429 path, not the success path.
    #
    # Graceful degradation if the Redis-backed limiter store itself becomes
    # unreachable: slowapi falls back to a local in-memory limiter instead
    # of raising a storage exception on every request (confirmed live: an
    # unreachable storage_uri produces an unhandled 500 with this off).
    # Per-process/approximate across Railway's multiple workers, not as
    # strict as the real Redis-backed limit, but still real protection
    # instead of either "every request 500s" or "no limiting at all".
    in_memory_fallback_enabled=True,
    in_memory_fallback=["200/minute"],
)


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """Wraps slowapi's default 429 handler to also log the trip into
    security_events (migration 033) — previously a rate-limit trip left no
    trace anywhere, so a scan/brute-force burst was invisible even though the
    protection itself worked.

    NOT async, on purpose: slowapi's own `_rate_limit_exceeded_handler` is a
    plain sync function that returns a `JSONResponse` directly, not a
    coroutine. The previous version of this wrapper was `async def` and did
    `return await _rate_limit_exceeded_handler(...)` — awaiting a plain
    `JSONResponse` raises `TypeError: object JSONResponse can't be used in
    'await' expression` INSIDE this exception handler itself. Starlette has
    no handler for an exception raised by an exception handler, so that
    TypeError propagated all the way up as an unhandled 500 — meaning every
    legitimate rate-limit trip, app-wide, produced a generic 500 instead of
    a 429. Confirmed live and locally: requests under the limit returned
    200, every request once the limit was exceeded returned 500 (not 429),
    on every endpoint using this shared limiter."""
    from app.core.security import client_ip, log_security_event
    log_security_event(
        "rate_limit_exceeded", ip=client_ip(request), detail=request.url.path,
        user_agent=request.headers.get("user-agent"), accept_language=request.headers.get("accept-language"),
    )
    response = _rate_limit_exceeded_handler(request, exc)
    # Retry-After on this one already-real Response, computed directly from
    # the window slowapi already resolved for this request — see the
    # headers_enabled note on `limiter` above for why this isn't done via
    # that global flag instead.
    try:
        import time
        current_limit = getattr(request.state, "view_rate_limit", None)
        if current_limit is not None:
            reset_at, _ = limiter.limiter.get_window_stats(current_limit[0], *current_limit[1])
            response.headers["Retry-After"] = str(max(1, int(1 + reset_at - time.time())))
    except Exception:
        pass
    return response
