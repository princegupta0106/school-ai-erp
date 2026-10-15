// ---------------------------------------------------------------------------------------------
// AUDIT LOGS - one place that records everything that happens in the portal.
//
//  * `auditMiddleware` is mounted once in index.js. After every request finishes it writes a row
//    to `audit_logs`: who (actor), which school, what (readable sentence), the target, the result
//    (success / failed + status), IP, and a sanitised copy of what was sent.
//  * Every change (POST / PUT / PATCH / DELETE) is logged - successful or not (a refused or failed
//    attempt is recorded too). Sign-ins (and failed sign-ins) are logged. A few sensitive READS
//    (receipts, payslips, a user's profile, a student's fee account...) are logged as kind "view".
//  * Passwords, tokens, salary values and message text are never stored.
//  * A new route is logged automatically even if it is not listed in RULES below (with a generic
//    sentence); add a rule only to get a nicer sentence.
//  * Logging can never break a request: failures are printed to the console and swallowed.
// ---------------------------------------------------------------------------------------------
import { db } from './db.js';
import { cfg } from './config.js';

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID.test(v);

export const AUDIT_MODULES = {
  auth: 'Sign-in & account', school: 'School', users: 'Users', attendance: 'Attendance', visitors: 'Visitors',
  fees: 'Fees', communication: 'Communication', academics: 'Academics', homework: 'Homework', documents: 'Documents', payroll: 'Payroll & Leave', ai: 'AI assistant', audit: 'Audit logs', system: 'Other',
};

// ---- readable names for the thing that was touched: [table, column that holds its name] ----------
const NAMED = {
  class: ['classes', 'name'], session: ['academic_sessions', 'name'], holiday: ['holidays', 'title'],
  subject: ['subjects', 'name'], exam: ['exams', 'name'], assessment: ['assessments', 'title'],
  visitor: ['visitors', 'name'], announcement: ['announcements', 'title'], fee_item: ['fee_items', 'name'],
  leave_type: ['leave_types', 'name'], assignment: ['assignments', 'title'],
};

