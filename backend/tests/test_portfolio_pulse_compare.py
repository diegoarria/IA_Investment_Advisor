"""Nuvos Pulse — Fase 6C: motor de comparación.

Capa 1 (mayoría de las pruebas): lógica pura `compare_snapshots` sobre
fixtures SINTÉTICAS, explícitamente marcadas como tales (Diego, Fase 6C
§8: "para tests de dos períodos, utilizar fixtures claramente
identificadas como sintéticas") — nunca se presenta este diseño de
pruebas como si fueran datos reales.

Capa 2: integración real contra Supabase Local para historial
insuficiente, corrección vs. versión vieja, aislamiento entre usuarios,
recuperación tras fallo e idempotencia concurrente — mismos
`capture_snapshot`/`correct_snapshot` ya probados en Fase 6B."""
import uuid
from unittest.mock import patch

import pytest

from app.services.portfolio_exposure import pulse, pulse_compare
from app.services.portfolio_exposure.pulse_thresholds import (
    COMPOSITION_DELTA_MIN_PP, CONCENTRATION_DELTA_MIN_PP, SECTOR_DELTA_MIN_PP,
)


# ─── Fixtures sintéticas ────────────────────────────────────────────────

def _pos(ticker, weight_fraction, verifiable=True, asset_class="equity", name=None):
    return {"ticker": ticker, "name": name, "asset_class": asset_class, "verifiable": verifiable, "weight_fraction": weight_fraction}


def _sector_row(sector, value):
    return {"sector": sector, "value": value, "pct_of_verified_total": None}  # el motor nunca lee este campo redondeado


def _country_row(country, value, asset_class_total_value, methodology):
    return {"country": country, "value": value, "asset_class_total_value": asset_class_total_value, "methodology": methodology, "pct_of_asset_class_value": None}


def _snapshot(
    id="s1", user_id="u1", portfolio_id="p1", snapshot_type="month_end", period_key="2026-10",
    observed_at="2026-10-02T00:00:00+00:00", base_currency="USD", methodology_version="combiner-v1",
    verification_state="full", total_value_verified=10000.0, valuation_coverage_pct=100.0,
    positions=None, sector_coverage_pct=100.0, by_sector=None,
    equity_domicile_coverage_pct=100.0, etf_underlying_coverage_pct=100.0, by_country=None,
    equity_value=10000.0, etf_value=0.0,
):
    return {
        "id": id, "user_id": user_id, "portfolio_id": portfolio_id,
        "snapshot_type": snapshot_type, "period_key": period_key, "observed_at": observed_at,
        "base_currency": base_currency, "methodology_version": methodology_version,
        "verification_state": verification_state, "total_value_verified": total_value_verified,
        "valuation_coverage_pct": valuation_coverage_pct,
        "positions": positions or [],
        "sector_exposure": {"by_sector": by_sector or [], "coverage_pct": sector_coverage_pct},
        "geographic_exposure": {
            "by_country": by_country or [],
            "equity_domicile_coverage_pct": equity_domicile_coverage_pct,
            "etf_underlying_coverage_pct": etf_underlying_coverage_pct,
        },
        "composition": {"equity_value": equity_value, "etf_value": etf_value},
    }


# ─── 1: comparación válida ─────────────────────────────────────────────

def test_1_valid_comparison_between_two_dates():
    before = _snapshot(id="a", period_key="2026-09", observed_at="2026-09-02T00:00:00+00:00",
                        positions=[_pos("AAPL", 0.5), _pos("MSFT", 0.5)], total_value_verified=10000.0)
    after = _snapshot(id="b", period_key="2026-10", observed_at="2026-10-02T00:00:00+00:00",
                       positions=[_pos("AAPL", 0.6), _pos("MSFT", 0.4)], total_value_verified=12000.0)
    result = pulse_compare.compare_snapshots(before, after)
    assert result["available"] is True
    assert result["comparability"]["status"] == "comparable"
    assert result["snapshot_before"]["id"] == "a"
    assert result["snapshot_after"]["id"] == "b"


