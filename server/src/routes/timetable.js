// Timetable & teacher workload.
//   1. Structure   : working days + periods (framework)           PUT  /structure
//   2. Teachers    : who teaches which subject in which class     PUT  /teachers/:id/assignments  (edited inside the teacher's profile)
//   3. Timetable   : class + day + period -> subject + teacher    PUT  /classes/:id/slot
//   4. Workload    : load per teacher, coverage, gaps             GET  /workload
//   5. Substitutes : cover an absent teacher for a date           GET /substitutions/plan, POST /substitutions
// A teacher can only be put in a class/subject they were given in their profile, and can never be in two classes
// at the same time (also enforced by a unique index in the database).
import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import { todayStr, validDate, addDays } from '../attendance.js';
import { classSubjectMap, ensureCombos } from '../classSubjects.js';

const r = Router();
const SEE = ['view_timetable', 'manage_timetable', 'manage_timetable_setup', 'manage_substitutions'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TEACHER_ROLES = ['staff', 'school_admin', 'other'];
const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const uid = (v, label) => { if (!UUID.test(String(v || ''))) throw httpError(400, `Unknown ${label}`); return v; };
const hhmm = (t) => String(t || '').slice(0, 5);
const dow = (d) => { const n = new Date(`${d}T00:00:00Z`).getUTCDay(); return n === 0 ? 7 : n; };
const clsLabel = (c) => (c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : '');

async function fetchAll(make) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    check(error); rows.push(...data); if (data.length < 1000) break;
  }
  return rows;
}

/* ------------------------------------------------------------------ loaders */
const loadPeriods = async (school) => {
  const { data, error } = await db.from('tt_periods').select('id,no,name,start_time,end_time,is_break').eq('school_id', school).order('no');
  check(error);
  return data.map((p) => ({ ...p, start_time: hhmm(p.start_time), end_time: hhmm(p.end_time) }));
};
const loadSettings = async (school) => {
  const { data, error } = await db.from('tt_settings').select('days,max_load').eq('school_id', school).maybeSingle();
  check(error);
  return data || { days: [1, 2, 3, 4, 5, 6], max_load: 30 };
};
const loadClasses = async (school) => {
  const { data, error } = await db.from('classes').select('id,name,section,level').eq('school_id', school).order('level', { nullsFirst: false }).order('name').order('section');
  check(error);
  return data;
};
const loadSubjects = async (school) => {
  const { data, error } = await db.from('subjects').select('id,name,code').eq('school_id', school).order('name');
  check(error);
  return data;
};
const loadTeachers = async (school) => {
  const { data, error } = await db.from('users').select('user_id,login_id,role,is_active,profiles(full_name,designation)').eq('school_id', school).in('role', TEACHER_ROLES).eq('is_active', true);
  check(error);
  return data.map((u) => {
    const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
    return { user_id: u.user_id, login_id: u.login_id, role: u.role, name: p?.full_name || u.login_id, designation: p?.designation || '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
};
const loadClassPeriods = async (school) => {
  const rows = await fetchAll(() => db.from('class_subjects').select('class_id,subject_id,periods_per_week').eq('school_id', school));
  const m = {}; rows.forEach((x) => { if (x.periods_per_week != null) (m[x.class_id] ||= {})[x.subject_id] = x.periods_per_week; });
  return m;
};
// the admin's number for the class + subject wins over whatever an old teacher row says
const loadAssignments = async (school) => {
  const [rows, cp] = await Promise.all([fetchAll(() => db.from('tt_assignments').select('id,teacher_id,class_id,subject_id,periods_per_week').eq('school_id', school).order('created_at')), loadClassPeriods(school)]);
  return rows.map((a) => ({ ...a, periods_per_week: cp[a.class_id]?.[a.subject_id] ?? a.periods_per_week }));
};
const loadSlots = (school, filter = {}) => fetchAll(() => {
  let q = db.from('tt_slots').select('id,class_id,day,period_id,subject_id,teacher_id').eq('school_id', school).order('day').order('period_id');
  if (filter.class_id) q = q.eq('class_id', filter.class_id);
  if (filter.teacher_id) q = q.eq('teacher_id', filter.teacher_id);
  return q;
});

const mustClass = async (school, id) => {
  const { data, error } = await db.from('classes').select('id,name,section').eq('id', uid(id, 'class')).eq('school_id', school).maybeSingle();
  check(error); if (!data) throw httpError(404, 'Class not found'); return data;
};
const teacherName = async (school, id) => {
  const { data } = await db.from('users').select('user_id,role,profiles(full_name)').eq('user_id', id).eq('school_id', school).maybeSingle();
  if (!data) throw httpError(404, 'Teacher not found');
  const p = Array.isArray(data.profiles) ? data.profiles[0] : data.profiles;
  return { ...data, name: p?.full_name || 'Teacher' };
};

/* ------------------------------------------------------------------ meta (everything a screen needs to start) */
r.get('/meta', requireFeature(...SEE, 'edit_user'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const [periods, settings, classes, subjects, teachers, assignments, class_subjects, class_periods] = await Promise.all([
    loadPeriods(school), loadSettings(school), loadClasses(school), loadSubjects(school), loadTeachers(school), loadAssignments(school), classSubjectMap(school), loadClassPeriods(school),
  ]);
  res.json({ periods, settings, classes, subjects, teachers, assignments, class_subjects, class_periods, today: todayStr(), day_names: DAY_NAMES });
}));

/* ------------------------------------------------------------------ 1. structure */
r.put('/structure', requireFeature('manage_timetable_setup'), asyncH(async (req, res) => {
  const school = schoolOf(req); const b = body(req);
  const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort();
  if (!days.length) throw httpError(400, 'Choose at least one school day');
  const maxLoad = Number(b.max_load);
  if (!Number.isInteger(maxLoad) || maxLoad < 1 || maxLoad > 80) throw httpError(400, 'Teacher limit must be between 1 and 80 periods a week');
  const list = Array.isArray(b.periods) ? b.periods : [];
  if (!list.length) throw httpError(400, 'Add at least one period');
  if (list.length > 20) throw httpError(400, 'Up to 20 periods a day');
  let prevEnd = '';
  const rows = list.map((p, i) => {
    const name = String(p.name || '').trim().slice(0, 40);
    if (!name) throw httpError(400, `Period ${i + 1} needs a name`);
    if (!TIME.test(p.start_time || '') || !TIME.test(p.end_time || '')) throw httpError(400, `${name}: enter a start and end time`);
    if (p.end_time <= p.start_time) throw httpError(400, `${name}: end time must be after the start time`);
    if (prevEnd && p.start_time < prevEnd) throw httpError(400, `${name} starts before the previous period ends`);
    prevEnd = p.end_time;
    return { id: p.id && UUID.test(p.id) ? p.id : null, no: i + 1, name, start_time: p.start_time, end_time: p.end_time, is_break: !!p.is_break };
  });

  const existing = await loadPeriods(school);
  const keep = new Set(rows.filter((x) => x.id).map((x) => x.id));
  for (const id of keep) if (!existing.some((e) => e.id === id)) throw httpError(400, 'Unknown period');
  const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (drop.length) { const { error } = await db.from('tt_periods').delete().in('id', drop).eq('school_id', school); check(error); }
  for (const row of rows) {
    if (row.id) {
      const { id, ...patch } = row;
      const { error } = await db.from('tt_periods').update(patch).eq('id', id).eq('school_id', school); check(error);
      if (row.is_break) { const e2 = await db.from('tt_slots').delete().eq('period_id', id); check(e2.error); }
    } else {
      const { id, ...ins } = row;
      const { error } = await db.from('tt_periods').insert({ ...ins, school_id: school }); check(error);
    }
  }
  // periods on days that are no longer school days are removed from class timetables
  const { error: e3 } = await db.from('tt_slots').delete().eq('school_id', school).not('day', 'in', `(${days.join(',')})`); check(e3);
  const { error: e4 } = await db.from('tt_settings').upsert({ school_id: school, days, max_load: maxLoad, updated_at: new Date().toISOString() }); check(e4);
  res.json({ periods: await loadPeriods(school), settings: { days, max_load: maxLoad } });
}));

// periods per week of each subject in each class (admin enters it once; teachers just take them)
r.put('/class-periods', requireFeature('manage_timetable_setup', 'manage_timetable'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const items = Array.isArray(body(req).items) ? body(req).items : [];
  if (items.length > 3000) throw httpError(400, 'Too many rows');
  const rows = items.map((it) => {
    const n = it.periods_per_week === '' || it.periods_per_week == null ? null : Number(it.periods_per_week);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 40)) throw httpError(400, 'Periods per week must be a whole number from 0 to 40');
    return { school_id: school, class_id: uid(it.class_id, 'class'), subject_id: uid(it.subject_id, 'subject'), periods_per_week: n };
  });
  if (rows.length) {
    const [cl, su] = await Promise.all([
      db.from('classes').select('id').eq('school_id', school).in('id', [...new Set(rows.map((x) => x.class_id))]),
      db.from('subjects').select('id').eq('school_id', school).in('id', [...new Set(rows.map((x) => x.subject_id))]),
    ]);
    check(cl.error); check(su.error);
    if (cl.data.length !== new Set(rows.map((x) => x.class_id)).size) throw httpError(400, 'Unknown class');
    if (su.data.length !== new Set(rows.map((x) => x.subject_id)).size) throw httpError(400, 'Unknown subject');
    for (let i = 0; i < rows.length; i += 500) { const e = await db.from('class_subjects').upsert(rows.slice(i, i + 500), { onConflict: 'class_id,subject_id' }); check(e.error); }
  }
  res.json({ ok: true, saved: rows.length });
}));

