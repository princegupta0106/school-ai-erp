-- =====================================================================
-- DEMO SEED  -  paste into Supabase -> SQL Editor -> Run
-- Run db/schema.sql FIRST. Safe to re-run: it wipes the old "DEMO1" school and rebuilds it.
--
-- LOGINS (all passwords:  Demo@123)
--   Admin    : demoadmin
--   Teacher  : demoteacher1     (every field filled)
--   Parent   : demoparent1      (parent of Aarav)
--   Student  : demostudent1     (Aarav Sharma - every field filled)
--   Students : demostudent2 ... demostudent10
-- =====================================================================
create extension if not exists pgcrypto;

do $$
declare
  v_hash    text := crypt('Demo@123', gen_salt('bf', 10));   -- bcrypt, works with the backend's bcryptjs
  v_school  uuid; v_admin uuid; v_teacher uuid; v_parent uuid; v_sess uuid;
  v_c4 uuid; v_c5 uuid; v_c6 uuid;
  v_math uuid; v_eng uuid; v_sci uuid; v_hin uuid;
  v_exam uuid; v_asm uuid;
  v_ct uuid; v_cs uuid; v_cl uuid; v_lr uuid; v_conv uuid;
  v_fee_adm uuid; v_fee_tui uuid;
  v_names text[] := array['Aarav Sharma','Diya Patel','Vihaan Singh','Ananya Iyer','Kabir Khan',
                          'Ishita Verma','Rohan Deshmukh','Meera Nair','Arjun Reddy','Saanvi Gupta'];
  v_st uuid[] := '{}'; v_acc uuid[] := '{}';
  v_id uuid; v_acc_id uuid; v_d date; v_status text;
  i int; d int; k int;
  v_subj uuid[];
