-- Run once in the Supabase SQL editor.
-- Each school gets a short 2-letter prefix used to build automatic user IDs (AF001, AF002, ...).
-- The server fills the prefix in by itself the first time it is needed (from the school name), so no data change is required here.
alter table schools add column if not exists id_prefix text;
create unique index if not exists schools_id_prefix_uniq on schools (upper(id_prefix)) where id_prefix is not null;
