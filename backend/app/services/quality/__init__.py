"""
Quality Engine package — Fase 2 of the Nuvos AI valuation/analysis
redesign (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Answers a question completely separate from `app.services.valuation`
(Fase 1, "how much is this worth"): "how GOOD is this business" — quality,
moat, management, capital allocation, risk, conviction — never using
price, DCF, or multiples. A company can be excellent and expensive, or
mediocre and cheap; this package exists so Nuvos AI can tell the user
which one it's looking at, independently of the valuation engine.

Fase 2 shipped across 11 incremental steps (Incrementos 1-11) — audit
first, then additive builds, each verified with its own tests before the
next increment started, same discipline Fase 1 used for the DCF rebuild.

Modules:
- industry_engine: classification + live peer-derived benchmarks
  (Incremento 1) — the peer group every other engine below reuses.
- quality_engine: pure quantitative business-quality scoring, no AI, no
  price (Incremento 2) — replaced the NIF's old business_quality formula
  (Incremento 3 cutover).
- capital_allocation_engine: buyback timing (vs. real historical prices),
  dividend consistency, reinvestment discipline (Incremento 4).
- earnings_quality_engine: deterministic accounting-quality alerts — SBC
  load, margin anomalies, FCF/net-income divergence (Incremento 5).
- evidence_sources: real SEC EDGAR filing text + cited Perplexity search +
  best-effort scraping, composed into one EvidenceBundle (Incremento 6) —
  the shared evidence layer moat/management/catalysts all cite.
- moat_engine: deterministic ROIC/margin premium-over-industry score, plus
  an AI-narrated 11-moat-type deep dive grounded in evidence_sources
  (Incremento 7).
- management_engine: deterministic score (capital allocation + insider
  alignment) that replaced the NIF's management_quality formula, plus a
  guidance-track-record/governance AI deep dive (Incremento 8).
- conviction_engine: pure synthesis of quality/moat/stability/beta, zero
  AI, zero new fetches (Incremento 9).
- catalysts_engine: AI-narrated near-term catalysts grounded in real
  revenue segments + evidence_sources (Incremento 9).
- peer_comparison_engine: ranks the company's real Quality Score against
  its real peers' own Quality Scores (reuses industry_engine's peer group)
  (Incremento 10).
- deterioration_engine: mechanical trend-DIRECTION analysis, complementing
  (never duplicating) quality_engine's non-directional CV stability
  (Incremento 10).

Every score in every module above carries a `factors: list[...]` with
name/value/score/reason — never a black box. Quality/Moat/Management/
Conviction/Peer-Comparison/Deterioration scores are surfaced as SIBLING
keys in the NIF dashboard response, deliberately never blended into
`overall_nif_score` (which mixes in valuation) — a cheap-but-weak business
must never inherit a high score just because it's cheap.
"""
