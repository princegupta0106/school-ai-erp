// Creates (or rebuilds) a complete TEST school: "Test Public School" (code TEST1).
// Safe to re-run: it deletes the old TEST1 school and builds it again. Nothing else is touched.
// Every login below uses the password  Test@123
import bcrypt from 'bcryptjs';
import { db, check } from '../src/db.js';

const PASS = 'Test@123';
const hash = await bcrypt.hash(PASS, 10);
const ins = async (table, rows, sel = '*') => { const { data, error } = await db.from(table).insert(rows).select(sel); check(error); return data; };

console.log('Removing old TEST1 school (if any)...');
{ const { error } = await db.from('schools').delete().eq('code', 'TEST1'); check(error); }

const [school] = await ins('schools', { name: 'Test Public School', code: 'TEST1', address: '1 Test Road, Pune, Maharashtra 411001', phone: '020-00000000', email: 'info@testschool.edu' });
const sid = school.id;
await ins('academic_sessions', { school_id: sid, name: '2026-2027', start_date: '2026-04-01', end_date: '2027-03-31', is_current: true });

// ---- classes: 6, 7, 8 with sections A and B
const classes = {};
for (const lvl of [6, 7, 8]) for (const sec of ['A', 'B']) {
  const [c] = await ins('classes', { school_id: sid, name: `Class ${lvl}`, section: sec, level: lvl });
  classes[`${lvl}${sec}`] = c.id;
}
const ALL = Object.keys(classes);

// ---- subjects, and every class studies all of them
const SUBJECTS = ['English', 'Hindi', 'Mathematics', 'Science', 'Social Studies', 'Computer Science', 'Physical Education', 'Art'];
// periods per week of each subject in every class (set by the admin in Timetable > Structure, not by the teacher)
const PPW = { English: 6, Hindi: 5, Mathematics: 7, Science: 6, 'Social Studies': 6, 'Computer Science': 3, 'Physical Education': 2, Art: 2 };
const subj = {};
for (const n of SUBJECTS) { const [s] = await ins('subjects', { school_id: sid, name: n, code: n.replace(/[^A-Z]/g, '').slice(0, 3) || n.slice(0, 3).toUpperCase() }); subj[n] = s.id; }
await ins('class_subjects', ALL.flatMap((k) => SUBJECTS.map((n) => ({ school_id: sid, class_id: classes[k], subject_id: subj[n], periods_per_week: PPW[n] }))));

// ---- school admin
const mkUser = async (login, role, name, extra = {}) => {
  const [u] = await ins('users', { school_id: sid, login_id: login, password_hash: hash, role }, 'user_id');
  await ins('profiles', { user_id: u.user_id, school_id: sid, full_name: name, ...extra });
  return u.user_id;
};
await mkUser('testadmin', 'school_admin', 'Test Admin', { phone: '9800000001', email: 'admin@testschool.edu', gender: 'male', designation: 'School Administrator' });

