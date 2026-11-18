-- Nuvos Radar 2.0 — Fase 7 "Mi tesis": persistencia privada real.
-- Diego, 2026-11-17: "una tesis actual por usuario y empresa, con
-- posibilidad de edición" — MVP deliberadamente sin historial de
-- versiones (a diferencia de portfolio_pulse_snapshots o
-- company_qualitative_content, que sí versionan). `answers` es JSONB
-- libre que espeja exactamente el shape real de ConstruirTesisPreview.tsx
-- (ThesisAnswers: q1..q6, q5Own) — nunca reinterpretado ni enriquecido
-- por IA, solo lo que el usuario eligió/escribió.
--
-- Mismo patrón RLS ya probado en watchlist (ver backend/app/api/routes/
-- watchlist.py): toda escritura real ocurre vía el service role del
-- backend (get_supabase()), con user_id SIEMPRE derivado del token
-- verificado (get_current_user_id) — nunca aceptado del cliente. La
-- política RLS "FOR ALL USING (auth.uid() = user_id)" es una segunda
-- capa de defensa (relevante si esta tabla se consultara alguna vez con
-- la clave anon/authenticated en vez de service_role), no el único
-- mecanismo de autorización.
--
-- SOLO preparación — NO aplicar en Supabase real sin autorización
-- explícita de Diego (igual que la migración 126 y sus 2 rondas de
-- dry-run antes de aplicarse).

CREATE TABLE IF NOT EXISTS user_radar_theses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker          TEXT NOT NULL,
  answers         JSONB NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_user_radar_theses_user ON user_radar_theses(user_id);

ALTER TABLE user_radar_theses ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que watchlist: una sola política cubre las 4 operaciones,
-- siempre acotada a la fila propia. El backend real escribe vía
-- service_role (que ignora RLS); esta política es la barrera si algo
-- alguna vez consulta la tabla con una clave anon/authenticated.
CREATE POLICY "Users manage own radar thesis" ON user_radar_theses
  FOR ALL USING (auth.uid() = user_id);