/* ------------------------------------------------------------------ class plan: subjects of a class + teacher + periods a week (one screen) */
async function applyPlan(school, classId, items) {
  const ids = items.map((i) => i.subject_id);
  const { data: have, error } = await db.from('class_subjects').select('subject_id').eq('school_id', school).eq('class_id', classId); check(error);
  const gone = have.map((h) => h.subject_id).filter((x) => !ids.includes(x));
  if (gone.length) {
    for (const [t, col] of [['tt_slots', 'subject_id'], ['tt_assignments', 'subject_id'], ['class_subjects', 'subject_id']]) {
      const d = await db.from(t).delete().eq('class_id', classId).in(col, gone); check(d.error);
    }
  }
  if (items.length) { const u = await db.from('class_subjects').upsert(items.map((i) => ({ school_id: school, class_id: classId, subject_id: i.subject_id, periods_per_week: i.periods_per_week })), { onConflict: 'class_id,subject_id' }); check(u.error); }
  for (const it of items) {
    if (!it.teacher_id) {
      const a = await db.from('tt_assignments').delete().eq('class_id', classId).eq('subject_id', it.subject_id); check(a.error);
      const b2 = await db.from('tt_slots').delete().eq('class_id', classId).eq('subject_id', it.subject_id); check(b2.error);
      continue;
    }
    const a = await db.from('tt_assignments').delete().eq('class_id', classId).eq('subject_id', it.subject_id).neq('teacher_id', it.teacher_id); check(a.error);
    const b2 = await db.from('tt_slots').delete().eq('class_id', classId).eq('subject_id', it.subject_id).neq('teacher_id', it.teacher_id); check(b2.error);
    const u = await db.from('tt_assignments').upsert({ school_id: school, teacher_id: it.teacher_id, class_id: classId, subject_id: it.subject_id, periods_per_week: it.periods_per_week || 5 }, { onConflict: 'teacher_id,class_id,subject_id' }); check(u.error);
  }
}

