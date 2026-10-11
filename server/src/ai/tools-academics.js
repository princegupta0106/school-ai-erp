// Academics: subjects, exams, tests, entering marks, class and student reports.
import { httpError } from '../db.js';
import { S, N, B, obj, withSchool, resolveSchoolId, resolveClass, findStudent, pickOne, P, norm, cap } from './helpers.js';
import { resolveDate } from './tools-leave.js';

const pre = ['academics'];
const SEE = ['manage_subjects', 'manage_exams', 'manage_assessments', 'view_academic_reports'];
const meta = (ctx, sid) => ctx.api('GET', P('/academics/meta', { school_id: sid }));
const pct = (x) => (x && x.pct !== undefined ? x.pct : x);

async function findTest(ctx, sid, a) {
  const c = await resolveClass(ctx, a.class_name, sid, pre);
  const m = await meta(ctx, sid);
  const subj = a.subject ? pickOne(m.subjects, a.subject, (s) => s.name, 'subject') : null;
  const rows = await ctx.api('GET', P('/academics/assessments', { class_id: c.id, subject_id: subj?.id, school_id: sid }));
  const w = norm(a.test);
  const hit = rows.filter((r) => !w || norm(r.title).includes(w) || norm(r.exam_name).includes(w));
  const one = hit.length === 1 ? hit[0] : null;
  if (!one) throw httpError(hit.length ? 409 : 404, hit.length ? `Which test? ${hit.slice(0, 8).map((r) => `${r.title} (${r.subject_name}, ${r.date})`).join('; ')}` : `No test matching "${a.test || ''}" in ${c.label}`);
  return { test: one, cls: c };
}

