-- ============================================================================
-- 063_research_hypothesis_outcomes.sql
--
-- Fase 3, Incremento 8 (see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md):
-- schema for the Benchmark Engine (Parte N, Incremento 11) — built now,
-- populated by the Thesis Tracker (Parte H, this increment) as soon as
-- there's something real to track, per the plan: "Inserta filas
-- research_hypothesis_outcomes con outcome=NULL (pendiente de evaluación
-- futura) — schema listo desde ya aunque el motor de agregación (N)
-- llegue después." Building the aggregation engine before there's >=1
-- real quarter of tracked hypotheses would be pure scaffolding with zero
-- signal — the schema comes first, the engine comes last.
--
-- One row per individually-verifiable claim Nuvos or a user's thesis made
-- (a critical variable, a risk, an invalidation event, a catalyst) —
-- `outcome` starts NULL (a real prediction, not yet evaluable) and is
-- filled in later, by the Thesis Tracker's NEXT review, once real
-- evidence exists to judge it.
--
-- Shared/global — this measures the quality of NUVOS'S OWN research
-- across every user and ticker, not one user's personal accuracy, so
-- there is no user_id column and RLS is service_role-only, same model as
-- major_news_events (migration 036).
-- ============================================================================

CREATE TABLE IF NOT EXISTS research_hypothesis_outcomes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker            TEXT NOT NULL,
  sector            TEXT,
  industry          TEXT,
  source_thesis_id  UUID REFERENCES research_thesis_drafts(id),
  claim_text        TEXT NOT NULL,
  claim_type        TEXT NOT NULL,   -- critical_variable|risk|invalidation_event|catalyst
  predicted_at      TIMESTAMPTZ NOT NULL,
  evaluated_at      TIMESTAMPTZ,
  outcome           TEXT,            -- confirmed|refuted|inconclusive|NULL (pending)
  evaluation_note   TEXT
);

CREATE INDEX IF NOT EXISTS idx_hypothesis_outcomes_ticker ON research_hypothesis_outcomes (ticker, predicted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hypothesis_outcomes_pending ON research_hypothesis_outcomes (outcome) WHERE outcome IS NULL;

ALTER TABLE research_hypothesis_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: research hypothesis outcomes" ON research_hypothesis_outcomes;
CREATE POLICY "Service: research hypothesis outcomes" ON research_hypothesis_outcomes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
