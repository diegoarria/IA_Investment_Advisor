"""
company_valuation_service.py — durable, versioned persistence of Nuvos
Radar's computed intrinsic valuations (migrations/114_company_valuations
.sql). Real logic under test, against a fake Supabase that enforces the
same invariants the real migration's schema/RPC do (partial unique index
on is_current, the set_current_company_valuation RPC's atomic flip), so
these tests catch a real logic bug in the service, not just in the mock.
"""
import asyncio
import uuid

import app.services.company_valuation_service as cvs


def _run(coro):
    return asyncio.run(coro)


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    def __init__(self, db, name):
        self.db = db
        self.name = name
        self._filters: dict = {}

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def limit(self, *_a, **_k):
        return self

    def insert(self, row):
        self._insert_row = dict(row)
        return self

    def update(self, data):
        self._update_data = dict(data)
        return self

    def in_(self, field, values):
        self._in_filters = getattr(self, "_in_filters", {})
        self._in_filters[field] = set(values)
        return self

    def execute(self):
        if hasattr(self, "_insert_row"):
            row = {**self._insert_row}
            row.setdefault("id", str(uuid.uuid4()))
            self.db.rows.append(row)
            return _FakeResult([row])
        rows = [r for r in self.db.rows if all(r.get(k) == v for k, v in self._filters.items())]
        if hasattr(self, "_in_filters"):
            for field, values in self._in_filters.items():
                rows = [r for r in rows if r.get(field) in values]
        if hasattr(self, "_update_data"):
            for r in rows:
                r.update(self._update_data)
            return _FakeResult(rows)
        return _FakeResult(rows)


class _FakeRpc:
    def __init__(self, db, fn_name, params):
        self.db = db
        self.fn_name = fn_name
        self.params = params

    def execute(self):
        assert self.fn_name == "set_current_company_valuation"
        p = self.params
        assert p["p_validation_status"] in ("valid", "insufficient_data", "under_review"), (
            "the RPC must never be called for a 'failed' result — that path is a plain insert"
        )
        ticker = p["p_ticker"]
        # Mirrors the real Postgres function: flip old current off, THEN
        # insert the new current row — same partial-unique-index guarantee
        # (at most one is_current=True per ticker) enforced here too.
        for r in self.db.rows:
            if r["ticker"] == ticker and r.get("is_current"):
                r["is_current"] = False
        row = {
            "id": str(uuid.uuid4()),
            "ticker": ticker,
            "intrinsic_value_usd": p["p_intrinsic_value_usd"],
            "currency": p["p_currency"],
            "methodology": p["p_methodology"],
            "model_version": p["p_model_version"],
            "financial_report_period": p["p_financial_report_period"],
            "assumptions": p["p_assumptions"],
            "validation_status": p["p_validation_status"],
            "is_current": True,
        }
        current_count = sum(1 for r in self.db.rows if r["ticker"] == ticker and r.get("is_current"))
        assert current_count == 0, "at most one is_current row per ticker before the new insert"
        self.db.rows.append(row)
        return _FakeResult([row])


class _FakeDB:
    def __init__(self):
        self.rows: list[dict] = []

    def table(self, name):
        assert name == "company_valuations"
        return _FakeTable(self, name)

    def rpc(self, fn_name, params):
        return _FakeRpc(self, fn_name, params)


def _current_rows(db, ticker):
    return [r for r in db.rows if r["ticker"] == ticker and r.get("is_current")]


