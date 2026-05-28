"""
SEC EDGAR XBRL Service
======================
Fetches the most recent 10-Q and 10-K financial statements directly from the
SEC's public XBRL API — no API key required, always up-to-date.

Endpoints used:
  - https://www.sec.gov/files/company_tickers.json   → ticker→CIK map
  - https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{concept}.json
      → per-concept time series (all filings for that metric)

All concept requests are fired in parallel and cached 20 minutes.
"""

import time
import math
import concurrent.futures
import requests

# SEC requires User-Agent with a real company/contact (enforced by rate limiter)
_HEADERS = {"User-Agent": "NuvosAI research@nuvosai.app", "Accept-Encoding": "gzip"}

# ── CIK map cache (24 h) ──────────────────────────────────────────────────
_cik_map: dict[str, str] = {}
_cik_map_ts: float = 0.0


def _ensure_cik_map() -> None:
    global _cik_map, _cik_map_ts
    if _cik_map and time.time() - _cik_map_ts < 86400:
        return
    try:
        r = requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers=_HEADERS, timeout=12
        )
        data = r.json()
        _cik_map = {
            v["ticker"].upper(): str(v["cik_str"]).zfill(10)
            for v in data.values()
            if "ticker" in v and "cik_str" in v
        }
        _cik_map_ts = time.time()
    except Exception:
        pass


def get_cik(ticker: str) -> str | None:
    _ensure_cik_map()
    return _cik_map.get(ticker.upper().replace("-", "."))


# ── Per-concept cache (20 min) ────────────────────────────────────────────
_concept_cache: dict[str, tuple[list, float]] = {}
CONCEPT_TTL = 1200


def _fetch_concept(cik: str, concept: str) -> list[dict]:
    key = f"{cik}/{concept}"
    cached = _concept_cache.get(key)
    if cached and time.time() - cached[1] < CONCEPT_TTL:
        return cached[0]
    try:
        url = (f"https://data.sec.gov/api/xbrl/companyconcept/"
               f"CIK{cik}/us-gaap/{concept}.json")
        r = requests.get(url, headers=_HEADERS, timeout=10)
        if r.status_code != 200:
            _concept_cache[key] = ([], time.time())
            return []
        entries = r.json().get("units", {}).get("USD", [])
        _concept_cache[key] = (entries, time.time())
        return entries
    except Exception:
        _concept_cache[key] = ([], time.time())
        return []


# ── Entry selection helpers ───────────────────────────────────────────────

def _most_recent_q(entries: list[dict]) -> dict | None:
    qs = [e for e in entries
          if e.get("form") == "10-Q"
          and e.get("fp") in ("Q1", "Q2", "Q3", "Q4")]
    return max(qs, key=lambda x: x.get("filed", "")) if qs else None


def _prior_year_q(entries: list[dict], ref: dict) -> dict | None:
    fp, fy = ref.get("fp"), ref.get("fy", 0)
    candidates = [e for e in entries
                  if e.get("form") == "10-Q"
                  and e.get("fp") == fp
                  and e.get("fy") == fy - 1]
    return max(candidates, key=lambda x: x.get("filed", "")) if candidates else None


def _most_recent_annual(entries: list[dict]) -> dict | None:
    ks = [e for e in entries if e.get("form") == "10-K" and e.get("fp") == "FY"]
    return max(ks, key=lambda x: x.get("filed", "")) if ks else None


def _prior_annual(entries: list[dict], ref: dict) -> dict | None:
    fy = ref.get("fy", 0)
    ks = [e for e in entries if e.get("form") == "10-K"
          and e.get("fp") == "FY" and e.get("fy") == fy - 1]
    return max(ks, key=lambda x: x.get("filed", "")) if ks else None


