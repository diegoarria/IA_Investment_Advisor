"""
Provenance — Nuvos Fair Value Engine, Block 1.

Data-provenance tracking for the headline metrics the Fair Value Engine
actually publishes a number from (EPS, revenue, FCF, the Fair P/E's key
drivers) — NOT every intermediate number the pipeline touches, per the
Simplicity principle (show evidence for what matters, not a data dump).

This module does not fetch anything itself. `financial_data_service.
get_financials()` already runs a real ordered-fallback provider chain
(FMP -> FiscalAI -> YFinance) and already returns which provider actually
answered plus a `fetchedAt` timestamp for the whole response
(`financial_data_service.py:1115-1146`) — `build_ledger` just captures
that already-made decision per metric instead of discarding it after the
numbers are pulled out.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class DataPoint:
    value: Optional[float]
    period: Optional[str]   # e.g. "FY2024", "TTM"
    source: str              # "FMP" | "FiscalAI" | "YFinance" | "Finnhub" | "AnalystConsensus" | "unavailable"
    as_of: Optional[str]     # ISO date/timestamp, from the provider response's own fetchedAt
    is_estimate: bool = False


@dataclass
class ProvenanceLedger:
    points: dict[str, DataPoint] = field(default_factory=dict)
    discrepancies: list[str] = field(default_factory=list)

    @property
    def completeness_pct(self) -> float:
        """Fraction of recorded metrics that have a real (non-"unavailable")
        source — the raw signal `confidence_engine.py` will fold in as
        `provenance_completeness` (plan §13). 100.0 when nothing was
        recorded yet, so an unused ledger never falsely tanks confidence."""
        if not self.points:
            return 100.0
        real = sum(1 for dp in self.points.values() if dp.source != "unavailable" and dp.value is not None)
        return round(real / len(self.points) * 100, 1)

    def stale_or_missing(self) -> list[str]:
        """Metric names with no real value — feeds Reality Gate check #9
        ("data current/traceable")."""
        return [name for name, dp in self.points.items() if dp.value is None or dp.source == "unavailable"]


_PROVIDER_LABELS = {
    "fmp": "FMP",
    "fiscalai": "FiscalAI",
    "fiscal_ai": "FiscalAI",
    "yfinance": "YFinance",
    "none": "unavailable",
}


def _label_provider(raw: Optional[str]) -> str:
    if not raw:
        return "unavailable"
    return _PROVIDER_LABELS.get(raw.lower(), raw)


def record(
    ledger: ProvenanceLedger,
    *,
    metric: str,
    value: Optional[float],
    period: Optional[str] = None,
    provider: Optional[str] = None,
    as_of: Optional[str] = None,
    is_estimate: bool = False,
) -> None:
    """Stamp one headline metric onto the ledger. Never fabricates a
    source — a `value` with no known `provider` is recorded honestly as
    "unavailable" rather than guessed, so `completeness_pct`/
    `stale_or_missing` reflect reality."""
    ledger.points[metric] = DataPoint(
        value=value,
        period=period,
        source=_label_provider(provider) if value is not None else "unavailable",
        as_of=as_of if value is not None else None,
        is_estimate=is_estimate,
    )


def note_discrepancy(ledger: ProvenanceLedger, message: str) -> None:
    """Record a human-readable note when two real sources disagreed on a
    headline metric — spec requires discrepancies be surfaced, never
    silently resolved by picking whichever number is more convenient."""
    ledger.discrepancies.append(message)


def build_ledger(
    *,
    financials_response: Optional[dict] = None,
    headline_metrics: Optional[dict[str, tuple[Optional[float], Optional[str]]]] = None,
) -> ProvenanceLedger:
    """Build a ledger for one analysis run.

    `financials_response` is the raw dict `financial_data_service.
    get_financials()` returns (carries a top-level `provider`/`fetchedAt`
    for this fetch). `headline_metrics` maps metric name -> (value,
    period) for whatever this engine run actually used from that
    response (and any other already-fetched source, e.g. Finnhub quote/
    analyst consensus, passed in the same shape by the caller with its
    own provider label via `record()` after this call returns).

    This function only seeds the ledger with metrics sourced directly
    from `financials_response`; callers add non-financials-service
    metrics (Finnhub, analyst consensus) via `record()` afterward."""
    ledger = ProvenanceLedger()
    if not financials_response or not headline_metrics:
        return ledger
    provider = financials_response.get("provider")
    fetched_at = financials_response.get("fetchedAt")
    for metric, (value, period) in headline_metrics.items():
        record(
            ledger,
            metric=metric,
            value=value,
            period=period,
            provider=provider,
            as_of=fetched_at,
        )
    return ledger
