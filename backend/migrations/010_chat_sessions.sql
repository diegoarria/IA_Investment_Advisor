-- Add session_id to chat_history so messages can be grouped by conversation
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS session_id VARCHAR(80);

-- Index for efficient per-session queries
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(user_id, session_id, created_at);
