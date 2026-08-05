"""
Valuation Engine — modular package (Fase 1 of the Nuvos AI valuation redesign).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md for the full
architecture and migration plan. This package is being built out
incrementally, module by module, without breaking the existing
`app.services.fundamental_analysis_service` — each new module here is
first proven out (tests + real usage) before `fundamental_analysis_service`
is refactored to consume it in place of its own inline logic.

Modules (as they land):
- robustness: pure numeric guards (Gordon-growth stability, clamping,
  finite-number checks) shared by every engine below it.
- dcf_engine: driver-based DCF (Revenue -> Operating Margin -> EBIT ->
  NOPAT -> Reinvestment -> FCF -> DCF). Incremento 2.
- monte_carlo_engine: probabilistic simulation over the DCF's inputs.
  Incremento 3.
- fair_value_engine: rule-based justified-multiple model, independent of
  the DCF. Incremento 6.
"""
