import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import { cfg } from '../config.js';
import { dayStart, AUDIT_MODULES, setAudit } from '../audit.js';
import { modulesFor } from '../features.js';

// Audit logs are read-only through the API: there is no route to change or delete a row.
//  - school admin: only the rows of their own school (forced here, whatever the query says)
//  - super admin : every school (optionally ?school_id=<id> for one school, or ?school_id=platform for platform-level rows)
const r = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['change', 'view', 'auth'];
const COLS = 'id,created_at,school_id,school_name,actor_id,actor_login,actor_name,actor_role,module,action,kind,summary,entity_type,entity_id,entity_label,success,status_code,method,path,ip,user_agent,duration_ms,detail';

function filtered(req) {
  const s = req.query;
  let q = db.from('audit_logs').select(COLS).order('created_at', { ascending: false }).order('id', { ascending: false });

  if (!isSuper(req)) {
    if (!req.user.school_id) throw httpError(403, 'No school on this account');
    q = q.eq('school_id', req.user.school_id);
  } else if (s.school_id === 'platform') q = q.is('school_id', null);
  else if (s.school_id) {
    if (!UUID.test(s.school_id)) throw httpError(400, 'Bad school');
    q = q.eq('school_id', s.school_id);
  }

  if (s.module) { if (!AUDIT_MODULES[s.module]) throw httpError(400, 'Bad module'); q = q.eq('module', s.module); }
  if (s.kind) { if (!KINDS.includes(s.kind)) throw httpError(400, 'Bad type'); q = q.eq('kind', s.kind); }
  if (s.result === 'failed') q = q.eq('success', false);
  else if (s.result === 'ok') q = q.eq('success', true);
  if (s.actor_id) { if (!UUID.test(s.actor_id)) throw httpError(400, 'Bad user'); q = q.eq('actor_id', s.actor_id); }

  const from = dayStart(s.from); const to = dayStart(s.to, 1); // `to` is inclusive of that whole day
  if (s.from && !from) throw httpError(400, 'Bad "from" date');
  if (s.to && !to) throw httpError(400, 'Bad "to" date');
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lt('created_at', to);

  if (s.before) { if (Number.isNaN(Date.parse(s.before))) throw httpError(400, 'Bad cursor'); q = q.lt('created_at', s.before); }

  const term = String(s.q || '').replace(/[,()%*\\"']/g, ' ').trim().slice(0, 80);
  if (term) {
    const like = `%${term}%`;
    q = q.or(['summary', 'actor_name', 'actor_login', 'entity_label', 'action', 'ip'].map((c) => `${c}.ilike.${like}`).join(','));
  }
  return q;
}

r.get('/', requireFeature('view_audit_logs'), asyncH(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 10), 100);
  const { data, error } = await filtered(req).limit(limit + 1);
  check(error);
  const more = data.length > limit;
  const logs = more ? data.slice(0, limit) : data;
  res.json({ logs, next: more ? logs[logs.length - 1].created_at : null });
}));

// The browser calls this whenever someone opens a module or one of its tabs, so page views are in the log
// too (e.g. "Opened Payroll & Leave > My leave & pay"). Only modules the person really has access to are accepted.
r.post('/navigate', asyncH(async (req, res) => {
  const key = String(req.body.module || '');
  const mod = modulesFor(req.user.features).find((m) => m.key === key);
  if (!mod || !AUDIT_MODULES[key]) throw httpError(400, 'Unknown module');
  const view = String(req.body.view || '');
  if (view && !/^[a-z0-9_-]{1,40}$/i.test(view)) throw httpError(400, 'Unknown page');
  const label = String(req.body.view_label || '').replace(/[^\p{L}\p{N} &'./-]/gu, '').slice(0, 60) || view;
  setAudit(req, {
    action: view ? `${key}.open_view` : `${key}.open_module`, kind: 'view',
    summary: view ? `Opened ${mod.label} > ${label}` : `Opened the ${mod.label} module`,
    detail: { page: view ? { module: key, view, label } : { module: key } },
  });
  res.json({ ok: true });
}));

const csvCell = (v) => {
  const t = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

// CSV of the current filters (max 5000 newest rows). The export itself is written to the audit log.
r.get('/export', requireFeature('view_audit_logs'), asyncH(async (req, res) => {
  const { data, error } = await filtered(req).limit(5000);
  check(error);
  const local = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: cfg.timezone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(t));
  const head = ['When', 'School', 'Who', 'Login ID', 'Role', 'Type', 'Module', 'What', 'Target', 'Result', 'Status', 'IP', 'Action code', 'Details'];
  const rows = data.map((x) => [local(x.created_at), x.school_name || (x.school_id ? '' : 'Platform'), x.actor_name, x.actor_login, x.actor_role,
    x.kind, AUDIT_MODULES[x.module] || x.module, x.summary, x.entity_label, x.success ? 'OK' : 'Failed', x.status_code, x.ip, x.action, x.detail]);
  const csv = [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${csv}`);
}));

export default r;
