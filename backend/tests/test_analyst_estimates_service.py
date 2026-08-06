"""
Tests — app.services.analyst_estimates_service (Nuvos AI Fair Value Engine
redesign, Incremento 3).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md. Mocks
yfinance entirely — no real network calls.
"""
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from app.services.analyst_estimates_service import get_analyst_estimates, _next_year_growth


def _estimate_df(rows: dict[str, dict]) -> pd.DataFrame:
    """Builds a DataFrame shaped like yfinance's earnings_estimate/
    revenue_estimate — index = period label, columns avg/low/high/growth."""
    return pd.DataFrame.from_dict(rows, orient="index")


class TestGetAnalystEstimates:
    def test_returns_normalized_estimates_from_yfinance(self):
        eps_df = _estimate_df({
            "0y": {"avg": 5.0, "low": 4.5, "high": 5.5, "growth": 0.05},
            "+1y": {"avg": 5.5, "low": 5.0, "high": 6.0, "growth": 0.10},
        })
        rev_df = _estimate_df({
            "0y": {"avg": 1000.0, "low": 900.0, "high": 1100.0, "growth": 0.03},
            "+1y": {"avg": 1100.0, "low": 1000.0, "high": 1200.0, "growth": 0.10},
        })
        mock_ticker = MagicMock()
        mock_ticker.earnings_estimate = eps_df
        mock_ticker.revenue_estimate = rev_df
        mock_ticker.info = {"numberOfAnalystOpinions": 12}

        with patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_analyst_estimates("AAPL")

        assert result is not None
        assert result.source == "yfinance"
        assert len(result.eps_estimates) == 2
        assert len(result.revenue_estimates) == 2
        assert result.n_analysts == 12
        assert result.revenue_growth_next_year_pct == pytest.approx(10.0)
        assert result.eps_growth_next_year_pct == pytest.approx(10.0)

    def test_returns_none_when_yfinance_has_nothing(self):
        mock_ticker = MagicMock()
        mock_ticker.earnings_estimate = pd.DataFrame()
        mock_ticker.revenue_estimate = pd.DataFrame()
        mock_ticker.info = {}

        with patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_analyst_estimates("OBSCURETICKER")

        assert result is None

    def test_returns_none_on_yfinance_exception_never_raises(self):
        with patch("yfinance.Ticker", side_effect=Exception("network down")):
            result = get_analyst_estimates("AAPL")
        assert result is None

    def test_degrades_gracefully_when_only_eps_estimate_available(self):
        eps_df = _estimate_df({"+1y": {"avg": 5.5, "low": 5.0, "high": 6.0, "growth": 0.08}})
        mock_ticker = MagicMock()
        mock_ticker.earnings_estimate = eps_df
        mock_ticker.revenue_estimate = pd.DataFrame()
        mock_ticker.info = {}

        with patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_analyst_estimates("AAPL")

        assert result is not None
        assert result.eps_growth_next_year_pct == pytest.approx(8.0)
        assert result.revenue_growth_next_year_pct is None


class TestNextYearGrowth:
    def test_prefers_second_entry_when_two_present(self):
        assert _next_year_growth([{"growth": 3.0}, {"growth": 10.0}]) == 10.0

    def test_falls_back_to_first_entry_when_only_one_present(self):
        assert _next_year_growth([{"growth": 7.0}]) == 7.0

    def test_none_when_no_entries(self):
        assert _next_year_growth([]) is None
