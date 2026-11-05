// Pushes the SQL files in /db to your Supabase database, so nobody has to paste them into the SQL editor.
//   node scripts/db-push.mjs            run files that are new or changed since last time (schema.sql always first)
//   node scripts/db-push.mjs --force    run every file again
//   node scripts/db-push.mjs --demo     also run demo-seed.sql (it wipes and rebuilds the DEMO1 school)
//   node scripts/db-push.mjs --list     only show what would run
// Two ways to connect (it picks automatically):
//   1. SUPABASE_URL + SUPABASE_SECRET_KEY (what you already have) after the ONE-TIME paste of scripts/bootstrap.sql in the SQL editor.
//   2. SUPABASE_DB_URL (direct Postgres connection string) - no bootstrap needed.
// Exit codes: 0 ok, 1 failed, 2 not configured, 3 one-time bootstrap.sql still has to be pasted.
// Every file in /db is written to be safe to re-run. Just drop a new .sql file into /db and it goes up next time.
// NOTE: never call process.exit() here - on Windows it can crash Node ("UV_HANDLE_CLOSING") while network sockets are closing.
// The script sets process.exitCode and lets Node finish on its own.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(root, '.env') });
const args = new Set(process.argv.slice(2));
const dir = path.join(root, 'db');
const url = process.env.SUPABASE_DB_URL;
const apiUrl = process.env.SUPABASE_URL;
const apiKey = process.env.SUPABASE_SECRET_KEY;

const files = (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.sql')) : [])
  .filter((f) => args.has('--demo') || f !== 'demo-seed.sql')
  .sort((a, b) => (a === 'schema.sql' ? -1 : b === 'schema.sql' ? 1 : a === 'demo-seed.sql' ? 1 : b === 'demo-seed.sql' ? -1 : a.localeCompare(b)));
const hashOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n')).digest('hex');

// a driver per way of connecting: applied(), run(sql), mark(file, hash), close()
// (connect functions return { code } instead of a driver when they cannot continue)
async function viaPg() {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try { await client.connect(); } catch (e) {
    console.error(`\n  Could not connect to the database: ${e.message}`);
    console.error('  Check SUPABASE_DB_URL (password, and use the "Session pooler" string if your network has no IPv6).\n');
    return { code: 1 };
  }
  await client.query('create table if not exists _sql_applied (file text primary key, hash text not null, applied_at timestamptz not null default now())');
  return {
    applied: async () => new Map((await client.query('select file, hash from _sql_applied')).rows.map((r) => [r.file, r.hash])),
    run: (sql) => client.query(sql), // one call = one transaction: a failing file changes nothing
    mark: (f, h) => client.query('insert into _sql_applied(file, hash) values ($1,$2) on conflict (file) do update set hash = excluded.hash, applied_at = now()', [f, h]),
    close: () => client.end().catch(() => {}),
  };
}

async function viaApi() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(apiUrl, apiKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const probe = await sb.rpc('exec_sql', { sql: 'select 1' });
  if (probe.error) {
    const missing = probe.error.code === 'PGRST202' || /exec_sql|schema cache|Could not find/i.test(probe.error.message || '');
    if (missing) {
      console.log('\n  ONE-TIME SETUP needed before SQL can be pushed with your Supabase keys:');
      console.log('    1. Supabase -> SQL Editor -> New query');
      console.log('    2. Paste the contents of  server\\scripts\\bootstrap.sql  and press Run  (run.bat has copied it to your clipboard)');
      console.log('    3. Run run.bat again. This is only needed once.\n');
      return { code: 3 };
    }
    console.error(`\n  Could not reach Supabase: ${probe.error.message}\n  Check SUPABASE_URL and SUPABASE_SECRET_KEY in .env.\n`);
    return { code: 1 };
  }
  return {
    applied: async () => {
      const { data, error } = await sb.from('_sql_applied').select('file,hash');
      if (error) throw new Error(`Cannot read _sql_applied (${error.message}). Run scripts/bootstrap.sql once in the SQL editor.`);
      return new Map(data.map((r) => [r.file, r.hash]));
    },
    run: async (sql) => { const { error } = await sb.rpc('exec_sql', { sql }); if (error) throw new Error(error.message); },
    mark: async (f, h) => { const { error } = await sb.from('_sql_applied').upsert({ file: f, hash: h, applied_at: new Date().toISOString() }); if (error) throw new Error(error.message); },
    close: async () => {},
  };
}

async function main() {
  if (!url && !(apiUrl && apiKey)) { console.log('\n  SQL push skipped: SUPABASE_URL / SUPABASE_SECRET_KEY are not set in .env.\n'); return 2; }
  const conn = url ? await viaPg() : await viaApi();
  if (conn.code) return conn.code;
  console.log(`  Connecting through ${url ? 'the direct database connection' : 'your Supabase URL + secret key'}.`);
  try {
    const done = await conn.applied();
    const todo = files.filter((f) => args.has('--force') || f === 'demo-seed.sql' || done.get(f) !== hashOf(f));
    if (!todo.length) { console.log(`  Database is up to date (${files.length} SQL files already applied).`); return 0; }
    console.log(`  ${todo.length} SQL file(s) to push: ${todo.join(', ')}`);
    if (args.has('--list')) return 0;
    for (const f of todo) {
      process.stdout.write(`  -> ${f} ... `);
      try {
        await conn.run(fs.readFileSync(path.join(dir, f), 'utf8'));
        await conn.mark(f, hashOf(f));
        console.log('done');
      } catch (e) {
        console.log('FAILED');
        console.error(`\n  ${f}: ${e.message}${e.position ? ` (at character ${e.position})` : ''}\n  Nothing from this file was applied. Fix it and run again.\n`);
        return 1;
      }
    }
    console.log('  All SQL pushed to Supabase.');
    return 0;
  } catch (e) {
    console.error(`\n  ${e.message}\n`);
    return 1;
  } finally { await conn.close(); }
}

process.exitCode = await main();
