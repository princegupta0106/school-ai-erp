import { Router } from 'express';
import { httpError, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import * as A from '../attendance.js';
import { buildProfile, myStudents } from '../studentProfile.js';

const r = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schoolOf = (req) => {
  const id = isSuper(req) ? req.query.school_id : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};

// the signed-in student / parent: which students can I open? (no feature needed - it is your own data)
r.get('/my', asyncH(async (req, res) => res.json(await myStudents(req.user))));

// staff: find a student (limited to the classes this person can use)
r.get('/search', requireFeature('view_student_profile'), asyncH(async (req, res) => {
  res.json(await A.searchStudents(req.user, schoolOf(req), req.query.q));
}));

r.get('/:id', asyncH(async (req, res) => {
  if (!UUID.test(req.params.id)) throw httpError(400, 'Unknown student');
  res.json(await buildProfile(req.user, req.params.id, req.query.session_id || undefined));
}));

export default r;
