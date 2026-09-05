-- ============================================================================
-- 087_client_errors.sql
--
-- Frontend crash reports (React error boundary / Next.js global-error.tsx),
-- POSTed to /telemetry/client-error with no auth (the user may be logged
-- out or mid-crash when it fires). Read by GET /sentinel/client-errors so
-- the standalone Nuvos Sentinel monitor can flag a spike in full-screen
-- ("pantalla en blanco") frontend crashes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_errors (
  id          BIGSERIAL PRIMARY KEY,
  message     TEXT,
  stack       TEXT,
  url         TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_errors_created_at ON client_errors(created_at DESC);

-- Internal/admin-only, same pattern as security_events (033).
ALTER TABLE client_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: client errors" ON client_errors;
CREATE POLICY "Service: client errors" ON client_errors
  FOR ALL TO service_role USING (true) WITH CHECK (true);
