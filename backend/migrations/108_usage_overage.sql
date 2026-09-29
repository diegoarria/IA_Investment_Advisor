-- 108 — Uso extra (usage-based overage billing), Diego 2026-09-29.
--
-- One row per user per calendar month. Premium includes up to
-- settings.premium_price_usd * guard_protection_pct ($9) of real LLM cost;
-- past that the user either opts in to "uso extra" (billed in $4.99 USD /
-- $89 MXN blocks, one block per $2.50 of extra cost, capped at cap_blocks)
-- or keeps using Arthur on the cheaper model until the month resets.
--
-- blocks_billed / invoiced_at are written by worker.py's monthly billing
-- job so a month is never charged twice.

create table if not exists public.usage_overage (
    user_id        uuid        not null,
    period         text        not null,              -- 'YYYY-MM' (UTC)
    opted_in       boolean     not null default false,
    declined       boolean     not null default false,
    cap_blocks     integer     not null default 4 check (cap_blocks between 1 and 20),
    notified_level integer     not null default 0,    -- highest usage alert sent: 0/70/90/100
    blocks_billed  integer     not null default 0,
    invoiced_at    timestamptz,
    stripe_invoice_id text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    primary key (user_id, period)
);

alter table public.usage_overage enable row level security;

-- Users can read their own rows; all writes go through the backend
-- (service role), which bypasses RLS.
drop policy if exists "usage_overage_select_own" on public.usage_overage;
create policy "usage_overage_select_own" on public.usage_overage
    for select using (auth.uid() = user_id);

-- Speeds up llm_usage_log per-user monthly sums used by the usage meter.
create index if not exists idx_llm_usage_log_user_created
    on public.llm_usage_log (user_id, created_at);
