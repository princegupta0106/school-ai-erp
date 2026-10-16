// Runs the REAL fees router (routes/fees.js + fees.js + feeReports.js) against a tiny in-memory stand-in for the Supabase client.
// No network, no secrets.   Run:  cd server && node --test test/fees-routes.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AUTH_SECRET = 'x'; process.env.SUPABASE_URL = 'http://localhost:1'; process.env.SUPABASE_SECRET_KEY = 'x';
const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: feesRoutes } = await import('../src/routes/fees.js');
const { todayStr } = await import('../src/attendance.js');

// ------------------------------------------------------------------ fake data
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1), S2 = id(2);
const today = todayStr();
const [y, m] = today.split('-').map(Number);
const start = `${m >= 4 ? y : y - 1}-04-01`;
const SESSION = { id: id(10), school_id: S1, name: 'Current', start_date: start, end_date: `${m >= 4 ? y + 1 : y}-03-31`, is_current: true };
const C = { c5a: { name: '5', section: 'A', level: 5 }, c5b: { name: '5', section: 'B', level: 5 }, c6a: { name: '6', section: 'A', level: 6 } };
const mk = (n, name, cls, extra = {}) => ({ user_id: id(n), school_id: S1, full_name: name, roll_no: extra.roll ?? n, admission_no: `AD${n}`, class_id: cls ? id(cls === 'c5a' ? 71 : cls === 'c5b' ? 72 : 73) : null, classes: cls ? C[cls] : null,
  father_name: extra.father ?? null, mother_name: null, father_phone: extra.fphone ?? null, mother_phone: null, phone: extra.phone ?? null, extra: extra.extra ?? {}, users: { login_id: extra.login ?? name.toLowerCase().replace(/\W+/g, '.'), is_active: extra.active ?? true, role: extra.role ?? 'student' } });
const PROFILES = [
  mk(21, 'Rahul Sharma', 'c5a', { roll: 3, father: 'Mahesh Sharma', fphone: '9820011111' }),
  mk(22, 'Priya Verma', 'c5b', { roll: 1 }),
  mk(23, 'Amit Roy', 'c6a'),                                                    // class 6 has no fee structure
  mk(24, 'राहुल गुप्ता', 'c5a', { roll: 9, login: 'rahul.g' }),                    // Hindi name
  mk(25, '=HYPERLINK("http://x")', 'c5b', { roll: 8, login: 'evil' }),             // spreadsheet-formula trick
  mk(26, 'Old Student', 'c5a', { extra: { graduated: true } }),                    // left school: not listed
  mk(27, 'Switched Off', 'c5a', { active: false }),                               // account off: not listed
  mk(31, 'Mahesh Sharma', null, { role: 'parent', phone: '9820011111', login: 'mahesh' }),
  mk(32, 'Clerk Kumar', null, { role: 'staff', login: 'clerk' }),
];
const DB = {
  academic_sessions: [SESSION],
  profiles: PROFILES,
  users: PROFILES.map((p) => ({ user_id: p.user_id, login_id: p.users.login_id, profiles: { full_name: p.full_name } })),
  parent_students: [{ parent_id: id(31), student_id: id(21), school_id: S1 }],
  schools: [{ id: S1, name: 'Test Public School', address: '1 Main Road, Pune', phone: '020 1234', email: 'office@test.school' }],
  fee_items: [
    { id: id(41), school_id: S1, session_id: SESSION.id, class_name: '5', name: 'Tuition', amount: 12000, frequency: 'quarterly', sort_order: 0, created_at: '2026-01-01' },
    { id: id(42), school_id: S1, session_id: SESSION.id, class_name: '5', name: 'Transport', amount: 6000, frequency: 'one_time', sort_order: 1, created_at: '2026-01-02' },
  ],
  student_fee_accounts: [{ id: id(51), school_id: S1, student_id: id(21), session_id: SESSION.id, class_id: id(71), class_name: '5' }],
  fee_adjustments: [],
  fee_payments: [{ id: id(61), school_id: S1, account_id: id(51), student_id: id(21), session_id: SESSION.id, receipt_seq: 1, receipt_no: 'RCP-000001', amount: 7000, paid_on: today, mode: 'upi', reference: 'UTR1', note: null, class_label: '5 A', allocation: [{ label: 'Tuition - Quarter 1', amount: 3000 }], balance_after: 11000, received_by: id(32), status: 'received' }],
  fee_counters: [{ school_id: S1, last_receipt: 1 }],
};

