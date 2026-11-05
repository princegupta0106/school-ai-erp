-- ================= EXAMS & REPORT CARDS (simple version) =================
-- Run once in the Supabase SQL editor (safe to re-run). Builds on subjects / assessments / assessment_marks.
-- Idea: every class has its own list of exams (PT1, PT2, Preboard ... / PT1, Half Yearly, PT2, Annual ...).
-- Teachers enter marks per exam + subject. The report card is built from those marks. No terms, no levels, no weightage.
--
-- If you ran the older terms / test types / levels version, nothing breaks: those tables are simply no longer used
-- (you can drop exam_terms, exam_test_types, exam_levels, exam_results later if you like).

-- the exams of a class
create table if not exists exam_structure (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  name text not null,
  max_marks numeric(6,2) not null default 100 check (max_marks > 0),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (class_id, name)
);
create index if not exists exam_structure_class_idx on exam_structure(school_id, class_id, sort);

-- marks of one exam + subject live in a normal assessment row (created automatically on first save)
alter table assessments add column if not exists exam_struct_id uuid references exam_structure(id) on delete cascade;
create unique index if not exists assessments_exam_struct_uniq on assessments(exam_struct_id, subject_id) where exam_struct_id is not null;
alter table assessment_marks add column if not exists remark text;

-- grading criteria (one scale for the whole school; built-in CBSE style scale is used until you save your own)
create table if not exists exam_grade_ranges (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  term_id uuid,
  min_pct numeric(5,2) not null,
  max_pct numeric(5,2) not null,
  grade text not null,
  grade_point numeric(4,1) not null default 0,
  remark text,
  is_fail boolean not null default false,
  sort int not null default 0
);
create index if not exists exam_grade_ranges_idx on exam_grade_ranges(school_id, term_id);

-- published report cards: a frozen copy per student per class
create table if not exists report_cards (
  student_id uuid not null references users(user_id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  snapshot jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid references users(user_id) on delete set null,
  primary key (student_id, class_id)
);
create index if not exists report_cards_school_idx on report_cards(school_id, class_id);

alter table exam_structure    enable row level security;
alter table exam_grade_ranges enable row level security;
alter table report_cards      enable row level security;
