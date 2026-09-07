"""
Regression tests — Relative Valuation (Method 3) and Historical Valuation
(Method 4) of the Valuation Engine.

Part of Fase 1, Incremento 1 — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md. Both methods
are network/DB-free pure functions once their peer/price data is supplied
(or mocked), which is exactly what's exercised here.

Nuvos AI Fair Value Engine redesign, Incremento 12 — Consensus (Method 5,
the archetype-weighted blend of these two with Conservative/Professional
DCF) is retired; its tests (previously in this file, named
test_valuation_relative_historical_consensus.py) were removed along with
consensus_valuation_service.py. Relative/Historical themselves are
untouched — they still feed the exit multiple anchor (decision #1).
"""
from unittest.mock import patch

import pytest

from app.services.relative_valuation_service import _find_peers, compute_relative_valuation
from app.services.historical_valuation_service import compute_historical_valuation


# ── Relative Valuation (Method 3) ───────────────────────────────────────────

def _fake_peer_data(pe, ev_ebitda, ev_fcf, p_fcf):
    return {"pe_ratio": pe, "ev_ebitda": ev_ebitda, "ev_fcf": ev_fcf, "p_fcf": p_fcf}


class TestComputeRelativeValuation:
    def test_returns_none_with_fewer_than_min_peers(self):
        with patch("app.api.routes.screener.UNIVERSE", [
            {"ticker": "AAA", "sector": "Technology", "industry": "Software"},
            {"ticker": "BBB", "sector": "Technology", "industry": "Software"},
        ]):
            result = compute_relative_valuation(
                ticker="ZZZ", price=100.0, shares_out=10.0,
                latest_eps=5.0, latest_ebitda=200.0, latest_fcf=150.0,
                total_debt=50.0, cash=20.0, sector="Technology", industry="Software",
            )
        assert result is None

    def test_computes_median_implied_value_across_peers(self):
        # universe must contain exactly the cached peers — any peer NOT in
        # analysis_cache triggers a real (network) get_fundamental_analysis()
        # call, which must never happen in a unit test.
        universe = [{"ticker": f"PEER{i}", "sector": "Technology", "industry": "Software"} for i in range(5)]
        analysis_cache = {
            "PEER0": _fake_peer_data(20, 12, 15, 18),
            "PEER1": _fake_peer_data(22, 13, 16, 19),
            "PEER2": _fake_peer_data(18, 11, 14, 17),
            "PEER3": _fake_peer_data(21, 12.5, 15.5, 18.5),
            "PEER4": _fake_peer_data(19, 11.5, 14.5, 17.5),
        }
        with patch("app.api.routes.screener.UNIVERSE", universe):
            result = compute_relative_valuation(
                ticker="ZZZ", price=100.0, shares_out=10.0,
                latest_eps=5.0, latest_ebitda=200.0, latest_fcf=150.0,
                total_debt=50.0, cash=20.0, sector="Technology", industry="Software",
                analysis_cache=analysis_cache,
            )
        assert result is not None
        assert result["peer_count"] == 5
        assert result["intrinsic_value_per_share"] > 0
        assert set(result["implied_values_by_multiple"].keys()) == {"pe", "ev_ebitda", "ev_fcf", "p_fcf"}

    def test_returns_none_when_no_multiple_produces_a_usable_value(self):
        universe = [{"ticker": f"PEER{i}", "sector": "Technology", "industry": "Software"} for i in range(5)]
        analysis_cache = {f"PEER{i}": _fake_peer_data(None, None, None, None) for i in range(5)}
        with patch("app.api.routes.screener.UNIVERSE", universe):
            result = compute_relative_valuation(
                ticker="ZZZ", price=100.0, shares_out=10.0,
                latest_eps=None, latest_ebitda=None, latest_fcf=None,
                total_debt=50.0, cash=20.0, sector="Technology", industry="Software",
                analysis_cache=analysis_cache,
            )
        assert result is None

    def test_find_peers_prefers_industry_over_sector(self):
        universe = (
            [{"ticker": f"IND{i}", "sector": "Technology", "industry": "Software"} for i in range(6)]
            + [{"ticker": f"SEC{i}", "sector": "Technology", "industry": "Hardware"} for i in range(6)]
        )
        with patch("app.api.routes.screener.UNIVERSE", universe):
            peers = _find_peers("ZZZ", sector="Technology", industry="Software")
        assert all(p.startswith("IND") for p in peers)

    def test_find_peers_falls_back_to_sector_when_industry_too_small(self):
        # Same-industry group has only 1 company (below _MIN_PEERS) -> falls
        # back to the whole sector, which includes that 1 company too (the
        # fallback is sector-wide, not "sector minus the too-small industry").
        universe = (
            [{"ticker": "IND0", "sector": "Technology", "industry": "Software"}]
            + [{"ticker": f"SEC{i}", "sector": "Technology", "industry": "Hardware"} for i in range(6)]
        )
        with patch("app.api.routes.screener.UNIVERSE", universe):
            peers = _find_peers("ZZZ", sector="Technology", industry="Software")
        assert len(peers) >= 5
        assert "IND0" in peers
        assert all(p in ("IND0", *(f"SEC{i}" for i in range(6))) for p in peers)


