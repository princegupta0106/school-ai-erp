// Automatic user IDs: <2-letter school prefix><3-digit number>, e.g. AF001, AF002.
// The number is the lowest one that is not used yet, so an ID that exists is never handed out twice.
import { db, check, httpError } from './db.js';

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const letters = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');

// prefixes to try for a school, best first: initials of the first two words, first two letters, then the rest
function candidates(name, code) {
  const words = String(name || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const all = letters(name) || letters(code) || 'SC';
  const out = [];
  if (words.length >= 2) out.push(words[0][0] + words[1][0]);
  out.push(all.slice(0, 2).padEnd(2, 'X'));
  for (let i = 1; i < all.length; i += 1) out.push(all[0] + all[i]);
  for (const c of ABC) out.push(all[0] + c);
  for (const a of ABC) for (const b of ABC) out.push(a + b);
  return [...new Set(out)];
}

// the school's prefix; made (and saved) the first time it is needed
export async function ensurePrefix(schoolId) {
  const { data: s, error } = await db.from('schools').select('id,name,code,id_prefix').eq('id', schoolId).maybeSingle();
  check(error);
  if (!s) throw httpError(404, 'School not found');
  if (s.id_prefix) return s.id_prefix.toUpperCase();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: rows, error: e1 } = await db.from('schools').select('id_prefix').not('id_prefix', 'is', null);
    check(e1);
    const taken = new Set(rows.map((r) => r.id_prefix.toUpperCase()));
    const pick = candidates(s.name, s.code).find((c) => !taken.has(c));
    if (!pick) break;
    const { error: e2 } = await db.from('schools').update({ id_prefix: pick }).eq('id', schoolId).is('id_prefix', null);
    if (!e2) {
      const { data: again } = await db.from('schools').select('id_prefix').eq('id', schoolId).maybeSingle();
      return String(again?.id_prefix || pick).toUpperCase();
    }
    if (e2.code !== '23505') check(e2);       // 23505 = someone took it a moment ago: try again
  }
  throw httpError(500, 'Could not make a user ID prefix for this school');
}

// every number already used with this prefix (AF001 -> 1)
async function usedNumbers(prefix) {
  const p = prefix.toLowerCase();
  const re = new RegExp(`^${p}(\\d+)$`);
  const used = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('users').select('login_id').ilike('login_id', `${p}%`).order('login_id').range(from, from + 999);
    check(error);
    for (const r of data) { const m = re.exec(String(r.login_id).toLowerCase()); if (m) used.add(Number(m[1])); }
    if (data.length < 1000) break;
  }
  return used;
}

// next free ID for a school, e.g. "af001" (stored in lower case; sign-in is not case sensitive)
export async function nextLoginId(schoolId) {
  const prefix = await ensurePrefix(schoolId);
  const used = await usedNumbers(prefix);
  let n = 1;
  while (used.has(n)) n += 1;
  return `${prefix.toLowerCase()}${String(n).padStart(3, '0')}`;
}
