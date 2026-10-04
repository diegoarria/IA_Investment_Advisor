"""
Relative Valuation (Method 3 of the Valuation Engine)
=======================================================
Implies a company's fair value from what the market is currently paying for
its real peers — same curated UNIVERSE already used by the weekly
undervalued screener (screener.py), filtered to real sector/industry
matches. Every multiple used here (P/E, EV/EBITDA, EV/FCF, Price/FCF) is
read directly from each peer's own already-computed, already-validated
get_fundamental_analysis() output — never re-derived with a separate,
parallel calculation that could quietly drift from the DCF engine's own
numbers.

Run in two places: the weekly screener batch (undervalued_screener_service),
amortized across the whole curated universe, and the live single-ticker
quick-analysis search (screener.py's /quick-analysis) — a single ticker's
5-10 real peers is cheap enough for a live request, and the whole response
is cached 24h per ticker so a repeat search never re-pays the cost.
"""

from __future__ import annotations

import logging
import statistics
from typing import Optional

from app.services.valuation.numeric_helpers import calc_margin_of_safety

logger = logging.getLogger(__name__)

_MIN_PEERS = 5  # never compute a median off a "peer group" too small to mean anything


def resolve_universe_sector_industry(ticker: str) -> tuple[Optional[str], Optional[str]]:
    """Real GICS sector/industry for this ticker from the SAME curated
    UNIVERSE that `_find_peers` matches against, when this ticker happens
    to be one of its ~927 members — confirmed live 2026-10-03 as strictly
    more useful here than Finnhub's own `sector` string
    (`get_fundamental_analysis`'s `sector` field, i.e. Finnhub's
    `finnhubIndustry`): that's a DIFFERENT taxonomy ("Consumer Cyclical")
    from UNIVERSE's GICS ("Consumer Discretionary"), so `_find_peers`'
    exact-string match against it silently returned zero peers for the
    ENTIRE mismatched-taxonomy population, not just edge cases — RIVN
    ("Consumer Cyclical" vs real GICS "Consumer Discretionary") is a
    representative, confirmed example. Returns (None, None), never a
    guess, when the ticker isn't in UNIVERSE — the caller falls back to
    the Finnhub sector string unchanged in that case."""
    from app.api.routes.screener import UNIVERSE
    entry = next((e for e in UNIVERSE if e["ticker"] == ticker.upper()), None)
    if not entry:
        return None, None
    return entry.get("sector"), entry.get("industry")


def _find_peers(ticker: str, sector: Optional[str], industry: Optional[str], limit: int = 10) -> list[str]:
    """Same industry first (the tighter, more meaningful comparison); falls
    back to same sector only if the industry group is too small. Returns []
    (not a guess) if neither real grouping has enough real companies —
    never pads a thin peer set with unrelated tickers just to hit a count."""
    from app.api.routes.screener import UNIVERSE
    ticker = ticker.upper()

    if industry:
        same_industry = [e["ticker"] for e in UNIVERSE if e.get("industry") == industry and e["ticker"] != ticker]
        if len(same_industry) >= _MIN_PEERS:
            return same_industry[:limit]
    if sector:
        same_sector = [e["ticker"] for e in UNIVERSE if e.get("sector") == sector and e["ticker"] != ticker]
        return same_sector[:limit]
    return []


