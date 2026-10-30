"""
Radar structural audit of the `legacy_dcf_or_financial_sector` methodology
(2026-10-29), ordered by Diego after the 100-ticker full-snapshot batch
surfaced 3 new extreme-ratio under_review cases on this engine (F, CHTR,
LITE) on top of the already-under_review F/CHTR from an earlier batch.

Root cause confirmed for F and CHTR (and a previously-undetected near-miss,
GIS, which was still `valid` at a 4.513x ratio — just under the 5.0x
review threshold): `_calc_wacc`'s sanity floor was a flat 4%, set back when
the real risk-free rate was ~1-2%. At today's ~5% risk-free rate, that
floor is BELOW the risk-free rate itself, which is economically incoherent
(equity is always riskier than a government bond, so cost of equity — and
therefore any real WACC — must clear the risk-free rate). This let a
heavily-levered company (CHTR: 87% debt-weighted, F: 77% debt-weighted
partly via Ford Credit's captive-finance debt) or a very-low-beta company
(GIS: beta -0.05, clamped to the 0.3 floor) compute a WACC cheaper than
risk-free, which — combined with the Gordon-growth terminal value's
extreme sensitivity to a thin WACC-minus-terminal-growth spread — produced
wildly inflated intrinsic values.

LITE is confirmed to have a DIFFERENT root cause (not a WACC issue, not a
mixed-regime anchor issue) — see TestLiteDistinctRootCause below. Per
Diego's explicit instruction, this suite never assumes F/CHTR/LITE share
one cause, and the fix below corrects a universal WACC-floor defect — it
never tunes any single company's assumptions toward its market price.
"""
from app.services.fundamental_analysis_service import _calc_wacc


# ── Ford-shaped: high debt weight, partly from Ford Credit's captive-finance
#    debt sitting in `total_debt` with no segment-level exclusion. ──────────

class TestFordShapedCapitalStructure:
    def test_high_debt_weight_wacc_no_longer_sits_below_risk_free_rate(self):
        # Real F inputs (2026-10-29): beta 1.94, rf 4.99%, equity_weight 23%,
        # debt_weight 77% (market cap ~$49.2B vs total_debt ~$164.8B, which
        # includes Ford Credit's captive-finance debt).
        wacc, meta = _calc_wacc(
            beta=1.94, risk_free_rate=0.0499, market_cap=49_200_000_000,
            total_debt=164_790_000_000, interest_expense=4_944_000_000,
            tax_rate=0.21, sector="Consumer Cyclical",
        )
        assert meta["method"] == "capm"
        # Before the fix this came out to ~5.02% — below the 4.99% risk-free
        # rate. The fix must push it strictly above risk-free.
        assert wacc > 0.0499
        assert wacc == 0.0649  # floor = max(4%, risk_free_rate + 1.5pp)

    def test_captive_finance_debt_inflation_is_a_separate_unresolved_gap(self):
        # Documents (does not fix) the second, still-open root cause: this
        # module has no mechanism to net a captive-finance subsidiary's
        # matching financing receivables against its funding debt before
        # that debt enters total_debt/net_cash — unlike the REIT carve-out,
        # there is no auto-captive-finance carve-out. Confirms it's simply
        # ABSENT (not mis-applied) by checking no such function exists.
        import app.services.fundamental_analysis_service as fas
        assert not hasattr(fas, "exclude_captive_finance_debt")
        assert not hasattr(fas, "_is_captive_finance_adjusted")


# ── Charter-shaped: extreme leverage from aggressive buyback-funded capital
#    structure (no captive-finance angle — a pure leverage/beta case). ──────

class TestCharterShapedCapitalStructure:
    def test_extreme_leverage_wacc_floored_above_risk_free_rate(self):
        # Real CHTR inputs (2026-10-29): beta 0.69, rf 4.99%, equity_weight
        # 13.1%, debt_weight 86.9%.
        wacc, meta = _calc_wacc(
            beta=0.69, risk_free_rate=0.0499, market_cap=14_690_000_000,
            total_debt=97_121_000_000, interest_expense=5_040_000_000,
            tax_rate=0.227, sector="Communication Services",
        )
        assert wacc > 0.0499
        assert wacc == 0.0649


# ── GIS-shaped: very-low/negative beta, NOT high leverage — confirms the
#    floor fix is a general fix, not something special-cased to leverage. ──

class TestLowBetaDefensiveNotHighLeverage:
    def test_near_zero_beta_wacc_still_floored_above_risk_free_rate(self):
        # Real GIS inputs (2026-10-29): beta -0.05 (clamped to 0.3 floor),
        # equity_weight 56.8%/debt_weight 43.2% — ordinary leverage, NOT
        # extreme like F/CHTR. This is a near-miss case found DURING this
        # audit: GIS was (and remains) `valid`, ratio 4.513x, just under
        # the 5.0x under_review threshold — undetected until this audit.
        wacc, meta = _calc_wacc(
            beta=-0.05, risk_free_rate=0.0499, market_cap=36_900_000_000,
            total_debt=28_050_000_000, interest_expense=1_117_000_000,
            tax_rate=0.40, sector="Consumer Defensive",
        )
        assert meta["beta"] == -0.05
        assert wacc > 0.0499
        assert wacc == 0.0649


# ── Regression: a normal, healthy WACC must be completely unaffected ───────

