// Fee receipt as a PDF (A4). Latin text uses the built-in Helvetica; Devanagari (Hindi / Marathi) names use Noto Sans Devanagari.
// Money is written "Rs." because the built-in font has no rupee sign.
import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { rupeesInWords } from './feeLedger.js';

const require = createRequire(import.meta.url);
let DEVA = null;
try {
  const dir = require.resolve('@fontsource/noto-sans-devanagari/package.json').replace(/package\.json$/, 'files/');
  DEVA = { regular: `${dir}noto-sans-devanagari-devanagari-400-normal.woff`, bold: `${dir}noto-sans-devanagari-devanagari-700-normal.woff` };
  if (!fs.existsSync(DEVA.regular) || !fs.existsSync(DEVA.bold)) DEVA = null;
} catch { DEVA = null; }

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs = (n) => `Rs. ${inr.format(Number(n) || 0)}`;
const MODE = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card', other: 'Other' };
const dmy = (d) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
const isDeva = (ch) => /[\u0900-\u097F\u200C\u200D]/.test(ch);
// anything the fonts cannot draw becomes "?" (control characters are dropped)
const UNDRAWABLE = DEVA ? /[^\u0020-\u007e\u00a0-\u00ff\u0900-\u097F\u200C\u200D]/g : /[^\u0020-\u007e\u00a0-\u00ff]/g;
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(UNDRAWABLE, '?');

// split text into runs of Latin / Devanagari
function runs(text) {
  const out = [];
  for (const ch of clean(text)) {
    const deva = DEVA ? isDeva(ch) : false;
    const last = out[out.length - 1];
    if (last && last.deva === deva) last.text += ch; else out.push({ text: ch, deva });
  }
  return out;
}

