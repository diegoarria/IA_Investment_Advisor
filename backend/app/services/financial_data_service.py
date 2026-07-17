"""
Financial Data Service
======================
Provider-agnostic abstraction layer for financial statements.

Priority chain:
  1. Financial Modeling Prep (FMP)  — 10 years, structured, if FMP_API_KEY set
  2. Yahoo Finance (yfinance)        — 4-5 years, always available, free

Features:
  - Provider hot-swap without app changes (just add new FinancialProvider subclass)
  - Currency normalization to USD via live FX rates
  - Automatic calculation of Gross/Operating/Net margins and FCF
  - Redis / in-memory cache with provider-based TTL
  - Thread-safe deduplication (one in-flight request per ticker)
  - Year-over-year growth metrics on the latest two annual periods
"""

from __future__ import annotations

import os
import time
import threading
import logging
from abc import ABC, abstractmethod
from typing import Optional

import requests
import pandas as pd

from app.core.cache import cache_get, cache_set
from app.core.config import settings

logger = logging.getLogger(__name__)

# ─── Provider credentials ─────────────────────────────────────────────────────

FMP_KEY = os.getenv("FMP_API_KEY", "")
FMP_BASE = "https://financialmodelingprep.com/stable"
_REQ_HEADERS = {
    "User-Agent": "NuvosAI/1.0 research@nuvosai.app",
    "Accept": "application/json",
}

# ─── Cache TTLs ───────────────────────────────────────────────────────────────

_TTL_FMP = 86_400       # 24 h  — FMP posts end-of-day updates
_TTL_YF = 43_200        # 12 h  — yfinance
_TTL_EMPTY = 3_600      # 1 h   — cache empty results to avoid hammering on bad tickers

# ─── Thread-safe request deduplication ───────────────────────────────────────

_inflight: dict[str, threading.Event] = {}
_inflight_mu = threading.Lock()


def _claim(key: str) -> bool:
    """Returns True if this thread should do the fetch; False if it should wait."""
    with _inflight_mu:
        if key in _inflight:
            ev = _inflight[key]
        else:
            _inflight[key] = threading.Event()
            return True
    ev.wait(timeout=20)
    return False


def _release(key: str) -> None:
    with _inflight_mu:
        ev = _inflight.pop(key, None)
    if ev:
        ev.set()


# ─── Numeric utilities ────────────────────────────────────────────────────────

def _num(v) -> Optional[float]:
    """Safe float conversion — returns None for NaN / inf / non-numeric."""
    if v is None:
        return None
    try:
        n = float(v)
        if n != n or abs(n) > 1e18:   # isnan or overflow
            return None
        return round(n, 2)
    except (TypeError, ValueError):
        return None


def _pct(numerator, denominator) -> Optional[float]:
    n, d = _num(numerator), _num(denominator)
    if n is None or d is None or d == 0:
        return None
    return round((n / d) * 100, 2)


def _yoy(periods: list[dict], field: str) -> Optional[float]:
    if len(periods) < 2:
        return None
    curr = _num(periods[-1].get(field))
    prev = _num(periods[-2].get(field))
    if curr is None or prev is None or prev == 0:
        return None
    return round((curr - prev) / abs(prev) * 100, 2)


# ─── Currency normalization ───────────────────────────────────────────────────

_fx: dict[str, float] = {}          # from_currency → USD rate
_fx_ts: float = 0.0
_fx_mu = threading.Lock()


def _usd_rate(currency: str) -> float:
    """Return multiplier to convert `currency` → USD.  Returns 1.0 on failure."""
    c = (currency or "USD").upper()
    if c in ("USD", "USX", ""):
        return 1.0

    with _fx_mu:
        if _fx and time.time() - _fx_ts < 3_600 and c in _fx:
            return _fx[c]

    try:
        import yfinance as yf
        pair = f"{c}USD=X"
        info = yf.Ticker(pair).fast_info
        rate = getattr(info, "last_price", None) or getattr(info, "regularMarketLastPrice", None)
        if rate and float(rate) > 0:
            with _fx_mu:
                _fx[c] = float(rate)
                _fx_ts = time.time()
            return float(rate)
    except Exception:
        pass
    return 1.0


def _conv(value, currency: str) -> Optional[float]:
    v = _num(value)
    if v is None:
        return None
    r = _usd_rate(currency)
    return round(v * r, 2)


# ─── Canonical period builders ────────────────────────────────────────────────

