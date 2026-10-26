import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import crypto from 'node:crypto';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper, shapeUser, USER_SELECT } from '../auth.js';
import { ROLES, ALL_FEATURES, SUPER_ONLY, allowedForRole } from '../features.js';
import { uploadFile, deleteFile, signedUrl } from '../r2.js';
import { nextLoginId } from '../userIds.js';

const r = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOGIN_RE = /^[a-z0-9._-]{3,40}$/;
const PROFILE_FIELDS = ['full_name', 'phone', 'email', 'dob', 'gender', 'address', 'admission_no', 'class_id',
  'father_name', 'mother_name', 'father_phone', 'mother_phone', 'father_occupation', 'mother_occupation', 'extra',
  'roll_no', 'blood_group', 'emergency_contact_name', 'emergency_contact_phone',
  'employee_id', 'designation', 'department', 'qualification', 'joining_date'];
// salary is only readable/editable with manage_salary (or your own, read-only)
const fieldsFor = (req) => (req.user.features.includes('manage_salary') ? [...PROFILE_FIELDS, 'salary'] : PROFILE_FIELDS);
function profileFrom(req, src) {
  const p = pick(src || {}, fieldsFor(req));
  if (p.salary !== undefined && p.salary !== null && !(Number(p.salary) >= 0)) throw httpError(400, 'Salary must be a number');
  if (p.roll_no !== undefined && p.roll_no !== null) {
    const n = Number(p.roll_no);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw httpError(400, 'Roll no. must be a whole number from 1 to 100');
    p.roll_no = n;
  }
  return p;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined)
  .map((k) => [k, typeof o[k] === 'string' ? (o[k].trim() || null) : o[k]]));
const out = (req, row) => {
  const u = shapeUser(row);
  if (!req.user.features.includes('manage_salary') && u.user_id !== req.user.user_id) delete u.profile.salary;
  return u;
};
// uploaded documents live in a private bucket: give each one a link that works for an hour (the database keeps only the key)
const signDocs = async (u) => {
  if (Array.isArray(u?.profile?.documents)) u.profile.documents = await Promise.all(u.profile.documents.map(async (d) => ({ ...d, url: await signedUrl(d.key, { filename: d.name }) })));
  return u;
};

// attach { children: [...], parents: [...] } (brief name cards) for the "parent of" links
async function attachLinks(users, schoolId) {
  if (!users.length) return users;
  let q = db.from('parent_students').select('parent_id,student_id');
  if (users.length === 1) q = q.or(`parent_id.eq.${users[0].user_id},student_id.eq.${users[0].user_id}`);
  else if (schoolId) q = q.eq('school_id', schoolId);
  const { data: links, error } = await q;
  check(error);
  const known = new Map(users.map((u) => [u.user_id, { user_id: u.user_id, login_id: u.login_id, full_name: u.profile?.full_name || null }]));
  const missing = [...new Set(links.flatMap((l) => [l.parent_id, l.student_id]).filter((id) => !known.has(id)))];
  if (missing.length) {
    const { data, error: e2 } = await db.from('users').select('user_id,login_id,profiles(full_name)').in('user_id', missing);
    check(e2);
    data.forEach((m) => known.set(m.user_id, { user_id: m.user_id, login_id: m.login_id, full_name: (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles)?.full_name || null }));
  }
  for (const u of users) {
    u.children = links.filter((l) => l.parent_id === u.user_id).map((l) => known.get(l.student_id)).filter(Boolean);
    u.parents = links.filter((l) => l.student_id === u.user_id).map((l) => known.get(l.parent_id)).filter(Boolean);
  }
  return users;
}

// replace the set of students linked to a parent (same school, role student only)
async function setChildren(parent, ids) {
  const want = [...new Set(Array.isArray(ids) ? ids : [])];
  if (parent.role !== 'parent') throw httpError(400, 'Only parents can be linked to students');
  if (want.length) {
    const { data, error } = await db.from('users').select('user_id').in('user_id', want).eq('role', 'student').eq('school_id', parent.school_id);
    check(error);
    if (data.length !== want.length) throw httpError(400, 'Every linked user must be a student of the same school');
    check((await db.from('parent_students').upsert(want.map((student_id) => ({ parent_id: parent.user_id, student_id, school_id: parent.school_id })), { onConflict: 'parent_id,student_id' })).error);
  }
  let del = db.from('parent_students').delete().eq('parent_id', parent.user_id);
  if (want.length) del = del.not('student_id', 'in', `(${want.join(',')})`);
  check((await del).error);
}

