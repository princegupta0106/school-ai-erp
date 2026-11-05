// Admissions: enquiry -> follow-ups -> application stages -> admit (creates the student). Reports for the funnel.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import { todayStr, validDate } from '../attendance.js';
import { nextLoginId } from '../userIds.js';

const r = Router();
const READ = ['view_enquiries', 'add_enquiry', 'update_enquiry', 'admit_student', 'view_admission_reports'];
const STAGES = ['new', 'contacted', 'follow_up', 'pending_documents', 'shortlisted', 'admitted', 'rejected'];
const STAGE_LABEL = { new: 'New', contacted: 'Contacted', follow_up: 'Follow-up', pending_documents: 'Pending documents', shortlisted: 'Shortlisted', admitted: 'Admitted', rejected: 'Rejected' };
const RANK = { new: 0, contacted: 1, follow_up: 1, pending_documents: 2, shortlisted: 3, admitted: 4 };
const SOURCES = ['online', 'walk_in', 'qr', 'referral', 'phone', 'campaign', 'other'];
const KINDS = ['call', 'whatsapp', 'email', 'visit', 'note'];
const CONTACT_KINDS = ['call', 'whatsapp', 'email', 'visit'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT = 'id,school_id,ref_no,student_name,class_id,gender,dob,parent_name,phone,email,address,locality,source,stage,reached,assigned_to,session_name,notes,missing_docs,next_followup_on,lost_reason,student_user_id,admitted_at,created_by,created_at,updated_at';

const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
const text = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const dateOrNull = (v, what) => (v ? validDate(String(v), what) : null);

async function classMap(school) {
  const { data, error } = await db.from('classes').select('id,name,section,level').eq('school_id', school).order('level', { nullsFirst: false }).order('name').order('section');
  check(error);
  return { list: data, label: new Map(data.map((c) => [c.id, `${c.name}${c.section ? ` ${c.section}` : ''}`])) };
}
async function nameMap(ids) {
  const want = [...new Set(ids.filter(Boolean))];
  if (!want.length) return new Map();
  const { data, error } = await db.from('users').select('user_id,profiles(full_name)').in('user_id', want);
  check(error);
  return new Map(data.map((u) => [u.user_id, (Array.isArray(u.profiles) ? u.profiles[0] : u.profiles)?.full_name || null]));
}
const shape = (row, classes, names) => ({ ...row, class_name: classes.get(row.class_id) || null, assigned_name: names.get(row.assigned_to) || null });

async function load(req, id) {
  if (!UUID.test(id)) throw httpError(404, 'Enquiry not found');
  let q = db.from('admission_enquiries').select(SELECT).eq('id', id);
  if (!isSuper(req)) q = q.eq('school_id', req.user.school_id);
  const { data, error } = await q.maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Enquiry not found');
  return data;
}
async function log(school_id, enquiry_id, kind, note, stage, by) {
  check((await db.from('admission_activity').insert({ school_id, enquiry_id, kind, note: note || null, stage: stage || null, created_by: by })).error);
}

// ---- meta: what the forms need (classes, staff to assign, labels)
r.get('/meta', requireFeature(...READ), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const { list } = await classMap(school);
  const { data: staff, error } = await db.from('users').select('user_id,role,profiles(full_name)').eq('school_id', school).eq('is_active', true).in('role', ['staff', 'school_admin', 'other']);
  check(error);
  const { data: ses } = await db.from('academic_sessions').select('name').eq('school_id', school).eq('is_current', true).maybeSingle();
  res.json({
    today: todayStr(), session: ses?.name || null, classes: list,
    stages: STAGES.map((k) => ({ key: k, label: STAGE_LABEL[k] })), sources: SOURCES,
    staff: staff.map((u) => ({ user_id: u.user_id, role: u.role, name: (Array.isArray(u.profiles) ? u.profiles[0] : u.profiles)?.full_name || 'Unnamed' })).sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

// ---- summary: numbers for the overview and reports
r.get('/summary', requireFeature('view_enquiries', 'view_admission_reports'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const today = todayStr();
  const { data: rows, error } = await db.from('admission_enquiries').select('id,student_name,class_id,phone,source,stage,reached,assigned_to,locality,lost_reason,next_followup_on,created_at,admitted_at,notes').eq('school_id', school).limit(10000);
  check(error);
  const classes = (await classMap(school)).label;
  const mkey = (iso) => String(iso).slice(0, 7);
  const now = new Date(`${today}T00:00:00Z`);
  const thisM = today.slice(0, 7);
  const lastM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));
  const created = { this: 0, last: 0 }; const admitted = { this: 0, last: 0 };
  const src = {}; const drop = {}; const loc = {};
  const funnel = [0, 0, 0, 0];
  for (const e of rows) {
    byStage[e.stage] += 1;
    if (mkey(e.created_at) === thisM) created.this += 1; else if (mkey(e.created_at) === lastM) created.last += 1;
    if (e.admitted_at) { if (mkey(e.admitted_at) === thisM) admitted.this += 1; else if (mkey(e.admitted_at) === lastM) admitted.last += 1; }
    const s = (src[e.source] ||= { source: e.source, total: 0, admitted: 0 }); s.total += 1; if (e.stage === 'admitted') s.admitted += 1;
    if (e.stage === 'rejected') { const k = e.lost_reason || 'No reason noted'; drop[k] = (drop[k] || 0) + 1; }
    if (e.locality) { const l = (loc[e.locality.toLowerCase()] ||= { locality: e.locality, total: 0, admitted: 0 }); l.total += 1; if (e.stage === 'admitted') l.admitted += 1; }
    funnel[0] += 1; if (e.reached >= 2) funnel[1] += 1; if (e.reached >= 3) funnel[2] += 1; if (e.reached >= 4) funnel[3] += 1;
  }
  const open = rows.filter((e) => !['admitted', 'rejected'].includes(e.stage));
  const due = open.filter((e) => e.next_followup_on && e.next_followup_on <= today).sort((a, b) => a.next_followup_on.localeCompare(b.next_followup_on));
  const names = await nameMap(due.slice(0, 12).map((e) => e.assigned_to));
  res.json({
    today, total: rows.length, by_stage: byStage, created, admitted,
    open: open.length, in_progress: byStage.pending_documents + byStage.shortlisted, awaiting_docs: byStage.pending_documents,
    due_count: due.filter((e) => e.next_followup_on === today).length, overdue_count: due.filter((e) => e.next_followup_on < today).length,
    due: due.slice(0, 12).map((e) => ({ id: e.id, student_name: e.student_name, class_name: classes.get(e.class_id) || null, phone: e.phone, stage: e.stage, next_followup_on: e.next_followup_on, assigned_name: names.get(e.assigned_to) || null, note: e.notes })),
    funnel: [{ key: 'enquiries', label: 'Enquiries', n: funnel[0] }, { key: 'applications', label: 'Applications', n: funnel[1] }, { key: 'shortlisted', label: 'Shortlisted', n: funnel[2] }, { key: 'admitted', label: 'Admitted', n: funnel[3] }],
    sources: Object.values(src).sort((a, b) => b.total - a.total),
    drop_reasons: Object.entries(drop).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n).slice(0, 8),
    localities: Object.values(loc).sort((a, b) => b.total - a.total).slice(0, 8),
  });
}));

