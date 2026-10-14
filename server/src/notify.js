// Notifications: every event that matters (notice, message, homework, marks, fees, document, leave, or a plain
// "send notification") ends up here. Two things happen for each person:
//   1. a row in `notifications`  -> the in-app inbox + bell (always works, even without push)
//   2. a push to their phone(s)  -> through Expo's push service (works once the phone has registered a token)
// Nothing in here ever throws into the caller: a notification problem must never break posting a notice or saving marks.
import { db } from './db.js';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const DEDUPE_HOURS = 6;
const one = (x) => (Array.isArray(x) ? x[0] : x);
const short = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const chunks = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const uniq = (a) => [...new Set(a.filter(Boolean))];
const errText = (e) => (e && e.message) || String(e);

/* ------------------------------------------------------------------ who should get it */
export async function schoolUserIds(schoolId, roles) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from('users').select('user_id').eq('school_id', schoolId).eq('is_active', true).neq('role', 'super_admin');
    if (roles?.length) q = q.in('role', roles);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out.push(...data.map((x) => x.user_id));
    if (data.length < 1000) break;
  }
  return out;
}
export async function classStudentIds(schoolId, classIds) {
  if (!classIds?.length) return [];
  const { data, error } = await db.from('profiles').select('user_id,extra,users!inner(role,is_active)')
    .eq('school_id', schoolId).in('class_id', classIds).eq('users.role', 'student').eq('users.is_active', true).limit(5000);
  if (error) throw error;
  return data.filter((p) => p.extra?.graduated !== true).map((p) => p.user_id);
}
export async function parentIdsOf(studentIds) {
  const out = [];
  for (const part of chunks(uniq(studentIds), 150)) {
    const { data, error } = await db.from('parent_students').select('parent_id').in('student_id', part);
    if (error) throw error;
    out.push(...data.map((x) => x.parent_id));
  }
  return uniq(out);
}
export async function classTeacherIds(classIds) {
  if (!classIds?.length) return [];
  const { data, error } = await db.from('class_teachers').select('teacher_id').in('class_id', classIds);
  if (error) throw error;
  return uniq(data.map((x) => x.teacher_id));
}
// students + their parents (+ the class teachers) of some classes
export async function classAudience(schoolId, classIds, { teachers = true } = {}) {
  const students = await classStudentIds(schoolId, classIds);
  const [parents, staff] = await Promise.all([parentIdsOf(students), teachers ? classTeacherIds(classIds) : []]);
  return uniq([...students, ...parents, ...staff]);
}
// a student and the parents linked to him / her
async function familyOf(studentIds) { const ids = uniq(studentIds); return uniq([...ids, ...(await parentIdsOf(ids))]); }

/* ------------------------------------------------------------------ deliver */
// userIds: who. n: { school_id, kind, title, body, module, view, by, dedupe }.  Returns how many people were notified.
export async function notify(userIds, n) {
  let ids = uniq(userIds).filter((id) => id !== n.by);
  if (!ids.length) return 0;

  if (n.dedupe) { // the same event (e.g. marks re-saved) should not buzz people again within a few hours
    const since = new Date(Date.now() - DEDUPE_HOURS * 3600e3).toISOString(); const seen = new Set();
    for (const part of chunks(ids, 150)) {
      const { data } = await db.from('notifications').select('user_id').in('user_id', part).eq('dedupe_key', n.dedupe).gte('created_at', since);
      (data || []).forEach((r) => seen.add(r.user_id));
    }
    ids = ids.filter((id) => !seen.has(id));
    if (!ids.length) return 0;
  }

  const title = short(n.title, 100) || 'School update'; const body = short(n.body, 240) || null;
  const rows = ids.map((user_id) => ({ school_id: n.school_id || null, user_id, kind: n.kind || 'general', title, body, module: n.module || null, view: n.view || null, dedupe_key: n.dedupe || null, created_by: n.by || null }));
  for (const part of chunks(rows, 500)) { const { error } = await db.from('notifications').insert(part); if (error) throw error; }

  await push(ids, { title, body: body || '', data: { module: n.module || null, view: n.view || null, kind: n.kind || 'general' } }).catch((e) => console.warn('push failed:', errText(e)));
  return ids.length;
}

