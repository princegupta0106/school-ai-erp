// Documents: certificates (bonafide, character, transfer, activity, experience, custom) and report cards.
// The wording / design of a document lives in the browser (client/src/docRender.js); the server is the source of truth for
// WHO a document is issued to, the details printed on it, the marks, the serial number and the history.
// Every issued document stores a full snapshot (wording, details, marks, letterhead) so it can never change afterwards.
//
//   getMeta(schoolId)                       letterhead settings + saved templates + sessions (everything a screen needs to start)
//   saveSettings / saveTemplate / resetTemplate / uploadImage
//   searchPeople(schoolId, {kind,q,classId})  students or staff to issue a document to
//   prefill(schoolId, personId, type, opts)   the details printed on the document (+ the report-card marks)
//   issue(user, schoolId, body)               allocate a serial number and store the document
//   listIssued / getIssued / cancelIssued     the register (staff) and a single document
//   myDocuments(user)                         documents issued to me, or to my children
import { db, httpError, check } from './db.js';
import { uploadFile, signedUrl, keyOf, refOf, toStored, toDisplay } from './r2.js';
import { studentDashboard, listSessions, PASS_PERCENT, gradeOf } from './academics.js';
import { notifyDocument } from './notify.js';
import { studentReport, todayStr } from './attendance.js';

// kind: who a type is for. student | staff (staff = teachers, staff, school admins)
export const TYPES = {
  bonafide: { label: 'Bonafide certificate', prefix: 'BON', for: ['student'] },
  character: { label: 'Character certificate', prefix: 'CHR', for: ['student', 'staff'] },
  transfer: { label: 'Transfer certificate', prefix: 'TC', for: ['student'] },
  activity: { label: 'Activity / achievement certificate', prefix: 'ACT', for: ['student', 'staff'] },
  report_card: { label: 'Report card', prefix: 'RC', for: ['student'] },
  experience: { label: 'Experience certificate', prefix: 'EXP', for: ['staff'] },
  custom: { label: 'Custom certificate / letter', prefix: 'DOC', for: ['student', 'staff'] },
};
const STAFF_ROLES = ['staff', 'other', 'school_admin'];
const kindOfRole = (role) => (role === 'student' ? 'student' : STAFF_ROLES.includes(role) ? 'staff' : null);

const DESIGNS = ['classic', 'royal', 'modern', 'emerald', 'minimal', 'ribbon'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (x) => (Array.isArray(x) ? x[0] : x);
const clsLabel = (c) => (c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : '');
const clean = (v, max = 300) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);

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

