"""
qualitative_content_service.py — editorial (business model / moat / risks)
content for Radar fichas, backed by company_qualitative_content (migrations
123/124/125). Real logic under test against a fake Supabase that enforces
the same partial-unique-index invariant (at most one is_current=True per
ticker) the real migration does, so these catch a real service bug, not
just a mock bug.
"""
import asyncio
import uuid

import app.services.qualitative_content_service as qcs
import app.core.cache as cache_mod


def _run(coro):
    return asyncio.run(coro)


def _clear_cache():
    cache_mod._mem.clear()


VALID_MOAT = [{
    "type": "scale", "explanation": "Distribución por defecto en la mayoría de navegadores y dispositivos móviles.",
    "evidence": "Acuerdos de distribución divulgados en el 10-K de la compañía.",
    "weakening_factors": "Litigio antimonopolio activo.",
    "source_name": "10-K más reciente disponible", "source_document_date": None,
    "source_accessed_at": None, "confidence": "alta",
}]

VALID_RISKS = [
    {"category": "regulacion", "fact_type": "hecho", "explanation": "Litigios antimonopolio activos en EE.UU. y la UE.",
     "evidence": "Casos judiciales públicos documentados.", "watch_indicator": "Fallos y apelaciones.",
     "uncertainty": "Resultado aún no resuelto.", "source_name": "Registros judiciales públicos",
     "source_document_date": None, "source_accessed_at": None, "confidence": "alta"},
    {"category": "tecnologia_disrupcion", "fact_type": "interpretacion", "explanation": "La IA conversacional podría desplazar parte del volumen de búsqueda.",
     "evidence": "Crecimiento documentado en adopción de asistentes de IA.", "watch_indicator": "Métricas de volumen de búsqueda reportadas.",
     "uncertainty": "No está claro si canibaliza o complementa.", "source_name": "Tendencias de adopción observables",
     "source_document_date": None, "source_accessed_at": None, "confidence": "media"},
    {"category": "competencia", "fact_type": "escenario_hipotetico", "explanation": "Un fallo de separación forzada cambiaría la valuación combinada.",
     "evidence": "Precedente de litigios antimonopolio en la industria.", "watch_indicator": "Resoluciones judiciales.",
     "uncertainty": "Especulativo, sin certeza de ocurrencia.", "source_name": "Análisis propio",
     "source_document_date": None, "source_accessed_at": None, "confidence": "baja"},
]


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    def __init__(self, db):
        self.db = db
        self._filters: dict = {}
        self._order_field = None
        self._desc = False
        self._limit = None

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def order(self, field, desc=False):
        self._order_field = field
        self._desc = desc
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
            row.setdefault("id", str(uuid.uuid4()))
            self.db.rows.append(row)
            return _FakeResult([row])
        rows = [r for r in self.db.rows if all(r.get(k) == v for k, v in self._filters.items())]
        if self._order_field:
            rows = sorted(rows, key=lambda r: r.get(self._order_field, 0), reverse=self._desc)
        if hasattr(self, "_update_data"):
            for r in rows:
                r.update(self._update_data)
            if self._limit:
                rows = rows[: self._limit]
            return _FakeResult(rows)
        if self._limit:
            rows = rows[: self._limit]
        return _FakeResult(rows)


class _FakeRpc:
    def __init__(self, db, fn_name, params):
        self.db = db
        self.fn_name = fn_name
        self.params = params

    def execute(self):
        assert self.fn_name == "publish_company_qualitative_content"
        p = self.params
        ticker = p["p_ticker"]
        current = [r for r in self.db.rows if r["ticker"] == ticker and r.get("is_current")]
        assert len(current) <= 1, "at most one is_current row per ticker before publish"
        next_version = (max((r["version"] for r in self.db.rows if r["ticker"] == ticker), default=0)) + 1
        for r in self.db.rows:
            if r["ticker"] == ticker and r.get("is_current"):
                r["is_current"] = False
        row = {
            "id": str(uuid.uuid4()), "ticker": ticker, "version": next_version,
            "review_status": "published", "is_current": True,
            "business_model_summary": p["p_business_model_summary"],
            "moat": p["p_moat"], "risks": p["p_risks"],
            "updated_by": p["p_updated_by"], "published_by": p["p_updated_by"],
            "last_updated_at": "2026-11-12T00:00:00Z",
        }
        self.db.rows.append(row)
        return _FakeResult(row)


