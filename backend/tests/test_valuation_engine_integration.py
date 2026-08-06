"""
Integration test — get_fundamental_analysis() wired to the new driver-based
DCF Engine (Fase 1, Incremento 2).

Context: fundamental_analysis_service.get_fundamental_analysis() is the
central function of the whole valuation engine — it now also computes
`dcf["driver_based_valuation"]` (the new Revenue->Margin->EBIT->NOPAT->
Reinvestment->FCF model, see valuation/dcf_engine.py) alongside the
existing FCF-fade model, and detects REITs (`sector_model_note`) to avoid
running the standard FCF-DCF on them. This test exercises the REAL
function end-to-end with synthetic-but-internally-consistent 10-year
financials, mocking only the network-touching boundary functions (Finnhub/
FMP/yfinance calls), to confirm the new wiring actually produces a real
result without breaking the existing DCF output.
"""
from unittest.mock import patch

import pytest

from app.services.fundamental_analysis_service import get_fundamental_analysis, format_fundamental_analysis_for_prompt


def _build_synthetic_financials(years: int = 10, revenue_0: float = 10_000_000_000.0, growth: float = 0.10):
    """A profitable, steadily-growing, internally-consistent synthetic
    company: ~10% revenue growth, 25% operating margin, 21% tax rate,
    positive FCF and ROIC every year — designed to clear every gate in
    get_fundamental_analysis() (avg_fcf_margin > 0, avg_roic > 0, >=3
    years of data) so the full driver-based DCF branch actually runs.

    Revenue starts at $10B — real provider data (FMP/Fiscal.ai) reports
    raw dollar amounts, not millions (only the frontend's dcfCalculator.ts
    divides by 1e6 for display), so this must be a realistic company-scale
    number, not a small unitless figure, or the per-share math silently
    produces near-zero values against a 100M raw share count."""
    income, balance, cashflow = [], [], []
    prev_wc = None
    for i in range(years):
        period = f"{2015 + i}-12-31"
        revenue = revenue_0 * ((1 + growth) ** i)
        operating_income = revenue * 0.25
        pretax_income = operating_income * 0.95  # small interest expense
        tax_provision = pretax_income * 0.21
        net_income = pretax_income - tax_provision
        shares = 100_000_000
        diluted_eps = net_income / shares

        da = revenue * 0.05
        capex = -(revenue * 0.08)
        ocf = net_income + da * 1.1  # roughly NI + D&A + small WC release
        working_capital = revenue * 0.10

        income.append({
            "period": period,
            "Total Revenue": revenue,
            "Gross Profit": revenue * 0.55,
            "Operating Income": operating_income,
            "Net Income": net_income,
            "Diluted EPS": diluted_eps,
            "Pretax Income": pretax_income,
            "Tax Provision": tax_provision,
            "Interest Expense": revenue * 0.01,
        })
        balance.append({
            "Stockholders Equity": revenue * 0.6,
            "Total Assets": revenue * 1.8,
            "Long Term Debt": revenue * 0.25,
            "Short Term Debt": revenue * 0.02,
            "Cash And Short Term Investments": revenue * 0.15,
            "Working Capital": working_capital,
        })
        cashflow.append({
            "Operating Cash Flow": ocf,
            "Capital Expenditure": capex,
            "Depreciation And Amortization": da,
            "Dividends Paid": -(net_income * 0.2),
        })
        prev_wc = working_capital

    return {
        "incomeStatement": {"annual": income},
        "balanceSheet": {"annual": balance},
        "cashFlow": {"annual": cashflow},
        "provider": "synthetic-test",
    }


def _patch_boundary(sector: str, price: float = 100.0, shares_out_millions: float = 100.0):
    """Patches every network-touching function get_fundamental_analysis()
    calls, at the point of use inside fundamental_analysis_service (they're
    imported with `from ... import X`, so the patch target must be the
    name as bound in this module, not the original definition module)."""
    return [
        patch("app.services.fundamental_analysis_service.get_financials", return_value=_build_synthetic_financials()),
        patch("app.services.fundamental_analysis_service.fh_quote", return_value={"price": price}),
        patch("app.services.fundamental_analysis_service.fh_profile", return_value={
            "finnhubIndustry": sector, "shareOutstanding": shares_out_millions,
        }),
        patch("app.services.fundamental_analysis_service.check_liquidity_gate", return_value={
            "paso": True, "avg_volume_30d": 1_000_000, "free_float_pct": 80.0, "analyst_coverage": 10, "detalle": "OK",
        }),
        patch("app.services.fundamental_analysis_service.get_beta", return_value=1.1),
        patch("app.services.fundamental_analysis_service.get_risk_free_rate", return_value=0.04),
        patch("app.services.fundamental_analysis_service.fh_price_target", return_value=None),
        patch("app.services.fundamental_analysis_service.get_revenue_segments", return_value=[]),
    ]


