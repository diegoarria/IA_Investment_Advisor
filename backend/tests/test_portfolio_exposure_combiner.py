"""Nuvos Plus — Fase 4A: portfolio exposure combiner.

Mocks every FMP-touching call (classify_asset, get_fmp_quote_price,
equity_profile.get_equity_profile, get_sector_group_es, _usd_rate,
etf.service.get_etf_overview) — these tests exercise the pure combination
math and the honesty rules (never fabricate a missing value, never claim
ETF-holding-level detail, never silently merge equity-domicile and
ETF-underlying geography)."""
import copy
from unittest.mock import patch

import pytest

from app.services.asset_classification import EQUITY, ETF, UNKNOWN
from app.services.portfolio_exposure import combiner


def _pos(ticker, shares, avg_price, name=None):
    return {"id": ticker, "ticker": ticker, "shares": shares, "avg_price": avg_price, "name": name}


def _etf_overview(price, nav_currency, sectors, sector_coverage, countries, country_coverage, name=None, etf_company=None):
    return {
        "price": {"current": price},
        "costs": {"nav_currency": nav_currency},
        "exposure": {
            "sector_weightings": sectors,
            "sector_weight_sum_in_expected_range": sector_coverage,
            "country_weightings": countries,
            "country_weight_sum_in_expected_range": country_coverage,
        },
        # Fase 5D: fund name/issuer -- optional kwargs so every pre-existing
        # call site (none of which cares about identity) keeps working
        # unmodified.
        "identification": {"name": name, "etf_company": etf_company},
    }


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.core import cache as cache_module
    cache_module._mem.clear()
    yield
    cache_module._mem.clear()


def _classify_map(mapping):
    def fake(ticker):
        return mapping.get(ticker.upper(), UNKNOWN)
    return fake


