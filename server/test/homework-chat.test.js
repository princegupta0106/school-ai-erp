// Homework from the AI chat: files are staged, then copied into the homework when it is created.
// Runs the REAL homework router + homework.js + stagedFiles.js + the AI proxy against in-memory stand-ins for
// Supabase and Cloudflare R2. No network, no secrets.   Run:  cd server && node --test test/homework-chat.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.AUTH_SECRET = 'x'; process.env.SUPABASE_URL = 'http://localhost:1'; process.env.SUPABASE_SECRET_KEY = 'x';
process.env.R2_ACCOUNT_ID = 'acc'; process.env.R2_ACCESS_KEY_ID = 'k'; process.env.R2_SECRET_ACCESS_KEY = 's'; process.env.R2_BUCKET_NAME = 'bkt'; process.env.R2_PUBLIC_URL = 'https://files.test';

// ------------------------------------------------------------------ fake AI service (must exist before config.js is read)
const AI_SEEN = [];
const aiServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { AI_SEEN.push({ url: req.url, body: JSON.parse(b || '{}') }); res.setHeader('Content-Type', 'application/json'); res.end('{"reply":"ok"}'); });
});
await new Promise((r) => aiServer.listen(0, r));
process.env.AI_URL = `http://127.0.0.1:${aiServer.address().port}`;

// ------------------------------------------------------------------ fake R2 (S3 client)
const S3 = await import('@aws-sdk/client-s3');
const BUCKET = new Map(); // key -> { body, type, modified }
const FAIL_COPY_ON = new Set();
S3.S3Client.prototype.send = async function send(cmd) {
  const i = cmd.input;
  if (cmd instanceof S3.PutObjectCommand) { BUCKET.set(i.Key, { body: i.Body, type: i.ContentType, modified: new Date() }); return {}; }
  if (cmd instanceof S3.DeleteObjectCommand) { BUCKET.delete(i.Key); return {}; }
  if (cmd instanceof S3.HeadObjectCommand) {
    const o = BUCKET.get(i.Key);
    if (!o) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    return { ContentLength: o.body.length, ContentType: o.type, LastModified: o.modified };
  }
  if (cmd instanceof S3.CopyObjectCommand) {
    if (FAIL_COPY_ON.has(i.Key)) throw new Error('R2 is down');
    const from = decodeURIComponent(i.CopySource.slice(`${i.Bucket}/`.length));
    const o = BUCKET.get(from);
    if (!o) throw new Error('NoSuchKey');
    BUCKET.set(i.Key, { ...o, modified: new Date() });
    return {};
  }
  if (cmd instanceof S3.ListObjectsV2Command) return { Contents: [...BUCKET].filter(([k]) => k.startsWith(i.Prefix)).map(([Key, o]) => ({ Key, LastModified: o.modified })), IsTruncated: false };
  throw new Error(`unexpected R2 command ${cmd.constructor.name}`);
};

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: homeworkRoutes } = await import('../src/routes/homework.js');
const { default: aiRoutes } = await import('../src/routes/ai.js');
const { sweepStaging } = await import('../src/homework.js');
const { parseStagedRef, sweepStaged, STAGE_TTL_MS } = await import('../src/stagedFiles.js');

