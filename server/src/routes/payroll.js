import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
// admins (school and platform) may decide their own leave; everyone else needs another approver
const canDecideOwn = (req) => isSuper(req) || req.user.role === 'school_admin';
import { notifyLeave } from '../notify.js';
import * as L from '../payroll-logic.js';
import { toCsv, tablePdf, money } from '../feeReports.js';

const r = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const has = (req, ...f) => f.some((x) => req.user.features.includes(x));
const PAY_ANY = ['my_leave', 'leave_approve', 'leave_view_all', 'leave_grant', 'payroll_view', 'payroll_manage', 'payroll_settings'];
const EMP_ROLES = ['staff', 'other', 'school_admin'];

const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
// read every row (supabase caps a single read at 1000)
async function all(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    check(error);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const audit = (school_id, actor, action, target, detail = {}) =>
  db.from('payroll_audit').insert({ school_id, actor_id: actor.user_id, action, target_user: target || null, detail }).then(() => {}, () => {});

async function settingsOf(school_id) {
  const { data } = await db.from('payroll_settings').select('*').eq('school_id', school_id).maybeSingle();
  return data || { school_id, approval_mode: 'manual', weekly_off: [0], rate_basis: 'working_days' };
}
const holidaysOf = async (school_id) => {
  const { data, error } = await db.from('holidays').select('start_date,end_date,type').eq('school_id', school_id);
  check(error); return data;
};
const nameMap = async (ids) => {
  const m = {}; if (!ids.length) return m;
  const { data, error } = await db.from('users').select('user_id,login_id,profiles(full_name,designation,salary)').in('user_id', [...new Set(ids)]);
  check(error);
  data.forEach((u) => { const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles; m[u.user_id] = { user_id: u.user_id, login_id: u.login_id, full_name: p?.full_name || u.login_id, designation: p?.designation || null }; });
  return m;
};
async function loadEmployee(school_id, user_id) {
  if (!UUID.test(String(user_id || ''))) throw httpError(400, 'Pick an employee');
  const { data } = await db.from('users').select('user_id,role,is_active,school_id,profiles(salary,full_name)').eq('user_id', user_id).eq('school_id', school_id).maybeSingle();
  if (!data || !EMP_ROLES.includes(data.role)) throw httpError(404, 'Employee not found');
  return data;
}
async function employees(school_id) {
  const { data, error } = await db.from('users').select('user_id,login_id,role,profiles(full_name,designation,salary,joining_date)').eq('school_id', school_id).eq('is_active', true).in('role', EMP_ROLES);
  check(error);
  return data.map((u) => { const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles; return { user_id: u.user_id, login_id: u.login_id, role: u.role, full_name: p?.full_name || u.login_id, designation: p?.designation || null, salary: p?.salary == null ? null : Number(p.salary) }; });
}
const ledgerRows = (school_id, filter = {}) => all(() => {
  let q = db.from('leave_ledger').select('*').eq('school_id', school_id).order('entry_date').order('created_at');
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  return q;
});
const balanceMap = (rows, upTo) => {
  const m = {};
  for (const x of rows) if (!upTo || x.entry_date <= upTo) { m[x.user_id] ||= {}; m[x.user_id][x.leave_type_id] = L.round1((m[x.user_id][x.leave_type_id] || 0) + Number(x.days)); }
  return m;
};
// months for which this person's payslip is already locked
async function lockedMonths(user_id) {
  const { data, error } = await db.from('payslips').select('period').eq('user_id', user_id).in('status', ['finalized', 'paid']);
  check(error); return new Set(data.map((p) => p.period));
}
const assertUnlocked = async (user_id, detail) => {
  const locked = await lockedMonths(user_id);
  const bad = Object.keys(L.byMonth(detail)).find((m) => locked.has(m));
  if (bad) throw httpError(400, `Payroll for ${L.monthLabel(bad)} is already finalized, so leave in that month can't be changed. Ask payroll to add an adjustment instead.`);
};

// ================= settings & leave types
r.get('/settings', requireFeature(...PAY_ANY), asyncH(async (req, res) => {
  const school_id = schoolOf(req);
  const { data: types, error } = await db.from('leave_types').select('*').eq('school_id', school_id).order('name');
  check(error);
  res.json({ settings: await settingsOf(school_id), types });
}));
r.put('/settings', requireFeature('payroll_settings'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const b = req.body;
  if (!['manual', 'auto'].includes(b.approval_mode)) throw httpError(400, 'Approval mode must be manual or auto');
  if (!['working_days', 'calendar_days', 'fixed_30'].includes(b.rate_basis)) throw httpError(400, 'Unknown pay-rate basis');
  const off = [...new Set((b.weekly_off || []).map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const row = { school_id, approval_mode: b.approval_mode, rate_basis: b.rate_basis, weekly_off: off, updated_at: new Date().toISOString() };
  check((await db.from('payroll_settings').upsert(row, { onConflict: 'school_id' })).error);
  await audit(school_id, req.user, 'settings_changed', null, row);
  res.json(await settingsOf(school_id));
}));
r.post('/leave-types', requireFeature('payroll_settings'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const b = req.body;
  const name = String(b.name || '').trim(); const q = Number(b.annual_quota || 0);
  if (!name) throw httpError(400, 'Name is required');
  if (!(q >= 0 && q <= 366)) throw httpError(400, 'Yearly quota must be 0 to 366');
  const is_paid = b.is_paid !== false;
  const { data, error } = await db.from('leave_types').insert({ school_id, name, is_paid, annual_quota: is_paid ? q : 0 }).select().single();
  check(error); res.status(201).json(data);
}));
r.patch('/leave-types/:id', requireFeature('payroll_settings'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const b = req.body; const patch = {};
  if (b.name !== undefined) { patch.name = String(b.name).trim(); if (!patch.name) throw httpError(400, 'Name is required'); }
  if (b.annual_quota !== undefined) { patch.annual_quota = Number(b.annual_quota); if (!(patch.annual_quota >= 0 && patch.annual_quota <= 366)) throw httpError(400, 'Bad quota'); }
  if (b.is_active !== undefined) patch.is_active = !!b.is_active;
  const { data, error } = await db.from('leave_types').update(patch).eq('id', req.params.id).eq('school_id', school_id).select().maybeSingle();
  check(error); if (!data) throw httpError(404, 'Leave type not found'); res.json(data);
}));

