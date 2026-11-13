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


def price_change_pct(price_history: list[dict]) -> dict:
    """Simple, real (price_end / price_start - 1) * 100 over whatever
    history is actually available — never annualized, never a CAGR
    estimate, since that would imply a precision the raw close-price
    series alone doesn't honestly support without knowing exact dividend
    reinvestment timing. Returns None for a window if there isn't enough
    real history to compute it (e.g. a brand-new ETF)."""
    if not price_history:
        return {"since_earliest_available_pct": None, "days_of_history": 0}
    first = price_history[-1]  # normalize_price_history keeps newest-first order
    last = price_history[0]
    if not first.get("price") or first["price"] == 0:
        return {"since_earliest_available_pct": None, "days_of_history": len(price_history)}
    change = round((last["price"] / first["price"] - 1) * 100, 2)
    return {"since_earliest_available_pct": change, "days_of_history": len(price_history)}