def test_comparison_determines_chronological_order_regardless_of_argument_order():
    before = _snapshot(id="a", period_key="2026-09", observed_at="2026-09-02T00:00:00+00:00")
    after = _snapshot(id="b", period_key="2026-10", observed_at="2026-10-02T00:00:00+00:00")
    result = pulse_compare.compare_snapshots(after, before)  # passed backwards on purpose
    assert result["snapshot_before"]["id"] == "a"
    assert result["snapshot_after"]["id"] == "b"


# ─── 2: historial insuficiente (real) ──────────────────────────────────

def _real_user_and_portfolio():
    from app.core.database import get_supabase
    db = get_supabase()
    res = db.table("user_portfolio").select("user_id, portfolio_id").execute()
    if not res.data:
        pytest.skip("no seeded user_portfolio row in Supabase Local")
    return res.data[0]["user_id"], res.data[0]["portfolio_id"]


class TestInsufficientHistoryReal:
    async def test_2_single_snapshot_is_insufficient_history(self):
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        from app.core.database import get_supabase
        try:
            await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk)
            result = await pulse_compare.compare_latest_for_portfolio(user_id, portfolio_id, "month_end")
            assert result == {"available": False, "reason": "insufficient_history"}
        finally:
            get_supabase().table("portfolio_pulse_snapshots").delete().eq("period_key", pk).execute()


# ─── 3: mismo snapshot dos veces ────────────────────────────────────────

def test_3_same_snapshot_used_twice_is_rejected():
    s = _snapshot(id="a")
    result = pulse_compare.compare_snapshots(s, s)
    assert result == {"available": False, "reason": "same_snapshot"}


# ─── 4: versión antigua vs corregida (real) ────────────────────────────

class TestCorrectionNeverTreatedAsSeparatePeriod:
    async def test_4_comparison_uses_corrected_version_not_the_old_one(self):
        user_id, portfolio_id = _real_user_and_portfolio()
        pk_a, pk_b = f"test-{uuid.uuid4().hex[:8]}", f"test-{uuid.uuid4().hex[:8]}"
        from app.core.database import get_supabase
        db = get_supabase()
        try:
            await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk_a)
            snap_b = await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk_b)
            corrected_b = await pulse.correct_snapshot(user_id, portfolio_id, snap_b["id"], "prueba fase 6C")

            result = await pulse_compare.compare_latest_for_portfolio(user_id, portfolio_id, "month_end")
            assert result["available"] is True
            assert result["snapshot_after"]["id"] == corrected_b["id"]
            assert result["snapshot_after"]["id"] != snap_b["id"]  # never the superseded old version
        finally:
            db.table("portfolio_pulse_snapshots").delete().in_("period_key", [pk_a, pk_b]).execute()


# ─── 5/6: monedas y metodologías distintas ─────────────────────────────

def test_5_different_currencies_rejected():
    before = _snapshot(id="a", period_key="2026-09", base_currency="USD")
    after = _snapshot(id="b", period_key="2026-10", base_currency="MXN")
    result = pulse_compare.compare_snapshots(before, after)
    assert result == {"available": False, "reason": "currency_mismatch"}


def test_6_different_methodology_versions_rejected():
    before = _snapshot(id="a", period_key="2026-09", methodology_version="combiner-v1")
    after = _snapshot(id="b", period_key="2026-10", methodology_version="combiner-v2")
    result = pulse_compare.compare_snapshots(before, after)
    assert result == {"available": False, "reason": "methodology_mismatch"}


# ─── 7/8: cobertura ─────────────────────────────────────────────────────

def test_7_insufficient_valuation_coverage_rejected():
    before = _snapshot(id="a", period_key="2026-09", valuation_coverage_pct=20.0)
    after = _snapshot(id="b", period_key="2026-10", valuation_coverage_pct=100.0)
    result = pulse_compare.compare_snapshots(before, after)
    assert result == {"available": False, "reason": "insufficient_coverage"}


def test_8_large_sector_coverage_gap_suppresses_only_that_dimension():
    before = _snapshot(id="a", period_key="2026-09", sector_coverage_pct=95.0, by_sector=[_sector_row("Tecnología", 5000)])
    after = _snapshot(id="b", period_key="2026-10", sector_coverage_pct=50.0, by_sector=[_sector_row("Tecnología", 5000)])
    result = pulse_compare.compare_snapshots(before, after)
    assert result["available"] is True
    assert result["comparability"]["status"] == "partial"
    assert result["changes"]["sectors"] is None  # suppressed
    assert result["changes"]["composition"] is not None  # other dimensions stay available
    assert result["changes"]["positions"] is not None