// ================= leave requests
const typeOf = async (school_id, id) => {
  const { data } = await db.from('leave_types').select('*').eq('id', id).eq('school_id', school_id).maybeSingle();
  if (!data || !data.is_active) throw httpError(400, 'Pick a valid leave type');
  return data;
};

// record the balance effect of an approved request (paid types only; unpaid types never touch the balance)
async function postTaken(reqRow, type, actor, sign) { // sign -1 = taken, +1 = reversal
  if (!type.is_paid) return;
  const rows = Object.entries(L.byMonth(reqRow.days_detail)).map(([m, v]) => ({
    school_id: reqRow.school_id, user_id: reqRow.user_id, leave_type_id: type.id, entry_date: v.first, days: sign * v.days,
    kind: sign < 0 ? 'taken' : 'reversal', leave_id: reqRow.id, note: `${type.name} ${sign < 0 ? 'taken' : 'cancelled'} (${L.monthLabel(m)})`, created_by: actor?.user_id || null,
  }));
  check((await db.from('leave_ledger').insert(rows)).error);
}
async function approve(row, actor, auto, note) {
  const type = (await db.from('leave_types').select('*').eq('id', row.leave_type_id).single()).data;
  await assertUnlocked(row.user_id, row.days_detail);
  const { data, error } = await db.from('leave_requests').update({ status: 'approved', decided_by: auto ? null : actor.user_id, decided_at: new Date().toISOString(), auto_approved: auto, decision_note: note || null })
    .eq('id', row.id).eq('status', 'pending').select().maybeSingle();
  check(error);
  if (!data) throw httpError(409, 'This request was already handled');
  try { await postTaken(data, type, actor, -1); }
  catch (e) { await db.from('leave_requests').update({ status: 'pending', decided_by: null, decided_at: null, auto_approved: false }).eq('id', row.id); throw e; }
  await audit(row.school_id, actor, auto ? 'leave_auto_approved' : 'leave_approved', row.user_id, { leave_id: row.id, days: row.days });
  notifyLeave(row.school_id, auto ? null : actor.user_id, row.user_id, 'approved', note);
  return data;
}

r.post('/leave', requireFeature('my_leave', 'leave_approve'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const b = req.body;
  const onBehalf = b.user_id && b.user_id !== req.user.user_id;
  if (onBehalf && !has(req, 'leave_approve')) throw httpError(403, "You can't apply for someone else");
  if (!onBehalf && !has(req, 'my_leave')) throw httpError(403, 'Leave application is not turned on for you');
  const uid = onBehalf ? b.user_id : req.user.user_id;
  await loadEmployee(school_id, uid);
  const type = await typeOf(school_id, b.leave_type_id);
  const settings = await settingsOf(school_id);
  const isOff = L.offDayChecker(settings.weekly_off, await holidaysOf(school_id));
  let detail;
  try { detail = L.leaveDays(b.start_date, b.end_date || b.start_date, !!b.half_day, isOff); } catch (e) { throw httpError(400, e.message); }
  const end = b.end_date || b.start_date;
  if (!onBehalf && b.start_date < L.addDays(L.todayStr(), -31)) throw httpError(400, 'You can only apply for dates up to 31 days back. Ask your admin.');
  const reason = String(b.reason || '').trim();
  if (!reason && !onBehalf) throw httpError(400, 'Please give a reason');
  await assertUnlocked(uid, detail);
  const { data: clash } = await db.from('leave_requests').select('id').eq('user_id', uid).in('status', ['pending', 'approved']).lte('start_date', end).gte('end_date', b.start_date).limit(1);
  if (clash?.length) throw httpError(400, 'You already have a leave request overlapping these dates');
  const days = L.round1(detail.reduce((s, d) => s + d.value, 0));
  const { data: row, error } = await db.from('leave_requests').insert({ school_id, user_id: uid, leave_type_id: type.id, start_date: b.start_date, end_date: end, half_day: !!b.half_day, days, days_detail: detail, reason: reason || null }).select().single();
  check(error);
  await audit(school_id, req.user, onBehalf ? 'leave_recorded_for' : 'leave_applied', uid, { leave_id: row.id, days });
  let out = row;
  if (onBehalf || settings.approval_mode === 'auto') {
    try { out = await approve(row, req.user, !onBehalf, onBehalf ? `Recorded by ${req.user.login_id}` : 'Auto-approved'); }
    catch (e) { await db.from('leave_requests').delete().eq('id', row.id); throw e; }
  }
  res.status(201).json(out);
}));

