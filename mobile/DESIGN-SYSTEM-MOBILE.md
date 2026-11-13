# Mobile design standard (use for EVERY new module)

> Page anatomy and the shared rules are in `../DESIGN-STANDARD.md`. v2 additions in `src/kit.js`: `PageHeader`, `Tabs` (for switching views), `StatusChip`, `EmptyState`, `FormSheet` (every create/edit). Type, spacing and radius come from `T` in `src/theme.js`: use `T.fs`, `T.sp`, `T.rad` instead of raw numbers.

One look, one kit. New screens import from `src/kit.js` and `src/ui.js`. They never hand-roll rows, chips, cards or colours.
Colours come only from `C` in `src/theme.js` (Light and Dark switch live). Never write a hex colour for UI chrome.
The only hard-coded colours allowed are per-item accents (`hueOf(name)`, a module accent like `#ec4899`).

## Page skeleton
- Wrap every view in `scoped(function X({ me, sid, sc, go, active, action, nonce }) {...})` (super admin picks a school first; `sc` is the `school_id` query object).
- Fetch with `useApi(url)` (cached, pull-to-refresh via `reload`). Show `<Loading/>` while `!data`, `<ErrorBox>` on error.
- Scrolling page = `<Pad reload loading hasData>`. A page with a search box = `<View flex:1><SearchBox/><Pad/></View>`.
- Writes: `api.post/patch/del`, then `toast('Saved')`. Failures: `toast(msg, true)`. Questions: `confirmAsk(msg, onYes)`. Never `Alert`.

## Components (all in `src/kit.js` unless noted)
| Need | Use |
|---|---|
| Card with coloured icon header | `<Section title icon color right>` |
| Plain card | `Card` (`ui.js`) |
| Headline numbers | `<KpiGrid><Kpi icon color label value sub tone onPress/></KpiGrid>` |
| Small counts row | `<StatRow><Stat n label tone/></StatRow>` |
| Pill / badge | `<Chip tone>` inside `<ChipRow>` (tones: ok bad warn info mute) |
| Tabs / filters | `Choice` (`ui.js`) |
| Multi select | `Chips` (`ui.js`) |
| List of tappable rows | `<List><Row onPress last>...</Row></List>` |
| Label / value pairs | `<Facts items=[[label,value]]/>` |
| Key line (receipt, stock, due) | `<Line left mid right rightTone last/>` |
| Person + call button | `<Person name role phone/>` |
| Progress / gauge | `<Meter pct/>`, `<Ring value/>` |
| Search | `<SearchBox/>` + `useDebounced` |
| Collapsible class groups | `groupByClass` + `<Group>` |
| Empty line in a section | `<Soft>` |
| Notice banner | `<Notice tone>` |
| Forms | `Field`, `Input`, `DateField`, `Btn`, `Check` (`ui.js`) |
| Detail screen back | `<BackBar/>` |
| Sheet (full screen modal) | `Sheet` (`ui.js`) |

## Rules
- Sizes: card radius 16, tile radius 12-14, page padding 16, gap 8-10. Title 16-19 / 800, body 14, small 12-12.5 / mute.
- Status colour = tone: good `ok`, due/late `warn`, bad/overdue `bad`, neutral `mute`, info `info`. Use `pctTone()` for percentages.
- Money = `rupees()`, dates = `fdate()`, times = `clock12()`. Do not format inline.
- One module = one file in `src/screens/`, registered in `src/modules.js` (views + `need` features + `prefetchUrls` + `search.js` keywords).
- Mirror the web module (`client/src/modules/*Module.jsx`): same endpoints, same permissions, same rules. No new server code.
- Add any new icon path to `P` in `src/icons.js`.

## FilterBar (search + one Filter button) - `src/FilterBar.js`
Every list screen uses ONE pattern: a search box with a **Filter** button beside it. All pills, dropdown-like choices, date ranges and sort
options live in a bottom sheet (Sort by, then one group per filter, Reset / Apply filters). Active filters show as removable chips under the bar and
the button shows a count badge. Same API as the web `FilterBar`.
```js
<FilterBar inline q={q} onQ={setQ} placeholder="Search..." count={rows.length}
  filters={[{ key:'cls', label:'Class', value:cls, onChange:setCls, all:'All classes', options:[{ value:'1', label:'Class 1' }] }]}
  sort={{ value:sortBy, onChange:setSortBy, def:'name', options:[{ value:'name', label:'Name A-Z' }] }} />
```
`inline` = it sits inside a scrolling `<Pad>`; leave it off when it sits above the list (like the old `SearchBox`).
Filter spec: `key, label, value, onChange, options (strings or {value,label}), all, def, chip(v), type:'date'`.
For object state use functional setters `(v) => setF((p) => ({ ...p, k: v }))`: Apply can call several `onChange`s in a row.
`Choice` stays for form fields and for tabs that switch between screens; do not use it for list filters any more.
