// Builds the printable HTML of every document (certificates and report cards) from a "content" snapshot, (printing / PDF sharing lives in docPrint.js on mobile).
// content = { type, title, body, design, accent, orientation, inset, bg_url, school, subject, fields, report, serial_no, issued_on }
// The same function draws the live preview, the issued copy and the printout, so what you see is what is printed.
// To add a design: add it to DESIGNS, give it a `case` in frameHTML() and a block in designCSS().
// To add a document type: add it to TYPES (wording + the extra fields the form asks for) - nothing else is needed for simple certificates.

export const DESIGNS = [
  { id: 'classic', name: 'Classic', accent: '#1f3a6e', desc: 'Double border with gold corners' },
  { id: 'royal', name: 'Royal', accent: '#7a1f2b', desc: 'Maroon & gold, ornate frame' },
  { id: 'modern', name: 'Modern', accent: '#0f5fa8', desc: 'Clean, colour band on the side' },
  { id: 'emerald', name: 'Emerald', accent: '#0f6b4f', desc: 'Green frame with a dashed inner line' },
  { id: 'minimal', name: 'Minimal', accent: '#374151', desc: 'Thin line, lots of white space' },
  { id: 'ribbon', name: 'Ribbon', accent: '#b4232c', desc: 'Coloured header band and ribbon title' },
];
export const designOf = (id) => DESIGNS.find((d) => d.id === id) || DESIGNS[0];

const GRADE_KEY = 'Grading scale: A+ 90% and above, A 80-89, B 70-79, C 60-69, D 50-59, E 33-49, F below 33. The pass mark is 33% in every subject.';

// kind: who it is for. fields: extra things asked while issuing. {{placeholders}} are filled from the person's profile and these fields.
export const TYPES = {
  bonafide: {
    label: 'Bonafide certificate', short: 'Bonafide', kind: ['student'], title: 'BONAFIDE CERTIFICATE', orientation: 'portrait', align: 'justify', signers: ['Principal'],
    desc: 'Proof that the student studies in the school',
    body: 'This is to certify that {{name}}, {{son_daughter}} of {{father}}, is a bonafide student of {{school}}. {{He_She}} is studying in Class {{class}} during the academic session {{session}} (Admission No. {{admission_no}}).\n\nAs per the school records, {{his_her}} date of birth is {{dob}}.\n\nThis certificate is issued at the request of the student / parent for {{purpose}}.',
    fields: [{ key: 'purpose', label: 'Purpose', def: () => 'any official purpose' }, { key: 'session', label: 'Academic session', def: (c) => c.session }],
  },
  character: {
    label: 'Character certificate', short: 'Character', kind: ['student', 'staff'], title: 'CHARACTER CERTIFICATE', orientation: 'portrait', align: 'justify', signers: ['Principal'],
    desc: 'Conduct and character of a student or staff member',
    body: 'This is to certify that {{name}}, {{son_daughter}} of {{father}}, has been a student of {{school}} in Class {{class}} during the academic session {{session}} (Admission No. {{admission_no}}).\n\nTo the best of my knowledge, {{his_her}} character and conduct have been {{conduct}}. {{He_She}} bears a good moral character and has not been involved in any act of indiscipline.\n\nI wish {{him_her}} all success in life.',
    bodyStaff: 'This is to certify that {{name}} has been working as {{designation}} at {{school}} since {{joining_date}}.\n\nTo the best of my knowledge, {{his_her}} character and conduct have been {{conduct}}. {{He_She}} bears a good moral character.\n\nI wish {{him_her}} all success in life.',
    fields: [{ key: 'conduct', label: 'Conduct', def: () => 'excellent' }, { key: 'session', label: 'Academic session', def: (c) => c.session, kind: 'student' }],
  },
  transfer: {
    label: 'Transfer certificate', short: 'Transfer (TC)', kind: ['student'], title: 'TRANSFER CERTIFICATE', orientation: 'portrait', layout: 'tc', signers: ['Class Teacher', 'Checked by', 'Principal'],
    desc: 'Issued when a student leaves the school',
    body: 'Certified that the above particulars are correct as per the school records. The pupil is granted this Transfer Certificate on {{today}}.',
    fields: [
      { key: 'nationality', label: 'Nationality', def: () => 'Indian' },
      { key: 'admission_date', label: 'Date of admission', type: 'date', def: () => '' },
      { key: 'class_studied', label: 'Class last studied', def: (c) => c.subject.class_label },
      { key: 'leaving_date', label: 'Date of leaving', type: 'date', def: (c) => c.today },
      { key: 'reason', label: 'Reason for leaving', def: () => "Parent's request" },
      { key: 'promotion', label: 'Qualified for promotion', def: () => 'Yes' },
      { key: 'dues', label: 'All fees / dues cleared', def: () => 'Yes' },
      { key: 'conduct', label: 'General conduct', def: () => 'Good' },
      { key: 'tc_remarks', label: 'Remarks', def: () => '', wide: true },
    ],
  },
  activity: {
    label: 'Activity / achievement certificate', short: 'Activity', kind: ['student', 'staff'], title: 'CERTIFICATE OF ACHIEVEMENT', orientation: 'landscape', align: 'center', layout: 'award', signers: ['Class Teacher', 'Principal'],
    desc: 'Sports, cultural, competition, participation...',
    body: 'for {{achievement}} in {{activity}}, held on {{event_date}}.\n\nWe appreciate {{his_her}} effort and dedication and wish {{him_her}} continued success.',
    fields: [
      { key: 'activity', label: 'Activity / event', def: () => '', ph: 'e.g. Inter-school Quiz Competition', required: true },
      { key: 'achievement', label: 'Position / achievement', def: () => 'outstanding participation', ph: 'e.g. securing First Position' },
      { key: 'event_date', label: 'Date of event', type: 'date', def: (c) => c.today },
    ],
  },
  report_card: {
    label: 'Report card', short: 'Report card', kind: ['student'], title: 'REPORT CARD', orientation: 'portrait', layout: 'report', signers: ['Class Teacher', "Parent's Signature", 'Principal'],
    desc: 'Marks of the chosen exams, result and attendance',
    body: GRADE_KEY,
    fields: [
      { key: 'promoted_to', label: 'Promoted to class', def: () => '' },
      { key: 'reopen_date', label: 'School re-opens on', type: 'date', def: () => '' },
      { key: 'remarks', label: "Class teacher's remarks", def: () => '', wide: true, area: true },
    ],
  },
  experience: {
    label: 'Experience certificate', short: 'Experience', kind: ['staff'], title: 'EXPERIENCE CERTIFICATE', orientation: 'portrait', align: 'justify', signers: ['Principal'],
    desc: 'Service certificate for a teacher or staff member',
    body: 'This is to certify that {{name}} worked as {{designation}} at {{school}} from {{joining_date}} to {{leaving_date}}.\n\nDuring {{his_her}} tenure, {{his_her}} conduct and performance were found to be {{conduct}}. The reason for leaving is: {{reason}}.\n\nWe wish {{him_her}} all the best in future endeavours.',
    fields: [
      { key: 'designation', label: 'Designation', def: (c) => c.subject.designation },
      { key: 'joining_date', label: 'Joined on', type: 'date', def: (c) => c.subject.joining_date },
      { key: 'leaving_date', label: 'Last working day', type: 'date', def: (c) => c.today },
      { key: 'conduct', label: 'Conduct / performance', def: () => 'satisfactory' },
      { key: 'reason', label: 'Reason for leaving', def: () => 'personal reasons', wide: true },
    ],
  },
  custom: {
    label: 'Custom certificate / letter', short: 'Custom', kind: ['student', 'staff'], title: 'CERTIFICATE', orientation: 'portrait', align: 'justify', signers: ['Principal'], customTitle: true,
    desc: 'Any other certificate or letter - write your own text',
    body: 'This is to certify that {{name}} ...\n\nWrite the text here. You can use {{school}}, {{class}}, {{father}}, {{today}} and the other placeholders.',
    fields: [],
  },
};
export const TYPE_LIST = Object.entries(TYPES).map(([key, t]) => ({ key, ...t }));