class _FakeDB:
    def __init__(self):
        self.rows: list[dict] = []

    def table(self, name):
        assert name == "company_qualitative_content"
        return _FakeTable(self)

    def rpc(self, fn_name, params):
        return _FakeRpc(self, fn_name, params)


# ── read path ────────────────────────────────────────────────────────────

def test_published_current_content_is_returned(monkeypatch):
    db = _FakeDB()
    db.rows.append({
        "ticker": "GOOGL", "version": 1, "review_status": "published", "is_current": True,
        "business_model_summary": "Alphabet gana la mayoría de sus ingresos vendiendo publicidad digital.",
        "moat": VALID_MOAT, "risks": VALID_RISKS, "last_updated_at": "2026-11-12T00:00:00Z",
    })
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _clear_cache()

    result = _run(qcs.get_published_qualitative_content("googl"))
    assert result is not None
    assert result["ticker"] == "GOOGL"
    assert len(result["moat"]) == 1


def test_draft_is_invisible_to_public_read(monkeypatch):
    db = _FakeDB()
    db.rows.append({
        "ticker": "COST", "version": 1, "review_status": "draft", "is_current": False,
        "business_model_summary": "x", "moat": VALID_MOAT, "risks": VALID_RISKS,
        "last_updated_at": "2026-11-12T00:00:00Z",
    })
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _clear_cache()

    assert _run(qcs.get_published_qualitative_content("COST")) is None


def test_reviewed_is_invisible_to_public_read(monkeypatch):
    db = _FakeDB()
    db.rows.append({
        "ticker": "JPM", "version": 1, "review_status": "reviewed", "is_current": False,
        "business_model_summary": "x", "moat": VALID_MOAT, "risks": VALID_RISKS,
        "last_updated_at": "2026-11-12T00:00:00Z",
    })
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _clear_cache()

    assert _run(qcs.get_published_qualitative_content("JPM")) is None