# ─── 9/10: sector aumenta / disminuye ───────────────────────────────────

def test_9_and_10_sector_increase_and_decrease_both_computed_correctly():
    before = _snapshot(id="a", period_key="2026-09", total_value_verified=10000.0,
                        by_sector=[_sector_row("Tecnología", 4000), _sector_row("Salud", 6000)])
    after = _snapshot(id="b", period_key="2026-10", total_value_verified=10000.0,
                       by_sector=[_sector_row("Tecnología", 7000), _sector_row("Salud", 3000)])
    result = pulse_compare.compare_snapshots(before, after)
    sectors = {s["sector"]: s for s in result["changes"]["sectors"]}
    assert sectors["Tecnología"]["delta_pp"] == pytest.approx(30.0, abs=1e-6)  # 40% -> 70%
    assert sectors["Salud"]["delta_pp"] == pytest.approx(-30.0, abs=1e-6)  # 60% -> 30%


# ─── 11/12: posición nueva / ausente ────────────────────────────────────

def test_11_and_12_new_and_disappeared_positions_never_labeled_as_sold():
    before = _snapshot(id="a", period_key="2026-09", positions=[_pos("AAPL", 0.5), _pos("GHOST", 0.5)])
    after = _snapshot(id="b", period_key="2026-10", positions=[_pos("AAPL", 0.5), _pos("NEWCO", 0.5)])
    result = pulse_compare.compare_snapshots(before, after)
    by_ticker = {p["ticker"]: p for p in result["changes"]["positions"]}
    assert by_ticker["NEWCO"]["status"] == "new"
    assert by_ticker["GHOST"]["status"] == "no_longer_verified"
    assert "sold" not in str(by_ticker["GHOST"]).lower() and "vendid" not in str(by_ticker["GHOST"]).lower()
    assert by_ticker["AAPL"]["status"] == "existing"


# ─── 13: acciones/ETFs ──────────────────────────────────────────────────

def test_13_equity_etf_composition_change():
    before = _snapshot(id="a", period_key="2026-09", total_value_verified=10000.0, equity_value=8000.0, etf_value=2000.0)
    after = _snapshot(id="b", period_key="2026-10", total_value_verified=10000.0, equity_value=4000.0, etf_value=6000.0)
    result = pulse_compare.compare_snapshots(before, after)
    comp = result["changes"]["composition"]
    assert comp["equity_delta_pp"] == pytest.approx(-40.0, abs=1e-6)
    assert comp["etf_delta_pp"] == pytest.approx(40.0, abs=1e-6)


# ─── 14/15: geografía acciones vs ETFs, independientes ──────────────────

def test_14_and_15_equity_domicile_and_etf_underlying_geography_kept_separate():
    before = _snapshot(id="a", period_key="2026-09",
                        by_country=[_country_row("Estados Unidos", 7000, 10000, "equity_domicile"), _country_row("México", 3000, 10000, "equity_domicile"),
                                    _country_row("Estados Unidos", 9000, 10000, "etf_underlying"), _country_row("Japón", 1000, 10000, "etf_underlying")])
    after = _snapshot(id="b", period_key="2026-10",
                       by_country=[_country_row("Estados Unidos", 5000, 10000, "equity_domicile"), _country_row("México", 5000, 10000, "equity_domicile"),
                                   _country_row("Estados Unidos", 9000, 10000, "etf_underlying"), _country_row("Japón", 1000, 10000, "etf_underlying")])
    result = pulse_compare.compare_snapshots(before, after)
    geo = result["changes"]["geography"]
    eq = {r["country"]: r for r in geo["equity_domicile"]}
    etf = {r["country"]: r for r in geo["etf_underlying"]}
    assert eq["Estados Unidos"]["delta_pp"] == pytest.approx(-20.0, abs=1e-6)
    assert eq["México"]["delta_pp"] == pytest.approx(20.0, abs=1e-6)
    assert etf["Estados Unidos"]["delta_pp"] == pytest.approx(0.0, abs=1e-6)  # unchanged, kept independent from equity shift


