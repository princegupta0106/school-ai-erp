# Design system (web client)

> Start with `DESIGN-STANDARD.md` (page anatomy + rules) and the live guide at `#design-system`. The v2 components (`Page`, `Button`, `Tabs`, `StatusBadge`, `KpiGrid`/`Kpi`, `Section`, `DataTable`, `List`/`ListRow`, `EmptyState`, `FormDialog`) are in `client/src/ui.jsx`; tokens in `client/src/tokens.css`. This file documents the original v1 pieces.

Files: `client/src/ds.css` (styles, every class prefixed `ds-`) and the components at the bottom of `client/src/ui.jsx`.
Rule: new screens use these components instead of hand-rolled rows/inputs. Classes prefixed `ds-` are never reused by modules, so they cannot collide.

| Need | Use | Notes |
|---|---|---|
| Screen / section header | `<PageBar title sub lead>actions</PageBar>` | Title left, actions right, wraps, never centred. `lead` = Back button. |
| Search + filters + buttons | `<Toolbar>` with `<SearchInput/>`, selects, buttons, optional `<ToolbarEnd>` | One wrapping row. Buttons never wrap their text. |
| Search box | `<SearchInput value onChange placeholder/>` | Icon gutter is built in (beats the global compact-input padding). |
| Fixed-height dashboard card | `Card` in Dashboard.jsx (wraps children in `<CardBody>`) | Height = `--ds-card-h`; list scrolls inside. Empty state: `className="ds-fill"`. |
| Save / submit bar | `<SaveBar summary error dirty action/>` (bottom dock) or `<PageBar sticky>` with the Save button in actions (used by Attendance: header stays at the top, never covers rows) | |

Tokens (in `ds.css`): `--ds-card-h`, `--ds-dock-offset`, `--ds-px`, `--ds-pb`.

Root cause of the earlier "everything centred" bug: the Student-profile root class was `.sp`, which also matched the old `row sp`
(space-between) helper. It is now `.sp-root`. Do not add module classes that are bare two-letter names.

Migrated so far: Dashboard cards, Attendance (header, search, save bar, roll numbers), Academics marks save bar, Fees class header,
Transport routes header, Admissions search, Inventory search. Remaining `row sp` headers still work (collision removed) and can be
moved to `PageBar` as screens are touched.

## FilterBar (search + one Filter button) - `client/src/FilterBar.jsx`
Every list screen uses ONE pattern: a search box and a **Filter** button. All dropdowns, status pills, date ranges and sort options live in a
drawer (bottom sheet on phones). Active filters show as removable chips under the bar, and the button shows a count badge.
```jsx
<FilterBar q={q} onQ={setQ} placeholder="Search..." count={rows.length}
  filters={[{ key:'cls', label:'Class', value:cls, onChange:setCls, all:'All classes', options:[{value:'1',label:'Class 1'}] }]}
  sort={{ value:sortBy, onChange:setSortBy, def:'name', options:[{value:'name',label:'Name A-Z'}] }}
  end={<button className="btn primary">Add</button>} />
```
Filter spec: `key, label, value, onChange, options (strings or {value,label}), all, def, chip(v), type: 'chips'|'select'|'date'`
(auto: chips up to 8 options, select above). Omit `onQ` for screens with no search. For object state use the functional setter
`(v) => setF((p) => ({ ...p, k: v }))` because Apply can call several `onChange`s in a row.
Styles: `ds-fb-*` in `ds.css`. Do not add new hand-rolled filter rows.
