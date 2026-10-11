// Offline smoke test of the AI layer: no Gemini, no database, no server needed.
//   cd server && node test/ai-smoke.mjs
process.env.AUTH_SECRET = 'x'; process.env.SUPABASE_URL = 'http://localhost:1'; process.env.SUPABASE_SECRET_KEY = 'x';
process.env.GEMINI_API_KEY = 'fake'; process.env.PORT = '3999';
import assert from 'node:assert/strict';

const calls = []; let geminiScript = [];
globalThis.fetch = async (url, opts = {}) => {
  const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  if (String(url).includes('generativelanguage')) return json(geminiScript.shift());
  const path = String(url).replace('http://127.0.0.1:3999/api', ''); const method = opts.method;
  calls.push({ method, path, body: opts.body ? JSON.parse(opts.body) : undefined, via: opts.headers['x-via'] });
  if (path === '/payroll/settings') return json({ settings: {}, types: [{ id: 't1', name: 'Casual Leave', is_paid: true, annual_quota: 12, is_active: true }, { id: 't2', name: 'Sick Leave', is_paid: true, annual_quota: 8, is_active: true }] });
  if (path === '/payroll/me') return json({ types: [], balances: [{ type_id: 't1', name: 'Casual Leave', balance: 5, pending: 0 }, { type_id: 't2', name: 'Sick Leave', balance: 0, pending: 0 }], requests: [] });
  if (path === '/payroll/leave' && method === 'POST') return json({ id: 'r1', start_date: JSON.parse(opts.body).start_date, end_date: JSON.parse(opts.body).end_date, days: 1, status: 'pending', half_day: false }, 201);
  if (path === '/payroll/employees') return json([{ user_id: 'u9', full_name: 'Anita Rao', login_id: 'anita' }]);
  if (path === '/schools' && method === 'GET') return json([{ id: 's1', name: 'Sunrise Public School', code: 'sunrise' }]);
  if (path === '/schools' && method === 'POST') { const b = JSON.parse(opts.body); return json({ school: { name: b.name, code: b.code }, admin: { login_id: b.admin.login_id } }, 201); }
  if (path === '/classes') return json([{ id: 'c1', school_id: 's1', name: '5', section: 'A' }]);
  if (path === '/users' && method === 'POST') { const b = JSON.parse(opts.body); if (b.login_id === 'taken.user') return json({ error: 'That value is already taken' }, 409); return json({ user_id: 'n1', role: b.role, login_id: b.login_id, profile: { full_name: b.profile.full_name } }, 201); }
  if (path.startsWith('/attendance/classes')) return json({ date: '2026-10-11', classes: [{ id: 'c1', name: '5', section: 'A' }] });
  if (path.startsWith('/attendance/sheet') && method === 'GET') return json({ date: '2026-10-11', can_edit: true, students: [{ student_id: 'a1', full_name: 'Aman Verma', roll_no: 3, status: null }, { student_id: 'a2', full_name: 'Riya Shah', roll_no: 7, status: null }, { student_id: 'a3', full_name: 'Karan Mehta', roll_no: 9, status: null }] });
  if (path === '/attendance/sheet' && method === 'PUT') return json({ saved: 3, unchanged: 0, date: '2026-10-11' });
  if (path.startsWith('/fees/students?')) return json([{ student_id: 'a1', full_name: 'Aman Verma', login_id: 'aman.verma', class_label: '5 A', roll_no: 3 }]);
  if (path.startsWith('/fees/students/a1') && method === 'GET') return json({ student: { full_name: 'Aman Verma', class_label: '5 A' }, session: { name: '2026-2027' }, today: '2026-10-11', ledger: { totals: { total: 24000, paid: 6000, pending: 18000 }, lines: [] }, payments: [], adjustments: [], items: [{ id: 'i1', name: 'Tuition' }], has_structure: true });
  if (path === '/fees/students/a1/payments' && method === 'POST') return json({ payment: { receipt_no: 'RCP-000001', amount: 5000 }, account: { ledger: { totals: { pending: 13000 } } } }, 201);
  if (path === '/payroll/grants') return json({ done: 1, skipped: 0 });
  return json({ error: `unmocked ${method} ${path}` }, 404);
};
const { chat, resolvePending } = await import('../src/ai/chat.js');
const { visibleTools, runTool, makeCtx } = await import('../src/ai/registry.js');
const { todayIn } = await import('../src/ai/tools-leave.js');

