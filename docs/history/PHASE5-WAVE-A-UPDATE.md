# Phase 5, Wave A - small modules migrated

Phase 4 (pilot: Visitors, Fees) was already in. This drop is the first migration wave.

## Web (client/src/modules) - 7 modules now at 0 inline styles, 0 hex colours
- **Audit**: PageBar (Export CSV in the bar), FilterBar, `DataTable` (cards on phones), `StatusBadge`, read-only `FormDialog` for the entry.
- **Backup**: PageBar with Create backup, `Notice` for running / done / error, History as `ListRow`, restore-from-files as a `Section`.
- **Queries**: New query (Tabs for form types, `FormGrid`), list (`ListRow`), detail (`FormDialog` with Save update), Forms & statuses settings (Sections, `FormDialog` editors, `Choice` for colour).
- **Communication**: Notice board (`Section` per notice, `StatusBadge` for audience, `FormDialog`), Messages (PageBar + `ListRow` list; the chat bubbles keep their own CSS), Send notification (`Choice` + `FormGrid`).
- **School**: Schools list (`ListRow`), school dialog (`FormDialog`), New school, Sessions & holidays (Sections + Add dialogs), Promotion (`FormGrid` + `DataTable` preview).
- **Users**: list (`DataTable`; students grouped by class), user dialog (`FormDialog noForm` with a Section per area), Add user, Classes (Add class dialog).
- **Homework**: teacher list (`ListRow` + status badges), New homework dialog, submissions dialog, student list and submit dialog.
- Shared: `FormDialog` got a `noForm` option. `ds.css` got the small helper classes listed in DESIGN-STANDARD section 2c, so modules need no inline styles.

## Mobile (mobile/src/screens) - mirrored
Audit, Backup, Notice board, Send notification, Queries, Homework now use `PageHeader`, `Section`, `Row`/`List`, `StatusChip`, `EmptyState`, `FormSheet` and the `T` scale (0 hex, 0 hard-coded font sizes or radii).

## Not done yet (still Wave A on mobile)
- mobile `School`, `Users`, `Messages` (web side is done).
- Waves B and C (Payroll, Documents, Admissions, Attendance, Academics; Transport, Inventory, Timetable, Exam, Student profile).

## Behaviour changes to be aware of
- Delete on Sessions and Holidays now asks for confirmation (it did not before).
- Query status colour is still stored as `off`; it is shown as red.
- Homework list rows show class and subject in the sub line, and "x/y submitted" as a badge instead of the little progress bar.
- Audit, Backup, Users and others now show a PageBar title under the app header (same as Visitors and Fees).

## Checks run
Syntax parse of every changed file, plus an undefined-component / unused-import check. The app itself was NOT run or built here (no npm install possible), so please run `run.bat` and click through each migrated screen in light and dark, at phone and desktop width, before the next wave. `node tools/design-audit.mjs` now reports web inline styles 524 -> 371.
