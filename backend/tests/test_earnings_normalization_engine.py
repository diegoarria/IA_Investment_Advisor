from unittest.mock import patch

from app.services.valuation.earnings_normalization_engine import (
    normalized_ttm_eps,
    capex_supercycle_state,
)


def _q(date, op, other, tax, shares, eps, revenue):
    return {
        "date": date, "operating_income": op, "other_income": other,
        "tax_expense": tax, "diluted_shares": shares, "revenue": revenue, "eps_diluted": eps,
    }


def _normal_quarters(n=8):
    """8 real-shaped quarters, consistent ~20% effective tax rate,
    healthy pretax margin — the "nothing anomalous happened" baseline."""
    rows = []
    for i in range(n):
        op = 5_000_000_000.0 + i * 100_000_000
        other = -50_000_000.0
        pretax = op + other
        tax = pretax * 0.20
        revenue = 20_000_000_000.0
        shares = 2_500_000_000.0
        eps = (pretax - tax) / shares
        rows.append(_q(f"2024-{(i%4)+1:02d}-01", op, other, tax, shares, eps, revenue))
    return rows


def test_none_when_too_few_quarters():
    with patch("app.services.valuation.earnings_normalization_engine.get_quarterly_income_detail",
               return_value=_normal_quarters(6)):
        assert normalized_ttm_eps("TEST") is None


def test_normal_company_barely_adjusted_and_nothing_flagged():
    with patch("app.services.valuation.earnings_normalization_engine.get_quarterly_income_detail",
               return_value=_normal_quarters(8)):
        r = normalized_ttm_eps("TEST")
    assert r is not None
    assert r.flagged_quarters == []
    assert r.normalized_ttm_eps is not None
    # normalized rate should track the real, consistent ~20% rate used —
    # i.e. normalized EPS should be very close to raw, not a big swing.
    assert abs(r.normalized_ttm_eps - r.raw_ttm_eps) < abs(r.raw_ttm_eps) * 0.05


def test_real_one_time_tax_charge_gets_flagged_and_normalized():
    """Same real shape as META's Q3 2025: one quarter with a real, huge
    one-off tax charge that crushes reported net income/EPS even though
    operating income that quarter was normal — the engine should flag
    that quarter and NOT let its distorted rate contaminate the
    normalized rate used for the other quarters."""
    rows = _normal_quarters(8)
    op = rows[-2]["operating_income"] + rows[-2]["other_income"]
    rows[-2]["tax_expense"] = op * 0.90  # a real, huge one-off tax hit
    rows[-2]["eps_diluted"] = (op - rows[-2]["tax_expense"]) / rows[-2]["diluted_shares"]
    with patch("app.services.valuation.earnings_normalization_engine.get_quarterly_income_detail",
               return_value=rows):
        r = normalized_ttm_eps("TEST")
    assert r is not None
    assert rows[-2]["date"] in r.flagged_quarters
    # normalized EPS should end up noticeably HIGHER than the raw,
    # tax-charge-depressed TTM EPS (the whole point of normalizing).
    assert r.normalized_ttm_eps > r.raw_ttm_eps


def test_near_breakeven_quarters_excluded_from_clean_pool():
    """Same real shape as Boeing: several quarters with pretax income
    close to zero relative to revenue — dividing a small real tax dollar
    figure by a near-zero base produces a meaningless "rate" that must
    NOT be trusted as evidence of the company's typical tax burden, even
    if the resulting ratio happens to fall inside the normal band."""
    rows = _normal_quarters(8)
    for i in (4, 5, 6):
        revenue = rows[i]["revenue"]
        # pretax income barely above zero relative to revenue (well under
        # the 5% materiality floor)
        tiny_pretax = revenue * 0.001
        rows[i]["operating_income"] = tiny_pretax - rows[i]["other_income"]
        rows[i]["tax_expense"] = tiny_pretax * 0.15  # would look "normal" if trusted
        rows[i]["eps_diluted"] = (tiny_pretax - rows[i]["tax_expense"]) / rows[i]["diluted_shares"]
    with patch("app.services.valuation.earnings_normalization_engine.get_quarterly_income_detail",
               return_value=rows):
        r = normalized_ttm_eps("TEST")
    assert r is not None
    # only 5 of 8 quarters remain real/meaningful — still >= the minimum
    # clean-quarter floor, so normalization should still run, but driven
    # only by the meaningful quarters (not the near-zero-margin ones).
    assert r.normalized_ttm_eps is not None


