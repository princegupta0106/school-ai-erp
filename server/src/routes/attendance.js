import { Router } from 'express';
import { httpError, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import * as A from '../attendance.js';

const r = Router();
const TAKE = ['mark_attendance', 'view_attendance_reports'];

// super admin works on one school at a time (?school_id=...); everyone else on their own
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};

// ---- class picker: my classes + "marked today?" for each
r.get('/classes', requireFeature('mark_attendance', 'view_attendance_reports', 'manage_roll_numbers'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const date = A.validDate(req.query.date || A.todayStr());
  const classes = await A.accessibleClasses(req.user, school);
  const status = await A.classDayStatus(school, classes, date);
  res.json({ today: A.todayStr(), date, classes: classes.map((c, i) => ({ ...c, ...status[i] })) });
}));

// ---- one class + day: students and their current marks
r.get('/sheet', requireFeature(...TAKE), asyncH(async (req, res) => {
  res.json(await A.getSheet(req.user, schoolOf(req), req.query.class_id, req.query.date));
}));

// ---- save (mark or change) -- calling again for the same day just updates
r.put('/sheet', requireFeature('mark_attendance'), asyncH(async (req, res) => {
  res.json(await A.saveSheet(req.user, schoolOf(req), req.body.class_id, req.body.date, req.body.records));
}));

// ---- reports
r.get('/reports/daily', requireFeature('view_attendance_reports'), asyncH(async (req, res) => {
  res.json(await A.dailyOverview(req.user, schoolOf(req), req.query.date));
}));
r.get('/reports/class', requireFeature('view_attendance_reports'), asyncH(async (req, res) => {
  res.json(await A.classReport(req.user, schoolOf(req), req.query.class_id, req.query.from, req.query.to));
}));
r.get('/reports/student/:id', requireFeature('view_attendance_reports'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  await A.assertStudentAccess(req.user, school, req.params.id);
  res.json(await A.studentReport(school, req.params.id, req.query.from, req.query.to));
}));
r.get('/reports/low', requireFeature('view_attendance_reports'), asyncH(async (req, res) => {
  res.json(await A.lowAttendance(req.user, schoolOf(req), { threshold: req.query.threshold || 75, from: req.query.from, to: req.query.to, classId: req.query.class_id || undefined }));
}));
r.get('/students', requireFeature('view_attendance_reports'), asyncH(async (req, res) => {
  res.json(await A.searchStudents(req.user, schoolOf(req), req.query.q));
}));

// ---- which teacher takes which class
r.get('/teachers', requireFeature('manage_class_teachers'), asyncH(async (req, res) => res.json(await A.listTeacherAssignments(schoolOf(req)))));
r.put('/classes/:id/teachers', requireFeature('manage_class_teachers'), asyncH(async (req, res) => {
  await A.setClassTeachers(schoolOf(req), req.params.id, req.body.teacher_ids, req.body.class_teacher_id);
  res.json({ ok: true });
}));

// ---- roll numbers (1-100, unique inside a class)
r.get('/rolls', requireFeature('manage_roll_numbers'), asyncH(async (req, res) => res.json(await A.listRolls(req.user, schoolOf(req), req.query.class_id))));
r.put('/rolls', requireFeature('manage_roll_numbers'), asyncH(async (req, res) => res.json(await A.saveRolls(req.user, schoolOf(req), req.body.class_id, req.body.items))));
r.post('/rolls/auto', requireFeature('manage_roll_numbers'), asyncH(async (req, res) => res.json(await A.autoAssignRolls(req.user, schoolOf(req), req.body.class_id, req.body.mode))));

// ---- a student (or the parent of a student) reading their own attendance: no feature needed
r.get('/my', asyncH(async (req, res) => {
  const sid = req.query.student_id || req.user.user_id;
  if (!req.user.school_id || !(await A.canSeeStudent(req.user, sid))) throw httpError(403, 'You can only see your own or your children\'s attendance');
  res.json(await A.studentReport(req.user.school_id, sid, req.query.from, req.query.to));
}));

export default r;
