"""Nuvos Plus — Fase 4A: the HTTP route's own logic (admin gate), same
convention as test_etf_route.py."""
import pytest
from fastapi import HTTPException

from app.api.routes.portfolio_exposure import _require_admin


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
