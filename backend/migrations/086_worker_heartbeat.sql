-- ============================================================================
-- 086_worker_heartbeat.sql
--
-- Single-row liveness marker for the worker.py APScheduler process. Written
-- every 60s by job_heartbeat (worker.py) — the standalone Nuvos Sentinel
-- monitor polls it via GET /sentinel/worker-heartbeat to tell "the whole
-- Railway worker process is stuck/crashed" apart from "the web process is
-- down" (health.py) — two different incidents needing different responses.
-- ============================================================================

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  id           TEXT PRIMARY KEY,   -- e.g. 'apscheduler'
  last_beat_at TIMESTAMPTZ NOT NULL,
  detail       TEXT
);

-- Internal/admin-only, same pattern as security_events (033): no end-user
-- ever reads this, only the backend's service_role writes/reads it.
ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: worker heartbeats" ON worker_heartbeats;
CREATE POLICY "Service: worker heartbeats" ON worker_heartbeats
  FOR ALL TO service_role USING (true) WITH CHECK (true);
