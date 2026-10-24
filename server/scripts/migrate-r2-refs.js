// One-off: after the bucket is made private, rewrite images that were saved as PUBLIC links into permanent "r2:<key>" references.
//   1. keep R2_PUBLIC_URL in .env (the old public address) while this runs
//   2. cd server && node scripts/migrate-r2-refs.js          (dry run: only shows what would change)
//      cd server && node scripts/migrate-r2-refs.js --apply   (writes the changes)
//   3. then switch the bucket's public access OFF in the Cloudflare dashboard (and R2_PUBLIC_URL can be removed)
// Homework attachments and user documents already store their key, so they need nothing.
import { db, check } from '../src/db.js';
import { keyOf, toStored } from '../src/r2.js';

const APPLY = process.argv.includes('--apply');
let changed = 0;
const fix = (v) => (typeof v === 'string' && keyOf(v) && toStored(v) !== v ? toStored(v) : v);

async function column(table, idCol, cols) {
  const { data, error } = await db.from(table).select([idCol, ...cols].join(','));
  check(error);
  for (const row of data) {
    const patch = {};
    for (const c of cols) { const n = fix(row[c]); if (n !== row[c]) patch[c] = n; }
    if (!Object.keys(patch).length) continue;
    changed += 1; console.log(`${table} ${row[idCol]}:`, patch);
    if (APPLY) check((await db.from(table).update(patch).eq(idCol, row[idCol])).error);
  }
}

await column('schools', 'id', ['logo_url']);
await column('doc_settings', 'school_id', ['logo_url', 'signature_url', 'seal_url']);
await column('doc_templates', 'id', ['bg_url']);

// issued documents keep a snapshot of the letterhead inside `content`
const { data: docs, error } = await db.from('issued_documents').select('id,content');
check(error);
for (const d of docs) {
  const c = d.content;
  if (!c) continue;
  const next = { ...c, bg_url: fix(c.bg_url), school: c.school ? { ...c.school, logo_url: fix(c.school.logo_url), signature_url: fix(c.school.signature_url), seal_url: fix(c.school.seal_url) } : c.school };
  if (JSON.stringify(next) === JSON.stringify(c)) continue;
  changed += 1; console.log(`issued_documents ${d.id}: images -> references`);
  if (APPLY) check((await db.from('issued_documents').update({ content: next }).eq('id', d.id)).error);
}
console.log(APPLY ? `Done: ${changed} row(s) updated.` : `Dry run: ${changed} row(s) would change. Run again with --apply.`);
process.exit(0);
