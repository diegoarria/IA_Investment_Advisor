-- Nuvos Pulse — Fase 6B: infraestructura de fotografías históricas
-- verificables. Captura EXCLUSIVAMENTE lo observado en el momento de
-- ejecución (Diego, 2026-11: "no quiero reconstruir artificialmente el
-- cierre mensual") — `period_key` es solo la clave estable del slot de
-- captura (ej. '2026-12'), nunca una afirmación de que los datos
-- corresponden a un cierre histórico exacto. `observed_at` es el único
-- reloj real: siempre server-side (DEFAULT NOW()), nunca aceptado desde
-- el cliente.
--
-- Solo Supabase Local en esta fase — NO aplicar en producción todavía.

CREATE TABLE IF NOT EXISTS portfolio_pulse_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id            TEXT NOT NULL,

  snapshot_type           TEXT NOT NULL CHECK (snapshot_type IN ('month_end', 'on_demand', 'backfill')),
  period_key              TEXT NOT NULL,              -- slot estable (p.ej. '2026-12') -- NUNCA un cierre histórico reclamado
  observed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  base_currency           TEXT NOT NULL,
  methodology_version     TEXT NOT NULL,

  total_value_verified    NUMERIC,
  valuation_coverage_pct  NUMERIC,
  positions               JSONB NOT NULL DEFAULT '[]',
  sector_exposure         JSONB,
  geographic_exposure     JSONB,
  composition             JSONB,
  sources                 JSONB NOT NULL DEFAULT '[]',
  verification_state      TEXT NOT NULL CHECK (verification_state IN ('full', 'partial', 'failed')),

  -- ── Versionado: inmutable salvo estas dos banderas de control ──
  is_current              BOOLEAN NOT NULL DEFAULT true,
  supersedes              UUID REFERENCES portfolio_pulse_snapshots(id),
  -- DEFERRABLE INITIALLY DEFERRED: correct_pulse_snapshot() below sets this
  -- on the OLD row before the NEW row (the one it points to) exists yet —
  -- both happen inside one function call/transaction, so the FK only needs
  -- to hold by COMMIT, not after each individual statement.
  superseded_by           UUID REFERENCES portfolio_pulse_snapshots(id) DEFERRABLE INITIALLY DEFERRED,
  original_observed_at    TIMESTAMPTZ NOT NULL,
  correction_reason       TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotencia real: como mucho UNA fila vigente por slot
-- (usuario + portafolio + tipo de captura + período).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pulse_snapshot_current_slot
  ON portfolio_pulse_snapshots (user_id, portfolio_id, snapshot_type, period_key)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_pulse_snapshot_lookup
  ON portfolio_pulse_snapshots (user_id, portfolio_id, period_key DESC) WHERE is_current;

ALTER TABLE portfolio_pulse_snapshots ENABLE ROW LEVEL SECURITY;

-- Solo lectura para el propio usuario. Deliberadamente SIN política de
-- INSERT/UPDATE/DELETE para el rol `authenticated` — con RLS activo y sin
-- esa política, esas operaciones quedan denegadas por defecto para
-- cualquier cliente autenticado. Toda escritura real ocurre únicamente
-- vía el service role del backend (get_supabase()), que ignora RLS.
CREATE POLICY portfolio_pulse_snapshots_read_own ON portfolio_pulse_snapshots
  FOR SELECT USING (user_id = auth.uid());

-- ── RPCs atómicas de escritura (invocadas solo desde el backend, nunca
--    expuestas como endpoint público) ──────────────────────────────────

-- Inserción idempotente: si ya existe una fila vigente para el slot, la
-- devuelve sin tocarla (nunca duplica, nunca sobrescribe evidencia
-- previa). La condición WHERE replica exactamente el predicado del
-- índice parcial, por lo que ON CONFLICT puede usarlo como árbitro.
CREATE OR REPLACE FUNCTION capture_pulse_snapshot_if_absent(
  p_user_id UUID,
  p_portfolio_id TEXT,
  p_snapshot_type TEXT,
  p_period_key TEXT,
  p_payload JSONB
) RETURNS portfolio_pulse_snapshots
LANGUAGE plpgsql
AS $$
DECLARE
  result portfolio_pulse_snapshots;
  new_id UUID := gen_random_uuid();
  now_ts TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO portfolio_pulse_snapshots (
    id, user_id, portfolio_id, snapshot_type, period_key, observed_at,
    base_currency, methodology_version, total_value_verified,
    valuation_coverage_pct, positions, sector_exposure, geographic_exposure,
    composition, sources, verification_state, is_current, original_observed_at
  )
  VALUES (
    new_id, p_user_id, p_portfolio_id, p_snapshot_type, p_period_key, now_ts,
    p_payload->>'base_currency', p_payload->>'methodology_version',
    (p_payload->>'total_value_verified')::NUMERIC,
    (p_payload->>'valuation_coverage_pct')::NUMERIC,
    COALESCE(p_payload->'positions', '[]'::jsonb),
    p_payload->'sector_exposure', p_payload->'geographic_exposure', p_payload->'composition',
    COALESCE(p_payload->'sources', '[]'::jsonb),
    p_payload->>'verification_state',
    true, now_ts
  )
  ON CONFLICT (user_id, portfolio_id, snapshot_type, period_key) WHERE is_current
  DO NOTHING;

  SELECT * INTO result FROM portfolio_pulse_snapshots
    WHERE user_id = p_user_id AND portfolio_id = p_portfolio_id
      AND snapshot_type = p_snapshot_type AND period_key = p_period_key
      AND is_current
    LIMIT 1;
  RETURN result;
END;
$$;

-- Corrección: nunca sobrescribe la fila original. Apaga `is_current` en
-- la vieja, inserta una nueva fila vigente que preserva
-- `original_observed_at` sin cambios (no se puede falsificar cuándo fue
-- la primera observación real), y enlaza ambas direcciones. Las dos
-- operaciones ocurren en la transacción implícita de esta función — un
-- fallo a mitad de camino revierte todo, nunca deja el slot sin versión
-- vigente.
CREATE OR REPLACE FUNCTION correct_pulse_snapshot(
  p_old_id UUID,
  p_payload JSONB,
  p_reason TEXT
) RETURNS portfolio_pulse_snapshots
LANGUAGE plpgsql
AS $$
DECLARE
  old_row portfolio_pulse_snapshots;
  new_row portfolio_pulse_snapshots;
  new_id UUID := gen_random_uuid();
  now_ts TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO old_row FROM portfolio_pulse_snapshots WHERE id = p_old_id AND is_current FOR UPDATE;
  IF old_row.id IS NULL THEN
    RAISE EXCEPTION 'no current snapshot with id % to correct', p_old_id;
  END IF;

  UPDATE portfolio_pulse_snapshots SET is_current = false, superseded_by = new_id WHERE id = p_old_id;

  INSERT INTO portfolio_pulse_snapshots (
    id, user_id, portfolio_id, snapshot_type, period_key, observed_at,
    base_currency, methodology_version, total_value_verified,
    valuation_coverage_pct, positions, sector_exposure, geographic_exposure,
    composition, sources, verification_state, is_current,
    supersedes, original_observed_at, correction_reason
  )
  VALUES (
    new_id, old_row.user_id, old_row.portfolio_id, old_row.snapshot_type, old_row.period_key, now_ts,
    p_payload->>'base_currency', p_payload->>'methodology_version',
    (p_payload->>'total_value_verified')::NUMERIC,
    (p_payload->>'valuation_coverage_pct')::NUMERIC,
    COALESCE(p_payload->'positions', '[]'::jsonb),
    p_payload->'sector_exposure', p_payload->'geographic_exposure', p_payload->'composition',
    COALESCE(p_payload->'sources', '[]'::jsonb),
    p_payload->>'verification_state',
    true,
    p_old_id, old_row.original_observed_at, p_reason
  )
  RETURNING * INTO new_row;

  RETURN new_row;
END;
$$;