async function decorate(rows) {
  const names = await nameMap([...rows.map((x) => x.user_id), ...rows.map((x) => x.decided_by).filter(Boolean)]);
  return rows.map((x) => ({ ...x, employee: names[x.user_id], decider: x.decided_by ? names[x.decided_by] : null }));
}
r.get('/leave', requireFeature('leave_approve', 'leave_view_all'), asyncH(async (req, res) => {
  const school_id = schoolOf(req);
  const rows = await all(() => {
    let q = db.from('leave_requests').select('*').eq('school_id', school_id).order('created_at', { ascending: false });
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.user_id) q = q.eq('user_id', req.query.user_id);
    return q;
  });
  res.json(await decorate(rows));
}));
async function loadReq(req) {
  const school_id = schoolOf(req);
  const { data } = await db.from('leave_requests').select('*').eq('id', req.params.id).eq('school_id', school_id).maybeSingle();
  if (!data) throw httpError(404, 'Request not found');
  return data;
}
r.post('/leave/:id/approve', requireFeature('leave_approve'), asyncH(async (req, res) => {
  const row = await loadReq(req);
  if (row.user_id === req.user.user_id && !canDecideOwn(req)) throw httpError(403, "You can't approve your own leave. Another approver must do it.");
  res.json(await approve(row, req.user, false, String(req.body.note || '').trim()));
}));
r.post('/leave/:id/reject', requireFeature('leave_approve'), asyncH(async (req, res) => {
  const row = await loadReq(req);
  if (row.user_id === req.user.user_id && !canDecideOwn(req)) throw httpError(403, "You can't decide your own leave");
  const { data, error } = await db.from('leave_requests').update({ status: 'rejected', decided_by: req.user.user_id, decided_at: new Date().toISOString(), decision_note: String(req.body.note || '').trim() || null }).eq('id', row.id).eq('status', 'pending').select().maybeSingle();
  check(error); if (!data) throw httpError(409, 'This request was already handled');
  await audit(row.school_id, req.user, 'leave_rejected', row.user_id, { leave_id: row.id });
  notifyLeave(row.school_id, req.user.user_id, row.user_id, 'rejected', String(req.body.note || '').trim());
  res.json(data);
}));
r.post('/leave/:id/cancel', requireFeature('my_leave', 'leave_approve'), asyncH(async (req, res) => {
  const row = await loadReq(req);
  const mine = row.user_id === req.user.user_id;
  if (!mine && !has(req, 'leave_approve')) throw httpError(403, "This isn't your request");
  if (mine && !has(req, 'my_leave') && !has(req, 'leave_approve')) throw httpError(403, 'Not allowed');
  if (!['pending', 'approved'].includes(row.status)) throw httpError(400, 'Only pending or approved leave can be cancelled');
  if (row.status === 'approved') {
    if (mine && !has(req, 'leave_approve') && row.start_date < L.todayStr()) throw httpError(400, 'Leave that has started can only be cancelled by an approver');
    await assertUnlocked(row.user_id, row.days_detail);
  }
  const { data, error } = await db.from('leave_requests').update({ status: 'cancelled', decided_at: new Date().toISOString(), decision_note: mine ? 'Cancelled by employee' : `Cancelled by ${req.user.login_id}` }).eq('id', row.id).eq('status', row.status).select().maybeSingle();
  check(error); if (!data) throw httpError(409, 'This request changed, refresh and try again');
  if (row.status === 'approved') {
    const type = (await db.from('leave_types').select('*').eq('id', row.leave_type_id).single()).data;
    await postTaken(data, type, req.user, +1);
  }
  await audit(row.school_id, req.user, 'leave_cancelled', row.user_id, { leave_id: row.id });
  res.json(data);
}));

// ================= balances & grants
async function balancesFor(school_id, user_ids) {
  const types = (await db.from('leave_types').select('*').eq('school_id', school_id).order('name')).data || [];
  const led = await ledgerRows(school_id);
  const bal = balanceMap(led);
  const pend = await all(() => db.from('leave_requests').select('user_id,leave_type_id,days').eq('school_id', school_id).eq('status', 'pending'));
  const pm = {}; pend.forEach((p) => { pm[p.user_id] ||= {}; pm[p.user_id][p.leave_type_id] = L.round1((pm[p.user_id][p.leave_type_id] || 0) + Number(p.days)); });
  return user_ids.map((uid) => ({ user_id: uid, balances: types.filter((t) => t.is_paid).map((t) => ({ type_id: t.id, name: t.name, balance: bal[uid]?.[t.id] || 0, pending: pm[uid]?.[t.id] || 0 })) }));
}
r.get('/balances', requireFeature('leave_view_all', 'leave_grant', 'leave_approve'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const emps = await employees(school_id);
  const bal = await balancesFor(school_id, emps.map((e) => e.user_id));
  const bm = Object.fromEntries(bal.map((b) => [b.user_id, b.balances]));
  res.json(emps.map((e) => ({ user_id: e.user_id, login_id: e.login_id, full_name: e.full_name, designation: e.designation, balances: bm[e.user_id] })));
}));
r.get('/ledger/:uid', requireFeature('leave_view_all', 'leave_grant'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); await loadEmployee(school_id, req.params.uid);
  const rows = await ledgerRows(school_id, { user_id: req.params.uid });
  res.json(rows.reverse());
}));
r.post('/grants', requireFeature('leave_grant'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const b = req.body;
  const type = await typeOf(school_id, b.leave_type_id);
  if (!type.is_paid) throw httpError(400, 'Unpaid leave has no balance to grant');
  if (!['allotment', 'grant', 'adjustment'].includes(b.kind)) throw httpError(400, 'Unknown grant kind');
  const note = String(b.note || '').trim();
  const eff = b.effective_date || L.todayStr();
  if (!L.isDate(eff)) throw httpError(400, 'Bad effective date');
  let days = Number(b.days);
  let targets;
  if (b.kind === 'allotment') {
    days = Number(type.annual_quota);
    if (!(days > 0)) throw httpError(400, `Set a yearly quota for ${type.name} first`);
    targets = b.all ? (await employees(school_id)).map((e) => e.user_id) : [].concat(b.user_ids || []);
  } else {
    if (!note) throw httpError(400, 'A note is required so the record is clear');
    if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 366 || Math.round(days * 2) !== days * 2) throw httpError(400, 'Days must be a non-zero number in halves (e.g. 1, 0.5, -2)');
    if (b.kind === 'grant' && days < 0) throw httpError(400, 'Use "Adjustment" for negative days');
    targets = [].concat(b.user_ids || []);
  }
  if (!targets.length) throw httpError(400, 'Pick at least one employee');
  const period_key = b.kind === 'allotment' ? String(b.period_key || '').trim() : null;
  if (b.kind === 'allotment' && !period_key) throw httpError(400, 'Enter the period, e.g. 2026-2027');
  let done = 0, skipped = 0;
  for (const uid of targets) {
    await loadEmployee(school_id, uid);
    if ((await lockedMonths(uid)).has(L.monthStart(eff))) throw httpError(400, `${L.monthLabel(eff)} is already finalized for one of these employees. Use today's date.`);
    const { error } = await db.from('leave_ledger').insert({ school_id, user_id: uid, leave_type_id: type.id, entry_date: eff, days, kind: b.kind, period_key, note: note || `Yearly allotment ${period_key}`, created_by: req.user.user_id });
    if (error?.code === '23505') { skipped++; continue; }
    check(error); done++;
  }
  await audit(school_id, req.user, `leave_${b.kind}`, null, { type: type.name, days, count: done, skipped });
  res.json({ done, skipped });
}));

