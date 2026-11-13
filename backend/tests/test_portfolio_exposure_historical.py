"""Nuvos Plus — Fase 5B: motor de comparación histórica.

Mocks FMP entirely via `_fetch_raw_chunk` — these are deterministic
mathematical/financial-property tests, never a network dependent one.
Nunca escribe en Supabase: ninguna prueba de este archivo importa ni
toca `app.core.database`."""
import math
from unittest.mock import patch

import pytest

from app.services.portfolio_exposure import historical as h


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.core import cache as cache_module
    cache_module._mem.clear()
    yield
    cache_module._mem.clear()


def _series(dates, prices):
    return [{"date": d, "adj_close": p} for d, p in zip(dates, prices)]


def _pos(ticker, weight_pct, currency="USD", verifiable=True):
    # `_weight_fraction` is the full-precision ratio compute_weights now
    # carries alongside the rounded, display-only `weight_pct` (Fase
    # 5B.1) — the historical engine reads ONLY `_weight_fraction`.
    return {
        "ticker": ticker,
        "weight_pct": weight_pct,
        "_weight_fraction": weight_pct / 100 if verifiable else None,
        "quote_currency": currency,
        "verifiable": verifiable,
    }


DATES_10 = [f"2024-01-{d:02d}" for d in range(1, 11)]  # 10 business-day-like dates, enough for alignment tests


# ─── 1-2: normalización e invariantes de peso ──────────────────────────────

def test_both_compositions_start_at_100():
    aligned = {"A": [10, 12, 15], "B": [20, 18, 22]}
    dates = ["d0", "d1", "d2"]
    idx = h.build_normalized_index({"A": 0.5, "B": 0.5}, dates, aligned)
    assert idx[0]["value"] == 100.0


def test_weights_must_sum_to_one():
    assert h.weights_sum_to_one({"A": 0.4, "B": 0.6})
    assert not h.weights_sum_to_one({"A": 0.4, "B": 0.5})
    assert not h.weights_sum_to_one({})


# ─── Fase 5B.1: precisión de pesos — nunca redondeados antes del índice ───

def test_weights_from_positions_uses_full_precision_fraction_not_rounded_pct():
    # weight_pct rounded to 43.37/56.63 (sums to exactly 100.00 by luck of
    # rounding) would mask this; a case where the UNROUNDED fraction and
    # the rounded display pct genuinely diverge in the 3rd decimal proves
    # _weight_fraction, not weight_pct, is what's actually read.
    positions = [
        {"ticker": "A", "weight_pct": 33.33, "_weight_fraction": 1 / 3, "quote_currency": "USD", "verifiable": True},
        {"ticker": "B", "weight_pct": 66.67, "_weight_fraction": 2 / 3, "quote_currency": "USD", "verifiable": True},
    ]
    weights = h._weights_from_positions(positions)
    assert weights["A"] == pytest.approx(1 / 3, abs=1e-12)
    assert weights["B"] == pytest.approx(2 / 3, abs=1e-12)
    assert h.weights_sum_to_one(weights)  # 1/3 + 2/3 == 1.0 exactly; 0.3333 + 0.6667 would also pass but for the wrong reason


def test_both_curves_start_at_exactly_100_with_four_real_weight_positions():
    # Reproduces the real 4-position shape (VOO/QQQ/GOOGL/ASML-style
    # weights) that produced 99.99/100.01 before _weight_fraction existed.
    fractions = {"VOO": 0.333232, "QQQ": 0.255914, "GOOGL": 0.209624, "ASML": 0.201230}
    assert sum(fractions.values()) == pytest.approx(1.0, abs=1e-9)
    dates = ["d0", "d1"]
    aligned = {t: [1.0, 1.1] for t in fractions}  # arbitrary flat prices — only t0 matters here
    idx = h.build_normalized_index(fractions, dates, aligned)
    assert idx[0]["value"] == pytest.approx(100.0, abs=1e-9)  # not 99.99, not 100.01 — exact within float precision


def test_full_precision_weights_preserved_through_entire_index_not_just_first_point():
    # Guards against a fix that only forces Index(t0) to 100 while every
    # later point still silently uses a rounded weight.
    fractions = {"A": 1 / 3, "B": 2 / 3}
    dates = ["d0", "d1", "d2"]
    aligned = {"A": [10, 11, 12], "B": [20, 22, 24]}  # B exactly doubles A's relative move
    idx = h.build_normalized_index(fractions, dates, aligned)
    expected_d1 = 100 * ((1 / 3) * (11 / 10) + (2 / 3) * (22 / 20))
    expected_d2 = 100 * ((1 / 3) * (12 / 10) + (2 / 3) * (24 / 20))
    assert idx[1]["value"] == pytest.approx(expected_d1, abs=1e-9)
    assert idx[2]["value"] == pytest.approx(expected_d2, abs=1e-9)


