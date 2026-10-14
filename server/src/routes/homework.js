import { Router } from 'express';
import multer from 'multer';
import { httpError, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import * as H from '../homework.js';

const r = Router();
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};

// up to 5 files, 10 MB each: PDF, images, Word / Excel / PowerPoint, text
const OK = /^(application\/pdf|image\/(png|jpe?g|webp)|text\/plain|application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)))$/;
const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => cb(OK.test(file.mimetype) ? null : httpError(400, 'Only PDF, image, Word, Excel, PowerPoint or text files'), true),
});
const files = (req, res, next) => uploader.array('files', 5)(req, res, (err) => {
  if (!err) return next();
  next(err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? httpError(400, 'You can attach up to 5 files') : err);
});

// ---- teacher
r.get('/classes', requireFeature('manage_homework'), asyncH(async (req, res) => res.json(await H.listClasses(req.user, schoolOf(req)))));
r.get('/assignments', requireFeature('manage_homework'), asyncH(async (req, res) => res.json(await H.listAssignments(req.user, schoolOf(req)))));
r.post('/assignments', requireFeature('manage_homework'), files, asyncH(async (req, res) => res.status(201).json(await H.createAssignment(req.user, schoolOf(req), req.body, req.files))));
r.delete('/assignments/:id', requireFeature('manage_homework'), asyncH(async (req, res) => { await H.deleteAssignment(req.user, schoolOf(req), req.params.id); res.json({ ok: true }); }));
r.get('/assignments/:id/submissions', requireFeature('manage_homework'), asyncH(async (req, res) => res.json(await H.getSubmissions(req.user, schoolOf(req), req.params.id))));
r.patch('/submissions/:id', requireFeature('manage_homework'), asyncH(async (req, res) => { await H.checkSubmission(req.user, schoolOf(req), req.params.id, req.body); res.json({ ok: true }); }));

// ---- student
r.get('/my', requireFeature('view_my_homework'), asyncH(async (req, res) => res.json(await H.myAssignments(req.user))));
r.get('/my/:id', requireFeature('view_my_homework'), asyncH(async (req, res) => res.json(await H.myAssignment(req.user, req.params.id))));
r.post('/my/:id/submit', requireFeature('view_my_homework'), files, asyncH(async (req, res) => res.status(201).json(await H.submit(req.user, req.params.id, req.body, req.files))));

export default r;