def _val_at(entries: list[dict], ref: dict | None) -> float | None:
    """Extract value matching the reference entry (by accession, then by end+fp+form)."""
    if not ref or not entries:
        return None
    accn = ref.get("accn")
    end  = ref.get("end")
    fp   = ref.get("fp")
    form = ref.get("form")
    # Exact match by accession
    m = next((e for e in entries if e.get("accn") == accn), None)
    if not m:
        # Fallback: match by filing period
        m = next((e for e in entries
                  if e.get("end") == end
                  and e.get("fp") == fp
                  and e.get("form") == form), None)
    if m:
        try:
            v = float(m["val"])
            return None if (math.isnan(v) or math.isinf(v)) else v
        except Exception:
            pass
    return None


def _ttm(entries: list[dict], ref: dict) -> float | None:
    """Sum 4 most recent distinct quarters (Trailing Twelve Months)."""
    qs = sorted(
        [e for e in entries if e.get("form") == "10-Q"
         and e.get("fp") in ("Q1", "Q2", "Q3", "Q4")],
        key=lambda x: x.get("filed", ""),
        reverse=True
    )
    seen: set[tuple] = set()
    total = 0.0
    count = 0
    for e in qs:
        key = (e.get("fy"), e.get("fp"))
        if key in seen:
            continue
        seen.add(key)
        try:
            v = float(e["val"])
            if not (math.isnan(v) or math.isinf(v)):
                total += v
                count += 1
        except Exception:
            pass
        if count == 4:
            break
    return total if count > 0 else None


# ── Formatting helpers ────────────────────────────────────────────────────

def _fmt(v) -> str:
    if v is None:
        return "N/D"
    try:
        f = float(v)
        s = "-" if f < 0 else ""
        a = abs(f)
        if a >= 1e12: return f"{s}${a/1e12:.3f}T"
        if a >= 1e9:  return f"{s}${a/1e9:.2f}B"
        if a >= 1e6:  return f"{s}${a/1e6:.2f}M"
        if a >= 1e3:  return f"{s}${a/1e3:.1f}K"
        return f"{s}${a:.2f}"
    except Exception:
        return "N/D"


def _yoy(c, p) -> str:
    if c is None or p is None or p == 0:
        return "—"
    return f"{(c - p) / abs(p) * 100:+.1f}%"


def _mg(n, d) -> str:
    if n is None or not d:
        return "—"
    return f"{n / d * 100:.1f}%"


def _period_label(e: dict) -> str:
    fp    = e.get("fp", "")
    fy    = e.get("fy", "")
    filed = e.get("filed", "")
    if fp and fy:
        return f"{fp} FY{fy}" + (f" (reportado {filed})" if filed else "")
    return e.get("end", "")[:7]


# ── Concept groups ────────────────────────────────────────────────────────

# Each group is a list of XBRL concept names to try in order (most common first).
# Different companies use different concepts — we take the first one with data.
_INCOME = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueGoodsNet",
        "RevenueFromContractWithCustomer",
    ],
    "gp": ["GrossProfit"],
    "opinc": [
        "OperatingIncomeLoss",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    ],
    "ni": [
        "NetIncomeLoss",
        "NetIncomeLossAvailableToCommonStockholdersBasic",
        "ProfitLoss",
    ],
    "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
}

_BALANCE = {
    "cash":   [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsAndShortTermInvestments",
        "CashAndCashEquivalentsAndShortTermInvestments",
    ],
    "assets": ["Assets"],
    "liab":   ["Liabilities"],
    "debt":   [
        "LongTermDebt",
        "LongTermDebtNoncurrent",
        "DebtAndCapitalLeaseObligations",
        "LongTermNotesPayable",
    ],
    "equity": [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
        "CommonStockholdersEquity",
    ],
}

_CASHFLOW = {
    "cfo":    ["NetCashProvidedByUsedInOperatingActivities"],
    "capex":  [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsForCapitalImprovements",
        "AcquisitionsNetOfCashAcquiredAndPurchasesOfBusinesses",
    ],
    "buyback": [
        "PaymentsForRepurchaseOfCommonStock",
        "PaymentsForRepurchaseOfCommonStockAmountRetired",
    ],
    "divs":   [
        "PaymentsOfDividendsCommonStock",
        "PaymentsOfDividends",
        "DividendsPaid",
    ],
}


