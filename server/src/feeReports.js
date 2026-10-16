// Files for the Fees module: CSV, a table PDF (pending list, collection report) and a student's fee statement PDF.
// Text handling (Latin = built-in Helvetica, Hindi / Marathi = Noto Sans Devanagari, "Rs." instead of the rupee sign)
// follows receipt.js on purpose, so every fee paper looks and behaves the same.
import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
let DEVA = null;
try {
  const dir = require.resolve('@fontsource/noto-sans-devanagari/package.json').replace(/package\.json$/, 'files/');
  DEVA = { regular: `${dir}noto-sans-devanagari-devanagari-400-normal.woff`, bold: `${dir}noto-sans-devanagari-devanagari-700-normal.woff` };
  if (!fs.existsSync(DEVA.regular) || !fs.existsSync(DEVA.bold)) DEVA = null;
} catch { DEVA = null; }

const inrFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => inrFmt.format(Number(n) || 0);
export const rs = (n) => `Rs. ${money(n)}`;
export const dmy = (d) => (/^\d{4}-\d{2}-\d{2}/.test(d || '') ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : d || '');
export const MODE_LABEL = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card', other: 'Other' };

// ---------------------------------------------------------------- CSV
// A cell that starts with = + - @ would be run as a formula by Excel / Sheets (a student called "=HYPERLINK(...)"), so it is written as text.
const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// columns: [{key, label}] ; rows: objects. BOM first so Excel opens Hindi names correctly.
export function toCsv(columns, rows) {
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(typeof c.csv === 'function' ? c.csv(r) : r[c.key])).join(','));
  return `\uFEFF${[head, ...body].join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------- text that may mix scripts
const isDeva = (ch) => /[\u0900-\u097F\u200C\u200D]/.test(ch);
const UNDRAWABLE = DEVA ? /[^\u0020-\u007e\u00a0-\u00ff\u0900-\u097F\u200C\u200D]/g : /[^\u0020-\u007e\u00a0-\u00ff]/g;
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(UNDRAWABLE, '?');
function runs(text) {
  const out = [];
  for (const ch of clean(text)) {
    const deva = DEVA ? isDeva(ch) : false;
    const last = out[out.length - 1];
    if (last && last.deva === deva) last.text += ch; else out.push({ text: ch, deva });
  }
  return out;
}

function writer(doc) {
  const fontFor = (p, bold) => (p.deva ? (bold ? 'deva-b' : 'deva') : (bold ? 'Helvetica-Bold' : 'Helvetica'));
  const width = (text, size, bold) => runs(text).reduce((w, p) => { doc.font(fontFor(p, bold)).fontSize(size); return w + doc.widthOfString(p.text); }, 0);
  // cut the text so it fits `w`, ending in ... when it had to be cut
  const fit = (text, w, size, bold) => {
    let s = clean(text);
    if (width(s, size, bold) <= w) return s;
    while (s.length > 1 && width(`${s}...`, size, bold) > w) s = s.slice(0, -1);
    return `${s.trimEnd()}...`;
  };
  const put = (text, x, y, { size = 10, bold = false, color = '#14161f', w = 0, align = 'left' } = {}) => {
    const parts = runs(text);
    const total = width(text, size, bold);
    let cx = align === 'center' ? x + (w - total) / 2 : align === 'right' ? x + w - total : x;
    doc.fillColor(color);
    for (const p of parts) { doc.font(fontFor(p, bold)).fontSize(size); const pw = doc.widthOfString(p.text); doc.text(p.text, cx, y, { lineBreak: false }); cx += pw; }
    doc.font('Helvetica');
  };
  return { put, fit, width };
}
function newDoc(info, opts = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true, info, ...opts });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  if (DEVA) { doc.registerFont('deva', DEVA.regular); doc.registerFont('deva-b', DEVA.bold); }
  return { doc, done };
}

const INK = '#14161f', MUTE = '#667085', LINE = '#cfd4de', ACCENT = '#4f46e5', HEAD_BG = '#eef0f6';

function pageNumbers(doc, w, left, right) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    w.put(`Page ${i + 1} of ${range.count}`, left, doc.page.height - 26, { size: 8, color: MUTE, w: right - left, align: 'right' });
  }
}

// ---------------------------------------------------------------- a table of rows (landscape A4)
// columns: [{label, weight, align?, get(row) -> text (use \n for a second line)}]
// totals: [[label, value], ...] shown under the title
export function tablePdf({ school = {}, title, subtitle = '', totals = [], columns, rows, note = '' }) {
  const { doc, done } = newDoc({ Title: title, Author: school.name || 'School' }, { layout: 'landscape' });
  const w = writer(doc);
  const L = 36, R = doc.page.width - 36, W = R - L, bottom = doc.page.height - 44;
  const sum = columns.reduce((s, c) => s + c.weight, 0);
  const xs = []; let acc = L;
  for (const c of columns) { xs.push(acc); acc += (W * c.weight) / sum; }
  const cw = (i) => (W * columns[i].weight) / sum;
  const PAD = 4, SIZE = 8.5, LH = 11;

  let y = 34;
  w.put(school.name || 'School', L, y, { size: 15, bold: true, w: W, align: 'center' }); y += 21;
  const sub = [school.address, [school.phone, school.email].filter(Boolean).join('  |  ')].filter(Boolean).join('   ');
  if (sub) { w.put(w.fit(sub, W, 8.5, false), L, y, { size: 8.5, color: MUTE, w: W, align: 'center' }); y += 13; }
  doc.moveTo(L, y).lineTo(R, y).strokeColor(ACCENT).lineWidth(1.2).stroke(); y += 9;
  w.put(title, L, y, { size: 12.5, bold: true }); y += 17;
  if (subtitle) { w.put(w.fit(subtitle, W, 9, false), L, y, { size: 9, color: MUTE }); y += 14; }
  if (totals.length) {
    let tx = L;
    for (const [k, v] of totals) {
      w.put(k, tx, y, { size: 8.5, color: MUTE });
      w.put(String(v), tx, y + 11, { size: 11, bold: true });
      tx += Math.max(w.width(k, 8.5, false), w.width(String(v), 11, true)) + 28;
    }
    y += 32;
  }
  y += 4;

  const header = () => {
    doc.rect(L, y, W, 20).fillColor(HEAD_BG).fill();
    columns.forEach((c, i) => w.put(w.fit(c.label, cw(i) - PAD * 2, 8.5, true), xs[i] + PAD, y + 5.5, { size: 8.5, bold: true, color: MUTE, w: cw(i) - PAD * 2, align: c.align || 'left' }));
    y += 20;
  };
  header();
  if (!rows.length) { w.put('Nothing to show.', L + PAD, y + 8, { size: 10, color: MUTE }); y += 28; }
  for (const r of rows) {
    const texts = columns.map((c, i) => String(c.get(r) ?? '').split('\n').slice(0, 2).map((t) => w.fit(t, cw(i) - PAD * 2, SIZE, false)));
    const h = Math.max(...texts.map((t) => t.length)) * LH + 7;
    if (y + h > bottom) { doc.addPage(); y = 36; header(); }
    texts.forEach((lines, i) => lines.forEach((t, k) => w.put(t, xs[i] + PAD, y + 4 + k * LH, { size: SIZE, w: cw(i) - PAD * 2, align: columns[i].align || 'left' })));
    y += h;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(0.5).stroke();
  }
  if (note) { y += 8; if (y > bottom) { doc.addPage(); y = 36; } w.put(w.fit(note, W, 8.5, false), L, y, { size: 8.5, color: MUTE }); }
  pageNumbers(doc, w, L, R);
  doc.end();
  return done;
}

// ---------------------------------------------------------------- one student's fee statement (portrait A4)
// view = the object fees.js accountView() returns; contacts = mergeContacts() result (staff only, else [])
export function statementPdf({ school = {}, view, contacts = [] }) {
  const { student, session, ledger, payments, today } = view;
  const { doc, done } = newDoc({ Title: `Fee statement - ${student.full_name}`, Author: school.name || 'School' });
  const w = writer(doc);
  const L = 36, R = doc.page.width - 36, W = R - L, bottom = doc.page.height - 50;
  let y = 36;
  const ensure = (h) => { if (y + h > bottom) { doc.addPage(); y = 40; } };

  w.put(school.name || 'School', L, y, { size: 18, bold: true, w: W, align: 'center' }); y += 25;
  const sub = [school.address, [school.phone, school.email].filter(Boolean).join('  |  ')].filter(Boolean);
  for (const s of sub) { w.put(w.fit(s, W, 9, false), L, y, { size: 9, color: MUTE, w: W, align: 'center' }); y += 13; }
  y += 5; doc.moveTo(L, y).lineTo(R, y).strokeColor(ACCENT).lineWidth(1.5).stroke(); y += 13;
  w.put('FEE STATEMENT', L, y, { size: 14, bold: true, w: W, align: 'center' }); y += 22;
  w.put(`Session: ${session.name}`, L, y, { size: 10.5, bold: true }); w.put(`As on: ${dmy(today)}`, L, y, { size: 10.5, bold: true, w: W, align: 'right' }); y += 22;

  // student box
  const rowsBox = [
    ['Student', student.full_name],
    ['Class', student.class_label || '-'],
    ['Roll / Admission no.', [student.roll_no ? `Roll ${student.roll_no}` : '', student.admission_no ? `Adm. ${student.admission_no}` : ''].filter(Boolean).join('  /  ') || '-'],
    ['User ID', student.login_id],
    ...contacts.slice(0, 3).map((c) => [c.relation || 'Parent', [c.name, c.phone].filter(Boolean).join('   ')]),
  ];
  const top = y; y += 9;
  for (const [k, v] of rowsBox) { w.put(k, L + 12, y, { size: 9.5, color: MUTE }); w.put(w.fit(v, W - 170, 10.5, k === 'Student'), L + 150, y, { size: 10.5, bold: k === 'Student' }); y += 16; }
  y += 3; doc.roundedRect(L, top, W, y - top, 6).strokeColor(LINE).lineWidth(0.8).stroke(); y += 16;

  // totals
  const t = ledger.totals;
  const boxes = [['Total fees', t.total], ['Paid', t.paid], ['Pending', t.pending], ['Due till today', t.due_till_date]];
  const bw = W / boxes.length;
  boxes.forEach(([k, v], i) => {
    doc.rect(L + i * bw, y, bw - 6, 40).fillColor(i === 2 ? '#fdecea' : HEAD_BG).fill();
    w.put(k, L + i * bw + 8, y + 7, { size: 8.5, color: MUTE });
    w.put(rs(v), L + i * bw + 8, y + 21, { size: 11.5, bold: true, color: i === 2 && Number(v) > 0 ? '#c62828' : INK });
  });
  y += 52;
  if (t.next_due_date && Number(t.next_due_amount) > 0) { w.put(`Next instalment: ${rs(t.next_due_amount)} on ${dmy(t.next_due_date)}`, L, y, { size: 9.5, color: MUTE }); y += 18; }

  // instalments
  const table = (heading, cols, data) => {
    ensure(60);
    w.put(heading, L, y, { size: 11, bold: true }); y += 17;
    const sum = cols.reduce((s, c) => s + c.weight, 0);
    const xs = []; let a = L; for (const c of cols) { xs.push(a); a += (W * c.weight) / sum; }
    const cw = (i) => (W * cols[i].weight) / sum;
    const head = () => { doc.rect(L, y, W, 19).fillColor(HEAD_BG).fill(); cols.forEach((c, i) => w.put(c.label, xs[i] + 4, y + 5, { size: 8.5, bold: true, color: MUTE, w: cw(i) - 8, align: c.align || 'left' })); y += 19; };
    head();
    if (!data.length) { w.put('None', L + 4, y + 6, { size: 9.5, color: MUTE }); y += 22; }
    for (const r of data) {
      if (y + 20 > bottom) { doc.addPage(); y = 40; head(); }
      cols.forEach((c, i) => w.put(w.fit(c.get(r), cw(i) - 8, 9, false), xs[i] + 4, y + 5.5, { size: 9, w: cw(i) - 8, align: c.align || 'left', color: c.color ? c.color(r) : INK }));
      y += 20; doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(0.5).stroke();
    }
    y += 16;
  };
  const STATUS = { paid: 'Paid', partial: 'Part paid', due: 'Due', upcoming: 'Upcoming' };
  table('Fee instalments', [
    { label: 'Fee', weight: 5, get: (l) => l.label },
    { label: 'Due date', weight: 2, get: (l) => dmy(l.due_date) },
    { label: 'Amount (Rs.)', weight: 2, align: 'right', get: (l) => money(l.amount) },
    { label: 'Paid (Rs.)', weight: 2, align: 'right', get: (l) => money(l.paid) },
    { label: 'Pending (Rs.)', weight: 2, align: 'right', get: (l) => money(l.pending) },
    { label: 'Status', weight: 2, get: (l) => (l.overdue ? 'Overdue' : STATUS[l.status] || l.status), color: (l) => (l.overdue ? '#c62828' : INK) },
  ], ledger.lines);

  table('Payments received', [
    { label: 'Receipt no.', weight: 3, get: (p) => p.receipt_no },
    { label: 'Date', weight: 2, get: (p) => dmy(p.paid_on) },
    { label: 'Mode', weight: 2, get: (p) => MODE_LABEL[p.mode] || p.mode },
    { label: 'Reference', weight: 3, get: (p) => p.reference || '-' },
    { label: 'Amount (Rs.)', weight: 2, align: 'right', get: (p) => money(p.amount) },
    { label: 'Status', weight: 2, get: (p) => (p.status === 'cancelled' ? 'Cancelled' : 'Received'), color: (p) => (p.status === 'cancelled' ? '#c62828' : INK) },
  ], payments);

  ensure(30);
  w.put('This is a computer generated statement. Cancelled receipts are shown for the record and are not counted.', L, y, { size: 8, color: MUTE });
  pageNumbers(doc, w, L, R);
  doc.end();
  return done;
}