// users can only grant features they hold themselves; super-only ones only by super admin
function grantable(req, list) {
  const held = new Set(req.user.features);
  // features meant only for other roles (e.g. view_my_fees for parents/students) can be granted by anyone allowed to change access
  const grantableByAnyone = (f) => !allowedForRole(req.user.role, f);
  return [...new Set((Array.isArray(list) ? list : []).filter((f) => ALL_FEATURES.includes(f) && (held.has(f) || grantableByAnyone(f))
    && (!SUPER_ONLY.includes(f) || isSuper(req))))];
}

// find a user by uuid or login id, inside the caller's school
async function loadTarget(req) {
  const id = req.params.id;
  const q = db.from('users').select(USER_SELECT);
  const { data, error } = await (UUID.test(id) ? q.eq('user_id', id) : q.eq('login_id', id.toLowerCase())).maybeSingle();
  check(error);
  if (!data || (!isSuper(req) && data.school_id !== req.user.school_id)) throw httpError(404, 'User not found');
  return data;
}
const reload = async (req, user_id) => {
  const { data, error } = await db.from('users').select(USER_SELECT).eq('user_id', user_id).single();
  check(error);
  return signDocs((await attachLinks([out(req, data)]))[0]);
};
const checkRole = (req, role) => {
  if (!ROLES.includes(role)) throw httpError(400, 'Unknown role');
  if (role === 'super_admin' && !isSuper(req)) throw httpError(403, 'Only a super admin can create super admins');
};
async function checkClass(school_id, class_id) {
  if (!class_id) return;
  const { data } = await db.from('classes').select('id').eq('id', class_id).eq('school_id', school_id).maybeSingle();
  if (!data) throw httpError(400, 'That class does not belong to this school');
}

// roll no. is unique inside one class: give a clear message instead of a database error
async function checkRoll(school_id, class_id, roll_no, exceptUserId) {
  if (roll_no === null || roll_no === undefined) return;
  if (!class_id) throw httpError(400, 'Choose a class before giving a roll no.');
  let q = db.from('profiles').select('user_id,full_name').eq('school_id', school_id).eq('class_id', class_id).eq('roll_no', roll_no);
  if (exceptUserId) q = q.neq('user_id', exceptUserId);
  const { data, error } = await q.limit(1);
  check(error);
  if (data.length) throw httpError(409, `Roll no. ${roll_no} is already taken in this class${data[0].full_name ? ` by ${data[0].full_name}` : ''}`);
}

// ---- get_all_users_school
r.get('/', requireFeature('get_all_users_school'), asyncH(async (req, res) => {
  let q = db.from('users').select(USER_SELECT).order('created_at', { ascending: false }).limit(2000);
  if (!isSuper(req)) q = q.eq('school_id', req.user.school_id);
  else if (req.query.school_id) q = q.eq('school_id', req.query.school_id);
  if (req.query.role) q = q.eq('role', req.query.role);
  const { data, error } = await q;
  check(error);
  res.json(await Promise.all((await attachLinks(data.map((row) => out(req, row)), isSuper(req) ? req.query.school_id : req.user.school_id)).map(signDocs)));
}));

// the signed-in parent's own students (for the future parent panel). No feature needed: it is your own data.
r.get('/my-children', asyncH(async (req, res) => {
  const { data: l, error } = await db.from('parent_students').select('student_id').eq('parent_id', req.user.user_id);
  check(error);
  if (!l.length) return res.json([]);
  const { data, error: e2 } = await db.from('users').select(USER_SELECT).in('user_id', l.map((x) => x.student_id));
  check(e2);
  res.json(await Promise.all(data.map((row) => signDocs(out(req, row)))));
}));

// lowest roll number (1-100) not yet used in the class; null when the class is full
async function nextFreeRoll(school_id, class_id) {
  const { data, error } = await db.from('profiles').select('roll_no').eq('school_id', school_id).eq('class_id', class_id).not('roll_no', 'is', null);
  check(error);
  const used = new Set(data.map((x) => x.roll_no));
  for (let n = 1; n <= 100; n += 1) if (!used.has(n)) return n;
  return null;
}

