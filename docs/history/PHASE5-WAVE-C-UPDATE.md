# Phase 5, Wave C - heavy modules migrated (web)

Transport, Inventory, Student profile, Exam and Timetable now follow DESIGN-STANDARD.md at the chrome level
(header, KPI strip, sections, tables, forms/dialogs, empty/error states, tabs, status colours).
Routes, exports and the server are untouched (registry.js untouched).

## Per module (client/src/modules)
- **Transport**: every screen is `Page > PageBar > KpiGrid/Section`. Bus, route, stop and "student transport" forms are `FormDialog`
  (delete is a danger button inside the edit dialog). Route direction is a `Choice`. **Add stop** is now a dialog (was an inline form).
  Route / bus / stop identity colours come from `--cat-*` tokens. 0 hex.
- **Inventory**: `PageBar` on every screen, `KpiGrid`, `Section`, `DataTable` (cards on phones; the old duplicate card list is gone),
  `ListRow` for orders / issues / set-up. Item, bulk add, order, receipt, store/category/vendor forms are `FormDialog`.
  Reports use `Tabs`. "Issue items" form sits in a `Section`. The only hex left is inside the print-receipt HTML (separate document).
- **Student profile**: `PageBar`, shared `Kpi`/`KpiGrid` (local Kpi removed), section jump links and the child switcher are `Tabs`,
  `EmptyState`/`Notice`. The `sp-` card grid keeps its layout CSS. 0 hex.
- **Exam**: the old no-op `Hero` is now a real `PageBar`; sub-tabs are `Tabs`; stat tiles are `Kpi`; report-card viewer is a `FormDialog`;
  **Subjects "Add" is a dialog** and the list is `ListRow` (Wave A rule 19). Grade colours use status tokens. 0 hex.
  The editable marks / structure tables keep their `ex-` CSS (they are data-entry grids).
- **Timetable**: `PageBar` on all screens, `Kpi` stats, day / class pickers are `Tabs`, the slot picker is a `FormDialog`, status/category colours use tokens.
  The weekly grid and `tt-` chips keep their CSS. Remaining hex is only in the print HTML.

## Shared
- `tokens.css`: new categorical palette `--cat-1..9` (the one place identity hex colours live).
- `ds.css` "Wave C additions": `ds-stack`, `inv-top`, `inv-r`, `ex-*` helpers, `tt-gap*`.

## Behaviour changes
- Transport "Add stop" and Exam "Add subject" are dialogs, not inline forms.
- Transport / Inventory delete buttons live inside the edit dialog.
- Inventory items and report tables become stacked cards under 760px through `DataTable`.
- Screens now show a title bar under the app header (Student profile, Exam, Timetable, Transport, Inventory).

## Not done
- Mobile mirror of Waves B and C, and mobile School / Users / Messages from Wave A.
- Phase 6 (remove dead CSS, lint rules, QA). Old `tr-` / `inv-` / `tt-` / `ex-` rules in styles.css that no longer match anything are still there.

## Checks run
All 5 files parse (esbuild); every `ui.jsx` import exists and none are unused; `node tools/design-audit.mjs`: web inline styles 187 -> 105,
hex 134 -> 13 (all print-HTML). Remaining inline styles are data-driven (`--c` colour variables, bar widths).
The app was NOT run or built here (no npm install possible). Click through each module in light and dark, phone and desktop width.
