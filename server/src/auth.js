import jwt from 'jsonwebtoken';
import { cfg } from './config.js';
import { db, httpError, check } from './db.js';
import { effectiveFeatures } from './features.js';

export const USER_SELECT = 'user_id,school_id,login_id,role,is_active,created_at,password_hash,profiles(*)';

export const signToken = (uid) => jwt.sign({ uid }, cfg.authSecret, { expiresIn: '12h' });

export const shapeUser = (row) => {
  const { password_hash, profiles, ...u } = row;
  const profile = Array.isArray(profiles) ? profiles[0] : profiles;
  return { ...u, profile: profile || {} };
};

// Loads the user fresh from DB on every request, so a changed role / removed
// permission / deactivated account takes effect immediately.
export async function authenticate(req, res, next) {
  try {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) throw httpError(401, 'Please sign in');
    let uid;
    try { uid = jwt.verify(m[1], cfg.authSecret).uid; } catch { throw httpError(401, 'Session expired, sign in again'); }
    const { data, error } = await db.from('users').select(USER_SELECT).eq('user_id', uid).maybeSingle();
    check(error);
    if (!data || !data.is_active) throw httpError(401, 'Account not available');
    const user = shapeUser(data);
    user.features = effectiveFeatures(user);
    req.user = user;
    next();
  } catch (e) { next(e); }
}

// authorization lives here: a route declares which feature(s) it needs
export const requireFeature = (...needed) => (req, res, next) => {
  if (needed.some((f) => req.user.features.includes(f))) return next();
  next(httpError(403, `You don't have access to this (needs ${needed.join(' or ')})`));
};

export const isSuper = (req) => req.user.role === 'super_admin';
