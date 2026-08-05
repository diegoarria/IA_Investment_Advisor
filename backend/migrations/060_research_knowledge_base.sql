-- ============================================================================
-- 060_research_knowledge_base.sql
--
-- Fase 3, Incremento 1 (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md):
-- the foundation of the Investment Research Engine — a permanent, per-COMPANY
-- (never per-user), incrementally-updated knowledge store. Confirmed gap in
-- the audit: every timeline/history-shaped table that existed before this
-- (fmg_events, investment_graph_events, investment_decisions) is scoped to
-- user_id — it tracks what a USER did/thought about a company, never the
-- company's own objective history. This table is deliberately the opposite
-- shape: shared, append-only, one row per new piece of real knowledge.
--
-- company_knowledge_snapshots: one row per (ticker, section) EACH TIME an
-- engine (Business Understanding, Competitive, Industry, Management,
-- Document Intelligence — Fase 3 Incrementos 2-5) produces a fresh read.
-- Never UPDATEd — Change Detection (Incremento 6) diffs row N against row
-- N-1 for the same (ticker, section), which requires the old row to still
-- exist. "Incremental" here means "a new row when there's new signal," not
-- "mutate the existing row in place."
--
-- company_timeline_events: the shared, per-company event history the
-- Timeline Engine (Incremento 6) reads and Change Detection writes to.
-- headline_hash dedup follows the exact same pattern as
-- major_news_events(event_date, headline_hash) from migration 036 — the
-- correct precedent for a shared (not per-user) table in this codebase.
--
-- Both tables: RLS enabled, service_role only, zero user-facing policies —
-- same model as major_news_events (036) and security_events (033). No
-- end-user ever reads these tables directly; the research/ package's own
-- service functions are the only callers.
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_knowledge_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker         TEXT NOT NULL,
  section        TEXT NOT NULL,   -- 'document_intel'|'business_understanding'|'competitive'|'industry'|'management'
  content        JSONB NOT NULL,  -- engine-specific shape; always includes a claims[] array (EvidenceTaggedClaim)
  source_period  TEXT,            -- e.g. 'FY2025', '2026-Q2' — which filing/earnings period this reflects
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_snapshots_lookup
  ON company_knowledge_snapshots (ticker, section, created_at DESC);

ALTER TABLE company_knowledge_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: knowledge snapshots" ON company_knowledge_snapshots;
CREATE POLICY "Service: knowledge snapshots" ON company_knowledge_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS company_timeline_events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                    TEXT NOT NULL,
  event_date                DATE,             -- real event date if known; NULL if only approximately dated
  event_type                TEXT NOT NULL,    -- ceo_change|ma|spinoff|product_launch|new_segment|regulatory|guidance_change|margin_shift|strategy_change
  headline                  TEXT NOT NULL,
  detail                    JSONB,            -- claims[], magnitude if applicable (e.g. margin_shift: {from, to, pct})
  detected_from_snapshot_id UUID REFERENCES company_knowledge_snapshots(id),
  source_claim              JSONB,            -- the EvidenceTaggedClaim that originated this event
  headline_hash             TEXT NOT NULL,    -- md5(ticker+event_type+headline) — dedup, same pattern as major_news_events
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_dedup
  ON company_timeline_events (ticker, event_type, headline_hash);
CREATE INDEX IF NOT EXISTS idx_timeline_ticker_date
  ON company_timeline_events (ticker, event_date DESC NULLS LAST);

ALTER TABLE company_timeline_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: company timeline events" ON company_timeline_events;
CREATE POLICY "Service: company timeline events" ON company_timeline_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
