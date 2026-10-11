// Student attendance: see which classes are marked, mark attendance by names / roll numbers, reports.
import { httpError } from '../db.js';
import { S, N, obj, withSchool, resolveSchoolId, resolveClass, findStudent, P, norm, cap } from './helpers.js';
import { resolveDate, todayIn } from './tools-leave.js';

const VIEW = ['mark_attendance', 'view_attendance_reports'];
const list = { type: 'array', items: { type: 'string' } };
const pre = ['attendance'];

// "Aman", "12", "roll 12" -> the student of this sheet
function matchStudent(students, token) {
  const t = norm(token).replace(/^roll\s*(no\.?)?\s*/, '');
  if (/^\d+$/.test(t)) { const m = students.filter((s) => String(s.roll_no) === t); if (m.length === 1) return m[0]; }
  const exact = students.filter((s) => norm(s.full_name) === t);
  const found = exact.length ? exact : students.filter((s) => norm(s.full_name).includes(t));
  if (found.length === 1) return found[0];
  throw httpError(found.length ? 409 : 404, found.length ? `"${token}" matches more than one student: ${found.map((s) => `${s.full_name} (roll ${s.roll_no ?? '-'})`).join(', ')}. Use the roll number.` : `No student "${token}" in this class`);
}

export const attendanceTools = [
  {
    name: 'attendance_status',
    description: 'Which of my classes have attendance marked for a day (not marked / partly / marked, with present-absent counts). Default today.',
    features: ['mark_attendance', 'view_attendance_reports', 'manage_roll_numbers'],
    parameters: obj(withSchool({ date: S('today or YYYY-MM-DD') })),
    run: async (ctx, a) => {
      const r = await ctx.api('GET', P('/attendance/classes', { date: a.date ? resolveDate(a.date) : undefined, school_id: await resolveSchoolId(ctx, a.school) }));
      return { date: r.date, classes: r.classes.map((c) => ({ class: `${c.name}${c.section ? ` ${c.section}` : ''}`, state: c.state, students: c.total_students, present: c.present, absent: c.absent, late: c.late, leave: c.leave, marked_by: c.marked_by?.join(', ') || undefined })) };
    },
  },
  {
    name: 'get_class_attendance',
    description: 'Roll list of one class for a day with each student\'s status (present / absent / late / leave / not marked yet).',
    features: VIEW,
    parameters: obj(withSchool({ class_name: S('e.g. "5 A"'), date: S('today or YYYY-MM-DD') }), ['class_name']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const c = await resolveClass(ctx, a.class_name, sid, pre);
      const r = await ctx.api('GET', P('/attendance/sheet', { class_id: c.id, date: a.date ? resolveDate(a.date) : undefined, school_id: sid }));
      return { class: c.label, date: r.date, holiday: r.holiday?.title, can_edit: r.can_edit, summary: r.status, students: r.students.map((s) => ({ roll: s.roll_no, name: s.full_name, status: s.status || 'not marked' })) };
    },
  },
  {
    name: 'mark_attendance',
    description:
      'Mark / change attendance of one class for a day. Everyone not listed is Present (or keeps the status already saved). ' +
      'List students by name or roll number under absent / late / leave. Example: class "5 A", absent ["3","7","Aman"].',
    features: ['mark_attendance'],
    parameters: obj(withSchool({ class_name: S('e.g. "5 A"'), date: S('today (default) or YYYY-MM-DD'), absent: list, late: list, leave: list }), ['class_name']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const c = await resolveClass(ctx, a.class_name, sid, pre);
      const date = a.date ? resolveDate(a.date) : todayIn();
      const sheet = await ctx.api('GET', P('/attendance/sheet', { class_id: c.id, date, school_id: sid }));
      if (!sheet.students.length) throw httpError(400, 'This class has no students');
      const want = new Map();
      for (const [status, names] of [['absent', a.absent], ['late', a.late], ['leave', a.leave]]) for (const n of names || []) want.set(matchStudent(sheet.students, n).student_id, status);
      const records = sheet.students.map((s) => ({ student_id: s.student_id, status: want.get(s.student_id) || s.status || 'present' }));
      const r = await ctx.api('PUT', '/attendance/sheet', { class_id: c.id, date, records, school_id: sid });
      const count = (k) => records.filter((x) => x.status === k).length;
      return { saved: true, class: c.label, date: r.date, students: records.length, present: count('present'), absent: count('absent'), late: count('late'), leave: count('leave'), changed: r.saved };
    },
  },
  {
    name: 'class_attendance_report',
    description: 'Attendance report of a class over a period (default: current session): attendance % per student and the days.',
    features: ['view_attendance_reports'],
    parameters: obj(withSchool({ class_name: S('e.g. "5 A"'), from: S('YYYY-MM-DD'), to: S('YYYY-MM-DD') }), ['class_name']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const c = await resolveClass(ctx, a.class_name, sid, pre);
      const r = await ctx.api('GET', P('/attendance/reports/class', { class_id: c.id, from: a.from && resolveDate(a.from), to: a.to && resolveDate(a.to), school_id: sid }));
      return cap({ class: c.label, range: r.range, days_marked: r.working_days, overall: r.summary, students: r.students.map((s) => ({ roll: s.roll_no, name: s.full_name, present: s.present, absent: s.absent, late: s.late, leave: s.leave, percent: s.percent })) });
    },
  },
  {
    name: 'student_attendance_report',
    description: 'Attendance of one student over a period: totals, % , by month and the absent days.',
    features: ['view_attendance_reports'],
    parameters: obj(withSchool({ student: S('Student name or login id'), from: S('YYYY-MM-DD'), to: S('YYYY-MM-DD') }), ['student']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const s = await findStudent(ctx, a.student, sid, pre);
      const r = await ctx.api('GET', P(`/attendance/reports/student/${s.id}`, { from: a.from && resolveDate(a.from), to: a.to && resolveDate(a.to), school_id: sid }));
      return cap({ student: r.student.full_name, class: r.student.class && `${r.student.class.name} ${r.student.class.section || ''}`.trim(), range: r.range, summary: r.summary, months: r.months, absences: r.absences.slice(0, 30) });
    },
  },
  {
    name: 'low_attendance_students',
    description: 'Students whose attendance % is below a limit (default 75).',
    features: ['view_attendance_reports'],
    parameters: obj(withSchool({ threshold: N('Percent limit, default 75'), class_name: S('Only this class (optional)'), from: S('YYYY-MM-DD'), to: S('YYYY-MM-DD') })),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const c = a.class_name ? await resolveClass(ctx, a.class_name, sid, pre) : null;
      const r = await ctx.api('GET', P('/attendance/reports/low', { threshold: a.threshold, class_id: c?.id, from: a.from && resolveDate(a.from), to: a.to && resolveDate(a.to), school_id: sid }));
      return cap({ below_percent: r.threshold, range: r.range, count: r.students.length, students: r.students.slice(0, 40).map((s) => ({ name: s.full_name, class: s.class_label, roll: s.roll_no, percent: s.percent, absent: s.absent })) });
    },
  },
  {
    name: 'auto_assign_roll_numbers',
    description: 'Give roll numbers to a class: mode "fill" only numbers students who have none; mode "name" renumbers everyone A-Z (asks for confirmation).',
    features: ['manage_roll_numbers'],
    confirm: true,
    parameters: obj(withSchool({ class_name: S('e.g. "5 A"'), mode: S('fill (default) or name', { enum: ['fill', 'name'] }) }), ['class_name']),
    prepare: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const c = await resolveClass(ctx, a.class_name, sid, pre);
      return { args: { class_id: c.id, mode: a.mode === 'name' ? 'name' : 'fill', school_id: sid }, describe: a.mode === 'name' ? `Renumber ALL students of ${c.label} alphabetically (replaces existing roll numbers)` : `Give roll numbers to students of ${c.label} who have none` };
    },
    run: async (ctx, a) => { const r = await ctx.api('POST', '/attendance/rolls/auto', a); return { done: true, students: Array.isArray(r) ? r.length : undefined }; },
  },
  {
    name: 'my_attendance',
    description: 'For a student or parent: the attendance of the student (or of the parent\'s child). Optional child name.',
    features: [],
    roles: ['student', 'parent'],
    parameters: obj({ child: S('Child name or login id (parents with several children)') }),
    run: async (ctx, a) => {
      let id;
      if (ctx.user.role === 'parent') {
        const kids = await ctx.api('GET', '/users/my-children');
        if (!kids.length) throw httpError(404, 'No children are linked to your account');
        const k = a.child ? kids.find((x) => norm(x.profile?.full_name).includes(norm(a.child)) || norm(x.login_id) === norm(a.child)) : kids.length === 1 ? kids[0] : null;
        if (!k) throw httpError(409, `Which child? ${kids.map((x) => x.profile?.full_name || x.login_id).join(', ')}`);
        id = k.user_id;
      } else if (ctx.user.role === 'student') id = ctx.user.user_id;
      else throw httpError(403, 'This is for students and parents');
      const r = await ctx.api('GET', P('/attendance/my', { student_id: id }));
      return cap({ student: r.student.full_name, range: r.range, summary: r.summary, months: r.months, recent_absences: r.absences.slice(0, 15) });
    },
  },
];
