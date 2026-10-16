import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import { canSeeStudent } from '../attendance.js';
import * as F from '../fees.js';
import { receiptPdf } from '../receipt.js';
import { statementPdf, tablePdf, toCsv, money, rs, dmy, MODE_LABEL } from '../feeReports.js';
import { PERIODS } from '../feeInsights.js';

const r = Router();
const STAFF_VIEW = ['view_student_fees', 'collect_fees', 'adjust_fees'];
const STRUCTURE = ['manage_fee_structure', 'view_student_fees', 'collect_fees', 'adjust_fees'];
const isStaff = (req) => STAFF_VIEW.some((f) => req.user.features.includes(f));

// super admin works on one school at a time (?school_id=...); everyone else on their own
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
// Adjustments and cancelling are for admins ONLY, even if the feature was somehow ticked on another account
const adminOnly = (req, res, next) => (['school_admin', 'super_admin'].includes(req.user.role) ? next() : next(httpError(403, 'Only a school admin can do this')));

// ================= fee structure
r.get('/sessions', requireFeature(...STRUCTURE), asyncH(async (req, res) => res.json(await F.sessionsOf(schoolOf(req)))));

r.get('/structure', requireFeature('manage_fee_structure'), asyncH(async (req, res) => res.json(await F.structureView(schoolOf(req), req.query.session_id))));
r.post('/structure/items', requireFeature('manage_fee_structure'), asyncH(async (req, res) => res.status(201).json(await F.addItem(schoolOf(req), req.body))));
r.patch('/structure/items/:id', requireFeature('manage_fee_structure'), asyncH(async (req, res) => res.json(await F.updateItem(schoolOf(req), req.params.id, req.body))));
r.delete('/structure/items/:id', requireFeature('manage_fee_structure'), asyncH(async (req, res) => { await F.deleteItem(schoolOf(req), req.params.id); res.json({ ok: true }); }));
r.post('/structure/copy', requireFeature('manage_fee_structure'), asyncH(async (req, res) => res.json(await F.copyStructure(schoolOf(req), req.body.from_session_id, req.body.to_session_id))));

// ================= staff: look up a student, see fees, take money
r.get('/students', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => res.json(await F.searchStudents(schoolOf(req), { q: req.query.q, classId: req.query.class_id, limit: req.query.limit }))));
r.get('/classes', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => {
  const { data, error } = await db.from('classes').select('id,name,section,level').eq('school_id', schoolOf(req)).order('level', { nullsFirst: false }).order('name').order('section');
  check(error);
  res.json(data);
}));

r.get('/students/:id', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const view = await F.accountView(school, req.params.id, req.query.session_id, true);
  if (req.query.contacts === '1') view.contacts = await F.studentContacts(school, req.params.id); // parents' names + phones (the AI assistant asks for this)
  res.json(view);
}));

r.post('/students/:id/payments', requireFeature('collect_fees'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const payment = await F.recordPayment(school, req.user, req.params.id, req.body);
  res.status(201).json({ payment, account: await F.accountView(school, req.params.id, payment.session_id, true) });
}));

// admin only
r.post('/students/:id/adjustments', requireFeature('adjust_fees'), adminOnly, asyncH(async (req, res) => {
  const school = schoolOf(req);
  const sessionId = await F.addAdjustment(school, req.user, req.params.id, req.body);
  res.status(201).json(await F.accountView(school, req.params.id, sessionId, true));
}));
r.post('/adjustments/:id/void', requireFeature('adjust_fees'), adminOnly, asyncH(async (req, res) => {
  const school = schoolOf(req);
  const a = await F.voidAdjustment(school, req.user, req.params.id, req.body.reason);
  res.json(await F.accountView(school, a.student_id, a.session_id, true));
}));
r.post('/payments/:id/cancel', requireFeature('cancel_fee_payment'), adminOnly, asyncH(async (req, res) => {
  const school = schoolOf(req);
  const p = await F.cancelPayment(school, req.user, req.params.id, req.body.reason);
  res.json(await F.accountView(school, p.student_id, p.session_id, true));
}));

