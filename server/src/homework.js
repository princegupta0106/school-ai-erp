// Homework & assignments.
//   Teacher:  listClasses / listAssignments / createAssignment / deleteAssignment / getSubmissions / checkSubmission
//   Student:  myAssignments / myAssignment / submit
// A teacher sees the assignments HE/SHE created (school admins see all of their school).
// A student sees the assignments of his/her own class.
import crypto from 'node:crypto';
import { db, httpError, check } from './db.js';
import { accessibleClasses } from './attendance.js';
import { uploadFile, deleteFile } from './r2.js';
import { notifyHomework, notifyChecked } from './notify.js';

const one = (x) => (Array.isArray(x) ? x[0] : x);
const isAdmin = (user) => user.role === 'school_admin' || user.role === 'super_admin';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- files (Cloudflare R2, same bucket as user documents)
async function saveFiles(files, folder) {
  const out = [];
  try {
    for (const f of files || []) {
      const id = crypto.randomUUID();
      const safe = f.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      const key = `${folder}/${id}-${safe}`;
      const url = await uploadFile(key, f.buffer, f.mimetype);
      out.push({ id, name: f.originalname, url, key, size: f.size, type: f.mimetype });
    }
  } catch (e) { await removeFiles(out); throw e; }
  return out;
}
const removeFiles = (list) => Promise.allSettled((list || []).map((f) => deleteFile(f.key)));
const publicFile = (f) => ({ id: f.id, name: f.name, url: f.url, size: f.size, type: f.type });

// ================================================================= teacher side
export async function listClasses(user, schoolId) {
  return accessibleClasses(user, schoolId);
}

async function ownAssignment(user, schoolId, id) {
  const { data, error } = await db.from('assignments').select('*, classes(id,name,section)').eq('id', id).eq('school_id', schoolId).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Assignment not found');
  if (!isAdmin(user) && data.created_by !== user.user_id) throw httpError(403, 'This is not your assignment');
  return data;
}

// classes a class has students in (active, not graduated)
async function classStudentIds(schoolId, classId) {
  const { data, error } = await db.from('profiles').select('user_id,extra,users!inner(role,is_active)').eq('school_id', schoolId).eq('class_id', classId).eq('users.role', 'student').eq('users.is_active', true).limit(2000);
  check(error);
  return data.filter((p) => p.extra?.graduated !== true).map((p) => p.user_id);
}

export async function listAssignments(user, schoolId) {
  let q = db.from('assignments').select('id,title,subject,due_date,needs_submission,created_at,created_by,class_id,attachments,classes(id,name,section)').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(200);
  if (!isAdmin(user)) q = q.eq('created_by', user.user_id);
  const { data, error } = await q;
  check(error);
  if (!data.length) return [];
  const { data: subs, error: e2 } = await db.from('assignment_submissions').select('assignment_id,status').in('assignment_id', data.map((a) => a.id)).limit(20000);
  check(e2);
  const counts = new Map();
  subs.forEach((s) => { const c = counts.get(s.assignment_id) || { submitted: 0, checked: 0 }; c.submitted += 1; if (s.status === 'checked') c.checked += 1; counts.set(s.assignment_id, c); });
  const classIds = [...new Set(data.map((a) => a.class_id))];
  const totals = new Map(await Promise.all(classIds.map(async (id) => [id, (await classStudentIds(schoolId, id)).length])));
  return data.map((a) => {
    const c = counts.get(a.id) || { submitted: 0, checked: 0 };
    return { ...a, classes: one(a.classes), attachments: (a.attachments || []).map(publicFile), total_students: totals.get(a.class_id) || 0, submitted: c.submitted, checked: c.checked, to_check: c.submitted - c.checked };
  });
}

