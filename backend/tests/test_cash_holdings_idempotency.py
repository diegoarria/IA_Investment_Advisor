"""
POST /api/cash-holdings idempotency (migrations/113) — a client-provided
client_id makes a retried add a no-op instead of a duplicate row.
"""
import asyncio

import app.api.routes.cash_holdings as ch


def _run(coro):
    return asyncio.run(coro)


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, db, mode, payload=None, on_conflict=None):
        self.db = db
        self.mode = mode
        self.payload = payload
        self.on_conflict = on_conflict

    def execute(self):
        if self.mode == "upsert":
            key = (self.payload["user_id"], self.payload.get("client_id"))
            existing = self.db.rows_by_key.get(key)
            if existing:
                existing.update({k: v for k, v in self.payload.items() if k != "id"})
                return _FakeResult([existing])
            row = {**self.payload, "id": f"row-{len(self.db.rows) + 1}"}
            self.db.rows.append(row)
            self.db.rows_by_key[key] = row
            return _FakeResult([row])
        if self.mode == "insert":
            row = {**self.payload, "id": f"row-{len(self.db.rows) + 1}"}
            self.db.rows.append(row)
            return _FakeResult([row])
        raise AssertionError(f"unexpected mode {self.mode}")


class _FakeTable:
    def __init__(self, db):
        self.db = db

    def upsert(self, payload, on_conflict=None):
        return _FakeQuery(self.db, "upsert", payload, on_conflict)

    def insert(self, payload):
        return _FakeQuery(self.db, "insert", payload)


class _FakeDB:
    def __init__(self):
        self.rows: list[dict] = []
        self.rows_by_key: dict = {}

    def table(self, name):
        assert name == "cash_holdings"
        return _FakeTable(self)


async def _fake_with_usd(holdings):
    for h in holdings:
        h["accrued_amount"] = h["amount"]
        h["amount_usd"] = h["amount"] if (h.get("currency") or "USD").upper() == "USD" else None
    return holdings


def test_repeated_add_with_same_client_id_does_not_duplicate(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(ch, "get_supabase", lambda: db)
    monkeypatch.setattr(ch, "_with_usd", _fake_with_usd)
    monkeypatch.setattr(ch, "_auto_rate_for_instrument", lambda instrument: _none())

    body = {"amount": 500.0, "instrument": "other", "currency": "USD", "client_id": "retry-key-1"}

    first = _run(ch.add_cash_holding(dict(body), user_id="u1"))
    second = _run(ch.add_cash_holding(dict(body), user_id="u1"))  # simulates the exact retry

    assert len(db.rows) == 1, "a retried add with the same client_id must not create a second row"
    assert first["holding"]["id"] == second["holding"]["id"]


def test_add_without_client_id_still_works_unidempotent(monkeypatch):
    # Older clients (no client_id) keep today's plain-insert behavior —
    # this fix must not require a client_id to function.
    db = _FakeDB()
    monkeypatch.setattr(ch, "get_supabase", lambda: db)
    monkeypatch.setattr(ch, "_with_usd", _fake_with_usd)
    monkeypatch.setattr(ch, "_auto_rate_for_instrument", lambda instrument: _none())

    body = {"amount": 50.0, "instrument": "bank", "currency": "USD"}
    out = _run(ch.add_cash_holding(dict(body), user_id="u1"))
    assert out["holding"]["amount"] == 50.0
    assert len(db.rows) == 1


def test_different_client_ids_create_separate_rows(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(ch, "get_supabase", lambda: db)
    monkeypatch.setattr(ch, "_with_usd", _fake_with_usd)
    monkeypatch.setattr(ch, "_auto_rate_for_instrument", lambda instrument: _none())

    _run(ch.add_cash_holding({"amount": 100.0, "instrument": "other", "currency": "USD", "client_id": "a"}, user_id="u1"))
    _run(ch.add_cash_holding({"amount": 200.0, "instrument": "other", "currency": "USD", "client_id": "b"}, user_id="u1"))

    assert len(db.rows) == 2, "two genuinely separate adds (different client_id) must both persist"


async def _none():
    return None