// ------------------------------------------------------------------ the fake query builder
const get = (r, k) => k.split('.').reduce((o, p) => (Array.isArray(o) ? o[0]?.[p] : o?.[p]), r);
class Q {
  constructor(name) { this.name = name; this.f = []; this.ord = []; this.op = 'select'; this.patch = null; this.rows = null; }
  select() { return this; }
  eq(k, v) { this.f.push((r) => get(r, k) === v); return this; }
  in(k, a) { this.f.push((r) => a.includes(get(r, k))); return this; }
  is(k, v) { this.f.push((r) => (v === null ? get(r, k) == null : get(r, k) === v)); return this; }
  not(k, op, v) { this.f.push((r) => (op === 'is' && v === null ? get(r, k) != null : true)); return this; }
  gte(k, v) { this.f.push((r) => get(r, k) >= v); return this; }
  lte(k, v) { this.f.push((r) => get(r, k) <= v); return this; }
  order(k, o = {}) { this.ord.push([k, o.ascending === false ? -1 : 1]); return this; }
  range(a, b) { this.rg = [a, b]; return this; }
  limit(n) { this.rg = [0, n - 1]; return this; }
  insert(o) { this.op = 'insert'; this.rows = Array.isArray(o) ? o : [o]; return this; }
  update(o) { this.op = 'update'; this.patch = o; return this; }
  delete() { this.op = 'delete'; return this; }
  _run() {
    const t = (DB[this.name] ||= []);
    if (this.op === 'insert') { const made = this.rows.map((r) => ({ id: id(900 + t.length), ...r })); t.push(...made); return made; }
    let out = t.filter((r) => this.f.every((fn) => fn(r)));
    if (this.op === 'update') { out.forEach((r) => Object.assign(r, this.patch)); return out; }
    if (this.op === 'delete') { DB[this.name] = t.filter((r) => !out.includes(r)); return out; }
    for (const [k, d] of [...this.ord].reverse()) out = [...out].sort((a, b) => (get(a, k) < get(b, k) ? -d : get(a, k) > get(b, k) ? d : 0));
    if (this.rg) out = out.slice(this.rg[0], this.rg[1] + 1);
    return out;
  }
  maybeSingle() { return Promise.resolve({ data: this._run()[0] ?? null, error: null }); }
  single() { const r = this._run()[0]; return Promise.resolve(r ? { data: r, error: null } : { data: null, error: { message: 'no row' } }); }
  then(res, rej) { try { const data = this._run(); return Promise.resolve({ data, error: null, count: data.length }).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
}
db.from = (name) => new Q(name);
db.rpc = async (fn, a) => { // the SQL function record_fee_payment, written out
  assert.equal(fn, 'record_fee_payment');
  const acc = DB.student_fee_accounts.find((x) => x.id === a.p_account && x.school_id === a.p_school);
  if (!acc) return { error: { message: 'Fee record not found', code: 'P0001' } };
  const paid = DB.fee_payments.filter((p) => p.account_id === acc.id && p.status === 'received').reduce((s, p) => s + Number(p.amount), 0);
  if (paid + a.p_amount > a.p_cap) return { error: { message: 'That is more than the pending balance', code: 'P0001' } };
  const c = DB.fee_counters.find((x) => x.school_id === a.p_school); c.last_receipt += 1;
  const row = { id: id(700 + c.last_receipt), school_id: a.p_school, account_id: acc.id, student_id: acc.student_id, session_id: acc.session_id, receipt_seq: c.last_receipt, receipt_no: `RCP-${String(c.last_receipt).padStart(6, '0')}`, amount: a.p_amount, paid_on: a.p_paid_on, mode: a.p_mode, reference: a.p_reference, note: a.p_note, class_label: a.p_class_label, allocation: a.p_allocation, balance_after: a.p_cap - paid - a.p_amount, received_by: a.p_by, status: 'received' };
  DB.fee_payments.push(row);
  return { data: row, error: null };
};

// ------------------------------------------------------------------ the app: the real router behind a stub sign-in
const USERS = {
  admin: { user_id: id(90), role: 'school_admin', school_id: S1, login_id: 'boss', features: ['view_student_fees', 'collect_fees', 'adjust_fees', 'cancel_fee_payment', 'manage_fee_structure'] },
  clerk: { user_id: id(32), role: 'staff', school_id: S1, login_id: 'clerk', features: ['view_student_fees', 'collect_fees'] },
  viewer: { user_id: id(33), role: 'staff', school_id: S1, login_id: 'v', features: ['view_student_fees'] },
  teacher: { user_id: id(34), role: 'staff', school_id: S1, login_id: 't', features: ['mark_attendance'] },
  parent: { user_id: id(31), role: 'parent', school_id: S1, login_id: 'mahesh', features: ['view_my_fees'] },
  other_parent: { user_id: id(35), role: 'parent', school_id: S1, login_id: 'op', features: ['view_my_fees'] },
  super: { user_id: id(91), role: 'super_admin', school_id: null, login_id: 'root', features: ['view_student_fees', 'collect_fees'] },
};
let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { const u = USERS[(req.headers.authorization || '').replace('Bearer ', '')]; if (!u) return res.status(401).json({ error: 'Please sign in' }); req.user = u; next(); });
  app.use('/api/fees', feesRoutes);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message })); // eslint-disable-line no-unused-vars
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/fees`;
});
after(() => server.close());
const call = (who, p, opt = {}) => fetch(base + p, { ...opt, headers: { Authorization: `Bearer ${who}`, 'Content-Type': 'application/json' } });
const csvOf = async (r) => { const b = Buffer.from(await r.arrayBuffer()); return { bom: b.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), text: b.subarray(3).toString('utf8') }; };
const json = async (who, p) => { const r = await call(who, p); return { status: r.status, body: await r.json() }; };
const pdfText = (buf) => { const f = path.join(os.tmpdir(), `t-${Date.now()}-${Math.random()}.pdf`); fs.writeFileSync(f, buf); try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } finally { fs.unlinkSync(f); } };

// ------------------------------------------------------------------ tests
test('pending list: who owes what, with class, parents and totals', async () => {
  const before = DB.student_fee_accounts.length;
  const { status, body } = await json('clerk', '/pending');
  assert.equal(status, 200);
  const by = Object.fromEntries(body.rows.map((r) => [r.full_name, r]));
  assert.deepEqual(Object.keys(by).sort(), ['=HYPERLINK("http://x")', 'Priya Verma', 'Rahul Sharma', 'राहुल गुप्ता'].sort()); // not Amit (no structure), not graduated / switched off
  assert.equal(by['Rahul Sharma'].pending, 11000); assert.equal(by['Rahul Sharma'].paid, 7000); assert.equal(by['Rahul Sharma'].class_label, '5 A');
  assert.equal(by['Priya Verma'].pending, 18000);
  assert.deepEqual(by['Rahul Sharma'].contacts, [{ relation: 'Father', name: 'Mahesh Sharma', phone: '9820011111' }]); // parent account + profile father merged into one
  assert.equal(body.rows[0].pending >= body.rows[body.rows.length - 1].pending, true);                                   // biggest first
  assert.deepEqual(body.summary.classes_without_fee_structure, ['6 A']);
  assert.equal(body.summary.total_pending, 11000 + 18000 * 3);
  assert.equal(DB.student_fee_accounts.length, before, 'viewing the list must not create fee records');
});

test('pending list filters', async () => {
  const names = async (q) => (await json('clerk', `/pending${q}`)).body.rows.map((r) => r.full_name).sort();
  assert.deepEqual(await names('?class_name=5'), ['=HYPERLINK("http://x")', 'Priya Verma', 'Rahul Sharma', 'राहुल गुप्ता'].sort());
  assert.deepEqual(await names(`?class_id=${id(72)}`), ['=HYPERLINK("http://x")', 'Priya Verma']);
  assert.deepEqual(await names('?q=rahul%20sh'), ['Rahul Sharma']);
  assert.deepEqual(await names('?min_pending=15000'), ['=HYPERLINK("http://x")', 'Priya Verma', 'राहुल गुप्ता'].sort());
  assert.equal((await json('clerk', '/pending?min_pending=abc')).status, 400);
  assert.equal((await json('clerk', '/pending?class_id=nope')).status, 400);
  assert.equal((await json('clerk', '/pending?limit=2')).body.rows.length, 2);
  assert.equal((await json('clerk', '/pending?limit=2')).body.truncated, true);
});

test('pending list is staff-only', async () => {
  assert.equal((await json('teacher', '/pending')).status, 403);
  assert.equal((await json('parent', '/pending')).status, 403);
  assert.equal((await json('parent', '/pending/download?format=csv')).status, 403);
  assert.equal((await json('nobody', '/pending')).status, 401);
  assert.equal((await json('viewer', '/pending')).status, 200);   // view_student_fees is enough to read
});

test('pending CSV: opens in Excel, keeps parents, and cannot run a formula', async () => {
  const r = await call('clerk', '/pending/download?format=csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.headers.get('content-disposition'), /attachment; filename="pending-fees-\d{4}-\d{2}-\d{2}\.csv"/);
  const { bom, text: t } = await csvOf(r);
  assert.ok(bom, 'starts with a BOM so Excel reads Hindi names');
  assert.match(t, /Student,Class,Roll no,Admission no,Login ID,Parent\(s\),Parent phone\(s\),Total fees,Paid,Pending,Due till date/);
  assert.match(t, /Rahul Sharma,5 A,3,AD21,rahul\.sharma,Father: Mahesh Sharma,9820011111,18000,7000,11000,/);
  assert.match(t, /राहुल गुप्ता/);
  assert.ok(!/(^|,)=HYPERLINK/m.test(t), 'a cell must never start with ='); assert.match(t, /"'=HYPERLINK\(""http:\/\/x""\)"/);
  assert.equal((await call('clerk', '/pending/download?format=xls')).status, 400);
});

test('pending PDF is a real PDF with the names, parents and totals', async () => {
  const r = await call('admin', '/pending/download?format=pdf&class_name=5');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const t = pdfText(buf);
  assert.match(t, /Test Public School/); assert.match(t, /PENDING FEES/);
  assert.match(t, /Rahul Sharma/); assert.match(t, /Father: Mahesh Sharma - 9820011111/); assert.match(t, /11,000\.00/);
  assert.match(t, /Total pending\s+Rs\. 65,000\.00|Rs\. 65,000\.00/);
  assert.match(t, /Page 1 of 1/);
  assert.ok(!/Amit Roy/.test(t));
  fs.writeFileSync('/tmp/pending.pdf', buf);
});

test('receipts list: today, by student, by receipt number, with totals', async () => {
  const a = await json('clerk', '/payments?period=today');
  assert.equal(a.status, 200); assert.equal(a.body.rows.length, 1);
  assert.equal(a.body.rows[0].student_name, 'Rahul Sharma'); assert.equal(a.body.rows[0].received_by, 'Clerk Kumar'); assert.equal(a.body.rows[0].receipt_no, 'RCP-000001');
  assert.equal(a.body.summary.total, 7000); assert.deepEqual(a.body.summary.by_mode, [{ name: 'upi', amount: 7000 }]);
  assert.equal((await json('clerk', '/payments?receipt_no=rcp-000001')).body.rows.length, 1);            // lower case is fine
  assert.equal((await json('clerk', `/payments?student_id=${id(21)}`)).body.rows.length, 1);
  assert.equal((await json('clerk', '/payments?period=yesterday')).body.rows.length, 0);
  assert.equal((await json('clerk', '/payments?period=today&mode=cash')).body.rows.length, 0);
  assert.equal((await json('clerk', '/payments?period=today&class_name=5')).body.rows.length, 1);
  assert.equal((await json('clerk', '/payments?period=today&class_name=6')).body.rows.length, 0);
  assert.equal((await json('clerk', '/payments?period=forever')).status, 400);
  assert.equal((await json('clerk', '/payments?from=2026-13-40')).status, 400);
  assert.equal((await json('clerk', '/payments?from=2026-05-02&to=2026-05-01')).status, 400);
  assert.equal((await json('parent', '/payments')).status, 403);
});

test('collection report downloads (CSV + PDF)', async () => {
  const { bom, text: csv } = await csvOf(await call('clerk', '/payments/download?format=csv&period=today'));
  assert.ok(bom);
  assert.match(csv, /^Receipt no,Date,Student,Class,Mode,Reference,Amount,Status,Received by/);
  assert.match(csv, /RCP-000001,\d{4}-\d{2}-\d{2},Rahul Sharma,5 A,UPI,UTR1,7000,Received,Clerk Kumar/);
  const r = await call('clerk', '/payments/download?format=pdf&period=today');
  assert.match(r.headers.get('content-disposition'), /fee-collection-/);
  const t = pdfText(Buffer.from(await r.arrayBuffer()));
  assert.match(t, /FEE COLLECTION/); assert.match(t, /RCP-000001/); assert.match(t, /7,000\.00/);
});

test('student statement PDF: staff (with parents) and the family (without)', async () => {
  const staff = await call('clerk', `/students/${id(21)}/statement`);
  assert.equal(staff.status, 200); assert.match(staff.headers.get('content-disposition'), /fee-statement-Rahul-Sharma-Current\.pdf/);
  const sbuf = Buffer.from(await staff.arrayBuffer()); fs.writeFileSync('/tmp/statement.pdf', sbuf);
  const t = pdfText(sbuf);
  assert.match(t, /FEE STATEMENT/); assert.match(t, /Rahul Sharma/); assert.match(t, /Father\s+Mahesh Sharma\s+9820011111/);
  assert.match(t, /Tuition - Quarter 1/); assert.match(t, /RCP-000001/); assert.match(t, /18,000\.00/); assert.match(t, /11,000\.00/);
  const mine = await call('parent', `/my/${id(21)}/statement`);
  assert.equal(mine.status, 200);
  assert.ok(!/Mahesh Sharma\s+9820011111/.test(pdfText(Buffer.from(await mine.arrayBuffer()))), 'family copy has no contact block');
  assert.equal((await call('other_parent', `/my/${id(21)}/statement`)).status, 403);                       // someone else's child
  assert.equal((await call('parent', `/students/${id(21)}/statement`)).status, 403);                      // staff route
  assert.equal((await call('teacher', `/students/${id(21)}/statement`)).status, 403);
  assert.equal((await call('clerk', `/students/${id(21)}/statement?session_id=bad`)).status, 400);
});

test('student account can include parents when asked (and not otherwise)', async () => {
  assert.equal((await json('clerk', `/students/${id(21)}`)).body.contacts, undefined);
  const c = (await json('clerk', `/students/${id(21)}?contacts=1`)).body.contacts;
  assert.deepEqual(c, [{ relation: 'Father', name: 'Mahesh Sharma', phone: '9820011111' }]);
});

test('student picker: default 50, bigger list for the assistant', async () => {
  const r = await json('clerk', '/students?limit=3000');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((x) => x.full_name).sort(), ['=HYPERLINK("http://x")', 'Amit Roy', 'Priya Verma', 'Rahul Sharma', 'राहुल गुप्ता'].sort());
});

test('collect a payment, then it shows in the list and the receipt downloads', async () => {
  const pay = await call('clerk', `/students/${id(22)}/payments`, { method: 'POST', body: JSON.stringify({ amount: '5000', mode: 'cash' }) });
  assert.equal(pay.status, 201);
  const { payment, account } = await pay.json();
  assert.equal(payment.receipt_no, 'RCP-000002'); assert.equal(account.ledger.totals.pending, 13000);
  const list = (await json('clerk', '/payments?period=today')).body;
  assert.equal(list.summary.total, 12000); assert.equal(list.rows[0].receipt_no, 'RCP-000002');
  const rec = await call('clerk', `/payments/${payment.id}/receipt`);
  assert.equal(rec.status, 200); assert.match(pdfText(Buffer.from(await rec.arrayBuffer())), /RCP-000002/);
  const over = await call('clerk', `/students/${id(22)}/payments`, { method: 'POST', body: JSON.stringify({ amount: '99999', mode: 'cash' }) });
  assert.equal(over.status, 400);
  assert.equal((await json('clerk', '/pending')).body.rows.find((x) => x.full_name === 'Priya Verma').pending, 13000); // the list moved with it
});

test('a super admin must pick a school', async () => {
  assert.equal((await json('super', '/pending')).status, 400);
  assert.equal((await json('super', `/pending?school_id=${S1}`)).status, 200);
});
