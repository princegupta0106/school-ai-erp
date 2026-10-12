# Speed & smoothness update

What changed and why it feels faster. Run `run.bat` as usual (it reinstalls server packages, which now include `compression`).

## Data: show cached first, update when the server answers
- `client/src/cache.js` is now a persistent stale-while-revalidate cache. Pages show the last data instantly (memory, and
  localStorage after a reload) while a fresh copy loads; the screen updates in place only if something changed.
- Per-user, wiped on sign-out, entries expire after 24h. Any save/edit marks everything stale so the next screen re-checks.
- Same-URL requests are shared; an older response can never overwrite a newer one. Re-checks happen on tab focus / reconnect.
- If a background refresh fails, the cached screen stays and a small toast says "showing saved data".
- Converted to the cache: Visitors, Attendance reports/teachers, Fees (all views), Notice board, Messages list,
  Payroll & Leave (all views), Issued documents, Academics (tests list, student marks, children). Editors that load a
  form from the server (attendance sheet, marks sheet, roll numbers) deliberately stay live so they never show stale values.

## Pages load before data
- Signed-in profile is remembered, so reload paints the real app immediately instead of a "Loading..." screen.
- Skeleton placeholders replace every "Loading..." text; they stay invisible for 120ms so quick loads never flash.
- Idle-time prefetch of each module's first screen after login; hovering/tapping a tab or tile warms its data.
- Service worker (`client/public/sw.js`) caches the app shell: the portal opens instantly and even with the server down.
- Server: hashed build files get long cache headers; gzip enabled.

## Motion
Page transitions, staggered home tiles, modal/menu pop, press feedback, thin top progress bar while the server is busy.
All under 300ms; disabled automatically for people who prefer reduced motion. Edit the block at the end of `styles.css`.

## Server
- `/auth/me` (runs on every reload) now runs its two Supabase lookups in parallel instead of one after the other.
