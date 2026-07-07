-- Migration 029: voice call transcripts
-- Saves the text transcript of each real-time voice call with the Mentor
-- (not regular text chat — that already has chat_history). Audio itself is
-- not stored, only what was said on both sides, so users can read back what
-- was discussed on a call from "Mi Perfil".

CREATE TABLE IF NOT EXISTS voice_call_transcripts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mentor           TEXT,
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INT NOT NULL DEFAULT 0,
  turns            JSONB NOT NULL DEFAULT '[]',  -- [{"role":"user"|"assistant","text":"..."}]
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_call_transcripts_user
  ON voice_call_transcripts (user_id, started_at DESC);

ALTER TABLE voice_call_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_call_transcripts_self ON voice_call_transcripts
  FOR ALL USING (user_id = auth.uid());