// ---- list (filters: q, stage, source, class_id, assigned_to, due=today|overdue)
r.get('/', requireFeature('view_enquiries'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const today = todayStr();
  let q = db.from('admission_enquiries').select(SELECT, { count: 'exact' }).eq('school_id', school).order('created_at', { ascending: false }).limit(400);
  const { stage, source, class_id, assigned_to, due } = req.query;
  if (stage === 'open') q = q.not('stage', 'in', '(admitted,rejected)'); else if (STAGES.includes(stage)) q = q.eq('stage', stage);
  if (SOURCES.includes(source)) q = q.eq('source', source);
  if (UUID.test(class_id || '')) q = q.eq('class_id', class_id);
  if (UUID.test(assigned_to || '')) q = q.eq('assigned_to', assigned_to);
  if (due === 'today') q = q.eq('next_followup_on', today).not('stage', 'in', '(admitted,rejected)');
  if (due === 'overdue') q = q.lt('next_followup_on', today).not('stage', 'in', '(admitted,rejected)');
  const term = String(req.query.q || '').replace(/[^\p{L}\p{N} @.+-]/gu, '').trim().slice(0, 60);
  if (term) q = q.or(`student_name.ilike.%${term}%,parent_name.ilike.%${term}%,phone.ilike.%${term}%`);
  const { data, error, count } = await q;
  check(error);
  const [{ label }, names] = await Promise.all([classMap(school), nameMap(data.map((e) => e.assigned_to))]);
  res.json({ today, total: count ?? data.length, rows: data.map((e) => shape(e, label, names)) });
}));

