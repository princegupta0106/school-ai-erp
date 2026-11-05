// Class subjects: which subjects each class studies, and who teaches each one.
//   classSubjectMap(schoolId)                         { class_id: [subject_id, ...] }
//   overview(schoolId)                                every class with its subjects, teachers and periods (the "Class subjects" report)
//   setClassSubjects(schoolId, classIds, subjectIds, mode)   'set' replaces, 'add' only adds. A subject that still has a teacher in that class cannot be removed.
//   ensureCombos(schoolId, rows)                      called when a teacher is given class + subject combos, keeps the class list in step
//   myCombos(userId, schoolId)                        the class + subject combos of one teacher
import { db, httpError, check } from './db.js';

const one = (v) => (Array.isArray(v) ? v[0] : v);
const label = (c) => `${c.name}${c.section ? ` ${c.section}` : ''}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchAll(make) {
  const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const { data, error } = await make().range(from, from + step - 1);
    check(error);
    out.push(...data);
    if (data.length < step) break;
  }
  return out;
}

export async function classSubjectMap(schoolId) {
  const rows = await fetchAll(() => db.from('class_subjects').select('class_id,subject_id').eq('school_id', schoolId));
  const m = {};
  rows.forEach((r) => { (m[r.class_id] ||= []).push(r.subject_id); });
  return m;
}

export async function myCombos(userId, schoolId) {
  const { data, error } = await db.from('tt_assignments').select('class_id,subject_id,periods_per_week').eq('school_id', schoolId).eq('teacher_id', userId);
  check(error);
  return data;
}

export async function overview(schoolId) {
  const [classes, subjects, links, assigns, teachers] = await Promise.all([
    db.from('classes').select('id,name,section').eq('school_id', schoolId).order('name').order('section'),
    db.from('subjects').select('id,name,code').eq('school_id', schoolId).order('name'),
    fetchAll(() => db.from('class_subjects').select('class_id,subject_id').eq('school_id', schoolId)),
    fetchAll(() => db.from('tt_assignments').select('teacher_id,class_id,subject_id,periods_per_week').eq('school_id', schoolId)),
    db.from('users').select('user_id,login_id,profiles(full_name)').eq('school_id', schoolId).in('role', ['staff', 'school_admin', 'other']),
  ]);
  check(classes.error); check(subjects.error); check(teachers.error);
  const tname = Object.fromEntries(teachers.data.map((u) => [u.user_id, one(u.profiles)?.full_name || u.login_id]));
  const sname = Object.fromEntries(subjects.data.map((s) => [s.id, s]));
  const rows = classes.data
    .sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }))
    .map((c) => {
      const subs = links.filter((l) => l.class_id === c.id).map((l) => sname[l.subject_id]).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => {
          const t = assigns.filter((a) => a.class_id === c.id && a.subject_id === s.id);
          return { subject_id: s.id, name: s.name, code: s.code, periods: t.reduce((n, x) => n + x.periods_per_week, 0), teachers: t.map((x) => ({ teacher_id: x.teacher_id, name: tname[x.teacher_id] || 'Teacher', periods: x.periods_per_week })) };
        });
      return { id: c.id, name: c.name, section: c.section, label: label(c), subjects: subs, unstaffed: subs.filter((s) => s.teachers.length === 0).length };
    });
  return { classes: rows, subjects: subjects.data, totals: { classes: rows.length, classes_without_subjects: rows.filter((c) => !c.subjects.length).length, unstaffed: rows.reduce((n, c) => n + c.unstaffed, 0) } };
}

export async function setClassSubjects(schoolId, classIds, subjectIds, mode = 'set') {
  const cl = [...new Set((Array.isArray(classIds) ? classIds : []).filter((x) => UUID.test(String(x))))];
  const su = [...new Set((Array.isArray(subjectIds) ? subjectIds : []).filter((x) => UUID.test(String(x))))];
  if (!cl.length) throw httpError(400, 'Choose at least one class');
  if (cl.length > 200 || su.length > 100) throw httpError(400, 'Too many rows');
  const [c, s] = await Promise.all([
    db.from('classes').select('id').eq('school_id', schoolId).in('id', cl),
    su.length ? db.from('subjects').select('id').eq('school_id', schoolId).in('id', su) : { data: [], error: null },
  ]);
  check(c.error); check(s.error);
  if (c.data.length !== cl.length) throw httpError(400, 'Unknown class');
  if (s.data.length !== su.length) throw httpError(400, 'Unknown subject');
  if (mode !== 'add') {
    // a subject cannot be dropped from a class while a teacher still teaches it there
    const { data: busy, error } = await db.from('tt_assignments').select('class_id,subject_id,subjects(name),classes(name,section)').eq('school_id', schoolId).in('class_id', cl);
    check(error);
    const bad = busy.find((b) => !su.includes(b.subject_id));
    if (bad) throw httpError(409, `${one(bad.subjects)?.name || 'A subject'} still has a teacher in ${label(one(bad.classes) || {})}. Remove that teacher's combo first (Users > teacher profile > Teaching).`);
    const del = await db.from('class_subjects').delete().eq('school_id', schoolId).in('class_id', cl);
    check(del.error);
  }
  const rows = cl.flatMap((class_id) => su.map((subject_id) => ({ school_id: schoolId, class_id, subject_id })));
  if (rows.length) { const ins = await db.from('class_subjects').upsert(rows, { onConflict: 'class_id,subject_id', ignoreDuplicates: true }); check(ins.error); }
  return { ok: true, classes: cl.length, subjects: su.length };
}

export async function ensureCombos(schoolId, rows) {
  if (!rows.length) return;
  const up = rows.map((r) => ({ school_id: schoolId, class_id: r.class_id, subject_id: r.subject_id }));
  const { error } = await db.from('class_subjects').upsert(up, { onConflict: 'class_id,subject_id', ignoreDuplicates: true });
  check(error);
}

// used when a test / exam paper is created: if the class has a subject list, the subject must be on it,
// and a teacher without "all classes" can only use the combos they were given (when they have any).
export async function assertCombo(user, schoolId, classId, subjectId, allClasses) {
  const { data: list, error } = await db.from('class_subjects').select('subject_id').eq('school_id', schoolId).eq('class_id', classId);
  check(error);
  if (list.length && !list.some((l) => l.subject_id === subjectId)) throw httpError(400, 'That subject is not taught in this class. Add it under Academics > Class subjects first.');
  if (allClasses) return;
  const mine = await myCombos(user.user_id, schoolId);
  if (mine.length && !mine.some((m) => m.class_id === classId && m.subject_id === subjectId)) throw httpError(403, 'You are not assigned to teach this subject in this class.');
}
