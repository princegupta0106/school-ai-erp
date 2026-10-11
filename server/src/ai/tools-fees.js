// Fees: student fee accounts, collecting payments, discounts / extra charges, cancelling a payment,
// the fee structure, and the parent / student view. Money tools always show a Confirm card.
import { httpError } from '../db.js';
import { S, N, obj, withSchool, resolveSchoolId, resolveClass, findStudent, currentSessionId, pickOne, P, cap, norm, peso } from './helpers.js';
import { resolveDate } from './tools-leave.js';

const STAFF = ['view_student_fees', 'collect_fees', 'adjust_fees'];
const pre = ['fees'];
const MODES = ['cash', 'upi', 'cheque', 'bank_transfer', 'card', 'other'];
const money = (n) => { const s = String(n ?? '').trim(); if (!/^\d+(\.\d{1,2})?$/.test(s) || !(Number(s) > 0)) throw httpError(400, 'Amount must be a positive number like 5000 or 2500.50'); return s; };
const account = (ctx, id, sid, sessionId) => ctx.api('GET', P(`/fees/students/${id}`, { session_id: sessionId, school_id: sid }));
const slimAccount = (r) => ({
  student: r.student.full_name, class: r.student.class_label, session: r.session.name, today: r.today,
  totals: r.ledger.totals, fee_lines: cap(r.ledger.lines, 2500),
  recent_payments: r.payments.slice(0, 6).map((p) => ({ receipt: p.receipt_no, amount: p.amount, date: p.paid_on, mode: p.mode, status: p.status })),
  adjustments: r.adjustments.filter((x) => !x.voided).slice(0, 6).map((x) => ({ fee: x.item_name || 'general', amount: x.amount, reason: x.reason })),
  has_fee_structure: r.has_structure,
});

