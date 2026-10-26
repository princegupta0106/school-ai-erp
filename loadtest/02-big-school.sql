-- =====================================================================
-- LOAD TEST SEED - STEP 2 of 4:  the BIG school (this is the one you log in to)
-- >>> TEST DATABASE ONLY <<<   Run 01-install.sql first.
--
-- The data is small now, so you can paste and run the whole file in one go.
-- Re-running block A wipes the school (code BIG1) and starts again; run B..E after it.
--
-- ===== LOGIN =====   school admin :  bigadmin      password: Load@1234
--                     teacher      :  bigteacher1   password: Load@1234
--                     parent       :  bigparent1    password: Load@1234
--                     student      :  bigstudent1   password: Load@1234
--
-- SIZE (normal tier, edit the numbers below to change):
--   150 students | 75 parents | 5 teachers | 12 classes | ~30k attendance rows | ~9k marks
--   ~400 fee payments, 25k audit rows, 10k chat messages, 10k notifications (04-finish.sql prints the exact counts)
--   (this is the original test scaled DOWN 20x: 3000 students -> 150, 500k audit -> 25k, etc.)
-- Logins that exist: bigteacher1..5, bigparent1..75, bigstudent1..150
-- Attendance days are capped by the session length (about 250 working days).
-- =====================================================================
set statement_timeout = 0;

-- ---- A) school, classes, people, fee structure (about 20-60 s)
select lt_base('BIG1', 'big', 150, 5);

-- ---- B) attendance: every student x 200 school days (about 30-90 s)
select lt_attendance('BIG1', 200) as attendance_rows;

-- ---- C) fees (payments, discounts)
select lt_fees('BIG1') as fee_payments;

-- ---- D) exams, tests, marks, homework, payroll, leave
select lt_academics('BIG1', 6) as marks_rows;

-- ---- E) notices, visitors, chats, notifications, documents, audit log
--          notices, visitors, conversations, messages, notifications, documents, audit rows
select lt_comms('BIG1', 30, 1000, 75, 10000, 10000, 750, 25000);
