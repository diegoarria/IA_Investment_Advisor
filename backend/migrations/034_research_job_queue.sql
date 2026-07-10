-- ============================================================================
-- 034_research_job_queue.sql
--
-- Redesigns Deep Research from a fire-and-forget asyncio.create_task (owned
-- by whichever web request happened to call /start, and lost entirely if
-- that process restarts) into a real persistent job queue: jobs are claimed
-- atomically (FOR UPDATE SKIP LOCKED — the standard Postgres queue pattern,
-- safe for any number of concurrent claimers) by the separate, single-
-- purpose `worker.py` process, with a heartbeat so a crashed/restarted
-- worker's in-flight jobs are detected and retried automatically instead of
-- being stuck at "researching" forever.
-- ============================================================================

ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS claimed_by TEXT;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS refunded BOOLEAN NOT NULL DEFAULT false;

-- 'cancelled' joins the existing pending/researching/completed/failed set.
ALTER TABLE research_jobs DROP CONSTRAINT IF EXISTS research_jobs_status_check;
ALTER TABLE research_jobs ADD CONSTRAINT research_jobs_status_check
  CHECK (status IN ('pending', 'researching', 'completed', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_research_jobs_claim ON research_jobs(status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_research_jobs_heartbeat ON research_jobs(status, heartbeat_at) WHERE status = 'researching';

-- Atomic claim: the only correct way to let N worker processes pull from the
-- same queue without two of them ever grabbing the same job. SKIP LOCKED
-- means a claimer never blocks waiting on a row another claimer already has
-- locked — it just moves on to the next eligible row. This one function is
-- what makes horizontal scaling of the worker safe: running 5 worker
-- instances instead of 1 requires zero code changes, just more callers of
-- this same function.
CREATE OR REPLACE FUNCTION claim_research_job(p_worker_id TEXT)
RETURNS SETOF research_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  claimed_id UUID;
BEGIN
  SELECT id INTO claimed_id
  FROM research_jobs
  WHERE status = 'pending'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE research_jobs
  SET status = 'researching',
      claimed_by = p_worker_id,
      claimed_at = NOW(),
      heartbeat_at = NOW(),
      attempts = attempts + 1
  WHERE id = claimed_id
  RETURNING *;
END;
$$;

-- Reclaim jobs whose worker died mid-run: a heartbeat older than the
-- threshold means the process that claimed it is gone (or wedged) without
-- ever reaching a terminal state. Requeue to 'pending' if attempts remain,
-- else mark 'failed' so it stops being retried forever and becomes eligible
-- for the refund path in research_service.reap_stale_jobs().
CREATE OR REPLACE FUNCTION reap_stale_research_jobs(p_stale_after_seconds INT DEFAULT 600)
RETURNS SETOF research_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE research_jobs
  SET status = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
      error = CASE WHEN attempts >= max_attempts THEN 'Se agotaron los intentos tras una interrupción del servidor.' ELSE error END,
      claimed_by = NULL,
      claimed_at = NULL,
      completed_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE completed_at END
  WHERE status = 'researching'
    AND heartbeat_at < NOW() - (p_stale_after_seconds || ' seconds')::interval
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_research_job(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION reap_stale_research_jobs(INT) TO service_role;