// ---- one enquiry with its history
r.get('/:id', requireFeature('view_enquiries'), asyncH(async (req, res) => {
  const e = await load(req, req.params.id);
  const { data: acts, error } = await db.from('admission_activity').select('id,kind,note,stage,created_by,created_at').eq('enquiry_id', e.id).order('created_at', { ascending: false }).limit(200);
  check(error);
  const [{ label }, names] = await Promise.all([classMap(e.school_id || req.user.school_id), nameMap([e.assigned_to, ...acts.map((a) => a.created_by)])]);
  res.json({ ...shape(e, label, names), activity: acts.map((a) => ({ ...a, by_name: names.get(a.created_by) || null })) });
}));

function fields(b, partial) {
  const o = {};
  const set = (k, v) => { if (!partial || b[k] !== undefined) o[k] = v; };
  set('student_name', text(b.student_name, 120));
  set('parent_name', text(b.parent_name, 120));
  set('phone', text(b.phone, 20));
  set('email', text(b.email, 120));
  set('address', text(b.address, 300));
  set('locality', text(b.locality, 80));
  set('notes', text(b.notes, 1000));
  set('missing_docs', text(b.missing_docs, 300));
  if (!partial || b.gender !== undefined) o.gender = ['male', 'female', 'other'].includes(String(b.gender || '').toLowerCase()) ? String(b.gender).toLowerCase() : null;
  if (!partial || b.dob !== undefined) o.dob = dateOrNull(b.dob, 'Date of birth');
  if (!partial || b.next_followup_on !== undefined) o.next_followup_on = dateOrNull(b.next_followup_on, 'Follow-up date');
  if (b.source !== undefined) { if (!SOURCES.includes(b.source)) throw httpError(400, 'Unknown source'); o.source = b.source; }
  if (!partial || b.class_id !== undefined) o.class_id = b.class_id || null;
  if (!partial || b.assigned_to !== undefined) o.assigned_to = b.assigned_to || null;
  if (o.phone && !/^[0-9 +()-]{7,20}$/.test(o.phone)) throw httpError(400, 'Enter a valid phone number');
  if (o.email && !/^\S+@\S+\.\S+$/.test(o.email)) throw httpError(400, 'Enter a valid email');
  return o;
}
async function checkRefs(school, o) {
  if (o.class_id) { const { data } = await db.from('classes').select('id').eq('id', o.class_id).eq('school_id', school).maybeSingle(); if (!data) throw httpError(400, 'That class does not belong to this school'); }
  if (o.assigned_to) { const { data } = await db.from('users').select('user_id').eq('user_id', o.assigned_to).eq('school_id', school).maybeSingle(); if (!data) throw httpError(400, 'That staff member is not in this school'); }
}

// ---- add an enquiry (office walk-in, phone call, QR, referral ...)
r.post('/', requireFeature('add_enquiry'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const o = fields(req.body, false);
  if (!o.student_name) throw httpError(400, 'Student name is required');
  if (!o.phone) throw httpError(400, 'Parent phone number is required');
  await checkRefs(school, o);
  const { data: ses } = await db.from('academic_sessions').select('name').eq('school_id', school).eq('is_current', true).maybeSingle();
  const row = { ...o, school_id: school, source: o.source || 'walk_in', stage: 'new', reached: 0, session_name: ses?.name || null, created_by: req.user.user_id,
    assigned_to: o.assigned_to || req.user.user_id, next_followup_on: req.body.next_followup_on === undefined ? todayStr() : o.next_followup_on };
  const { data, error } = await db.from('admission_enquiries').insert(row).select(SELECT).single();
  check(error);
  await log(school, data.id, 'created', `Enquiry added (${data.source.replace('_', ' ')})`, 'new', req.user.user_id);
  res.status(201).json({ ...data, name: data.student_name });
}));

