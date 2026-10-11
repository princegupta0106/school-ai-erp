// Pure payroll / leave maths (no database here, so it is easy to test).
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s) => DATE.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const utc = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const todayStr = () => new Date().toLocaleDateString('en-CA'); // server-local YYYY-MM-DD
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round1 = (n) => Math.round(Number(n) * 10) / 10;

export const monthStart = (s) => `${s.slice(0, 7)}-01`;
export const monthEnd = (s) => { const d = utc(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1, 0); return iso(d); };
export const daysInMonth = (s) => Number(monthEnd(s).slice(8));
export const nextMonth = (s) => addDays(monthEnd(s), 1);
export const monthLabel = (s) => utc(monthStart(s)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// 'YYYY-MM' or 'YYYY-MM-DD' -> first of month, or null
export const toPeriod = (s) => (/^\d{4}-\d{2}(-\d{2})?$/.test(String(s || '')) && isDate(`${String(s).slice(0, 7)}-01`) ? monthStart(String(s)) : null);

// is this date a non-working day? (weekly off, or inside a holiday / vacation of the school calendar)
export function offDayChecker(weeklyOff, holidays) {
  const off = new Set((weeklyOff || []).map(Number));
  const blocks = (holidays || []).filter((h) => ['holiday', 'vacation'].includes(h.type));
  return (s) => off.has(utc(s).getUTCDay()) || blocks.some((h) => s >= h.start_date && s <= h.end_date);
}

// counted working days of a leave: [{date, value}]
export function leaveDays(start, end, half, isOff) {
  if (!isDate(start) || !isDate(end)) throw new Error('Enter valid dates');
  if (end < start) throw new Error('End date is before the start date');
  if (half && start !== end) throw new Error('A half day can only be for a single date');
  const out = [];
  for (let d = start, i = 0; d <= end; d = addDays(d, 1), i++) {
    if (i > 366) throw new Error('Leave cannot be longer than a year');
    if (!isOff(d)) out.push({ date: d, value: half ? 0.5 : 1 });
  }
  if (!out.length) throw new Error('Those dates are all weekly offs or holidays, no leave is needed');
  return out;
}

// [{date,value}] -> { 'YYYY-MM-01': {days, first} }
export function byMonth(detail) {
  const m = {};
  for (const d of detail) {
    const k = monthStart(d.date);
    m[k] ||= { days: 0, first: d.date };
    m[k].days = round1(m[k].days + Number(d.value));
    if (d.date < m[k].first) m[k].first = d.date;
  }
  return m;
}

export function dayRate(basis, salary, period, workingDaysInMonth) {
  const div = basis === 'calendar_days' ? daysInMonth(period) : basis === 'fixed_30' ? 30 : Math.max(1, workingDaysInMonth);
  return { divisor: div, rate: round2(Number(salary) / div) };
}
export const workingDaysIn = (period, isOff) => {
  let n = 0; for (let d = monthStart(period); d <= monthEnd(period); d = addDays(d, 1)) if (!isOff(d)) n++; return n;
};

/**
 * Builds one payslip's numbers.
 *  salary            monthly gross
 *  taken             [{type_id, name, is_paid, days}] approved leave days that fall in the month
 *  balanceAtEnd      { type_id: ledger balance up to the end of the month }  (paid types only)
 *  adjustments       [{kind,label,amount}] for that month
 * Rule: unpaid-type days are always cut. For paid types, only the part that pushed the balance below zero
 * (capped at the days taken this month) is cut. That same number of days is later added back to the leave
 * balance ("settlement"), so the person is never charged twice (money AND leave).
 */
export function buildPayslip({ salary, basis, period, workingDays, taken, balanceAtEnd, adjustments }) {
  const { divisor, rate } = dayRate(basis, salary, period, workingDays);
  const leaves = []; let unpaid = 0; const settle = [];
  for (const t of taken) {
    const days = round1(t.days);
    if (!t.is_paid) { leaves.push({ type: t.name, taken: days, covered: 0, cut: days, reason: 'Unpaid leave type' }); unpaid += days; continue; }
    const bal = Number(balanceAtEnd[t.type_id] || 0);
    const cut = round1(Math.min(Math.max(0, -bal), days));
    leaves.push({ type: t.name, taken: days, covered: round1(days - cut), cut, reason: cut ? 'Balance ran out' : 'Covered by balance' });
    if (cut > 0) { unpaid += cut; settle.push({ type_id: t.type_id, name: t.name, days: cut }); }
  }
  unpaid = round1(unpaid);
  const base = round2(salary);
  const leave_deduction = Math.min(base, round2(rate * unpaid));
  const bonuses = adjustments.filter((a) => a.kind === 'bonus');
  const cuts = adjustments.filter((a) => a.kind === 'deduction');
  const bonus_total = round2(bonuses.reduce((s, a) => s + Number(a.amount), 0));
  const other_deduction_total = round2(cuts.reduce((s, a) => s + Number(a.amount), 0));
  const net_pay = round2(base - leave_deduction + bonus_total - other_deduction_total);
  return {
    base_salary: base, rate_per_day: rate, unpaid_days: unpaid, leave_deduction, bonus_total, other_deduction_total, net_pay,
    settle,
    breakdown: { basis, divisor, rate, leaves, bonuses: bonuses.map((a) => ({ label: a.label, amount: Number(a.amount) })), deductions: cuts.map((a) => ({ label: a.label, amount: Number(a.amount) })) },
  };
}
