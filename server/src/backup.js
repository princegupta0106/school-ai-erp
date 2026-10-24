// Backup & restore of ONE school.
//
// A backup is two files, saved in the private R2 bucket under backups/<school_id>/<backup_id>/ :
//   database.json.gz  every row of the school's tables (users, fees, attendance, marks, ...) - one single file
//   files.zip         every file of the school in R2 (schools/<school_id>/...) - documents, homework, logos
//   meta.json         who / when / sizes  -> this is the "history" list
// Both files can be downloaded, and the school can be restored from them in one click (from the saved copy,
// or by uploading the two downloaded files again).
//
// Audit logs and push-notification tokens are NOT part of a backup: the audit log is a permanent record and must
// never be rolled back, and phone tokens belong to devices.
//
// Backup and restore run as background jobs (they can take minutes); the app polls status().
import fs from 'node:fs';
import zlib from 'node:zlib';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { db, httpError } from './db.js';
import { putStream, getStream, getBuffer, listWithSize, uploadFile, deleteFile } from './r2.js';

const FORMAT = 'school-erp-backup';
const CHUNK = 500;
const MAX_KEEP = 20; // newest backups kept; older ones are removed automatically

// Parents first. `via` = the table has no school_id, so it is found through its parent.
// Rows are deleted in REVERSE order and inserted in this order (foreign keys stay satisfied).
const TABLES = [
  { t: 'schools', own: 'id' },
  { t: 'classes' }, { t: 'academic_sessions' }, { t: 'users' }, { t: 'profiles' }, { t: 'parent_students' },
  { t: 'holidays' }, { t: 'class_teachers' }, { t: 'student_attendance' }, { t: 'visitors' },
  { t: 'announcements' }, { t: 'announcement_classes' },
  { t: 'conversations' }, { t: 'messages', via: { parent: 'conversations', col: 'conversation_id' } },
  { t: 'fee_items' }, { t: 'student_fee_accounts' }, { t: 'fee_adjustments' }, { t: 'fee_counters' }, { t: 'fee_payments' },
  { t: 'subjects' }, { t: 'exams' }, { t: 'assessments' }, { t: 'assessment_marks' },
  { t: 'payroll_settings' }, { t: 'leave_types' }, { t: 'leave_requests' }, { t: 'leave_ledger' },
  { t: 'payslips' }, { t: 'payroll_adjustments' }, { t: 'payroll_audit' },
  { t: 'doc_settings' }, { t: 'doc_templates' }, { t: 'doc_counters' }, { t: 'issued_documents' },
  { t: 'assignments' }, { t: 'assignment_submissions' }, { t: 'notifications' },
];

// stable paging needs an order: the key columns of tables that have no `id`
const ORDER = {
  users: ['user_id'], profiles: ['user_id'], parent_students: ['parent_id', 'student_id'], class_teachers: ['class_id', 'teacher_id'],
  fee_counters: ['school_id'], assessment_marks: ['assessment_id', 'student_id'], payroll_settings: ['school_id'],
  doc_settings: ['school_id'], doc_counters: ['doc_type', 'year'], announcement_classes: ['announcement_id', 'class_id'],
};
const ordered = (q, t) => (ORDER[t] || ['id']).reduce((acc, c) => acc.order(c), q);

const prefix = (schoolId) => `backups/${schoolId}/`;
const filesPrefix = (schoolId) => `schools/${schoolId}/`;
const ID_RE = /^\d{8}-\d{6}-[a-z0-9]{4}$/;

// ---------------------------------------------------------------- job state (one job per school at a time)
const jobs = new Map(); // schoolId -> { status: 'running'|'done'|'error', kind, step, message, startedAt, finishedAt }
export const status = (schoolId) => jobs.get(schoolId) || { status: 'idle' };
function startJob(schoolId, kind, run) {
  if (jobs.get(schoolId)?.status === 'running') throw httpError(409, 'Another backup or restore is already running for this school. Wait for it to finish.');
  const job = { status: 'running', kind, step: 'Starting...', message: '', startedAt: Date.now() };
  jobs.set(schoolId, job);
  const step = (s) => { job.step = s; };
  Promise.resolve().then(() => run(step)).then((message) => {
    Object.assign(job, { status: 'done', step: 'Finished', message: message || '', finishedAt: Date.now() });
  }).catch((e) => {
    console.error(`Backup job (${kind}) failed:`, e);
    Object.assign(job, { status: 'error', step: 'Failed', message: e.message || 'Failed', finishedAt: Date.now() });
  });
  return job;
}

