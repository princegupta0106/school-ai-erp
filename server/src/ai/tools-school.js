// School settings, academic calendar, year-end promotion, deeper user management, visitors, audit log.
// Every tool = "which endpoint + which params". The backend decides if the person may do it.
import crypto from 'node:crypto';
import { httpError } from '../db.js';
import { MODULES } from '../features.js';
import { S, N, B, obj, withSchool, resolveSchoolId, resolveClass, findUser, pickOne, P, cap, norm } from './helpers.js';
import { resolveDate, todayIn } from './tools-leave.js';

const makePassword = () => crypto.randomBytes(9).toString('base64url').slice(0, 10);
const ROLES = ['school_admin', 'staff', 'student', 'parent', 'other'];
const PROFILE = ['phone', 'email', 'dob', 'gender', 'address', 'designation', 'department', 'employee_id', 'joining_date', 'qualification', 'admission_no', 'father_name', 'mother_name', 'father_phone', 'mother_phone', 'father_occupation', 'mother_occupation', 'blood_group', 'emergency_contact_name', 'emergency_contact_phone', 'salary', 'roll_no', 'full_name'];

async function schoolIdFor(ctx, a) {
  const sid = await resolveSchoolId(ctx, a.school);
  const id = sid || ctx.user.school_id;
  if (!id) throw httpError(400, 'Which school? (give the school name)');
  return id;
}