class TestDriverBasedValuationWiring:
    def test_profitable_tech_company_gets_both_valuations(self):
        patches = _patch_boundary(sector="Technology")
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7]:
            result = get_fundamental_analysis("SYN1")

        assert result is not None
        assert result["dcf"] is not None
        # existing FCF-fade model still works, untouched
        assert result["dcf"]["margin_of_safety_pct"] is not None
        assert result["dcf"]["scenarios"]["base"]["intrinsic_value_per_share"] > 0

        # new driver-based model is now wired in and actually computed
        driver = result["dcf"]["driver_based_valuation"]
        assert driver is not None
        assert driver["value_per_share"] > 0
        assert len(driver["yearly"]) == 10
        assert driver["yearly"][0]["revenue"] > 0
        assert result["sector_model_note"] is None

        # Monte Carlo (Incremento 3) is wired in too, reusing the same anchors
        mc = result["dcf"]["monte_carlo"]
        assert mc is not None
        assert mc["n_valid"] > 0
        assert mc["min"] <= mc["p10"] <= mc["p25"] <= mc["median"] <= mc["p75"] <= mc["p90"] <= mc["max"]
        assert mc["probability_undervalued_pct"] is not None

    def test_reit_sector_gets_a_note_and_no_standard_dcf(self):
        patches = _patch_boundary(sector="REIT - Retail")
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7]:
            result = get_fundamental_analysis("SYN2")

        assert result is not None
        assert result["dcf"] is None
        assert result["sector_model_note"] is not None
        assert result["sector_model_note"]["sector_type"] == "reit"

        prompt_text = format_fundamental_analysis_for_prompt(result)
        assert "FFO/AFFO" in prompt_text

    def test_financial_sector_still_uses_justified_pb_and_has_no_note(self):
        patches = _patch_boundary(sector="Banks - Regional")
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7]:
            result = get_fundamental_analysis("SYN3")

        assert result is not None
        assert result["dcf"] is not None
        assert result["dcf"]["methodology"] == "residual_income_justified_pb"
        # financial-sector model doesn't compute the driver-based DCF (that
        # branch is scoped to the standard FCF-DCF path only)
        assert "driver_based_valuation" not in result["dcf"]
        assert result["sector_model_note"] is None


class TestPeerDependentDataWiring:
    """Nuvos AI Fair Value Engine redesign, Incremento 3b — see
    /Users/diegoarria/.claude/plans/stateful-painting-flurry.md. Mocks
    compute_relative_valuation/compute_historical_valuation/
    compute_industry_benchmarks directly (rather than relying on real
    UNIVERSE peer lookups, which fail fast/gracefully to None in this
    sandbox for lack of real API keys) for a deterministic assertion that
    the 3 pieces reach every caller of get_fundamental_analysis(), not
    just screener.py's live search."""

    def test_relative_historical_industry_present_on_dcf_when_peer_dependent_data_enabled(self):
        patches = _patch_boundary(sector="Technology")
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7], \
             patch("app.services.relative_valuation_service.compute_relative_valuation", return_value={"methodology": "relative_valuation", "intrinsic_value_per_share": 123.0}), \
             patch("app.services.historical_valuation_service.compute_historical_valuation", return_value={"methodology": "historical_valuation", "intrinsic_value_per_share": 130.0}), \
             patch("app.services.quality.industry_engine.compute_industry_benchmarks") as mock_industry:
            from app.services.quality.industry_engine import IndustryBenchmarks
            mock_industry.return_value = IndustryBenchmarks(
                category="Software", sector="Technology", industry=None, peer_count=8, peers_used=["A", "B"],
                median_roic_pct=18.0, median_operating_margin_pct=25.0, median_fcf_margin_pct=20.0, median_revenue_cagr_pct=12.0,
            )
            result = get_fundamental_analysis("SYN4")

        assert result is not None
        assert result["dcf"]["relative_valuation"]["intrinsic_value_per_share"] == 123.0
        assert result["dcf"]["historical_valuation"]["intrinsic_value_per_share"] == 130.0
        assert result["dcf"]["industry_benchmarks"]["category"] == "Software"
        assert result["dcf"]["industry_benchmarks"]["median_roic_pct"] == 18.0

    def test_all_three_are_none_when_peer_dependent_data_disabled(self):
        # Same guard Consensus already used (Fase 1.5, Incremento 10),
        # broadened in this increment to also cover industry/relative/
        # historical — a peer-level lookup must never cascade into ITS
        # OWN peer-fetching.
        patches = _patch_boundary(sector="Technology")
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7], \
             patch("app.services.relative_valuation_service.compute_relative_valuation") as mock_relative, \
             patch("app.services.quality.industry_engine.compute_industry_benchmarks") as mock_industry:
            result = get_fundamental_analysis("SYN5", _compute_peer_dependent_data=False)

        assert result is not None
        assert result["dcf"]["relative_valuation"] is None
        assert result["dcf"]["historical_valuation"] is None
        assert result["dcf"]["industry_benchmarks"] is None
        mock_relative.assert_not_called()
        mock_industry.assert_not_called()

    def test_never_breaks_the_primary_dcf_when_industry_benchmarks_raises(self):
        patches = _patch_boundary(sector="Technology")
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7], \
             patch("app.services.quality.industry_engine.compute_industry_benchmarks", side_effect=Exception("boom")):
            result = get_fundamental_analysis("SYN6")

        assert result is not None
        assert result["dcf"] is not None
        assert result["dcf"]["margin_of_safety_pct"] is not None
        assert result["dcf"]["industry_benchmarks"] is None
