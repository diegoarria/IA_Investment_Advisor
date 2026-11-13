"""
Nuvos ETF — Fase 1: independent FMP-backed ETF data engine.

Deliberately its own package, separate from app/services/valuation/ and
app/services/quality/ (Nuvos Radar's stock engines) — nothing in here
imports from those, and nothing in those imports from here. The only
shared surface is app.services.asset_classification.classify_asset(),
which both sides already depend on independently (Radar to keep ETFs OUT
of its valuation pipeline — see Phase 0 — and this package to confirm a
ticker genuinely IS an ETF before fetching ETF-shaped data for it).

Public entry point: get_etf_overview(ticker) in service.py.
"""
from app.services.etf.service import get_etf_overview

__all__ = ["get_etf_overview"]
