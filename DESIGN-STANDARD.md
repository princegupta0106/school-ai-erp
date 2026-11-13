# Design standard (web + mobile) - the ONE flow every module follows

Single source of truth. If another doc disagrees with this one, this one wins.
Live reference on web: open the app with `#design-system` in the address (e.g. `http://localhost:5173/#design-system`).
Components: web `client/src/ui.jsx` (styles `ds.css`, tokens `tokens.css`) / mobile `mobile/src/kit.js` (+ `ui.js`, tokens `T` in `theme.js`).
Progress report: `node tools/design-audit.mjs`.

## 1. Page anatomy (same order on every screen)

```
Page
 ├─ PageBar / PageHeader     title + subtitle left, 1-2 actions right (primary action is the rightmost, filled)
 ├─ Tabs                     ONLY if the module has sub-views. Underline style. Never pills.
 ├─ FilterBar                search + one Filter button (+ active chips). Never loose dropdown rows.
 ├─ KpiGrid                  optional, 2-4 headline numbers; tone colours the number only
 └─ Section / DataTable / List
      ├─ Loading             skeleton / <Loading/>
      ├─ Empty               EmptyState (icon + one line + one action)
      └─ Error               inline message with Retry
```

| Situation | Web | Mobile |
|---|---|---|
| Screen title + actions | `PageBar` | `PageHeader` |
| Switch between views | `Tabs` | `Tabs` |
| Search + filters + sort | `FilterBar` | `FilterBar` |
| Headline numbers | `KpiGrid` + `Kpi` | `KpiGrid` + `Kpi` |
| Titled card | `Section` | `Section` |
| Table of records | `DataTable` (cards on phones automatically) | `List` + `Row` |
| People / things list | `List` + `ListRow` | `List` + `Row` |
| Status word | `StatusBadge` | `StatusChip` |
| Buttons | `Button` (kind: primary, secondary, ghost, danger; size: md, sm) | `Btn` |
| Create / edit | `FormDialog` (`noForm` for multi-section detail dialogs) | `FormSheet` |
| Confirm / delete | `ask()` | `confirmAsk()` |
| Nothing to show | `EmptyState` | `EmptyState` |
| Message / error / hint line | `Notice` (tone ok, warn, bad, info, mute; optional action) | `Notice` |
| Pick one option inside a form | `Choice` | `Choice` |
| Form field layout | `FormGrid` + `Field full` (2 columns, 1 on phones) | stacked `Field` |
| Totals under a table | `DataTable foot={(col) => ...}` | last `Row` in a `Section flush` |
| List card with no padding | `Section flush` + `List` | `Section flush` + `Row` |
| Feedback after a write | `toast('Saved')`, errors `toast(msg, true)` | same |

## 2. Rules

1. **Left aligned.** Titles left, actions right. Nothing centred except empty states.
2. **One primary action per screen**, filled, top right. Everything else is secondary or ghost.
3. **Forms**: always `FormDialog` / `FormSheet`. Fields stacked, labels above, required marked with `*`, error shown in the dialog (not a toast). Footer: Cancel then the primary button.
4. **Destructive actions** are `danger` buttons and always go through `ask()` / `confirmAsk()`. Never `window.confirm`, never `Alert`.
5. **Status colour = meaning**: ok (paid, present, approved), warn (due, late, pending), bad (overdue, absent, rejected), info (leave, draft), mute (neutral). `StatusBadge` / `StatusChip` choose the tone from the word.
6. **No hex colours, no pixel font sizes, no border radii inside modules.** Use tokens. The only allowed raw colours are per-item accents (class colour, subject colour, module accent).
7. **No inline `style={{}}` for layout** (flex, gap, padding, width). Use `Page`, `PageBar`, `Section`, `Toolbar`. Inline style is allowed only for a dynamic value (a width percentage, a per-item colour).
8. **No module-private copies of tabs, chips, badges, tables or dialogs.** If something is missing, add it to the shared set first, then use it.
9. **Money** `rupees()` / `money()`, **dates** `fdate()`, **times** `clock12()`. Never format inline.
10. **Tap targets** are at least 44px on phones. Light and dark must both look right.

### 2b. Rules learned from the pilot (Visitors, Fees)

11. **Context selects** (school, session) may sit in the PageBar actions. They are not buttons, so they do not count towards the "1-2 actions" limit. The primary button is still rightmost.
12. **A screen with a list and an Add button** puts Add in the PageBar and opens a `FormDialog`. A stand-alone "Add" view (for staff who may add but not view) shows a PageBar and an EmptyState, and opens the same dialog.
13. **Class / session pickers that switch what is shown** are `Tabs` (with `count` for "how many items"; 0 is the warning, replacing the old dot).
14. **Records with notes or reasons** (payments, adjustments) use `ListRow wrap`, not a table.
15. **Disabled submit** is `submitDisabled` on `FormDialog` / `FormSheet`; never hide the button.
16. **Errors that block a screen** are `Notice tone="bad"` with a Retry button (`refresh` on web, `reload` on mobile). Errors from a save show inside the dialog.
17. **Strike-through** for cancelled / removed money rows is a plain `<s>` / `line-through`, always paired with a `StatusBadge` ("Cancelled", "Removed").

### 2c. Rules learned from Wave A (Audit, Backup, Queries, Communication, School, Users, Homework)