class TestUnaffectedNormalCompany:
    def test_healthy_wacc_well_above_new_floor_is_unchanged(self):
        # beta 1.0, modest leverage — WACC comes out comfortably above
        # either floor, so this must produce byte-identical output to
        # before the fix.
        wacc, _ = _calc_wacc(
            beta=1.0, risk_free_rate=0.0499, market_cap=9e9,
            total_debt=1e9, interest_expense=4e7, tax_rate=0.21, sector="Technology",
        )
        cost_of_equity = 0.0499 + 1.0 * 0.046
        cost_of_debt = 0.04  # 4e7/1e9
        e, d, v = 9e9, 1e9, 1e10
        expected = (e / v) * cost_of_equity + (d / v) * cost_of_debt * (1 - 0.21)
        assert wacc == round(expected, 10) or abs(wacc - expected) < 1e-9

    def test_low_risk_free_rate_regime_keeps_the_old_4pct_floor(self):
        # When the risk-free rate itself is low (e.g. a future low-rate
        # cycle), risk_free_rate + 1.5pp can fall below 4% — the floor
        # must never go BELOW the original 4% constant either.
        wacc, _ = _calc_wacc(
            beta=0.05, risk_free_rate=0.01, market_cap=1e9,
            total_debt=0, interest_expense=0, tax_rate=0.21, sector=None,
        )
        assert wacc == 0.04


# ── Financial-sector company: must be completely untouched by this fix —
#    it never goes through _calc_wacc's floor at all for its OWN discount
#    rate (financial_engine.py uses its own, separate, higher 9% practitioner
#    floor on cost of equity). ──────────────────────────────────────────────

class TestFinancialSectorUnaffected:
    def test_cost_of_equity_floor_is_still_9pct_independent_of_wacc_fix(self):
        from app.services.valuation.financial_engine import _COST_OF_EQUITY_FLOOR
        assert _COST_OF_EQUITY_FLOOR == 0.09

    def test_financial_fair_value_still_applies_its_own_floor_below_capm(self):
        from app.services.valuation.financial_engine import build_financial_fair_value
        # A low-beta financial (CAPM cost of equity ~5%, below the 9%
        # practitioner floor) must still value at >= 9% cost of equity —
        # this floor lives entirely in financial_engine.py, untouched by
        # today's _calc_wacc change.
        result = build_financial_fair_value(
            ticker="TESTBANK", sector="Financial Services", industry="Banks",
            price=50.0, shares_out=1_000_000_000,
            roe_trend=[10.0, 11.0, 10.5, 12.0, 11.5],
            eps_trend=[3.0, 3.2, 3.1, 3.4, 3.3],
            book_value_trend=[20e9, 21e9, 22e9, 23e9, 24e9],
            latest_dividends_paid=2e9, latest_net_income=4e9,
            total_debt=5e9, cash=3e9, cost_of_equity_capm=0.05,
            business_quality_score=50.0, latest_eps=3.3, pe_ratio=15.0,
            wall_street_eps_growth_next_year_pct=5.0,
            wacc_details={"method": "capm"}, compute_peer_dependent_data=False,
        )
        assert result is not None
        assert result["cost_of_equity_pct"] >= 9.0


# ── Industrial company with ordinary FCF — a clean, unaffected control case ─

class TestIndustrialControlCase:
    def test_industrial_company_mid_leverage_wacc_unaffected(self):
        # A generic industrial (moderate leverage, moderate beta) should
        # land comfortably above both floors, same as before the fix.
        wacc, meta = _calc_wacc(
            beta=1.1, risk_free_rate=0.0499, market_cap=20e9,
            total_debt=6e9, interest_expense=3e8, tax_rate=0.21, sector="Industrials",
        )
        assert wacc > 0.0649
        assert meta["method"] == "capm"


# ── LITE: confirmed DISTINCT root cause — thin/volatile historical FCF vs.
#    a forward-looking market re-rating, NOT a WACC or mixed-regime defect. ──

class TestLiteDistinctRootCause:
    def test_lite_wacc_is_not_the_anomaly(self):
        # Real LITE inputs (2026-10-29): beta 1.54, ordinary (not extreme)
        # leverage — WACC of 11.89% is NOT low, confirming the WACC-floor
        # fix has zero effect on this specific case (by design — it's a
        # different failure mode from F/CHTR).
        wacc, meta = _calc_wacc(
            beta=1.54, risk_free_rate=0.0499, market_cap=83_000_000_000,
            total_debt=1_637_400_000, interest_expense=50_000_000,
            tax_rate=0.21, sector="Technology",
        )
        assert wacc > 0.10
        assert meta["debt_weight_pct"] < 5.0  # not a leverage case either


# ── Irregular/volatile FCF company — a cyclical name whose average margin is
#    thin and highly variable, same shape as LITE's real numbers. This only
#    asserts the DATA SHAPE that drives the "insufficient historical signal"
#    conclusion is real and visible (fcf_volatility_cv), not a fabricated
#    model output. ────────────────────────────────────────────────────────

class TestIrregularFcfCompanyShape:
    def test_coefficient_of_variation_flags_high_volatility(self):
        from app.services.valuation.numeric_helpers import _coefficient_of_variation
        # LITE's real 5-year FCF-margin-implied series shape: thin, swinging
        # between a down year and a strong upcycle year.
        thin_volatile_series = [1.5, -2.0, 8.0, 0.5, 11.0]
        cv = _coefficient_of_variation(thin_volatile_series)
        assert cv is not None and cv > 1.0  # same order of magnitude as LITE's measured 1.99
