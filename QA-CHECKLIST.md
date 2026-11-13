# QA checklist (run before every release)

Automated (30 seconds, from `client/`):
- [ ] `npm run build` succeeds
- [ ] `npm run lint:design` says OK
- [ ] `npm run prune:css` reports 0 removable rules (otherwise run with `--write` and re-test)
- [ ] `npm run audit:design` web totals did not go up

Open `http://localhost:5173/#design-system` first. If a screen looks different from that page, the screen is wrong.

For EACH module (Visitors, Audit, Backup, Queries, Communication, School, Users, Homework, Fees, Payroll, Documents, Admissions, Attendance, Academics, Transport, Inventory, Timetable, Exam, Student profile):

**Anatomy**
- [ ] Title bar (`PageBar`) first, primary action on the right, filled
- [ ] Tabs only for real sub-views, underline style, no pills
- [ ] One search + Filter button (`FilterBar`), no loose dropdown rows
- [ ] KPI strip is 2-4 numbers; the tone colours the number only
- [ ] Create / edit opens a dialog with Cancel + primary at the bottom; Escape closes it
- [ ] Delete / destructive asks for confirmation first

**States**
- [ ] Loading skeleton, then content (no layout jump)
- [ ] Zero rows shows an empty state with one clear next step
- [ ] A failed request shows an inline error message, not a blank page
- [ ] A save error shows INSIDE the dialog

**Looks**
- [ ] Light mode and dark mode (no white boxes, no unreadable text, no hard-coded colour)
- [ ] 360px phone, 768px tablet, 1280px desktop: no sideways scroll on the page; tables become cards on phones
- [ ] A very long student / item / route name wraps or truncates, never breaks the layout
- [ ] Every tap target is at least 44px on a phone
- [ ] Text contrast is readable (status badges, muted text, disabled buttons)
- [ ] Keyboard: Tab reaches every control, focus ring visible, dialogs trap focus sensibly

**Roles** (check as admin, teacher, parent, student)
- [ ] Buttons the role cannot use are hidden, not just disabled
- [ ] Parent / student screens show only their own data

**Mobile app** (when mirrored): same title, same order, same wording as web.
