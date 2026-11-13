// Design adoption report. Run from the project root:   node tools/design-audit.mjs
// Shows, per module, how much it still hand-rolls instead of using the design system. Re-run after each migration wave.
// Goal for a migrated module: inline styles ~0, hex colours 0, row-sp headers 0, uses Page + PageBar + FormDialog.
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const count = (s, re) => (s.match(re) || []).length;
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const pad = (v, n) => String(v).padEnd(n);
const padl = (v, n) => String(v).padStart(n);

function web() {
  const dir = path.join(root, 'client/src/modules');
  const rows = fs.readdirSync(dir).filter((f) => f.endsWith('.jsx')).map((f) => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    const uses = ['Page', 'PageBar', 'Tabs', 'FilterBar', 'KpiGrid', 'Section', 'DataTable', 'StatusBadge', 'FormDialog', 'EmptyState'].filter((c) => new RegExp(`<${c}[\\s>/]`).test(s));
    return { name: f.replace('Module.jsx', ''), lines: s.split('\n').length, inline: count(s, /style=\{\{/g), hex: count(s, HEX), rowsp: count(s, /className="row sp"/g), ds: uses };
  });
  console.log('\nWEB modules (client/src/modules)\n');
  console.log(pad('module', 16) + padl('lines', 6) + padl('inline', 8) + padl('hex', 6) + padl('row sp', 8) + '  design-system components used');
  for (const r of rows.sort((a, b) => b.inline + b.hex * 2 - (a.inline + a.hex * 2))) console.log(pad(r.name, 16) + padl(r.lines, 6) + padl(r.inline, 8) + padl(r.hex, 6) + padl(r.rowsp, 8) + '  ' + (r.ds.join(', ') || '-'));
  const t = rows.reduce((a, r) => ({ inline: a.inline + r.inline, hex: a.hex + r.hex }), { inline: 0, hex: 0 });
  console.log(`\nTOTAL inline styles: ${t.inline}   hex colours: ${t.hex}`);
}

function mobile() {
  const dir = path.join(root, 'mobile/src/screens');
  const rows = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    const fonts = new Set((s.match(/fontSize: ?[0-9.]+/g) || []).map((x) => x.replace(/\s/g, '')));
    const radii = new Set((s.match(/borderRadius: ?[0-9]+/g) || []).map((x) => x.replace(/\s/g, '')));
    const uses = ['PageHeader', 'Tabs', 'FilterBar', 'KpiGrid', 'Section', 'StatusChip', 'FormSheet', 'EmptyState'].filter((c) => new RegExp(`<${c}[\\s>/]`).test(s));
    return { name: f.replace('.js', ''), lines: s.split('\n').length, hex: count(s, HEX), fonts: fonts.size, radii: radii.size, ds: uses };
  });
  console.log('\nMOBILE screens (mobile/src/screens)\n');
  console.log(pad('screen', 18) + padl('lines', 6) + padl('hex', 6) + padl('fonts', 7) + padl('radii', 7) + '  design-system components used');
  for (const r of rows.sort((a, b) => b.hex - a.hex || b.fonts - a.fonts)) console.log(pad(r.name, 18) + padl(r.lines, 6) + padl(r.hex, 6) + padl(r.fonts, 7) + padl(r.radii, 7) + '  ' + (r.ds.join(', ') || '-'));
}

web();
mobile();
console.log('');
