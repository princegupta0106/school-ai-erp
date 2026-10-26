-- =====================================================================
-- LOAD TEST SEED - STEP 1 of 4:  install the helper functions
-- >>> RUN THIS ONLY ON A SEPARATE TEST DATABASE, NEVER ON PRODUCTION <<<
-- (create a second Supabase project, run db/schema.sql there, then run these files in order)
--
-- This file only creates functions (lt_*). It inserts nothing and is safe to re-run.
-- Everything it creates is for fake schools whose code you choose; lt_drop('CODE') removes one completely.
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- remove one fake school (and its audit rows)
create or replace function lt_drop(p_code text) returns void language plpgsql as $$
declare v uuid;
begin
  select id into v from schools where code = p_code;
  if v is null then return; end if;
  -- the audit table refuses deletes on purpose; switch the guard off only for this test clean-up
  alter table audit_logs disable trigger audit_logs_immutable;
  delete from audit_logs where school_id = v;
  alter table audit_logs enable trigger audit_logs_immutable;
  delete from schools where id = v;   -- cascades to everything else of the school
end $$;

-- ---------------------------------------------------------------- phase 1: school, classes, people, fee structure
-- logins (password for ALL of them:  Load@1234):  <prefix>admin, <prefix>teacher1.., <prefix>parent1.., <prefix>student1..
create or replace function lt_base(p_code text, p_prefix text, p_students int, p_staff int default 100)
returns uuid language plpgsql as $$
declare
  v_hash text := crypt('Load@1234', gen_salt('bf', 10));
  v_school uuid; v_sess uuid; v_admin uuid;
  v_start date := (date_trunc('month', current_date - interval '10 months'))::date;
  v_secs int := greatest(1, ceil(p_students / 12.0 / 50)::int);   -- sections per level so every class has <= 50 students
  v_classes int; v_per int; v_parents int;
  fn text[] := array['Aarav','Diya','Vihaan','Ananya','Kabir','Ishita','Rohan','Meera','Arjun','Saanvi','Aditya','Kavya','Reyansh','Navya','Ayaan','Prisha','Krish','Myra','Dhruv','Tara'];
  ln text[] := array['Sharma','Patel','Singh','Iyer','Khan','Verma','Deshmukh','Nair','Reddy','Gupta','Joshi','Kulkarni','Mehta','Shah','Bose','Das','Pillai','Menon','Yadav','Chopra'];
  subj text[] := array['English','Hindi','Mathematics','Science','Social Science','Computer Science','Art','Physical Education'];