// ---------------------------------------------------------------- reading / writing rows
async function readAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function exportTables(schoolId) {
  const tables = {};
  const ids = {}; // parent table -> its ids (for tables without school_id)
  for (const def of TABLES) {
    let rows;
    if (def.via) {
      const parentIds = ids[def.via.parent] || [];
      rows = [];
      for (let i = 0; i < parentIds.length; i += 100) {
        const part = parentIds.slice(i, i + 100);
        rows.push(...await readAll(() => ordered(db.from(def.t).select('*').in(def.via.col, part), def.t)));
      }
    } else {
      const col = def.own || 'school_id';
      rows = await readAll(() => ordered(db.from(def.t).select('*').eq(col, schoolId), def.t));
    }
    tables[def.t] = rows;
    if (def.t === 'conversations') ids.conversations = rows.map((r) => r.id);
  }
  return tables;
}

async function wipeSchoolRows(schoolId) {
  // the school row itself stays (deleting it would cascade into everything, incl. the audit trail)
  for (const def of [...TABLES].reverse()) {
    if (def.own || def.via) continue; // messages go with their conversation (cascade)
    const { error } = await db.from(def.t).delete().eq('school_id', schoolId);
    if (error) throw new Error(`Could not clear ${def.t}: ${error.message}`);
  }
}

async function importTables(schoolId, tables, step) {
  for (const def of TABLES) {
    const rows = tables[def.t] || [];
    if (!rows.length) continue;
    step(`Restoring database: ${def.t}`);
    if (def.own) { // the school row: update, never delete
      const { id, ...rest } = rows[0];
      const { error } = await db.from('schools').update(rest).eq('id', schoolId);
      if (error) throw new Error(`Could not restore schools: ${error.message}`);
      continue;
    }
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db.from(def.t).insert(rows.slice(i, i + CHUNK));
      if (error) throw new Error(`Could not restore ${def.t}: ${error.message}`);
    }
  }
}

// What a database file must look like before we touch anything: right format, THIS school, no foreign rows.
export function parseDatabaseFile(buf, schoolId) {
  let data;
  try { data = JSON.parse(zlib.gunzipSync(buf).toString('utf8')); }
  catch { throw httpError(400, 'This is not a valid database backup file'); }
  if (data?.format !== FORMAT || !data.tables || typeof data.tables !== 'object') throw httpError(400, 'This is not a school backup file');
  if (data.school?.id !== schoolId) throw httpError(400, 'This backup belongs to a different school and cannot be restored here');
  for (const def of TABLES) {
    const rows = data.tables[def.t];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw httpError(400, 'The backup file is damaged');
    if (def.via) continue;
    const col = def.own || 'school_id';
    if (rows.some((r) => r[col] !== schoolId)) throw httpError(400, 'The backup file holds data of another school - restore refused');
  }
  if (!(data.tables.users || []).some((u) => u.role === 'school_admin')) throw httpError(400, 'The backup has no school admin account - restore refused');
  return data;
}

// Replace the school's data with the backup. If it fails half-way, the data from just before is put back.
async function restoreDatabase(schoolId, data, step, { allowRollback = true } = {}) {
  let before = null;
  if (allowRollback) { step('Taking a safety copy of the current data...'); before = await exportTables(schoolId); }
  try {
    step('Clearing current data...');
    await wipeSchoolRows(schoolId);
    await importTables(schoolId, data.tables, step);
  } catch (e) {
    if (!before) throw e;
    try {
      step('Restore failed - putting the previous data back...');
      await wipeSchoolRows(schoolId);
      await importTables(schoolId, before, () => {});
    } catch (e2) {
      throw new Error(`Restore failed (${e.message}) and the automatic undo also failed (${e2.message}). Use the safety backup in the history to restore.`);
    }
    throw new Error(`Restore failed and nothing was changed: ${e.message}`);
  }
}

