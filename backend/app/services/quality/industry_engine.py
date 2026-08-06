"""
Industry Engine — Fase 2, Incremento 1 (Parte I — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Two independent jobs:

1. `classify_industry`: maps a company's raw sector/industry strings
   (Finnhub's `finnhubIndustry` taxonomy, same source used everywhere
   else in this codebase) onto one of the canonical categories the brief
   asks for — so a REIT is never benchmarked against Nvidia.

2. `compute_industry_benchmarks`: real, LIVE benchmarks (median ROIC,
   operating margin, FCF margin, revenue growth) computed from the
   company's actual real peers — never a static invented table.

   This is a deliberate improvement over the brief's literal ask (a fixed
   "expected ROIC by industry" table): a hardcoded table would carry the
   exact same "not backtested, just an illustrative anchor" weakness
   already disclosed for `fair_value_engine.py`'s sector base-P/E table.
   Computing the benchmark live from real peers is strictly more honest —
   it's REAL data, not someone's guess at what "good" looks like — and it
   reuses `relative_valuation_service._find_peers` verbatim (the exact
   same peer-finding logic already proven for valuation multiples),
   applied here to quality metrics instead. No duplicated peer-matching
   logic between the two engines.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from typing import Optional

_MIN_PEERS_FOR_BENCHMARK = 5  # same floor relative_valuation_service uses — never median a group too small to mean anything

# ── Canonical industry categories ──────────────────────────────────────────
# Substring-matched against "{industry} {sector}" (industry first — it's the
# finer-grained signal), same pattern already used throughout this codebase
# (sector discount rates, terminal growth, base P/E tables). Order matters:
# more specific keys (e.g. "reit") are checked before broader ones that would
# otherwise also match (e.g. "real estate").
_INDUSTRY_CATEGORIES: list[tuple[str, str]] = [
    ("reit", "REIT"),
    ("bank", "Financials"),
    ("insurance", "Financials"),
    ("capital markets", "Financials"),
    ("financial services", "Financials"),
    ("asset management", "Financials"),
    ("semiconductor", "Semiconductors"),
    ("software", "Software"),
    ("internet", "Marketplace"),
    ("e-commerce", "Marketplace"),
    ("marketplace", "Marketplace"),
    ("airline", "Airlines"),
    ("telecom", "Telecom"),
    ("oil & gas", "Oil & Gas"),
    ("oil and gas", "Oil & Gas"),
    ("energy", "Oil & Gas"),
    ("utilities", "Utilities"),
    ("biotechnology", "Healthcare"),
    ("drug", "Healthcare"),
    ("healthcare", "Healthcare"),
    ("pharmaceutical", "Healthcare"),
    ("aerospace", "Industrials"),
    ("industrials", "Industrials"),
    ("machinery", "Industrials"),
    ("retail", "Retail"),
    ("consumer defensive", "Consumer"),
    ("consumer cyclical", "Consumer"),
    ("consumer electronics", "Consumer"),
    ("real estate", "Real Estate Services"),
]
_DEFAULT_CATEGORY = "Diversified"


def classify_industry(sector: Optional[str], industry: Optional[str]) -> str:
    """Returns the canonical category, or "Diversified" when nothing
    matches — an honest "we don't have a specific bucket for this" rather
    than forcing a bad fit."""
    haystack = f"{industry or ''} {sector or ''}".lower()
    for key, category in _INDUSTRY_CATEGORIES:
        if key in haystack:
            return category
    return _DEFAULT_CATEGORY


@dataclass
class IndustryBenchmarks:
    category: str
    sector: Optional[str]
    industry: Optional[str]
    peer_count: int
    peers_used: list[str]
    median_roic_pct: Optional[float]
    median_operating_margin_pct: Optional[float]
    median_fcf_margin_pct: Optional[float]
    median_revenue_cagr_pct: Optional[float]


def compute_industry_benchmarks(
    ticker: str, sector: Optional[str], industry: Optional[str],
    analysis_cache: Optional[dict[str, Optional[dict]]] = None,
) -> Optional[IndustryBenchmarks]:
    """Real median ROIC/margins/growth across the company's actual real
    peers (same universe + peer-matching `relative_valuation_service`
    already uses). Returns None — never a fabricated/estimated benchmark —
    if fewer than `_MIN_PEERS_FOR_BENCHMARK` real peers have computable
    data, exactly like `compute_relative_valuation`'s own None-safety.

    `analysis_cache`, when passed, avoids re-fetching a peer's full
    analysis if the caller already computed it elsewhere in the same
    request/batch (same convention as relative_valuation_service)."""
    from app.services.relative_valuation_service import _find_peers
    from app.services.fundamental_analysis_service import get_fundamental_analysis

    peers = _find_peers(ticker, sector, industry)
    if len(peers) < _MIN_PEERS_FOR_BENCHMARK:
        return None

    roic_vals, om_vals, fcf_vals, growth_vals = [], [], [], []
    real_peers: list[str] = []
    for peer_ticker in peers:
        if analysis_cache is not None and peer_ticker in analysis_cache:
            peer_data = analysis_cache[peer_ticker]
        else:
            try:
                # _compute_peer_dependent_data=False — only real trend/margin data is
                # read from the peer below, never its Consensus fair value;
                # see get_fundamental_analysis's docstring.
                peer_data = get_fundamental_analysis(peer_ticker, _compute_peer_dependent_data=False)
            except Exception:
                continue
            if analysis_cache is not None:
                analysis_cache[peer_ticker] = peer_data
        if not peer_data:
            continue
        real_peers.append(peer_ticker)

        dcf = peer_data.get("dcf") or {}
        growth_buildup = dcf.get("growth_buildup") or {}
        if growth_buildup.get("avg_roic_pct") is not None:
            roic_vals.append(growth_buildup["avg_roic_pct"])
        if dcf.get("avg_fcf_margin_pct") is not None:
            fcf_vals.append(dcf["avg_fcf_margin_pct"])

        om_trend = peer_data.get("operating_margin_trend") or []
        latest_om = next((v for v in reversed(om_trend) if v is not None), None)
        if latest_om is not None:
            om_vals.append(latest_om)

        if peer_data.get("revenue_cagr_pct") is not None:
            growth_vals.append(peer_data["revenue_cagr_pct"])

    if len(real_peers) < _MIN_PEERS_FOR_BENCHMARK:
        return None

    return IndustryBenchmarks(
        category=classify_industry(sector, industry),
        sector=sector, industry=industry,
        peer_count=len(real_peers), peers_used=real_peers,
        median_roic_pct=round(statistics.median(roic_vals), 1) if roic_vals else None,
        median_operating_margin_pct=round(statistics.median(om_vals), 1) if om_vals else None,
        median_fcf_margin_pct=round(statistics.median(fcf_vals), 1) if fcf_vals else None,
        median_revenue_cagr_pct=round(statistics.median(growth_vals), 1) if growth_vals else None,
    )
