// 360-degree student profile: ONE call that gathers everything the school knows about a student
// (personal + family, fees, attendance, marks, homework, documents) by re-using the existing modules,
// so permissions and numbers always match what those modules show on their own screens.
import { db, httpError, check } from './db.js';
import { isSuper } from './auth.js';
import * as Fees from './fees.js';
import * as Att from './attendance.js';
import * as Acad from './academics.js';
import * as Transport from './transport.js';

const one = (x) => (Array.isArray(x) ? x[0] : x);
const FEE_STAFF = ['view_student_fees', 'collect_fees', 'adjust_fees'];
const TRANSPORT_STAFF = ['view_transport', 'manage_transport', 'assign_transport'];
const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: e.message || 'Unavailable' }; } };

// which school the student belongs to (a super admin has no school of their own)
async function studentRow(studentId) {
  const { data, error } = await db.from('profiles').select('*, classes(name,section), users!inner(login_id,is_active,role,school_id)').eq('user_id', studentId).maybeSingle();
  check(error);
  const u = data && one(data.users);
  if (!data || !u || u.role !== 'student') throw httpError(404, 'Student not found');
  return { p: data, u, cls: one(data.classes) };
}

// family (the student or a linked parent) always may; staff need the feature + a class they can use
export async function resolveAccess(user, studentId) {
  const row = await studentRow(studentId);
  const school = row.u.school_id;
  if (await Att.canSeeStudent(user, studentId)) {
    if (user.school_id !== school) throw httpError(403, 'Not allowed');
    return { ...row, school, family: true };
  }
  if (!user.features.includes('view_student_profile')) throw httpError(403, 'You do not have access to student profiles');
  const superUser = isSuper({ user }); // isSuper() takes the request, not the user
  if (!superUser && user.school_id !== school) throw httpError(404, 'Student not found');
  if (!superUser) await Att.assertStudentAccess(user, school, studentId);
  return { ...row, school, family: false };
}

export async function myStudents(user) {
  let ids = [];
  if (user.role === 'student') ids = [user.user_id];
  else {
    const { data, error } = await db.from('parent_students').select('student_id').eq('parent_id', user.user_id);
    check(error);
    ids = data.map((x) => x.student_id);
  }
  if (!ids.length) return [];
  const { data, error } = await db.from('profiles').select('user_id,full_name,roll_no,classes(name,section)').in('user_id', ids);
  check(error);
  return data.map((p) => ({ student_id: p.user_id, full_name: p.full_name, roll_no: p.roll_no, class_label: p.classes ? `${one(p.classes).name}${one(p.classes).section ? ` ${one(p.classes).section}` : ''}` : null }))
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
}

async function parentsOf(studentId) {
  const { data, error } = await db.from('parent_students').select('parent_id').eq('student_id', studentId);
  check(error);
  if (!data.length) return [];
  const { data: ps, error: e2 } = await db.from('profiles').select('user_id,full_name,phone,email').in('user_id', data.map((x) => x.parent_id));
  check(e2);
  return ps.map((p) => ({ user_id: p.user_id, full_name: p.full_name, phone: p.phone, email: p.email }));
}

async function homeworkOf(school, studentId, classId) {
  if (!classId) return { total: 0, submitted: 0, checked: 0, pending: 0, overdue: 0, items: [] };
  const { data, error } = await db.from('assignments').select('id,title,subject,due_date,needs_submission,created_at').eq('school_id', school).eq('class_id', classId).order('created_at', { ascending: false }).limit(40);
  check(error);
  const { data: subs, error: e2 } = data.length
    ? await db.from('assignment_submissions').select('assignment_id,status,marks,submitted_at,is_late').eq('student_id', studentId).in('assignment_id', data.map((a) => a.id))
    : { data: [], error: null };
  check(e2);
  const by = new Map(subs.map((s) => [s.assignment_id, s]));
  const today = Att.todayStr();
  const items = data.map((a) => {
    const my = by.get(a.id) || null;
    let state = 'info'; // homework that needs no submission
    if (a.needs_submission) state = my ? (my.status === 'checked' ? 'checked' : 'submitted') : (a.due_date && a.due_date < today ? 'overdue' : 'pending');
    return { id: a.id, title: a.title, subject: a.subject, due_date: a.due_date, state, late: !!my?.is_late, marks: my?.marks ?? null };
  });
  const count = (s) => items.filter((i) => i.state === s).length;
  return { total: items.length, submitted: count('submitted') + count('checked'), checked: count('checked'), pending: count('pending'), overdue: count('overdue'), items: items.slice(0, 12) };
}

