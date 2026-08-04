-- Migration 059: Tombstone deleted chat sessions so they never resurrect.
-- Chat session deletion was a hard DELETE from chat_history with nothing
-- recorded to remember "this session_id must stay dead" — any later event
-- that could re-insert a row with that session_id (a queued /save-message
-- call that raced the delete, a cross-device sync poll, a stale locally
-- cached copy on another browser/device) silently resurrected the "deleted"
-- chat. This table is the tombstone: /save-message refuses to insert for a
-- tombstoned session_id, and /history returns the tombstoned ids so every
-- client prunes its own local cache to match.
CREATE TABLE IF NOT EXISTS chat_deleted_sessions (
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, session_id)
);

ALTER TABLE chat_deleted_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own deleted chat sessions" ON chat_deleted_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service: deleted chat sessions"  ON chat_deleted_sessions FOR ALL TO service_role USING (true);
