# Student 360° Profile (web)

One screen with everything about a student: attendance, marks, fees, homework, family and certificates.

## Who sees what
- Parent / Student: "Student profile" module on Home (own or linked children; several children get a switcher). Fees included.
- Teacher / Staff: "Student profiles" tab, search by name / roll no. / ID, limited to the classes they can use (same rule as Attendance). The Fees card shows only if they hold a fee-view permission.
- School admin / Super admin: every student (super admin picks a school first).
- Permissions: `view_student_profile` (staff default) and `view_my_student_profile` (parent/student defaults). Adjustable under Users > feature access.

## What was added
- server/src/studentProfile.js: gathers data by re-using Fees, Attendance and Academics (same numbers, same access checks). Each section fails independently.
- server/src/routes/studentProfile.js: GET /api/student-profile/my, /search?q=, /:id?session_id=
- server/src/features.js and index.js: new module, 2 permissions, route registration.
- client/src/modules/StudentProfileModule.jsx, `.sp-*` styles at the end of styles.css, entry in registry.js.
- Header chips (Regular, Top performer, Fee due, Low attendance, homework overdue...) are worked out automatically. Extra chips come from profiles.extra.tags (array of text) if you store any.
- No database changes.

## Run
Restart the server so the new routes load, then sign out and in once so new permissions reach each user.
client/dist is already rebuilt.

## Automatic SQL push (run.bat)
Uses your existing SUPABASE_URL + SUPABASE_SECRET_KEY. No database password needed.

One-time setup (about 30 seconds):
1. Run run.bat. On the first run it says setup is needed and copies `server/scripts/bootstrap.sql` to your clipboard.
2. Supabase > SQL Editor > New query > paste > Run.
3. Run run.bat again. From now on step 2 of run.bat pushes every file in `db/` by itself.

Details:
- schema.sql goes first, then the other files in `db/`. Already-applied files are skipped (remembered in table `_sql_applied`); a new or edited file goes up on the next run.
- Drop any new `.sql` file into `db/`. Files should be safe to re-run (`create table if not exists`, `add column if not exists`...), like the existing ones.
- `demo-seed.sql` is skipped unless you run `push-sql.bat --demo`. `--force` re-sends everything, `--list` shows what would run.
- The helper `exec_sql` can only be called with the secret (service_role) key, never by anon or logged-in users.
- If a file fails, nothing from that file is applied and you choose whether to start the portal anyway.
- Optional: if you set SUPABASE_DB_URL it uses a direct Postgres connection instead and no setup paste is needed.