// ================= parents / students: their own fees, read only. Nothing here can change an amount.
const family = (req) => {
  if (!req.user.features.includes('view_my_fees') || !req.user.school_id) throw httpError(403, "You don't have access to fees");
  return req.user.school_id;
};
r.get('/my', asyncH(async (req, res) => {
  const school = family(req);
  let ids;
  if (req.user.role === 'student') ids = [req.user.user_id];
  else {
    const { data, error } = await db.from('parent_students').select('student_id').eq('parent_id', req.user.user_id);
    check(error);
    ids = data.map((x) => x.student_id);
  }
  const session = await F.resolveSession(school).catch(() => null);
  const kids = [];
  for (const id of ids) {
    const s = await F.loadStudent(school, id).catch(() => null);
    if (!s) continue;
    kids.push({ student_id: s.student_id, full_name: s.full_name, class_label: s.class_label, roll_no: s.roll_no, admission_no: s.admission_no, summary: session ? await F.accountSummary(school, s, session) : null });
  }
  res.json(kids.sort((a, b) => a.full_name.localeCompare(b.full_name)));
}));
r.get('/my/:studentId', asyncH(async (req, res) => {
  const school = family(req);
  if (!(await canSeeStudent(req.user, req.params.studentId))) throw httpError(403, "You can only see your own or your children's fees");
  res.json(await F.accountView(school, req.params.studentId, req.query.session_id, false));
}));

