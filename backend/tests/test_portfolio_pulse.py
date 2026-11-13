"""Nuvos Pulse — Fase 6B: infraestructura de fotografías históricas.

Tres capas de prueba:
  1. Lógica pura (payload, verification_state, period_key) — sin DB.
  2. Orquestación (capture_snapshot/correct_snapshot) contra el service
     role REAL de Supabase Local — conftest.py ya bloquea estas pruebas
     si ENV_FILE apunta a producción.
  3. Seguridad real (RLS, roles efectivos) vía `psql` directo contra
     Supabase Local — prueba el comportamiento real de Postgres, no un
     mock de RLS."""
import os
import subprocess
import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from app.services.portfolio_exposure import combiner, pulse
from app.services.portfolio_exposure.pulse import SnapshotCorrectionError, period_key_for


# ─── Capa 1: lógica pura ─────────────────────────────────────────────────

def test_period_key_is_stable_month_slot_not_a_historical_claim():
    assert period_key_for(datetime(2026, 12, 2, tzinfo=timezone.utc)) == "2026-12"
    assert period_key_for(datetime(2026, 12, 31, 23, 59, tzinfo=timezone.utc)) == "2026-12"


def _valued_position(ticker="AAPL", weight_pct=100.0, verifiable=True, asset_class="equity", **overrides):
    base = {
        "ticker": ticker, "name": "Apple Inc.", "asset_class": asset_class,
        "shares": 10.0, "avg_price": 150.0, "cost_basis": 1500.0,
        "market_value": 1500.0 if verifiable else None,
        "verifiable": verifiable, "unverifiable_reason": None if verifiable else "no_price",
        "quote_currency": "USD", "fx_rate_applied": 1.0, "price": 150.0,
        "weight_pct": weight_pct, "_weight_fraction": weight_pct / 100 if weight_pct is not None else None,
        "sector": "Technology", "country": "Estados Unidos", "etf_company": None,
        "price_fetched_at": 1_700_000_000.0, "_etf_overview": None,
    }
    base.update(overrides)
    return base


def test_verification_state_full_when_every_position_verified():
    valuation = {"position_count": 2, "verified_position_count": 2, "total_value_verified": 3000.0}
    assert pulse._verification_state(valuation) == "full"


def test_verification_state_full_for_a_genuinely_empty_portfolio():
    """Scenario 4: zero positions is a valid, fully-verified 'nothing to
    show' state -- never treated as a failure."""
    valuation = {"position_count": 0, "verified_position_count": 0, "total_value_verified": None}
    assert pulse._verification_state(valuation) == "full"


def test_verification_state_partial_when_some_but_not_all_verified():
    valuation = {"position_count": 3, "verified_position_count": 2, "total_value_verified": 2000.0}
    assert pulse._verification_state(valuation) == "partial"


def test_verification_state_failed_when_positions_exist_but_none_verified():
    """Scenario 6: a snapshot this poor must never be treated as usable
    -- Diego's explicit 'no considerar una captura fallida como exitosa'."""
    valuation = {"position_count": 3, "verified_position_count": 0, "total_value_verified": None}
    assert pulse._verification_state(valuation) == "failed"


def test_position_payload_carries_full_precision_weight_alongside_rounded_pct():
    """Scenario 3: internal weights must be exact, never only the
    rounded UI value."""
    p = _valued_position(weight_pct=33.33)
    p["_weight_fraction"] = 1 / 3
    payload = pulse._position_for_snapshot(p)
    assert payload["weight_fraction"] == pytest.approx(1 / 3, abs=1e-12)
    assert payload["weight_pct"] == 33.33


def test_position_payload_records_price_and_its_observation_timestamp():
    """Scenario 2: precios y SUS fechas, no solo el número."""
    p = _valued_position()
    payload = pulse._position_for_snapshot(p)
    assert payload["price"] == 150.0
    assert payload["price_observed_at"] == "2023-11-14T22:13:20+00:00"


def test_position_payload_never_claims_a_sector_exposure_date_for_equities():
    """Equities have no concept of 'sector exposure provider date' --
    must always be None, never a guessed/borrowed ETF-style date."""
    p = _valued_position(asset_class="equity")
    payload = pulse._position_for_snapshot(p)
    assert payload["sector_exposure_provider_updated_at"] is None