// ------------------------------------------------------------------ fake data
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1);
const C5A = id(71), C5B = id(72);
const DB = {
  classes: [{ id: C5A, school_id: S1, name: '5', section: 'A', level: 5 }, { id: C5B, school_id: S1, name: '5', section: 'B', level: 5 }],
  class_teachers: [{ class_id: C5A, teacher_id: id(34), school_id: S1, is_class_teacher: true, classes: { id: C5A, name: '5', section: 'A', level: 5 } }],
  assignments: [], assignment_submissions: [], profiles: [], users: [], parent_students: [], notifications: [], push_tokens: [],
};
const get = (r, k) => k.split('.').reduce((o, p) => (Array.isArray(o) ? o[0]?.[p] : o?.[p]), r);
class Q {
  constructor(name) { this.name = name; this.f = []; this.op = 'select'; this.rows = null; }
  select() { return this; }
  eq(k, v) { this.f.push((r) => get(r, k) === v); return this; }
  neq(k, v) { this.f.push((r) => get(r, k) !== v); return this; }
  in(k, a) { this.f.push((r) => a.includes(get(r, k))); return this; }
  order() { return this; }
  range() { return this; }
  limit() { return this; }
  insert(o) { this.op = 'insert'; this.rows = Array.isArray(o) ? o : [o]; return this; }
  delete() { this.op = 'delete'; return this; }
  _run() {
    const t = (DB[this.name] ||= []);
    if (this.op === 'insert') { t.push(...this.rows); return this.rows; }
    const out = t.filter((r) => this.f.every((fn) => fn(r)));
    if (this.op === 'delete') { DB[this.name] = t.filter((r) => !out.includes(r)); return out; }
    return out;
  }
  maybeSingle() { return Promise.resolve({ data: this._run()[0] ?? null, error: null }); }
  then(res, rej) { try { const data = this._run(); return Promise.resolve({ data, error: null }).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
}
db.from = (name) => new Q(name);

// ------------------------------------------------------------------ the app: real routers behind a stub sign-in
const HW = ['manage_homework', 'use_assistant'];
const USERS = {
  teacher: { user_id: id(34), role: 'staff', school_id: S1, login_id: 't', features: HW },
  other: { user_id: id(35), role: 'staff', school_id: S1, login_id: 'o', features: HW },
  noaccess: { user_id: id(36), role: 'staff', school_id: S1, login_id: 'n', features: ['use_assistant'] },
  admin: { user_id: id(90), role: 'school_admin', school_id: S1, login_id: 'boss', features: [...HW, 'attendance_all_classes'] },
  super: { user_id: id(91), role: 'super_admin', school_id: null, login_id: 'root', features: [...HW, 'attendance_all_classes'] },
};
let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { const u = USERS[(req.headers.authorization || '').replace('Bearer ', '')]; if (!u) return res.status(401).json({ error: 'Please sign in' }); req.user = u; next(); });
  app.use('/api/homework', homeworkRoutes);
  app.use('/api/ai', aiRoutes);
  app.use((err, req, res, next) => res.status(err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500)).json({ error: err.message })); // eslint-disable-line no-unused-vars
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); aiServer.close(); });

const json = (who, p, body, method = 'POST') => fetch(base + p, { method, headers: { Authorization: `Bearer ${who}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const upload = (who, p, files, fields = {}) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  files.forEach(([name, text, type = 'application/pdf']) => fd.append('files', new Blob([text], { type }), name));
  return fetch(base + p, { method: 'POST', headers: { Authorization: `Bearer ${who}` }, body: fd });
};
const stage = async (who, files) => (await (await upload(who, '/homework/chat-files', files)).json()).files;
const keysUnder = (prefix) => [...BUCKET.keys()].filter((k) => k.startsWith(prefix));
const reset = () => { BUCKET.clear(); DB.assignments.length = 0; FAIL_COPY_ON.clear(); AI_SEEN.length = 0; };

// ------------------------------------------------------------------ tests
test('attaching files in the chat stages them under the teacher\'s own temporary folder', async () => {
  reset();
  const r = await upload('teacher', '/homework/chat-files', [['Chapter 3 notes.pdf', 'AAAA'], ['sheet.png', 'BBBBBB', 'image/png']]);
  assert.equal(r.status, 201);
  const { files } = await r.json();
  assert.equal(files.length, 2);
  assert.deepEqual(files.map((f) => f.name), ['Chapter 3 notes.pdf', 'sheet.png']);
  assert.deepEqual(files.map((f) => f.size), [4, 6]);
  for (const f of files) {
    assert.ok(f.key.startsWith(`staging/homework/${id(34)}/`), f.key);
    assert.ok(BUCKET.has(f.key));
    assert.ok(parseStagedRef(id(34), f), 'the portal accepts its own refs back');
  }
  assert.match(files[0].key, /Chapter_3_notes\.pdf$/, 'unsafe characters in the name are replaced');
  assert.equal(DB.assignments.length, 0, 'nothing is posted yet');
});

test('staging is for people who can post homework, and only safe files', async () => {
  reset();
  assert.equal((await upload('noaccess', '/homework/chat-files', [['a.pdf', 'x']])).status, 403);
  assert.equal((await upload('teacher', '/homework/chat-files', [['a.exe', 'x', 'application/x-msdownload']])).status, 400);
  assert.equal((await upload('teacher', '/homework/chat-files', [])).status, 400);
  assert.equal((await upload('teacher', '/homework/chat-files', Array.from({ length: 6 }, (_, i) => [`f${i}.pdf`, 'x']))).status, 400);
  assert.equal(BUCKET.size, 0);
});

test('confirming: staged files are COPIED into the homework, notified, and the staged copies stay for a second class', async () => {
  reset();
  const staged = await stage('admin', [['Worksheet 4.pdf', 'WORKSHEET'], ['answers.txt', 'KEY', 'text/plain']]);
  const body = { class_id: C5A, title: 'Worksheet 4', subject: 'Maths', description: 'Do all questions', due_date: '2026-10-23', needs_submission: true, staged_files: staged.map(({ id: i, key, name }) => ({ id: i, key, name })) };
  const r = await json('admin', '/homework/assignments', body);
  assert.equal(r.status, 201);
  const made = await r.json();
  assert.equal(made.files, 2);
  const row = DB.assignments.find((a) => a.id === made.id);
  assert.equal(row.title, 'Worksheet 4'); assert.equal(row.class_id, C5A); assert.equal(row.needs_submission, true); assert.equal(row.due_date, '2026-10-23'); assert.equal(row.created_by, id(90));
  assert.equal(row.attachments.length, 2);
  for (const a of row.attachments) {
    assert.ok(a.key.startsWith(`schools/${S1}/homework/${made.id}/`), a.key);
    assert.equal(a.url, `https://files.test/${a.key}`);
    assert.ok(BUCKET.has(a.key), 'the copy exists');
  }
  assert.deepEqual(row.attachments.map((a) => [a.name, a.size, a.type]), [['Worksheet 4.pdf', 9, 'application/pdf'], ['answers.txt', 3, 'text/plain']]);
  assert.equal(BUCKET.get(row.attachments[0].key).body.toString(), 'WORKSHEET');
  assert.equal(keysUnder('staging/').length, 2, 'staged files are left for the sweep, so the same file can go to another class');
  // the same files to a second class -> an independent copy
  const r2 = await json('admin', '/homework/assignments', { ...body, class_id: C5B });
  assert.equal(r2.status, 201);
  const made2 = await r2.json();
  const row2 = DB.assignments.find((a) => a.id === made2.id);
  assert.notEqual(row2.attachments[0].key, row.attachments[0].key);
  // deleting one homework must not break the other one
  assert.equal((await json('admin', `/homework/assignments/${made.id}`, undefined, 'DELETE')).status, 200);
  assert.ok(!BUCKET.has(row.attachments[0].key), 'the deleted homework\'s files are gone');
  assert.ok(BUCKET.has(row2.attachments[0].key), 'the other homework still has its files');
});