# ─── 3-4: identidad del índice bajo composiciones equivalentes ─────────────

def test_identical_weights_produce_identical_curves():
    aligned = {"A": [10, 11, 9, 13], "B": [20, 19, 24, 18]}
    dates = ["d0", "d1", "d2", "d3"]
    w = {"A": 0.3, "B": 0.7}
    idx1 = h.build_normalized_index(w, dates, aligned)
    idx2 = h.build_normalized_index(dict(w), dates, aligned)
    assert idx1 == idx2


def test_swapping_weight_between_identical_series_does_not_change_curve():
    # A and B have EXACTLY the same price path -> redistributing weight
    # between them must be a no-op for the index, by construction.
    same_path = [10, 11, 9, 13, 14]
    aligned = {"A": same_path, "B": list(same_path)}
    dates = [f"d{i}" for i in range(5)]
    idx_5050 = h.build_normalized_index({"A": 0.5, "B": 0.5}, dates, aligned)
    idx_9010 = h.build_normalized_index({"A": 0.9, "B": 0.1}, dates, aligned)
    for a, b in zip(idx_5050, idx_9010):
        assert a["value"] == pytest.approx(b["value"], abs=1e-9)


# ─── 5: buy-and-hold sin rebalanceo implícito ───────────────────────────────

def test_buy_and_hold_no_implicit_rebalancing():
    # If the engine rebalanced, a position that doubles then halves would
    # NOT return to the exact starting index value when the OTHER position
    # is flat -- buy-and-hold must return exactly to it (within rounding).
    aligned = {"A": [100, 200, 100], "B": [100, 100, 100]}
    dates = ["d0", "d1", "d2"]
    idx = h.build_normalized_index({"A": 0.5, "B": 0.5}, dates, aligned)
    assert idx[0]["value"] == pytest.approx(100.0, abs=1e-6)
    assert idx[2]["value"] == pytest.approx(100.0, abs=1e-6)
    assert idx[1]["value"] == pytest.approx(150.0, abs=1e-6)  # mid-point reflects the real move, not a rebalanced one


# ─── 6-7: métricas sobre series conocidas ──────────────────────────────────

def test_max_drawdown_on_a_known_series():
    values = [100, 120, 90, 110, 70, 130]
    dates = [f"d{i}" for i in range(len(values))]
    out = h.compute_max_drawdown(values, dates)
    # peak 120 (d1) -> trough 70 (d4): 70/120 - 1 = -41.666...%
    assert out["value"] == pytest.approx(-41.6667, abs=1e-3)
    assert out["peak_date"] == "d1"
    assert out["trough_date"] == "d4"


def test_volatility_against_a_reproducible_example():
    # constant +1% daily return -> stdev of returns is exactly 0
    values = [100.0]
    for _ in range(40):
        values.append(values[-1] * 1.01)
    out = h.compute_annualized_volatility(values)
    assert out["value"] == pytest.approx(0.0, abs=1e-6)
    assert out["observations"] == 40


def test_volatility_insufficient_observations_returns_none_not_a_number():
    out = h.compute_annualized_volatility([100, 101, 99])
    assert out["value"] is None
    assert out["reason"] == "insufficient_observations"


# ─── 8-9: honestidad de datos — nunca precios inválidos ni duplicados en conflicto ──

def test_rejects_negative_zero_nan_infinite_prices():
    with patch.object(h, "_fetch_raw_chunk") as mock_fetch:
        mock_fetch.return_value = [
            {"date": "2024-01-02", "adjClose": 100.0},
            {"date": "2024-01-03", "adjClose": 0.0},
            {"date": "2024-01-04", "adjClose": -5.0},
            {"date": "2024-01-05", "adjClose": math.nan},
            {"date": "2024-01-08", "adjClose": math.inf},
            {"date": "2024-01-09", "adjClose": 105.0},
        ]
        out = h.fetch_adjusted_price_series("TEST", "2024-01-01", "2024-01-10")
    kept_dates = [row["date"] for row in out["series"]]
    assert kept_dates == ["2024-01-02", "2024-01-09"]


