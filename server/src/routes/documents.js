import { Router } from 'express';
import multer from 'multer';
import { httpError, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import * as D from '../documents.js';

const r = Router();
const START = ['manage_doc_templates', 'issue_documents', 'view_issued_documents'];
const REGISTER = ['view_issued_documents', 'issue_documents'];

// super admin works on one school at a time (?school_id=...); everyone else on their own
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
const adminOnly = (req, res, next) => (['school_admin', 'super_admin'].includes(req.user.role) ? next() : next(httpError(403, 'Only a school admin can do this')));
const image = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(/^image\/(png|jpe?g|webp)$/.test(file.mimetype) ? null : httpError(400, 'Only PNG, JPG or WebP images'), true),
});

// ---- letterhead, templates and designs
r.get('/meta', requireFeature(...START), asyncH(async (req, res) => res.json(await D.getMeta(schoolOf(req)))));
r.put('/settings', requireFeature('manage_doc_templates'), asyncH(async (req, res) => res.json(await D.saveSettings(schoolOf(req), req.body))));
r.post('/images', requireFeature('manage_doc_templates'), image.single('file'), asyncH(async (req, res) => res.status(201).json(await D.uploadImage(schoolOf(req), req.body.kind, req.file))));
r.put('/templates/:type', requireFeature('manage_doc_templates'), asyncH(async (req, res) => res.json(await D.saveTemplate(schoolOf(req), req.params.type, req.body))));
r.delete('/templates/:type', requireFeature('manage_doc_templates'), asyncH(async (req, res) => res.json(await D.resetTemplate(schoolOf(req), req.params.type))));

// ---- issuing
r.get('/people', requireFeature('issue_documents'), asyncH(async (req, res) => res.json(await D.searchPeople(schoolOf(req), { kind: req.query.kind, q: req.query.q, classId: req.query.class_id }))));
r.get('/people/:id/prefill', requireFeature('issue_documents'), asyncH(async (req, res) => res.json(await D.prefill(schoolOf(req), req.params.id, req.query.type, req.query))));
r.post('/issue', requireFeature('issue_documents'), asyncH(async (req, res) => res.status(201).json(await D.issue(req.user, schoolOf(req), req.body))));

// ---- the register (staff)
r.get('/issued', requireFeature(...REGISTER), asyncH(async (req, res) => res.json(await D.listIssued(schoolOf(req), req.query))));
r.post('/issued/:id/cancel', requireFeature('cancel_document'), adminOnly, asyncH(async (req, res) => {
  await D.cancelIssued(req.user, schoolOf(req), req.params.id, req.body.reason);
  res.json({ ok: true });
}));

// ---- my documents: no feature needed, it is your own (or your child's) paper
r.get('/my', asyncH(async (req, res) => res.json(await D.myDocuments(req.user))));
r.get('/issued/:id', asyncH(async (req, res) => {
  const school = isSuper(req) ? schoolOf(req) : req.user.school_id;
  const staff = REGISTER.some((f) => req.user.features.includes(f));
  res.json(await D.getIssued(req.user, school, req.params.id, staff));
}));

export default r;
