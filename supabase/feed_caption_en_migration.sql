-- ============================================================
--  Nuvos AI — English captions for clips
--  Ejecutar en Supabase SQL Editor
-- ============================================================

alter table public.clips
  add column if not exists caption_en text not null default '';