// ---- create_user
r.post('/', requireFeature('create_user'), asyncH(async (req, res) => {
  const b = req.body;
  const role = b.role || 'other';
  checkRole(req, role);
  const school_id = role === 'super_admin' ? null : (isSuper(req) ? b.school_id : req.user.school_id);
  if (role !== 'super_admin' && !school_id) throw httpError(400, 'Pick a school');
  // school users get an automatic ID (AF001, AF002...). Only a platform super admin (no school) types an ID by hand.
  const manualId = String(b.login_id || '').trim().toLowerCase();
  if (!school_id && !LOGIN_RE.test(manualId)) throw httpError(400, 'ID: 3-40 letters, numbers, . _ -');
  if (String(b.password || '').length < 6) throw httpError(400, 'Password needs at least 6 characters');
  const profile = profileFrom(req, b.profile);
  if (!profile.full_name) throw httpError(400, 'Full name is required');
  if (role === 'student' && !profile.class_id) throw httpError(400, 'Choose a class for the student');
  if (school_id) await checkClass(school_id, profile.class_id);
  if (role !== 'student') { delete profile.roll_no; } // roll numbers are for students only
  else if (school_id) {
    profile.roll_no = await nextFreeRoll(school_id, profile.class_id); // roll no. is always automatic: the next free one in the class
    await checkRoll(school_id, profile.class_id, profile.roll_no, null);
  }

  const password_hash = await bcrypt.hash(String(b.password), 10);
  let u; let login_id = manualId;
  for (let tries = 0; tries < 5; tries += 1) {
    if (school_id) login_id = await nextLoginId(school_id);     // lowest number not taken yet
    const r2 = await db.from('users').insert({ school_id, login_id, role, password_hash }).select('user_id').single();
    if (r2.error?.code === '23505' && school_id) continue;      // someone took that number a moment ago: pick the next free one
    check(r2.error);
    u = r2.data; break;
  }
  if (!u) throw httpError(409, 'Could not make a free user ID, please try again');
  const features = req.user.features.includes('change_features') ? grantable(req, b.features_permission) : [];
  const { error: e2 } = await db.from('profiles').insert({ user_id: u.user_id, school_id, ...profile, features_permission: features });
  if (e2) { await db.from('users').delete().eq('user_id', u.user_id); check(e2); }
  if (role === 'parent' && Array.isArray(b.children) && b.children.length) {
    try { await setChildren({ user_id: u.user_id, role, school_id }, b.children); }
    catch (e) { await db.from('users').delete().eq('user_id', u.user_id); throw e; }
  }
  res.status(201).json(await reload(req, u.user_id));
}));

// ---- get_user
r.get('/:id', requireFeature('get_user'), asyncH(async (req, res) => res.json(await signDocs((await attachLinks([out(req, await loadTarget(req))]))[0]))));

// ---- edit_user (profile fields + active flag)
r.patch('/:id', requireFeature('edit_user'), asyncH(async (req, res) => {
  const t = await loadTarget(req);
  const patch = profileFrom(req, req.body.profile);
  if (t.school_id) await checkClass(t.school_id, patch.class_id);
  if (t.role !== 'student') delete patch.roll_no;
  else if (t.school_id && (patch.roll_no !== undefined || patch.class_id !== undefined)) {
    const cur = (Array.isArray(t.profiles) ? t.profiles[0] : t.profiles) || {};
    const cls = patch.class_id !== undefined ? patch.class_id : cur.class_id;
    let roll = patch.roll_no !== undefined ? patch.roll_no : cur.roll_no;
    // moving to another class: the student gets the next free roll number there (roll no. is never typed by hand)
    if (cls !== cur.class_id) roll = cls ? await nextFreeRoll(t.school_id, cls) : null;
    if (roll === null || roll === undefined) roll = cls ? await nextFreeRoll(t.school_id, cls) : null;
    patch.roll_no = roll;
    await checkRoll(t.school_id, cls, roll, t.user_id);
    if (!cls) patch.roll_no = null;
  }
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const { error } = await db.from('profiles').update(patch).eq('user_id', t.user_id);
    check(error);
  }
  if (req.body.is_active !== undefined) {
    if (t.user_id === req.user.user_id) throw httpError(400, "You can't turn off your own account");
    const { error } = await db.from('users').update({ is_active: !!req.body.is_active }).eq('user_id', t.user_id);
    check(error);
  }
  res.json(await reload(req, t.user_id));
}));

