import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import { canSeeStudent } from '../attendance.js';
import * as F from '../fees.js';
import { receiptPdf } from '../receipt.js';

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
r.get('/students', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => res.json(await F.searchStudents(schoolOf(req), { q: req.query.q, classId: req.query.class_id }))));
r.get('/classes', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => {
  const { data, error } = await db.from('classes').select('id,name,section,level').eq('school_id', schoolOf(req)).order('level', { nullsFirst: false }).order('name').order('section');
  check(error);
  res.json(data);
}));

r.get('/students/:id', requireFeature(...STAFF_VIEW), asyncH(async (req, res) => res.json(await F.accountView(schoolOf(req), req.params.id, req.query.session_id, true))));

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