// Images are shown on the printed page: an outside https link, or a file of THIS school in our private bucket.
// Our files are stored as "r2:<key>" (never as a link that expires). The browser may hand back the 1-hour link it was
// given earlier; keyOf() turns that back into the key, so the database only ever holds the permanent reference.
function url(v, what, schoolId) {
  const s = clean(v, 1500);
  if (!s) return null;
  const key = keyOf(s);
  if (key) {
    if (key.includes('..') || !key.startsWith(`schools/${schoolId}/`)) throw httpError(400, `${what} must be a file uploaded for this school`);
    return refOf(key);
  }
  if (!/^(https?:\/\/|\/)[^\s"'<>]+$/i.test(s)) throw httpError(400, `${what} must be a web link (https://...)`);
  return s;
}

// stored image references -> links that work for one hour (outside links pass through untouched)
const IMG_COLS = ['logo_url', 'signature_url', 'seal_url', 'bg_url'];
async function signImages(o) {
  if (!o || typeof o !== 'object') return o;
  const out = { ...o };
  for (const c of IMG_COLS) if (out[c]) out[c] = await toDisplay(out[c]);
  return out;
}
// an issued document keeps its letterhead + background as references; give the viewer fresh links
async function signContent(content) {
  if (!content) return content;
  const c = await signImages(content);
  if (c.school) c.school = await signImages(c.school);
  return c;
}

// ---------------------------------------------------------------- meta
const SETTING_FIELDS = ['principal_name', 'principal_title', 'tagline', 'reg_line', 'place', 'footer_note'];
const IMAGE_FIELDS = ['logo_url', 'signature_url', 'seal_url'];

async function schoolRow(schoolId) {
  const { data, error } = await db.from('schools').select('id,name,address,phone,email,logo_url').eq('id', schoolId).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'School not found');
  return data;
}

// everything printed in the letterhead (school row + doc_settings)
export async function letterhead(schoolId) {
  const [school, { data: s, error }] = [await schoolRow(schoolId), await db.from('doc_settings').select('*').eq('school_id', schoolId).maybeSingle()];
  check(error);
  const o = s || {};
  return {
    name: school.name, address: school.address || '', phone: school.phone || '', email: school.email || '',
    logo_url: toStored(o.logo_url || school.logo_url || ''), signature_url: toStored(o.signature_url || ''), seal_url: toStored(o.seal_url || ''), // always permanent references, never links that expire
    principal_name: o.principal_name || '', principal_title: o.principal_title || 'Principal',
    tagline: o.tagline || '', reg_line: o.reg_line || '', place: o.place || '', footer_note: o.footer_note || '',
  };
}

export async function getMeta(schoolId) {
  const [lh, settings, templates, sessions, classes] = await Promise.all([
    letterhead(schoolId),
    db.from('doc_settings').select('*').eq('school_id', schoolId).maybeSingle(),
    db.from('doc_templates').select('doc_type,title,body,design,accent,bg_url,orientation,settings').eq('school_id', schoolId),
    listSessions(schoolId),
    db.from('classes').select('id,name,section,level').eq('school_id', schoolId).order('level', { nullsFirst: false }).order('name').order('section'),
  ]);
  check(settings.error); check(templates.error); check(classes.error);
  const tpls = await Promise.all(templates.data.map(async (t) => [t.doc_type, await signImages(t)]));
  return {
    letterhead: await signImages(lh),
    settings: await signImages(settings.data || {}),
    templates: Object.fromEntries(tpls),
    sessions,
    classes: classes.data.map((c) => ({ id: c.id, label: clsLabel(c) })),
    types: Object.entries(TYPES).map(([key, t]) => ({ key, label: t.label, for: t.for })),
    today: todayStr(),
  };
}

export async function saveSettings(schoolId, b) {
  const row = { school_id: schoolId, updated_at: new Date().toISOString() };
  for (const f of SETTING_FIELDS) row[f] = clean(b[f], f === 'footer_note' ? 300 : 160) || null;
  for (const f of IMAGE_FIELDS) row[f] = url(b[f], f.replace('_url', '').replace('_', ' '), schoolId) || null;
  const { error } = await db.from('doc_settings').upsert(row, { onConflict: 'school_id' });
  check(error);
  return getMeta(schoolId);
}

export async function uploadImage(schoolId, kind, file) {
  if (!['logo', 'signature', 'seal', 'background'].includes(kind)) throw httpError(400, 'Unknown image type');
  if (!file) throw httpError(400, 'Choose an image');
  if (!process.env.R2_BUCKET_NAME) throw httpError(400, 'File storage (R2) is not set up in .env - paste an image link instead');
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.mimetype];
  const key = `schools/${schoolId}/documents/${kind}-${Date.now()}.${ext}`;
  await uploadFile(key, file.buffer, file.mimetype);
  // `url` is a 1-hour link to preview the picture now; saving it keeps only the permanent reference (see url())
  return { url: await signedUrl(key), ref: refOf(key) };
}