// ================= reports: who owes what, receipts of a period (JSON for screens / the AI, CSV or PDF to keep)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNone = (v, what) => { if (v && !UUID.test(String(v))) throw httpError(400, `Unknown ${what}`); return v || undefined; };
const flag = (v) => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase());
const pendingOpts = (q, max, dflt) => {
  const min = q.min_pending === undefined || q.min_pending === '' ? 0 : Number(q.min_pending);
  if (!(min >= 0)) throw httpError(400, 'Minimum pending must be a number like 5000');
  return {
    sessionId: uuidOrNone(q.session_id, 'session'), classId: uuidOrNone(q.class_id, 'class'), className: String(q.class_name || '').trim().slice(0, 40),
    minPending: min, dueNow: flag(q.due_now), q: String(q.q || '').trim().slice(0, 60),
    sort: ['amount', 'class', 'name'].includes(q.sort) ? q.sort : 'amount', limit: Math.min(Number(q.limit) || dflt, max),
  };
};
const paymentOpts = (q, max, dflt) => {
  if (q.period && !PERIODS.includes(q.period)) throw httpError(400, `period must be one of: ${PERIODS.join(', ')}`);
  return {
    from: q.from, to: q.to, period: q.period, mode: q.mode || undefined, status: q.status, studentId: uuidOrNone(q.student_id, 'student'),
    receiptNo: String(q.receipt_no || '').trim().slice(0, 20) || undefined, className: String(q.class_name || '').trim().slice(0, 40),
    limit: Math.min(Number(q.limit) || dflt, max),
  };
};
const schoolInfo = async (school) => {
  const { data, error } = await db.from('schools').select('name,address,phone,email').eq('id', school).maybeSingle();
  check(error);
  return data || {};
};
const sendFile = (res, buf, mime, name) => {
  res.set({ 'Content-Type': mime, 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' });
  res.send(buf);
};
const FORMAT = (q) => { if (!['pdf', 'csv'].includes(q.format)) throw httpError(400, 'format must be pdf or csv'); return q.format; };
const contactLine = (c) => `${c.relation ? `${c.relation}: ` : ''}${c.name || ''}${c.phone ? ` - ${c.phone}` : ''}`.trim();

r.get('/pending', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => res.json(await F.pendingStudents(schoolOf(req), pendingOpts(req.query, 500, 50)))));

r.get('/pending/download', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => {
  const format = FORMAT(req.query);
  const school = schoolOf(req);
  const out = await F.pendingStudents(school, pendingOpts(req.query, 5000, 5000));
  const stamp = out.summary.as_of;
  const name = `pending-fees-${stamp}`;
  if (format === 'csv') {
    const cols = [
      { label: 'Student', key: 'full_name' }, { label: 'Class', key: 'class_label' }, { label: 'Roll no', key: 'roll_no' }, { label: 'Admission no', key: 'admission_no' }, { label: 'Login ID', key: 'login_id' },
      { label: 'Parent(s)', csv: (x) => x.contacts.map((c) => [c.relation, c.name].filter(Boolean).join(': ')).join(' / ') },
      { label: 'Parent phone(s)', csv: (x) => x.contacts.map((c) => c.phone).filter(Boolean).join(' / ') },
      { label: 'Total fees', key: 'total' }, { label: 'Paid', key: 'paid' }, { label: 'Pending', key: 'pending' }, { label: 'Due till date', key: 'due_till_date' },
      { label: 'Oldest unpaid due date', key: 'oldest_due_date' },
    ];
    return sendFile(res, Buffer.from(toCsv(cols, out.rows), 'utf8'), 'text/csv; charset=utf-8', `${name}.csv`);
  }
  const f = out.summary.filter;
  const filt = [f.class ? `Class ${f.class}` : 'All classes', f.due_now ? 'only fees due till today' : 'all unpaid fees', f.min_pending ? `pending of Rs. ${money(f.min_pending)} or more` : ''].filter(Boolean).join('  |  ');
  const pdf = await tablePdf({
    school: await schoolInfo(school), title: 'PENDING FEES', subtitle: `Session ${out.summary.session.name}  |  as on ${dmy(stamp)}  |  ${filt}`,
    totals: [['Students with dues', out.summary.students_owing], ['Total pending', rs(out.summary.total_pending)], ['Due till today', rs(out.summary.total_due_till_date)]],
    columns: [
      { label: '#', weight: 0.7, get: (x) => x._n },
      { label: 'Student', weight: 4, get: (x) => x.full_name },
      { label: 'Class', weight: 1.4, get: (x) => `${x.class_label}${x.roll_no ? ` / ${x.roll_no}` : ''}` },
      { label: 'Adm. no', weight: 1.5, get: (x) => x.admission_no || '-' },
      { label: 'Parent / phone', weight: 5.2, get: (x) => x.contacts.slice(0, 2).map(contactLine).join('\n') || '-' },
      { label: 'Total (Rs.)', weight: 1.8, align: 'right', get: (x) => money(x.total) },
      { label: 'Paid (Rs.)', weight: 1.8, align: 'right', get: (x) => money(x.paid) },
      { label: 'Pending (Rs.)', weight: 1.9, align: 'right', get: (x) => money(x.pending) },
      { label: 'Due now (Rs.)', weight: 1.9, align: 'right', get: (x) => money(x.due_till_date) },
    ],
    rows: out.rows.map((x, i) => ({ ...x, _n: i + 1 })),
    note: out.summary.classes_without_fee_structure.length ? `No fee structure set yet for: ${out.summary.classes_without_fee_structure.join(', ')} (these students are not counted).` : '',
  });
  sendFile(res, pdf, 'application/pdf', `${name}.pdf`);
}));

r.get('/payments', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => res.json(await F.listPayments(schoolOf(req), paymentOpts(req.query, 500, 50)))));

