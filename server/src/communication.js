// Communication functions: notice board (announcements) and 1-to-1 messages.
// Routes (routes/communication.js) only check the feature and call these.
//
//   listAnnouncements / createAnnouncement / updateAnnouncement / deleteAnnouncement
//   postableClasses(user, schoolId)            classes this person may post notices to
//   searchContacts(user, schoolId, q)          people this person may start a chat with
//   startConversation(user, schoolId, otherId) open (or create) the chat with one person
//   listConversations / getMessages / sendMessage
import { db, httpError, check } from './db.js';
import { accessibleClasses, hasAllClasses } from './attendance.js';
import { notifyNotice, notifyMessage } from './notify.js';

const one = (x) => (Array.isArray(x) ? x[0] : x);
const nameOf = (p, loginId) => p?.full_name || loginId || 'Unknown';
const has = (user, f) => user.features.includes(f);
const chunks = (arr, n = 100) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const clean = (q) => String(q || '').replace(/[%,()*\\]/g, ' ').trim().slice(0, 60);

async function fetchAll(make) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    check(error);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// ================================================================= notice board
// classes whose notices this person gets (students: own class, parents: their children's, staff: assigned)
async function myClassIds(user) {
  if (user.role === 'student') return user.profile?.class_id ? [user.profile.class_id] : [];
  if (user.role === 'parent') {
    const { data: l, error } = await db.from('parent_students').select('student_id').eq('parent_id', user.user_id);
    check(error);
    if (!l.length) return [];
    const { data, error: e2 } = await db.from('profiles').select('class_id').in('user_id', l.map((x) => x.student_id));
    check(e2);
    return [...new Set(data.map((x) => x.class_id).filter(Boolean))];
  }
  const { data, error } = await db.from('class_teachers').select('class_id').eq('teacher_id', user.user_id);
  check(error);
  return data.map((x) => x.class_id);
}

export async function listAnnouncements(user, schoolId, { before, limit = 20 } = {}) {
  const args = { p_school: schoolId, p_user: user.user_id, p_class_ids: await myClassIds(user), p_all: has(user, 'manage_announcements') || hasAllClasses(user) };
  const call = async (pinned, bef, lim) => { const { data, error } = await db.rpc('list_announcements', { ...args, p_pinned: pinned, p_before: bef || null, p_limit: lim }); check(error); return data; };
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const [pinned, items] = await Promise.all([before ? [] : call(true, null, 100), call(false, before, lim + 1)]);
  const mark = (a) => ({ ...a, can_edit: a.created_by === user.user_id || has(user, 'manage_announcements') });
  return { pinned: pinned.map(mark), items: items.slice(0, lim).map(mark), more: items.length > lim };
}

export async function postableClasses(user, schoolId) {
  return has(user, 'post_announcement') ? accessibleClasses(user, schoolId) : [];
}

export async function createAnnouncement(user, schoolId, b) {
  const title = String(b.title || '').trim(); const body = String(b.body || '').trim();
  if (!title) throw httpError(400, 'Title is required');
  if (title.length > 150) throw httpError(400, 'Title is too long (150 characters max)');
  if (!body) throw httpError(400, 'Write the notice');
  if (body.length > 5000) throw httpError(400, 'Notice is too long (5000 characters max)');
  const audience = b.audience === 'class' ? 'class' : 'school';
  let classIds = [];
  if (audience === 'school') {
    if (!has(user, 'post_school_announcement')) throw httpError(403, "You can't post to the whole school");
  } else {
    if (!has(user, 'post_announcement')) throw httpError(403, "You can't post class notices");
    classIds = [...new Set(Array.isArray(b.class_ids) ? b.class_ids : [])];
    if (!classIds.length) throw httpError(400, 'Choose at least one class');
    const ok = new Set((await accessibleClasses(user, schoolId)).map((c) => c.id));
    if (classIds.some((id) => !ok.has(id))) throw httpError(403, 'You can only post to your own classes');
  }
  const { data, error } = await db.from('announcements').insert({ school_id: schoolId, title, body, audience, is_pinned: !!b.is_pinned, created_by: user.user_id }).select('id').single();
  check(error);
  if (classIds.length) {
    const { error: e2 } = await db.from('announcement_classes').insert(classIds.map((class_id) => ({ announcement_id: data.id, class_id, school_id: schoolId })));
    if (e2) { await db.from('announcements').delete().eq('id', data.id); check(e2); }
  }
  notifyNotice(schoolId, user, { title, body, audience, classIds });
  return { id: data.id };
}

