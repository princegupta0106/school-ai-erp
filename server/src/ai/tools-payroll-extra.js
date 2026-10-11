// More Payroll & Leave: apply for someone else, yearly allotment, leave types and approval mode.
import { httpError } from '../db.js';
import { S, N, B, obj, norm, pickOne } from './helpers.js';
import { resolveDate } from './tools-leave.js';

const types = async (ctx) => (await ctx.api('GET', '/payroll/settings')).types.filter((t) => t.is_active);

export const payrollExtraTools = [
  {
    name: 'record_leave_for_employee',
    description: 'Record a leave for another employee (approvers only; it is approved at once). Dates accept today / tomorrow / YYYY-MM-DD.',
    features: ['leave_approve'],
    parameters: obj({ employee_name: S('Employee name'), start_date: S('First day'), end_date: S('Last day (optional)'), leave_type: S('Leave type name'), half_day: B('Half day'), reason: S('Reason (optional)') }, ['employee_name', 'start_date', 'leave_type']),
    run: async (ctx, a) => {
      const emps = await ctx.api('GET', '/payroll/employees');
      const e = pickOne(emps, a.employee_name, (x) => x.full_name, 'employee', (x) => x.login_id);
      const t = pickOne(await types(ctx), a.leave_type, (x) => x.name, 'leave type');
      const start = resolveDate(a.start_date);
      const r = await ctx.api('POST', '/payroll/leave', { user_id: e.user_id, leave_type_id: t.id, start_date: start, end_date: a.end_date ? resolveDate(a.end_date) : start, half_day: !!a.half_day, reason: a.reason });
      return { recorded: true, employee: e.full_name, leave_type: t.name, from: r.start_date, to: r.end_date, days: Number(r.days), status: r.status };
    },
  },
  {
    name: 'allot_yearly_leave',
    description: 'Give every employee (or named ones) the yearly quota of a leave type for a period like "2026-2027". Can only be done once per period. The user must confirm first.',
    features: ['leave_grant'],
    confirm: true,
    parameters: obj({ leave_type: S('Leave type name'), period: S('e.g. 2026-2027'), everyone: B('true = all employees'), employee_names: { type: 'array', items: { type: 'string' }, description: 'Or these employees' } }, ['leave_type', 'period']),
    prepare: async (ctx, a) => {
      const t = pickOne(await types(ctx), a.leave_type, (x) => x.name, 'leave type');
      let ids = [];
      if (!a.everyone) {
        if (!a.employee_names?.length) throw httpError(400, 'Everyone, or which employees?');
        const emps = await ctx.api('GET', '/payroll/employees');
        ids = a.employee_names.map((n) => pickOne(emps, n, (x) => x.full_name, 'employee').user_id);
      }
      return { args: { kind: 'allotment', leave_type_id: t.id, period_key: a.period, all: !!a.everyone, user_ids: ids }, describe: `Allot the yearly quota of ${t.name} (${t.annual_quota} days) for ${a.period} to ${a.everyone ? 'ALL employees' : a.employee_names.join(', ')}` };
    },
    run: async (ctx, a) => ({ ...(await ctx.api('POST', '/payroll/grants', a)), note: 'skipped = already had this period' }),
  },
  {
    name: 'create_leave_type',
    description: 'Add a leave type (e.g. "Casual Leave", 12 days a year, paid; or an unpaid type).',
    features: ['payroll_settings'],
    parameters: obj({ name: S('Leave type name'), yearly_quota: N('Days per year (0 for unpaid)'), paid: B('true = paid (default)') }, ['name']),
    run: async (ctx, a) => { const r = await ctx.api('POST', '/payroll/leave-types', { name: a.name, annual_quota: a.yearly_quota || 0, is_paid: a.paid !== false }); return { created: true, name: r.name, paid: r.is_paid, yearly_quota: Number(r.annual_quota) }; },
  },
  {
    name: 'set_leave_approval_mode',
    description: 'Choose how leave is approved: "manual" (an approver decides) or "auto" (approved at once). The user must confirm first.',
    features: ['payroll_settings'],
    confirm: true,
    parameters: obj({ mode: S('manual or auto', { enum: ['manual', 'auto'] }) }, ['mode']),
    prepare: async (ctx, a) => ({ args: { mode: a.mode }, describe: `Set leave approval to ${a.mode === 'auto' ? 'AUTOMATIC (every request is approved at once)' : 'MANUAL (an approver decides)'}` }),
    run: async (ctx, a) => {
      const cur = (await ctx.api('GET', '/payroll/settings')).settings;
      const r = await ctx.api('PUT', '/payroll/settings', { approval_mode: a.mode, rate_basis: cur.rate_basis || 'working_days', weekly_off: cur.weekly_off || [0] });
      return { done: true, approval_mode: r.approval_mode };
    },
  },
];
void norm;
