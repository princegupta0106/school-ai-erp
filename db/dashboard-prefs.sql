-- Dashboard customisation (final DB file for this change)
-- Each person's layout is stored as JSON in users.ui_prefs. The dashboard adds two keys to it:
--   dashHidden : ids of dashboard cards the person removed
--   dashOrder  : ids in the order the person wants them
-- The column already exists in schema.sql; this is safe to run any number of times.
alter table users add column if not exists ui_prefs jsonb;