begin
  perform lt_drop(p_code);
  insert into schools (name, code, address, phone, email)
    values ('Load Test ' || p_code, p_code, '1 Test Road, Pune', '020-00000000', lower(p_code) || '@loadtest.invalid') returning id into v_school;
  insert into academic_sessions (school_id, name, start_date, end_date, is_current)
    values (v_school, to_char(v_start, 'YYYY') || '-' || to_char(v_start + interval '1 year', 'YYYY'), v_start, (v_start + interval '1 year' - interval '1 day')::date, true)
    returning id into v_sess;

  -- classes: Class 1..12 x sections
  insert into classes (school_id, name, section, level)
    select v_school, 'Class ' || l, case when s <= 26 then chr(64 + s) else 'S' || s end, l
    from generate_series(1, 12) l, generate_series(1, v_secs) s;
  select count(*) into v_classes from classes where school_id = v_school;
  v_per := ceil(p_students::numeric / v_classes)::int;
  v_parents := ceil(p_students / 2.0)::int;

  -- admin
  insert into users (school_id, login_id, password_hash, role) values (v_school, p_prefix || 'admin', v_hash, 'school_admin') returning user_id into v_admin;
  insert into profiles (user_id, school_id, full_name, phone, email, designation)
    values (v_admin, v_school, 'Load Admin ' || p_code, '9800000001', p_prefix || 'admin@loadtest.invalid', 'School Administrator');

  -- teachers (role staff) + a few clerks (role other)
  create temp table lt_tc (n int, uid uuid default gen_random_uuid()) on commit drop;
  insert into lt_tc (n) select generate_series(1, p_staff);
  insert into users (user_id, school_id, login_id, password_hash, role)
    select uid, v_school, p_prefix || 'teacher' || n, v_hash, 'staff' from lt_tc;
  insert into profiles (user_id, school_id, full_name, phone, email, gender, employee_id, designation, department, qualification, joining_date, salary, features_permission)
    select uid, v_school, fn[1 + n % 20] || ' ' || ln[1 + (n * 7) % 20], '98' || lpad((10000000 + n)::text, 8, '0'), p_prefix || 'teacher' || n || '@loadtest.invalid',
           case when n % 2 = 0 then 'female' else 'male' end, 'EMP-' || lpad(n::text, 4, '0'), 'Teacher', subj[1 + n % 8], 'M.A., B.Ed.',
           current_date - (200 + n * 13), 20000 + (n % 40) * 1000,
           array['mark_attendance','view_attendance_reports','manage_assessments','view_academic_reports','manage_homework','post_announcement','send_notification','add_visitor']
    from lt_tc;
  insert into users (school_id, login_id, password_hash, role)
    select v_school, p_prefix || 'clerk' || n, v_hash, 'other' from generate_series(1, 5) n;
  insert into profiles (user_id, school_id, full_name, designation, salary)
    select u.user_id, v_school, 'Clerk ' || right(u.login_id, 1), 'Clerk', 18000 from users u where u.school_id = v_school and u.role = 'other';

  -- students, spread over the classes in order (Class 1 first ... Class 12 last), roll numbers 1..n inside each class
  create temp table lt_cl (k int, id uuid) on commit drop;
  insert into lt_cl select row_number() over (order by level, section), id from classes where school_id = v_school;
  create temp table lt_st (n int, uid uuid default gen_random_uuid(), cid uuid, roll int) on commit drop;
  insert into lt_st (n, cid, roll)
    select g, c.id, ((g - 1) % v_per) + 1 from generate_series(1, p_students) g join lt_cl c on c.k = ((g - 1) / v_per) + 1;
  insert into users (user_id, school_id, login_id, password_hash, role)
    select uid, v_school, p_prefix || 'student' || n, v_hash, 'student' from lt_st;
  insert into profiles (user_id, school_id, full_name, dob, gender, admission_no, class_id, roll_no, father_name, mother_name, father_phone, mother_phone, address, blood_group)
    select uid, v_school, fn[1 + n % 20] || ' ' || ln[1 + (n * 3) % 20], current_date - (3650 + (n % 3000)), case when n % 2 = 0 then 'female' else 'male' end,
           'ADM' || lpad(n::text, 6, '0'), cid, roll, fn[1 + (n * 5) % 20] || ' ' || ln[1 + (n * 3) % 20], fn[1 + (n * 11) % 20] || ' ' || ln[1 + (n * 3) % 20],
           '97' || lpad((10000000 + n)::text, 8, '0'), '96' || lpad((10000000 + n)::text, 8, '0'), n || ' Test Colony, Pune', (array['A+','B+','O+','AB+'])[1 + n % 4]
    from lt_st;

  -- parents: one per two students (siblings pairs), linked through parent_students
  create temp table lt_pa (n int, uid uuid default gen_random_uuid()) on commit drop;
  insert into lt_pa (n) select generate_series(1, v_parents);
  insert into users (user_id, school_id, login_id, password_hash, role)
    select uid, v_school, p_prefix || 'parent' || n, v_hash, 'parent' from lt_pa;
  insert into profiles (user_id, school_id, full_name, phone, email)
    select uid, v_school, fn[1 + (n * 5) % 20] || ' ' || ln[1 + (n * 3) % 20], '95' || lpad((10000000 + n)::text, 8, '0'), p_prefix || 'parent' || n || '@loadtest.invalid' from lt_pa;
  insert into parent_students (parent_id, student_id, school_id)
    select pa.uid, st.uid, v_school from lt_st st join lt_pa pa on pa.n = ceil(st.n / 2.0)::int;

  -- teachers per class: one class teacher + one more
  insert into class_teachers (class_id, teacher_id, school_id, is_class_teacher)
    select c.id, t.uid, v_school, true from lt_cl c join lt_tc t on t.n = ((c.k - 1) % p_staff) + 1;
  insert into class_teachers (class_id, teacher_id, school_id, is_class_teacher)
    select c.id, t.uid, v_school, false from lt_cl c join lt_tc t on t.n = (c.k % p_staff) + 1 where p_staff > 1
    on conflict do nothing;

  -- subjects, holidays, leave / payroll / document settings, fee structure, fee accounts
  insert into subjects (school_id, name, code) select v_school, s, upper(left(s, 3)) from unnest(subj) s;
  insert into holidays (school_id, session_id, title, start_date, end_date, type)
    select v_school, v_sess, 'Holiday ' || g, v_start + g * 20, v_start + g * 20 + (g % 3), (array['holiday','vacation','event','exam'])[1 + g % 4] from generate_series(1, 15) g;
  insert into leave_types (school_id, name, is_paid, annual_quota) values (v_school, 'Casual Leave', true, 12), (v_school, 'Sick Leave', true, 10), (v_school, 'Loss of Pay', false, 0);
  insert into payroll_settings (school_id) values (v_school);
  insert into doc_settings (school_id, principal_name, principal_title) values (v_school, 'Dr. Test Principal', 'Principal');
  insert into fee_counters (school_id, last_receipt) values (v_school, 0);
  insert into fee_items (school_id, session_id, class_name, name, amount, frequency, sort_order)
    select v_school, v_sess, 'Class ' || l, x.name, x.amt + case when x.name = 'Tuition Fee' then l * 100 else 0 end, x.freq, x.ord
    from generate_series(1, 12) l,
         (values ('Tuition Fee', 1500, 'monthly', 1), ('Admission Fee', 5000, 'one_time', 2), ('Exam Fee', 800, 'half_yearly', 3), ('Activity Fee', 600, 'quarterly', 4)) x(name, amt, freq, ord);
  insert into student_fee_accounts (school_id, student_id, session_id, class_id, class_name)
    select v_school, st.uid, v_sess, st.cid, c.name from lt_st st join classes c on c.id = st.cid;

  drop table lt_st; drop table lt_pa; drop table lt_tc; drop table lt_cl;
  return v_school;
