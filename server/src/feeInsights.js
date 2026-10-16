// Fee reports with no database in them (so they can be tested alone). fees.js loads the rows, this file works them out.
//
//   assemblePending(...)   one row per student: total, paid, pending, due till date (+ the class filter / search / sorting)
//   mergeContacts(...)     the parent names + phones to show next to a student (linked parent accounts + father / mother on the profile)
//   periodRange(...)       "today", "yesterday", "this_month", "last_month" in the school's own date
//   summarizePayments(...) totals of a list of receipts: by mode and by class
import { buildLedger, toPaise, toRupees } from './feeLedger.js';

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const sameName = (a, b) => !!a && !!b && norm(a) === norm(b);

// ---------------------------------------------------------------- who to call
// linked: [{name, phone, login_id}] parent accounts linked to the student
// student: {father_name, mother_name, father_phone, mother_phone}
export function mergeContacts(linked = [], student = {}) {
  const out = [];
  const add = (c) => { if (c.name || c.phone) out.push({ relation: c.relation || null, name: c.name || null, phone: c.phone || null }); };
  const fam = [
    { relation: 'Father', name: student.father_name, phone: student.father_phone },
    { relation: 'Mother', name: student.mother_name, phone: student.mother_phone },
  ].filter((c) => c.name || c.phone);
  const used = new Set();
  for (const p of linked) {
    // a parent account that is the father / mother already written on the profile is ONE person, not two
    const i = fam.findIndex((f, k) => !used.has(k) && (sameName(f.name, p.name) || (f.phone && p.phone && f.phone.replace(/\D/g, '').slice(-10) === p.phone.replace(/\D/g, '').slice(-10))));
    if (i >= 0) { used.add(i); add({ relation: fam[i].relation, name: fam[i].name || p.name, phone: p.phone || fam[i].phone }); }
    else add({ relation: 'Parent', name: p.name || p.login_id, phone: p.phone });
  }
  fam.forEach((f, k) => { if (!used.has(k)) add(f); });
  return out;
}

// ---------------------------------------------------------------- the pending list
/**
 * session:     {id, name, is_current}
 * today:       'YYYY-MM-DD' (school date)
 * students:    [{student_id, full_name, login_id, roll_no, admission_no, class_id, class_name, class_label, level, father_name, ...}]
 * accounts:    [{id, student_id, class_name}]                       the session's fee records
 * items:       [{id, class_name, name, amount, frequency, sort_order, created_at}]
 * adjustments: [{account_id, item_id, amount, reason, applied_on}]  live (not voided) ones
 * payments:    [{account_id, amount, status}]                       received ones
 * filters:     {classId, className, minPending, dueNow, q, sort: 'amount'|'class'|'name'}
 *
 * Nobody's fee record is created here: a student with no record yet simply owes the full fees of their class.
 */
