// Fees functions. Routes (routes/fees.js) check the feature and call these, so other modules
// (reports, parent panel...) can reuse them.
//
//   sessionsOf(school) / resolveSession(school, id)    academic sessions (default = the current one)
//   loadStudent(school, studentId)                      name, class, roll, admission no.
//   searchStudents(school, {q, classId})                students for the picker
//   ensureAccount(school, student, session)             the student's fee record for a session (created on first use)
//   accountView(school, studentId, sessionId, staff)    EVERYTHING for one student: totals, instalments, payments, adjustments
//   accountSummary(...)                                 just the totals (for lists)
//   structureView / saveItem / deleteItem / copyStructure   the fee structure
//   recordPayment / cancelPayment / addAdjustment / voidAdjustment
//   pendingStudents(school, opts)                       who owes what, school-wide (class, parents, due till date) - feeInsights.js does the sums
//   listPayments(school, filters)                       receipts of a period / student, with totals by mode and class
//   studentContacts(school, studentId)                  a student's parents (names + phones)
import { db, httpError, check } from './db.js';
import { todayStr, validDate } from './attendance.js';
import { notifyFee } from './notify.js';
import { buildLedger, allocate, toPaise, toRupees, FREQUENCIES, FREQUENCY_KEYS, describeItem } from './feeLedger.js';
import { assemblePending, publicRow, mergeContacts, periodRange, summarizePayments } from './feeInsights.js';

export const MODES = ['cash', 'upi', 'cheque', 'bank_transfer', 'card', 'other'];
const MAX_MONEY = 10_000_000; // Rs. 1 crore per entry: catches a typo like an extra zero
const one = (x) => (Array.isArray(x) ? x[0] : x);
const clsLabel = (name, section) => `${name}${section ? ` ${section}` : ''}`;

async function fetchAll(make) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    check(error);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// ---------------------------------------------------------------- money input
export function money(v, what = 'Amount') {
  if (v === '' || v === null || v === undefined || !/^\d+(\.\d{1,2})?$/.test(String(v).trim())) throw httpError(400, `${what} must be a number like 5000 or 2500.50`);
  const n = Number(v);
  if (!(n > 0)) throw httpError(400, `${what} must be above zero`);
  if (n > MAX_MONEY) throw httpError(400, `${what} is too large`);
  return n;
}
const text = (v, max, what, required = false) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw httpError(400, `${what} is required`);
  if (s.length > max) throw httpError(400, `${what} is too long (max ${max} characters)`);
  return s || null;
};

// ---------------------------------------------------------------- names
async function namesOf(ids) {
  const map = new Map();
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await db.from('users').select('user_id,login_id,profiles(full_name)').in('user_id', list.slice(i, i + 200));
    check(error);
    data.forEach((u) => map.set(u.user_id, one(u.profiles)?.full_name || u.login_id));
  }
  return map;
}

// ---------------------------------------------------------------- sessions
export async function sessionsOf(school) {
  const { data, error } = await db.from('academic_sessions').select('id,name,start_date,end_date,is_current').eq('school_id', school).order('start_date', { ascending: false });
  check(error);
  return data;
}
export async function resolveSession(school, id) {
  let q = db.from('academic_sessions').select('id,name,start_date,end_date,is_current').eq('school_id', school);
  q = id ? q.eq('id', id) : q.eq('is_current', true);
  const { data, error } = await q.maybeSingle();
  check(error);
  if (!data) throw httpError(id ? 404 : 400, id ? 'Session not found' : 'There is no current session. Create one under School > Sessions & holidays first.');
  return data;
}

// ---------------------------------------------------------------- students
export async function loadStudent(school, studentId) {
  const { data, error } = await db.from('profiles')
    .select('user_id,full_name,roll_no,admission_no,class_id,extra,classes(name,section),users!inner(login_id,is_active,role)')
    .eq('user_id', studentId).eq('school_id', school).maybeSingle();
  check(error);
  const u = data && one(data.users);
  if (!data || u.role !== 'student') throw httpError(404, 'Student not found');
  const c = one(data.classes);
  return {
    student_id: data.user_id, full_name: data.full_name || u.login_id, login_id: u.login_id, roll_no: data.roll_no, admission_no: data.admission_no,
    class_id: data.class_id, class_name: c?.name || null, class_label: c ? clsLabel(c.name, c.section) : null,
    active: u.is_active, graduated: data.extra?.graduated === true,
  };
}