end $$;

-- ---------------------------------------------------------------- phase 2: attendance (students x working days; Mon-Sat, newest first)
create or replace function lt_attendance(p_code text, p_days int)
returns bigint language plpgsql as $$
declare v_school uuid; v_sess uuid; v_start date; v_admin uuid; n bigint;
begin
  select id into v_school from schools where code = p_code;
  select id, start_date into v_sess, v_start from academic_sessions where school_id = v_school and is_current;
  select user_id into v_admin from users where school_id = v_school and role = 'school_admin' limit 1;
  insert into student_attendance (school_id, class_id, student_id, session_id, date, status, roll_no, marked_by)
    select v_school, p.class_id, p.user_id, v_sess, d.d,
           case when x.r < 0.90 then 'present' when x.r < 0.94 then 'absent' when x.r < 0.98 then 'late' else 'leave' end, p.roll_no, v_admin
    from profiles p
    join users u on u.user_id = p.user_id and u.role = 'student'
    cross join (select dd::date d from generate_series(current_date - 1, v_start, interval '-1 day') dd where extract(dow from dd) <> 0 limit p_days) d
    cross join lateral (select random() r) x
    where p.school_id = v_school;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- phase 3: fees (payments, a few cancelled, some discounts)
create or replace function lt_fees(p_code text)
returns bigint language plpgsql as $$
declare v_school uuid; v_sess uuid; v_start date; v_admin uuid; n bigint;
begin
  select id into v_school from schools where code = p_code;
  select id, start_date into v_sess, v_start from academic_sessions where school_id = v_school and is_current;
  select user_id into v_admin from users where school_id = v_school and role = 'school_admin' limit 1;
  insert into fee_payments (school_id, account_id, student_id, session_id, receipt_seq, receipt_no, amount, paid_on, mode, class_label, allocation, received_by, status, cancelled_by, cancelled_at, cancel_reason)
    select v_school, t.account_id, t.student_id, v_sess, row_number() over (order by t.paid_on, t.student_id, t.k),
           'RCT-' || lpad((row_number() over (order by t.paid_on, t.student_id, t.k))::text, 7, '0'),
           t.amount, t.paid_on, t.mode, t.class_name, jsonb_build_array(jsonb_build_object('label', 'Tuition Fee', 'amount', t.amount)), v_admin,
           case when t.r < 0.02 then 'cancelled' else 'received' end,
           case when t.r < 0.02 then v_admin end, case when t.r < 0.02 then now() end, case when t.r < 0.02 then 'Entered by mistake' end
    from (select a.id account_id, a.student_id, a.class_name, k, (1000 + floor(random() * 50) * 100)::numeric amount,
                 least(current_date, v_start + (random() * 300)::int) paid_on,
                 (array['cash','upi','cheque','bank_transfer','card'])[1 + floor(random() * 5)::int] mode, random() r
          from student_fee_accounts a, generate_series(1, 4) k
          where a.school_id = v_school and random() < 0.65) t;
  get diagnostics n = row_count;
  update fee_counters set last_receipt = (select coalesce(max(receipt_seq), 0) from fee_payments where school_id = v_school) where school_id = v_school;
  insert into fee_adjustments (school_id, account_id, student_id, session_id, item_name, amount, reason, applied_on, created_by)
    select v_school, a.id, a.student_id, v_sess, 'Tuition Fee', -500, 'Sibling concession', v_start + 30, v_admin
    from student_fee_accounts a where a.school_id = v_school and random() < 0.05;
  return n;