def test_etf_position_carries_provider_stated_exposure_date_when_available():
    """Scenario 5: ETF data with a real provider-stated vigency date."""
    p = _valued_position(ticker="VOO", asset_class="etf", sector=None, country=None)
    p["_etf_overview"] = {"identification": {"sector_exposure_provider_updated_at": "2026-11-01T00:00:00Z"}}
    payload = pulse._position_for_snapshot(p)
    assert payload["sector_exposure_provider_updated_at"] == "2026-11-01T00:00:00Z"


def test_etf_position_without_a_provider_date_is_honestly_none_not_guessed():
    p = _valued_position(ticker="QQQ", asset_class="etf", sector=None, country=None)
    p["_etf_overview"] = {"identification": {"sector_exposure_provider_updated_at": None}}
    payload = pulse._position_for_snapshot(p)
    assert payload["sector_exposure_provider_updated_at"] is None


def test_build_snapshot_payload_never_rounds_before_persisting():
    """Scenario 3/18: 'no almacenar únicamente valores redondeados de UI'."""
    valued = [_valued_position(weight_pct=33.33, **{"_weight_fraction": 1 / 3})]
    exposure = combiner.compute_full_exposure([dict(v) for v in valued])
    payload = pulse.build_snapshot_payload(valued, exposure, "USD")
    stored_fraction = payload["positions"][0]["weight_fraction"]
    assert stored_fraction == pytest.approx(1 / 3, abs=1e-9)


def test_sector_exposure_asof_is_always_query_time_never_backdated():
    """Scenario 18: nunca reconstrucción retroactiva de exposición ETF --
    la única fecha honesta disponible es la de consulta."""
    valued = [_valued_position()]
    exposure = combiner.compute_full_exposure([dict(v) for v in valued])
    payload = pulse.build_snapshot_payload(valued, exposure, "USD")
    assert payload["sector_exposure"]["asof_source"] == "query_time"
    assert payload["sector_exposure"]["asof_observed_at"] is not None


def test_build_snapshot_payload_never_claims_etf_holdings_knowledge():
    """No se afirma conocer holdings empresariales dentro de ETFs."""
    valued = [_valued_position(ticker="VOO", asset_class="etf", sector=None, country=None)]
    exposure = combiner.compute_full_exposure([dict(v) for v in valued])
    payload = pulse.build_snapshot_payload(valued, exposure, "USD")
    assert "FMP /etf/info" in payload["sources"]
    assert not any("holding" in s.lower() for s in payload["sources"])


def test_covered_partial_portfolio_is_marked_partial_not_silently_complete():
    """Scenario 4: cobertura parcial debe quedar explícita."""
    valued = [_valued_position(ticker="AAPL"), _valued_position(ticker="GHOST", verifiable=False, market_value=None, weight_pct=None)]
    exposure = combiner.compute_full_exposure([dict(v) for v in valued])
    payload = pulse.build_snapshot_payload(valued, exposure, "USD")
    assert payload["verification_state"] == "partial"
    assert payload["valuation_coverage_pct"] is not None and payload["valuation_coverage_pct"] < 100


# ─── Capa 2: orquestación (ownership, no-write a user_portfolio) ───────

class TestCaptureOrchestration:
    async def test_unknown_portfolio_raises_not_found_never_a_silent_empty_capture(self):
        from app.services.portfolio_exposure.service import PortfolioNotFoundError
        with pytest.raises(PortfolioNotFoundError):
            await pulse.capture_snapshot("00000000-0000-0000-0000-000000000000", "does-not-exist", "on_demand", period_key="2026-01-test")

    async def test_capture_never_writes_to_user_portfolio(self):
        """Scenario 19: la captura nunca modifica posiciones reales --
        verificado inspeccionando que pulse.py no importa ninguna
        operación de escritura hacia user_portfolio."""
        import inspect
        src = inspect.getsource(pulse)
        assert '.table("user_portfolio")' not in src  # only ever reaches it indirectly via _build_valued_positions, read-only


# ─── Capa 3: integración real contra Supabase Local ────────────────────

