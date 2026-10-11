# School Portal (modules: School, Users, Attendance, Visitors, Communication, Fees, Academics, Documents, Payroll & Leave, Audit logs)

Updating from the first version? Re-run `db/schema.sql` (safe to re-run) and restart.

1. Supabase -> SQL Editor -> paste and run `db/schema.sql` (once).
2. Double-click `run.bat` (needs Node 18+). It installs, builds and starts http://localhost:3000.
3. Sign in as `princegupta` / `12345678` (created automatically on first start, from `.env`).

## How permissions work
- `server/src/features.js` lists every module and feature. A user sees a module if they hold >= 1 of its features.
- super_admin: all features. school_admin: all features except super-only ones (always, even for future features).
  Others: whatever is in `profiles.features_permission`.
- Every API route declares `requireFeature('...')`; every query is also scoped to the caller's school.
- Add a module: add features in `features.js`, routes in `server/src/routes`, an entry in `client/src/registry.js`.

## Dev mode
`cd server && npm run dev` and `cd client && npm run dev` (UI on :5173, proxies /api).

## Year-end flow (School > Promotion)
1. Users > Classes: give each class an order number (1,2,3...). Students in order n go to n+1 (same section if it exists).
2. School > Sessions & holidays: make sure the current session is set (e.g. 2026-2027).
3. School > Promotion: Preview, then Promote. In ONE database transaction it moves students up, marks the last class as
   graduated (optionally turns their accounts off), closes the session and opens the next one. A session can only be promoted once.

## Other notes
- Salary is hidden from everyone without the `manage_salary` feature (except your own profile).
- "Parent of": a parent can be linked to many students and a student to many parents. `GET /api/users/my-children` returns the signed-in parent's students (for the parent panel later).
- Holidays/sessions: `GET /api/calendar/sessions` and `/api/calendar/holidays` are what leave/attendance/fees modules should read.

## Attendance module (student attendance)
**Re-run `db/schema.sql` once** (safe to re-run). It converts roll numbers to whole numbers 1-100 (invalid or duplicate old values are cleared), adds `class_teachers` and `student_attendance`, and `set_roll_numbers()`.

Features (Users > a user > Feature access; school admins always have all of them):
- `mark_attendance` take / change attendance. `view_attendance_reports` reports.
- `attendance_all_classes` see every class. Without it a user only sees classes assigned to them.
- `edit_past_attendance` edit earlier dates (without it only today is editable). `manage_class_teachers` assign teachers. `manage_roll_numbers` roll numbers.

How it works
- Attendance > Class teachers: pick the staff for each class (one can be the class teacher).
- Attendance > Take attendance: a teacher sees their classes, each showing **Not marked / Partly marked / Marked by whom and when**. Opening an already marked class shows who marked it, and it can still be changed (late arrivals). Everyone starts as Present; tap A / L / Lv for the others, or type absent roll numbers (`3 7 12`) and press Mark absent. Statuses: present, absent, late, leave.
- Roll no.: 1-100, unique inside a class (set in the user form or in bulk under Attendance > Roll numbers: edit, "Fill missing", "Number all A-Z"). Year-end promotion clears roll numbers, so assign them again in the new class.
- Reports: daily overview (every class marked or not), class report (per student, CSV), student report (by month, absent days), low attendance (below X%, CSV). Attendance % = (present + late) / all marked days; leave counts as not attended.
- "Today" uses `SCHOOL_TIMEZONE` from `.env` (default Asia/Kolkata).

Reusable functions live in `server/src/attendance.js` (`getSheet`, `saveSheet`, `classDayStatus`, `dailyOverview`, `classReport`, `studentReport`, `lowAttendance`, `listRolls`, `saveRolls`, `autoAssignRolls`...). `GET /api/attendance/my` returns a student's (or a parent's child's, `?student_id=`) own report for the future parent/student panel.