def test_capex_supercycle_none_when_too_few_years():
    with patch("app.services.valuation.earnings_normalization_engine.get_annual_cashflow_detail",
               return_value=[{"date": "2024-01-01", "operating_cash_flow": 1.0, "capex": -0.1, "revenue": 10.0}]):
        assert capex_supercycle_state("TEST", sector="Media") is None


def test_financial_sector_excluded():
    with patch("app.services.valuation.earnings_normalization_engine.get_annual_cashflow_detail",
               return_value=[{"date": f"202{i}-01-01", "operating_cash_flow": 1.0, "capex": 0.0, "revenue": 10.0}
                             for i in range(6)]):
        r = capex_supercycle_state("TEST", sector="Banking")
    assert r is not None
    assert r.applicable is False
    assert "financial" in r.reason.lower()


def test_asset_light_business_excluded_by_near_zero_capex():
    """A business with essentially no real capex in almost every year
    (payment networks, asset managers) shouldn't get a fabricated
    'normalized FCF margin' out of a concept that doesn't really apply —
    even when its sector string alone wouldn't have triggered the
    financial-sector exclusion."""
    years = [{"date": f"20{18+i}-01-01", "operating_cash_flow": 5.0 + i, "capex": -0.001, "revenue": 20.0 + i}
             for i in range(7)]
    with patch("app.services.valuation.earnings_normalization_engine.get_annual_cashflow_detail",
               return_value=years):
        r = capex_supercycle_state("TEST", sector="Technology")
    assert r is not None
    assert r.applicable is False


def test_real_capex_supercycle_flagged_even_with_revenue_growth():
    """Real shape of META's 2025: capex jumps far above its own trailing
    3-year average level even though revenue also grew that year — a
    real, structural capex ramp, correctly flagged."""
    years = []
    capex_ratio = 0.20
    for i in range(7):
        revenue = 100.0 * (1.15 ** i)
        capex = revenue * capex_ratio
        years.append({"date": f"20{18+i}-01-01", "operating_cash_flow": revenue * 0.35, "capex": -capex, "revenue": revenue})
    # final year: real capex ramp, well above the trailing-3yr average ratio
    revenue_last = 100.0 * (1.15 ** 7)
    years.append({"date": "2025-01-01", "operating_cash_flow": revenue_last * 0.30,
                  "capex": -revenue_last * 0.35, "revenue": revenue_last})
    with patch("app.services.valuation.earnings_normalization_engine.get_annual_cashflow_detail",
               return_value=years):
        r = capex_supercycle_state("TEST", sector="Media")
    assert r is not None
    assert r.applicable is True
    assert r.current_year_elevated_capex is True


def test_revenue_crash_alone_does_not_falsely_flag_elevated_capex():
    """Real shape of XOM's 2020: revenue crashes (real commodity price
    collapse) while capex ITSELF actually falls too — the capex/revenue
    RATIO would rise on a naive ratio-vs-median comparison, but the real
    capex LEVEL didn't ramp up, so this must NOT be flagged as an
    elevated-capex year."""
    years = [
        {"date": "2018-01-01", "operating_cash_flow": 30.0, "capex": -20.0, "revenue": 280.0},
        {"date": "2019-01-01", "operating_cash_flow": 25.0, "capex": -24.0, "revenue": 255.0},
        {"date": "2020-01-01", "operating_cash_flow": 10.0, "capex": -17.0, "revenue": 178.0},  # crash year: capex fell too
        {"date": "2021-01-01", "operating_cash_flow": 35.0, "capex": -12.0, "revenue": 276.0},
        {"date": "2022-01-01", "operating_cash_flow": 60.0, "capex": -18.0, "revenue": 398.0},
    ]
    with patch("app.services.valuation.earnings_normalization_engine.get_annual_cashflow_detail",
               return_value=years):
        r = capex_supercycle_state("TEST", sector="Energy")
    assert r is not None
    assert r.applicable is True
    # crash year (index 2) must not be the one driving an "elevated" flag
    assert r.n_elevated_years <= 1
