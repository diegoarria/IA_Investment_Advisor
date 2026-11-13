-- Nuvos Pulse — Fase 6C, §1: corrige un bug real encontrado en la propia
-- auditoría previa a construir el comparador.
--
-- Bug: `capture_pulse_snapshot_if_absent` (migración 121) trataba CUALQUIER
-- fila vigente del slot como "ya capturado, no reintentar" — incluyendo una
-- fila con verification_state='failed'. Eso significa que un fallo
-- transitorio de FMP en el primer intento del mes bloqueaba PERMANENTEMENTE
-- ese slot mensual: ningún reintento posterior, exitoso o no, podía generar
-- una versión vigente nueva.
--
-- Corrección: una fila vigente 'failed' SÍ puede ser reemplazada
-- automáticamente por un reintento posterior (se conserva como versión NO
-- vigente para auditoría, nunca se borra ni se sobrescribe). Una fila
-- vigente 'full' o 'partial' sigue siendo verdaderamente idempotente —
-- nunca se reemplaza silenciosamente solo porque alguien volvió a llamar a
-- la captura ("no reemplazar silenciosamente un snapshot parcial válido").
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
  existing portfolio_pulse_snapshots;
  new_id UUID := gen_random_uuid();
  now_ts TIMESTAMPTZ := NOW();
  result portfolio_pulse_snapshots;
BEGIN
  -- FOR UPDATE: si dos reintentos concurrentes encuentran la misma fila
  -- 'failed' vigente, el segundo espera a que el primero termine (ver
  -- comentario más abajo sobre la re-evaluación del WHERE tras el bloqueo).
  SELECT * INTO existing FROM portfolio_pulse_snapshots
    WHERE user_id = p_user_id AND portfolio_id = p_portfolio_id
      AND snapshot_type = p_snapshot_type AND period_key = p_period_key
      AND is_current
    FOR UPDATE;

  IF existing.id IS NOT NULL AND existing.verification_state <> 'failed' THEN
    -- Idempotencia real: una observación ya usable (full o partial) nunca
    -- se reemplaza porque alguien volvió a llamar a la captura.
    RETURN existing;
  END IF;

  IF existing.id IS NOT NULL THEN
    -- existing.verification_state = 'failed' -- se conserva intacta (nunca
    -- se borra ni se reescribe) pero deja de ser la vigente; un reintento
    -- puede superarla. Esto NO es una "corrección" de un dato financiero
    -- válido -- es recuperación tras un fallo, mismo mecanismo de
    -- versionado, motivo distinto.
    UPDATE portfolio_pulse_snapshots SET is_current = false, superseded_by = new_id WHERE id = existing.id;
  END IF;

  INSERT INTO portfolio_pulse_snapshots (
    id, user_id, portfolio_id, snapshot_type, period_key, observed_at,
    base_currency, methodology_version, total_value_verified,
    valuation_coverage_pct, positions, sector_exposure, geographic_exposure,
    composition, sources, verification_state, is_current,
    supersedes, original_observed_at, correction_reason
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
    true,
    existing.id,
    COALESCE(existing.original_observed_at, now_ts),
    CASE WHEN existing.id IS NOT NULL THEN 'reintento automático tras captura fallida' ELSE NULL END
  )
  ON CONFLICT (user_id, portfolio_id, snapshot_type, period_key) WHERE is_current
  DO NOTHING
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    -- Perdimos una carrera real contra otra captura concurrente (solo
    -- posible cuando existing.id era NULL y dos primeros intentos
    -- corrieron a la vez) -- la fila vigente que ganó es la respuesta
    -- correcta para ambos llamadores.
    SELECT * INTO result FROM portfolio_pulse_snapshots
      WHERE user_id = p_user_id AND portfolio_id = p_portfolio_id
        AND snapshot_type = p_snapshot_type AND period_key = p_period_key
        AND is_current
      LIMIT 1;
  END IF;

  RETURN result;
END;
$$;
