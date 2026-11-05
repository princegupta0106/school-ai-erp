// Exams & Report Cards (simple version).
//   Every class has its own list of exams (e.g. 10th: PT1, PT2, Preboard - 8th: PT1, Half Yearly, PT2, Annual).
//   A teacher enters marks for the subjects he teaches in a class, per exam. The report card is built from those marks.
//
//   exam_structure            the exams of a class (name + max marks)
//   assessments (exam_struct_id)  marks of one exam + one subject (created automatically on the first save)
//   computeClass              totals, percentage, grade, rank, Pass / Fail for a whole class
//   report_cards              published (frozen) report cards that students and parents see
import { db, httpError, check } from './db.js';
import * as A from './academics.js';
import * as CS from './classSubjects.js';
import { classRoster, todayStr } from './attendance.js';
import { notify, parentIdsOf } from './notify.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const one = (x) => (Array.isArray(x) ? x[0] : x);
const clean = (v, max, what) => { const s = String(v ?? '').trim(); if (s.length > max) throw httpError(400, `${what} is too long`); return s; };
const num = (v, what, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw httpError(400, `${what} must be between ${lo} and ${hi}`); return r2(n); };
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
async function fetchAll(make) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    check(error); rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// CBSE style 9-point scale, used until the school sets its own
export const DEFAULT_GRADES = [
  { min_pct: 91, max_pct: 100, grade: 'A1', grade_point: 10, remark: 'Outstanding', is_fail: false },
  { min_pct: 81, max_pct: 90.99, grade: 'A2', grade_point: 9, remark: 'Excellent', is_fail: false },
  { min_pct: 71, max_pct: 80.99, grade: 'B1', grade_point: 8, remark: 'Very good', is_fail: false },
  { min_pct: 61, max_pct: 70.99, grade: 'B2', grade_point: 7, remark: 'Good', is_fail: false },
  { min_pct: 51, max_pct: 60.99, grade: 'C1', grade_point: 6, remark: 'Above average', is_fail: false },
  { min_pct: 41, max_pct: 50.99, grade: 'C2', grade_point: 5, remark: 'Average', is_fail: false },
  { min_pct: 33, max_pct: 40.99, grade: 'D', grade_point: 4, remark: 'Needs improvement', is_fail: false },
  { min_pct: 0, max_pct: 32.99, grade: 'E', grade_point: 0, remark: 'Needs support', is_fail: true },
];
const rangeFor = (ranges, pct) => (pct === null || pct === undefined ? null : [...ranges].sort((a, b) => b.min_pct - a.min_pct).find((g) => pct >= g.min_pct) || null);

async function currentSession(schoolId) {
  const { data } = await db.from('academic_sessions').select('id,name,start_date,end_date').eq('school_id', schoolId).eq('is_current', true).maybeSingle();
  return data || null;
}

// ---------------------------------------------------------------- exam structure (per class)
const S_COLS = 'id,class_id,name,max_marks,sort';
const shapeEx = (e) => ({ ...e, max_marks: Number(e.max_marks) });
export async function listStructure(schoolId, classIds) {
  let q = db.from('exam_structure').select(S_COLS).eq('school_id', schoolId).order('sort').order('created_at');
  if (classIds) { if (!classIds.length) return []; q = q.in('class_id', classIds); }
  const { data, error } = await q; check(error);
  return data.map(shapeEx);
}
async function loadExam(schoolId, id) {
  if (!UUID.test(String(id || ''))) throw httpError(400, 'Choose an exam');
  const { data, error } = await db.from('exam_structure').select(S_COLS).eq('id', id).eq('school_id', schoolId).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Exam not found');
  return shapeEx(data);
}

