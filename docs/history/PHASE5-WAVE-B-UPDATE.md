# Phase 5, Wave B - medium modules migrated (web)

Payroll, Documents, Admissions, Attendance, Academics now follow DESIGN-STANDARD.md.
Fees was already done in the pilot. Exports and routes are unchanged (registry.js untouched), server untouched.

## What changed per module (web, client/src/modules)
- **Payroll** (My leave & pay, Leave requests, Balances & grants, Payroll, Leave rules): every screen is `Page > PageBar > (Tabs) > KpiGrid > Section`. Balances/payroll tables are `DataTable` (cards on phones). Apply / record leave, grant, salary, payment, bonus and leave-type forms are `FormDialog`. The inline "add leave type" row is now an Add dialog. Payslips open in a read-only `FormDialog`. 0 inline styles.
- **Documents** (Issue, Issued register, My documents, Templates, Letterhead): `PageBar` on every screen, register is `DataTable`, viewer and cancel are `FormDialog` (cancel is a danger dialog with reason), kind pickers are `Choice`, Save buttons live in the `PageBar`. The A4 preview, type cards and design thumbnails keep their own CSS (they are previews, not UI chrome).
- **Admissions** (Overview, Enquiries, Pipeline, Add enquiry, Reports): `KpiGrid`, `Section`, `ListRow`, `StatusBadge`; edit / admit are `FormDialog`; source, follow-up kind pickers are `Choice`. The side drawer and kanban board keep their `adm-` layout CSS.
- **Attendance** (Take, Reports, Roll numbers, Class teachers): `PageBar` with date / back actions, report tabs are `Tabs` (also the date presets), `KpiGrid`, `DataTable` for class and month tables, `ListRow` for lists, teacher assignment is a `FormDialog`. Class cards and the tap-to-mark rows keep their CSS (core interaction). `scoped()` is unchanged apart from the school select class.
- **Academics** (Marks dashboard, Tests & marks, Marks sheet, Reports, Subjects, Exams): dashboard is `PageBar` + `KpiGrid` + `Tabs`; test / exam lists are `ListRow`; Create / Edit test, subject and exam are `FormDialog` (Subjects "Add" moved from an inline row to a dialog, same as Wave A rule 19). The marks entry grid keeps its CSS.

## Shared
- `ds.css` "Wave B additions": `ds-color`, `ds-nowrap`, `ds-details`, `ds-ctx-select`, `adm-pad`.
- Icon names fixed to ones that exist in `ui.jsx` (`users`, `doc`, `sparkle`).

## Behaviour changes
- Payroll: leave-type add, subjects add and "Record leave" are dialogs, not inline rows.
- Payroll: errors from saves now show inside the dialog instead of a toast.
- Documents / Attendance / Academics / Admissions / Payroll screens now show a PageBar title under the app header (like Visitors and Fees).
- Student report in Attendance and the Class / Month tables are now DataTables (stacked cards under 760px).
- Payroll "Leave rules" form saves from a button in the section header.

## Not done yet
- Mobile mirror of Wave B (Payroll, Documents, Admissions, Attendance, Academics screens) and the mobile School / Users / Messages from Wave A.
- Wave C (Transport, Inventory, Timetable, Exam, Student profile).

## Checks run
Every changed file parses (esbuild), no missing / undefined `ui.jsx` imports, exports used by `registry.js` and other modules unchanged. `node tools/design-audit.mjs`: web inline styles 371 -> 187; Payroll, Documents, Admissions, Attendance, Academics now have 0-1 (one dynamic width bar each, which is allowed), 0 hex.
The app was NOT run or built here (no npm install possible). Please run `run.bat` and click through each of the five modules in light and dark, at phone and desktop width, before Wave C.
