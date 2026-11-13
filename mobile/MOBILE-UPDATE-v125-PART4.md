# Mobile update v125 - Part 4: Timetable

New **Timetable** module (amber, calendar icon), same endpoints and permissions as the web (`/api/timetable`). No server or database change.

The web's wide weekly grids became phone screens: a **day selector** (today pre-selected) plus a list of periods. The all-classes / all-teachers matrices became collapsible groups, one per class or teacher. Each subject keeps its own colour.

Views (shown by permission):
- **My timetable:** teachers see their own week, today's count, workload, cover duties and classes covered by someone else. Students / parents see the class timetable (a child chooser for parents) and a notice when a period today is taken by a substitute.
- **Overview & workload:** teachers / planned / scheduled / still-to-schedule / clashes / substitutions-today tiles, coverage ring, class-wise coverage bars, teacher workload (busiest first or A to Z, red over the limit).
- **Class subjects:** per class, choose its subjects, the teacher of each and periods a week; "also give this plan to" other classes; warns about teachers over the limit.
- **Class timetable:** pick a class, Day-wise or Subject-wise. Tap a period to choose who takes it (busy teachers greyed out, placed-vs-planned counts), clear a period, delete the class timetable, **share as PDF**.
- **Auto generate:** choose classes, keep-or-replace mode, auto-pick teachers; preview, "try another arrangement", save the exact preview, delete old timetable; preview checked day by day for all classes or all teachers.
- **Teacher timetable:** teacher chooser, tiles, day list, "Teaches" chips, share PDF / export CSV.
- **Whole school:** one day at a time, every class or every teacher, share the day as PDF.
- **Substitutions:** "Teacher absent?" with date and teacher, each period with the best free candidates (same subject first), assign / remove, upcoming substitutions.
- **Structure:** school days, teacher weekly limit, periods and breaks (quick start, add, reorder, delete, time pickers), and **periods per week** per class and subject ("same for all").

Rules are enforced by the server as before (no teacher in two classes at once, only assigned subjects, breaks cannot hold a subject, removing a period or teacher clears dependent timetable slots).

Not included (stays in the Users module): the "Teaching" card inside a teacher's profile. The same classes / subjects / teacher links can be set from Class subjects here.

Files: added `src/screens/Timetable.js`; changed `src/modules.js`, `src/search.js`, `src/download.js` (`sharePdfHtml` takes an optional page size, used for landscape timetables), `MOBILE-PARTS-PLAN.md`, `README.md`.
Run: replace files, `npx expo start -c`, sign out and in once. No APK rebuild needed.