// Replaces the exam list of one or more classes (several sections of the same class get the same list).
// An item with an id of that class is renamed / edited in place, otherwise it is matched by name, otherwise it is new.
// Exams left out of the list are removed together with their marks.
export async function saveStructure(user, schoolId, b) {
  const classIds = [...new Set((Array.isArray(b.class_ids) ? b.class_ids : []).filter((x) => UUID.test(String(x))))];
  if (!classIds.length) throw httpError(400, 'Choose a class');
  if (classIds.length > 100) throw httpError(400, 'Too many classes');
  if (!Array.isArray(b.items) || b.items.length > 20) throw httpError(400, 'A class can have at most 20 exams');
  const items = b.items.map((x) => {
    const name = clean(x?.name, 40, 'Exam name'); if (!name) throw httpError(400, 'Every exam needs a name');
    return { id: x.id && UUID.test(String(x.id)) ? x.id : null, name, max_marks: num(x.max_marks ?? 100, 'Max marks', 1, 1000) };
  });
  const seen = new Set();
  items.forEach((x) => { const k = x.name.toLowerCase(); if (seen.has(k)) throw httpError(400, `"${x.name}" is listed twice`); seen.add(k); });
  const { data: cls, error: ce } = await db.from('classes').select('id').eq('school_id', schoolId).in('id', classIds); check(ce);
  if (cls.length !== classIds.length) throw httpError(400, 'Unknown class');
  for (const id of classIds) await A.assertClassAccess(user, schoolId, id);

  for (const classId of classIds) {
    const { data: ex, error } = await db.from('exam_structure').select(S_COLS).eq('school_id', schoolId).eq('class_id', classId); check(error);
    const byId = new Map(ex.map((e) => [e.id, e])); const byName = new Map(ex.map((e) => [e.name.toLowerCase(), e]));
    const keep = new Set(); const plan = [];
    items.forEach((x, i) => {
      let cur = (x.id && byId.get(x.id)) || byName.get(x.name.toLowerCase()) || null;
      if (cur && keep.has(cur.id)) cur = null;
      if (cur) keep.add(cur.id);
      plan.push({ cur, x, i });
    });
    // 1. remove exams that are no longer listed (their marks go with them)
    const drop = ex.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (drop.length) check((await db.from('exam_structure').delete().in('id', drop).eq('school_id', schoolId)).error);
    // 2. edit the ones that stay (never below a mark that is already entered)
    for (const { cur, x, i } of plan.filter((p) => p.cur)) {
      if (Number(cur.max_marks) > x.max_marks) {
        const { data: as } = await db.from('assessments').select('id').eq('exam_struct_id', cur.id);
        if (as?.length) {
          const { data: hi } = await db.from('assessment_marks').select('marks').in('assessment_id', as.map((a) => a.id)).not('marks', 'is', null).order('marks', { ascending: false }).limit(1);
          if (hi?.length && Number(hi[0].marks) > x.max_marks) throw httpError(400, `${x.name}: a student already has ${Number(hi[0].marks)} marks, so the maximum cannot be below that.`);
        }
      }
      const { error: ue } = await db.from('exam_structure').update({ name: x.name, max_marks: x.max_marks, sort: i }).eq('id', cur.id).eq('school_id', schoolId);
      if (ue?.code === '23505') throw httpError(409, 'Two exams have the same name');
      check(ue);
      await db.from('assessments').update({ title: x.name, max_marks: x.max_marks }).eq('exam_struct_id', cur.id);
    }
    // 3. add the new ones
    const fresh = plan.filter((p) => !p.cur).map(({ x, i }) => ({ school_id: schoolId, class_id: classId, name: x.name, max_marks: x.max_marks, sort: i }));
    if (fresh.length) {
      const { error: ie } = await db.from('exam_structure').insert(fresh);
      if (ie?.code === '23505') throw httpError(409, 'Two exams have the same name');
      check(ie);
    }
  }
  return listStructure(schoolId, classIds);
}