// ---------------------------------------------------------------- files
async function zipFilesInto(schoolId, out, step) {
  const files = await listWithSize(filesPrefix(schoolId));
  const archive = archiver('zip', { zlib: { level: 1 } }); // photos / pdfs are already compressed
  const failed = new Promise((_, rej) => { archive.on('error', rej); out.on('error', rej); });
  archive.pipe(out);
  const work = (async () => {
    let n = 0;
    for (const f of files) {
      const body = await getStream(f.key);
      if (!body) continue;
      step(`Zipping files (${++n} of ${files.length})...`);
      await new Promise((res, rej) => {
        archive.once('entry', res);
        body.once('error', rej);
        archive.append(body, { name: f.key });
      });
    }
    await archive.finalize();
    return { count: files.length, bytes: files.reduce((s, f) => s + f.size, 0) };
  })();
  return Promise.race([work, failed]);
}

async function restoreFilesFromZip(schoolId, zipPath, step) {
  const dir = await unzipper.Open.file(zipPath);
  const root = filesPrefix(schoolId);
  const entries = dir.files.filter((f) => f.type === 'File');
  let n = 0;
  for (const e of entries) {
    const key = e.path.replace(/\\/g, '/');
    if (key.includes('..') || !key.startsWith(root)) throw new Error('The files zip holds files of another school - restore refused');
  }
  for (const e of entries) {
    step(`Restoring files (${++n} of ${entries.length})...`);
    await putStream(e.path.replace(/\\/g, '/'), e.stream(), 'application/octet-stream');
  }
  return entries.length;
}

// ---------------------------------------------------------------- backups (history)
const newId = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
};

export async function history(schoolId) {
  const objs = await listWithSize(prefix(schoolId));
  const metas = objs.filter((o) => o.key.endsWith('/meta.json')).sort((a, b) => (a.key < b.key ? 1 : -1));
  const out = [];
  for (const m of metas) {
    try {
      const buf = await getBuffer(m.key);
      if (buf) out.push(JSON.parse(buf.toString('utf8')));
    } catch { /* skip a damaged entry */ }
  }
  return out;
}

async function getMeta(schoolId, id) {
  if (!ID_RE.test(String(id))) throw httpError(400, 'Bad backup');
  const buf = await getBuffer(`${prefix(schoolId)}${id}/meta.json`);
  if (!buf) throw httpError(404, 'Backup not found');
  return JSON.parse(buf.toString('utf8'));
}

// Make one backup (database file + files zip + meta). `withFiles:false` is used for the automatic safety copy.
async function makeBackup(schoolId, { by, kind = 'manual', withFiles = true }, step) {
  const id = newId();
  const dir = `${prefix(schoolId)}${id}/`;
  const { data: school, error } = await db.from('schools').select('id,name,code').eq('id', schoolId).single();
  if (error) throw new Error(error.message);

  step('Reading the database...');
  const tables = await exportTables(schoolId);
  const rows = Object.values(tables).reduce((s, r) => s + r.length, 0);
  const dbBuf = zlib.gzipSync(Buffer.from(JSON.stringify({ format: FORMAT, version: 1, created_at: new Date().toISOString(), school, tables })));
  step('Saving the database file...');
  await uploadFile(`${dir}database.json.gz`, dbBuf, 'application/gzip');

  let files = { count: 0, bytes: 0 }; let zipSize = 0;
  if (withFiles) {
    const pass = new PassThrough();
    let zipBytes = 0;
    pass.on('data', (c) => { zipBytes += c.length; });
    const upload = putStream(`${dir}files.zip`, pass, 'application/zip');
    try { files = await zipFilesInto(schoolId, pass, step); } catch (e) { pass.destroy(); upload.catch(() => {}); throw e; }
    await upload;
    zipSize = zipBytes;
  }

  const meta = {
    id, kind, school_code: school.code, created_at: new Date().toISOString(), created_by: by || null,
    db_size: dbBuf.length, rows, has_files: withFiles, files_size: zipSize, file_count: files.count,
  };
  await uploadFile(`${dir}meta.json`, Buffer.from(JSON.stringify(meta)), 'application/json');

  // keep only the newest MAX_KEEP
  const all = await history(schoolId);
  for (const old of all.slice(MAX_KEEP)) await removeBackup(schoolId, old.id).catch(() => {});
  return meta;
}

