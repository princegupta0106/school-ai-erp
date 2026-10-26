-- =====================================================================
-- SUGGESTED INDEXES  (found by the load test - safe to run on production too; each is "if not exists")
--
-- Why: when a user is deleted (Users > Delete user, or a whole school is removed) Postgres must check every table that
-- points at that user (created_by, marked_by, entered_by, sender_id ...). Where the pointing column has no index, it reads the
-- WHOLE table once per deleted user. On the seeded big school, deleting ONE student took ~550 ms and grew with table size;
-- almost all of it was attendance (1.7M rows), marks, notifications and messages.
-- These indexes are partial (only rows where the column is filled), so they stay small. Cost: a little extra work on inserts.
-- Run on the test database first, then 05-explain.sql / delete a test user to see the difference.
-- =====================================================================
set statement_timeout = 0;

create index if not exists attendance_marked_by_idx   on student_attendance(marked_by)  where marked_by is not null;
create index if not exists attendance_updated_by_idx  on student_attendance(updated_by) where updated_by is not null;
create index if not exists marks_student_idx          on assessment_marks(student_id);
create index if not exists marks_entered_by_idx       on assessment_marks(entered_by)   where entered_by is not null;
create index if not exists notifications_created_by_idx on notifications(created_by)    where created_by is not null;
create index if not exists messages_sender_idx        on messages(sender_id);
create index if not exists assessments_created_by_idx on assessments(created_by)       where created_by is not null;
create index if not exists submissions_checked_by_idx on assignment_submissions(checked_by) where checked_by is not null;
create index if not exists assignments_created_by_idx on assignments(created_by)       where created_by is not null;
create index if not exists fee_payments_received_by_idx  on fee_payments(received_by)  where received_by is not null;
create index if not exists fee_payments_cancelled_by_idx on fee_payments(cancelled_by) where cancelled_by is not null;
create index if not exists fee_adj_student_idx        on fee_adjustments(student_id);
create index if not exists fee_adj_created_by_idx     on fee_adjustments(created_by)    where created_by is not null;
create index if not exists fee_adj_voided_by_idx      on fee_adjustments(voided_by)     where voided_by is not null;
create index if not exists fee_accounts_student_idx   on student_fee_accounts(student_id);
create index if not exists visitors_created_by_idx    on visitors(created_by)           where created_by is not null;
create index if not exists announcements_created_by_idx on announcements(created_by)    where created_by is not null;
create index if not exists issued_docs_issued_by_idx  on issued_documents(issued_by)    where issued_by is not null;
create index if not exists issued_docs_cancelled_by_idx on issued_documents(cancelled_by) where cancelled_by is not null;
create index if not exists leave_requests_decided_by_idx on leave_requests(decided_by)  where decided_by is not null;
create index if not exists leave_ledger_created_by_idx on leave_ledger(created_by)      where created_by is not null;
create index if not exists payslips_finalized_by_idx  on payslips(finalized_by)         where finalized_by is not null;
create index if not exists payslips_paid_by_idx       on payslips(paid_by)              where paid_by is not null;
create index if not exists payroll_adj_created_by_idx on payroll_adjustments(created_by) where created_by is not null;
create index if not exists payroll_audit_actor_idx    on payroll_audit(actor_id)        where actor_id is not null;
create index if not exists audit_logs_actor_fk_idx    on audit_logs(actor_id)           where actor_id is not null;
analyze;
