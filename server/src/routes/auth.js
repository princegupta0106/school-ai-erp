import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db, httpError, check, asyncH } from '../db.js';
import { authenticate, signToken, shapeUser, USER_SELECT } from '../auth.js';
import { modulesFor, catalog } from '../features.js';
import { setAudit } from '../audit.js';

const r = Router();

async function mePayload(user) {
  let school = null;
  if (user.school_id) {
    const { data } = await db.from('schools').select('id,name,code,is_active').eq('id', user.school_id).maybeSingle();
    school = data;
  }
  const { profile, ...u } = user;
  const { documents, extra, ...profileLite } = profile;
  return { ...u, school, profile: profileLite, modules: modulesFor(user.features), catalog: catalog() };
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

export default r;
