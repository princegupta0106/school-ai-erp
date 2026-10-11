-- School portal database. Run in Supabase -> SQL Editor. Safe to re-run any time (it only adds what is missing).
create extension if not exists pgcrypto;

create table if not exists schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  address text, phone text, email text, logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- level = order of the class (1,2,3...). Promotion moves students from level n to n+1.
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  section text not null default '',
  created_at timestamptz not null default now(),
  unique (school_id, name, section)
);
alter table classes add column if not exists level int;

create table if not exists users (
  user_id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id) on delete cascade,
  login_id text not null unique,
  password_hash text not null,
  role text not null check (role in ('super_admin','school_admin','parent','staff','student','other')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_school_rule check (
    (role = 'super_admin' and school_id is null) or (role <> 'super_admin' and school_id is not null))
);
create index if not exists users_school_idx on users(school_id);
create index if not exists users_role_idx on users(school_id, role);

create table if not exists profiles (
  user_id uuid primary key references users(user_id) on delete cascade,
  school_id uuid references schools(id) on delete cascade,
  full_name text, phone text, email text, dob date, gender text, address text,
  admission_no text,
  class_id uuid references classes(id) on delete set null,
  father_name text, mother_name text,
  father_phone text, mother_phone text,
  father_occupation text, mother_occupation text,
  documents jsonb not null default '[]'::jsonb,         -- [{id,label,name,url,key,size,type,uploaded_at}]
  features_permission text[] not null default '{}',     -- e.g. {create_user,get_user}
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- added later (all optional)
alter table profiles add column if not exists roll_no int;   -- 1-100, unique per class (see attendance block below)
alter table profiles add column if not exists blood_group text;
alter table profiles add column if not exists emergency_contact_name text;
alter table profiles add column if not exists emergency_contact_phone text;
alter table profiles add column if not exists employee_id text;       -- staff / teachers
alter table profiles add column if not exists designation text;       -- e.g. Maths Teacher, Clerk, Driver
alter table profiles add column if not exists department text;
alter table profiles add column if not exists qualification text;
alter table profiles add column if not exists joining_date date;
alter table profiles add column if not exists salary numeric(12,2);   -- only visible with manage_salary
create index if not exists profiles_school_idx on profiles(school_id);
create index if not exists profiles_class_idx on profiles(class_id);

-- "parent of": one parent can have many students, one student can have many parents
create table if not exists parent_students (
  parent_id uuid not null references users(user_id) on delete cascade,
  student_id uuid not null references users(user_id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);
create index if not exists parent_students_student_idx on parent_students(student_id);
create index if not exists parent_students_school_idx on parent_students(school_id);

-- academic sessions, e.g. 2026-2027. Exactly one is current per school.
create table if not exists academic_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);
create unique index if not exists sessions_one_current on academic_sessions(school_id) where is_current;

-- holidays, vacations, school events (leave / attendance / fees modules will read this)
create table if not exists holidays (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  session_id uuid references academic_sessions(id) on delete set null,
  title text not null,
  start_date date not null,
  end_date date not null,
  type text not null default 'holiday' check (type in ('holiday','vacation','event','exam')),
  description text,
  created_at timestamptz not null default now()
);
create index if not exists holidays_school_date_idx on holidays(school_id, start_date);

-- End-of-year promotion in ONE transaction.
--   p_dry = true  -> only returns what would happen (preview)
--   p_dry = false -> moves every active student up one class level, marks the last class as graduated
--                    (and switches their account off if p_final = 'deactivate'),
--                    closes the current session and opens p_new_session.
create or replace function promote_students(
  p_school uuid, p_final text default 'deactivate', p_dry boolean default true, p_new_session jsonb default null)
returns jsonb language plpgsql as $$
declare cur record; plan jsonb; moving int; grads int; unplaced int;
begin
  select * into cur from academic_sessions where school_id = p_school and is_current limit 1;
  if cur.id is null then raise exception 'Create a current session first'; end if;
  if cur.promoted_at is not null then raise exception 'Session % was already promoted', cur.name; end if;

  create temp table _s on commit drop as
  select p.user_id, c.level, c.name as from_name, c.section as from_section,
    (select c2.id from classes c2
      where c2.school_id = p_school and c2.level = c.level + 1
      order by (c2.section = c.section) desc, c2.section limit 1) as to_id
  from profiles p
  join users u on u.user_id = p.user_id
  join classes c on c.id = p.class_id
  where u.school_id = p_school and u.role = 'student' and u.is_active
    and c.level is not null and coalesce(p.extra->>'graduated', '') <> 'true';

  select coalesce(jsonb_agg(x order by x.level, x.from_section), '[]'::jsonb) into plan from (
    select s.level, s.from_name, s.from_section, tc.name as to_name, tc.section as to_section, count(*)::int as students
    from _s s left join classes tc on tc.id = s.to_id
    group by s.level, s.from_name, s.from_section, tc.name, tc.section) x;

  select count(*) filter (where to_id is not null), count(*) filter (where to_id is null)
    into moving, grads from _s;

  select count(*) into unplaced
  from profiles p join users u on u.user_id = p.user_id left join classes c on c.id = p.class_id
  where u.school_id = p_school and u.role = 'student' and u.is_active
    and (p.class_id is null or c.level is null) and coalesce(p.extra->>'graduated', '') <> 'true';

  if not p_dry then
    if p_new_session is null or coalesce(p_new_session->>'name', '') = '' then
      raise exception 'New session details are required';
    end if;
    update profiles p set extra = p.extra || '{"graduated": true}'::jsonb, updated_at = now()
      from _s where _s.user_id = p.user_id and _s.to_id is null;
    if p_final = 'deactivate' then
      update users u set is_active = false, updated_at = now()
        from _s where _s.user_id = u.user_id and _s.to_id is null;
    end if;
    -- fees: remember which class each student was in for the closing session (so unpaid fees of this session stay visible)
    insert into student_fee_accounts (school_id, student_id, session_id, class_id, class_name)
      select p_school, s.user_id, cur.id, p.class_id, s.from_name from _s s join profiles p on p.user_id = s.user_id
      on conflict (student_id, session_id) do nothing;
    -- roll numbers are per class: clear them so they never clash in the new class (re-assign in Attendance > Roll numbers)
    update profiles p set roll_no = null, updated_at = now() from _s where _s.user_id = p.user_id;
    update profiles p set class_id = _s.to_id, updated_at = now()
      from _s where _s.user_id = p.user_id and _s.to_id is not null;
    update academic_sessions set is_current = false, promoted_at = now() where id = cur.id;
    insert into academic_sessions (school_id, name, start_date, end_date, is_current)
      values (p_school, p_new_session->>'name', (p_new_session->>'start_date')::date, (p_new_session->>'end_date')::date, true);
  end if;

  return jsonb_build_object('dry_run', p_dry, 'session', cur.name, 'plan', plan,
    'moving', moving, 'graduating', grads, 'unplaced', unplaced);
end $$;
revoke execute on function promote_students(uuid, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function promote_students(uuid, text, boolean, jsonb) to service_role;

-- ================= ATTENDANCE MODULE =================
-- Roll no. becomes a whole number 1-100, unique inside a class (1 in class 1A and 1 in class 1B is fine).
-- Old free-text values are converted when they are a valid number; invalid/duplicate ones are cleared (assign again in Attendance > Roll numbers).
do $$ begin
  if (select data_type from information_schema.columns where table_name = 'profiles' and column_name = 'roll_no') = 'text' then
    alter table profiles alter column roll_no type int
      using (case when roll_no ~ '^\s*\d{1,3}\s*$' and trim(roll_no)::int between 1 and 100 then trim(roll_no)::int end);
  end if;
end $$;
-- clear duplicates left over from old data (keep the first one in each class)
update profiles p set roll_no = null
  from (select user_id, row_number() over (partition by class_id, roll_no order by created_at, user_id) rn
        from profiles where class_id is not null and roll_no is not null) d
  where d.user_id = p.user_id and d.rn > 1;
update profiles set roll_no = null where roll_no is not null and class_id is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_roll_no_range') then
    alter table profiles add constraint profiles_roll_no_range check (roll_no is null or roll_no between 1 and 100);
  end if;
end $$;
create unique index if not exists profiles_class_roll_uniq on profiles(class_id, roll_no) where class_id is not null and roll_no is not null;

-- which teachers take which class
create table if not exists class_teachers (
  class_id uuid not null references classes(id) on delete cascade,
  teacher_id uuid not null references users(user_id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  is_class_teacher boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (class_id, teacher_id)
);
create index if not exists class_teachers_teacher_idx on class_teachers(teacher_id);
create index if not exists class_teachers_school_idx on class_teachers(school_id);

-- one row per student per day. roll_no / class_id are a snapshot of that day (they change after promotion).
create table if not exists student_attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  class_id uuid references classes(id) on delete set null,
  student_id uuid not null references users(user_id) on delete cascade,
  session_id uuid references academic_sessions(id) on delete set null,
  date date not null,
  status text not null check (status in ('present','absent','late','leave')),
  roll_no int,
  marked_by uuid references users(user_id) on delete set null,
  updated_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, date)
);
create index if not exists attendance_class_date_idx on student_attendance(school_id, class_id, date);
create index if not exists attendance_date_idx on student_attendance(school_id, date);

-- Set / swap / clear roll numbers of one class in ONE transaction (so swapping 3 and 5 never clashes).
-- p_items = [{"student_id": "...", "roll_no": 7 | null}, ...]
create or replace function set_roll_numbers(p_school uuid, p_class uuid, p_items jsonb)
returns int language plpgsql as $$
declare n int;
begin
  if not exists (select 1 from classes where id = p_class and school_id = p_school) then
    raise exception 'Class not found';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(student_id uuid, roll_no int)
             where x.roll_no is not null and (x.roll_no < 1 or x.roll_no > 100)) then
    raise exception 'Roll numbers must be between 1 and 100';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(student_id uuid, roll_no int)
             where x.roll_no is not null group by x.roll_no having count(*) > 1) then
    raise exception 'Two students have the same roll number';
  end if;
  -- only students of this class and school may be touched
  if exists (select 1 from jsonb_to_recordset(p_items) as x(student_id uuid, roll_no int)
             where not exists (select 1 from profiles p join users u on u.user_id = p.user_id
                               where p.user_id = x.student_id and p.class_id = p_class and u.school_id = p_school and u.role = 'student')) then
    raise exception 'A listed student is not in this class';
  end if;
  update profiles set roll_no = null where user_id in (select x.student_id from jsonb_to_recordset(p_items) as x(student_id uuid, roll_no int));
  update profiles p set roll_no = x.roll_no, updated_at = now()
    from jsonb_to_recordset(p_items) as x(student_id uuid, roll_no int)
    where p.user_id = x.student_id and x.roll_no is not null;
  get diagnostics n = row_count;
  return n;
