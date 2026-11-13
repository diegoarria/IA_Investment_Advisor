"""Nuvos Plus — Fase 8C: "no Nuvos Plus subscription for now, ship free for
every authenticated user." The Fase 8B premium/admin gate
(`require_premium_or_admin`) is gone along with the Fase 4A/6D admin-only
placeholder before it — these 4 routes now rely solely on FastAPI's own
`Depends(get_current_user)` for authentication, with ownership enforced in
app/services/portfolio_exposure/service.py (covered by
test_portfolio_exposure_service.py, not duplicated here)."""
from pathlib import Path

ROUTE_FILE = Path(__file__).resolve().parent.parent / "app" / "api" / "routes" / "portfolio_exposure.py"


class TestNoCommercialGateRemains:
    def test_no_admin_or_premium_gate_helpers_remain(self):
        # Fase 8A found a live contradiction once a commercial/admin-only
        # backend gate was left behind while the frontend already showed a
        # feature to everyone. Guard against that regression shape
        # recurring here now that both gates are intentionally gone.
        text = ROUTE_FILE.read_text(encoding="utf-8")
        assert "_require_admin" not in text
        assert "_admin_emails" not in text
        assert "from app.core.subscription import require_premium_or_admin" not in text
        assert "await require_premium_or_admin(user)" not in text

    def test_every_route_still_depends_on_get_current_user(self):
        # The one thing that must NOT be removed: real authentication.
        text = ROUTE_FILE.read_text(encoding="utf-8")
        assert text.count("user: dict = Depends(get_current_user)") == 4

    def test_pulse_route_cache_key_is_scoped_per_user(self):
        # Two different users must never read each other's cached Pulse
        # comparison, even for the same portfolio_id string (e.g. the
        # default "default" portfolio id, which is NOT globally unique).
        text = ROUTE_FILE.read_text(encoding="utf-8")
        assert 'cache_key = f"pulse_compare:{user[\'id\']}:{portfolio_id}:{snapshot_type}"' in text