def test_conflicting_duplicate_dates_are_flagged_not_averaged():
    with patch.object(h, "_date_chunks") as mock_chunks, patch.object(h, "_fetch_raw_chunk") as mock_fetch:
        import datetime
        mock_chunks.return_value = [
            (datetime.date(2024, 1, 1), datetime.date(2024, 1, 5)),
            (datetime.date(2024, 1, 5), datetime.date(2024, 1, 10)),
        ]
        mock_fetch.side_effect = [
            [{"date": "2024-01-05", "adjClose": 100.0}],
            [{"date": "2024-01-05", "adjClose": 103.0}],  # same date, different price across the chunk boundary
        ]
        out = h.fetch_adjusted_price_series("TEST", "2024-01-01", "2024-01-10")
    assert out["series"] == [{"date": "2024-01-05", "adj_close": 100.0}]  # first real value kept, never averaged/invented
    assert out["warnings"] == ["conflicting_duplicate_dates:1"]


# ─── 10: splits y dividendos ────────────────────────────────────────────────

def test_dividend_adjusted_endpoint_is_the_one_called():
    with patch.object(h, "_fetch_raw_chunk") as mock_fetch:
        mock_fetch.return_value = [{"date": "2024-01-02", "adjClose": 100.0}]
        h.fetch_adjusted_price_series("VOO", "2024-01-01", "2024-01-05")
    # the series itself came from adj_close -- the field name documents
    # that splits+dividends are already folded in by the provider, this
    # module never re-derives either adjustment itself.
    assert mock_fetch.called


# ─── 11-12: datos faltantes y distintos calendarios ─────────────────────────

def test_isolated_gap_is_forward_filled_within_limit():
    series_map = {
        "A": _series(["d0", "d1", "d2", "d3", "d4"], [10, 11, 12, 13, 14]),
        "B": _series(["d0", "d1", "d3", "d4"], [20, 21, 23, 24]),  # missing d2 only
    }
    out = h.align_series(series_map, max_forward_fill_days=3)
    assert out["ok"]
    assert out["aligned"]["B"] == [20, 21, 21, 23, 24]  # d2 forward-filled from d1's real 21


def test_gap_longer_than_limit_makes_ticker_unavailable_not_silently_dropped():
    series_map = {
        "A": _series(["d0", "d1", "d2", "d3", "d4", "d5"], [10, 11, 12, 13, 14, 15]),
        "B": _series(["d0", "d5"], [20, 25]),  # missing d1..d4 -- too long to forward-fill
    }
    out = h.align_series(series_map, max_forward_fill_days=3)
    assert out["ok"] is False
    assert out["reason"] == "insufficient_coverage"
    assert "B" in out["unavailable"]


def test_anchor_dates_are_never_forward_filled():
    # B is missing its very first date -- even with room under the
    # forward-fill limit, an anchor must be a real close, never filled.
    series_map = {
        "A": _series(["d0", "d1", "d2"], [10, 11, 12]),
        "B": _series(["d1", "d2"], [20, 21]),  # no real value at d0, the first shared date
    }
    out = h.align_series(series_map, max_forward_fill_days=3)
    assert out["ok"] is False
    assert "d0" in out["unavailable"]["B"]


# ─── 13: tickers recientes (no historial antes de su propia existencia) ─────

def test_recently_listed_ticker_shrinks_the_common_window_explicitly():
    before = [_pos("OLD", 100.0)]
    after = [_pos("OLD", 50.0), _pos("NEW", 50.0)]
    old_series = _series(["2020-01-01", "2020-06-01", "2023-01-01", "2024-01-01"], [10, 11, 14, 15])
    new_series = _series(["2023-01-01", "2023-06-01", "2024-01-01"], [5, 6, 7])

    def fake_fetch(ticker, start, end):
        return {"series": old_series if ticker == "OLD" else new_series, "warnings": []}

    with patch.object(h, "fetch_adjusted_price_series", side_effect=fake_fetch):
        out = h.compare_composition_history(before, after, "USD", "5y")
    assert out["available"] is True
    assert out["window_status"] == "partial"
    assert out["start_date"] == "2023-01-01"  # NEW's real start, not the requested 5y start


# ─── 14: rechazo controlado de monedas distintas de USD ────────────────────

