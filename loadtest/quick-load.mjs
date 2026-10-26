// Zero-install load tester (needs only Node 18+). Prints p50 / p95 / p99 per endpoint.
//
//   node quick-load.mjs --base http://localhost:3000 --vus 20 --duration 60 --p95 800
//
// It signs in ONCE per persona (the login route is rate-limited to 30 per 5 minutes per IP) and then
// reuses the token, the same way a real app does. Defaults are the BIG1 school made by 02-big-school.sql.
//
// options (or env vars BASE, VUS, DURATION, P95, ADMIN, TEACHER, PARENT, PASSWORD):
//   --base      server address (use the TEST server, never production)
//   --vus       how many users act at the same time           (default 20)
//   --duration  seconds to run after warm-up                  (default 60)
//   --p95       fail (exit code 1) if any endpoint's p95 ms is above this  (default 800)
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : (process.env[k.toUpperCase()] ?? d); };
const BASE = String(arg('base', 'http://localhost:3000')).replace(/\/$/, '');
const VUS = Number(arg('vus', 20)); const DURATION = Number(arg('duration', 60)); const P95 = Number(arg('p95', 800));
const PASSWORD = arg('password', 'Load@1234');
const LOGINS = { admin: arg('admin', 'bigadmin'), teacher: arg('teacher', 'bigteacher1'), parent: arg('parent', 'bigparent1') };

const day = (back = 0) => new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
// the seed has no Sunday rows, so "the last school day" skips Sundays
const lastWorkday = () => { let b = 1; while (new Date(Date.now() - b * 864e5).getUTCDay() === 0) b++; return day(b); };
const call = async (path, token, opts = {}) => {
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  return res;
};
async function login(id) {
  const r = await call('/auth/login', null, { method: 'POST', body: JSON.stringify({ login_id: id, password: PASSWORD }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error(`Sign-in failed for "${id}" (${r.status}) ${d.error || ''} - did you run the seed files, and is ${BASE} the right server?`);
  return d.token;
}
const list = (d) => (Array.isArray(d) ? d : d?.students || d?.items || d?.rows || []);

// what each persona does: [weight, name, path]
function plan(tok, ids) {
  const admin = tok.admin, teacher = tok.teacher, parent = tok.parent;
  return [
    [4, 'admin: me', admin, '/auth/me'],
    [4, 'admin: classes', admin, '/classes'],
    [6, 'admin: attendance classes (today)', admin, `/attendance/classes?date=${lastWorkday()}`],
    [6, 'admin: attendance daily overview', admin, `/attendance/reports/daily?date=${lastWorkday()}`],
    [5, 'admin: attendance class report (60d)', admin, `/attendance/reports/class?class_id=${ids.classId}&from=${day(60)}&to=${day(1)}`],
    [3, 'admin: low attendance report (90d)', admin, `/attendance/reports/low?from=${day(90)}&to=${day(1)}`],
    [6, 'admin: fee students search', admin, '/fees/students?limit=50'],
    [5, 'admin: fee pending list', admin, '/fees/pending?limit=50'],
    [4, 'admin: fee payments list', admin, '/fees/payments?limit=50'],
    [4, 'admin: assessments of a class', admin, `/academics/assessments?class_id=${ids.classId}`],
    [4, 'admin: audit log (page 1)', admin, '/audit?limit=50'],
    [2, 'admin: ALL users list (heavy)', admin, '/users'],
    [4, 'admin: notices', admin, '/communication/announcements?limit=20'],
    [5, 'teacher: attendance classes', teacher, `/attendance/classes?date=${lastWorkday()}`],
    [5, 'teacher: attendance sheet', teacher, `/attendance/sheet?class_id=${ids.classId}&date=${lastWorkday()}`],
    [3, 'teacher: homework list', teacher, '/homework/assignments'],
    [8, 'parent: notifications', parent, '/notifications'],
    [6, 'parent: notices', parent, '/communication/announcements?limit=20'],
    [5, 'parent: chats', parent, '/communication/conversations'],
    [4, 'parent: my fees', parent, '/fees/my'],
  ];
}

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)] : 0);
const stats = new Map();
const rec = (name, ms, ok) => { const s = stats.get(name) || { t: [], bad: 0, codes: {} }; s.t.push(ms); if (!ok.ok) { s.bad++; s.codes[ok.code] = (s.codes[ok.code] || 0) + 1; } stats.set(name, s); };

