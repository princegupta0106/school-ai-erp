# Phase 6 - guardrails

## Done
- **Dead CSS removed**: `tools/prune-css.mjs` removed about 300 unused rules from `client/src/styles.css` (139.5 KB -> 118.2 KB). A second run finds nothing more.
- **Lint ratchet**: `tools/design-lint.mjs` + `tools/design-lint-baseline.json`. Web modules: hex 0, static inline layout 0, legacy patterns 0. Mobile screens: hex baseline recorded (87), cannot grow.
  npm scripts in `client/package.json`: `lint:design`, `audit:design`, `prune:css`.
- **Legacy patterns cleared in Timetable and Exam**: every pill row is now `Tabs` (view switchers) or the new `MultiChoice` (pick several); `<Empty>`, `page-head`, `className="err"` gone; 19 static inline styles became classes.
- **New shared component**: `MultiChoice` in `ui.jsx` (same look as `Choice`).
- **Showcase** (`#design-system`) now shows `MultiChoice` and the `--cat-1..9` palette.
- **Docs**: `DESIGN-STANDARD.md` is the single source of truth (status, guardrails, component choice table). `QA-CHECKLIST.md` added. All older update / design notes moved to `docs/history/`. README points to the standard.

## Not done
- Mobile screens still hold 87 hex colours and have not been mirrored (Waves A-C). That is the next job; the baseline stops it getting worse.
- The app was NOT run or built here. Run `npm run build`, then the QA checklist, especially Timetable and Exam (the most changed in this phase) and the CSS prune (look for any screen that lost styling).
