-- ============================================================================
-- 037_llm_usage_log.sql
--
-- Structured, queryable log of every Claude API call's token usage and cost —
-- recommendation #18/#19 of the cost-optimization architecture. Previously
-- cost was only visible as unstructured text in worker.py's
-- "LLM ...: in=%d out=%d cost=$%.5f" log lines, which can't be queried or
-- aggregated per-user. This table is what makes #19 (cost per user) and any
-- future per-endpoint cost dashboard possible.
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_usage_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  endpoint                    TEXT NOT NULL,        -- e.g. 'chat_stream', 'monthly_report', 'price_alert_why'
  model                       TEXT NOT NULL,
  input_tokens                INTEGER NOT NULL DEFAULT 0,
  output_tokens                INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd                    NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_log_user_created ON llm_usage_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_log_endpoint_created ON llm_usage_log(endpoint, created_at DESC);

-- Internal/system table — no end-user ever reads it directly (only admin
-- aggregation queries via service_role). Mirrors the RLS pattern from
-- 033_security_events.sql / 036_major_news_events.sql.
ALTER TABLE llm_usage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: llm usage log" ON llm_usage_log;
CREATE POLICY "Service: llm usage log" ON llm_usage_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
