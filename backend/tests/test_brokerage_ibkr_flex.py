"""IBKR Flex Web Service connector (2026-10-06) — direct, no-Plaid Interactive
Brokers integration. See app/api/routes/brokerage.py's module docstring for
why Flex (not Client Portal OAuth or TWS) is the right IBKR surface for a
backend syncing many users unattended."""
from unittest.mock import AsyncMock, patch

import pytest

from app.api.routes.brokerage import (
    _normalize_ibkr_flex_positions,
    _ibkr_flex_fetch_statement,
)
from fastapi import HTTPException


_REAL_STATEMENT_XML = """<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Nuvos Positions" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="20261001" toDate="20261006" period="LastBusinessDay" whenGenerated="20261006;120000">
      <OpenPositions>
        <OpenPosition accountId="U1234567" currency="USD" fxRateToBase="1" symbol="AAPL" description="APPLE INC" conid="265598" securityID="US0378331005" position="10" markPrice="258.5" positionValue="2585" openPrice="150.25" costBasisPrice="150.25" costBasisMoney="1502.5" percentOfNAV="12.3" assetCategory="STK" />
        <OpenPosition accountId="U1234567" currency="USD" fxRateToBase="1" symbol="MSFT" description="MICROSOFT CORP" conid="272093" securityID="US5949181045" position="5" markPrice="430.1" positionValue="2150.5" openPrice="400" costBasisPrice="400" costBasisMoney="2000" percentOfNAV="10.2" assetCategory="STK" />
      </OpenPositions>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>"""

_PENDING_XML = """<FlexStatementResponse timestamp='06 October, 2026 12:00:00 EST'>
<Status>Fail</Status>
<ErrorCode>1019</ErrorCode>
<ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage>
</FlexStatementResponse>"""

_BAD_TOKEN_XML = """<FlexStatementResponse timestamp='06 October, 2026 12:00:00 EST'>
<Status>Fail</Status>
<ErrorCode>1003</ErrorCode>
<ErrorMessage>Invalid request or token.</ErrorMessage>
</FlexStatementResponse>"""

_SEND_SUCCESS_XML = """<FlexStatementResponse timestamp='06 October, 2026 12:00:00 EST'>
<Status>Success</Status>
<ReferenceCode>1234567890</ReferenceCode>
<Url>https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement</Url>
</FlexStatementResponse>"""


class TestNormalizeIbkrFlexPositions:
    def test_parses_real_open_positions(self):
        positions = _normalize_ibkr_flex_positions(_REAL_STATEMENT_XML)
        assert len(positions) == 2
        aapl = next(p for p in positions if p["ticker"] == "AAPL")
        assert aapl["name"] == "APPLE INC"
        assert aapl["shares"] == 10.0
        assert aapl["avgPrice"] == 150.25
        assert aapl["currentPrice"] == 258.5
        assert aapl["currency"] == "USD"
        assert aapl["brokerSource"] == "ibkr_flex"
        assert aapl["institutionName"] == "Interactive Brokers"

    def test_no_open_positions_section_returns_empty_not_error(self):
        xml = """<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" /></FlexStatements></FlexQueryResponse>"""
        assert _normalize_ibkr_flex_positions(xml) == []

    def test_unparseable_xml_returns_empty_never_raises(self):
        assert _normalize_ibkr_flex_positions("not xml at all <<<") == []

    def test_falls_back_to_open_price_when_cost_basis_price_missing(self):
        xml = """<FlexQueryResponse><FlexStatements><FlexStatement>
          <OpenPositions><OpenPosition symbol="TSLA" description="TESLA INC" position="2" markPrice="430" openPrice="300" currency="USD" /></OpenPositions>
        </FlexStatement></FlexStatements></FlexQueryResponse>"""
        positions = _normalize_ibkr_flex_positions(xml)
        assert positions[0]["avgPrice"] == 300.0


