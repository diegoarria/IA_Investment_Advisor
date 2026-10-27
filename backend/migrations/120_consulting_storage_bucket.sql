-- ============================================================================
-- 120_consulting_storage_bucket.sql
--
-- Private storage for MY NUVOS — assignment submissions, final project
-- files, resource documents, graduation certificates. The only existing
-- storage bucket in this project (avatars) is PUBLIC (get_public_url, no
-- signed URLs) — there is no prior private-bucket precedent to follow, so
-- this is the first one.
--
-- public = false: objects are NOT reachable by a permanent public URL.
-- The backend (service-role key, which bypasses storage RLS the same way
-- it bypasses table RLS) is the only thing that ever reads/writes this
-- bucket directly — it hands the browser a short-lived SIGNED URL
-- (createSignedUrl, ~10 min) per download, generated on demand by
-- GET /api/consulting/documents/{path}/signed-url after that route's own
-- ownership check. No RLS policy on storage.objects is added for this
-- bucket, on purpose — same deny-all-for-anon/authenticated stance as
-- migration 119's tables; the signed URL itself (not a Postgres policy)
-- is what time-limits access.
-- ============================================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('consulting-documents', 'consulting-documents', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
