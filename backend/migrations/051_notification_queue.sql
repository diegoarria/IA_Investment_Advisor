-- Migration 051: Notification delivery queue
-- Lets any job enqueue a push for delivery a few minutes in the future
-- instead of sending it immediately. First use: spacing out individual
-- per-stock price-mover alerts (job_portfolio_alerts) ~5 minutes apart so a
-- user with 3 simultaneous movers doesn't get 3 notifications in the same
-- second. job_dispatch_notification_queue (worker.py) polls this every 60s.
--
-- Also adds the AI-insight monthly quota counters used by the new
-- job_ai_insight_scan ("La IA encontró algo") — same migration since both
-- ship together.

CREATE TABLE IF NOT EXISTS notification_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_pending
  ON notification_queue(scheduled_for) WHERE sent_at IS NULL;

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: notification queue" ON notification_queue;
CREATE POLICY "Service: notification queue" ON notification_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS ai_insight_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_insight_month TEXT;