r.put('/class-plan/:id', requireFeature('manage_timetable_setup', 'manage_timetable'), asyncH(async (req, res) => {
  const school = schoolOf(req); const cls = await mustClass(school, req.params.id); const b = body(req);
  const input = Array.isArray(b.items) ? b.items : [];
  if (input.length > 60) throw httpError(400, 'Too many subjects');
  const seen = new Map();
  for (const it of input) {
    const subject_id = uid(it.subject_id, 'subject');
    const teacher_id = it.teacher_id ? uid(it.teacher_id, 'teacher') : null;
    const n = it.periods_per_week === '' || it.periods_per_week == null ? null : Number(it.periods_per_week);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 40)) throw httpError(400, 'Periods per week must be a whole number from 0 to 40');
    seen.set(subject_id, { subject_id, teacher_id, periods_per_week: n });
  }
  const items = [...seen.values()];
  const copy = [...new Set((Array.isArray(b.copy_to) ? b.copy_to : []).filter((x) => x !== cls.id).map((x) => uid(x, 'class')))];
  const checks = [
    items.length ? db.from('subjects').select('id').eq('school_id', school).in('id', items.map((i) => i.subject_id)) : { data: [], error: null },
    copy.length ? db.from('classes').select('id').eq('school_id', school).in('id', copy) : { data: [], error: null },
    items.some((i) => i.teacher_id) ? db.from('users').select('user_id,role').eq('school_id', school).in('user_id', [...new Set(items.filter((i) => i.teacher_id).map((i) => i.teacher_id))]) : { data: [], error: null },
  ];
  const [su, cl, us] = await Promise.all(checks);
  check(su.error); check(cl.error); check(us.error);
  if (su.data.length !== items.length) throw httpError(400, 'Unknown subject');
  if (cl.data.length !== copy.length) throw httpError(400, 'Unknown class');
  const want = new Set(items.filter((i) => i.teacher_id).map((i) => i.teacher_id));
  if (us.data.length !== want.size || us.data.some((u) => !TEACHER_ROLES.includes(u.role))) throw httpError(400, 'Unknown teacher');
  for (const id of [cls.id, ...copy]) await applyPlan(school, id, items);
  res.json({ ok: true, classes: 1 + copy.length });
}));

// delete the timetable (all classes, or only the given ones)
r.post('/clear', requireFeature('manage_timetable'), asyncH(async (req, res) => {
  const school = schoolOf(req); const ids = Array.isArray(body(req).class_ids) ? body(req).class_ids.map((x) => uid(x, 'class')) : [];
  let q = db.from('tt_slots').delete().eq('school_id', school); if (ids.length) q = q.in('class_id', ids);
  const { data, error } = await q.select('id'); check(error);
  let q2 = db.from('tt_substitutions').delete().eq('school_id', school).gte('sub_date', todayStr()); if (ids.length) q2 = q2.in('class_id', ids);
  const e2 = await q2; check(e2.error);
  res.json({ ok: true, removed: data.length });
}));

/* ------------------------------------------------------------------ 2. what a teacher teaches (edited in the teacher's profile) */
r.get('/teachers/:id/assignments', requireFeature(...SEE, 'edit_user', 'get_user'), asyncH(async (req, res) => {
  const school = schoolOf(req); const tid = uid(req.params.id, 'teacher');
  const [{ data: items, error }, slots] = await Promise.all([
    db.from('tt_assignments').select('class_id,subject_id,periods_per_week').eq('school_id', school).eq('teacher_id', tid).order('created_at'),
    loadSlots(school, { teacher_id: tid }),
  ]);
  check(error);
  res.json(items.map((a) => ({ ...a, scheduled: slots.filter((s) => s.class_id === a.class_id && s.subject_id === a.subject_id).length })));
}));

r.put('/teachers/:id/assignments', requireFeature('edit_user', 'manage_timetable'), asyncH(async (req, res) => {
  const school = schoolOf(req); const tid = uid(req.params.id, 'teacher');
  const t = await teacherName(school, tid);
  if (!TEACHER_ROLES.includes(t.role)) throw httpError(400, 'Only staff can be given classes to teach');
  const input = Array.isArray(body(req).items) ? body(req).items : [];
  if (input.length > 120) throw httpError(400, 'Too many rows');
  const seen = new Map();
  for (const it of input) {
    const class_id = uid(it.class_id, 'class'); const subject_id = uid(it.subject_id, 'subject');
    const ppw = Number(it.periods_per_week);
    if (!Number.isInteger(ppw) || ppw < 1 || ppw > 40) throw httpError(400, 'Periods per week must be a whole number from 1 to 40');
    seen.set(`${class_id}|${subject_id}`, { school_id: school, teacher_id: tid, class_id, subject_id, periods_per_week: ppw });
  }
  const rows = [...seen.values()];
  if (rows.length) {
    const [cl, su] = await Promise.all([
      db.from('classes').select('id').eq('school_id', school).in('id', [...new Set(rows.map((x) => x.class_id))]),
      db.from('subjects').select('id').eq('school_id', school).in('id', [...new Set(rows.map((x) => x.subject_id))]),
    ]);
    check(cl.error); check(su.error);
    if (cl.data.length !== new Set(rows.map((x) => x.class_id)).size) throw httpError(400, 'Unknown class');
    if (su.data.length !== new Set(rows.map((x) => x.subject_id)).size) throw httpError(400, 'Unknown subject');
  }
  const del = await db.from('tt_assignments').delete().eq('school_id', school).eq('teacher_id', tid); check(del.error);
  if (rows.length) { const ins = await db.from('tt_assignments').insert(rows); check(ins.error); await ensureCombos(school, rows); }
  // timetable periods of things this teacher no longer teaches are removed
  const slots = await loadSlots(school, { teacher_id: tid });
  const gone = slots.filter((s) => !seen.has(`${s.class_id}|${s.subject_id}`)).map((s) => s.id);
  if (gone.length) { const e = await db.from('tt_slots').delete().in('id', gone); check(e.error); }
  res.json({ ok: true, saved: rows.length, removed_periods: gone.length });
}));

