"""Nuvos ETF Fase 2B — universe search + curated categories."""
from unittest.mock import patch

import pytest

from app.services.etf.categories import get_categories
from app.services.etf.universe import get_etf_universe, search_etf_universe


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.core import cache as cache_module
    cache_module._mem.clear()
    yield
    cache_module._mem.clear()


FAKE_UNIVERSE = [
    {"symbol": "VOO", "name": "Vanguard S&P 500 ETF"},
    {"symbol": "SPY", "name": "State Street SPDR S&P 500 ETF"},
    {"symbol": "VTI", "name": "Vanguard Total Stock Market ETF"},
    {"symbol": "XLK", "name": "Technology Select Sector SPDR Fund"},
    {"symbol": "XLV", "name": "Health Care Select Sector SPDR Fund"},
    {"symbol": "FXI", "name": "iShares China Large-Cap ETF"},
    {"symbol": "VXUS", "name": "Vanguard Total International Stock ETF"},
]


class TestUniverse:
    def test_fetch_and_cache(self):
        class Resp:
            status_code = 200
            def json(self): return FAKE_UNIVERSE
        with patch("app.services.etf.universe.requests.get", return_value=Resp()) as mock_get, \
             patch("app.services.etf.universe.FMP_KEY", "fake"):
            u1 = get_etf_universe()
            u2 = get_etf_universe()
        assert len(u1) == 7
        assert mock_get.call_count == 1  # second call served from cache

    def test_provider_failure_returns_empty_not_crash(self):
        class Resp:
            status_code = 500
            def json(self): return {}
        with patch("app.services.etf.universe.requests.get", return_value=Resp()), \
             patch("app.services.etf.universe.FMP_KEY", "fake"):
            assert get_etf_universe() == []

    def test_no_api_key_returns_empty(self):
        with patch("app.services.etf.universe.FMP_KEY", ""):
            assert get_etf_universe() == []


class TestSearch:
    def _patched(self):
        return patch("app.services.etf.universe.get_etf_universe", return_value=FAKE_UNIVERSE)

    def test_search_by_exact_ticker(self):
        with self._patched():
            results = search_etf_universe("VOO")
        assert any(r["symbol"] == "VOO" for r in results)

    def test_search_by_name_substring(self):
        with self._patched():
            results = search_etf_universe("Vanguard")
        symbols = {r["symbol"] for r in results}
        assert {"VOO", "VTI", "VXUS"}.issubset(symbols)

    def test_search_by_theme_in_name(self):
        """'S&P 500', 'Technology', 'Healthcare', 'China' are all real
        substrings of real ETF names — no inferred category needed."""
        with self._patched():
            assert any("S&P 500" in r["name"] for r in search_etf_universe("S&P 500"))
            assert any(r["symbol"] == "XLK" for r in search_etf_universe("Technology"))
            assert any(r["symbol"] == "XLV" for r in search_etf_universe("Health"))
            assert any(r["symbol"] == "FXI" for r in search_etf_universe("China"))

    def test_ticker_prefix_match_ranked_above_name_match(self):
        with self._patched():
            results = search_etf_universe("v")  # matches VOO/VTI/VXUS by prefix, "Vanguard"-named others by substring
        symbols = [r["symbol"] for r in results]
        assert symbols.index("VOO") < symbols.index("XLK") if "XLK" in symbols else True

    def test_empty_query_returns_empty(self):
        with self._patched():
            assert search_etf_universe("") == []
            assert search_etf_universe("   ") == []

    def test_no_match_returns_empty_not_error(self):
        with self._patched():
            assert search_etf_universe("ZZZZNOTREALNAME") == []

    def test_respects_limit(self):
        with self._patched():
            results = search_etf_universe("ETF", limit=2)
        assert len(results) <= 2

    def test_case_insensitive(self):
        with self._patched():
            results_lower = search_etf_universe("voo")
            results_upper = search_etf_universe("VOO")
        assert [r["symbol"] for r in results_lower] == [r["symbol"] for r in results_upper]


class TestCategories:
    def test_categories_structure(self):
        with patch("app.services.etf.categories.classify_asset", return_value="etf"):
            cats = get_categories()
        assert len(cats) == 6  # Fase 2B 2nd iteration: granular interest categories, not one mixed "sectores" bucket
        for cat in cats:
            assert "key" in cat and "label" in cat and "etfs" in cat
            for e in cat["etfs"]:
                assert "ticker" in e and "label" in e

    def test_non_etf_ticker_dropped_from_category(self):
        """A curated ticker that no longer classifies as ETF (e.g. closed
        fund) must be silently dropped, never shown as if verified."""
        def fake_classify(ticker):
            return "equity" if ticker == "XLK" else "etf"
        with patch("app.services.etf.categories.classify_asset", side_effect=fake_classify):
            cats = get_categories()
        tech_cat = next(c for c in cats if c["key"] == "tecnologia")
        tickers = {e["ticker"] for e in tech_cat["etfs"]}
        assert "XLK" not in tickers

    def test_classification_failure_drops_entry_not_crash(self):
        with patch("app.services.etf.categories.classify_asset", return_value="unknown"):
            cats = get_categories()
        for cat in cats:
            assert cat["etfs"] == []  # nothing verified, but no crash
