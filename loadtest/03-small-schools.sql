-- =====================================================================
-- LOAD TEST SEED - STEP 3 of 4:  many small schools (multi-tenant noise)
-- >>> TEST DATABASE ONLY <<<   Run 01-install.sql first (02 is not required).
--
-- Your app filters every query by school_id, so the test is only honest when OTHER schools'
-- rows sit in the same tables. This adds 10 schools (codes SM01..SM10) of 45 students each (scaled down 20x from the original 30 x 300).
-- Logins:  sm01admin / sm02admin ...  password Load@1234
-- Takes a few seconds.
-- =====================================================================
set statement_timeout = 0;

select lt_all('SM' || lpad(i::text, 2, '0'), 'sm' || lpad(i::text, 2, '0'), 45, 5, 120, 750)
from generate_series(1, 10) i;
