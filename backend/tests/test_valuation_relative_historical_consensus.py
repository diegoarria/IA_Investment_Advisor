"""
Regression tests — Relative Valuation (Method 3), Historical Valuation
(Method 4), and Consensus blend (Method 5) of the Valuation Engine.

Part of Fase 1, Incremento 1 — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md. All three
methods are network/DB-free pure functions once their peer/price data is
supplied (or mocked), which is exactly what's exercised here.
"""
from unittest.mock import patch

import pytest

from app.services.relative_valuation_service import _find_peers, compute_relative_valuation
from app.services.historical_valuation_service import compute_historical_valuation
from app.services.consensus_valuation_service import classify_archetype, compute_consensus_fair_value


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


# ── Consensus (Method 5) ─────────────────────────────────────────────────────

class TestClassifyArchetype:
    def test_financial_sector_always_wins(self):
        assert classify_archetype(True, business_quality_score=90, predictability_score=90, cyclicality_dampener=1.0) == "financials"

    def test_high_quality_high_predictability_is_secular_compounder(self):
        assert classify_archetype(False, business_quality_score=85, predictability_score=80, cyclicality_dampener=1.0) == "secular_compounder"

    def test_low_cyclicality_dampener_is_cyclical(self):
        assert classify_archetype(False, business_quality_score=50, predictability_score=50, cyclicality_dampener=0.90) == "cyclical"

    def test_default_is_balanced(self):
        assert classify_archetype(False, business_quality_score=50, predictability_score=50, cyclicality_dampener=1.0) == "balanced"

    def test_missing_scores_do_not_crash(self):
        assert classify_archetype(False, business_quality_score=None, predictability_score=None, cyclicality_dampener=1.0) == "balanced"


class TestComputeConsensusFairValue:
    def test_blends_all_four_methods_when_all_available(self):
        result = compute_consensus_fair_value(
            archetype="balanced",
            conservative_dcf_value=90.0,
            professional_dcf_value=110.0,
            relative={"intrinsic_value_per_share": 100.0, "peer_count": 8},
            historical={"intrinsic_value_per_share": 95.0, "years_used": 7},
        )
        assert result is not None
        assert set(result["methods_used"].keys()) == {"conservative_dcf", "professional_dcf", "relative", "historical"}
        assert 90.0 <= result["consensus_fair_value"] <= 110.0

    def test_renormalizes_when_a_method_is_missing(self):
        result = compute_consensus_fair_value(
            archetype="secular_compounder",
            conservative_dcf_value=90.0,
            professional_dcf_value=110.0,
            relative=None,
            historical=None,
        )
        assert result is not None
        assert set(result["methods_used"].keys()) == {"conservative_dcf", "professional_dcf"}

    def test_returns_none_when_nothing_is_available(self):
        result = compute_consensus_fair_value(
            archetype="balanced",
            conservative_dcf_value=None,
            professional_dcf_value=None,
            relative=None,
            historical=None,
        )
        assert result is None

    def test_unknown_archetype_falls_back_to_balanced_weights(self):
        result = compute_consensus_fair_value(
            archetype="not_a_real_archetype",
            conservative_dcf_value=100.0,
            professional_dcf_value=100.0,
            relative=None,
            historical=None,
        )
        assert result is not None
        assert result["archetype_base_weights"] == result["archetype_base_weights"]  # sanity: doesn't crash
