"""
radar_thesis_service.py — Nuvos Radar 2.0 Fase 7 "Mi tesis" private
persistence (migration 127, not applied to real Supabase yet). Fake
Supabase enforces UNIQUE(user_id, ticker) the same way the real table
does, so these catch a real upsert-logic bug, not just a mock bug.
"""
import asyncio
import uuid

import pytest
from fastapi import HTTPException

import app.services.radar_thesis_service as svc

USER_A = str(uuid.uuid4())
USER_B = str(uuid.uuid4())

VALID_ANSWERS = {
    "q1": "bueno", "q2": ["ventaja", "crecimiento"], "q3": ["Riesgo de ejemplo"],
    "q4": "razonable", "q5": ["Algo que cambiaría mi opinión"], "q5Own": "mi propia nota",
    "q6": "largo",
}


def _run(coro):
    return asyncio.run(coro)


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    def __init__(self, db):
        self.db = db
        self._filters: dict = {}
        self._limit = None

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def limit(self, n):
        self._limit = n
        return self

    def insert(self, row):
        self._insert_row = dict(row)
        return self

    def update(self, data):
        self._update_data = dict(data)
        return self

    def execute(self):
        if hasattr(self, "_insert_row"):
            row = {**self._insert_row}
            # Same invariant as the real UNIQUE(user_id, ticker) constraint.
            dup = [r for r in self.db.rows if r.get("user_id") == row.get("user_id") and r.get("ticker") == row.get("ticker")]
            assert not dup, "UNIQUE(user_id, ticker) violated"
            row.setdefault("id", str(uuid.uuid4()))
            self.db.rows.append(row)
            return _FakeResult([row])
        rows = [r for r in self.db.rows if all(r.get(k) == v for k, v in self._filters.items())]
        if hasattr(self, "_update_data"):
            for r in rows:
                r.update(self._update_data)
            return _FakeResult(rows)
        if self._limit:
            rows = rows[: self._limit]
        return _FakeResult(rows)


class _FakeDB:
    def __init__(self):
        self.rows: list[dict] = []

    def table(self, name):
        assert name == "user_radar_theses"
        return _FakeTable(self)


def test_validate_thesis_answers_accepts_real_shape():
    cleaned = svc.validate_thesis_answers(VALID_ANSWERS)
    assert cleaned["q1"] == "bueno"
    assert cleaned["q6"] == "largo"


def test_validate_thesis_answers_rejects_bad_q1():
    with pytest.raises(HTTPException):
        svc.validate_thesis_answers({**VALID_ANSWERS, "q1": "algo_inventado"})


def test_validate_thesis_answers_rejects_non_list_q2():
    with pytest.raises(HTTPException):
        svc.validate_thesis_answers({**VALID_ANSWERS, "q2": "no es una lista"})


def test_validate_ticker_rejects_garbage(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(svc, "get_fresh_supabase", lambda: db)
    with pytest.raises(HTTPException):
        _run(svc.get_thesis(USER_A, "'; DROP TABLE users; --"))


def test_user_a_creates_and_reads_own_thesis(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(svc, "get_fresh_supabase", lambda: db)

    saved = _run(svc.save_thesis(USER_A, "googl", VALID_ANSWERS))
    assert saved["ticker"] == "GOOGL"
    assert saved["answers"]["q1"] == "bueno"

    fetched = _run(svc.get_thesis(USER_A, "GOOGL"))
    assert fetched is not None
    assert fetched["answers"] == saved["answers"]


def test_user_a_edits_and_saves_without_creating_duplicate(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(svc, "get_fresh_supabase", lambda: db)

    _run(svc.save_thesis(USER_A, "GOOGL", VALID_ANSWERS))
    edited = {**VALID_ANSWERS, "q1": "dudas"}
    _run(svc.save_thesis(USER_A, "GOOGL", edited))

    rows = [r for r in db.rows if r["user_id"] == USER_A and r["ticker"] == "GOOGL"]
    assert len(rows) == 1, "editing must update the existing row, never insert a second one"
    assert rows[0]["answers"]["q1"] == "dudas"


def test_user_b_cannot_read_user_a_thesis(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(svc, "get_fresh_supabase", lambda: db)

    _run(svc.save_thesis(USER_A, "GOOGL", VALID_ANSWERS))
    result = _run(svc.get_thesis(USER_B, "GOOGL"))
    assert result is None


def test_user_b_save_never_touches_user_a_row(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(svc, "get_fresh_supabase", lambda: db)

    _run(svc.save_thesis(USER_A, "GOOGL", VALID_ANSWERS))
    _run(svc.save_thesis(USER_B, "GOOGL", {**VALID_ANSWERS, "q1": "no_convence"}))

    a_row = [r for r in db.rows if r["user_id"] == USER_A][0]
    b_row = [r for r in db.rows if r["user_id"] == USER_B][0]
    assert a_row["answers"]["q1"] == "bueno"
    assert b_row["answers"]["q1"] == "no_convence"
    assert a_row["id"] != b_row["id"]


def test_different_tickers_stay_independent_for_same_user(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(svc, "get_fresh_supabase", lambda: db)

    _run(svc.save_thesis(USER_A, "GOOGL", VALID_ANSWERS))
    _run(svc.save_thesis(USER_A, "MCD", {**VALID_ANSWERS, "q1": "no_convence"}))

    googl = _run(svc.get_thesis(USER_A, "GOOGL"))
    mcd = _run(svc.get_thesis(USER_A, "MCD"))
    assert googl["answers"]["q1"] == "bueno"
    assert mcd["answers"]["q1"] == "no_convence"


def test_get_thesis_returns_none_when_absent(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(svc, "get_fresh_supabase", lambda: db)
    assert _run(svc.get_thesis(USER_A, "NVDA")) is None
