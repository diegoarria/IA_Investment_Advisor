-- Track which specific learn topics each user has completed.
-- Array of topic IDs (strings), merged across devices on sync.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS completed_topic_ids text[] DEFAULT '{}';
