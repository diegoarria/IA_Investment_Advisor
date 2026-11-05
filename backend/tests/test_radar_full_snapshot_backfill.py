"""
Nuvos Radar full-snapshot backfill extension (migration 117, 2026-10-29).
Diego: "el siguiente objetivo será extender el backfill para producir
snapshots completos de las 927 empresas." Tests compute_full_diagnostic_
valuation, get_pending_tickers' missing_snapshot bucket, and refresh_if_
needed's snapshot-upgrade path — against the same real _FakeDB/_FakeRpc
infra as test_company_valuation_service.py, not a looser mock.
"""
import asyncio
import uuid
from unittest.mock import patch

import app.services.company_valuation_service as cvs
from tests.test_company_valuation_service import _FakeDB, _current_rows


def _run(coro):
    return asyncio.run(coro)


def _clear_cache():
    import app.core.cache as cache_mod
    cache_mod._mem.clear()


# ── compute_full_diagnostic_valuation ──────────────────────────────────────

class TestComputeFullDiagnosticValuation:
    def test_valid_company_gets_snapshot(self):
        fake_data = {"dcf": {"gqv_fair_value": {"status": "ok"}}}
        fake_numeric = {
            "validation_status": "valid", "intrinsic_value_usd": 100.0, "currency": "USD",
            "methodology": "gqv", "model_version": "v1", "financial_report_period": "2026-Q3",
            "assumptions": {},
        }
        fake_diag = {"companyName": "Acme", "scoreLabel": "SOLIDA", "ticker": "ACME"}
        with patch("app.services.fundamental_analysis_service.get_fundamental_analysis", return_value=fake_data), \
             patch.object(cvs, "scenarios_from_fetched_data", return_value=dict(fake_numeric)), \
             patch("app.services.company_diagnostic_service.build_company_diagnostic", return_value=dict(fake_diag)):
            result = cvs.compute_full_diagnostic_valuation("ACME")
        assert result["validation_status"] == "valid"
        assert result["diagnostic_snapshot"]["companyName"] == "Acme"
        assert result["snapshot_schema_version"] == cvs._DIAGNOSTIC_SCHEMA_VERSION_FOR_BACKFILL
        # Never-fabricated narrative — the AI step must not have run.
        assert result["diagnostic_snapshot"]["investmentThesis"] is None
        assert result["diagnostic_snapshot"]["noiseVsReality"] is None
        assert result["diagnostic_snapshot"]["actionPlan"] is None

    def test_reit_or_insufficient_pillar_data_falls_back_to_numeric_only(self):
        """build_company_diagnostic returning None (REIT, missing pillar
        inputs) must not block the numeric result from still being
        returned — same cut-down-but-honest shape the live route serves."""
        fake_data = {"dcf": {"sector_model_note": {"sector_type": "reit"}}}
        fake_numeric = {
            "validation_status": "insufficient_data", "error_detail": "no primary or relative-valuation scenario",
        }
        with patch("app.services.fundamental_analysis_service.get_fundamental_analysis", return_value=fake_data), \
             patch.object(cvs, "scenarios_from_fetched_data", return_value=dict(fake_numeric)), \
             patch("app.services.company_diagnostic_service.build_company_diagnostic", return_value=None):
            result = cvs.compute_full_diagnostic_valuation("DLR")
        assert result["validation_status"] == "insufficient_data"
        assert result["diagnostic_snapshot"] is None
        assert result["snapshot_schema_version"] is None

    def test_build_company_diagnostic_hang_is_abandoned_not_awaited_forever(self):
        """A genuinely-hanging build must not block the backfill tick
        indefinitely — same hard-cap discipline as screener.py's
        _attempt_build, just for a background job instead of an HTTP
        response."""
        import time
        fake_data = {"dcf": {"gqv_fair_value": {"status": "ok"}}}
        fake_numeric = {"validation_status": "valid", "intrinsic_value_usd": 50.0}

        def hangs_forever(ticker, data, lang):
            time.sleep(30)
            return {"companyName": "Never"}

        with patch("app.services.fundamental_analysis_service.get_fundamental_analysis", return_value=fake_data), \
             patch.object(cvs, "scenarios_from_fetched_data", return_value=dict(fake_numeric)), \
             patch("app.services.company_diagnostic_service.build_company_diagnostic", side_effect=hangs_forever), \
             patch.object(cvs, "_FULL_SNAPSHOT_BUILD_TIMEOUT_S", 0.3):
            t0 = time.monotonic()
            result = cvs.compute_full_diagnostic_valuation("SLOW")
            elapsed = time.monotonic() - t0
        assert elapsed < 5.0, f"should abandon after the hard cap, took {elapsed}s"
        assert result["validation_status"] == "valid"  # numeric result still usable
        assert result["diagnostic_snapshot"] is None  # but no snapshot from the abandoned build

    def test_build_company_diagnostic_raising_falls_back_to_numeric_only(self):
        fake_data = {"dcf": {"gqv_fair_value": {"status": "ok"}}}
        fake_numeric = {"validation_status": "valid", "intrinsic_value_usd": 50.0}
        with patch("app.services.fundamental_analysis_service.get_fundamental_analysis", return_value=fake_data), \
             patch.object(cvs, "scenarios_from_fetched_data", return_value=dict(fake_numeric)), \
             patch("app.services.company_diagnostic_service.build_company_diagnostic", side_effect=RuntimeError("boom")):
            result = cvs.compute_full_diagnostic_valuation("BOOM")
        assert result["validation_status"] == "valid"
        assert result["diagnostic_snapshot"] is None

    def test_under_review_company_still_gets_snapshot(self):
        """AXON-shaped case: a completed, non-failing diagnostic that the
        anomaly guard marks under_review must still be persistable as a
        snapshot — the ficha stays useful, just not presented as trustworthy
        (that's the read path's job, not this function's)."""
        fake_data = {"dcf": {"gqv_fair_value": {"status": "ok"}}}
        fake_numeric = {
            "validation_status": "under_review", "error_detail": "operating_margin_anchor unreliable",
            "intrinsic_value_usd": 36.3,
        }
        fake_diag = {"companyName": "Axon", "scoreLabel": "MIXTA"}
        with patch("app.services.fundamental_analysis_service.get_fundamental_analysis", return_value=fake_data), \
             patch.object(cvs, "scenarios_from_fetched_data", return_value=dict(fake_numeric)), \
             patch("app.services.company_diagnostic_service.build_company_diagnostic", return_value=dict(fake_diag)):
            result = cvs.compute_full_diagnostic_valuation("AXON")
        assert result["validation_status"] == "under_review"
        assert result["diagnostic_snapshot"] is not None

    def test_fmp_yahoo_finnhub_all_failing_yields_no_snapshot_no_crash(self):
        with patch("app.services.fundamental_analysis_service.get_fundamental_analysis", return_value=None):
            result = cvs.compute_full_diagnostic_valuation("GHOST")
        assert result["validation_status"] == "insufficient_data"
        assert "diagnostic_snapshot" not in result or result.get("diagnostic_snapshot") is None

    def test_get_fundamental_analysis_raising_is_a_failed_result_not_a_crash(self):
        with patch("app.services.fundamental_analysis_service.get_fundamental_analysis", side_effect=RuntimeError("provider down")):
            result = cvs.compute_full_diagnostic_valuation("DOWN")
        assert result["validation_status"] == "failed"


