# Design system (web client)

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
