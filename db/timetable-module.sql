-- ================= TIMETABLE & TEACHER WORKLOAD MODULE =================
-- Safe to re-run. Pushed automatically like every file in db/.
--   tt_settings     : working days + a teacher's weekly period limit
--   tt_periods      : the school-day framework (Period 1, Period 2, Break ...)
--   tt_assignments  : set in the TEACHER PROFILE: this teacher teaches this subject in this class (periods per week)
--   tt_slots        : the timetable itself (class + day + period -> subject + teacher). A teacher can never be in two classes at once.
--   tt_substitutions: a cover teacher for one class period on one date
create table if not exists tt_settings (
  school_id uuid primary key references schools(id) on delete cascade,
  days int[] not null default '{1,2,3,4,5,6}',          -- 1 = Monday ... 7 = Sunday
  max_load int not null default 30 check (max_load between 1 and 80),
  updated_at timestamptz not null default now()
);

create table if not exists tt_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  no int not null,
  name text not null,
  start_time time not null,
  end_time time not null,
  is_break boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tt_periods_school_idx on tt_periods(school_id, no);

create table if not exists tt_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  teacher_id uuid not null references users(user_id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  periods_per_week int not null default 5 check (periods_per_week between 1 and 40),
  created_at timestamptz not null default now(),
  unique (teacher_id, class_id, subject_id)
);
create index if not exists tt_assign_school_idx on tt_assignments(school_id, class_id);

create table if not exists tt_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  day int not null check (day between 1 and 7),
  period_id uuid not null references tt_periods(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  teacher_id uuid not null references users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, day, period_id),
  unique (teacher_id, day, period_id)
);
create index if not exists tt_slots_school_idx on tt_slots(school_id, class_id);

create table if not exists tt_substitutions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  sub_date date not null,
  class_id uuid not null references classes(id) on delete cascade,
  period_id uuid not null references tt_periods(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  absent_teacher_id uuid references users(user_id) on delete set null,
  substitute_teacher_id uuid not null references users(user_id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (class_id, sub_date, period_id)
);
create index if not exists tt_sub_school_idx on tt_substitutions(school_id, sub_date);
create index if not exists tt_sub_teacher_idx on tt_substitutions(substitute_teacher_id, sub_date);

alter table tt_settings      enable row level security;
alter table tt_periods       enable row level security;
alter table tt_assignments   enable row level security;
alter table tt_slots         enable row level security;
alter table tt_substitutions enable row level security;
