-- ================= PUSH NOTIFICATIONS =================
-- Run this once in the Supabase SQL editor (it is also appended to schema.sql).

-- one row per phone that has the app and allowed notifications (a person can have several phones)
create table if not exists push_tokens (
  token       text primary key,                         -- ExponentPushToken[...]
  user_id     uuid not null references users(user_id) on delete cascade,
  platform    text,
  device_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on push_tokens(user_id);

-- the in-app inbox: every notification sent to a person (also kept when the phone is offline / push is off)
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid references schools(id) on delete cascade,
  user_id     uuid not null references users(user_id) on delete cascade,
  kind        text not null default 'general',          -- general, notice, message, homework, marks, fees, document, leave
  title       text not null,
  body        text,
  module      text,                                     -- where a tap goes (e.g. homework)
  view        text,                                     -- ... and which tab (e.g. my)
  dedupe_key  text,                                     -- stops the same event notifying twice within a few hours
  created_by  uuid references users(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_user_idx   on notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx on notifications(user_id) where read_at is null;
create index if not exists notifications_dedupe_idx on notifications(user_id, dedupe_key, created_at desc) where dedupe_key is not null;
alter table push_tokens    enable row level security;
alter table notifications  enable row level security;
