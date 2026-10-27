import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import { cleanClassName, cleanSection } from '../classNames.js';

const r = Router();
const READ = ['get_all_users_school', 'get_user', 'create_user', 'edit_user'];

r.get('/', requireFeature(...READ), asyncH(async (req, res) => {
  let q = db.from('classes').select('*').order('name').order('section');
  if (!isSuper(req)) q = q.eq('school_id', req.user.school_id);
  const { data, error } = await q;
  check(error);
  res.json(data);
}));

r.post('/', requireFeature('edit_user'), asyncH(async (req, res) => {
  const school_id = isSuper(req) ? req.body.school_id : req.user.school_id;
  const name = cleanClassName(req.body.name);
  if (!school_id || !name) throw httpError(400, 'Class name is required');
  const level = req.body.level !== undefined && req.body.level !== '' ? Number(req.body.level) : (/^\d+$/.test(name) ? Number(name) : null);
  if (level !== null && !Number.isInteger(level)) throw httpError(400, 'Order must be a whole number');
  const { data, error } = await db.from('classes').insert({ school_id, name, level, section: cleanSection(req.body.section) }).select().single();
  check(error);
  res.status(201).json(data);
}));

r.patch('/:id', requireFeature('edit_user'), asyncH(async (req, res) => {
  const level = req.body.level === '' || req.body.level === null ? null : Number(req.body.level);
  if (level !== null && !Number.isInteger(level)) throw httpError(400, 'Order must be a whole number');
  let q = db.from('classes').update({ level }).eq('id', req.params.id);
  if (!isSuper(req)) q = q.eq('school_id', req.user.school_id);
  const { data, error } = await q.select().maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Class not found');
  res.json(data);
}));

r.delete('/:id', requireFeature('edit_user'), asyncH(async (req, res) => {
  let q = db.from('classes').delete().eq('id', req.params.id);
  if (!isSuper(req)) q = q.eq('school_id', req.user.school_id);
  const { error } = await q;
  check(error);
  res.json({ ok: true });
}));

export default r;