exception when unique_violation then
  raise exception 'That roll number is already used by another student in this class';
end $$;
revoke execute on function set_roll_numbers(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function set_roll_numbers(uuid, uuid, jsonb) to service_role;

alter table class_teachers      enable row level security;
alter table student_attendance  enable row level security;

-- ================= VISITORS MODULE =================
-- visit_date / visit_time are the school's local date and time (what the person typed or the current time)
create table if not exists visitors (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  purpose text,
  visit_date date not null,
  visit_time time not null,
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists visitors_school_date_idx on visitors(school_id, visit_date, visit_time);
alter table visitors enable row level security;

-- ================= COMMUNICATION MODULE =================
-- notice board: audience 'school' (everyone in the school) or 'class' (students, parents and teachers of the chosen classes)
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  title text not null,
  body text not null,
  audience text not null check (audience in ('school','class')),
  is_pinned boolean not null default false,
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_school_idx on announcements(school_id, created_at desc);
create table if not exists announcement_classes (
  announcement_id uuid not null references announcements(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  primary key (announcement_id, class_id)
);
create index if not exists announcement_classes_class_idx on announcement_classes(class_id);

-- notices a person may see. p_all = true for people who see every notice (admins / all-class access).
-- p_pinned = true -> pinned notices only; false -> the rest, newest first, older than p_before.
create or replace function list_announcements(
  p_school uuid, p_user uuid, p_class_ids uuid[], p_all boolean, p_pinned boolean, p_before timestamptz, p_limit int)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (
    select a.id, a.title, a.body, a.audience, a.is_pinned, a.created_by, a.created_at, a.updated_at,
      coalesce(p.full_name, u.login_id) as author,
      coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'section', c.section) order by c.name, c.section)
                from announcement_classes ac join classes c on c.id = ac.class_id where ac.announcement_id = a.id), '[]'::jsonb) as classes
    from announcements a
    left join users u on u.user_id = a.created_by
    left join profiles p on p.user_id = a.created_by
    where a.school_id = p_school and a.is_pinned = p_pinned
      and (p_pinned or p_before is null or a.created_at < p_before)
      and (p_all or a.audience = 'school' or a.created_by = p_user
           or exists (select 1 from announcement_classes ac where ac.announcement_id = a.id and ac.class_id = any(coalesce(p_class_ids, '{}'::uuid[]))))
    order by a.created_at desc
    limit p_limit
  ) x
