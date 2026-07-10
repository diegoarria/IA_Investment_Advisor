# Nuvos AI — Disaster Recovery Runbook

Status as of this writing: **the independent backup layer and this runbook are new** (added during the production-hardening pass). What was true before: no backup/recovery strategy existed anywhere in the repository or documentation — recovery, if possible at all, depended entirely on whatever Supabase plan/PITR setting was configured in the dashboard, known to nobody outside that dashboard.

This document is the single source of truth for "how do we recover if something goes badly wrong," and defines explicit targets rather than leaving them as unmeasured unknowns.

## 1. Recovery objectives

| | Target | Basis |
|---|---|---|
| **RPO** (Recovery Point Objective — max acceptable data loss) | **≤ 15 minutes** if Supabase PITR is active on the project's plan; **≤ 24 hours** otherwise (bounded by the nightly `pg_dump`) | See §2 — this is a real gap until PITR is confirmed |
| **RTO** (Recovery Time Objective — max acceptable downtime) | **≤ 2 hours** for a full database restore into a fresh Supabase project | Estimated from a manual `pg_restore` of a multi-GB custom-format dump; not yet measured by an actual drill (see §5) |

**Action required, not yet done as of this writing**: confirm in the Supabase dashboard (Settings → Add-ons / Database) whether Point-in-Time Recovery is enabled, and on which plan tier. This single fact changes the real RPO by orders of magnitude and cannot be determined from the codebase — it must be checked and then this document updated with the confirmed answer.

## 2. Backup strategy (defense in depth — two independent layers)

1. **Supabase-native backups / PITR** (provider-managed). Free/lower tiers get daily backups only (RPO up to 24h); Pro-tier-and-above PITR gets near-continuous WAL-based recovery (RPO in minutes). **Status: unconfirmed — verify in dashboard.**
2. **Independent nightly `pg_dump`** (`backend/scripts/backup_db.sh`, run by `.github/workflows/db-backup.yml`). This is provider-agnostic: it protects against losing the Supabase *account/project* itself (billing lapse, compromised credentials, platform-side incident affecting that specific project) — a scenario layer 1 alone cannot cover, since it lives inside the same account being protected against.

Layer 2 is new. **Setup required before it's actually running**:
- Add repo secrets: `DATABASE_URL` (Supabase → Settings → Database → Connection string, "Session pooler" URI), `BACKUP_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`.
- Use an S3 bucket + IAM role scoped to `PutObject`/`GetObject` on that bucket only — not a general-purpose AWS key.
- Until these secrets exist, the scheduled GitHub Action will fail loudly every night — that failure notification is the intended signal that setup isn't complete yet, rather than a silent no-op that looks like backups are happening when they aren't.
- Verify the first few scheduled runs actually succeed (Actions tab → "Nightly database backup").

## 3. Restore procedure

**Scenario A — restore from Supabase PITR** (fastest path, if enabled):
1. Supabase dashboard → Database → Backups → select the point in time.
2. Follow Supabase's guided restore (this typically restores in place or to a new project, depending on plan).
3. Verify per §4 below before repointing the app at it.

**Scenario B — restore from the independent `pg_dump`** (used if Supabase PITR is unavailable, or the Supabase account/project itself is unrecoverable):
1. Create a fresh Supabase project (or any Postgres 15+ instance).
2. Download the relevant `nuvos_backup_<timestamp>.dump` from the S3 bucket.
3. Restore:
   ```bash
   pg_restore --no-owner --no-privileges --clean --if-exists \
     -d "$NEW_DATABASE_URL" nuvos_backup_<timestamp>.dump
   ```
4. Re-run every file in `backend/migrations/*.sql` in numeric order against the new database if the dump predates the latest migration (the dump is a snapshot of *data*, not a substitute for tracking which migrations have been applied — see §6).
5. Update Railway env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` to point at the new project.
6. Verify per §4, then redeploy the backend.

## 4. Post-restore verification (do not skip)

A restore that "completes without error" is not the same as a restore that actually recovered usable data. Before declaring recovery complete:
- Spot-check row counts on the highest-value tables (`user_profiles`, `user_portfolio`, `research_reports`) against the last known-good count.
- Log in as a real test account and confirm portfolio/watchlist data renders correctly.
- Confirm RLS policies are present (`\d+ <table>` in `psql`, or the Supabase dashboard's policy view) — a restored dump does NOT include `pg_dump --no-owner --no-privileges`-excluded role grants automatically; migrations 032/033 must be re-applied if they predate the dump, since they're what makes RLS reproducible from a clean database (see `backend/migrations/032_rls_hardening.sql`'s own header comment).
- Run `GET /health/ready` against the restored backend and confirm it reports healthy (see `main.py` — this now checks real Supabase connectivity, not just process liveness).

## 5. Backup verification / restore drills

**Not yet performed as of this writing — this is the honest remaining gap.** A backup that has never been test-restored is a hypothesis, not a guarantee. Recommended cadence: **quarterly**, restore the most recent nightly dump into a scratch Supabase project, run through §4's verification checklist, and record the actual wall-clock time taken (this is what turns the RTO in §1 from an estimate into a measured number). Log each drill's date, duration, and outcome in this file's §7.

## 6. Migration safety / rollback

Migrations in `backend/migrations/*.sql` are applied manually (there is no migration-tracking table and no automated runner — this remains true after this hardening pass; introducing one is tracked as follow-up technical debt, not fixed here). Consequences for DR:
- There is no automatic record of which migrations have actually been applied to production. Before a restore, cross-reference the highest-numbered migration file in the repo at the time of the backup against what's live.
- Migrations here are written idempotently (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` + `CREATE POLICY`) specifically so re-running the full sequence against a freshly-restored database is safe, even if some were already applied.
- **No migration ships with a tested down/rollback script.** If a future migration is genuinely destructive (a `DROP COLUMN`, a data-transforming `UPDATE`), it must include a manually-tested rollback path in its own file before merging — this is a process rule, not something code can enforce today.

## 7. Rollback procedure for bad deploys (not a data incident — a bad code push)

1. Railway dashboard → Deployments → select the last known-good deployment → Redeploy. This is a fast, low-risk rollback for application code and does not touch the database.
2. If the bad deploy included a destructive migration that already ran, code rollback alone does not undo the schema/data change — this requires the restore procedure in §3, scoped to just before that migration ran (PITR is far better suited to this than the nightly dump, given the likely sub-24h gap).

## 8. Drill log

| Date | Type | Result | Duration | Notes |
|---|---|---|---|---|
| _(none yet)_ | | | | First drill should be scheduled within one quarter of this document's creation. |
