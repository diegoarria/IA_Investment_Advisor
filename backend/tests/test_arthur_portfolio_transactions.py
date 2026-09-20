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


async def test_sell_fifo_handles_snake_case_avg_price_from_screenshot_import(fake_db):
    """Bug found in audit: the screenshot-import feature (market.py) writes
    cost basis as snake_case "avg_price", not "avgPrice". Selling that lot
    must use its REAL cost, not silently treat it as a $0 cost basis (which
    would fabricate a huge fake gain and corrupt closed_positions forever)."""
    fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"] = [
        {"ticker": "GOOGL", "shares": 2.0, "avg_price": 250.0, "purchaseDate": "2026-02-01"},
    ]
    propose = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "SELL_ASSET", "ticker": "GOOGL", "quantity": 2.0, "execution_price": 300,
        "raw_message": "Vendí 2 acciones de GOOGL a $300",
    }, user_id="u1")
    pending_id = _pending_id(propose)

    confirm = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" in confirm
    # Real gain: 2 * (300 - 250) = 100 — NOT 2*300=600 (which is what a $0
    # cost-basis bug would have produced).
    assert "100.00" in confirm

    closed = fake_db["user_portfolio"][("u1", "default")]["positions"]["closed_positions"]
    assert closed[0]["avgPrice"] == 250.0


async def test_abandoned_expired_proposal_does_not_block_a_fresh_one(fake_db):
    """Bug found in audit: dedup only checked status='pending', so an
    abandoned proposal past its TTL kept being handed back as if it were
    still valid, instead of transparently starting a fresh one."""
    args = {
        "action_type": "BUY_ASSET", "ticker": "GOOGL", "amount": 100, "execution_price": 300,
        "raw_message": "Compré $100 más de GOOGL a $300",
    }
    first = await ai_service._exec_mentor_tool("propose_portfolio_transaction", args, user_id="u1")
    first_id = _pending_id(first)
    # Simulate the proposal going stale (abandoned past its TTL) without
    # anyone ever confirming or cancelling it.
    from datetime import datetime, timedelta, timezone
    fake_db["pending_financial_actions"][first_id]["expires_at"] = (
        datetime.now(timezone.utc) - timedelta(minutes=1)
    ).isoformat()

    second = await ai_service._exec_mentor_tool("propose_portfolio_transaction", args, user_id="u1")
    second_id = _pending_id(second)

    assert second_id != first_id
    assert fake_db["pending_financial_actions"][first_id]["status"] == "expired"
    assert fake_db["pending_financial_actions"][second_id]["status"] == "pending"


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

    # Bug found in audit: the propose preview used a blended weighted-average
    # cost while apply used real per-lot FIFO cost, so they could disagree
    # whenever a ticker holds lots at different prices. Both must now match
    # exactly (real FIFO result: 0.5147@272 fully consumed + 0.4853@300
    # partially consumed -> 0.5147*(350-272) + 0.4853*(350-300) = 64.41).
    assert "64.41" in propose

    confirm = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" in confirm
    assert "64.41" in confirm

    parsed = fake_db["user_portfolio"][("u1", "default")]["positions"]
    # FIFO: consumes the whole 0.5147 oldest lot, then 0.4853 of the newer one.
    remaining = [p for p in parsed["positions"] if p["ticker"] == "GOOGL"]
    assert len(remaining) == 1
    assert remaining[0]["avgPrice"] == 300.0
    assert pytest.approx(remaining[0]["shares"], abs=1e-4) == 0.5147
    assert len(parsed["closed_positions"]) == 2


async def test_sell_entire_single_lot_position_closes_it_completely(fake_db):
    """A 100% sell of a single-lot position must remove the ticker from
    positions entirely — not leave a dangling zero-share lot."""
    propose = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "SELL_ASSET", "ticker": "GOOGL", "quantity": 0.5147, "execution_price": 350,
        "raw_message": "Vendí toda mi posición de GOOGL a $350",
    }, user_id="u1")
    pending_id = _pending_id(propose)

    confirm = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" in confirm

    parsed = fake_db["user_portfolio"][("u1", "default")]["positions"]
    assert [p for p in parsed["positions"] if p["ticker"] == "GOOGL"] == []
    assert len(parsed["closed_positions"]) == 1
    assert parsed["closed_positions"][0]["shares"] == pytest.approx(0.5147, abs=1e-4)


