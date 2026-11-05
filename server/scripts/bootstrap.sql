-- ONE-TIME SETUP for "run.bat pushes SQL to Supabase" (paste into Supabase -> SQL Editor -> Run, once).
-- Adds a helper that runs SQL text, and a table remembering which db/*.sql files were already pushed.
-- The helper can ONLY be called with your secret (service_role) key - never by the public/anon key or logged-in users.
create table if not exists _sql_applied (
  file text primary key,
  hash text not null,
  applied_at timestamptz not null default now()
);
alter table _sql_applied enable row level security; -- no policies: only the service role can read/write it

create or replace function exec_sql(sql text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('statement_timeout', '0', true);
  execute sql;
  notify pgrst, 'reload schema';
end $$;

revoke all on function exec_sql(text) from public, anon, authenticated;
grant execute on function exec_sql(text) to service_role;
