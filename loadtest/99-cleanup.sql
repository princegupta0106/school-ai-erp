-- =====================================================================
-- REMOVE ALL LOAD-TEST DATA (only the fake schools BIG1 and SM01..SM10; any other school is untouched)
-- TEST DATABASE ONLY. Takes a while for the big school.
-- =====================================================================
set statement_timeout = 0;
select lt_drop(code) from schools where code = 'BIG1' or code ~ '^SM[0-9]{2}$';
-- to also remove the helper functions:
-- drop function if exists lt_drop(text), lt_base(text,text,int,int), lt_attendance(text,int), lt_fees(text), lt_academics(text,int),
--   lt_comms(text,int,int,int,int,int,int,int), lt_all(text,text,int,int,int,int);
