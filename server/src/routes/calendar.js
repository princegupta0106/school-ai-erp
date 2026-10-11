import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';

const r = Router();
const VIEW = ['get_calendar', 'manage_calendar', 'promote_students'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['holiday', 'vacation', 'event', 'exam'];

const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
const dates = (a, b) => {
  if (!DATE.test(a || '') || !DATE.test(b || '')) throw httpError(400, 'Enter valid start and end dates');
  if (b < a) throw httpError(400, 'End date is before the start date');
};
const own = async (table, id, school_id) => {
  const { data, error } = await db.from(table).select('*').eq('id', id).eq('school_id', school_id).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Not found');
  return data;
};
const clearCurrent = async (school_id) => check((await db.from('academic_sessions').update({ is_current: false }).eq('school_id', school_id).eq('is_current', true)).error);

// ---------- sessions
r.get('/sessions', requireFeature(...VIEW), asyncH(async (req, res) => {
  const { data, error } = await db.from('academic_sessions').select('*').eq('school_id', schoolOf(req)).order('start_date', { ascending: false });
  check(error);
  res.json(data);
}));

r.post('/sessions', requireFeature('manage_calendar'), asyncH(async (req, res) => {
  const school_id = schoolOf(req);
  const name = String(req.body.name || '').trim();
  if (!name) throw httpError(400, 'Session name is required, e.g. 2026-2027');
  dates(req.body.start_date, req.body.end_date);
  const { count } = await db.from('academic_sessions').select('id', { count: 'exact', head: true }).eq('school_id', school_id).eq('is_current', true);
  const makeCurrent = !!req.body.is_current || !count;
  if (makeCurrent) await clearCurrent(school_id);
  const { data, error } = await db.from('academic_sessions').insert({ school_id, name, start_date: req.body.start_date, end_date: req.body.end_date, is_current: makeCurrent }).select().single();
  check(error);
  res.status(201).json(data);
}));

r.patch('/sessions/:id', requireFeature('manage_calendar'), asyncH(async (req, res) => {
  const school_id = schoolOf(req);
  const cur = await own('academic_sessions', req.params.id, school_id);
  const patch = {};
  if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
  if (req.body.start_date || req.body.end_date) { patch.start_date = req.body.start_date || cur.start_date; patch.end_date = req.body.end_date || cur.end_date; dates(patch.start_date, patch.end_date); }
  if (req.body.is_current === true) { await clearCurrent(school_id); patch.is_current = true; }
  const { data, error } = await db.from('academic_sessions').update(patch).eq('id', cur.id).select().single();
  check(error);
  res.json(data);
}));

r.delete('/sessions/:id', requireFeature('manage_calendar'), asyncH(async (req, res) => {
  const cur = await own('academic_sessions', req.params.id, schoolOf(req));
  if (cur.is_current) throw httpError(400, 'Make another session current before deleting this one');
  check((await db.from('academic_sessions').delete().eq('id', cur.id)).error);
  res.json({ ok: true });
}));

// ---------- holidays
r.get('/holidays', requireFeature(...VIEW), asyncH(async (req, res) => {
  const { data, error } = await db.from('holidays').select('*').eq('school_id', schoolOf(req)).order('start_date');
  check(error);
  res.json(data);
}));

async function holidayBody(req, school_id, partial) {
  const b = req.body; const out = {};
  if (!partial || b.title !== undefined) { out.title = String(b.title || '').trim(); if (!out.title) throw httpError(400, 'Title is required'); }
  if (!partial || b.start_date) { out.start_date = b.start_date; out.end_date = b.end_date || b.start_date; dates(out.start_date, out.end_date); }
  if (b.type !== undefined) { if (!TYPES.includes(b.type)) throw httpError(400, 'Unknown type'); out.type = b.type; }
  if (b.description !== undefined) out.description = String(b.description).trim() || null;
  if (!partial || b.session_id !== undefined) {
    let sid = b.session_id || null;
    if (sid) await own('academic_sessions', sid, school_id);
    else if (!partial) { const { data } = await db.from('academic_sessions').select('id').eq('school_id', school_id).eq('is_current', true).maybeSingle(); sid = data?.id || null; }
    out.session_id = sid;
  }
  return out;
}

r.post('/holidays', requireFeature('manage_calendar'), asyncH(async (req, res) => {
  const school_id = schoolOf(req);
  const { data, error } = await db.from('holidays').insert({ school_id, ...(await holidayBody(req, school_id, false)) }).select().single();
  check(error);
  res.status(201).json(data);
}));

r.patch('/holidays/:id', requireFeature('manage_calendar'), asyncH(async (req, res) => {
  const school_id = schoolOf(req);
  await own('holidays', req.params.id, school_id);
  const { data, error } = await db.from('holidays').update(await holidayBody(req, school_id, true)).eq('id', req.params.id).select().single();
  check(error);
  res.json(data);
}));

r.delete('/holidays/:id', requireFeature('manage_calendar'), asyncH(async (req, res) => {
  await own('holidays', req.params.id, schoolOf(req));
  check((await db.from('holidays').delete().eq('id', req.params.id)).error);
  res.json({ ok: true });
}));

export default r;