$$;
revoke execute on function list_announcements(uuid, uuid, uuid[], boolean, boolean, timestamptz, int) from public, anon, authenticated;
grant execute on function list_announcements(uuid, uuid, uuid[], boolean, boolean, timestamptz, int) to service_role;

-- 1-to-1 chats. One row per pair of people (user_a < user_b), each side has its own unread counter.
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_a uuid not null references users(user_id) on delete cascade,
  user_b uuid not null references users(user_id) on delete cascade,
  a_unread int not null default 0,
  b_unread int not null default 0,
  last_message_at timestamptz,
  last_preview text,
  last_sender uuid,
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists conversations_a_idx on conversations(user_a, last_message_at desc);
create index if not exists conversations_b_idx on conversations(user_b, last_message_at desc);
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references users(user_id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on messages(conversation_id, created_at desc);

create or replace function send_message(p_conv uuid, p_sender uuid, p_body text)
returns jsonb language plpgsql as $$
declare c conversations; m messages;
begin
  select * into c from conversations where id = p_conv for update;
  if c.id is null or p_sender not in (c.user_a, c.user_b) then raise exception 'Conversation not found'; end if;
  insert into messages (conversation_id, sender_id, body) values (p_conv, p_sender, p_body) returning * into m;
  update conversations set last_message_at = m.created_at, last_preview = left(p_body, 80), last_sender = p_sender,
    a_unread = a_unread + (case when user_b = p_sender then 1 else 0 end),
    b_unread = b_unread + (case when user_a = p_sender then 1 else 0 end)
  where id = p_conv;
  return to_jsonb(m);
end $$;
create or replace function mark_conversation_read(p_conv uuid, p_user uuid)
returns void language sql as $$
  update conversations set a_unread = 0 where id = p_conv and user_a = p_user and a_unread > 0;
  update conversations set b_unread = 0 where id = p_conv and user_b = p_user and b_unread > 0;
$$;
revoke execute on function send_message(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function mark_conversation_read(uuid, uuid) from public, anon, authenticated;
grant execute on function send_message(uuid, uuid, text) to service_role;
grant execute on function mark_conversation_read(uuid, uuid) to service_role;

alter table announcements        enable row level security;
alter table announcement_classes enable row level security;
alter table conversations        enable row level security;
alter table messages             enable row level security;

-- ================= FEES MODULE =================
-- Fee structure: what each class pays in a session. Applies to every section of that class name (1 A, 1 B ...).
-- amount = the TOTAL for the session. frequency decides how it is split into instalments:
--   one_time = 1 instalment due on the session start date, half_yearly = 2, quarterly = 4, monthly = 12 (spaced from the session start date).
create table if not exists fee_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  session_id uuid not null references academic_sessions(id) on delete cascade,
  class_name text not null,
  name text not null,
  amount numeric(12,2) not null check (amount > 0),
  frequency text not null check (frequency in ('one_time','half_yearly','quarterly','monthly')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fee_items_unique on fee_items(session_id, class_name, lower(name));
create index if not exists fee_items_school_idx on fee_items(school_id, session_id);

-- one row per student per session: remembers the class the student was in (so the right fee structure applies, even after promotion)
create table if not exists student_fee_accounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references users(user_id) on delete cascade,
  session_id uuid not null references academic_sessions(id) on delete cascade,
  class_id uuid references classes(id) on delete set null,
  class_name text,
  created_at timestamptz not null default now(),
  unique (student_id, session_id)
);
create index if not exists fee_accounts_school_idx on student_fee_accounts(school_id, session_id);

-- admin-only changes to ONE student's fees. amount is signed: negative = discount / concession, positive = extra charge.
-- item_id = the fee it applies to (spread over its instalments); null = general (applies from applied_on).
-- Rows are never deleted: a wrong one is voided and stays in the history.
create table if not exists fee_adjustments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  account_id uuid not null references student_fee_accounts(id) on delete cascade,
  student_id uuid not null references users(user_id) on delete cascade,
  session_id uuid not null references academic_sessions(id) on delete cascade,
  item_id uuid references fee_items(id) on delete set null,
  item_name text,
  amount numeric(12,2) not null check (amount <> 0),
  reason text not null,
  applied_on date not null,
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references users(user_id) on delete set null,
  void_reason text
);
create index if not exists fee_adjustments_account_idx on fee_adjustments(account_id);

-- every rupee received. Receipts never change: class, allocation and balance are stored as they were that day.
create table if not exists fee_counters (
  school_id uuid primary key references schools(id) on delete cascade,
  last_receipt int not null default 0
);
create table if not exists fee_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  account_id uuid not null references student_fee_accounts(id) on delete cascade,
  student_id uuid not null references users(user_id) on delete cascade,
  session_id uuid not null references academic_sessions(id) on delete cascade,
  receipt_seq int not null,
  receipt_no text not null,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null,
  mode text not null check (mode in ('cash','upi','cheque','bank_transfer','card','other')),
  reference text,
  note text,
  class_label text,
  allocation jsonb not null default '[]'::jsonb,   -- [{label, amount}] what this payment went towards
  balance_after numeric(12,2),
  received_by uuid references users(user_id) on delete set null,
  status text not null default 'received' check (status in ('received','cancelled')),
  cancelled_by uuid references users(user_id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  unique (school_id, receipt_seq)
);
create index if not exists fee_payments_account_idx on fee_payments(account_id, paid_on, created_at);
create index if not exists fee_payments_student_idx on fee_payments(student_id);

-- Record a payment in ONE transaction: locks the student's account (two clerks can't overpay at the same time),
-- refuses more than the total payable (p_cap), and hands out the next receipt number of the school.
create or replace function record_fee_payment(
  p_school uuid, p_account uuid, p_amount numeric, p_cap numeric, p_mode text, p_reference text, p_note text,
  p_paid_on date, p_by uuid, p_class_label text, p_allocation jsonb)