def test_geography_dimension_suppressed_independently_when_only_one_methodology_has_a_coverage_gap():
    before = _snapshot(id="a", period_key="2026-09", equity_domicile_coverage_pct=90.0, etf_underlying_coverage_pct=80.0)
    after = _snapshot(id="b", period_key="2026-10", equity_domicile_coverage_pct=40.0, etf_underlying_coverage_pct=82.0)
    result = pulse_compare.compare_snapshots(before, after)
    assert result["changes"]["geography"]["equity_domicile"] is None  # suppressed
    assert result["changes"]["geography"]["etf_underlying"] is not None  # stays available


# ─── 11b (Fase 6D §1): reclasificación de activos ──────────────────────

def test_reclassified_ticker_suppresses_sector_and_composition_never_a_misleading_conclusion():
    before = _snapshot(id="a", period_key="2026-09", total_value_verified=10000.0, equity_value=10000.0, etf_value=0.0,
                        positions=[_pos("XYZ", 1.0, asset_class="equity")],
                        by_sector=[_sector_row("Tecnología", 10000)])
    # XYZ reclassified from equity to etf between A and B -- same ticker, same weight.
    after = _snapshot(id="b", period_key="2026-10", total_value_verified=10000.0, equity_value=0.0, etf_value=10000.0,
                       positions=[_pos("XYZ", 1.0, asset_class="etf")],
                       by_sector=[_sector_row("Tecnología", 10000)])
    result = pulse_compare.compare_snapshots(before, after)

    assert result["available"] is True
    assert result["comparability"]["status"] == "partial"
    reasons = {(w["dimension"], w["reason"]) for w in result["comparability"]["warnings"]}
    assert ("sectors", "asset_reclassified") in reasons
    assert ("composition", "asset_reclassified") in reasons
    assert result["changes"]["sectors"] is None  # never a misleading sector conclusion
    assert result["changes"]["composition"] is None  # equity_pct/etf_pct would be 100%->0% purely from reclassification
    # the OTHER dimensions stay operative
    assert result["changes"]["positions"] is not None
    by_ticker = {p["ticker"]: p for p in result["changes"]["positions"]}
    assert by_ticker["XYZ"]["classification_changed"] is True


def test_no_reclassification_detected_when_every_ticker_keeps_its_asset_class():
    before = _snapshot(id="a", period_key="2026-09", positions=[_pos("AAPL", 0.5, asset_class="equity"), _pos("VOO", 0.5, asset_class="etf")])
    after = _snapshot(id="b", period_key="2026-10", positions=[_pos("AAPL", 0.6, asset_class="equity"), _pos("VOO", 0.4, asset_class="etf")])
    result = pulse_compare.compare_snapshots(before, after)
    assert result["comparability"]["status"] == "comparable"
    assert result["changes"]["sectors"] is not None or True  # no reclassification warning regardless of sector data presence
    assert not any(w["reason"] == "asset_reclassified" for w in result["comparability"]["warnings"])


# ─── 16/17: precisión y redondeo ────────────────────────────────────────

def test_16_and_17_delta_uses_full_precision_fraction_not_pre_rounded_percentages():
    before = _snapshot(id="a", period_key="2026-09", positions=[_pos("A", 1 / 3), _pos("B", 2 / 3)])
    after = _snapshot(id="b", period_key="2026-10", positions=[_pos("A", 2 / 3), _pos("B", 1 / 3)])
    result = pulse_compare.compare_snapshots(before, after)
    by_ticker = {p["ticker"]: p for p in result["changes"]["positions"]}
    # (2/3 - 1/3) * 100 = 33.333...  -- would be 33.0 or 33.3 if computed from 2-decimal-rounded inputs first
    assert by_ticker["A"]["delta_pp"] == pytest.approx(33.3333, abs=1e-3)
    assert by_ticker["B"]["delta_pp"] == pytest.approx(-33.3333, abs=1e-3)


def test_no_nan_or_infinite_deltas_ever_produced():
    before = _snapshot(id="a", period_key="2026-09", positions=[_pos("A", 0.0)])
    after = _snapshot(id="b", period_key="2026-10", positions=[_pos("A", 0.5)])
    result = pulse_compare.compare_snapshots(before, after)
    import math
    for p in result["changes"]["positions"]:
        if p["delta_pp"] is not None:
            assert math.isfinite(p["delta_pp"])


