// The AI assistant lives in a small Python service (ai-server/). This route only checks that the person
// may use it and forwards their message, with their sign-in token, to that service.
// The service then calls this portal's own /api routes AS THAT PERSON, so every permission still applies.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH, httpError } from '../db.js';
import { requireFeature } from '../auth.js';
import { cfg } from '../config.js';

const r = Router();
const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.user_id || req.ip,
  message: { error: 'Too many messages, wait a minute.' },
});

async function forward(method, path, req, body) {
  let res;
  try {
    res = await fetch(`${cfg.ai.url}/api/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(150000),
    });
  } catch {
    throw httpError(503, 'The AI service is not running. Start it with run.bat (it opens an "AI service" window) or: python ai-server/server.py');
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

r.get('/status', requireFeature('use_assistant'), asyncH(async (req, res) => {
  try { const { data } = await forward('GET', 'health', req); res.json({ enabled: !!data.configured, provider: data.provider, model: data.model }); }
  catch (e) { res.json({ enabled: false, error: e.message }); }
}));

for (const p of ['chat', 'confirm', 'cancel']) {
  r.post(`/${p}`, requireFeature('use_assistant'), limiter, asyncH(async (req, res) => {
    const { status, data } = await forward('POST', p, req, req.body);
    res.status(status).json(data);
  }));
}

export default r;