export async function createAssignment(user, schoolId, b, files) {
  const title = String(b.title || '').trim();
  if (!title) throw httpError(400, 'Title is required');
  if (title.length > 150) throw httpError(400, 'Title is too long (150 characters max)');
  const description = String(b.description || '').trim();
  if (description.length > 5000) throw httpError(400, 'Description is too long (5000 characters max)');
  const needs = b.needs_submission === true || b.needs_submission === 'true';
  const due = b.due_date ? String(b.due_date) : null;
  if (due && !DATE.test(due)) throw httpError(400, 'Invalid due date');
  if (!description && !(files || []).length) throw httpError(400, 'Write something or attach a file');
  const ok = new Set((await accessibleClasses(user, schoolId)).map((c) => c.id));
  if (!ok.has(b.class_id)) throw httpError(403, 'You can only post to your own classes');
  const id = crypto.randomUUID();
  const attachments = await saveFiles(files, `schools/${schoolId}/homework/${id}`);
  const { error } = await db.from('assignments').insert({
    id, school_id: schoolId, class_id: b.class_id, created_by: user.user_id, title, description: description || null,
    subject: String(b.subject || '').trim().slice(0, 60) || null, due_date: due, needs_submission: needs, attachments,
  });
  if (error) { await removeFiles(attachments); check(error); }
  notifyHomework(schoolId, user, { class_id: b.class_id, title, subject: String(b.subject || '').trim().slice(0, 60), needs, due });
  return { id };
}

export async function deleteAssignment(user, schoolId, id) {
  const a = await ownAssignment(user, schoolId, id);
  const { data: subs, error } = await db.from('assignment_submissions').select('files').eq('assignment_id', id);
  check(error);
  check((await db.from('assignments').delete().eq('id', id)).error);
  await removeFiles([...(a.attachments || []), ...subs.flatMap((s) => s.files || [])]);
}

// every student of the class with his/her submission (or "not submitted")
export async function getSubmissions(user, schoolId, id) {
  const a = await ownAssignment(user, schoolId, id);
  const { data: studs, error } = await db.from('profiles').select('user_id,full_name,roll_no,extra,users!inner(login_id,role,is_active)').eq('school_id', schoolId).eq('class_id', a.class_id).eq('users.role', 'student').eq('users.is_active', true).limit(2000);
  check(error);
  const { data: subs, error: e2 } = await db.from('assignment_submissions').select('*').eq('assignment_id', id);
  check(e2);
  const by = new Map(subs.map((s) => [s.student_id, s]));
  const rows = studs.filter((p) => p.extra?.graduated !== true).map((p) => {
    const s = by.get(p.user_id);
    return {
      student_id: p.user_id, name: p.full_name || one(p.users).login_id, roll_no: p.roll_no,
      submission: s ? { id: s.id, note: s.note, files: (s.files || []).map(publicFile), is_late: s.is_late, submitted_at: s.submitted_at, status: s.status, marks: s.marks, feedback: s.feedback, checked_at: s.checked_at } : null,
    };
  }).sort((x, y) => (x.roll_no ?? 1e9) - (y.roll_no ?? 1e9) || x.name.localeCompare(y.name));
  return { assignment: { id: a.id, title: a.title, description: a.description, subject: a.subject, due_date: a.due_date, needs_submission: a.needs_submission, classes: one(a.classes), attachments: (a.attachments || []).map(publicFile) }, students: rows };
}

export async function checkSubmission(user, schoolId, submissionId, b) {
  const { data: s, error } = await db.from('assignment_submissions').select('id,assignment_id,student_id').eq('id', submissionId).eq('school_id', schoolId).maybeSingle();
  check(error);
  if (!s) throw httpError(404, 'Submission not found');
  const asg = await ownAssignment(user, schoolId, s.assignment_id);
  const marks = String(b.marks ?? '').trim().slice(0, 30);
  const feedback = String(b.feedback ?? '').trim().slice(0, 2000);
  check((await db.from('assignment_submissions').update({ status: 'checked', marks: marks || null, feedback: feedback || null, checked_by: user.user_id, checked_at: new Date().toISOString() }).eq('id', submissionId)).error);
  notifyChecked(schoolId, user, s.student_id, { title: asg.title, marks });
}

