"""
Tests — app.services.quality.capital_allocation_engine (Fase 2, Incremento 4).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import patch

import pytest

from app.services.quality.capital_allocation_engine import (
    evaluate_buyback_timing,
    evaluate_dividend_consistency,
    evaluate_reinvestment_quality,
    compute_capital_allocation_score,
    ACQUISITIONS_NOTE,
)


class TestEvaluateBuybackTiming:
    def test_returns_none_without_current_price(self):
        score, years = evaluate_buyback_timing("AAPL", [100.0, 95.0], ["2023-12-31", "2024-12-31"], None)
        assert score is None
        assert years == []

    def test_returns_none_with_no_real_buyback_years(self):
        # shares constant/growing -> no real buyback detected
        score, years = evaluate_buyback_timing("AAPL", [100.0, 100.0, 101.0], ["a", "b", "c"], 200.0)
        assert score is None
        assert years == []

    def test_detects_buyback_and_scores_good_hindsight(self):
        implied_shares = [100.0, 95.0]  # 5% reduction -> real buyback
        dates = ["2023-12-31", "2024-12-31"]
        with patch(
            "app.services.financial_data_service.get_historical_prices_near_dates",
            return_value={"2024-12-31": 50.0},
        ):
            score, years = evaluate_buyback_timing("AAPL", implied_shares, dates, current_price=100.0)
        assert score == 100.0  # current (100) > price at buyback (50) -> looks good
        assert len(years) == 1
        assert years[0].looks_good_in_hindsight is True
        assert years[0].shares_reduced_pct == pytest.approx(5.0)

    def test_detects_buyback_and_scores_bad_hindsight(self):
        with patch(
            "app.services.financial_data_service.get_historical_prices_near_dates",
            return_value={"2024-12-31": 150.0},
        ):
            score, years = evaluate_buyback_timing("AAPL", [100.0, 95.0], ["2023-12-31", "2024-12-31"], current_price=100.0)
        assert score == 0.0  # current (100) < price at buyback (150) -> looks expensive
        assert years[0].looks_good_in_hindsight is False

    def test_ignores_small_share_count_noise_below_1pct(self):
        # 0.5% change is noise, not a real buyback
        score, years = evaluate_buyback_timing("AAPL", [100.0, 99.7], ["a", "b"], current_price=100.0)
        assert score is None
        assert years == []

    def test_handles_missing_price_data_gracefully(self):
        with patch("app.services.financial_data_service.get_historical_prices_near_dates", return_value={"2024-12-31": None}):
            score, years = evaluate_buyback_timing("AAPL", [100.0, 95.0], ["2023-12-31", "2024-12-31"], current_price=100.0)
        assert score is None  # no evaluated years
        assert len(years) == 1
        assert years[0].looks_good_in_hindsight is None


class TestEvaluateDividendConsistency:
    def test_none_score_with_fewer_than_3_years(self):
        score, cuts = evaluate_dividend_consistency([10.0, 11.0])
        assert score is None
        assert cuts is None

    def test_no_cuts_scores_high(self):
        score, cuts = evaluate_dividend_consistency([10.0, 11.0, 12.0, 13.0])
        assert cuts == 0
        assert score == 95.0

    def test_detects_a_real_cut(self):
        score, cuts = evaluate_dividend_consistency([10.0, 11.0, 5.0, 6.0])  # >10% drop
        assert cuts == 1
        assert score == 65.0

    def test_ignores_none_entries(self):
        score, cuts = evaluate_dividend_consistency([10.0, None, 11.0, 12.0])
        assert cuts == 0

    def test_score_floors_at_10(self):
        score, cuts = evaluate_dividend_consistency([100.0, 10.0, 1.0, 0.1, 0.01])  # multiple cuts
        assert score == 10.0


class TestEvaluateReinvestmentQuality:
    def test_none_with_insufficient_data(self):
        assert evaluate_reinvestment_quality([0.3]) is None

    def test_stable_reinvestment_scores_high(self):
        score = evaluate_reinvestment_quality([0.30, 0.31, 0.29, 0.30, 0.32])
        assert score >= 80

    def test_volatile_reinvestment_scores_low(self):
        score = evaluate_reinvestment_quality([0.10, 0.90, 0.05, 0.95, 0.02])
        assert score <= 40


class TestComputeCapitalAllocationScore:
    def _base_kwargs(self, **overrides):
        kwargs = dict(
            ticker="AAPL", current_price=100.0,
            implied_shares_trend=[100.0, 98.0, 96.0, 94.0],
            fiscal_period_dates=["2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31"],
            dividends_paid_trend=[10.0, 11.0, 12.0, 13.0],
            reinvestment_rate_trend=[0.30, 0.31, 0.29, 0.30],
            buyback_rate_pct=2.0, payout_ratio=0.3,
        )
        kwargs.update(overrides)
        return kwargs

    def test_produces_a_real_score_with_full_data(self):
        with patch(
            "app.services.financial_data_service.get_historical_prices_near_dates",
            return_value={"2022-12-31": 60.0, "2023-12-31": 70.0, "2024-12-31": 80.0},
        ):
            result = compute_capital_allocation_score(**self._base_kwargs())
        assert 0 <= result.capital_allocation_score <= 100
        assert result.has_any_signal is True
        assert len(result.buyback_years) == 3

    def test_always_includes_the_acquisitions_disclosure(self):
        with patch("app.services.financial_data_service.get_historical_prices_near_dates", return_value={}):
            result = compute_capital_allocation_score(**self._base_kwargs())
        assert result.acquisitions_note == ACQUISITIONS_NOTE
        assert "adquisiciones" in result.acquisitions_note.lower()

    def test_every_factor_has_a_reason(self):
        with patch("app.services.financial_data_service.get_historical_prices_near_dates", return_value={}):
            result = compute_capital_allocation_score(**self._base_kwargs())
        assert len(result.factors) >= 5
        assert all(f.reason for f in result.factors)

    def test_no_data_at_all_produces_zero_score_and_no_signal(self):
        result = compute_capital_allocation_score(
            ticker="ZZZ", current_price=None,
            implied_shares_trend=[], fiscal_period_dates=[],
            dividends_paid_trend=[], reinvestment_rate_trend=[],
            buyback_rate_pct=None, payout_ratio=None,
        )
        assert result.capital_allocation_score == 0
        assert result.has_any_signal is False