# ── Main entry point ──────────────────────────────────────────────────────

def get_sec_financials(ticker: str) -> str:
    """
    Returns a formatted string block with the most recent 10-Q / 10-K data
    for the given ticker, ready to inject into the AI context.
    Returns "" if no SEC data is available.
    """
    cik = get_cik(ticker)
    if not cik:
        return ""

    # Collect all unique concept names to fetch
    all_groups = [_INCOME, _BALANCE, _CASHFLOW]
    unique_concepts: list[str] = []
    for group in all_groups:
        for names in group.values():
            for name in names:
                if name not in unique_concepts:
                    unique_concepts.append(name)

    # Fetch all concepts in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(unique_concepts), 20)) as ex:
        futs = {name: ex.submit(_fetch_concept, cik, name) for name in unique_concepts}
        raw: dict[str, list[dict]] = {}
        for name, fut in futs.items():
            try:
                raw[name] = fut.result(timeout=12)
            except Exception:
                raw[name] = []

    def entries(group: dict, key: str) -> list[dict]:
        """Return first non-empty entry list for a concept group key."""
        for name in group.get(key, []):
            e = raw.get(name, [])
            if e:
                return e
        return []

    def val(group: dict, key: str, ref: dict | None) -> float | None:
        for name in group.get(key, []):
            v = _val_at(raw.get(name, []), ref)
            if v is not None:
                return v
        return None

    def ttm_val(group: dict, key: str, ref: dict) -> float | None:
        for name in group.get(key, []):
            v = _ttm(raw.get(name, []), ref)
            if v is not None:
                return v
        return None

    # ── Determine most recent reporting periods ──
    rev_all  = entries(_INCOME, "revenue")
    ref_q    = _most_recent_q(rev_all)        # most recent 10-Q quarter
    ref_ann  = _most_recent_annual(rev_all)   # most recent 10-K annual

    if not ref_q and not ref_ann:
        return ""  # No financials found for this ticker

    lines: list[str] = [f"\n### 📋 ESTADOS FINANCIEROS — SEC EDGAR (10-Q / 10-K) — {ticker.upper()}"]

    # ══ INCOME STATEMENT ══════════════════════════════════════════════════

    if ref_q:
        ref_q_prev = _prior_year_q(rev_all, ref_q)

        fp_c = ref_q.get("fp", ""); fy_c = ref_q.get("fy", "")
        fp_p = ref_q_prev.get("fp", "") if ref_q_prev else ""
        fy_p = ref_q_prev.get("fy", "") if ref_q_prev else ""

        rev_c = val(_INCOME, "revenue", ref_q);   rev_p = val(_INCOME, "revenue", ref_q_prev)
        gp_c  = val(_INCOME, "gp",      ref_q);   gp_p  = val(_INCOME, "gp",      ref_q_prev)
        oi_c  = val(_INCOME, "opinc",   ref_q);   oi_p  = val(_INCOME, "opinc",   ref_q_prev)
        ni_c  = val(_INCOME, "ni",      ref_q);   ni_p  = val(_INCOME, "ni",      ref_q_prev)
        eps_c = val(_INCOME, "eps",     ref_q);   eps_p = val(_INCOME, "eps",     ref_q_prev)

        rev_ttm = ttm_val(_INCOME, "revenue", ref_q)
        ni_ttm  = ttm_val(_INCOME, "ni",      ref_q)

        curr_label = _period_label(ref_q)
        prev_label = f"{fp_p} FY{fy_p}" if (fp_p and fy_p) else "Mismo trim. año ant."

        lines.append(f"\n**📊 Estado de Resultados — Trimestral**")
        lines.append(f"*Período más reciente: {curr_label}*")
        if rev_ttm:
            lines.append(f"*TTM: Ingresos {_fmt(rev_ttm)} | Utilidad neta {_fmt(ni_ttm)}*")
        lines.append(f"| Métrica | {fp_c} FY{fy_c} | {prev_label} | Var. YoY |")
        lines.append("|---|---|---|---|")
        lines.append(f"| Ingresos | {_fmt(rev_c)} | {_fmt(rev_p)} | {_yoy(rev_c, rev_p)} |")
        if gp_c is not None or gp_p is not None:
            lines.append(f"| Utilidad bruta | {_fmt(gp_c)} | {_fmt(gp_p)} | {_yoy(gp_c, gp_p)} |")
            lines.append(f"| Margen bruto | {_mg(gp_c, rev_c)} | {_mg(gp_p, rev_p)} | — |")
        lines.append(f"| Util. operativa (EBIT) | {_fmt(oi_c)} | {_fmt(oi_p)} | {_yoy(oi_c, oi_p)} |")
        lines.append(f"| Margen operativo | {_mg(oi_c, rev_c)} | {_mg(oi_p, rev_p)} | — |")
        lines.append(f"| Utilidad neta | {_fmt(ni_c)} | {_fmt(ni_p)} | {_yoy(ni_c, ni_p)} |")
        lines.append(f"| Margen neto | {_mg(ni_c, rev_c)} | {_mg(ni_p, rev_p)} | — |")
        if eps_c is not None or eps_p is not None:
            eps_p_str = f"${eps_p:.2f}" if eps_p is not None else "N/D"
            lines.append(f"| EPS diluido | {'$'+f'{eps_c:.2f}' if eps_c is not None else 'N/D'} | {eps_p_str} | {_yoy(eps_c, eps_p)} |")

    if ref_ann:
        ref_ann_prev = _prior_annual(rev_all, ref_ann)
        fy_c = ref_ann.get("fy", ""); fy_p = ref_ann_prev.get("fy","") if ref_ann_prev else ""

        rev_c = val(_INCOME, "revenue", ref_ann); rev_p = val(_INCOME, "revenue", ref_ann_prev)
        gp_c  = val(_INCOME, "gp",      ref_ann); gp_p  = val(_INCOME, "gp",      ref_ann_prev)
        oi_c  = val(_INCOME, "opinc",   ref_ann); oi_p  = val(_INCOME, "opinc",   ref_ann_prev)
        ni_c  = val(_INCOME, "ni",      ref_ann); ni_p  = val(_INCOME, "ni",      ref_ann_prev)
        eps_c = val(_INCOME, "eps",     ref_ann); eps_p = val(_INCOME, "eps",     ref_ann_prev)

        lines.append(f"\n**📊 Estado de Resultados — Anual (10-K)**")
        lines.append(f"*FY{fy_c} (reportado {ref_ann.get('filed','')}) vs FY{fy_p}*")
        lines.append(f"| Métrica | FY{fy_c} | FY{fy_p} | Var. YoY |")
        lines.append("|---|---|---|---|")
        lines.append(f"| Ingresos | {_fmt(rev_c)} | {_fmt(rev_p)} | {_yoy(rev_c, rev_p)} |")
        if gp_c is not None or gp_p is not None:
            lines.append(f"| Utilidad bruta | {_fmt(gp_c)} | {_fmt(gp_p)} | {_yoy(gp_c, gp_p)} |")
            lines.append(f"| Margen bruto | {_mg(gp_c, rev_c)} | {_mg(gp_p, rev_p)} | — |")
        lines.append(f"| Util. operativa | {_fmt(oi_c)} | {_fmt(oi_p)} | {_yoy(oi_c, oi_p)} |")
        lines.append(f"| Utilidad neta | {_fmt(ni_c)} | {_fmt(ni_p)} | {_yoy(ni_c, ni_p)} |")
        lines.append(f"| Margen neto | {_mg(ni_c, rev_c)} | {_mg(ni_p, rev_p)} | — |")
        if eps_c is not None or eps_p is not None:
            eps_p_str = f"${eps_p:.2f}" if eps_p is not None else "N/D"
            lines.append(f"| EPS diluido | {'$'+f'{eps_c:.2f}' if eps_c is not None else 'N/D'} | {eps_p_str} | {_yoy(eps_c, eps_p)} |")

    # ══ BALANCE SHEET ═════════════════════════════════════════════════════

    # Find most recent balance sheet reference from Assets
    asset_entries = entries(_BALANCE, "assets")
    bs_candidates = sorted(
        [e for e in asset_entries if e.get("form") in ("10-Q", "10-K")],
        key=lambda x: x.get("filed", ""),
        reverse=True
    )
    bs_ref = bs_candidates[0] if bs_candidates else None

    if bs_ref:
        bs_lbl = _period_label(bs_ref)
        cash_v = val(_BALANCE, "cash",   bs_ref)
        assets = val(_BALANCE, "assets", bs_ref)
        liab   = val(_BALANCE, "liab",   bs_ref)
        debt   = val(_BALANCE, "debt",   bs_ref)
        equity = val(_BALANCE, "equity", bs_ref)

        lines.append(f"\n**🏦 Balance General ({bs_lbl}):**")
        lines.append(f"- Efectivo y equiv.: {_fmt(cash_v)}")
        lines.append(f"- Activos totales:   {_fmt(assets)}")
        if liab:   lines.append(f"- Pasivos totales:   {_fmt(liab)}")
        if debt:   lines.append(f"- Deuda a LP:        {_fmt(debt)}")
        if equity: lines.append(f"- Patrimonio neto:   {_fmt(equity)}")
        if assets and equity:
            net_dbt = (debt or 0) - (val(_BALANCE, "cash", bs_ref) or 0)
            de = (debt or 0) / equity if equity else None
            if de: lines.append(f"- D/E ratio:         {de:.2f}x")

    # ══ CASH FLOW ═════════════════════════════════════════════════════════

    cfo_all   = entries(_CASHFLOW, "cfo")
    capex_all = entries(_CASHFLOW, "capex")
    buy_all   = entries(_CASHFLOW, "buyback")
    div_all   = entries(_CASHFLOW, "divs")

    cf_ref = _most_recent_q(cfo_all) or _most_recent_annual(cfo_all)

    if cf_ref:
        is_quarterly = cf_ref.get("form") == "10-Q"

        if is_quarterly:
            cfo_v   = ttm_val(_CASHFLOW, "cfo",     cf_ref)
            capex_v = ttm_val(_CASHFLOW, "capex",   cf_ref)
            buy_v   = ttm_val(_CASHFLOW, "buyback", cf_ref)
            div_v   = ttm_val(_CASHFLOW, "divs",    cf_ref)
            cf_note = "TTM"
        else:
            cfo_v   = val(_CASHFLOW, "cfo",     cf_ref)
            capex_v = val(_CASHFLOW, "capex",   cf_ref)
            buy_v   = val(_CASHFLOW, "buyback", cf_ref)
            div_v   = val(_CASHFLOW, "divs",    cf_ref)
            cf_note = f"FY{cf_ref.get('fy', '')}"

        # Capex in SEC filings is reported as positive (it's a cash outflow)
        fcf_v = (cfo_v - capex_v) if (cfo_v is not None and capex_v is not None) else None

        lines.append(f"\n**💵 Flujo de Caja ({cf_note}):**")
        lines.append(f"- FCO (Operaciones):      {_fmt(cfo_v)}")
        lines.append(f"- Capex:                  -{_fmt(capex_v)}" if capex_v else "- Capex: N/D")
        lines.append(f"- Free Cash Flow:         {_fmt(fcf_v)}")
        if buy_v: lines.append(f"- Recompra de acciones:  {_fmt(buy_v)}")
        if div_v: lines.append(f"- Dividendos pagados:    {_fmt(div_v)}")

    # ── Source attribution ──
    filing_dates = []
    if ref_q:   filing_dates.append(f"10-Q: {ref_q.get('filed','?')}")
    if ref_ann: filing_dates.append(f"10-K: {ref_ann.get('filed','?')}")
    lines.append(f"\n*Fuente: SEC EDGAR XBRL ({' | '.join(filing_dates)}). "
                 f"Datos del último reporte oficial publicado.*")

    return "\n".join(lines)
