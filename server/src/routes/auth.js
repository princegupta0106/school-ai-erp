import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db, httpError, check, asyncH } from '../db.js';
import { authenticate, signToken, shapeUser, USER_SELECT } from '../auth.js';
import { modulesFor, catalog } from '../features.js';
import { setAudit } from '../audit.js';

const r = Router();

async function mePayload(user) {
  const { profile, ...u } = user;
  const { documents, extra, ...profileLite } = profile;
  // the two lookups don't depend on each other, so run them together (one round trip to Supabase instead of two)
  const [schoolRes, prefsRes] = await Promise.all([
    user.school_id ? db.from('schools').select('id,name,code,is_active').eq('id', user.school_id).maybeSingle() : Promise.resolve({ data: null }),
    // saved home-screen layout (null until the person customises it; also null if the column isn't added yet)
    db.from('users').select('ui_prefs').eq('user_id', user.user_id).maybeSingle(),
  ]);
  const school = schoolRes.data; const pr = prefsRes.data;
  return { ...u, school, profile: profileLite, ui_prefs: pr?.ui_prefs ?? null, modules: modulesFor(user.features), catalog: catalog() };
}

r.post('/login', rateLimit({ windowMs: 5 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  asyncH(async (req, res) => {
    const loginId = String(req.body.login_id || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!loginId || !password) throw httpError(400, 'Enter your ID and password');
    const { data, error } = await db.from('users').select(USER_SELECT).eq('login_id', loginId).maybeSingle();
    check(error);
    // every refused sign-in is written to the audit log (attributed to the account when the ID exists)
    const refuse = (status, msg, reason) => {
      setAudit(req, {
        action: 'auth.login_failed', kind: 'auth', summary: `Failed sign-in for "${loginId}" (${reason})`, actor_login: loginId,
        user: data ? { ...shapeUser(data), features: [] } : null, school_id: data?.school_id || null, detail: { reason },
      });
      throw httpError(status, msg);
    };
    const ok = data && (await bcrypt.compare(password, data.password_hash));
    if (!ok) refuse(401, 'Wrong ID or password', data ? 'wrong password' : 'unknown ID');
    if (!data.is_active) refuse(403, 'This account is turned off', 'account is off');
    if (data.school_id) {
      const { data: s } = await db.from('schools').select('is_active').eq('id', data.school_id).maybeSingle();
      if (s && !s.is_active) refuse(403, 'This school is turned off', 'school is off');
    }
    const user = shapeUser(data);
    // reuse authenticate's feature calculation
    const { effectiveFeatures } = await import('../features.js');
    user.features = effectiveFeatures(user);
    setAudit(req, { action: 'auth.login', kind: 'auth', summary: 'Signed in', user });
    res.json({ token: signToken(user.user_id), me: await mePayload(user) });
  }));

r.get('/me', authenticate, asyncH(async (req, res) => res.json(await mePayload(req.user))));

// the browser calls this when the person presses "Sign out" (only so it shows in the audit log)
r.post('/logout', authenticate, (req, res) => res.json({ ok: true }));

r.post('/change-password', authenticate, asyncH(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || String(new_password).length < 6) throw httpError(400, 'New password needs at least 6 characters');
  const { data } = await db.from('users').select('password_hash').eq('user_id', req.user.user_id).single();
  if (!(await bcrypt.compare(String(current_password || ''), data.password_hash))) throw httpError(400, 'Current password is wrong');
  const { error } = await db.from('users').update({ password_hash: await bcrypt.hash(String(new_password), 10) }).eq('user_id', req.user.user_id);
  check(error);
  res.json({ ok: true });
}));

// keep only plain short strings, so nobody can store junk (or a huge blob) here
const strList = (v, max) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x.length <= 60))].slice(0, max) : []);

// the person's own home-screen layout: which module cards to show, their order, and pinned shortcuts
r.put('/prefs', authenticate, asyncH(async (req, res) => {
  const b = req.body || {};
  const prefs = {
    hidden: strList(b.hidden, 50),
    order: strList(b.order, 50),
    dashHidden: strList(b.dashHidden, 50), // dashboard cards the person removed
    dashOrder: strList(b.dashOrder, 50),
    shortcuts: b.shortcuts === null || b.shortcuts === undefined ? null : strList(b.shortcuts, 30), // null = use the defaults
  };
  const { error } = await db.from('users').update({ ui_prefs: prefs }).eq('user_id', req.user.user_id);
  check(error);
  res.json({ ok: true, ui_prefs: prefs });
}));

export default r;
