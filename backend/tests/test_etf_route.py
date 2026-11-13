"""Nuvos ETF Fase 2A — the HTTP route's own logic (admin gate, ticker
validation). The rate-limit decorator itself is slowapi's own, already
covered upstream (same convention test_research_engine_cost_control.py
documents) — not re-tested here."""
import pytest
from fastapi import HTTPException

from app.api.routes.etf import _require_admin, _TICKER_RE


class TestAdminGate:
    async def test_admin_email_passes(self):
        from app.core.config import settings
        admin_email = settings.admin_emails.split(",")[0].strip()
        await _require_admin({"id": "x", "email": admin_email})  # must not raise

    async def test_non_admin_email_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            await _require_admin({"id": "x", "email": "random-user@example.com"})
        assert exc_info.value.status_code == 403

    async def test_missing_email_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            await _require_admin({"id": "x", "email": None})
        assert exc_info.value.status_code == 403

    async def test_email_check_is_case_insensitive(self):
        from app.core.config import settings
        admin_email = settings.admin_emails.split(",")[0].strip()
        await _require_admin({"id": "x", "email": admin_email.upper()})  # must not raise


class TestTickerValidation:
    @pytest.mark.parametrize("ticker", ["SPY", "QQQ", "VOO", "BOTZ", "A", "BRK.B"])
    def test_valid_tickers_match(self, ticker):
        assert _TICKER_RE.match(ticker)

    @pytest.mark.parametrize("ticker", ["spy", "123", "DROP TABLE", "<script>", "", "TOOLONGTICKER"])
    def test_invalid_tickers_rejected(self, ticker):
        assert not _TICKER_RE.match(ticker)