/* ------------------------------------------------------------------ 3. the timetable */
r.get('/slots', requireFeature(...SEE), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const f = {};
  if (req.query.class_id) f.class_id = uid(req.query.class_id, 'class');
  if (req.query.teacher_id) f.teacher_id = uid(req.query.teacher_id, 'teacher');
  res.json(await loadSlots(school, f));
}));

// for one empty cell: which teachers could take it (they teach it in this class) and who is already busy then
r.get('/classes/:id/options', requireFeature('manage_timetable'), asyncH(async (req, res) => {
  const school = schoolOf(req); const cls = await mustClass(school, req.params.id);
  const day = Number(req.query.day); const period_id = uid(req.query.period_id, 'period');
  const [assign, classSlots, busy] = await Promise.all([
    db.from('tt_assignments').select('teacher_id,subject_id,periods_per_week').eq('school_id', school).eq('class_id', cls.id),
    loadSlots(school, { class_id: cls.id }),
    db.from('tt_slots').select('teacher_id,class_id,classes(name,section)').eq('school_id', school).eq('day', day).eq('period_id', period_id),
  ]);
  check(assign.error); check(busy.error);
  const busyBy = new Map(busy.data.map((b) => [b.teacher_id, b]));
  res.json(assign.data.map((a) => {
    const b = busyBy.get(a.teacher_id);
    return {
      teacher_id: a.teacher_id, subject_id: a.subject_id, periods_per_week: a.periods_per_week,
      scheduled: classSlots.filter((s) => s.teacher_id === a.teacher_id && s.subject_id === a.subject_id).length,
      busy: b && b.class_id !== cls.id ? clsLabel(Array.isArray(b.classes) ? b.classes[0] : b.classes) : null,
    };
  }));
}));

r.put('/classes/:id/slot', requireFeature('manage_timetable'), asyncH(async (req, res) => {
  const school = schoolOf(req); const cls = await mustClass(school, req.params.id); const b = body(req);
  const day = Number(b.day); const period_id = uid(b.period_id, 'period');
  const settings = await loadSettings(school);
  if (!settings.days.includes(day)) throw httpError(400, 'That is not a school day');
  const { data: period, error: pe } = await db.from('tt_periods').select('id,name,is_break').eq('id', period_id).eq('school_id', school).maybeSingle();
  check(pe); if (!period) throw httpError(404, 'Period not found');
  if (period.is_break) throw httpError(400, 'Breaks cannot have a subject');

  if (!b.teacher_id && !b.subject_id) { // clear the cell
    const { error } = await db.from('tt_slots').delete().eq('class_id', cls.id).eq('day', day).eq('period_id', period_id).eq('school_id', school); check(error);
    return res.json({ ok: true });
  }
  const teacher_id = uid(b.teacher_id, 'teacher'); const subject_id = uid(b.subject_id, 'subject');
  const { data: a, error: ae } = await db.from('tt_assignments').select('id,periods_per_week').eq('school_id', school).eq('class_id', cls.id).eq('teacher_id', teacher_id).eq('subject_id', subject_id).maybeSingle();
  check(ae);
  if (!a) throw httpError(400, 'This teacher is not set to teach this subject in this class. Add it in the teacher\'s profile first.');
  const { data: clash, error: ce } = await db.from('tt_slots').select('class_id,classes(name,section)').eq('school_id', school).eq('teacher_id', teacher_id).eq('day', day).eq('period_id', period_id).neq('class_id', cls.id).maybeSingle();
  check(ce);
  if (clash) { const t = await teacherName(school, teacher_id); throw httpError(409, `${t.name} is already teaching Class ${clsLabel(Array.isArray(clash.classes) ? clash.classes[0] : clash.classes)} in this period`); }

  const { error } = await db.from('tt_slots').upsert({ school_id: school, class_id: cls.id, day, period_id, subject_id, teacher_id }, { onConflict: 'class_id,day,period_id' });
  check(error);

  const warnings = [];
  const [mine, same] = await Promise.all([loadSlots(school, { teacher_id }), loadSlots(school, { class_id: cls.id })]);
  if (mine.length > settings.max_load) warnings.push(`This teacher now has ${mine.length} periods a week (limit ${settings.max_load}).`);
  const placed = same.filter((s) => s.teacher_id === teacher_id && s.subject_id === subject_id).length;
  const plan = (await loadClassPeriods(school))[cls.id]?.[subject_id] ?? a.periods_per_week;
  if (placed > plan) warnings.push(`That is more than the ${plan} periods a week planned for this subject.`);
  res.json({ ok: true, warning: warnings.join(' ') || null });
}));