// words you can drop into the wording
export const PLACEHOLDERS = [
  ['name', 'Name'], ['class', 'Class'], ['roll_no', 'Roll no.'], ['admission_no', 'Admission no.'], ['father', "Father's name"], ['mother', "Mother's name"],
  ['dob', 'Date of birth'], ['dob_words', 'Birth date in words'], ['session', 'Session'], ['school', 'School name'], ['today', 'Issue date'], ['place', 'Place'],
  ['son_daughter', 'son / daughter'], ['he_she', 'he / she'], ['He_She', 'He / She'], ['his_her', 'his / her'], ['him_her', 'him / her'],
  ['designation', 'Designation'], ['department', 'Department'], ['employee_id', 'Employee ID'], ['joining_date', 'Joining date'],
];

// ---------------------------------------------------------------- small helpers
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const fmtDate = (d) => { if (!ISO.test(d || '')) return d || ''; const [y, m, day] = d.split('-').map(Number); return `${day} ${MONTHS[m - 1]} ${y}`; };

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const ORD = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth', 'Twenty First', 'Twenty Second', 'Twenty Third', 'Twenty Fourth', 'Twenty Fifth', 'Twenty Sixth', 'Twenty Seventh', 'Twenty Eighth', 'Twenty Ninth', 'Thirtieth', 'Thirty First'];
function yearWords(y) {
  if (y >= 2000 && y < 2100) return y === 2000 ? 'Two Thousand' : `Two Thousand ${below100(y - 2000)}`;
  if (y >= 1900 && y < 2000) return y % 100 === 0 ? 'Nineteen Hundred' : `Nineteen ${below100(y % 100)}`;
  return String(y);
}
export function dobWords(d) {
  if (!ISO.test(d || '')) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${ORD[day]} ${MONTHS[m - 1]} ${yearWords(y)}`;
}

const genderOf = (g) => (/^m/i.test(g || '') ? 'm' : /^f/i.test(g || '') ? 'f' : 'n');
function pronouns(g) {
  const k = genderOf(g);
  const p = { m: ['he', 'his', 'him', 'son'], f: ['she', 'her', 'her', 'daughter'], n: ['he/she', 'his/her', 'him/her', 'son/daughter'] }[k];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return { he_she: p[0], He_She: cap(p[0]), his_her: p[1], His_Her: cap(p[1]), him_her: p[2], son_daughter: p[3] };
}

// every {{placeholder}} the wording can use
export function varsOf(c) {
  const s = c.subject || {}; const f = c.fields || {}; const sc = c.school || {};
  const v = {
    name: s.name, class: s.class_label, roll_no: s.roll_no, admission_no: s.admission_no, father: s.father, mother: s.mother,
    dob: fmtDate(s.dob), dob_words: dobWords(s.dob), session: c.session_name || c.report?.session_name || f.session, school: sc.name, today: fmtDate(c.issued_on || c.today),
    place: sc.place, designation: s.designation, department: s.department, employee_id: s.employee_id, joining_date: fmtDate(s.joining_date), address: s.address,
    principal: sc.principal_name, ...pronouns(s.gender),
  };
  for (const [k, val] of Object.entries(f)) if (val !== '' && val !== undefined) v[k] = ISO.test(val) ? fmtDate(val) : val;
  return v;
}

const BLANK = '<b class="blank">&nbsp;</b>';
const PLAIN = new Set(['he_she', 'He_She', 'his_her', 'His_Her', 'him_her', 'son_daughter']); // pronouns read better without bold
export function fillText(text, vars) {
  return esc(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    if (vars[k] === undefined || vars[k] === null || String(vars[k]).trim() === '') return BLANK;
    return PLAIN.has(k) ? esc(vars[k]) : `<b>${esc(vars[k])}</b>`;
  });
}
const isMissing = (vars, k) => vars[k] === undefined || vars[k] === null || String(vars[k]).trim() === '';
const hasMissing = (str, vars) => [...str.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].some((m) => !PLAIN.has(m[1]) && isMissing(vars, m[1]));
// leave out any detail that is not filled in: "(Admission No. {{x}})" and whole sentences that need a missing value
function prune(par, vars) {
  const t = par.replace(/\s*\([^()]*\{\{[^()]*\}\}[^()]*\)/g, (m) => (hasMissing(m, vars) ? '' : m));
  return t.split(/(?<=[a-z0-9)}][.!?])\s+(?=[A-Z]|\{\{\s*[A-Z])/).filter((x) => !hasMissing(x, vars)).join(' ').trim();
}
const paragraphs = (text, vars, dropBlank = false) => String(text || '').split(/\n\s*\n/).map((p) => p.trim()).map((p) => (dropBlank ? prune(p, vars) : p)).filter(Boolean).map((p) => `<p>${fillText(p, vars).replace(/\n/g, '<br>')}</p>`).join('');

// the wording to use: a saved template of the school, else the built-in one
export function resolveTemplate(type, tpl, kind) {
  const T = TYPES[type]; const t = tpl || {};
  const staffBody = kind === 'staff' ? (t.settings?.body_staff || T.bodyStaff) : null;
  return {
    title: t.title || T.title,
    body: staffBody || t.body || T.body,
    design: t.design || 'classic',
    accent: t.accent || designOf(t.design || 'classic').accent,
    orientation: t.orientation || T.orientation,
    bg_url: t.bg_url || '',
    inset: t.settings?.inset ?? 18,
  };
}

// starting values of the extra fields
export function defaultFields(type, ctx) {
  const out = {};
  for (const f of TYPES[type].fields) out[f.key] = f.def ? f.def(ctx) || '' : '';
  return out;
}

// ---------------------------------------------------------------- the page
const ORNAMENT = '<svg viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 58V12a10 10 0 0 1 10-10h46"/><path d="M9 58V20a11 11 0 0 1 11-11h38" stroke-width="1"/><circle cx="6" cy="6" r="3" fill="currentColor" stroke="none"/><path d="M16 16c6 0 10 4 10 10" stroke-width="1"/></svg>';
const corners = () => ['tl', 'tr', 'bl', 'br'].map((p) => `<span class="orn ${p}">${ORNAMENT}</span>`).join('');

function frameHTML(c) {
  if (c.bg_url) return '';
  switch (c.design) {
    case 'classic': return `<div class="f1"></div><div class="f2"></div>${corners()}`;
    case 'royal': return `<div class="f1"></div><div class="f2"></div><div class="f3"></div>${corners()}`;
    case 'modern': return '<div class="band"></div><div class="band2"></div>';
    case 'emerald': return '<div class="f1"></div><div class="f2"></div><span class="dot tl"></span><span class="dot tr"></span><span class="dot bl"></span><span class="dot br"></span>';
    case 'minimal': return '<div class="f1"></div>';
    case 'ribbon': return '<div class="top"></div><div class="bot"></div>';
    default: return '';
  }
}

function letterheadHTML(sc) {
  const logo = sc.logo_url ? `<div class="lh-logo"><img src="${esc(sc.logo_url)}" alt=""></div>` : '';
  const contact = [sc.address, [sc.phone, sc.email].filter(Boolean).join('  |  ')].filter(Boolean);
  return `<header class="lh">${logo}<div class="lh-text">
    <h1>${esc(sc.name || 'Your School')}</h1>
    ${sc.tagline ? `<div class="tag">${esc(sc.tagline)}</div>` : ''}
    ${contact.map((l) => `<div class="addr">${esc(l)}</div>`).join('')}
    ${sc.reg_line ? `<div class="reg">${esc(sc.reg_line)}</div>` : ''}
  </div>${sc.logo_url ? '<div class="lh-logo"></div>' : ''}</header>`;
}

function signHTML(c, T, date) {
  const sc = c.school || {};
  const labels = T.signers || ['Principal'];
  const last = labels.length - 1;
  const blocks = labels.map((label, i) => {
    if (i !== last) return `<div class="sig"><div class="sig-line"></div><div class="sig-label">${esc(label)}</div></div>`;
    return `<div class="sig">${sc.signature_url ? `<img class="sig-img" src="${esc(sc.signature_url)}" alt="">` : '<div class="sig-space"></div>'}<div class="sig-line"></div>
      ${sc.principal_name ? `<div class="sig-name">${esc(sc.principal_name)}</div>` : ''}<div class="sig-label">${esc(label === 'Principal' ? sc.principal_title || 'Principal' : label)}</div></div>`;
  });
  if (sc.seal_url) blocks.splice(Math.ceil(blocks.length / 2), 0, `<div class="seal"><img src="${esc(sc.seal_url)}" alt=""></div>`);
  const pd = (T.layout === 'award' || T.layout === 'report') ? '' : `<div class="pd">${sc.place ? `Place: <b>${esc(sc.place)}</b><br>` : ''}Date: <b>${esc(date)}</b></div>`;
  return `<footer class="signs">${pd}${blocks.join('')}</footer>${sc.footer_note ? `<div class="foot">${esc(sc.footer_note)}</div>` : ''}`;
}

const row = (n, label, val) => `<tr><td class="n">${n}</td><td class="l">${esc(label)}</td><td class="v">${val ? esc(val) : '&nbsp;'}</td></tr>`;

function tcTable(c, v) {
  const s = c.subject; const f = c.fields;
  const rows = [
    ['Name of the pupil', s.name], ["Father's / Guardian's name", s.father], ["Mother's name", s.mother],
    ['Date of birth (in figures)', fmtDate(s.dob)], ['Date of birth (in words)', dobWords(s.dob)],
    ['Nationality', f.nationality], ['Admission No.', s.admission_no], ['Date of admission', fmtDate(f.admission_date)],
    ['Class in which last studied', f.class_studied || s.class_label], ['Date of leaving the school', fmtDate(f.leaving_date)],
    ['Reason for leaving', f.reason], ['Qualified for promotion to a higher class', f.promotion], ['All fees / dues cleared', f.dues],
    ['General conduct', f.conduct], ['Remarks', f.tc_remarks],
  ];
  const shown = rows.filter((r, i) => i === 0 || String(r[1] ?? '').trim() !== ''); // unfilled details are left out
  return `<table class="tc">${shown.map((r, i) => row(i + 1, r[0], r[1])).join('')}</table>${paragraphs(c.body, v, true)}`;
}

function reportHTML(c, v) {
  const s = c.subject; const R = c.report || { subjects: [], exams: [], exam_totals: {} };
  const info = [
    ['Name', s.name], ['Class', s.class_label], ['Roll No.', s.roll_no], ['Admission No.', s.admission_no],
    ["Father's name", s.father], ["Mother's name", s.mother], ['Date of birth', fmtDate(s.dob)], ['Session', R.session_name || c.fields.session],
  ];
  const num = (n) => (n === null || n === undefined ? '-' : Number(n));
  const cell = (x) => (!x ? '-' : x.absent ? 'Ab' : `${num(x.marks)}<small>/${num(x.max)}</small>`);
  const head = `<tr><th class="sub">Subject</th>${R.exams.map((e) => `<th>${esc(e.name)}</th>`).join('')}<th>Total</th><th>%</th><th>Grade</th>${R.has_tests_column ? '<th>Tests %</th>' : ''}</tr>`;
  const bodyRows = R.subjects.map((x) => `<tr><td class="sub">${esc(x.name)}</td>${R.exams.map((e) => `<td>${cell(x.cells[e.exam_id])}</td>`).join('')}
    <td><b>${num(x.obtained)}</b><small>/${num(x.max)}</small></td><td>${x.pct === null ? '-' : `${x.pct}%`}</td><td><b>${esc(x.grade || '-')}</b></td>${R.has_tests_column ? `<td>${x.tests_pct === null ? '-' : `${x.tests_pct}%`}</td>` : ''}</tr>`).join('');
  const foot = `<tr class="tot"><td class="sub">Total</td>${R.exams.map((e) => { const t = R.exam_totals[e.exam_id]; return `<td>${t ? `<b>${num(t.obtained)}</b><small>/${num(t.max)}</small>` : '-'}</td>`; }).join('')}
    <td><b>${num(R.grand?.obtained)}</b><small>/${num(R.grand?.max)}</small></td><td><b>${R.grand?.pct ?? '-'}%</b></td><td><b>${esc(R.grand?.grade || '-')}</b></td>${R.has_tests_column ? '<td></td>' : ''}</tr>`;
  const att = R.attendance ? `${R.attendance.pct}%` : '-'; const attSub = R.attendance ? `${R.attendance.present} of ${R.attendance.total} days` : '';
  const pass = R.result === 'PASS';
  return `<div class="rinfo">${info.filter(([, val]) => val !== undefined && val !== null && String(val).trim() !== '').map(([k, val]) => `<div><span>${esc(k)}</span><b>${val ? esc(val) : '&nbsp;'}</b></div>`).join('')}</div>
    <table class="marks"><thead>${head}</thead><tbody>${bodyRows}</tbody><tfoot>${foot}</tfoot></table>
    <div class="rsum"><div><span>Result</span><b class="${pass ? 'ok' : 'bad'}">${esc(R.result || '-')}</b></div><div><span>Percentage</span><b>${R.grand?.pct ?? '-'}%</b></div><div><span>Grade</span><b>${esc(R.grand?.grade || '-')}</b></div><div><span>Attendance</span><b>${esc(att)}</b>${attSub ? `<small>${esc(attSub)}</small>` : ''}</div></div>
    ${R.result === 'FAIL' ? `<div class="rnote">Below pass mark in: ${esc(R.failed_subjects.join(', '))}</div>` : ''}
    <div class="rextra">${c.fields.promoted_to ? `<div><span>Promoted to class</span><b>${esc(c.fields.promoted_to)}</b></div>` : ''}${c.fields.reopen_date ? `<div><span>School re-opens on</span><b>${esc(fmtDate(c.fields.reopen_date))}</b></div>` : ''}</div>
    ${c.fields.remarks ? `<div class="remarks"><span>Class teacher's remarks</span><div>${esc(c.fields.remarks).replace(/\n/g, '<br>')}</div></div>` : ''}
    <div class="gnote">${fillText(c.body, v)}</div>`;
}

function awardHTML(c, v) {
  const s = c.subject;
  const who = s.kind === 'staff' ? [s.designation, s.department].filter(Boolean).join(', ') : s.class_label ? `Class ${s.class_label}` : '';
  return `<div class="presented">This certificate is proudly presented to</div><div class="recipient">${esc(s.name)}</div>${who ? `<div class="who">${esc(who)}</div>` : ''}${paragraphs(c.body, v, true)}`;
}

export function buildHTML(c, opts = {}) {
  const T = TYPES[c.type] || TYPES.custom;
  const design = DESIGNS.some((d) => d.id === c.design) ? c.design : 'classic';
  const accent = /^#[0-9a-fA-F]{6}$/.test(c.accent || '') ? c.accent : designOf(design).accent;
  const orient = c.orientation === 'landscape' ? 'landscape' : 'portrait';
  const cc = { ...c, design, accent, orient };
  const v = varsOf(c);
  const date = fmtDate(c.issued_on || c.today || '');
  const serial = c.serial_no || (opts.draft ? 'To be assigned' : '');
  const title = esc(c.title || T.title);

  let main;
  if (T.layout === 'tc') main = tcTable(c, v);
  else if (T.layout === 'report') main = reportHTML(c, v);
  else if (T.layout === 'award') main = awardHTML(c, v);
  else main = paragraphs(c.body, v, c.type !== 'custom');

  const meta = T.layout === 'award' ? '' : `<div class="meta"><span>${serial ? `No.: <b>${esc(serial)}</b>` : ''}</span><span>Date: <b>${esc(date)}</b></span></div>`;
  const awardSerial = T.layout === 'award' && serial ? `<div class="aserial">No. ${esc(serial)}</div>` : '';
  const mark = opts.cancelled ? '<div class="wm cancel">CANCELLED</div>' : opts.draft ? '<div class="wm">PREVIEW</div>' : '';
  const kindCls = `t-${T.layout || 'text'} ${T.align === 'center' ? 'center' : ''}`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.title || T.title)}${serial ? ` - ${esc(serial)}` : ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Great+Vibes&family=Lora:wght@400;500;600;700&family=Montserrat:wght@400;500;600;700&family=Noto+Sans+Devanagari:wght@400;600&family=Playfair+Display:wght@600;700;800&display=swap" rel="stylesheet">
<style>${designCSS(cc, c)}</style></head><body>
<div class="page ${design} ${orient} ${c.bg_url ? 'hasbg' : ''} ${kindCls}">${frameHTML(cc)}${mark}
<div class="inner">${letterheadHTML(c.school || {})}${meta}${awardSerial}<h2 class="title"><span>${title}</span></h2><main class="main">${main}</main>${signHTML(c, T, date)}</div></div></body></html>`;
}