export async function searchStudents(school, { q, classId, limit = 50 }) {
  const rows = await fetchAll(() => {
    let b = db.from('profiles')
      .select('user_id,full_name,roll_no,admission_no,class_id,extra,classes(name,section,level),users!inner(login_id,is_active,role)')
      .eq('school_id', school).eq('users.role', 'student').eq('users.is_active', true).order('user_id');
    if (classId) b = b.eq('class_id', classId);
    return b;
  });
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter((p) => p.extra?.graduated !== true)
    .map((p) => { const c = one(p.classes); return { student_id: p.user_id, full_name: p.full_name || one(p.users).login_id, login_id: one(p.users).login_id, roll_no: p.roll_no, admission_no: p.admission_no, class_label: c ? clsLabel(c.name, c.section) : 'No class', level: c?.level ?? 1e9 }; })
    .filter((s) => !needle || `${s.full_name} ${s.login_id} ${s.admission_no ?? ''} ${s.roll_no ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => a.level - b.level || a.class_label.localeCompare(b.class_label, undefined, { numeric: true }) || (a.roll_no ?? 1e9) - (b.roll_no ?? 1e9) || a.full_name.localeCompare(b.full_name))
    .slice(0, Math.min(Math.max(Number(limit) || 50, 1), 3000)).map(({ level, ...s }) => s);
}

// ---------------------------------------------------------------- the student's fee record for a session
async function findAccount(school, studentId, sessionId) {
  const { data, error } = await db.from('student_fee_accounts').select('*').eq('school_id', school).eq('student_id', studentId).eq('session_id', sessionId).maybeSingle();
  check(error);
  return data;
}

// Created the first time someone opens the student in the CURRENT session. Older sessions must already have one (made when the year was closed).
// While nothing has been paid, a change of class moves the record to the new class.
export async function ensureAccount(school, student, session) {
  let acc = await findAccount(school, student.student_id, session.id);
  if (!acc) {
    if (!session.is_current) throw httpError(404, `No fee record for ${student.full_name} in session ${session.name}`);
    const { data, error } = await db.from('student_fee_accounts')
      .insert({ school_id: school, student_id: student.student_id, session_id: session.id, class_id: student.class_id, class_name: student.class_name }).select().single();
    if (error?.code === '23505') acc = await findAccount(school, student.student_id, session.id); // opened twice at the same moment
    else { check(error); acc = data; }
  } else if (session.is_current && (acc.class_name || null) !== (student.class_name || null)) {
    const { count } = await db.from('fee_payments').select('id', { count: 'exact', head: true }).eq('account_id', acc.id).eq('status', 'received');
    if (!count) {
      const { data, error } = await db.from('student_fee_accounts').update({ class_id: student.class_id, class_name: student.class_name }).eq('id', acc.id).select().single();
      check(error); acc = data;
    }
  }
  return acc;
}

async function classItems(school, session, className) {
  if (!className) return [];
  const { data, error } = await db.from('fee_items').select('id,name,amount,frequency,sort_order,created_at')
    .eq('school_id', school).eq('session_id', session.id).eq('class_name', className).order('sort_order').order('created_at');
  check(error);
  return data;
}

async function loadLedgerData(school, acc, session) {
  const items = await classItems(school, session, acc.class_name);
  const [adj, pay] = await Promise.all([
    db.from('fee_adjustments').select('*').eq('account_id', acc.id).order('created_at'),
    db.from('fee_payments').select('*').eq('account_id', acc.id).order('paid_on').order('created_at'),
  ]);
  check(adj.error); check(pay.error);
  return { items, adjustments: adj.data, payments: pay.data };
}

const ledgerOf = (d, session, today = todayStr()) => buildLedger({ items: d.items, adjustments: d.adjustments, payments: d.payments, session, today });

export async function accountSummary(school, student, session) {
  const acc = await ensureAccount(school, student, session);
  const led = ledgerOf(await loadLedgerData(school, acc, session), session);
  return { session_id: session.id, ...led.totals };
}

// ---------------------------------------------------------------- the full picture for one student
export async function accountView(school, studentId, sessionId, staff) {
  const student = await loadStudent(school, studentId);
  const session = await resolveSession(school, sessionId);
  const acc = await ensureAccount(school, student, session);
  const data = await loadLedgerData(school, acc, session);
  const today = todayStr();
  const ledger = ledgerOf(data, session, today);

  // the session switcher: every session this student has a fee record in (+ the current one), with what is unpaid
  const [allSessions, accounts] = await Promise.all([sessionsOf(school), db.from('student_fee_accounts').select('id,session_id,class_name').eq('school_id', school).eq('student_id', studentId)]);
  check(accounts.error);
  const mine = new Map(accounts.data.map((a) => [a.session_id, a]));
  const switcher = [];
  for (const s of allSessions) {
    if (!mine.has(s.id) && !s.is_current) continue;
    if (s.id === session.id) { switcher.push({ id: s.id, name: s.name, is_current: s.is_current, pending: ledger.totals.pending }); continue; }
    const a = mine.get(s.id);
    const pending = a ? ledgerOf(await loadLedgerData(school, a, s), s, today).totals.pending : 0;
    switcher.push({ id: s.id, name: s.name, is_current: s.is_current, pending });
  }

  const names = staff ? await namesOf([...data.payments.map((p) => p.received_by), ...data.payments.map((p) => p.cancelled_by), ...data.adjustments.map((a) => a.created_by), ...data.adjustments.map((a) => a.voided_by)]) : new Map();
  return {
    student, session, today, sessions: switcher,
    has_structure: data.items.length > 0,
    items: data.items.map((i) => ({ id: i.id, name: i.name })),
    ledger: { lines: ledger.lines, totals: ledger.totals },
    payments: [...data.payments].reverse().map((p) => ({
      id: p.id, receipt_no: p.receipt_no, amount: Number(p.amount), paid_on: p.paid_on, mode: p.mode, reference: p.reference, note: p.note,
      status: p.status, cancel_reason: p.cancel_reason, allocation: p.allocation, balance_after: p.balance_after === null ? null : Number(p.balance_after),
      ...(staff ? { received_by: names.get(p.received_by) || null, cancelled_by: names.get(p.cancelled_by) || null } : {}),
    })),
    adjustments: [...data.adjustments].reverse().map((a) => ({
      id: a.id, item_name: a.item_name, amount: Number(a.amount), reason: a.reason, applied_on: a.applied_on,
      voided: !!a.voided_at, void_reason: a.void_reason,
      ...(staff ? { created_by: names.get(a.created_by) || null, voided_by: names.get(a.voided_by) || null } : {}),
    })),
  };
}

// ---------------------------------------------------------------- payments
export async function recordPayment(school, user, studentId, body) {
  const student = await loadStudent(school, studentId);
  const session = await resolveSession(school, body.session_id);
  const acc = await ensureAccount(school, student, session);
  const today = todayStr();
  const amount = money(body.amount);
  if (!MODES.includes(body.mode)) throw httpError(400, 'Choose how the money was paid');
  const paid_on = body.paid_on ? validDate(body.paid_on, 'Payment date') : today;
  if (paid_on > today) throw httpError(400, 'The payment date cannot be in the future');
  const reference = text(body.reference, 100, 'Reference');
  const note = text(body.note, 300, 'Note');

  const ledger = ledgerOf(await loadLedgerData(school, acc, session), session, today);
  if (ledger.paise.pending <= 0) throw httpError(400, 'Nothing is pending for this student in this session');
  const paise = toPaise(amount);
  if (paise > ledger.paise.pending) throw httpError(400, `That is more than the pending balance (Rs. ${toRupees(ledger.paise.pending).toFixed(2)})`);

  const { data, error } = await db.rpc('record_fee_payment', {
    p_school: school, p_account: acc.id, p_amount: amount, p_cap: toRupees(ledger.paise.total), p_mode: body.mode, p_reference: reference, p_note: note,
    p_paid_on: paid_on, p_by: user.user_id, p_class_label: student.class_label, p_allocation: allocate(ledger, paise),
  });
  check(error);
  notifyFee(school, user, student.student_id, amount);
  return data;
}

export async function cancelPayment(school, user, paymentId, reason) {
  const why = text(reason, 300, 'Reason', true);
  const { data, error } = await db.from('fee_payments').update({ status: 'cancelled', cancelled_by: user.user_id, cancelled_at: new Date().toISOString(), cancel_reason: why })
    .eq('id', paymentId).eq('school_id', school).eq('status', 'received').select('id,student_id,session_id').maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Payment not found or already cancelled');
  return data;
}

export async function getPayment(school, paymentId) {
  const { data, error } = await db.from('fee_payments').select('*').eq('id', paymentId).eq('school_id', school).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Receipt not found');
  return data;
}

// ---------------------------------------------------------------- adjustments (admin only: the route enforces it)
export async function addAdjustment(school, user, studentId, body) {
  const student = await loadStudent(school, studentId);
  const session = await resolveSession(school, body.session_id);
  const acc = await ensureAccount(school, student, session);
  if (!['discount', 'charge'].includes(body.type)) throw httpError(400, 'Choose discount or extra charge');
  const amount = money(body.amount);
  const reason = text(body.reason, 200, 'Reason', true);
  const signed = body.type === 'discount' ? -amount : amount;
  const today = todayStr();

  const data = await loadLedgerData(school, acc, session);
  let item = null;
  if (body.item_id) {
    item = data.items.find((i) => i.id === body.item_id);
    if (!item) throw httpError(400, "That fee is not part of this student's class fees");
  }
  const before = ledgerOf(data, session, today);
  const row = { id: 'new', item_id: item?.id || null, amount: signed, reason, applied_on: today, voided_at: null };
  const after = ledgerOf({ ...data, adjustments: [...data.adjustments, row] }, session, today);
  if (signed < 0) {
    if (item) {
      const eff = toPaise(item.amount) + data.adjustments.filter((a) => !a.voided_at && a.item_id === item.id).reduce((s, a) => s + toPaise(a.amount), 0);
      if (toPaise(amount) > eff) throw httpError(400, `That discount is more than what is left of ${item.name} (Rs. ${toRupees(eff).toFixed(2)})`);
    } else if (toPaise(amount) > before.paise.pending) {
      throw httpError(400, `A general discount cannot be more than the pending balance (Rs. ${toRupees(before.paise.pending).toFixed(2)})`);
    }
    if (after.paise.total < after.paise.paid) throw httpError(400, `That would bring the fees below the Rs. ${toRupees(after.paise.paid).toFixed(2)} already paid. Cancel a payment first if it was a mistake.`);
  }
  const { error } = await db.from('fee_adjustments').insert({
    school_id: school, account_id: acc.id, student_id: studentId, session_id: session.id, item_id: item?.id || null, item_name: item?.name || null,
    amount: signed, reason, applied_on: today, created_by: user.user_id,
  });
  check(error);
  return session.id;
}

export async function voidAdjustment(school, user, adjustmentId, reason) {
  const why = text(reason, 200, 'Reason', true);
  const { data: adj, error } = await db.from('fee_adjustments').select('*').eq('id', adjustmentId).eq('school_id', school).maybeSingle();
  check(error);
  if (!adj || adj.voided_at) throw httpError(404, 'Adjustment not found or already removed');
  const { data: acc } = await db.from('student_fee_accounts').select('*').eq('id', adj.account_id).maybeSingle();
  const session = await resolveSession(school, adj.session_id);
  const data = await loadLedgerData(school, acc, session);
  const after = ledgerOf({ ...data, adjustments: data.adjustments.map((a) => (a.id === adj.id ? { ...a, voided_at: 'x' } : a)) }, session);
  if (after.paise.total < after.paise.paid) throw httpError(400, `Removing this would bring the fees below the Rs. ${toRupees(after.paise.paid).toFixed(2)} already paid`);
  const { error: e2 } = await db.from('fee_adjustments').update({ voided_at: new Date().toISOString(), voided_by: user.user_id, void_reason: why }).eq('id', adj.id).is('voided_at', null);
  check(e2);
  return { student_id: adj.student_id, session_id: adj.session_id };
}

// ---------------------------------------------------------------- parents
// student id -> [{name, phone, login_id}] : the parent ACCOUNTS linked to each student
async function linkedParents(school, studentIds) {
  const out = new Map();
  const ids = [...new Set(studentIds.filter(Boolean))];
  const links = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('parent_students').select('parent_id,student_id').eq('school_id', school).in('student_id', ids.slice(i, i + 200));
    check(error);
    links.push(...data);
  }
  const people = new Map();
  const pids = [...new Set(links.map((l) => l.parent_id))];
  for (let i = 0; i < pids.length; i += 200) {
    const { data, error } = await db.from('profiles').select('user_id,full_name,phone,users(login_id)').in('user_id', pids.slice(i, i + 200));
    check(error);
    data.forEach((p) => people.set(p.user_id, { name: p.full_name || one(p.users)?.login_id || null, phone: p.phone || null, login_id: one(p.users)?.login_id || null }));
  }
  for (const l of links) {
    const p = people.get(l.parent_id);
    if (!p) continue;
    if (!out.has(l.student_id)) out.set(l.student_id, []);
    out.get(l.student_id).push(p);
  }
  return out;
}

export async function studentContacts(school, studentId) {
  const [prof, linked] = await Promise.all([
    db.from('profiles').select('father_name,mother_name,father_phone,mother_phone').eq('user_id', studentId).eq('school_id', school).maybeSingle(),
    linkedParents(school, [studentId]),
  ]);
  check(prof.error);
  return mergeContacts(linked.get(studentId) || [], prof.data || {});
}

// ---------------------------------------------------------------- who owes what (school-wide)
const STUDENT_COLS = 'user_id,full_name,roll_no,admission_no,class_id,father_name,mother_name,father_phone,mother_phone,extra,classes(name,section,level),users!inner(login_id,is_active,role)';
const studentRow = (p) => {
  const c = one(p.classes), u = one(p.users);
  return {
    student_id: p.user_id, full_name: p.full_name || u.login_id, login_id: u.login_id, roll_no: p.roll_no, admission_no: p.admission_no,
    class_id: p.class_id, class_name: c?.name || null, class_label: c ? clsLabel(c.name, c.section) : null, level: c?.level ?? null,
    father_name: p.father_name, mother_name: p.mother_name, father_phone: p.father_phone, mother_phone: p.mother_phone,
  };
};
const all = (table, cols, school, sessionId, extra) => fetchAll(() => {
  let b = db.from(table).select(cols).eq('school_id', school).eq('session_id', sessionId).order('id');
  if (extra) b = extra(b);
  return b;
});

// opts: {sessionId, classId, className, minPending, dueNow, q, sort, limit}.  Reads only: no fee record is created for anyone.
export async function pendingStudents(school, opts = {}) {
  const session = await resolveSession(school, opts.sessionId);
  const today = todayStr();
  const [accounts, items, adjustments, payments] = await Promise.all([
    all('student_fee_accounts', 'id,student_id,class_id,class_name', school, session.id),
    all('fee_items', 'id,class_name,name,amount,frequency,sort_order,created_at', school, session.id),
    all('fee_adjustments', 'account_id,item_id,amount,reason,applied_on', school, session.id, (b) => b.is('voided_at', null)),
    all('fee_payments', 'account_id,amount,status', school, session.id, (b) => b.eq('status', 'received')),
  ]);

  let profiles;
  if (session.is_current) {
    // everyone studying now (graduated students' old dues live in their older session's fee record)
    profiles = (await fetchAll(() => db.from('profiles').select(STUDENT_COLS).eq('school_id', school).eq('users.role', 'student').eq('users.is_active', true).order('user_id')))
      .filter((p) => p.extra?.graduated !== true);
  } else {
    // an older session: only students who have a fee record in it
    profiles = [];
    const ids = [...new Set(accounts.map((a) => a.student_id))];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from('profiles').select(STUDENT_COLS).eq('school_id', school).eq('users.role', 'student').in('user_id', ids.slice(i, i + 200));
      check(error);
      profiles.push(...data);
    }
  }

  const { summary, rows } = assemblePending({
    session, today, students: profiles.map(studentRow), accounts, items, adjustments, payments,
    filters: { classId: opts.classId, className: opts.className, minPending: opts.minPending, dueNow: opts.dueNow, q: opts.q, sort: opts.sort },
  });
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 5000);
  const shown = rows.slice(0, limit);
  const linked = await linkedParents(school, shown.map((r) => r.student_id));
  return {
    summary, shown: shown.length, truncated: rows.length > shown.length,
    rows: shown.map((r) => ({ ...publicRow(r), contacts: mergeContacts(linked.get(r.student_id) || [], r._student) })),
  };
}

// ---------------------------------------------------------------- receipts of a period / a student
// f: {from, to, period, mode, status ('received'|'cancelled'|'all'), studentId, receiptNo, className, limit}
export async function listPayments(school, f = {}) {
  const today = todayStr();
  let from = f.from ? validDate(f.from, 'From date') : null;
  let to = f.to ? validDate(f.to, 'To date') : null;
  if (f.period) {
    const r = periodRange(f.period, today);
    if (!r) throw httpError(400, 'Unknown period');
    ({ from, to } = r);
  }
  if (!from && !to && !f.studentId && !f.receiptNo) from = to = today; // never an unbounded dump by accident
  if (from && to && from > to) throw httpError(400, 'The "from" date is after the "to" date');
  if (f.mode && !MODES.includes(f.mode)) throw httpError(400, `Payment mode must be one of: ${MODES.join(', ')}`);
  const status = ['received', 'cancelled'].includes(f.status) ? f.status : null;

  const rows = await fetchAll(() => {
    let b = db.from('fee_payments')
      .select('id,receipt_no,receipt_seq,student_id,session_id,amount,paid_on,mode,reference,class_label,status,cancel_reason,received_by')
      .eq('school_id', school).order('paid_on', { ascending: false }).order('receipt_seq', { ascending: false });
    if (from) b = b.gte('paid_on', from);
    if (to) b = b.lte('paid_on', to);
    if (f.mode) b = b.eq('mode', f.mode);
    if (status) b = b.eq('status', status);
    if (f.studentId) b = b.eq('student_id', f.studentId);
    if (f.receiptNo) b = b.eq('receipt_no', String(f.receiptNo).trim().toUpperCase());
    return b;
  });
  const want = String(f.className || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const kept = want ? rows.filter((p) => { const l = String(p.class_label || '').toLowerCase(); return l === want || l.startsWith(`${want} `); }) : rows;

  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 5000);
  const shown = kept.slice(0, limit);
  const names = await namesOf([...shown.map((p) => p.student_id), ...shown.map((p) => p.received_by)]);
  return {
    from, to, summary: summarizePayments(kept), shown: shown.length, truncated: kept.length > shown.length,
    rows: shown.map((p) => ({
      id: p.id, receipt_no: p.receipt_no, student_id: p.student_id, student_name: names.get(p.student_id) || null, class_label: p.class_label,
      amount: Number(p.amount), paid_on: p.paid_on, mode: p.mode, reference: p.reference, status: p.status, cancel_reason: p.cancel_reason,
      received_by: names.get(p.received_by) || null,
    })),
  };
}

// ---------------------------------------------------------------- fee structure
const byLevel = (a, b) => (a.level ?? 1e9) - (b.level ?? 1e9) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true });

export async function structureView(school, sessionId) {
  const session = await resolveSession(school, sessionId);
  const [classRows, itemRows, sessions] = await Promise.all([
    db.from('classes').select('id,name,section,level').eq('school_id', school),
    db.from('fee_items').select('id,class_name,name,amount,frequency,sort_order,created_at').eq('school_id', school).eq('session_id', session.id).order('sort_order').order('created_at'),
    sessionsOf(school),
  ]);
  check(classRows.error); check(itemRows.error);
  const students = await fetchAll(() => db.from('profiles').select('class_id,extra,users!inner(role,is_active)').eq('school_id', school).eq('users.role', 'student').eq('users.is_active', true).not('class_id', 'is', null).order('user_id'));
  const perClass = new Map();
  students.filter((p) => p.extra?.graduated !== true).forEach((p) => perClass.set(p.class_id, (perClass.get(p.class_id) || 0) + 1));

  const groups = new Map();
  for (const c of classRows.data) {
    const g = groups.get(c.name) || { name: c.name, level: c.level, sections: [], students: 0, items: [] };
    if (c.section) g.sections.push(c.section);
    g.level = g.level ?? c.level;
    g.students += perClass.get(c.id) || 0;
    groups.set(c.name, g);
  }
  for (const it of itemRows.data) {
    const g = groups.get(it.class_name);
    if (g) g.items.push({ id: it.id, name: it.name, amount: Number(it.amount), frequency: it.frequency, ...describeItem(it) });
  }
  const classes = [...groups.values()].sort(byLevel).map((g) => ({ ...g, sections: g.sections.sort(), total: toRupees(g.items.reduce((s, i) => s + toPaise(i.amount), 0)) }));
  return { session, sessions, frequencies: FREQUENCY_KEYS.map((k) => ({ key: k, label: FREQUENCIES[k].label, count: FREQUENCIES[k].count })), classes };
}

function itemBody(body) {
  const name = text(body.name, 80, 'Fee name', true);
  const amount = money(body.amount, 'Fee amount');
  if (!FREQUENCY_KEYS.includes(body.frequency)) throw httpError(400, 'Choose a payment term');
  return { name, amount, frequency: body.frequency };
}

async function assertClassName(school, className) {
  const { count } = await db.from('classes').select('id', { count: 'exact', head: true }).eq('school_id', school).eq('name', className);
  if (!count) throw httpError(400, 'Class not found');
}

export async function addItem(school, body) {
  const session = await resolveSession(school, body.session_id);
  const class_name = text(body.class_name, 80, 'Class', true);
  await assertClassName(school, class_name);
  const { data: last } = await db.from('fee_items').select('sort_order').eq('session_id', session.id).eq('class_name', class_name).order('sort_order', { ascending: false }).limit(1);
  const { data, error } = await db.from('fee_items').insert({ school_id: school, session_id: session.id, class_name, sort_order: (last?.[0]?.sort_order ?? -1) + 1, ...itemBody(body) }).select().single();
  if (error?.code === '23505') throw httpError(409, 'This class already has a fee with that name');
  check(error);
  return data;
}

export async function updateItem(school, id, body) {
  const { data, error } = await db.from('fee_items').update({ ...itemBody(body), updated_at: new Date().toISOString() }).eq('id', id).eq('school_id', school).select().maybeSingle();
  if (error?.code === '23505') throw httpError(409, 'This class already has a fee with that name');
  check(error);
  if (!data) throw httpError(404, 'Fee not found');
  return data;
}

export async function deleteItem(school, id) {
  const { count } = await db.from('fee_adjustments').select('id', { count: 'exact', head: true }).eq('item_id', id).is('voided_at', null);
  if (count) throw httpError(409, `${count} student${count === 1 ? ' has' : 's have'} an adjustment on this fee. Remove those first (Student fees > Adjust), or edit the amount instead.`);
  const { data, error } = await db.from('fee_items').delete().eq('id', id).eq('school_id', school).select('id');
  check(error);
  if (!data?.length) throw httpError(404, 'Fee not found');
}

// copy the whole structure of one session into another (skips fees a class already has there)
export async function copyStructure(school, fromId, toId) {
  if (!fromId || !toId || fromId === toId) throw httpError(400, 'Choose two different sessions');
  const [from, to] = [await resolveSession(school, fromId), await resolveSession(school, toId)];
  const [src, dst] = await Promise.all([
    db.from('fee_items').select('class_name,name,amount,frequency,sort_order').eq('school_id', school).eq('session_id', from.id),
    db.from('fee_items').select('class_name,name').eq('school_id', school).eq('session_id', to.id),
  ]);
  check(src.error); check(dst.error);
  const have = new Set(dst.data.map((d) => `${d.class_name}\u0000${d.name.toLowerCase()}`));
  const rows = src.data.filter((s) => !have.has(`${s.class_name}\u0000${s.name.toLowerCase()}`)).map((s) => ({ ...s, school_id: school, session_id: to.id }));
  if (rows.length) check((await db.from('fee_items').insert(rows)).error);
  return { copied: rows.length, skipped: src.data.length - rows.length, from: from.name, to: to.name };
}