class TestFetchStatementPolling:
    @staticmethod
    def _mock_responses(*texts):
        mocks = [AsyncMock() for _ in texts]
        for m, t in zip(mocks, texts):
            m.text = t
        return mocks

    async def test_succeeds_immediately_when_statement_ready_on_first_poll(self, monkeypatch):
        send_resp, stmt_resp = self._mock_responses(_SEND_SUCCESS_XML, _REAL_STATEMENT_XML)
        client = AsyncMock()
        client.get = AsyncMock(side_effect=[send_resp, stmt_resp])
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        monkeypatch.setattr("app.api.routes.brokerage.httpx.AsyncClient", lambda **kw: client)
        monkeypatch.setattr("app.api.routes.brokerage.asyncio.sleep", AsyncMock())

        result = await _ibkr_flex_fetch_statement("123", "tok")
        assert result == _REAL_STATEMENT_XML

    async def test_retries_through_pending_1019_then_succeeds(self, monkeypatch):
        send_resp, pending1, pending2, stmt_resp = self._mock_responses(
            _SEND_SUCCESS_XML, _PENDING_XML, _PENDING_XML, _REAL_STATEMENT_XML
        )
        client = AsyncMock()
        client.get = AsyncMock(side_effect=[send_resp, pending1, pending2, stmt_resp])
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        monkeypatch.setattr("app.api.routes.brokerage.httpx.AsyncClient", lambda **kw: client)
        monkeypatch.setattr("app.api.routes.brokerage.asyncio.sleep", AsyncMock())

        result = await _ibkr_flex_fetch_statement("123", "tok")
        assert result == _REAL_STATEMENT_XML

    async def test_bad_token_on_send_raises_401_with_ibkr_message(self, monkeypatch):
        bad_send = AsyncMock()
        bad_send.text = _BAD_TOKEN_XML
        client = AsyncMock()
        client.get = AsyncMock(return_value=bad_send)
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        monkeypatch.setattr("app.api.routes.brokerage.httpx.AsyncClient", lambda **kw: client)

        with pytest.raises(HTTPException) as exc:
            await _ibkr_flex_fetch_statement("bad", "bad")
        assert exc.value.status_code == 401
        assert "Invalid request or token" in exc.value.detail

    async def test_real_error_mid_poll_raises_immediately_not_retried(self, monkeypatch):
        # A non-1019 error AFTER a successful SendRequest (e.g. the query
        # was deleted mid-flight) must fail fast, not burn through all 4
        # retries first.
        send_resp, stmt_resp = self._mock_responses(_SEND_SUCCESS_XML, _BAD_TOKEN_XML)
        client = AsyncMock()
        client.get = AsyncMock(side_effect=[send_resp, stmt_resp])
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        monkeypatch.setattr("app.api.routes.brokerage.httpx.AsyncClient", lambda **kw: client)
        monkeypatch.setattr("app.api.routes.brokerage.asyncio.sleep", AsyncMock())

        with pytest.raises(HTTPException) as exc:
            await _ibkr_flex_fetch_statement("123", "tok")
        assert exc.value.status_code == 401
        assert client.get.call_count == 2  # SendRequest + exactly 1 poll, no further retries

    async def test_exhausting_all_retries_still_pending_raises_504(self, monkeypatch):
        send_resp = self._mock_responses(_SEND_SUCCESS_XML)[0]
        pending = self._mock_responses(_PENDING_XML)[0]
        client = AsyncMock()
        client.get = AsyncMock(side_effect=[send_resp, pending, pending, pending, pending])
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        monkeypatch.setattr("app.api.routes.brokerage.httpx.AsyncClient", lambda **kw: client)
        monkeypatch.setattr("app.api.routes.brokerage.asyncio.sleep", AsyncMock())

        with pytest.raises(HTTPException) as exc:
            await _ibkr_flex_fetch_statement("123", "tok")
        assert exc.value.status_code == 504