async function ownOrManage(user, schoolId, id) {
  const { data, error } = await db.from('announcements').select('id,created_by').eq('id', id).eq('school_id', schoolId).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Notice not found');
  if (data.created_by !== user.user_id && !has(user, 'manage_announcements')) throw httpError(403, 'You can only change your own notices');
  return data;
}
export async function updateAnnouncement(user, schoolId, id, b) {
  await ownOrManage(user, schoolId, id);
  const patch = { updated_at: new Date().toISOString() };
  if (b.title !== undefined) { patch.title = String(b.title).trim(); if (!patch.title || patch.title.length > 150) throw httpError(400, 'Title is required (150 characters max)'); }
  if (b.body !== undefined) { patch.body = String(b.body).trim(); if (!patch.body || patch.body.length > 5000) throw httpError(400, 'Notice text is required (5000 characters max)'); }
  if (b.is_pinned !== undefined) patch.is_pinned = !!b.is_pinned;
  check((await db.from('announcements').update(patch).eq('id', id)).error);
}
export async function deleteAnnouncement(user, schoolId, id) {
  await ownOrManage(user, schoolId, id);
  check((await db.from('announcements').delete().eq('id', id)).error);
}

// ================================================================= 1-to-1 messages
// Who may start a chat with whom:
//  - school admins and people with "message_anyone": everyone in the school
//  - teachers/staff: admins, other staff, and the students + parents of their classes
//  - parents: admins and the teachers of their children's classes
//  - students: admins and the teachers of their own class
async function allowedContacts(user, schoolId) {
  if (user.role === 'school_admin' || has(user, 'message_anyone')) return { anyone: true };
  const ids = new Set();
  const addUsers = async (roles) => {
    const rows = await fetchAll(() => db.from('users').select('user_id').eq('school_id', schoolId).eq('is_active', true).in('role', roles).order('user_id'));
    rows.forEach((r) => ids.add(r.user_id));
  };
  await addUsers(['school_admin']);
  if (user.role === 'parent' || user.role === 'student') {
    const classIds = await myClassIds(user);
    if (classIds.length) {
      const { data, error } = await db.from('class_teachers').select('teacher_id').in('class_id', classIds);
      check(error);
      data.forEach((t) => ids.add(t.teacher_id));
    }
  } else {
    await addUsers(['staff', 'other']);
    const classes = await accessibleClasses(user, schoolId);
    if (classes.length) {
      const studs = await fetchAll(() => db.from('profiles').select('user_id,users!inner(is_active,role)').eq('school_id', schoolId).in('class_id', classes.map((c) => c.id)).eq('users.role', 'student').eq('users.is_active', true).order('user_id'));
      studs.forEach((s) => ids.add(s.user_id));
      const parents = (await Promise.all(chunks(studs.map((s) => s.user_id)).map((c) => db.from('parent_students').select('parent_id').in('student_id', c)))).flatMap((r) => { check(r.error); return r.data; });
      parents.forEach((p) => ids.add(p.parent_id));
    }
  }
  ids.delete(user.user_id);
  return { anyone: false, ids };
}

const USER_BRIEF = 'user_id,login_id,role,is_active,school_id,profiles(full_name,designation)';
async function briefs(ids) {
  const out = await Promise.all(chunks([...new Set(ids)]).map((c) => db.from('users').select(USER_BRIEF).in('user_id', c)));
  return out.flatMap((r) => { check(r.error); return r.data; });
}
const ROLE_NAME = { school_admin: 'School admin', staff: 'Staff', parent: 'Parent', student: 'Student', other: 'Staff', super_admin: 'Admin' };
// "Parent of Rahul (5 A)" for parents, designation for staff
async function labelFor(rows) {
  const parents = rows.filter((u) => u.role === 'parent').map((u) => u.user_id);
  const kids = new Map();
  if (parents.length) {
    const links = (await Promise.all(chunks(parents).map((c) => db.from('parent_students').select('parent_id,student_id').in('parent_id', c)))).flatMap((r) => { check(r.error); return r.data; });
    const studs = links.length ? await Promise.all(chunks([...new Set(links.map((l) => l.student_id))]).map((c) => db.from('profiles').select('user_id,full_name,classes(name,section)').in('user_id', c))) : [];
    const sm = new Map(studs.flatMap((r) => { check(r.error); return r.data; }).map((s) => [s.user_id, s]));
    for (const l of links) {
      const s = sm.get(l.student_id); if (!s) continue;
      const c = one(s.classes);
      const t = `${s.full_name || 'Student'}${c ? ` (${c.name}${c.section ? ` ${c.section}` : ''})` : ''}`;
      kids.set(l.parent_id, [...(kids.get(l.parent_id) || []), t]);
    }
  }
  return new Map(rows.map((u) => [u.user_id, {
    user_id: u.user_id, name: nameOf(one(u.profiles), u.login_id), login_id: u.login_id, role: u.role,
    label: u.role === 'parent' ? (kids.get(u.user_id) ? `Parent of ${kids.get(u.user_id).join(', ')}` : 'Parent') : (one(u.profiles)?.designation || ROLE_NAME[u.role] || u.role),
  }]));
}