export async function saveTemplate(schoolId, type, b) {
  if (!TYPES[type]) throw httpError(400, 'Unknown document type');
  const design = b.design ? clean(b.design, 20) : null;
  if (design && !DESIGNS.includes(design)) throw httpError(400, 'Unknown design');
  const accent = b.accent ? clean(b.accent, 7) : null;
  if (accent && !COLOR.test(accent)) throw httpError(400, 'Colour must look like #1a3a6b');
  const orientation = b.orientation ? clean(b.orientation, 10) : null;
  if (orientation && !['portrait', 'landscape'].includes(orientation)) throw httpError(400, 'Unknown page direction');
  const inset = Number(b.settings?.inset);
  const row = {
    school_id: schoolId, doc_type: type, updated_at: new Date().toISOString(),
    title: clean(b.title, 120) || null,
    body: String(b.body ?? '').replace(/\r/g, '').slice(0, 4000) || null,
    design, accent, orientation, bg_url: url(b.bg_url, 'Background image', schoolId),
    settings: { inset: Number.isFinite(inset) ? Math.min(Math.max(inset, 0), 60) : 18, body_staff: String(b.body_staff ?? b.settings?.body_staff ?? '').replace(/\r/g, '').slice(0, 4000) || null },
  };
  const { error } = await db.from('doc_templates').upsert(row, { onConflict: 'school_id,doc_type' });
  check(error);
  return getMeta(schoolId);
}

export async function resetTemplate(schoolId, type) {
  if (!TYPES[type]) throw httpError(400, 'Unknown document type');
  check((await db.from('doc_templates').delete().eq('school_id', schoolId).eq('doc_type', type)).error);
  return getMeta(schoolId);
}

// ---------------------------------------------------------------- people
export async function searchPeople(schoolId, { kind, q, classId }) {
  const roles = kind === 'staff' ? STAFF_ROLES : ['student'];
  const needle = String(q || '').replace(/[%,()*\\]/g, ' ').trim().slice(0, 60);
  if (!needle && !classId) return [];
  if (classId && !UUID.test(classId)) throw httpError(400, 'Unknown class');
  let ids = [];
  if (needle) {
    const { data } = await db.from('users').select('user_id').eq('school_id', schoolId).in('role', roles).ilike('login_id', `%${needle}%`).limit(40);
    ids = (data || []).map((u) => u.user_id);
  }
  let query = db.from('profiles')
    .select('user_id,full_name,roll_no,admission_no,employee_id,designation,class_id,extra,users!inner(login_id,is_active,role)')
    .eq('school_id', schoolId).in('users.role', roles);
  if (classId) query = query.eq('class_id', classId);
  if (needle) {
    const p = `%${needle}%`;
    query = query.or(`full_name.ilike.${p},admission_no.ilike.${p},employee_id.ilike.${p}${ids.length ? `,user_id.in.(${ids.join(',')})` : ''}`);
  }
  const { data, error } = await query.order('full_name').limit(40);
  check(error);
  const { data: classes } = await db.from('classes').select('id,name,section').eq('school_id', schoolId);
  const label = new Map((classes || []).map((c) => [c.id, clsLabel(c)]));
  return data.map((p) => {
    const u = one(p.users);
    return {
      id: p.user_id, name: p.full_name || u.login_id, login_id: u.login_id, role: u.role, kind: kindOfRole(u.role),
      class_label: label.get(p.class_id) || '', roll_no: p.roll_no, admission_no: p.admission_no || '',
      designation: p.designation || '', employee_id: p.employee_id || '',
      inactive: !u.is_active || p.extra?.graduated === true,
    };
  });
}

async function loadPerson(schoolId, id) {
  if (!UUID.test(id || '')) throw httpError(400, 'Choose a person');
  const { data, error } = await db.from('users').select('user_id,login_id,role,is_active,school_id,profiles(*)').eq('user_id', id).eq('school_id', schoolId).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Person not found');
  const p = one(data.profiles) || {};
  let cls = null;
  if (p.class_id) cls = (await db.from('classes').select('name,section').eq('id', p.class_id).maybeSingle()).data;
  return { u: data, p, kind: kindOfRole(data.role), classLabel: clsLabel(cls) };
}

