// The AI assistant lives in a small Python service (ai-server/). This route only checks that the person
// may use it and forwards their message, with their sign-in token, to that service.
// The service then calls this portal's own /api routes AS THAT PERSON, so every permission still applies.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH, httpError } from '../db.js';
import { requireFeature } from '../auth.js';
import { cfg } from '../config.js';
import { parseStagedRef, MAX_FILES } from '../stagedFiles.js';

const r = Router();
const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.user_id || req.ip,
  message: { error: 'Too many messages, wait a minute.' },
});

// Download cards (receipts, statements, fee reports, issued documents): the app fetches `path` with the person's own sign-in,
// so only these portal GET routes may ever appear in a card, whatever the AI service sends.
const ID = '[0-9a-fA-F-]{36}';
const DL_PATH = new RegExp(`^/(fees/(payments/${ID}/receipt|students/${ID}/statement|my/${ID}/statement|pending/download|payments/download)|documents/issued/${ID})(\\?[A-Za-z0-9_=&%.+:~-]*)?$`);
export const cleanDownloads = (list) => (Array.isArray(list) ? list : []).slice(0, 8).filter((d) => d && typeof d.path === 'string' && DL_PATH.test(d.path)).map((d) => ({
  id: String(d.id || '').slice(0, 64), kind: d.kind === 'document' ? 'document' : 'file', label: String(d.label || 'File').slice(0, 120), sub: String(d.sub || '').slice(0, 160),
  path: d.path, filename: String(d.filename || 'file').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 90), format: String(d.format || 'PDF').toUpperCase().slice(0, 5), cancelled: !!d.cancelled,
}));
export const cleanReply = (data) => {
  if (!data || typeof data !== 'object') return data;
  if ('downloads' in data) data.downloads = cleanDownloads(data.downloads);
  if (Array.isArray(data.actions)) data.actions.forEach((a) => { if (a) a.downloads = cleanDownloads(a.downloads); });
  if (data.action) data.action.downloads = cleanDownloads(data.action.downloads);
  return data;
};

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

// files attached in the chat: keep only the ones in this person's own staging folder (and only the fields the assistant needs)
const cleanAttachments = (req) => (Array.isArray(req.body?.attachments) ? req.body.attachments : []).slice(0, MAX_FILES).map((a) => {
  const ref = parseStagedRef(req.user.user_id, a);
  return ref ? { id: ref.id, key: ref.key, name: ref.name, size: Number(a.size) || 0, type: String(a.type || '').slice(0, 100) } : null;
}).filter(Boolean);

// Streaming chat: relays the AI service's live events (status / tool / text) to the app line by line, as they happen.
r.post('/chat/stream', requireFeature('use_assistant'), limiter, async (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');   // no-transform keeps compression from buffering the stream
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (o) => { res.write(`${JSON.stringify(o)}\n`); res.flush?.(); };
  send({ t: 'ping', pad: ' '.repeat(2048) });                 // flushes any proxy buffer right away so later events arrive live
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const up = await fetch(`${cfg.ai.url}/api/chat_stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization },
      body: JSON.stringify({ ...req.body, attachments: cleanAttachments(req) }),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(150000)]),
    });
    if (!up.ok || !up.body) { const d = await up.json().catch(() => ({})); send({ t: 'error', error: d.error || 'The AI service could not answer.' }); return res.end(); }
    const dec = new TextDecoder();
    let buf = '';
    const line = (l) => {
      if (!l.trim()) return;
      let ev; try { ev = JSON.parse(l); } catch { return; }
      if (ev.t === 'done') ev.data = cleanReply(ev.data);
      send(ev);
    };
    for await (const chunk of up.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    line(buf);
  } catch (e) {
    if (!ac.signal.aborted) send({ t: 'error', error: 'The AI service is not running. Start it with run.bat (it opens an "AI service" window) or: python ai-server/server.py' });
  }
  res.end();
});

for (const p of ['chat', 'confirm', 'cancel']) {
  r.post(`/${p}`, requireFeature('use_assistant'), limiter, asyncH(async (req, res) => {
    const body = p === 'chat' ? { ...req.body, attachments: cleanAttachments(req) } : req.body;
    const { status, data } = await forward('POST', p, req, body);
    res.status(status).json(cleanReply(data));
  }));
}

export default r;
