// Attendance functions. Routes (routes/attendance.js) only check the feature and call these,
// so any other module (fees, parent panel, notices...) can import and reuse them.
//
//   todayStr()                                        school-local date (YYYY-MM-DD)
//   accessibleClasses(user, schoolId)                 classes this person may use (all, or only assigned ones)
//   classDayStatus(schoolId, classes, date)           marked / not marked + counts + who, per class
//   getSheet(user, schoolId, classId, date)           roster + existing marks for one class and day
//   saveSheet(user, schoolId, classId, date, records) mark or change attendance (safe to call again for the same day)
//   dailyOverview(user, schoolId, date)               report: every class, marked or not
//   classReport(user, schoolId, classId, from, to)    report: per-student totals + per-day totals for a class
//   studentReport(schoolId, studentId, from, to)      report: one student, month by month + absent days
//   lowAttendance(user, schoolId, opts)               report: students below a % limit
//   listTeacherAssignments / setClassTeachers         which teachers take which class
//   listRolls / saveRolls / autoAssignRolls           roll numbers (1-100, unique inside a class)
import { cfg } from './config.js';
import { db, httpError, check } from './db.js';

export const STATUSES = ['present', 'absent', 'late', 'leave'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 370;
const TEACHER_ROLES = ['staff', 'other'];

// ---------------------------------------------------------------- dates
export const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function validDate(d, what = 'Date') {
  const t = new Date(`${d}T00:00:00Z`); // an impossible date such as 2026-13-40 is an Invalid Date: toISOString() would throw (a 500), so check first
  if (!DATE.test(d || '') || Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) throw httpError(400, `${what} is not a valid date`);
  return d;
}
export const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

// default report range = current session start .. today (max ~1 year)
export async function resolveRange(schoolId, from, to) {
  const today = todayStr();
  to = to ? validDate(to, 'To date') : today;
  if (!from) {
    const { data } = await db.from('academic_sessions').select('start_date').eq('school_id', schoolId).eq('is_current', true).maybeSingle();
    from = data?.start_date && data.start_date <= to ? data.start_date : `${to.slice(0, 7)}-01`;
    if (daysBetween(from, to) > MAX_DAYS - 1) from = addDays(to, -(MAX_DAYS - 1));
  } else validDate(from, 'From date');
  if (to < from) throw httpError(400, 'The end date is before the start date');
  if (daysBetween(from, to) > MAX_DAYS - 1) throw httpError(400, 'Pick a range of at most 12 months');
  return { from, to };
}

// ---------------------------------------------------------------- helpers
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
const nameOf = (p, loginId) => p?.full_name || loginId || 'Unknown';
const one = (x) => (Array.isArray(x) ? x[0] : x);

async function namesOf(ids) {
  const map = new Map();
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await db.from('users').select('user_id,login_id,profiles(full_name,roll_no)').in('user_id', list.slice(i, i + 200));
    check(error);
    data.forEach((u) => map.set(u.user_id, { name: nameOf(one(u.profiles), u.login_id), login_id: u.login_id }));
  }
  return map;
}

const tally = (rows) => {
  const t = { present: 0, absent: 0, late: 0, leave: 0, total: 0 };
  for (const r of rows) { t[r.status] += 1; t.total += 1; }
  t.percent = pct(t);
  return t;
};
// attendance % = (present + late) / all marked days. Leave counts as a day not attended.
export const pct = (t) => (t.total ? Math.round(((t.present + t.late) / t.total) * 1000) / 10 : null);

export const hasAllClasses = (user) => user.features.includes('attendance_all_classes');