const teacher = { user_id: 'u1', login_id: 't1', role: 'staff', features: ['my_leave', 'use_assistant'], profile: { full_name: 'Ravi Kumar', designation: 'Maths Teacher' } };
const hr = { user_id: 'u2', login_id: 'hr', role: 'staff', features: ['my_leave', 'leave_grant', 'use_assistant'], profile: { full_name: 'HR' } };
const fn = (name, args) => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }] });
const say = (t) => ({ candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] });

// 1. visibility is permission-based
assert.ok(visibleTools(teacher).some((t) => t.name === 'apply_leave'));
assert.ok(!visibleTools(teacher).some((t) => t.name === 'grant_leave'), 'teacher must not see grant_leave');
assert.ok(visibleTools(hr).some((t) => t.name === 'grant_leave'));
assert.deepEqual(visibleTools({ ...teacher, features: ['my_leave'] }), [], 'no use_assistant -> no tools');

// 2. a tool that is not visible cannot be run even if the model asks for it
const denied = await runTool(makeCtx(teacher, 'tok'), 'grant_leave', {});
assert.equal(denied.ok, false); assert.equal(denied.status, 403);

// 3. "apply leave for today" -> defaults filled, API called with the user's token, tagged as AI
geminiScript = [fn('apply_leave', { start_date: 'today' }), say('Applied for today.')];
const r1 = await chat(teacher, 'tok', null, 'apply leave for today');
assert.equal(r1.reply, 'Applied for today.');
const post = calls.find((c) => c.method === 'POST' && c.path === '/payroll/leave');
assert.equal(post.body.start_date, todayIn()); assert.equal(post.body.end_date, todayIn());
assert.equal(post.body.leave_type_id, 't1'); assert.equal(post.body.reason, 'Personal reasons'); assert.equal(post.via, 'ai-assistant');
assert.equal(r1.actions[0].ok, true);

// 4. risky tool -> pending card first, nothing executed until Confirm
calls.length = 0;
geminiScript = [fn('grant_leave', { employee_name: 'anita', leave_type: 'casual', days: 2, note: 'extra' }), say('Please confirm.')];
const r2 = await chat(hr, 'tok', null, 'give anita 2 casual days');
assert.equal(r2.pending.length, 1);
assert.ok(!calls.some((c) => c.path === '/payroll/grants'), 'must not run before confirm');
geminiScript = [say('Granted 2 days.')];
const r3 = await resolvePending(hr, 'tok', r2.pending[0].id, true);
assert.ok(calls.some((c) => c.path === '/payroll/grants' && c.body.user_ids[0] === 'u9'));
assert.equal(r3.actions[0].ok, true);
// a pending action is single-use and bound to the person
await assert.rejects(() => resolvePending(hr, 'tok', r2.pending[0].id, true));
geminiScript = [fn('grant_leave', { employee_name: 'anita', leave_type: 'casual', days: 1, note: 'x' }), say('confirm?')];
const r4 = await chat(hr, 'tok', null, 'again');
await assert.rejects(() => resolvePending(teacher, 'tok', r4.pending[0].id, true), 'someone else cannot confirm');