def test_nonexistent_ticker_returns_none_not_exception(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _clear_cache()

    assert _run(qcs.get_published_qualitative_content("ZZZZ")) is None


def test_transient_supabase_failure_degrades_to_none_never_blocks_ficha(monkeypatch):
    def _boom():
        raise ConnectionError("transient network blip")
    monkeypatch.setattr(qcs, "get_supabase", _boom)
    _clear_cache()

    # Must not raise — a failure here must never block the financial ficha.
    assert _run(qcs.get_published_qualitative_content("NVDA")) is None


def test_invalid_ticker_input_handled_safely(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _clear_cache()

    assert _run(qcs.get_published_qualitative_content("")) is None
    assert _run(qcs.get_published_qualitative_content("   ")) is None


# ── write flow: draft -> reviewed -> published ─────────────────────────────

def test_create_draft_sets_is_current_false_explicitly(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)

    row = _run(qcs.create_draft("MCD", "x" * 25, VALID_MOAT, VALID_RISKS, "ai_draft:claude-sonnet-5"))
    assert row["review_status"] == "draft"
    assert row["is_current"] is False


def test_ai_draft_cannot_be_marked_reviewed_without_human_actor(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _run(qcs.create_draft("MCD", "x" * 25, VALID_MOAT, VALID_RISKS, "ai_draft:claude-sonnet-5"))

    try:
        _run(qcs.mark_reviewed("MCD", 1, "ai_draft:claude-sonnet-5"))
        assert False, "should have raised"
    except qcs.QualitativeContentError as exc:
        assert "humano" in str(exc)


def test_ai_draft_cannot_be_marked_reviewed_with_blank_actor(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _run(qcs.create_draft("MCD", "x" * 25, VALID_MOAT, VALID_RISKS, "ai_draft:claude-sonnet-5"))

    try:
        _run(qcs.mark_reviewed("MCD", 1, ""))
        assert False, "should have raised"
    except qcs.QualitativeContentError:
        pass


def test_full_flow_draft_review_publish_preserves_history(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _clear_cache()

    _run(qcs.create_draft("NVDA", "x" * 25, VALID_MOAT, VALID_RISKS, "ai_draft:claude-sonnet-5"))
    _run(qcs.mark_reviewed("NVDA", 1, "diego@nuvosai.com"))
    assert db.rows[0]["review_status"] == "reviewed"

    published = _run(qcs.publish_version("NVDA", 1, "diego@nuvosai.com"))
    assert published["review_status"] == "published"
    assert published["is_current"] is True
    assert published["version"] == 2  # publish always inserts the NEXT version

    # Full history preserved — nothing deleted.
    assert len(db.rows) == 2
    v1 = next(r for r in db.rows if r["version"] == 1)
    assert v1["review_status"] == "reviewed"  # untouched, not mutated in place

    # And the published row is now genuinely readable.
    result = _run(qcs.get_published_qualitative_content("NVDA"))
    assert result is not None


def test_publish_requires_reviewed_status_not_draft(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _run(qcs.create_draft("JPM", "x" * 25, VALID_MOAT, VALID_RISKS, "ai_draft:claude-sonnet-5"))

    try:
        _run(qcs.publish_version("JPM", 1, "diego@nuvosai.com"))
        assert False, "should have raised — draft, not reviewed"
    except qcs.QualitativeContentError as exc:
        assert "reviewed" in str(exc)


def test_publish_without_human_actor_rejected(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _run(qcs.create_draft("JPM", "x" * 25, VALID_MOAT, VALID_RISKS, "ai_draft:claude-sonnet-5"))
    _run(qcs.mark_reviewed("JPM", 1, "diego@nuvosai.com"))

    try:
        _run(qcs.publish_version("JPM", 1, "ai_draft:claude-sonnet-5"))
        assert False, "should have raised"
    except qcs.QualitativeContentError:
        pass


def test_republishing_supersedes_old_version_exactly_one_current(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)
    _clear_cache()

    _run(qcs.create_draft("COST", "x" * 25, VALID_MOAT, VALID_RISKS, "ai_draft:claude-sonnet-5"))
    _run(qcs.mark_reviewed("COST", 1, "diego@nuvosai.com"))
    _run(qcs.publish_version("COST", 1, "diego@nuvosai.com"))

    _run(qcs.create_draft("COST", "y" * 25, VALID_MOAT, VALID_RISKS, "ai_draft:claude-sonnet-5"))
    _run(qcs.mark_reviewed("COST", 3, "diego@nuvosai.com"))
    _run(qcs.publish_version("COST", 3, "diego@nuvosai.com"))

    current = [r for r in db.rows if r["ticker"] == "COST" and r.get("is_current")]
    assert len(current) == 1
    assert current[0]["version"] == 4
    assert len(db.rows) == 4  # all 4 rows preserved, nothing deleted


# ── validation ───────────────────────────────────────────────────────────

def test_draft_rejected_without_sufficient_evidence(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)

    bad_moat = [{**VALID_MOAT[0], "confidence": "alta", "source_name": ""}]  # material claim, no source
    try:
        _run(qcs.create_draft("ABBV", "x" * 25, bad_moat, VALID_RISKS, "ai_draft:claude-sonnet-5"))
        assert False, "should have raised"
    except qcs.QualitativeContentError as exc:
        assert "fuente" in str(exc).lower() or "evidencia" in str(exc).lower() or "source_name" in str(exc)


def test_draft_rejected_for_prescriptive_language(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)

    bad_risk = [{**VALID_RISKS[0], "explanation": "Deberías comprar esta acción ahora mismo."}]
    try:
        _run(qcs.create_draft("ABBV", "x" * 25, VALID_MOAT, bad_risk + VALID_RISKS[1:], "ai_draft:claude-sonnet-5"))
        assert False, "should have raised"
    except qcs.QualitativeContentError as exc:
        assert "prescriptivo" in str(exc)


def test_draft_rejected_with_too_few_risks(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(qcs, "get_supabase", lambda: db)

    try:
        _run(qcs.create_draft("ABBV", "x" * 25, VALID_MOAT, VALID_RISKS[:1], "ai_draft:claude-sonnet-5"))
        assert False, "should have raised"
    except qcs.QualitativeContentError:
        pass


def test_validate_rejects_invented_future_date():
    errors = qcs.validate_qualitative_entries(
        "x" * 25, [{**VALID_MOAT[0], "source_document_date": "2099-01-01"}], VALID_RISKS
    )
    assert any("source_document_date" in e for e in errors)


def test_validate_accepts_null_dates_as_honest_unknown():
    errors = qcs.validate_qualitative_entries("x" * 25, VALID_MOAT, VALID_RISKS)
    assert errors == []
