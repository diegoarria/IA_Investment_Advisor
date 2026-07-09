-- Migration 031: Nuvos Deep Research
-- Multi-stage AI research jobs + their finished, saved reports.
-- research_jobs tracks a single research run (status/progress, tied to the
-- Stripe checkout that paid for it). research_reports is the durable,
-- searchable output — kept separate from the job row so a finished report
-- keeps existing independently of job bookkeeping (and so future scheduled/
-- templated research can write directly into research_reports without a job).

CREATE TABLE IF NOT EXISTS research_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_text      TEXT NOT NULL,
  plan              JSONB,              -- structured interpretation from stage 1
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'researching', 'completed', 'failed')),
  current_stage     TEXT,               -- human-readable, shown in progress UI
  stripe_session_id TEXT,               -- ties this job to the checkout that paid for it
  report_id         UUID,               -- set on completion, references research_reports
  error             TEXT,
  trigger_source    TEXT NOT NULL DEFAULT 'manual',  -- 'manual' today; 'scheduled'/'watchlist' later, unused for now
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_research_jobs_user ON research_jobs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id      UUID REFERENCES research_jobs(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  companies   TEXT[] NOT NULL DEFAULT '{}',   -- tickers involved, for search/filter in Research History
  blocks      JSONB NOT NULL,                 -- modular report body: [{type, data}, ...]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_reports_user ON research_reports (user_id, created_at DESC);

ALTER TABLE research_jobs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY research_jobs_self ON research_jobs
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY research_reports_self ON research_reports
  FOR ALL USING (user_id = auth.uid());