def compute_relative_valuation(
    ticker: str, price: float, shares_out: float,
    latest_eps: Optional[float], latest_ebitda: Optional[float], latest_fcf: Optional[float],
    total_debt: float, cash: float, sector: Optional[str], industry: Optional[str],
    analysis_cache: Optional[dict[str, Optional[dict]]] = None,
    latest_revenue: Optional[float] = None,
) -> Optional[dict]:
    """Real peer-multiple valuation. Returns None (never a fabricated
    estimate) if the curated universe doesn't have enough real peers in the
    same sector/industry, or none of them have a usable multiple for this
    company's own real per-share metrics.

    `analysis_cache`, when passed (the weekly refresh job passes the same
    dict it already populated while scanning the WHOLE curated universe),
    avoids re-fetching a peer's full analysis when it was already computed
    for that peer directly — a same-sector peer is frequently also a
    candidate elsewhere in the same weekly run. Never required — falls
    back to a real live fetch per peer when no cache is given.

    `latest_revenue` (optional, added 2026-10-03): EV/Sales is the ONLY
    multiple here that stays meaningful when EPS/EBITDA/FCF are negative —
    an ordinary state for early-stage growth names and cyclicals in a down
    year (RIVN, LCID, PLUG, MSTR...), confirmed live as the single biggest
    cause of CompanyDiagnosticCard 404ing with "datos insuficientes" even
    though a real price, real peers and real revenue all existed. Each
    peer's own EV/Sales is derived from ITS real price/shares/debt/cash/
    revenue — never looked up as a pre-computed field (none exists)."""
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    peers = _find_peers(ticker, sector, industry)
    if len(peers) < _MIN_PEERS:
        return None

    pe_values, ev_ebitda_values, ev_fcf_values, p_fcf_values, ev_sales_values = [], [], [], [], []
    real_peers_used = []
    for peer_ticker in peers:
        try:
            if analysis_cache is not None and peer_ticker in analysis_cache:
                peer_data = analysis_cache[peer_ticker]
            else:
                # _compute_peer_dependent_data=False — a peer's own Consensus would
                # recurse back into compute_relative_valuation for THEIR
                # peers (frequently including the ticker we started from);
                # see get_fundamental_analysis's docstring.
                peer_data = get_fundamental_analysis(peer_ticker, _compute_peer_dependent_data=False)
                if analysis_cache is not None:
                    analysis_cache[peer_ticker] = peer_data
        except Exception as exc:
            logger.warning("compute_relative_valuation(%s): peer %s failed: %s", ticker, peer_ticker, exc)
            continue
        if not peer_data:
            continue
        real_peers_used.append(peer_ticker)
        if peer_data.get("pe_ratio") and peer_data["pe_ratio"] > 0:
            pe_values.append(peer_data["pe_ratio"])
        if peer_data.get("ev_ebitda") and peer_data["ev_ebitda"] > 0:
            ev_ebitda_values.append(peer_data["ev_ebitda"])
        if peer_data.get("ev_fcf") and peer_data["ev_fcf"] > 0:
            ev_fcf_values.append(peer_data["ev_fcf"])
        if peer_data.get("p_fcf") and peer_data["p_fcf"] > 0:
            p_fcf_values.append(peer_data["p_fcf"])
        # EV/Sales — derived here (no pre-computed field exists) from this
        # peer's own real price/shares/debt/cash/revenue. Skipped for a
        # peer missing any one of those real inputs, never estimated.
        peer_price = peer_data.get("current_price")
        peer_shares = (peer_data.get("dcf") or {}).get("shares_outstanding")
        peer_revenue = (peer_data.get("revenue_trend") or [None])[-1]
        if peer_price and peer_shares and peer_revenue and peer_revenue > 0:
            peer_debt = peer_data.get("total_debt") or 0.0
            peer_cash = peer_data.get("cash") or 0.0
            peer_ev = peer_price * peer_shares + peer_debt - peer_cash
            if peer_ev > 0:
                ev_sales_values.append(peer_ev / peer_revenue)

    if len(real_peers_used) < _MIN_PEERS:
        return None

    net_debt = total_debt - cash
    implied_values: dict[str, float] = {}

    if pe_values and latest_eps and latest_eps > 0:
        implied_values["pe"] = statistics.median(pe_values) * latest_eps

    if ev_ebitda_values and latest_ebitda and latest_ebitda > 0 and shares_out:
        implied_ev = statistics.median(ev_ebitda_values) * latest_ebitda
        implied_values["ev_ebitda"] = (implied_ev - net_debt) / shares_out

    if ev_fcf_values and latest_fcf and latest_fcf > 0 and shares_out:
        implied_ev = statistics.median(ev_fcf_values) * latest_fcf
        implied_values["ev_fcf"] = (implied_ev - net_debt) / shares_out

    if p_fcf_values and latest_fcf and latest_fcf > 0 and shares_out:
        implied_values["p_fcf"] = statistics.median(p_fcf_values) * latest_fcf / shares_out

    if ev_sales_values and latest_revenue and latest_revenue > 0 and shares_out:
        implied_ev = statistics.median(ev_sales_values) * latest_revenue
        implied_values["ev_sales"] = (implied_ev - net_debt) / shares_out

    if not implied_values:
        return None

    # Median across the multiples that DID produce a usable implied value —
    # not an average, so one distorted multiple (e.g. a peer set with an
    # outlier EV/EBITDA) doesn't drag the whole estimate.
    intrinsic_value_per_share = round(statistics.median(list(implied_values.values())), 2)
    margin_of_safety_pct = calc_margin_of_safety(intrinsic_value_per_share, price)

    return {
        "methodology": "relative_valuation",
        "peers_used": real_peers_used,
        "peer_count": len(real_peers_used),
        "peer_median_pe": round(statistics.median(pe_values), 1) if pe_values else None,
        "peer_median_ev_ebitda": round(statistics.median(ev_ebitda_values), 1) if ev_ebitda_values else None,
        "peer_median_ev_fcf": round(statistics.median(ev_fcf_values), 1) if ev_fcf_values else None,
        "peer_median_p_fcf": round(statistics.median(p_fcf_values), 1) if p_fcf_values else None,
        "peer_median_ev_sales": round(statistics.median(ev_sales_values), 2) if ev_sales_values else None,
        "implied_values_by_multiple": {k: round(v, 2) for k, v in implied_values.items()},
        "intrinsic_value_per_share": intrinsic_value_per_share,
        "margin_of_safety_pct": margin_of_safety_pct,
    }
