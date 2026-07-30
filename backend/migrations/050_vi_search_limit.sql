-- Migration 050: Weekly free-tier quota for the Valor Intrínseco search
-- (Oportunidades screen). Free users get 1 search per rolling 7-day window;
-- Premium is unlimited. Same counter+window pattern as msg_count/
-- msg_window_start for the chat message limit.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS vi_search_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vi_search_window_start TIMESTAMPTZ;
