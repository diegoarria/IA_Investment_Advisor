"""Arthur's natural-language portfolio transaction feature.

Covers the propose -> confirm flow end to end (BUY, SELL/FIFO, realized
P/L), plus the safety cases that matter most for money-moving code:
insufficient shares never silently clamped, duplicate proposals never
double-applied, a cancel never touches the portfolio, and a missing/stale
pending_id never fabricates a false success.

Uses an in-memory fake Supabase client instead of a real DB — this suite
only exercises the pure Python logic (ai_service._propose_portfolio_
transaction / _confirm_pending_financial_action, sync.apply_portfolio_
positions / add_buy_lot / apply_sell_fifo), never real network/DB I/O.
"""
import uuid
from unittest.mock import AsyncMock

import pytest

from app.services import ai_service
import app.api.routes.sync as sync_module


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, store: dict, table_name: str):
        self._store = store
        self._table_name = table_name
        self._op = None
        self._payload = None
        self._filters: dict = {}

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def insert(self, payload):
        self._op, self._payload = "insert", dict(payload)
        return self

    def update(self, payload):
        self._op, self._payload = "update", dict(payload)
        return self

    def upsert(self, payload, on_conflict=None):
        self._op, self._payload = "upsert", dict(payload)
        return self

    async def execute(self):
        table = self._store.setdefault(self._table_name, {})
        if self._op == "insert":
            row = dict(self._payload)
            row.setdefault("id", str(uuid.uuid4()))
            table[row["id"]] = row
            return _FakeResult([row])
        if self._op == "update":
            matched = []
            for row in table.values():
                if all(row.get(k) == v for k, v in self._filters.items()):
                    row.update(self._payload)
                    matched.append(row)
            return _FakeResult(matched)
        if self._op == "upsert":
            key = (self._payload.get("user_id"), self._payload.get("portfolio_id", "default"))
            table[key] = dict(self._payload)
            return _FakeResult([self._payload])
        rows = [row for row in table.values() if all(row.get(k) == v for k, v in self._filters.items())]
        return _FakeResult(rows)


class _FakeTable:
    def __init__(self, store, name):
        self._store, self._name = store, name

    def select(self, *a, **k):
        return _FakeQuery(self._store, self._name).select(*a, **k)

    def insert(self, payload):
        return _FakeQuery(self._store, self._name).insert(payload)

    def update(self, payload):
        return _FakeQuery(self._store, self._name).update(payload)

    def upsert(self, payload, on_conflict=None):
        return _FakeQuery(self._store, self._name).upsert(payload, on_conflict)


class _FakeDB:
    def __init__(self, store):
        self._store = store

    def table(self, name):
        return _FakeTable(self._store, name)


@pytest.fixture
def fake_db(monkeypatch):
    """Patches get_supabase/run_query everywhere this feature touches them,
    and seeds one GOOGL lot matching the product spec's own worked example
    (0.5147 shares @ $272 avg cost)."""
    store: dict = {"user_portfolio": {}, "pending_financial_actions": {}}
    db = _FakeDB(store)

    async def fake_run_query(query):
        return await query.execute()

    for mod in (ai_service, sync_module):
        monkeypatch.setattr(mod, "get_supabase", lambda: db)
        monkeypatch.setattr(mod, "run_query", fake_run_query)
    monkeypatch.setattr(sync_module, "cache_delete", lambda *_a, **_k: None)
    monkeypatch.setattr(sync_module.fmg_service, "log_event", AsyncMock())

    store["user_portfolio"][("u1", "default")] = {
        "user_id": "u1", "portfolio_id": "default", "portfolio_name": "Mi portafolio",
        "positions": {
            "_v": 3, "currency": "USD",
            "positions": [{"ticker": "GOOGL", "shares": 0.5147, "avgPrice": 272.0, "purchaseDate": "2026-01-01"}],
            "closed_positions": [], "inception_date": "2026-01-01",
        },
        "updated_at": "2026-09-18T00:00:00+00:00",
    }
    return store


def _pending_id(propose_text: str) -> str:
    return propose_text.split("PENDING_ID: ")[1].split("\n")[0]


async def test_buy_propose_matches_spec_worked_example(fake_db):
    """§15 of the spec: $200 more of GOOGL at $340 against an existing
    0.5147 sh @ $272 lot must land on ~1.10294 shares / ~$308.27 avg cost."""
    result = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 200, "execution_price": 340,
        "raw_message": "Compré $200 más de Google a $340.",
    }, user_id="u1")
    assert "1.1029" in result
    assert "308.27" in result
    # Nothing written yet — propose never mutates the real portfolio.
    row = fake_db["user_portfolio"][("u1", "default")]
    assert len(row["positions"]["positions"]) == 1


async def test_buy_confirm_applies_and_matches_math(fake_db):
    propose = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 200, "execution_price": 340,
        "raw_message": "Compré $200 más de Google a $340.",
    }, user_id="u1")
    pending_id = _pending_id(propose)

    confirm = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" in confirm
    assert "1.1029" in confirm
    assert "308.27" in confirm

    positions = fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"]
    assert len(positions) == 2  # BUY appends a new lot, never merges
    assert positions[1]["ticker"] == "GOOGL"
    assert positions[1]["avgPrice"] == 340.0

    pending_row = next(iter(fake_db["pending_financial_actions"].values()))
    assert pending_row["status"] == "applied"


