# Phase 4 - pilot report (Visitors + Fees)

Status: code written and syntax-checked only. **Not built or run** (no node_modules / network in the sandbox). Please run `run.bat` (or `npm run build` in `client/`), and start the mobile app, then check the list at the bottom.

## What was migrated

| Module | Web | Mobile |
|---|---|---|
| Visitors | `client/src/modules/VisitorsModule.jsx` | `mobile/src/screens/Visitors.js` |
| Fees (structure, student fees, account, my fees) | `client/src/modules/FeesModule.jsx` | `mobile/src/screens/Fees.js` |

Both now follow DESIGN-STANDARD.md: `Page > PageBar > Tabs? > FilterBar? > KpiGrid? > Section > DataTable / List`, every form is a `FormDialog` / `FormSheet`, every status is a `StatusBadge` / `StatusChip`, destructive actions use `ask()` / `confirmAsk()`.

`node tools/design-audit.mjs`: Visitors and Fees on web are at **0 inline styles, 0 hex colours, 0 `row sp` headers**. Total inline styles in web modules went from 558 to 524.
Removed from `styles.css`: the Fees-only classes (`.fsum`, `.ft`, `.fchip`, `.payrow`, `.strike`, `.pos-text`, `.neg-text`). Nothing else used them.

## What the pilot taught us (shared components that changed)

| Gap found | Fix | Web | Mobile |
|---|---|---|---|
| No message / hint component (every module wrote its own `.notice`) | `Notice` | new | tones `bad`, `mute` added to the existing one |
| Binary choice inside a form (discount / charge) tempted people to use pills | `Choice` | new, same name + options as mobile | already existed |
| No 2-column form layout | `FormGrid`, `Field full` | new | n/a |
| Tables had no totals row | `DataTable foot` | new | `Section flush` + last `Row` |
| `DataTable` rowKey could not use the row index (ledger lines have no id) | `rowKey(row, index)` | changed | n/a |
| Rows with long notes / reasons got cut off | `ListRow wrap` | new | n/a |
| Dialog submit could not be disabled | `submitDisabled` | `FormDialog` | `FormSheet` |
| Card with a header but no padding (lists of rows) | `Section flush` | existed | new |
| Back button before the title | `PageBar lead` | existed | `PageHeader lead` added |
| Section without a title drew an empty header | fixed | fine | fixed |
| Selects in the PageBar were full width | `.ds-bar-a select` | CSS | n/a |

The style guide (`#design-system`) shows the new pieces in sections 6 and 7.

## Behaviour changes you should know about

1. **Visitors list web: the sort now works.** The sort control existed but was never applied on web (mobile applied it). Fixed to match mobile.
2. **Visitors: adding is now a dialog / sheet** opened from the list's primary button, instead of a separate form view. After saving, the dialog closes and the list reloads. The old stand-alone "Add visitor" view still exists (same permission) for gate staff who cannot see the list; it now opens the same dialog.
3. **Fees: the "due" row tint is gone.** The status badge (Overdue / Due today) already says it.
4. **Fees: the class selector is Tabs**, and each tab shows the number of fees; `0` replaces the old red dot.
5. **Fees: "My children" is a list with a status badge** instead of big tiles.
6. **Fees account: buttons moved up.** On web "Adjust fees" and the primary "Record payment" sit in the page header. On mobile they are a right-aligned row under the header.

Server endpoints, permissions, request bodies and money rules were not touched.

## Not changed on purpose (found, needs a decision)

- **The app shell still draws module sub-views as `pill` buttons** (`App.jsx`, `<nav className="tabs">`). That is the standard's "Tabs" in the wrong style, and it affects every module at once. I did not change it in the pilot because it is global. Recommended as the first step of Wave A: swap it for `<Tabs>`.
- **`scoped()` in `AttendanceModule.jsx`** (the school picker for super admins) has an inline `style` on a select and is used by most modules. Same: one fix, benefits all.
- Legacy global classes still used elsewhere: `.drow`, `.vtime`, `.hide-sm`, `.tile`. They go in Phase 6, once their last user is migrated.

## Check list for you (about 10 minutes)

Web, light and dark, at 1280 / 768 / 360px:
- [ ] Visitors list: Add visitor dialog opens, saves, list refreshes; delete asks first; search + date filter + sort work; empty day shows the empty state
- [ ] Visitors "Add visitor" view (log in as a role with `add_visitor` but not `view_visitors`)
- [ ] Fees > Fee structure: class tabs, add / edit / remove fee, copy from another session, totals row, table turns into cards at 360px
- [ ] Fees > Student fees: search, class filter, open a student
- [ ] Student account: Record payment (amount quick-fill buttons, over-pay is blocked), Adjust fees (discount and charge), cancel a payment, remove an adjustment, download a receipt
- [ ] Log in as a parent: "My children" list and read-only account (no action buttons)
Mobile: the same flows. Sheets should show Cancel + primary in a docked footer; all icon buttons at least 44px.
