-- 109 — Arthur proactivo + importación automática (Diego, 2026-09-29).
--
-- arthur_proactive_threads: conversations ARTHUR starts (from an alert,
-- an imported trade, a weekly review…). The opening message itself lives in
-- chat_history like any other message (same session_id), so it syncs to web
-- and mobile through the normal history/poll path; this table only tracks
-- which thread is new, its suggested actions, and when the user opened it.
create table if not exists public.arthur_proactive_threads (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null,
    session_id  text not null,
    category    text not null,
    title       text,
    message     text not null,
    actions     jsonb,
    created_at  timestamptz not null default now(),
    opened_at   timestamptz
);
create index if not exists idx_apt_user_created on public.arthur_proactive_threads (user_id, created_at desc);
alter table public.arthur_proactive_threads enable row level security;
drop policy if exists "apt_select_own" on public.arthur_proactive_threads;
create policy "apt_select_own" on public.arthur_proactive_threads for select using (auth.uid()::text = user_id);

-- inbound_email_aliases: each user's private forwarding address
-- (<alias>@<INBOUND_EMAIL_DOMAIN>) — brokers without an API (GBM,
-- Actinver…) email trade confirmations/statements; the user sets a mail
-- rule to forward them here once, and Nuvos updates the portfolio.
create table if not exists public.inbound_email_aliases (
    user_id    text primary key,
    alias      text not null unique,
    created_at timestamptz not null default now()
);
alter table public.inbound_email_aliases enable row level security;
drop policy if exists "iea_select_own" on public.inbound_email_aliases;
create policy "iea_select_own" on public.inbound_email_aliases for select using (auth.uid()::text = user_id);

-- inbound_imports: one row per received email / shared file, with what
-- was extracted and whether the user applied it.
create table if not exists public.inbound_imports (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null,
    source       text not null default 'email',   -- email | share
    sender       text,
    subject      text,
    kind         text,                            -- trades | statement | unknown
    payload      jsonb,                           -- {trades:[...], positions:[...], broker}
    status       text not null default 'parsed',  -- parsed | applied | dismissed | failed | nothing
    error        text,
    dedup_key    text,
    created_at   timestamptz not null default now(),
    applied_at   timestamptz
);
create index if not exists idx_inbound_imports_user on public.inbound_imports (user_id, created_at desc);
create unique index if not exists idx_inbound_imports_dedup on public.inbound_imports (user_id, dedup_key) where dedup_key is not null;
alter table public.inbound_imports enable row level security;
drop policy if exists "ii_select_own" on public.inbound_imports;
create policy "ii_select_own" on public.inbound_imports for select using (auth.uid()::text = user_id);