export async function searchContacts(user, schoolId, q) {
  const needle = clean(q).toLowerCase();
  const access = await allowedContacts(user, schoolId);
  let rows;
  if (access.anyone) {
    // candidates by name (profiles) and by login id
    const byName = db.from('profiles').select('user_id').eq('school_id', schoolId).neq('user_id', user.user_id).limit(60);
    const byLogin = db.from('users').select('user_id').eq('school_id', schoolId).eq('is_active', true).neq('user_id', user.user_id).limit(60);
    const [a, b] = await Promise.all([needle ? byName.ilike('full_name', `%${needle}%`) : byName, needle ? byLogin.ilike('login_id', `%${needle}%`) : byLogin.order('login_id')]);
    check(a.error); check(b.error);
    rows = await briefs([...b.data, ...a.data].map((x) => x.user_id));
    // a parent may be found through the child's name
    if (needle) {
      const kid = await db.from('profiles').select('user_id').eq('school_id', schoolId).ilike('full_name', `%${needle}%`).limit(40);
      check(kid.error);
      if (kid.data.length) {
        const l = await db.from('parent_students').select('parent_id').in('student_id', kid.data.map((k) => k.user_id)).limit(60);
        check(l.error);
        rows = [...rows, ...(await briefs(l.data.map((x) => x.parent_id)))];
      }
    }
  } else {
    rows = await briefs([...access.ids]);
  }
  rows = [...new Map(rows.filter((u) => u.is_active && u.school_id === schoolId && u.user_id !== user.user_id && u.role !== 'super_admin').map((u) => [u.user_id, u])).values()];
  const labels = await labelFor(rows);
  return [...labels.values()]
    .filter((c) => !needle || `${c.name} ${c.login_id} ${c.label}`.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
}

const pair = (a, b) => [a, b].sort();

export async function startConversation(user, schoolId, otherId) {
  if (!otherId || otherId === user.user_id) throw httpError(400, 'Choose who to message');
  const { data: o, error } = await db.from('users').select(USER_BRIEF).eq('user_id', otherId).maybeSingle();
  check(error);
  if (!o || o.school_id !== schoolId || !o.is_active) throw httpError(404, 'Person not found');
  const [a, b] = pair(user.user_id, otherId);
  const find = () => db.from('conversations').select('id').eq('user_a', a).eq('user_b', b).maybeSingle();
  let { data: ex } = await find();
  if (!ex) {
    const access = await allowedContacts(user, schoolId);
    if (!access.anyone && !access.ids.has(otherId)) throw httpError(403, "You can't start a chat with this person");
    const ins = await db.from('conversations').insert({ school_id: schoolId, user_a: a, user_b: b }).select('id').single();
    if (ins.error && ins.error.code === '23505') ex = (await find()).data; else { check(ins.error); ex = ins.data; }
  }
  return { id: ex.id, other: (await labelFor([o])).get(otherId) };
}

export async function listConversations(user, schoolId) {
  const { data, error } = await db.from('conversations').select('id,user_a,user_b,a_unread,b_unread,last_message_at,last_preview,last_sender')
    .eq('school_id', schoolId).or(`user_a.eq.${user.user_id},user_b.eq.${user.user_id}`).not('last_message_at', 'is', null)
    .order('last_message_at', { ascending: false }).limit(100);
  check(error);
  const otherIds = data.map((c) => (c.user_a === user.user_id ? c.user_b : c.user_a));
  const people = otherIds.length ? await labelFor(await briefs(otherIds)) : new Map();
  return data.map((c) => {
    const mineA = c.user_a === user.user_id;
    return { id: c.id, other: people.get(mineA ? c.user_b : c.user_a) || { name: 'Deleted user', label: '' }, unread: mineA ? c.a_unread : c.b_unread,
      last_message_at: c.last_message_at, last_preview: c.last_preview, last_mine: c.last_sender === user.user_id };
  });
}

async function myConversation(user, id) {
  const { data, error } = await db.from('conversations').select('id,user_a,user_b').eq('id', id).maybeSingle();
  check(error);
  if (!data || ![data.user_a, data.user_b].includes(user.user_id)) throw httpError(404, 'Chat not found');
  return data;
}

// latest 40 (or 40 older than `before`, or everything newer than `after` for polling), oldest first
export async function getMessages(user, id, { before, after } = {}) {
  const c = await myConversation(user, id);
  let q = db.from('messages').select('id,sender_id,body,created_at').eq('conversation_id', id);
  if (after) q = q.gt('created_at', after).order('created_at', { ascending: true }).limit(100);
  else { if (before) q = q.lt('created_at', before); q = q.order('created_at', { ascending: false }).limit(41); }
  const { data, error } = await q;
  check(error);
  let rows = data; let more = false;
  if (!after) { more = rows.length > 40; rows = rows.slice(0, 40).reverse(); }
  if (!before) check((await db.rpc('mark_conversation_read', { p_conv: c.id, p_user: user.user_id })).error);
  return { messages: rows.map((m) => ({ ...m, mine: m.sender_id === user.user_id })), more };
}

export async function sendMessage(user, id, body) {
  const text = String(body || '').trim();
  if (!text) throw httpError(400, 'Write a message');
  if (text.length > 2000) throw httpError(400, 'Message is too long (2000 characters max)');
  const conv = await myConversation(user, id);
  const { data, error } = await db.rpc('send_message', { p_conv: id, p_sender: user.user_id, p_body: text });
  check(error);
  notifyMessage(user.school_id, user, conv.user_a === user.user_id ? conv.user_b : conv.user_a, text);
  return { ...data, mine: true };
}