test('staged files alone are enough (no instructions), and uploaded + staged files together are capped at 5', async () => {
  reset();
  const staged = await stage('teacher', [['a.pdf', 'a']]);
  const ok = await json('teacher', '/homework/assignments', { class_id: C5A, title: 'Read this', staged_files: staged });
  assert.equal(ok.status, 201);
  assert.equal((await json('teacher', '/homework/assignments', { class_id: C5A, title: 'Nothing attached' })).status, 400);
  const six = await stage('teacher', Array.from({ length: 5 }, (_, i) => [`f${i}.pdf`, 'x']));
  const tooMany = await json('teacher', '/homework/assignments', { class_id: C5A, title: 'Too many', staged_files: [...six, ...staged] });
  assert.equal(tooMany.status, 400);
  assert.equal(DB.assignments.length, 1);
});

test('the normal web / phone form (multipart upload) still works exactly as before', async () => {
  reset();
  const r = await upload('teacher', '/homework/assignments', [['direct.pdf', 'DIRECT']], { class_id: C5A, title: 'Form homework', needs_submission: 'true', description: 'x' });
  assert.equal(r.status, 201);
  assert.equal(DB.assignments.length, 1);
  assert.equal(DB.assignments[0].attachments.length, 1);
  assert.ok(BUCKET.has(DB.assignments[0].attachments[0].key));
  assert.equal(keysUnder('staging/').length, 0);
});

test('nobody can attach someone else\'s staged file, or an invented key', async () => {
  reset();
  const theirs = await stage('other', [['secret.pdf', 'SECRET']]);
  const before = BUCKET.size;
  const stolen = await json('teacher', '/homework/assignments', { class_id: C5A, title: 'Stolen', staged_files: theirs });
  assert.equal(stolen.status, 400);
  for (const key of ['schools/x/homework/other.pdf', `staging/homework/${id(34)}/../${id(35)}/x`, `staging/homework/${id(34)}/not-a-uuid-file.pdf`, `staging/homework/${id(34)}/${id(5)}-a/b.pdf`, 123, null]) {
    const r = await json('teacher', '/homework/assignments', { class_id: C5A, title: 'Bad', staged_files: [{ key, name: 'x' }] });
    assert.equal(r.status, 400, String(key));
  }
  assert.equal(DB.assignments.length, 0);
  assert.equal(BUCKET.size, before, 'nothing was copied');
});

