import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { asyncH, httpError } from '../db.js';
import { requireFeature } from '../auth.js';
import { cfg } from '../config.js';
import { visibleTools } from '../ai/registry.js';
import { chat, resolvePending, resetConversation, attachFile, removeFile } from '../ai/chat.js';
import { MAX_FILE_BYTES } from '../ai/docs.js';

const r = Router();
const token = (req) => /^Bearer (.+)$/.exec(req.headers.authorization || '')[1];
const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.user_id || req.ip,
  message: { error: 'Too many messages, wait a minute.' },
});

r.get('/status', requireFeature('use_assistant'), (req, res) => {
  res.json({ enabled: !!cfg.gemini.apiKey, model: cfg.gemini.model, tools: visibleTools(req.user).map((t) => t.name) });
});

r.post('/chat', requireFeature('use_assistant'), limiter, asyncH(async (req, res) => {
  res.json(await chat(req.user, token(req), req.body.conversation_id, req.body.message));
}));

// the Confirm / Cancel buttons on a confirmation card
r.post('/confirm', requireFeature('use_assistant'), limiter, asyncH(async (req, res) => {
  if (!req.body.pending_id) throw httpError(400, 'Missing pending_id');
  res.json(await resolvePending(req.user, token(req), req.body.pending_id, req.body.approve === true));
}));

// attach a file to the conversation (PDF / Word / text / photo)
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
r.post('/upload', requireFeature('use_assistant'), limiter, up.single('file'), asyncH(async (req, res) => {
  if (!req.file) throw httpError(400, 'No file received');
  res.json(await attachFile(req.user, req.body.conversation_id, req.file));
}));
r.post('/remove-file', requireFeature('use_assistant'), (req, res) => {
  removeFile(req.user, req.body.conversation_id, req.body.file_id);
  res.json({ ok: true });
});

r.post('/reset', requireFeature('use_assistant'), (req, res) => {
  if (req.body.conversation_id) resetConversation(req.user, req.body.conversation_id);
  res.json({ ok: true });
});

export default r;
