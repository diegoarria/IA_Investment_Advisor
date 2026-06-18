-- Migration 012 — Add download_url to clips
-- Run in Supabase SQL Editor
-- Stores a direct MP4 download URL separate from the HLS streaming URL.

ALTER TABLE clips ADD COLUMN IF NOT EXISTS download_url TEXT;
