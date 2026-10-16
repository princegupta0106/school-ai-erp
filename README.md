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


## AI assistant (Users + Fees + Visitors + Leave & Payroll + Attendance + Documents + Homework + Communication + Academics modules) - copied from the wholesale ERP
A floating **Ask AI** button (bottom-right) for everyone who holds the `use_assistant` permission (staff and other employees by default, school admins and super admins always). Type or speak (English / Hindi / Hinglish):
`how many teachers do we have`, `create a student Rahul Sharma in class 5 A`, `turn off Ravi Kumar's account`, `reset the password of Sumit`, `make Sumit a parent of Rahul`, `give Priya the create_user permission`.

**Fees (needs the matching fee permission; the AI can only do what that person can do by hand)**
- Look up: `how much fees does Sumit Pal of 5 A owe`, `who has not paid in class 5`, `dues above 5000 with parent phone numbers`, `how much was collected today / this month`, `cash collected yesterday`, `find receipt RCP-000012`, `show the fee structure of class 5`. Parents and students can ask `how much fees is pending for my child` (read only).
- Do (Confirm card first): `Sumit Pal paid 5000 by UPI` (collect_fees), `give Sumit a 1000 sibling discount on tuition fee` and `cancel receipt RCP-000012, wrong student` (school admins only), `add Lab Fee 1200 one time to class 5`, `change tuition fee of class 5 to 30000`, `copy fees from 2025-26 to 2026-27` (manage_fee_structure).
- Safety: payments, discounts / charges, cancellations and fee-structure changes **always** need a Confirm tap, even when the chat's auto-confirm switch is on. A payment can never exceed the pending balance; amounts come from the portal, never from the AI's own arithmetic. Receipt / statement / report PDFs stay on the Fees page.
- Test: `cd ai-server && python -m unittest test_ai test_ai_fees test_ai_visitors test_ai_payroll test_ai_attendance test_ai_documents test_ai_homework test_ai_communication test_ai_downloads test_ai_academics`.

**Visitors (needs `view_visitors` / `add_visitor` / `delete_visitor`)**
- Look up: `who visited today`, `visitors yesterday`, `visitors from 10 to 16 October` (up to 14 days), `did anyone come for admission this week`.
- Do (Confirm card first): `add visitor Ramesh Gupta, admission enquiry` (date and time default to today / now; `at 2:30 pm` works), `delete the Courier entry from yesterday`. Deleting always needs a Confirm tap, even with auto-confirm on. Someone who may only add visitors cannot see the list (same as the portal).

**Setup:** put `VELONA_API_KEY` (Gemini through Velona, default model `google/gemini-3.8-flash`, change with `VELONA_MODEL`) **or** `ANTHROPIC_API_KEY` (Claude) in `.env` (optional: `AI_PROVIDER`, `AI_MODEL`, `SCHOOL_NAME`). `run.bat` starts a second window, **School AI service** (`python ai-server\server.py`, port `AI_PORT`, default 8001), next to the portal. It needs Python 3.8+ and **no pip packages**. Manually: `python ai-server/server.py` (Linux / Mac: use `python3`).

**How it behaves** (same engine as the wholesale `agent.py`)
- People are found by fuzzy search (typos, `sumit` = `sumeet`, phone digits). One clear match is used; if several fit it shows tap buttons and asks.
- Anything that changes data (create user, edit, turn on/off, reset password, change role, delete, link parent/students, add class, change permissions) shows a **Confirm card first**. Nothing is saved until you press Confirm. A generated password is shown once after confirming. The header has an "auto-confirm" switch; leave it off.
- The AI calls the portal's own `/api/...` routes **with the signed-in person's token**, so it can never do more than that person could by hand: permissions, school scoping and the audit log apply (entries are tagged "via AI assistant").
- Flow: browser -> `/api/ai/*` (Node checks `use_assistant`, rate limit 20/min) -> Python AI service -> back to `/api/*` as the same person. Conversations and pending actions live in the Python process memory.
- Code: `ai-server/agent.py` (engine + tools), `ai-server/server.py`, `server/src/routes/ai.js` (proxy), `client/src/AssistantChat.jsx`. Test: `cd ai-server && python -m unittest test_ai`.
- Modules covered: Users, Fees, Visitors, Leave & Payroll, Attendance, Documents, Homework. To add a module: add tool functions + rows in `TOOLS` in `agent.py`, list its write actions in `EXEC` (and in `ALWAYS_CONFIRM` if they must never auto-run), mention it in `system_prompt`, and add a `test_ai_<module>.py`.
- Hosting: deploy `ai-server/` as a second process next to the Node server and set `AI_URL` for the Node server (default `http://127.0.0.1:8001`) and `NODE_URL` for the AI service if the portal is not on `localhost:PORT`.

