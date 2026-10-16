// Run:  cd server && node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePending, mergeContacts, periodRange, summarizePayments } from '../src/feeInsights.js';
import { buildLedger } from '../src/feeLedger.js';

const session = { id: 's1', name: '2026-2027', is_current: true, start_date: '2026-04-01' };
const today = '2026-10-15';
const items = [
  { id: 'i1', class_name: '5', name: 'Tuition', amount: 12000, frequency: 'quarterly', sort_order: 0 }, // 3000 due Apr, Jul, Oct, Jan
  { id: 'i2', class_name: '5', name: 'Transport', amount: 6000, frequency: 'one_time', sort_order: 1 },
];
const stu = (id, name, over = {}) => ({ student_id: id, full_name: name, login_id: name.toLowerCase().replace(' ', '.'), roll_no: 1, admission_no: `A${id}`, class_id: 'c5a', class_name: '5', class_label: '5 A', level: 5, ...over });
const base = { session, today, items, accounts: [], adjustments: [], payments: [] };

test('a student with no fee record yet owes the full class fees, and nothing is created', () => {
  const { rows, summary } = assemblePending({ ...base, students: [stu('u1', 'Rahul Sharma')] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 18000); assert.equal(rows[0].pending, 18000);
  assert.equal(rows[0].due_till_date, 3000 * 3 + 6000); // Apr, Jul, Oct quarters + transport (due Apr 1)
  assert.equal(summary.total_pending, 18000);
});

test('matches the per-student ledger exactly (payments, discounts, charges)', () => {
  const acc = { id: 'a1', student_id: 'u1', class_name: '5' };
  const adjustments = [{ account_id: 'a1', item_id: 'i1', amount: -1200, reason: 'sibling', applied_on: '2026-05-01' }, { account_id: 'a1', item_id: null, amount: 500, reason: 'Late fine', applied_on: '2026-09-01' }];
  const payments = [{ account_id: 'a1', amount: 7000, status: 'received' }, { account_id: 'a1', amount: 9999, status: 'cancelled' }];
  const { rows } = assemblePending({ ...base, students: [stu('u1', 'Rahul Sharma')], accounts: [acc], adjustments, payments });
  const led = buildLedger({ items, adjustments, payments, session, today }).totals;
  assert.equal(rows[0].pending, led.pending); assert.equal(rows[0].due_till_date, led.due_till_date); assert.equal(rows[0].paid, 7000);
});

test('fully paid students are left out; min_pending, due_now and class filters work', () => {
  const students = [stu('u1', 'Rahul Sharma'), stu('u2', 'Paid Fully'), stu('u3', 'Small Due', { class_id: 'c6', class_name: '6', class_label: '6 A', level: 6 })];
  const accounts = [{ id: 'a2', student_id: 'u2', class_name: '5' }];
  const payments = [{ account_id: 'a2', amount: 18000, status: 'received' }];
  const all = assemblePending({ ...base, students, accounts, payments });
  assert.deepEqual(all.rows.map((r) => r.student_id), ['u1']);
  assert.deepEqual(all.summary.classes_without_fee_structure, ['6 A']); // class 6 has no structure: said, not hidden
  assert.equal(all.summary.students_checked, 3);
  assert.equal(assemblePending({ ...base, students, accounts, payments, filters: { minPending: 20000 } }).rows.length, 0);
  assert.equal(assemblePending({ ...base, students, accounts, payments, filters: { className: ' 5 ' } }).rows.length, 1);
  assert.equal(assemblePending({ ...base, students, accounts, payments, filters: { classId: 'c6' } }).rows.length, 0);
  assert.equal(assemblePending({ ...base, students, accounts, payments, filters: { dueNow: true } }).rows[0].due_till_date, 15000);
});

test('class changed with no money received follows the new class; with money received it stays', () => {
  const moved = stu('u1', 'Rahul Sharma', { class_name: '6', class_label: '6 A', class_id: 'c6' });
  const items6 = [...items, { id: 'i9', class_name: '6', name: 'Tuition', amount: 1000, frequency: 'one_time', sort_order: 0 }];
  const acc = { id: 'a1', student_id: 'u1', class_name: '5' };
  assert.equal(assemblePending({ ...base, items: items6, students: [moved], accounts: [acc] }).rows[0].total, 1000);
  const paid = assemblePending({ ...base, items: items6, students: [moved], accounts: [acc], payments: [{ account_id: 'a1', amount: 100, status: 'received' }] });
  assert.equal(paid.rows[0].total, 18000);
});

test('past session uses the class stored on the fee record', () => {
  const past = { ...session, is_current: false };
  const moved = stu('u1', 'Rahul Sharma', { class_name: '6', class_label: '6 A' });
  const r = assemblePending({ ...base, session: past, students: [moved], accounts: [{ id: 'a1', student_id: 'u1', class_name: '5' }] });
  assert.equal(r.rows[0].total, 18000);
  assert.equal(assemblePending({ ...base, session: past, students: [moved], accounts: [] }).rows.length, 0); // no record in an old session = nothing owed
});

test('sorting and search', () => {
  const students = [stu('u1', 'Zed Khan', { roll_no: 2 }), stu('u2', 'Amit Roy', { roll_no: 1 })];
  const payments = [{ account_id: 'a1', amount: 1000, status: 'received' }];
  const accounts = [{ id: 'a1', student_id: 'u1', class_name: '5' }];
  assert.equal(assemblePending({ ...base, students, accounts, payments }).rows[0].student_id, 'u2');                 // biggest pending first
  assert.equal(assemblePending({ ...base, students, accounts, payments, filters: { sort: 'name' } }).rows[0].full_name, 'Amit Roy');
  assert.deepEqual(assemblePending({ ...base, students, accounts, payments, filters: { q: 'zed' } }).rows.map((r) => r.student_id), ['u1']);
});

test('contacts: a parent account that is the father on the profile is one person', () => {
  const c = mergeContacts([{ name: 'Mahesh Sharma', phone: '98200 11111', login_id: 'mahesh' }], { father_name: 'mahesh sharma', father_phone: null, mother_name: 'Sunita Sharma', mother_phone: '9820022222' });
  assert.deepEqual(c, [{ relation: 'Father', name: 'mahesh sharma', phone: '98200 11111' }, { relation: 'Mother', name: 'Sunita Sharma', phone: '9820022222' }]);
  assert.deepEqual(mergeContacts([{ name: 'Uncle Raj', phone: '1' }], {}), [{ relation: 'Parent', name: 'Uncle Raj', phone: '1' }]);
  assert.deepEqual(mergeContacts([], {}), []);
});

test('periods use the school date', () => {
  assert.deepEqual(periodRange('today', '2026-10-15'), { from: '2026-10-15', to: '2026-10-15' });
  assert.deepEqual(periodRange('yesterday', '2026-10-01'), { from: '2026-09-30', to: '2026-09-30' });
  assert.deepEqual(periodRange('this_week', '2026-10-15'), { from: '2026-10-12', to: '2026-10-15' }); // Thursday -> Monday
  assert.deepEqual(periodRange('this_month', '2026-10-15'), { from: '2026-10-01', to: '2026-10-15' });
  assert.deepEqual(periodRange('last_month', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(periodRange('last_month', '2026-03-05'), { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(periodRange('nope', '2026-10-15'), null);
});

test('payment summary counts cancelled receipts apart', () => {
  const s = summarizePayments([{ amount: 100.5, mode: 'cash', status: 'received', class_label: '5 A' }, { amount: 200, mode: 'upi', status: 'received', class_label: '5 A' }, { amount: 999, mode: 'cash', status: 'cancelled', class_label: '5 A' }]);
  assert.equal(s.total, 300.5); assert.equal(s.receipts, 2); assert.equal(s.cancelled_receipts, 1); assert.equal(s.cancelled_total, 999);
  assert.deepEqual(s.by_mode, [{ name: 'upi', amount: 200 }, { name: 'cash', amount: 100.5 }]);
});