# ── get_pending_tickers full_snapshot mode ─────────────────────────────────

class TestGetPendingTickersFullSnapshotMode:
    def test_valid_row_without_complete_snapshot_is_missing_snapshot(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "AAPL", "validation_status": "valid",
            "model_version": cvs.MODEL_VERSION, "next_retry_at": None, "is_current": True,
            "diagnostic_snapshot": None, "snapshot_schema_version": None,
        })
        buckets = _run(cvs.get_pending_tickers(["AAPL"], full_snapshot=True))
        assert buckets["missing_snapshot"] == ["AAPL"]
        assert buckets["already_valid"] == []

    def test_valid_row_with_complete_current_snapshot_is_already_valid(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "MSFT", "validation_status": "valid",
            "model_version": cvs.MODEL_VERSION, "next_retry_at": None, "is_current": True,
            "diagnostic_snapshot": {"companyName": "Microsoft"},
            "snapshot_schema_version": cvs._DIAGNOSTIC_SCHEMA_VERSION_FOR_BACKFILL,
        })
        buckets = _run(cvs.get_pending_tickers(["MSFT"], full_snapshot=True))
        assert buckets["already_valid"] == ["MSFT"]
        assert buckets["missing_snapshot"] == []

    def test_valid_row_with_stale_schema_version_snapshot_is_missing_snapshot(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "OLD", "validation_status": "valid",
            "model_version": cvs.MODEL_VERSION, "next_retry_at": None, "is_current": True,
            "diagnostic_snapshot": {"companyName": "Old Co"}, "snapshot_schema_version": 1,
        })
        buckets = _run(cvs.get_pending_tickers(["OLD"], full_snapshot=True))
        assert buckets["missing_snapshot"] == ["OLD"]

    def test_numeric_only_mode_unaffected_by_snapshot_fields(self, monkeypatch):
        """Default (full_snapshot=False) must classify identically to
        before this feature existed — missing_snapshot bucket stays empty
        and already_valid behaves exactly as today."""
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "AAPL", "validation_status": "valid",
            "model_version": cvs.MODEL_VERSION, "next_retry_at": None, "is_current": True,
            "diagnostic_snapshot": None,
        })
        buckets = _run(cvs.get_pending_tickers(["AAPL"]))
        assert buckets["already_valid"] == ["AAPL"]
        assert buckets["missing_snapshot"] == []

    def test_under_review_and_insufficient_data_rows_never_land_in_missing_snapshot(self, monkeypatch):
        """missing_snapshot is specifically for upgrading VALID rows — a
        retry-eligible under_review/insufficient_data row keeps going
        through the normal retry_eligible/backing_off path regardless of
        full_snapshot, since compute_full_diagnostic_valuation always
        attempts a snapshot for whatever status it lands on."""
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "DOW", "validation_status": "insufficient_data",
            "model_version": cvs.MODEL_VERSION, "next_retry_at": None, "is_current": True,
            "diagnostic_snapshot": None,
        })
        buckets = _run(cvs.get_pending_tickers(["DOW"], full_snapshot=True))
        assert "DOW" not in buckets["missing_snapshot"]
        assert "DOW" in buckets["retry_eligible"]


