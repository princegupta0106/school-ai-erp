-- ================= ADMISSIONS MODULE =================
-- Run once in the Supabase SQL editor (safe to re-run). Does not touch the older "queries" tables.
-- admission_enquiries : one row per child/family from first enquiry to admission (or rejection)
-- admission_activity  : the history of every call, visit, note and stage change
create table if not exists admission_enquiries (
  id uuid primary key default gen_random_uuid(),
  ref_no bigint generated always as identity,
  school_id uuid not null references schools(id) on delete cascade,
  student_name text not null,
  class_id uuid references classes(id) on delete set null,
  gender text,
  dob date,
  parent_name text,
  phone text,
  email text,
  address text,
  locality text,
  source text not null default 'walk_in' check (source in ('online','walk_in','qr','referral','phone','campaign','other')),
  stage text not null default 'new' check (stage in ('new','contacted','follow_up','pending_documents','shortlisted','admitted','rejected')),
  reached smallint not null default 0,            -- furthest step reached (0 enquiry, 1 contacted, 2 application, 3 shortlisted, 4 admitted) for the funnel
  assigned_to uuid references users(user_id) on delete set null,
  session_name text,
  notes text,
  missing_docs text,
  next_followup_on date,
  lost_reason text,
  student_user_id uuid references users(user_id) on delete set null,
  admitted_at timestamptz,
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists adm_enq_school_idx on admission_enquiries(school_id, created_at desc);
create index if not exists adm_enq_stage_idx on admission_enquiries(school_id, stage);
create index if not exists adm_enq_due_idx on admission_enquiries(school_id, next_followup_on);

create table if not exists admission_activity (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references admission_enquiries(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  kind text not null check (kind in ('created','call','whatsapp','email','visit','note','stage','admitted')),
  note text,
  stage text,
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists adm_act_enq_idx on admission_activity(enquiry_id, created_at desc);

alter table admission_enquiries enable row level security;
alter table admission_activity enable row level security;