/* ------------------------------------------------------------------ 3b. AUTOMATIC TIMETABLE
   Uses: subjects of each class (class_subjects) + the teachers given them (tt_assignments, periods per week).
   Optional auto_assign: a subject with no teacher in a class gets a teacher who already teaches that subject elsewhere (lightest load first).
   POST /auto-generate { class_ids?: [], mode: 'fill'|'replace', auto_assign: bool, apply: bool, seed?: number }
   apply=false -> preview only (returns a seed); send the same seed with apply=true to save exactly that result. */
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// Predictable timetable: a subject of a class sits in the SAME period row on its days (e.g. Maths of 6A = Period 2 every day),
// so a teacher keeps the same period for the same class all week. Only leftovers become small exceptions.
function buildTimetable({ days, periods, maxLoad, assigns, fixedSlots, seed }) {
  const rand = rng(seed); const D = days.length;
  const pids = periods.filter((p) => !p.is_break).map((p) => p.id);
  const tBusy = new Set(); const cBusy = new Set(); const tTotal = {}; const subDay = new Set(); const rowOf = {};
  const mark = (s) => {
    tBusy.add(`${s.teacher_id}|${s.day}|${s.period_id}`); cBusy.add(`${s.class_id}|${s.day}|${s.period_id}`);
    tTotal[s.teacher_id] = (tTotal[s.teacher_id] || 0) + 1; subDay.add(`${s.class_id}|${s.subject_id}|${s.day}`);
    (rowOf[`${s.class_id}|${s.subject_id}`] ||= new Set()).add(s.period_id);
  };
  fixedSlots.forEach(mark);
  const free = (a, d, pid) => !cBusy.has(`${a.class_id}|${d}|${pid}`) && !tBusy.has(`${a.teacher_id}|${d}|${pid}`);
  const out = []; const put = (a, d, pid) => { const s = { class_id: a.class_id, subject_id: a.subject_id, teacher_id: a.teacher_id, day: d, period_id: pid }; mark(s); out.push(s); a.left -= 1; };
  // evenly spread day choice: 2 -> Mon, Thu ; 3 -> Mon, Wed, Fri ; rotated by `shift` when that row is taken
  const pattern = (n, shift) => [...new Set(Array.from({ length: n }, (_, i) => days[(Math.round((i * D) / n) + shift) % D]))];

  const list = assigns.map((a) => ({ ...a, left: a.need, n0: a.need, j: rand() })).filter((a) => a.left > 0);
  const load = {}; list.forEach((a) => { load[a.teacher_id] = (load[a.teacher_id] || 0) + a.left; });
  list.sort((x, y) => (load[y.teacher_id] - load[x.teacher_id]) || (y.need - x.need) || (x.j - y.j));
  const P = pids.length; const LOW = 3;                     // subjects with 1-3 periods a week are "light" (games, art, library...)
  const daily = list.filter((a) => a.n0 > LOW);
  const rank = (a) => daily.filter((x) => x.class_id === a.class_id).sort((p, q) => q.n0 - p.n0).findIndex((x) => x === a);

  // 1) DAILY subjects first: one period row that repeats on n days, biggest subjects in the earliest periods
  const blocks = [];
  daily.forEach((a) => { let n = a.left; while (n > 0) { const take = Math.min(n, D); blocks.push({ a, n: take }); n -= take; } });
  blocks.sort((x, y) => (y.n - x.n));
  for (const { a, n } of blocks) {
    if (a.left <= 0) continue;
    const want = Math.min(n, a.left); let best = null; let bestCost = Infinity;
    for (let ri = 0; ri < P; ri += 1) for (let shift = 0; shift < D; shift += 1) {
      const ds = pattern(want, shift);
      if (ds.length < want) continue;
      if (!ds.every((d) => free(a, d, pids[ri]) && !subDay.has(`${a.class_id}|${a.subject_id}|${d}`))) continue;
      if ((tTotal[a.teacher_id] || 0) + want > maxLoad) continue;
      const used = rowOf[`${a.class_id}|${a.subject_id}`];
      const cost = Math.abs(ri - rank(a)) * 3 + (ri >= P - 2 ? 8 : 0) + shift * 2 + (used && !used.has(pids[ri]) ? 8 : 0) + rand() * 1.5;
      if (cost < bestCost) { bestCost = cost; best = { ri, ds }; }
    }
    if (best) best.ds.forEach((d) => put(a, d, pids[best.ri]));
  }

  // 2) LIGHT subjects: Wednesday & Saturday, last / second-last period (then Friday, Tuesday...), same period row each time
  const PREF = [6, 3, 5, 2, 4, 1, 7].filter((d) => days.includes(d));
  const light = list.filter((a) => a.n0 <= LOW);
  for (let round = 0; round < LOW; round += 1) {
    for (const a of light) {
      if (a.left <= 0 || (tTotal[a.teacher_id] || 0) >= maxLoad) continue;
      let best = null; let bestCost = Infinity; const used = rowOf[`${a.class_id}|${a.subject_id}`];
      for (const d of days) for (let ri = 0; ri < P; ri += 1) {
        const pid = pids[ri]; if (!free(a, d, pid)) continue;
        const fromEnd = P - 1 - ri;
        const cost = PREF.indexOf(d) * 3 + (fromEnd === 0 ? 0 : fromEnd === 1 ? 1 : 6 + fromEnd) + (used && !used.has(pid) ? 5 : 0) + (subDay.has(`${a.class_id}|${a.subject_id}|${d}`) ? 50 : 0) + rand() * 1.5;
        if (cost < bestCost) { bestCost = cost; best = [d, pid]; }
      }
      if (best) put(a, best[0], best[1]);
    }
  }

  // 3) exceptions: whatever is left goes to a free box, preferring a period this subject already uses and days it is not on yet
  for (const a of list) {
    while (a.left > 0) {
      if ((tTotal[a.teacher_id] || 0) >= maxLoad) break;
      let best = null; let bestCost = Infinity; const used = rowOf[`${a.class_id}|${a.subject_id}`];
      for (const d of days) for (const pid of pids) {
        if (!free(a, d, pid)) continue;
        const cost = (subDay.has(`${a.class_id}|${a.subject_id}|${d}`) ? 50 : 0) + (used && used.has(pid) ? 0 : 10) + pids.indexOf(pid) + rand() * 2;
        if (cost < bestCost) { bestCost = cost; best = [d, pid]; }
      }
      if (!best) break;
      put(a, best[0], best[1]);
    }
  }
  const shortfall = list.filter((a) => a.left > 0).map((a) => ({ class_id: a.class_id, subject_id: a.subject_id, teacher_id: a.teacher_id, missing: a.left }));
  return { slots: out, shortfall };
}

