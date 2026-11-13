# Unified Search + Filter update (web)
New: `client/src/FilterBar.jsx` + `ds-fb-*` styles in `client/src/ds.css`; new `filter` icon in `ui.jsx`. `client/dist` is rebuilt.
Converted to FilterBar: Admissions (list + pipeline), Attendance (marking), Audit, Documents (people picker + register), Fees (students),
Homework (now also searchable/sortable), Academics (tests & exams, now searchable), Inventory (items, orders, stock report, issue report),
Queries, Transport (students), Users, Visitors (date is now a filter + sort), Payroll (leave status), Timetable (workload sort),
Student profile search, Communication (new message search).
Left as they were on purpose: form fields inside dialogs, context pickers (session / school / class that choose what a screen is about),
report parameters, and the tab pills that switch between different screens.
Mobile app: done in the same way, see `mobile/FILTER-SYSTEM-UPDATE.md`.
