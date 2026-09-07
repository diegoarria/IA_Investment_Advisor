"""
Earnings Normalization Engine.

Generalizes, into real ticker-agnostic rules, two things that were first
done BY HAND for one company (META, methodology-review session) and then
validated live against 36 real, diverse tickers before landing here —
see the session's own record for the full trail. Two real, separate
normalizations:

1. `normalized_ttm_eps` — a trailing-twelve-month EPS built from real
   quarterly pretax income and a NORMALIZED tax rate, instead of the raw
   reported tax rate. Real one-time tax items (a large one-time charge or
   credit — see docstring below) can swing GAAP EPS wildly quarter to
   quarter without any real change in the underlying business; blending in
   a normalized rate removes that swing while never touching quarters
   where nothing anomalous happened.

2. `capex_supercycle_state` — detects whether a company is currently in a
   real, elevated-capex investment phase (so a FCF-based valuation can
   apply a real recovery model instead of treating a temporarily-depressed
   FCF margin as permanent), and separately computes a normalized FCF
   margin from the company's own non-elevated years.

Both are ADDITIVE, standalone functions — not yet wired into the live
fair-value pipeline's `_epsNormalized`/FCF-margin output for all tickers.
They were validated on 36 tickers spanning very different real profiles
(mega-cap tech, banks, airlines, cyclicals, biotech, REITs) and 2 real
bugs were found and fixed in that process (documented below) — but at
least one further real gap is KNOWN and NOT yet fixed: a company whose
real pretax income itself (not just its tax line) is distorted by a large
one-time item buried in "other income" (confirmed live: Boeing's real
$9.13B one-time gain in Q4 2025, likely a real divestiture) still produces
an inflated normalized EPS, because normalizing the TAX RATE alone can't
correct a distortion that lives in the income line itself. Flip the
switch on the live pipeline only after that gap (or an explicit decision
to accept it) is addressed.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

from app.services.financial_data_service import get_quarterly_income_detail, get_annual_cashflow_detail
from app.services.fundamental_analysis_service import _is_financial_sector, _is_asset_light_financial_industry

# A quarter's effective tax rate is only trusted as evidence of the
# company's real, typical tax burden when it falls in a normal real-world
# band — true one-time items push far outside this (confirmed live:
# META's real 87.5%-effective-rate Q3'25 one-time tax charge, and its
# real -23%-effective-rate Q1'26 tax benefit).
_NORMAL_TAX_RATE_BAND = (0.0, 0.40)
_MIN_CLEAN_QUARTERS = 3

# Real bug found live testing this against Boeing (near-breakeven pretax
# income most quarters): dividing a small real tax dollar amount by a
# near-zero pretax base produces a wild, meaningless "rate" — and some of
# those wild rates land inside the normal band by pure arithmetic
# coincidence, getting accepted as if they were real typical-tax
# quarters. A quarter's rate only counts as usable evidence when pretax
# income is a MEANINGFUL share of that quarter's revenue.
_MIN_PRETAX_MARGIN_FOR_TRUST = 0.05

# A year's capex/revenue ratio only counts as "elevated" when it exceeds
# its own trailing 3-year average level by a real, material margin — a
# LEVEL comparison, not a growth-rate comparison. Two earlier, discarded
# approaches, both confirmed live to be wrong: (a) comparing the ratio to
# its all-time median over-flagged/under-flagged depending on where in
# the cycle the median sat, and specifically mislabeled XOM's 2020 as
# "elevated" even though its real capex FELL that year — the ratio only
# rose because oil-crash revenue fell further, a real false positive from
# using a ratio instead of the level's own recent trend; (b) comparing
# YoY capex growth rate to YoY revenue growth rate over-triggered on
# fast-growing, capex-light names (NVDA, AAPL) where a small capex base
# makes % growth naturally noisy even when nothing structural changed.
_CAPEX_TRAILING_WINDOW_YEARS = 3
_CAPEX_ELEVATED_THRESHOLD_PP = 5.0


@dataclass
class NormalizedEpsResult:
    raw_ttm_eps: Optional[float]
    normalized_ttm_eps: Optional[float]
    normalized_tax_rate_pct: Optional[float]
    flagged_quarters: list[str] = field(default_factory=list)
    note: str = ""


def normalized_ttm_eps(ticker: str) -> Optional[NormalizedEpsResult]:
    """See module docstring. Returns None only when there isn't enough
    real quarterly data to attempt this at all (never fabricates)."""
    rows = get_quarterly_income_detail(ticker, limit=8)
    if len(rows) < 8:
        return None

    quarters = []
    for row in rows:
        pretax = row["operating_income"] + row["other_income"]
        rate = row["tax_expense"] / pretax if pretax else None
        pretax_margin_ok = abs(pretax) / row["revenue"] >= _MIN_PRETAX_MARGIN_FOR_TRUST
        quarters.append({
            "date": row["date"], "pretax": pretax, "rate": rate,
            "shares": row["diluted_shares"], "raw_eps": row["eps_diluted"],
            "pretax_margin_ok": pretax_margin_ok,
        })

    lo, hi = _NORMAL_TAX_RATE_BAND
    clean_rates = [q["rate"] for q in quarters
                    if q["rate"] is not None and q["pretax_margin_ok"] and lo <= q["rate"] <= hi]

    last4 = quarters[-4:]
    raw_ttm = sum(q["raw_eps"] for q in last4 if q["raw_eps"] is not None)

    if len(clean_rates) < _MIN_CLEAN_QUARTERS:
        return NormalizedEpsResult(
            raw_ttm_eps=round(raw_ttm, 2), normalized_ttm_eps=None, normalized_tax_rate_pct=None,
            note="insufficient clean, meaningful quarters to trust a normalized tax rate — "
                 "using raw TTM EPS as-is",
        )

    norm_rate = statistics.median(clean_rates)
    flagged = [q["date"] for q in last4
               if q["rate"] is not None and not (lo <= q["rate"] <= hi)]
    avg_shares = statistics.mean(q["shares"] for q in last4)
    norm_net_sum = sum(q["pretax"] * (1 - norm_rate) for q in last4)
    normalized = norm_net_sum / avg_shares

    return NormalizedEpsResult(
        raw_ttm_eps=round(raw_ttm, 2),
        normalized_ttm_eps=round(normalized, 2),
        normalized_tax_rate_pct=round(norm_rate * 100, 2),
        flagged_quarters=flagged,
    )


@dataclass
class CapexSupercycleResult:
    applicable: bool
    reason: str = ""
    normalized_fcf_margin_pct: Optional[float] = None
    current_year_elevated_capex: Optional[bool] = None
    n_normal_years: int = 0
    n_elevated_years: int = 0


def capex_supercycle_state(ticker: str, sector: Optional[str] = None,
                             industry: Optional[str] = None) -> Optional[CapexSupercycleResult]:
    """See module docstring. `sector`/`industry` should be the SAME real
    fields already used elsewhere in this pipeline (Finnhub's
    `finnhubIndustry` for sector, the curated-universe GICS sub-industry
    for `industry` — see `_is_financial_sector`/`_is_asset_light_
    financial_industry` in fundamental_analysis_service.py, reused
    verbatim here rather than re-implemented, since they're already real,
    already validated against real financial-sector tickers). Returns
    `applicable=False` for banks/insurers/financial-services businesses —
    FCF = operating cash flow minus capex is not a coherent concept for
    them (confirmed live: a real bank's FCF margin swung -61% to +70%
    year to year with $0 real capex reported every year — the business
    model doesn't map onto this framework at all, not a data gap)."""
    if _is_financial_sector(sector) and not _is_asset_light_financial_industry(industry):
        return CapexSupercycleResult(applicable=False, reason=f"financial sector: {sector}")

    rows = get_annual_cashflow_detail(ticker, limit=8)
    if len(rows) < 5:
        return None

    years = []
    for row in rows:
        fcf = row["operating_cash_flow"] + row["capex"]  # capex already negative
        years.append({
            "date": row["date"], "fcf_margin": fcf / row["revenue"],
            "capex_ratio": -row["capex"] / row["revenue"],
        })

    near_zero_years = sum(1 for y in years if abs(y["capex_ratio"]) < 0.005)
    if near_zero_years >= max(1, len(years) - 2):
        return CapexSupercycleResult(applicable=False, reason="near-zero real capex in almost every available year")

    window = _CAPEX_TRAILING_WINDOW_YEARS
    for i, y in enumerate(years):
        if i < window:
            y["elevated"] = False
            continue
        trailing_avg = statistics.mean(years[j]["capex_ratio"] for j in range(i - window, i))
        y["elevated"] = (y["capex_ratio"] - trailing_avg) * 100 > _CAPEX_ELEVATED_THRESHOLD_PP

    normal_years = [y for y in years if not y["elevated"]]
    elevated_years = [y for y in years if y["elevated"]]
    normalized_margin = statistics.mean(y["fcf_margin"] for y in normal_years) if normal_years else None

    return CapexSupercycleResult(
        applicable=True,
        normalized_fcf_margin_pct=round(normalized_margin * 100, 2) if normalized_margin is not None else None,
        current_year_elevated_capex=years[-1]["elevated"],
        n_normal_years=len(normal_years),
        n_elevated_years=len(elevated_years),
    )