returns jsonb language plpgsql as $$
declare a student_fee_accounts; paid numeric; seq int; pay fee_payments;
begin
  select * into a from student_fee_accounts where id = p_account and school_id = p_school for update;
  if a.id is null then raise exception 'Fee record not found'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero'; end if;
  select coalesce(sum(amount), 0) into paid from fee_payments where account_id = p_account and status = 'received';
  if paid + p_amount > p_cap then
    raise exception 'That is more than the pending balance (Rs. %)', to_char(greatest(p_cap - paid, 0), 'FM999999990.00');
  end if;
  insert into fee_counters (school_id, last_receipt) values (p_school, 1)
    on conflict (school_id) do update set last_receipt = fee_counters.last_receipt + 1
    returning last_receipt into seq;
  insert into fee_payments (school_id, account_id, student_id, session_id, receipt_seq, receipt_no, amount, paid_on, mode,
      reference, note, class_label, allocation, balance_after, received_by)
    values (p_school, p_account, a.student_id, a.session_id, seq, 'RCP-' || lpad(seq::text, 6, '0'), p_amount, p_paid_on, p_mode,
      nullif(trim(p_reference), ''), nullif(trim(p_note), ''), p_class_label, coalesce(p_allocation, '[]'::jsonb),
      p_cap - paid - p_amount, p_by)
    returning * into pay;
  return to_jsonb(pay);
