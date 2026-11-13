"""Nuvos ETF Fase 2B redesign — enriched card summary + batch endpoint."""
from unittest.mock import patch

import pytest

from app.services.etf.service import NotAnETFError, get_etf_card_summary


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.core import cache as cache_module
    cache_module._mem.clear()
    yield
    cache_module._mem.clear()


def _mock_structural_fetch(name="Vanguard S&P 500 ETF", expense_ratio=0.03, description="A" * 200):
    def fake_fetch(path, symbol, **kw):
        from app.services.etf.provider import FMPResult
        if path == "/etf/info":
            return FMPResult(ok=True, data=[{
                "name": name, "expenseRatio": expense_ratio, "description": description,
                "etfCompany": "Vanguard",
            }])
        if path == "/profile":
            return FMPResult(ok=True, data=[{"symbol": symbol}])
        return FMPResult(ok=True, data=[{"sector": "Technology", "weightPercentage": 50.0}] if "sector" in path else [{"country": "United States", "weightPercentage": "99%"}])
    return fake_fetch


class TestCardSummary:
    def test_builds_card_from_structural_data(self):
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=_mock_structural_fetch()):
            card = get_etf_card_summary("VOO", use_cache=False)
        assert card["ticker"] == "VOO"
        assert card["name"] == "Vanguard S&P 500 ETF"
        assert card["expense_ratio_pct"] == 0.03
        assert card["cost_tier"] == "muy_bajo"
        assert card["etf_company"] == "Vanguard"

    def test_curated_ticker_gets_editorial_spanish_description(self):
        """VOO is in editorial_descriptions.py's curated set — the card
        must use that factual one-liner, never FMP's raw English
        paragraph (regardless of what FMP itself returns)."""
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=_mock_structural_fetch(description="X" * 300)):
            card = get_etf_card_summary("VOO", use_cache=False)
        assert card["short_description"] == "Sigue el índice S&P 500 — las 500 empresas más grandes de EE. UU."
        assert card["has_editorial_description"] is True

    def test_non_etf_raises(self):
        with patch("app.services.etf.service.classify_asset", return_value="equity"):
            with pytest.raises(NotAnETFError):
                get_etf_card_summary("AAPL", use_cache=False)

    def test_non_curated_ticker_falls_back_to_none_honestly(self):
        """A real ETF outside Nuvos's curated set (e.g. a generic search
        result) must never get FMP's raw English paragraph either — honest
        None, not invented, not untranslated."""
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=_mock_structural_fetch(description="Some long English paragraph.")):
            card = get_etf_card_summary("ZZZZNOTCURATED", use_cache=False)
        assert card["short_description"] is None
        assert card["has_editorial_description"] is False

    def test_dominant_sector_from_structural_data(self):
        """Translated to Spanish by default (lang='es') — same static
        dictionary insights.py and get_etf_overview use."""
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=_mock_structural_fetch()):
            card = get_etf_card_summary("VOO", use_cache=False)
        assert card["dominant_sector"] == "Tecnología"

    def test_dominant_sector_english_when_lang_en(self):
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=_mock_structural_fetch()):
            card = get_etf_card_summary("VOO", use_cache=False, lang="en")
        assert card["dominant_sector"] == "Technology"

    def test_reuses_structural_cache_no_extra_fmp_calls_on_second_call(self):
        with patch("app.services.etf.service.classify_asset", return_value="etf"), \
             patch("app.services.etf.service.fetch", side_effect=_mock_structural_fetch()) as mock_fetch:
            get_etf_card_summary("VOO", use_cache=True)
            get_etf_card_summary("VOO", use_cache=True)
        assert mock_fetch.call_count == 4  # only the first call's 4 structural fetches


class TestCardsRoute:
    def test_tickers_param_parsing_and_cap(self):
        from app.api.routes.etf import _MAX_CARDS_PER_REQUEST
        raw = "VOO,QQQ,SPY,VXUS,XLK,XLV,IBB,BOTZ"  # 8 tickers, over the cap
        requested = [t.strip().upper() for t in raw.split(",") if t.strip()][:_MAX_CARDS_PER_REQUEST]
        assert len(requested) == _MAX_CARDS_PER_REQUEST
        assert requested == ["VOO", "QQQ", "SPY", "VXUS", "XLK", "XLV"]

    async def test_endpoint_never_drops_a_ticker_even_on_failure(self):
        from app.api.routes.etf import get_etf_cards
        from starlette.requests import Request

        def fake_card_summary(ticker, use_cache=True):
            if ticker == "BAD":
                raise NotAnETFError(ticker)
            return {"ticker": ticker, "name": f"{ticker} Fund", "short_description": None, "expense_ratio_pct": 0.1, "cost_tier": "bajo", "etf_company": None, "unavailable_fields": []}

        request = Request({
            "type": "http", "method": "GET", "path": "/api/etf/cards", "headers": [],
            "client": ("127.0.0.1", 1234), "query_string": b"", "server": ("127.0.0.1", 8000),
        })
        user = {"email": "diego.arria19@gmail.com"}
        with patch("app.api.routes.etf.get_etf_card_summary", side_effect=fake_card_summary):
            result = await get_etf_cards(request, tickers="VOO,BAD", user=user)
        tickers_in_result = {c["ticker"] for c in result["cards"]}
        assert tickers_in_result == {"VOO", "BAD"}
        bad_card = next(c for c in result["cards"] if c["ticker"] == "BAD")
        assert bad_card["available"] is False
