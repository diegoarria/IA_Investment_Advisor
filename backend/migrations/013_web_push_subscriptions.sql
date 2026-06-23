-- Web Push subscriptions — stores browser push subscription objects per user.
-- One user can have multiple subscriptions (different browsers/devices).
-- The endpoint is unique (browser-issued, stable per device+browser).

create table if not exists web_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  subscription jsonb not null,   -- {endpoint, keys: {p256dh, auth}}
  created_at   timestamptz not null default now()
);

create index if not exists web_push_subscriptions_user_idx
  on web_push_subscriptions(user_id);
