import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';

const r = Router();
const TONES = ['ok', 'off', 'warn', 'info', 'mute'];
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select'];
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
const has = (req, f) => req.user.features.includes(f);
const str = (v, max) => String(v ?? '').trim().slice(0, max);

const DEFAULT_TYPES = [
  { name: 'Admission enquiry', audience: 'external', fields: [
    { key: 'child_name', label: 'Child name', type: 'text', required: true },
    { key: 'class_applying', label: 'Class applying for', type: 'text', required: true },
    { key: 'child_dob', label: 'Child date of birth', type: 'date' },
    { key: 'prev_school', label: 'Previous school', type: 'text' },
    { key: 'source', label: 'How did you hear about us?', type: 'select', options: ['Walk-in', 'Friend / relative', 'Social media', 'Advertisement', 'Other'] },
  ] },
  { name: 'General query', audience: 'external', fields: [] },
  { name: 'Complaint / feedback', audience: 'external', fields: [] },
  { name: 'Internal query', audience: 'internal', fields: [
    { key: 'department', label: 'Department', type: 'text' },
  ] },
];
const DEFAULT_STATUSES = [
  { name: 'Pending', color: 'warn', is_closed: false, is_default: true },
  { name: 'In progress', color: 'info', is_closed: false },
  { name: 'Done', color: 'ok', is_closed: true },
  { name: 'Rejected', color: 'off', is_closed: true },
];

// first use of the module in a school: create the starter forms and statuses
async function ensureDefaults(school) {
  const { count, error } = await db.from('query_statuses').select('id', { count: 'exact', head: true }).eq('school_id', school);
  check(error);
  if (count) return;
  const s = await db.from('query_statuses').upsert(DEFAULT_STATUSES.map((x, i) => ({ name: x.name, color: x.color, is_closed: !!x.is_closed, is_default: !!x.is_default, school_id: school, sort_order: i })), { onConflict: 'school_id,name', ignoreDuplicates: true });
  check(s.error);
  const t = await db.from('query_types').upsert(DEFAULT_TYPES.map((x, i) => ({ name: x.name, audience: x.audience, fields: x.fields, school_id: school, sort_order: i })), { onConflict: 'school_id,name', ignoreDuplicates: true });
  check(t.error);
}

function cleanFields(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw httpError(400, 'Form questions must be a list');
  if (input.length > 25) throw httpError(400, 'A form can have at most 25 extra questions');
  const seen = new Set();
  return input.map((f, i) => {
    const label = str(f.label, 80);
    if (!label) throw httpError(400, `Question ${i + 1} needs a label`);
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    let key = str(f.key, 40).replace(/[^a-z0-9_]/gi, '_').toLowerCase() || `q${i + 1}`;
    while (seen.has(key)) key += '_';
    seen.add(key);
    const out = { key, label, type, required: !!f.required };
    if (type === 'select') {
      out.options = (Array.isArray(f.options) ? f.options : String(f.options || '').split(',')).map((o) => str(o, 60)).filter(Boolean).slice(0, 20);
      if (!out.options.length) throw httpError(400, `"${label}" needs at least one choice`);
    }
    return out;
  });
}

// ---------------------------------------------------------------- meta: forms + statuses (used by every screen)
r.get('/meta', requireFeature('add_query', 'view_queries', 'update_query', 'manage_query_settings'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  await ensureDefaults(school);
  const [t, s] = await Promise.all([
    db.from('query_types').select('id,name,audience,fields,sort_order,is_active').eq('school_id', school).order('sort_order').order('name'),
    db.from('query_statuses').select('id,name,color,is_closed,is_default,sort_order').eq('school_id', school).order('sort_order').order('name'),
  ]);
  check(t.error); check(s.error);
  res.json({ types: has(req, 'manage_query_settings') ? t.data : t.data.filter((x) => x.is_active), statuses: s.data });
}));

