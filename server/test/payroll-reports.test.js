import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/payroll-logic.js';
import { toCsv, tablePdf } from '../src/feeReports.js';

// October 2026: 31 days. Sundays 4, 11, 18, 25 are weekly offs; 2 Oct is a holiday -> 26 working days.
const isOff = L.offDayChecker([0], [{ type: 'holiday', start_date: '2026-10-02', end_date: '2026-10-02' }]);
const casual = (days) => ({ name: 'Casual', is_paid: true, days_detail: days });
const lop = (days) => ({ name: 'Loss of pay', is_paid: false, days_detail: days });

test('present days = working days minus leave (full and half days)', () => {
  const a = L.attendanceOf({ period: '2026-10-01', isOff, through: null, leaves: [
    casual([{ date: '2026-10-05', value: 1 }, { date: '2026-10-06', value: 0.5 }]),
    lop([{ date: '2026-10-07', value: 1 }]),
  ] });
  assert.equal(a.working_days, 26);
  assert.equal(a.leave_days, 2.5);
  assert.equal(a.present_days, 23.5);
  assert.equal(a.paid_leave_days, 1.5);
  assert.equal(a.unpaid_leave_days, 1);
  assert.deepEqual(a.by_type.map((t) => [t.name, t.days]), [['Casual', 1.5], ['Loss of pay', 1]]);
});

test('leave on a weekly off or holiday is not counted against present days', () => {
  const a = L.attendanceOf({ period: '2026-10-01', isOff, through: null, leaves: [casual([{ date: '2026-10-11', value: 1 }])] });
  assert.equal(a.leave_days, 0);
  assert.equal(a.present_days, 26);
  assert.equal(a.codes['2026-10-11'], 'O');
});

test('day codes for the attendance register', () => {
  const a = L.attendanceOf({ period: '2026-10-01', isOff, through: null, leaves: [
    casual([{ date: '2026-10-05', value: 1 }, { date: '2026-10-06', value: 0.5 }]),
    lop([{ date: '2026-10-07', value: 1 }]),
  ] });
  assert.equal(a.codes['2026-10-01'], 'P');
  assert.equal(a.codes['2026-10-05'], 'L');
  assert.equal(a.codes['2026-10-06'], 'H');
  assert.equal(a.codes['2026-10-07'], 'LWP');
  assert.equal(a.codes['2026-10-02'], 'O');
});

test('current month counts only up to today, so future days are not shown as present', () => {
  const a = L.attendanceOf({ period: '2026-10-01', isOff, through: '2026-10-06', leaves: [casual([{ date: '2026-10-05', value: 1 }])] });
  assert.equal(a.working_days, 4); // 1, 5, 6 and 3 Oct (Sat) is working; 2 Oct holiday, 4 Oct Sunday
  assert.equal(a.present_days, 3);
  assert.equal(a.codes['2026-10-07'], undefined);
});

test('a future month has no working days yet', () => {
  const a = L.attendanceOf({ period: '2026-12-01', isOff, through: '2026-11-09', leaves: [] });
  assert.equal(a.working_days, 0);
  assert.equal(a.present_days, 0);
});

test('leave from another month is ignored', () => {
  const a = L.attendanceOf({ period: '2026-10-01', isOff, through: null, leaves: [casual([{ date: '2026-09-30', value: 1 }, { date: '2026-11-02', value: 1 }])] });
  assert.equal(a.leave_days, 0);
});

test('payslip cuts only what the balance did not cover, and the same days are settled', () => {
  const p = L.buildPayslip({ salary: 26000, basis: 'working_days', period: '2026-10-01', workingDays: 26,
    taken: [{ type_id: 'c', name: 'Casual', is_paid: true, days: 3 }],
    balanceAtEnd: { c: -1 }, adjustments: [{ kind: 'bonus', label: 'Diwali', amount: 500 }] });
  assert.equal(p.unpaid_days, 1);
  assert.equal(p.leave_deduction, 1000);
  assert.equal(p.net_pay, 25500);
  assert.deepEqual(p.settle, [{ type_id: 'c', name: 'Casual', days: 1 }]);
});

test('a report file is produced for a row set with Hindi and quoted names', async () => {
  const csv = toCsv([{ label: 'Employee', csv: (x) => x.name }, { label: 'Present', csv: (x) => x.present }],
    [{ name: 'Ravi "R" Sharma, Jr', present: 23.5 }, { name: '=HYPERLINK("x")', present: 0 }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"Ravi ""R"" Sharma, Jr"'));
  assert.ok(csv.includes("'=HYPERLINK"));
  const pdf = await tablePdf({ school: { name: 'Test School' }, title: 'Staff attendance', columns: [{ label: 'Employee', weight: 1, get: (x) => x.name }], rows: [{ name: 'Priyа Nair' }], note: 'P = present' });
  assert.equal(pdf.slice(0, 4).toString(), '%PDF');
});
