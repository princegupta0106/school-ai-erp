# Exams & Report Cards (simplified)

No terms, no test types, no levels, no weightage. Just:

1. **Exams of each class** - pick a class and list its exams, e.g.
   * 10th: PT1, PT2, Preboard
   * 8th: PT1, Half Yearly, PT2, Annual

   Each exam has a name and max marks. "Use the same exams for all sections" copies the list to every section of that class, and "Copy exams from..." reuses another class's list.
2. **Enter marks** - the teacher picks a class and sees a grid of subjects x exams. He can open an exam for the subjects he is assigned to teach in that class (Users > teacher > Teaching, same as the timetable). Other subjects are view-only. Absent + remark per student.
3. **Results & report cards** - totals, percentage, grade and rank are worked out automatically. Publish (or unpublish) report cards for selected students, print all/selected, preview one.
4. **Performance analysis** - class comparison, subject averages, weak subjects with a trend across the class's exams, grade distribution, top performers, students who need support.
5. **Students / parents** - see the published report card, print it or save it as PDF.

## Install (3 steps)
1. Run `db/exam-report-module.sql` once in the Supabase SQL editor (safe to re-run; adds `exam_structure`, `report_cards`, `assessments.exam_struct_id`).
2. Deploy the `server` folder (changed: `src/examinations.js`, `src/routes/examinations.js`, `src/features.js`).
3. **Rebuild the client**: run `npm install` (first time) and `npm run build` inside `client`, then deploy `client/dist`.
   (The `dist` folder in this zip still contains the previous build, so it must be rebuilt.)

Permissions are unchanged: tick "Enter marks & remarks for the subjects they teach" (`manage_exam_marks`) for teachers, "Set up the exams of each class" (`manage_exam_structure`) for whoever defines exams (admins).

## How the numbers work
* Subject total = sum of the marks of the exams entered for that subject; % = total / their max marks. Absent counts as 0.
* Student total / % = all subjects together. Grade comes from the grading criteria (Exam structure > Grading criteria).
* A student is **complete** when every exam of every subject of the class has marks. Only complete students get Pass / Fail (Fail = any subject in a fail grade) and a class rank; until then the result shows "In progress".
* A report card can be published at any time once a student has some marks (for example after PT1) and published again later with the new marks.

## One module only (Academics removed from the web app)
* The old **Academics** module (My marks, Tests & marks, Reports, Exams) is deleted from the web app. **Exams & Report Cards** is now the only place for marks and results.
* **Subjects** moved into Exams & Report Cards (last tab). Class subjects and teacher assignments are still set in Timetable / Users as before.
* Permissions `manage_subjects`, `academics_all_classes` and `view_my_academics` now sit in the "Exams & Report Cards" group (same keys, nothing to re-tick). The three old keys (`manage_exams`, `manage_assessments`, `view_academic_reports`) are listed as "Academics (mobile app & AI assistant only)".
* Kept on purpose, so nothing else breaks: the server `/api/academics` endpoints and `server/src/academics.js` (used by student profile, documents, the AI assistant and the mobile app). The mobile app still shows its old Academics screen; the old Documents marksheet still reads the old named exams.

## Notes
* Marks are stored as normal `assessments` rows (one per exam + subject, created on the first save), so they also show up in Academics.
* The old tables (`exam_terms`, `exam_test_types`, `exam_levels`, `exam_results`) are no longer used and can be dropped later. Report cards published with the old version are not carried over; publish them again.
* Mobile app: not included (web only).

## Homework: class + subject picker
New homework / file now has one **Class & subject** dropdown (e.g. "6 A · Maths", "7 B · Maths") instead of separate Class and free-text Subject fields.
* Teachers see only the class + subject combos assigned to them (Users > teacher > Teaching / timetable). Admins see every subject of every class.
* A class with no subjects (or a teacher with no combos) is offered as a plain class.
* Server: `GET /api/homework/combos`; creating homework with a `subject_id` is checked against those combos. The AI assistant and the mobile app keep working as before (they still send a class + subject name). The mobile app form is unchanged.