// ---------------------------------------------------------------- grading (one scale for the school)
const numify = (g) => ({ ...g, min_pct: Number(g.min_pct), max_pct: Number(g.max_pct), grade_point: Number(g.grade_point) });
export async function getGrading(schoolId) {
  const { data, error } = await db.from('exam_grade_ranges').select('id,min_pct,max_pct,grade,grade_point,remark,is_fail,sort').eq('school_id', schoolId).is('term_id', null).order('min_pct', { ascending: false });
  check(error);
  return data.length ? { ranges: data.map(numify), scope: 'school' } : { ranges: DEFAULT_GRADES, scope: 'default' };
}
export async function saveGrading(schoolId, ranges) {
  if (!Array.isArray(ranges) || !ranges.length) throw httpError(400, 'Add at least one grade range');
  if (ranges.length > 20) throw httpError(400, 'Too many grade ranges');
  const rows = ranges.map((g, i) => {
    const min_pct = num(g.min_pct, 'From %', 0, 100); const max_pct = num(g.max_pct, 'To %', 0, 100);
    if (max_pct < min_pct) throw httpError(400, `Grade ${g.grade || i + 1}: "To" is below "From"`);
    const grade = clean(g.grade, 6, 'Grade'); if (!grade) throw httpError(400, 'Every range needs a grade');
    return { school_id: schoolId, term_id: null, min_pct, max_pct, grade, grade_point: num(g.grade_point ?? 0, 'Grade point', 0, 100), remark: clean(g.remark, 40, 'Remark') || null, is_fail: g.is_fail === true, sort: i };
  });
  const s = [...rows].sort((a, b) => a.min_pct - b.min_pct);
  for (let i = 1; i < s.length; i++) if (s[i].min_pct <= s[i - 1].max_pct) throw httpError(400, `Ranges ${s[i - 1].grade} and ${s[i].grade} overlap`);
  check((await db.from('exam_grade_ranges').delete().eq('school_id', schoolId).is('term_id', null)).error);
  check((await db.from('exam_grade_ranges').insert(rows)).error);
  return getGrading(schoolId);
}
export async function resetGrading(schoolId) {
  check((await db.from('exam_grade_ranges').delete().eq('school_id', schoolId).is('term_id', null)).error);
  return getGrading(schoolId);
}

// ---------------------------------------------------------------- meta
export async function getMeta(user, schoolId) {
  const [classes, grading, subjects, class_subjects, my_combos] = await Promise.all([
    A.accessibleClasses(user, schoolId), getGrading(schoolId),
    db.from('subjects').select('id,name,code').eq('school_id', schoolId).order('name').then((r) => { check(r.error); return r.data; }),
    CS.classSubjectMap(schoolId), CS.myCombos(user.user_id, schoolId),
  ]);
  const structure = await listStructure(schoolId, classes.map((c) => c.id));
  return { today: todayStr(), classes, structure, grading, subjects, class_subjects, my_combos, all_classes: A.hasAllClasses(user) };
}

// ---------------------------------------------------------------- marks entry
const subjectsOfClass = (csMap, subjects, classId) => { const l = csMap[classId]; return l?.length ? subjects.filter((s) => l.includes(s.id)) : subjects; };
async function canEditCombo(user, schoolId, classId, subjectId) {
  try { await CS.assertCombo(user, schoolId, classId, subjectId, A.hasAllClasses(user)); return true; } catch { return false; }
}

// one class: its exams, its subjects (with "can this user enter marks"), and how many marks are in for each exam + subject
export async function marksOverview(user, schoolId, classId) {
  const cls = await A.assertClassAccess(user, schoolId, classId);
  const [exams, subs, csMap, assessments, roster] = await Promise.all([
    listStructure(schoolId, [cls.id]),
    db.from('subjects').select('id,name').eq('school_id', schoolId).order('name').then((r) => { check(r.error); return r.data; }),
    CS.classSubjectMap(schoolId),
    db.from('assessments').select('id,subject_id,exam_struct_id').eq('school_id', schoolId).eq('class_id', cls.id).not('exam_struct_id', 'is', null).then((r) => { check(r.error); return r.data; }),
    classRoster(schoolId, cls.id),
  ]);
  const subjects = [];
  for (const s of subjectsOfClass(csMap, subs, cls.id)) subjects.push({ id: s.id, name: s.name, can_edit: await canEditCombo(user, schoolId, cls.id, s.id) });
  const stats = new Map();
  if (assessments.length) { const r = await db.rpc('assessment_stats', { p_ids: assessments.map((a) => a.id) }); check(r.error); (r.data || []).forEach((s) => stats.set(s.assessment_id, s)); }
  const cells = {};
  assessments.forEach((a) => { const s = stats.get(a.id); cells[`${a.exam_struct_id}:${a.subject_id}`] = { entered: s?.entered || 0, absent: s?.absent || 0 }; });
  return { class: { id: cls.id, label: cls.label }, exams, subjects, size: roster.length, cells };
}

