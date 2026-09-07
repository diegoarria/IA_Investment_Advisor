from app.services.valuation.dcf_recovery_engine import (
    compute_recovery_dcf,
    compute_single_period_fcf_value,
)


def test_recovery_dcf_matches_real_meta_case():
    """Real numbers for META's base case at the current real production
    defaults (terminal_growth_pct=3.0, the Fase 2 batch's fix — the
    original 5.0% override this test used no longer clears the
    2026-09-04 7.0pp minimum WACC-terminal spread at META's real 10.1%
    WACC, and 5.0% was already documented as too aggressive)."""
    r = compute_recovery_dcf(
        fcf_per_share_today=17.95,
        normalized_fcf_margin_pct=31.5,
        revenue_per_share_today=78.23,
        growth_pct=14.0,
        wacc_pct=10.1,
        terminal_growth_pct=3.0,
    )
    assert r is not None
    assert abs(r.fair_value_per_share - 532.3) < 2.0
    assert len(r.fcf_per_share_projection) == 5
    # first 2 years stay at today's depressed level (default depressed_years=2)
    assert r.fcf_per_share_projection[0] == 17.95
    assert r.fcf_per_share_projection[1] == 17.95
    # recovery years increase monotonically toward the normalized target
    assert r.fcf_per_share_projection[2] < r.fcf_per_share_projection[3] < r.fcf_per_share_projection[4]


def test_recovery_dcf_none_when_wacc_not_above_terminal_growth():
    r = compute_recovery_dcf(
        fcf_per_share_today=10.0, normalized_fcf_margin_pct=20.0,
        revenue_per_share_today=50.0, growth_pct=10.0,
        wacc_pct=5.0, terminal_growth_pct=5.0,
    )
    assert r is None


def test_single_period_uses_next_year_fcf_not_today():
    """Real formula bug caught and fixed this session: must discount
    FCF1 = FCF0 * (1+g), not FCF0 itself. Uses g=3.0 (current real
    production default) at META's real 10.1% WACC — a 5.0% g here would
    no longer clear the 2026-09-04 7.0pp minimum WACC-terminal spread."""
    fcf0 = 17.95
    wacc, g = 10.1, 3.0
    value = compute_single_period_fcf_value(fcf_per_share_today=fcf0, wacc_pct=wacc, terminal_growth_pct=g)
    expected = round((fcf0 * 1.03) / (0.101 - 0.03), 2)
    assert value == expected
    # sanity: must NOT equal the (wrong) FCF0-based value
    wrong = round(fcf0 / (0.101 - 0.03), 2)
    assert value != wrong


def test_single_period_none_when_wacc_not_above_terminal_growth():
    assert compute_single_period_fcf_value(fcf_per_share_today=10.0, wacc_pct=5.0, terminal_growth_pct=5.0) is None
