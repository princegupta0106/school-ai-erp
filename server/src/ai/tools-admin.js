// ---------------------------------------------------------------------------------------------
// TOOLS FOR SCHOOLS, USERS & CLASSES  (create a school, create a user, look people up...)
//
// These tools only say "call this endpoint with these params". WHETHER THE PERSON MAY DO IT is
// decided by the backend routes (create_school = super admin only, create_user needs the
// create_user feature, a school admin can only touch their own school...). A refused call comes
// back as an error and the bot just tells the person.
// ---------------------------------------------------------------------------------------------
import crypto from 'node:crypto';
import { httpError } from '../db.js';

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const makePassword = () => crypto.randomBytes(9).toString('base64url').slice(0, 10);
const className = (c) => `${c.name}${c.section ? ` ${c.section}` : ''}`.trim();
const ROLES = ['school_admin', 'staff', 'student', 'parent', 'other'];

async function resolveSchool(ctx, name) {
  const list = await ctx.api('GET', '/schools');
  const w = norm(name);
  const hit = list.filter((s) => norm(s.name) === w || norm(s.code) === w);
  const found = hit.length ? hit : list.filter((s) => norm(s.name).includes(w) || norm(s.code).includes(w));
  if (found.length === 1) return found[0];
  throw httpError(found.length ? 409 : 404, found.length ? `More than one school matches "${name}": ${found.map((s) => s.name).join(', ')}` : `No school found for "${name}"`);
}
async function resolveClass(ctx, label, school_id) {
  const all = await ctx.api('GET', '/classes');
  const list = school_id ? all.filter((c) => c.school_id === school_id) : all;
  const w = norm(label);
  const exact = list.filter((c) => norm(className(c)) === w || norm(c.name) === w);
  const found = exact.length ? exact : list.filter((c) => norm(className(c)).includes(w));
  if (found.length === 1) return found[0];
  throw httpError(found.length ? 409 : 404, found.length ? `Which class? ${found.map(className).join(', ')}` : `No class "${label}". Existing classes: ${list.map(className).join(', ') || 'none yet'}`);
}
// salary stays out unless the API itself returned it (it only does for people with manage_salary)
const slimUser = (u) => ({
  user_id: u.user_id, login_id: u.login_id, role: u.role, active: u.is_active, name: u.profile?.full_name || null,
  designation: u.profile?.designation || undefined, department: u.profile?.department || undefined, class_id: u.profile?.class_id || undefined,
  roll_no: u.profile?.roll_no || undefined, phone: u.profile?.phone || undefined, email: u.profile?.email || undefined,
  children: u.children?.length ? u.children.map((c) => c.full_name || c.login_id) : undefined,
});