async def test_sell_entire_multi_lot_position_closes_all_lots(fake_db):
    """A 100% sell spanning multiple lots must consume and close every one
    of them, not just the first lot FIFO reaches."""
    fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"].append(
        {"ticker": "GOOGL", "shares": 1.0, "avgPrice": 300.0, "purchaseDate": "2026-06-01"}
    )
    total_shares = 0.5147 + 1.0
    propose = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "SELL_ASSET", "ticker": "GOOGL", "quantity": total_shares, "execution_price": 350,
        "raw_message": "Vendí todas mis acciones de GOOGL a $350",
    }, user_id="u1")
    pending_id = _pending_id(propose)
    assert "PENDING_ID" in propose  # exactly the total held, must not be refused

    confirm = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" in confirm

    parsed = fake_db["user_portfolio"][("u1", "default")]["positions"]
    assert [p for p in parsed["positions"] if p["ticker"] == "GOOGL"] == []
    assert len(parsed["closed_positions"]) == 2
    closed_total = sum(c["shares"] for c in parsed["closed_positions"])
    assert closed_total == pytest.approx(total_shares, abs=1e-4)


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


# ──────────────────────────────────────────────────────────────
# get_portfolio_transactions / update_portfolio_transaction /
# delete_portfolio_transaction — the natural-language correction/deletion
# capability layered on top of the BUY/SELL flow above. Same propose->confirm
# pattern, same fake DB fixture, same "never fabricate success" discipline.
# ──────────────────────────────────────────────────────────────

async def test_get_portfolio_transactions_lists_lots_and_flags_uncorrectable_ones(fake_db):
    """The seeded GOOGL lot predates this feature (no `id`) — it must still
    show up so the user isn't confused about where it went, but flagged as
    not correctable/deletable rather than silently given a fake id."""
    result = await ai_service._exec_mentor_tool("get_portfolio_transactions", {}, user_id="u1")
    assert "GOOGL" in result
    assert "sin-id" in result  # the seeded lot has no id — must say so, never invent one


async def test_get_portfolio_transactions_new_lot_has_a_real_correctable_id(fake_db):
    propose = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "NVDA", "quantity": 10, "execution_price": 178.50,
        "raw_message": "Acabo de comprar 10 NVDA a 178.50",
    }, user_id="u1")
    pending_id = _pending_id(propose)
    await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": True,
    }, user_id="u1")

    result = await ai_service._exec_mentor_tool("get_portfolio_transactions", {"ticker": "NVDA"}, user_id="u1")
    assert "NVDA" in result
    assert "sin-id" not in result
    lot = fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"][-1]
    assert lot["id"] in result


async def test_update_transaction_without_id_asks_instead_of_guessing(fake_db):
    result = await ai_service._exec_mentor_tool("update_portfolio_transaction", {
        "shares": 15,
    }, user_id="u1")
    assert "PENDING_ID" not in result
    assert "id" in result.lower()


async def test_update_transaction_unknown_id_never_fabricates_success(fake_db):
    """§ security: a transaction_id that doesn't exist in this user's own
    portfolio (typo'd, stale, or someone else's) must be refused, not
    silently applied to whatever it happens to match."""
    result = await ai_service._exec_mentor_tool("update_portfolio_transaction", {
        "transaction_id": "does-not-exist", "shares": 15,
    }, user_id="u1")
    assert "PENDING_ID" not in result
    assert "no encontré" in result.lower()


