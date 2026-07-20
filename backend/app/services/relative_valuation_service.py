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

Deliberately NOT wired into the live quick-analysis search path — computing
this means running a full fundamental analysis for 5-10 real peers, which
is exactly the kind of per-request cost the rest of this platform goes out
of its way to avoid (see undervalued_screener_service's weekly-cache
design). This belongs in the same weekly batch refresh, amortized the same
way the DCF itself already is for the curated universe.
"""

from __future__ import annotations

import logging
import statistics
from typing import Optional

logger = logging.getLogger(__name__)

_MIN_PEERS = 5  # never compute a median off a "peer group" too small to mean anything


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
    back to a real live fetch per peer when no cache is given."""
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    peers = _find_peers(ticker, sector, industry)
    if len(peers) < _MIN_PEERS:
        return None

    pe_values, ev_ebitda_values, ev_fcf_values, p_fcf_values = [], [], [], []
    real_peers_used = []
    for peer_ticker in peers:
        try:
            if analysis_cache is not None and peer_ticker in analysis_cache:
                peer_data = analysis_cache[peer_ticker]
            else:
                peer_data = get_fundamental_analysis(peer_ticker)
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

    if not implied_values:
        return None

    # Median across the multiples that DID produce a usable implied value —
    # not an average, so one distorted multiple (e.g. a peer set with an
    # outlier EV/EBITDA) doesn't drag the whole estimate.
    intrinsic_value_per_share = round(statistics.median(list(implied_values.values())), 2)
    margin_of_safety_pct = (
        round((intrinsic_value_per_share - price) / intrinsic_value_per_share * 100, 1)
        if intrinsic_value_per_share else None
    )

    return {
        "methodology": "relative_valuation",
        "peers_used": real_peers_used,
        "peer_count": len(real_peers_used),
        "peer_median_pe": round(statistics.median(pe_values), 1) if pe_values else None,
        "peer_median_ev_ebitda": round(statistics.median(ev_ebitda_values), 1) if ev_ebitda_values else None,
        "peer_median_ev_fcf": round(statistics.median(ev_fcf_values), 1) if ev_fcf_values else None,
        "peer_median_p_fcf": round(statistics.median(p_fcf_values), 1) if p_fcf_values else None,
        "implied_values_by_multiple": {k: round(v, 2) for k, v in implied_values.items()},
        "intrinsic_value_per_share": intrinsic_value_per_share,
        "margin_of_safety_pct": margin_of_safety_pct,
    }