async function main() {
  console.log(`Target ${BASE}  |  ${VUS} users at once  |  ${DURATION}s  |  fail if p95 > ${P95} ms`);
  const tok = {};
  for (const [k, id] of Object.entries(LOGINS)) tok[k] = await login(id);
  const cls = list(await (await call('/classes', tok.admin)).json());
  const ids = { classId: cls[Math.floor(cls.length / 2)]?.id };
  if (!ids.classId) throw new Error('No classes found - run the seed files first');
  const table = plan(tok, ids);
  const total = table.reduce((s, r) => s + r[0], 0);
  const pick = () => { let x = Math.random() * total; for (const r of table) { x -= r[0]; if (x <= 0) return r; } return table[0]; };

  const warmUntil = Date.now() + 5000; // first 5 s are not counted (cold caches, connection set-up)
  const endAt = warmUntil + DURATION * 1000;
  let n = 0; const t0 = warmUntil;
  const worker = async () => {
    while (Date.now() < endAt) {
      const [, name, token, path] = pick();
      const s = performance.now();
      let ok = { ok: false, code: 'network' };
      try { const r = await call(path, token); await r.arrayBuffer(); ok = { ok: r.ok, code: r.status }; } catch { /* counted as failed */ }
      const ms = performance.now() - s;
      if (Date.now() >= warmUntil) { rec(name, ms, ok); n++; }
    }
  };
  await Promise.all(Array.from({ length: VUS }, worker));

  const secs = (Date.now() - t0) / 1000;
  const rows = [...stats].map(([name, s]) => { const t = s.t.sort((a, b) => a - b); return { name, n: t.length, p50: pct(t, 50), p95: pct(t, 95), p99: pct(t, 99), max: t[t.length - 1], bad: s.bad, codes: s.codes }; })
    .sort((a, b) => b.p95 - a.p95);
  const f = (x) => String(Math.round(x)).padStart(6);
  console.log(`\n${'endpoint'.padEnd(40)} ${'calls'.padStart(6)} ${'p50'.padStart(6)} ${'p95'.padStart(6)} ${'p99'.padStart(6)} ${'max'.padStart(6)}  errors`);
  for (const r of rows) console.log(`${r.name.padEnd(40)} ${String(r.n).padStart(6)} ${f(r.p50)} ${f(r.p95)} ${f(r.p99)} ${f(r.max)}  ${r.bad ? `${r.bad} ${JSON.stringify(r.codes)}` : '0'}  ${r.p95 > P95 ? '<-- SLOW' : ''}`);
  const all = rows.flatMap((r) => stats.get(r.name).t).sort((a, b) => a - b);
  const bad = rows.reduce((s, r) => s + r.bad, 0);
  console.log(`\nTotal ${n} calls in ${secs.toFixed(0)}s = ${(n / secs).toFixed(1)} requests/second | overall p50 ${Math.round(pct(all, 50))} ms, p95 ${Math.round(pct(all, 95))} ms, p99 ${Math.round(pct(all, 99))} ms | errors ${bad} (${((bad / n) * 100).toFixed(2)}%)`);
  const slow = rows.filter((r) => r.p95 > P95);
  if (slow.length || bad / n > 0.01) { console.log(`\nRESULT: FAIL - ${slow.length} endpoint(s) over ${P95} ms at p95, error rate ${((bad / n) * 100).toFixed(2)}%`); process.exit(1); }
  console.log(`\nRESULT: PASS - every endpoint p95 <= ${P95} ms and errors under 1%`);
}
main().catch((e) => { console.error(e.message); process.exit(2); });