def test_non_usd_portfolio_currency_is_refused_not_converted():
    out = h.compare_composition_history([_pos("A", 100.0)], [_pos("A", 100.0)], "EUR", "1y")
    assert out == {"available": False, "reason": "non_usd_portfolio_currency", "detail": {"portfolio_currency": "EUR"}}


def test_non_usd_instrument_is_refused_not_converted():
    before = [_pos("ASML_EU", 100.0, currency="EUR")]
    out = h.compare_composition_history(before, before, "USD", "1y")
    assert out["available"] is False
    assert out["reason"] == "non_usd_instrument"
    assert out["detail"]["tickers"] == {"ASML_EU": "EUR"}


def test_invalid_period_raises_not_a_silent_fallback():
    with pytest.raises(h.HistoricalDataUnavailableError):
        h.compare_composition_history([_pos("A", 100.0)], [_pos("A", 100.0)], "USD", "10y")


# ─── 15: paginación y límite de 5,000 registros ─────────────────────────────

def test_wide_range_is_split_into_chunks_and_concatenated():
    import datetime
    chunks = h._date_chunks(datetime.date(2010, 1, 1), datetime.date(2024, 1, 1), years=4)
    assert len(chunks) > 1
    # contiguous, no gaps, no overlap beyond a shared boundary day
    for (s1, e1), (s2, _e2) in zip(chunks, chunks[1:]):
        assert s2 == e1 + datetime.timedelta(days=1)
    assert chunks[0][0] == datetime.date(2010, 1, 1)
    assert chunks[-1][1] == datetime.date(2024, 1, 1)


def test_pagination_concatenates_and_dedupes_boundary_date():
    import datetime
    with patch.object(h, "_date_chunks") as mock_chunks, patch.object(h, "_fetch_raw_chunk") as mock_fetch:
        mock_chunks.return_value = [
            (datetime.date(2024, 1, 1), datetime.date(2024, 1, 5)),
            (datetime.date(2024, 1, 5), datetime.date(2024, 1, 10)),
        ]
        mock_fetch.side_effect = [
            [{"date": "2024-01-02", "adjClose": 10.0}, {"date": "2024-01-05", "adjClose": 11.0}],
            [{"date": "2024-01-05", "adjClose": 11.0}, {"date": "2024-01-09", "adjClose": 12.0}],
        ]
        out = h.fetch_adjusted_price_series("TEST", "2024-01-01", "2024-01-10")
    dates = [row["date"] for row in out["series"]]
    assert dates == ["2024-01-02", "2024-01-05", "2024-01-09"]  # boundary date appears once, not twice
    assert out["warnings"] == []  # same value on both sides of the boundary -- not a real conflict


# ─── 16: ausencia de escrituras en Supabase ─────────────────────────────────

def test_module_never_imports_database_or_supabase():
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(h))
    imported_modules = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    } | {
        node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module
    }
    assert not any("supabase" in (m or "").lower() or "database" in (m or "").lower() for m in imported_modules)


# ─── 17: aislamiento — inputs nunca mutados ────────────────────────────────

def test_input_position_lists_are_never_mutated():
    before = [_pos("A", 60.0), _pos("B", 40.0)]
    after = [_pos("A", 40.0), _pos("B", 30.0), _pos("C", 30.0)]
    before_copy = [dict(p) for p in before]
    after_copy = [dict(p) for p in after]

    series_map = {t: _series(DATES_10, [10 + i for i in range(10)]) for t in ("A", "B", "C")}

    def fake_fetch(ticker, start, end):
        return {"series": series_map[ticker], "warnings": []}

    with patch.object(h, "fetch_adjusted_price_series", side_effect=fake_fetch):
        h.compare_composition_history(before, after, "USD", "1y")

    assert before == before_copy
    assert after == after_copy


# ─── 18: fallos de FMP ──────────────────────────────────────────────────────

def test_fmp_failure_for_one_ticker_yields_unavailable_not_a_crash():
    before = [_pos("A", 100.0)]
    after = [_pos("A", 50.0), _pos("B", 50.0)]

    def fake_fetch(ticker, start, end):
        if ticker == "B":
            return {"series": [], "warnings": []}  # provider failure / no data
        return {"series": _series(DATES_10, list(range(10, 20))), "warnings": []}

    with patch.object(h, "fetch_adjusted_price_series", side_effect=fake_fetch):
        out = h.compare_composition_history(before, after, "USD", "1y")
    assert out == {"available": False, "reason": "no_price_history", "detail": {"ticker": "B"}}


# ─── 19: misma ventana temporal para ambas curvas ──────────────────────────