// ---------------------------------------------------------------- list (+ counts per status)
r.get('/', requireFeature('add_query', 'view_queries'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  await ensureDefaults(school);
  const seeAll = has(req, 'view_queries');
  let q = db.from('queries').select('id,ref_no,type_id,type_name,status_id,name,phone,subject,created_at,updated_at,closed_at,created_by', { count: 'exact' }).eq('school_id', school);
  if (!seeAll) q = q.eq('created_by', req.user.user_id);
  if (req.query.status_id) q = q.eq('status_id', req.query.status_id);
  if (req.query.type_id) q = q.eq('type_id', req.query.type_id);
  if (req.query.open === '1') {
    const { data: closed, error } = await db.from('query_statuses').select('id').eq('school_id', school).eq('is_closed', true);
    check(error);
    if (closed.length) q = q.not('status_id', 'in', `(${closed.map((c) => c.id).join(',')})`);
  }
  const term = str(req.query.q, 60).replace(/[,()%*]/g, ' ').trim();
  if (term) q = q.or(`name.ilike.%${term}%,phone.ilike.%${term}%,subject.ilike.%${term}%`);
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = 50;
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(page * size, page * size + size - 1);
  check(error);
  res.json({ queries: data, total: count, page, size, can_see_all: seeAll });
}));

// ---------------------------------------------------------------- one entry with its history
r.get('/:id', requireFeature('add_query', 'view_queries'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const { data: row, error } = await db.from('queries').select('*').eq('id', req.params.id).eq('school_id', school).maybeSingle();
  check(error);
  if (!row || (!has(req, 'view_queries') && row.created_by !== req.user.user_id)) throw httpError(404, 'Entry not found');
  const { data: notes, error: e2 } = await db.from('query_notes').select('id,note,status_name,created_at,created_by').eq('query_id', row.id).order('created_at');
  check(e2);
  const ids = [...new Set([row.created_by, ...notes.map((n) => n.created_by)].filter(Boolean))];
  const names = new Map();
  if (ids.length) {
    const { data: us, error: e3 } = await db.from('users').select('user_id,login_id,profiles(full_name)').in('user_id', ids);
    check(e3);
    us.forEach((u) => names.set(u.user_id, u.profiles?.full_name || u.login_id));
  }
  res.json({ ...row, created_by_name: names.get(row.created_by) || null, notes: notes.map((n) => ({ ...n, by: names.get(n.created_by) || null })) });
}));

// ---------------------------------------------------------------- new entry
r.post('/', requireFeature('add_query'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  await ensureDefaults(school);
  const { data: type, error: te } = await db.from('query_types').select('*').eq('id', req.body.type_id || '00000000-0000-0000-0000-000000000000').eq('school_id', school).maybeSingle();
  check(te);
  if (!type || !type.is_active) throw httpError(400, 'Choose a form');
  const name = str(req.body.name, 120);
  if (!name) throw httpError(400, 'Name is required');
  const phone = str(req.body.phone, 30) || null;
  if (phone && !/^[0-9+()\-\s]{5,30}$/.test(phone)) throw httpError(400, 'Enter a valid phone number');
  const subject = str(req.body.subject, 160) || null;
  const details = str(req.body.details, 3000) || null;
  const given = req.body.data && typeof req.body.data === 'object' ? req.body.data : {};
  const data = {};
  for (const f of type.fields || []) {
    const v = str(given[f.key], 500);
    if (f.required && !v) throw httpError(400, `"${f.label}" is required`);
    if (!v) continue;
    if (f.type === 'number' && !Number.isFinite(Number(v))) throw httpError(400, `"${f.label}" must be a number`);
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw httpError(400, `"${f.label}" must be a date`);
    if (f.type === 'select' && !(f.options || []).includes(v)) throw httpError(400, `Choose a valid option for "${f.label}"`);
    data[f.key] = v;
  }
  const { data: st, error: se } = await db.from('query_statuses').select('id,name,is_closed').eq('school_id', school).order('is_default', { ascending: false }).order('sort_order').limit(1);
  check(se);
  const status = st[0];
  const { data: row, error } = await db.from('queries').insert({
    school_id: school, type_id: type.id, type_name: type.name, status_id: status?.id || null,
    name, phone, subject, details, data, created_by: req.user.user_id,
  }).select('id,ref_no,name,type_name').single();
  check(error);
  res.status(201).json(row);
}));