async def test_update_transaction_corrects_shares_end_to_end(fake_db):
    """Spec example: 'me equivoqué, compré 15 NVDA no 10'."""
    propose_buy = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "NVDA", "quantity": 10, "execution_price": 178.50,
        "raw_message": "Acabo de comprar 10 NVDA a 178.50",
    }, user_id="u1")
    await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": _pending_id(propose_buy), "confirmed": True,
    }, user_id="u1")
    lot_id = fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"][-1]["id"]

    propose_fix = await ai_service._exec_mentor_tool("update_portfolio_transaction", {
        "transaction_id": lot_id, "shares": 15,
        "raw_message": "Me equivoqué, compré 15 NVDA no 10.",
    }, user_id="u1")
    assert "PENDING_ID" in propose_fix
    assert "15" in propose_fix

    confirm_fix = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": _pending_id(propose_fix), "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" in confirm_fix

    lot = next(p for p in fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"] if p.get("id") == lot_id)
    assert lot["shares"] == 15
    assert lot["avgPrice"] == 178.50  # unchanged — only shares was corrected


async def test_update_transaction_price_only_leaves_shares_untouched(fake_db):
    propose_buy = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "AMZN", "quantity": 5, "execution_price": 225,
        "raw_message": "Compré 5 AMZN a 225",
    }, user_id="u1")
    await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": _pending_id(propose_buy), "confirmed": True,
    }, user_id="u1")
    lot_id = fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"][-1]["id"]

    propose_fix = await ai_service._exec_mentor_tool("update_portfolio_transaction", {
        "transaction_id": lot_id, "price": 230,
        "raw_message": "El precio correcto era 230.",
    }, user_id="u1")
    await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": _pending_id(propose_fix), "confirmed": True,
    }, user_id="u1")

    lot = next(p for p in fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"] if p.get("id") == lot_id)
    assert lot["shares"] == 5
    assert lot["avgPrice"] == 230


async def test_update_transaction_rejects_zero_or_negative_shares(fake_db):
    propose_buy = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "AAPL", "quantity": 5, "execution_price": 220,
        "raw_message": "Compré 5 AAPL a 220",
    }, user_id="u1")
    await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": _pending_id(propose_buy), "confirmed": True,
    }, user_id="u1")
    lot_id = fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"][-1]["id"]

    result = await ai_service._exec_mentor_tool("update_portfolio_transaction", {
        "transaction_id": lot_id, "shares": -5,
    }, user_id="u1")
    assert "PENDING_ID" not in result


async def test_delete_transaction_without_id_asks_instead_of_guessing(fake_db):
    result = await ai_service._exec_mentor_tool("delete_portfolio_transaction", {}, user_id="u1")
    assert "PENDING_ID" not in result
    assert "id" in result.lower()


async def test_delete_transaction_end_to_end_removes_the_lot(fake_db):
    """Spec example: 'borra la compra que acabo de registrar'."""
    propose_buy = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "COST", "quantity": 3, "execution_price": 900,
        "raw_message": "Compré 3 COST a 900",
    }, user_id="u1")
    await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": _pending_id(propose_buy), "confirmed": True,
    }, user_id="u1")
    lot_id = fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"][-1]["id"]
    count_before = len(fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"])

    propose_delete = await ai_service._exec_mentor_tool("delete_portfolio_transaction", {
        "transaction_id": lot_id, "raw_message": "Borra la compra de COST que acabo de registrar.",
    }, user_id="u1")
    assert "PENDING_ID" in propose_delete
    assert "COST" in propose_delete

    confirm_delete = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": _pending_id(propose_delete), "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" in confirm_delete

    positions_after = fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"]
    assert len(positions_after) == count_before - 1
    assert all(p.get("id") != lot_id for p in positions_after)


async def test_delete_transaction_unknown_id_never_fabricates_success(fake_db):
    result = await ai_service._exec_mentor_tool("delete_portfolio_transaction", {
        "transaction_id": "does-not-exist",
    }, user_id="u1")
    assert "PENDING_ID" not in result
    assert "no encontré" in result.lower()


async def test_update_transaction_cannot_target_another_users_lot(fake_db):
    """§ security/IDOR: a real lot id that belongs to a DIFFERENT user must
    never be reachable through user u1's session, even if u1 somehow gets
    hold of that id (e.g. guessed, leaked, or a stale client cache)."""
    fake_db["user_portfolio"][("u2", "default")] = {
        "user_id": "u2", "portfolio_id": "default", "portfolio_name": "Otro portafolio",
        "positions": {
            "_v": 3, "currency": "USD",
            "positions": [{"id": "victim-lot", "ticker": "TSLA", "shares": 1.0, "avgPrice": 200.0, "purchaseDate": "2026-01-01"}],
            "closed_positions": [], "inception_date": "2026-01-01",
        },
        "updated_at": "2026-09-18T00:00:00+00:00",
    }

    result = await ai_service._exec_mentor_tool("update_portfolio_transaction", {
        "transaction_id": "victim-lot", "shares": 999,
    }, user_id="u1")
    assert "PENDING_ID" not in result
    assert "no encontré" in result.lower()

    victim_positions = fake_db["user_portfolio"][("u2", "default")]["positions"]["positions"]
    assert victim_positions[0]["shares"] == 1.0  # untouched


async def test_delete_transaction_double_confirm_is_idempotent(fake_db):
    """§ double execution: confirming the same delete PENDING_ID twice must
    not error out or double-delete — the second confirm just finds no more
    pending row to apply."""
    propose_buy = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "MSFT", "quantity": 2, "execution_price": 400,
        "raw_message": "Compré 2 MSFT a 400",
    }, user_id="u1")
    await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": _pending_id(propose_buy), "confirmed": True,
    }, user_id="u1")
    lot_id = fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"][-1]["id"]

    propose_delete = await ai_service._exec_mentor_tool("delete_portfolio_transaction", {
        "transaction_id": lot_id,
    }, user_id="u1")
    pending_id = _pending_id(propose_delete)

    first = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" in first

    second = await ai_service._exec_mentor_tool("confirm_pending_financial_action", {
        "pending_id": pending_id, "confirmed": True,
    }, user_id="u1")
    assert "Aplicado" not in second
    assert "no encontré" in second.lower()


