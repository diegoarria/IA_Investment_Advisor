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

Built incrementally, module by module, same discipline as Fase 2 — each
module ships with its own tests before the next one starts.

Modules (as they land):
- claim_schema: `EvidenceTaggedClaim` — the cross-cutting fact/inference/
  ai_opinion + confidence schema every other module's output uses. Not a
  standalone "Evidence Engine" service (it would have no callers of its
  own) — a shared data contract instead (Incremento 1).
- knowledge_store: the persistence layer over `company_knowledge_snapshots`
  / `company_timeline_events` (migration 060) — the permanent, per-COMPANY
  (never per-user) knowledge base every other engine reads from and writes
  to. This is the genuine architectural gap Fase 1-2 never needed: every
  prior phase recomputed everything fresh on each request (Incremento 1).

Every module reuses Fase 1/2 infrastructure rather than reimplementing it:
`app.services.quality.evidence_sources.gather_evidence_bundle` for all real
evidence (SEC filing text, cited web search, scraping), `app.services.
ai_service._claude`/`_parse_json_response`/`_output_language_directive` for
all AI narration, `app.services.nif_service._safe` as the resilience
pattern for any new multi-engine orchestrator. Fase 3 never modifies
`app.services.valuation`/`app.services.quality`/`nif_service.py` — it is
strictly additive on top of them.
"""
