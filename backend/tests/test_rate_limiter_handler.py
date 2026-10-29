"""Regression tests for app.core.limiter's rate_limit_exceeded_handler.

Root cause this guards against: the handler used to be `async def` and did
`return await _rate_limit_exceeded_handler(...)` — slowapi's own handler is
a plain SYNC function returning a JSONResponse, so awaiting it raised
TypeError *inside* this exception handler, which Starlette has no way to
recover from, producing an unhandled 500 on every legitimate rate-limit
trip, app-wide. See app/core/limiter.py's docstring for the full story.
"""
import time

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

from app.core.limiter import _rate_key, rate_limit_exceeded_handler


def _make_app(limit_value="3/minute", **limiter_kwargs):
    limiter = Limiter(key_func=limiter_kwargs.pop("key_func", _rate_key), **limiter_kwargs)
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

    @app.get("/t")
    @limiter.limit(limit_value)
    async def t(request: Request):
        # Plain dict, matching every real route in this codebase — NOT a
        # Starlette Response. This is exactly the shape that breaks if
        # headers_enabled=True is ever turned back on at the Limiter level.
        return {"ok": True}

    return app, limiter


def test_within_limit_returns_200_with_plain_dict_route():
    app, _ = _make_app("3/minute", storage_uri="memory://")
    client = TestClient(app, raise_server_exceptions=True)
    for _ in range(3):
        r = client.get("/t")
        assert r.status_code == 200
        assert r.json() == {"ok": True}


def test_exceeding_limit_returns_429_not_500():
    app, _ = _make_app("3/minute", storage_uri="memory://")
    client = TestClient(app, raise_server_exceptions=True)
    for _ in range(3):
        assert client.get("/t").status_code == 200
    r = client.get("/t")
    assert r.status_code == 429
    assert "error" in r.json()


def test_429_response_includes_retry_after():
    app, _ = _make_app("3/minute", storage_uri="memory://")
    client = TestClient(app, raise_server_exceptions=True)
    for _ in range(3):
        client.get("/t")
    r = client.get("/t")
    assert r.status_code == 429
    retry_after = r.headers.get("retry-after")
    assert retry_after is not None
    assert 0 < int(retry_after) <= 60


def test_success_path_has_no_retry_after_header():
    """Guards the specific regression risk of re-enabling headers_enabled=True
    at the Limiter level: that breaks every successful (under-limit) request
    to any of this app's ~50 dict-returning routes with a 500, since
    slowapi's header injection then runs on the raw endpoint return value
    before FastAPI serializes it. This test just pins today's safe behavior."""
    app, _ = _make_app("3/minute", storage_uri="memory://")
    client = TestClient(app, raise_server_exceptions=True)
    r = client.get("/t")
    assert r.status_code == 200
    assert r.headers.get("retry-after") is None


def test_recovery_after_window_expires():
    app, _ = _make_app("2/second", storage_uri="memory://")
    client = TestClient(app, raise_server_exceptions=True)
    assert client.get("/t").status_code == 200
    assert client.get("/t").status_code == 200
    assert client.get("/t").status_code == 429
    time.sleep(1.1)
    assert client.get("/t").status_code == 200


def test_different_keys_are_isolated():
    """Two different callers (two different rate-limit keys) must not share
    a bucket — confirms per-user/session isolation, not a global counter."""

    def key_from_header(request: Request) -> str:
        return request.headers.get("x-test-user", "anon")

    app, _ = _make_app("1/minute", storage_uri="memory://", key_func=key_from_header)
    client = TestClient(app, raise_server_exceptions=True)
    # Each of these 2 distinct keys sees exactly 1 request — neither should
    # see the other's hit against its own 1/minute bucket.
    r1 = client.get("/t", headers={"x-test-user": "alice"})
    r2 = client.get("/t", headers={"x-test-user": "bob"})
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    # A second hit from the SAME key, though, must now be limited.
    r3 = client.get("/t", headers={"x-test-user": "alice"})
    assert r3.status_code == 429


def test_concurrent_requests_eventually_rate_limit():
    app, _ = _make_app("5/minute", storage_uri="memory://")
    client = TestClient(app, raise_server_exceptions=True)
    results = [client.get("/t").status_code for _ in range(8)]
    assert results.count(200) == 5
    assert results.count(429) == 3


def test_storage_unreachable_falls_back_instead_of_500():
    """Redis (or whatever storage_uri points to) being unreachable must not
    turn into an unhandled 500 on every request — confirms the in-memory
    fallback configured on `limiter` (app/core/limiter.py) actually degrades
    gracefully instead of crashing."""
    app, _ = _make_app(
        "3/minute",
        storage_uri="redis://localhost:1/0",  # deliberately unreachable
        in_memory_fallback_enabled=True,
        in_memory_fallback=["200/minute"],
    )
    client = TestClient(app, raise_server_exceptions=True)
    for _ in range(6):
        r = client.get("/t")
        assert r.status_code == 200, f"expected graceful fallback, got {r.status_code}: {r.text}"


def test_storage_unreachable_without_fallback_still_fails_loud_not_silent():
    """Sanity check on the OLD behavior (fallback disabled): confirms this is
    a real, distinct failure mode from the awaited-handler bug — this one
    raises before `rate_limit_exceeded_handler` is ever reached, so it's
    out of scope for this hotfix, but pinning it here documents the
    remaining known gap explicitly rather than silently."""
    app, _ = _make_app("3/minute", storage_uri="redis://localhost:1/0")
    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/t")
    assert r.status_code == 500  # known remaining gap, not claimed as fixed


def test_handler_is_scoped_to_rate_limit_exceeded_not_a_catch_all():
    """A different exception type raised inside the endpoint must NOT be
    turned into a 429 by this handler — it's only registered for
    RateLimitExceeded, never a blanket except-all."""
    limiter = Limiter(key_func=_rate_key, storage_uri="memory://")
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

    @app.get("/boom")
    async def boom(request: Request):
        raise ValueError("not a rate limit problem")

    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/boom")
    assert r.status_code == 500  # unrelated error, correctly NOT a 429


def test_logs_security_event_on_trip(monkeypatch):
    logged = {}

    def fake_log(event_type, **kwargs):
        logged["event_type"] = event_type
        logged.update(kwargs)

    import app.core.security as security_mod
    monkeypatch.setattr(security_mod, "log_security_event", fake_log)

    app, _ = _make_app("1/minute", storage_uri="memory://")
    client = TestClient(app, raise_server_exceptions=True)
    client.get("/t")
    r = client.get("/t")
    assert r.status_code == 429
    assert logged.get("event_type") == "rate_limit_exceeded"
