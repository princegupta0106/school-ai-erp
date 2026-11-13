# Design update v2 - phases 0 to 2 (cleanup, tokens, one component set)

Nothing in the existing screens was changed. Everything below is additive, so the app looks and works exactly as before until a module is migrated (phases 4-5).

## Phase 0 - cleanup
- The old Expo app that lived in the project root (`src/`, `App.js`, `app.json`, `package.json`, ...) is now in `_archive/old-root-mobile/`. It had drifted from `mobile/` and `run-mobile.bat` only ever starts `mobile/`. Delete `_archive/` whenever you like.
- `.env` files are included as they were in your zip.
- `client/dist` is not included (stale). `run.bat` rebuilds it; or run `npm run build` in `client/`.

## Phase 1 - tokens
- Web: new `client/src/tokens.css` (loaded first): type scale, spacing, radius, control heights, and 5 semantic status colours mapped onto your existing palette (no colour changed).
- Mobile: new `T` export in `mobile/src/theme.js` with the same scales.

## Phase 2 - one component set
Web (`client/src/ui.jsx`, styles at the end of `ds.css`): `Page`, `Button`, `Tabs`, `StatusBadge` (+ `toneFor`), `KpiGrid` / `Kpi`, `Section`, `DataTable`, `List` / `ListRow`, `EmptyState`, `FormDialog`. Already there and kept: `PageBar`, `Toolbar`, `SearchInput`, `SaveBar`, `FilterBar`.
Mobile (`mobile/src/kit.js`): `PageHeader`, `Tabs`, `StatusChip` (+ `toneFor`), `EmptyState`, `FormSheet`. `Sheet` in `ui.js` got an optional `footer`.
- Living style guide on web: open the app with `#design-system` in the address.
- `DESIGN-STANDARD.md` is the page standard and the migration checklist.
- `node tools/design-audit.mjs` prints per-module adoption. Baseline at this point: web 558 inline styles and 135 hex colours inside modules; mobile 20 font sizes and 24 radii across screens.

## Next
Phase 4 pilot (Visitors, then Fees on web + mobile), then the migration waves in `DESIGN-STANDARD.md`.
