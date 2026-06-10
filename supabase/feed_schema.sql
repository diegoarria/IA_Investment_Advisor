-- ============================================================
--  Nuvos AI — Feed de Video (TikTok-style)
--  Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Tabla principal de clips
create table if not exists public.clips (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text not null default '',
  video_url        text not null,                        -- URL del CDN (Cloudflare Stream / S3)
  thumbnail_url    text not null default '',
  speaker          text not null,                        -- 'Warren Buffett', 'Ray Dalio', etc.
  tags             text[] not null default '{}',         -- ['value investing', 'macro', 'mindset']
  language         text not null default 'es',           -- idioma del audio original
  translated_caption text not null default '',           -- subtítulos/caption en español
  duration_sec     integer not null default 0,
  status           text not null default 'draft'         -- 'draft' | 'published' | 'archived'
                   check (status in ('draft','published','archived')),
  created_by       uuid references auth.users(id),
  view_count       integer not null default 0,
  like_count       integer not null default 0,
  comment_count    integer not null default 0,
  created_at       timestamptz not null default now(),
  published_at     timestamptz
);

create index if not exists clips_status_created   on public.clips(status, created_at desc);
create index if not exists clips_status_likes     on public.clips(status, like_count desc);
create index if not exists clips_speaker          on public.clips(speaker);
create index if not exists clips_tags             on public.clips using gin(tags);

-- 2. Likes
create table if not exists public.clip_likes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  clip_id    uuid not null references public.clips(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, clip_id)
);

create index if not exists clip_likes_user on public.clip_likes(user_id);
create index if not exists clip_likes_clip on public.clip_likes(clip_id);

-- 3. Saves / bookmarks
create table if not exists public.clip_saves (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  clip_id    uuid not null references public.clips(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, clip_id)
);

-- 4. Comentarios (con hilo básico via parent_id)
create table if not exists public.clip_comments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  clip_id    uuid not null references public.clips(id) on delete cascade,
  text       text not null check (char_length(text) <= 500),
  parent_id  uuid references public.clip_comments(id) on delete cascade,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists clip_comments_clip on public.clip_comments(clip_id, created_at);

-- 5. Vistas (para analytics y no repetir contenido)
create table if not exists public.clip_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  clip_id     uuid not null references public.clips(id) on delete cascade,
  watched_pct integer not null default 0,
  created_at  timestamptz not null default now(),
  unique(user_id, clip_id)
);

create index if not exists clip_views_user on public.clip_views(user_id);

-- ── RPC functions para contadores atómicos ────────────────────────────────

create or replace function increment_clip_views(p_clip_id uuid)
returns void language sql security definer as $$
  update public.clips set view_count = view_count + 1 where id = p_clip_id;
$$;

create or replace function increment_clip_likes(p_clip_id uuid)
returns void language sql security definer as $$
  update public.clips set like_count = like_count + 1 where id = p_clip_id;
$$;

create or replace function decrement_clip_likes(p_clip_id uuid)
returns void language sql security definer as $$
  update public.clips set like_count = greatest(0, like_count - 1) where id = p_clip_id;
$$;

create or replace function increment_clip_comments(p_clip_id uuid)
returns void language sql security definer as $$
  update public.clips set comment_count = comment_count + 1 where id = p_clip_id;
$$;

-- ── is_admin en user_profiles ─────────────────────────────────────────────
-- Solo si la columna no existe aún:
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'user_profiles' and column_name = 'is_admin'
  ) then
    alter table public.user_profiles add column is_admin boolean not null default false;
  end if;
end$$;

-- ── RLS (Row Level Security) ──────────────────────────────────────────────
alter table public.clips         enable row level security;
alter table public.clip_likes    enable row level security;
alter table public.clip_saves    enable row level security;
alter table public.clip_comments enable row level security;
alter table public.clip_views    enable row level security;

-- Clips: cualquier auth user puede leer publicados
create policy "clips_select_published" on public.clips
  for select using (status = 'published');

-- Admins ven todos
create policy "clips_admin_all" on public.clips
  for all using (
    exists (select 1 from public.user_profiles where user_id = auth.uid() and is_admin = true)
  );

-- Likes/saves/comments/views: usuario ve los suyos
create policy "clip_likes_own"    on public.clip_likes    for all using (user_id = auth.uid());
create policy "clip_saves_own"    on public.clip_saves    for all using (user_id = auth.uid());
create policy "clip_views_own"    on public.clip_views    for all using (user_id = auth.uid());
create policy "clip_comments_select" on public.clip_comments for select using (is_deleted = false);
create policy "clip_comments_own"    on public.clip_comments for insert with check (user_id = auth.uid());
create policy "clip_comments_delete" on public.clip_comments for update using (user_id = auth.uid());

-- ── Datos de ejemplo (speakers permitidos) ────────────────────────────────
comment on column public.clips.speaker is
  'Speakers válidos: Warren Buffett, Charlie Munger, Ray Dalio, Benjamin Graham, '
  'Peter Lynch, Morgan Housel, Howard Marks, Seth Klarman, Bill Ackman, '
  'Grant Cardone, Robert Kiyosaki, Nassim Taleb, Michael Burry';