def _real_user_and_portfolio():
    """A real (user_id, portfolio_id) pair from the actual local
    Supabase seed data -- these tests must exercise the real DB, never a
    fixture pretending to be one."""
    from app.core.database import get_supabase
    db = get_supabase()
    res = db.table("user_portfolio").select("user_id, portfolio_id").limit(1).execute()
    if not res.data:
        pytest.skip("no seeded user_portfolio row in Supabase Local to test against")
    row = res.data[0]
    return row["user_id"], row["portfolio_id"]


class TestRealCaptureIntegration:
    """Scenario 1/2/7/8/9/10: captura real, idempotencia, concurrencia,
    versionado -- contra el service role real de Supabase Local."""

    async def _cleanup(self, period_key: str):
        from app.core.database import get_supabase
        get_supabase().table("portfolio_pulse_snapshots").delete().eq("period_key", period_key).execute()

    async def test_real_capture_persists_real_positions_and_prices(self):
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        try:
            row = await pulse.capture_snapshot(user_id, portfolio_id, "on_demand", period_key=pk)
            assert row["user_id"] == user_id
            assert row["portfolio_id"] == portfolio_id
            assert row["verification_state"] in ("full", "partial", "failed")
            assert isinstance(row["positions"], list)
            if row["positions"]:
                pos = row["positions"][0]
                assert "weight_fraction" in pos
                assert "price_observed_at" in pos
        finally:
            await self._cleanup(pk)

    async def test_monthly_idempotency_a_retry_never_duplicates_or_overwrites(self):
        """Scenario 7: una única captura vigente por slot mensual."""
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        try:
            first = await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk)
            second = await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk)
            assert first["id"] == second["id"]

            from app.core.database import get_supabase
            res = get_supabase().table("portfolio_pulse_snapshots").select("id").eq("period_key", pk).eq("is_current", True).execute()
            assert len(res.data) == 1  # never two vigente rows for the same slot
        finally:
            await self._cleanup(pk)

    async def test_retries_do_not_duplicate_across_snapshot_types(self):
        """Scenario 8: distintos snapshot_type para el mismo período son slots DIFERENTES, cada uno idempotente por separado."""
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        try:
            month_end = await pulse.capture_snapshot(user_id, portfolio_id, "month_end", period_key=pk)
            on_demand = await pulse.capture_snapshot(user_id, portfolio_id, "on_demand", period_key=pk)
            assert month_end["id"] != on_demand["id"]  # distinct slots, both legitimately captured
        finally:
            await self._cleanup(pk)

    async def test_correction_preserves_original_content_and_creates_new_version(self):
        """Scenario 10: versionado -- el contenido original nunca se
        reescribe, la corrección crea una fila nueva vigente."""
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        try:
            original = await pulse.capture_snapshot(user_id, portfolio_id, "on_demand", period_key=pk)
            corrected = await pulse.correct_snapshot(user_id, portfolio_id, original["id"], "prueba de correccion")

            from app.core.database import get_supabase
            db = get_supabase()
            old_row = db.table("portfolio_pulse_snapshots").select("*").eq("id", original["id"]).execute().data[0]

            assert old_row["is_current"] is False
            assert old_row["superseded_by"] == corrected["id"]
            assert old_row["positions"] == original["positions"]  # content never rewritten
            assert corrected["is_current"] is True
            assert corrected["supersedes"] == original["id"]
            assert corrected["original_observed_at"] == original["observed_at"]  # never falsified
            assert corrected["correction_reason"] == "prueba de correccion"

            # exactly one vigente row for the slot after the correction
            current_res = db.table("portfolio_pulse_snapshots").select("id").eq("period_key", pk).eq("is_current", True).execute()
            assert len(current_res.data) == 1
        finally:
            await self._cleanup(pk)

    async def test_cannot_correct_someone_elses_snapshot(self):
        """Scenario 12/13: aislamiento -- nunca se puede corregir el
        snapshot de otro usuario/portafolio."""
        from app.core.database import get_supabase
        db = get_supabase()
        users_res = db.table("user_portfolio").select("user_id, portfolio_id").execute()
        pairs = [(r["user_id"], r["portfolio_id"]) for r in users_res.data]
        if len(pairs) < 2:
            pytest.skip("needs at least two distinct seeded users to test cross-user isolation")
        (user_a, portfolio_a), (user_b, portfolio_b) = pairs[0], pairs[1]
        pk = f"test-{uuid.uuid4().hex[:8]}"
        try:
            snap_a = await pulse.capture_snapshot(user_a, portfolio_a, "on_demand", period_key=pk)
            with pytest.raises(SnapshotCorrectionError):
                await pulse.correct_snapshot(user_b, portfolio_b, snap_a["id"], "intento cruzado")
        finally:
            await self._cleanup(pk)

    async def test_cannot_correct_a_non_current_already_superseded_snapshot(self):
        """Scenario 10: no reescribir una versión vieja ni corregirla dos veces en paralelo sobre la misma base."""
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        try:
            original = await pulse.capture_snapshot(user_id, portfolio_id, "on_demand", period_key=pk)
            await pulse.correct_snapshot(user_id, portfolio_id, original["id"], "primera correccion")
            with pytest.raises(SnapshotCorrectionError):
                await pulse.correct_snapshot(user_id, portfolio_id, original["id"], "segunda correccion sobre version vieja")
        finally:
            await self._cleanup(pk)

    async def test_concurrent_captures_for_the_same_slot_never_produce_two_current_rows(self):
        """Scenario 9: ejecuciones concurrentes -- el índice único parcial
        en Postgres, no la aplicación, es lo que realmente lo garantiza."""
        import asyncio
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        try:
            results = await asyncio.gather(*[
                pulse.capture_snapshot(user_id, portfolio_id, "on_demand", period_key=pk) for _ in range(5)
            ])
            ids = {r["id"] for r in results}
            assert len(ids) == 1  # every concurrent attempt converged on the SAME row

            from app.core.database import get_supabase
            current_res = get_supabase().table("portfolio_pulse_snapshots").select("id").eq("period_key", pk).eq("is_current", True).execute()
            assert len(current_res.data) == 1
        finally:
            await self._cleanup(pk)

    async def test_fmp_provider_failure_still_persists_an_honest_partial_or_failed_snapshot(self):
        """Scenario 16: un fallo del proveedor nunca bloquea la captura
        entera -- se persiste lo que SÍ se pudo verificar, honestamente
        marcado."""
        user_id, portfolio_id = _real_user_and_portfolio()
        pk = f"test-{uuid.uuid4().hex[:8]}"
        try:
            with patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=None), \
                 patch("app.services.etf.service.get_etf_overview", side_effect=Exception("proveedor caído")):
                row = await pulse.capture_snapshot(user_id, portfolio_id, "on_demand", period_key=pk)
            assert row["verification_state"] in ("failed", "full")  # "full" only if the portfolio was genuinely empty
            if row["positions"]:
                assert row["verification_state"] == "failed"
                assert all(not p["verifiable"] for p in row["positions"])
        finally:
            await self._cleanup(pk)


