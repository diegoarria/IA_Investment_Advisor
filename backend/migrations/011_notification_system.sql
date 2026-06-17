-- Migration 011 — Notification & Engagement System
-- Run in Supabase SQL Editor

-- User notification preferences (one row per user, created on first GET)
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Push toggles
  push_market_open        BOOLEAN DEFAULT true,
  push_market_close       BOOLEAN DEFAULT true,
  push_news_general       BOOLEAN DEFAULT true,
  push_portfolio_alerts   BOOLEAN DEFAULT true,
  push_watchlist_alerts   BOOLEAN DEFAULT true,
  push_ai_recommendations BOOLEAN DEFAULT true,
  push_milestones         BOOLEAN DEFAULT true,
  push_volatility         BOOLEAN DEFAULT true,
  -- Email toggles
  email_daily_summary  BOOLEAN DEFAULT true,
  email_weekly_summary BOOLEAN DEFAULT true,
  -- Fatigue control
  max_push_per_day   INTEGER DEFAULT 5,
  max_push_per_week  INTEGER DEFAULT 20,
  quiet_hours_start  INTEGER DEFAULT 22,  -- hour in ET (22 = 10pm)
  quiet_hours_end    INTEGER DEFAULT 8,   -- hour in ET (8 = 8am)
  -- Engagement tracking
  last_opened_app     TIMESTAMPTZ,
  consecutive_ignores INTEGER DEFAULT 0,
  snooze_until        TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Delivery log — one row per notification sent/skipped/failed
CREATE TABLE IF NOT EXISTS notification_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,   -- 'push' | 'email'
  category   VARCHAR(50) NOT NULL,   -- 'market_open' | 'portfolio_alert' | 'weekly_summary' | etc.
  title      TEXT,
  body       TEXT,
  data       JSONB DEFAULT '{}',
  status     VARCHAR(20) DEFAULT 'sent',  -- 'sent' | 'delivered' | 'failed' | 'skipped'
  opened_at  TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  error_text TEXT,
  dedup_key  VARCHAR(255),  -- prevent same category+user+day duplicate
  sent_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics events
CREATE TABLE IF NOT EXISTS notification_analytics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      VARCHAR(50) NOT NULL,  -- 'sent' | 'opened' | 'clicked' | 'converted'
  category        VARCHAR(50),
  user_id         UUID,
  user_tier       VARCHAR(20),
  notification_id UUID REFERENCES notification_log(id) ON DELETE SET NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notif_prefs_user       ON notification_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_user         ON notification_log(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_category     ON notification_log(category, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_dedup        ON notification_log(dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notif_analytics_event  ON notification_analytics(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_analytics_cat    ON notification_analytics(category, created_at DESC);

-- RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_analytics   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own prefs"      ON notification_preferences FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own logs"          ON notification_log         FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service inserts logs"        ON notification_log         FOR INSERT WITH CHECK (true);
CREATE POLICY "Service inserts analytics"   ON notification_analytics   FOR INSERT WITH CHECK (true);
