"""
Investment Research Engine package — Fase 3 of the Nuvos AI valuation/analysis
redesign (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Fase 1 (`app.services.valuation`) answers "how much is this company worth."
Fase 2 (`app.services.quality`) answers "how good is this company as a
business." Fase 3 answers a categorically different question: "what do I
need to know and understand about this company to think more clearly about
it — and how does that change over time?" It is never a buy/sell signal and
never a new valuation number — it is structured, persistent, versioned
KNOWLEDGE.

Built incrementally across 11 increments, same discipline as Fase 2 — each
module shipped with its own tests before the next one started. Fase 3 is
now feature-complete.

Modules:
- claim_schema: `EvidenceTaggedClaim` — the cross-cutting fact/inference/
  ai_opinion + confidence schema every other module's output uses. Not a
  standalone "Evidence Engine" service (it would have no callers of its
  own) — a shared data contract instead (Incremento 1).
- knowledge_store: the persistence layer over `company_knowledge_snapshots`
  / `company_timeline_events` (migration 060) — the permanent, per-COMPANY
  (never per-user) knowledge base every other engine reads from and writes
  to. This is the genuine architectural gap Fase 1-2 never needed: every
  prior phase recomputed everything fresh on each request (Incremento 1).
- document_intelligence: real primary-source text collection (10-K/10-Q +
  press releases/shareholder letters/earnings-call evidence) — zero AI,
  structures real text rather than summarizing it (Incremento 2).
- business_understanding: company-specific "how does it make money"
  synthesis, grounded in real segments + real 10-K text, compares against
  its own prior snapshot to answer "how has the business changed"
  (Incremento 3).
- competitive_intelligence / industry_intelligence: real peer-comparison
  (reuses `quality.peer_comparison_engine`/`industry_engine` verbatim) +
  AI-narrated competitive landscape / industry outlook, both grounded in
  real evidence (Incremento 4).
- management_intelligence: the first engine whose core capability
  (detecting a real strategy/tone change) is structurally impossible as a
  single-turn call — requires comparing against its own prior snapshot
  (Incremento 5).
- change_detection / timeline_engine: combines real numeric deterioration
  signals + Business/Management Intelligence's own already-detected
  changes into causally-INTERPRETED events, persisted to
  `company_timeline_events`; timeline_engine is the read-only layer over
  that same table (Incremento 6).
- thesis_engine / bull_bear_engine: synthesizes every real signal
  (Quality/Moat/Conviction, valuation, B-E snapshots, real timeline) into
  a structured, NEVER-buy/sell thesis and independent bull/bear cases as
  typed claim lists (ready for a future Debate Engine). Two-table thesis
  model (`research_thesis_drafts` shared/regenerable,
  `user_investment_theses` personal/append-only) resolves the brief's
  auto-build vs. never-overwrite vs. user-editable conflict (Incremento 7).
- thesis_tracker: versions a user's thesis against real events since the
  last review, explains WHY it changed, and records
  `research_hypothesis_outcomes` for the Benchmark Engine (Incremento 8).
- memo_engine: a PURE assembler — zero new computation/AI/fetches — into
  a professional Investment Memo, structured for a future PDF/DOCX export
  layer (Incremento 9).
- research_orchestrator: composes the Company Research Dossier (analogous
  to `nif_service.build_nif_dashboard`), exposed via
  `app.api.routes.research_engine` alongside independent per-section
  routes (Incremento 10).
- benchmark_engine: aggregate accuracy statistics over
  `research_hypothesis_outcomes` (overall, by industry/sector/claim type)
  — deliberately the LAST increment, since it only has real signal once
  the Thesis Tracker has evaluated hypotheses to aggregate (Incremento 11).

Every module reuses Fase 1/2 infrastructure rather than reimplementing it:
`app.services.quality.evidence_sources.gather_evidence_bundle` for all real
evidence (SEC filing text, cited web search, scraping), `app.services.
ai_service._claude`/`_parse_json_response`/`_output_language_directive` for
all AI narration, `app.services.safe_call.safe_call` (promoted from
`nif_service._safe` in Incremento 10) as the resilience pattern for any
multi-engine orchestrator. Fase 3 never modifies
`app.services.valuation`/`app.services.quality`/`nif_service.py` — it is
strictly additive on top of them.
"""
