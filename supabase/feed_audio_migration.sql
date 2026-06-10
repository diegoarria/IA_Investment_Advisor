-- ============================================================
--  Nuvos AI — Feed Audio (análisis IA pre/post video)
--  Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Nuevas columnas en clips
alter table public.clips
  add column if not exists pre_text       text not null default '',
  add column if not exists post_text      text not null default '',
  add column if not exists pre_audio_url  text not null default '',
  add column if not exists post_audio_url text not null default '';

-- 2. Crear bucket de storage para audios (si no existe)
--    ALTERNATIVA: Supabase Dashboard → Storage → New bucket → "clip-audio" (Public)
insert into storage.buckets (id, name, public)
values ('clip-audio', 'clip-audio', true)
on conflict (id) do nothing;

-- 3. Políticas de storage
create policy "clip_audio_public_read"
  on storage.objects for select
  using (bucket_id = 'clip-audio');

create policy "clip_audio_service_insert"
  on storage.objects for insert
  with check (bucket_id = 'clip-audio');

create policy "clip_audio_service_update"
  on storage.objects for update
  using (bucket_id = 'clip-audio');

create policy "clip_audio_service_delete"
  on storage.objects for delete
  using (bucket_id = 'clip-audio');