## Visitors module
Re-run `db/schema.sql` (adds the `visitors` table). Features: `add_visitor`, `view_visitors` (any day), `delete_visitor`.
- Visitors > Add visitor: name (required), purpose (optional); date and time are pre-filled with the school's current date/time (`SCHOOL_TIMEZONE`) and can be changed.
- Visitors > Visitors: today's list by default; pick any date to see that day.

## Communication module
Re-run `db/schema.sql` (adds announcements, conversations, messages and 3 functions).

**Notice board** - audience is the whole school or chosen classes. Class notices are seen by the students, the parents of those students and the teachers assigned to those classes. Posting needs `post_school_announcement` (whole school) or `post_announcement` (classes; teachers only to their assigned classes, unless they have "Access every class"). You can edit/delete/pin your own notices; `manage_announcements` does it for all and sees every notice. Newest first, pinned on top, "Load older notices" for history.

**Messages** - 1-to-1 only (no groups), with full history ("Load earlier messages"), unread counts, and live refresh every few seconds. Who can start a chat: school admins / `message_anyone` -> anyone; teachers & staff -> admins, other staff, and the students + parents of their classes (parents show as "Parent of Rahul (5 A)"); parents -> admins and the teachers of their children's classes; students -> admins and teachers of their class. Anyone in a chat can always reply.

**Default access** (no ticking needed): parents get notice board + messages, students get the notice board, staff get notice board + messages. Posting is never automatic - tick `post_announcement` for teachers. Super admin can post notices (pick a school) but chats are for school accounts.

## Fees module
**Re-run `db/schema.sql`** (safe to re-run; adds fee tables and updates the promotion function), then run `run.bat` again (it installs the new `pdfkit` package).

Features (Users > a user > Feature access; school admins always have all of theirs):
- `manage_fee_structure` define/edit fees per class + payment term. `view_student_fees` pending fees, payment history, receipts. `collect_fees` record payments.
- `adjust_fees` and `cancel_fee_payment` are **admin only** (enforced in code; ticking them on a teacher/clerk does nothing). `view_my_fees` is for parents (automatic) and students (tick it).

How it works
- Fees > Fee structure: per class (all sections share it) and session. Each fee has a **total for the session** and a **payment term**: one time (1 instalment), half yearly (2), quarterly (4), monthly (12), first due on the session start date. After a promotion use "Copy from another session".
- Fees > Student fees: search a student. Shows Total, Paid, Total pending and **Due till today** (only instalments whose date has arrived). Payments are used against the oldest unpaid fees first.
- Record payment: refuses more than the pending balance; receipt numbers (RCP-000001...) are per school and never repeat. Receipts download as PDF; a wrong payment is *cancelled* (admin, with reason), never deleted.
- Adjust fees (admin): discount or extra charge, on one fee or general, with a reason. Removing one keeps it in the history. Parents see everything read-only and can download their children's receipts.
- Year-end promotion remembers each student's class for the closing session, so unpaid old fees stay visible (session switcher on the student page) and can still be collected.

## Academics module (subjects, tests, exams, marks)
**Re-run `db/schema.sql` once** (safe to re-run). It adds `subjects`, `exams`, `assessments`, `assessment_marks` and two functions (`save_marks`, `assessment_stats`).
Nothing is taken on the platform: a teacher creates a test for a class and logs each student's marks; results show up for students and parents.

**Tests vs exams** - a *test* is a one-off for one class and subject (e.g. "Unit test 1"). An *exam* is a named event of a session (Half-yearly, Final) created once; teachers then add an exam *paper* per class and subject. Students see tests and exams in separate tabs.