// ================= payslips
const employeeSet = async (school_id) => Object.fromEntries((await employees(school_id)).map((e) => [e.user_id, e]));

// salary, leave and adjustment numbers for one person-month
async function compute(school_id, emp, period, settings, isOff, ctx) {
  const start = period, end = L.monthEnd(period);
  const reqs = ctx.reqs.filter((x) => x.user_id === emp.user_id);
  const takenMap = {};
  for (const q of reqs) {
    const sum = q.days_detail.filter((d) => d.date >= start && d.date <= end).reduce((s, d) => s + Number(d.value), 0);
    if (sum > 0) { const t = ctx.types[q.leave_type_id]; takenMap[t.id] ||= { type_id: t.id, name: t.name, is_paid: t.is_paid, days: 0 }; takenMap[t.id].days += sum; }
  }
  const adjustments = ctx.adj.filter((a) => a.user_id === emp.user_id && a.period === period);
  return L.buildPayslip({ salary: emp.salary, basis: settings.rate_basis, period, workingDays: L.workingDaysIn(period, isOff), taken: Object.values(takenMap), balanceAtEnd: ctx.bal[emp.user_id] || {}, adjustments });
}
async function context(school_id, period) {
  const types = Object.fromEntries(((await db.from('leave_types').select('*').eq('school_id', school_id)).data || []).map((t) => [t.id, t]));
  const reqs = await all(() => db.from('leave_requests').select('user_id,leave_type_id,days_detail').eq('school_id', school_id).eq('status', 'approved').lte('start_date', L.monthEnd(period)).gte('end_date', period));
  const adj = await all(() => db.from('payroll_adjustments').select('*').eq('school_id', school_id).eq('period', period));
  const bal = balanceMap(await ledgerRows(school_id), L.monthEnd(period));
  return { types, reqs, adj, bal };
}
const slipBody = (c) => ({ base_salary: c.base_salary, rate_per_day: c.rate_per_day, unpaid_days: c.unpaid_days, leave_deduction: c.leave_deduction, bonus_total: c.bonus_total, other_deduction_total: c.other_deduction_total, net_pay: c.net_pay, breakdown: c.breakdown });

r.get('/payslips', requireFeature('payroll_view', 'payroll_manage'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const period = L.toPeriod(req.query.period);
  if (!period) throw httpError(400, 'Pick a month');
  const rows = await all(() => db.from('payslips').select('*').eq('school_id', school_id).eq('period', period));
  const emps = await employeeSet(school_id);
  const names = await nameMap(rows.map((x) => x.user_id));
  const closed = period < L.monthStart(L.todayStr());
  res.json({ period, can_generate: closed, rows: rows.map((x) => ({ ...x, employee: names[x.user_id] })), missing: Object.values(emps).filter((e) => !rows.some((x) => x.user_id === e.user_id)).map((e) => ({ user_id: e.user_id, full_name: e.full_name, has_salary: e.salary != null && e.salary > 0 })) });
}));

// create / refresh DRAFT payslips for a finished month (finalized and paid ones are never touched)
r.post('/payslips/generate', requireFeature('payroll_manage'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const period = L.toPeriod(req.body.period);
  if (!period) throw httpError(400, 'Pick a month');
  if (period >= L.monthStart(L.todayStr())) throw httpError(400, `${L.monthLabel(period)} hasn't ended yet. Payroll can be prepared once the month is over.`);
  const settings = await settingsOf(school_id);
  const isOff = L.offDayChecker(settings.weekly_off, await holidaysOf(school_id));
  const ctx = await context(school_id, period);
  const existing = await all(() => db.from('payslips').select('user_id,status').eq('school_id', school_id).eq('period', period));
  const st = Object.fromEntries(existing.map((x) => [x.user_id, x.status]));
  let made = 0, locked = 0; const noSalary = [];
  for (const e of Object.values(await employeeSet(school_id))) {
    if (st[e.user_id] && st[e.user_id] !== 'draft') { locked++; continue; }
    if (!(e.salary > 0)) { noSalary.push(e.full_name); continue; }
    const c = await compute(school_id, e, period, settings, isOff, ctx);
    check((await db.from('payslips').upsert({ school_id, user_id: e.user_id, period, status: 'draft', ...slipBody(c), updated_at: new Date().toISOString() }, { onConflict: 'user_id,period' })).error);
    made++;
  }
  await audit(school_id, req.user, 'payroll_generated', null, { period, made });
  res.json({ made, locked, noSalary });
}));