## Homework & Assignments module
**Re-run `db/schema.sql` once** (safe to re-run; adds `assignments` and `assignment_submissions`) and restart.

- Teacher (feature `manage_homework`, given to every staff account by default; school admins always have it): Homework > New homework / file. Pick one of your assigned classes, title, instructions, optional last date and up to 5 attached files (10 MB each). Two types: **Assignment** (students must submit) or **Study file** (read only).
- Each teacher sees only the homework **they posted** (school admins see all). Open one to see every student of the class: Submitted / Not submitted, download their files, add marks + a remark and press *Mark as checked*. The list shows "x/y submitted, n to check".
- Student (feature `view_my_homework`, automatic): Homework > My homework shows the homework of their own class, with Pending / Submitted / Checked / Overdue. They download the teacher's files, upload their work and an optional note, and can replace it until the teacher has checked it. After checking they see the marks and remark.
- Files are stored in Cloudflare R2 (same bucket as user documents) under `schools/<school>/homework/...`.
- Code: `server/src/homework.js`, `server/src/routes/homework.js`, `client/src/modules/HomeworkModule.jsx`.

## Homework from the AI chat (teachers)
**No database change and no new packages.** Deploy the new `server/` and `ai-server/` (and rebuild the web app / phone app) and it works.
Needs the same permissions as the Homework page: `manage_homework` (every staff account has it) + `use_assistant`. Students and parents do not use this; they see homework on the Homework page.

How a teacher uses it (web: **Ask AI**; phone: the sparkle button)
1. Tap the **paperclip** in the chat and pick up to 5 files (PDF, photo, Word, Excel, PowerPoint, text; 10 MB each). They show as chips above the message box.
2. Type or speak: `homework for 5 A maths, solve exercise 3.2 questions 1 to 10, last date Friday` (English / Hindi / Hinglish) and send. The files are uploaded then.
3. A **Confirm card** shows the class, subject, title, instructions, whether students must upload their work, the last date (written out, e.g. *Friday, 23 Oct 2026*) and the attached files. Press **Confirm**: the homework is posted, the files are attached, and the students of that class get a notification (bell + phone push), exactly like a homework posted from the Homework page.
- Words like `tomorrow`, `friday` are worked out by the portal from the school's date (`SCHOOL_TIMEZONE`), never by the AI. A date that has passed is refused.
- `Assignment` (students submit) is the default. Say it is notes / study material / only for reading and it is posted as a **Study file** (read only, no last date).
- Several classes in one message (`same for 5 A and 5 B`) give one card per class, each with the files. A file already used is not attached again to a later, unrelated homework in the same chat, unless you say `use the same file`.
- A teacher can only post to the classes assigned to them (school admins: any class). Posting a title that already exists for that class shows a warning on the card.
- The AI cannot read what is inside a file; it only attaches it.

Also in the chat (same permission): `what homework did I give this week`, `which homework is past its last date`, `what is waiting to be checked`, `who has not submitted the maths homework of 5 A`, `give Rahul 8/10 on the fractions worksheet, neat work` (marks the work as checked and tells the student), `delete the poem notes homework`.
**Posting, checking and deleting always need a Confirm tap, even with auto-confirm on** (posting notifies a whole class). To allow auto-confirm for posting, remove `"create_homework"` from the `ALWAYS_CONFIRM.update(...)` line in the HOMEWORK section of `ai-server/agent.py`.

