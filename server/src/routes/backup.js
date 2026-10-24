import { Router } from 'express';
import multer from 'multer';
import os from 'node:os';
import { httpError, asyncH } from '../db.js';
import { requireFeature } from '../auth.js';
import { cfg } from '../config.js';
import * as bk from '../backup.js';

// School admin only. Every call works on the admin's OWN school (taken from the sign-in, never from the request).
const r = Router();
r.use(requireFeature('manage_backups'));
r.use((req, res, next) => {
  if (!req.user.school_id) return next(httpError(403, 'No school on this account'));
  if (!(cfg.r2.accountId && cfg.r2.bucket)) return next(httpError(503, 'File storage (Cloudflare R2) is not set up on this server'));
  next();
});
const sid = (req) => req.user.school_id;
const who = (req) => req.user.profile?.full_name || req.user.login_id;

// the two files to restore from, saved to the server's temp folder (they can be large, so never held in memory)
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 2 } });

r.get('/', asyncH(async (req, res) => res.json({ history: await bk.history(sid(req)), job: bk.status(sid(req)) })));
r.get('/status', (req, res) => res.json(bk.status(sid(req))));

r.post('/', asyncH(async (req, res) => res.status(202).json(bk.startBackup(sid(req), who(req)))));

// restore from the two files the admin downloaded earlier (database file required, files zip optional)
r.post('/restore-upload', upload.fields([{ name: 'database', maxCount: 1 }, { name: 'files', maxCount: 1 }]), asyncH(async (req, res) => {
  const dbf = req.files?.database?.[0]; const zipf = req.files?.files?.[0];
  if (!dbf) { if (zipf) await import('node:fs').then((fs) => fs.promises.unlink(zipf.path).catch(() => {})); throw httpError(400, 'Choose the database backup file'); }
  res.status(202).json(bk.startRestoreUploaded(sid(req), who(req), dbf.path, zipf?.path));
}));

r.post('/:id/restore', asyncH(async (req, res) => res.status(202).json(await bk.startRestoreSaved(sid(req), req.params.id, who(req)))));
r.delete('/:id', asyncH(async (req, res) => { await bk.deleteBackup(sid(req), req.params.id); res.json({ ok: true }); }));
r.get('/:id/:which(database|files)', asyncH(async (req, res) => bk.sendFile(sid(req), req.params.id, req.params.which, res)));

export default r;
