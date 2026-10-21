"""
job_market_close — 2026-10-21: confirmed live that a transient Finnhub
blip at exactly 4:05pm ET made both index quotes AND the batch portfolio-
price fetch come back empty, producing a push that read "S&P 500 s/d ·
Nasdaq s/d" instead of the real personalized "hoy ganaste $X". Fixed with
one retry for each fetch, and — if the retry still comes up empty — no
longer sending a no-data placeholder push at all.
"""
from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

import worker


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Chainable no-op stand-in for a Supabase query builder — covers both
    method-call chaining (.select(...).eq(...)) and property-style chaining
    (.not_.is_(...)) by making every attribute access AND every call
    return the same object."""
    def __init__(self, data):
        self._data = data

    def __getattr__(self, _name):
        return self

    def __call__(self, *a, **k):
        return self

    def execute(self):
        return _FakeResult(self._data)


class _FakeDB:
    """Returns canned rows by table name, ignoring the real filter chain —
    enough to drive job_market_close's own logic for real, without
    reimplementing Supabase's query semantics."""

    def __init__(self, tables: dict[str, list]):
        self.tables = tables

    def table(self, name):
        return _FakeQuery(self.tables.get(name, []))


def _base_tables(uid="u1"):
    return {
        "user_portfolio": [{"user_id": uid, "positions": {"positions": [{"ticker": "AAPL", "shares": 10}], "currency": "USD"}}],
        "notification_preferences": [],
        "user_profiles": [{"user_id": uid, "push_token": "ExponentPushToken[xxx]", "name": "Diego", "subscription_tier": "premium", "trial_started_at": None, "preferred_language": "es", "streak_bonus_premium_until": None}],
        "web_push_subscriptions": [],
    }


@pytest.fixture(autouse=True)
def _market_open(monkeypatch):
    monkeypatch.setattr(worker, "_is_market_open_today", lambda: True)
    monkeypatch.setattr(worker, "_is_early_close_today", lambda: False)
    import pytz
    monkeypatch.setattr(worker, "datetime", MagicMock(now=lambda tz=None: datetime(2026, 10, 20, 16, 5, tzinfo=pytz.timezone("America/New_York"))))


@pytest.mark.asyncio
async def test_retry_recovers_from_a_transient_blip_and_sends_the_real_personalized_push(monkeypatch):
    db = _FakeDB(_base_tables())
    import app.core.database as dbmod
    monkeypatch.setattr(dbmod, "get_supabase", lambda: db)

    # First attempt: both indices AND the price batch fail. Second
    # attempt (the retry): real data.
    quote_calls = {"n": 0}
    def fake_quote(symbol):
        quote_calls["n"] += 1
        if quote_calls["n"] <= 2:
            return None  # first SPY, first QQQ both fail
        return {"curr": 100.0, "prev": 95.0, "pct": 5.26}
    monkeypatch.setattr(worker, "_finnhub_quote", fake_quote)

    batch_calls = {"n": 0}
    async def fake_batch(tickers):
        batch_calls["n"] += 1
        if batch_calls["n"] == 1:
            return {}  # first attempt: empty
        return {"AAPL": {"curr": 110.0, "prev": 100.0}}  # retry: real
    monkeypatch.setattr(worker, "_finnhub_prices_batch", fake_batch)

    sent = []
    async def fake_send_push(uid, kind, title, body, data, db):
        sent.append((uid, title, body))
    import app.services.notification_engine as ne
    monkeypatch.setattr(ne, "send_push", fake_send_push)

    await worker.job_market_close()

    assert batch_calls["n"] == 2, "the price batch must have been retried once"
    assert len(sent) == 1
    uid, title, body = sent[0]
    assert "ganaste" in title or "perdiste" in title, f"expected the real personalized push, got: {title!r}"
    assert "s/d" not in body


@pytest.mark.asyncio
async def test_still_no_data_after_retry_skips_the_push_entirely(monkeypatch):
    db = _FakeDB(_base_tables())
    import app.core.database as dbmod
    monkeypatch.setattr(dbmod, "get_supabase", lambda: db)

    monkeypatch.setattr(worker, "_finnhub_quote", lambda symbol: None)  # always fails
    async def always_empty(tickers):
        return {}
    monkeypatch.setattr(worker, "_finnhub_prices_batch", always_empty)

    sent = []
    async def fake_send_push(uid, kind, title, body, data, db):
        sent.append((uid, title, body))
    import app.services.notification_engine as ne
    monkeypatch.setattr(ne, "send_push", fake_send_push)

    await worker.job_market_close()

    assert sent == [], "no real data anywhere (own prices + both indices) must mean NO push, never a s/d placeholder"
