"""
Diego, 2026-10-02: "deja la sesión iniciada siempre". Only a token Supabase
actually REJECTS may end a session (401). A network blip / Supabase hiccup
must be a 503, which both clients treat as "keep the session, retry later".
"""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from gotrue.errors import AuthApiError, AuthRetryableError

import app.api.deps as deps
import app.api.routes.auth as auth_routes


def _request(cookies=None):
    return SimpleNamespace(cookies=cookies or {}, client=SimpleNamespace(host="1.2.3.4"), headers={}, state=SimpleNamespace())


def _call_refresh(monkeypatch, behaviour):
    calls = {"n": 0}

    def refresh_session(_token):
        calls["n"] += 1
        return behaviour(calls["n"])

    client = SimpleNamespace(auth=SimpleNamespace(refresh_session=refresh_session))
    monkeypatch.setattr(auth_routes, "get_auth_session_client", lambda: client)
    fn = getattr(auth_routes.refresh_token, "__wrapped__", auth_routes.refresh_token)
    resp = Response()
    try:
        out = asyncio.run(fn(_request(), resp, {"refresh_token": "rt"}))
        return out, None, calls["n"]
    except HTTPException as e:
        return None, e, calls["n"]


def test_refresh_transient_failure_is_503_not_logout(monkeypatch):
    def boom(_n):
        raise AuthRetryableError("connection reset", 0)
    _, err, calls = _call_refresh(monkeypatch, boom)
    assert err.status_code == 503
    assert calls == 2  # retried once inside the request


def test_refresh_recovers_on_retry(monkeypatch):
    session = SimpleNamespace(access_token="at2", refresh_token="rt2")

    def flaky(n):
        if n == 1:
            raise TimeoutError("slow")
        return SimpleNamespace(session=session)
    out, err, _ = _call_refresh(monkeypatch, flaky)
    assert err is None and out == {"access_token": "at2", "refresh_token": "rt2"}


def test_refresh_really_invalid_is_401(monkeypatch):
    def rejected(_n):
        raise AuthApiError("Refresh token is not valid", 400, "refresh_token_not_found")
    _, err, calls = _call_refresh(monkeypatch, rejected)
    assert err.status_code == 401
    assert calls == 1  # never retried — the server answered


def test_token_check_transient_failure_is_503(monkeypatch):
    def get_user(_t):
        raise AuthRetryableError("timeout", 0)
    monkeypatch.setattr(deps, "get_supabase", lambda: SimpleNamespace(auth=SimpleNamespace(get_user=get_user)))
    monkeypatch.setattr(deps, "cache_get", lambda _k: None)
    with pytest.raises(HTTPException) as e:
        asyncio.run(deps._resolve_user_token("some-token-transient"))
    assert e.value.status_code == 503


def test_token_check_rejected_is_401(monkeypatch):
    def get_user(_t):
        raise AuthApiError("invalid JWT", 401, "bad_jwt")
    monkeypatch.setattr(deps, "get_supabase", lambda: SimpleNamespace(auth=SimpleNamespace(get_user=get_user)))
    monkeypatch.setattr(deps, "cache_get", lambda _k: None)
    with pytest.raises(HTTPException) as e:
        asyncio.run(deps._resolve_user_token("some-token-rejected"))
    assert e.value.status_code == 401
