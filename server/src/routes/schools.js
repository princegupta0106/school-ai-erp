import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import multer from 'multer';
import { keyOf, refOf, toDisplay, uploadFile, deleteFile } from '../r2.js';
import { nextLoginId } from '../userIds.js';

const r = Router();
const FIELDS = ['name', 'address', 'phone', 'email', 'logo_url'];
const clean = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, typeof o[k] === 'string' ? (o[k].trim() || null) : o[k]]));
// The logo is either an outside link or a file in our private bucket (kept as "r2:<key>", shown through a 1-hour signed link).
const showSchool = async (s) => (s ? { ...s, logo_url: s.logo_url ? await toDisplay(s.logo_url) : s.logo_url } : s);
function storedLogo(schoolId, patch) {
  if (typeof patch.logo_url !== 'string') return;
  const key = keyOf(patch.logo_url);
  if (!key) return;
  if (key.includes('..') || !key.startsWith(`schools/${schoolId}/`)) throw httpError(400, 'The logo must be a file uploaded for this school');
  patch.logo_url = refOf(key);
}
const logoUpload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(/^image\/(png|jpe?g|webp)$/.test(file.mimetype) ? null : httpError(400, 'Only PNG, JPG or WebP images'), true),
});
const ownSchool = (req) => { if (!isSuper(req) && req.params.id !== req.user.school_id) throw httpError(404, 'School not found'); };
const dropOldLogo = async (stored) => { const k = keyOf(stored); if (k) await deleteFile(k).catch(() => {}); };

// create_school: super admin only. Creates the school AND its first school admin.
r.post('/', requireFeature('create_school'), asyncH(async (req, res) => {
  const { admin = {} } = req.body;
  const name = String(req.body.name || '').trim();
  const code = String(req.body.code || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!name || !code) throw httpError(400, 'School name and code are required');
  if (!String(admin.full_name || '').trim()) throw httpError(400, 'Admin name is required');
  if (String(admin.password || '').length < 6) throw httpError(400, 'Admin password needs at least 6 characters');

  if (keyOf(req.body.logo_url)) throw httpError(400, 'Upload the logo after the school is created');
  const { data: school, error } = await db.from('schools').insert({ name, code, ...clean(req.body, FIELDS.slice(1)) }).select().single();
  check(error);
  try {
    // the school gets its 2-letter prefix and the admin the first automatic ID (e.g. AF001)
    const password_hash = await bcrypt.hash(String(admin.password), 10);
    let u; let loginId;
    for (let tries = 0; tries < 5; tries += 1) {
      loginId = await nextLoginId(school.id);
      const r2 = await db.from('users').insert({ school_id: school.id, login_id: loginId, role: 'school_admin', password_hash }).select('user_id').single();
      if (r2.error?.code === '23505') continue;
      check(r2.error); u = r2.data; break;
    }
    if (!u) throw httpError(409, 'Could not make a free user ID, please try again');
    const { error: e2 } = await db.from('profiles').insert({ user_id: u.user_id, school_id: school.id, full_name: String(admin.full_name).trim(), phone: admin.phone || null, email: admin.email || null });
    check(e2);
    res.status(201).json({ school: await showSchool(school), admin: { user_id: u.user_id, login_id: loginId } });
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
  res.json(await Promise.all(data.map(showSchool)));
}));

r.get('/:id', requireFeature('get_school', 'edit_school'), asyncH(async (req, res) => {
  if (!isSuper(req) && req.params.id !== req.user.school_id) throw httpError(404, 'School not found');
  const { data, error } = await db.from('schools').select('*').eq('id', req.params.id).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'School not found');
  res.json(await showSchool(data));
}));

r.patch('/:id', requireFeature('edit_school'), asyncH(async (req, res) => {
  if (!isSuper(req) && req.params.id !== req.user.school_id) throw httpError(404, 'School not found');
  const patch = clean(req.body, FIELDS);
  storedLogo(req.params.id, patch);
  if (patch.name === null) throw httpError(400, 'School name cannot be empty');
  if (isSuper(req)) {
    if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active;
    if (req.body.code) patch.code = String(req.body.code).trim().toLowerCase().replace(/\s+/g, '-');
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await db.from('schools').update(patch).eq('id', req.params.id).select().maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'School not found');
  res.json(await showSchool(data));
}));

// logo: upload a picture (replaces the old one)
r.post('/:id/logo', requireFeature('edit_school'), logoUpload.single('file'), asyncH(async (req, res) => {
  ownSchool(req);
  if (!req.file) throw httpError(400, 'Choose an image');
  if (!process.env.R2_BUCKET_NAME) throw httpError(400, 'File storage (R2) is not set up in .env');
  const { data: cur, error: e0 } = await db.from('schools').select('id,logo_url').eq('id', req.params.id).maybeSingle();
  check(e0);
  if (!cur) throw httpError(404, 'School not found');
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[req.file.mimetype];
  const key = `schools/${req.params.id}/logo-${Date.now()}.${ext}`;
  await uploadFile(key, req.file.buffer, req.file.mimetype);
  const { data, error } = await db.from('schools').update({ logo_url: refOf(key), updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) { await deleteFile(key).catch(() => {}); check(error); }
  await dropOldLogo(cur.logo_url);
  res.json(await showSchool(data));
}));

r.delete('/:id/logo', requireFeature('edit_school'), asyncH(async (req, res) => {
  ownSchool(req);
  const { data: cur, error: e0 } = await db.from('schools').select('id,logo_url').eq('id', req.params.id).maybeSingle();
  check(e0);
  if (!cur) throw httpError(404, 'School not found');
  const { data, error } = await db.from('schools').update({ logo_url: null, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  check(error);
  await dropOldLogo(cur.logo_url);
  res.json(await showSchool(data));
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
