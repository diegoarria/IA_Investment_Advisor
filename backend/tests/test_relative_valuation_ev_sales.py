"""EV/Sales peer-multiple support (2026-10-03) — the only multiple that
stays meaningful when EPS/EBITDA/FCF are negative. See company_diagnostic_
service.py's "siempre siempre siempre" fallback for why this exists."""
from unittest.mock import patch

from app.services.relative_valuation_service import compute_relative_valuation


def _peer(price, shares, debt, cash, revenue):
    return {
        "current_price": price, "total_debt": debt, "cash": cash,
        "revenue_trend": [revenue], "dcf": {"shares_outstanding": shares},
        "pe_ratio": None, "ev_ebitda": None, "ev_fcf": None, "p_fcf": None,
    }


class TestEvSalesFallback:
    def test_uses_ev_sales_when_earnings_negative(self):
        # 5 real peers, each with a real EV/Sales ~3.0x
        peers = {f"PEER{i}": _peer(30.0, 100.0, 50.0, 20.0, 1000.0) for i in range(5)}
        with patch("app.services.relative_valuation_service._find_peers", return_value=list(peers)), \
             patch("app.services.fundamental_analysis_service.get_fundamental_analysis", side_effect=lambda t, **kw: peers[t]):
            result = compute_relative_valuation(
                "TARGET", price=10.0, shares_out=200.0,
                latest_eps=-5.0, latest_ebitda=-100.0, latest_fcf=-50.0,
                total_debt=100.0, cash=10.0, sector="Consumer Discretionary", industry=None,
                latest_revenue=2000.0,
            )
        assert result is not None
        assert result["peer_median_ev_sales"] == 3.03
        assert "ev_sales" in result["implied_values_by_multiple"]
        # Only ev_sales produced a value (all earnings-based multiples negative)
        assert result["intrinsic_value_per_share"] == result["implied_values_by_multiple"]["ev_sales"]

    def test_returns_none_without_latest_revenue(self):
        peers = {f"PEER{i}": _peer(30.0, 100.0, 50.0, 20.0, 1000.0) for i in range(5)}
        with patch("app.services.relative_valuation_service._find_peers", return_value=list(peers)), \
             patch("app.services.fundamental_analysis_service.get_fundamental_analysis", side_effect=lambda t, **kw: peers[t]):
            result = compute_relative_valuation(
                "TARGET", price=10.0, shares_out=200.0,
                latest_eps=-5.0, latest_ebitda=-100.0, latest_fcf=-50.0,
                total_debt=100.0, cash=10.0, sector="Consumer Discretionary", industry=None,
                latest_revenue=None,
            )
        assert result is None

    def test_skips_peer_missing_shares(self):
        peers = {
            "PEER0": _peer(30.0, 100.0, 50.0, 20.0, 1000.0),
            "PEER1": {**_peer(30.0, 100.0, 50.0, 20.0, 1000.0), "dcf": {}},  # no shares_outstanding
            "PEER2": _peer(30.0, 100.0, 50.0, 20.0, 1000.0),
            "PEER3": _peer(30.0, 100.0, 50.0, 20.0, 1000.0),
            "PEER4": _peer(30.0, 100.0, 50.0, 20.0, 1000.0),
        }
        with patch("app.services.relative_valuation_service._find_peers", return_value=list(peers)), \
             patch("app.services.fundamental_analysis_service.get_fundamental_analysis", side_effect=lambda t, **kw: peers[t]):
            result = compute_relative_valuation(
                "TARGET", price=10.0, shares_out=200.0,
                latest_eps=None, latest_ebitda=None, latest_fcf=None,
                total_debt=100.0, cash=10.0, sector="Consumer Discretionary", industry=None,
                latest_revenue=2000.0,
            )
        assert result is not None
        # 4 real peers produced an ev_sales value, not 5
        assert result["peer_median_ev_sales"] == 3.03


class TestResolveUniverseSectorIndustry:
    def test_known_ticker_returns_real_gics(self):
        from app.services.relative_valuation_service import resolve_universe_sector_industry
        with patch("app.api.routes.screener.UNIVERSE", [{"ticker": "RIVN", "sector": "Consumer Discretionary", "industry": "Auto Manufacturers"}]):
            assert resolve_universe_sector_industry("rivn") == ("Consumer Discretionary", "Auto Manufacturers")

    def test_unknown_ticker_returns_none_none(self):
        from app.services.relative_valuation_service import resolve_universe_sector_industry
        with patch("app.api.routes.screener.UNIVERSE", [{"ticker": "AAPL", "sector": "Technology", "industry": "Consumer Electronics"}]):
            assert resolve_universe_sector_industry("ZZZZ") == (None, None)
