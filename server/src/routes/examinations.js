import { Router } from 'express';
import { httpError, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import * as E from '../examinations.js';

const r = Router();
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
const ANY = ['manage_exam_structure', 'manage_exam_grading', 'manage_exam_marks', 'view_exam_results', 'publish_exam_results', 'view_exam_analytics'];

r.get('/meta', requireFeature(...ANY), asyncH(async (req, res) => res.json(await E.getMeta(req.user, schoolOf(req)))));

// ---- exams of each class
r.put('/structure', requireFeature('manage_exam_structure'), asyncH(async (req, res) => res.json(await E.saveStructure(req.user, schoolOf(req), req.body))));

// ---- grading criteria
r.get('/grading', requireFeature(...ANY), asyncH(async (req, res) => res.json(await E.getGrading(schoolOf(req)))));
r.put('/grading', requireFeature('manage_exam_grading'), asyncH(async (req, res) => res.json(await E.saveGrading(schoolOf(req), req.body.ranges))));
r.delete('/grading', requireFeature('manage_exam_grading'), asyncH(async (req, res) => res.json(await E.resetGrading(schoolOf(req)))));

// ---- marks entry (per class: exam x subject)
r.get('/marks/overview', requireFeature('manage_exam_marks', 'view_exam_results'), asyncH(async (req, res) => res.json(await E.marksOverview(req.user, schoolOf(req), req.query.class_id))));
r.get('/marks/sheet', requireFeature('manage_exam_marks', 'view_exam_results'), asyncH(async (req, res) => res.json(await E.getSheet(req.user, schoolOf(req), req.query.exam_id, req.query.subject_id))));
r.put('/marks/sheet', requireFeature('manage_exam_marks'), asyncH(async (req, res) => res.json(await E.saveMarks(req.user, schoolOf(req), req.body.exam_id, req.body.subject_id, req.body.items))));

// ---- results, publishing, report cards
r.get('/results', requireFeature('view_exam_results'), asyncH(async (req, res) => res.json(await E.results(req.user, schoolOf(req), req.query.class_id))));
r.post('/results/publish', requireFeature('publish_exam_results'), asyncH(async (req, res) => res.json(await E.publish(req.user, schoolOf(req), req.body))));
r.get('/report-card', asyncH(async (req, res) => res.json(await E.reportCard(req.user, req.user.school_id && !isSuper(req) ? req.user.school_id : schoolOf(req), req.query.class_id || null, req.query.student_id))));
r.get('/report-cards', requireFeature('view_exam_results'), asyncH(async (req, res) => res.json(await E.reportCards(req.user, schoolOf(req), req.query.class_id, req.query.published === '1'))));
r.get('/analytics', requireFeature('view_exam_analytics'), asyncH(async (req, res) => res.json(await E.analytics(req.user, schoolOf(req), req.query))));

// ---- a student / parent reading published report cards (own data: no feature needed)
r.get('/my', asyncH(async (req, res) => res.json(await E.myResults(req.user, req.query.student_id || req.user.user_id))));

export default r;