export function assemblePending({ session, today, students, accounts, items, adjustments, payments, filters = {} }) {
  const accOf = new Map(accounts.map((a) => [a.student_id, a]));
  const itemsOf = new Map();
  for (const it of items) { if (!itemsOf.has(it.class_name)) itemsOf.set(it.class_name, []); itemsOf.get(it.class_name).push(it); }
  for (const list of itemsOf.values()) list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  const adjOf = new Map(), payOf = new Map();
  for (const a of adjustments) { if (!adjOf.has(a.account_id)) adjOf.set(a.account_id, []); adjOf.get(a.account_id).push(a); }
  const hasReceived = new Set();
  for (const p of payments) { if ((p.status || 'received') !== 'received') continue; hasReceived.add(p.account_id); if (!payOf.has(p.account_id)) payOf.set(p.account_id, []); payOf.get(p.account_id).push(p); }

  // which class's fees apply: the same rule fees.js ensureAccount follows - in the current session the student's class,
  // unless money was already received under another class (then the record stays where it was)
  const classOf = (s, acc) => {
    if (!session.is_current) return acc?.class_name ?? null;
    if (!acc || (acc.class_name || null) === (s.class_name || null)) return s.class_name ?? acc?.class_name ?? null;
    return hasReceived.has(acc.id) ? acc.class_name : s.class_name;
  };

  const needle = norm(filters.q);
  const wantGroup = norm(filters.className);
  const min = Number(filters.minPending) > 0 ? toPaise(filters.minPending) : 0;
  const rows = [], noStructure = new Set();
  let counted = 0;

  for (const s of students) {
    const acc = accOf.get(s.student_id) || null;
    const cls = classOf(s, acc);
    if (filters.classId && s.class_id !== filters.classId) continue;
    if (wantGroup && norm(cls) !== wantGroup) continue;
    if (needle && !`${s.full_name} ${s.login_id} ${s.admission_no ?? ''}`.toLowerCase().includes(needle)) continue;
    counted += 1;
    const list = itemsOf.get(cls) || [];
    if (!list.length) { noStructure.add(s.class_label || cls || 'No class'); continue; }
    const led = buildLedger({ items: list, adjustments: acc ? adjOf.get(acc.id) || [] : [], payments: acc ? payOf.get(acc.id) || [] : [], session, today });
    const t = led.totals;
    const unpaid = led.lines.filter((l) => toPaise(l.pending) > 0);
    rows.push({
      student_id: s.student_id, full_name: s.full_name, login_id: s.login_id, class_label: s.class_label || cls || '-', class_name: cls,
      roll_no: s.roll_no ?? null, admission_no: s.admission_no ?? null,
      total: t.total, paid: t.paid, pending: t.pending, due_till_date: t.due_till_date,
      oldest_due_date: unpaid.length ? unpaid[0].due_date : null, next_due_date: t.next_due_date,
      _level: s.level ?? 1e9, _paise: { pending: toPaise(t.pending), due: toPaise(t.due_till_date) },
      _student: s,
    });
  }

  const basis = filters.dueNow ? 'due' : 'pending';
  const owing = rows.filter((r) => r._paise[basis] > 0 && r._paise[basis] >= min);
  const sort = filters.sort || 'amount';
  const byClass = (a, b) => a._level - b._level || String(a.class_label).localeCompare(String(b.class_label), undefined, { numeric: true }) || (a.roll_no ?? 1e9) - (b.roll_no ?? 1e9) || a.full_name.localeCompare(b.full_name);
  owing.sort(sort === 'class' ? byClass : sort === 'name' ? (a, b) => a.full_name.localeCompare(b.full_name) : (a, b) => b._paise[basis] - a._paise[basis] || byClass(a, b));

  const sum = (k) => owing.reduce((s, r) => s + r._paise[k], 0);
  const summary = {
    session: { id: session.id, name: session.name }, as_of: today,
    students_checked: counted, students_owing: owing.length,
    total_pending: toRupees(sum('pending')), total_due_till_date: toRupees(sum('due')),
    classes_without_fee_structure: [...noStructure].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    filter: { class: filters.className || null, min_pending: Number(filters.minPending) || null, due_now: !!filters.dueNow, q: filters.q || null },
  };
  return { summary, rows: owing };
}

// strip the helper fields before a row leaves the server
export const publicRow = ({ _level, _paise, _student, ...r }) => r;

// ---------------------------------------------------------------- periods
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
function addDays(dateStr, n) { const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

export const PERIODS = ['today', 'yesterday', 'this_week', 'this_month', 'last_month'];
// returns {from, to} (inclusive, school dates) or null for an unknown name
export function periodRange(name, today) {
  const [y, m] = today.split('-').map(Number);
  switch (name) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const d = addDays(today, -1); return { from: d, to: d }; }
    case 'this_week': { const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; return { from: addDays(today, -dow), to: today }; } // Monday..today
    case 'this_month': return { from: `${y}-${pad(m)}-01`, to: today };
    case 'last_month': { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` }; }
    default: return null;
  }
}

// ---------------------------------------------------------------- receipts
// payments: [{amount, mode, status, class_label}]  -> totals of the RECEIVED ones (cancelled are counted separately)
export function summarizePayments(payments) {
  const byMode = new Map(), byClass = new Map();
  let total = 0, count = 0, cancelled = 0, cancelledAmount = 0;
  for (const p of payments) {
    const paise = toPaise(p.amount);
    if (p.status === 'cancelled') { cancelled += 1; cancelledAmount += paise; continue; }
    total += paise; count += 1;
    byMode.set(p.mode, (byMode.get(p.mode) || 0) + paise);
    const c = p.class_label || '-';
    byClass.set(c, (byClass.get(c) || 0) + paise);
  }
  const list = (m) => [...m.entries()].map(([k, v]) => ({ name: k, amount: toRupees(v) })).sort((a, b) => b.amount - a.amount);
  return { receipts: count, total: toRupees(total), cancelled_receipts: cancelled, cancelled_total: toRupees(cancelledAmount), by_mode: list(byMode), by_class: list(byClass) };
}
