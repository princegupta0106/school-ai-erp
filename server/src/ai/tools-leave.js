// ---------------------------------------------------------------------------------------------
// TOOLS FOR THE "PAYROLL & LEAVE" MODULE
//
// A tool = { name, description, parameters (JSON schema), features (any-of), confirm?, prepare?, run }
//   features : who may even SEE the tool (the real check is still done by the API route it calls)
//   confirm  : true -> the user must press Confirm before it runs (money / balances / bulk actions)
//   prepare  : (ctx,args) -> { args, describe }   validates + resolves names; used for the confirm card
//   run      : (ctx,args) -> plain JSON result given back to the model
// ctx = { user, api(method,path,body), today }
//
// To add another module (fees, attendance...) copy this file, write tools that call that module's
// routes, and add the array to registry.js.
// ---------------------------------------------------------------------------------------------
import { cfg } from '../config.js';
import { httpError } from '../db.js';

// ---------- small helpers ----------
export const todayIn = (tz = cfg.timezone) => new Date().toLocaleDateString('en-CA', { timeZone: tz });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const shift = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function resolveDate(v, fallback) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) { if (fallback) return fallback; throw httpError(400, 'A date is required'); }
  const today = todayIn();
  if (s === 'today') return today;
  if (s === 'tomorrow') return shift(today, 1);
  if (s === 'yesterday') return shift(today, -1);
  if (DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return s;
  throw httpError(400, `I could not understand the date "${v}". Use YYYY-MM-DD.`);
}
// 'YYYY-MM' (or date) -> 'YYYY-MM-01'; empty -> previous month
export function resolvePeriod(v) {
  const s = String(v ?? '').trim();
  if (!s) { const t = todayIn(); const d = new Date(`${t.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); }
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return `${s.slice(0, 7)}-01`;
  throw httpError(400, 'Use a month like 2026-09');
}
const monthName = (p) => new Date(`${p.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function leaveTypes(ctx) {
  const { types } = await ctx.api('GET', '/payroll/settings');
  return types.filter((t) => t.is_active);
}
function matchType(types, wanted) {
  const w = norm(wanted);
  const hit = types.find((t) => norm(t.name) === w) || types.filter((t) => norm(t.name).includes(w) || w.includes(norm(t.name)));
  const one = Array.isArray(hit) ? (hit.length === 1 ? hit[0] : null) : hit;
  if (!one) throw httpError(400, `${Array.isArray(hit) && hit.length > 1 ? 'More than one' : 'No'} leave type matches "${wanted}". Available: ${types.map((t) => t.name).join(', ')}`);
  return one;
}
// employees visible to this person (needs an approver / payroll feature)
async function findEmployee(ctx, name) {
  const list = await ctx.api('GET', '/payroll/employees');
  const w = norm(name);
  const exact = list.filter((e) => norm(e.full_name) === w || norm(e.login_id) === w);
  const found = exact.length ? exact : list.filter((e) => norm(e.full_name).includes(w) || norm(e.login_id).includes(w));
  if (found.length === 1) return found[0];
  if (!found.length) throw httpError(404, `No employee found for "${name}"`);
  throw httpError(409, `More than one employee matches "${name}": ${found.slice(0, 8).map((e) => `${e.full_name} (${e.login_id})`).join('; ')}. Ask which one.`);
}
const slimRequest = (r, typeName) => ({
  id: r.id, type: typeName || undefined, from: r.start_date, to: r.end_date, days: Number(r.days), half_day: !!r.half_day,
  status: r.status, reason: r.reason || undefined, auto_approved: r.auto_approved || undefined, note: r.decision_note || undefined,
});
const slimSlip = (s) => ({
  period: s.period, status: s.status, base_salary: Number(s.base_salary), unpaid_days: Number(s.unpaid_days), leave_deduction: Number(s.leave_deduction),
  bonus: Number(s.bonus_total), other_deductions: Number(s.other_deduction_total), net_pay: Number(s.net_pay),
});

const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const obj = (properties, required = []) => ({ type: 'object', properties, required });

// ======================================================================================
// EVERYONE WITH "my_leave"  (staff, teachers, other employees, school admins)
// ======================================================================================
const SELF = ['my_leave'];
const APPROVER = ['leave_approve'];

export const leaveTools = [
  {
    name: 'get_my_profile',
    description: 'Who the signed-in person is: name, role, designation, department, employee id, contact details and today\'s date. Use it to fill in any detail about the user.',
    features: [],
    parameters: obj({}),
    run: async (ctx) => {
      const p = ctx.user.profile || {};
      return {
        name: p.full_name || ctx.user.login_id, login_id: ctx.user.login_id, role: ctx.user.role,
        designation: p.designation || null, department: p.department || null, employee_id: p.employee_id || null,
        email: p.email || null, phone: p.phone || null, joining_date: p.joining_date || null,
        today: ctx.today, timezone: cfg.timezone,
      };
    },
  },
  {
    name: 'list_leave_types',
    description: 'The leave types of the school (e.g. Casual, Sick, Unpaid) with yearly quota and whether they are paid.',
    features: SELF,
    parameters: obj({}),
    run: async (ctx) => (await leaveTypes(ctx)).map((t) => ({ name: t.name, paid: t.is_paid, yearly_quota: Number(t.annual_quota) })),
  },
  {
    name: 'get_my_leave_summary',
    description: 'My leave balances (per type), my recent leave requests with status, and whether approval is manual or automatic.',
    features: SELF,
    parameters: obj({}),
    run: async (ctx) => {
      const me = await ctx.api('GET', '/payroll/me');
      const names = Object.fromEntries(me.types.map((t) => [t.id, t.name]));
      return {
        approval_mode: me.approval_mode,
        balances: me.balances.map((b) => ({ type: b.name, balance_days: b.balance, pending_days: b.pending })),
        recent_requests: me.requests.slice(0, 10).map((r) => slimRequest(r, names[r.leave_type_id])),
      };
    },
  },
  {
    name: 'apply_leave',
    description:
      'Apply for leave for the signed-in person. Only start_date is needed: everything else is filled in automatically ' +
      '(end date = start date, leave type = Casual/the only type, reason = "Personal reasons"). Dates accept "today", "tomorrow" or YYYY-MM-DD. ' +
      'Weekly offs and holidays are skipped by the backend. Depending on school settings the request is approved at once or waits for an approver.',
    features: SELF,
    parameters: obj({
      start_date: S('First day of leave: today, tomorrow or YYYY-MM-DD'),
      end_date: S('Last day of leave (omit for a single day)'),
      half_day: { type: 'boolean', description: 'true for a half day (single date only)' },
      leave_type: S('Leave type name, e.g. Casual, Sick. Omit to let the system choose the default.'),
      reason: S('Reason for leave. Omit if the user did not give one.'),
    }, ['start_date']),
    run: async (ctx, a) => {
      const start = resolveDate(a.start_date);
      const end = resolveDate(a.end_date, start);
      const types = await leaveTypes(ctx);
      const assumed = [];
      let type;
      if (a.leave_type) type = matchType(types, a.leave_type);
      else {
        const me = await ctx.api('GET', '/payroll/me');
        const bal = Object.fromEntries(me.balances.map((b) => [b.type_id, b.balance]));
        const casual = types.find((t) => t.is_paid && /casual/i.test(t.name) && (bal[t.id] || 0) > 0);
        type = casual || (types.length === 1 ? types[0] : null);
        if (!type) throw httpError(400, `Which leave type? Options: ${types.map((t) => `${t.name}${t.is_paid ? ` (balance ${bal[t.id] ?? 0})` : ' (unpaid)'}`).join(', ')}`);
        assumed.push(`leave type: ${type.name}`);
      }
      let reason = String(a.reason || '').trim();
      if (!reason) { reason = 'Personal reasons'; assumed.push('reason: "Personal reasons"'); }
      const row = await ctx.api('POST', '/payroll/leave', { leave_type_id: type.id, start_date: start, end_date: end, half_day: !!a.half_day, reason });
      return {
        applied: true, request_id: row.id, leave_type: type.name, from: row.start_date, to: row.end_date, days_counted: Number(row.days), half_day: !!row.half_day,
        status: row.status, auto_approved: !!row.auto_approved,
        meaning: row.status === 'approved' ? 'Leave is approved.' : 'Leave is pending and waits for an approver.',
        filled_in_automatically: assumed,
      };
    },
  },
  {
    name: 'cancel_my_leave',
    description: 'Cancel one of my pending or approved leave requests. Give request_id, or the date the leave covers (e.g. "today", "tomorrow", YYYY-MM-DD).',
    features: SELF,
    parameters: obj({ request_id: S('Leave request id'), date: S('A date covered by the leave request') }),
    run: async (ctx, a) => {
      let id = a.request_id;
      if (!id) {
        const d = resolveDate(a.date);
        const me = await ctx.api('GET', '/payroll/me');
        const hits = me.requests.filter((r) => ['pending', 'approved'].includes(r.status) && r.start_date <= d && r.end_date >= d);
        if (!hits.length) throw httpError(404, `You have no pending or approved leave covering ${d}`);
        if (hits.length > 1) throw httpError(409, `More than one request covers ${d}; give the request id: ${hits.map((r) => r.id).join(', ')}`);
        id = hits[0].id;
      }
      const r = await ctx.api('POST', `/payroll/leave/${id}/cancel`, {});
      return { cancelled: true, request_id: r.id, from: r.start_date, to: r.end_date };
    },
  },
  {
    name: 'get_my_salary',
    description:
      'My own salary details: finalized payslips (net pay, deductions for extra leave, bonus) and an estimate for the current / upcoming months. ' +
      'Optional period "YYYY-MM" for one month.',
    features: SELF,
    parameters: obj({ period: S('Month as YYYY-MM (optional)') }),
    run: async (ctx, a) => {
      const me = await ctx.api('GET', '/payroll/me');
      if (!me.has_salary) return { message: 'No salary is set on your profile yet. Ask the school admin.' };
      const slips = me.payslips.map(slimSlip);
      const upcoming = me.upcoming.map((u) => ({ period: u.period, month_ended: u.ended, estimated_net_pay: Number(u.net_pay), unpaid_days: Number(u.unpaid_days), leave_deduction: Number(u.leave_deduction), bonus: Number(u.bonus_total), other_deductions: Number(u.other_deduction_total), base_salary: Number(u.base_salary) }));
      if (a.period) {
        const p = resolvePeriod(a.period);
        return { period: p, payslip: slips.find((s) => s.period === p) || null, estimate: upcoming.find((u) => u.period === p) || null };
      }
      return { latest_payslips: slips.slice(0, 3), upcoming_estimates: upcoming.slice(-3) };
    },
  },

  // ======================================================================================
  // APPROVERS / HR  (leave_approve, leave_view_all, leave_grant)
  // ======================================================================================
  {
    name: 'list_leave_requests',
    description: 'List leave requests of the school (default: pending ones waiting for a decision). Optional filter by status and employee name.',
    features: ['leave_approve', 'leave_view_all'],
    parameters: obj({
      status: S('pending, approved, rejected or cancelled (default pending)', { enum: ['pending', 'approved', 'rejected', 'cancelled'] }),
      employee_name: S('Part of the employee name'),
    }),
    run: async (ctx, a) => {
      const [rows, types] = await Promise.all([ctx.api('GET', `/payroll/leave?status=${a.status || 'pending'}`), leaveTypes(ctx).catch(() => [])]);
      const tn = Object.fromEntries(types.map((t) => [t.id, t.name]));
      const w = norm(a.employee_name);
      const list = rows.filter((r) => !w || norm(r.employee?.full_name).includes(w));
      return { count: list.length, requests: list.slice(0, 25).map((r) => ({ ...slimRequest(r, tn[r.leave_type_id]), employee: r.employee?.full_name, designation: r.employee?.designation || undefined })) };
    },
  },
  {
    name: 'decide_leave',
    description:
      'Approve or reject a pending leave request. Identify it by request_id, OR by employee_name (+ optional date). ' +
      'The backend refuses if the person is not an approver or tries to decide their own leave.',
    features: APPROVER,
    parameters: obj({
      action: S('approve or reject', { enum: ['approve', 'reject'] }),
      request_id: S('Leave request id'),
      employee_name: S('Employee name (when no id)'),
      date: S('A date covered by the request (optional)'),
      note: S('Optional note shown to the employee'),
    }, ['action']),
    run: async (ctx, a) => {
      let id = a.request_id;
      if (!id) {
        if (!a.employee_name) throw httpError(400, 'Give the request id or the employee name');
        const rows = await ctx.api('GET', '/payroll/leave?status=pending');
        const w = norm(a.employee_name); const d = a.date ? resolveDate(a.date) : null;
        const hits = rows.filter((r) => norm(r.employee?.full_name).includes(w) && (!d || (r.start_date <= d && r.end_date >= d)));
        if (!hits.length) throw httpError(404, `No pending leave request found for "${a.employee_name}"`);
        if (hits.length > 1) throw httpError(409, `More than one pending request: ${hits.map((r) => `${r.employee?.full_name} ${r.start_date}..${r.end_date} (id ${r.id})`).join('; ')}. Ask which one.`);
        id = hits[0].id;
      }
      const r = await ctx.api('POST', `/payroll/leave/${id}/${a.action}`, { note: a.note || '' });
      return { done: true, request_id: r.id, status: r.status, from: r.start_date, to: r.end_date };
    },
  },
  {
    name: 'get_leave_balances',
    description: 'Leave balances of all employees (or one, by name).',
    features: ['leave_view_all', 'leave_grant', 'leave_approve'],
    parameters: obj({ employee_name: S('Part of the employee name (optional)') }),
    run: async (ctx, a) => {
      const w = norm(a.employee_name);
      const rows = (await ctx.api('GET', '/payroll/balances')).filter((e) => !w || norm(e.full_name).includes(w));
      return { count: rows.length, employees: rows.slice(0, 40).map((e) => ({ name: e.full_name, designation: e.designation || undefined, balances: e.balances.map((b) => `${b.name}: ${b.balance}${b.pending ? ` (${b.pending} pending)` : ''}`) })) };
    },
  },
  {
    name: 'grant_leave',
    description: 'Add (grant) or correct (adjustment, may be negative) leave balance for one employee. A note is required. The user must confirm first.',
    features: ['leave_grant'],
    confirm: true,
    parameters: obj({
      employee_name: S('Employee name'),
      leave_type: S('Leave type name'),
      days: { type: 'number', description: 'Days in halves, e.g. 1, 0.5, -2' },
      kind: S('grant (add days) or adjustment (correction, can be negative)', { enum: ['grant', 'adjustment'] }),
      note: S('Why - kept in the record'),
    }, ['employee_name', 'leave_type', 'days', 'note']),
    prepare: async (ctx, a) => {
      const emp = await findEmployee(ctx, a.employee_name);
      const type = matchType(await leaveTypes(ctx), a.leave_type);
      const days = Number(a.days);
      const kind = a.kind || (days < 0 ? 'adjustment' : 'grant');
      return { args: { user_id: emp.user_id, leave_type_id: type.id, days, kind, note: a.note }, describe: `${kind === 'grant' ? 'Grant' : 'Adjust by'} ${days} day(s) of ${type.name} leave for ${emp.full_name}. Note: "${a.note}"` };
    },
    run: async (ctx, a) => ({ ...(await ctx.api('POST', '/payroll/grants', { kind: a.kind, leave_type_id: a.leave_type_id, days: a.days, note: a.note, user_ids: [a.user_id] })), done: true }),
  },

  // ======================================================================================
  // PAYROLL  (payroll_view, payroll_manage)
  // ======================================================================================
  {
    name: 'list_payslips',
    description: 'Payslips of all staff for one month (default: last month): net pay, deductions and status. Also lists staff whose payslip is not prepared yet.',
    features: ['payroll_view', 'payroll_manage'],
    parameters: obj({ period: S('Month as YYYY-MM (default last month)') }),
    run: async (ctx, a) => {
      const period = resolvePeriod(a.period);
      const r = await ctx.api('GET', `/payroll/payslips?period=${period.slice(0, 7)}`);
      const rows = r.rows.map((s) => ({ employee: s.employee?.full_name, ...slimSlip(s) }));
      return {
        month: monthName(period), month_has_ended: r.can_generate, count: rows.length,
        total_net_pay: Math.round(rows.reduce((t, s) => t + s.net_pay, 0) * 100) / 100,
        payslips: rows.slice(0, 40), not_prepared: r.missing.map((m) => `${m.full_name}${m.has_salary ? '' : ' (no salary set)'}`),
      };
    },
  },
  {
    name: 'prepare_payroll',
    description: 'Create / refresh DRAFT payslips for a finished month (default: last month). Finalized and paid payslips are not touched. The user must confirm first.',
    features: ['payroll_manage'],
    confirm: true,
    parameters: obj({ period: S('Month as YYYY-MM (default last month)') }),
    prepare: async (ctx, a) => { const p = resolvePeriod(a.period); return { args: { period: p }, describe: `Prepare draft payslips for ${monthName(p)}` }; },
    run: async (ctx, a) => ({ ...(await ctx.api('POST', '/payroll/payslips/generate', { period: a.period })), done: true }),
  },
  {
    name: 'finalize_payroll',
    description: 'Finalize ALL draft payslips of a month. This locks the numbers and the leave in that month. The user must confirm first.',
    features: ['payroll_manage'],
    confirm: true,
    parameters: obj({ period: S('Month as YYYY-MM (default last month)') }),
    prepare: async (ctx, a) => { const p = resolvePeriod(a.period); return { args: { period: p }, describe: `FINALIZE all draft payslips of ${monthName(p)} (locks the numbers)` }; },
    run: async (ctx, a) => ({ ...(await ctx.api('POST', '/payroll/payslips/finalize-all', { period: a.period })), note: 'done = finalized, failed = reasons for any that could not be finalized' }),
  },
  {
    name: 'mark_payroll_paid',
    description: 'Mark ALL finalized payslips of a month as paid. The user must confirm first.',
    features: ['payroll_manage'],
    confirm: true,
    parameters: obj({
      period: S('Month as YYYY-MM (default last month)'),
      payment_method: S('e.g. Bank transfer, Cash, Cheque'),
      payment_date: S('YYYY-MM-DD or today'),
    }),
    prepare: async (ctx, a) => {
      const p = resolvePeriod(a.period); const date = resolveDate(a.payment_date, todayIn());
      return { args: { period: p, payment_method: a.payment_method || '', payment_date: date }, describe: `Mark all finalized payslips of ${monthName(p)} as PAID on ${date}${a.payment_method ? ` via ${a.payment_method}` : ''}` };
    },
    run: async (ctx, a) => ({ ...(await ctx.api('POST', '/payroll/payslips/pay-all', a)), note: 'done = number of payslips marked paid' }),
  },
  {
    name: 'add_payroll_adjustment',
    description: 'Add a bonus or an extra deduction to one employee\'s pay for a month. The user must confirm first.',
    features: ['payroll_manage'],
    confirm: true,
    parameters: obj({
      employee_name: S('Employee name'),
      kind: S('bonus or deduction', { enum: ['bonus', 'deduction'] }),
      amount: { type: 'number', description: 'Amount in rupees (positive)' },
      label: S('Reason shown to the employee'),
      period: S('Month as YYYY-MM (default: current month)'),
    }, ['employee_name', 'kind', 'amount', 'label']),
    prepare: async (ctx, a) => {
      const emp = await findEmployee(ctx, a.employee_name);
      const period = a.period ? resolvePeriod(a.period) : `${todayIn().slice(0, 7)}-01`;
      return { args: { user_id: emp.user_id, kind: a.kind, amount: Number(a.amount), label: a.label, period }, describe: `Add a ${a.kind} of Rs ${Number(a.amount).toLocaleString('en-IN')} ("${a.label}") to ${emp.full_name} for ${monthName(period)}` };
    },
    run: async (ctx, a) => ({ ...(await ctx.api('POST', '/payroll/adjustments', a)), done: true }),
  },
];