// ---------------------------------------------------------------- styles
function designCSS(c, raw) {
  const land = c.orient === 'landscape';
  const W = land ? 297 : 210; const H = land ? 210 : 297;
  const inset = Number.isFinite(Number(raw.inset)) ? Number(raw.inset) : 18;
  const gold = '#b8913a';
  const fonts = {
    classic: ["'Playfair Display',Georgia,serif", "'Lora',Georgia,serif"], royal: ["'Playfair Display',Georgia,serif", "'Cormorant Garamond',Georgia,serif"],
    modern: ["'Montserrat','Noto Sans Devanagari',Arial,sans-serif", "'Montserrat','Noto Sans Devanagari',Arial,sans-serif"], emerald: ["'Playfair Display',Georgia,serif", "'Lora',Georgia,serif"],
    minimal: ["'Cormorant Garamond',Georgia,serif", "'Cormorant Garamond',Georgia,serif"], ribbon: ["'Montserrat','Noto Sans Devanagari',Arial,sans-serif", "'Lora',Georgia,serif"],
  }[c.design];
  const pad = { classic: 20, royal: 21, modern: 14, emerald: 19, minimal: 17, ribbon: 10 }[c.design];
  const padX = c.bg_url ? inset : pad;
  const big = c.design === 'royal' || c.design === 'minimal';
  return `
@page{size:${W}mm ${H}mm;margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;padding:0;background:#fff}
body{font-family:${fonts[1]},'Noto Sans Devanagari'}
.page{--a:${c.accent};--g:${gold};--head:${fonts[0]};position:relative;width:${W}mm;height:${H}mm;overflow:hidden;background:#fff;color:#1b1b1b;page-break-after:avoid}
.page.royal{background:#fffdf6}
.page.hasbg{background:#fff url("${esc(raw.bg_url || '')}") center/100% 100% no-repeat}
.inner{position:absolute;inset:0;padding:${land ? Math.min(padX, 16) : padX}mm ${padX + (c.design === 'modern' && !c.bg_url ? 12 : 0)}mm ${land ? Math.min(padX, 14) : padX}mm ${padX + (c.design === 'modern' && !c.bg_url ? 18 : 0)}mm;display:flex;flex-direction:column}
.page.ribbon:not(.hasbg) .inner{padding-top:0;padding-left:16mm;padding-right:16mm}
.orn{position:absolute;width:${c.design === 'royal' ? 22 : 17}mm;height:${c.design === 'royal' ? 22 : 17}mm;color:var(--g)}
.orn svg{width:100%;height:100%;display:block}
.orn.tl{top:${c.design === 'royal' ? 6 : 7}mm;left:${c.design === 'royal' ? 6 : 7}mm}.orn.tr{top:${c.design === 'royal' ? 6 : 7}mm;right:${c.design === 'royal' ? 6 : 7}mm;transform:scaleX(-1)}
.orn.bl{bottom:${c.design === 'royal' ? 6 : 7}mm;left:${c.design === 'royal' ? 6 : 7}mm;transform:scaleY(-1)}.orn.br{bottom:${c.design === 'royal' ? 6 : 7}mm;right:${c.design === 'royal' ? 6 : 7}mm;transform:scale(-1)}
.classic .f1{position:absolute;inset:8mm;border:2.4mm double var(--a)}.classic .f2{position:absolute;inset:13.5mm;border:.3mm solid var(--g)}
.royal .f1{position:absolute;inset:6mm;border:1.6mm solid var(--g)}.royal .f2{position:absolute;inset:9.5mm;border:.5mm solid var(--a)}.royal .f3{position:absolute;inset:11.5mm;border:.25mm solid var(--g)}
.modern .band{position:absolute;left:0;top:0;bottom:0;width:11mm;background:var(--a)}.modern .band2{position:absolute;left:11mm;top:0;bottom:0;width:1.6mm;background:var(--g)}
.emerald .f1{position:absolute;inset:7mm;border:1.6mm solid var(--a)}.emerald .f2{position:absolute;inset:11.5mm;border:.35mm dashed var(--a)}
.emerald .dot{position:absolute;width:5mm;height:5mm;border-radius:50%;background:var(--g);border:1mm solid #fff;box-shadow:0 0 0 .4mm var(--a)}
.emerald .dot.tl{top:4.6mm;left:4.6mm}.emerald .dot.tr{top:4.6mm;right:4.6mm}.emerald .dot.bl{bottom:4.6mm;left:4.6mm}.emerald .dot.br{bottom:4.6mm;right:4.6mm}
.minimal .f1{position:absolute;inset:10mm;border:.3mm solid #9ca3af}
.ribbon .top{position:absolute;left:0;right:0;top:0;height:${land ? 38 : 46}mm;background:var(--a)}.ribbon .bot{position:absolute;left:0;right:0;bottom:0;height:7mm;background:var(--a)}
.lh{display:flex;align-items:center;gap:6mm;text-align:center;justify-content:center;margin-bottom:3mm}
.lh-logo{flex:none;width:${land ? 20 : 24}mm;height:${land ? 20 : 24}mm;display:flex;align-items:center;justify-content:center}.lh-logo img{max-width:100%;max-height:100%;object-fit:contain}
.lh-text{flex:1;min-width:0}
.lh h1{margin:0;font-family:var(--head);font-size:${land ? 21 : 23}pt;line-height:1.15;letter-spacing:.04em;text-transform:uppercase;color:var(--a)}
.lh .tag{font-size:9.5pt;font-weight:600;margin-top:1mm;color:#333}.lh .addr{font-size:9pt;color:#444;margin-top:.6mm}.lh .reg{font-size:8.5pt;color:#555;margin-top:.6mm}
.modern .lh{text-align:left;justify-content:flex-start;border-bottom:.5mm solid var(--a);padding-bottom:4mm}.modern .lh-text{text-align:left}.modern .lh-logo:last-child{display:none}
.modern .lh h1{font-size:${land ? 18 : 19}pt;letter-spacing:.02em}
.ribbon:not(.hasbg) .lh{height:${land ? 38 : 46}mm;margin:0 -6mm 7mm;padding:0 6mm}.ribbon:not(.hasbg) .lh h1,.ribbon:not(.hasbg) .lh .tag,.ribbon:not(.hasbg) .lh .addr,.ribbon:not(.hasbg) .lh .reg{color:#fff}
.ribbon:not(.hasbg) .lh-logo{background:#fff;border-radius:50%;padding:2mm}
.minimal .lh h1{font-weight:700;letter-spacing:.12em}
.meta{display:flex;justify-content:space-between;font-size:10.5pt;margin:${land ? 1 : 3}mm 0 ${land ? 2 : 4}mm}
.aserial{text-align:center;font-size:9.5pt;color:#666;margin-bottom:1mm}
.title{margin:${land ? 2 : 3}mm 0 ${land ? 5 : 8}mm;text-align:center;font-family:var(--head);font-weight:700;font-size:${land ? 26 : 21}pt;letter-spacing:.08em;color:var(--a)}
.title span{display:inline-block;padding-bottom:2mm;border-bottom:.6mm solid var(--g)}
.royal .title{font-size:${land ? 30 : 24}pt}.royal .title span{border-bottom:none;padding:0 0 1mm;background:linear-gradient(90deg,transparent,var(--g),transparent) bottom/100% .5mm no-repeat}
.modern .title{text-align:left;font-size:${land ? 22 : 19}pt;letter-spacing:.14em}.modern .title span{border-bottom:1.2mm solid var(--g)}
.minimal .title{font-weight:600;letter-spacing:.3em;font-size:${land ? 22 : 18}pt}.minimal .title span{border-bottom:.3mm solid var(--a)}
.ribbon .title span{border:0;padding:2.4mm 14mm;background:var(--a);color:#fff;font-size:${land ? 18 : 16}pt;clip-path:polygon(0 0,100% 0,96% 50%,100% 100%,0 100%,4% 50%)}
.emerald .title span{border-bottom:none;padding:0 8mm;position:relative}.emerald .title span:before,.emerald .title span:after{content:"\\2756";position:absolute;top:50%;transform:translateY(-62%);font-size:15pt;color:var(--g)}.emerald .title span:before{left:-4mm}.emerald .title span:after{right:-4mm}
.main{flex:1;font-size:${big ? (land ? 17 : 16.5) : (land ? 14.5 : 14)}pt;line-height:${land ? 1.7 : 1.95};text-align:justify;min-height:0}
.main p{margin:0 0 4.5mm}.main b{font-weight:700}.main .blank{display:inline-block;min-width:26mm;border-bottom:.3mm solid #888;font-weight:400}
.center .main{text-align:center}
.presented{text-align:center;font-style:italic;font-size:13pt;color:#555;margin-top:1mm}
.recipient{text-align:center;font-family:'Great Vibes','Playfair Display',cursive;font-size:${land ? 40 : 34}pt;line-height:1.3;color:var(--a);margin:1mm 0 0}
.who{text-align:center;font-size:12.5pt;color:#444;margin-bottom:3mm}
.t-award .main{font-size:${land ? 15.5 : 14.5}pt;display:flex;flex-direction:column;justify-content:center}
table{border-collapse:collapse;width:100%}
.tc{font-size:11.5pt;line-height:1.35;margin-bottom:4mm}.tc td{border:.3mm solid #777;padding:1.7mm 2.4mm}.tc .n{width:9mm;text-align:center}.tc .l{width:47%;color:#222}.tc .v{font-weight:700}
.t-tc .main{font-size:11.5pt;line-height:1.5}.t-tc .main p{font-size:11pt;margin-top:3mm}
.t-report .main{font-size:10pt;line-height:1.4;text-align:left}
.rinfo{display:grid;grid-template-columns:1fr 1fr;gap:1.2mm 8mm;margin-bottom:4mm;font-size:10.5pt}.rinfo div{display:flex;gap:2mm;border-bottom:.2mm solid #ccc;padding:.8mm 0}.rinfo span{color:#555;min-width:27mm}
.marks{font-size:10pt;margin:2mm 0 3mm}.marks th{background:var(--a);color:#fff;padding:2mm 1.6mm;font-weight:600;font-size:9.5pt;border:.25mm solid var(--a)}.marks td{border:.25mm solid #999;padding:1.6mm;text-align:center}
.marks .sub{text-align:left;font-weight:600}.marks small{color:#666;font-size:8pt}.marks .tot td{background:#f1f3f6;border-top:.5mm solid var(--a)}
.rsum{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin:3mm 0}.rsum div{border:.3mm solid #aaa;border-radius:2mm;padding:2mm;text-align:center}.rsum span{display:block;font-size:8.5pt;color:#666}.rsum b{font-size:12.5pt}
.rsum small{display:block;font-size:8pt;color:#666}.rsum .ok{color:#15803d}.rsum .bad{color:#b91c1c}.rnote{font-size:9.5pt;color:#b91c1c;margin-bottom:2mm}
.rextra{display:flex;gap:10mm;font-size:10pt}.rextra div{display:flex;gap:2mm}.rextra span{color:#555}
.remarks{margin-top:3mm;font-size:10pt}.remarks span{color:#555}.remarks div{border:.3mm solid #aaa;border-radius:2mm;padding:2mm 3mm;min-height:13mm;margin-top:1mm;line-height:1.45}
.gnote{margin-top:3mm;font-size:8.5pt;color:#555;line-height:1.4}.gnote b{font-weight:400}
.signs{display:flex;align-items:flex-end;justify-content:space-between;gap:6mm;margin-top:${land ? 3 : 6}mm;font-size:10.5pt}
.pd{font-size:10pt;line-height:1.6;white-space:nowrap}
.sig{text-align:center;min-width:${land ? 48 : 38}mm;flex:0 1 auto}.sig-space{height:${land ? 10 : 14}mm}.sig-img{display:block;margin:0 auto;height:${land ? 10 : 14}mm;max-width:46mm;object-fit:contain}
.sig-line{border-top:.3mm solid #333;margin-top:1mm}.sig-name{font-weight:700;margin-top:1mm}.sig-label{font-size:9.5pt;color:#333;margin-top:.6mm}
.seal{flex:none;width:${land ? 24 : 28}mm;height:${land ? 24 : 28}mm;display:flex;align-items:center;justify-content:center}.seal img{max-width:100%;max-height:100%;object-fit:contain}
.foot{margin-top:4mm;text-align:center;font-size:8.5pt;color:#666}
.ribbon:not(.hasbg) .foot{color:#fff;position:absolute;left:0;right:0;bottom:1.2mm;margin:0}
.wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 ${land ? 90 : 80}pt Arial,sans-serif;letter-spacing:.1em;color:rgba(120,120,120,.12);transform:rotate(-30deg);pointer-events:none;z-index:5}
.wm.cancel{color:rgba(200,30,30,.2);font-size:${land ? 80 : 70}pt}
@media screen{body{background:#e5e7eb}.page{margin:0 auto}}
@media print{body{background:#fff}.page{margin:0}}
`;
}