// ---------------------------------------------------------------- change status / add a note
r.patch('/:id', requireFeature('update_query'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const { data: row, error } = await db.from('queries').select('id,name,status_id').eq('id', req.params.id).eq('school_id', school).maybeSingle();
  check(error);
  if (!row) throw httpError(404, 'Entry not found');
  const note = str(req.body.note, 1000) || null;
  let status = null;
  if (req.body.status_id && req.body.status_id !== row.status_id) {
    const { data, error: e2 } = await db.from('query_statuses').select('id,name,is_closed').eq('id', req.body.status_id).eq('school_id', school).maybeSingle();
    check(e2);
    if (!data) throw httpError(400, 'Unknown status');
    status = data;
  }
  if (!status && !note) throw httpError(400, 'Change the status or write a note');
  const upd = { updated_at: new Date().toISOString() };
  if (status) { upd.status_id = status.id; upd.closed_at = status.is_closed ? new Date().toISOString() : null; }
  check((await db.from('queries').update(upd).eq('id', row.id)).error);
  check((await db.from('query_notes').insert({ query_id: row.id, school_id: school, note, status_name: status?.name || null, created_by: req.user.user_id })).error);
  res.json({ ok: true, name: row.name });
}));

r.delete('/:id', requireFeature('delete_query'), asyncH(async (req, res) => {
  let q = db.from('queries').delete().eq('id', req.params.id);
  if (!isSuper(req)) q = q.eq('school_id', req.user.school_id);
  check((await q).error);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- settings: forms
r.post('/types', requireFeature('manage_query_settings'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const name = str(req.body.name, 60);
  if (!name) throw httpError(400, 'Form name is required');
  const { count } = await db.from('query_types').select('id', { count: 'exact', head: true }).eq('school_id', school);
  const { data, error } = await db.from('query_types').insert({
    school_id: school, name, audience: req.body.audience === 'internal' ? 'internal' : 'external',
    fields: cleanFields(req.body.fields), sort_order: count || 0,
  }).select().single();
  check(error);
  res.status(201).json(data);
}));
r.patch('/types/:id', requireFeature('manage_query_settings'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const upd = {};
  if (req.body.name !== undefined) { upd.name = str(req.body.name, 60); if (!upd.name) throw httpError(400, 'Form name is required'); }
  if (req.body.audience !== undefined) upd.audience = req.body.audience === 'internal' ? 'internal' : 'external';
  if (req.body.fields !== undefined) upd.fields = cleanFields(req.body.fields);
  if (req.body.is_active !== undefined) upd.is_active = !!req.body.is_active;
  const { data, error } = await db.from('query_types').update(upd).eq('id', req.params.id).eq('school_id', school).select().single();
  check(error);
  res.json(data);
}));
r.delete('/types/:id', requireFeature('manage_query_settings'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const { count } = await db.from('queries').select('id', { count: 'exact', head: true }).eq('type_id', req.params.id).eq('school_id', school);
  if (count) throw httpError(409, `${count} entr${count === 1 ? 'y uses' : 'ies use'} this form. Switch it off instead of deleting it.`);
  check((await db.from('query_types').delete().eq('id', req.params.id).eq('school_id', school)).error);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- settings: statuses
r.post('/statuses', requireFeature('manage_query_settings'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const name = str(req.body.name, 40);
  if (!name) throw httpError(400, 'Status name is required');
  const { count } = await db.from('query_statuses').select('id', { count: 'exact', head: true }).eq('school_id', school);
  const { data, error } = await db.from('query_statuses').insert({
    school_id: school, name, color: TONES.includes(req.body.color) ? req.body.color : 'info', is_closed: !!req.body.is_closed, sort_order: count || 0,
  }).select().single();
  check(error);
  res.status(201).json(data);
}));
r.patch('/statuses/:id', requireFeature('manage_query_settings'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const upd = {};
  if (req.body.name !== undefined) { upd.name = str(req.body.name, 40); if (!upd.name) throw httpError(400, 'Status name is required'); }
  if (req.body.color !== undefined && TONES.includes(req.body.color)) upd.color = req.body.color;
  if (req.body.is_closed !== undefined) upd.is_closed = !!req.body.is_closed;
  if (req.body.is_default === true) {
    check((await db.from('query_statuses').update({ is_default: false }).eq('school_id', school)).error);
    upd.is_default = true;
  }
  const { data, error } = await db.from('query_statuses').update(upd).eq('id', req.params.id).eq('school_id', school).select().single();
  check(error);
  res.json(data);
}));
r.delete('/statuses/:id', requireFeature('manage_query_settings'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const { count } = await db.from('queries').select('id', { count: 'exact', head: true }).eq('status_id', req.params.id).eq('school_id', school);
  if (count) throw httpError(409, `${count} entr${count === 1 ? 'y has' : 'ies have'} this status. Move them to another status first.`);
  check((await db.from('query_statuses').delete().eq('id', req.params.id).eq('school_id', school)).error);
  res.json({ ok: true });
}));

export default r;