export const adminTools = [
  {
    name: 'list_schools',
    description: 'List the schools the person can see (a super admin sees all schools, anyone else only their own).',
    features: ['get_school', 'edit_school'],
    parameters: obj({}),
    run: async (ctx) => (await ctx.api('GET', '/schools')).map((s) => ({ name: s.name, code: s.code, active: s.is_active, phone: s.phone || undefined, email: s.email || undefined, address: s.address || undefined })),
  },
  {
    name: 'create_school',
    description:
      'Create a new school together with its first school admin account. Needs: school name and the admin\'s name. Everything else is optional: ' +
      'school code and admin login id are made up from the names, and a password is generated when none is given (it is returned once so you can tell the user).',
    features: ['create_school'],
    parameters: obj({
      name: S('School name'), code: S('Short unique code, e.g. "dps-nagpur" (optional)'),
      address: S('Address'), phone: S('School phone'), email: S('School email'),
      admin_name: S('Full name of the school admin'), admin_login_id: S('Login id for the admin (optional)'),
      admin_password: S('Password for the admin (optional, min 6 chars)'), admin_email: S('Admin email'), admin_phone: S('Admin phone'),
    }, ['name', 'admin_name']),
    run: async (ctx, a) => {
      const code = String(a.code || '').trim() || slug(a.name).replace(/\./g, '-').slice(0, 40);
      const password = a.admin_password || makePassword();
      const base = String(a.admin_login_id || '').trim().toLowerCase() || slug(a.admin_name) || `admin.${code}`;
      let lastErr;
      for (let i = 0; i < 4; i++) {
        const login_id = i === 0 ? base : `${base}${Math.floor(10 + Math.random() * 90)}`;
        try {
          const r = await ctx.api('POST', '/schools', {
            name: a.name, code, address: a.address, phone: a.phone, email: a.email,
            admin: { login_id, password, full_name: a.admin_name, email: a.admin_email, phone: a.admin_phone },
          });
          return {
            created: true, school: { name: r.school.name, code: r.school.code }, admin_login_id: r.admin.login_id,
            ...(a.admin_password ? {} : { generated_password: password, note: 'Password was generated: show it to the user once and advise changing it.' }),
          };
        } catch (e) { lastErr = e; if (e.status !== 409 || a.admin_login_id) throw e; } // retry only an auto-made login id
      }
      throw lastErr;
    },
  },
  {
    name: 'list_classes',
    description: 'List the classes (e.g. "5 A") of the school. A super admin can pass a school name.',
    features: ['get_all_users_school', 'get_user', 'create_user', 'edit_user'],
    parameters: obj({ school: S('School name (super admin only)') }),
    run: async (ctx, a) => {
      const school = a.school ? await resolveSchool(ctx, a.school) : null;
      const list = await ctx.api('GET', '/classes');
      return (school ? list.filter((c) => c.school_id === school.id) : list).map((c) => ({ class: className(c), order: c.level ?? undefined }));
    },
  },
  {
    name: 'create_class',
    description: 'Add a class, e.g. name "5", section "A".',
    features: ['edit_user'],
    parameters: obj({ name: S('Class name, e.g. 5 or Nursery'), section: S('Section, e.g. A (optional)'), school: S('School name (super admin only)') }, ['name']),
    run: async (ctx, a) => {
      const school = a.school ? await resolveSchool(ctx, a.school) : null;
      const c = await ctx.api('POST', '/classes', { name: a.name, section: a.section || '', ...(school ? { school_id: school.id } : {}) });
      return { created: true, class: className(c) };
    },
  },
  {
    name: 'find_users',
    description:
      'Search people of the school by name, login id, role or class, and get head-counts by role. Use it to answer questions like "how many teachers do we have", ' +
      '"who is in class 5 A", "find Ravi".',
    features: ['get_all_users_school'],
    parameters: obj({
      search: S('Part of a name or login id'), role: S('Filter by role', { enum: ROLES }),
      class_name: S('Class like "5 A"'), school: S('School name (super admin only)'),
    }),
    run: async (ctx, a) => {
      const school = a.school ? await resolveSchool(ctx, a.school) : null;
      const q = [a.role ? `role=${a.role}` : '', school ? `school_id=${school.id}` : ''].filter(Boolean).join('&');
      let rows = await ctx.api('GET', `/users${q ? `?${q}` : ''}`);
      if (a.class_name) { const c = await resolveClass(ctx, a.class_name, school?.id || rows[0]?.school_id); rows = rows.filter((u) => u.profile?.class_id === c.id); }
      const w = norm(a.search);
      if (w) rows = rows.filter((u) => norm(u.profile?.full_name).includes(w) || norm(u.login_id).includes(w));
      const by = {}; rows.forEach((u) => { by[u.role] = (by[u.role] || 0) + 1; });
      return { total: rows.length, by_role: by, people: rows.slice(0, 30).map(slimUser), truncated: rows.length > 30 || undefined };
    },
  },
  {
    name: 'get_user_details',
    description: 'Full profile of one person, by login id or exact user id (parents show their children, students show parents).',
    features: ['get_user'],
    parameters: obj({ login_id: S('Login id or user id') }, ['login_id']),
    run: async (ctx, a) => {
      const u = await ctx.api('GET', `/users/${encodeURIComponent(String(a.login_id).trim())}`);
      const { documents, extra, features_permission, ...p } = u.profile || {};
      return { ...slimUser(u), profile: p, parents: u.parents?.map((x) => x.full_name || x.login_id), children: u.children?.map((x) => x.full_name || x.login_id) };
    },
  },
  {
    name: 'create_user',
    description:
      'Create a new user account (teacher/staff, student, parent, school admin or other). Needs only full_name and role (and class for a student if known). ' +
      'Login id is made from the name and a password is generated when not given (returned once so you can tell the user). ' +
      'A super admin must also say which school. Salary is only saved if the person has the salary permission.',
    features: ['create_user'],
    parameters: obj({
      full_name: S('Full name'), role: S('Account type', { enum: ROLES }),
      login_id: S('Login id (optional)'), password: S('Password (optional, min 6 chars)'), school: S('School name (super admin only)'),
      class_name: S('Class for a student, e.g. "5 A"'), roll_no: { type: 'number', description: 'Roll number 1-100 (students)' },
      phone: S('Phone'), email: S('Email'), dob: S('Date of birth YYYY-MM-DD'), gender: S('Gender'), address: S('Address'),
      designation: S('Designation, e.g. Maths Teacher (staff)'), department: S('Department (staff)'), employee_id: S('Employee id (staff)'),
      joining_date: S('Joining date YYYY-MM-DD (staff)'), salary: { type: 'number', description: 'Monthly salary in Rs (staff)' },
      admission_no: S('Admission number (students)'), father_name: S('Father name'), mother_name: S('Mother name'),
      father_phone: S('Father phone'), mother_phone: S('Mother phone'),
      children_logins: { type: 'array', items: { type: 'string' }, description: 'Login ids of the students (for a parent)' },
    }, ['full_name', 'role']),
    run: async (ctx, a) => {
      const school = a.school ? await resolveSchool(ctx, a.school) : null;
      const profile = {};
      for (const k of ['phone', 'email', 'dob', 'gender', 'address', 'designation', 'department', 'employee_id', 'joining_date', 'admission_no', 'father_name', 'mother_name', 'father_phone', 'mother_phone', 'salary', 'roll_no']) if (a[k] !== undefined && a[k] !== '') profile[k] = a[k];
      profile.full_name = a.full_name;
      if (a.class_name) profile.class_id = (await resolveClass(ctx, a.class_name, school?.id)).id;
      let children;
      if (a.children_logins?.length) children = await Promise.all(a.children_logins.map(async (l) => (await ctx.api('GET', `/users/${encodeURIComponent(l.trim())}`)).user_id));
      const password = a.password || makePassword();
      const base = String(a.login_id || '').trim().toLowerCase() || slug(a.full_name);
      let lastErr;
      for (let i = 0; i < 4; i++) {
        const login_id = i === 0 ? base : `${base}${Math.floor(10 + Math.random() * 90)}`;
        try {
          const u = await ctx.api('POST', '/users', { role: a.role, login_id, password, profile, children, ...(school ? { school_id: school.id } : {}) });
          return {
            created: true, name: u.profile?.full_name, role: u.role, login_id: u.login_id,
            ...(a.password ? {} : { generated_password: password, note: 'Password was generated: show it to the user once.' }),
            salary_saved: a.salary !== undefined ? u.profile?.salary != null : undefined,
          };
        } catch (e) { lastErr = e; if (e.status !== 409 || a.login_id) throw e; }
      }
      throw lastErr;
    },
  },
  {
    name: 'set_user_active',
    description: 'Turn a person\'s account ON or OFF (by login id). The user must confirm first.',
    features: ['edit_user'],
    confirm: true,
    parameters: obj({ login_id: S('Login id'), active: { type: 'boolean', description: 'true = on, false = off' } }, ['login_id', 'active']),
    prepare: async (ctx, a) => {
      const u = await ctx.api('GET', `/users/${encodeURIComponent(String(a.login_id).trim())}`);
      return { args: { user_id: u.user_id, active: !!a.active }, describe: `Turn ${a.active ? 'ON' : 'OFF'} the account of ${u.profile?.full_name || u.login_id} (${u.login_id})` };
    },
    run: async (ctx, a) => { const u = await ctx.api('PATCH', `/users/${a.user_id}`, { is_active: a.active }); return { done: true, login_id: u.login_id, active: u.is_active }; },
  },
];