class TestEquityOnlyPortfolio:
    """Scenario 1 + 17: a portfolio with ONLY individual equities must work
    with zero ETF involvement."""

    def test_two_equities_value_and_sector_correctly(self):
        positions = [_pos("GOOGL", 100, 200.0), _pos("BRKB", 25, 400.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=_classify_map({"GOOGL": EQUITY, "BRKB": EQUITY})), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", side_effect=lambda t: {"GOOGL": 200.0, "BRKB": 400.0}[t]), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", side_effect=lambda t: {
                 "GOOGL": {"sector": "Communication Services", "country": "US", "currency": "USD"},
                 "BRKB": {"sector": "Financial Services", "country": "US", "currency": "USD"},
             }[t]), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", side_effect=lambda t: {
                 "GOOGL": "Comunicación de Servicios", "BRKB": "Finanzas",
             }[t]):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]

        assert all(p["verifiable"] for p in valued)
        valuation = combiner.compute_valuation_summary(valued)
        assert valuation["total_value_verified"] == 20000.0 + 10000.0
        composition = combiner.compute_composition(valued, valuation["total_value_verified"])
        assert composition["equity_pct"] == 100.0
        assert composition["etf_value"] == 0.0

    def test_single_equity_position(self):
        """Scenario 4: a portfolio with exactly one position."""
        positions = [_pos("AAPL", 10, 150.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=150.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        combiner.compute_weights(valued, 1500.0)
        assert valued[0]["weight_pct"] == 100.0

    def test_weight_fraction_is_full_precision_alongside_rounded_weight_pct(self):
        """Fase 5B.1: the historical engine needs the UNROUNDED ratio, not
        the 2-decimal display value — `_weight_fraction` must be the exact
        same division `weight_pct` rounds from, never a second
        calculation, and must be internal-only (stripped from the public
        HTTP contract, like `_etf_overview` already is)."""
        positions = [_pos("AAPL", 10, 150.0), _pos("MSFT", 7, 299.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", side_effect=lambda t: {"AAPL": 150.0, "MSFT": 299.0}[t]), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        total = sum(p["market_value"] for p in valued)
        combiner.compute_weights(valued, total)
        for p in valued:
            assert p["_weight_fraction"] == pytest.approx(p["market_value"] / total, abs=1e-12)
            assert p["weight_pct"] == round(p["_weight_fraction"] * 100, 2)
        from app.services.portfolio_exposure.service import _strip_internal_fields
        assert "_weight_fraction" not in _strip_internal_fields(valued[0])
        assert "weight_pct" in _strip_internal_fields(valued[0])


class TestEtfOnlyPortfolio:
    """Scenario 2: a portfolio with ONLY ETFs."""

    def test_two_etfs_combine_sector_weights(self):
        positions = [_pos("VOO", 100, 400.0), _pos("QQQ", 50, 400.0)]
        voo_overview = _etf_overview(400.0, "USD", [{"name": "Tecnología", "weight_pct": 32.0}], True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
        qqq_overview = _etf_overview(400.0, "USD", [{"name": "Tecnología", "weight_pct": 59.0}], True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", side_effect=lambda t, **k: {"VOO": voo_overview, "QQQ": qqq_overview}[t]):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]

        valuation = combiner.compute_valuation_summary(valued)
        composition = combiner.compute_composition(valued, valuation["total_value_verified"])
        assert composition["etf_pct"] == 100.0
        sector_exposure = combiner.compute_sector_exposure(valued)
        tech_row = next(r for r in sector_exposure["by_sector"] if r["sector"] == "Tecnología")
        expected_tech = 40000 * 0.32 + 20000 * 0.59
        assert tech_row["value"] == round(expected_tech, 2)


class TestMixedPortfolio:
    """Scenario 3: Diego's own worked example — VOO $40k, QQQ $30k, GOOGL
    $20k, BRK.B $10k — never duplicating capital, never misclassifying."""

    def test_diego_worked_example(self):
        positions = [_pos("VOO", 100, 400.0), _pos("QQQ", 75, 400.0), _pos("GOOGL", 100, 200.0), _pos("BRKB", 25, 400.0)]
        voo_overview = _etf_overview(400.0, "USD", [{"name": "Tecnología", "weight_pct": 32.0}], True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
        qqq_overview = _etf_overview(400.0, "USD", [{"name": "Tecnología", "weight_pct": 59.0}], True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)

        with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=_classify_map({"VOO": ETF, "QQQ": ETF, "GOOGL": EQUITY, "BRKB": EQUITY})), \
             patch("app.services.etf.service.get_etf_overview", side_effect=lambda t, **k: {"VOO": voo_overview, "QQQ": qqq_overview}[t]), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", side_effect=lambda t: {"GOOGL": 200.0, "BRKB": 400.0}[t]), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", side_effect=lambda t: {
                 "GOOGL": {"sector": "Communication Services", "country": "US", "currency": "USD"},
                 "BRKB": {"sector": "Financial Services", "country": "US", "currency": "USD"},
             }[t]), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", side_effect=lambda t: {
                 "GOOGL": "Comunicación de Servicios", "BRKB": "Finanzas",
             }[t]):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]

        valuation = combiner.compute_valuation_summary(valued)
        assert valuation["total_value_verified"] == 100000.0  # 40k+30k+20k+10k, no duplication
        combiner.compute_weights(valued, valuation["total_value_verified"])
        weights = {p["ticker"]: p["weight_pct"] for p in valued}
        assert weights["VOO"] == 40.0 and weights["QQQ"] == 30.0 and weights["GOOGL"] == 20.0 and weights["BRKB"] == 10.0

        composition = combiner.compute_composition(valued, valuation["total_value_verified"])
        assert composition["etf_pct"] == 70.0
        assert composition["equity_pct"] == 30.0

        sector_exposure = combiner.compute_sector_exposure(valued)
        tech_row = next(r for r in sector_exposure["by_sector"] if r["sector"] == "Tecnología")
        # 40,000*0.32 + 30,000*0.59 = 12,800 + 17,700 = 30,500
        assert tech_row["value"] == 30500.0
        assert tech_row["pct_of_verified_total"] == 30.5


class TestLargePortfolio:
    """Scenario 6: 20+ positions — the engine must not choke or silently
    truncate, and classification/valuation must apply independently to
    every single one."""

    def test_twenty_equity_positions(self):
        tickers = [f"TICK{i}" for i in range(22)]
        positions = [_pos(t, 10, 50.0) for t in tickers]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=55.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert len(valued) == 22
        assert all(p["verifiable"] for p in valued)
        valuation = combiner.compute_valuation_summary(valued)
        assert valuation["position_count"] == 22
        assert valuation["verified_position_count"] == 22


class TestEtfWithoutSectorDistribution:
    """Scenario 7 + 14: an ETF whose own sector-weightings coverage isn't
    confirmed complete must NEVER contribute a guessed sector percentage —
    its whole value goes to unclassified."""

    def test_etf_with_unconfirmed_sector_coverage_goes_unclassified(self):
        positions = [_pos("WEIRD", 10, 100.0)]
        overview = _etf_overview(100.0, "USD", [{"name": "Tecnología", "weight_pct": 10.0}], False, [], None)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        sector_exposure = combiner.compute_sector_exposure(valued)
        assert sector_exposure["by_sector"] == []
        assert sector_exposure["unclassified_value"] == 1000.0
        assert sector_exposure["coverage_pct"] == 0.0

    def test_etf_with_empty_sector_list_goes_unclassified(self):
        positions = [_pos("BOND", 10, 100.0)]
        overview = _etf_overview(100.0, "USD", [], True, [], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        sector_exposure = combiner.compute_sector_exposure(valued)
        assert sector_exposure["by_sector"] == []


class TestGeographicNotVerifiable:
    """Fase 4B explicit scenario: an ETF whose own country-weightings
    coverage isn't confirmed complete must never contribute a guessed
    geographic percentage — same discipline as the sector case, applied
    to geography specifically."""

    def test_etf_with_unconfirmed_country_coverage_excluded_from_rows(self):
        positions = [_pos("WEIRD", 10, 100.0)]
        overview = _etf_overview(100.0, "USD", [], True, [{"name": "Estados Unidos", "weight_pct": 50.0}], False)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        geo = combiner.compute_geographic_exposure(valued)
        assert geo["by_country"] == []
        assert geo["etf_underlying_coverage_pct"] == 0.0

    def test_equity_with_unrecognized_country_code_stays_unverifiable_for_geography(self):
        """A country code outside country_codes.py's known set (not a
        guess — a real gap) must not produce a fabricated country row."""
        positions = [_pos("OBSCURE", 10, 100.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=100.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "XX", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["country"] is None
        geo = combiner.compute_geographic_exposure(valued)
        assert geo["by_country"] == []
        assert geo["equity_domicile_coverage_pct"] == 0.0


class TestUnclassifiedEquity:
    """Scenario 8: an equity sector_lookup can't classify stays visible,
    contributes zero to sector totals, and is counted in the coverage
    gap — never dropped, never guessed."""

    def test_equity_with_no_sector_classification(self):
        positions = [_pos("OBSCURE", 10, 100.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=100.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": None, "country": None, "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value=None):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["verifiable"] is True
        assert valued[0]["sector"] is None
        sector_exposure = combiner.compute_sector_exposure(valued)
        assert sector_exposure["by_sector"] == []
        assert sector_exposure["unclassified_value"] == 1000.0


class TestUnknownTicker:
    """Scenario 9: a ticker classify_asset can't identify at all (doesn't
    exist / neither ETF nor equity) stays in the position list, visibly
    unverifiable, never silently dropped."""

    def test_nonexistent_ticker_stays_visible_as_unverifiable(self):
        positions = [_pos("NOTREAL", 10, 100.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=UNKNOWN):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert len(valued) == 1
        assert valued[0]["verifiable"] is False
        assert valued[0]["unverifiable_reason"] == "unclassified_asset"
        assert valued[0]["cost_basis"] == 1000.0  # cost basis still shown, just never counted as verified


class TestMissingMarketPrice:
    """Scenario 11: a classifiable ticker whose live quote can't be
    fetched must be excluded from the verified total, not silently
    priced at cost."""

    def test_equity_missing_quote(self):
        positions = [_pos("NOQUOTE", 10, 100.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=None):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["verifiable"] is False
        assert valued[0]["unverifiable_reason"] == "no_price"
        assert valued[0]["market_value"] is None

    def test_etf_missing_quote(self):
        positions = [_pos("NOQUOTEETF", 10, 100.0)]
        overview = _etf_overview(None, "USD", [], True, [], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["verifiable"] is False
        assert valued[0]["unverifiable_reason"] == "no_price"


class TestMixedCurrencies:
    """Scenario 12 + 13: a portfolio with assets quoted in different
    currencies than the portfolio's own base currency."""

    def test_foreign_currency_converted_correctly(self):
        positions = [_pos("EURO", 10, 90.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=100.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "DE", "currency": "EUR"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"), \
             patch("app.services.portfolio_exposure.combiner._usd_rate", side_effect=lambda c: {"EUR": 1.1, "USD": 1.0}[c]):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["verifiable"] is True
        assert valued[0]["quote_currency"] == "EUR"
        assert valued[0]["fx_rate_applied"] == 1.1
        assert valued[0]["market_value"] == 1100.0  # 10 shares * 100 EUR * 1.1 EUR->USD

    def test_fx_lookup_failure_never_fabricates_a_rate(self):
        positions = [_pos("EURO", 10, 90.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=100.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "DE", "currency": "EUR"}), \
             patch("app.services.portfolio_exposure.combiner._usd_rate", return_value=None):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["verifiable"] is False
        assert valued[0]["unverifiable_reason"] == "fx_conversion_failed"
        assert valued[0]["market_value"] is None

    def test_unknown_quote_currency_never_assumed_as_portfolio_currency(self):
        positions = [_pos("MYSTERY", 10, 90.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=100.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": None, "currency": None}):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["verifiable"] is False
        assert valued[0]["unverifiable_reason"] == "currency_unknown"


class TestGeographicMethodologySeparation:
    """Part 1.5 / module docstring constraint 4: equity-domicile and
    ETF-underlying geography are never merged, even when the country name
    coincides."""

    def test_same_country_name_produces_two_separate_tagged_rows(self):
        positions = [_pos("GOOGL", 10, 200.0), _pos("VOO", 10, 400.0)]
        voo_overview = _etf_overview(400.0, "USD", [], True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=_classify_map({"GOOGL": EQUITY, "VOO": ETF})), \
             patch("app.services.etf.service.get_etf_overview", return_value=voo_overview), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=200.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Communication Services", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Comunicación de Servicios"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        geo = combiner.compute_geographic_exposure(valued)
        methodologies = {row["methodology"] for row in geo["by_country"]}
        assert methodologies == {"equity_domicile", "etf_underlying"}
        us_rows = [r for r in geo["by_country"] if r["country"] == "Estados Unidos"]
        assert len(us_rows) == 2  # never merged into one

    def test_each_country_row_percentage_is_of_its_own_asset_class_subset(self):
        """Fase 4C audit, Diego's point 1: confirms exactly what denominator
        each country row uses. equity_domicile rows must be a % of the
        EQUITY-only total, never the whole portfolio; etf_underlying rows
        must be a % of the ETF-only total. The field name itself
        (`pct_of_asset_class_value`, not `pct_of_verified_total`) must
        make this explicit — a row with the wrong field would KeyError
        here, not silently read a stale/wrong number."""
        positions = [_pos("GOOGL", 10, 200.0), _pos("VOO", 10, 400.0)]
        voo_overview = _etf_overview(400.0, "USD", [], True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=_classify_map({"GOOGL": EQUITY, "VOO": ETF})), \
             patch("app.services.etf.service.get_etf_overview", return_value=voo_overview), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=200.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Communication Services", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Comunicación de Servicios"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        geo = combiner.compute_geographic_exposure(valued)

        equity_row = next(r for r in geo["by_country"] if r["methodology"] == "equity_domicile")
        etf_row = next(r for r in geo["by_country"] if r["methodology"] == "etf_underlying")

        # GOOGL is the ONLY equity ($2,000) — its domicile row must be
        # 100% of the equity-only subset, NOT ~33% of the $6,000 whole
        # portfolio (2,000 GOOGL + 4,000 VOO).
        assert equity_row["pct_of_asset_class_value"] == 100.0
        assert equity_row["asset_class_total_value"] == 2000.0

        # VOO is the ONLY ETF ($4,000), 99% US underlying — its row must
        # be ~99% of the ETF-only subset, not ~66% of the whole portfolio.
        assert etf_row["pct_of_asset_class_value"] == 99.0
        assert etf_row["asset_class_total_value"] == 4000.0

        # the old, misleading field name must not reappear on country rows
        assert "pct_of_verified_total" not in equity_row
        assert "pct_of_verified_total" not in etf_row

    def test_adding_to_an_etf_never_changes_equity_domicile_percentages(self):
        """The literal scenario Diego reported: +$1,000 into VOO (an ETF)
        must leave every equity_domicile row's percentage EXACTLY
        unchanged, because its denominator (the equity-only subset) isn't
        touched by an ETF addition at all — proof the subset-based
        denominator is mathematically self-consistent, not a bug in the
        arithmetic itself (the bug was only the field's name)."""
        positions = [_pos("GOOGL", 10, 200.0), _pos("VOO", 10, 400.0)]
        voo_overview = _etf_overview(400.0, "USD", [], True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=_classify_map({"GOOGL": EQUITY, "VOO": ETF})), \
             patch("app.services.etf.service.get_etf_overview", return_value=voo_overview), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=200.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Communication Services", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Comunicación de Servicios"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]

        hypothetical = {
            "ticker": "VOO", "name": None, "asset_class": ETF, "shares": None, "avg_price": None,
            "cost_basis": 1000.0, "market_value": 1000.0, "verifiable": True, "unverifiable_reason": None,
            "quote_currency": "USD", "fx_rate_applied": 1.0, "sector": None, "country": None,
            "price_fetched_at": 0.0, "is_hypothetical": True, "_etf_overview": voo_overview,
        }
        sim = combiner.simulate_addition(valued, hypothetical)

        equity_before = next(r for r in sim["before"]["geographic_exposure"]["by_country"] if r["methodology"] == "equity_domicile")
        equity_after = next(r for r in sim["after"]["geographic_exposure"]["by_country"] if r["methodology"] == "equity_domicile")
        assert equity_before["pct_of_asset_class_value"] == equity_after["pct_of_asset_class_value"] == 100.0
        assert equity_before["asset_class_total_value"] == equity_after["asset_class_total_value"] == 2000.0  # untouched

        # the ETF subset DID grow — its own row's % may shift (not asserted
        # to an exact number here, just that the subset total grew by $1,000)
        etf_before = next(r for r in sim["before"]["geographic_exposure"]["by_country"] if r["methodology"] == "etf_underlying")
        etf_after = next(r for r in sim["after"]["geographic_exposure"]["by_country"] if r["methodology"] == "etf_underlying")
        assert etf_after["asset_class_total_value"] == pytest.approx(etf_before["asset_class_total_value"] + 1000.0, abs=0.01)

        # and no country delta was silently computed against the wrong field
        for d in sim["country_deltas"]:
            assert "pct_before" in d and "pct_after" in d and d["pct_before"] is not None


class TestSinglePositionConcentration:
    """Scenario 16: one position dominating the portfolio must be
    reflected honestly in weight and surfaced by insights.py — never as a
    risk label, only as a plain percentage."""

    def test_concentrated_position_flows_into_insight(self):
        positions = [_pos("BIGONE", 100, 100.0), _pos("SMALL", 1, 100.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", side_effect=lambda t: 100.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        valuation = combiner.compute_valuation_summary(valued)
        combiner.compute_weights(valued, valuation["total_value_verified"])
        concentration = combiner.compute_concentration(valued)
        assert concentration["largest_single_position_pct"] > 99.0

        from app.services.portfolio_exposure.insights import build_insights
        sector_exposure = combiner.compute_sector_exposure(valued)
        insights = build_insights(valued, sector_exposure, concentration, valuation)
        assert any(i["category"] == "single_position_concentration" and "BIGONE" in i["text"] for i in insights)
        for i in insights:
            lowered = i["text"].lower()
            assert "riesgo" not in lowered and "recomend" not in lowered


class TestInsightsNeverRepeatSummaryMetrics:
    """Diego, 2026-11 (Mi distribución visual refinement #1): the
    equity%/ETF% composition split is already shown verbatim in the
    Resumen cards — "Lo que debes entender" must never restate it, and
    must prioritize concentration, then sector, then coverage instead."""

    def test_composition_category_never_appears(self):
        positions = [_pos("VOO", 100, 400.0), _pos("GOOGL", 100, 200.0)]
        overview = _etf_overview(400.0, "USD", [{"name": "Tecnología", "weight_pct": 32.0}], True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=_classify_map({"VOO": ETF, "GOOGL": EQUITY})), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=200.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Communication Services", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Comunicación de Servicios"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        valuation = combiner.compute_valuation_summary(valued)
        combiner.compute_weights(valued, valuation["total_value_verified"])
        concentration = combiner.compute_concentration(valued)
        sector_exposure = combiner.compute_sector_exposure(valued)

        from app.services.portfolio_exposure.insights import build_insights
        insights = build_insights(valued, sector_exposure, concentration, valuation)
        assert not any(i["category"] == "composition" for i in insights)

    def test_priority_order_is_concentration_then_sector_then_coverage(self):
        """A portfolio engineered to qualify for all three remaining
        categories at once — top_holdings/single_position_concentration
        must come before dominant_sector, which must come before
        coverage_gap."""
        positions = [_pos("ONLYONE", 100, 100.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=100.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        valuation = combiner.compute_valuation_summary(valued)
        combiner.compute_weights(valued, valuation["total_value_verified"])
        concentration = combiner.compute_concentration(valued)
        sector_exposure = combiner.compute_sector_exposure(valued)

        from app.services.portfolio_exposure.insights import build_insights
        insights = build_insights(valued, sector_exposure, concentration, valuation)
        categories = [i["category"] for i in insights]
        assert categories[0] == "single_position_concentration"
        if "dominant_sector" in categories:
            assert categories.index("dominant_sector") > categories.index("single_position_concentration")


class TestNeverMutatesOriginalPositions:
    """Scenario 18: nothing in the combiner mutates the caller's original
    position dicts — the exposure engine is read-only all the way down."""

    def test_aggregate_and_value_do_not_mutate_input(self):
        positions = [_pos("VOO", 100, 400.0)]
        original = copy.deepcopy(positions)
        overview = _etf_overview(400.0, "USD", [{"name": "Tecnología", "weight_pct": 30.0}], True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            combiner.aggregate_and_classify(positions)
            combiner.aggregate_and_classify(positions)  # called twice — must stay idempotent too
        assert positions == original


class TestDominantSectorPerPositionContribution:
    """Diego, 2026-11: the dominant-sector observation must show WHERE a
    sector's weight comes from — each real contributing position's own
    percentage-POINT contribution to the whole portfolio, not just the
    sector total — and carry coverage/limitations in supporting_data.
    Mirrors Diego's own real Supabase Local portfolio (VOO, QQQ, GOOGL,
    ASML) that originally surfaced the 81.7% sector-coverage gap."""

    def _diego_portfolio_valued(self):
        # Realistic FULL sector breakdowns (summing close to 100%, like
        # real FMP data) — not just the Tecnología row — so tests that
        # check whether sector percentages sum to the whole portfolio
        # actually exercise that invariant instead of a partial mock.
        voo_sectors = [
            {"name": "Tecnología", "weight_pct": 32.0}, {"name": "Servicios financieros", "weight_pct": 13.0},
            {"name": "Salud", "weight_pct": 11.0}, {"name": "Consumo cíclico", "weight_pct": 10.0},
            {"name": "Servicios de comunicación", "weight_pct": 9.0}, {"name": "Industriales", "weight_pct": 8.0},
            {"name": "Consumo defensivo", "weight_pct": 6.0}, {"name": "Energía", "weight_pct": 3.0},
            {"name": "Servicios públicos", "weight_pct": 2.5}, {"name": "Bienes raíces", "weight_pct": 2.5},
            {"name": "Materiales básicos", "weight_pct": 2.0},
        ]
        qqq_sectors = [
            {"name": "Tecnología", "weight_pct": 59.0}, {"name": "Consumo cíclico", "weight_pct": 17.0},
            {"name": "Servicios de comunicación", "weight_pct": 15.0}, {"name": "Salud", "weight_pct": 6.0},
            {"name": "Consumo defensivo", "weight_pct": 3.0},
        ]
        positions = [_pos("VOO", 10, 400.0), _pos("QQQ", 5, 400.0), _pos("GOOGL", 10, 180.0), _pos("ASML", 2, 650.0)]
        voo_overview = _etf_overview(704.78, "USD", voo_sectors, True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
        qqq_overview = _etf_overview(691.95, "USD", qqq_sectors, True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=_classify_map({"VOO": ETF, "QQQ": ETF, "GOOGL": EQUITY, "ASML": EQUITY})), \
             patch("app.services.etf.service.get_etf_overview", side_effect=lambda t, **k: {"VOO": voo_overview, "QQQ": qqq_overview}[t]), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", side_effect=lambda t: {"GOOGL": 349.51, "ASML": 1496.3}[t]), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", side_effect=lambda t: {
                 "GOOGL": {"sector": "Communication Services", "country": "US", "currency": "USD"},
                 "ASML": {"sector": "Technology", "country": "NL", "currency": "USD"},
             }[t]), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", side_effect=lambda t: {
                 "GOOGL": "Comunicación de Servicios", "ASML": "Tecnología",
             }[t]):
            agg = combiner.aggregate_and_classify(positions)
            return [combiner.value_position(p, "USD") for p in agg]

    def test_asml_classifies_as_technology_not_unclassified(self):
        """The real bug this reproduces: ASML — not in the S&P 500
        UNIVERSE table, so it needs sector_lookup's Finnhub fallback —
        must end up classified once that fallback actually has data,
        never silently excluded from sector coverage."""
        valued = self._diego_portfolio_valued()
        asml = next(p for p in valued if p["ticker"] == "ASML")
        assert asml["verifiable"] is True
        assert asml["sector"] == "Tecnología"
        sector_exposure = combiner.compute_sector_exposure(valued)
        assert sector_exposure["coverage_pct"] == 100.0
        assert sector_exposure["unclassified_value"] == 0.0

    def test_sector_contributions_sum_without_duplicating_capital(self):
        """Every position's contribution to Tecnología must come from its
        OWN real weight (ETF sector weighting or equity classification) —
        summing all contributors' dollar values must never exceed the
        sector's own total, and must never exceed the portfolio total."""
        valued = self._diego_portfolio_valued()
        sector_exposure = combiner.compute_sector_exposure(valued)
        tech_row = next(r for r in sector_exposure["by_sector"] if r["sector"] == "Tecnología")
        verified_total = sum(p["market_value"] for p in valued if p["verifiable"])
        assert tech_row["value"] <= verified_total + 0.01
        # VOO + QQQ's real tech weight + ASML's full value, no more
        voo = next(p for p in valued if p["ticker"] == "VOO")
        qqq = next(p for p in valued if p["ticker"] == "QQQ")
        asml = next(p for p in valued if p["ticker"] == "ASML")
        expected = voo["market_value"] * 0.32 + qqq["market_value"] * 0.59 + asml["market_value"]
        assert tech_row["value"] == round(expected, 2)

    def test_observation_text_numbers_match_supporting_data(self):
        from app.services.portfolio_exposure.insights import build_insights
        valued = self._diego_portfolio_valued()
        valuation = combiner.compute_valuation_summary(valued)
        combiner.compute_weights(valued, valuation["total_value_verified"])
        sector_exposure = combiner.compute_sector_exposure(valued)
        concentration = combiner.compute_concentration(valued)
        insights = build_insights(valued, sector_exposure, concentration, valuation)
        sector_insight = next(i for i in insights if i["category"] == "dominant_sector")

        sd = sector_insight["supporting_data"]
        assert sd["sector"] == "Tecnología"
        assert "sector_coverage_pct" in sd and "unclassified_value" in sd  # coverage/limitations inspectable
        assert len(sd["contributors"]) >= 2  # VOO, QQQ, and ASML all contribute

        # Every contributor's ticker and point-contribution number that
        # appears in the text must be traceable to supporting_data —
        # never a number in the prose that isn't backed by real data.
        for c in sd["contributors"][:3]:
            assert c["ticker"] in sector_insight["text"]
            assert f"{c['contribution_pct_points']:.1f}" in sector_insight["text"]

        for forbidden in ("riesgo", "recomend", "deberías", "conviene"):
            assert forbidden not in sector_insight["text"].lower()

    def test_no_dominant_sector_observation_when_verified_total_is_zero(self):
        from app.services.portfolio_exposure.insights import build_insights
        sector_exposure = {"by_sector": [{"sector": "Tecnología", "value": 0.0, "pct_of_verified_total": 100.0}], "coverage_pct": 100.0, "unclassified_value": 0.0}
        insights = build_insights([], sector_exposure, {"top_positions": [], "largest_single_position_pct": None}, {"valuation_coverage_pct": None})
        assert not any(i["category"] == "dominant_sector" for i in insights)

    def test_sector_rows_sum_to_whole_portfolio_when_coverage_is_complete(self):
        """Fase 4C pre-audit, Diego's explicit ask: formally lock the
        invariant the manual Supabase Local check demonstrated — when
        every position is classified (100% coverage), the sector rows'
        percentages must sum to ~100% of the verified total. A meaningful
        gap here would mean capital is being double-counted or dropped
        somewhere in the sector combination math."""
        valued = self._diego_portfolio_valued()
        sector_exposure = combiner.compute_sector_exposure(valued)
        assert sector_exposure["coverage_pct"] == 100.0
        assert sector_exposure["unclassified_value"] == 0.0
        total_pct = sum(r["pct_of_verified_total"] for r in sector_exposure["by_sector"])
        assert 99.0 <= total_pct <= 101.0  # small tolerance for independent per-row rounding


class TestAssetIdentityFase5D:
    """Fase 5D: real company/fund name, from data already fetched for
    valuation -- never a second FMP call, never a guessed/derived name."""

    def test_equity_without_a_user_typed_name_gets_the_real_company_name(self):
        positions = [_pos("AAPL", 10, 150.0)]  # no `name` kwarg -> None
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=150.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "US", "currency": "USD", "company_name": "Apple Inc."}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["name"] == "Apple Inc."

    def test_a_user_typed_name_is_never_overwritten_by_the_real_one(self):
        positions = [_pos("AAPL", 10, 150.0, name="Mi apodo para Apple")]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=150.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "US", "currency": "USD", "company_name": "Apple Inc."}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["name"] == "Mi apodo para Apple"

    def test_etf_gets_the_real_fund_name_and_issuer_never_a_holding(self):
        positions = [_pos("VOO", 10, 400.0)]
        overview = _etf_overview(400.0, "USD", [], True, [], True, name="Vanguard S&P 500 ETF", etf_company="Vanguard")
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["name"] == "Vanguard S&P 500 ETF"
        assert valued[0]["etf_company"] == "Vanguard"

    def test_missing_name_metadata_never_blocks_valuation(self):
        """If FMP didn't return a name, the position is still verifiable
        and valued correctly -- absent identity metadata never breaks
        Distribución/Exposición/Historia."""
        positions = [_pos("AAPL", 10, 150.0)]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=150.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": None, "country": None, "currency": "USD", "company_name": None}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value=None):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        assert valued[0]["name"] is None
        assert valued[0]["verifiable"] is True
        assert valued[0]["market_value"] == 1500.0

    def test_hypothetical_equity_position_gets_a_real_name(self):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Consumer Defensive", "country": "US", "currency": "USD", "company_name": "The Coca-Cola Company"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Consumo defensivo"):
            hypothetical = combiner.build_hypothetical_position("KO", 800, "USD")
        assert hypothetical["name"] == "The Coca-Cola Company"

    def test_hypothetical_etf_position_gets_real_fund_name_and_issuer(self):
        overview = _etf_overview(400.0, "USD", [], True, [], True, name="Invesco QQQ Trust", etf_company="Invesco")
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            hypothetical = combiner.build_hypothetical_position("QQQ", 800, "USD")
        assert hypothetical["name"] == "Invesco QQQ Trust"
        assert hypothetical["etf_company"] == "Invesco"

    def test_name_lookup_never_cross_contaminates_between_tickers(self):
        """Two different real positions must each get THEIR OWN real name
        -- never another position's name leaking across."""
        positions = [_pos("AAPL", 10, 150.0), _pos("MSFT", 5, 300.0)]
        names = {"AAPL": "Apple Inc.", "MSFT": "Microsoft Corporation"}
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", side_effect=lambda t: {"AAPL": 150.0, "MSFT": 300.0}[t]), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", side_effect=lambda t: {"sector": "Technology", "country": "US", "currency": "USD", "company_name": names[t]}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        by_ticker = {p["ticker"]: p["name"] for p in valued}
        assert by_ticker == {"AAPL": "Apple Inc.", "MSFT": "Microsoft Corporation"}
