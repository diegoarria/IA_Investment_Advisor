"""
Tests — app.services.valuation.nuvos_engine.reality_gate.

See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md. Calibration
against real tickers (KO/NVDA) found an all-checks-block-equally gate
produced too many false "insufficient_data" results — these tests pin the
critical-vs-advisory split that fixed it.
"""
from app.services.valuation.nuvos_engine.divergence import explain_divergence
from app.services.valuation.nuvos_engine.earnings_state import EarningsState
from app.services.valuation.nuvos_engine.provenance import ProvenanceLedger, record
from app.services.valuation.nuvos_engine.reality_gate import run_reality_gate


def _clean_ledger():
    ledger = ProvenanceLedger()
    record(ledger, metric="eps_ttm", value=1.0, provider="fmp")
    return ledger


def _no_divergence():
    return explain_divergence(
        fair_value=105.0, current_price=100.0, earnings_state=EarningsState.NORMAL,
        fair_pe_primary_anchor="growth_based", historical_median_pe=None, peer_median_pe=None, growth_based_multiple=None,
    )


def _base_kwargs(**overrides):
    kwargs = dict(
        growth_adjustment_pct=1.0, growth_adjustment_bound_pp=2.0,
        fair_pe_primary_anchor="growth_based", fair_pe_value=20.0, fair_pe_band=(15.0, 25.0),
        earnings_state=EarningsState.NORMAL, normalized_eps_used=True,
        buyback_share_of_eps_growth_pct=None, fcf_divergence_flag=None,
        leverage_adjustment_applied=True, eps_source_consistent=True,
        ledger=_clean_ledger(), divergence=_no_divergence(),
    )
    kwargs.update(overrides)
    return kwargs


class TestCriticalChecksBlock:
    def test_no_fair_pe_anchor_blocks(self):
        result = run_reality_gate(**_base_kwargs(fair_pe_primary_anchor=None, fair_pe_value=None))
        assert result.overall_pass is False

    def test_peak_earnings_without_normalization_blocks(self):
        result = run_reality_gate(**_base_kwargs(earnings_state=EarningsState.CYCLICAL_PEAK, normalized_eps_used=False))
        assert result.overall_pass is False

    def test_peak_earnings_with_normalization_does_not_block(self):
        result = run_reality_gate(**_base_kwargs(earnings_state=EarningsState.CYCLICAL_PEAK, normalized_eps_used=True))
        assert result.overall_pass is True

    def test_stale_data_blocks(self):
        empty_ledger = ProvenanceLedger()
        record(empty_ledger, metric="eps_ttm", value=None, provider=None)
        result = run_reality_gate(**_base_kwargs(ledger=empty_ledger))
        assert result.overall_pass is False


class TestAdvisoryChecksDoNotBlock:
    def test_single_year_fcf_divergence_does_not_block_by_itself(self):
        # Calibration finding (KO): a real but isolated EPS-vs-FCF
        # divergence must lower confidence, not withhold the number.
        result = run_reality_gate(**_base_kwargs(fcf_divergence_flag="EPS growth exceeds FCF growth by 29.4pp"))
        assert result.overall_pass is True
        failed = [c.name for c in result.checks if not c.passed]
        assert "eps_fcf_aligned" in failed

    def test_missing_leverage_data_does_not_block(self):
        result = run_reality_gate(**_base_kwargs(leverage_adjustment_applied=False))
        assert result.overall_pass is True

    def test_buyback_driven_growth_does_not_block(self):
        result = run_reality_gate(**_base_kwargs(buyback_share_of_eps_growth_pct=90.0))
        assert result.overall_pass is True

    def test_moderately_unexplained_divergence_does_not_block(self):
        moderate_divergence = explain_divergence(
            fair_value=160.0, current_price=100.0, earnings_state=EarningsState.NORMAL,
            fair_pe_primary_anchor="growth_based", historical_median_pe=None, peer_median_pe=None, growth_based_multiple=None,
        )
        assert moderate_divergence.material and not moderate_divergence.explained  # 60% gap, unexplained
        result = run_reality_gate(**_base_kwargs(divergence=moderate_divergence))
        assert result.overall_pass is True

    def test_extreme_unexplained_divergence_does_block(self):
        extreme_divergence = explain_divergence(
            fair_value=300.0, current_price=100.0, earnings_state=EarningsState.NORMAL,
            fair_pe_primary_anchor="growth_based", historical_median_pe=None, peer_median_pe=None, growth_based_multiple=None,
        )
        assert extreme_divergence.material and not extreme_divergence.explained  # 200% gap, unexplained
        result = run_reality_gate(**_base_kwargs(divergence=extreme_divergence))
        assert result.overall_pass is False


class TestPassRate:
    def test_pass_rate_reflects_all_checks_not_just_critical(self):
        result = run_reality_gate(**_base_kwargs(fcf_divergence_flag="diverged", leverage_adjustment_applied=False))
        assert result.pass_rate < 100.0
        assert result.overall_pass is True  # still passes despite lower rate — advisory-only failures


class TestStructuralStates:
    """Phase 1 (Nuvos Fair Value Engine V2, 2026-08-12)."""

    def test_structurally_elevated_without_normalization_blocks(self):
        result = run_reality_gate(**_base_kwargs(earnings_state=EarningsState.STRUCTURALLY_ELEVATED, normalized_eps_used=False))
        assert result.overall_pass is False

    def test_structurally_depressed_without_normalization_blocks(self):
        result = run_reality_gate(**_base_kwargs(earnings_state=EarningsState.STRUCTURALLY_DEPRESSED, normalized_eps_used=False))
        assert result.overall_pass is False

    def test_structurally_elevated_with_evidence_does_not_block(self):
        result = run_reality_gate(**_base_kwargs(
            earnings_state=EarningsState.STRUCTURALLY_ELEVATED, normalized_eps_used=True, structural_evidence_count=3,
        ))
        assert result.overall_pass is True
        failed = [c.name for c in result.checks if not c.passed]
        assert "structural_claim_evidenced" not in failed

    def test_structurally_elevated_without_evidence_count_fails_advisory_check_but_does_not_block(self):
        # A wiring gap (count never threaded through) shouldn't itself
        # force insufficient_data — it's advisory, lowering confidence
        # via pass_rate instead.
        result = run_reality_gate(**_base_kwargs(
            earnings_state=EarningsState.STRUCTURALLY_ELEVATED, normalized_eps_used=True, structural_evidence_count=None,
        ))
        assert result.overall_pass is True
        failed = [c.name for c in result.checks if not c.passed]
        assert "structural_claim_evidenced" in failed

    def test_non_structural_state_is_unaffected_by_structural_evidence_count(self):
        result = run_reality_gate(**_base_kwargs(earnings_state=EarningsState.NORMAL, structural_evidence_count=None))
        failed = [c.name for c in result.checks if not c.passed]
        assert "structural_claim_evidenced" not in failed
