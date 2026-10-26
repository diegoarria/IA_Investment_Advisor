"""
2026-10-26: confirmed live — a single job_portfolio_alerts run during a bad
ANTHROPIC_API_KEY window made every mover in that run collapse to
NO_CATALYST, and because the WHY result is cached per ticker per ET trading
day for 12h, that one transient failure got served to every user holding
any of those tickers for the rest of the day, looking identical to a
genuine "no catalyst found" finding (7 real tickers, same push text, same
~1h window — see the Slack screenshot Diego sent). generate_price_alert_why
must return a DIFFERENT sentinel for "the Claude call itself failed" than
for "Claude judged there's no real catalyst," so the caller (worker.py's
job_portfolio_alerts) can skip caching only the failure case.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.price_alert_service import (
    NO_CATALYST,
    WHY_CALL_FAILED,
    generate_price_alert_why,
)


@pytest.mark.asyncio
async def test_claude_auth_error_returns_call_failed_not_no_catalyst():
    # `anthropic` is imported locally inside generate_price_alert_why, so the
    # real module/class is patched directly rather than the function's module.
    with patch("anthropic.AsyncAnthropic") as mock_cls, \
         patch("app.services.ai_service.check_daily_spend_cap"):
        client = MagicMock()
        client.messages.create = AsyncMock(side_effect=Exception("401 - invalid x-api-key"))
        mock_cls.return_value = client

        result = await generate_price_alert_why("NVDA", -3.5, 180.0, [], extra_context="some real news context")

    assert result == WHY_CALL_FAILED
    assert result != NO_CATALYST


@pytest.mark.asyncio
async def test_claude_timeout_returns_call_failed_not_no_catalyst():
    import asyncio

    with patch("anthropic.AsyncAnthropic") as mock_cls, \
         patch("app.services.ai_service.check_daily_spend_cap"), \
         patch("asyncio.wait_for", side_effect=asyncio.TimeoutError):
        client = MagicMock()
        mock_cls.return_value = client

        result = await generate_price_alert_why("TSLA", 4.0, 250.0, [], extra_context="some real news context")

    assert result == WHY_CALL_FAILED


@pytest.mark.asyncio
async def test_claude_genuine_no_catalyst_judgment_is_unaffected():
    """A real, successful Claude call that judges there's no catalyst must
    still return NO_CATALYST, not WHY_CALL_FAILED — only an actual failure
    to reach/parse the API should ever return WHY_CALL_FAILED."""
    with patch("anthropic.AsyncAnthropic") as mock_cls, \
         patch("app.services.ai_service.check_daily_spend_cap"), \
         patch("app.services.llm_usage.log_llm_usage", new=AsyncMock()):
        resp = MagicMock()
        resp.content = [MagicMock(text="NO_CATALYST")]
        resp.usage = MagicMock()
        client = MagicMock()
        client.messages.create = AsyncMock(return_value=resp)
        mock_cls.return_value = client

        result = await generate_price_alert_why("XYZ", 2.5, 10.0, [], extra_context="vague market sentiment only")

    assert result == NO_CATALYST
    assert result != WHY_CALL_FAILED