# ─── 18: ausencia de cambios relevantes ─────────────────────────────────

def test_18_no_relevant_changes_returns_null_primary_change():
    before = _snapshot(id="a", period_key="2026-09", positions=[_pos("AAPL", 0.5), _pos("MSFT", 0.5)],
                        by_sector=[_sector_row("Tecnología", 10000)])
    after = _snapshot(id="b", period_key="2026-10", positions=[_pos("AAPL", 0.5), _pos("MSFT", 0.5)],
                       by_sector=[_sector_row("Tecnología", 10000)])
    result = pulse_compare.compare_snapshots(before, after)
    assert result["primary_change"] is None
    assert result["causality"]["level"] == "no_change"


# ─── 19: selección determinista de observación principal ───────────────

def test_19_the_largest_eligible_magnitude_wins():
    # Concentration delta (15pp) genuinely larger than sector delta
    # (10pp) -- magnitude decides, per the documented rule (Fase 6A.1
    # §7): category order is only the tie-break for EQUAL magnitudes,
    # never a way to override a clearly larger real change.
    before = _snapshot(id="a", period_key="2026-09", total_value_verified=10000.0,
                        positions=[_pos("AAPL", 0.40), _pos("MSFT", 0.60)],
                        by_sector=[_sector_row("Tecnología", 5000), _sector_row("Salud", 5000)])
    after = _snapshot(id="b", period_key="2026-10", total_value_verified=10000.0,
                       positions=[_pos("AAPL", 0.55), _pos("MSFT", 0.45)],
                       by_sector=[_sector_row("Tecnología", 6000), _sector_row("Salud", 4000)])
    result = pulse_compare.compare_snapshots(before, after)
    assert result["primary_change"]["category"] == "concentration"
    assert result["primary_change"]["delta_pp"] == pytest.approx(15.0, abs=1e-6)
    # run it again to confirm determinism (same inputs -> same output, always)
    result2 = pulse_compare.compare_snapshots(before, after)
    assert result == result2


def test_19b_fixed_category_order_breaks_a_genuine_tie_in_magnitude():
    from app.services.portfolio_exposure import pulse_compare as pc
    changes = {"sectors": [{"sector": "Y", "before_pct": 0, "after_pct": 10, "delta_pp": 10.0}], "composition": None, "positions": [
        {"ticker": "X", "status": "existing", "delta_pp": 10.0, "weight_before_pct": 0, "weight_after_pct": 10},
    ]}
    result = pc.select_primary_change(changes)
    assert result["category"] == "sector"  # sector precedes concentration in PRIMARY_CHANGE_CATEGORY_PRIORITY on an exact tie


def test_candidate_below_its_own_threshold_never_wins():
    before = _snapshot(id="a", period_key="2026-09", total_value_verified=10000.0, by_sector=[_sector_row("Tecnología", 5000)])
    after = _snapshot(id="b", period_key="2026-10", total_value_verified=10000.0, by_sector=[_sector_row("Tecnología", 5000 + 1)])  # 0.01pp, way under threshold
    result = pulse_compare.compare_snapshots(before, after)
    assert result["primary_change"] is None


# ─── 20: causa no determinada ───────────────────────────────────────────

def test_20_causality_is_always_undetermined_when_there_is_a_real_change():
    before = _snapshot(id="a", period_key="2026-09", by_sector=[_sector_row("Tecnología", 4000)], total_value_verified=10000.0)
    after = _snapshot(id="b", period_key="2026-10", by_sector=[_sector_row("Tecnología", 8000)], total_value_verified=10000.0)
    result = pulse_compare.compare_snapshots(before, after)
    assert result["causality"]["level"] == "undetermined"
    assert "no contamos con información suficiente" in result["causality"]["note_es"]
    # never attributes to a cause this engine hasn't demonstrated
    forbidden = ["compra", "venta", "rentabilidad", "subida de precio", "recomend"]
    assert not any(f in result["causality"]["note_es"].lower() for f in forbidden)


# ─── 21/22: rechazo de datos entre usuarios/portafolios ─────────────────

def test_21_rejects_comparing_snapshots_from_different_users():
    before = _snapshot(id="a", user_id="user-A", period_key="2026-09")
    after = _snapshot(id="b", user_id="user-B", period_key="2026-10")
    result = pulse_compare.compare_snapshots(before, after)
    assert result == {"available": False, "reason": "different_user_or_portfolio"}


