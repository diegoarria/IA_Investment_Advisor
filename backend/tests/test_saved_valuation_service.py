"""
Tests — app.services.saved_valuation_service.compute_iv (Fase 1.5,
Incremento 16).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md. Only the
pure compute_iv/_newly_crossed_milestones logic is tested here — no network
I/O (get_live_inputs/run_milestone_check's Supabase calls) is exercised.
"""
import pytest

from app.services.saved_valuation_service import compute_iv, _newly_crossed_milestones
from app.services.fundamental_analysis_service import _run_dcf


class TestComputeIv:
    def test_matches_run_dcf_directly(self):
        # compute_iv should be a thin wrapper: same fade-based _run_dcf the
        # rest of the app uses, plus net cash / shares to get per-share value.
        fcf0, g, r, gt, net_cash, shares = 10_000.0, 0.10, 0.09, 0.03, 5_000.0, 1_000.0
        result = _run_dcf(fcf0, g, r, gt)
        expected = (result["enterprise_value"] + net_cash) / shares

        iv = compute_iv(fcf0, g * 100, r * 100, gt * 100, net_cash, shares)
        assert iv == pytest.approx(expected, rel=1e-6)

    def test_no_longer_none_when_r_equals_g(self):
        # Fase 1.5, Incremento 16 — g is now just the year-1 fade point (a
        # per-year loop inside _run_dcf), not a closed-form denominator, so
        # r == g is no longer a division-by-zero case. Only r == gt is.
        iv = compute_iv(10_000.0, 9.0, 9.0, 3.0, 5_000.0, 1_000.0)
        assert iv is not None

    def test_none_when_r_equals_gt(self):
        iv = compute_iv(10_000.0, 7.0, 3.0, 3.0, 5_000.0, 1_000.0)
        assert iv is None

    def test_none_when_shares_non_positive(self):
        assert compute_iv(10_000.0, 7.0, 9.0, 3.0, 5_000.0, 0.0) is None
        assert compute_iv(10_000.0, 7.0, 9.0, 3.0, 5_000.0, -100.0) is None


class TestNewlyCrossedMilestones:
    def test_downside_milestone_fires_at_or_below(self):
        assert _newly_crossed_milestones(-10.0, []) == [-10]
        assert _newly_crossed_milestones(-15.0, []) == [-10]
        assert _newly_crossed_milestones(-5.0, []) == []

    def test_upside_milestones_fire_at_or_above(self):
        assert _newly_crossed_milestones(25.0, []) == [0, 10, 20]

    def test_already_notified_milestones_are_excluded(self):
        assert _newly_crossed_milestones(25.0, [0, 10]) == [20]