def _income_period(
    period: str,
    revenue=None, cost_of_revenue=None, gross_profit=None,
    operating_expenses=None, operating_income=None, ebitda=None,
    net_income=None, diluted_eps=None, basic_eps=None,
    gross_margin=None, operating_margin=None, net_margin=None,
    rd=None, sga=None, interest_income=None, interest_expense=None,
    pretax_income=None, tax_provision=None, depreciation_amortization=None,
) -> dict:
    rev = _num(revenue)
    cogs = _num(cost_of_revenue)
    gp = _num(gross_profit)
    oi = _num(operating_income)
    ni = _num(net_income)

    # Auto-derive Gross Profit when missing
    if gp is None and rev is not None and cogs is not None:
        gp = round(rev - cogs, 2)

    # Auto-derive margins
    gm = _num(gross_margin) or _pct(gp, rev)
    om = _num(operating_margin) or _pct(oi, rev)
    nm = _num(net_margin) or _pct(ni, rev)

    # Auto-derive Pretax Income when missing: Operating Income + non-op items
    pti = _num(pretax_income)
    if pti is None and oi is not None:
        ii = _num(interest_income) or 0
        ie = _num(interest_expense) or 0
        # Only auto-derive if we have at least one non-op item
        if ii != 0 or ie != 0:
            pti = round(oi + ii + ie, 2)

    return {
        "period": period,
        "Total Revenue": rev,
        "Cost Of Revenue": cogs,
        "Gross Profit": gp,
        "Gross Margin %": gm,
        "Research And Development": _num(rd),
        "Selling General Administrative": _num(sga),
        "Operating Expenses": _num(operating_expenses),
        "Operating Income": oi,
        "Operating Margin %": om,
        "Interest Income": _num(interest_income),
        "Interest Expense": _num(interest_expense),
        "Pretax Income": pti,
        "Tax Provision": _num(tax_provision),
        "Net Income": ni,
        "Net Margin %": nm,
        "EBITDA": _num(ebitda),
        "Depreciation And Amortization": _num(depreciation_amortization),
        "Diluted EPS": _num(diluted_eps),
        "Basic EPS": _num(basic_eps),
    }


def _balance_period(period: str, **fields) -> dict:
    return {"period": period, **{k: _num(v) for k, v in fields.items()}}


def _cashflow_period(period: str, **fields) -> dict:
    d: dict = {"period": period, **{k: _num(v) for k, v in fields.items()}}
    # Auto-derive FCF = CFO + Capex (capex reported as negative outflow)
    if d.get("Free Cash Flow") is None:
        cfo = d.get("Operating Cash Flow")
        capex = d.get("Capital Expenditure")
        if cfo is not None and capex is not None:
            d["Free Cash Flow"] = round(cfo + capex, 2)
    return d


# ─── Abstract provider interface ──────────────────────────────────────────────