export const feesTools = [
  {
    name: 'get_student_fees',
    description: 'A student\'s fee account: total, paid, pending, what is due till today, fee lines, latest payments (with receipt numbers).',
    features: STAFF,
    parameters: obj(withSchool({ student: S('Student name or login id'), session: S('Session name like 2026-2027 (default current)') }), ['student']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const s = await findStudent(ctx, a.student, sid, pre);
      return slimAccount(await account(ctx, s.id, sid, a.session ? await currentSessionId(ctx, sid, a.session) : undefined));
    },
  },
  {
    name: 'record_fee_payment',
    description: 'Record a fee payment received from a student (cash, upi, cheque, bank_transfer, card, other). Cannot exceed the pending balance. A receipt number is created. The user must confirm first.',
    features: ['collect_fees'],
    confirm: true,
    parameters: obj(withSchool({ student: S('Student name or login id'), amount: N('Amount in rupees'), mode: S('How it was paid', { enum: MODES }), reference: S('Cheque / UPI / transaction reference (optional)'), note: S('Note (optional)'), paid_on: S('today (default) or YYYY-MM-DD') }), ['student', 'amount', 'mode']),
    prepare: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const s = await findStudent(ctx, a.student, sid, pre);
      const amount = money(a.amount);
      if (!MODES.includes(a.mode)) throw httpError(400, `Payment mode must be one of ${MODES.join(', ')}`);
      const acc = await account(ctx, s.id, sid);
      return { args: { student_id: s.id, school_id: sid, amount, mode: a.mode, reference: a.reference, note: a.note, paid_on: a.paid_on ? resolveDate(a.paid_on) : undefined }, describe: `Record ${peso(amount)} (${a.mode}${a.reference ? `, ref ${a.reference}` : ''}) received from ${s.name} (${s.class_label || 'class ?'}). Pending now: ${peso(acc.ledger.totals.pending)}` };
    },
    run: async (ctx, a) => {
      const { student_id, school_id, ...body } = a;
      const r = await ctx.api('POST', `/fees/students/${student_id}/payments`, { ...body, school_id });
      return { recorded: true, receipt_no: r.payment.receipt_no, amount: Number(r.payment.amount), pending_after: r.account.ledger.totals.pending };
    },
  },
  {
    name: 'adjust_fees',
    description: 'Give a discount or add an extra charge to a student\'s fees (school admin only). Optionally on one named fee. A reason is required. The user must confirm first.',
    features: ['adjust_fees'],
    confirm: true,
    parameters: obj(withSchool({ student: S('Student name or login id'), type: S('discount or charge', { enum: ['discount', 'charge'] }), amount: N('Amount in rupees'), reason: S('Reason (kept in the record)'), fee_name: S('Name of one fee, e.g. Tuition (omit for a general adjustment)') }), ['student', 'type', 'amount', 'reason']),
    prepare: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const s = await findStudent(ctx, a.student, sid, pre);
      const amount = money(a.amount);
      let item;
      if (a.fee_name) { const acc = await account(ctx, s.id, sid); item = pickOne(acc.items, a.fee_name, (i) => i.name, 'fee'); }
      return { args: { student_id: s.id, school_id: sid, type: a.type, amount, reason: a.reason, item_id: item?.id }, describe: `${a.type === 'discount' ? 'DISCOUNT' : 'EXTRA CHARGE'} of ${peso(amount)} for ${s.name} (${s.class_label || ''})${item ? ` on "${item.name}"` : ' (general)'}. Reason: ${a.reason}` };
    },
    run: async (ctx, a) => { const { student_id, ...body } = a; const r = await ctx.api('POST', `/fees/students/${student_id}/adjustments`, body); return { done: true, totals: r.ledger.totals }; },
  },
  {
    name: 'cancel_fee_payment',
    description: 'Cancel a wrongly recorded payment by its receipt number (school admin only; it stays in the history). A reason is required. The user must confirm first.',
    features: ['cancel_fee_payment'],
    confirm: true,
    parameters: obj(withSchool({ student: S('Student name or login id'), receipt_no: S('Receipt number, e.g. RCP-000007'), reason: S('Why it is cancelled') }), ['student', 'receipt_no', 'reason']),
    prepare: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const s = await findStudent(ctx, a.student, sid, pre);
      const acc = await account(ctx, s.id, sid);
      const p = acc.payments.find((x) => norm(x.receipt_no) === norm(a.receipt_no));
      if (!p) throw httpError(404, `${s.name} has no receipt ${a.receipt_no}`);
      if (p.status === 'cancelled') throw httpError(400, 'That payment is already cancelled');
      return { args: { id: p.id, school_id: sid, reason: a.reason }, describe: `CANCEL payment ${p.receipt_no} of ${peso(p.amount)} (${p.paid_on}) from ${s.name}. Reason: ${a.reason}` };
    },
    run: async (ctx, a) => { const r = await ctx.api('POST', `/fees/payments/${a.id}/cancel`, { reason: a.reason, school_id: a.school_id }); return { cancelled: true, totals: r.ledger.totals }; },
  },
  {
    name: 'get_fee_structure',
    description: 'The fee structure of a session: for each class the fees (name, amount, payment term) and the class total.',
    features: ['manage_fee_structure'],
    parameters: obj(withSchool({ session: S('Session name (default current)') })),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const r = await ctx.api('GET', P('/fees/structure', { session_id: a.session ? await currentSessionId(ctx, sid, a.session) : undefined, school_id: sid }));
      return cap({ session: r.session.name, terms: r.frequencies.map((f) => f.key), classes: r.classes.map((c) => ({ class: c.name, sections: c.sections.join(', '), students: c.students, yearly_total: c.total, fees: c.items.map((i) => `${i.name}: ${peso(i.amount)} (${i.frequency})`) })) });
    },
  },
  {
    name: 'add_fee',
    description: 'Add a fee to a class for a session (e.g. Tuition Rs 24000 monthly for class 5). All sections share it. The user must confirm first.',
    features: ['manage_fee_structure'],
    confirm: true,
    parameters: obj(withSchool({ class_name: S('Class name without section, e.g. "5"'), fee_name: S('e.g. Tuition'), amount: N('TOTAL for the session in rupees'), frequency: S('Payment term', { enum: ['one_time', 'half_yearly', 'quarterly', 'monthly'] }), session: S('Session name (default current)') }), ['class_name', 'fee_name', 'amount', 'frequency']),
    prepare: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const amount = money(a.amount);
      const cls = await resolveClass(ctx, a.class_name, sid, ['fees']).catch(() => ({ name: a.class_name }));
      return { args: { school_id: sid, class_name: cls.name, name: a.fee_name, amount, frequency: a.frequency, session_id: a.session ? await currentSessionId(ctx, sid, a.session) : undefined }, describe: `Add fee "${a.fee_name}" = ${peso(amount)} for the session, paid ${a.frequency.replace('_', ' ')}, to class ${cls.name} (changes the dues of every student there)` };
    },
    run: async (ctx, a) => { const r = await ctx.api('POST', '/fees/structure/items', a); return { added: true, fee: r.name, class: r.class_name, amount: Number(r.amount), frequency: r.frequency }; },
  },
  {
    name: 'my_fees',
    description: 'For parents and students: the fees (total, paid, pending) of me / my children.',
    features: ['view_my_fees'],
    parameters: obj({}),
    run: async (ctx) => (await ctx.api('GET', '/fees/my')).map((k) => ({ student: k.full_name, class: k.class_label, summary: k.summary })),
  },
];