// ---------------------------------------------------------------- classes & access
export async function accessibleClasses(user, schoolId) {
  let classes;
  if (hasAllClasses(user)) {
    const { data, error } = await db.from('classes').select('id,name,section,level').eq('school_id', schoolId).order('level', { nullsFirst: false }).order('name').order('section');
    check(error);
    classes = data.map((c) => ({ ...c, is_class_teacher: false }));
    const { data: mine } = await db.from('class_teachers').select('class_id,is_class_teacher').eq('teacher_id', user.user_id);
    const m = new Map((mine || []).map((x) => [x.class_id, x.is_class_teacher]));
    classes.forEach((c) => { c.assigned = m.has(c.id); c.is_class_teacher = !!m.get(c.id); });
  } else {
    const { data, error } = await db.from('class_teachers').select('is_class_teacher,classes(id,name,section,level)').eq('teacher_id', user.user_id).eq('school_id', schoolId);
    check(error);
    classes = data.filter((x) => one(x.classes)).map((x) => ({ ...one(x.classes), assigned: true, is_class_teacher: x.is_class_teacher }));
  }
  const byOrder = (a, b) => (a.level ?? 1e9) - (b.level ?? 1e9) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }) || a.section.localeCompare(b.section);
  return classes.sort(byOrder);
}

export async function assertClassAccess(user, schoolId, classId) {
  if (!classId) throw httpError(400, 'Choose a class');
  const { data, error } = await db.from('classes').select('id,name,section,level,school_id').eq('id', classId).eq('school_id', schoolId).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Class not found');
  if (!hasAllClasses(user)) {
    const { data: a } = await db.from('class_teachers').select('class_id').eq('class_id', classId).eq('teacher_id', user.user_id).maybeSingle();
    if (!a) throw httpError(403, 'This class is not assigned to you');
  }
  return data;
}

// active, not-graduated students of a class, ordered by roll no (no roll last) then name
export async function classRoster(schoolId, classId) {
  const rows = await fetchAll(() => db.from('profiles')
    .select('user_id,full_name,roll_no,admission_no,gender,extra,users!inner(login_id,is_active,role)')
    .eq('school_id', schoolId).eq('class_id', classId).eq('users.role', 'student').eq('users.is_active', true).order('user_id'));
  return rows.filter((p) => p.extra?.graduated !== true)
    .map((p) => ({ student_id: p.user_id, full_name: p.full_name || one(p.users).login_id, login_id: one(p.users).login_id, roll_no: p.roll_no, admission_no: p.admission_no }))
    .sort((a, b) => (a.roll_no ?? 1e9) - (b.roll_no ?? 1e9) || a.full_name.localeCompare(b.full_name));
}

// ---------------------------------------------------------------- "was it marked today?"
export async function classDayStatus(schoolId, classes, date) {
  const ids = classes.map((c) => c.id);
  if (!ids.length) return [];
  const [rows, students] = await Promise.all([
    fetchAll(() => db.from('student_attendance').select('class_id,status,marked_by,updated_by,updated_at').eq('school_id', schoolId).eq('date', date).in('class_id', ids).order('id')),
    fetchAll(() => db.from('profiles').select('class_id,extra,users!inner(is_active,role)').eq('school_id', schoolId).in('class_id', ids).eq('users.role', 'student').eq('users.is_active', true).order('user_id')),
  ]);
  const people = await namesOf(rows.flatMap((r) => [r.marked_by, r.updated_by]));
  return classes.map((c) => {
    const mine = rows.filter((r) => r.class_id === c.id);
    const total = students.filter((s) => s.class_id === c.id && s.extra?.graduated !== true).length;
    const t = tally(mine);
    const last = mine.reduce((a, r) => (!a || r.updated_at > a.updated_at ? r : a), null);
    return {
      class_id: c.id, total_students: total, marked: t.total, present: t.present, absent: t.absent, late: t.late, leave: t.leave,
      state: t.total === 0 ? 'not_marked' : t.total >= total ? 'marked' : 'partial',
      marked_by: [...new Set(mine.map((r) => people.get(r.marked_by)?.name).filter(Boolean))],
      last_updated: last?.updated_at || null, last_updated_by: last ? people.get(last.updated_by)?.name || null : null,
    };
  });
}