// 5. bad API result goes back to the model as an error, not a crash
calls.length = 0;
geminiScript = [fn('cancel_my_leave', { date: 'today' }), say('You have nothing to cancel.')];
const r5 = await chat(teacher, 'tok', null, 'cancel my leave');
assert.equal(r5.actions[0].ok, false);
// 6. super admin: create a school (backend would refuse anyone else) - login id + password made automatically
const sa = { user_id: 'u0', login_id: 'root', role: 'super_admin', features: ['use_assistant', 'create_school', 'create_user', 'get_school'], profile: { full_name: 'Root' } };
calls.length = 0;
geminiScript = [fn('create_school', { name: 'Green Valley School', admin_name: 'Meena Joshi' }), say('Created.')];
await chat(sa, 'tok', null, 'create a new school Green Valley, admin Meena Joshi');
const sc = calls.find((c) => c.method === 'POST' && c.path === '/schools');
assert.equal(sc.body.code, 'green-valley-school'); assert.equal(sc.body.admin.login_id, 'meena.joshi'); assert.ok(sc.body.admin.password.length >= 6);
// teacher has no create_school tool
assert.ok(!visibleTools(teacher).some((t) => ['create_school', 'create_user'].includes(t.name)));

// 7. create a student: class "5 A" resolved to its id, school by name, login id from the name
calls.length = 0;
geminiScript = [fn('create_user', { full_name: 'Aman Verma', role: 'student', class_name: '5 A', school: 'sunrise', father_name: 'R Verma' }), say('Done.')];
await chat(sa, 'tok', null, 'add student Aman Verma class 5A in Sunrise');
const cu = calls.find((c) => c.method === 'POST' && c.path === '/users');
assert.equal(cu.body.school_id, 's1'); assert.equal(cu.body.profile.class_id, 'c1'); assert.equal(cu.body.login_id, 'aman.verma'); assert.equal(cu.body.role, 'student');
// 8. attendance: "5A, absent roll 3 and Riya" -> everyone else present, names/rolls matched
calls.length = 0;
const teacher2 = { user_id: 'u5', login_id: 'tt', role: 'staff', features: ['use_assistant', 'mark_attendance'], profile: { full_name: 'T' } };
geminiScript = [fn('mark_attendance', { class_name: '5A', absent: ['3', 'Riya'] }), say('Marked.')];
await chat(teacher2, 'tok', null, 'mark 5A, roll 3 and Riya absent');
const put = calls.find((c) => c.method === 'PUT' && c.path === '/attendance/sheet');
assert.deepEqual(put.body.records.map((r) => r.status), ['absent', 'absent', 'present']);
assert.ok(!visibleTools(teacher2).some((t) => t.name === 'record_fee_payment'));

// 9. fees: payment goes through a Confirm card showing the pending balance; nothing is recorded before Confirm
calls.length = 0;
const clerk = { user_id: 'u6', login_id: 'clerk', role: 'staff', features: ['use_assistant', 'collect_fees'], profile: { full_name: 'Clerk' } };
geminiScript = [fn('record_fee_payment', { student: 'Aman', amount: 5000, mode: 'upi' }), say('Please confirm.')];
const f1 = await chat(clerk, 'tok', null, 'aman paid 5000 by upi');
assert.match(f1.pending[0].details, /Rs 5,000/); assert.match(f1.pending[0].details, /18,000/);
assert.ok(!calls.some((c) => c.path.endsWith('/payments')));
geminiScript = [say('Recorded RCP-000001.')];
await resolvePending(clerk, 'tok', f1.pending[0].id, true);
assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/fees/students/a1/payments' && c.body.amount === '5000' && c.body.mode === 'upi'));
// bad amount is refused before any confirm card exists
geminiScript = [fn('record_fee_payment', { student: 'Aman', amount: -5, mode: 'upi' }), say('Invalid amount.')];
const f2 = await chat(clerk, 'tok', null, 'aman paid -5');
assert.equal(f2.pending.length, 0);

// 10. role-limited tools
const parent = { user_id: 'p1', login_id: 'par', role: 'parent', features: ['use_assistant', 'view_my_fees'], profile: {} };
assert.ok(visibleTools(parent).some((t) => t.name === 'my_attendance'));
assert.ok(!visibleTools(teacher).some((t) => t.name === 'my_attendance'));
console.log('AI smoke test passed');
process.exit(0);