export function receiptPdf({ school, student, session, payment, receivedBy }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Fee receipt ${payment.receipt_no}`, Author: school.name || 'School' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (DEVA) { doc.registerFont('deva', DEVA.regular); doc.registerFont('deva-b', DEVA.bold); }

    const L = 40, W = doc.page.width - 80, R = L + W;
    const ink = '#14161f', mute = '#667085', line = '#cfd4de', accent = '#4f46e5';

    // draw text that may mix scripts; align left | center | right inside [x, x+w]
    const mixed = (text, x, y, { size = 10, bold = false, color = ink, w = W, align = 'left' } = {}) => {
      const parts = runs(text);
      const fontFor = (p) => (p.deva ? (bold ? 'deva-b' : 'deva') : (bold ? 'Helvetica-Bold' : 'Helvetica'));
      const widths = parts.map((p) => { doc.font(fontFor(p)).fontSize(size); return doc.widthOfString(p.text); });
      const total = widths.reduce((a, b) => a + b, 0);
      let cx = align === 'center' ? x + (w - total) / 2 : align === 'right' ? x + w - total : x;
      doc.fillColor(color);
      parts.forEach((p, i) => { doc.font(fontFor(p)).fontSize(size).text(p.text, cx, y, { lineBreak: false }); cx += widths[i]; });
      doc.font('Helvetica');
    };
    const hline = (y, c = line) => doc.moveTo(L, y).lineTo(R, y).strokeColor(c).lineWidth(0.7).stroke();

    // ---- header
    let y = 40;
    mixed(school.name || 'School', L, y, { size: 19, bold: true, align: 'center' }); y += 26;
    const sub = [school.address, [school.phone, school.email].filter(Boolean).join('  |  ')].filter(Boolean);
    for (const s of sub) { mixed(s, L, y, { size: 9, color: mute, align: 'center' }); y += 13; }
    y += 6; doc.moveTo(L, y).lineTo(R, y).strokeColor(accent).lineWidth(1.5).stroke(); y += 14;
    mixed('FEE RECEIPT', L, y, { size: 14, bold: true, align: 'center' }); y += 28;

    // ---- receipt no / date
    mixed(`Receipt No: ${payment.receipt_no}`, L, y, { size: 11, bold: true });
    mixed(`Date: ${dmy(payment.paid_on)}`, L, y, { size: 11, bold: true, align: 'right' }); y += 24;

    // ---- student box
    const boxTop = y;
    const rows = [
      ['Student', student.full_name],
      ['Class', payment.class_label || student.class_label || '-'],
      ['Roll / Admission no.', [student.roll_no ? `Roll ${student.roll_no}` : '', student.admission_no ? `Adm. ${student.admission_no}` : ''].filter(Boolean).join('  /  ') || '-'],
      ['User ID', student.login_id],
      ['Session', session.name],
    ];
    y += 10;
    for (const [k, v] of rows) { mixed(k, L + 12, y, { size: 9.5, color: mute }); mixed(v, L + 150, y, { size: 10.5, bold: k === 'Student' }); y += 17; }
    y += 4;
    doc.roundedRect(L, boxTop, W, y - boxTop, 6).strokeColor(line).lineWidth(0.8).stroke();
    y += 18;

    // ---- particulars table
    doc.rect(L, y, W, 22).fillColor('#eef0f6').fill();
    mixed('#', L + 10, y + 6, { size: 9.5, bold: true, color: mute });
    mixed('Particulars', L + 40, y + 6, { size: 9.5, bold: true, color: mute });
    mixed('Amount (Rs.)', L, y + 6, { size: 9.5, bold: true, color: mute, w: W - 12, align: 'right' });
    y += 22;
    const alloc = (payment.allocation && payment.allocation.length) ? payment.allocation : [{ label: 'Fee payment', amount: payment.amount }];
    alloc.forEach((a, i) => {
      if (y > doc.page.height - 230) { doc.addPage(); y = 50; }
      mixed(String(i + 1), L + 10, y + 7, { size: 10 });
      mixed(a.label, L + 40, y + 7, { size: 10.5 });
      mixed(inr.format(a.amount), L, y + 7, { size: 10.5, w: W - 12, align: 'right' });
      y += 24; hline(y);
    });
    y += 8;
    mixed('Total received', L + 40, y, { size: 12, bold: true });
    mixed(rs(payment.amount), L, y, { size: 12, bold: true, w: W - 12, align: 'right' }); y += 22;
    mixed(rupeesInWords(payment.amount), L + 40, y, { size: 9.5, color: mute, w: W - 52 }); y += 26;

    // ---- how it was paid
    const info = [['Payment mode', MODE[payment.mode] || payment.mode]];
    if (payment.reference) info.push(['Reference / cheque no.', payment.reference]);
    if (payment.note) info.push(['Note', payment.note]);
    if (payment.balance_after !== null && payment.balance_after !== undefined) info.push(['Balance pending after this payment', rs(payment.balance_after)]);
    for (const [k, v] of info) { mixed(k, L, y, { size: 9.5, color: mute }); mixed(v, L + 190, y, { size: 10.5, bold: k.startsWith('Balance') }); y += 17; }

    // ---- footer
    const fy = Math.max(y + 50, doc.page.height - 150);
    hline(fy - 4);
    mixed(`Received by: ${receivedBy || '-'}`, L, fy + 6, { size: 9.5, color: mute });
    doc.moveTo(R - 160, fy + 52).lineTo(R, fy + 52).strokeColor(ink).lineWidth(0.6).stroke();
    mixed('Authorised signatory', R - 160, fy + 57, { size: 9, color: mute, w: 160, align: 'center' });
    mixed('This is a computer generated receipt.', L, fy + 74, { size: 8, color: mute, w: W - 180 });

    // ---- cancelled receipts are clearly marked
    if (payment.status === 'cancelled') {
      doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font('Helvetica-Bold').fontSize(90).fillColor('#c62828').opacity(0.18).text('CANCELLED', 60, doc.page.height / 2 - 50, { lineBreak: false });
      doc.restore();
      doc.opacity(1);
      mixed(`Cancelled${payment.cancel_reason ? `: ${payment.cancel_reason}` : ''}`, L, fy - 28, { size: 10, bold: true, color: '#c62828' });
    }
    doc.end();
  });
}
