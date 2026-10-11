// Helpers shared by the tool files. Nothing here talks to the database: everything goes through
// ctx.api(), i.e. the portal's own routes, so permissions are always the backend's.
import { httpError } from '../db.js';

export const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
export const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
export const N = (description) => ({ type: 'number', description });
export const B = (description) => ({ type: 'boolean', description });
export const obj = (properties, required = []) => ({ type: 'object', properties, required });
export const schoolProp = { school: S('School name (only a super admin needs this; everyone else works in their own school)') };
export const withSchool = (properties) => ({ ...properties, ...schoolProp });
export const classLabel = (c) => `${c.name ?? ''}${c.section ? ` ${c.section}` : ''}`.trim();
export const cap = (v, n = 6000) => { const s = JSON.stringify(v); return s.length <= n ? v : { truncated: true, text: s.slice(0, n) }; };
export const peso = (n) => `Rs ${Number(n).toLocaleString('en-IN')}`;

// "path?a=1&b=2" (skips empty values)
export function P(path, params = {}) {
  const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return q ? `${path}?${q}` : path;
}

// Pick exactly one item out of a list by name, or explain what is wrong in words the model can relay.
export function pickOne(list, wanted, nameOf, what, extraOf = () => '') {
  const w = norm(wanted);
  const exact = list.filter((x) => norm(nameOf(x)) === w);
  const found = exact.length ? exact : list.filter((x) => norm(nameOf(x)).includes(w));
  if (found.length === 1) return found[0];
  if (!found.length) throw httpError(404, `No ${what} found for "${wanted}"`);
  throw httpError(409, `More than one ${what} matches "${wanted}": ${found.slice(0, 8).map((x) => `${nameOf(x)}${extraOf(x) ? ` (${extraOf(x)})` : ''}`).join('; ')}. Ask which one.`);
}

// ---- school (only matters to a super admin; others pass nothing) ----
export async function resolveSchoolId(ctx, name) {
  if (!name) return undefined;
  const list = await ctx.api('GET', '/schools');
  return pickOne(list, name, (s) => s.name, 'school', (s) => s.code).id;
}

// ---- classes: try every route a person might be allowed to use, first that works wins ----
const CLASS_SOURCES = {
  attendance: (ctx, sid) => ctx.api('GET', P('/attendance/classes', { school_id: sid })).then((r) => r.classes),
  academics: (ctx, sid) => ctx.api('GET', P('/academics/meta', { school_id: sid })).then((r) => r.classes),
  fees: (ctx, sid) => ctx.api('GET', P('/fees/classes', { school_id: sid })),
  users: (ctx, sid) => ctx.api('GET', P('/classes', { school_id: sid })).then((r) => (sid ? r.filter((c) => c.school_id === sid) : r)),
  documents: (ctx, sid) => ctx.api('GET', P('/documents/meta', { school_id: sid })).then((r) => r.classes.map((c) => ({ id: c.id, name: c.label, section: '' }))),
};
export async function listClasses(ctx, sid, prefer = []) {
  const order = [...new Set([...prefer, ...Object.keys(CLASS_SOURCES)])];
  let denied;
  for (const key of order) {
    try { return (await CLASS_SOURCES[key](ctx, sid)).map((c) => ({ id: c.id, name: c.name, section: c.section || '', label: classLabel(c) })); }
    catch (e) { if (e.status !== 403) throw e; denied = e; }
  }
  throw denied || httpError(403, "You don't have access to classes");
}
export async function resolveClass(ctx, label, sid, prefer) {
  const list = await listClasses(ctx, sid, prefer);
  const w = norm(label).replace(/^class\s+/, '');
  const compact = (s) => norm(s).replace(/\s+/g, '');
  const exact = list.filter((c) => norm(c.label) === w || compact(c.label) === compact(w));
  const found = exact.length ? exact : list.filter((c) => norm(c.name) === w);
  if (found.length === 1) return found[0];
  throw httpError(found.length ? 409 : 404, found.length ? `Which section? ${found.map((c) => c.label).join(', ')}` : `No class "${label}". Classes: ${list.map((c) => c.label).join(', ') || 'none yet'}`);
}

// ---- students ----
const STUDENT_SOURCES = {
  attendance: async (ctx, q, sid) => (await ctx.api('GET', P('/attendance/students', { q, school_id: sid }))).map((s) => ({ id: s.student_id, name: s.full_name, login_id: s.login_id, class_label: s.class_label, roll_no: s.roll_no })),
  fees: async (ctx, q, sid) => (await ctx.api('GET', P('/fees/students', { q, school_id: sid }))).map((s) => ({ id: s.student_id, name: s.full_name, login_id: s.login_id, class_label: s.class_label, roll_no: s.roll_no })),
  documents: async (ctx, q, sid) => (await ctx.api('GET', P('/documents/people', { kind: 'student', q, school_id: sid }))).map((s) => ({ id: s.id, name: s.name, login_id: s.login_id, class_label: s.class_label, roll_no: s.roll_no })),
  users: async (ctx, q, sid) => (await ctx.api('GET', P('/users', { role: 'student', school_id: sid }))).filter((u) => norm(u.profile?.full_name).includes(norm(q)) || norm(u.login_id).includes(norm(q))).map((u) => ({ id: u.user_id, name: u.profile?.full_name || u.login_id, login_id: u.login_id, class_label: '', roll_no: u.profile?.roll_no })),
};
export async function findStudent(ctx, query, sid, prefer = []) {
  const order = [...new Set([...prefer, ...Object.keys(STUDENT_SOURCES)])];
  let denied;
  for (const key of order) {
    let list;
    try { list = await STUDENT_SOURCES[key](ctx, String(query).trim(), sid); } catch (e) { if (e.status !== 403) throw e; denied = e; continue; }
    if (!list.length) { denied = httpError(404, `No student found for "${query}"`); continue; }
    return pickOne(list, query, (s) => s.name, 'student', (s) => `${s.class_label || 'class ?'}${s.roll_no ? `, roll ${s.roll_no}` : ''}, login ${s.login_id}`.trim());
  }
  throw denied || httpError(404, `No student found for "${query}"`);
}

// ---- any user: by login id first, else by name ----
export async function findUser(ctx, who, sid) {
  const w = String(who).trim();
  if (/^[a-z0-9._-]{3,40}$/i.test(w)) {
    try { const u = await ctx.api('GET', `/users/${encodeURIComponent(w.toLowerCase())}`); return { user_id: u.user_id, login_id: u.login_id, role: u.role, name: u.profile?.full_name || u.login_id, school_id: u.school_id, raw: u }; }
    catch (e) { if (e.status !== 404 && e.status !== 403) throw e; }
  }
  const rows = await ctx.api('GET', P('/users', { school_id: sid }));
  const u = pickOne(rows, w, (x) => x.profile?.full_name || x.login_id, 'person', (x) => `${x.role}, login ${x.login_id}`);
  return { user_id: u.user_id, login_id: u.login_id, role: u.role, name: u.profile?.full_name || u.login_id, school_id: u.school_id, raw: u };
}

export async function currentSessionId(ctx, sid, name) {
  const rows = await ctx.api('GET', P('/calendar/sessions', { school_id: sid }));
  if (name) return pickOne(rows, name, (s) => s.name, 'session').id;
  return rows.find((s) => s.is_current)?.id;
}