// block finalizing a month while an earlier month of the same person is still open
async function assertInOrder(slip) {
  const { data: older } = await db.from('payslips').select('period').eq('user_id', slip.user_id).eq('status', 'draft').lt('period', slip.period).limit(1);
  if (older?.length) throw httpError(400, `Finalize ${L.monthLabel(older[0].period)} first (months must be closed in order)`);
  const reqs = await all(() => db.from('leave_requests').select('days_detail').eq('user_id', slip.user_id).eq('status', 'approved'));
  const locked = await lockedMonths(slip.user_id);
  const months = new Set(reqs.flatMap((q) => Object.keys(L.byMonth(q.days_detail))));
  const miss = [...months].filter((m) => m < slip.period && !locked.has(m)).sort()[0];
  if (miss) throw httpError(400, `${L.monthLabel(miss)} has leave but no finalized payslip. Generate and finalize it first.`);
}
async function finalizeOne(slip, actor) {
  if (slip.status !== 'draft') throw httpError(400, 'Only draft payslips can be finalized');
  if (slip.period >= L.monthStart(L.todayStr())) throw httpError(400, 'That month has not ended yet');
  await assertInOrder(slip);
  const school_id = slip.school_id;
  const settings = await settingsOf(school_id);
  const isOff = L.offDayChecker(settings.weekly_off, await holidaysOf(school_id));
  const emp = (await employeeSet(school_id))[slip.user_id];
  if (!emp || !(emp.salary > 0)) throw httpError(400, 'Employee has no salary set');
  const c = await compute(school_id, emp, slip.period, settings, isOff, await context(school_id, slip.period));
  if (c.net_pay < 0) throw httpError(400, `Net pay would be negative (${c.net_pay}). Reduce the deductions first.`);
  // winner-takes-it: only one request can move draft -> finalized
  const { data: won, error } = await db.from('payslips').update({ status: 'finalized', ...slipBody(c), finalized_by: actor.user_id, finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', slip.id).eq('status', 'draft').select().maybeSingle();
  check(error);
  if (!won) throw httpError(409, 'This payslip was already finalized');
  try {
    check((await db.from('payroll_adjustments').update({ payslip_id: slip.id }).eq('user_id', slip.user_id).eq('period', slip.period)).error);
    if (c.settle.length) {
      // money was cut for these days, so the negative leave balance is cleared (no double loss)
      check((await db.from('leave_ledger').insert(c.settle.map((s) => ({ school_id, user_id: slip.user_id, leave_type_id: s.type_id, entry_date: L.monthEnd(slip.period), days: s.days, kind: 'settlement', payslip_id: slip.id, note: `Salary cut for ${s.days} extra ${s.name} day(s) in ${L.monthLabel(slip.period)}; balance restored`, created_by: actor.user_id })))).error);
    }
  } catch (e) {
    await db.from('payroll_adjustments').update({ payslip_id: null }).eq('payslip_id', slip.id);
    await db.from('leave_ledger').delete().eq('payslip_id', slip.id).eq('kind', 'settlement');
    await db.from('payslips').update({ status: 'draft', finalized_by: null, finalized_at: null }).eq('id', slip.id);
    throw e;
  }
  await audit(school_id, actor, 'payslip_finalized', slip.user_id, { period: slip.period, net: c.net_pay });
  return won;
}
const slipById = async (req) => {
  const { data } = await db.from('payslips').select('*').eq('id', req.params.id).eq('school_id', schoolOf(req)).maybeSingle();
  if (!data) throw httpError(404, 'Payslip not found'); return data;
};
r.post('/payslips/finalize-all', requireFeature('payroll_manage'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const period = L.toPeriod(req.body.period);
  if (!period) throw httpError(400, 'Pick a month');
  const rows = (await all(() => db.from('payslips').select('*').eq('school_id', school_id).eq('period', period).eq('status', 'draft'))).sort((a, b) => 0);
  let done = 0; const failed = [];
  for (const s of rows) { try { await finalizeOne(s, req.user); done++; } catch (e) { failed.push(e.message); } }
  res.json({ done, failed });
}));
r.post('/payslips/pay-all', requireFeature('payroll_manage'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const period = L.toPeriod(req.body.period);
  if (!period) throw httpError(400, 'Pick a month');
  const rows = await all(() => db.from('payslips').select('*').eq('school_id', school_id).eq('period', period).eq('status', 'finalized'));
  let done = 0; for (const s of rows) { await payOne(s, req); done++; }
  res.json({ done });
}));
async function payOne(slip, req) {
  const b = req.body; const date = b.payment_date || L.todayStr();
  if (!L.isDate(date)) throw httpError(400, 'Bad payment date');
  const { data, error } = await db.from('payslips').update({ status: 'paid', paid_by: req.user.user_id, paid_at: new Date().toISOString(), payment_date: date, payment_method: String(b.payment_method || '').trim() || null, payment_reference: String(b.payment_reference || '').trim() || null, updated_at: new Date().toISOString() }).eq('id', slip.id).eq('status', 'finalized').select().maybeSingle();
  check(error); if (!data) throw httpError(409, 'Only finalized, unpaid payslips can be marked paid');
  await audit(slip.school_id, req.user, 'payslip_paid', slip.user_id, { period: slip.period, net: slip.net_pay, date });
  return data;
}
r.post('/payslips/:id/finalize', requireFeature('payroll_manage'), asyncH(async (req, res) => res.json(await finalizeOne(await slipById(req), req.user))));
r.post('/payslips/:id/pay', requireFeature('payroll_manage'), asyncH(async (req, res) => res.json(await payOne(await slipById(req), req))));
// undo a finalize (never a paid one): unlocks the month and reverses the balance settlement
r.post('/payslips/:id/reopen', requireFeature('payroll_manage'), asyncH(async (req, res) => {
  const slip = await slipById(req);
  const { data: later } = await db.from('payslips').select('id').eq('user_id', slip.user_id).gt('period', slip.period).in('status', ['finalized', 'paid']).limit(1);
  if (later?.length) throw httpError(400, 'A later month is already finalized. Reopen that one first.');
  const { data, error } = await db.from('payslips').update({ status: 'draft', finalized_by: null, finalized_at: null, updated_at: new Date().toISOString() }).eq('id', slip.id).eq('status', 'finalized').select().maybeSingle();
  check(error); if (!data) throw httpError(400, 'Only finalized (not yet paid) payslips can be reopened');
  const net = {}; (await ledgerRows(slip.school_id, { payslip_id: slip.id })).forEach((x) => { net[x.leave_type_id] = L.round1((net[x.leave_type_id] || 0) + Number(x.days)); });
  const back = Object.entries(net).filter(([, d]) => d !== 0).map(([leave_type_id, d]) => ({ school_id: slip.school_id, user_id: slip.user_id, leave_type_id, entry_date: L.monthEnd(slip.period), days: -d, kind: 'reversal', payslip_id: slip.id, note: `Payslip for ${L.monthLabel(slip.period)} reopened`, created_by: req.user.user_id }));
  if (back.length) check((await db.from('leave_ledger').insert(back)).error);
  await db.from('payroll_adjustments').update({ payslip_id: null }).eq('payslip_id', slip.id);
  await audit(slip.school_id, req.user, 'payslip_reopened', slip.user_id, { period: slip.period });
  res.json(data);
}));