// ---- rules: how to describe each route -----------------------------------------------------------
// R(method, '/path/:id', action, summary, { entity, kind })  - action / summary / kind may be functions of c.
// c = { body, q, p: [path params], label (name of the target), res (response body) }
const R = (method, pattern, action, summary, opts = {}) =>
  ({ method, re: new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}/?$`), action, summary, ...opts });
const nm = (c) => c.label || c.body?.name || c.body?.title || c.res?.name || c.res?.title || '';
const q = (s) => (s ? ` "${s}"` : '');
const money = (n) => (Number.isFinite(Number(n)) ? `Rs ${Number(n).toLocaleString('en-IN')}` : '');
const day = (c) => c.body?.date || c.q?.date || '';

const RULES = [
  // ---- sign-in & account
  R('POST', '/auth/login', 'auth.login', 'Signed in', { kind: 'auth', onlyIfSet: true }),
  R('POST', '/auth/logout', 'auth.logout', 'Signed out', { kind: 'auth' }),
  R('PUT', '/auth/prefs', 'auth.prefs', 'Updated own home-screen settings', { kind: 'auth' }),
  R('POST', '/auth/change-password', 'auth.password_change', 'Changed own password', { kind: 'auth' }),

  // ---- school
  R('POST', '/schools', 'school.create', (c) => `Created school${q(nm(c))} and its first admin`, { entity: 'school' }),
  R('PATCH', '/schools/:id', 'school.update',
    (c) => (c.body.is_active === false ? `Turned OFF school${q(nm(c))}` : c.body.is_active === true ? `Turned ON school${q(nm(c))}` : `Edited school${q(nm(c))}`), { entity: 'school' }),
  R('POST', '/schools/:id/promote', (c) => (c.body.dry_run === false ? 'school.promote' : 'school.promote_preview'),
    (c) => (c.body.dry_run === false ? `Ended the session and promoted students${q(c.body.new_session?.name ? `new session ${c.body.new_session.name}` : '')}` : 'Previewed year-end promotion'),
    { entity: 'school', kind: (c) => (c.body.dry_run === false ? 'change' : 'view') }),
  R('POST', '/calendar/sessions', 'school.session.create', (c) => `Added session${q(nm(c))}`, { entity: 'session' }),
  R('PATCH', '/calendar/sessions/:id', 'school.session.update', (c) => `Edited session${q(nm(c))}`, { entity: 'session' }),
  R('DELETE', '/calendar/sessions/:id', 'school.session.delete', (c) => `Deleted session${q(nm(c))}`, { entity: 'session' }),
  R('POST', '/calendar/holidays', 'school.holiday.create', (c) => `Added holiday${q(nm(c))}`, { entity: 'holiday' }),
  R('PATCH', '/calendar/holidays/:id', 'school.holiday.update', (c) => `Edited holiday${q(nm(c))}`, { entity: 'holiday' }),
  R('DELETE', '/calendar/holidays/:id', 'school.holiday.delete', (c) => `Deleted holiday${q(nm(c))}`, { entity: 'holiday' }),

  // ---- users & classes
  R('POST', '/users', 'users.create', (c) => `Created ${String(c.body.role || 'user').replace('_', ' ')} account${q(c.body.full_name || c.body.login_id)}`, { entity: 'user' }),
  R('GET', '/users/:id', 'users.view', (c) => `Opened the profile of${q(c.label) || ' a user'}`, { entity: 'user', kind: 'view' }),
  R('PATCH', '/users/:id', 'users.update', (c) => `Edited profile of${q(c.label) || ' a user'}${c.body.is_active === false ? ' (account turned OFF)' : c.body.is_active === true ? ' (account turned ON)' : ''}`, { entity: 'user' }),
  R('PUT', '/users/:id/children', 'users.children_set', (c) => `Changed the students linked to parent${q(c.label)}`, { entity: 'user' }),
  R('DELETE', '/users/:id', 'users.delete', (c) => `Deleted user${q(c.label)}`, { entity: 'user' }),
  R('POST', '/users/:id/reset-password', 'users.reset_password', (c) => `Reset the password of${q(c.label) || ' a user'}`, { entity: 'user' }),
  R('PATCH', '/users/:id/role', 'users.role_change', (c) => `Changed role of${q(c.label) || ' a user'} to ${String(c.body.role || '?').replace('_', ' ')}`, { entity: 'user' }),
  R('PATCH', '/users/:id/features', 'users.features_change', (c) => `Changed feature access of${q(c.label) || ' a user'}`, { entity: 'user' }),
  R('POST', '/users/:id/documents', 'users.document_upload', (c) => `Uploaded a document for${q(c.label) || ' a user'}`, { entity: 'user' }),
  R('DELETE', '/users/:id/documents/:docId', 'users.document_delete', (c) => `Removed a document of${q(c.label) || ' a user'}`, { entity: 'user' }),
  R('POST', '/classes', 'users.class.create', (c) => `Added class${q([nm(c), c.body.section].filter(Boolean).join(' '))}`, { entity: 'class' }),
  R('PATCH', '/classes/:id', 'users.class.update', (c) => `Edited class${q(nm(c))}`, { entity: 'class' }),
  R('DELETE', '/classes/:id', 'users.class.delete', (c) => `Deleted class${q(nm(c))}`, { entity: 'class' }),

  // ---- attendance
  R('PUT', '/attendance/sheet', 'attendance.mark', (c) => `Saved attendance${day(c) ? ` of ${day(c)}` : ''} (${Array.isArray(c.body.records) ? c.body.records.length : '?'} students)`, { entity: 'class' }),
  R('PUT', '/attendance/classes/:id/teachers', 'attendance.class_teachers', () => 'Changed the teachers of a class', { entity: 'class' }),
  R('PUT', '/attendance/rolls', 'attendance.rolls_save', () => 'Saved roll numbers'),
  R('POST', '/attendance/rolls/auto', 'attendance.rolls_auto', () => 'Auto-assigned roll numbers'),
  R('GET', '/attendance/reports/student/:id', 'attendance.student_report', () => 'Viewed a student\'s attendance report', { entity: 'user', kind: 'view' }),

  // ---- visitors
  R('POST', '/visitors', 'visitors.add', (c) => `Added visitor${q(nm(c))}`, { entity: 'visitor' }),
  R('DELETE', '/visitors/:id', 'visitors.delete', (c) => `Deleted visitor entry${q(nm(c))}`, { entity: 'visitor' }),

  // ---- communication (message text is never stored)
  R('POST', '/communication/announcements', 'communication.notice.post', (c) => `Posted notice${q(nm(c))}`, { entity: 'announcement' }),
  R('PATCH', '/communication/announcements/:id', 'communication.notice.update', (c) => `Edited notice${q(nm(c))}`, { entity: 'announcement' }),
  R('DELETE', '/communication/announcements/:id', 'communication.notice.delete', (c) => `Deleted notice${q(nm(c))}`, { entity: 'announcement' }),
  R('POST', '/communication/conversations', 'communication.chat_start', () => 'Started a chat'),
  R('POST', '/communication/conversations/:id/messages', 'communication.message_send', () => 'Sent a message', { entity: 'conversation' }),

  // ---- fees
  R('POST', '/fees/structure/items', 'fees.structure.create', (c) => `Added fee${q(nm(c))}${c.body.class_name ? ` for class ${c.body.class_name}` : ''}`, { entity: 'fee_item' }),
  R('PATCH', '/fees/structure/items/:id', 'fees.structure.update', (c) => `Edited fee${q(nm(c))}`, { entity: 'fee_item' }),
  R('DELETE', '/fees/structure/items/:id', 'fees.structure.delete', (c) => `Deleted fee${q(nm(c))}`, { entity: 'fee_item' }),
  R('POST', '/fees/structure/copy', 'fees.structure.copy', () => 'Copied the fee structure from another session'),
  R('GET', '/fees/students/:id', 'fees.student_view', (c) => `Opened the fee account of${q(c.label) || ' a student'}`, { entity: 'user', kind: 'view' }),
  R('POST', '/fees/students/:id/payments', 'fees.payment.collect',
    (c) => `Collected ${money(c.body.amount)}${c.res?.payment?.receipt_no ? ` (receipt ${c.res.payment.receipt_no})` : ''} from${q(c.label) || ' a student'}`, { entity: 'user' }),
  R('POST', '/fees/students/:id/adjustments', 'fees.adjustment.add', (c) => `Added a fee adjustment of ${money(c.body.amount)} for${q(c.label) || ' a student'}`, { entity: 'user' }),
  R('POST', '/fees/adjustments/:id/void', 'fees.adjustment.void', () => 'Removed a fee adjustment', { entity: 'fee_adjustment' }),
  R('POST', '/fees/payments/:id/cancel', 'fees.payment.cancel', (c) => `Cancelled a fee payment${c.body.reason ? ` - ${c.body.reason}` : ''}`, { entity: 'fee_payment' }),
  R('GET', '/fees/payments/:id/receipt', 'fees.receipt_download', () => 'Downloaded a fee receipt', { entity: 'fee_payment', kind: 'view' }),

  // ---- homework
  R('POST', '/homework/assignments', 'homework.assignment.create', (c) => `Posted homework / assignment${q(nm(c))}`, { entity: 'assignment' }),
  R('DELETE', '/homework/assignments/:id', 'homework.assignment.delete', () => 'Deleted homework / assignment', { entity: 'assignment' }),
  R('PATCH', '/homework/submissions/:id', 'homework.submission.check', () => 'Checked a submission', { entity: 'submission' }),
  R('POST', '/homework/my/:id/submit', 'homework.submit', () => 'Submitted an assignment', { entity: 'assignment' }),
  // ---- academics
  R('POST', '/academics/subjects', 'academics.subject.create', (c) => `Added subject${q(nm(c))}`, { entity: 'subject' }),
  R('PATCH', '/academics/subjects/:id', 'academics.subject.update', (c) => `Edited subject${q(nm(c))}`, { entity: 'subject' }),
  R('DELETE', '/academics/subjects/:id', 'academics.subject.delete', (c) => `Deleted subject${q(nm(c))}`, { entity: 'subject' }),
  R('POST', '/academics/exams', 'academics.exam.create', (c) => `Created exam${q(nm(c))}`, { entity: 'exam' }),
  R('PATCH', '/academics/exams/:id', 'academics.exam.update', (c) => `Edited exam${q(nm(c))}`, { entity: 'exam' }),
  R('DELETE', '/academics/exams/:id', 'academics.exam.delete', (c) => `Deleted exam${q(nm(c))}`, { entity: 'exam' }),
  R('POST', '/academics/assessments', 'academics.assessment.create', (c) => `Created ${c.body.kind === 'exam' ? 'exam paper' : 'test'}${q(nm(c))}`, { entity: 'assessment' }),
  R('PATCH', '/academics/assessments/:id', 'academics.assessment.update', (c) => `Edited test / exam paper${q(nm(c))}`, { entity: 'assessment' }),
  R('DELETE', '/academics/assessments/:id', 'academics.assessment.delete', (c) => `Deleted test / exam paper${q(nm(c))}`, { entity: 'assessment' }),
  R('PUT', '/academics/assessments/:id/marks', 'academics.marks_save', (c) => `Saved marks${q(c.label)}`, { entity: 'assessment' }),
  R('GET', '/academics/reports/student/:id', 'academics.student_report', () => 'Viewed a student\'s academic report', { entity: 'user', kind: 'view' }),

  // ---- documents (certificates & report cards)
  R('PUT', '/documents/settings', 'documents.letterhead_save', () => 'Changed the school letterhead'),
  R('POST', '/documents/images', 'documents.image_upload', (c) => `Uploaded a letterhead / design image${q(c.body?.kind)}`),
  R('PUT', '/documents/templates/:type', 'documents.template_save', (c) => `Changed the wording / design of the${q(c.p?.[0])} template`, { entity: 'doc_template' }),
  R('DELETE', '/documents/templates/:type', 'documents.template_reset', (c) => `Reset the${q(c.p?.[0])} template to the default`, { entity: 'doc_template' }),
  R('POST', '/documents/issue', 'documents.issue', (c) => `Issued ${c.res?.title || c.body?.doc_type || 'a document'}${c.res?.serial_no ? ` (${c.res.serial_no})` : ''}${c.res?.subject_name ? ` to ${c.res.subject_name}` : ''}`, { entity: 'issued_document' }),
  R('POST', '/documents/issued/:id/cancel', 'documents.cancel', (c) => `Cancelled an issued document${c.body?.reason ? ` (${c.body.reason})` : ''}`, { entity: 'issued_document' }),
  R('GET', '/documents/issued/:id', 'documents.view', () => 'Opened an issued document', { entity: 'issued_document', kind: 'view' }),

  // ---- payroll & leave
  R('PUT', '/payroll/settings', 'payroll.settings', () => 'Changed leave & pay rules'),
  R('POST', '/payroll/leave-types', 'payroll.leave_type.create', (c) => `Added leave type${q(nm(c))}`, { entity: 'leave_type' }),
  R('PATCH', '/payroll/leave-types/:id', 'payroll.leave_type.update', (c) => `Edited leave type${q(nm(c))}`, { entity: 'leave_type' }),
  R('POST', '/payroll/leave', 'payroll.leave.apply', (c) => `${c.body.user_id ? 'Recorded leave on behalf of someone' : 'Applied for leave'}${c.body.start_date ? ` (${c.body.start_date}${c.body.end_date && c.body.end_date !== c.body.start_date ? ` to ${c.body.end_date}` : ''})` : ''}`, { entity: 'leave_request' }),
  R('POST', '/payroll/leave/:id/approve', 'payroll.leave.approve', () => 'Approved a leave request', { entity: 'leave_request' }),
  R('POST', '/payroll/leave/:id/reject', 'payroll.leave.reject', () => 'Rejected a leave request', { entity: 'leave_request' }),
  R('POST', '/payroll/leave/:id/cancel', 'payroll.leave.cancel', () => 'Cancelled a leave request', { entity: 'leave_request' }),
  R('GET', '/payroll/ledger/:id', 'payroll.ledger_view', () => 'Viewed a leave ledger', { entity: 'user', kind: 'view' }),
  R('POST', '/payroll/grants', 'payroll.grant', () => 'Granted / adjusted leave balances'),
  R('POST', '/payroll/payslips/generate', 'payroll.payslips_generate', (c) => `Prepared payroll${c.body.period ? ` for ${c.body.period}` : ''}`),
  R('POST', '/payroll/payslips/finalize-all', 'payroll.payslips_finalize_all', (c) => `Finalized all payslips${c.body.period ? ` of ${c.body.period}` : ''}`),
  R('POST', '/payroll/payslips/pay-all', 'payroll.payslips_pay_all', (c) => `Marked all payslips as paid${c.body.period ? ` for ${c.body.period}` : ''}`),
  R('POST', '/payroll/payslips/:id/finalize', 'payroll.payslip.finalize', () => 'Finalized a payslip', { entity: 'payslip' }),
  R('POST', '/payroll/payslips/:id/pay', 'payroll.payslip.pay', () => 'Marked a payslip as paid', { entity: 'payslip' }),
  R('POST', '/payroll/payslips/:id/reopen', 'payroll.payslip.reopen', () => 'Re-opened a payslip', { entity: 'payslip' }),
  R('GET', '/payroll/payslips/:id', 'payroll.payslip_view', () => 'Viewed a payslip', { entity: 'payslip', kind: 'view' }),
  R('POST', '/payroll/adjustments', 'payroll.adjustment.add', (c) => `Added a payroll ${c.body.kind || 'adjustment'}${q(c.body.label)} of ${money(c.body.amount)}`, { entity: 'payroll_adjustment' }),
  R('DELETE', '/payroll/adjustments/:id', 'payroll.adjustment.remove', () => 'Removed a payroll adjustment', { entity: 'payroll_adjustment' }),

  // ---- AI assistant (what it asked the portal to do is logged as the normal action, tagged "via AI assistant")
  R('POST', '/ai/chat', 'ai.chat', () => 'Sent a message to the AI assistant'),
  R('POST', '/ai/confirm', 'ai.confirm', (c) => 'Confirmed an action proposed by the AI assistant'),
  R('POST', '/ai/cancel', 'ai.cancel', () => 'Cancelled an action proposed by the AI assistant'),

  // ---- audit logs themselves (only exporting is recorded; browsing the log is not)
  R('POST', '/audit/navigate', 'audit.navigate', () => 'Opened a page', { kind: 'view' }),
  R('GET', '/audit/export', 'audit.export', () => 'Exported the audit log to CSV', { kind: 'view' }),
];

const findRule = (method, path) => RULES.find((r) => r.method === method && r.re.test(path));
const call = (v, c) => (typeof v === 'function' ? v(c) : v);

// ---- sanitising what gets stored -----------------------------------------------------------------
const SECRET_KEY = /pass(word)?|token|secret|hash|authorization/i;
const TEXT_KEY = /^(body|text|content|message)$/i;

export function sanitize(v, { path = '', depth = 0, key = '' } = {}) {
  if (v === null || v === undefined) return v;
  if (SECRET_KEY.test(key)) return '[hidden]';
  if (key === 'salary') return '[hidden]';
  if (TEXT_KEY.test(key) && ((path.includes('/communication/conversations') || path.startsWith('/ai/')))) return '[message text not stored]';
  if (typeof v === 'string') return v.length > 300 ? `${v.slice(0, 300)}...` : v;
  if (typeof v !== 'object') return v;
  if (depth >= 4) return '[...]';
  if (Array.isArray(v)) {
    if (v.length > 10) return { _items: v.length, first: v.slice(0, 3).map((x) => sanitize(x, { path, depth: depth + 1 })) };
    return v.map((x) => sanitize(x, { path, depth: depth + 1 }));
  }
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = sanitize(val, { path, depth: depth + 1, key: k });
  return out;
}

const capped = (obj) => {
  const s = JSON.stringify(obj);
  return s.length <= 4000 ? obj : { _truncated: true, size: s.length, keys: Object.keys(obj) };
};

// ---- who / where helpers --------------------------------------------------------------------------
const schoolNames = new Map();
async function schoolName(id) {
  if (!id) return null;
  if (schoolNames.has(id)) return schoolNames.get(id);
  const { data } = await db.from('schools').select('name').eq('id', id).maybeSingle();
  if (data?.name) schoolNames.set(id, data.name);
  return data?.name || null;
}

// look the touched thing up (readable name + the school it belongs to)
async function lookup(entity, id) {
  if (!entity || !isUuid(id)) return null;
  try {
    if (entity === 'user') {
      const { data } = await db.from('users').select('login_id,school_id,profiles(full_name)').eq('user_id', id).maybeSingle();
      if (!data) return null;
      const p = Array.isArray(data.profiles) ? data.profiles[0] : data.profiles;
      return { label: p?.full_name ? `${p.full_name} (${data.login_id})` : data.login_id, school_id: data.school_id };
    }
    if (entity === 'school') {
      const { data } = await db.from('schools').select('name').eq('id', id).maybeSingle();
      return data ? { label: data.name, school_id: id } : null;
    }
    if (NAMED[entity]) {
      const [table, col] = NAMED[entity];
      const { data } = await db.from(table).select(`school_id,${col}`).eq('id', id).maybeSingle();
      return data ? { label: data[col], school_id: data.school_id } : null;
    }
    if (entity === 'assessment') return null;
  } catch { /* labels are a nicety */ }
  return null;
}

const firstId = (...vals) => vals.find(isUuid) || null;

export async function writeLog(entry) {
  try {
    const { error } = await db.from('audit_logs').insert(entry);
    if (error) console.error('[audit] could not save log:', error.message);
  } catch (e) { console.error('[audit] could not save log:', e.message); }
}

// Routes can add details / override who did it: setAudit(req, { action, summary, kind, user, school_id, detail, ... })
export const setAudit = (req, o) => { req.audit = { ...(req.audit || {}), ...o }; };

// ---- the middleware --------------------------------------------------------------------------------
export function auditMiddleware(req, res, next) {
  const started = Date.now();
  const path = req.originalUrl.split('?')[0].replace(/^\/api/, '') || '/';
  const rule = findRule(req.method, path);
  const isWrite = WRITE.has(req.method);
  if (!isWrite && !rule) return next();            // plain reads are not logged
  if (!isWrite && rule.kind !== 'view' && typeof rule.kind !== 'function') return next();

  const params = rule ? (rule.re.exec(path) || []).slice(1) : [];
  if (!isWrite && params[0] && !isUuid(params[0])) return next();  // e.g. GET /users/my-children is not "a profile"
  const entityId = params[0];
  const pre = rule?.entity && isUuid(entityId) ? lookup(rule.entity, entityId) : null; // started now, read at the end

  // keep the response body (ids / names) for the log
  const json = res.json.bind(res);
  res.json = (b) => { res.locals.auditBody = b; return json(b); };

  res.on('finish', () => {
    buildEntry({ req, res, path, rule, params, pre, ms: Date.now() - started })
      .then((e) => e && writeLog(e))
      .catch((e) => console.error('[audit]', e.message));
  });

  // a DELETE removes the row, so read its name BEFORE the route runs
  if (req.method === 'DELETE' && pre) pre.then(() => next(), () => next());
  else next();
}

async function buildEntry({ req, res, path, rule, params, pre, ms }) {
  const o = req.audit || {};
  if (rule?.onlyIfSet && !o.action) return null;                  // e.g. rate-limited login: nothing to say
  const user = o.user || req.user || null;
  const status = res.statusCode;
  if (!user && !o.action && status === 401) return null;          // unauthenticated noise
  if (status === 404 && !rule) return null;                       // unknown URL

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const target = (await pre?.catch(() => null)) || null;
  const resBody = res.locals.auditBody && typeof res.locals.auditBody === 'object' ? res.locals.auditBody : null;
  const c = { body, q: req.query || {}, p: params, label: o.entity_label || target?.label || '', res: resBody };

  const seg = path.split('/')[1] || 'system';
  const fallbackModule = { schools: 'school', calendar: 'school', classes: 'users' }[seg] || seg;
  const action = o.action || (rule ? call(rule.action, c) : `${fallbackModule}.${req.method.toLowerCase()}`);
  const module = AUDIT_MODULES[action.split('.')[0]] ? action.split('.')[0] : (AUDIT_MODULES[fallbackModule] ? fallbackModule : 'system');
  const kind = o.kind || (rule ? call(rule.kind, c) : null) || (WRITE.has(req.method) ? 'change' : 'view');
  let summary = o.summary || (rule ? call(rule.summary, c) : `${req.method} ${path}`);
  const ok = status < 400;

  // which school does this belong to? (a school admin's action belongs to their school;
  // a super admin's action belongs to the school they worked on)
  const own = user && user.role !== 'super_admin' ? user.school_id : null;
  const school_id = firstId(
    o.school_id, own,
    rule?.entity === 'school' ? params[0] : null, target?.school_id,
    req.query?.school_id, body.school_id, resBody?.school?.id, resBody?.school_id,
  );

  const entityId = firstId(params[0], resBody?.id, resBody?.user_id, resBody?.school?.id, resBody?.payment?.id) || (params[0] || null);
  const detail = { ...(o.detail || {}) };
  if (WRITE.has(req.method) && !action.endsWith('.open_view') && !action.endsWith('.open_module')) {
    const sent = sanitize(body, { path });
    if (Object.keys(sent).length) detail.request = sent;
    if (req.file) detail.file = { name: req.file.originalname, size: req.file.size, type: req.file.mimetype };
  }
  if (Object.keys(req.query || {}).length) detail.query = sanitize(req.query, { path });
  if (req.headers['x-via'] === 'ai-assistant') { detail.via = 'ai-assistant'; summary = `${summary} (via AI assistant)`; }
  if (!ok) detail.error = res.locals.errorMessage || `HTTP ${status}`;
  if (!ok && !o.summary) summary = `FAILED: ${summary}`;

  return {
    school_id, school_name: await schoolName(school_id),
    actor_id: user?.user_id || null,
    actor_login: user?.login_id || o.actor_login || null,
    actor_name: user?.profile?.full_name || o.actor_name || null,
    actor_role: user?.role || null,
    module, action, kind, summary: String(summary).slice(0, 400),
    entity_type: rule?.entity || null, entity_id: entityId, entity_label: c.label || nm(c) || body.full_name || null,
    success: ok, status_code: status, method: req.method, path: path.slice(0, 300),
    ip: req.ip || null, user_agent: String(req.headers['user-agent'] || '').slice(0, 250) || null,
    duration_ms: ms, detail: capped(detail),
  };
}

// ---- reading: used by routes/audit.js ----------------------------------------------------------------
function tzOffsetMs(ts, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}
// start of a school-local calendar day (YYYY-MM-DD) as an ISO instant
export function dayStart(d, plusDays = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return null;
  const guess = Date.parse(`${d}T00:00:00Z`) + plusDays * 86400000;
  if (Number.isNaN(guess)) return null;
  return new Date(guess - tzOffsetMs(guess, cfg.timezone)).toISOString();
}
