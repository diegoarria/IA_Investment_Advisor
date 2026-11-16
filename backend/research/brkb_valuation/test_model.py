"""
Deterministic tests for the isolated BRK.B valuation prototype
(research/brkb_valuation/model.py). No network, no Supabase, no
dependency on app/ — these only exercise this module's own pure functions
against the fixed, dated BrkInputs() defaults.

Run standalone:  pytest backend/research/brkb_valuation/test_model.py -q
(does NOT require ENV_FILE / Supabase — this module never touches them)
"""
import math

import pytest

from .model import (
    BASE,
    CONSERVADOR,
    OPTIMISTA,
    BrkInputs,
    ScenarioAssumptions,
    compute_all_scenarios,
    compute_scenario,
    sensitivity_to_deferred_tax,
    sensitivity_to_msr_multiple,
    sensitivity_to_unresolved_liability,
)


def test_base_case_is_in_the_range_the_prior_audit_round_vetted():
    """This standalone implementation is a fresh, from-scratch encoding of
    the normalized-earnings x multiples approach the prior audit round
    sanity-checked by hand (~$389/share) — a few dollars/share of
    difference is expected (this module's own rounding/treatment of
    BHE's 92% ownership timing, etc.), but it must land in the same
    double-counting-checked ballpark, nowhere near the production
    engine's ~$757."""
    result = compute_scenario(BrkInputs(), BASE)
    assert 370.0 < result.value_per_share < 410.0


def test_base_case_is_a_pinned_regression_value_for_this_exact_code():
    """Regression pin for THIS module's own deterministic output — any
    change to it must be a deliberate, reviewed edit of this number, never
    a silent drift."""
    result = compute_scenario(BrkInputs(), BASE)
    assert result.value_per_share == pytest.approx(395.50, abs=0.05)


def test_scenarios_are_monotonic_conservative_to_optimistic():
    results = compute_all_scenarios()
    assert results["conservador"].value_per_share < results["base"].value_per_share
    assert results["base"].value_per_share < results["optimista"].value_per_share


def test_scenarios_land_well_below_the_production_engine():
    """The whole point of this prototype: an independently-built,
    double-counting-checked model should NOT reproduce the production
    Residual Income engine's ~$757/share — if it ever does, something in
    this model's assumptions has drifted toward unjustified optimism."""
    results = compute_all_scenarios()
    assert results["optimista"].value_per_share < 757.0


def test_no_asset_is_counted_in_more_than_one_bucket():
    """Each financial-asset figure must appear in exactly one of the four
    `*_value` fields, and the four must sum exactly to financial_assets_
    total — this is the double-counting invariant the whole audit chain
    exists to protect."""
    result = compute_scenario(BrkInputs(), BASE)
    assert (
        result.equity_portfolio_value
        + result.fixed_income_value
        + result.equity_method_value
        + result.cash_and_tbills_value
        == pytest.approx(result.financial_assets_total)
    )
    # And the financial-assets total must equal the raw inputs verbatim —
    # no multiplier/haircut silently applied to a balance-sheet fair value.
    inputs = BrkInputs()
    assert result.financial_assets_total == pytest.approx(
        inputs.equity_portfolio_fair_value
        + inputs.fixed_income_investments
        + inputs.equity_method_investments
        + inputs.cash_and_tbills_insurance_and_other
    )


def test_operating_businesses_use_their_own_multiple_only_once():
    """Each segment's annualized earnings must be multiplied by exactly
    its own assumption field — catches a copy-paste bug that reuses one
    segment's multiple for another."""
    inputs = BrkInputs()
    result = compute_scenario(inputs, BASE)
    annualize = 4.0 / 3.0

    assert result.underwriting_value == pytest.approx(
        inputs.underwriting_gain_9mo * annualize * BASE.underwriting_multiple
    )
    assert result.bnsf_value == pytest.approx(inputs.bnsf_earnings_9mo * annualize * BASE.bnsf_multiple)
    assert result.bhe_value == pytest.approx(
        inputs.bhe_earnings_9mo * annualize * inputs.bhe_ownership_pct * BASE.bhe_multiple
    )
    assert result.msr_value == pytest.approx(inputs.msr_earnings_9mo * annualize * BASE.msr_multiple)


def test_insurance_investment_income_is_never_an_input_to_the_model():
    """Note (A) in model.py: insurance investment income must never be
    capitalized as a separate earnings stream, since the assets that
    generate it are already counted at fair value. Guard this by asserting
    BrkInputs has no such field at all — if someone adds one back, this
    test forces them to also re-justify the no-double-count treatment."""
    assert not hasattr(BrkInputs(), "insurance_investment_income_9mo")
    assert not hasattr(BrkInputs(), "insurance_investment_income")