// one payslip: the owner sees it once it is final; payroll staff always
r.get('/payslips/:id', asyncH(async (req, res) => {
  const slip = await slipById(req);
  const own = slip.user_id === req.user.user_id;
  if (!(has(req, 'payroll_view', 'payroll_manage') || (own && has(req, 'my_leave') && slip.status !== 'draft'))) throw httpError(403, "You can't view this payslip");
  const names = await nameMap([slip.user_id]);
  res.json({ ...slip, employee: names[slip.user_id] });
}));

// ================= bonuses / extra deductions
r.get('/adjustments', requireFeature('payroll_view', 'payroll_manage'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const period = L.toPeriod(req.query.period);
  if (!period) throw httpError(400, 'Pick a month');
  const rows = await all(() => db.from('payroll_adjustments').select('*').eq('school_id', school_id).eq('period', period).order('created_at'));
  const names = await nameMap(rows.map((x) => x.user_id));
  res.json(rows.map((x) => ({ ...x, employee: names[x.user_id] })));
}));
r.post('/adjustments', requireFeature('payroll_manage'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const b = req.body; const period = L.toPeriod(b.period);
  if (!period) throw httpError(400, 'Pick a month');
  await loadEmployee(school_id, b.user_id);
  if (!['bonus', 'deduction'].includes(b.kind)) throw httpError(400, 'Bonus or deduction only');
  const label = String(b.label || '').trim(); const amount = L.round2(b.amount);
  if (!label) throw httpError(400, 'Say why (this is shown to the employee)');
  if (!(amount > 0 && amount < 1e8)) throw httpError(400, 'Amount must be more than 0');
  if ((await lockedMonths(b.user_id)).has(period)) throw httpError(400, `${L.monthLabel(period)} is already finalized for this person. Add it to a later month.`);
  const { data, error } = await db.from('payroll_adjustments').insert({ school_id, user_id: b.user_id, period, kind: b.kind, label, amount, created_by: req.user.user_id }).select().single();
  check(error);
  await audit(school_id, req.user, `adjustment_${b.kind}`, b.user_id, { period, label, amount });
  res.status(201).json(data);
}));
r.delete('/adjustments/:id', requireFeature('payroll_manage'), asyncH(async (req, res) => {
  const school_id = schoolOf(req);
  const { data } = await db.from('payroll_adjustments').select('*').eq('id', req.params.id).eq('school_id', school_id).maybeSingle();
  if (!data) throw httpError(404, 'Not found');
  if ((await lockedMonths(data.user_id)).has(data.period)) throw httpError(400, 'That month is finalized and locked');
  check((await db.from('payroll_adjustments').delete().eq('id', data.id)).error);
  await audit(school_id, req.user, 'adjustment_removed', data.user_id, { label: data.label, amount: data.amount });
  res.json({ ok: true });
}));

// ================= my page (employee self-service, read only except applying)
r.get('/me', requireFeature('my_leave'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const uid = req.user.user_id;
  const [settingsBundle, bal, reqs, slips, adj] = await Promise.all([
    settingsOf(school_id), balancesFor(school_id, [uid]),
    all(() => db.from('leave_requests').select('*').eq('user_id', uid).order('created_at', { ascending: false })),
    all(() => db.from('payslips').select('*').eq('user_id', uid).neq('status', 'draft').order('period', { ascending: false })),
    all(() => db.from('payroll_adjustments').select('*').eq('user_id', uid).is('payslip_id', null)),
  ]);
  const types = (await db.from('leave_types').select('*').eq('school_id', school_id).eq('is_active', true).order('name')).data || [];
  const ledger = (await ledgerRows(school_id, { user_id: uid })).reverse();
  // "what is coming": estimate for every month that has no final payslip yet, up to the current month
  const own = (await employeeSet(school_id))[uid];
  const upcoming = [];
  if (own?.salary > 0) {
    const isOff = L.offDayChecker(settingsBundle.weekly_off, await holidaysOf(school_id));
    const locked = new Set(slips.map((s) => s.period));
    const monthsWithLeave = new Set(reqs.filter((q) => q.status === 'approved').flatMap((q) => Object.keys(L.byMonth(q.days_detail))));
    adj.forEach((a) => monthsWithLeave.add(a.period));
    monthsWithLeave.add(L.monthStart(L.todayStr()));
    for (const m of [...monthsWithLeave].filter((m) => !locked.has(m)).sort()) {
      const c = await compute(school_id, own, m, settingsBundle, isOff, await context(school_id, m));
      upcoming.push({ period: m, ended: m < L.monthStart(L.todayStr()), ...slipBody(c) });
    }
  }
  res.json({ approval_mode: settingsBundle.approval_mode, types, balances: bal[0].balances, requests: reqs, payslips: slips, upcoming, ledger, has_salary: !!(own?.salary > 0), pending_adjustments: adj });
}));

r.get('/audit', requireFeature('payroll_manage'), asyncH(async (req, res) => {
  const school_id = schoolOf(req);
  const { data, error } = await db.from('payroll_audit').select('*').eq('school_id', school_id).order('created_at', { ascending: false }).limit(200);
  check(error);
  const names = await nameMap([...data.map((x) => x.actor_id), ...data.map((x) => x.target_user)].filter(Boolean));
  res.json(data.map((x) => ({ ...x, actor: names[x.actor_id], target: names[x.target_user] })));
}));
r.get('/employees', requireFeature('leave_approve', 'leave_grant', 'payroll_manage', 'payroll_view', 'manage_salary'), asyncH(async (req, res) => {
  const list = await employees(schoolOf(req));
  const canSalary = has(req, 'payroll_view', 'payroll_manage', 'manage_salary');
  res.json(list.map((e) => ({ ...e, salary: canSalary ? e.salary : undefined })));
}));