export const academicsTools = [
  {
    name: 'academics_overview',
    description: 'Subjects, exams (Half-yearly, Final...), sessions and the classes I can use for academics.',
    features: SEE,
    parameters: obj(withSchool({})),
    run: async (ctx, a) => {
      const m = await meta(ctx, await resolveSchoolId(ctx, a.school));
      return { today: m.today, subjects: m.subjects.map((s) => s.name), exams: m.exams.map((e) => ({ name: e.name, from: e.start_date, to: e.end_date })), classes: m.classes.map((c) => `${c.name}${c.section ? ` ${c.section}` : ''}`), pass_percent: m.pass_percent };
    },
  },
  {
    name: 'create_subject',
    description: 'Add a subject (e.g. Maths).',
    features: ['manage_subjects'],
    parameters: obj(withSchool({ name: S('Subject name'), code: S('Short code (optional)') }), ['name']),
    run: async (ctx, a) => ({ created: true, ...(await ctx.api('POST', '/academics/subjects', { name: a.name, code: a.code, school_id: await resolveSchoolId(ctx, a.school) })) }),
  },
  {
    name: 'create_exam',
    description: 'Create an exam of the current session (e.g. Half-yearly). Teachers then add papers per class and subject.',
    features: ['manage_exams'],
    parameters: obj(withSchool({ name: S('Exam name'), start_date: S('YYYY-MM-DD (optional)'), end_date: S('YYYY-MM-DD (optional)') }), ['name']),
    run: async (ctx, a) => ({ created: true, ...(await ctx.api('POST', '/academics/exams', { name: a.name, start_date: a.start_date && resolveDate(a.start_date), end_date: a.end_date && resolveDate(a.end_date), school_id: await resolveSchoolId(ctx, a.school) })) }),
  },
  {
    name: 'list_tests',
    description: 'Tests / exam papers of a class (optionally one subject) with how many marks are entered and the class average.',
    features: ['manage_assessments', 'view_academic_reports'],
    parameters: obj(withSchool({ class_name: S('e.g. "5 A"'), subject: S('Subject (optional)') }), ['class_name']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const c = await resolveClass(ctx, a.class_name, sid, pre);
      const m = await meta(ctx, sid);
      const subj = a.subject ? pickOne(m.subjects, a.subject, (s) => s.name, 'subject') : null;
      const rows = await ctx.api('GET', P('/academics/assessments', { class_id: c.id, subject_id: subj?.id, school_id: sid }));
      return { class: c.label, tests: rows.slice(0, 30).map((r) => ({ title: r.title, kind: r.kind, exam: r.exam_name || undefined, subject: r.subject_name, date: r.date, max_marks: r.max_marks, marks_entered: `${r.entered}/${r.total_students}`, class_avg_percent: r.avg_pct, highest: r.highest, lowest: r.lowest })) };
    },
  },
  {
    name: 'create_test',
    description: 'Create a test (or an exam paper) for a class and subject. For an exam paper give exam_name. Date defaults to today.',
    features: ['manage_assessments'],
    parameters: obj(withSchool({ class_name: S('e.g. "5 A"'), subject: S('Subject'), title: S('e.g. "Unit test 1"'), max_marks: N('Maximum marks'), date: S('today or YYYY-MM-DD'), exam_name: S('Exam name if this is an exam paper') }), ['class_name', 'subject', 'max_marks']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const c = await resolveClass(ctx, a.class_name, sid, pre);
      const m = await meta(ctx, sid);
      const subj = pickOne(m.subjects, a.subject, (s) => s.name, 'subject');
      const exam = a.exam_name ? pickOne(m.exams, a.exam_name, (e) => e.name, 'exam') : null;
      const r = await ctx.api('POST', '/academics/assessments', { kind: exam ? 'exam' : 'test', exam_id: exam?.id, class_id: c.id, subject_id: subj.id, title: a.title, max_marks: a.max_marks, date: a.date && resolveDate(a.date), school_id: sid });
      return { created: true, title: r.title, class: c.label, subject: subj.name, max_marks: r.max_marks, date: r.date };
    },
  },
  {
    name: 'get_marks_sheet',
    description: 'Marks entered so far for one test / exam paper of a class.',
    features: ['manage_assessments', 'view_academic_reports'],
    parameters: obj(withSchool({ class_name: S('e.g. "5 A"'), test: S('Test title or part of it'), subject: S('Subject (helps to find the test)') }), ['class_name']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const { test } = await findTest(ctx, sid, a);
      const r = await ctx.api('GET', P(`/academics/assessments/${test.id}`, { school_id: sid }));
      return cap({ test: r.assessment.title, subject: r.assessment.subject_name, class: r.assessment.class_label, max_marks: r.assessment.max_marks, students: r.students.map((s) => ({ roll: s.roll_no, name: s.full_name, marks: s.absent ? 'absent' : s.marks })) });
    },
  },
  {
    name: 'enter_marks',
    description: 'Enter or change marks for a test. Give the test (class + title/subject) and the marks per student, by name or roll number. Use absent:true for absentees. Students not listed are left unchanged.',
    features: ['manage_assessments'],
    parameters: obj(withSchool({
      class_name: S('e.g. "5 A"'), test: S('Test title or part of it'), subject: S('Subject (helps to find the test)'),
      marks: { type: 'array', description: 'One entry per student', items: obj({ student: S('Student name or roll number'), marks: N('Marks obtained'), absent: B('true if absent') }, ['student']) },
    }), ['class_name', 'marks']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const { test } = await findTest(ctx, sid, a);
      const sheet = await ctx.api('GET', P(`/academics/assessments/${test.id}`, { school_id: sid }));
      const items = (a.marks || []).map((m) => {
        const t = norm(m.student).replace(/^roll\s*(no\.?)?\s*/, '');
        let s = /^\d+$/.test(t) ? sheet.students.filter((x) => String(x.roll_no) === t) : [];
        if (s.length !== 1) { const ex = sheet.students.filter((x) => norm(x.full_name) === t); s = ex.length ? ex : sheet.students.filter((x) => norm(x.full_name).includes(t)); }
        if (s.length !== 1) throw httpError(s.length ? 409 : 404, s.length ? `"${m.student}" matches several students: ${s.map((x) => `${x.full_name} (roll ${x.roll_no ?? '-'})`).join(', ')}. Use the roll number.` : `No student "${m.student}" in this class`);
        if (!m.absent && Number(m.marks) > Number(sheet.assessment.max_marks)) throw httpError(400, `${s[0].full_name}: ${m.marks} is more than the maximum ${sheet.assessment.max_marks}`);
        return { student_id: s[0].student_id, marks: m.absent ? null : m.marks, absent: !!m.absent };
      });
      const r = await ctx.api('PUT', `/academics/assessments/${test.id}/marks`, { items, school_id: sid });
      return { saved: items.length, test: r.assessment.title, entered: r.assessment.entered, of: r.assessment.total_students, class_avg_percent: r.assessment.avg_pct };
    },
  },
  {
    name: 'class_academic_report',
    description: 'Academic report of a class: class average, pass count, topper and every student\'s overall %, grade and rank.',
    features: ['view_academic_reports'],
    parameters: obj(withSchool({ class_name: S('e.g. "5 A"'), scope: S('all (default), tests or exams', { enum: ['all', 'tests', 'exams'] }) }), ['class_name']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const c = await resolveClass(ctx, a.class_name, sid, pre);
      const r = await ctx.api('GET', P('/academics/reports/class', { class_id: c.id, scope: a.scope, school_id: sid }));
      return cap({ class: r.class.label, summary: r.summary, pass_percent: r.pass_percent, subject_avg_percent: r.subjects.map((s) => `${s.name}: ${r.subject_avgs[s.id] ?? '-'}`), students: r.students.map((s) => ({ rank: s.rank, roll: s.roll_no, name: s.full_name, percent: s.total.pct, grade: s.grade })) });
    },
  },
  {
    name: 'student_academic_report',
    description: 'One student\'s academic dashboard: overall %, per subject, recent tests and exams. For staff (by name) or for students / parents (own / child: leave student empty or give the child name).',
    features: ['view_academic_reports', 'view_my_academics'],
    parameters: obj(withSchool({ student: S('Student name or login id (staff). Students and parents may leave it empty.') })),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      let r;
      if (['student', 'parent'].includes(ctx.user.role)) {
        let id = ctx.user.user_id;
        if (ctx.user.role === 'parent') {
          const kids = await ctx.api('GET', '/users/my-children');
          const k = a.student ? kids.find((x) => norm(x.profile?.full_name).includes(norm(a.student))) : kids.length === 1 ? kids[0] : null;
          if (!k) throw httpError(409, `Which child? ${kids.map((x) => x.profile?.full_name || x.login_id).join(', ') || '(none linked)'}`);
          id = k.user_id;
        }
        r = await ctx.api('GET', P('/academics/my', { student_id: id }));
      } else {
        if (!a.student) throw httpError(400, 'Which student?');
        const s = await findStudent(ctx, a.student, sid, ['attendance', 'users', 'fees']);
        r = await ctx.api('GET', P(`/academics/reports/student/${s.id}`, { school_id: sid }));
      }
      return cap({
        student: r.student.name, class: r.student.class_label, overall: r.summary.overall, tests: r.summary.tests, exams: r.summary.exams,
        subjects: r.subjects.map((s) => ({ subject: s.name, overall_percent: pct(s.overall), tests_percent: pct(s.tests), exams_percent: pct(s.exams) })),
        recent_tests: r.tests.slice(0, 8).map((t) => ({ subject: t.subject, title: t.title, marks: t.absent ? 'absent' : `${t.marks}/${t.max_marks}`, percent: t.pct, grade: t.grade })),
        exams: r.exams.map((e) => ({ exam: e.name, total_percent: e.total?.pct, failed_papers: e.failed })),
      });
    },
  },
];