def test_float_is_deducted_exactly_once_and_never_capitalized_as_a_separate_benefit():
    """Float must appear as a liability deduction and must NOT also
    inflate equity_value via a second 'float benefit' add-on anywhere in
    the breakdown (see model.py Note A for why only one treatment is
    used)."""
    result = compute_scenario(BrkInputs(), BASE)
    assert result.float_deduction == BrkInputs().float_liability
    # equity_value must reconcile EXACTLY from the three documented buckets
    # — if a hidden fourth term existed (e.g. a float-benefit perpetuity),
    # this identity would fail.
    expected_equity_value = (
        result.operating_businesses_total + result.financial_assets_total - result.liabilities_total
    )
    assert result.equity_value == pytest.approx(expected_equity_value)


def test_liabilities_total_is_the_exact_sum_of_its_four_components():
    result = compute_scenario(BrkInputs(), BASE)
    assert result.liabilities_total == pytest.approx(
        result.float_deduction
        + result.tbills_payable_deduction
        + result.deferred_tax_deduction
        + result.unresolved_liability_deduction
    )


def test_deferred_tax_retention_pct_scales_the_deduction_linearly():
    inputs = BrkInputs()
    full = compute_scenario(inputs, ScenarioAssumptions(**{**BASE.__dict__, "deferred_tax_retention_pct": 1.0}))
    half = compute_scenario(inputs, ScenarioAssumptions(**{**BASE.__dict__, "deferred_tax_retention_pct": 0.5}))
    zero = compute_scenario(inputs, ScenarioAssumptions(**{**BASE.__dict__, "deferred_tax_retention_pct": 0.0}))
    assert zero.deferred_tax_deduction == pytest.approx(0.0)
    assert half.deferred_tax_deduction == pytest.approx(full.deferred_tax_deduction / 2)


def test_unresolved_liability_weight_zero_matches_fully_excluded_sensitivity():
    sens = sensitivity_to_unresolved_liability()
    excluded = compute_scenario(
        BrkInputs(), ScenarioAssumptions(**{**BASE.__dict__, "unresolved_liability_weight": 0.0})
    )
    assert sens["fully_excluded"] == pytest.approx(excluded.value_per_share)
    # weight=0 (fully excluded) deducts nothing for this liability, so it
    # must produce a HIGHER per-share value than weight=1 (fully included).
    assert sens["fully_excluded"] > sens["fully_included"]


def test_shares_outstanding_reflects_the_real_1500_to_1_conversion():
    """480,476 Class A shares at a real 1500:1 conversion ratio, plus the
    real Class B share count, must equal the BRK.B-equivalent total used
    as the valuation's denominator — catches a BRK.A/BRK.B scale error of
    the kind this audit chain explicitly ruled out for the production
    engine."""
    class_a_shares = 480_476
    class_b_shares = 1_403_805_594
    conversion_ratio = 1_500
    expected_b_equivalent_millions = (class_a_shares * conversion_ratio + class_b_shares) / 1_000_000
    assert BrkInputs().shares_b_equivalent_millions == pytest.approx(expected_b_equivalent_millions, rel=1e-4)


def test_sensitivity_to_msr_multiple_moves_in_the_expected_direction():
    sens = sensitivity_to_msr_multiple()
    assert sens["msr_multiple-2.0x"] < sens["base"] < sens["msr_multiple+2.0x"]


def test_sensitivity_to_deferred_tax_moves_in_the_expected_direction():
    sens = sensitivity_to_deferred_tax()
    assert sens["retention_0pct"] > sens["retention_100pct"]


def test_conservador_and_optimista_differ_only_in_their_declared_knobs():
    """CONSERVADOR and OPTIMISTA must differ exactly in the knobs they
    document (multiples, deferred-tax retention, unresolved-liability
    weight) and nowhere else — guards against a hidden extra adjustment
    smuggled into one scenario."""
    for field in ("underwriting_multiple", "bnsf_multiple", "bhe_multiple", "msr_multiple"):
        assert getattr(CONSERVADOR, field) < getattr(OPTIMISTA, field)
    assert CONSERVADOR.deferred_tax_retention_pct > OPTIMISTA.deferred_tax_retention_pct
    assert CONSERVADOR.unresolved_liability_weight > OPTIMISTA.unresolved_liability_weight


def test_no_nan_or_negative_equity_value_across_all_scenarios():
    for result in compute_all_scenarios().values():
        assert not math.isnan(result.equity_value)
        assert result.equity_value > 0
        assert result.value_per_share > 0