async function findAssessment(schoolId, structId, subjectId) {
  const { data, error } = await db.from('assessments').select('id').eq('school_id', schoolId).eq('exam_struct_id', structId).eq('subject_id', subjectId).maybeSingle();
  check(error); return data;
}
async function subjectOf(schoolId, id) {
  if (!UUID.test(String(id || ''))) throw httpError(400, 'Choose a subject');
  const { data } = await db.from('subjects').select('id,name').eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (!data) throw httpError(400, 'Choose a subject');
  return data;
}
export async function getSheet(user, schoolId, structId, subjectId) {
  const ex = await loadExam(schoolId, structId);
  const cls = await A.assertClassAccess(user, schoolId, ex.class_id);
  const subject = await subjectOf(schoolId, subjectId);
  const a = await findAssessment(schoolId, ex.id, subject.id);
  const [roster, marks, can_edit] = await Promise.all([
    classRoster(schoolId, cls.id),
    a ? fetchAll(() => db.from('assessment_marks').select('student_id,marks,is_absent,remark').eq('assessment_id', a.id).order('student_id')) : [],
    canEditCombo(user, schoolId, cls.id, subject.id),
  ]);
  const by = new Map(marks.map((m) => [m.student_id, m]));
  return {
    exam: { id: ex.id, name: ex.name, max_marks: ex.max_marks }, class: { id: cls.id, label: cls.label }, subject, can_edit,
    students: roster.map((s) => { const m = by.get(s.student_id); return { student_id: s.student_id, full_name: s.full_name, roll_no: s.roll_no, marks: m && m.marks !== null ? Number(m.marks) : null, absent: !!m?.is_absent, remark: m?.remark || '' }; }),
  };
}
export async function saveMarks(user, schoolId, structId, subjectId, items) {
  const ex = await loadExam(schoolId, structId);
  await A.assertClassAccess(user, schoolId, ex.class_id);
  const subject = await subjectOf(schoolId, subjectId);
  await CS.assertCombo(user, schoolId, ex.class_id, subject.id, A.hasAllClasses(user));
  if (!Array.isArray(items) || !items.length) throw httpError(400, 'Nothing to save');
  items.forEach((x) => { if (!x.absent && x.marks !== null && x.marks !== undefined && x.marks !== '' && Number(x.marks) > ex.max_marks) throw httpError(400, `Marks cannot be more than ${ex.max_marks}`); });
  let a = await findAssessment(schoolId, ex.id, subject.id);
  if (!a) {
    const session = await currentSession(schoolId);
    const { data, error } = await db.from('assessments').insert({ school_id: schoolId, session_id: session?.id || null, kind: 'test', exam_id: null, class_id: ex.class_id, subject_id: subject.id, title: ex.name, test_date: todayStr(), max_marks: ex.max_marks, exam_struct_id: ex.id, created_by: user.user_id }).select('id').single();
    if (error?.code === '23505') a = await findAssessment(schoolId, ex.id, subject.id); else { check(error); a = data; }
  }
  await A.saveMarks(user, schoolId, a.id, items.map((x) => ({ student_id: x.student_id, marks: x.marks, absent: x.absent })));
  for (const part of chunks(items.filter((x) => x.remark !== undefined), 25)) {
    await Promise.all(part.map((x) => db.from('assessment_marks').update({ remark: clean(x.remark, 120, 'Remark') || null }).eq('assessment_id', a.id).eq('student_id', x.student_id)));
  }
  return getSheet(user, schoolId, structId, subjectId);
}