// ---------------------------------------------------------------- a sample, used for design previews
export function sampleContent(type, school, tpl) {
  const T = TYPES[type];
  const r = resolveTemplate(type, tpl, 'student');
  const subject = { kind: 'student', name: 'Aarav Sharma', gender: 'Male', dob: '2012-03-14', father: 'Mr. Rajesh Sharma', mother: 'Mrs. Neha Sharma', class_label: '7 A', admission_no: '2019/114', roll_no: '12', designation: 'Mathematics Teacher', department: 'Senior School', joining_date: '2018-04-02' };
  const ctx = { session: '2026-27', today: new Date().toISOString().slice(0, 10), subject };
  const fields = defaultFields(type, ctx);
  if (type === 'activity') Object.assign(fields, { activity: 'Inter-school Science Quiz', achievement: 'securing First Position', event_date: ctx.today });
  if (type === 'bonafide') fields.purpose = 'opening a bank account';
  if (type === 'transfer') Object.assign(fields, { admission_date: '2019-04-05' });
  const c = {
    type, ...r, school, subject, fields, serial_no: `${TYPES[type] ? 'SAMPLE' : ''}/0001`, issued_on: ctx.today, session_name: ctx.session,
  };
  if (type === 'report_card') {
    const ex = [{ exam_id: 'a', name: 'Half-yearly' }, { exam_id: 'b', name: 'Final' }];
    const mk = (m1, m2) => ({ a: { marks: m1, max: 100 }, b: { marks: m2, max: 100 } });
    c.report = {
      session_name: ctx.session, exams: ex, exam_totals: { a: { obtained: 405, max: 500 }, b: { obtained: 431, max: 500 } }, has_tests_column: true,
      subjects: [['English', 78, 82], ['Hindi', 81, 85], ['Mathematics', 90, 94], ['Science', 84, 88], ['Social Science', 72, 82]]
        .map(([name, a, b]) => ({ name, cells: mk(a, b), obtained: a + b, max: 200, pct: Math.round(((a + b) / 2) * 10) / 10, grade: (a + b) / 2 >= 90 ? 'A+' : (a + b) / 2 >= 80 ? 'A' : 'B', tests_pct: 80 })),
      grand: { obtained: 836, max: 1000, pct: 83.6, grade: 'A' }, result: 'PASS', failed_subjects: [], attendance: { present: 168, total: 175, pct: 96 },
    };
    c.fields = { ...fields, remarks: 'Aarav is a sincere and cheerful student. Keep up the good work.', promoted_to: '8 A' };
  }
  return c;
}