end $$;
revoke execute on function record_fee_payment(uuid, uuid, numeric, numeric, text, text, text, date, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function record_fee_payment(uuid, uuid, numeric, numeric, text, text, text, date, uuid, text, jsonb) to service_role;

alter table fee_items             enable row level security;
alter table student_fee_accounts  enable row level security;
alter table fee_adjustments       enable row level security;
alter table fee_counters          enable row level security;
alter table fee_payments          enable row level security;

-- ================= ACADEMICS MODULE =================
-- subjects of a school (Maths, English...)
create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  code text,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

-- an exam = a named event of a session (Half-yearly, Final...). Its papers are rows of `assessments` with kind = 'exam'.
create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  session_id uuid references academic_sessions(id) on delete set null,
  name text not null,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  unique (school_id, session_id, name)
);
create index if not exists exams_school_idx on exams(school_id, session_id);

-- one test (kind 'test') or one exam paper (kind 'exam', belongs to an exam) for ONE class and ONE subject.
-- Nothing is taken on the platform: teachers only log the marks.
create table if not exists assessments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  session_id uuid references academic_sessions(id) on delete set null,
  kind text not null check (kind in ('test','exam')),
  exam_id uuid references exams(id) on delete cascade,
  class_id uuid references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete restrict,
  title text not null,
  test_date date not null,
  max_marks numeric(6,2) not null check (max_marks > 0),
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'exam') = (exam_id is not null))
);
create index if not exists assessments_class_idx on assessments(school_id, class_id, session_id, test_date desc);
create index if not exists assessments_subject_idx on assessments(subject_id);
create unique index if not exists assessments_exam_paper_uniq on assessments(exam_id, class_id, subject_id) where kind = 'exam';