// ================================================================= student side
function needStudent(user) {
  if (user.role !== 'student' || !user.school_id) throw httpError(403, 'This is for students');
  if (!user.profile?.class_id) throw httpError(400, 'You are not in a class yet');
}

export async function myAssignments(user) {
  needStudent(user);
  const { data, error } = await db.from('assignments').select('id,title,subject,due_date,needs_submission,created_at,attachments,created_by').eq('school_id', user.school_id).eq('class_id', user.profile.class_id).order('created_at', { ascending: false }).limit(200);
  check(error);
  if (!data.length) return [];
  const { data: subs, error: e2 } = await db.from('assignment_submissions').select('assignment_id,status,marks,submitted_at,is_late').eq('student_id', user.user_id).in('assignment_id', data.map((a) => a.id));
  check(e2);
  const by = new Map(subs.map((s) => [s.assignment_id, s]));
  const teachers = await teacherNames(data.map((a) => a.created_by));
  return data.map((a) => ({ ...a, attachments: (a.attachments || []).map(publicFile), teacher: teachers.get(a.created_by) || '', my: by.get(a.id) || null }));
}

async function teacherNames(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const { data, error } = await db.from('profiles').select('user_id,full_name').in('user_id', list);
  check(error);
  return new Map(data.map((p) => [p.user_id, p.full_name]));
}

export async function myAssignment(user, id) {
  needStudent(user);
  const { data: a, error } = await db.from('assignments').select('*').eq('id', id).eq('school_id', user.school_id).eq('class_id', user.profile.class_id).maybeSingle();
  check(error);
  if (!a) throw httpError(404, 'Assignment not found');
  const { data: s, error: e2 } = await db.from('assignment_submissions').select('*').eq('assignment_id', id).eq('student_id', user.user_id).maybeSingle();
  check(e2);
  const teachers = await teacherNames([a.created_by]);
  return {
    id: a.id, title: a.title, description: a.description, subject: a.subject, due_date: a.due_date, needs_submission: a.needs_submission, created_at: a.created_at,
    attachments: (a.attachments || []).map(publicFile), teacher: teachers.get(a.created_by) || '',
    my: s ? { note: s.note, files: (s.files || []).map(publicFile), is_late: s.is_late, submitted_at: s.submitted_at, status: s.status, marks: s.marks, feedback: s.feedback, checked_at: s.checked_at } : null,
  };
}

// today in the school's timezone, as YYYY-MM-DD (to know if a submission is late)
const todayStr = async () => {
  const { cfg } = await import('./config.js');
  return new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
};

export async function submit(user, id, b, files) {
  needStudent(user);
  const { data: a, error } = await db.from('assignments').select('id,due_date,needs_submission').eq('id', id).eq('school_id', user.school_id).eq('class_id', user.profile.class_id).maybeSingle();
  check(error);
  if (!a) throw httpError(404, 'Assignment not found');
  if (!a.needs_submission) throw httpError(400, 'Nothing to submit for this one');
  const note = String(b.note || '').trim().slice(0, 2000);
  if (!(files || []).length && !note) throw httpError(400, 'Attach a file or write a note');
  const { data: old, error: e2 } = await db.from('assignment_submissions').select('id,status,files').eq('assignment_id', id).eq('student_id', user.user_id).maybeSingle();
  check(e2);
  if (old?.status === 'checked') throw httpError(400, 'Your teacher has already checked this, it can no longer be changed');
  const saved = await saveFiles(files, `schools/${user.school_id}/homework/${id}/submissions/${user.user_id}`);
  const row = { assignment_id: id, school_id: user.school_id, student_id: user.user_id, note: note || null, files: saved, is_late: !!a.due_date && (await todayStr()) > a.due_date, submitted_at: new Date().toISOString(), status: 'submitted' };
  const { error: e3 } = await db.from('assignment_submissions').upsert(row, { onConflict: 'assignment_id,student_id' });
  if (e3) { await removeFiles(saved); check(e3); }
  if (old) await removeFiles(old.files); // the new upload replaces the old one
  return { ok: true };
}