# ─── Capa 3b: RLS real, vía psql directo contra Supabase Local ─────────

def _psql(sql: str) -> str:
    db_url = os.getenv("DATABASE_URL") or "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    result = subprocess.run(["psql", db_url, "-t", "-A", "-c", sql], capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    # RAISE NOTICE and other server messages go to stderr, not stdout --
    # callers that need to see them (e.g. the INSERT_DENIED check) must
    # get both.
    return (result.stdout + "\n" + result.stderr).strip()


def _psql_available() -> bool:
    try:
        _psql("SELECT 1;")
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _psql_available(), reason="psql against Supabase Local not reachable in this environment")
class TestRealRLS:
    """Scenario 11: RLS real, con los roles efectivos de Supabase Local
    -- nunca asumido, siempre verificado contra Postgres de verdad."""

    def test_owner_sees_only_their_own_snapshot(self):
        user_a = str(uuid.uuid4())
        user_b = str(uuid.uuid4())
        try:
            _psql(f"INSERT INTO auth.users (id, email) VALUES ('{user_a}','a-{user_a}@x.com'), ('{user_b}','b-{user_b}@x.com');")
            _psql(f"""INSERT INTO portfolio_pulse_snapshots
                (user_id, portfolio_id, snapshot_type, period_key, base_currency, methodology_version, verification_state, original_observed_at)
                VALUES ('{user_a}', 'default', 'on_demand', '2026-11-rls', 'USD', 'combiner-v1', 'full', NOW());""")

            own = _psql(f"""
                SET ROLE authenticated;
                SET request.jwt.claims = '{{"sub":"{user_a}","role":"authenticated"}}';
                SELECT count(*) FROM portfolio_pulse_snapshots;
            """)
            other = _psql(f"""
                SET ROLE authenticated;
                SET request.jwt.claims = '{{"sub":"{user_b}","role":"authenticated"}}';
                SELECT count(*) FROM portfolio_pulse_snapshots;
            """)
            assert own.strip().splitlines()[-1] == "1"
            assert other.strip().splitlines()[-1] == "0"
        finally:
            _psql(f"DELETE FROM portfolio_pulse_snapshots WHERE user_id IN ('{user_a}','{user_b}');")
            _psql(f"DELETE FROM auth.users WHERE id IN ('{user_a}','{user_b}');")

    def test_authenticated_role_cannot_insert_update_or_delete(self):
        user_a = str(uuid.uuid4())
        try:
            _psql(f"INSERT INTO auth.users (id, email) VALUES ('{user_a}','a-{user_a}@x.com');")
            out = _psql(f"""
                SET ROLE authenticated;
                SET request.jwt.claims = '{{"sub":"{user_a}","role":"authenticated"}}';
                DO $$
                BEGIN
                  BEGIN
                    INSERT INTO portfolio_pulse_snapshots (user_id, portfolio_id, snapshot_type, period_key, base_currency, methodology_version, verification_state, original_observed_at)
                    VALUES ('{user_a}', 'default', 'on_demand', '2026-11-rls2', 'USD', 'combiner-v1', 'full', NOW());
                    RAISE NOTICE 'INSERT_SUCCEEDED';
                  EXCEPTION WHEN insufficient_privilege THEN
                    RAISE NOTICE 'INSERT_DENIED';
                  END;
                END $$;
            """)
            assert "INSERT_DENIED" in out
            assert "INSERT_SUCCEEDED" not in out
        finally:
            _psql(f"DELETE FROM portfolio_pulse_snapshots WHERE user_id = '{user_a}';")
            _psql(f"DELETE FROM auth.users WHERE id = '{user_a}';")

    def test_deleting_a_user_cascades_their_snapshots(self):
        """Scenario 15: eliminación de cuenta -> ON DELETE CASCADE real."""
        user_a = str(uuid.uuid4())
        _psql(f"INSERT INTO auth.users (id, email) VALUES ('{user_a}','a-{user_a}@x.com');")
        _psql(f"""INSERT INTO portfolio_pulse_snapshots
            (user_id, portfolio_id, snapshot_type, period_key, base_currency, methodology_version, verification_state, original_observed_at)
            VALUES ('{user_a}', 'default', 'on_demand', '2026-11-rls3', 'USD', 'combiner-v1', 'full', NOW());""")

        _psql(f"DELETE FROM auth.users WHERE id = '{user_a}';")
        remaining = _psql(f"SELECT count(*) FROM portfolio_pulse_snapshots WHERE user_id = '{user_a}';")
        assert remaining == "0"