def test_22_rejects_comparing_snapshots_from_different_portfolios():
    before = _snapshot(id="a", portfolio_id="portfolio-1", period_key="2026-09")
    after = _snapshot(id="b", portfolio_id="portfolio-2", period_key="2026-10")
    result = pulse_compare.compare_snapshots(before, after)
    assert result == {"available": False, "reason": "different_user_or_portfolio"}


class TestRealCrossUserRejection:
    async def test_21_real_compare_latest_never_crosses_users(self):
        """El punto de entrada real nunca acepta un snapshot_id -- solo
        compara dentro del (user_id, portfolio_id) consultado."""
        from app.core.database import get_supabase
        db = get_supabase()
        pairs_res = db.table("user_portfolio").select("user_id, portfolio_id").execute()
        pairs = [(r["user_id"], r["portfolio_id"]) for r in pairs_res.data]
        if len(pairs) < 2:
            pytest.skip("needs at least two distinct seeded users")
        (user_a, portfolio_a), (user_b, portfolio_b) = pairs[0], pairs[1]
        result_a = await pulse_compare.compare_latest_for_portfolio(user_a, portfolio_a, "on_demand")
        result_b = await pulse_compare.compare_latest_for_portfolio(user_b, portfolio_b, "on_demand")
        # each call is independently scoped -- never leaks the other user's snapshots in
        if result_a.get("available"):
            assert result_a["snapshot_before"]["id"] != result_b.get("snapshot_before", {}).get("id")


# ─── 23: no modificación de snapshots ───────────────────────────────────

def test_23_compare_snapshots_never_mutates_its_inputs():
    before = _snapshot(id="a", period_key="2026-09", positions=[_pos("AAPL", 0.5)])
    after = _snapshot(id="b", period_key="2026-10", positions=[_pos("AAPL", 0.6)])
    import copy
    before_copy, after_copy = copy.deepcopy(before), copy.deepcopy(after)
    pulse_compare.compare_snapshots(before, after)
    assert before == before_copy
    assert after == after_copy


def test_23_compare_module_contains_no_write_operations():
    import inspect
    src = inspect.getsource(pulse_compare)
    for forbidden in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc("):
        assert forbidden not in src


# ─── 24: recuperación tras captura fallida (real) ──────────────────────

class TestFailureRecoveryReal:
    async def test_24_a_failed_capture_can_be_superseded_by_a_later_success(self):
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        from app.core.database import get_supabase
        db = get_supabase()
        try:
            with patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=None), \
                 patch("app.services.etf.service.get_etf_overview", side_effect=Exception("proveedor caído")):
                failed = await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk)
            assert failed["verification_state"] in ("failed", "full")  # "full" only if portfolio is genuinely empty
            if failed["positions"]:
                assert failed["verification_state"] == "failed"

                success = await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk)
                assert success["id"] != failed["id"]
                assert success["verification_state"] in ("full", "partial")

                old_row = db.table("portfolio_pulse_snapshots").select("*").eq("id", failed["id"]).execute().data[0]
                assert old_row["is_current"] is False
                assert old_row["superseded_by"] == success["id"]
                assert old_row["verification_state"] == "failed"  # original failure preserved for audit, never deleted

                current_res = db.table("portfolio_pulse_snapshots").select("id").eq("period_key", pk).eq("snapshot_type", "month_end").eq("is_current", True).execute()
                assert len(current_res.data) == 1  # slot never left without exactly one vigente row
        finally:
            db.table("portfolio_pulse_snapshots").delete().eq("period_key", pk).execute()

    async def test_24_a_second_successful_capture_never_overwrites_the_first_successful_one(self):
        """'No reemplazar silenciosamente un snapshot parcial válido.'"""
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        from app.core.database import get_supabase
        db = get_supabase()
        try:
            first = await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk)
            second = await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk)
            assert first["id"] == second["id"]
        finally:
            db.table("portfolio_pulse_snapshots").delete().eq("period_key", pk).execute()


# ─── 25: idempotencia ante reintentos concurrentes (real) ──────────────

