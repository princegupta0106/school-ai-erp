// Design guardrails. Fails (exit 1) when a module gets MORE violations than tools/design-lint-baseline.json allows.
//   node tools/design-lint.mjs                 check
//   node tools/design-lint.mjs --update-baseline   accept current numbers (only after you have REDUCED them)
// Rules (web: client/src/modules, mobile: mobile/src/screens):
//   hex     no hex colours (use a token / var(--...)). Lines holding print-HTML or marked `design-lint-ignore` are skipped.
//   inline  no static inline layout styles style={{ margin, padding, gap, display, flex, width, fontSize, color... }}.
//           Data-driven custom properties like style={{ '--c': col }} and bar widths are allowed.
//   legacy  web only: old patterns that the design system replaced (<Modal>, <Empty>, className="err", "pills"/"pill", "page-head", "btn" is fine).
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const targets = [
  { name: 'web', dir: 'client/src/modules', ext: /\.jsx$/, rules: ['hex', 'inline', 'legacy'] },
  { name: 'mobile', dir: 'mobile/src/screens', ext: /\.jsx?$/, rules: ['hex'] },
];
const LAYOUT = /\b(margin\w*|padding\w*|gap|display|flex\w*|alignSelf|alignItems|justifyContent|maxWidth|minWidth|textAlign|fontSize|fontWeight|color|border\w*|position|lineHeight)\s*:/;
const HEX = /(^|[^\w&])#[0-9a-fA-F]{3,8}\b/;
const PRINT = /document\.write|<style>|style=\\?["']|printHtml|design-lint-ignore|srcDoc/;
const LEGACY = /<Modal\b|<Empty>|className="err"|className=\{?[`"'][^`"']*\bpills?\b|page-head/;
const count = (file, rules) => {
  const out = { hex: 0, inline: 0, legacy: 0 };
  fs.readFileSync(file, 'utf8').split('\n').forEach((line) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    if (rules.includes('hex') && HEX.test(line) && !PRINT.test(line) && !/^\s*import /.test(line)) out.hex++;
    if (rules.includes('inline')) for (const m of line.matchAll(/style=\{\{([^}]*)\}\}/g)) { const body = m[1]; if (!/^\s*'--/.test(body) && LAYOUT.test(body) && !/design-lint-ignore/.test(line)) out.inline++; }
    if (rules.includes('legacy') && LEGACY.test(line) && !/design-lint-ignore/.test(line)) out.legacy++;
  });
  return out;
};
const now = {};
for (const t of targets) {
  const dir = path.join(root, t.dir); if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => t.ext.test(x))) now[`${t.name}/${f}`] = count(path.join(dir, f), t.rules);
}
const basePath = path.join(root, 'tools/design-lint-baseline.json');
if (process.argv.includes('--update-baseline')) { fs.writeFileSync(basePath, JSON.stringify(now, null, 1)); console.log('baseline written'); process.exit(0); }
const base = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) : {};
let fail = 0; let total = { hex: 0, inline: 0, legacy: 0 };
for (const [f, c] of Object.entries(now)) {
  for (const r of Object.keys(c)) {
    total[r] += c[r];
    const allowed = base[f]?.[r] ?? 0;
    if (c[r] > allowed) { fail++; console.error(`FAIL ${f}: ${r} ${c[r]} (allowed ${allowed}) - fix it, do not raise the baseline`); }
    else if (c[r] < allowed) console.log(`good ${f}: ${r} dropped ${allowed} -> ${c[r]} (run --update-baseline to lock it in)`);
  }
}
console.log(`design-lint: hex ${total.hex}, inline ${total.inline}, legacy ${total.legacy}${fail ? `  -> ${fail} problem(s)` : '  -> OK'}`);
process.exit(fail ? 1 : 0);
