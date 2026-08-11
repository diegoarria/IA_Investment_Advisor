"""
Nuvos Fair Value Engine — the primary production valuation methodology,
per /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.

Normalized EPS x Fair P/E, made rigorous: real data provenance, a genuine
business-lifecycle classification, an earnings-state (peak/trough/normal)
detector, EPS-growth-quality decomposition, a multi-factor Fair P/E model,
a pre-publish Reality Check Gate, and an anti-crazy-valuation divergence
explainer — all built on top of this codebase's existing Fase 1/1.5/2
engines (growth_engine, quality_engine, moat_engine, deterioration_engine,
industry_engine, historical_valuation_service, relative_valuation_service),
never re-deriving what already exists.

The driver-based DCF (`dcf_engine.py`/`legacy_dcf_core.py`) remains as a
secondary cross-check, not deleted — see `engine.py`'s orchestration.

This package is internal. Nothing in it is named after, or presented as,
any individual investor's methodology — see `fair_pe.py`'s module
docstring, inherited verbatim from `fair_value_engine.py`.
"""