18. **Read-only detail dialogs** (log entry, submissions) use `FormDialog hideFooter`. A detail dialog with several independent sections, each with its own Save button (user profile), uses `FormDialog noForm` so each section can own a real `<form>`. Mobile: `FormSheet hideFooter`.
19. **Inline "add" rows are gone.** Adding a session, holiday, class or status opens a `FormDialog` from a small primary button in the `Section actions` (or the `PageBar` when it is the page's main job). Never a row of loose inputs.
20. **Stand-alone entry forms** (New query, Send notification, New school, Add user) are `Page narrow` > `PageBar` > `Section` > `FormGrid`, with one filled submit button at the end. Group long forms with `<div className="ds-label ds-full">Heading</div>`.
21. **Audience / type pickers inside a form** are `Choice`; **pickers that switch the form that is shown** (query form types) are `Tabs`.
22. **Records of people** in a table are `DataTable` (cards on phones for free). A table cell with two lines uses `<span className="ds-subline">`. Students grouped by class keep `ClassGroup` but the rows inside are `ListRow`.
23. **Removable chips** reuse the FilterBar chip (`ds-fb-chip`) instead of a new class. Key/value detail uses `ds-kv`; raw JSON uses `ds-code`.
24. **Old tone names:** the stored status colour `off` means red. Map it with `tone = (c) => (c === 'off' ? 'bad' : c)` when feeding `StatusBadge` / `StatusChip`.
25. **Small helper classes** (ds.css, "Wave A additions"): `ds-label`, `ds-note`, `ds-hint`, `ds-more`, `ds-check`, `ds-checks`, `ds-stack`, `ds-inline`, `ds-spread`, `ds-grow`, `ds-sunk`, `ds-chips`, `ds-pre`, `ds-person`, `ds-input-sm`, `ds-logo`, `ds-file-row`. Use these instead of inline `style={{}}`.

## 3. Tokens (tokens.css / `T`)

| Token | Values |
|---|---|
| Type scale | 12 caption / 13 secondary / 14 body / 16 title / 20 big title / 22 KPI number |
| Weights | 400, 500, 600, 700 |
| Spacing (4px grid) | 4, 8, 12, 16, 24, 32 |
| Radius | 8 control / 12 card / 16 sheet / pill |
| Control height | 36 desktop, 40-44 phone |
| Status | `--st-ok`, `--st-warn`, `--st-bad`, `--st-info`, `--st-mute` (each with `-bg`) on web; `C.ok/warn/bad/info/mute` (+ `Bg`) on mobile |

## 4. Migrating a module (checklist)

- [ ] Wrap the screen in `Page`; header is `PageBar` (no `h1/h2/h3`, no `row sp` header)
- [ ] Sub-views are `Tabs`; delete the module's own pill / chip / seg classes
- [ ] Lists have `FilterBar`; no loose `select` rows
- [ ] Headline numbers are `Kpi`; cards are `Section`
- [ ] Tables are `DataTable` (or `ListRow`); status cells are `StatusBadge`
- [ ] Every create / edit is a `FormDialog`; deletes use `ask()`
- [ ] Empty / loading / error states use the shared ones
- [ ] Remove the module's inline styles, hex colours and private CSS block
- [ ] Check light + dark, 360px / 768px / 1280px, a very long name, and zero rows
- [ ] Mirror the same change in the mobile screen
- [ ] `node tools/design-audit.mjs` shows the module's inline / hex numbers near 0

## 5. Status

| Area | State |
|---|---|
| Web, all 19 modules | Migrated (Waves A, B, C). Lint baseline for web modules is **0** hex, **0** static inline layout styles, **0** legacy patterns |
| Web CSS | Dead rules pruned (`styles.css` 139 KB -> 118 KB). Module-specific CSS that remains is layout only (class cards, kanban, weekly grid, marks grid, previews) |
| Mobile | Kit exists (`kit.js`); Waves A-C not mirrored yet. Hex baseline is tracked, never allowed to grow |

## 6. Guardrails (Phase 6)

Run from `client/`: `npm run lint:design`, `npm run audit:design`, `npm run prune:css` (or `node tools/<name>.mjs` from the project root).

- **`tools/design-lint.mjs`** is a ratchet. It compares each module with `tools/design-lint-baseline.json` and fails if a module has MORE violations than allowed.
  - `hex`: no hex colours in modules or mobile screens. Use a token (`var(--st-ok)`, `var(--cat-3)`, `C.ok`). Print-HTML lines are skipped, or add `design-lint-ignore` on the line.
  - `inline`: no static inline layout styles (margin, padding, gap, flex, width, font, colour...). Allowed: data-driven custom properties like `style={{ '--c': colour }}` and bar widths.
  - `legacy`: no `<Modal>`, `<Empty>`, `className="err"`, `pill` / `pills`, `page-head` in web modules.
  - When you REDUCE a number, run `node tools/design-lint.mjs --update-baseline` to lock it in. Never raise the baseline to make a check pass.
- **`tools/prune-css.mjs`** lists (and with `--write` removes) CSS rules in `styles.css` whose classes appear nowhere in the source. Run it after deleting a screen. Dynamic class names are protected by prefix detection (`tr-${x}`).
- **`tools/design-audit.mjs`** is the progress report (counts per module, web and mobile).
- **`#design-system`** page (`DesignShowcase.jsx`) is the live reference. When you add or change a shared component, update that page in the same change.

Which component for which job (additions to section 1):

| Situation | Web |
|---|---|
| Pick ONE option in a form | `Choice` |
| Pick SEVERAL options in a form (days, classes, subjects) | `MultiChoice` |
| Switch views of one screen (including a class / day / child picker) | `Tabs` |
| Identity colour (route, bus, class, subject) | `var(--cat-1..9)` from `tokens.css` |
| Status colour | `StatusBadge` / `var(--st-*)` |
| Detail dialog with its own buttons | `FormDialog noForm hideFooter` |

## 7. QA before every release

See `QA-CHECKLIST.md`.

## 8. History

Old per-feature update notes and earlier design notes live in `docs/history/`. They describe how things were, not how they are. If one disagrees with this file, this file wins.