const SUBJECT_KEYS = ['name', 'gender', 'dob', 'father', 'mother', 'address', 'class_label', 'admission_no', 'roll_no', 'designation', 'department', 'employee_id', 'joining_date', 'qualification'];

function subjectOf({ u, p, kind, classLabel }) {
  return {
    id: u.user_id, role: u.role, kind,
    name: p.full_name || u.login_id, gender: p.gender || '', dob: p.dob || '', father: p.father_name || '', mother: p.mother_name || '',
    address: p.address || '', class_label: classLabel, admission_no: p.admission_no || '', roll_no: p.roll_no ?? '',
    designation: p.designation || '', department: p.department || '', employee_id: p.employee_id || '',
    joining_date: p.joining_date || '', qualification: p.qualification || '',
  };
}

// ---------------------------------------------------------------- report card data (computed here, never trusted from the browser)
async function reportData(schoolId, studentId, { session_id, exam_ids, include_tests }) {
  const dash = await studentDashboard(schoolId, studentId, session_id || undefined);
  const sessions = dash.sessions;
  const session = sessions.find((s) => s.id === dash.session_id) || null;
  const available = dash.exams.map((e) => ({ exam_id: e.exam_id, name: e.name, start_date: e.start_date, pct: e.total.pct }));
  const wanted = Array.isArray(exam_ids) ? exam_ids.filter((x) => UUID.test(x)) : null;
  const chosen = dash.exams.filter((e) => (wanted ? wanted.includes(e.exam_id) : true));

  const subj = new Map();
  for (const e of chosen) {
    for (const pp of e.papers) {
      if (!subj.has(pp.subject_id)) subj.set(pp.subject_id, { name: pp.subject, cells: {}, obtained: 0, max: 0 });
      const s = subj.get(pp.subject_id);
      s.cells[e.exam_id] = { marks: pp.marks, max: pp.max_marks, absent: !!pp.absent };
      if (!pp.absent) { s.obtained += pp.marks ?? 0; s.max += pp.max_marks; }
    }
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  const testsBy = new Map(dash.subjects.map((s) => [s.subject_id, s.tests]));
  const subjects = [...subj.entries()].map(([sid, s]) => {
    const pct = s.max > 0 ? r1((s.obtained / s.max) * 100) : null;
    const t = testsBy.get(sid);
    return { name: s.name, cells: s.cells, obtained: s.obtained, max: s.max, pct, grade: gradeOf(pct), tests_pct: include_tests && t && t.count ? t.pct : null };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const examTotals = {};
  for (const e of chosen) examTotals[e.exam_id] = { obtained: e.total.obtained, max: e.total.max, pct: e.total.pct, grade: e.total.grade };
  const gObt = subjects.reduce((n, s) => n + s.obtained, 0);
  const gMax = subjects.reduce((n, s) => n + s.max, 0);
  const gPct = gMax > 0 ? r1((gObt / gMax) * 100) : null;
  const failed = subjects.filter((s) => s.pct !== null && s.pct < PASS_PERCENT).map((s) => s.name);

  // attendance over the session (up to today)
  let attendance = null;
  try {
    if (session) {
      const to = session.end_date && session.end_date < todayStr() ? session.end_date : todayStr();
      const a = await studentReport(schoolId, studentId, session.start_date, to);
      attendance = a.summary.total ? { present: a.summary.present + a.summary.late, total: a.summary.total, pct: a.summary.percent } : null;
    }
  } catch { attendance = null; }

  return {
    session_id: dash.session_id, session_name: session?.name || '', sessions: sessions.map((s) => ({ id: s.id, name: s.name, is_current: s.is_current })),
    available_exams: available,
    exams: chosen.map((e) => ({ exam_id: e.exam_id, name: e.name })),
    exam_totals: examTotals,
    subjects,
    has_tests_column: !!include_tests && subjects.some((s) => s.tests_pct !== null),
    grand: { obtained: Math.round(gObt * 100) / 100, max: Math.round(gMax * 100) / 100, pct: gPct, grade: gradeOf(gPct) },
    result: subjects.length ? (failed.length ? 'FAIL' : 'PASS') : '',
    failed_subjects: failed,
    attendance, pass_percent: PASS_PERCENT,
  };
}

export async function prefill(schoolId, id, type, q = {}) {
  if (!TYPES[type]) throw httpError(400, 'Unknown document type');
  const person = await loadPerson(schoolId, id);
  if (!person.kind || !TYPES[type].for.includes(person.kind)) throw httpError(400, `A ${TYPES[type].label.toLowerCase()} cannot be issued to this person`);
  const out = { subject: subjectOf(person), session_name: '' };
  const sessions = await listSessions(schoolId);
  out.session_name = (sessions.find((s) => s.is_current) || sessions[0])?.name || '';
  out.inactive = !person.u.is_active || person.p.extra?.graduated === true;
  if (type === 'report_card') {
    out.report = await reportData(schoolId, id, {
      session_id: q.session_id, exam_ids: q.exam_ids ? String(q.exam_ids).split(',').filter(Boolean) : null, include_tests: q.include_tests === '1',
    });
    out.session_name = out.report.session_name || out.session_name;
  }
  return out;
}

// ---------------------------------------------------------------- issue
export async function issue(user, schoolId, b) {
  const type = b.type;
  const T = TYPES[type];
  if (!T) throw httpError(400, 'Choose a document type');
  const person = await loadPerson(schoolId, b.subject_id);
  if (!person.kind || !T.for.includes(person.kind)) throw httpError(400, `A ${T.label.toLowerCase()} cannot be issued to this person`);

  // details printed on the document: what is on the profile, optionally corrected for this document only
  const subject = subjectOf(person);
  for (const k of SUBJECT_KEYS) {
    if (b.subject?.[k] === undefined || b.subject?.[k] === null) continue;
    const v = clean(b.subject[k], k === 'address' ? 300 : 120);
    if (k === 'name' && !v) continue;
    subject[k] = v;
  }
  for (const k of ['dob', 'joining_date']) if (subject[k] && !DATE.test(subject[k])) throw httpError(400, 'Dates must be valid');
  if (!subject.name) throw httpError(400, 'The name cannot be empty');

  // free fields of this document (purpose, activity, dates...): text only
  const fields = {};
  for (const [k, v] of Object.entries(b.fields || {})) {
    if (!/^[a-z_]{1,30}$/.test(k) || k === 'exam_ids' || k === 'include_tests') continue;
    fields[k] = clean(v, k.includes('remark') || k === 'reason' ? 500 : 200);
  }

  let title = clean(b.title, 120) || T.label;
  const body = String(b.body ?? '').replace(/\r/g, '').slice(0, 4000);
  if (type === 'custom' && !body.trim()) throw httpError(400, 'Write the text of the document');
  const design = DESIGNS.includes(b.design) ? b.design : 'classic';
  const accent = COLOR.test(b.accent || '') ? b.accent : '';
  const orientation = b.orientation === 'landscape' ? 'landscape' : 'portrait';
  const inset = Number.isFinite(Number(b.inset)) ? Math.min(Math.max(Number(b.inset), 0), 60) : 18;

  const content = {
    v: 1, type, title, body, design, accent, orientation, inset, bg_url: url(b.bg_url, 'Background image', schoolId),
    school: await letterhead(schoolId), subject, fields, issued_on: todayStr(),
  };
  if (type === 'report_card') {
    const rc = b.report || {};
    content.report = await reportData(schoolId, person.u.user_id, { session_id: rc.session_id, exam_ids: rc.exam_ids, include_tests: !!rc.include_tests });
    if (!content.report.subjects.length) throw httpError(400, 'There are no marks to print for this student (pick the exams to include)');
    content.fields.exam_names = content.report.exams.map((e) => e.name).join(', ');
  }

  const year = Number(content.issued_on.slice(0, 4));
  const { data: serial, error: e1 } = await db.rpc('next_doc_serial', { p_school: schoolId, p_type: type, p_prefix: T.prefix, p_year: year });
  check(e1);
  content.serial_no = serial;
  const { data, error } = await db.from('issued_documents').insert({
    school_id: schoolId, doc_type: type, serial_no: serial, subject_id: person.u.user_id, subject_name: subject.name, subject_role: person.u.role,
    class_label: subject.class_label || null, title, content, issued_by: user.user_id, issued_by_name: user.profile?.full_name || user.login_id,
  }).select('*').single();
  check(error);
  notifyDocument(schoolId, user, person.u.user_id, title);
  return { ...data, content: await signContent(data.content) };
}

// ---------------------------------------------------------------- register
const LIST_COLS = 'id,doc_type,serial_no,subject_id,subject_name,subject_role,class_label,title,status,issued_at,issued_by_name,cancelled_at,cancel_reason';

export async function listIssued(schoolId, f = {}) {
  let q = db.from('issued_documents').select(LIST_COLS, { count: 'exact' }).eq('school_id', schoolId).order('issued_at', { ascending: false });
  if (f.type && TYPES[f.type]) q = q.eq('doc_type', f.type);
  if (f.status === 'issued' || f.status === 'cancelled') q = q.eq('status', f.status);
  if (UUID.test(f.subject_id || '')) q = q.eq('subject_id', f.subject_id);
  const needle = String(f.q || '').replace(/[%,()*\\]/g, ' ').trim().slice(0, 60);
  if (needle) q = q.or(`subject_name.ilike.%${needle}%,serial_no.ilike.%${needle}%`);
  const limit = 50; const page = Math.max(Number(f.page) || 0, 0);
  const { data, error, count } = await q.range(page * limit, page * limit + limit - 1);
  check(error);
  return { rows: data, total: count ?? data.length, page, limit };
}

// staff with the register feature, the person it was issued to, or the parent of that student
export async function getIssued(user, schoolId, id, isStaff) {
  if (!UUID.test(id || '')) throw httpError(400, 'Unknown document');
  const { data, error } = await db.from('issued_documents').select('*').eq('id', id).eq('school_id', schoolId).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Document not found');
  if (!isStaff) {
    let ok = data.subject_id === user.user_id;
    if (!ok && data.subject_id) {
      const { data: link } = await db.from('parent_students').select('student_id').eq('parent_id', user.user_id).eq('student_id', data.subject_id).maybeSingle();
      ok = !!link;
    }
    if (!ok) throw httpError(403, 'This document was not issued to you');
    if (data.status === 'cancelled') data.content = null; // a cancelled document can no longer be printed by the holder
  }
  data.content = await signContent(data.content);
  return data;
}

export async function cancelIssued(user, schoolId, id, reason) {
  const why = clean(reason, 200);
  if (!why) throw httpError(400, 'Give a reason');
  const { data, error } = await db.from('issued_documents').select('id,status').eq('id', id).eq('school_id', schoolId).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Document not found');
  if (data.status === 'cancelled') throw httpError(409, 'Already cancelled');
  const { error: e2 } = await db.from('issued_documents').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: user.user_id, cancel_reason: why }).eq('id', id);
  check(e2);
}

export async function myDocuments(user) {
  if (!user.school_id) return [];
  const { data: kids } = await db.from('parent_students').select('student_id').eq('parent_id', user.user_id);
  const ids = [user.user_id, ...(kids || []).map((k) => k.student_id)];
  const rows = await fetchAll(() => db.from('issued_documents').select(LIST_COLS).eq('school_id', user.school_id).in('subject_id', ids).order('issued_at', { ascending: false }).order('id'));
  return rows.map((r) => ({ ...r, mine: r.subject_id === user.user_id }));
}