// ================= salary entry & staff reports (attendance is worked out from approved leave)
// Set one person's monthly salary from the Payroll screen (the same column the Users form edits).
r.put('/employees/:uid/salary', requireFeature('payroll_manage', 'manage_salary'), asyncH(async (req, res) => {
  const school_id = schoolOf(req);
  const emp = await loadEmployee(school_id, req.params.uid);
  const v = req.body?.salary;
  const n = v === '' || v === null || v === undefined ? null : Number(v);
  if (n !== null && !(Number.isFinite(n) && n >= 0 && n < 1e8)) throw httpError(400, 'Salary must be a number from 0 up to 99,999,999 (leave empty to clear it)');
  const stored = n === null ? null : L.round2(n);
  check((await db.from('profiles').update({ salary: stored, updated_at: new Date().toISOString() }).eq('user_id', emp.user_id)).error);
  // the audit log never stores salary figures (same rule as the Users screen)
  await audit(school_id, req.user, 'salary_set', emp.user_id, {});
  res.json({ ok: true, user_id: emp.user_id, salary: stored });
}));

// every active employee for one month: attendance from leave + the salary figures
// past months: the whole month. current month: up to today. Finalized / draft payslips are shown as saved.
async function staffMonth(school_id, period) {
  const today = L.todayStr();
  if (period > L.monthStart(today)) throw httpError(400, `${L.monthLabel(period)} hasn't started yet`);
  const through = period < L.monthStart(today) ? L.monthEnd(period) : today;
  const settings = await settingsOf(school_id);
  const isOff = L.offDayChecker(settings.weekly_off, await holidaysOf(school_id));
  const ctx = await context(school_id, period);
  const slips = await all(() => db.from('payslips').select('*').eq('school_id', school_id).eq('period', period));
  const slipBy = Object.fromEntries(slips.map((s) => [s.user_id, s]));
  const emps = (await employees(school_id)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const rows = [];
  for (const e of emps) {
    const leaves = ctx.reqs.filter((q) => q.user_id === e.user_id).map((q) => ({
      name: ctx.types[q.leave_type_id]?.name || 'Leave', is_paid: !!ctx.types[q.leave_type_id]?.is_paid, days_detail: q.days_detail,
    }));
    const attendance = L.attendanceOf({ period, isOff, through, leaves });
    let pay = null;
    const slip = slipBy[e.user_id];
    if (slip) pay = { status: slip.status, leave_cut_days: slip.unpaid_days, leave_deduction: slip.leave_deduction, bonus_total: slip.bonus_total, other_deduction_total: slip.other_deduction_total, net_pay: slip.net_pay };
    else if (e.salary > 0) {
      const c = await compute(school_id, e, period, settings, isOff, ctx);
      pay = { status: 'not prepared', leave_cut_days: c.unpaid_days, leave_deduction: c.leave_deduction, bonus_total: c.bonus_total, other_deduction_total: c.other_deduction_total, net_pay: c.net_pay };
    }
    rows.push({ ...e, attendance, pay });
  }
  return { rows, through };
}

const schoolInfo = async (school_id) => {
  const { data, error } = await db.from('schools').select('name,address,phone,email').eq('id', school_id).maybeSingle();
  check(error); return data || {};
};
const reportPeriod = (q) => { const p = L.toPeriod(q.period); if (!p) throw httpError(400, 'Pick a month'); return p; };
const reportFormat = (q) => { if (!['pdf', 'csv'].includes(q.format)) throw httpError(400, 'format must be pdf or csv'); return q.format; };
const sendReport = (res, buf, mime, name) => {
  res.set({ 'Content-Type': mime, 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' });
  res.send(buf);
};
const reportSubtitle = (period, through) => (through < L.monthEnd(period) ? `Counted up to ${L.monthLabel(period)} ${through.slice(8)} (today). ` : '')
  + 'Present = working days minus approved leave. Weekly offs and school holidays are not counted.';
const ATT_LEGEND = 'P = present, L = paid leave, LWP = unpaid leave, H = half-day leave, O = weekly off / holiday, blank = not counted yet';

// one flat line per person: the same numbers feed the CSV and the PDF
function attendanceLines(rows, period) {
  const lines = rows.map((x) => ({
    name: x.full_name, login: x.login_id, designation: x.designation || '', codes: x.attendance.codes,
    working: x.attendance.working_days, present: x.attendance.present_days, leave: x.attendance.leave_days,
    unpaid: x.attendance.unpaid_leave_days, by_type: x.attendance.by_type.map((t) => `${t.name}: ${t.days}`).join(', ') || '-',
  }));
  const sum = (k) => L.round1(lines.reduce((s, x) => s + Number(x[k] || 0), 0));
  const total = { name: 'Total', working: sum('working'), present: sum('present'), leave: sum('leave'), unpaid: sum('unpaid') };
  return { lines, total, days: L.daysInMonth(period) };
}

r.get('/reports/attendance', requireFeature('payroll_view', 'payroll_manage'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const period = reportPeriod(req.query); const format = reportFormat(req.query);
  const { rows, through } = await staffMonth(school_id, period);
  const { lines, total, days } = attendanceLines(rows, period);
  const base = `attendance-${period.slice(0, 7)}`;
  if (format === 'csv') {
    // attendance register: one row per person, one column per day (P / L / O ...), then the totals
    const dayKey = (i) => `${period.slice(0, 7)}-${String(i).padStart(2, '0')}`;
    const cols = [
      { label: 'Employee', csv: (x) => (x.legend ? ATT_LEGEND : x.name) },
      { label: 'Login ID', csv: (x) => (x.legend || x.total ? '' : x.login) },
      { label: 'Designation', csv: (x) => (x.legend || x.total ? '' : x.designation) },
      ...Array.from({ length: days }, (_, i) => ({ label: String(i + 1), csv: (x) => (x.legend || x.total ? '' : (x.codes[dayKey(i + 1)] ?? '')) })),
      { label: 'Working days', csv: (x) => (x.legend ? '' : x.working) },
      { label: 'Present days', csv: (x) => (x.legend ? '' : x.present) },
      { label: 'Leave days', csv: (x) => (x.legend ? '' : x.leave) },
      { label: 'Unpaid leave days', csv: (x) => (x.legend ? '' : x.unpaid) },
    ];
    const data = [...lines, { ...total, total: true }, { legend: true }];
    return sendReport(res, Buffer.from(toCsv(cols, data), 'utf8'), 'text/csv; charset=utf-8', `${base}.csv`);
  }
  const school = await schoolInfo(school_id);
  const pdf = await tablePdf({
    school, title: `Staff attendance · ${L.monthLabel(period)}`, subtitle: reportSubtitle(period, through),
    totals: [['Staff', lines.length], ['Present days (all staff)', total.present], ['Leave days (all staff)', total.leave], ['Unpaid leave (all staff)', total.unpaid]],
    columns: [
      { label: 'Employee', weight: 3, get: (x) => `${x.name}\n${x.designation || x.login}` },
      { label: 'Working days', weight: 1.1, align: 'right', get: (x) => x.working },
      { label: 'Present', weight: 1, align: 'right', get: (x) => x.present },
      { label: 'Leave days', weight: 1, align: 'right', get: (x) => x.leave },
      { label: 'Unpaid leave', weight: 1.1, align: 'right', get: (x) => x.unpaid },
      { label: 'Leave by type', weight: 3, get: (x) => x.by_type },
    ],
    rows: lines,
    note: ATT_LEGEND,
  });
  sendReport(res, pdf, 'application/pdf', `${base}.pdf`);
}));

r.get('/reports/salary', requireFeature('payroll_view', 'payroll_manage'), asyncH(async (req, res) => {
  const school_id = schoolOf(req); const period = reportPeriod(req.query); const format = reportFormat(req.query);
  const { rows, through } = await staffMonth(school_id, period);
  const base = `salary-${period.slice(0, 7)}`;
  const lines = rows.map((x) => ({
    name: x.full_name, login: x.login_id, designation: x.designation || '', salary: x.salary,
    present: x.attendance.present_days, leave: x.attendance.leave_days,
    cut_days: x.pay?.leave_cut_days ?? '', leave_cut: x.pay?.leave_deduction ?? '', bonus: x.pay?.bonus_total ?? '',
    other: x.pay?.other_deduction_total ?? '', net: x.pay?.net_pay ?? '', status: x.pay ? x.pay.status : (x.salary > 0 ? '' : 'Salary not set'),
  }));
  const sum = (k) => L.round2(lines.reduce((s, x) => s + (x[k] === '' ? 0 : Number(x[k])), 0));
  const total = { name: 'Total', salary: sum('salary'), present: L.round1(lines.reduce((s, x) => s + Number(x.present), 0)), leave: L.round1(lines.reduce((s, x) => s + Number(x.leave), 0)), cut_days: sum('cut_days'), leave_cut: sum('leave_cut'), bonus: sum('bonus'), other: sum('other'), net: sum('net') };
  const m = (v) => (v === '' || v === null ? '' : money(v));
  if (format === 'csv') {
    const cols = [
      { label: 'Employee', csv: (x) => (x.legend ? 'Salary = monthly gross. Net pay = salary - leave cut + bonus - deductions. Status: draft / finalized / paid, or "not prepared" (estimate).' : x.name) },
      { label: 'Login ID', csv: (x) => (x.total || x.legend ? '' : x.login) },
      { label: 'Designation', csv: (x) => (x.total || x.legend ? '' : x.designation) },
      { label: 'Monthly salary', csv: (x) => (x.legend ? '' : x.salary ?? '') },
      { label: 'Present days', csv: (x) => (x.legend ? '' : x.present) },
      { label: 'Leave days', csv: (x) => (x.legend ? '' : x.leave) },
      { label: 'Days cut from salary', csv: (x) => (x.legend ? '' : x.cut_days) },
      { label: 'Leave cut', csv: (x) => (x.legend ? '' : x.leave_cut) },
      { label: 'Bonus', csv: (x) => (x.legend ? '' : x.bonus) },
      { label: 'Other deductions', csv: (x) => (x.legend ? '' : x.other) },
      { label: 'Net pay', csv: (x) => (x.legend ? '' : x.net) },
      { label: 'Status', csv: (x) => (x.legend || x.total ? '' : x.status) },
    ];
    return sendReport(res, Buffer.from(toCsv(cols, [...lines, { ...total, total: true }, { legend: true }]), 'utf8'), 'text/csv; charset=utf-8', `${base}.csv`);
  }
  const school = await schoolInfo(school_id);
  const pdf = await tablePdf({
    school, title: `Salary register · ${L.monthLabel(period)}`, subtitle: reportSubtitle(period, through),
    totals: [['Net pay', m(total.net)], ['Leave cut', m(total.leave_cut)], ['Bonus', m(total.bonus)], ['Staff', lines.length]],
    columns: [
      { label: 'Employee', weight: 2.6, get: (x) => `${x.name}\n${x.designation || x.login}` },
      { label: 'Salary', weight: 1.3, align: 'right', get: (x) => m(x.salary) || 'Not set' },
      { label: 'Present', weight: 0.9, align: 'right', get: (x) => x.present },
      { label: 'Leave days', weight: 0.9, align: 'right', get: (x) => x.leave },
      { label: 'Leave cut', weight: 1.2, align: 'right', get: (x) => m(x.leave_cut) },
      { label: 'Bonus', weight: 1.1, align: 'right', get: (x) => m(x.bonus) },
      { label: 'Other ded.', weight: 1.1, align: 'right', get: (x) => m(x.other) },
      { label: 'Net pay', weight: 1.3, align: 'right', get: (x) => m(x.net) },
      { label: 'Status', weight: 1.2, get: (x) => x.status || '' },
    ],
    rows: lines,
    note: 'Figures for finalized and paid months are the saved payslip numbers. "not prepared" rows are estimates from the current salary and leave.',
  });
  sendReport(res, pdf, 'application/pdf', `${base}.pdf`);
}));

export default r;
