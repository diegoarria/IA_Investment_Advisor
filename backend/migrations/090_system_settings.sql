-- ============================================================================
-- 090_system_settings.sql
--
-- Tiny durable key-value store for system-wide toggles — first use: the
-- "AI kill switch" Diego controls from the standalone Nuvos Sentinel panel
-- (GET/POST /sentinel/ai-status, /sentinel/ai-toggle) to pause Arthur/every
-- AI feature during a suspected attack, planned maintenance, or any other
-- reason, without a deploy. See app/core/feature_flags.py.
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  reason      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT
);

INSERT INTO system_settings (key, value)
VALUES ('ai_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Internal/admin-only, same pattern as security_events (033).
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: system settings" ON system_settings;
CREATE POLICY "Service: system settings" ON system_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