How the files travel (so you can debug it)
- Files chosen in the chat are sent to `POST /api/homework/chat-files` and wait in a temporary R2 folder `staging/homework/<user id>/`. Nothing is posted yet. The AI service only ever receives small references to them, never the file.
- On Confirm, `POST /api/homework/assignments` is called with `staged_files`; the portal checks every file is in **that teacher's own** staging folder, **copies** it into `schools/<school>/homework/<homework id>/` and then creates the homework. If anything fails, no half-made homework or stray copy is left.
- Files nobody confirmed are deleted automatically after 24 hours (a clean-up runs at start and every 6 hours; it needs R2). Optional extra: in Cloudflare R2 > bucket > Settings > Object lifecycle, add a rule to delete the prefix `staging/` after 1 day.
- Audit log: the upload shows as "Attached files to a homework in the AI chat (not posted yet)"; the posting itself is logged as before, tagged "via AI assistant".
- Code: `server/src/stagedFiles.js` (rules), `server/src/homework.js` (`stageFiles`, `createAssignment`), `server/src/routes/homework.js` (`/chat-files`, `/meta`), `server/src/routes/ai.js` (only forwards the person's own files), `ai-server/agent.py` (HOMEWORK section), `client/src/AssistantChat.jsx`, `mobile/src/screens/Assistant.js`.
- Tests: `cd server && npm test` (includes `test/homework-chat.test.js`) and `cd ai-server && python -m unittest test_ai_homework`.

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

**Attendance (uses the same permissions and class access as the Attendance pages)**
- Look up (`mark_attendance` or `view_attendance_reports`): `which classes have not taken attendance today`, `who is absent in 5 A today`, `attendance of 6 B yesterday`. Teachers only see the classes assigned to them (unless they have `attendance_all_classes`).
- Reports (`view_attendance_reports`): `attendance report of Priya Singh this month`, `5 A attendance report last month`, `who is below 75% attendance`, `students under 60% in class 7`. Percentages come from the portal: (present + late) / marked days.
- Take attendance (`mark_attendance`, Confirm card first): `5 A everyone present except Priya and roll 2 late`, `mark 6 B yesterday all present` (earlier dates need `edit_past_attendance`; future dates are refused). Re-marking a day just updates it.
- Class teachers and roll numbers (`manage_class_teachers` / `manage_roll_numbers`): `who takes attendance of 5 B`, `assign Anil Rao to 5 B and make him class teacher`, `give roll numbers to class 5 A`, `renumber 5 A by name`, `set Priya's roll no to 12`. These **always** need a Confirm tap, even with auto-confirm on.
- Students and parents: `how is my child's attendance this month` (read only, `my_attendance`).

**Documents (certificates and report cards; uses the same permissions as the Documents pages)**
- Look up: `what documents did we issue to Priya` / `show cancelled documents` / `find BON/2026/0003` (`view_issued_documents` or `issue_documents`), `what types of certificate can we issue` (`document_types`). Students, parents and staff: `show my documents` / `which certificates were issued for my child` (`view_my_documents`, read only).
- Issue (`issue_documents`, Confirm card first): `issue a bonafide certificate for Sumit Pal of 5 A for bank account opening`, `character certificate for Meena Gupta`, `transfer certificate for Priya, moving to Delhi`, `achievement certificate for Rahul, First Position in Inter-school Quiz`, `experience certificate for Ravi, last day 31 October`, `report card of Priya for the Half Yearly exam`, `custom letter: NO OBJECTION CERTIFICATE, Rahul of 6 B may join the trip`. The wording, design and letterhead are the school's saved template (or the built-in one); the serial number, marks, result and attendance come from the portal, never from the AI. Only the details the person names are changed, the rest default from the profile. A detail can be corrected on that one document only (`father name is Rajesh Singh`); the profile is not touched.
- Cancel (`cancel_document`, school admins only): `cancel BON/2026/0003, wrong class` (a reason is required; the number stays in the register as cancelled).
- School wording (`manage_doc_templates`): `change the principal to Mrs Iyer`, `make the bonafide certificate royal design`, `reset the transfer certificate to the built-in wording`, `change the bonafide wording to ...`. Only known `{{placeholders}}` are accepted. Logos, signature and seal images are still uploaded on the Documents page.
- Safety: issuing, cancelling and changing / resetting a template **always** need a Confirm tap, even with auto-confirm on. PDFs are not made in the chat; open them under Documents > Issued documents / My documents.
- The built-in wording in `agent.py` (`DOC_TYPES`) is a copy of `client/src/docRender.js`; `test_ai_documents.py` fails if the two differ, so change both together.

**Leave & payroll (uses the same permissions as the Leave & Payroll pages)**
- Everyone with `my_leave`: `how many casual leaves do I have left`, `apply casual leave on 22 and 23 October, family function`, `cancel my leave request`, `show my last payslips`.
- Approvers (`leave_approve` / `leave_view_all`): `who is on leave today`, `pending leave requests`, `approve Ravi's leave`, `reject it, exams are on`, `record 1 day sick leave for Ravindra on 10 October` (approved at once), `leave balance of Ravi Kumar`.
- HR (`leave_grant`): `give everyone their 2026-2027 casual leave quota`, `give Ravi 2 extra days, note: exam duty`, `deduct 1 day from Ravi, correction`.
- Payroll (`payroll_view` to look, `payroll_manage` to act): `payslips of last month`, `who has no payslip yet`, `add a 2000 Diwali bonus for Ravi in October`, `prepare payroll for September`, `finalize September payslips`, `mark September salary paid by bank transfer`, `reopen Ravi's September payslip`.
- Rules (`payroll_settings`): `make leave approval automatic`, `Sunday and Saturday are weekly off`, `add Study Leave 5 days a year`, `change casual leave to 15 days`.
- Safety: leave decisions / cancellations, balance grants, bonuses / deductions, generating, finalizing, paying and reopening payroll and rule changes **always** need a Confirm tap, even with auto-confirm on; only applying for one's own leave can be auto-confirmed. The portal still refuses locked months, months finalized out of order and approving your own leave. "Mark paid" only records the payment, it never sends money. Leave days and payslip amounts are always worked out by the portal, never by the AI.

## AI chat: download cards (v45 checkpoint 8)
When someone asks the assistant for a file, the chat now shows a **download card** (web and mobile app):

| Ask | Card |
| --- | --- |
| "give me receipt RCP-000012", "last receipt of Sumit Pal" | Fee receipt (PDF) |
| "fee statement of Sumit Pal" | Fee statement (PDF) |
| "pending fees of class 5 as excel", "this month's collection pdf" | Fee report (PDF / CSV) |
| "give me BON/2026/0003", "download Priya's TC" | Issued certificate / report card (Print / Save as PDF) |
| after you confirm "record payment" | Receipt of the new payment appears by itself |
| after you confirm "issue certificate" | The new document appears by itself |

Parents and students can get **their own children's** receipts, statements and documents. Staff need the same permissions as the matching Fees / Documents pages.

How it works: the AI service's new tools (`get_receipt`, `get_fee_statement`, `get_fee_report`, `get_document_file`) add a card holding only a portal path. The app downloads it with the person's own sign-in, so the portal still decides access. `server/src/routes/ai.js` lets only the known receipt / statement / report / issued-document routes through. Tests: `python -m unittest test_ai_downloads` (from `ai-server/`). Redeploy the **server**, the **AI service** and the **web app**; for the phone app rebuild the APK (or push an OTA update).

### Checkpoint 9: the download button always shows
- A **⬇ Download** button (never "Print") appears on every receipt / statement / report / certificate card. Certificates now download as a real PDF file on the web (drawn in the browser with html2canvas + jsPDF, so run `npm install` in `client/`); the phone app saves / shares the PDF.
- Cards no longer depend on the AI choosing a tool: if the person asked for a receipt or certificate (receipt, download, pdf, certificate, TC, bonafide ...) and any lookup found one, the card is added automatically (max 3, newest first). Plain questions like "how much does Sumit owe" get no card.
- After **Confirm** on a payment or a new document the card is always added; if the portal does not return the new id, the service looks the receipt / serial up itself.

### Checkpoint 10: Communication in the AI chat
The assistant now covers the **Communication** module, with the same permissions as the Communication pages:

| Ask | What happens |
| --- | --- |
| "what notices are up?", "find the PTM notice" | Reads the notice board |
| "post a notice for 5 A: maths test Monday" / "tell the whole school the school is closed Friday" | Confirm card, then posts; the audience is notified |
| "pin the PTM notice", "change the PTM time to 11 am", "delete the maths test notice" | Confirm card, then edits / deletes (own notices, or any if you manage the board) |
| "any new messages?", "what did Priya say?" | Reads your inbox / a chat (opening a chat marks it read) |
| "message Priya Verma: please send the marks" | Finds the person (typos are fine), confirm card, then sends from your account |
| "send a notification to all parents: school closes at 12" | Confirm card, then sends a push alert to the class / school |

Everything that tells other people something (post, edit, delete, message, notification) **always** needs a Confirm tap, even with auto-confirm switched on. Text inside notices and messages is treated as data: the assistant never follows instructions written in them. Tests: `python -m unittest test_ai_communication` (from `ai-server/`). Only the AI service and the two chat screens changed; the portal's Communication routes are untouched.

### Checkpoint 11: Academics in the AI chat
The assistant now covers the **Academics** module (subjects, exams, tests and marks), with the same permissions as the Academics pages. **No database change, no new packages**: redeploy the **AI service** (and the **server**, which has a small fix, see below) and rebuild the web app / phone app for the new example prompts.

| What you can say | Tool | Needs |
|---|---|---|
| "Which subjects / exams do we have?" | `academics_overview` | any academics permission |
| "How is Priya of 5 A doing in maths?" | `find_academic_student`, `student_academics` | `view_academic_reports` |
| "Toppers of 5 A in the Half-yearly", "who failed the final in 6 B" | `class_academics` | `view_academic_reports` |
| "Which tests did I take?", "who has no marks in the unit test?" | `academic_assessments`, `assessment_marks` | `manage_assessments` or `view_academic_reports` |
| "How did my child do?" (parents / students) | `my_academics` | `view_my_academics` (read only) |
| "Add subject Science" / rename / delete | `add_subject`, `update_subject`, `delete_subject` | `manage_subjects` |
| "Create the Half-yearly exam from 20 to 30 Sept" / change / delete | `create_exam`, `update_exam`, `delete_exam` | `manage_exams` |
| "Unit test 2 for 5 A maths, 25 marks" / change / delete | `create_assessment`, `update_assessment`, `delete_assessment` | `manage_assessments` |
| "Marks of unit test 1, 5 A: Rahul 18, Priya 6, Amit absent" | `enter_marks` | `manage_assessments` |

- Percentages, grades, ranks, class averages and pass / fail are worked out by the portal and only repeated by the assistant. Teachers only reach the classes assigned to them (unless they hold `academics_all_classes`), exactly as on the Academics page.
- Marks are matched to students by name (typos are fine) or roll number; an unclear name makes the assistant ask. A mark above the test's maximum, a student listed twice, or marks that are already entered are refused with a plain explanation.
- **Always a Confirm tap, even with auto-confirm on:** entering marks (it notifies students and parents and may replace marks), changing or deleting a test / exam paper, deleting a subject or an exam. Adding a subject, creating an exam or creating a test can run under auto-confirm (nobody is notified). To make those always confirm too, add their names to the `ALWAYS_CONFIRM.update(...)` line in the ACADEMICS section of `ai-server/agent.py`.
- Creating a test and entering its marks are two steps: confirm the test first, then give the marks (the assistant finds the new test by itself).
- **Server fix (found while adding this):** in `server/src/academics.js` a line that tells families "marks added" was in `updateAssessment` (where it crashed when a test was edited) instead of `saveMarks`. It is now in `saveMarks`, so editing a test works and families are notified when marks are saved.
- Code: `ai-server/agent.py` (ACADEMICS section), `client/src/AssistantChat.jsx` and `mobile/src/screens/Assistant.js` (example prompts). Test: `cd ai-server && python -m unittest test_ai_academics`.
