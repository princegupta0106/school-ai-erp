-- ================= CLASS SUBJECTS =================
-- Which subjects each class studies (Class 10 A: Maths, Physics, English ...).
-- Teachers are then linked to a class + subject combo (tt_assignments), which feeds the timetable, tests and reports.
-- Safe to re-run.
create table if not exists class_subjects (
  school_id uuid not null references schools(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, subject_id)
);
create index if not exists class_subjects_school_idx on class_subjects(school_id, class_id);
alter table class_subjects enable row level security;

-- one-time fill from what the school already has: existing teacher combos and existing tests/exam papers
do $$
begin
  if to_regclass('public.tt_assignments') is not null then
    insert into class_subjects (school_id, class_id, subject_id)
      select distinct school_id, class_id, subject_id from tt_assignments
      on conflict do nothing;
  end if;
  if to_regclass('public.assessments') is not null then
    insert into class_subjects (school_id, class_id, subject_id)
      select distinct school_id, class_id, subject_id from assessments
      on conflict do nothing;
  end if;
end $$;