r.get('/payments/download', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => {
  const format = FORMAT(req.query);
  const school = schoolOf(req);
  const out = await F.listPayments(school, paymentOpts(req.query, 5000, 5000));
  const span = out.from && out.to ? (out.from === out.to ? out.from : `${out.from}_to_${out.to}`) : 'all';
  const name = `fee-collection-${span}`;
  if (format === 'csv') {
    const cols = [
      { label: 'Receipt no', key: 'receipt_no' }, { label: 'Date', key: 'paid_on' }, { label: 'Student', key: 'student_name' }, { label: 'Class', key: 'class_label' },
      { label: 'Mode', csv: (x) => MODE_LABEL[x.mode] || x.mode }, { label: 'Reference', key: 'reference' }, { label: 'Amount', key: 'amount' },
      { label: 'Status', csv: (x) => (x.status === 'cancelled' ? 'Cancelled' : 'Received') }, { label: 'Received by', key: 'received_by' },
    ];
    return sendFile(res, Buffer.from(toCsv(cols, out.rows), 'utf8'), 'text/csv; charset=utf-8', `${name}.csv`);
  }
  const s = out.summary;
  const pdf = await tablePdf({
    school: await schoolInfo(school), title: 'FEE COLLECTION',
    subtitle: out.from ? `${dmy(out.from)}${out.to && out.to !== out.from ? ` to ${dmy(out.to)}` : ''}` : 'All dates',
    totals: [['Receipts', s.receipts], ['Total collected', rs(s.total)], ...s.by_mode.map((m) => [MODE_LABEL[m.name] || m.name, rs(m.amount)]), ...(s.cancelled_receipts ? [['Cancelled (not counted)', s.cancelled_receipts]] : [])],
    columns: [
      { label: 'Receipt no.', weight: 2, get: (x) => x.receipt_no },
      { label: 'Date', weight: 1.6, get: (x) => dmy(x.paid_on) },
      { label: 'Student', weight: 4, get: (x) => x.student_name || '-' },
      { label: 'Class', weight: 1.4, get: (x) => x.class_label || '-' },
      { label: 'Mode', weight: 1.6, get: (x) => MODE_LABEL[x.mode] || x.mode },
      { label: 'Reference', weight: 2.4, get: (x) => x.reference || '-' },
      { label: 'Amount (Rs.)', weight: 2, align: 'right', get: (x) => money(x.amount) },
      { label: 'Status', weight: 1.6, get: (x) => (x.status === 'cancelled' ? 'Cancelled' : 'Received') },
      { label: 'Received by', weight: 2.4, get: (x) => x.received_by || '-' },
    ],
    rows: out.rows,
  });
  sendFile(res, pdf, 'application/pdf', `${name}.pdf`);
}));

// ================= a student's fee statement (PDF): staff, or the parent / student it belongs to
async function statement(res, school, studentId, sessionId, staff) {
  const view = await F.accountView(school, studentId, uuidOrNone(sessionId, 'session'), staff);
  const contacts = staff ? await F.studentContacts(school, studentId) : [];
  const pdf = await statementPdf({ school: await schoolInfo(school), view, contacts });
  const safe = String(view.student.full_name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'student';
  sendFile(res, pdf, 'application/pdf', `fee-statement-${safe}-${view.session.name.replace(/[^0-9A-Za-z]+/g, '-')}.pdf`);
}
r.get('/students/:id/statement', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => statement(res, schoolOf(req), req.params.id, req.query.session_id, true)));
r.get('/my/:studentId/statement', asyncH(async (req, res) => {
  const school = family(req);
  if (!(await canSeeStudent(req.user, req.params.studentId))) throw httpError(403, "You can only see your own or your children's fees");
  await statement(res, school, req.params.studentId, req.query.session_id, false);
}));

// ================= receipt (PDF) - staff, or the parent / student it belongs to
r.get('/payments/:id/receipt', asyncH(async (req, res) => {
  const staff = isStaff(req);
  const school = staff ? schoolOf(req) : family(req);
  const payment = await F.getPayment(school, req.params.id);
  if (!staff && !(await canSeeStudent(req.user, payment.student_id))) throw httpError(403, "You can only download your own or your children's receipts");
  const [student, session, sch, who] = await Promise.all([
    F.loadStudent(school, payment.student_id),
    F.resolveSession(school, payment.session_id),
    db.from('schools').select('name,address,phone,email').eq('id', school).maybeSingle(),
    payment.received_by ? db.from('users').select('login_id,profiles(full_name)').eq('user_id', payment.received_by).maybeSingle() : { data: null },
  ]);
  check(sch.error);
  const prof = Array.isArray(who.data?.profiles) ? who.data.profiles[0] : who.data?.profiles;
  const pdf = await receiptPdf({
    school: sch.data || {}, student, session, receivedBy: prof?.full_name || who.data?.login_id || '',
    payment: { ...payment, amount: Number(payment.amount), balance_after: payment.balance_after === null ? null : Number(payment.balance_after) },
  });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Content-Disposition': `attachment; filename="${payment.receipt_no}.pdf"`, 'Cache-Control': 'private, no-store' });
  res.send(pdf);
}));

export default r;