// ---- edit details
r.patch('/:id', requireFeature('update_enquiry'), asyncH(async (req, res) => {
  const e = await load(req, req.params.id);
  if (e.stage === 'admitted') throw httpError(400, 'This student is already admitted - edit the student profile instead');
  const o = fields(req.body, true);
  if (o.student_name === null) throw httpError(400, 'Student name is required');
  await checkRefs(e.school_id || req.user.school_id, o);
  const { data, error } = await db.from('admission_enquiries').update({ ...o, updated_at: new Date().toISOString() }).eq('id', e.id).select(SELECT).single();
  check(error);
  res.json({ ...data, name: data.student_name });
}));

// shared: move an enquiry to another stage
async function moveStage(req, e, stage, { reason, missing_docs, note }) {
  if (!STAGES.includes(stage)) throw httpError(400, 'Unknown stage');
  if (stage === 'admitted') throw httpError(400, 'Use "Admit student" - it creates the student profile');
  if (e.stage === 'admitted') throw httpError(400, 'This student is already admitted');
  const patch = { stage, updated_at: new Date().toISOString() };
  if (stage === 'rejected') { patch.lost_reason = text(reason, 200); if (!patch.lost_reason) throw httpError(400, 'Tell us why (the reason shows up in drop-off reports)'); patch.next_followup_on = null; }
  else { patch.lost_reason = null; patch.reached = Math.max(e.reached, RANK[stage] ?? 0); }
  if (stage === 'pending_documents') patch.missing_docs = text(missing_docs, 300) ?? e.missing_docs;
  if (stage === 'shortlisted') patch.missing_docs = null;
  return { patch, line: `${STAGE_LABEL[e.stage]} → ${STAGE_LABEL[stage]}${stage === 'rejected' ? `: ${patch.lost_reason}` : ''}${note ? ` - ${text(note, 300)}` : ''}` };
}

r.post('/:id/stage', requireFeature('update_enquiry'), asyncH(async (req, res) => {
  const e = await load(req, req.params.id);
  const stage = String(req.body.stage || '');
  if (stage === e.stage) throw httpError(400, 'Already at that stage');
  const { patch, line } = await moveStage(req, e, stage, req.body);
  if (req.body.next_followup_on !== undefined) patch.next_followup_on = dateOrNull(req.body.next_followup_on, 'Follow-up date');
  const { data, error } = await db.from('admission_enquiries').update(patch).eq('id', e.id).select(SELECT).single();
  check(error);
  await log(data.school_id || req.user.school_id, e.id, 'stage', line, stage, req.user.user_id);
  res.json({ ...data, name: data.student_name });
}));

// ---- log a call / visit / note, and set the next follow-up date
r.post('/:id/activity', requireFeature('update_enquiry'), asyncH(async (req, res) => {
  const e = await load(req, req.params.id);
  const kind = String(req.body.kind || 'note');
  if (!KINDS.includes(kind)) throw httpError(400, 'Unknown activity');
  const note = text(req.body.note, 1000);
  if (kind === 'note' && !note) throw httpError(400, 'Write a note');
  if (e.stage === 'admitted' || e.stage === 'rejected') throw httpError(400, 'This enquiry is closed');
  const patch = { updated_at: new Date().toISOString() };
  if (req.body.next_followup_on !== undefined) patch.next_followup_on = dateOrNull(req.body.next_followup_on, 'Follow-up date');
  let stageLine = null; let stage = e.stage;
  if (req.body.stage && req.body.stage !== e.stage) { const m = await moveStage(req, e, String(req.body.stage), req.body); Object.assign(patch, m.patch); stage = req.body.stage; stageLine = m.line; }
  else if (e.stage === 'new' && CONTACT_KINDS.includes(kind)) { patch.stage = 'contacted'; patch.reached = Math.max(e.reached, 1); stage = 'contacted'; stageLine = 'New → Contacted'; }
  const { data, error } = await db.from('admission_enquiries').update(patch).eq('id', e.id).select(SELECT).single();
  check(error);
  const sid = data.school_id || req.user.school_id;
  await log(sid, e.id, kind, note, null, req.user.user_id);
  if (stageLine) await log(sid, e.id, 'stage', stageLine, stage, req.user.user_id);
  res.json({ ...data, name: data.student_name });
}));