r.post('/auto-generate', requireFeature('manage_timetable'), asyncH(async (req, res) => {
  const school = schoolOf(req); const b = body(req);
  const apply = b.apply === true; const replace = b.mode === 'replace'; const autoAssign = b.auto_assign !== false;
  const seed = Number.isInteger(b.seed) ? b.seed : Math.floor(Math.random() * 2 ** 31);
  const [periods, settings, classes, teachers, assignments, allSlots, csMap] = await Promise.all([
    loadPeriods(school), loadSettings(school), loadClasses(school), loadTeachers(school), loadAssignments(school), loadSlots(school), classSubjectMap(school),
  ]);
  const cp = await loadClassPeriods(school);
  const teaching = periods.filter((p) => !p.is_break);
  if (!teaching.length) throw httpError(400, 'Set up the periods first (Timetable > Structure)');
  const picked = Array.isArray(b.class_ids) && b.class_ids.length ? classes.filter((c) => b.class_ids.includes(c.id)) : classes;
  if (!picked.length) throw httpError(400, 'Choose at least one class');
  const pickedIds = new Set(picked.map((c) => c.id));
  const notes = [];

  // 1) the teacher of every subject of the class (periods per week come from Structure > Periods per subject)
  const assigns = assignments.filter((a) => pickedIds.has(a.class_id)).map((a) => ({ ...a }));
  const newAssign = [];
  const tLoad = {}; assignments.forEach((a) => { tLoad[a.teacher_id] = (tLoad[a.teacher_id] || 0) + a.periods_per_week; });
  for (const c of picked) {
    for (const sub of csMap[c.id] || []) {
      if (assigns.some((a) => a.class_id === c.id && a.subject_id === sub)) continue;
      const n = cp[c.id]?.[sub] ?? 0;
      if (!autoAssign) { notes.push({ class_id: c.id, subject_id: sub, text: 'No teacher given' }); continue; }
      const cands = teachers.filter((t) => assignments.some((a) => a.teacher_id === t.user_id && a.subject_id === sub)).sort((x, y) => (tLoad[x.user_id] || 0) - (tLoad[y.user_id] || 0));
      if (!cands[0]) { notes.push({ class_id: c.id, subject_id: sub, text: 'No teacher teaches this subject anywhere yet' }); continue; }
      const row = { school_id: school, teacher_id: cands[0].user_id, class_id: c.id, subject_id: sub, periods_per_week: n || 4 };
      newAssign.push(row); assigns.push({ ...row }); tLoad[cands[0].user_id] = (tLoad[cands[0].user_id] || 0) + row.periods_per_week;
    }
  }
  for (const c of picked) for (const sub of csMap[c.id] || []) if (cp[c.id]?.[sub] == null) notes.push({ class_id: c.id, subject_id: sub, text: 'periods per week not set (Structure), 4 used' });

  // 2) what is already fixed
  const keep = allSlots.filter((s) => !(replace && pickedIds.has(s.class_id)));
  const need = assigns.map((a) => {
    const total = cp[a.class_id]?.[a.subject_id] ?? a.periods_per_week;
    const have = keep.filter((s) => s.class_id === a.class_id && s.subject_id === a.subject_id && s.teacher_id === a.teacher_id).length;
    return { ...a, need: Math.max(0, total - have) };
  });

  // 3) best of several tries
  let best = null;
  for (let i = 0; i < 25; i += 1) {
    const t = buildTimetable({ days: settings.days, periods, maxLoad: settings.max_load, assigns: need, fixedSlots: keep, seed: seed + i * 7919 });
    const miss = t.shortfall.reduce((n, x) => n + x.missing, 0);
    if (!best || miss < best.miss) best = { ...t, miss, used: seed + i * 7919 };
    if (!miss) break;
  }
  const result = {
    seed: best.used, applied: apply, placed: best.slots.length, shortfall: best.shortfall, notes, new_assignments: newAssign.length,
    per_class: picked.map((c) => ({ class_id: c.id, placed: best.slots.filter((s) => s.class_id === c.id).length, kept: keep.filter((s) => s.class_id === c.id).length, slots_total: teaching.length * settings.days.length })),
  };
  if (!apply) return res.json({ ...result, slots: [...keep.map((s) => ({ class_id: s.class_id, subject_id: s.subject_id, teacher_id: s.teacher_id, day: s.day, period_id: s.period_id })), ...best.slots] });

  if (replace) { const d = await db.from('tt_slots').delete().eq('school_id', school).in('class_id', [...pickedIds]); check(d.error); }
  if (newAssign.length) { const i = await db.from('tt_assignments').upsert(newAssign, { onConflict: 'teacher_id,class_id,subject_id', ignoreDuplicates: true }); check(i.error); await ensureCombos(school, newAssign); }
  for (let i = 0; i < best.slots.length; i += 500) {
    const ins = await db.from('tt_slots').insert(best.slots.slice(i, i + 500).map((s) => ({ ...s, school_id: school }))); check(ins.error);
  }
  res.json(result);
}));

