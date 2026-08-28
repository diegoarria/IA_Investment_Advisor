-- Removes the margin-of-safety alert feature entirely (Diego, 2026-08-27:
-- "no me gustó nada" — full removal, not a hide). The table backed both the
-- original manual-DCF-sliders feature (migration 048) and its later
-- repurposing into a configurable margin-of-safety threshold (migration
-- 078); neither survives in the app anymore, so the table goes too.

DROP TABLE IF EXISTS saved_valuations;