Features (Users > a user > Feature access; school admins always have all of them):
- `manage_subjects` add/edit/delete subjects. `manage_exams` create exams. `manage_assessments` create tests / exam papers and enter marks.
- `view_academic_reports` class reports and any student's dashboard. `academics_all_classes` every class (without it a teacher only sees classes assigned under Attendance > Class teachers).
- `view_my_academics` is given automatically to students and parents (they only ever see their own / their children's marks).

Flow
1. Academics > Subjects: add Maths, English...  Academics > Exams: add Half-yearly, Final (optional dates).
2. Teacher: Academics > Tests & marks > New test / exam paper > pick class, subject, date, max marks > type the marks (Enter jumps to the next student, "Absent" for absentees) > Save. Marks can be edited any time.
3. Student / parent: Academics > My marks. Tabs: Overview (overall %, subject bars, latest results), Subjects (tests vs exams %, trend), Tests (every test with class average), Exams (per exam table with total and grade). Parents with several children get a picker; an old session can be chosen from the session dropdown.
4. Teacher / admin: Academics > Reports: pick class + session + (all / tests / exams / one exam) to get every student's subject %, overall %, grade and rank, with CSV export. Tap a student to open their full dashboard.

Rules: absent entries are left out of percentages. Pass mark 33% (`PASS_PERCENT` in `server/src/academics.js`); grades A+ >=90, A >=80, B >=70, C >=60, D >=50, E >=33, F below. Subject % = total marks obtained / total maximum. Results stay attached to the student after year-end promotion (old sessions remain viewable).
Reusable functions live in `server/src/academics.js` (`studentDashboard`, `classReport`, `getSheet`, `saveMarks`...). `GET /api/academics/my` (`?student_id=` for a parent) is the student's own dashboard.

## Payroll & Leave module 
**Re-run `db/schema.sql`** in the Supabase SQL editor (safe to re-run), then restart (`run.bat`).
Sidebar > Payroll & Leave. Staff get "My leave & pay" automatically; admins can give other people the permissions
(approve leave, see all leave, grant leave, payroll view, payroll manage, leave rules) from the Users page.
Flow: apply -> auto/manual approval -> balance ledger -> month ends -> Prepare payroll -> Finalize (locks numbers,
extra leave days are cut from salary AND added back to the balance) -> Mark paid.

## Documents module (certificates & report cards)
**Re-run `db/schema.sql`** (safe to re-run; adds `doc_settings`, `doc_templates`, `doc_counters`, `issued_documents` and `next_doc_serial()`), then run `run.bat` again.

Document types: Bonafide, Character (student or staff), Transfer certificate (TC), Activity / achievement (student or staff), Report card, Experience (teacher / staff) and Custom (write any letter).

Features (Users > a user > Feature access; school admins always have all of them):
- `issue_documents` make and print documents. `view_issued_documents` see the register of everything issued. `manage_doc_templates` change letterhead, designs and wording. `cancel_document` is admin only.
- `view_my_documents` is automatic for students, parents, teachers and staff: Documents > My documents shows what was issued to them (parents see their children's) with Print / Save as PDF.

How it works
- Documents > School letterhead (once): principal name and title, affiliation line, place, signature, seal and logo (paste an image link, or upload when R2 storage is set up in `.env`). School name, address and phone come from the School module.
- Documents > Templates & designs: for each type pick one of 6 built-in designs (Classic, Royal, Modern, Emerald, Minimal, Ribbon), colour, portrait / landscape and the wording. Wording uses placeholders such as `{{name}}`, `{{father}}`, `{{class}}`, `{{He_She}}`. To use any design downloaded from the web (Canva, Freepik...), upload it as the "background image": the wording and details are printed on top of it. Respect the licence of designs you download.
- Documents > Issue document: pick a type, search the person, check the details taken from the profile (can be corrected for this one document), see the live preview, then **Issue & print**. The document gets a number that never repeats (e.g. `BON/2026/0001`) and a copy that never changes, even if the profile changes later. TC and character certificates can also be issued to students who have already left.
- Report card: choose the session and which exams become columns (optionally the class-test average). Marks come from Academics and attendance % from Attendance, calculated on the server. Absent papers are left out of the percentage. Add promoted-to class, re-opening date and remarks.
- Documents > Issued documents: search by name or number, filter by type, re-open and re-print. An admin can cancel a wrongly issued document with a reason; it stays in the register and the holder can no longer print it.
- Printing uses the browser: choose "Save as PDF" in the print window for a digital copy; switch on "Background graphics" if borders do not show. Every design prints on exactly one A4 page.

## Audit logs (who did what, when)
**Re-run `db/schema.sql` once** (safe to re-run; adds the `audit_logs` table), then restart. Nothing else to install.
Sidebar > Audit logs.

- **School admin** sees the log of *their own school only* (enforced on the server, whatever the browser sends).
  **Super admin** sees every school: pick one school, "All schools", or "Platform only" (e.g. failed sign-ins for an unknown ID).
  The feature `view_audit_logs` is admin-only: it can never be ticked for teachers, parents, etc.
- **What is recorded** (automatically, by one middleware in `server/src/audit.js`, so new routes are covered without extra code):
  every change (create / edit / delete / save / approve / pay / promote ...), successful *or refused/failed* (with the error);
  sign-ins, failed sign-ins and sign-outs; password changes and resets; role and feature-access changes; and a few sensitive
  *views*: every module and every tab/page a person opens ("Opened Payroll & Leave > My leave & pay"), plus a user's profile, a student's fee account, receipts, payslips, ledgers, student reports, CSV export of the log.
  A super admin's work inside a school appears in that school's log too, so school admins can see it.
- **Each entry has**: time, school, who (name, ID, role), a readable sentence ("Collected Rs 500 (receipt RCP-000007) from Rahul Sharma"),
  who/what it was done to, module, result + status code, IP address, device, and a sanitised copy of what was sent (click a row).
- **Never stored**: passwords, tokens, salary values, message text.
- **Cannot be tampered with**: there is no API to edit or delete a row, and a database trigger blocks UPDATE/DELETE
  (to purge old rows on purpose, run `alter table audit_logs disable trigger audit_logs_immutable;` in the SQL editor).
  Names are copied into each row, so history stays readable after a user is renamed or deleted.
- Filters: search, module, type (change / view / sign-in), result (ok / failed), date range (school time zone), "Load older entries", and Export CSV (latest 5000 matching rows).
- Better wording for a route: add a line to `RULES` in `server/src/audit.js`. IP address is `req.ip`; if you deploy behind a proxy/load balancer add `app.set('trust proxy', 1)` in `index.js` so the real visitor IP is recorded.
- Documents actions (letterhead / template changes, issuing, cancelling, opening an issued document) are logged under the "Documents" module.
- The older Payroll "audit" tab still works; the same actions are now also in the central log.


## AI assistant (chatbot + MCP server) - first module: Payroll & Leave
Add `GEMINI_API_KEY=...` (and optionally `GEMINI_MODEL`, default `gemini-2.5-flash`) to `.env`, then run `run.bat` (it rebuilds the UI).
No database change is needed. A floating sparkle button appears bottom-right for everyone who holds the `use_assistant` feature
(staff and other employees get it automatically, school admins always; tick it for anyone else under Users > Feature access).

**Chat + data questions + actions.** Normal chat and general questions work without tools. Data questions ("how many teachers do we have", "who is in class 5 A", "list schools") use read tools. Actions: super admin "create a new school Green Valley, admin Meena Joshi"; admin or anyone with `create_user` "add student Aman Verma, class 5 A"; also create class, turn an account on/off (confirm card). Login id and password are made automatically when not given (the password is shown once). The bot only sends tool name + params; the backend routes decide if the person may do it (`create_school` is super-admin only, school admins stay inside their school). Tools live in `server/src/ai/tools-admin.js`.

**Try:** "apply leave for today", "leave tomorrow and Friday, sick", "cancel my leave for tomorrow", "what is my leave balance",
"how much salary will I get this month", and as an approver "show pending leave requests", "approve Anita's leave",
"give Anita 2 casual days (note: extra duty)", "prepare payroll for last month".

**How the backend stays in control** (`server/src/ai/`)
- `loopback.js` every tool calls the portal's own `/api/...` routes with the SIGNED-IN person's token. So `authenticate`, `requireFeature`,
  school scoping and the audit log apply exactly as for a button click. The AI can never do more than the person could do by hand.
  Audit entries from the assistant are tagged "(via AI assistant)".
- `tools-leave.js` the tools: name, description, parameters, `features` (who is even told the tool exists), optional `confirm`.
  Details come from the profile and defaults (user, today in `SCHOOL_TIMEZONE`, leave type, reason), so "apply leave for today" needs no questions.
- `registry.js` one list of tools + the permission re-check before running. `chat.js` Gemini loop (REST, no SDK), per-user conversations (in memory).
- **Confirm cards**: money / balance / bulk tools (`grant_leave`, `prepare_payroll`, `finalize_payroll`, `mark_payroll_paid`, `add_payroll_adjustment`)
  never run straight from the model. The UI shows Confirm / Cancel and only the person's button press runs it (single use, bound to that person).
- Endpoints: `GET /api/ai/status`, `POST /api/ai/chat`, `POST /api/ai/confirm`, `POST /api/ai/reset`.

**MCP server** - `POST http://localhost:3000/mcp` (stateless Streamable HTTP, JSON-RPC). Same tools, for Claude Desktop / Cursor / any MCP client.
Authenticate with a portal token: `Authorization: Bearer <token>` where the token is `token` from `POST /api/auth/login` (valid 12 h).
`tools/list` shows only what that person may use. Confirm-type tools need `"confirmed": true`, which the client should send only after the human agreed.
Example client config (clients that support custom headers):
`{ "mcpServers": { "school-portal": { "url": "http://localhost:3000/mcp", "headers": { "Authorization": "Bearer <token>" } } } }`

**Add the next module** (fees, attendance, ...): copy `ai/tools-leave.js` to `ai/tools-fees.js`, write tools that call that module's routes,
spread the array into `TOOLS` in `ai/registry.js`. Nothing else changes (chat, MCP, permissions, confirm cards all pick it up).

**Test (no Gemini key / database needed):** `cd server && npm run test:ai`. It checks permission-based tool visibility, "apply leave for today"
defaults, the confirm flow and that other people cannot confirm your action.

Notes: conversations / pending confirmations live in server memory (restart = new chat; use Redis/a table if you run several servers).
Super admins have no school of their own, so school-level tools ask them to use a school admin account.

## AI assistant - all modules (81 tools)
The chatbot / MCP server now covers every module. Each file in `server/src/ai/` is one area; each tool is only "endpoint + params", the backend decides if the person may do it.
| File | What the AI can do |
|---|---|
| `tools-admin.js` | list/create schools, create users and classes, find people, user details, turn accounts on/off |
| `tools-school.js` | edit school, on/off a school, sessions & holidays, preview/run year-end promotion, update users, link parents, change role, reset password, delete user, permissions (feature access), visitors, audit-log search |
| `tools-attendance.js` | which classes are marked, class roll list, **mark attendance by names / roll numbers**, class & student reports, low attendance, auto roll numbers, parent/student own attendance |
| `tools-academics.js` | subjects, exams, create tests, **enter marks**, marks sheet, class report (rank/grade), student dashboard |
| `tools-fees.js` | student fee account, **record payment**, discount / extra charge, cancel payment, fee structure, add fee, parent "my fees" |
| `tools-communication.js` | read / post / delete notices, find contacts, send and read messages |
| `tools-documents.js` | document types, **issue certificates / report cards**, issued register, cancel, my documents |
| `tools-leave.js`, `tools-payroll-extra.js` | leave & salary (self + approvers + payroll), record leave for others, yearly allotment, leave types, approval mode |

Confirm cards (money, deletion, bulk, things sent to other people): fee payments / adjustments / cancel, new fees, deleting users / holidays / visitors / notices, role & permission changes, password reset, promotion, school on/off, posting notices, sending messages, issuing / cancelling documents, payroll finalize / pay, leave grants.
Super admins pass the school by name (the bot asks if it does not know). Tools that a person's permissions do not allow are not even shown to the model, and the API checks again.
Not covered by the AI: uploading files / images, downloading receipt PDFs, printing documents (use the portal pages).
`npm run test:ai` checks tool visibility, defaults, confirm flows and attendance / fee mappings offline.