async function documentsOf(school, studentId) {
  const { data, error } = await db.from('issued_documents').select('id,doc_type,serial_no,title,status,issued_at').eq('school_id', school).eq('subject_id', studentId).order('issued_at', { ascending: false }).limit(10);
  check(error);
  return data;
}

// colourful at-a-glance chips, worked out from the numbers (plus any tags the school saved in profile.extra.tags)
function tagsFor({ extra, attendance, academics, fees, homework }) {
  const t = [];
  const ap = attendance?.summary?.percent;
  if (ap !== null && ap !== undefined) t.push(ap >= 90 ? { label: 'Regular', tone: 'ok' } : ap < 75 ? { label: 'Low attendance', tone: 'bad' } : { label: 'Attendance watch', tone: 'warn' });
  const mp = academics?.summary?.overall?.pct;
  if (mp !== null && mp !== undefined) t.push(mp >= 85 ? { label: 'Top performer', tone: 'ok' } : mp < 40 ? { label: 'Needs support', tone: 'bad' } : null);
  if (fees?.ledger?.totals?.due_till_date > 0) t.push({ label: 'Fee due', tone: 'bad' });
  else if (fees?.ledger?.totals && fees.ledger.totals.pending === 0 && fees.ledger.totals.total > 0) t.push({ label: 'Fees cleared', tone: 'ok' });
  if (homework?.overdue > 0) t.push({ label: `${homework.overdue} homework overdue`, tone: 'warn' });
  for (const x of Array.isArray(extra?.tags) ? extra.tags : []) t.push({ label: String(x).slice(0, 30), tone: 'info' });
  return t.filter(Boolean);
}

export async function buildProfile(user, studentId, sessionId) {
  const a = await resolveAccess(user, studentId);
  const { p, u, cls, school, family } = a;
  const canFees = family || FEE_STAFF.some((f) => user.features.includes(f));
  const canTransport = family || TRANSPORT_STAFF.some((f) => user.features.includes(f));

  const [parents, attendance, academics, homework, documents, fees, transport] = await Promise.all([
    safe(() => parentsOf(studentId)),
    safe(() => Att.studentReport(school, studentId)),
    safe(() => Acad.studentDashboard(school, studentId, sessionId)),
    safe(() => homeworkOf(school, studentId, p.class_id)),
    safe(() => documentsOf(school, studentId)),
    canFees ? safe(() => Fees.accountView(school, studentId, sessionId, false)) : Promise.resolve(null),
    canTransport ? safe(() => Transport.studentTransport(school, studentId)) : Promise.resolve(null),
  ]);
  const ok = (x) => (x && !x.error ? x : null);

  if (fees && !fees.error) fees.payments = (fees.payments || []).slice(0, 6); // latest receipts only
  const extra = p.extra && typeof p.extra === 'object' ? p.extra : {};
  const T = { extra, attendance: ok(attendance), academics: ok(academics), fees: ok(fees), homework: ok(homework) };

  return {
    viewer: { family, can_fees: canFees, can_transport: canTransport },
    student: {
      student_id: p.user_id, full_name: p.full_name || u.login_id, login_id: u.login_id, active: u.is_active, graduated: extra.graduated === true,
      class_label: cls ? `${cls.name}${cls.section ? ` ${cls.section}` : ''}` : null, roll_no: p.roll_no, admission_no: p.admission_no,
      dob: p.dob, gender: p.gender, blood_group: p.blood_group, address: p.address, phone: p.phone, email: p.email,
      father_name: p.father_name, mother_name: p.mother_name, father_phone: p.father_phone, mother_phone: p.mother_phone,
      father_occupation: p.father_occupation, mother_occupation: p.mother_occupation,
      emergency_contact_name: p.emergency_contact_name, emergency_contact_phone: p.emergency_contact_phone,
    },
    tags: tagsFor(T),
    parents, attendance, academics, homework, documents, fees, transport,
  };
}