// ---- parent of: replace the students linked to a parent
r.put('/:id/children', requireFeature('edit_user'), asyncH(async (req, res) => {
  const t = await loadTarget(req);
  await setChildren(t, req.body.student_ids);
  res.json(await reload(req, t.user_id));
}));

// ---- delete_user
r.delete('/:id', requireFeature('delete_user'), asyncH(async (req, res) => {
  const t = await loadTarget(req);
  if (t.user_id === req.user.user_id) throw httpError(400, "You can't delete your own account");
  const docs = (Array.isArray(t.profiles) ? t.profiles[0] : t.profiles)?.documents || [];
  await Promise.allSettled(docs.map((d) => deleteFile(d.key)));
  const { error } = await db.from('users').delete().eq('user_id', t.user_id);
  check(error);
  res.json({ ok: true });
}));

// ---- reset_pass
r.post('/:id/reset-password', requireFeature('reset_pass'), asyncH(async (req, res) => {
  const t = await loadTarget(req);
  if (String(req.body.password || '').length < 6) throw httpError(400, 'Password needs at least 6 characters');
  const { error } = await db.from('users').update({ password_hash: await bcrypt.hash(String(req.body.password), 10) }).eq('user_id', t.user_id);
  check(error);
  res.json({ ok: true });
}));

// ---- change_role
r.patch('/:id/role', requireFeature('change_role'), asyncH(async (req, res) => {
  const t = await loadTarget(req);
  checkRole(req, req.body.role);
  if (t.user_id === req.user.user_id) throw httpError(400, "You can't change your own role");
  if (req.body.role === 'super_admin' || t.role === 'super_admin') throw httpError(400, 'Super admins are managed separately');
  const { error } = await db.from('users').update({ role: req.body.role }).eq('user_id', t.user_id);
  check(error);
  res.json(await reload(req, t.user_id));
}));

// ---- change_features
r.patch('/:id/features', requireFeature('change_features'), asyncH(async (req, res) => {
  const t = await loadTarget(req);
  const features = grantable(req, req.body.features_permission);
  const { error } = await db.from('profiles').update({ features_permission: features, updated_at: new Date().toISOString() }).eq('user_id', t.user_id);
  check(error);
  res.json(await reload(req, t.user_id));
}));

// ---- upload_document (private Cloudflare R2 bucket; only the key is stored, links are signed when the user is read)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(/^(application\/pdf|image\/(png|jpe?g|webp)|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/.test(file.mimetype)
    ? null : httpError(400, 'Only PDF, image or Word files'), true),
});

r.post('/:id/documents', requireFeature('upload_document'), upload.single('file'), asyncH(async (req, res) => {
  const t = await loadTarget(req);
  if (!req.file) throw httpError(400, 'Choose a file');
  const id = crypto.randomUUID();
  const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const key = `schools/${t.school_id || 'platform'}/users/${t.user_id}/${id}-${safe}`;
  await uploadFile(key, req.file.buffer, req.file.mimetype);
  const current = (Array.isArray(t.profiles) ? t.profiles[0] : t.profiles)?.documents || [];
  const doc = { id, label: String(req.body.label || '').trim() || req.file.originalname, name: req.file.originalname, key, size: req.file.size, type: req.file.mimetype, uploaded_at: new Date().toISOString() };
  const { error } = await db.from('profiles').update({ documents: [...current, doc] }).eq('user_id', t.user_id);
  if (error) { await deleteFile(key).catch(() => {}); check(error); }
  res.status(201).json(await reload(req, t.user_id));
}));

r.delete('/:id/documents/:docId', requireFeature('upload_document'), asyncH(async (req, res) => {
  const t = await loadTarget(req);
  const current = (Array.isArray(t.profiles) ? t.profiles[0] : t.profiles)?.documents || [];
  const doc = current.find((d) => d.id === req.params.docId);
  if (!doc) throw httpError(404, 'Document not found');
  const { error } = await db.from('profiles').update({ documents: current.filter((d) => d.id !== doc.id) }).eq('user_id', t.user_id);
  check(error);
  await deleteFile(doc.key).catch(() => {});
  res.json(await reload(req, t.user_id));
}));

export default r;