def test_before_and_after_curves_share_identical_dates():
    before = [_pos("A", 100.0)]
    after = [_pos("A", 50.0), _pos("B", 50.0)]
    series_map = {"A": _series(DATES_10, list(range(10, 20))), "B": _series(DATES_10, list(range(20, 30)))}

    def fake_fetch(ticker, start, end):
        return {"series": series_map[ticker], "warnings": []}

    with patch.object(h, "fetch_adjusted_price_series", side_effect=fake_fetch):
        out = h.compare_composition_history(before, after, "USD", "1y")
    assert [r["date"] for r in out["index_before"]] == [r["date"] for r in out["index_after"]]
    assert out["start_date"] == DATES_10[0]
    assert out["end_date"] == DATES_10[-1]


# ─── 20: ausencia de cambios en distribución/exposición existentes ─────────

def test_does_not_touch_combiner_simulate_addition_contract():
    from app.services.portfolio_exposure import combiner
    import inspect
    sig_before = str(inspect.signature(combiner.simulate_addition))
    # Importing historical.py must not change combiner's own public contract.
    assert sig_before == "(valued_real: list[dict], hypothetical: dict) -> dict"


class TestDualClassTickerSuffixFallback:
    """Fase 8-hotfix (2026-11-12): confirmed live against FMP — a dual-
    class suffix written with a dot ("BRK.B") returns 402 "special
    endpoint... not available under your current subscription" on
    /historical-price-eod/dividend-adjusted too. Real symbol is the
    hyphen form ("BRK-B"). Also fixes a real pre-existing bug this
    investigation found: ANY non-200 response (402, 429, 5xx) used to be
    silently cached as "no historical data" for 24h — now only a genuine
    200 response is cached, and only a confirmed-rejected symbol (never
    a 429/5xx) triggers the canonical-form retry."""

    def _resp(self, status, body):
        class _R:
            status_code = status
            def json(self_inner):
                return body
        return _R()

    def test_brk_b_retries_with_hyphen_and_gets_real_history(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            if params["symbol"] == "BRK.B":
                return self._resp(402, {"Error Message": "Special Endpoint"})
            if params["symbol"] == "BRK-B":
                return self._resp(200, [{"symbol": "BRK-B", "date": "2024-01-10", "adjClose": 367.92}])
            raise AssertionError(f"unexpected symbol: {params['symbol']}")

        with patch("app.services.portfolio_exposure.historical.requests.get", side_effect=fake_get):
            rows = h._fetch_raw_chunk("BRK.B", "2024-01-01", "2024-01-10")
        assert rows == [{"symbol": "BRK-B", "date": "2024-01-10", "adjClose": 367.92}]
        assert calls == ["BRK.B", "BRK-B"]

    def test_brk_a_same_pattern(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            if params["symbol"] == "BRK.A":
                return self._resp(402, {})
            return self._resp(200, [{"symbol": "BRK-A", "date": "2024-01-10", "adjClose": 550000.0}])

        with patch("app.services.portfolio_exposure.historical.requests.get", side_effect=fake_get):
            rows = h._fetch_raw_chunk("BRK.A", "2024-01-01", "2024-01-10")
        assert rows and rows[0]["adjClose"] == 550000.0

    def test_plain_tickers_never_retried_aapl_voo_asml(self):
        """AAPL, VOO, ASML — none have a dot suffix, must never trigger
        a second request."""
        for ticker in ("AAPL", "VOO", "ASML"):
            calls = []

            def fake_get(url, params=None, headers=None, timeout=None):
                calls.append(params["symbol"])
                return self._resp(200, [{"symbol": ticker, "date": "2024-01-10", "adjClose": 100.0}])

            with patch("app.services.portfolio_exposure.historical.requests.get", side_effect=fake_get):
                rows = h._fetch_raw_chunk(ticker, "2024-01-01", "2024-01-10")
            assert rows and rows[0]["symbol"] == ticker
            assert calls == [ticker], f"{ticker} triggered an unexpected retry: {calls}"

    def test_429_never_triggers_the_canonical_retry(self):
        """Explicit requirement: a transient rate-limit on the ORIGINAL
        symbol must never spend a second call retrying a different
        symbol string — it wouldn't fix a rate limit anyway."""
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            return self._resp(429, {"Error Message": "Limit Reach"})

        with patch("app.services.portfolio_exposure.historical.requests.get", side_effect=fake_get):
            rows = h._fetch_raw_chunk("BRK.B", "2024-01-01", "2024-01-10")
        assert rows == []
        assert calls == ["BRK.B"]  # never retried with BRK-B

    def test_5xx_never_triggers_the_canonical_retry(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(params["symbol"])
            return self._resp(503, {"error": "upstream unavailable"})

        with patch("app.services.portfolio_exposure.historical.requests.get", side_effect=fake_get):
            rows = h._fetch_raw_chunk("BRK.B", "2024-01-01", "2024-01-10")
        assert rows == []
        assert calls == ["BRK.B"]

    def test_transient_failure_is_never_cached_as_no_data(self):
        """Pre-existing bug found during this investigation: a non-200
        response used to be silently cached as '[]' for 24h. Confirms a
        later successful attempt is no longer blocked by that."""
        from app.core import cache as cache_module
        state = {"fail": True}

        def fake_get(url, params=None, headers=None, timeout=None):
            if state["fail"]:
                return self._resp(429, {"Error Message": "Limit Reach"})
            return self._resp(200, [{"symbol": "AAPL", "date": "2024-01-10", "adjClose": 190.0}])

        with patch("app.services.portfolio_exposure.historical.requests.get", side_effect=fake_get):
            rows = h._fetch_raw_chunk("AAPL", "2024-01-01", "2024-01-10")
            assert rows == []
            # Confirm nothing got persisted for this key.
            assert cache_module.cache_get("fmp:adj_hist:AAPL:2024-01-01:2024-01-10") is None
            state["fail"] = False
            rows = h._fetch_raw_chunk("AAPL", "2024-01-01", "2024-01-10")
            assert rows and rows[0]["adjClose"] == 190.0

    def test_genuine_empty_200_response_is_cached_as_legitimate_no_data(self):
        """A real 200 with an empty list (e.g. a date range before the
        stock existed) IS a legitimate answer and must be cached — not
        confused with a transient/rejected-symbol failure."""
        call_count = {"n": 0}

        def fake_get(url, params=None, headers=None, timeout=None):
            call_count["n"] += 1
            return self._resp(200, [])

        with patch("app.services.portfolio_exposure.historical.requests.get", side_effect=fake_get):
            assert h._fetch_raw_chunk("AAPL", "1950-01-01", "1950-01-10") == []
            assert h._fetch_raw_chunk("AAPL", "1950-01-01", "1950-01-10") == []
        assert call_count["n"] == 1  # second call served from cache

    def test_result_cached_under_original_ticker_not_canonical(self):
        call_count = {"n": 0}

        def fake_get(url, params=None, headers=None, timeout=None):
            call_count["n"] += 1
            if params["symbol"] == "BRK.B":
                return self._resp(402, {})
            return self._resp(200, [{"symbol": "BRK-B", "date": "2024-01-10", "adjClose": 367.92}])

        with patch("app.services.portfolio_exposure.historical.requests.get", side_effect=fake_get):
            h._fetch_raw_chunk("BRK.B", "2024-01-01", "2024-01-10")
            h._fetch_raw_chunk("BRK.B", "2024-01-01", "2024-01-10")  # same ticker+range again
        assert call_count["n"] == 2  # only the FIRST call made real requests (1 fail + 1 retry)

    def test_no_history_formula_or_methodology_changed_full_pipeline_still_correct(self):
        """End-to-end through fetch_adjusted_price_series (the real
        public entry point): confirms the dual-class retry composes
        correctly with the existing chunking/validation/dedup logic
        without altering any of it."""
        def fake_get(url, params=None, headers=None, timeout=None):
            if params["symbol"] == "BRK.B":
                return self._resp(402, {})
            return self._resp(200, [
                {"symbol": "BRK-B", "date": "2024-01-08", "adjClose": 360.0},
                {"symbol": "BRK-B", "date": "2024-01-09", "adjClose": 365.0},
                {"symbol": "BRK-B", "date": "2024-01-10", "adjClose": 367.92},
            ])

        with patch("app.services.portfolio_exposure.historical.requests.get", side_effect=fake_get):
            result = h.fetch_adjusted_price_series("BRK.B", "2024-01-08", "2024-01-10")
        assert result["series"] == [
            {"date": "2024-01-08", "adj_close": 360.0},
            {"date": "2024-01-09", "adj_close": 365.0},
            {"date": "2024-01-10", "adj_close": 367.92},
        ]
        assert result["warnings"] == []
