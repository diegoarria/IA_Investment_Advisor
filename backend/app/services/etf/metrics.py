"""
Derived metrics — computed ONLY from fields normalize.py already confirmed
present and real. Nothing here estimates, interpolates, or asks an LLM to
fill a gap. A metric that needs data we don't have is omitted (None), not
guessed — same discipline Nuvos Radar's own valuation engine uses for
insufficient_data cases.

Deliberately limited to what's honestly computable without the restricted
holdings endpoint (see provider.py's docstring): concentration at the
sector/country level, not the individual-holding level. "How many of your
top 10 individual positions overlap with another ETF" is explicitly OUT of
scope here — that needs /etf/holdings, which Fase 1 does not have access
to (402 under the current plan).
"""
from datetime import date, timedelta


def concentration_metrics(weightings: dict) -> dict:
    """`weightings` is normalize.normalize_weightings()'s output (works
    for sector or country alike — same shape). Returns top-1 and top-3
    concentration, and a plain count of how many distinct buckets the ETF
    actually reports (a thin but real diversification signal: a sector
    ETF reporting 1 sector is maximally concentrated by construction, not
    a data gap)."""
    items = weightings.get("items") or []
    if not items:
        return {
            "top1_name": None, "top1_weight_pct": None,
            "top3_weight_pct": None,
            "bucket_count": 0,
        }
    top1 = items[0]
    top3_pct = round(sum(i["weight_pct"] for i in items[:3]), 2)
    return {
        "top1_name": top1["name"],
        "top1_weight_pct": top1["weight_pct"],
        "top3_weight_pct": top3_pct,
        "bucket_count": len(items),
    }


def cost_tier(expense_ratio_pct: float | None) -> str | None:
    """A plain-language bucket for the expense ratio — not a score, just a
    label a beginner-facing UI can show next to the raw number. Bands
    follow Morningstar's commonly published low/average/high expense-ratio
    thresholds for US ETFs, not an invented scale.

    Returns None (not a guess) when expense_ratio_pct is None."""
    if expense_ratio_pct is None:
        return None
    if expense_ratio_pct <= 0.10:
        return "muy_bajo"
    if expense_ratio_pct <= 0.30:
        return "bajo"
    if expense_ratio_pct <= 0.60:
        return "moderado"
    return "alto"


def price_returns(price_history: list[dict], requested_from_date: str | None) -> dict:
    """YTD, 1-year, 5-year, and "max" returns — each a simple, real
    (price_now / price_then - 1) * 100, never annualized or CAGR-estimated
    (that would imply a precision the raw close-price series alone doesn't
    honestly support without knowing exact dividend reinvestment timing).
    Each window is computed INDEPENDENTLY and returns None for ITSELF when
    there isn't a real price on or before that window's start — e.g. a
    3-year-old ETF has a real YTD/1-year but an honestly-None 5-year, never
    a guess derived from a shorter window.

    `requested_from_date` is the "from" bound service.py asked FMP for
    (ISO "YYYY-MM-DD"). "max" is the return over the oldest real price FMP
    actually returned, which is `max_start_date` — NOT necessarily the
    fund's inception. `max_is_full_history` is True only when FMP's oldest
    row is noticeably newer than `requested_from_date` (FMP ran out of real
    history before reaching what we asked for, so this genuinely is all
    there is); when the oldest row basically equals `requested_from_date`,
    there's likely more real history before our fetch window that we
    simply didn't ask for, so this is reported as a capped window, never
    implied as "since inception".

    `price_history` is normalize_price_history's output: newest-first."""
    empty = {
        "ytd_pct": None, "one_year_pct": None, "five_year_pct": None,
        "max_pct": None, "max_start_date": None, "max_is_full_history": False,
    }
    if not price_history:
        return empty

    current_price = price_history[0].get("price")
    if not current_price:
        return empty

    today = date.today()

    def _return_since(cutoff: date) -> float | None:
        cutoff_str = cutoff.isoformat()
        baseline = next((row for row in price_history if row.get("date") and row["date"] <= cutoff_str), None)
        if not baseline or not baseline.get("price"):
            return None
        return round((current_price / baseline["price"] - 1) * 100, 2)

    ytd_pct = _return_since(date(today.year, 1, 1))
    one_year_pct = _return_since(today - timedelta(days=365))
    five_year_pct = _return_since(today - timedelta(days=365 * 5))

    oldest = price_history[-1]
    max_pct = None
    if oldest.get("price"):
        max_pct = round((current_price / oldest["price"] - 1) * 100, 2)
    max_start_date = oldest.get("date")

    max_is_full_history = False
    if max_start_date and requested_from_date:
        try:
            gap_days = (date.fromisoformat(max_start_date) - date.fromisoformat(requested_from_date)).days
            max_is_full_history = gap_days > 10
        except ValueError:
            max_is_full_history = False

    return {
        "ytd_pct": ytd_pct,
        "one_year_pct": one_year_pct,
        "five_year_pct": five_year_pct,
        "max_pct": max_pct,
        "max_start_date": max_start_date,
        "max_is_full_history": max_is_full_history,
    }
