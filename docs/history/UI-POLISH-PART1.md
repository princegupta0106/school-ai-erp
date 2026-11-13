# UI polish - part 1 (Attendance + Inventory setup + global density)

Files changed: client/src/styles.css (new "POLISH v3" block at the end), client/src/modules/AttendanceModule.jsx, client/src/modules/InventoryModule.jsx.
Rebuild with `npm run build` in client/ (run.bat does this).

- Everything is smaller: base font 14px, header title 20px, buttons/inputs 34px high (mobile keeps 38px tap targets), sidebar 224px.
- "Today" card -> compact left-aligned toolbar (date text left, date picker right).
- Class cards are neutral white with a small coloured status label (no pink alarm cards).
- Class teachers: the whole card is the button; the big Edit button is gone (pencil appears on hover).
- "Class Class 1 A" fixed: the word "Class" is only added when the name does not already start with it.
- Save bar (attendance + roll numbers): one quiet docked bar, compact, button only enabled when there is something to save.
- Roll number inputs are small instead of giant boxes.
- Inventory set-up cards: title/hint left, one small "+ Add" button on the right.
- New helper classes for the next parts: .toolbar, .card-head, .savebar, .btn.sm, .card.flush, .pg-title, .pg-sub, .hint.