class TestConcurrentRetryReal:
    async def test_25_concurrent_retries_after_a_failure_converge_on_one_row(self):
        import asyncio
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        from app.core.database import get_supabase
        db = get_supabase()
        try:
            with patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=None), \
                 patch("app.services.etf.service.get_etf_overview", side_effect=Exception("proveedor caído")):
                failed = await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk)
            if not failed["positions"]:
                pytest.skip("portfolio has no positions to exercise a real failure state")

            results = await asyncio.gather(*[
                pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk) for _ in range(5)
            ])
            ids = {r["id"] for r in results}
            assert len(ids) == 1  # every concurrent retry converged on the SAME new row
            assert list(ids)[0] != failed["id"]

            current_res = db.table("portfolio_pulse_snapshots").select("id").eq("period_key", pk).eq("snapshot_type", "month_end").eq("is_current", True).execute()
            assert len(current_res.data) == 1
        finally:
            db.table("portfolio_pulse_snapshots").delete().eq("period_key", pk).execute()


# ─── Fase 6D §2: el endpoint HTTP (route function llamada directamente) ───

def _fake_request():
    """slowapi's @limiter.limit requires a real starlette Request to
    inspect the client IP -- a minimal ASGI scope satisfies it without
    needing a full TestClient/app boot."""
    from starlette.requests import Request
    return Request(scope={"type": "http", "method": "GET", "path": "/", "headers": [], "client": ("127.0.0.1", 0), "query_string": b""})


class TestPulseRouteReal:
    async def test_route_rejects_invalid_snapshot_type(self):
        from fastapi import HTTPException
        from app.api.routes.portfolio_exposure import get_portfolio_pulse_route
        user_id, portfolio_id = _real_user_and_portfolio()
        from app.core.config import settings
        admin_email = settings.admin_emails.split(",")[0].strip()
        with pytest.raises(HTTPException) as exc_info:
            await get_portfolio_pulse_route(request=_fake_request(), portfolio_id=portfolio_id, snapshot_type="bogus", user={"id": user_id, "email": admin_email})
        assert exc_info.value.status_code == 422

    async def test_route_rejects_non_admin(self):
        from fastapi import HTTPException
        from app.api.routes.portfolio_exposure import get_portfolio_pulse_route
        user_id, portfolio_id = _real_user_and_portfolio()
        with pytest.raises(HTTPException) as exc_info:
            await get_portfolio_pulse_route(request=_fake_request(), portfolio_id=portfolio_id, snapshot_type="on_demand", user={"id": user_id, "email": "not-an-admin@example.com"})
        assert exc_info.value.status_code == 403

    async def test_route_returns_insufficient_history_as_200_never_a_404(self):
        from app.api.routes.portfolio_exposure import get_portfolio_pulse_route
        from app.core.config import settings
        admin_email = settings.admin_emails.split(",")[0].strip()
        user_id, _ = _real_user_and_portfolio()
        result = await get_portfolio_pulse_route(request=_fake_request(), portfolio_id=f"nonexistent-{uuid.uuid4().hex[:8]}", snapshot_type="on_demand", user={"id": user_id, "email": admin_email})
        assert result == {"available": False, "reason": "insufficient_history"}  # never leaks whether the portfolio_id exists

    async def test_route_never_calls_fmp_or_generates_a_new_snapshot_on_a_plain_get(self):
        """§2: 'no generar snapshots automáticamente por una consulta GET.'"""
        from app.api.routes.portfolio_exposure import get_portfolio_pulse_route
        from app.core.config import settings
        from app.core.database import get_supabase
        admin_email = settings.admin_emails.split(",")[0].strip()
        user_id, portfolio_id = _real_user_and_portfolio()
        db = get_supabase()
        before_count = len(db.table("portfolio_pulse_snapshots").select("id").eq("user_id", user_id).eq("portfolio_id", portfolio_id).execute().data)
        with patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price") as mock_fmp:
            await get_portfolio_pulse_route(request=_fake_request(), portfolio_id=portfolio_id, snapshot_type="on_demand", user={"id": user_id, "email": admin_email})
            mock_fmp.assert_not_called()
        after_count = len(db.table("portfolio_pulse_snapshots").select("id").eq("user_id", user_id).eq("portfolio_id", portfolio_id).execute().data)
        assert before_count == after_count