async function removeBackup(schoolId, id) {
  const objs = await listWithSize(`${prefix(schoolId)}${id}/`);
  for (const o of objs) await deleteFile(o.key);
}

// ---------------------------------------------------------------- public API used by the routes
export function startBackup(schoolId, by) {
  return startJob(schoolId, 'backup', async (step) => {
    const m = await makeBackup(schoolId, { by }, step);
    return `Backup saved: ${m.rows.toLocaleString('en-IN')} database rows and ${m.file_count} file(s).`;
  });
}

export async function startRestoreSaved(schoolId, id, by) {
  const meta = await getMeta(schoolId, id);
  return startJob(schoolId, 'restore', async (step) => {
    step('Checking the backup...');
    const buf = await getBuffer(`${prefix(schoolId)}${id}/database.json.gz`);
    if (!buf) throw new Error('The database file of this backup is missing');
    const data = parseDatabaseFile(buf, schoolId);
    step('Saving a safety backup of the current data...');
    await makeBackup(schoolId, { by, kind: 'before-restore', withFiles: false }, step);
    await restoreDatabase(schoolId, data, step);
    let nFiles = 0;
    if (meta.has_files) {
      step('Restoring files...');
      const tmp = `${process.env.TMPDIR || '/tmp'}/restore-${id}.zip`;
      const body = await getStream(`${prefix(schoolId)}${id}/files.zip`);
      if (body) {
        await new Promise((res, rej) => { const w = fs.createWriteStream(tmp); body.pipe(w); w.on('finish', res); w.on('error', rej); body.on('error', rej); });
        try { nFiles = await restoreFilesFromZip(schoolId, tmp, step); } finally { fs.promises.unlink(tmp).catch(() => {}); }
      }
    }
    return `Restored: ${Object.values(data.tables).reduce((s, r) => s + r.length, 0).toLocaleString('en-IN')} database rows and ${nFiles} file(s). Sign in again if the app asks you to.`;
  });
}

// from the two downloaded files; `dbPath` is required, `zipPath` optional. Temporary files are removed afterwards.
export function startRestoreUploaded(schoolId, by, dbPath, zipPath) {
  const cleanup = () => { [dbPath, zipPath].filter(Boolean).forEach((p) => fs.promises.unlink(p).catch(() => {})); };
  try {
    return startJob(schoolId, 'restore', async (step) => {
      try {
        step('Checking the backup file...');
        const data = parseDatabaseFile(await fs.promises.readFile(dbPath), schoolId);
        step('Saving a safety backup of the current data...');
        await makeBackup(schoolId, { by, kind: 'before-restore', withFiles: false }, step);
        await restoreDatabase(schoolId, data, step);
        const nFiles = zipPath ? await restoreFilesFromZip(schoolId, zipPath, step) : 0;
        return `Restored: ${Object.values(data.tables).reduce((s, r) => s + r.length, 0).toLocaleString('en-IN')} database rows and ${nFiles} file(s). Sign in again if the app asks you to.`;
      } finally { cleanup(); }
    });
  } catch (e) { cleanup(); throw e; }
}

export async function deleteBackup(schoolId, id) {
  await getMeta(schoolId, id);
  await removeBackup(schoolId, id);
}

// stream one of the two files to the response
export async function sendFile(schoolId, id, which, res) {
  const meta = await getMeta(schoolId, id);
  const isDb = which === 'database';
  if (!isDb && !meta.has_files) throw httpError(404, 'This backup has no files copy');
  const body = await getStream(`${prefix(schoolId)}${id}/${isDb ? 'database.json.gz' : 'files.zip'}`);
  if (!body) throw httpError(404, 'File not found');
  const name = `${meta.school_code || 'school'}-${isDb ? 'database' : 'files'}-${id}.${isDb ? 'json.gz' : 'zip'}`;
  res.setHeader('Content-Type', isDb ? 'application/gzip' : 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Content-Encoding', 'identity'); // never gzip a file that is already compressed
  if (isDb ? meta.db_size : meta.files_size) res.setHeader('Content-Length', isDb ? meta.db_size : meta.files_size);
  await new Promise((resolve, reject) => { body.on('error', reject); res.on('close', resolve); res.on('finish', resolve); body.pipe(res); });
}
