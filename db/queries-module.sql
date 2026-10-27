-- ================= QUERIES MODULE =================
-- Run this once in the Supabase SQL editor (it is also safe to re-run).
-- query_types    : the "forms" (Admission enquiry, General query, Internal ...). `fields` = extra questions of that form.
-- query_statuses : the statuses a school uses (Pending, In progress, Done ... or any custom one). is_closed = counts as finished.
-- queries        : one entry per enquiry. `data` holds the answers to the form's extra questions.
-- query_notes    : history of every status change / note on an entry.
create table if not exists query_types (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  audience text not null default 'external' check (audience in ('external','internal')),
  fields jsonb not null default '[]'::jsonb,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);
create table if not exists query_statuses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  color text not null default 'info' check (color in ('ok','off','warn','info','mute')),
  is_closed boolean not null default false,
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);
create table if not exists queries (
  id uuid primary key default gen_random_uuid(),
  ref_no bigint generated always as identity,
  school_id uuid not null references schools(id) on delete cascade,
  type_id uuid references query_types(id) on delete set null,
  type_name text not null,
  status_id uuid references query_statuses(id) on delete set null,
  name text not null,
  phone text,
  subject text,
  details text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references users(user_id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists queries_school_idx on queries(school_id, created_at desc);
create index if not exists queries_status_idx on queries(school_id, status_id);
create table if not exists query_notes (
  id uuid primary key default gen_random_uuid(),
  query_id uuid not null references queries(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  note text,
  status_name text,
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists query_notes_query_idx on query_notes(query_id, created_at);
alter table query_types enable row level security;
alter table query_statuses enable row level security;
alter table queries enable row level security;
alter table query_notes enable row level security;
