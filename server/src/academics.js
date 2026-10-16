// Academics: subjects, exams, tests and marks. Nothing is taken on the platform - teachers create a test (or an exam paper)
// for a class and log the marks; students and parents then read the results. Routes (routes/academics.js) only check the
// feature and call these, so a future module (report cards, fees, parent panel...) can import and reuse them.
//
//   gradeOf(percent)                                 A+ / A / B / C / D / E / F  (pass mark = PASS_PERCENT)
//   accessibleClasses(user, schoolId)                classes this person may use (all, or only assigned ones)
//   getMeta(user, schoolId)                          sessions, subjects, exams, classes - everything the screens need to start
//   list/create/update/deleteSubject                 subjects of the school
//   list/create/update/deleteExam                    named exams of a session (Half-yearly, Final...)
//   listAssessments / createAssessment / updateAssessment / deleteAssessment     tests and exam papers of a class
//   getSheet(user, schoolId, id) / saveMarks(...)    the marks sheet of one test or paper
//   classReport(user, schoolId, classId, sessionId, scope)   per-student subject % + overall + rank
//   studentDashboard(schoolId, studentId, sessionId)         everything one student sees: summary, subjects, tests, exams
//   canSeeStudent / assertStudentAccess              who may open a student's results
import { db, httpError, check } from './db.js';
import { notifyMarks } from './notify.js';
import { todayStr, validDate, classRoster } from './attendance.js';

export const PASS_PERCENT = 33;
const GRADES = [[90, 'A+'], [80, 'A'], [70, 'B'], [60, 'C'], [50, 'D'], [33, 'E'], [0, 'F']];
export const gradeOf = (p) => (p === null || p === undefined ? null : GRADES.find(([min]) => p >= min)[1]);

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const pctOf = (o, m) => (m > 0 ? r1((o / m) * 100) : null);
const one = (x) => (Array.isArray(x) ? x[0] : x);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clsLabel = (c) => (c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : '');

// supabase returns max 1000 rows per request: read page by page
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
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// ---------------------------------------------------------------- running totals
const bucket = () => ({ obt: 0, max: 0, count: 0, absent: 0 });
const addTo = (b, marks, max, absent) => { if (absent) { b.absent += 1; return; } b.obt += marks; b.max += max; b.count += 1; };
const fin = (b) => { const pct = pctOf(b.obt, b.max); return { obtained: r2(b.obt), max: r2(b.max), count: b.count, absent: b.absent, pct, grade: gradeOf(pct) }; };

// ---------------------------------------------------------------- classes & access
export const hasAllClasses = (user) => user.features.includes('academics_all_classes');

export async function accessibleClasses(user, schoolId) {
  let classes;
  if (hasAllClasses(user)) {
    const { data, error } = await db.from('classes').select('id,name,section,level').eq('school_id', schoolId);
    check(error);
    classes = data;
  } else {
    const { data, error } = await db.from('class_teachers').select('classes(id,name,section,level)').eq('teacher_id', user.user_id).eq('school_id', schoolId);
    check(error);
    classes = data.map((x) => one(x.classes)).filter(Boolean);
  }
  return classes
    .map((c) => ({ ...c, label: clsLabel(c) }))
    .sort((a, b) => (a.level ?? 1e9) - (b.level ?? 1e9) || a.name.localeCompare(b.name, undefined, { numeric: true }) || a.section.localeCompare(b.section));
}

export async function assertClassAccess(user, schoolId, classId) {
  if (!classId) throw httpError(400, 'Choose a class');
  const { data, error } = await db.from('classes').select('id,name,section,level').eq('id', classId).eq('school_id', schoolId).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Class not found');
  if (!hasAllClasses(user)) {
    const { data: a } = await db.from('class_teachers').select('class_id').eq('class_id', classId).eq('teacher_id', user.user_id).maybeSingle();
    if (!a) throw httpError(403, 'This class is not assigned to you');
  }
  return { ...data, label: clsLabel(data) };
}

