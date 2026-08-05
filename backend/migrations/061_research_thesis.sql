-- ============================================================================
-- 061_research_thesis.sql
--
-- Fase 3, Incremento 7 (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md):
-- the Thesis Engine (Parte F). The brief asks, simultaneously, for the
-- thesis to be "auto-constructed" by the AI AND to "never automatically
-- overwrite an existing thesis" AND to be "editable by the user" — three
-- requirements that can't coexist in one table. Resolved with two tables:
--
-- research_thesis_drafts: Nuvos's own OBJECTIVE research view — no owner,
-- regenerated in-place (UPSERT on ticker) whenever there's new material
-- Change Detection signal. This is what "auto-construida" refers to. RLS
-- modeled on major_news_events (migration 036) — service_role only, this
-- is never a user's personal data.
--
-- user_investment_theses: the user's PERSONAL, editable thesis. Only ever
-- created by explicit user action (writing one from scratch, or "forking"
-- a research_thesis_drafts snapshot as a starting point) or by the Thesis
-- Tracker (Incremento 8) creating a NEW version row — never UPDATEd by any
-- automated process. is_current marks the live version per (user_id,
-- ticker); parent_thesis_id chains versions so Thesis Tracker can compare
-- N vs N-1 the same way company_knowledge_snapshots does for research.
-- ============================================================================

CREATE TABLE IF NOT EXISTS research_thesis_drafts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                TEXT NOT NULL UNIQUE,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  based_on_snapshot_id  UUID REFERENCES company_knowledge_snapshots(id),
  thesis_summary        TEXT NOT NULL,
  strengths             JSONB NOT NULL,   -- EvidenceTaggedClaim[]
  critical_variables    JSONB NOT NULL,   -- EvidenceTaggedClaim[] — what has to hold true
  key_risks             JSONB NOT NULL,   -- EvidenceTaggedClaim[]
  invalidation_events   JSONB NOT NULL,   -- EvidenceTaggedClaim[] — what would fully invalidate the thesis
  confidence            TEXT NOT NULL     -- low|medium|high, aggregate
);

ALTER TABLE research_thesis_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: research thesis drafts" ON research_thesis_drafts;
CREATE POLICY "Service: research thesis drafts" ON research_thesis_drafts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS user_investment_theses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker                TEXT NOT NULL,
  version               INT NOT NULL DEFAULT 1,
  parent_thesis_id      UUID REFERENCES user_investment_theses(id),
  forked_from_draft_id  UUID REFERENCES research_thesis_drafts(id),
  thesis_summary        TEXT NOT NULL,
  strengths             JSONB NOT NULL,
  critical_variables    JSONB NOT NULL,
  key_risks             JSONB NOT NULL,
  invalidation_events   JSONB NOT NULL,
  is_current            BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_theses_current ON user_investment_theses (user_id, ticker) WHERE is_current;

ALTER TABLE user_investment_theses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own investment theses" ON user_investment_theses;
CREATE POLICY "Users manage own investment theses" ON user_investment_theses
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