-- one row per student per assessment. marks null + is_absent = was absent. No row = not entered yet.
create table if not exists assessment_marks (
  assessment_id uuid not null references assessments(id) on delete cascade,
  student_id uuid not null references users(user_id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  marks numeric(6,2) check (marks >= 0),
  is_absent boolean not null default false,
  entered_by uuid references users(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (assessment_id, student_id),
  check (not is_absent or marks is null),
  check (is_absent or marks is not null)
);
create index if not exists assessment_marks_student_idx on assessment_marks(student_id);

-- Save marks of one assessment in ONE transaction.
-- p_items = [{"student_id": "...", "marks": 17.5 | null, "absent": true | false}, ...]
-- marks null and absent false = clear the entry. Returns how many rows were saved or cleared.
create or replace function save_marks(p_school uuid, p_assessment uuid, p_user uuid, p_items jsonb)
returns int language plpgsql as $$
declare a assessments; n int := 0;
begin
  select * into a from assessments where id = p_assessment and school_id = p_school;
  if a.id is null then raise exception 'Test not found'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(student_id uuid, marks numeric, absent boolean)
             where x.marks is not null and (x.marks < 0 or x.marks > a.max_marks)) then
    raise exception 'Marks must be between 0 and %', a.max_marks;
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(student_id uuid, marks numeric, absent boolean)
             group by x.student_id having count(*) > 1) then
    raise exception 'A student is listed twice';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(student_id uuid, marks numeric, absent boolean)
             where not exists (select 1 from profiles p join users u on u.user_id = p.user_id
                               where p.user_id = x.student_id and p.class_id = a.class_id and u.school_id = p_school and u.role = 'student')) then
    raise exception 'A listed student is not in this class';
  end if;

  delete from assessment_marks m using jsonb_to_recordset(p_items) as x(student_id uuid, marks numeric, absent boolean)
    where m.assessment_id = p_assessment and m.student_id = x.student_id and x.marks is null and not coalesce(x.absent, false);
  get diagnostics n = row_count;

  insert into assessment_marks (assessment_id, student_id, school_id, marks, is_absent, entered_by, updated_at)
  select p_assessment, x.student_id, p_school, case when coalesce(x.absent, false) then null else x.marks end,
         coalesce(x.absent, false), p_user, now()
  from jsonb_to_recordset(p_items) as x(student_id uuid, marks numeric, absent boolean)
  where x.marks is not null or coalesce(x.absent, false)
  on conflict (assessment_id, student_id) do update
    set marks = excluded.marks, is_absent = excluded.is_absent, entered_by = excluded.entered_by, updated_at = now();
  n := n + (select count(*) from jsonb_to_recordset(p_items) as x(student_id uuid, marks numeric, absent boolean)
            where x.marks is not null or coalesce(x.absent, false));
  update assessments set updated_at = now() where id = p_assessment;
  return n;