// ---------------------------------------------------------------- the calculation
async function sharedCtx(schoolId) {
  const [grading, subjects, csMap, structure] = await Promise.all([
    getGrading(schoolId),
    db.from('subjects').select('id,name').eq('school_id', schoolId).then((r) => { check(r.error); return new Map(r.data.map((s) => [s.id, s])); }),
    CS.classSubjectMap(schoolId), listStructure(schoolId),
  ]);
  return { ranges: grading.ranges, subjects, csMap, structure };
}

// Per subject: total = sum of the marks of the exams entered, % = total / their max. Absent counts as 0.
// Per student: total / % over every subject. A student is "complete" when every exam of every subject has marks;
// only then is Pass / Fail decided (Fail = a subject in a fail grade) and a rank given.
async function computeClass(schoolId, cls, ctx) {
  const exams = ctx.structure.filter((e) => e.class_id === cls.id);
  const list = exams.length ? await fetchAll(() => db.from('assessments').select('id,subject_id,exam_struct_id').eq('school_id', schoolId).eq('class_id', cls.id).in('exam_struct_id', exams.map((e) => e.id)).order('id')) : [];
  const aMap = new Map(list.map((a) => [`${a.exam_struct_id}:${a.subject_id}`, a.id]));
  const roster = await classRoster(schoolId, cls.id);
  const marks = new Map();
  for (const part of chunks(list.map((a) => a.id), 150)) {
    const rows = await fetchAll(() => db.from('assessment_marks').select('assessment_id,student_id,marks,is_absent,remark').in('assessment_id', part).order('student_id').order('assessment_id'));
    rows.forEach((m) => marks.set(`${m.assessment_id}:${m.student_id}`, m));
  }
  const ids = ctx.csMap[cls.id]?.length ? ctx.csMap[cls.id] : [...new Set(list.map((a) => a.subject_id))];
  const subjects = ids.map((id) => ctx.subjects.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

  const students = roster.map((st) => {
    const remarks = [];
    const cells = subjects.map((s) => {
      const parts = exams.map((e) => {
        const aid = aMap.get(`${e.id}:${s.id}`); const m = aid && marks.get(`${aid}:${st.student_id}`);
        if (!m || (m.marks === null && !m.is_absent)) return null;
        if (m.remark) remarks.push({ subject: s.name, text: m.remark });
        return { marks: m.is_absent ? null : Number(m.marks), max: e.max_marks, absent: !!m.is_absent };
      });
      const got = parts.filter(Boolean);
      const total = r2(got.reduce((x, p) => x + (p.absent ? 0 : p.marks), 0)); const max = got.reduce((x, p) => x + p.max, 0);
      const pct = max ? r1((total / max) * 100) : null; const g = rangeFor(ctx.ranges, pct);
      return { subject_id: s.id, name: s.name, cells: parts, total, max, pct, grade: g?.grade || null, grade_point: g ? g.grade_point : null, fail: !!g?.is_fail, complete: exams.length > 0 && got.length === exams.length };
    });
    const withData = cells.filter((c) => c.max > 0);
    const total = r2(withData.reduce((x, c) => x + c.total, 0)); const max = withData.reduce((x, c) => x + c.max, 0);
    const pct = max ? r1((total / max) * 100) : null; const g = rangeFor(ctx.ranges, pct);
    const complete = cells.length > 0 && cells.every((c) => c.complete);
    const result = !complete ? 'Pending' : cells.some((c) => c.fail) ? 'Fail' : 'Pass';
    const seen = new Set();
    return {
      student_id: st.student_id, full_name: st.full_name, roll_no: st.roll_no, admission_no: st.admission_no || null, subjects: cells, total, max, pct,
      grade: g?.grade || null, grade_remark: g?.remark || null, result, rank: null, published: false, published_at: null,
      remarks: remarks.filter((x) => { if (seen.has(x.text)) return false; seen.add(x.text); return true; }).slice(0, 6),
    };
  });
  const ranked = students.filter((s) => s.result !== 'Pending' && s.pct !== null).sort((a, b) => b.pct - a.pct);
  ranked.forEach((s, i) => { s.rank = i > 0 && s.pct === ranked[i - 1].pct ? ranked[i - 1].rank : i + 1; });
  const { data: pubs, error: pe } = await db.from('report_cards').select('student_id,published_at').eq('school_id', schoolId).eq('class_id', cls.id); check(pe);
  const pm = new Map((pubs || []).map((p) => [p.student_id, p.published_at]));
  students.forEach((s) => { s.published = pm.has(s.student_id); s.published_at = pm.get(s.student_id) || null; });

  const done = students.filter((s) => s.pct !== null);
  const avg = (xs) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const dist = {}; students.forEach((s) => { if (s.grade) dist[s.grade] = (dist[s.grade] || 0) + 1; });
  const subject_avgs = subjects.map((s) => {
    const cs = students.map((x) => x.subjects.find((c) => c.subject_id === s.id));
    return {
      subject_id: s.id, name: s.name, avg: avg(cs.map((c) => c.pct).filter((v) => v !== null)),
      by_exam: exams.map((e, j) => ({ name: e.name, avg: avg(cs.map((c) => c.cells[j]).filter(Boolean).map((p) => (p.absent ? 0 : (p.marks / p.max) * 100))) })).filter((x) => x.avg !== null),
    };
  });
  return {
    class: { id: cls.id, label: cls.label || `${cls.name}${cls.section ? ` ${cls.section}` : ''}` }, exams: exams.map((e) => ({ id: e.id, name: e.name, max_marks: e.max_marks })),
    subjects: subjects.map((s) => ({ id: s.id, name: s.name })), grading: ctx.ranges, students,
    stats: { students: students.length, with_marks: done.length, pass: students.filter((s) => s.result === 'Pass').length, fail: students.filter((s) => s.result === 'Fail').length, pending: students.filter((s) => s.result === 'Pending').length, published: pubs.length, avg_pct: avg(done.map((s) => s.pct)), highest: done.length ? Math.max(...done.map((s) => s.pct)) : null, lowest: done.length ? Math.min(...done.map((s) => s.pct)) : null, grade_dist: dist, subject_avgs },
  };
}

export async function results(user, schoolId, classId) {
  const cls = await A.assertClassAccess(user, schoolId, classId);
  return computeClass(schoolId, cls, await sharedCtx(schoolId));
}

// ---------------------------------------------------------------- report cards & publishing
async function attendanceMap(schoolId, classId, session) {
  const from = session?.start_date; const to = session?.end_date;
  const rows = await fetchAll(() => { let q = db.from('student_attendance').select('student_id,status').eq('school_id', schoolId).eq('class_id', classId).order('id'); if (from) q = q.gte('date', from); if (to) q = q.lte('date', to); return q; });
  const m = new Map();
  rows.forEach((r) => { const x = m.get(r.student_id) || { present: 0, total: 0 }; x.total += 1; if (['present', 'late', 'P', 'L'].includes(r.status)) x.present += 1; m.set(r.student_id, x); });
  return m;
}
async function schoolInfo(schoolId) {
  const { data } = await db.from('schools').select('name,address,phone,email,logo_url').eq('id', schoolId).maybeSingle();
  return data || {};
}
async function profileExtras(schoolId, ids) {
  const m = new Map();
  for (const part of chunks(ids, 150)) {
    const { data } = await db.from('profiles').select('user_id,dob,father_name,mother_name').eq('school_id', schoolId).in('user_id', part);
    (data || []).forEach((p) => m.set(p.user_id, p));
  }
  return m;
}
function buildCard(school, session, res, s, att, extra, published_at) {
  const a = att?.get(s.student_id);
  return {
    school, session: session ? { id: session.id, name: session.name } : null, class: res.class, exams: res.exams,
    student: { id: s.student_id, name: s.full_name, roll_no: s.roll_no, admission_no: s.admission_no, dob: extra?.dob || null, father_name: extra?.father_name || null, mother_name: extra?.mother_name || null },
    subjects: s.subjects.map((c) => ({ name: c.name, cells: c.cells, total: c.total, max: c.max, pct: c.pct, grade: c.grade, fail: c.fail })),
    total: s.total, max: s.max, pct: s.pct, grade: s.grade, grade_remark: s.grade_remark, result: s.result, rank: s.rank, class_size: res.stats.students,
    class_avg: res.stats.avg_pct, remarks: s.remarks, attendance: a ? { present: a.present, total: a.total, pct: a.total ? r1((a.present / a.total) * 100) : null } : null,
    grading: res.grading.map((g) => ({ grade: g.grade, min_pct: g.min_pct, max_pct: g.max_pct, remark: g.remark })),
    published_at: published_at || null, generated_at: new Date().toISOString(),
  };
}
async function cardsFor(user, schoolId, classId) {
  const cls = await A.assertClassAccess(user, schoolId, classId);
  const res = await computeClass(schoolId, cls, await sharedCtx(schoolId));
  const session = await currentSession(schoolId);
  const [school, att, extras] = await Promise.all([schoolInfo(schoolId), attendanceMap(schoolId, cls.id, session), profileExtras(schoolId, res.students.map((s) => s.student_id))]);
  return { res, cards: res.students.map((s) => buildCard(school, session, res, s, att, extras.get(s.student_id), s.published_at)) };
}

// publishes (or withdraws) the report card of the selected students; a card can be published again later when more marks are in
export async function publish(user, schoolId, { class_id, student_ids, unpublish }) {
  if (!Array.isArray(student_ids) || !student_ids.length) throw httpError(400, 'Select at least one student');
  const { res, cards } = await cardsFor(user, schoolId, class_id);
  const want = new Set(student_ids);
  if (unpublish) {
    check((await db.from('report_cards').delete().eq('class_id', class_id).eq('school_id', schoolId).in('student_id', [...want])).error);
    return { count: want.size, ...(await results(user, schoolId, class_id)) };
  }
  const rows = []; let skipped = 0;
  res.students.forEach((s, i) => {
    if (!want.has(s.student_id)) return;
    if (s.pct === null) { skipped += 1; return; }
    rows.push({ student_id: s.student_id, class_id, school_id: schoolId, snapshot: cards[i], published_at: new Date().toISOString(), published_by: user.user_id });
  });
  if (!rows.length) throw httpError(400, 'None of the selected students has any marks yet.');
  for (const part of chunks(rows, 100)) check((await db.from('report_cards').upsert(part, { onConflict: 'student_id,class_id' })).error);
  Promise.resolve().then(async () => {
    const ids = rows.map((r) => r.student_id); const parents = await parentIdsOf(ids);
    await notify([...new Set([...ids, ...parents])], { school_id: schoolId, by: user.user_id, kind: 'marks', title: 'Report card published', body: 'Your report card is now available in Exams & Report Cards.', module: 'examinations', view: 'my', dedupe: `reportcard:${class_id}:${Date.now()}` });
  }).catch((e) => console.warn('notify failed:', e.message));
  return { count: rows.length, skipped, ...(await results(user, schoolId, class_id)) };
}

export async function reportCard(user, schoolId, classId, studentId) {
  const { data: p } = await db.from('profiles').select('class_id').eq('user_id', studentId).eq('school_id', schoolId).maybeSingle();
  if (!p) throw httpError(404, 'Student not found');
  if (user.features.includes('view_exam_results')) {
    await A.assertStudentAccess(user, schoolId, studentId);
    const cid = classId || p.class_id;
    if (!cid) throw httpError(404, 'This student has no class');
    const { cards } = await cardsFor(user, schoolId, cid);
    const c = cards.find((x) => x.student.id === studentId);
    if (!c) throw httpError(404, 'No report card for this student');
    return c;
  }
  if (!(await A.canSeeStudent(user, studentId))) throw httpError(403, 'You can only open your own or your children\'s report cards');
  let q = db.from('report_cards').select('snapshot').eq('student_id', studentId).eq('school_id', schoolId);
  q = classId ? q.eq('class_id', classId) : q.order('published_at', { ascending: false }).limit(1);
  const { data } = await q.maybeSingle();
  if (!data) throw httpError(404, 'This report card has not been published yet');
  return data.snapshot;
}
export async function reportCards(user, schoolId, classId, publishedOnly) {
  const { cards } = await cardsFor(user, schoolId, classId);
  return cards.filter((c) => c.pct !== null).filter((c) => !publishedOnly || c.published_at);
}

// a student or parent: the published report cards
export async function myResults(user, studentId) {
  if (!user.school_id || !(await A.canSeeStudent(user, studentId))) throw httpError(403, 'You can only see your own or your children\'s results');
  const { data, error } = await db.from('report_cards').select('class_id,snapshot,published_at').eq('student_id', studentId).eq('school_id', user.school_id).order('published_at');
  check(error);
  return data.map((r) => { const c = r.snapshot; return { class_id: r.class_id, class: c.class.label, session: c.session?.name || null, published_at: r.published_at, pct: c.pct, grade: c.grade, rank: c.rank, class_size: c.class_size, result: c.result, total: c.total, max: c.max, exams: c.exams.map((e) => e.name), subjects: c.subjects.map((s) => ({ name: s.name, pct: s.pct, grade: s.grade })) }; });
}

// ---------------------------------------------------------------- analysis
export async function analytics(user, schoolId, { class_id }) {
  const classes = class_id ? [await A.assertClassAccess(user, schoolId, class_id)] : (await A.accessibleClasses(user, schoolId)).slice(0, 40);
  const ctx = await sharedCtx(schoolId);
  const all = []; for (const c of classes) all.push(await computeClass(schoolId, c, ctx));
  const live = all.filter((r) => r.stats.with_marks > 0);
  const students = live.flatMap((r) => r.students.filter((s) => s.pct !== null).map((s) => ({ ...s, class_label: r.class.label })));
  const avg = (xs) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const subj = new Map();
  live.forEach((r) => r.stats.subject_avgs.forEach((s) => { if (s.avg === null) return; const x = subj.get(s.subject_id) || { subject_id: s.subject_id, name: s.name, by_class: [], trend: s.by_exam }; x.by_class.push({ class_id: r.class.id, label: r.class.label, avg: s.avg }); subj.set(s.subject_id, x); }));
  const subjects = [...subj.values()].map((s) => ({ ...s, avg: avg(s.by_class.map((c) => c.avg)) })).sort((a, b) => a.name.localeCompare(b.name));
  const weak = [...subjects].filter((s) => s.avg < 60).sort((a, b) => a.avg - b.avg).slice(0, 5).map((w) => ({ ...w, trend: class_id ? w.trend : [] }));
  const dist = {}; live.forEach((r) => Object.entries(r.stats.grade_dist).forEach(([g, n]) => { dist[g] = (dist[g] || 0) + n; }));
  const support = students.filter((s) => s.result === 'Fail' || s.pct < 40).sort((a, b) => a.pct - b.pct).slice(0, 15)
    .map((s) => ({ student_id: s.student_id, full_name: s.full_name, class_label: s.class_label, pct: s.pct, weak_subjects: s.subjects.filter((c) => c.fail || (c.pct !== null && c.pct < 40)).map((c) => c.name) }));
  const judged = students.filter((s) => s.result !== 'Pending');
  return {
    summary: { students: all.reduce((a, r) => a + r.stats.students, 0), with_marks: students.length, avg_pct: avg(students.map((s) => s.pct)), pass_pct: judged.length ? r1((judged.filter((s) => s.result === 'Pass').length / judged.length) * 100) : null, highest: students.length ? Math.max(...students.map((s) => s.pct)) : null, published: all.reduce((a, r) => a + r.stats.published, 0) },
    classes: all.map((r) => ({ class_id: r.class.id, label: r.class.label, students: r.stats.students, avg_pct: r.stats.avg_pct, pass_pct: r.stats.pass + r.stats.fail ? r1((r.stats.pass / (r.stats.pass + r.stats.fail)) * 100) : null, pending: r.stats.pending })),
    subjects, weak, grade_dist: dist,
    top: [...students].filter((s) => s.result !== 'Pending').sort((a, b) => b.pct - a.pct).slice(0, 5).map((s) => ({ student_id: s.student_id, full_name: s.full_name, class_label: s.class_label, pct: s.pct, grade: s.grade })),
    support,
  };
}