async def test_missing_date_defaults_to_today_and_flags_the_assumption(fake_db):
    """Date is optional and never blocks the proposal — but when it was
    defaulted (not given), the summary must say so explicitly so Arthur
    can mention it, rather than silently guessing without telling anyone."""
    result = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 200, "execution_price": 340,
        "raw_message": "Compré $200 más de Google a $340.",
    }, user_id="u1")
    assert "PENDING_ID" in result
    assert "asumí que fue HOY" in result


async def test_explicit_date_is_used_without_any_assumption_note(fake_db):
    result = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 200, "execution_price": 340,
        "transaction_date": "2026-09-10", "raw_message": "Ayer compré $200 más de Google a $340.",
    }, user_id="u1")
    assert "2026-09-10" in result
    assert "asumí" not in result


async def test_sell_more_than_held_is_refused_before_creating_pending(fake_db):
    """§23: never silently clamp or create a negative position."""
    result = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "SELL_ASSET", "ticker": "GOOGL", "quantity": 10, "execution_price": 350,
        "raw_message": "Vendí 10 acciones de GOOGL a $350",
    }, user_id="u1")
    assert "0.5147" in result  # the real held amount, stated honestly
    assert "PENDING_ID" not in result
    assert fake_db["pending_financial_actions"] == {}


async def test_sell_fifo_realized_pl_and_remaining_shares(fake_db):
    # Add a second, cheaper lot so FIFO has two lots to work through.
    fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"].append(
        {"ticker": "GOOGL", "shares": 1.0, "avgPrice": 300.0, "purchaseDate": "2026-06-01"}
    )
    propose = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "SELL_ASSET", "ticker": "GOOGL", "quantity": 1.0, "execution_price": 350,
        "raw_message": "Vendí 1 acción de GOOGL a $350",
    }, user_id="u1")
    pending_id = _pending_id(propose)

    confirm = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" in confirm

    parsed = fake_db["user_portfolio"][("u1", "default")]["positions"]
    # FIFO: consumes the whole 0.5147 oldest lot, then 0.4853 of the newer one.
    remaining = [p for p in parsed["positions"] if p["ticker"] == "GOOGL"]
    assert len(remaining) == 1
    assert remaining[0]["avgPrice"] == 300.0
    assert pytest.approx(remaining[0]["shares"], abs=1e-4) == 0.5147
    assert len(parsed["closed_positions"]) == 2


async def test_duplicate_propose_before_confirm_reuses_same_pending_id(fake_db):
    """§18 idempotency: the same reported transaction, proposed twice before
    confirmation, must not spawn two separate pending proposals."""
    args = {
        "action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 100, "execution_price": 300,
        "raw_message": "Compré $100 más de GOOGL a $300",
    }
    r1 = await ai_service._exec_mentor_tool("propose_portfolio_transaction", args, user_id="u1")
    r2 = await ai_service._exec_mentor_tool("propose_portfolio_transaction", args, user_id="u1")
    assert _pending_id(r1) == _pending_id(r2)
    assert len(fake_db["pending_financial_actions"]) == 1


async def test_cancel_never_touches_the_portfolio(fake_db):
    propose = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 200, "execution_price": 340,
        "raw_message": "Compré $200 más de Google a $340.",
    }, user_id="u1")
    pending_id = _pending_id(propose)

    cancel = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": False,
    }, user_id="u1")
    assert "Cancelado" in cancel

    positions = fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"]
    assert len(positions) == 1  # unchanged
    assert fake_db["pending_financial_actions"][pending_id]["status"] == "cancelled"


async def test_confirm_with_unknown_pending_id_never_fabricates_success(fake_db):
    """§22: a failed/missing lookup must never say 'listo'."""
    result = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": "does-not-exist", "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" not in result
    assert "no encontré" in result.lower() or "no encontre" in result.lower()


async def test_missing_execution_price_never_invents_market_price(fake_db):
    result = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 200,
        "raw_message": "Compré otros $200 de Google.",
    }, user_id="u1")
    assert "PENDING_ID" not in result
    assert fake_db["pending_financial_actions"] == {}


async def test_currency_mismatch_asks_instead_of_converting(fake_db):
    """§26: never silently convert currencies."""
    result = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 200, "execution_price": 340,
        "currency": "MXN", "raw_message": "Compré 200 pesos de Google a 340.",
    }, user_id="u1")
    assert "PENDING_ID" not in result
    assert "MXN" in result and "USD" in result


async def test_db_write_failure_never_reports_false_success(fake_db, monkeypatch):
    """§22: if apply_portfolio_positions blows up, the user must be told
    the portfolio was NOT modified — never a false 'listo'."""
    propose = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 200, "execution_price": 340,
        "raw_message": "Compré $200 más de Google a $340.",
    }, user_id="u1")
    pending_id = _pending_id(propose)

    async def boom(*_a, **_k):
        raise RuntimeError("simulated DB outage")
    monkeypatch.setattr(sync_module, "apply_portfolio_positions", boom)

    confirm = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" not in confirm
    assert "no fue modificad" in confirm.lower() or "no pude actualizar" in confirm.lower()