end $$;
revoke execute on function save_marks(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function save_marks(uuid, uuid, uuid, jsonb) to service_role;

-- quick numbers per assessment (entered / absent / average / highest / lowest / passed). Pass mark = 33 %.
create or replace function assessment_stats(p_ids uuid[])
returns table (assessment_id uuid, entered int, absent int, avg_marks numeric, hi numeric, lo numeric, passed int)
language sql stable as $$
  select a.id,
    count(m.student_id)::int,
    (count(*) filter (where m.is_absent))::int,
    round(avg(m.marks), 2), max(m.marks), min(m.marks),
    (count(*) filter (where m.marks is not null and m.marks >= a.max_marks * 0.33))::int
  from assessments a left join assessment_marks m on m.assessment_id = a.id
  where a.id = any(p_ids)
  group by a.id
$$;
revoke execute on function assessment_stats(uuid[]) from public, anon, authenticated;
grant execute on function assessment_stats(uuid[]) to service_role;

alter table subjects          enable row level security;
alter table exams             enable row level security;
alter table assessments       enable row level security;
alter table assessment_marks  enable row level security;

-- Only the backend (secret key) touches the data. RLS on + no policies = the public key can read nothing.
alter table schools           enable row level security;
alter table classes           enable row level security;
alter table users             enable row level security;
alter table profiles          enable row level security;
alter table parent_students   enable row level security;
alter table academic_sessions enable row level security;
alter table holidays          enable row level security;

-- =====================================================================
-- PAYROLL & LEAVE module (safe to re-run)
-- Flow: leave application -> approval (auto or manual) -> leave ledger (balance)
--       -> monthly payslip (after the month ends) -> finalize (locks numbers, settles
--       negative balance against the salary cut) -> mark paid.
-- Everything below is written by the backend only (RLS on, no policies).
-- =====================================================================
create table if not exists payroll_settings (
  school_id uuid primary key references schools(id) on delete cascade,
  approval_mode text not null default 'manual' check (approval_mode in ('manual','auto')),
  weekly_off int[] not null default '{0}',                 -- 0 = Sunday ... 6 = Saturday
  rate_basis text not null default 'working_days' check (rate_basis in ('working_days','calendar_days','fixed_30')),
  updated_at timestamptz not null default now()
);

create table if not exists leave_types (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  is_paid boolean not null default true,                    -- false = loss-of-pay type: every day is cut from salary
  annual_quota numeric(5,1) not null default 0 check (annual_quota >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  leave_type_id uuid not null references leave_types(id),
  start_date date not null,
  end_date date not null,
  half_day boolean not null default false,
  days numeric(5,1) not null check (days > 0),
  days_detail jsonb not null default '[]'::jsonb,           -- frozen [{date, value}] of counted working days
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  auto_approved boolean not null default false,
  decided_by uuid references users(user_id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists leave_requests_school_status_idx on leave_requests(school_id, status, created_at desc);
create index if not exists leave_requests_user_idx on leave_requests(user_id, start_date);

-- Append-only balance book. balance = sum(days). Never edited: corrections are new rows.
create table if not exists leave_ledger (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  leave_type_id uuid not null references leave_types(id),
  entry_date date not null,
  days numeric(6,1) not null check (days <> 0),             -- + credit, - taken
  kind text not null check (kind in ('allotment','grant','adjustment','taken','reversal','settlement')),
  leave_id uuid references leave_requests(id) on delete set null,
  payslip_id uuid,
  period_key text,
  note text,
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists leave_ledger_user_idx on leave_ledger(user_id, leave_type_id, entry_date);
-- one allotment per person / type / period (stops double allotting)
create unique index if not exists leave_ledger_allot_once on leave_ledger(user_id, leave_type_id, period_key) where kind = 'allotment';
-- a request can be "taken" / "reversed" for a month only once
drop index if exists leave_ledger_taken_once;
create unique index if not exists leave_ledger_taken_once on leave_ledger(leave_id, leave_type_id, entry_date, kind) where kind in ('taken','reversal');

create table if not exists payslips (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  period date not null,                                     -- first day of the month being paid
  status text not null default 'draft' check (status in ('draft','finalized','paid')),
  base_salary numeric(12,2) not null default 0,
  rate_per_day numeric(12,2) not null default 0,
  unpaid_days numeric(6,1) not null default 0,
  leave_deduction numeric(12,2) not null default 0,
  bonus_total numeric(12,2) not null default 0,
  other_deduction_total numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  breakdown jsonb not null default '{}'::jsonb,             -- human-readable "why this amount"
  finalized_by uuid references users(user_id) on delete set null,
  finalized_at timestamptz,
  paid_by uuid references users(user_id) on delete set null,
  paid_at timestamptz,
  payment_date date,
  payment_method text,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, period)
);
create index if not exists payslips_school_period_idx on payslips(school_id, period desc);

-- one-off bonuses / deductions for a month. Picked up by that month's payslip.
create table if not exists payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  period date not null,
  kind text not null check (kind in ('bonus','deduction')),
  label text not null,
  amount numeric(12,2) not null check (amount > 0),
  payslip_id uuid references payslips(id) on delete set null,   -- set when the payslip is finalized (locked)
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists payroll_adj_idx on payroll_adjustments(school_id, period, user_id);

-- audit trail of every sensitive action (who did what, when)
create table if not exists payroll_audit (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  actor_id uuid references users(user_id) on delete set null,
  action text not null,
  target_user uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists payroll_audit_idx on payroll_audit(school_id, created_at desc);

alter table payroll_settings    enable row level security;
alter table leave_types         enable row level security;
alter table leave_requests      enable row level security;
alter table leave_ledger        enable row level security;
alter table payslips            enable row level security;
alter table payroll_adjustments enable row level security;
alter table payroll_audit       enable row level security;


-- =====================================================================
-- AUDIT LOGS: one central, append-only record of everything that happens.
-- school_id = the school the action belongs to (NULL = platform level, e.g. a failed
-- sign-in for an unknown ID). School admins only ever read their own school's rows;
-- the super admin reads all. Names are copied into the row so the history stays readable
-- even after a user or school is renamed / deleted.
-- =====================================================================
create table if not exists audit_logs (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  school_id    uuid references schools(id) on delete set null,
  school_name  text,
  actor_id     uuid references users(user_id) on delete set null,
  actor_login  text,
  actor_name   text,
  actor_role   text,
  module       text not null,                 -- school, users, fees, auth ...
  action       text not null,                 -- e.g. fees.payment.collect
  kind         text not null default 'change' check (kind in ('change','view','auth')),
  summary      text not null,                 -- human sentence: "Collected Rs 500 from Rahul Sharma"
  entity_type  text,
  entity_id    text,
  entity_label text,
  success      boolean not null default true,
  status_code  int,
  method       text,
  path         text,
  ip           text,
  user_agent   text,
  duration_ms  int,
  detail       jsonb not null default '{}'::jsonb
);
create index if not exists audit_logs_school_idx on audit_logs(school_id, created_at desc);
create index if not exists audit_logs_time_idx   on audit_logs(created_at desc);
create index if not exists audit_logs_actor_idx  on audit_logs(actor_id, created_at desc);
create index if not exists audit_logs_module_idx on audit_logs(school_id, module, created_at desc);

-- append-only: rows can never be edited or deleted (the only allowed change is Postgres itself
-- blanking school_id / actor_id when a school or user is removed - the copied names stay).
-- To purge very old rows on purpose:  alter table audit_logs disable trigger audit_logs_immutable;
create or replace function audit_logs_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Audit logs cannot be deleted';
  end if;
  if (to_jsonb(new) - 'school_id' - 'actor_id') is distinct from (to_jsonb(old) - 'school_id' - 'actor_id') then
    raise exception 'Audit logs cannot be edited';
  end if;
  return new;
end $$;
drop trigger if exists audit_logs_immutable on audit_logs;
create trigger audit_logs_immutable before update or delete on audit_logs
  for each row execute function audit_logs_guard();

alter table audit_logs enable row level security;


-- ================= DOCUMENTS MODULE (certificates & report cards) =================
-- Letterhead details of a school (principal, signature, seal...). The school's name / address / logo come from the schools table.
create table if not exists doc_settings (
  school_id uuid primary key references schools(id) on delete cascade,
  principal_name text,
  principal_title text,
  tagline text,            -- e.g. "Affiliated to CBSE, Affiliation No. 123456"
  reg_line text,           -- e.g. "UDISE: 0912345  |  Reg. No. 45/2001"
  place text,              -- printed after "Place:"
  footer_note text,
  logo_url text,           -- falls back to schools.logo_url
  signature_url text,
  seal_url text,
  updated_at timestamptz not null default now()
);

-- a school's own wording / design for one document type. No row = the built-in default is used.
create table if not exists doc_templates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  doc_type text not null,
  title text,
  body text,
  design text,
  accent text,
  bg_url text,             -- optional full-page background (any certificate design downloaded from the web)
  orientation text check (orientation in ('portrait','landscape')),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (school_id, doc_type)
);

-- serial numbers never repeat: one counter per school, document type and year
create table if not exists doc_counters (
  school_id uuid not null references schools(id) on delete cascade,
  doc_type text not null,
  year int not null,
  last_seq int not null default 0,
  primary key (school_id, doc_type, year)
);

-- every issued document keeps a full snapshot (wording, details, marks), so it never changes after it is issued
create table if not exists issued_documents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  doc_type text not null,
  serial_no text not null,
  subject_id uuid references users(user_id) on delete set null,   -- the student / teacher / staff it was issued to
  subject_name text not null,
  subject_role text,
  class_label text,
  title text not null,
  content jsonb not null,
  status text not null default 'issued' check (status in ('issued','cancelled')),
  issued_by uuid references users(user_id) on delete set null,
  issued_by_name text,
  issued_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references users(user_id) on delete set null,
  cancel_reason text,
  unique (school_id, serial_no)
);
create index if not exists issued_documents_school_idx on issued_documents(school_id, issued_at desc);
create index if not exists issued_documents_subject_idx on issued_documents(subject_id, issued_at desc);

create or replace function next_doc_serial(p_school uuid, p_type text, p_prefix text, p_year int)
returns text language plpgsql as $$
declare seq int;
begin
  insert into doc_counters (school_id, doc_type, year, last_seq) values (p_school, p_type, p_year, 1)
    on conflict (school_id, doc_type, year) do update set last_seq = doc_counters.last_seq + 1
    returning last_seq into seq;
  return p_prefix || '/' || p_year || '/' || lpad(seq::text, 4, '0');
end $$;
revoke execute on function next_doc_serial(uuid, text, text, int) from public, anon, authenticated;
grant execute on function next_doc_serial(uuid, text, text, int) to service_role;

alter table doc_settings      enable row level security;
alter table doc_templates     enable row level security;
alter table doc_counters      enable row level security;
alter table issued_documents  enable row level security;
