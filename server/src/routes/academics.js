import { Router } from 'express';
import { httpError, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import * as A from '../academics.js';

const r = Router();
const SEE = ['manage_subjects', 'manage_exams', 'manage_assessments', 'view_academic_reports'];

// super admin works on one school at a time (?school_id=...); everyone else on their own
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};

// everything a screen needs to start: sessions, subjects, exams and the caller's classes
r.get('/meta', requireFeature(...SEE), asyncH(async (req, res) => res.json(await A.getMeta(req.user, schoolOf(req)))));

// ---- subjects
r.post('/subjects', requireFeature('manage_subjects'), asyncH(async (req, res) => res.status(201).json(await A.createSubject(schoolOf(req), req.body))));
r.patch('/subjects/:id', requireFeature('manage_subjects'), asyncH(async (req, res) => res.json(await A.updateSubject(schoolOf(req), req.params.id, req.body))));
r.delete('/subjects/:id', requireFeature('manage_subjects'), asyncH(async (req, res) => { await A.deleteSubject(schoolOf(req), req.params.id); res.json({ ok: true }); }));

// ---- exams (Half-yearly, Final...)
r.post('/exams', requireFeature('manage_exams'), asyncH(async (req, res) => res.status(201).json(await A.createExam(schoolOf(req), req.body))));
r.patch('/exams/:id', requireFeature('manage_exams'), asyncH(async (req, res) => res.json(await A.updateExam(schoolOf(req), req.params.id, req.body))));
r.delete('/exams/:id', requireFeature('manage_exams'), asyncH(async (req, res) => { await A.deleteExam(schoolOf(req), req.params.id); res.json({ ok: true }); }));

// ---- tests and exam papers of a class
r.get('/assessments', requireFeature('manage_assessments', 'view_academic_reports'), asyncH(async (req, res) => {
  const { class_id, subject_id, kind, exam_id, session_id } = req.query;
  res.json(await A.listAssessments(req.user, schoolOf(req), { class_id, subject_id, kind, exam_id, session_id }));
}));
r.post('/assessments', requireFeature('manage_assessments'), asyncH(async (req, res) => res.status(201).json(await A.createAssessment(req.user, schoolOf(req), req.body))));
r.get('/assessments/:id', requireFeature('manage_assessments', 'view_academic_reports'), asyncH(async (req, res) => res.json(await A.getSheet(req.user, schoolOf(req), req.params.id))));
r.patch('/assessments/:id', requireFeature('manage_assessments'), asyncH(async (req, res) => res.json(await A.updateAssessment(req.user, schoolOf(req), req.params.id, req.body))));
r.delete('/assessments/:id', requireFeature('manage_assessments'), asyncH(async (req, res) => { await A.deleteAssessment(req.user, schoolOf(req), req.params.id); res.json({ ok: true }); }));
r.put('/assessments/:id/marks', requireFeature('manage_assessments'), asyncH(async (req, res) => res.json(await A.saveMarks(req.user, schoolOf(req), req.params.id, req.body.items))));

// ---- reports
r.get('/reports/class', requireFeature('view_academic_reports'), asyncH(async (req, res) => {
  res.json(await A.classReport(req.user, schoolOf(req), req.query.class_id, req.query.session_id, req.query.scope || 'all'));
}));
r.get('/reports/student/:id', requireFeature('view_academic_reports'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  await A.assertStudentAccess(req.user, school, req.params.id);
  res.json(await A.studentDashboard(school, req.params.id, req.query.session_id));
}));

// ---- a student (or the parent of a student) reading their own results: no feature needed beyond the default one
r.get('/my', asyncH(async (req, res) => {
  const sid = req.query.student_id || req.user.user_id;
  if (!req.user.school_id || !(await A.canSeeStudent(req.user, sid))) throw httpError(403, 'You can only see your own or your children\'s marks');
  res.json(await A.studentDashboard(req.user.school_id, sid, req.query.session_id));
}));

export default r;
