"""
app.core.fmp_budget — the shared, distributed FMP call budget (Nuvos
Radar structural audit, 2026-10-21). Diego: "un limitador distribuido...
que respete la cuota compartida de FMP entre todas las instancias y
workers... reserva capacidad para consultas de usuarios frente a trabajos
automáticos."
"""
from unittest.mock import Mock, patch

import app.core.fmp_budget as fb


def _clear():
    import app.core.cache as cache_mod
    cache_mod._mem.clear()


def test_calls_allowed_under_the_limit():
    _clear()
    for _ in range(10):
        assert fb.fmp_call_allowed() is True


def test_user_calls_blocked_once_the_full_limit_is_reached():
    _clear()
    for _ in range(fb.FMP_LIMIT_PER_MINUTE):
        assert fb.fmp_call_allowed() is True
    assert fb.fmp_call_allowed() is False, "the (window+1)th live-user call must be rejected"


def test_background_calls_blocked_at_their_smaller_reserved_share():
    _clear()
    background_limit = int(fb.FMP_LIMIT_PER_MINUTE * fb._BACKGROUND_SHARE)
    with fb.fmp_background():
        for _ in range(background_limit):
            assert fb.fmp_call_allowed() is True
        assert fb.fmp_call_allowed() is False, "a background job must be capped at its reserved share, well under the full budget"


def test_background_exhaustion_never_blocks_a_live_user_call():
    _clear()
    background_limit = int(fb.FMP_LIMIT_PER_MINUTE * fb._BACKGROUND_SHARE)
    with fb.fmp_background():
        for _ in range(background_limit):
            fb.fmp_call_allowed()
        assert fb.fmp_call_allowed() is False  # background budget now exhausted
    # Back in the live-user context (outside the `with` block) — capacity
    # must still be available, since background calls can never consume
    # more than their own reserved share of the shared window.
    assert fb.fmp_call_allowed() is True, "a user request must never be starved by a background job's own consumption"


def test_background_context_resets_after_exit():
    _clear()
    with fb.fmp_background():
        assert fb._is_background_ctx.get() is True
    assert fb._is_background_ctx.get() is False


def test_nested_calls_outside_background_context_default_to_user_class():
    _clear()
    assert fb._is_background_ctx.get() is False


def test_fmp_provider_get_respects_the_shared_budget():
    """FMPProvider._get (financial_data_service.py) — the single highest-
    volume FMP call site — must actually consult the shared budget, not
    just have it exist unused. Confirms _get returns [] (its normal
    "request failed" sentinel) without ever calling requests.get once the
    budget is exhausted."""
    from app.services.financial_data_service import FMPProvider

    _clear()
    for _ in range(fb.FMP_LIMIT_PER_MINUTE):
        fb.fmp_call_allowed()

    mock_response = Mock()
    mock_response.json.return_value = [{"date": "2025-12-31"}]
    with patch("requests.get", return_value=mock_response) as mock_get:
        rows = FMPProvider()._get("income-statement", {"symbol": "AAPL"})

    assert rows == []
    mock_get.assert_not_called()
