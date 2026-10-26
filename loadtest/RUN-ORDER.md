# Run order (small load test, 20x fewer rows)

TEST database only. Paste each file whole into the Supabase SQL editor and press Run, in this order:

1. 01-install.sql        (creates helper functions, inserts nothing)
2. 02-big-school.sql     (school BIG1: 150 students, ~30k attendance, ~25k audit rows)
3. 03-small-schools.sql  (10 small schools SM01..SM10, 45 students each)
4. 04-finish.sql         (ANALYZE + row counts - do not skip)
5. 06-suggested-indexes.sql  (optional but recommended)
6. 05-explain.sql        (optional, run one query at a time)

Logins (password Load@1234): bigadmin, bigteacher1..5, bigparent1..75, bigstudent1..150, sm01admin..sm10admin
Cleanup: 99-cleanup.sql