# ── refresh_if_needed full_snapshot upgrade path ───────────────────────────

class TestRefreshIfNeededFullSnapshotUpgrade:
    def test_valid_row_missing_snapshot_is_upgraded_not_skipped(self, monkeypatch):
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "AAPL", "validation_status": "valid",
            "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q3",
            "computed_at": "2026-10-29T00:00:00+00:00", "attempt_count": 0,
            "is_current": True, "diagnostic_snapshot": None, "snapshot_schema_version": None,
        })
        fake_full = {
            "validation_status": "valid", "intrinsic_value_usd": 264.6, "currency": "USD",
            "methodology": "gqv", "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q3",
            "assumptions": {}, "diagnostic_snapshot": {"companyName": "Apple"},
            "snapshot_schema_version": cvs._DIAGNOSTIC_SCHEMA_VERSION_FOR_BACKFILL,
        }
        with patch("app.api.routes.screener._latest_reported_earnings_period", return_value="2026-Q3"), \
             patch.object(cvs, "compute_full_diagnostic_valuation", return_value=fake_full) as mock_compute:
            row = _run(cvs.refresh_if_needed("AAPL", full_snapshot=True))
        mock_compute.assert_called_once()
        assert row["_backfill_attempted"] is True
        assert row.get("diagnostic_snapshot") == {"companyName": "Apple"}

    def test_numeric_only_mode_still_skips_already_fresh_row(self, monkeypatch):
        """Regression guard: full_snapshot defaulting to False must not
        change today's numeric-only skip behavior."""
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "AAPL", "validation_status": "valid",
            "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q3",
            "computed_at": "2026-10-29T00:00:00+00:00", "attempt_count": 0,
            "is_current": True, "diagnostic_snapshot": None,
        })
        with patch("app.api.routes.screener._latest_reported_earnings_period", return_value="2026-Q3"), \
             patch.object(cvs, "compute_numeric_valuation") as mock_numeric, \
             patch.object(cvs, "compute_full_diagnostic_valuation") as mock_full:
            row = _run(cvs.refresh_if_needed("AAPL"))
        mock_numeric.assert_not_called()
        mock_full.assert_not_called()
        assert row["_backfill_attempted"] is False

    def test_snapshot_write_never_overwrites_existing_snapshot_with_none(self, monkeypatch):
        """Invariant from persist_valuation, re-verified through refresh_
        if_needed's full_snapshot=False path: a numeric-only compute must
        never erase a snapshot a prior full-snapshot run already wrote."""
        db = _FakeDB()
        monkeypatch.setattr(cvs, "get_supabase", lambda: db)
        _clear_cache()
        db.rows.append({
            "id": str(uuid.uuid4()), "ticker": "AAPL", "validation_status": "insufficient_data",
            "model_version": "v0-stale", "financial_report_period": "2026-Q2",
            "computed_at": "2026-10-01T00:00:00+00:00", "attempt_count": 0,
            "is_current": True, "diagnostic_snapshot": {"companyName": "Apple"},
            "snapshot_schema_version": cvs._DIAGNOSTIC_SCHEMA_VERSION_FOR_BACKFILL,
        })
        fake_numeric = {
            "validation_status": "valid", "intrinsic_value_usd": 264.6, "currency": "USD",
            "methodology": "gqv", "model_version": cvs.MODEL_VERSION, "financial_report_period": "2026-Q3",
            "assumptions": {},
        }
        with patch("app.api.routes.screener._latest_reported_earnings_period", return_value="2026-Q3"), \
             patch.object(cvs, "compute_numeric_valuation", return_value=fake_numeric):
            row = _run(cvs.refresh_if_needed("AAPL"))
        current = _current_rows(db, "AAPL")
        assert len(current) == 1
        assert current[0]["diagnostic_snapshot"] == {"companyName": "Apple"}, (
            "a numeric-only recompute must preserve the existing snapshot, never null it out"
        )