end $$;

-- ---------------------------------------------------------------- phase 4: academics (exams, tests, marks) + homework + payroll/leave
create or replace function lt_academics(p_code text, p_tests int default 4)
returns bigint language plpgsql as $$
declare v_school uuid; v_sess uuid; v_start date; v_admin uuid; n bigint;
begin
  select id into v_school from schools where code = p_code;
  select id, start_date into v_sess, v_start from academic_sessions where school_id = v_school and is_current;
  select user_id into v_admin from users where school_id = v_school and role = 'school_admin' limit 1;

  insert into exams (school_id, session_id, name, start_date, end_date)
    values (v_school, v_sess, 'Half Yearly', v_start + 150, v_start + 160), (v_school, v_sess, 'Annual', v_start + 330, v_start + 340);
  -- exam papers: every class x subject x exam
  insert into assessments (school_id, session_id, kind, exam_id, class_id, subject_id, title, test_date, max_marks, created_by)
    select v_school, v_sess, 'exam', e.id, c.id, s.id, s.name || ' - ' || e.name, e.start_date, 100, v_admin
    from exams e cross join classes c cross join subjects s where e.school_id = v_school and c.school_id = v_school and s.school_id = v_school;
  -- class tests
  insert into assessments (school_id, session_id, kind, class_id, subject_id, title, test_date, max_marks, created_by)
    select v_school, v_sess, 'test', c.id, s.id, s.name || ' Test ' || t, least(current_date - 1, v_start + 20 + t * 40), 25, v_admin
    from classes c cross join subjects s cross join generate_series(1, p_tests) t where c.school_id = v_school and s.school_id = v_school;
  -- marks for every student of the class, 3% absent
  insert into assessment_marks (assessment_id, student_id, school_id, marks, is_absent, entered_by)
    select a.id, p.user_id, v_school, case when x.r < 0.03 then null else round((a.max_marks * (0.35 + random() * 0.65))::numeric, 0) end, x.r < 0.03, v_admin
    from assessments a
    join profiles p on p.class_id = a.class_id
    join users u on u.user_id = p.user_id and u.role = 'student'
    cross join lateral (select random() r) x
    where a.school_id = v_school;
  get diagnostics n = row_count;

  -- homework: 6 per class, ~60% of the class submitted
  insert into assignments (school_id, class_id, created_by, title, description, subject, due_date, needs_submission)
    select v_school, c.id, v_admin, 'Homework ' || g, 'Solve the exercise at the end of the chapter.', (array['English','Mathematics','Science'])[1 + g % 3], current_date - g * 7, true
    from classes c cross join generate_series(1, 6) g where c.school_id = v_school;
  insert into assignment_submissions (assignment_id, school_id, student_id, note, is_late, status, marks, checked_by, checked_at)
    select a.id, v_school, p.user_id, 'Done', random() < 0.1, case when random() < 0.7 then 'checked' else 'submitted' end, '8/10', v_admin, now()
    from assignments a join profiles p on p.class_id = a.class_id join users u on u.user_id = p.user_id and u.role = 'student'
    where a.school_id = v_school and random() < 0.6;

  -- payroll: 12 monthly payslips per teacher; leave: allotments + a few requests
  insert into payslips (school_id, user_id, period, status, base_salary, rate_per_day, net_pay, paid_by, paid_at, payment_date, payment_method)
    select v_school, p.user_id, (date_trunc('month', current_date) - (m || ' month')::interval)::date, 'paid', p.salary, round(p.salary / 26), p.salary, v_admin, now(), current_date, 'bank_transfer'
    from profiles p join users u on u.user_id = p.user_id and u.role = 'staff' cross join generate_series(1, 12) m where p.school_id = v_school;
  insert into leave_ledger (school_id, user_id, leave_type_id, entry_date, days, kind, period_key, note)
    select v_school, u.user_id, lt.id, v_start, lt.annual_quota, 'allotment', to_char(v_start, 'YYYY'), 'Yearly allotment'
    from users u join leave_types lt on lt.school_id = v_school and lt.annual_quota > 0 where u.school_id = v_school and u.role = 'staff';
  insert into leave_requests (school_id, user_id, leave_type_id, start_date, end_date, days, reason, status, decided_by, decided_at)
    select v_school, u.user_id, (select id from leave_types where school_id = v_school and name = 'Casual Leave'), current_date - 20 - g * 9, current_date - 20 - g * 9, 1, 'Personal work',
           (array['approved','approved','pending','rejected'])[1 + g % 4], v_admin, now()
    from users u cross join generate_series(1, 3) g where u.school_id = v_school and u.role = 'staff';
  return n;