// a student, or a parent of that student, reads results without any feature (it is their own data)
export async function canSeeStudent(user, studentId) {
  if (user.user_id === studentId) return true;
  const { data } = await db.from('parent_students').select('student_id').eq('parent_id', user.user_id).eq('student_id', studentId).maybeSingle();
  return !!data;
}

// a teacher may open a student's results only if the student's class is one they can use
export async function assertStudentAccess(user, schoolId, studentId) {
  const { data } = await db.from('profiles').select('class_id').eq('user_id', studentId).eq('school_id', schoolId).maybeSingle();
  if (!data) throw httpError(404, 'Student not found');
  if (hasAllClasses(user)) return;
  const { data: a } = data.class_id ? await db.from('class_teachers').select('class_id').eq('class_id', data.class_id).eq('teacher_id', user.user_id).maybeSingle() : { data: null };
  if (!a) throw httpError(403, "This student's class is not assigned to you");
}

// ---------------------------------------------------------------- sessions
export async function listSessions(schoolId) {
  const { data, error } = await db.from('academic_sessions').select('id,name,start_date,end_date,is_current').eq('school_id', schoolId).order('start_date', { ascending: false });
  check(error);
  return data;
}
// a given session id (checked), or the current one, or null (= no session set up: nothing is filtered)
async function resolveSession(schoolId, sessionId) {
  if (sessionId === 'all') return null;
  if (sessionId) {
    if (!UUID.test(sessionId)) throw httpError(400, 'Unknown session');
    const { data } = await db.from('academic_sessions').select('id').eq('id', sessionId).eq('school_id', schoolId).maybeSingle();
    if (!data) throw httpError(404, 'Session not found');
    return data.id;
  }
  const { data } = await db.from('academic_sessions').select('id').eq('school_id', schoolId).eq('is_current', true).maybeSingle();
  return data?.id || null;
}

// ---------------------------------------------------------------- subjects
export async function listSubjects(schoolId) {
  const { data, error } = await db.from('subjects').select('id,name,code').eq('school_id', schoolId).order('name');
  check(error);
  return data;
}
function subjectFields(b) {
  const name = String(b.name || '').trim();
  if (!name) throw httpError(400, 'Subject name is required');
  if (name.length > 60) throw httpError(400, 'Subject name is too long');
  const code = String(b.code || '').trim().slice(0, 12) || null;
  return { name, code };
}
export async function createSubject(schoolId, b) {
  const { data, error } = await db.from('subjects').insert({ school_id: schoolId, ...subjectFields(b) }).select('id,name,code').single();
  if (error?.code === '23505') throw httpError(409, 'A subject with that name already exists');
  check(error);
  return data;
}
export async function updateSubject(schoolId, id, b) {
  const { data, error } = await db.from('subjects').update(subjectFields(b)).eq('id', id).eq('school_id', schoolId).select('id,name,code').maybeSingle();
  if (error?.code === '23505') throw httpError(409, 'A subject with that name already exists');
  check(error);
  if (!data) throw httpError(404, 'Subject not found');
  return data;
}
export async function deleteSubject(schoolId, id) {
  const { count, error } = await db.from('assessments').select('id', { count: 'exact', head: true }).eq('subject_id', id).eq('school_id', schoolId);
  check(error);
  if (count) throw httpError(409, `This subject has ${count} test${count === 1 ? '' : 's'} / exam paper${count === 1 ? '' : 's'}. Delete those first.`);
  const { error: e2 } = await db.from('subjects').delete().eq('id', id).eq('school_id', schoolId);
  check(e2);
}

