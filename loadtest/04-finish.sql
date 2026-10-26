-- =====================================================================
-- LOAD TEST SEED - STEP 4 of 4:  refresh statistics + show what you have
-- Always run this after loading: without ANALYZE the database plans queries badly and your timings mean nothing.
-- =====================================================================
set statement_timeout = 0;
analyze;

select 'schools' as "table", count(*) from schools union all
select 'users', count(*) from users union all
select 'student_attendance', count(*) from student_attendance union all
select 'fee_payments', count(*) from fee_payments union all
select 'assessment_marks', count(*) from assessment_marks union all
select 'assignment_submissions', count(*) from assignment_submissions union all
select 'messages', count(*) from messages union all
select 'notifications', count(*) from notifications union all
select 'audit_logs', count(*) from audit_logs
order by 2 desc;