test('a class the teacher does not take is refused BEFORE any file is copied', async () => {
  reset();
  const staged = await stage('teacher', [['a.pdf', 'a']]);
  const r = await json('teacher', '/homework/assignments', { class_id: C5B, title: 'Wrong class', staged_files: staged });
  assert.equal(r.status, 403);
  assert.equal(keysUnder('schools/').length, 0);
  assert.equal(DB.assignments.length, 0);
});

test('an expired file, or a failed copy, leaves nothing half-made behind', async () => {
  reset();
  const staged = await stage('teacher', [['one.pdf', '1'], ['two.pdf', '2']]);
  BUCKET.delete(staged[1].key);                                    // the 2nd one was swept away
  const r = await json('teacher', '/homework/assignments', { class_id: C5A, title: 'Expired', staged_files: staged });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /expired.*Attach it again/i);
  assert.equal(keysUnder('schools/').length, 0, 'the first file\'s copy was removed again');
  assert.equal(DB.assignments.length, 0);

  const again = await stage('teacher', [['one.pdf', '1'], ['two.pdf', '2']]);
  const orig = S3.S3Client.prototype.send;
  S3.S3Client.prototype.send = async function (cmd) { if (cmd instanceof S3.CopyObjectCommand && /two\.pdf$/.test(cmd.input.Key)) throw new Error('R2 is down'); return orig.call(this, cmd); };
  try {
    const r2 = await json('teacher', '/homework/assignments', { class_id: C5A, title: 'Broken', staged_files: again });
    assert.equal(r2.status, 500);
  } finally { S3.S3Client.prototype.send = orig; }
  assert.equal(keysUnder('schools/').length, 0, 'no orphan copy');
  assert.equal(DB.assignments.length, 0);
});

test('meta: the school\'s today and the classes this person may post to', async () => {
  const t = await (await json('teacher', '/homework/meta', undefined, 'GET')).json();
  assert.match(t.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(t.classes.map((c) => c.id), [C5A]);
  const a = await (await json('admin', '/homework/meta', undefined, 'GET')).json();
  assert.deepEqual(a.classes.map((c) => c.id).sort(), [C5A, C5B].sort());
  assert.equal((await json('noaccess', '/homework/meta', undefined, 'GET')).status, 403);
});

test('AI proxy forwards only the signed-in person\'s own staged files', async () => {
  reset();
  const mine = await stage('teacher', [['mine.pdf', 'm']]);
  const theirs = await stage('other', [['theirs.pdf', 't']]);
  const r = await json('teacher', '/ai/chat', { message: 'hw for 5 A', attachments: [...mine, ...theirs, { key: 'schools/a/b.pdf' }, 'junk', null] });
  assert.equal(r.status, 200);
  const seen = AI_SEEN.at(-1);
  assert.equal(seen.url, '/api/chat');
  assert.deepEqual(seen.body.attachments.map((a) => a.key), [mine[0].key]);
  assert.deepEqual(Object.keys(seen.body.attachments[0]).sort(), ['id', 'key', 'name', 'size', 'type']);
  assert.equal(seen.body.message, 'hw for 5 A');
  // no attachments / wrong shape -> an empty list, never a crash
  await json('teacher', '/ai/chat', { message: 'hi', attachments: 'x' });
  assert.deepEqual(AI_SEEN.at(-1).body.attachments, []);
  await json('teacher', '/ai/confirm', { action_id: 'a', attachments: mine });
  assert.equal(AI_SEEN.at(-1).url, '/api/confirm');
});

test('cleanup removes chat files older than a day and nothing else', async () => {
  reset();
  const old = new Date(Date.now() - STAGE_TTL_MS - 60_000), fresh = new Date();
  BUCKET.set(`staging/homework/${id(34)}/${id(1)}-old.pdf`, { body: 'x', type: 'application/pdf', modified: old });
  BUCKET.set(`staging/homework/${id(34)}/${id(2)}-new.pdf`, { body: 'x', type: 'application/pdf', modified: fresh });
  BUCKET.set(`schools/${S1}/homework/h1/${id(3)}-keep.pdf`, { body: 'x', type: 'application/pdf', modified: old });
  assert.equal(await sweepStaging(), 1);
  assert.deepEqual([...BUCKET.keys()].sort(), [`schools/${S1}/homework/h1/${id(3)}-keep.pdf`, `staging/homework/${id(34)}/${id(2)}-new.pdf`].sort());
  // one failed delete does not stop the others
  const calls = [];
  const n = await sweepStaged({ listFiles: async () => [{ key: 'a', modified: old }, { key: 'b', modified: old }, { key: 'c', modified: fresh }], deleteFile: async (k) => { calls.push(k); if (k === 'a') throw new Error('x'); } });
  assert.deepEqual(calls, ['a', 'b']); assert.equal(n, 1);
});
