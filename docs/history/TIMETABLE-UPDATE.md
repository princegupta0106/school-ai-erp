# Timetable & Teacher Workload module (new, web)

1. Run `push-sql.bat` (or `node server/scripts/db-push.mjs`) - applies `db/timetable-module.sql`.
2. Restart the server (the web build in `client/dist` is already rebuilt).
3. School admins get everything automatically. For staff, tick on their profile (Users > open user > Feature access):
   `manage_timetable_setup`, `manage_timetable`, `view_timetable`, `manage_substitutions`.
   Teachers, students and parents get **My timetable** (`view_my_timetable`) by default.

## How it works (in this order)
1. **Timetable > Structure** - school days, periods, breaks (and a weekly limit per teacher). "Quick start" gives a ready-made day.
2. **Users > teacher profile > Teaching** (also on *Add user*) - pick subject + classes + periods per week.
   Subjects come from Academics > Subjects, classes from Users > Classes.
3. **Timetable > Class timetable** - tap a box; only teachers who were given that class + subject appear, busy ones are greyed.
   A teacher can never be in two classes at once (checked by the server AND a database unique index).
4. **Overview & workload**, **Teacher timetable** (print / Excel), **Whole school** (one day, every class, print).
5. **Substitutions** - pick date + absent teacher; free teachers are suggested (same subject first, teachers on approved leave are left out).

Files: `db/timetable-module.sql`, `server/src/routes/timetable.js`, `client/src/modules/TimetableModule.jsx`
(+ small edits: features.js, index.js, audit.js, backup.js, registry.js, UsersModule.jsx, styles.css).
Included in audit log and backups. Mobile (Expo) app: not included in this update.

## Update: Subject-wise view + Auto generate + test school
- **Class timetable > Subject-wise** toggle: each subject with its teacher, periods/week and exact days/periods.
- **Timetable > Auto generate**: pick classes -> Preview -> Save. Uses class subjects + teacher assignments, no teacher clashes,
  subjects spread over days, weekly teacher limit respected, optional auto-pick of a teacher for subjects without one.
  API: `POST /api/timetable/auto-generate`.
- **TestSchoolCreationSeed.bat**: creates "Test Public School" (TEST1). Password for all logins: `Test@123`
  testadmin, testteacher1..11, teststudent1..5, testparent1. Re-run any time to rebuild.

## Update 2: predictable timetable
- Periods per week for each class + subject are now set once in **Timetable > Structure > "Periods per week"** (matrix, "same for all" button). Teachers no longer carry period counts.
- Auto generate keeps a teacher in the SAME period row for the same class on all their days (e.g. Period 2 in 6A daily); subjects with few periods (Games 2) get evenly spaced days (Mon+Thu); only leftovers (e.g. the 7th Maths period) become exceptions.
- Preview now shows every class timetable and every teacher timetable before saving.
- New SQL: db/timetable-periods-per-subject.sql (pushed automatically by run.bat / the seed bat).

## Update 3
- Daily subjects are placed first, in the early periods. Light subjects (1-3 periods a week, e.g. games, art) go to Wednesday & Saturday, last / second-last period.
- Auto generate preview and Whole school now show ONE DAY at a time: a grid of all classes and a grid of all teachers for that day (day tabs on top).
- Auto generate defaults to "fresh timetable" so it does not just keep old periods.

## Update 4
- **Timetable > Class subjects** (moved here from Academics): per class, pick subjects, the teacher of each (change any time) and periods a week; remove subjects; copy the same plan to other classes.
- **Delete old timetable**: button on Auto generate (selected / all classes) and "Delete" on Class timetable.