end $$;

-- ---------------------------------------------------------------- phase 5: notices, visitors, chat, notifications, issued documents, AUDIT LOG
create or replace function lt_comms(p_code text, p_notices int, p_visitors int, p_convs int, p_msgs int, p_notifs int, p_docs int, p_audit int)
returns text language plpgsql as $$
declare
  v_school uuid; v_name text; v_admin uuid; v_pa uuid[]; v_te uuid[]; v_us uuid[]; v_st uuid[]; v_per int;
begin
  select id, name into v_school, v_name from schools where code = p_code;
  select user_id into v_admin from users where school_id = v_school and role = 'school_admin' limit 1;
  select array_agg(user_id order by login_id) into v_pa from users where school_id = v_school and role = 'parent';
  select array_agg(user_id order by login_id) into v_te from users where school_id = v_school and role = 'staff';
  select array_agg(user_id) into v_st from users where school_id = v_school and role = 'student';
  select array_agg(user_id) into v_us from users where school_id = v_school and role in ('student', 'parent');

  -- notices (30% are for chosen classes)
  insert into announcements (school_id, title, body, audience, is_pinned, created_by, created_at)
    select v_school, 'Notice ' || g, 'Dear parents, please note the following update for the school. ' || repeat('Details follow. ', 5),
           case when g % 10 < 3 then 'class' else 'school' end, g % 50 = 0, v_admin, now() - random() * 300 * interval '1 day' from generate_series(1, p_notices) g;
  insert into announcement_classes (announcement_id, class_id, school_id)
    select a.id, c.id, v_school from announcements a
    cross join lateral (select id from classes where school_id = v_school order by random() limit 2) c
    where a.school_id = v_school and a.audience = 'class';

  insert into visitors (school_id, name, purpose, visit_date, visit_time, created_by)
    select v_school, 'Visitor ' || g, (array['Admission enquiry','Meet principal','Delivery','Parent meeting'])[1 + g % 4], current_date - (random() * 300)::int, (random() * 86399 * interval '1 second')::time, v_admin
    from generate_series(1, p_visitors) g;

  -- parent <-> teacher chats: p_convs conversations (at most one per parent), p_msgs messages in total
  if p_convs > 0 and cardinality(v_pa) > 0 and cardinality(v_te) > 0 then
    p_convs := least(p_convs, cardinality(v_pa));
    v_per := greatest(1, p_msgs / p_convs);
    insert into conversations (school_id, user_a, user_b)
      select v_school, least(v_pa[g], v_te[1 + g % cardinality(v_te)]), greatest(v_pa[g], v_te[1 + g % cardinality(v_te)]) from generate_series(1, p_convs) g;
    insert into messages (conversation_id, sender_id, body, created_at)
      select c.id, case when m % 2 = 0 then c.user_a else c.user_b end, 'Message ' || m || ': thank you for the update, we will follow up soon.', now() - ((v_per - m) * 37 || ' minutes')::interval - (c.rn % 200 || ' hours')::interval
      from (select id, user_a, user_b, row_number() over () rn from conversations where school_id = v_school) c cross join generate_series(1, v_per) m;
    update conversations c set last_message_at = m.mx, last_preview = left(m.body, 60), last_sender = m.sender
      from (select distinct on (conversation_id) conversation_id, created_at mx, body, sender_id sender from messages order by conversation_id, created_at desc) m
      where m.conversation_id = c.id and c.school_id = v_school;
  end if;

  -- notifications to students / parents (30% still unread)
  insert into notifications (school_id, user_id, kind, title, body, module, created_by, created_at, read_at)
    select v_school, v_us[1 + g % cardinality(v_us)], (array['notice','homework','marks','fees','message','general'])[1 + g % 6], 'Update ' || g, 'You have a new update from school.', null, v_admin,
           now() - random() * 300 * interval '1 day', case when random() < 0.7 then now() else null end
    from generate_series(1, p_notifs) g;

  insert into issued_documents (school_id, doc_type, serial_no, subject_id, subject_name, subject_role, title, content, issued_by, issued_by_name)
    select v_school, (array['bonafide','character','transfer','report_card'])[1 + g % 4], upper(p_code) || '-' || lpad(g::text, 7, '0'), v_st[1 + g % cardinality(v_st)], 'Student ' || g, 'student', 'Certificate ' || g,
           '{"note":"load test"}'::jsonb, v_admin, 'Load Admin'
    from generate_series(1, p_docs) g;

  -- audit log: what the real app writes for sign-ins, views and changes
  insert into audit_logs (created_at, school_id, school_name, actor_id, actor_login, actor_name, actor_role, module, action, kind, summary, success, status_code, method, path, ip, user_agent, duration_ms)
    select now() - random() * 300 * interval '1 day' - (g % 86400 || ' seconds')::interval, v_school, v_name,
           case when g % 3 = 0 then v_admin else v_te[1 + g % cardinality(v_te)] end, 'user' || (g % 50), 'Test User ' || (g % 50), case when g % 3 = 0 then 'school_admin' else 'staff' end,
           x.module, x.module || '.' || x.act, x.kind, x.act || ' in ' || x.module || ' #' || g, g % 50 <> 0, case when g % 50 = 0 then 403 else 200 end,
           case when x.kind = 'change' then 'POST' else 'GET' end, '/api/' || x.module, '10.0.' || (g % 255) || '.' || (g % 200), 'k6-load-test', 5 + (g % 300)
    from generate_series(1, p_audit) g
    cross join lateral (select (array['attendance','fees','users','academics','communication','documents','homework','payroll','visitors'])[1 + g % 9] module,
                               (array['view','list','update','create','export'])[1 + g % 5] act,
                               (array['view','change','view','change','auth'])[1 + g % 5] kind) x;
  return format('notices %s, visitors %s, chats %s/%s, notifications %s, documents %s, audit rows %s', p_notices, p_visitors, p_convs, p_msgs, p_notifs, p_docs, p_audit);
end $$;

-- ---------------------------------------------------------------- one call for a whole (small) school
create or replace function lt_all(p_code text, p_prefix text, p_students int, p_staff int, p_days int, p_audit int)
returns text language plpgsql as $$
begin
  perform lt_base(p_code, p_prefix, p_students, p_staff);
  perform lt_attendance(p_code, p_days);
  perform lt_fees(p_code);
  perform lt_academics(p_code, 3);
  return p_code || ': ' || lt_comms(p_code, p_students / 10, p_students / 5, p_students / 4, p_students * 4, p_students * 3, p_students / 5, p_audit);
end $$;
