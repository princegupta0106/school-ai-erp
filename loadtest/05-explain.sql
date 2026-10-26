-- =====================================================================
-- DATABASE SPEED CHECK (run in the Supabase SQL editor, on the TEST database, after 04-finish.sql)
-- Each query below is what a busy screen of the app does. Run them ONE AT A TIME.
-- Read the result like this:
--   "Execution Time"  -> the real time in ms. Over ~100 ms for a screen query is worth a look.
--   "Seq Scan on <big table>" with a big "Rows Removed by Filter" -> no usable index: add one.
--   "Index Scan" / "Index Only Scan" / "Bitmap Index Scan" -> good.
-- =====================================================================

-- 1) one day of attendance for the whole school (dashboard / daily overview)
explain (analyze, buffers)
select status, count(*) from student_attendance
where school_id = (select id from schools where code = 'BIG1') and date = (select max(date) from student_attendance where school_id = (select id from schools where code = 'BIG1')) group by status;

-- 2) one class, 60 days of attendance (class report)
explain (analyze, buffers)
select student_id, status, count(*) from student_attendance
where school_id = (select id from schools where code = 'BIG1')
  and class_id = (select id from classes where school_id = (select id from schools where code = 'BIG1') order by level, section offset 6 limit 1)
  and date between current_date - 60 and current_date - 1 group by student_id, status;

-- 3) one student's whole year of attendance (student report / parent screen)
explain (analyze, buffers)
select date, status from student_attendance
where student_id = (select user_id from users where login_id = 'bigstudent1') order by date desc;

-- 4) fee payments of the school, newest first (fee payments list)
explain (analyze, buffers)
select id, receipt_no, amount, paid_on, mode, status from fee_payments
where school_id = (select id from schools where code = 'BIG1') order by paid_on desc, created_at desc limit 50;

-- 5) who still owes fees (pending list): paid per account across the school
explain (analyze, buffers)
select a.student_id, coalesce(sum(p.amount) filter (where p.status = 'received'), 0) paid
from student_fee_accounts a left join fee_payments p on p.account_id = a.id
where a.school_id = (select id from schools where code = 'BIG1') group by a.student_id order by paid limit 50;

-- 6a) marks of one test (mark sheet)
explain (analyze, buffers)
select * from assessment_marks where assessment_id = (select id from assessments where school_id = (select id from schools where code = 'BIG1') limit 1);
-- 6b) marks of one student (parent / report card)
explain (analyze, buffers)
select * from assessment_marks where student_id = (select user_id from users where login_id = 'bigstudent1');

-- 7) audit log, first page of the school (the audit screen) - should be an index scan, not a sort of 500k rows
explain (analyze, buffers)
select id, created_at, summary from audit_logs
where school_id = (select id from schools where code = 'BIG1') order by created_at desc, id desc limit 51;

-- 8) audit log filtered by module (filter dropdown)
explain (analyze, buffers)
select id, created_at, summary from audit_logs
where school_id = (select id from schools where code = 'BIG1') and module = 'fees' order by created_at desc limit 51;

-- 9) a person's notifications (bell icon, runs often)
explain (analyze, buffers)
select * from notifications where user_id = (select user_id from users where login_id = 'bigparent1') order by created_at desc limit 30;

-- 10) a chat: latest messages of one conversation
explain (analyze, buffers)
select * from messages where conversation_id = (select id from conversations where school_id = (select id from schools where code = 'BIG1') limit 1)
order by created_at desc limit 50;

-- 11) every student with their profile (the users list; the API loads up to 2000 of these)
explain (analyze, buffers)
select u.user_id, u.login_id, p.full_name, p.class_id from users u join profiles p on p.user_id = u.user_id
where u.school_id = (select id from schools where code = 'BIG1') and u.role = 'student' order by u.created_at desc limit 2000;

-- 12) which queries are the slowest overall (Supabase: pg_stat_statements is on by default). Un-comment and run:
-- select round(mean_exec_time::numeric, 1) as avg_ms, calls, round(total_exec_time::numeric) as total_ms, left(query, 110) as query
-- from pg_stat_statements order by total_exec_time desc limit 15;