async function push(userIds, { title, body, data }) {
  const tokens = [];
  for (const part of chunks(userIds, 150)) {
    const { data: t, error } = await db.from('push_tokens').select('token').in('user_id', part);
    if (error) throw error;
    tokens.push(...t.map((x) => x.token));
  }
  for (const part of chunks(uniq(tokens), 100)) {
    const messages = part.map((to) => ({ to, title, body, data, sound: 'default', priority: 'high', channelId: 'default' }));
    const res = await fetch(EXPO_URL, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(messages) });
    const j = await res.json().catch(() => ({}));
    const dead = [];
    (j.data || []).forEach((t, i) => { if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') dead.push(part[i]); });
    if (dead.length) await db.from('push_tokens').delete().in('token', dead); // the app was uninstalled: forget that phone
  }
}

/* ------------------------------------------------------------------ one helper per event (fire and forget) */
const bg = (fn) => (...a) => { Promise.resolve().then(() => fn(...a)).catch((e) => console.warn('notify failed:', errText(e))); };
const nameOf = (u) => u?.profile?.full_name || u?.login_id || 'Someone';

export const notifyNotice = bg(async (schoolId, user, { title, body, audience, classIds }) => {
  const to = audience === 'school' ? await schoolUserIds(schoolId) : await classAudience(schoolId, classIds);
  await notify(to, { school_id: schoolId, by: user.user_id, kind: 'notice', title: `New notice: ${title}`, body, module: 'communication', view: 'board' });
});
export const notifyMessage = bg(async (schoolId, user, toId, text) => {
  await notify([toId], { school_id: schoolId, by: user.user_id, kind: 'message', title: nameOf(user), body: text, module: 'communication', view: 'messages' });
});
export const notifyHomework = bg(async (schoolId, user, { class_id, title, subject, needs, due }) => {
  const students = await classStudentIds(schoolId, [class_id]);
  const bits = [subject, needs ? 'Submission needed' : 'Study material', due ? `due ${due}` : ''].filter(Boolean).join(' · ');
  await notify(students, { school_id: schoolId, by: user.user_id, kind: 'homework', title: `New homework: ${title}`, body: bits, module: 'homework', view: 'my' });
});
export const notifyChecked = bg(async (schoolId, user, studentId, { title, marks }) => {
  await notify([studentId], { school_id: schoolId, by: user.user_id, kind: 'homework', title: `Homework checked: ${title}`, body: marks ? `Marks: ${marks}` : 'Your teacher has checked your work', module: 'homework', view: 'my' });
});
export const notifyMarks = bg(async (schoolId, user, assessment, studentIds) => {
  const to = await familyOf(studentIds); const subject = one(assessment.subjects)?.name;
  await notify(to, { school_id: schoolId, by: user.user_id, kind: 'marks', title: `Marks added: ${assessment.title}`, body: subject ? `${subject} marks are now in Academics` : 'Marks are now in Academics', module: 'academics', view: 'my', dedupe: `marks:${assessment.id}` });
});
export const notifyFee = bg(async (schoolId, user, studentId, amount) => {
  await notify(await familyOf([studentId]), { school_id: schoolId, by: user.user_id, kind: 'fees', title: 'Fee payment received', body: `Rs. ${Number(amount).toLocaleString('en-IN')} was recorded. The receipt is in Fees.`, module: 'fees', view: 'my' });
});
export const notifyDocument = bg(async (schoolId, user, personId, title) => {
  await notify(await familyOf([personId]), { school_id: schoolId, by: user.user_id, kind: 'document', title: `Document issued: ${title}`, body: 'You can open and download it from Documents.', module: 'documents', view: 'my' });
});
export const notifyLeave = bg(async (schoolId, byId, userId, status, note) => {
  await notify([userId], { school_id: schoolId, by: byId, kind: 'leave', title: `Leave ${status}`, body: note || '', module: 'payroll', view: 'my' });
});