// ---------------------------------------------------------------- exams
export async function listExams(schoolId) {
  const { data, error } = await db.from('exams').select('id,name,session_id,start_date,end_date').eq('school_id', schoolId).order('start_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
  check(error);
  return data;
}
async function examFields(schoolId, b, isNew) {
  const name = String(b.name || '').trim();
  if (!name) throw httpError(400, 'Exam name is required');
  if (name.length > 80) throw httpError(400, 'Exam name is too long');
  const start_date = b.start_date ? validDate(b.start_date, 'Start date') : null;
  const end_date = b.end_date ? validDate(b.end_date, 'End date') : null;
  if (start_date && end_date && end_date < start_date) throw httpError(400, 'The end date is before the start date');
  const f = { name, start_date, end_date };
  if (isNew) f.session_id = await resolveSession(schoolId, b.session_id);
  return f;
}
export async function createExam(schoolId, b) {
  const f = await examFields(schoolId, b, true);
  const { data, error } = await db.from('exams').insert({ school_id: schoolId, ...f }).select('id,name,session_id,start_date,end_date').single();
  if (error?.code === '23505') throw httpError(409, 'This session already has an exam with that name');
  check(error);
  return data;
}
export async function updateExam(schoolId, id, b) {
  const f = await examFields(schoolId, b, false);
  const { data, error } = await db.from('exams').update(f).eq('id', id).eq('school_id', schoolId).select('id,name,session_id,start_date,end_date').maybeSingle();
  if (error?.code === '23505') throw httpError(409, 'This session already has an exam with that name');
  check(error);
  if (!data) throw httpError(404, 'Exam not found');
  return data;
}
export async function deleteExam(schoolId, id) {
  const { count, error } = await db.from('assessments').select('id', { count: 'exact', head: true }).eq('exam_id', id).eq('school_id', schoolId);
  check(error);
  if (count) throw httpError(409, `This exam has ${count} paper${count === 1 ? '' : 's'} with marks attached. Delete those papers first.`);
  const { error: e2 } = await db.from('exams').delete().eq('id', id).eq('school_id', schoolId);
  check(e2);
}

// ---------------------------------------------------------------- meta (one call to start any screen)
export async function getMeta(user, schoolId) {
  const canTeach = user.features.includes('manage_assessments') || user.features.includes('view_academic_reports');
  const [sessions, subjects, exams, classes] = await Promise.all([
    listSessions(schoolId), listSubjects(schoolId), listExams(schoolId), canTeach ? accessibleClasses(user, schoolId) : [],
  ]);
  return { today: todayStr(), sessions, current_session_id: sessions.find((s) => s.is_current)?.id || null, subjects, exams, classes, pass_percent: PASS_PERCENT };
}

// ---------------------------------------------------------------- tests & exam papers
const A_SELECT = 'id,school_id,session_id,kind,exam_id,class_id,subject_id,title,test_date,max_marks,created_by,created_at,updated_at,subjects(name),exams(name),classes(name,section)';

async function statsFor(ids) {
  const map = new Map();
  for (const part of chunks(ids, 200)) {
    const { data, error } = await db.rpc('assessment_stats', { p_ids: part });
    check(error);
    (data || []).forEach((s) => map.set(s.assessment_id, s));
  }
  return map;
}
async function classSizes(schoolId, classIds) {
  const sizes = new Map();
  if (!classIds.length) return sizes;
  const rows = await fetchAll(() => db.from('profiles').select('class_id,extra,users!inner(is_active,role)')
    .eq('school_id', schoolId).in('class_id', classIds).eq('users.role', 'student').eq('users.is_active', true).order('user_id'));
  rows.filter((p) => p.extra?.graduated !== true).forEach((p) => sizes.set(p.class_id, (sizes.get(p.class_id) || 0) + 1));
  return sizes;
}
const shapeAssessment = (a, st, size) => {
  const max = Number(a.max_marks);
  return {
    id: a.id, kind: a.kind, exam_id: a.exam_id, exam_name: one(a.exams)?.name || null,
    class_id: a.class_id, class_label: clsLabel(one(a.classes)), subject_id: a.subject_id, subject_name: one(a.subjects)?.name || '',
    title: a.title, date: a.test_date, max_marks: max, session_id: a.session_id,
    entered: st?.entered ?? 0, absent: st?.absent ?? 0, total_students: size ?? 0,
    avg_pct: st?.avg_marks === null || st?.avg_marks === undefined ? null : pctOf(Number(st.avg_marks), max),
    highest: st?.hi === null || st?.hi === undefined ? null : Number(st.hi), lowest: st?.lo === null || st?.lo === undefined ? null : Number(st.lo),
    passed: st?.passed ?? 0,
  };
};

export async function listAssessments(user, schoolId, f = {}) {
  let classIds;
  if (f.class_id) { await assertClassAccess(user, schoolId, f.class_id); classIds = [f.class_id]; }
  else classIds = (await accessibleClasses(user, schoolId)).map((c) => c.id);
  if (!classIds.length) return [];
  const session = await resolveSession(schoolId, f.session_id);
  let q = db.from('assessments').select(A_SELECT).eq('school_id', schoolId).in('class_id', classIds)
    .order('test_date', { ascending: false }).order('created_at', { ascending: false }).limit(300);
  if (session) q = q.eq('session_id', session);
  if (f.subject_id) q = q.eq('subject_id', f.subject_id);
  if (f.kind === 'test' || f.kind === 'exam') q = q.eq('kind', f.kind);
  if (f.exam_id) q = q.eq('exam_id', f.exam_id);
  const { data, error } = await q;
  check(error);
  const [stats, sizes] = await Promise.all([statsFor(data.map((a) => a.id)), classSizes(schoolId, [...new Set(data.map((a) => a.class_id))])]);
  return data.map((a) => shapeAssessment(a, stats.get(a.id), sizes.get(a.class_id)));
}

async function loadAssessment(user, schoolId, id) {
  const { data, error } = await db.from('assessments').select(A_SELECT).eq('id', id).eq('school_id', schoolId).maybeSingle();
  check(error);
  if (!data || !data.class_id) throw httpError(404, 'Test not found');
  await assertClassAccess(user, schoolId, data.class_id);
  return data;
}

function maxMarksOf(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw httpError(400, 'Maximum marks must be more than 0');
  if (n > 1000) throw httpError(400, 'Maximum marks can be at most 1000');
  return r2(n);
}
const titleOf = (v) => {
  const t = String(v || '').trim();
  if (t.length > 120) throw httpError(400, 'Title is too long');
  return t;
};

export async function createAssessment(user, schoolId, b) {
  const kind = b.kind === 'exam' ? 'exam' : 'test';
  await assertClassAccess(user, schoolId, b.class_id);
  const { data: subj } = b.subject_id ? await db.from('subjects').select('id').eq('id', b.subject_id).eq('school_id', schoolId).maybeSingle() : { data: null };
  if (!subj) throw httpError(400, 'Choose a subject');
  let exam = null; let session_id;
  if (kind === 'exam') {
    const { data } = b.exam_id ? await db.from('exams').select('id,name,session_id,start_date').eq('id', b.exam_id).eq('school_id', schoolId).maybeSingle() : { data: null };
    if (!data) throw httpError(400, 'Choose an exam. Create exams first under Academics > Exams');
    exam = data; session_id = data.session_id;
  } else session_id = await resolveSession(schoolId, null);
  const title = titleOf(b.title) || (exam ? exam.name : '');
  if (!title) throw httpError(400, 'Give the test a title, e.g. "Unit test 1"');
  const test_date = validDate(b.date || exam?.start_date || todayStr(), 'Date');
  const row = { school_id: schoolId, session_id, kind, exam_id: exam?.id || null, class_id: b.class_id, subject_id: subj.id, title, test_date, max_marks: maxMarksOf(b.max_marks), created_by: user.user_id };
  const { data, error } = await db.from('assessments').insert(row).select(A_SELECT).single();
  if (error?.code === '23505') throw httpError(409, 'This exam already has a paper for that class and subject');
  check(error);
  return shapeAssessment(data, null, null);
}

export async function updateAssessment(user, schoolId, id, b) {
  const cur = await loadAssessment(user, schoolId, id);
  const patch = { updated_at: new Date().toISOString() };
  if (b.title !== undefined) { const t = titleOf(b.title); if (!t) throw httpError(400, 'Title is required'); patch.title = t; }
  if (b.date) patch.test_date = validDate(b.date, 'Date');
  if (b.subject_id && b.subject_id !== cur.subject_id) {
    const { data: s } = await db.from('subjects').select('id').eq('id', b.subject_id).eq('school_id', schoolId).maybeSingle();
    if (!s) throw httpError(400, 'Choose a subject');
    patch.subject_id = s.id;
  }
  if (b.max_marks !== undefined) {
    const max = maxMarksOf(b.max_marks);
    const { data: hi } = await db.from('assessment_marks').select('marks').eq('assessment_id', id).not('marks', 'is', null).order('marks', { ascending: false }).limit(1);
    if (hi?.length && Number(hi[0].marks) > max) throw httpError(400, `A student already has ${Number(hi[0].marks)} marks. Maximum cannot be below that.`);
    patch.max_marks = max;
  }
  const { error } = await db.from('assessments').update(patch).eq('id', id).eq('school_id', schoolId);
  if (error?.code === '23505') throw httpError(409, 'This exam already has a paper for that class and subject');
  check(error);
  return getSheet(user, schoolId, id);
}

export async function deleteAssessment(user, schoolId, id) {
  await loadAssessment(user, schoolId, id);
  const { error } = await db.from('assessments').delete().eq('id', id).eq('school_id', schoolId);
  check(error);
}

// ---------------------------------------------------------------- the marks sheet of one test
export async function getSheet(user, schoolId, id) {
  const a = await loadAssessment(user, schoolId, id);
  const [roster, marks, stats] = await Promise.all([
    classRoster(schoolId, a.class_id),
    fetchAll(() => db.from('assessment_marks').select('student_id,marks,is_absent').eq('assessment_id', id).order('student_id')),
    statsFor([id]),
  ]);
  const by = new Map(marks.map((m) => [m.student_id, m]));
  const students = roster.map((s) => {
    const m = by.get(s.student_id);
    return { student_id: s.student_id, full_name: s.full_name, roll_no: s.roll_no, marks: m && m.marks !== null ? Number(m.marks) : null, absent: !!m?.is_absent, entered: !!m };
  });
  return { assessment: shapeAssessment(a, stats.get(id), roster.length), students };
}

export async function saveMarks(user, schoolId, id, items) {
  const assessment = await loadAssessment(user, schoolId, id);
  if (!Array.isArray(items) || !items.length) throw httpError(400, 'Nothing to save');
  if (items.length > 500) throw httpError(400, 'Too many students in one save');
  const clean = items.map((x) => {
    if (!x || !UUID.test(String(x.student_id || ''))) throw httpError(400, 'Invalid student');
    const absent = x.absent === true;
    let marks = null;
    if (!absent && x.marks !== null && x.marks !== undefined && String(x.marks).trim() !== '') {
      marks = Number(x.marks);
      if (!Number.isFinite(marks) || marks < 0) throw httpError(400, 'Marks must be a number, 0 or more');
      marks = r2(marks);
    }
    return { student_id: x.student_id, marks, absent };
  });
  const { error } = await db.rpc('save_marks', { p_school: schoolId, p_assessment: id, p_user: user.user_id, p_items: clean });
  check(error);
  notifyMarks(schoolId, user, assessment, clean.filter((x) => x.marks !== null || x.absent).map((x) => x.student_id));
  return getSheet(user, schoolId, id);
}

// ---------------------------------------------------------------- class report
// scope: 'all' (default) | 'tests' | 'exams' | <exam id>
export async function classReport(user, schoolId, classId, sessionId, scope = 'all') {
  const cls = await assertClassAccess(user, schoolId, classId);
  const session = await resolveSession(schoolId, sessionId);
  let q = db.from('assessments').select('id,kind,exam_id,subject_id,max_marks,subjects(name)').eq('school_id', schoolId).eq('class_id', classId);
  if (session) q = q.eq('session_id', session);
  if (scope === 'tests') q = q.eq('kind', 'test');
  else if (scope === 'exams') q = q.eq('kind', 'exam');
  else if (UUID.test(scope)) q = q.eq('exam_id', scope);
  else if (scope !== 'all') throw httpError(400, 'Unknown report type');
  const { data: asm, error } = await q;
  check(error);

  const roster = await classRoster(schoolId, classId);
  const byAsm = new Map(asm.map((a) => [a.id, a]));
  const marks = [];
  for (const part of chunks(asm.map((a) => a.id), 100)) {
    marks.push(...await fetchAll(() => db.from('assessment_marks').select('assessment_id,student_id,marks,is_absent').in('assessment_id', part).order('assessment_id').order('student_id')));
  }

  const subjects = [...new Map(asm.map((a) => [a.subject_id, one(a.subjects)?.name || ''])).entries()]
    .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const per = new Map(roster.map((s) => [s.student_id, { total: bucket(), subj: new Map() }]));
  const subjTotals = new Map(subjects.map((s) => [s.id, bucket()]));
  for (const m of marks) {
    const a = byAsm.get(m.assessment_id); const p = per.get(m.student_id);
    if (!a || !p) continue; // student moved to another class / switched off
    const mk = m.marks === null ? 0 : Number(m.marks); const max = Number(a.max_marks);
    if (!p.subj.has(a.subject_id)) p.subj.set(a.subject_id, bucket());
    addTo(p.subj.get(a.subject_id), mk, max, m.is_absent);
    addTo(p.total, mk, max, m.is_absent);
    addTo(subjTotals.get(a.subject_id), mk, max, m.is_absent);
  }

  const students = roster.map((s) => {
    const p = per.get(s.student_id); const total = fin(p.total);
    const cells = {};
    subjects.forEach((sub) => { const b = p.subj.get(sub.id); if (b) { const f = fin(b); cells[sub.id] = { pct: f.pct, obtained: f.obtained, max: f.max, absent: f.absent }; } });
    return { student_id: s.student_id, full_name: s.full_name, roll_no: s.roll_no, subjects: cells, total, grade: total.grade, rank: null };
  });
  // rank by overall % (same % = same rank)
  const ranked = students.filter((s) => s.total.pct !== null).sort((a, b) => b.total.pct - a.total.pct);
  ranked.forEach((s, i) => { s.rank = i > 0 && s.total.pct === ranked[i - 1].total.pct ? ranked[i - 1].rank : i + 1; });

  const withData = students.filter((s) => s.total.pct !== null);
  return {
    class: { id: cls.id, label: cls.label }, session_id: session, scope,
    subjects, students,
    subject_avgs: Object.fromEntries(subjects.map((s) => [s.id, fin(subjTotals.get(s.id)).pct])),
    summary: {
      students: students.length, with_marks: withData.length, assessments: asm.length,
      class_avg: withData.length ? r1(withData.reduce((n, s) => n + s.total.pct, 0) / withData.length) : null,
      passed: withData.filter((s) => s.total.pct >= PASS_PERCENT).length,
      top: ranked.length ? { name: ranked[0].full_name, pct: ranked[0].total.pct } : null,
    },
    pass_percent: PASS_PERCENT,
  };
}

// ---------------------------------------------------------------- one student's dashboard
export async function studentDashboard(schoolId, studentId, sessionId) {
  const { data: st, error: e0 } = await db.from('users').select('user_id,login_id,role,school_id,profiles(full_name,roll_no,class_id,classes(name,section))').eq('user_id', studentId).eq('school_id', schoolId).maybeSingle();
  check(e0);
  if (!st || st.role !== 'student') throw httpError(404, 'Student not found');
  const prof = one(st.profiles) || {};
  const [sessions, session] = [await listSessions(schoolId), await resolveSession(schoolId, sessionId)];

  const make = () => {
    let q = db.from('assessment_marks')
      .select('marks,is_absent,assessment_id,assessments!inner(id,kind,exam_id,subject_id,title,test_date,max_marks,session_id,subjects(name),exams(name,start_date))')
      .eq('school_id', schoolId).eq('student_id', studentId);
    if (session) q = q.eq('assessments.session_id', session);
    return q.order('assessment_id');
  };
  const rows = await fetchAll(make);
  const stats = await statsFor(rows.map((r) => r.assessment_id));

  const entries = rows.map((r) => {
    const a = one(r.assessments); const max = Number(a.max_marks);
    const marks = r.marks === null ? null : Number(r.marks);
    const pct = r.is_absent || marks === null ? null : pctOf(marks, max);
    const avg = stats.get(a.id)?.avg_marks;
    return {
      id: a.id, kind: a.kind, exam_id: a.exam_id, exam_name: one(a.exams)?.name || null, exam_start: one(a.exams)?.start_date || null,
      subject_id: a.subject_id, subject: one(a.subjects)?.name || '', title: a.title, date: a.test_date, max_marks: max,
      marks, absent: r.is_absent, pct, grade: gradeOf(pct), class_avg_pct: avg === null || avg === undefined ? null : pctOf(Number(avg), max),
    };
  });
  const chrono = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  // summary + per subject
  const all = bucket(); const tests = bucket(); const exams = bucket();
  const subj = new Map();
  for (const e of [...entries].sort(chrono)) {
    const mk = e.marks ?? 0;
    addTo(all, mk, e.max_marks, e.absent); addTo(e.kind === 'test' ? tests : exams, mk, e.max_marks, e.absent);
    if (!subj.has(e.subject_id)) subj.set(e.subject_id, { subject_id: e.subject_id, name: e.subject, all: bucket(), tests: bucket(), exams: bucket(), recent: [] });
    const s = subj.get(e.subject_id);
    addTo(s.all, mk, e.max_marks, e.absent); addTo(e.kind === 'test' ? s.tests : s.exams, mk, e.max_marks, e.absent);
    if (e.pct !== null) s.recent.push({ date: e.date, title: e.title, kind: e.kind, pct: e.pct });
  }
  const subjects = [...subj.values()].map((s) => {
    const overall = fin(s.all);
    return { subject_id: s.subject_id, name: s.name, overall, tests: fin(s.tests), exams: fin(s.exams), recent: s.recent.slice(-8) };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // exams grouped by exam
  const ex = new Map();
  for (const e of entries.filter((x) => x.kind === 'exam')) {
    if (!ex.has(e.exam_id)) ex.set(e.exam_id, { exam_id: e.exam_id, name: e.exam_name, start_date: e.exam_start, papers: [], b: bucket() });
    const g = ex.get(e.exam_id);
    g.papers.push(e); addTo(g.b, e.marks ?? 0, e.max_marks, e.absent);
  }
  const examList = [...ex.values()].map((g) => ({
    exam_id: g.exam_id, name: g.name, start_date: g.start_date,
    papers: g.papers.sort((a, b) => a.subject.localeCompare(b.subject)),
    total: fin(g.b),
    failed: g.papers.filter((p) => p.pct !== null && p.pct < PASS_PERCENT).length,
  })).sort((a, b) => String(b.start_date || b.papers[0]?.date || '').localeCompare(String(a.start_date || a.papers[0]?.date || '')));

  return {
    student: { id: st.user_id, name: prof.full_name || st.login_id, roll_no: prof.roll_no ?? null, class_label: clsLabel(one(prof.classes)) },
    sessions, session_id: session,
    summary: { overall: fin(all), tests: fin(tests), exams: fin(exams) },
    subjects,
    tests: entries.filter((e) => e.kind === 'test').sort((a, b) => chrono(b, a)),
    exams: examList,
    pass_percent: PASS_PERCENT,
  };
}
