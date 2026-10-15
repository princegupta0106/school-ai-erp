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


## AI assistant (Users module first) - copied from the wholesale ERP
A floating **Ask AI** button (bottom-right) for everyone who holds the `use_assistant` permission (staff and other employees by default, school admins and super admins always). Type or speak (English / Hindi / Hinglish):
`how many teachers do we have`, `create a student Rahul Sharma in class 5 A`, `turn off Ravi Kumar's account`, `reset the password of Sumit`, `make Sumit a parent of Rahul`, `give Priya the create_user permission`.

**Setup:** put `VELONA_API_KEY` (Gemini through Velona, default model `google/gemini-3.8-flash`, change with `VELONA_MODEL`) **or** `ANTHROPIC_API_KEY` (Claude) in `.env` (optional: `AI_PROVIDER`, `AI_MODEL`, `SCHOOL_NAME`). `run.bat` starts a second window, **School AI service** (`python ai-server\server.py`, port `AI_PORT`, default 8001), next to the portal. It needs Python 3.8+ and **no pip packages**. Manually: `python ai-server/server.py` (Linux / Mac: use `python3`).

**How it behaves** (same engine as the wholesale `agent.py`)
- People are found by fuzzy search (typos, `sumit` = `sumeet`, phone digits). One clear match is used; if several fit it shows tap buttons and asks.
- Anything that changes data (create user, edit, turn on/off, reset password, change role, delete, link parent/students, add class, change permissions) shows a **Confirm card first**. Nothing is saved until you press Confirm. A generated password is shown once after confirming. The header has an "auto-confirm" switch; leave it off.
- The AI calls the portal's own `/api/...` routes **with the signed-in person's token**, so it can never do more than that person could by hand: permissions, school scoping and the audit log apply (entries are tagged "via AI assistant").
- Flow: browser -> `/api/ai/*` (Node checks `use_assistant`, rate limit 20/min) -> Python AI service -> back to `/api/*` as the same person. Conversations and pending actions live in the Python process memory.
- Code: `ai-server/agent.py` (engine + tools), `ai-server/server.py`, `server/src/routes/ai.js` (proxy), `client/src/AssistantChat.jsx`. Test: `cd ai-server && python -m unittest test_ai`.
- Only the Users module is covered so far (create_user, edit_user, set_user_active, reset_password, change_role, delete_user, link_children, create_class, change_features + search/list/details). To add a module: add tool functions + a row in `TOOLS` in `agent.py`. The mobile app has no chat button yet.
- Hosting: deploy `ai-server/` as a second process next to the Node server and set `AI_URL` for the Node server (default `http://127.0.0.1:8001`) and `NODE_URL` for the AI service if the portal is not on `localhost:PORT`.

## Homework & Assignments module
**Re-run `db/schema.sql` once** (safe to re-run; adds `assignments` and `assignment_submissions`) and restart.

- Teacher (feature `manage_homework`, given to every staff account by default; school admins always have it): Homework > New homework / file. Pick one of your assigned classes, title, instructions, optional last date and up to 5 attached files (10 MB each). Two types: **Assignment** (students must submit) or **Study file** (read only).
- Each teacher sees only the homework **they posted** (school admins see all). Open one to see every student of the class: Submitted / Not submitted, download their files, add marks + a remark and press *Mark as checked*. The list shows "x/y submitted, n to check".
- Student (feature `view_my_homework`, automatic): Homework > My homework shows the homework of their own class, with Pending / Submitted / Checked / Overdue. They download the teacher's files, upload their work and an optional note, and can replace it until the teacher has checked it. After checking they see the marks and remark.
- Files are stored in Cloudflare R2 (same bucket as user documents) under `schools/<school>/homework/...`.
- Code: `server/src/homework.js`, `server/src/routes/homework.js`, `client/src/modules/HomeworkModule.jsx`.

## Push notifications & the notification bell (mobile)
Every important event now creates a notification for the people it concerns. It shows in the **bell** (top right of the app, with an unread count, and a "Latest updates" preview on Home) and is also pushed to their phones.

| Event | Who is notified |
| --- | --- |
| Notice posted | whole school, or the students / parents / teachers of the chosen classes |
| New 1-to-1 message | the other person |
| Homework or study file posted | students of that class |
| Homework checked | that student |
| Marks entered for a test | the students and their parents (once per test every 6 hours, so re-saving does not spam) |
| Fee payment recorded | the student and their parents |
| Document issued | the person (and parents of a student) |
| Leave approved / rejected | the employee |
| **Send notification** (Communication > Send notification) | whoever you choose: whole school (everyone / students / parents / staff) or selected classes |

Permissions (Users > feature access, module *Communication*): `send_notification` (to classes you teach) and `send_school_notification` (whole school). School admins have both automatically.

### Setting it up (once)
1. Run `db/push-notifications.sql` in the Supabase SQL editor (creates `push_tokens` and `notifications`).
2. Deploy the new `server/` (no new npm packages needed).
3. In `mobile/` run `run-mobile` again (it installs `expo-notifications` and `expo-device`).
4. Phone alerts need a real phone and an APK/development build - see `mobile/BUILD-APK.md` for the step-by-step.
5. In the app: bell > **Turn on phone alerts** registers the phone and tells you if something is wrong.

Code: `server/src/notify.js`, `server/src/routes/notifications.js`, `mobile/src/push.js`, `mobile/src/screens/Notifications.js`, `mobile/src/screens/SendNotification.js`.
