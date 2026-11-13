"""Nuvos ETF — Fase 8C removed the Fase 2A admin-only gate (every
authenticated user can reach these routes now, see etf.py's own updated
docstring) — the admin-gate tests this file used to carry are gone with
it. The rate-limit decorator itself is slowapi's own, already covered
upstream (same convention test_research_engine_cost_control.py
documents) — not re-tested here."""
import pytest

from app.api.routes.etf import _TICKER_RE


class TestNoAdminGateRemains:
    def test_admin_gate_helpers_are_gone(self):
        # Fase 8A found a live contradiction once an admin-only backend
        # gate was left behind while the frontend already showed a
        # feature to everyone. Guard against that regression shape
        # recurring here now that the gate itself is intentionally gone.
        from pathlib import Path
        path = Path(__file__).resolve().parent.parent / "app" / "api" / "routes" / "etf.py"
        text = path.read_text(encoding="utf-8")
        assert "_require_admin" not in text
        assert "_admin_emails" not in text
        assert "admin_emails" not in text


class TestTickerValidation:
    @pytest.mark.parametrize("ticker", ["SPY", "QQQ", "VOO", "BOTZ", "A", "BRK.B"])
    def test_valid_tickers_match(self, ticker):
        assert _TICKER_RE.match(ticker)

    @pytest.mark.parametrize("ticker", ["spy", "123", "DROP TABLE", "<script>", "", "TOOLONGTICKER"])
    def test_invalid_tickers_rejected(self, ticker):
        assert not _TICKER_RE.match(ticker)