// ---------------------------------------------------------------- take attendance
export async function getSheet(user, schoolId, classId, date) {
  const today = todayStr();
  date = validDate(date || today);
  if (date > today) throw httpError(400, 'You cannot mark attendance for a future date');
  const cls = await assertClassAccess(user, schoolId, classId);
  const [roster, recs, hol, tch, [status]] = await Promise.all([
    classRoster(schoolId, classId),
    db.from('student_attendance').select('student_id,status').eq('school_id', schoolId).eq('class_id', classId).eq('date', date),
    db.from('holidays').select('title,type').eq('school_id', schoolId).lte('start_date', date).gte('end_date', date).limit(1),
    db.from('class_teachers').select('is_class_teacher,users!inner(login_id,profiles(full_name))').eq('class_id', classId),
    classDayStatus(schoolId, [cls], date),
  ]);
  check(recs.error); check(hol.error); check(tch.error);
  const byStudent = new Map(recs.data.map((r) => [r.student_id, r.status]));
  const canMark = user.features.includes('mark_attendance');
  const pastOk = user.features.includes('edit_past_attendance') || user.role === 'super_admin';
  return {
    class: cls, date, today,
    can_edit: canMark && (date === today || pastOk),
    edit_note: !canMark ? 'View only' : date !== today && !pastOk ? 'Only today can be edited with your access' : null,
    holiday: hol.data[0] || null,
    students: roster.map((s) => ({ ...s, status: byStudent.get(s.student_id) || null })),
    status,
    teachers: tch.data.map((t) => ({ name: nameOf(one(one(t.users).profiles), one(t.users).login_id), is_class_teacher: t.is_class_teacher })),
  };
}

export async function saveSheet(user, schoolId, classId, date, records) {
  const today = todayStr();
  date = validDate(date || today);
  if (date > today) throw httpError(400, 'You cannot mark attendance for a future date');
  if (date !== today && !user.features.includes('edit_past_attendance') && user.role !== 'super_admin') throw httpError(403, 'You can only edit today\'s attendance');
  await assertClassAccess(user, schoolId, classId);
  if (!Array.isArray(records) || !records.length) throw httpError(400, 'Nothing to save');

  const roster = new Map((await classRoster(schoolId, classId)).map((s) => [s.student_id, s]));
  const wanted = new Map();
  for (const r of records) {
    if (!STATUSES.includes(r?.status)) throw httpError(400, 'Unknown attendance status');
    if (!roster.has(r.student_id)) throw httpError(400, 'A student in the list is not in this class (reload the class and try again)');
    wanted.set(r.student_id, r.status);
  }
  const ids = [...wanted.keys()];
  const { data: existing, error } = await db.from('student_attendance').select('student_id,status,class_id,marked_by').eq('school_id', schoolId).eq('date', date).in('student_id', ids);
  check(error);
  const ex = new Map(existing.map((e) => [e.student_id, e]));
  const { data: ses } = await db.from('academic_sessions').select('id').eq('school_id', schoolId).eq('is_current', true).maybeSingle();

  const now = new Date().toISOString();
  const rows = []; let unchanged = 0;
  for (const [sid, status] of wanted) {
    const e = ex.get(sid);
    if (e && e.status === status && e.class_id === classId) { unchanged += 1; continue; }
    rows.push({
      school_id: schoolId, class_id: classId, student_id: sid, session_id: ses?.id || null, date, status,
      roll_no: roster.get(sid).roll_no, marked_by: e?.marked_by || user.user_id, updated_by: user.user_id, updated_at: now,
    });
  }
  if (rows.length) check((await db.from('student_attendance').upsert(rows, { onConflict: 'student_id,date' })).error);
  return { saved: rows.length, unchanged, date };
}

// ---------------------------------------------------------------- reports
export async function dailyOverview(user, schoolId, date) {
  date = validDate(date || todayStr());
  const classes = await accessibleClasses(user, schoolId);
  if (!classes.length) return { date, totals: { classes: 0, classes_marked: 0, students: 0, marked: 0, present: 0, absent: 0, late: 0, leave: 0 }, classes: [] };
  const status = await classDayStatus(schoolId, classes, date);
  const { data: tch, error } = await db.from('class_teachers').select('class_id,is_class_teacher,users!inner(login_id,profiles(full_name))').eq('school_id', schoolId).in('class_id', classes.map((c) => c.id));
  check(error);
  const rows = classes.map((c, i) => ({
    ...c, ...status[i],
    teachers: (tch || []).filter((t) => t.class_id === c.id).map((t) => nameOf(one(one(t.users).profiles), one(t.users).login_id)),
  }));
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const totals = { classes: rows.length, classes_marked: rows.filter((r) => r.state !== 'not_marked').length, students: sum('total_students'), marked: sum('marked'), present: sum('present'), absent: sum('absent'), late: sum('late'), leave: sum('leave') };
  return { date, totals, classes: rows };
}

