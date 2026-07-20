"""
Historical Valuation (Method 4 of the Valuation Engine)
=========================================================
Is this company cheap or expensive versus its OWN past — the cleanest
signal for a business whose economics haven't structurally changed. Every
multiple here is built from a real historical price (financial_data_
service.get_historical_prices_near_dates, one real FMP call per ticker) at
each real fiscal year-end, combined with that year's own real EPS/EBITDA/
FCF and balance-sheet figures — never an estimate standing in for a missing
data point.

Diluted share count per historical year is backed out the same way the
rest of this engine already does it elsewhere (Net Income ÷ Diluted EPS) —
no separate historical-shares-outstanding series exists on any provider
here; this is the same real technique already used for FCF-per-share
trends, not a new assumption invented for this method.
"""

from __future__ import annotations

import statistics
from typing import Optional

_MIN_HISTORICAL_YEARS = 5  # never build a "10-year distribution" claim off fewer real data points


def compute_historical_valuation(
    ticker: str, income: list[dict], balance: list[dict], cashflow: list[dict],
    price: float, shares_out: float, total_debt: float, cash: float,
    latest_eps: Optional[float], latest_ebitda: Optional[float], latest_fcf: Optional[float],
) -> Optional[dict]:
    """Returns None (never a fabricated distribution) if fewer than
    _MIN_HISTORICAL_YEARS real (price, fundamental) pairs are available —
    e.g. a recent IPO, or a ticker FMP's price history doesn't cover.
    `shares_out`/`total_debt`/`cash` are TODAY's real values, used only to
    apply the historical median multiples to today's own fundamentals —
    the historical multiples themselves come entirely from each year's own
    real, period-specific share count and balance sheet."""
    from app.services.financial_data_service import get_historical_prices_near_dates

    dates = [row.get("period") for row in income if row.get("period")]
    if len(dates) < _MIN_HISTORICAL_YEARS:
        return None
    prices_by_date = get_historical_prices_near_dates(ticker, dates)

    pe_hist, ev_ebitda_hist, p_fcf_hist, fcf_yield_hist = [], [], [], []
    for i, row in enumerate(income):
        hist_price = prices_by_date.get(row.get("period"))
        if hist_price is None:
            continue
        eps = row.get("Diluted EPS") or row.get("Basic EPS")
        ni = row.get("Net Income")
        ebitda = row.get("EBITDA")
        bal = balance[i] if i < len(balance) else {}
        cf = cashflow[i] if i < len(cashflow) else {}
        lt_debt = bal.get("Long Term Debt") or 0
        st_debt = bal.get("Short Term Debt") or 0
        cash_i = bal.get("Cash And Short Term Investments") or bal.get("Cash And Cash Equivalents") or 0
        ocf, capex = cf.get("Operating Cash Flow"), cf.get("Capital Expenditure")
        fcf_i = (ocf - abs(capex)) if ocf is not None and capex is not None else None

        implied_shares = (ni / eps) if ni is not None and eps and eps != 0 else None
        if not implied_shares or implied_shares <= 0:
            continue

        if eps and eps > 0:
            pe_hist.append(hist_price / eps)

        market_cap_i = hist_price * implied_shares
        if ebitda and ebitda > 0:
            ev_ebitda_hist.append((market_cap_i + lt_debt + st_debt - cash_i) / ebitda)

        if fcf_i and fcf_i > 0:
            fcf_per_share_i = fcf_i / implied_shares
            if fcf_per_share_i > 0:
                p_fcf_hist.append(hist_price / fcf_per_share_i)
                fcf_yield_hist.append(fcf_per_share_i / hist_price * 100)

    real_years_used = max(len(pe_hist), len(ev_ebitda_hist), len(p_fcf_hist))
    if real_years_used < _MIN_HISTORICAL_YEARS:
        return None

    def percentile_cheaper_than(today_value: Optional[float], distribution: list[float]) -> Optional[float]:
        """% of its own history where the multiple was HIGHER than today —
        i.e. "cheaper than X% of its own history"."""
        if today_value is None or not distribution:
            return None
        return round(sum(1 for v in distribution if v > today_value) / len(distribution) * 100, 0)

    net_debt = total_debt - cash
    implied_values: dict[str, float] = {}

    if pe_hist and latest_eps and latest_eps > 0:
        implied_values["pe"] = statistics.median(pe_hist) * latest_eps

    if ev_ebitda_hist and latest_ebitda and latest_ebitda > 0 and shares_out:
        implied_ev = statistics.median(ev_ebitda_hist) * latest_ebitda
        implied_values["ev_ebitda"] = (implied_ev - net_debt) / shares_out

    if p_fcf_hist and latest_fcf and latest_fcf > 0 and shares_out:
        fcf_per_share_today = latest_fcf / shares_out
        implied_values["p_fcf"] = statistics.median(p_fcf_hist) * fcf_per_share_today

    if not implied_values:
        return None

    intrinsic_value_per_share = round(statistics.median(list(implied_values.values())), 2)
    margin_of_safety_pct = (
        round((intrinsic_value_per_share - price) / intrinsic_value_per_share * 100, 1)
        if intrinsic_value_per_share else None
    )
    today_pe = price / latest_eps if latest_eps and latest_eps > 0 else None

    return {
        "methodology": "historical_valuation",
        "years_used": real_years_used,
        "historical_median_pe": round(statistics.median(pe_hist), 1) if pe_hist else None,
        "historical_median_ev_ebitda": round(statistics.median(ev_ebitda_hist), 1) if ev_ebitda_hist else None,
        "historical_median_p_fcf": round(statistics.median(p_fcf_hist), 1) if p_fcf_hist else None,
        "historical_median_fcf_yield_pct": round(statistics.median(fcf_yield_hist), 1) if fcf_yield_hist else None,
        "current_pe_percentile_cheaper_than": percentile_cheaper_than(today_pe, pe_hist),
        "implied_values_by_multiple": {k: round(v, 2) for k, v in implied_values.items()},
        "intrinsic_value_per_share": intrinsic_value_per_share,
        "margin_of_safety_pct": margin_of_safety_pct,
    }
