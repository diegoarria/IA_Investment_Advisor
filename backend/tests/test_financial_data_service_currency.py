"""Regression test for a real bug found auditing Healthcare (2026-09-06):
Novo Nordisk (NVO, reports in DKK) showed a margin of safety of +89.1% with
a "fair value" of $429/share against a real $46.60 ADR price — a ~10x
mismatch. Root cause: `FMPProvider.get_income`/`YFinanceProvider.get_income`
in financial_data_service.py convert every OTHER income-statement line
(revenue, net income, EBITDA, etc.) to USD via `_conv(value, currency)`, but
left `diluted_eps`/`basic_eps` unconverted — so a foreign-currency reporter's
EPS stayed in its native currency (DKK) while everything else, and the
market price it gets compared against, is in USD. Fixed by wrapping both
EPS fields in the same `_conv`/`n()` call every other field already uses.
"""
from unittest.mock import Mock, patch

from app.services.financial_data_service import FMPProvider, _conv, _usd_rate


class TestFMPProviderEpsCurrencyConversion:
    def test_diluted_and_basic_eps_are_converted_to_usd_like_every_other_field(self):
        # A DKK reporter (Novo Nordisk-shaped): 100 DKK net income, 10 DKK EPS.
        # At a real DKK->USD rate of 0.145 (~6.9 DKK/USD), both must scale down
        # by the SAME factor — an inconsistent scale between net income and EPS
        # is exactly the bug (implied share count would also come out wrong).
        raw_row = {
            "date": "2025-12-31",
            "reportedCurrency": "DKK",
            "revenue": 1000.0,
            "netIncome": 100.0,
            "epsDiluted": 10.0,
            "eps": 10.0,
        }
        mock_response = Mock()
        mock_response.json.return_value = [raw_row]

        with patch("requests.get", return_value=mock_response), \
             patch("app.services.financial_data_service._usd_rate", return_value=0.145):
            rows = FMPProvider().get_income("NVO", annual=True, limit=5)

        assert len(rows) == 1
        row = rows[0]
        assert row["Net Income"] == round(100.0 * 0.145, 2)
        assert row["Diluted EPS"] == round(10.0 * 0.145, 2)
        assert row["Basic EPS"] == round(10.0 * 0.145, 2)
        # Net income and EPS must scale by the identical rate — the whole point
        # of the fix is that they can no longer silently drift onto different
        # currency scales.
        assert row["Net Income"] / row["Diluted EPS"] == 100.0 / 10.0

    def test_usd_reporter_eps_is_unaffected(self):
        raw_row = {
            "date": "2025-12-31",
            "reportedCurrency": "USD",
            "revenue": 1000.0,
            "netIncome": 100.0,
            "epsDiluted": 5.0,
            "eps": 5.0,
        }
        mock_response = Mock()
        mock_response.json.return_value = [raw_row]

        with patch("requests.get", return_value=mock_response):
            rows = FMPProvider().get_income("AAPL", annual=True, limit=5)

        assert rows[0]["Diluted EPS"] == 5.0
        assert rows[0]["Basic EPS"] == 5.0


class TestUsdRateFailurePropagation:
    """Second real gap found the same day: even after the fix above, a
    transient FX-quote outage (confirmed live: Yahoo's "CNYUSD=X" pair
    failing while auditing BABA right after the NVO fix) used to make
    `_usd_rate` return 1.0 on failure — indistinguishable from a genuine
    1:1 rate, so EVERY field silently stayed on its native-currency scale
    (not just EPS) while the real market price stayed in USD. `_usd_rate`
    must return None on a real failure, and `_conv` must propagate that
    as a missing value rather than silently returning the unconverted
    figure."""

    def test_usd_rate_returns_none_when_yfinance_lookup_fails(self):
        with patch("yfinance.Ticker", side_effect=Exception("rate limited")):
            assert _usd_rate("CNY") is None

    def test_usd_rate_returns_1_for_usd_without_any_network_call(self):
        assert _usd_rate("USD") == 1.0
        assert _usd_rate("") == 1.0

    def test_conv_propagates_none_instead_of_returning_unconverted_value(self):
        with patch("app.services.financial_data_service._usd_rate", return_value=None):
            assert _conv(853_062_000_000.0, "CNY") is None

    def test_fmp_income_row_is_entirely_none_for_a_foreign_reporter_during_an_fx_outage(self):
        raw_row = {
            "date": "2025-12-31",
            "reportedCurrency": "CNY",
            "revenue": 853_062_000_000.0,
            "netIncome": 62_249_000_000.0,
            "epsDiluted": 22.72,
            "eps": 22.96,
        }
        mock_response = Mock()
        mock_response.json.return_value = [raw_row]

        with patch("requests.get", return_value=mock_response), \
             patch("app.services.financial_data_service._usd_rate", return_value=None):
            rows = FMPProvider().get_income("BABA", annual=True, limit=5)

        row = rows[0]
        # Declines rather than fabricates a wrong-currency-scale figure —
        # every converted field must come back None, never the raw CNY value.
        assert row["Total Revenue"] is None
        assert row["Net Income"] is None
        assert row["Diluted EPS"] is None
        assert row["Basic EPS"] is None
