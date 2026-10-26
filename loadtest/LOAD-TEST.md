# Load testing the school ERP (seed data + p50 / p95 / p99)

> **Do all of this on a separate TEST database and a separate TEST server. Never on production.**
> The seed files create fake schools and ~100k rows (20x smaller than v1), and a load test sends hundreds of requests per second.

## 0. What is in this folder

| File | What it does |
|---|---|
| `01-install.sql` | Creates the helper functions (inserts nothing). |
| `02-big-school.sql` | The BIG school `BIG1` (150 students, ~30k attendance, ~9k marks, 25k audit rows ...). **This is the one you log in to.** |
| `03-small-schools.sql` | 10 small schools (`SM01`..`SM10`, 45 students each) so the tables hold other tenants' rows too. |
| `04-finish.sql` | `ANALYZE` + row counts. **Never skip it** - without it your timings mean nothing. |
| `05-explain.sql` | 11 database queries behind the busiest screens, with `EXPLAIN ANALYZE`. |
| `06-suggested-indexes.sql` | Indexes this test found missing (see "What the test already found"). |
| `quick-load.mjs` | Load tester that needs nothing but Node 18+. Prints p50/p95/p99 per endpoint. |
| `k6-load.js` | The same traffic for [k6](https://k6.io) (nicer reports, ramp-up, pass/fail thresholds). |
| `99-cleanup.sql` | Removes all load-test schools. |

## 1. Logins (password for every one: `Load@1234`)

| Who | Login ID | Sees |
|---|---|---|
| **School admin (big school - use this one)** | **`bigadmin`** | everything: 150 students, 12 classes, all fees / attendance / marks / audit |
| Teacher | `bigteacher1` (…`bigteacher5`) | attendance, homework, marks |
| Parent | `bigparent1` (…`bigparent75`) | their 2 children |
| Student | `bigstudent1` (…`bigstudent150`) | own marks, fees, homework |
| Small-school admins | `sm01admin` … `sm10admin` | 45 students each |

## 2. Set up the test environment

1. Create a **second Supabase project** (free tier is fine). In its SQL editor run `db/schema.sql` (it already contains the push-notification and dashboard parts).
2. Copy your `.env` to a test `.env` and put the **test** project's `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in it. Use a test R2 bucket (or leave R2 unset; the load test does not touch files).
3. Start the server against it: `cd server && npm install && npm start` (locally), or deploy a second Render service with the test `.env`.
   For honest numbers the test server should run on **the same plan/size as production** - a laptop is far faster than a small Render instance.

## 3. Load the data (SQL editor of the TEST project)

Run the files in order, pasting each one in the SQL editor:

1. `01-install.sql`
2. `02-big-school.sql` - it has blocks **A..E**. Run them **one at a time** (A, then B, ...) so no single run gets long.
3. `03-small-schools.sql` - a few minutes. If the editor times out, change `30` to `10` and run it again.
4. `04-finish.sql` - prints the row counts. You should see roughly 40k attendance rows, 27k audit rows and 13k marks.

How long it took in my test (a plain Postgres 16 in a sandbox, so Supabase free tier will differ - expect the same order, maybe slower): big school about 1 minute, 30 small schools about 1.5 minutes.

**Bigger / "stress" tier:** in `02-big-school.sql` change block A to `lt_base('BIG1','big', 20000, 400)` and multiply the numbers in block E by 5-10. Attendance days are limited by the session length (about 250 working days).

## 4. Check the database first (so you know which layer is slow)

Run `05-explain.sql` **one query at a time**.

* Look at **Execution Time**. A screen query over ~100 ms is worth a look.
* `Seq Scan on <huge table>` + a large `Rows Removed by Filter` = missing index.
* `Index Scan` / `Bitmap Index Scan` = fine.

In Supabase also open **Database -> Query Performance**: it lists the slowest queries by total time while your load test runs.

On my sandbox every one of the 11 queries ran in under 25 ms, with index scans on the big tables (attendance, audit, messages, notifications).

## 5. Run the API load test

### Option A - no install (`quick-load.mjs`)

```bash
cd loadtest
node quick-load.mjs --base http://localhost:3000 --vus 20 --duration 60 --p95 800
# bigger:  --vus 100 --duration 180
```

### Option B - k6 (install from https://k6.io/docs/get-started/installation/)

```bash
k6 run -e BASE=http://localhost:3000 loadtest/k6-load.js
k6 run -e BASE=https://your-test-server.onrender.com -e PEAK=100 -e P95=800 loadtest/k6-load.js
```

Both sign in **once** per persona (admin / teacher / parent) and reuse the token, because the login route allows only 30 attempts per 5 minutes per IP. Traffic mix: 20% office staff, 25% teachers, 55% parents. The runner exits with an error code when a target is missed, so you can put it in CI.

### How to read the result

```
endpoint                                  calls    p50    p95    p99    max  errors
admin: ALL users list (heavy)                28    901    903    904    904  0   <-- SLOW
```

* **p50 (median)** - half of the requests were faster than this. What a typical user feels.
* **p95** - 95 of 100 requests were faster. **This is the number to judge by.** 1 in 20 requests is slower than this.
* **p99** - the worst 1 in 100. Shows spikes (cold start, locks, garbage collection).
* **max** - one unlucky request; do not judge by it.
* **Averages hide problems** - never use them.
* **errors** - anything not HTTP 200. Over 1% is a failure whatever the speed.
* **requests/second** at the end = your capacity at that number of users.

Suggested targets (set your own before you start): list/report screens **p95 < 800 ms**, simple reads (me, notifications) **p95 < 300 ms**, error rate **< 1%**, p99 **< 2 s**.

### Run it in steps, not once

1. 10 users (should be fast everywhere) -> 2. 50 -> 3. 100 -> 4. 200. The "knee" - where p95 suddenly jumps - is your real capacity on that server size.
2. Run each for at least 1-2 minutes; the first 5 seconds are ignored as warm-up.
3. Watch the server's CPU and memory (Render dashboard) while it runs, and Supabase's CPU / connections.

### Which layer is slow?

| You see | Cause | Fix |
|---|---|---|
| Query slow in `05-explain.sql` / Supabase Query Performance | database | add an index or change the query |
| Queries fast, API p95 high, server CPU ~100% | server code or too small an instance | fewer queries per request, caching, bigger plan |
| Queries fast, API fast on your PC, slow from your phone | network / payload size | smaller responses, pagination, compression |
| Page loads fast but the screen freezes | frontend rendering | paginate / virtualize long lists |

## 6. Test the web app and the mobile app (frontend)

The API load test never opens a screen, so test the screens separately, signed in as **`bigadmin`**:

* **Chrome DevTools -> Network** (tick "Disable cache", set throttling to *Fast 4G*): open Users, Attendance reports, Fees, Audit. Look at **payload size** and the **Waterfall**. A response of several MB or a request over 1 s is a finding.
* **DevTools -> Performance**: record while opening a long list. Long yellow blocks (scripting) = the page is rendering too many rows at once.
* **Lighthouse**: `npx lighthouse https://your-test-site --view` (aim for Performance 80+ on mobile settings).
* **Mobile**: install the app pointing at the test server (`EXPO_PUBLIC_API_URL`), use a low-end Android phone and a throttled network, scroll the Users, Audit and Fees lists, and watch for jank or a long blank screen.

## 7. What the test already found (in the code and schema)

1. **Missing foreign-key indexes (measured).** Deleting ONE student took about **550 ms** on the big data, almost all of it Postgres scanning `student_attendance`, marks, notifications and messages once per deleted user. With `06-suggested-indexes.sql` the same delete took about **11 ms**. This matters for Users -> Delete and for removing a whole school (re-creating the big school was still stuck on its wipe step after 5 minutes before the indexes - I stopped it - and wiping all 31 test schools took 24 s after). Safe to run on production.
2. **`GET /api/users` returns at most 2,000 rows** (`limit(2000)` in `server/src/routes/users.js`). A school with 3,000 students silently shows only part of its users, and the response is large. It needs real pagination/search. The load test includes it as "ALL users list (heavy)" so you will see its p95.
3. **Login is limited to 30 attempts per 5 minutes per IP.** Good for security, but a school behind one shared IP (office Wi-Fi) logging in together at 8:30 AM can hit it. Not changed here.
4. **The server loads the signed-in user from the database on every request** (`authenticate` in `server/src/auth.js`). It is fast with the `users` primary key, but it is one extra query on every call, so watch it under load.
5. **Every change and sign-in writes an audit row.** At 500k+ rows the audit page stayed fast in my tests (index scan), but the table grows without limit; plan an archive policy.
6. **Backup of a school reads the whole database export into memory** (see `BACKUP-UPDATE.md`). Test it on the big school on your smallest server size.

I did not run the API load test against your real server (it needs your Supabase project and credentials), so no API numbers are claimed here. The scripts were checked against a mock server and the SQL against your schema on a local Postgres 16.

## 8. Clean up

* `99-cleanup.sql` removes `BIG1` and `SM01..SM30` only (takes under a minute if you ran `06`; many minutes if you did not).
* Fastest of all: delete the test Supabase project.