begin
  -- 0) wipe any previous demo (cascades to everything under the school)
  delete from schools where code = 'DEMO1';

  -- 1) school
  insert into schools (name, code, address, phone, email)
  values ('Demo Public School', 'DEMO1', '12 Knowledge Park, Pune, Maharashtra 411001', '020-12345678', 'info@demoschool.edu')
  returning id into v_school;

  -- 2) session, classes
  insert into academic_sessions (school_id, name, start_date, end_date, is_current)
  values (v_school, '2026-2027', '2026-04-01', '2027-03-31', true) returning id into v_sess;

  insert into classes (school_id, name, section, level) values (v_school, 'Class 4', 'A', 4) returning id into v_c4;
  insert into classes (school_id, name, section, level) values (v_school, 'Class 5', 'A', 5) returning id into v_c5;
  insert into classes (school_id, name, section, level) values (v_school, 'Class 6', 'A', 6) returning id into v_c6;

  -- 3) ADMIN
  insert into users (school_id, login_id, password_hash, role) values (v_school, 'demoadmin', v_hash, 'school_admin') returning user_id into v_admin;
  insert into profiles (user_id, school_id, full_name, phone, email, gender, address, designation)
  values (v_admin, v_school, 'Demo Admin', '9800000001', 'admin@demoschool.edu', 'male', '12 Knowledge Park, Pune', 'School Administrator');

  -- 4) TEACHER (everything filled)
  insert into users (school_id, login_id, password_hash, role) values (v_school, 'demoteacher1', v_hash, 'staff') returning user_id into v_teacher;
  insert into profiles (user_id, school_id, full_name, phone, email, dob, gender, address, blood_group,
      emergency_contact_name, emergency_contact_phone, employee_id, designation, department, qualification,
      joining_date, salary, class_id, father_name, mother_name, father_phone, mother_phone, father_occupation, mother_occupation,
      features_permission, documents, extra)
  values (v_teacher, v_school, 'Priya Mehta', '9800000002', 'priya.mehta@demoschool.edu', '1989-06-14', 'female',
      'Flat 302, Green Heights, Baner, Pune 411045', 'B+', 'Rahul Mehta (Husband)', '9800000099',
      'EMP-001', 'Maths Teacher & Class Teacher (5-A)', 'Mathematics', 'M.Sc. Mathematics, B.Ed.',
      '2018-06-01', 40000.00, null, 'Suresh Kulkarni', 'Sunita Kulkarni', '9811111111', '9822222222', 'Retired Bank Manager', 'Homemaker',
      array['mark_attendance','view_attendance_reports','edit_past_attendance','manage_roll_numbers','add_visitor','view_visitors',
            'post_announcement','manage_subjects','manage_exams','manage_assessments','view_academic_reports',
            'get_user','get_all_users_school','get_calendar','view_student_fees','issue_documents'],
      jsonb_build_array(
        jsonb_build_object('id','d1','label','Aadhaar Card','name','aadhaar.pdf','url','https://example.com/demo/aadhaar.pdf','size',120000,'type','application/pdf','uploaded_at', now()),
        jsonb_build_object('id','d2','label','B.Ed. Certificate','name','bed-certificate.pdf','url','https://example.com/demo/bed.pdf','size',250000,'type','application/pdf','uploaded_at', now())),
      '{"languages":["English","Hindi","Marathi"],"experience_years":8}'::jsonb);

  insert into class_teachers (class_id, teacher_id, school_id, is_class_teacher) values (v_c5, v_teacher, v_school, true);

  -- 5) PARENT of student 1
  insert into users (school_id, login_id, password_hash, role) values (v_school, 'demoparent1', v_hash, 'parent') returning user_id into v_parent;
  insert into profiles (user_id, school_id, full_name, phone, email, gender, address)
  values (v_parent, v_school, 'Rajesh Sharma', '9876500001', 'rajesh.sharma@example.com', 'male', '45 Lake View Society, Kothrud, Pune');

  -- 6) STUDENTS (10 in Class 5-A; student 1 fully filled)
  for i in 1..10 loop
    insert into users (school_id, login_id, password_hash, role)
    values (v_school, 'demostudent' || i, v_hash, 'student') returning user_id into v_id;
    v_st := v_st || v_id;

    if i = 1 then
      insert into profiles (user_id, school_id, full_name, phone, email, dob, gender, address, admission_no, class_id, roll_no,
          father_name, mother_name, father_phone, mother_phone, father_occupation, mother_occupation,
          blood_group, emergency_contact_name, emergency_contact_phone, documents, extra)
      values (v_id, v_school, v_names[i], '9876500001', 'aarav.sharma@example.com', '2015-08-21', 'male',
          '45 Lake View Society, Kothrud, Pune 411038', 'ADM-2026-001', v_c5, 1,
          'Rajesh Sharma', 'Neha Sharma', '9876500001', '9876500002', 'Software Engineer', 'Pediatrician',
          'O+', 'Vikram Sharma (Uncle)', '9876500003',
          jsonb_build_array(
            jsonb_build_object('id','s1','label','Birth Certificate','name','birth-cert.pdf','url','https://example.com/demo/birth.pdf','size',98000,'type','application/pdf','uploaded_at', now()),
            jsonb_build_object('id','s2','label','Previous Marksheet','name','class4-marksheet.pdf','url','https://example.com/demo/marks.pdf','size',140000,'type','application/pdf','uploaded_at', now()),
            jsonb_build_object('id','s3','label','Transfer Certificate','name','tc.pdf','url','https://example.com/demo/tc.pdf','size',110000,'type','application/pdf','uploaded_at', now())),
          '{"religion":"Hindu","nationality":"Indian","mother_tongue":"Marathi","previous_school":"Sunrise Primary School, Pune","transport":"Bus Route 4","house":"Blue House"}'::jsonb);
      insert into parent_students (parent_id, student_id, school_id) values (v_parent, v_id, v_school);
    else
      insert into profiles (user_id, school_id, full_name, phone, dob, gender, address, admission_no, class_id, roll_no,
          father_name, mother_name, father_phone, blood_group)
      values (v_id, v_school, v_names[i], '98765000' || lpad(i::text, 2, '0'), date '2015-01-01' + (i * 37),
          case when i in (2,4,6,8,10) then 'female' else 'male' end,
          'Pune, Maharashtra', 'ADM-2026-' || lpad(i::text, 3, '0'), v_c5, i,
          'Mr. ' || split_part(v_names[i], ' ', 2), 'Mrs. ' || split_part(v_names[i], ' ', 2),
          '98111000' || lpad(i::text, 2, '0'), (array['A+','B+','O+','AB+','A-'])[1 + (i % 5)]);
    end if;
  end loop;

  -- 7) FEES: structure, accounts, two receipts
  insert into fee_items (school_id, session_id, class_name, name, amount, frequency, sort_order)
  values (v_school, v_sess, 'Class 5', 'Admission Fee', 5000, 'one_time', 1) returning id into v_fee_adm;
  insert into fee_items (school_id, session_id, class_name, name, amount, frequency, sort_order)
  values (v_school, v_sess, 'Class 5', 'Tuition Fee', 24000, 'quarterly', 2) returning id into v_fee_tui;

  for i in 1..10 loop
    insert into student_fee_accounts (school_id, student_id, session_id, class_id, class_name)
    values (v_school, v_st[i], v_sess, v_c5, 'Class 5') returning id into v_acc_id;
    v_acc := v_acc || v_acc_id;
  end loop;

  insert into fee_payments (school_id, account_id, student_id, session_id, receipt_seq, receipt_no, amount, paid_on, mode,
      reference, note, class_label, allocation, balance_after, received_by)
  values
   (v_school, v_acc[1], v_st[1], v_sess, 1, 'RCP-000001', 11000, '2026-04-05', 'upi', 'UPI-demo-884213', 'Admission + Q1 tuition', 'Class 5 A',
      '[{"label":"Admission Fee","amount":5000},{"label":"Tuition Fee (Q1)","amount":6000}]'::jsonb, 18000, v_admin),
   (v_school, v_acc[2], v_st[2], v_sess, 2, 'RCP-000002', 5000, '2026-04-06', 'cash', null, 'Admission fee', 'Class 5 A',
      '[{"label":"Admission Fee","amount":5000}]'::jsonb, 24000, v_admin);
  insert into fee_counters (school_id, last_receipt) values (v_school, 2) on conflict (school_id) do update set last_receipt = 2;

  -- 8) SUBJECTS
  insert into subjects (school_id, name, code) values (v_school, 'Mathematics', 'MATH') returning id into v_math;
  insert into subjects (school_id, name, code) values (v_school, 'English', 'ENG') returning id into v_eng;
  insert into subjects (school_id, name, code) values (v_school, 'Science', 'SCI') returning id into v_sci;
  insert into subjects (school_id, name, code) values (v_school, 'Hindi', 'HIN') returning id into v_hin;
  v_subj := array[v_math, v_eng, v_sci];

  -- 9) ATTENDANCE: last 14 days (Sundays skipped)
  for d in 1..14 loop
    v_d := current_date - d;
    continue when extract(dow from v_d) = 0;
    for i in 1..10 loop
      v_status := case when i = 1 then (case when d = 5 then 'late' else 'present' end) when (i + d) % 7 = 0 then 'absent' when (i * d) % 11 = 0 then 'late' when (i + d) % 13 = 0 then 'leave' else 'present' end;
      insert into student_attendance (school_id, class_id, student_id, session_id, date, status, roll_no, marked_by)
      values (v_school, v_c5, v_st[i], v_sess, v_d, v_status, i, v_teacher);
    end loop;
  end loop;

  -- 10) EXAM (Half Yearly, 3 papers) + a unit test, with marks
  insert into exams (school_id, session_id, name, start_date, end_date)
  values (v_school, v_sess, 'Half Yearly Exam', '2026-09-15', '2026-09-25') returning id into v_exam;

  for k in 1..3 loop
    insert into assessments (school_id, session_id, kind, exam_id, class_id, subject_id, title, test_date, max_marks, created_by)
    values (v_school, v_sess, 'exam', v_exam, v_c5, v_subj[k], 'Half Yearly - ' || (array['Mathematics','English','Science'])[k],
            date '2026-09-14' + (k * 3), 100, v_teacher) returning id into v_asm;
    for i in 1..10 loop
      insert into assessment_marks (assessment_id, student_id, school_id, marks, is_absent, entered_by)
      values (v_asm, v_st[i], v_school, case when i = 1 then (array[92, 88, 95])[k] else 52 + ((i * 7 + k * 13) % 46) end, false, v_teacher);
    end loop;
  end loop;

  insert into assessments (school_id, session_id, kind, class_id, subject_id, title, test_date, max_marks, created_by)
  values (v_school, v_sess, 'test', v_c5, v_math, 'Unit Test 1 - Mathematics', '2026-08-10', 20, v_teacher) returning id into v_asm;
  for i in 1..10 loop
    if i = 5 then
      insert into assessment_marks (assessment_id, student_id, school_id, marks, is_absent, entered_by) values (v_asm, v_st[i], v_school, null, true, v_teacher);
    else
      insert into assessment_marks (assessment_id, student_id, school_id, marks, is_absent, entered_by) values (v_asm, v_st[i], v_school, case when i = 1 then 18 else 9 + ((i * 3) % 11) end, false, v_teacher);
    end if;
  end loop;

  -- 11) HOLIDAYS & EVENTS
  insert into holidays (school_id, session_id, title, start_date, end_date, type, description) values
   (v_school, v_sess, 'Diwali Break',       '2026-11-07', '2026-11-11', 'vacation', 'School closed for Diwali'),
   (v_school, v_sess, 'Annual Day',         '2026-12-18', '2026-12-18', 'event',    'Annual day celebration, parents invited'),
   (v_school, v_sess, 'Winter Vacation',    '2026-12-25', '2027-01-05', 'vacation', 'Winter break'),
   (v_school, v_sess, 'Republic Day',       '2027-01-26', '2027-01-26', 'holiday',  'National holiday'),
   (v_school, v_sess, 'Final Exams',        '2027-03-05', '2027-03-20', 'exam',     'Annual examinations');

  -- 12) NOTICE BOARD
  insert into announcements (school_id, title, body, audience, is_pinned, created_by) values
   (v_school, 'Welcome to Demo Public School', 'Welcome to the new session 2026-27! Please keep your contact details updated in the portal.', 'school', true, v_admin);
  insert into announcements (school_id, title, body, audience, is_pinned, created_by)
   values (v_school, 'Class 5-A: Maths worksheet', 'Please complete the fractions worksheet and submit by Friday.', 'class', false, v_teacher) returning id into v_id;
  insert into announcement_classes (announcement_id, class_id, school_id) values (v_id, v_c5, v_school);

  -- 13) CHAT (teacher <-> parent)
  insert into conversations (school_id, user_a, user_b) values (v_school, least(v_teacher, v_parent), greatest(v_teacher, v_parent)) returning id into v_conv;
  insert into messages (conversation_id, sender_id, body, created_at) values
   (v_conv, v_parent,  'Good morning ma''am, how is Aarav doing in Maths?', now() - interval '2 hours'),
   (v_conv, v_teacher, 'Good morning! Aarav is doing very well, his Half Yearly marks were great.', now() - interval '1 hour');
  update conversations set last_message_at = now() - interval '1 hour', last_preview = 'Good morning! Aarav is doing very well, his Half Yearly marks were great.',
    last_sender = v_teacher,
    a_unread = case when user_a = v_parent then 1 else 0 end,
    b_unread = case when user_b = v_parent then 1 else 0 end
  where id = v_conv;

  -- 14) VISITORS
  insert into visitors (school_id, name, purpose, visit_date, visit_time, created_by) values
   (v_school, 'Mr. Anil Joshi',  'Admission enquiry',        current_date,     '10:15', v_teacher),
   (v_school, 'Mrs. Kavita Rao', 'Meet class teacher',       current_date,     '11:40', v_teacher),
   (v_school, 'Courier - BlueDart', 'Parcel delivery',       current_date - 1, '14:05', v_admin);

  -- 15) PAYROLL & LEAVE (teacher)
  insert into payroll_settings (school_id, approval_mode, weekly_off, rate_basis) values (v_school, 'manual', '{0}', 'working_days');
  insert into leave_types (school_id, name, is_paid, annual_quota) values (v_school, 'Casual Leave', true, 12) returning id into v_cl;
  insert into leave_types (school_id, name, is_paid, annual_quota) values (v_school, 'Sick Leave',   true, 10) returning id into v_ct;
  insert into leave_types (school_id, name, is_paid, annual_quota) values (v_school, 'Loss of Pay',  false, 0);

  insert into leave_ledger (school_id, user_id, leave_type_id, entry_date, days, kind, period_key, note, created_by) values
   (v_school, v_teacher, v_cl, '2026-04-01', 12, 'allotment', '2026', 'Yearly casual leave', v_admin),
   (v_school, v_teacher, v_ct, '2026-04-01', 10, 'allotment', '2026', 'Yearly sick leave',   v_admin);

  -- approved leave (already taken)
  insert into leave_requests (school_id, user_id, leave_type_id, start_date, end_date, days, days_detail, reason, status, decided_by, decided_at, decision_note)
  values (v_school, v_teacher, v_cl, current_date - 30, current_date - 29, 2,
          jsonb_build_array(jsonb_build_object('date', current_date - 30, 'value', 1), jsonb_build_object('date', current_date - 29, 'value', 1)),
          'Family function', 'approved', v_admin, now() - interval '31 days', 'Approved')
  returning id into v_lr;
  insert into leave_ledger (school_id, user_id, leave_type_id, entry_date, days, kind, leave_id, note, created_by)
  values (v_school, v_teacher, v_cl, current_date - 30, -2, 'taken', v_lr, 'Family function', v_admin);

  -- pending leave (admin can approve it live in the demo)
  insert into leave_requests (school_id, user_id, leave_type_id, start_date, end_date, days, days_detail, reason, status)
  values (v_school, v_teacher, v_ct, current_date + 3, current_date + 3, 1,
          jsonb_build_array(jsonb_build_object('date', current_date + 3, 'value', 1)), 'Doctor appointment', 'pending');

  -- last month's payslip (paid)
  insert into payslips (school_id, user_id, period, status, base_salary, rate_per_day, unpaid_days, leave_deduction, bonus_total,
      other_deduction_total, net_pay, breakdown, finalized_by, finalized_at, paid_by, paid_at, payment_date, payment_method, payment_reference)
  values (v_school, v_teacher, date_trunc('month', current_date - interval '1 month')::date, 'paid', 40000, 1538.46, 0, 0, 0, 0, 40000,
      '{"note":"Full salary, no unpaid leave"}'::jsonb, v_admin, now() - interval '10 days', v_admin, now() - interval '9 days',
      (current_date - 9), 'bank_transfer', 'NEFT-DEMO-556677');

  -- 16) CERTIFICATE LETTERHEAD
  insert into doc_settings (school_id, principal_name, principal_title, tagline, reg_line, place, footer_note)
  values (v_school, 'Dr. Sunil Deshpande', 'Principal', 'Affiliated to CBSE, Affiliation No. 1234567',
          'UDISE: 27010101010  |  Reg. No. 45/2001', 'Pune', 'This is a computer generated document.');

  -- 17) REPORT CARD already issued to the demo student (Documents -> register, or log in as demostudent1 / demoparent1)
  declare
    r_subj jsonb; r_obt numeric; r_max numeric; r_pct numeric; r_grade text; r_att jsonb; r_fail text[];
    r_serial text := 'RC/' || extract(year from current_date)::int || '/0001';
    r_lh jsonb; r_content jsonb;
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', x.name,
             'cells', jsonb_build_object(v_exam::text, jsonb_build_object('marks', x.marks, 'max', x.max_marks, 'absent', false)),
             'obtained', x.marks, 'max', x.max_marks, 'pct', x.pct,
             'grade', case when x.pct >= 90 then 'A+' when x.pct >= 80 then 'A' when x.pct >= 70 then 'B' when x.pct >= 60 then 'C'
                           when x.pct >= 50 then 'D' when x.pct >= 33 then 'E' else 'F' end,
             'tests_pct', null) order by x.name), '[]'::jsonb),
           coalesce(sum(x.marks), 0), coalesce(sum(x.max_marks), 0),
           coalesce(array_agg(x.name) filter (where x.pct < 33), '{}')
      into r_subj, r_obt, r_max, r_fail
      from (select sj.name, m.marks, a.max_marks, round(m.marks / a.max_marks * 100, 1) as pct
              from assessments a
              join subjects sj on sj.id = a.subject_id
              join assessment_marks m on m.assessment_id = a.id and m.student_id = v_st[1]
             where a.exam_id = v_exam and a.class_id = v_c5) x;

    r_pct := round(r_obt / nullif(r_max, 0) * 100, 1);
    r_grade := case when r_pct >= 90 then 'A+' when r_pct >= 80 then 'A' when r_pct >= 70 then 'B' when r_pct >= 60 then 'C'
                    when r_pct >= 50 then 'D' when r_pct >= 33 then 'E' else 'F' end;

    select jsonb_build_object('present', count(*) filter (where status in ('present','late')), 'total', count(*),
             'pct', round((count(*) filter (where status in ('present','late')))::numeric / nullif(count(*), 0) * 100))
      into r_att from student_attendance where student_id = v_st[1];

    select jsonb_build_object('name', s.name, 'address', coalesce(s.address, ''), 'phone', coalesce(s.phone, ''), 'email', coalesce(s.email, ''),
             'logo_url', '', 'signature_url', '', 'seal_url', '',
             'principal_name', coalesce(d.principal_name, ''), 'principal_title', coalesce(d.principal_title, 'Principal'),
             'tagline', coalesce(d.tagline, ''), 'reg_line', coalesce(d.reg_line, ''), 'place', coalesce(d.place, ''), 'footer_note', coalesce(d.footer_note, ''))
      into r_lh from schools s left join doc_settings d on d.school_id = s.id where s.id = v_school;

    r_content := jsonb_build_object(
      'v', 1, 'type', 'report_card', 'title', 'REPORT CARD',
      'body', 'Grading scale: A+ 90% and above, A 80-89, B 70-79, C 60-69, D 50-59, E 33-49, F below 33. The pass mark is 33% in every subject.',
      'design', 'classic', 'accent', '', 'orientation', 'portrait', 'inset', 18, 'bg_url', null,
      'school', r_lh, 'issued_on', to_char(current_date, 'YYYY-MM-DD'), 'serial_no', r_serial, 'session_name', '2026-2027',
      'subject', jsonb_build_object('id', v_st[1], 'role', 'student', 'kind', 'student', 'name', v_names[1], 'gender', 'male', 'dob', '2015-08-21',
          'father', 'Rajesh Sharma', 'mother', 'Neha Sharma', 'address', '45 Lake View Society, Kothrud, Pune 411038',
          'class_label', 'Class 5 A', 'admission_no', 'ADM-2026-001', 'roll_no', '1',
          'designation', '', 'department', '', 'employee_id', '', 'joining_date', '', 'qualification', ''),
      'fields', jsonb_build_object('promoted_to', 'Class 6 A', 'reopen_date', '2027-04-01', 'exam_names', 'Half Yearly Exam',
          'remarks', 'Aarav is a sincere and cheerful student who takes active part in class. Keep up the good work!'),
      'report', jsonb_build_object(
          'session_id', v_sess, 'session_name', '2026-2027',
          'sessions', jsonb_build_array(jsonb_build_object('id', v_sess, 'name', '2026-2027', 'is_current', true)),
          'available_exams', jsonb_build_array(jsonb_build_object('exam_id', v_exam, 'name', 'Half Yearly Exam', 'pct', r_pct)),
          'exams', jsonb_build_array(jsonb_build_object('exam_id', v_exam, 'name', 'Half Yearly Exam')),
          'exam_totals', jsonb_build_object(v_exam::text, jsonb_build_object('obtained', r_obt, 'max', r_max, 'pct', r_pct, 'grade', r_grade)),
          'subjects', r_subj, 'has_tests_column', false,
          'grand', jsonb_build_object('obtained', r_obt, 'max', r_max, 'pct', r_pct, 'grade', r_grade),
          'result', case when cardinality(r_fail) = 0 then 'PASS' else 'FAIL' end,
          'failed_subjects', to_jsonb(r_fail), 'attendance', r_att, 'pass_percent', 33));

    insert into doc_counters (school_id, doc_type, year, last_seq) values (v_school, 'report_card', extract(year from current_date)::int, 1)
      on conflict (school_id, doc_type, year) do update set last_seq = 1;
    insert into issued_documents (school_id, doc_type, serial_no, subject_id, subject_name, subject_role, class_label, title, content, issued_by, issued_by_name)
    values (v_school, 'report_card', r_serial, v_st[1], v_names[1], 'student', 'Class 5 A', 'REPORT CARD', r_content, v_admin, 'Demo Admin');
  end;

  raise notice 'Demo school created. Login: demoadmin / demoteacher1 / demoparent1 / demostudent1  -  password Demo@123';
end $$;
