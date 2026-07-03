-- Migration 024: Investor Progress Engine (Fase 1 — motor de cálculo)
-- Reutiliza fmg_events como timeline permanente de hitos (idempotente vía
-- milestone_key) en vez de crear una tabla paralela. Agrega fmg_annual_reports
-- porque el resumen anual sí debe congelarse una vez pasa el año, no
-- recalcularse con datos futuros.

-- ── 1. Hitos: reutilizar fmg_events con clave idempotente ────────────────────
ALTER TABLE fmg_events ADD COLUMN IF NOT EXISTS milestone_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fmg_events_milestone_key
  ON fmg_events (user_id, milestone_key) WHERE milestone_key IS NOT NULL;

-- ── 2. Resumen anual congelado ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fmg_annual_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year         INT NOT NULL,
  report       JSONB NOT NULL DEFAULT '{}',
  finalized    BOOLEAN NOT NULL DEFAULT FALSE,  -- true una vez termina el año calendario
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, year)
);

CREATE INDEX IF NOT EXISTS idx_fmg_annual_reports_user
  ON fmg_annual_reports (user_id, year DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Explícito owner + service_role, siguiendo 019_fix_portfolio_rls.sql — sin la
-- policy de service_role, el propio backend queda bloqueado (incidente ya
-- vivido una vez en este proyecto con user_portfolio/user_paper_trading).
ALTER TABLE fmg_annual_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY fmg_annual_reports_self ON fmg_annual_reports
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY fmg_annual_reports_service_role ON fmg_annual_reports
  FOR ALL TO service_role USING (true) WITH CHECK (true);