# ── Historical Valuation (Method 4) ─────────────────────────────────────────

def _income_row(period, eps, ni, ebitda):
    return {"period": period, "Diluted EPS": eps, "Net Income": ni, "EBITDA": ebitda}


def _balance_row(cash=0.0):
    return {"Long Term Debt": 0, "Short Term Debt": 0, "Cash And Cash Equivalents": cash}


def _cashflow_row(ocf, capex):
    return {"Operating Cash Flow": ocf, "Capital Expenditure": capex}


class TestComputeHistoricalValuation:
    def test_returns_none_with_fewer_than_min_years(self):
        income = [_income_row(f"202{i}", 2.0, 100.0, 50.0) for i in range(3)]
        balance = [_balance_row() for _ in range(3)]
        cashflow = [_cashflow_row(60.0, -10.0) for _ in range(3)]
        result = compute_historical_valuation(
            "ZZZ", income, balance, cashflow, price=100.0, shares_out=10.0,
            total_debt=0, cash=0, latest_eps=5.0, latest_ebitda=200.0, latest_fcf=150.0,
        )
        assert result is None

    def test_computes_median_multiple_from_real_historical_prices(self):
        periods = [f"202{i}" for i in range(6)]
        income = [_income_row(p, 2.0, 100.0, 50.0) for p in periods]
        balance = [_balance_row(cash=10.0) for _ in periods]
        cashflow = [_cashflow_row(60.0, -10.0) for _ in periods]
        prices_by_date = {p: 40.0 for p in periods}  # implies a historical P/E of 20x

        with patch(
            "app.services.financial_data_service.get_historical_prices_near_dates",
            return_value=prices_by_date,
        ):
            result = compute_historical_valuation(
                "ZZZ", income, balance, cashflow, price=100.0, shares_out=10.0,
                total_debt=0, cash=0, latest_eps=5.0, latest_ebitda=200.0, latest_fcf=150.0,
            )
        assert result is not None
        assert result["years_used"] == 6
        assert result["historical_median_pe"] == pytest.approx(20.0, abs=0.1)
        # median P/E (20x) * latest_eps (5.0) = 100
        assert result["implied_values_by_multiple"]["pe"] == pytest.approx(100.0, abs=0.5)

    def test_historical_pe_is_recency_weighted_not_a_flat_median(self):
        """Diego, 2026-09-05 — real bug found auditing the full Energy
        sector: a flat median over the whole real history let a
        well-documented multi-year sector bust (oil & gas, 2014-2020)
        permanently drag down "historical_own_pe" for companies whose
        CURRENT earnings/multiple are perfectly normal (confirmed live for
        XOM). Fixed by recency-weighting the historical P/E (and EV/EBITDA/
        P-FCF) the same way `avg_fcf_margin`/ROE already are elsewhere in
        this codebase (`recency_weighted_average`, oldest=weight 1..newest=
        weight N) — a real crisis-era year still counts, just less than a
        recent, more representative one.

        4 old "depressed" years (real P/E 10x) + 2 recent "healthy" years
        (real P/E 30x). A flat median would land at 10x (4 of 6 points);
        recency weighting must land meaningfully ABOVE that, close to the
        hand-computed weighted average."""
        periods = [f"202{i}" for i in range(6)]
        income = [_income_row(p, 2.0, 100.0, 50.0) for p in periods]
        balance = [_balance_row(cash=10.0) for _ in periods]
        cashflow = [_cashflow_row(60.0, -10.0) for _ in periods]
        # EPS is a constant 2.0 -> price alone controls each year's real P/E.
        prices_by_date = {periods[i]: (20.0 if i < 4 else 60.0) for i in range(6)}  # P/E 10x (old) / 30x (recent)

        with patch(
            "app.services.financial_data_service.get_historical_prices_near_dates",
            return_value=prices_by_date,
        ):
            result = compute_historical_valuation(
                "ZZZ", income, balance, cashflow, price=100.0, shares_out=10.0,
                total_debt=0, cash=0, latest_eps=5.0, latest_ebitda=200.0, latest_fcf=150.0,
            )
        assert result is not None
        flat_median = 10.0
        # weights 1..6 (oldest..newest): (1+2+3+4)*10 + (5+6)*30 = 100 + 330 = 430; /21
        expected_weighted = 430 / 21
        assert result["historical_median_pe"] > flat_median + 2.0
        assert result["historical_median_pe"] == pytest.approx(expected_weighted, abs=0.15)

    def test_returns_none_when_no_price_history_available(self):
        periods = [f"202{i}" for i in range(6)]
        income = [_income_row(p, 2.0, 100.0, 50.0) for p in periods]
        balance = [_balance_row() for _ in periods]
        cashflow = [_cashflow_row(60.0, -10.0) for _ in periods]

        with patch("app.services.financial_data_service.get_historical_prices_near_dates", return_value={}):
            result = compute_historical_valuation(
                "ZZZ", income, balance, cashflow, price=100.0, shares_out=10.0,
                total_debt=0, cash=0, latest_eps=5.0, latest_ebitda=200.0, latest_fcf=150.0,
            )
        assert result is None
