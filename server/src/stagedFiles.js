// Files a teacher attaches in the AI chat are first kept in a temporary "staging" folder of the R2 bucket:
//     staging/homework/<user id>/<file id>-<safe name>
// When the teacher confirms the homework, each staged file is COPIED into the homework's own folder
// (schools/<school>/homework/<homework id>/...). Staged files nobody confirmed are swept away after STAGE_TTL_MS.
// This file has no imports on purpose (pure rules, easy to test); the R2 calls are passed in.
export const STAGE_ROOT = 'staging/homework';
export const STAGE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_FILES = 5;

export const stagePrefix = (userId) => `${STAGE_ROOT}/${userId}/`;
export const safeName = (name) => String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What the browser / phone / AI may send back about a staged file. Anything not in the signed-in teacher's own
// staging folder is refused, so nobody can attach (or copy) someone else's file by guessing a key.
export function parseStagedRef(userId, ref) {
  const key = String(ref?.key ?? '');
  const prefix = stagePrefix(userId);
  if (!key.startsWith(prefix) || key.includes('..')) return null;
  const rest = key.slice(prefix.length);                         // <uuid>-<safe name>
  const id = rest.slice(0, 36);
  if (!UUID.test(id) || rest[36] !== '-' || rest.length < 38 || rest.includes('/')) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(rest.slice(37))) return null;
  return { id, key, name: String(ref?.name || rest.slice(37)).slice(0, 200) };
}

// Validate a list of refs and turn them into attachments of homework `folder`. r2 = { headFile, copyFile }.
// Returns [{ id, name, key, size, type }] (no link is stored: the bucket is private, links are signed when the file is shown); `copied` collects what was written so the caller can undo it on failure.
export async function copyStaged(userId, refs, folder, r2, copied = []) {
  if (!Array.isArray(refs)) return [];
  if (refs.length > MAX_FILES) throw Object.assign(new Error('You can attach up to 5 files'), { status: 400 });
  const out = [];
  const seen = new Set();
  for (const ref of refs) {
    const p = parseStagedRef(userId, ref);
    if (!p) throw Object.assign(new Error('One of the attached files is not valid. Attach it again.'), { status: 400 });
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const head = await r2.headFile(p.key);
    if (!head) throw Object.assign(new Error(`"${p.name}" has expired. Attach it again.`), { status: 400 });
    const id = globalThis.crypto.randomUUID();
    const key = `${folder}/${id}-${safeName(p.name)}`;
    await r2.copyFile(p.key, key);
    copied.push({ key });
    out.push({ id, name: p.name, key, size: head.size, type: head.type });
  }
  return out;
}

// delete staged files older than STAGE_TTL_MS. r2 = { listFiles, deleteFile }. Returns how many were removed.
export async function sweepStaged(r2, now = Date.now()) {
  const old = (await r2.listFiles(`${STAGE_ROOT}/`)).filter((f) => f.modified && now - new Date(f.modified).getTime() > STAGE_TTL_MS);
  const done = await Promise.allSettled(old.map((f) => r2.deleteFile(f.key)));
  return done.filter((d) => d.status === 'fulfilled').length;
}