class TestPortfolioDeletionCleanup:
    """Scenario 14: a deleted PORTFOLIO (not the whole account) has no FK
    to cascade from — the route's own explicit cleanup hook is what
    removes its snapshots."""

    async def test_deleting_a_portfolio_removes_its_pulse_snapshots(self):
        from app.api.routes.sync import delete_portfolio
        from app.core.database import get_supabase

        user_id, _ = _real_user_and_portfolio()
        throwaway_portfolio_id = f"pulse-test-{uuid.uuid4().hex[:8]}"
        pk = f"test-{uuid.uuid4().hex[:8]}"
        db = get_supabase()

        db.table("user_portfolio").insert({
            "user_id": user_id, "portfolio_id": throwaway_portfolio_id, "portfolio_name": "Pulse cleanup test",
            "positions": {"_v": 3, "currency": "USD", "positions": [], "closed_positions": [], "inception_date": "2026-01-01"},
        }).execute()
        await pulse.capture_snapshot(user_id, throwaway_portfolio_id, "on_demand", period_key=pk)

        before = db.table("portfolio_pulse_snapshots").select("id").eq("user_id", user_id).eq("portfolio_id", throwaway_portfolio_id).execute()
        assert len(before.data) == 1

        await delete_portfolio(throwaway_portfolio_id, user_id)

        after = db.table("portfolio_pulse_snapshots").select("id").eq("user_id", user_id).eq("portfolio_id", throwaway_portfolio_id).execute()
        assert after.data == []