async def test_concurrent_double_confirm_applies_exactly_once(fake_db, monkeypatch):
    """Real race: two confirms of the SAME pending action (double-tap, client
    retry) both read status='pending' before either writes. The atomic claim
    (pending -> applying compare-and-swap) must let exactly one through."""
    import asyncio

    propose = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "MSFT", "quantity": 2, "execution_price": 400,
        "raw_message": "Compré 2 MSFT a 400",
    }, user_id="u1")
    pending_id = _pending_id(propose)

    # Force interleaving: yield to the loop on every DB call so both confirms
    # complete their reads before either one reaches its write.
    original = ai_service.run_query

    async def yielding_run_query(query):
        await asyncio.sleep(0)
        return await original(query)

    monkeypatch.setattr(ai_service, "run_query", yielding_run_query)
    monkeypatch.setattr(sync_module, "run_query", yielding_run_query)

    results = await asyncio.gather(*(
        ai_service._exec_mentor_tool(
            "confirm_pending_financial_action", {"pending_id": pending_id, "confirmed": True}, user_id="u1",
        )
        for _ in range(3)
    ))
    applied = [r for r in results if r.startswith("Aplicado.")]
    assert len(applied) == 1, results
    msft_lots = [
        p for p in fake_db["user_portfolio"][("u1", "default")]["positions"]["positions"]
        if p["ticker"] == "MSFT"
    ]
    assert len(msft_lots) == 1


async def test_failed_write_releases_the_claim_so_a_retry_can_succeed(fake_db, monkeypatch):
    propose = await ai_service._exec_mentor_tool("propose_portfolio_transaction", {
        "action_type": "BUY_ASSET", "ticker": "MSFT", "quantity": 2, "execution_price": 400,
        "raw_message": "Compré 2 MSFT a 400",
    }, user_id="u1")
    pending_id = _pending_id(propose)

    real_apply = sync_module.apply_portfolio_positions

    async def failing(*a, **k):
        raise RuntimeError("supabase blip")

    monkeypatch.setattr(sync_module, "apply_portfolio_positions", failing)
    first = await ai_service._exec_mentor_tool(
        "confirm_pending_financial_action", {"pending_id": pending_id, "confirmed": True}, user_id="u1")
    assert "NO fue modificado" in first
    row = next(iter(fake_db["pending_financial_actions"].values()))
    assert row["status"] == "pending"

    monkeypatch.setattr(sync_module, "apply_portfolio_positions", real_apply)
    second = await ai_service._exec_mentor_tool(
        "confirm_pending_financial_action", {"pending_id": pending_id, "confirmed": True}, user_id="u1")
    assert second.startswith("Aplicado.")