// ---- admit: turn the enquiry into a student (and optionally a parent login) without typing anything again
const nextFreeRoll = async (school, class_id) => {
  const { data, error } = await db.from('profiles').select('roll_no').eq('school_id', school).eq('class_id', class_id).not('roll_no', 'is', null);
  check(error);
  const used = new Set(data.map((x) => x.roll_no));
  for (let n = 1; n <= 100; n += 1) if (!used.has(n)) return n;
  return null;
};
const nextAdmissionNo = async (school) => {
  const year = todayStr().slice(0, 4);
  const { data, error } = await db.from('profiles').select('admission_no').eq('school_id', school).like('admission_no', `ADM/${year}/%`).order('admission_no', { ascending: false }).limit(1);
  check(error);
  const last = Number(String(data[0]?.admission_no || '').split('/')[2] || 0);
  return `ADM/${year}/${String(last + 1).padStart(4, '0')}`;
};
const genPassword = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
async function makeUser(school, role, password, profile) {
  const password_hash = await bcrypt.hash(password, 10);
  for (let tries = 0; tries < 5; tries += 1) {
    const login_id = await nextLoginId(school);
    const ins = await db.from('users').insert({ school_id: school, login_id, role, password_hash }).select('user_id').single();
    if (ins.error?.code === '23505') continue;
    check(ins.error);
    const { error } = await db.from('profiles').insert({ user_id: ins.data.user_id, school_id: school, ...profile });
    if (error) { await db.from('users').delete().eq('user_id', ins.data.user_id); check(error); }
    return { user_id: ins.data.user_id, login_id };
  }
  throw httpError(409, 'Could not make a free user ID, please try again');
}

r.post('/:id/admit', requireFeature('admit_student'), asyncH(async (req, res) => {
  const e = await load(req, req.params.id);
  const school = e.school_id || req.user.school_id;
  if (e.stage === 'admitted' || e.student_user_id) throw httpError(400, 'This student is already admitted');
  if (e.stage === 'rejected') throw httpError(400, 'Reopen this enquiry (move it to another stage) before admitting');
  const class_id = req.body.class_id || e.class_id;
  if (!class_id) throw httpError(400, 'Choose the class to admit the student into');
  await checkRefs(school, { class_id });
  const password = String(req.body.password || '').trim() || genPassword();
  if (password.length < 6) throw httpError(400, 'Password needs at least 6 characters');
  const roll_no = await nextFreeRoll(school, class_id);
  const admission_no = await nextAdmissionNo(school);
  const student = await makeUser(school, 'student', password, {
    full_name: e.student_name, dob: e.dob, gender: e.gender, address: e.address, class_id, roll_no, admission_no,
    phone: null, emergency_contact_name: e.parent_name, emergency_contact_phone: e.phone,
    extra: { admission_enquiry_ref: e.ref_no, guardian_name: e.parent_name, guardian_phone: e.phone, guardian_email: e.email },
  });
  const out = { student: { user_id: student.user_id, login_id: student.login_id, password, admission_no, roll_no } };
  if (req.body.create_parent) {
    const ppass = String(req.body.parent_password || '').trim() || genPassword();
    if (ppass.length < 6) throw httpError(400, 'Parent password needs at least 6 characters');
    try {
      const parent = await makeUser(school, 'parent', ppass, { full_name: e.parent_name || `Parent of ${e.student_name}`, phone: e.phone, email: e.email, address: e.address });
      check((await db.from('parent_students').insert({ parent_id: parent.user_id, student_id: student.user_id, school_id: school })).error);
      out.parent = { user_id: parent.user_id, login_id: parent.login_id, password: ppass };
    } catch (x) { await db.from('users').delete().eq('user_id', student.user_id); throw x; }
  }
  const { data, error } = await db.from('admission_enquiries').update({ stage: 'admitted', reached: 4, class_id, student_user_id: student.user_id, admitted_at: new Date().toISOString(), next_followup_on: null, lost_reason: null, updated_at: new Date().toISOString() }).eq('id', e.id).select(SELECT).single();
  check(error);
  await log(school, e.id, 'admitted', `Admitted as ${admission_no} (user ${student.login_id})`, 'admitted', req.user.user_id);
  res.status(201).json({ ...data, name: data.student_name, ...out });
}));

r.delete('/:id', requireFeature('delete_enquiry'), asyncH(async (req, res) => {
  const e = await load(req, req.params.id);
  check((await db.from('admission_enquiries').delete().eq('id', e.id)).error);
  res.json({ ok: true, name: e.student_name });
}));

export default r;