class FinancialProvider(ABC):
    """Implement this class to plug in any financial data source."""

    name: str = "base"

    def available(self) -> bool:
        return True

    @abstractmethod
    def get_income(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        ...

    @abstractmethod
    def get_balance(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        ...

    @abstractmethod
    def get_cashflow(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        ...


# ─── FMP provider ─────────────────────────────────────────────────────────────

class FMPProvider(FinancialProvider):
    """
    Financial Modeling Prep — https://financialmodelingprep.com
    Requires FMP_API_KEY env var.

    Current subscription plan caps `limit` at 5 (confirmed: limit=10 returns
    a plain-text "Premium Query Parameter" error, not JSON, which silently
    looked like "no data" and fell through to yfinance). Clamped here so a
    caller asking for more years still gets the 5 real ones instead of zero
    — upgrade the FMP plan and raise _MAX_LIMIT if more years are needed.
    """

    name = "fmp"
    _MAX_LIMIT = 5

    def available(self) -> bool:
        return bool(FMP_KEY)

    def _get(self, path: str, params: dict | None = None) -> list[dict]:
        try:
            r = requests.get(
                f"{FMP_BASE}/{path}",
                params={"apikey": FMP_KEY, **(params or {})},
                headers=_REQ_HEADERS,
                timeout=14,
            )
            data = r.json()
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "Error Message" not in data:
                return [data]
        except Exception as exc:
            logger.debug("FMP request failed for %s: %s", path, exc)
        return []

    def get_income(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        period = "annual" if annual else "quarter"
        raw = self._get("income-statement", {"symbol": symbol, "limit": min(limit, self._MAX_LIMIT), "period": period})
        result = []
        for r in raw:
            cur = r.get("reportedCurrency", "USD")
            def n(v):
                return _conv(v, cur)
            # FMP ratios come as 0-1 fractions; convert to %
            def pct_field(v):
                x = _num(v)
                return round(x * 100, 2) if x is not None else None

            result.append(_income_period(
                period=(r.get("date") or r.get("fillingDate") or "")[:10],
                revenue=n(r.get("revenue")),
                cost_of_revenue=n(r.get("costOfRevenue")),
                gross_profit=n(r.get("grossProfit")),
                operating_expenses=n(r.get("operatingExpenses")),
                operating_income=n(r.get("operatingIncome")),
                ebitda=n(r.get("ebitda")),
                net_income=n(r.get("netIncome")),
                diluted_eps=_num(r.get("epsDiluted") or r.get("epsdiluted")),
                basic_eps=_num(r.get("eps")),
                gross_margin=pct_field(r.get("grossProfitRatio")),
                operating_margin=pct_field(r.get("operatingIncomeRatio")),
                net_margin=pct_field(r.get("netIncomeRatio")),
                rd=n(r.get("researchAndDevelopmentExpenses")),
                sga=n(r.get("sellingGeneralAndAdministrativeExpenses")),
                interest_income=n(r.get("interestIncome")),
                interest_expense=n(r.get("interestExpense")),
                pretax_income=n(r.get("incomeBeforeTax")),
                tax_provision=n(r.get("incomeTaxExpense")),
                depreciation_amortization=n(r.get("depreciationAndAmortization")),
            ))
        return result[::-1]  # oldest → newest

    def get_balance(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        period = "annual" if annual else "quarter"
        raw = self._get("balance-sheet-statement", {"symbol": symbol, "limit": min(limit, self._MAX_LIMIT), "period": period})
        result = []
        for r in raw:
            cur = r.get("reportedCurrency", "USD")
            def n(v):
                return _conv(v, cur)
            ca = n(r.get("totalCurrentAssets"))
            cl = n(r.get("totalCurrentLiabilities"))
            result.append(_balance_period(
                period=(r.get("date") or "")[:10],
                **{
                    "Cash And Cash Equivalents": n(r.get("cashAndCashEquivalents")),
                    "Short Term Investments": n(r.get("shortTermInvestments")),
                    "Cash And Short Term Investments": n(r.get("cashAndShortTermInvestments")),
                    "Net Receivables": n(r.get("netReceivables")),
                    "Inventory": n(r.get("inventory")),
                    "Other Current Assets": n(r.get("otherCurrentAssets")),
                    "Current Assets": ca,
                    "Net PPE": n(r.get("propertyPlantEquipmentNet")),
                    "Goodwill": n(r.get("goodwill")),
                    "Intangible Assets": n(r.get("intangibleAssets")),
                    "Long Term Investments": n(r.get("longTermInvestments")),
                    "Total Non Current Assets": n(r.get("totalNonCurrentAssets")),
                    "Total Assets": n(r.get("totalAssets")),
                    "Accounts Payable": n(r.get("accountPayables")),
                    "Short Term Debt": n(r.get("shortTermDebt")),
                    "Current Liabilities": cl,
                    "Long Term Debt": n(r.get("longTermDebt")),
                    "Total Non Current Liabilities": n(r.get("totalNonCurrentLiabilities")),
                    "Total Liabilities Net Minority Interest": n(r.get("totalLiabilities")),
                    "Stockholders Equity": n(r.get("totalStockholdersEquity")),
                    "Retained Earnings": n(r.get("retainedEarnings")),
                    "Total Debt": n(r.get("totalDebt")),
                    "Net Debt": n(r.get("netDebt")),
                    "Working Capital": (
                        round((ca or 0) - (cl or 0), 2)
                        if ca is not None and cl is not None else None
                    ),
                },
            ))
        return result[::-1]

    def get_cashflow(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        period = "annual" if annual else "quarter"
        raw = self._get("cash-flow-statement", {"symbol": symbol, "limit": min(limit, self._MAX_LIMIT), "period": period})
        result = []
        for r in raw:
            cur = r.get("reportedCurrency", "USD")
            def n(v):
                return _conv(v, cur)
            result.append(_cashflow_period(
                period=(r.get("date") or "")[:10],
                **{
                    "Net Income": n(r.get("netIncome")),
                    "Depreciation And Amortization": n(r.get("depreciationAndAmortization")),
                    "Stock Based Compensation": n(r.get("stockBasedCompensation")),
                    "Change In Working Capital": n(r.get("changeInWorkingCapital")),
                    "Other Non Cash Items": n(r.get("otherNonCashItems")),
                    "Operating Cash Flow": n(r.get("operatingCashFlow") or r.get("netCashProvidedByOperatingActivities")),
                    "Capital Expenditure": n(r.get("capitalExpenditure")),
                    "Acquisitions Net": n(r.get("acquisitionsNet")),
                    "Purchases Of Investments": n(r.get("purchasesOfInvestments")),
                    "Sales Maturities Of Investments": n(r.get("salesMaturitiesOfInvestments")),
                    "Investing Cash Flow": n(r.get("investingCashFlow") or r.get("netCashProvidedByInvestingActivities")),
                    "Issuance Of Common Stock": n(r.get("commonStockIssuance") or r.get("commonStockIssued")),
                    "Repurchase Of Capital Stock": n(r.get("commonStockRepurchased")),
                    "Repayment Of Debt": n(r.get("debtRepayment") or r.get("netDebtIssuance")),
                    "Dividends Paid": n(r.get("commonDividendsPaid") or r.get("netDividendsPaid") or r.get("dividendsPaid")),
                    "Financing Cash Flow": n(r.get("financingCashFlow") or r.get("netCashProvidedByFinancingActivities")),
                    "Free Cash Flow": n(r.get("freeCashFlow")),
                    "Net Change In Cash": n(r.get("netChangeInCash")),
                    "Cash At Beginning Of Period": n(r.get("cashAtBeginningOfPeriod")),
                    "Cash At End Of Period": n(r.get("cashAtEndOfPeriod")),
                },
            ))
        return result[::-1]


# ─── yfinance provider ────────────────────────────────────────────────────────

class YFinanceProvider(FinancialProvider):
    """
    Yahoo Finance via the yfinance library — always available, no API key needed.
    Delivers approximately 4 years of annual data and 8 quarters.
    """

    name = "yfinance"

    def _currency(self, ticker) -> str:
        try:
            fi = getattr(ticker, "fast_info", None)
            return getattr(fi, "currency", None) or "USD"
        except Exception:
            return "USD"

    def _df_get(self, df: pd.DataFrame | None, col, *keys) -> Optional[float]:
        """Try multiple row-key spellings and return the first non-null numeric."""
        if df is None or df.empty:
            return None
        for key in keys:
            if key in df.index:
                v = df.at[key, col]
                result = _num(v if not isinstance(v, float) or v == v else None)
                if result is not None:
                    return result
        return None

    def get_income(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        try:
            import yfinance as yf
            t = yf.Ticker(symbol)
            df = t.income_stmt if annual else t.quarterly_income_stmt
            if df is None or df.empty:
                return []
            cur = self._currency(t)

            def n(v):
                return _conv(v, cur)

            result = []
            for col in list(df.columns)[:limit]:
                g = lambda *keys: self._df_get(df, col, *keys)
                rev = n(g("Total Revenue", "TotalRevenue"))
                cogs = n(g("Cost Of Revenue", "CostOfRevenue", "Cost of Revenue"))
                gp = n(g("Gross Profit", "GrossProfit"))
                oi = n(g("Operating Income", "OperatingIncome", "EBIT"))
                ebitda = n(g("EBITDA", "Normalized EBITDA", "NormalizedEBITDA"))
                ni = n(g("Net Income", "NetIncome", "Net Income Common Stockholders"))
                result.append(_income_period(
                    period=str(col)[:10],
                    revenue=rev, cost_of_revenue=cogs, gross_profit=gp,
                    operating_income=oi, ebitda=ebitda, net_income=ni,
                    diluted_eps=g("Diluted EPS"),
                    basic_eps=g("Basic EPS"),
                    rd=n(g("Research And Development", "ResearchAndDevelopment",
                           "Research Development")),
                    sga=n(g("Selling General And Administration",
                            "SellingGeneralAndAdministration",
                            "General And Administrative Expense")),
                    interest_income=n(g("Interest Income", "InterestIncome")),
                    interest_expense=n(g("Interest Expense", "InterestExpense")),
                    pretax_income=n(g("Pretax Income", "PreTaxIncome",
                                      "Income Before Tax", "Earnings Before Tax")),
                    tax_provision=n(g("Tax Provision", "Income Tax Expense", "IncomeTaxExpense")),
                    depreciation_amortization=n(g("Reconciled Depreciation",
                                                   "Depreciation And Amortization",
                                                   "Depreciation Amortization Depletion")),
                ))
            return result[::-1]  # oldest → newest
        except Exception as exc:
            logger.debug("YF income failed %s: %s", symbol, exc)
            return []

    def get_balance(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        try:
            import yfinance as yf
            t = yf.Ticker(symbol)
            df = t.balance_sheet if annual else t.quarterly_balance_sheet
            if df is None or df.empty:
                return []
            cur = self._currency(t)

            def n(v):
                return _conv(v, cur)

            result = []
            for col in list(df.columns)[:limit]:
                g = lambda *keys: self._df_get(df, col, *keys)
                ca = n(g("Current Assets", "Total Current Assets", "TotalCurrentAssets"))
                cl = n(g("Current Liabilities", "Total Current Liabilities", "TotalCurrentLiabilities"))
                result.append(_balance_period(
                    period=str(col)[:10],
                    **{
                        "Cash And Cash Equivalents": n(g("Cash And Cash Equivalents",
                                                         "CashAndCashEquivalents", "Cash")),
                        "Short Term Investments": n(g("Short Term Investments")),
                        "Net Receivables": n(g("Receivables", "Net Receivables", "Accounts Receivable")),
                        "Inventory": n(g("Inventory")),
                        "Current Assets": ca,
                        "Net PPE": n(g("Net PPE", "Net Property Plant And Equipment",
                                       "Property Plant And Equipment")),
                        "Goodwill": n(g("Goodwill")),
                        "Intangible Assets": n(g("Intangible Assets", "Other Intangible Assets")),
                        "Total Assets": n(g("Total Assets", "TotalAssets")),
                        "Accounts Payable": n(g("Accounts Payable", "AccountsPayable")),
                        "Short Term Debt": n(g("Short Term Debt", "Current Debt", "CurrentDebt")),
                        "Current Liabilities": cl,
                        "Long Term Debt": n(g("Long Term Debt", "LongTermDebt")),
                        "Total Liabilities Net Minority Interest": n(
                            g("Total Liabilities Net Minority Interest",
                              "Total Liabilities", "TotalLiabilities")
                        ),
                        "Stockholders Equity": n(
                            g("Stockholders Equity", "Common Stock Equity",
                              "Total Stockholder Equity")
                        ),
                        "Retained Earnings": n(g("Retained Earnings", "RetainedEarnings")),
                        "Total Debt": n(g("Total Debt", "TotalDebt")),
                        "Net Debt": n(g("Net Debt", "NetDebt")),
                        "Working Capital": (
                            round((ca or 0) - (cl or 0), 2)
                            if ca is not None and cl is not None else None
                        ),
                    },
                ))
            return result[::-1]
        except Exception as exc:
            logger.debug("YF balance failed %s: %s", symbol, exc)
            return []

    def get_cashflow(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        try:
            import yfinance as yf
            t = yf.Ticker(symbol)
            df = t.cashflow if annual else t.quarterly_cashflow
            if df is None or df.empty:
                return []
            cur = self._currency(t)

            def n(v):
                return _conv(v, cur)

            result = []
            for col in list(df.columns)[:limit]:
                g = lambda *keys: self._df_get(df, col, *keys)
                result.append(_cashflow_period(
                    period=str(col)[:10],
                    **{
                        "Operating Cash Flow": n(g(
                            "Operating Cash Flow", "Cash Flow From Continuing Operating Activities",
                            "Total Cash From Operating Activities")),
                        "Capital Expenditure": n(g(
                            "Capital Expenditure", "Purchase Of PPE",
                            "Capital Expenditures")),
                        "Depreciation And Amortization": n(g(
                            "Depreciation And Amortization", "Depreciation Amortization Depletion",
                            "Depreciation")),
                        "Stock Based Compensation": n(g("Stock Based Compensation")),
                        "Change In Working Capital": n(g("Change In Working Capital")),
                        "Free Cash Flow": n(g("Free Cash Flow")),
                        "Acquisitions Net": n(g("Acquisitions Net", "Net Business Purchase And Sale")),
                        "Purchases Of Investments": n(g("Purchases Of Investments",
                                                        "Purchase Of Investment")),
                        "Sales Maturities Of Investments": n(g(
                            "Sales Maturities Of Investments", "Sale Of Investment")),
                        "Investing Cash Flow": n(g(
                            "Investing Cash Flow", "Cash Flow From Continuing Investing Activities",
                            "Total Cash From Investing Activities")),
                        "Issuance Of Common Stock": n(g("Issuance Of Common Stock",
                                                        "Common Stock Issued")),
                        "Repurchase Of Capital Stock": n(g(
                            "Repurchase Of Capital Stock", "Common Stock Repurchased",
                            "Repurchase Of Stock")),
                        "Repayment Of Debt": n(g("Repayment Of Debt")),
                        "Dividends Paid": n(g("Dividends Paid", "Common Stock Dividend Paid",
                                              "Payment Of Dividends")),
                        "Financing Cash Flow": n(g(
                            "Financing Cash Flow", "Cash Flow From Continuing Financing Activities",
                            "Total Cash From Financing Activities")),
                        "Net Change In Cash": n(g("Changes In Cash", "Net Change In Cash",
                                                  "Net Income From Continuing Operation Net Minority Interest")),
                    },
                ))
            return result[::-1]
        except Exception as exc:
            logger.debug("YF cashflow failed %s: %s", symbol, exc)
            return []


# ─── Fiscal.ai provider ──────────────────────────────────────────────────────

FISCAL_AI_KEY = settings.fiscal_ai_api_key or os.getenv("FISCAL_AI_API_KEY", "")
FISCAL_BASE   = "https://api.fiscal.ai/v1/company/financials"
_TTL_FISCAL   = 86_400   # 24 h — updates within minutes of earnings, daily cache is fine


class FiscalAIProvider(FinancialProvider):
    """
    Fiscal.ai — https://fiscal.ai
    Enterprise-grade standardized financials. Same source as stockanalysis.com.
    Free tier covers ~45 major tickers; paid plans cover the full market.
    Requires FISCAL_AI_API_KEY env var.
    """

    name = "fiscal_ai"

    def available(self) -> bool:
        return bool(FISCAL_AI_KEY)

    def _get(self, statement: str, symbol: str, annual: bool, limit: int) -> list[dict]:
        period_type = "annual" if annual else "quarterly"
        try:
            r = requests.get(
                f"{FISCAL_BASE}/{statement}/standardized",
                params={
                    "ticker":     symbol,
                    "periodType": period_type,
                    "currency":   "USD",
                    "apiKey":     FISCAL_AI_KEY,
                },
                headers=_REQ_HEADERS,
                timeout=14,
            )
            data = r.json()
            if "errors" in data:
                logger.debug("fiscal.ai error for %s: %s", symbol, data["errors"])
                return []
            periods = data.get("data", [])
            # fiscal.ai returns newest first — reverse to oldest→newest, then take limit
            return list(reversed(periods))[-limit:]
        except Exception as exc:
            logger.debug("fiscal.ai request failed %s/%s: %s", statement, symbol, exc)
            return []

    def _mv(self, period: dict, *keys) -> Optional[float]:
        mv = period.get("metricsValues", {})
        for k in keys:
            v = mv.get(k, {})
            if v and v.get("value") is not None:
                return _num(v["value"])
        return None

    def get_income(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        periods = self._get("income-statement", symbol, annual, limit)
        result = []
        for p in periods:
            g = lambda *keys: self._mv(p, *keys)
            result.append(_income_period(
                period=p.get("reportDate", "")[:10],
                revenue=g("income_statement_total_revenues"),
                cost_of_revenue=g("income_statement_cost_of_sales"),
                gross_profit=g("income_statement_gross_profit"),
                operating_income=g("income_statement_operating_profit"),
                ebitda=g("income_statement_ebitda"),
                net_income=g("income_statement_net_income_attributable_to_common_shareholders",
                             "income_statement_consolidated_net_income"),
                rd=g("income_statement_research_and_development_expenses"),
                sga=g("income_statement_selling_general_and_administrative_expenses"),
                interest_income=g("income_statement_interest_income",
                                  "income_statement_interest_and_investment_income"),
                interest_expense=g("income_statement_interest_expense",
                                   "income_statement_net_interest_income_expense"),
                pretax_income=g("income_statement_pretax_income",
                                "income_statement_income_before_taxes"),
                tax_provision=g("income_statement_provision_for_income_taxes"),
                depreciation_amortization=g("income_statement_depreciation_and_amortization"),
                diluted_eps=g("income_statement_diluted_eps"),
                basic_eps=g("income_statement_basic_eps"),
            ))
        return result

    def get_balance(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        periods = self._get("balance-sheet", symbol, annual, limit)
        result = []
        for p in periods:
            g = lambda *keys: self._mv(p, *keys)
            ca = g("balance_sheet_total_current_assets")
            cl = g("balance_sheet_total_current_liabilities")
            result.append(_balance_period(
                period=p.get("reportDate", "")[:10],
                **{
                    "Cash And Cash Equivalents":           g("balance_sheet_cash_and_cash_equivalents"),
                    "Short Term Investments":              g("balance_sheet_short_term_investments"),
                    "Cash And Short Term Investments":     g("balance_sheet_total_cash_and_cash_equivalents"),
                    "Net Receivables":                     g("balance_sheet_accounts_receivable",
                                                             "balance_sheet_total_trade_receivables"),
                    "Inventory":                           g("balance_sheet_inventories"),
                    "Other Current Assets":                g("balance_sheet_other_current_assets"),
                    "Current Assets":                      ca,
                    "Net PPE":                             g("balance_sheet_net_property_plant_and_equipment"),
                    "Goodwill":                            g("balance_sheet_goodwill"),
                    "Intangible Assets":                   g("balance_sheet_net_intangible_assets"),
                    "Long Term Investments":               g("balance_sheet_long_term_investments"),
                    "Total Assets":                        g("balance_sheet_total_assets"),
                    "Accounts Payable":                    g("balance_sheet_accounts_payable"),
                    "Short Term Debt":                     g("balance_sheet_short_term_debt"),
                    "Current Liabilities":                 cl,
                    "Long Term Debt":                      g("balance_sheet_long_term_debt"),
                    "Total Liabilities Net Minority Interest": g("balance_sheet_total_liabilities"),
                    "Stockholders Equity":                 g("balance_sheet_total_common_shareholders_equity",
                                                             "balance_sheet_total_shareholders_equity"),
                    "Retained Earnings":                   g("balance_sheet_retained_earnings"),
                    "Working Capital": (
                        round((ca or 0) - (cl or 0), 2)
                        if ca is not None and cl is not None else None
                    ),
                },
            ))
        return result

    def get_cashflow(self, symbol: str, annual: bool, limit: int) -> list[dict]:
        periods = self._get("cash-flow-statement", symbol, annual, limit)
        result = []
        for p in periods:
            g = lambda *keys: self._mv(p, *keys)
            result.append(_cashflow_period(
                period=p.get("reportDate", "")[:10],
                **{
                    "Operating Cash Flow":           g("cash_flow_statement_cash_from_operating_activities"),
                    "Capital Expenditure":           g("cash_flow_statement_purchases_of_property_plant_and_equipment"),
                    "Depreciation And Amortization": g("cash_flow_statement_depreciation_and_amortization"),
                    "Stock Based Compensation":      g("cash_flow_statement_share_based_compensation_expense"),
                    "Investing Cash Flow":           g("cash_flow_statement_cash_from_investing_activities"),
                    "Financing Cash Flow":           g("cash_flow_statement_cash_from_financing_activities"),
                    "Dividends Paid":                g("cash_flow_statement_common_share_dividends_paid"),
                    "Repurchase Of Capital Stock":   g("cash_flow_statement_repurchases_of_common_shares"),
                    "Issuance Of Common Stock":      g("cash_flow_statement_issuance_of_common_shares"),
                    "Net Change In Cash":            g("cash_flow_statement_increase_or_decrease_in_cash_cash_equivalents_and_restricted_cash"),
                },
            ))
        return result


# ─── Provider registry ────────────────────────────────────────────────────────

# Ordered by preference; extend this list to add new providers
_REGISTRY: list[FinancialProvider] = [
    # FMP prioritized over Fiscal.ai for now — Fiscal.ai's free plan only
    # covers ~45 major tickers (confirmed: even AAPL 403'd, "not available
    # on the free plan"), which silently fell back to yfinance for anything
    # else. Swap back to FiscalAIProvider-first once on a paid Fiscal.ai plan.
    FMPProvider(),        # 10 years — activates when FMP_API_KEY is set
    FiscalAIProvider(),   # Best quality — 20+ years, same as stockanalysis.com — free plan is ticker-limited
    YFinanceProvider(),   # Always-available free fallback
]


def _active_provider() -> FinancialProvider:
    for p in _REGISTRY:
        if p.available():
            return p
    return _REGISTRY[-1]


def register_provider(provider: FinancialProvider, priority: int = 0) -> None:
    """Hot-register a new provider.  priority=0 → prepend (highest), -1 → append."""
    if priority == 0:
        _REGISTRY.insert(0, provider)
    else:
        _REGISTRY.append(provider)


# ─── Calculated metrics ───────────────────────────────────────────────────────

def _build_metrics(income_annual: list[dict]) -> dict:
    if not income_annual:
        return {}
    latest = income_annual[-1]
    prev = income_annual[-2] if len(income_annual) >= 2 else {}

    def f(k):
        return latest.get(k)

    rev = f("Total Revenue")
    gp = f("Gross Profit")
    oi = f("Operating Income")
    ni = f("Net Income")

    return {
        "latestPeriod": f("period"),
        "revenue": rev,
        "grossProfit": gp,
        "operatingIncome": oi,
        "ebitda": f("EBITDA"),
        "netIncome": ni,
        "grossMarginPct": f("Gross Margin %") or _pct(gp, rev),
        "operatingMarginPct": f("Operating Margin %") or _pct(oi, rev),
        "netMarginPct": f("Net Margin %") or _pct(ni, rev),
        "revenueGrowthYoY": _yoy(income_annual, "Total Revenue"),
        "grossProfitGrowthYoY": _yoy(income_annual, "Gross Profit"),
        "netIncomeGrowthYoY": _yoy(income_annual, "Net Income"),
        "ebitdaGrowthYoY": _yoy(income_annual, "EBITDA"),
        "prevPeriod": prev.get("period"),
        "prevRevenue": prev.get("Total Revenue"),
        "prevNetIncome": prev.get("Net Income"),
    }


# ─── Public API ───────────────────────────────────────────────────────────────

def get_financials(symbol: str, limit: int = 5) -> dict:
    """
    Return normalized financial statements for `symbol` (annual + quarterly).

    Response shape:
    {
      "ticker": "AAPL",
      "provider": "fmp" | "yfinance",
      "incomeStatement":   {"annual": [...], "quarterly": [...]},
      "balanceSheet":      {"annual": [...], "quarterly": [...]},
      "cashFlow":          {"annual": [...], "quarterly": [...]},
      "calculatedMetrics": {...},
      "fetchedAt": "ISO-8601",
    }

    Each period dict in the arrays has consistent field names regardless of provider.
    """
    sym = symbol.upper().strip()
    cache_key = f"fin_v3:{sym}:{limit}"

    # Fast path: cache hit
    cached = cache_get(cache_key)
    if cached:
        return cached

    # Deduplication: if another thread is already fetching, wait and re-read cache
    if not _claim(cache_key):
        return cache_get(cache_key) or _empty_response(sym)

    try:
        active_providers = [p for p in _REGISTRY if p.available()]

        def fetch_best(method_name: str, annual: bool, lim: int) -> tuple[list, str]:
            """Try each provider in registry order; return first non-empty result + provider name."""
            for p in active_providers:
                try:
                    result = getattr(p, method_name)(sym, annual=annual, limit=lim)
                    if result:
                        return result, p.name
                except Exception as exc:
                    logger.debug("%s failed for %s/%s: %s", p.name, method_name, sym, exc)
            return [], "none"

        income_a,  income_prov  = fetch_best("get_income",   annual=True,  lim=limit)
        income_q,  _            = fetch_best("get_income",   annual=False, lim=8)
        balance_a, balance_prov = fetch_best("get_balance",  annual=True,  lim=limit)
        balance_q, _            = fetch_best("get_balance",  annual=False, lim=8)
        cf_a,      cf_prov      = fetch_best("get_cashflow", annual=True,  lim=limit)
        cf_q,      _            = fetch_best("get_cashflow", annual=False, lim=8)

        # Use the provider that answered the income statement as the canonical label
        best_provider = income_prov if income_prov != "none" else (balance_prov if balance_prov != "none" else cf_prov)

        response = {
            "ticker": sym,
            "provider": best_provider,
            "incomeStatement":   {"annual": income_a,  "quarterly": income_q},
            "balanceSheet":      {"annual": balance_a, "quarterly": balance_q},
            "cashFlow":          {"annual": cf_a,      "quarterly": cf_q},
            "calculatedMetrics": _build_metrics(income_a),
            "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        ttl = {"fiscal_ai": _TTL_FISCAL, "fmp": _TTL_FMP}.get(best_provider, _TTL_YF)
        if not income_a and not balance_a and not cf_a:
            ttl = _TTL_EMPTY

        cache_set(cache_key, response, ttl=ttl)
        return response

    except Exception as exc:
        logger.exception("get_financials failed for %s: %s", sym, exc)
        return _empty_response(sym)

    finally:
        _release(cache_key)


def _empty_response(sym: str) -> dict:
    return {
        "ticker": sym,
        "provider": "none",
        "incomeStatement":   {"annual": [], "quarterly": []},
        "balanceSheet":      {"annual": [], "quarterly": []},
        "cashFlow":          {"annual": [], "quarterly": []},
        "calculatedMetrics": {},
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def invalidate_cache(symbol: str, limit: int = 5) -> None:
    """Force a fresh fetch on the next request for this ticker."""
    from app.core.cache import cache_delete
    cache_delete(f"fin_v3:{symbol.upper()}:{limit}")