export async function classReport(user, schoolId, classId, from, to) {
  const cls = await assertClassAccess(user, schoolId, classId);
  const range = await resolveRange(schoolId, from, to);
  const [roster, recs] = await Promise.all([
    classRoster(schoolId, classId),
    fetchAll(() => db.from('student_attendance').select('student_id,date,status,roll_no').eq('school_id', schoolId).eq('class_id', classId).gte('date', range.from).lte('date', range.to).order('date').order('student_id')),
  ]);
  const people = await namesOf(recs.map((r) => r.student_id).filter((id) => !roster.some((s) => s.student_id === id)));
  const rowsBy = new Map();
  for (const r of recs) { if (!rowsBy.has(r.student_id)) rowsBy.set(r.student_id, []); rowsBy.get(r.student_id).push(r); }
  const students = roster.map((s) => ({ ...s, current: true }));
  for (const id of rowsBy.keys()) if (!roster.some((s) => s.student_id === id)) {
    const last = rowsBy.get(id).at(-1);
    students.push({ student_id: id, full_name: people.get(id)?.name || 'Unknown', login_id: people.get(id)?.login_id, roll_no: last.roll_no, current: false });
  }
  const out = students.map((s) => ({ ...s, ...tally(rowsBy.get(s.student_id) || []) }))
    .sort((a, b) => (a.roll_no ?? 1e9) - (b.roll_no ?? 1e9) || a.full_name.localeCompare(b.full_name));
  const days = new Map();
  for (const r of recs) { const d = days.get(r.date) || { date: r.date, present: 0, absent: 0, late: 0, leave: 0 }; d[r.status] += 1; days.set(r.date, d); }
  const perDay = [...days.values()].map((d) => ({ ...d, total: d.present + d.absent + d.late + d.leave, percent: pct({ ...d, total: d.present + d.absent + d.late + d.leave }) }));
  return { class: cls, range, working_days: days.size, summary: tally(recs), students: out, days: perDay };
}

export async function studentReport(schoolId, studentId, from, to) {
  const { data: u, error } = await db.from('users').select('user_id,login_id,school_id,role,profiles(full_name,roll_no,admission_no,class_id)').eq('user_id', studentId).maybeSingle();
  check(error);
  if (!u || u.school_id !== schoolId || u.role !== 'student') throw httpError(404, 'Student not found');
  const p = one(u.profiles) || {};
  const range = await resolveRange(schoolId, from, to);
  const recs = await fetchAll(() => db.from('student_attendance').select('date,status,class_id,roll_no').eq('student_id', studentId).gte('date', range.from).lte('date', range.to).order('date'));
  const months = new Map();
  for (const r of recs) { const k = r.date.slice(0, 7); if (!months.has(k)) months.set(k, []); months.get(k).push(r); }
  let cls = null;
  if (p.class_id) { const { data } = await db.from('classes').select('id,name,section').eq('id', p.class_id).maybeSingle(); cls = data; }
  return {
    student: { student_id: u.user_id, full_name: nameOf(p, u.login_id), login_id: u.login_id, roll_no: p.roll_no, admission_no: p.admission_no, class: cls },
    range, summary: tally(recs),
    months: [...months].map(([month, rows]) => ({ month, ...tally(rows) })),
    absences: recs.filter((r) => r.status !== 'present').map((r) => ({ date: r.date, status: r.status })).reverse(),
  };
}