export const schoolTools = [
  // ---------------------------------------------------------------- school
  {
    name: 'edit_school',
    description: 'Change a school\'s name, address, phone or email.',
    features: ['edit_school'],
    parameters: obj(withSchool({ name: S('New school name'), address: S('Address'), phone: S('Phone'), email: S('Email') })),
    run: async (ctx, a) => {
      const id = await schoolIdFor(ctx, a);
      const s = await ctx.api('PATCH', `/schools/${id}`, { name: a.name, address: a.address, phone: a.phone, email: a.email });
      return { updated: true, name: s.name, address: s.address, phone: s.phone, email: s.email };
    },
  },
  {
    name: 'set_school_active',
    description: 'Turn a whole school ON or OFF (super admin). Turning it off blocks everyone of that school from signing in. The user must confirm first.',
    features: ['create_school'],
    confirm: true,
    parameters: obj({ school: S('School name'), active: B('true = on, false = off') }, ['school', 'active']),
    prepare: async (ctx, a) => {
      const list = await ctx.api('GET', '/schools'); const s = pickOne(list, a.school, (x) => x.name, 'school');
      return { args: { id: s.id, active: !!a.active }, describe: `Turn the school "${s.name}" ${a.active ? 'ON' : 'OFF (nobody from it can sign in)'}` };
    },
    run: async (ctx, a) => { const s = await ctx.api('PATCH', `/schools/${a.id}`, { is_active: a.active }); return { done: true, school: s.name, active: s.is_active }; },
  },

  // ---------------------------------------------------------------- calendar & sessions
  {
    name: 'get_calendar',
    description: 'Academic sessions (which is current) and the holidays / vacations / events / exam dates of the school.',
    features: ['get_calendar', 'manage_calendar', 'promote_students'],
    parameters: obj(withSchool({ upcoming_only: B('true = only holidays from today on') })),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const [sessions, holidays] = await Promise.all([ctx.api('GET', P('/calendar/sessions', { school_id: sid })), ctx.api('GET', P('/calendar/holidays', { school_id: sid }))]);
      const today = todayIn();
      return {
        today,
        sessions: sessions.map((s) => ({ name: s.name, from: s.start_date, to: s.end_date, current: s.is_current })),
        holidays: holidays.filter((h) => !a.upcoming_only || h.end_date >= today).slice(0, 60).map((h) => ({ title: h.title, type: h.type, from: h.start_date, to: h.end_date })),
      };
    },
  },
  {
    name: 'add_session',
    description: 'Add an academic session such as "2026-2027".',
    features: ['manage_calendar'],
    parameters: obj(withSchool({ name: S('e.g. 2026-2027'), start_date: S('YYYY-MM-DD'), end_date: S('YYYY-MM-DD'), make_current: B('make it the current session') }), ['name', 'start_date', 'end_date']),
    run: async (ctx, a) => {
      const r = await ctx.api('POST', '/calendar/sessions', { name: a.name, start_date: resolveDate(a.start_date), end_date: resolveDate(a.end_date), is_current: !!a.make_current, school_id: await resolveSchoolId(ctx, a.school) });
      return { created: true, name: r.name, current: r.is_current };
    },
  },
  {
    name: 'add_holiday',
    description: 'Add a holiday, vacation, event or exam date to the school calendar. Leave and attendance use it.',
    features: ['manage_calendar'],
    parameters: obj(withSchool({ title: S('e.g. Diwali'), start_date: S('YYYY-MM-DD'), end_date: S('YYYY-MM-DD (omit for one day)'), type: S('holiday, vacation, event or exam', { enum: ['holiday', 'vacation', 'event', 'exam'] }), description: S('Optional note') }), ['title', 'start_date']),
    run: async (ctx, a) => {
      const start = resolveDate(a.start_date);
      const r = await ctx.api('POST', '/calendar/holidays', { title: a.title, start_date: start, end_date: a.end_date ? resolveDate(a.end_date) : start, type: a.type || 'holiday', description: a.description, school_id: await resolveSchoolId(ctx, a.school) });
      return { created: true, title: r.title, from: r.start_date, to: r.end_date, type: r.type };
    },
  },
  {
    name: 'delete_holiday',
    description: 'Delete a holiday / event from the calendar by its title. The user must confirm first.',
    features: ['manage_calendar'],
    confirm: true,
    parameters: obj(withSchool({ title: S('Title of the holiday') }), ['title']),
    prepare: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const h = pickOne(await ctx.api('GET', P('/calendar/holidays', { school_id: sid })), a.title, (x) => x.title, 'holiday', (x) => x.start_date);
      return { args: { id: h.id, school_id: sid }, describe: `Delete the calendar entry "${h.title}" (${h.start_date}${h.end_date !== h.start_date ? ` to ${h.end_date}` : ''})` };
    },
    run: async (ctx, a) => { await ctx.api('DELETE', P(`/calendar/holidays/${a.id}`, { school_id: a.school_id })); return { deleted: true }; },
  },

  // ---------------------------------------------------------------- year-end promotion
  {
    name: 'preview_promotion',
    description: 'Preview the year-end promotion (who moves to which class, who graduates). Changes nothing.',
    features: ['promote_students'],
    parameters: obj(withSchool({ final_class_action: S('What happens to the last class: deactivate (default) or keep', { enum: ['deactivate', 'keep'] }) })),
    run: async (ctx, a) => cap(await ctx.api('POST', `/schools/${await schoolIdFor(ctx, a)}/promote`, { dry_run: true, final_class_action: a.final_class_action })),
  },
  {
    name: 'promote_students',
    description: 'END the current session and PROMOTE every student to the next class, then open the new session. Can only be done once per session. The user must confirm first.',
    features: ['promote_students'],
    confirm: true,
    parameters: obj(withSchool({ new_session_name: S('e.g. 2027-2028'), new_session_start: S('YYYY-MM-DD'), new_session_end: S('YYYY-MM-DD'), final_class_action: S('deactivate (default) or keep', { enum: ['deactivate', 'keep'] }) }), ['new_session_name', 'new_session_start', 'new_session_end']),
    prepare: async (ctx, a) => {
      const id = await schoolIdFor(ctx, a);
      return { args: { id, name: a.new_session_name, start_date: resolveDate(a.new_session_start), end_date: resolveDate(a.new_session_end), final_class_action: a.final_class_action || 'deactivate' }, describe: `END the current session and PROMOTE all students; new session "${a.new_session_name}" (${a.new_session_start} to ${a.new_session_end}). Last class: ${a.final_class_action === 'keep' ? 'kept' : 'graduated and accounts turned off'}. This cannot be repeated for this session.` };
    },
    run: async (ctx, a) => cap(await ctx.api('POST', `/schools/${a.id}/promote`, { dry_run: false, final_class_action: a.final_class_action, new_session: { name: a.name, start_date: a.start_date, end_date: a.end_date } })),
  },

  // ---------------------------------------------------------------- deeper user management
  {
    name: 'update_user',
    description: 'Change details on someone\'s profile (phone, email, designation, class, roll number, parents\' names, salary...). Identify the person by login id or name.',
    features: ['edit_user'],
    parameters: obj(withSchool({
      who: S('Login id or name of the person'),
      class_name: S('Move a student to this class, e.g. "6 B"'),
      ...Object.fromEntries(PROFILE.map((k) => [k, k === 'salary' || k === 'roll_no' ? N(`New ${k.replace('_', ' ')}`) : S(`New ${k.replace(/_/g, ' ')}`)])),
    }), ['who']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const u = await findUser(ctx, a.who, sid);
      const profile = {};
      for (const k of PROFILE) if (a[k] !== undefined && a[k] !== '') profile[k] = a[k];
      if (a.class_name) profile.class_id = (await resolveClass(ctx, a.class_name, u.school_id, ['users', 'attendance'])).id;
      if (!Object.keys(profile).length) throw httpError(400, 'Tell me what to change');
      const r = await ctx.api('PATCH', `/users/${u.user_id}`, { profile });
      return { updated: true, person: r.profile?.full_name || r.login_id, changed: Object.keys(profile).filter((k) => k !== 'class_id'), class_changed: !!profile.class_id, salary_saved: a.salary !== undefined ? r.profile?.salary != null : undefined };
    },
  },
  {
    name: 'link_parent_to_students',
    description: 'Link a parent account to student accounts (adds to the children already linked).',
    features: ['edit_user'],
    parameters: obj(withSchool({ parent: S('Parent login id or name'), students: { type: 'array', items: { type: 'string' }, description: 'Student login ids or names' } }), ['parent', 'students']),
    run: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const parent = await findUser(ctx, a.parent, sid);
      if (parent.role !== 'parent') throw httpError(400, `${parent.name} is not a parent account`);
      const kids = [];
      for (const s of a.students) kids.push((await findUser(ctx, s, sid)).user_id);
      const ids = [...new Set([...(parent.raw.children || []).map((c) => c.user_id), ...kids])];
      const r = await ctx.api('PUT', `/users/${parent.user_id}/children`, { student_ids: ids });
      return { linked: true, parent: r.profile?.full_name || r.login_id, children: (r.children || []).map((c) => c.full_name || c.login_id) };
    },
  },
  {
    name: 'change_user_role',
    description: 'Change a person\'s role (school_admin, staff, student, parent, other). The user must confirm first.',
    features: ['change_role'],
    confirm: true,
    parameters: obj(withSchool({ who: S('Login id or name'), role: S('New role', { enum: ROLES }) }), ['who', 'role']),
    prepare: async (ctx, a) => { const u = await findUser(ctx, a.who, await resolveSchoolId(ctx, a.school)); return { args: { user_id: u.user_id, role: a.role }, describe: `Change the role of ${u.name} (${u.login_id}) from ${u.role} to ${a.role}` }; },
    run: async (ctx, a) => { const r = await ctx.api('PATCH', `/users/${a.user_id}/role`, { role: a.role }); return { done: true, login_id: r.login_id, role: r.role }; },
  },
  {
    name: 'reset_user_password',
    description: 'Set a new password for a person (a random one is generated if none is given and returned once). The user must confirm first.',
    features: ['reset_pass'],
    confirm: true,
    parameters: obj(withSchool({ who: S('Login id or name'), password: S('New password (optional, min 6 chars)') }), ['who']),
    prepare: async (ctx, a) => { const u = await findUser(ctx, a.who, await resolveSchoolId(ctx, a.school)); return { args: { user_id: u.user_id, password: a.password || makePassword(), generated: !a.password }, describe: `Reset the password of ${u.name} (${u.login_id})` }; },
    run: async (ctx, a) => { await ctx.api('POST', `/users/${a.user_id}/reset-password`, { password: a.password }); return { done: true, ...(a.generated ? { generated_password: a.password, note: 'Show once; the person should change it after signing in.' } : {}) }; },
  },
  {
    name: 'delete_user',
    description: 'PERMANENTLY delete a user account. The user must confirm first. (Turning an account off with set_user_active is usually better.)',
    features: ['delete_user'],
    confirm: true,
    parameters: obj(withSchool({ who: S('Login id or name') }), ['who']),
    prepare: async (ctx, a) => { const u = await findUser(ctx, a.who, await resolveSchoolId(ctx, a.school)); return { args: { user_id: u.user_id }, describe: `PERMANENTLY DELETE the account of ${u.name} (${u.login_id}, ${u.role}). This cannot be undone.` }; },
    run: async (ctx, a) => { await ctx.api('DELETE', `/users/${a.user_id}`); return { deleted: true }; },
  },
  {
    name: 'list_feature_names',
    description: 'All permission (feature) names that can be given to a person, grouped by module. Use before changing someone\'s feature access.',
    features: ['change_features'],
    parameters: obj({}),
    run: async () => Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, Object.entries(m.features).map(([f, v]) => `${f} - ${v.label}`)])),
  },
  {
    name: 'set_user_features',
    description: 'Give or take away permissions (feature names) of a person. Use list_feature_names first. The user must confirm first. You can only give what you hold yourself.',
    features: ['change_features'],
    confirm: true,
    parameters: obj(withSchool({ who: S('Login id or name'), add: { type: 'array', items: { type: 'string' }, description: 'Feature names to give' }, remove: { type: 'array', items: { type: 'string' }, description: 'Feature names to take away' } }), ['who']),
    prepare: async (ctx, a) => {
      const u = await findUser(ctx, a.who, await resolveSchoolId(ctx, a.school));
      const cur = u.raw.profile?.features_permission || [];
      const next = [...new Set([...cur, ...(a.add || [])])].filter((f) => !(a.remove || []).includes(f));
      return { args: { user_id: u.user_id, features: next }, describe: `${u.name} (${u.login_id}): ${(a.add || []).length ? `GIVE ${a.add.join(', ')}` : ''}${(a.add || []).length && (a.remove || []).length ? '; ' : ''}${(a.remove || []).length ? `TAKE AWAY ${a.remove.join(', ')}` : ''}` };
    },
    run: async (ctx, a) => { const r = await ctx.api('PATCH', `/users/${a.user_id}/features`, { features_permission: a.features }); return { done: true, features_now: r.profile?.features_permission }; },
  },

  // ---------------------------------------------------------------- visitors
  {
    name: 'add_visitor',
    description: 'Log a visitor at the school. Date and time default to now.',
    features: ['add_visitor'],
    parameters: obj(withSchool({ name: S('Visitor name'), purpose: S('Purpose of the visit (optional)'), date: S('today or YYYY-MM-DD (default today)'), time: S('HH:MM 24h (default now)') }), ['name']),
    run: async (ctx, a) => {
      const r = await ctx.api('POST', '/visitors', { name: a.name, purpose: a.purpose, date: a.date ? resolveDate(a.date) : undefined, time: a.time, school_id: await resolveSchoolId(ctx, a.school) });
      return { logged: true, name: r.name, date: r.visit_date, time: r.visit_time, purpose: r.purpose };
    },
  },
  {
    name: 'list_visitors',
    description: 'Visitors of one day (default today).',
    features: ['view_visitors'],
    parameters: obj(withSchool({ date: S('today or YYYY-MM-DD') })),
    run: async (ctx, a) => {
      const r = await ctx.api('GET', P('/visitors', { date: a.date ? resolveDate(a.date) : undefined, school_id: await resolveSchoolId(ctx, a.school) }));
      return { date: r.date, count: r.visitors.length, visitors: r.visitors.map((v) => ({ name: v.name, time: v.visit_time, purpose: v.purpose || undefined })) };
    },
  },
  {
    name: 'delete_visitor',
    description: 'Delete a visitor entry (by visitor name, optional date). The user must confirm first.',
    features: ['delete_visitor'],
    confirm: true,
    parameters: obj(withSchool({ name: S('Visitor name'), date: S('today or YYYY-MM-DD (default today)') }), ['name']),
    prepare: async (ctx, a) => {
      const sid = await resolveSchoolId(ctx, a.school);
      const r = await ctx.api('GET', P('/visitors', { date: a.date ? resolveDate(a.date) : undefined, school_id: sid }));
      const v = pickOne(r.visitors, a.name, (x) => x.name, 'visitor', (x) => x.visit_time);
      return { args: { id: v.id, school_id: sid }, describe: `Delete the visitor entry "${v.name}" of ${r.date} ${v.visit_time}` };
    },
    run: async (ctx, a) => { await ctx.api('DELETE', P(`/visitors/${a.id}`, { school_id: a.school_id })); return { deleted: true }; },
  },

  // ---------------------------------------------------------------- audit log
  {
    name: 'search_audit_log',
    description: 'Search the audit log: who did what and when (latest first). Filter by text, module, type (change/view/auth), result and dates.',
    features: ['view_audit_logs'],
    parameters: obj(withSchool({
      q: S('Text to search (name, action, summary)'),
      module: S('e.g. fees, payroll, users, attendance, ai'),
      kind: S('change, view or auth', { enum: ['change', 'view', 'auth'] }),
      result: S('ok or failed', { enum: ['ok', 'failed'] }),
      from: S('YYYY-MM-DD or today'), to: S('YYYY-MM-DD or today'), limit: N('How many entries (max 30, default 15)'),
    })),
    run: async (ctx, a) => {
      const r = await ctx.api('GET', P('/audit', {
        q: a.q, module: a.module, kind: a.kind, result: a.result, school_id: await resolveSchoolId(ctx, a.school),
        from: a.from ? resolveDate(a.from) : undefined, to: a.to ? resolveDate(a.to) : undefined, limit: Math.min(Number(a.limit) || 15, 30),
      }));
      return { more_available: !!r.next, entries: r.logs.map((l) => ({ at: l.created_at, who: `${l.actor_name || l.actor_login || '?'} (${l.actor_role || '-'})`, what: l.summary, ok: l.success, module: l.module })) };
    },
  },
];
void norm;