def test_valid_valuation_saves_and_is_retrievable(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(cvs, "get_supabase", lambda: db)
    import app.core.cache as cache_mod
    cache_mod._mem.clear()

    computed = {
        "validation_status": "valid", "intrinsic_value_usd": 263.70, "currency": "USD",
        "methodology": "gqv", "model_version": "v1", "financial_report_period": "2026-Q3",
        "assumptions": {"bear": 197.16, "bull": 295.46},
    }
    saved = _run(cvs.persist_valuation("AAPL", computed))
    assert saved["intrinsic_value_usd"] == 263.70
    assert saved["is_current"] is True

    fetched = _run(cvs.get_persisted_valuation("AAPL"))
    assert fetched["intrinsic_value_usd"] == 263.70
    assert fetched["ticker"] == "AAPL"


def test_failed_computation_never_replaces_last_valid_row(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(cvs, "get_supabase", lambda: db)
    import app.core.cache as cache_mod
    cache_mod._mem.clear()

    good = {
        "validation_status": "valid", "intrinsic_value_usd": 450.73, "currency": "USD",
        "methodology": "gqv", "model_version": "v1", "financial_report_period": "2026-Q2",
        "assumptions": {},
    }
    _run(cvs.persist_valuation("MSFT", good))
    assert _current_rows(db, "MSFT")[0]["intrinsic_value_usd"] == 450.73

    failure = {"validation_status": "failed", "error_detail": "FMP 429 rate limited"}
    _run(cvs.persist_valuation("MSFT", failure))

    # The last valid row must still be the current one, untouched.
    current = _current_rows(db, "MSFT")
    assert len(current) == 1
    assert current[0]["intrinsic_value_usd"] == 450.73
    assert current[0]["validation_status"] == "valid"
    # The failure was logged as real history, just never promoted.
    failed_rows = [r for r in db.rows if r["ticker"] == "MSFT" and r["validation_status"] == "failed"]
    assert len(failed_rows) == 1
    assert failed_rows[0]["is_current"] is False


def test_sequential_updates_never_leave_two_current_rows(monkeypatch):
    """Simulates two 'concurrent' refreshes for the same ticker landing
    one after another (the realistic outcome under Postgres row locking —
    true simultaneity serializes to this) — history must stay clean, with
    exactly one current row at every point, never zero, never two."""
    db = _FakeDB()
    monkeypatch.setattr(cvs, "get_supabase", lambda: db)
    import app.core.cache as cache_mod
    cache_mod._mem.clear()

    v1 = {"validation_status": "valid", "intrinsic_value_usd": 100.0, "currency": "USD",
          "methodology": "gqv", "model_version": "v1", "financial_report_period": "2026-Q1", "assumptions": {}}
    v2 = {"validation_status": "valid", "intrinsic_value_usd": 105.0, "currency": "USD",
          "methodology": "gqv", "model_version": "v1", "financial_report_period": "2026-Q2", "assumptions": {}}

    _run(cvs.persist_valuation("TSLA", v1))
    assert len(_current_rows(db, "TSLA")) == 1
    _run(cvs.persist_valuation("TSLA", v2))

    current = _current_rows(db, "TSLA")
    assert len(current) == 1, "exactly one current row — the RPC's own assertion would have raised otherwise"
    assert current[0]["intrinsic_value_usd"] == 105.0
    all_tsla = [r for r in db.rows if r["ticker"] == "TSLA"]
    assert len(all_tsla) == 2, "both the old and new computations stay in history"


def test_claim_prevents_duplicate_concurrent_work(monkeypatch):
    import app.core.cache as cache_mod
    cache_mod._mem.clear()
    token1 = cvs.claim_ticker("NVDA")
    assert token1 is not None
    token2 = cvs.claim_ticker("NVDA")
    assert token2 is None, "a second claim on the same ticker while the first is held must be refused"
    cvs.release_claim("NVDA", token1)
    token3 = cvs.claim_ticker("NVDA")
    assert token3 is not None, "released claim must be claimable again"
    cvs.release_claim("NVDA", token3)


def test_refresh_skips_recompute_when_nothing_changed(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(cvs, "get_supabase", lambda: db)
    import app.core.cache as cache_mod
    cache_mod._mem.clear()

    existing_row = {
        "id": str(uuid.uuid4()), "ticker": "KO", "intrinsic_value_usd": 70.0, "currency": "USD",
        "methodology": "gqv", "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q2",
        "assumptions": {}, "validation_status": "valid", "is_current": True,
    }
    db.rows.append(existing_row)

    compute_calls = []
    monkeypatch.setattr(cvs, "compute_numeric_valuation", lambda t: compute_calls.append(t) or {"validation_status": "failed"})

    import app.api.routes.screener as screener_mod
    monkeypatch.setattr(screener_mod, "_latest_reported_earnings_period", lambda t: "2026-Q2")

    result = _run(cvs.refresh_if_needed("KO"))
    assert compute_calls == [], "same model_version + same reported period must skip recompute entirely"
    assert result["intrinsic_value_usd"] == 70.0


def test_refresh_recomputes_when_new_report_detected(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(cvs, "get_supabase", lambda: db)
    import app.core.cache as cache_mod
    cache_mod._mem.clear()

    existing_row = {
        "id": str(uuid.uuid4()), "ticker": "PEP", "intrinsic_value_usd": 170.0, "currency": "USD",
        "methodology": "gqv", "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q1",
        "assumptions": {}, "validation_status": "valid", "is_current": True,
    }
    db.rows.append(existing_row)

    monkeypatch.setattr(cvs, "compute_numeric_valuation", lambda t: {
        "validation_status": "valid", "intrinsic_value_usd": 175.0, "currency": "USD",
        "methodology": "gqv", "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q2",
        "assumptions": {},
    })
    import app.api.routes.screener as screener_mod
    monkeypatch.setattr(screener_mod, "_latest_reported_earnings_period", lambda t: "2026-Q2")

    result = _run(cvs.refresh_if_needed("PEP"))
    assert result["intrinsic_value_usd"] == 175.0
    assert len(_current_rows(db, "PEP")) == 1


def test_transient_no_data_never_demotes_an_existing_valid_row(monkeypatch):
    """2026-10-20, confirmed live for BRK.B: all 3 financial-data
    providers transiently empty at once is indistinguishable at the
    compute layer from "genuinely not enough data" — refresh_if_needed
    must still never let that demote a real previously-valid row to
    insufficient_data; it must log it as a failure instead.

    Stores the existing row under "BRK-B" (the canonical, normalized
    form persist_valuation would actually have written — see
    TestTickerNormalization below) but still calls refresh_if_needed with
    the dotted "BRK.B" spelling, so this also exercises normalize_ticker_
    symbol finding the same row end-to-end."""
    db = _FakeDB()
    monkeypatch.setattr(cvs, "get_supabase", lambda: db)
    import app.core.cache as cache_mod
    cache_mod._mem.clear()

    existing_row = {
        "id": str(uuid.uuid4()), "ticker": "BRK-B", "intrinsic_value_usd": 1035561.12, "currency": "USD",
        "methodology": "gqv", "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q2",
        "assumptions": {}, "validation_status": "valid", "is_current": True,
        "computed_at": "2020-01-01T00:00:00+00:00",  # old enough that the 24h freshness fallback won't apply either
    }
    db.rows.append(existing_row)

    monkeypatch.setattr(cvs, "compute_numeric_valuation", lambda t: {
        "validation_status": "insufficient_data", "error_detail": "every provider failed (transient)",
    })
    import app.api.routes.screener as screener_mod
    monkeypatch.setattr(screener_mod, "_latest_reported_earnings_period", lambda t: "2026-Q3")  # a genuinely new period, forces an attempt

    result = _run(cvs.refresh_if_needed("BRK.B"))
    assert result["validation_status"] == "failed", "must be logged as a failure, never as insufficient_data, when a valid row already exists"

    current = _current_rows(db, "BRK-B")
    assert len(current) == 1
    assert current[0]["intrinsic_value_usd"] == 1035561.12, "the real previous valid value must still be current"
    assert current[0]["validation_status"] == "valid"


def test_unresolvable_earnings_period_falls_back_to_time_based_freshness(monkeypatch):
    """When _latest_reported_earnings_period can't be resolved at all
    (confirmed happens for real — Finnhub plan/outage), a recently
    computed row must still be trusted rather than always recomputing
    (which would defeat quota protection every time this one signal is
    down)."""
    db = _FakeDB()
    monkeypatch.setattr(cvs, "get_supabase", lambda: db)
    import app.core.cache as cache_mod
    cache_mod._mem.clear()
    from datetime import datetime, timezone

    existing_row = {
        "id": str(uuid.uuid4()), "ticker": "AAPL", "intrinsic_value_usd": 263.70, "currency": "USD",
        "methodology": "gqv", "model_version": cvs.MODEL_VERSION, "financial_report_period": None,
        "assumptions": {}, "validation_status": "valid", "is_current": True,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
    db.rows.append(existing_row)

    compute_calls = []
    monkeypatch.setattr(cvs, "compute_numeric_valuation", lambda t: compute_calls.append(t) or {"validation_status": "failed"})
    import app.api.routes.screener as screener_mod
    monkeypatch.setattr(screener_mod, "_latest_reported_earnings_period", lambda t: None)

    result = _run(cvs.refresh_if_needed("AAPL"))
    assert compute_calls == [], "a fresh row must be trusted via the time-based fallback when the period signal is unavailable"
    assert result["intrinsic_value_usd"] == 263.70


def test_backfill_processes_all_and_resumes_after_interruption(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(cvs, "get_supabase", lambda: db)
    import app.core.cache as cache_mod
    cache_mod._mem.clear()

    processed = []

    def fake_compute(ticker):
        processed.append(ticker)
        return {"validation_status": "valid", "intrinsic_value_usd": 10.0, "currency": "USD",
                "methodology": "gqv", "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q1",
                "assumptions": {}}

    monkeypatch.setattr(cvs, "compute_numeric_valuation", fake_compute)
    import app.api.routes.screener as screener_mod
    monkeypatch.setattr(screener_mod, "_latest_reported_earnings_period", lambda t: "2026-Q1")

    universe = ["AAA", "BBB", "CCC", "DDD", "EEE"]

    # First "run" — interrupted after 3 tickers (simulated by only passing
    # the first 3 to the driver, same as a crash/stop mid-sweep would).
    result1 = _run(cvs.backfill_universe(universe[:3], max_tickers_per_minute=100000))
    assert result1["valid"] == 3
    assert sorted(processed) == ["AAA", "BBB", "CCC"]

    # "Resume" — re-run over the FULL universe. The 3 already-done tickers
    # must be skipped (same report period, same model version); only the
    # 2 new ones get real work.
    processed.clear()
    result2 = _run(cvs.backfill_universe(universe, max_tickers_per_minute=100000))
    assert sorted(processed) == ["DDD", "EEE"], "already-completed tickers must not be recomputed on resume"
    # All 5 end up "valid" (3 skipped-but-already-valid + 2 freshly computed) —
    # the real signal for resumability is `processed` above, not this count.
    assert result2["valid"] == 5

    # Exactly 5 current rows exist, one per ticker — no duplicates, no gaps.
    for t in universe:
        assert len(_current_rows(db, t)) == 1


class TestTickerNormalization:
    """2026-10-21, Nuvos Radar structural audit: confirmed live that
    "BRK.B" and "BRK-B" existed as two separate is_current=true rows for
    the same real company, because this module only ever did a bare
    .upper() while the route layer (screener._resolve_quick_ticker)
    normalized the dual-class dot to a hyphen. Every persistence-layer
    entry point must key on the same canonical form."""

    def test_dot_suffix_becomes_hyphen(self):
        assert cvs.normalize_ticker_symbol("BRK.B") == "BRK-B"
        assert cvs.normalize_ticker_symbol("BF.B") == "BF-B"

    def test_already_hyphenated_is_unchanged(self):
        assert cvs.normalize_ticker_symbol("BRK-B") == "BRK-B"

    def test_lowercase_is_uppercased(self):
        assert cvs.normalize_ticker_symbol("brk.b") == "BRK-B"
        assert cvs.normalize_ticker_symbol("aapl") == "AAPL"

    def test_plain_ticker_unaffected(self):
        assert cvs.normalize_ticker_symbol("AMZN") == "AMZN"

    def test_canonicalize_suffix_preserves_case(self):
        # Unlike normalize_ticker_symbol, the route layer's own helper
        # must NOT change case — screener._resolve_quick_ticker relies on
        # comparing the result against its own uppercased form to decide
        # whether the user deliberately typed a literal ticker.
        assert cvs.canonicalize_ticker_suffix("BRK.B") == "BRK-B"
        assert cvs.canonicalize_ticker_suffix("brk.b") == "brk-b"

    def test_get_persisted_valuation_normalizes_dotted_lookup(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        import app.core.cache as cache_mod
        cache_mod._mem.clear()
        _run(cvs.persist_valuation("BRK-B", {
            "validation_status": "valid", "intrinsic_value_usd": 751.86,
            "currency": "USD", "methodology": "gqv", "model_version": cvs.MODEL_VERSION,
            "financial_report_period": "2026-Q2", "assumptions": {},
        }))
        # A lookup using the dotted spelling must find the same row the
        # hyphenated spelling wrote — not come back empty.
        result = _run(cvs.get_persisted_valuation("BRK.B"))
        assert result is not None
        assert result["intrinsic_value_usd"] == 751.86


class TestAnomalyReviewGuard:
    """2026-10-27, AXON backfill-pilot audit: a completed (non-failing)
    computation can still be untrustworthy. _anomaly_review_reason must
    flag it for human review (validation_status='under_review') without
    ever touching the computed number itself — never nudging it toward
    the market price."""

    def test_unreliable_operating_margin_anchor_triggers_review(self):
        dcf = {"operating_margin_anchor_reliable": False, "operating_margin_anchor_warning": "thin mixed-regime anchor"}
        scenarios = {"base": 36.30, "current_price": 425.87}
        reason = cvs._anomaly_review_reason(scenarios, dcf)
        assert reason == "thin mixed-regime anchor"

    def test_extreme_low_ratio_triggers_review_even_without_margin_flag(self):
        dcf = {"operating_margin_anchor_reliable": True}
        scenarios = {"base": 36.30, "current_price": 425.87}  # 0.085x
        reason = cvs._anomaly_review_reason(scenarios, dcf)
        assert reason is not None and "ratio" in reason

    def test_extreme_high_ratio_triggers_review(self):
        dcf = {"operating_margin_anchor_reliable": True}
        scenarios = {"base": 600.0, "current_price": 100.0}  # 6x
        reason = cvs._anomaly_review_reason(scenarios, dcf)
        assert reason is not None

    def test_normal_gap_within_universe_range_is_not_flagged(self):
        # real pilot tickers sat at 0.7-0.9x-equivalent gaps (12-27%) — this
        # guard must never fire on that normal range.
        dcf = {"operating_margin_anchor_reliable": True}
        for base, price in [(301.06, 320.0), (220.95, 230.09), (102.49, 110.0), (410.08, 420.0)]:
            assert cvs._anomaly_review_reason({"base": base, "current_price": price}, dcf) is None

    def test_missing_margin_flag_key_defaults_to_reliable(self):
        # the Priority-3 minimal dcf fallback branch doesn't set this key
        # at all — must not be misread as unreliable.
        dcf = {}
        scenarios = {"base": 100.0, "current_price": 110.0}
        assert cvs._anomaly_review_reason(scenarios, dcf) is None

    def test_persist_valuation_writes_under_review_status(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        import app.core.cache as cache_mod
        cache_mod._mem.clear()
        row = _run(cvs.persist_valuation("AXON", {
            "validation_status": "under_review",
            "error_detail": "thin mixed-regime operating-margin anchor",
            "intrinsic_value_usd": 36.30, "currency": "USD", "methodology": "gqv",
            "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-06-30",
            "assumptions": {"bear": 27.19, "bull": 46.71},
        }))
        assert row["validation_status"] == "under_review"
        assert row["is_current"] is True, "under_review must still present on the ticker's page, same as insufficient_data"
        # Backoff advances (treated like insufficient_data), never resets to 0 as 'valid' would.
        assert row["attempt_count"] >= 1

    def test_under_review_never_silently_becomes_valid_on_resume(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        import app.core.cache as cache_mod
        cache_mod._mem.clear()
        _run(cvs.persist_valuation("AXON", {
            "validation_status": "under_review", "error_detail": "flagged",
            "intrinsic_value_usd": 36.30, "currency": "USD", "methodology": "gqv",
            "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-06-30",
            "assumptions": {},
        }))
        rows = [r for r in db.rows if r["ticker"] == "AXON" and r["is_current"]]
        assert len(rows) == 1
        assert rows[0]["validation_status"] == "under_review"