// students whose attendance % is below the limit (default 75), in the classes this person can use
export async function lowAttendance(user, schoolId, { threshold = 75, from, to, classId } = {}) {
  const limit = Number(threshold);
  if (!(limit > 0 && limit <= 100)) throw httpError(400, 'Limit must be between 1 and 100');
  const range = await resolveRange(schoolId, from, to);
  let classes = await accessibleClasses(user, schoolId);
  if (classId) { await assertClassAccess(user, schoolId, classId); classes = classes.filter((c) => c.id === classId); }
  if (!classes.length) return { range, threshold: limit, students: [] };
  const recs = await fetchAll(() => db.from('student_attendance').select('student_id,class_id,status,roll_no').eq('school_id', schoolId).in('class_id', classes.map((c) => c.id)).gte('date', range.from).lte('date', range.to).order('date').order('student_id'));
  const by = new Map();
  for (const r of recs) { const k = `${r.student_id}|${r.class_id}`; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const people = await namesOf(recs.map((r) => r.student_id));
  const label = new Map(classes.map((c) => [c.id, `${c.name}${c.section ? ` ${c.section}` : ''}`]));
  const students = [...by].map(([k, rows]) => {
    const [student_id, class_id] = k.split('|');
    return { student_id, class_id, class_label: label.get(class_id), full_name: people.get(student_id)?.name, roll_no: rows.at(-1).roll_no, ...tally(rows) };
  }).filter((s) => s.percent !== null && s.percent < limit).sort((a, b) => a.percent - b.percent);
  return { range, threshold: limit, students };
}

// ---------------------------------------------------------------- teachers <-> classes
export async function listTeacherAssignments(schoolId) {
  const [cls, asg, staff] = await Promise.all([
    db.from('classes').select('id,name,section,level').eq('school_id', schoolId).order('level', { nullsFirst: false }).order('name').order('section'),
    db.from('class_teachers').select('class_id,teacher_id,is_class_teacher').eq('school_id', schoolId),
    db.from('users').select('user_id,login_id,role,profiles(full_name,designation)').eq('school_id', schoolId).in('role', TEACHER_ROLES).eq('is_active', true).order('login_id'),
  ]);
  check(cls.error); check(asg.error); check(staff.error);
  const teachers = staff.data.map((u) => ({ user_id: u.user_id, login_id: u.login_id, full_name: nameOf(one(u.profiles), u.login_id), designation: one(u.profiles)?.designation || null }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const t = new Map(teachers.map((x) => [x.user_id, x]));
  return {
    teachers,
    classes: cls.data.map((c) => ({ ...c, teachers: asg.data.filter((a) => a.class_id === c.id && t.has(a.teacher_id)).map((a) => ({ ...t.get(a.teacher_id), is_class_teacher: a.is_class_teacher })) })),
  };
}

export async function setClassTeachers(schoolId, classId, teacherIds, classTeacherId) {
  const { data: c } = await db.from('classes').select('id').eq('id', classId).eq('school_id', schoolId).maybeSingle();
  if (!c) throw httpError(404, 'Class not found');
  const want = [...new Set(Array.isArray(teacherIds) ? teacherIds : [])];
  if (want.length) {
    const { data, error } = await db.from('users').select('user_id').in('user_id', want).eq('school_id', schoolId).in('role', TEACHER_ROLES).eq('is_active', true);
    check(error);
    if (data.length !== want.length) throw httpError(400, 'Every teacher must be an active staff member of this school');
  }
  const head = want.includes(classTeacherId) ? classTeacherId : null;
  if (want.length) check((await db.from('class_teachers').upsert(want.map((teacher_id) => ({ class_id: classId, teacher_id, school_id: schoolId, is_class_teacher: teacher_id === head })), { onConflict: 'class_id,teacher_id' })).error);
  let del = db.from('class_teachers').delete().eq('class_id', classId);
  if (want.length) del = del.not('teacher_id', 'in', `(${want.join(',')})`);
  check((await del).error);
}

// ---------------------------------------------------------------- roll numbers
export async function listRolls(user, schoolId, classId) {
  const cls = await assertClassAccess(user, schoolId, classId);
  return { class: cls, students: await classRoster(schoolId, classId) };
}

async function applyRolls(schoolId, classId, items) {
  const { error } = await db.rpc('set_roll_numbers', { p_school: schoolId, p_class: classId, p_items: items });
  check(error);
}

export async function saveRolls(user, schoolId, classId, items) {
  await assertClassAccess(user, schoolId, classId);
  if (!Array.isArray(items)) throw httpError(400, 'Nothing to save');
  const clean = items.map((i) => {
    const blank = i.roll_no === null || i.roll_no === undefined || i.roll_no === '';
    const n = blank ? null : Number(i.roll_no);
    if (!blank && (!Number.isInteger(n) || n < 1 || n > 100)) throw httpError(400, 'Roll numbers must be whole numbers from 1 to 100');
    return { student_id: i.student_id, roll_no: n };
  });
  await applyRolls(schoolId, classId, clean);
  return listRolls(user, schoolId, classId);
}

// mode 'name': number everyone 1..n by name (A-Z).   mode 'fill': keep existing numbers, give the smallest free numbers to the rest.
export async function autoAssignRolls(user, schoolId, classId, mode = 'fill') {
  await assertClassAccess(user, schoolId, classId);
  const roster = await classRoster(schoolId, classId);
  if (roster.length > 100) throw httpError(400, 'A class can have at most 100 roll numbers');
  let items;
  if (mode === 'name') {
    items = [...roster].sort((a, b) => a.full_name.localeCompare(b.full_name)).map((s, i) => ({ student_id: s.student_id, roll_no: i + 1 }));
  } else {
    const used = new Set(roster.map((s) => s.roll_no).filter(Boolean));
    let next = 1;
    items = roster.filter((s) => !s.roll_no).sort((a, b) => a.full_name.localeCompare(b.full_name)).map((s) => {
      while (used.has(next)) next += 1;
      used.add(next);
      return { student_id: s.student_id, roll_no: next };
    });
    if (items.some((i) => i.roll_no > 100)) throw httpError(400, 'No free roll numbers left (1-100)');
  }
  if (items.length) await applyRolls(schoolId, classId, items);
  return listRolls(user, schoolId, classId);
}

// ---------------------------------------------------------------- own / children (no feature needed: it is your own data)
export async function canSeeStudent(user, studentId) {
  if (user.user_id === studentId) return true;
  const { data } = await db.from('parent_students').select('student_id').eq('parent_id', user.user_id).eq('student_id', studentId).maybeSingle();
  return !!data;
}

// a teacher may open a student's report only if the student's class is one they can use
export async function assertStudentAccess(user, schoolId, studentId) {
  const { data } = await db.from('profiles').select('class_id').eq('user_id', studentId).eq('school_id', schoolId).maybeSingle();
  if (!data) throw httpError(404, 'Student not found');
  if (hasAllClasses(user)) return;
  const { data: a } = data.class_id ? await db.from('class_teachers').select('class_id').eq('class_id', data.class_id).eq('teacher_id', user.user_id).maybeSingle() : { data: null };
  if (!a) throw httpError(403, "This student's class is not assigned to you");
}

// students a teacher can search in the Student report: roster of every class they can use
export async function searchStudents(user, schoolId, q) {
  const classes = await accessibleClasses(user, schoolId);
  if (!classes.length) return [];
  const rows = await fetchAll(() => db.from('profiles')
    .select('user_id,full_name,roll_no,class_id,extra,users!inner(login_id,is_active,role)')
    .eq('school_id', schoolId).in('class_id', classes.map((c) => c.id)).eq('users.role', 'student').eq('users.is_active', true).order('user_id'));
  const label = new Map(classes.map((c) => [c.id, `${c.name}${c.section ? ` ${c.section}` : ''}`]));
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter((p) => p.extra?.graduated !== true)
    .map((p) => ({ student_id: p.user_id, full_name: p.full_name || one(p.users).login_id, login_id: one(p.users).login_id, roll_no: p.roll_no, class_label: label.get(p.class_id) }))
    .filter((s) => !needle || `${s.full_name} ${s.login_id} ${s.roll_no ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => a.class_label.localeCompare(b.class_label, undefined, { numeric: true }) || (a.roll_no ?? 1e9) - (b.roll_no ?? 1e9) || a.full_name.localeCompare(b.full_name))
    .slice(0, 50);
}