/* ------------------------------------------------------------------ 4. workload & coverage */
r.get('/workload', requireFeature(...SEE), asyncH(async (req, res) => {
  const school = schoolOf(req); const today = todayStr();
  const [periods, settings, classes, teachers, assignments, slots, subs] = await Promise.all([
    loadPeriods(school), loadSettings(school), loadClasses(school), loadTeachers(school), loadAssignments(school), loadSlots(school),
    db.from('tt_substitutions').select('id', { count: 'exact', head: true }).eq('school_id', school).eq('sub_date', today),
  ]);
  check(subs.error);
  const teaching = periods.filter((p) => !p.is_break).length;
  const perTeacher = teachers.map((t) => {
    const mine = assignments.filter((a) => a.teacher_id === t.user_id);
    const sl = slots.filter((s) => s.teacher_id === t.user_id);
    return {
      teacher_id: t.user_id, assigned: mine.reduce((n, a) => n + a.periods_per_week, 0), scheduled: sl.length,
      classes: new Set(mine.map((a) => a.class_id)).size, subjects: new Set(mine.map((a) => a.subject_id)).size,
      free: Math.max(0, teaching * settings.days.length - sl.length),
    };
  });
  const required = assignments.reduce((n, a) => n + a.periods_per_week, 0);
  const perClass = classes.map((c) => {
    const req2 = assignments.filter((a) => a.class_id === c.id).reduce((n, a) => n + a.periods_per_week, 0);
    const sched = slots.filter((s) => s.class_id === c.id).length;
    return { class_id: c.id, required: req2, scheduled: sched, empty: Math.max(0, teaching * settings.days.length - sched) };
  });
  res.json({
    max_load: settings.max_load, teachers: perTeacher, classes: perClass,
    totals: { teachers: teachers.length, required, scheduled: slots.length, unassigned: Math.max(0, required - slots.length), clashes: 0, substitutions_today: subs.count || 0, slots_per_class: teaching * settings.days.length },
  });
}));

/* ------------------------------------------------------------------ 5. substitutions */
const onLeave = async (school, date) => {
  const { data, error } = await db.from('leave_requests').select('user_id').eq('school_id', school).eq('status', 'approved').lte('start_date', date).gte('end_date', date);
  check(error); return new Set(data.map((x) => x.user_id));
};

r.get('/substitutions', requireFeature(...SEE), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const from = req.query.from ? validDate(req.query.from, 'From date') : todayStr();
  const to = req.query.to ? validDate(req.query.to, 'To date') : addDays(from, 6);
  const { data, error } = await db.from('tt_substitutions').select('id,sub_date,class_id,period_id,subject_id,absent_teacher_id,substitute_teacher_id').eq('school_id', school).gte('sub_date', from).lte('sub_date', to).order('sub_date');
  check(error); res.json(data);
}));

// "Teacher X is absent on DATE": their periods that day, and for each one the teachers who are free
r.get('/substitutions/plan', requireFeature('manage_substitutions'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const date = validDate(req.query.date, 'Date'); const teacher_id = uid(req.query.teacher_id, 'teacher'); const day = dow(date);
  const [settings, teachers, assignments, leave] = await Promise.all([loadSettings(school), loadTeachers(school), loadAssignments(school), onLeave(school, date)]);
  if (!settings.days.includes(day)) return res.json({ date, day, school_day: false, periods: [] });
  const [mine, allToday, subsToday] = await Promise.all([
    db.from('tt_slots').select('class_id,period_id,subject_id').eq('school_id', school).eq('teacher_id', teacher_id).eq('day', day),
    db.from('tt_slots').select('teacher_id,period_id').eq('school_id', school).eq('day', day),
    db.from('tt_substitutions').select('id,class_id,period_id,substitute_teacher_id').eq('school_id', school).eq('sub_date', date),
  ]);
  check(mine.error); check(allToday.error); check(subsToday.error);
  const busy = (tid, pid) => allToday.data.some((s) => s.teacher_id === tid && s.period_id === pid) || subsToday.data.some((s) => s.substitute_teacher_id === tid && s.period_id === pid);
  const loadToday = (tid) => allToday.data.filter((s) => s.teacher_id === tid).length + subsToday.data.filter((s) => s.substitute_teacher_id === tid).length;
  const periods = mine.data.map((s) => {
    const existing = subsToday.data.find((x) => x.class_id === s.class_id && x.period_id === s.period_id) || null;
    const candidates = teachers
      .filter((t) => t.user_id !== teacher_id && !leave.has(t.user_id) && (!busy(t.user_id, s.period_id) || existing?.substitute_teacher_id === t.user_id))
      .map((t) => ({
        teacher_id: t.user_id,
        same_subject: assignments.some((a) => a.teacher_id === t.user_id && a.subject_id === s.subject_id),
        same_class: assignments.some((a) => a.teacher_id === t.user_id && a.class_id === s.class_id),
        load_today: loadToday(t.user_id),
      }))
      .sort((a, b) => (b.same_subject - a.same_subject) || (b.same_class - a.same_class) || (a.load_today - b.load_today));
    return { class_id: s.class_id, period_id: s.period_id, subject_id: s.subject_id, substitution: existing, candidates };
  });
  res.json({ date, day, school_day: true, absent_on_leave: leave.has(teacher_id), periods });
}));

