"""
Quality Engine package — Fase 2 of the Nuvos AI valuation/analysis
redesign (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Answers a question completely separate from `app.services.valuation`
(Fase 1, "how much is this worth"): "how GOOD is this business" — quality,
moat, management, capital allocation, risk, conviction — never using
price, DCF, or multiples. A company can be excellent and expensive, or
mediocre and cheap; this package exists so Nuvos AI can tell the user
which one it's looking at, independently of the valuation engine.

Modules (as they land):
- industry_engine: classification + live peer-derived benchmarks
  (Incremento 1).
- quality_engine: pure quantitative business-quality scoring
  (Incremento 2).
"""
