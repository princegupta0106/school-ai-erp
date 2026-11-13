// Finds (and with --write removes) CSS rules in client/src/styles.css whose selectors use a class that no source file mentions.
// Conservative: a class counts as used if its name appears ANYWHERE in the client source text, or starts with a dynamic prefix like `tr-${...}`.
// Usage: node tools/prune-css.mjs [--write]
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../client');
const cssFile = path.join(root, 'src/styles.css');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
const srcFiles = [...walk(path.join(root, 'src')), path.join(root, 'index.html')].filter((f) => /\.(jsx?|html)$/.test(f));
const src = srcFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
// classes written by other CSS files as well (ds.css / exam.css use their own classes in JSX, covered by src). Prefixes built dynamically:
const prefixes = [...new Set([...src.matchAll(/([a-z][a-z0-9]*-)\$\{/g), ...src.matchAll(/['"`]([a-z][a-z0-9]*-)['"`]\s*\+/g), ...src.matchAll(/\+\s*['"`]-([a-z][a-z0-9]*)/g)].map((m) => m[1]))];
const used = (c) => src.includes(c) || prefixes.some((p) => c.startsWith(p));
const css = fs.readFileSync(cssFile, 'utf8');

// split into top-level blocks: [{ text, kind }]; @media / @supports are parsed recursively
function blocks(text) {
  const out = []; let i = 0; let start = 0; let depth = 0; let inStr = null; let inCom = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inCom) { if (c === '*' && text[i + 1] === '/') { inCom = false; i++; } continue; }
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c === '/' && text[i + 1] === '*') { inCom = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { out.push(text.slice(start, i + 1)); start = i + 1; } }
    else if (c === ';' && depth === 0) { out.push(text.slice(start, i + 1)); start = i + 1; }
  }
  if (text.slice(start).trim()) out.push(text.slice(start));
  return out;
}
const dead = []; let kept = 0;
function pruneBlock(block) {
  const lead = block.match(/^\s*(\/\*[\s\S]*?\*\/\s*)*/)[0];
  const body = block.slice(lead.length);
  if (!body.startsWith('{') && body.includes('{')) {
    const sel = body.slice(0, body.indexOf('{')).trim();
    if (sel.startsWith('@media') || sel.startsWith('@supports')) {
      const inner = body.slice(body.indexOf('{') + 1, body.lastIndexOf('}'));
      const parts = blocks(inner).map(pruneBlock).filter(Boolean);
      if (!parts.length) { dead.push(`${sel} { ...all rules dead }`); return ''; }
      return `${lead}${sel}{${parts.join('')}}`;
    }
    if (sel.startsWith('@')) { kept++; return block; }
    const sels = sel.split(',').map((s) => s.trim()).filter(Boolean);
    const live = sels.filter((s) => [...s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].every((m) => used(m[1])));
    if (live.length === sels.length) { kept++; return block; }
    if (live.length === 0) { dead.push(sel.replace(/\s+/g, ' ').slice(0, 110)); return ''; }
    dead.push(`(partial) ${sels.filter((s) => !live.includes(s)).join(', ').slice(0, 100)}`);
    return `${lead}${live.join(',')}${body.slice(body.indexOf('{'))}`;
  }
  kept++; return block;
}
const outCss = blocks(css).map(pruneBlock).join('');
console.log(`rules kept: ${kept}, removed/trimmed: ${dead.length}, size ${css.length} -> ${outCss.length} bytes`);
if (globalThis.process.argv.includes('--list')) dead.forEach((d) => console.log('  -', d));
if (globalThis.process.argv.includes('--write')) { fs.writeFileSync(cssFile, outCss); console.log('styles.css updated'); }