r.post('/substitutions', requireFeature('manage_substitutions'), asyncH(async (req, res) => {
  const school = schoolOf(req); const b = body(req);
  const date = validDate(b.date, 'Date'); const day = dow(date);
  const class_id = uid(b.class_id, 'class'); const period_id = uid(b.period_id, 'period'); const sub = uid(b.substitute_teacher_id, 'teacher');
  const { data: slot, error } = await db.from('tt_slots').select('teacher_id,subject_id').eq('school_id', school).eq('class_id', class_id).eq('day', day).eq('period_id', period_id).maybeSingle();
  check(error);
  if (!slot) throw httpError(400, 'That class has no period at that time on this day');
  if (slot.teacher_id === sub) throw httpError(400, 'Choose a different teacher');
  const t = await teacherName(school, sub);
  if (!TEACHER_ROLES.includes(t.role)) throw httpError(400, 'That person cannot take classes');
  const [own, other, leave] = await Promise.all([
    db.from('tt_slots').select('id').eq('school_id', school).eq('teacher_id', sub).eq('day', day).eq('period_id', period_id).maybeSingle(),
    db.from('tt_substitutions').select('id,class_id').eq('school_id', school).eq('substitute_teacher_id', sub).eq('sub_date', date).eq('period_id', period_id).neq('class_id', class_id).maybeSingle(),
    onLeave(school, date),
  ]);
  check(own.error); check(other.error);
  if (own.data) throw httpError(409, `${t.name} has a class of their own in that period`);
  if (other.data) throw httpError(409, `${t.name} is already covering another class in that period`);
  if (leave.has(sub)) throw httpError(409, `${t.name} is on approved leave that day`);
  const { data, error: e2 } = await db.from('tt_substitutions').upsert({
    school_id: school, sub_date: date, class_id, period_id, subject_id: slot.subject_id, absent_teacher_id: slot.teacher_id, substitute_teacher_id: sub, created_by: req.user.user_id,
  }, { onConflict: 'class_id,sub_date,period_id' }).select('*').single();
  check(e2);
  res.status(201).json(data);
}));

r.delete('/substitutions/:id', requireFeature('manage_substitutions'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const { error } = await db.from('tt_substitutions').delete().eq('id', uid(req.params.id, 'substitution')).eq('school_id', school); check(error);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ "my timetable": teachers see their own, students / parents see the class */
r.get('/my', requireFeature('view_my_timetable'), asyncH(async (req, res) => {
  const me = req.user; const school = me.school_id;
  if (!school) return res.json({ kind: 'none' });
  const today = todayStr();
  const [periods, settings, subjects, classes] = await Promise.all([loadPeriods(school), loadSettings(school), loadSubjects(school), loadClasses(school)]);
  const base = { periods, settings, subjects, classes, today, day: dow(today), day_names: DAY_NAMES };

  if (me.role === 'student' || me.role === 'parent') {
    let kids = [];
    if (me.role === 'student') kids = [{ user_id: me.user_id, name: me.profile?.full_name || 'Me', class_id: me.profile?.class_id }];
    else {
      const { data: l, error } = await db.from('parent_students').select('student_id').eq('parent_id', me.user_id); check(error);
      if (l.length) {
        const { data, error: e2 } = await db.from('users').select('user_id,profiles(full_name,class_id)').in('user_id', l.map((x) => x.student_id)); check(e2);
        kids = data.map((u) => { const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles; return { user_id: u.user_id, name: p?.full_name || 'Student', class_id: p?.class_id }; });
      }
    }
    const classIds = [...new Set(kids.map((k) => k.class_id).filter(Boolean))];
    if (!classIds.length) return res.json({ ...base, kind: 'class', children: kids, slots: [], subs: [], teachers: [] });
    const [slots, subs, teachers] = await Promise.all([
      fetchAll(() => db.from('tt_slots').select('id,class_id,day,period_id,subject_id,teacher_id').eq('school_id', school).in('class_id', classIds)),
      db.from('tt_substitutions').select('id,sub_date,class_id,period_id,substitute_teacher_id').eq('school_id', school).in('class_id', classIds).gte('sub_date', today).lte('sub_date', addDays(today, 6)),
      loadTeachers(school),
    ]);
    check(subs.error);
    const used = new Set([...slots.map((s) => s.teacher_id), ...subs.data.map((s) => s.substitute_teacher_id)]);
    return res.json({ ...base, kind: 'class', children: kids, slots, subs: subs.data, teachers: teachers.filter((t) => used.has(t.user_id)).map((t) => ({ user_id: t.user_id, name: t.name })) });
  }

  const [slots, duties, covered, teachers, assignments] = await Promise.all([
    loadSlots(school, { teacher_id: me.user_id }),
    db.from('tt_substitutions').select('id,sub_date,class_id,period_id,subject_id').eq('school_id', school).eq('substitute_teacher_id', me.user_id).gte('sub_date', today).lte('sub_date', addDays(today, 13)).order('sub_date'),
    db.from('tt_substitutions').select('id,sub_date,class_id,period_id,subject_id,substitute_teacher_id').eq('school_id', school).eq('absent_teacher_id', me.user_id).gte('sub_date', today).lte('sub_date', addDays(today, 13)).order('sub_date'),
    loadTeachers(school),
    db.from('tt_assignments').select('class_id,subject_id,periods_per_week').eq('school_id', school).eq('teacher_id', me.user_id),
  ]);
  check(duties.error); check(covered.error); check(assignments.error);
  res.json({
    ...base, kind: 'teacher', slots, duties: duties.data, covered: covered.data, assignments: assignments.data,
    teachers: teachers.map((t) => ({ user_id: t.user_id, name: t.name })), max_load: settings.max_load,
  });
}));

export default r;
