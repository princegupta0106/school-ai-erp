import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import { cfg } from '../config.js';
import { todayStr, validDate } from '../attendance.js';

const r = Router();
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
const nowTime = () => new Intl.DateTimeFormat('en-GB', { timeZone: cfg.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

// visitors of one day (default today) + the current school date/time for the entry form
r.get('/', requireFeature('view_visitors', 'add_visitor'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const date = validDate(req.query.date || todayStr());
  let visitors = [];
  if (req.user.features.includes('view_visitors')) {
    const { data, error } = await db.from('visitors').select('id,name,purpose,visit_date,visit_time,created_at').eq('school_id', school).eq('visit_date', date).order('visit_time').order('created_at');
    check(error);
    visitors = data.map((v) => ({ ...v, visit_time: v.visit_time.slice(0, 5) }));
  }
  res.json({ date, today: todayStr(), now: nowTime(), visitors });
}));

r.post('/', requireFeature('add_visitor'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const name = String(req.body.name || '').trim();
  if (!name) throw httpError(400, 'Visitor name is required');
  if (name.length > 120) throw httpError(400, 'Name is too long');
  const purpose = String(req.body.purpose || '').trim().slice(0, 300) || null;
  const visit_date = validDate(req.body.date || todayStr());
  const visit_time = req.body.time || nowTime();
  if (!TIME.test(visit_time)) throw httpError(400, 'Enter a valid time');
  const { data, error } = await db.from('visitors').insert({ school_id: school, name, purpose, visit_date, visit_time, created_by: req.user.user_id }).select('id,name,purpose,visit_date,visit_time').single();
  check(error);
  res.status(201).json({ ...data, visit_time: data.visit_time.slice(0, 5) });
}));

r.delete('/:id', requireFeature('delete_visitor'), asyncH(async (req, res) => {
  let q = db.from('visitors').delete().eq('id', req.params.id);
  if (!isSuper(req)) q = q.eq('school_id', req.user.school_id);
  check((await q).error);
  res.json({ ok: true });
}));

export default r;