// ---- teachers: [login, name, designation, [subject, classes, periods/week]...]
const TEACHERS = [
  ['testteacher1', 'Priya Mehta', 'Maths Teacher', [['Mathematics', ['6A', '6B', '7A'], 7]], '6A'],
  ['testteacher2', 'Rahul Verma', 'Maths Teacher', [['Mathematics', ['7B', '8A', '8B'], 7]], '8A'],
  ['testteacher3', 'Anita Desai', 'English Teacher', [['English', ['6A', '6B', '7A'], 6]], '6B'],
  ['testteacher4', 'Sanjay Kulkarni', 'English Teacher', [['English', ['7B', '8A', '8B'], 6]], '7B'],
  ['testteacher5', 'Sunita Joshi', 'Hindi Teacher', [['Hindi', ALL, 5]], '7A'],
  ['testteacher6', 'Vikram Patil', 'Science Teacher', [['Science', ['6A', '6B', '7A'], 6]], null],
  ['testteacher7', 'Neha Kapoor', 'Science Teacher', [['Science', ['7B', '8A', '8B'], 6]], '8B'],
  ['testteacher8', 'Deepak Rao', 'Social Studies Teacher', [['Social Studies', ['6A', '6B', '7A', '7B'], 6]], null],
  ['testteacher9', 'Kavita Nair', 'Social Studies & Art Teacher', [['Social Studies', ['8A', '8B'], 6], ['Art', ALL, 2]], null],
  ['testteacher10', 'Arjun Singh', 'Computer Teacher', [['Computer Science', ALL, 3]], null],
  ['testteacher11', 'Meera Shah', 'PE Teacher', [['Physical Education', ALL, 3]], null],
];
let n = 0;
for (const [login, name, desig, combos, classTeacherOf] of TEACHERS) {
  n += 1;
  const uid = await mkUser(login, 'staff', name, {
    phone: `98000001${String(n).padStart(2, '0')}`, email: `${login}@testschool.edu`, gender: n % 2 ? 'female' : 'male',
    employee_id: `EMP-${String(n).padStart(3, '0')}`, designation: desig, department: combos[0][0], qualification: 'M.A., B.Ed.', joining_date: '2020-06-01',
  });
  const rows = combos.flatMap(([sub, cls, ppw]) => cls.map((k) => ({ school_id: sid, teacher_id: uid, class_id: classes[k], subject_id: subj[sub], periods_per_week: PPW[sub] })));
  await ins('tt_assignments', rows, 'id');
  const ct = [...new Set(rows.map((r) => r.class_id))];
  await ins('class_teachers', ct.map((c) => ({ school_id: sid, class_id: c, teacher_id: uid, is_class_teacher: classTeacherOf ? classes[classTeacherOf] === c : false })), 'class_id');
}

// ---- timetable frame: Mon-Sat, 7 periods + 2 breaks, teacher limit 30 a week
await ins('tt_settings', { school_id: sid, days: [1, 2, 3, 4, 5, 6], max_load: 30 }, 'school_id');
const FRAME = [['Period 1', '08:00', '08:45'], ['Period 2', '08:45', '09:30'], ['Period 3', '09:30', '10:15'], ['Morning break', '10:15', '10:35', 1], ['Period 4', '10:35', '11:20'], ['Period 5', '11:20', '12:05'], ['Lunch', '12:05', '12:35', 1], ['Period 6', '12:35', '13:20'], ['Period 7', '13:20', '14:05']];
await ins('tt_periods', FRAME.map(([name, s, e, b], i) => ({ school_id: sid, no: i + 1, name, start_time: s, end_time: e, is_break: !!b })), 'id');

// ---- students (5) + one parent
const STUDENTS = [['Aarav Sharma', '6A', 'male'], ['Diya Patel', '6B', 'female'], ['Vihaan Singh', '7A', 'male'], ['Ananya Iyer', '8A', 'female'], ['Kabir Khan', '8B', 'male']];
const roll = {}; let firstStudent = null;
for (let i = 0; i < STUDENTS.length; i += 1) {
  const [name, k, gender] = STUDENTS[i]; roll[k] = (roll[k] || 0) + 1;
  const uid = await mkUser(`teststudent${i + 1}`, 'student', name, {
    gender, dob: '2013-05-10', admission_no: `T-${String(i + 1).padStart(4, '0')}`, class_id: classes[k], roll_no: roll[k],
    father_name: `Mr ${name.split(' ')[1]}`, mother_name: `Mrs ${name.split(' ')[1]}`, father_phone: '9811111111', mother_phone: '9822222222',
  });
  if (!firstStudent) firstStudent = uid;
}
const parent = await mkUser('testparent1', 'parent', 'Mr Sharma', { phone: '9811111111', gender: 'male' });
await ins('parent_students', { parent_id: parent, student_id: firstStudent, school_id: sid }, 'parent_id');

console.log(`
=====================================================
 TEST SCHOOL READY:  Test Public School (TEST1)
 Password for every login:  ${PASS}

 School admin : testadmin
 Teachers     : testteacher1 ... testteacher11
                (1-2 Maths, 3-4 English, 5 Hindi, 6-7 Science,
                 8-9 Social Studies, 9 Art, 10 Computer, 11 PE)
 Students     : teststudent1 ... teststudent5
 Parent       : testparent1 (parent of teststudent1)

 Classes: 6A 6B 7A 7B 8A 8B - all 8 subjects, every subject has a teacher.
 Timetable frame is set (Mon-Sat, 7 periods). Log in as testadmin >
 Timetable > "Auto generate" to build the timetables.
=====================================================`);
