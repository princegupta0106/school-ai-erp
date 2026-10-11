import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';

const r = Router();
const FIELDS = ['name', 'address', 'phone', 'email', 'logo_url'];
const clean = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, typeof o[k] === 'string' ? (o[k].trim() || null) : o[k]]));
const LOGIN_RE = /^[a-z0-9._-]{3,40}$/;

// create_school: super admin only. Creates the school AND its first school admin.
r.post('/', requireFeature('create_school'), asyncH(async (req, res) => {
  const { admin = {} } = req.body;
  const name = String(req.body.name || '').trim();
  const code = String(req.body.code || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!name || !code) throw httpError(400, 'School name and code are required');
  const loginId = String(admin.login_id || '').trim().toLowerCase();
  if (!LOGIN_RE.test(loginId)) throw httpError(400, 'Admin ID: 3-40 letters, numbers, . _ -');
  if (String(admin.password || '').length < 6) throw httpError(400, 'Admin password needs at least 6 characters');

  const { data: school, error } = await db.from('schools').insert({ name, code, ...clean(req.body, FIELDS.slice(1)) }).select().single();
  check(error);
  try {
    const { data: u, error: e1 } = await db.from('users').insert({
      school_id: school.id, login_id: loginId, role: 'school_admin', password_hash: await bcrypt.hash(String(admin.password), 10),
    }).select('user_id').single();
    check(e1);
    const { error: e2 } = await db.from('profiles').insert({ user_id: u.user_id, school_id: school.id, full_name: admin.full_name || null, phone: admin.phone || null, email: admin.email || null });
    check(e2);
    res.status(201).json({ school, admin: { user_id: u.user_id, login_id: loginId } });
  } catch (e) {
    await db.from('schools').delete().eq('id', school.id); // roll back, cascades users
    throw e;
  }
}));

// get_school: super admin sees all, everyone else only their own
r.get('/', requireFeature('get_school', 'edit_school'), asyncH(async (req, res) => {
  let q = db.from('schools').select('*').order('created_at', { ascending: false });
  if (!isSuper(req)) q = q.eq('id', req.user.school_id);
  const { data, error } = await q;
  check(error);
  res.json(data);
}));

r.get('/:id', requireFeature('get_school', 'edit_school'), asyncH(async (req, res) => {
  if (!isSuper(req) && req.params.id !== req.user.school_id) throw httpError(404, 'School not found');
  const { data, error } = await db.from('schools').select('*').eq('id', req.params.id).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'School not found');
  res.json(data);
}));

r.patch('/:id', requireFeature('edit_school'), asyncH(async (req, res) => {
  if (!isSuper(req) && req.params.id !== req.user.school_id) throw httpError(404, 'School not found');
  const patch = clean(req.body, FIELDS);
  if (patch.name === null) throw httpError(400, 'School name cannot be empty');
  if (isSuper(req)) {
    if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active;
    if (req.body.code) patch.code = String(req.body.code).trim().toLowerCase().replace(/\s+/g, '-');
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await db.from('schools').update(patch).eq('id', req.params.id).select().maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'School not found');
  res.json(data);
}));

// promote_students: dry_run (default) previews; real run moves everyone up and starts the new session
r.post('/:id/promote', requireFeature('promote_students'), asyncH(async (req, res) => {
  if (!isSuper(req) && req.params.id !== req.user.school_id) throw httpError(404, 'School not found');
  const dry = req.body.dry_run !== false;
  const ns = req.body.new_session || {};
  if (!dry && !(ns.name && ns.start_date && ns.end_date)) throw httpError(400, 'Give the new session a name, start date and end date');
  const { data, error } = await db.rpc('promote_students', {
    p_school: req.params.id, p_final: req.body.final_class_action === 'keep' ? 'keep' : 'deactivate', p_dry: dry, p_new_session: dry ? null : ns,
  });
  check(error);
  res.json(data);
}));

export default r;