# ── reading a snapshot never triggers a DCF calculation ────────────────────

class TestSnapshotReadNeverRecomputes:
    def test_degraded_diagnostic_with_complete_snapshot_calls_no_provider(self, monkeypatch):
        """Direct proof (not inference from latency) that the read path,
        given a complete current-schema snapshot, never calls get_
        fundamental_analysis/build_company_diagnostic/any external
        provider client."""
        import asyncio as _asyncio
        from app.api.routes import screener as scr

        persisted = {
            "ticker": "OMC", "validation_status": "valid", "intrinsic_value_usd": 70.0,
            "diagnostic_snapshot": {
                "companyName": "Omnicom", "ticker": "OMC", "score": 70,
                "valuation": {"currentPrice": 65.0, "baseFairValue": 70.0},
            },
            "snapshot_schema_version": scr._DIAGNOSTIC_SCHEMA_VERSION,
            "computed_at": "2026-10-29T00:00:00+00:00",
        }

        def _boom(*a, **k):
            raise AssertionError("must not call external provider / DCF engine when a complete snapshot exists")

        with patch("app.services.fundamental_analysis_service.get_fundamental_analysis", side_effect=_boom), \
             patch("app.services.company_diagnostic_service.build_company_diagnostic", side_effect=_boom):
            result = _asyncio.run(scr._degraded_diagnostic("OMC", "es", persisted))
        assert result["companyName"] == "Omnicom"
