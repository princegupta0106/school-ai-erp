import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import { accessibleClasses } from '../attendance.js';
import { notify, schoolUserIds, classAudience } from '../notify.js';

const r = Router();
const SEND = ['send_notification', 'send_school_notification'];
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^(Expo|Exponent)PushToken\[[^\]]{8,}\]$/;

// ---- my inbox (everyone): newest first + how many are unread
r.get('/', asyncH(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  let q = db.from('notifications').select('id,kind,title,body,module,view,created_at,read_at').eq('user_id', req.user.user_id).order('created_at', { ascending: false }).limit(limit + 1);
  if (req.query.before) q = q.lt('created_at', String(req.query.before));
  const [{ data, error }, { count, error: e2 }] = await Promise.all([
    q,
    db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.user_id).is('read_at', null),
  ]);
  check(error); check(e2);
  res.json({ items: data.slice(0, limit), more: data.length > limit, unread: count || 0 });
}));

// body: { ids: [...] } or { all: true }
r.post('/read', asyncH(async (req, res) => {
  let q = db.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', req.user.user_id).is('read_at', null);
  if (req.body?.all !== true) {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => UUID.test(String(x))).slice(0, 200);
    if (!ids.length) return res.json({ ok: true });
    q = q.in('id', ids);
  }
  check((await q).error);
  res.json({ ok: true });
}));

// ---- this phone's push token (the app calls this after sign-in)
r.post('/push-token', asyncH(async (req, res) => {
  const token = String(req.body?.token || '');
  if (!TOKEN.test(token)) throw httpError(400, 'Invalid push token');
  const now = new Date().toISOString();
  check((await db.from('push_tokens').upsert({ token, user_id: req.user.user_id, platform: String(req.body?.platform || '').slice(0, 20) || null, device_name: String(req.body?.device_name || '').slice(0, 80) || null, updated_at: now }, { onConflict: 'token' })).error);
  res.json({ ok: true });
}));
r.post('/push-token/remove', asyncH(async (req, res) => {
  check((await db.from('push_tokens').delete().eq('token', String(req.body?.token || '')).eq('user_id', req.user.user_id)).error);
  res.json({ ok: true });
}));

// ---- send a plain notification (not a notice-board post): needs the "send notification" feature
r.get('/classes', requireFeature(...SEND), asyncH(async (req, res) => res.json(await accessibleClasses(req.user, schoolOf(req)))));

r.post('/send', requireFeature(...SEND), asyncH(async (req, res) => {
  const schoolId = schoolOf(req); const b = req.body || {};
  const title = String(b.title || '').trim(); const body = String(b.body || '').trim();
  if (!title) throw httpError(400, 'Write a title');
  if (title.length > 100) throw httpError(400, 'Title is too long (100 characters max)');
  if (body.length > 500) throw httpError(400, 'Message is too long (500 characters max)');
  const has = (f) => req.user.features.includes(f);
  let to;
  if (b.audience === 'class') {
    if (!has('send_notification')) throw httpError(403, "You can't send to classes");
    const classIds = [...new Set(Array.isArray(b.class_ids) ? b.class_ids : [])];
    if (!classIds.length) throw httpError(400, 'Choose at least one class');
    const ok = new Set((await accessibleClasses(req.user, schoolId)).map((c) => c.id));
    if (classIds.some((id) => !ok.has(id))) throw httpError(403, 'You can only send to your own classes');
    to = await classAudience(schoolId, classIds);
  } else {
    if (!has('send_school_notification')) throw httpError(403, "You can't send to the whole school");
    const WHO = { all: undefined, students: ['student'], parents: ['parent'], staff: ['staff', 'other', 'school_admin'] };
    if (b.who && !(b.who in WHO)) throw httpError(400, 'Choose who should get it');
    to = await schoolUserIds(schoolId, WHO[b.who || 'all']);
  }
  const sent = await notify(to, { school_id: schoolId, by: req.user.user_id, kind: 'general', title, body, module: null, view: null });
  res.json({ sent });
}));

export default r;
