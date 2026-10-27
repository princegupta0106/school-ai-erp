// Global "find anything" search, shared by the web app and the mobile app (this file is identical in both).
// It searches every screen the signed-in person can open (module + tab), plus app actions (dark mode, change
// password, sign out...). It is fuzzy: typos ("attendence"), partial words ("fee rec"), word order and
// everyday synonyms ("certificate" finds Issue document) all work. No data leaves the device.

// everyday words people use for each screen (matched at lower weight than the real names)
const KW = {
  school: 'school profile institution campus',
  'school/list': 'schools profile edit school details address logo contact',
  'school/new': 'create add new school onboard',
  'school/calendar': 'session academic year holiday holidays calendar vacation days off',
  'school/promote': 'promote promotion year end next class students passout new session',
  users: 'people accounts',
  'users/list': 'users students teachers parents staff accounts people profile password reset role permissions access delete disable login',
  'users/add': 'add create new student teacher parent staff admission enroll register user',
  'users/classes': 'class section grade standard classes divisions',
  attendance: 'present absent roll call',
  'attendance/take': 'mark present absent late daily roll call take attendance today',
  'attendance/reports': 'attendance report percentage absentees monthly summary',
  'attendance/rolls': 'roll number numbering',
  'attendance/teachers': 'class teacher assign incharge in-charge',
  visitors: 'gate guests register',
  'visitors/list': 'visitor log gate register guests entries today',
  'visitors/add': 'new visitor entry gate check in guest',
  queries: 'enquiry enquiries inquiry inquiries admission complaint feedback request',
  'queries/list': 'enquiry enquiries inquiry admission complaint pending done status follow up track',
  'queries/new': 'new enquiry inquiry admission enquiry parent visit walk-in form record query',
  'queries/settings': 'forms statuses custom status add form configure',
  fees: 'money payment dues tuition',
  'fees/my': 'my fees pay dues receipt child payment',
  'fees/students': 'collect fee payment receipt pending dues discount adjust cancel student fees outstanding',
  'fees/structure': 'fee structure tuition amount per class terms installments',
  communication: 'notice message chat announcement',
  'communication/board': 'notice announcement circular board news post',
  'communication/messages': 'chat message inbox talk parent teacher',
  'communication/notify': 'push notification alert send notify broadcast',
  academics: 'marks exams results tests',
  'academics/my': 'marks results report card grades child performance',
  'academics/tests': 'enter marks test exam paper assessment grades score',
  'academics/reports': 'academic report toppers performance results ranking',
  'academics/exams': 'exam half yearly final term create',
  'academics/subjects': 'subject syllabus add subject',
  payroll: 'salary leave pay',
  'payroll/my': 'leave apply payslip salary balance my pay holiday',
  'payroll/requests': 'leave approve reject requests pending',
  'payroll/balances': 'leave balance grant adjust',
  'payroll/payroll': 'salary payroll run bonus deduction payslip payments staff pay',
  'payroll/settings': 'leave types rules approval policy pay rules',
  documents: 'certificate letter print',
  'documents/issue': 'certificate bonafide character transfer leaving report card issue print generate',
  'documents/issued': 'issued certificates history cancelled list',
  'documents/templates': 'template wording design certificate format',
  'documents/letterhead': 'letterhead logo header school stamp signature',
  'documents/my': 'my certificates documents download',
  homework: 'assignment study',
  'homework/my': 'assignment submit homework due my',
  'homework/manage': 'post homework assignment study material check submissions give',
  audit: 'security history log',
  'audit/log': 'audit log who did what history security activity trail export',
  backup: 'data export restore',
  'backup/backup': 'backup restore download data export database save',
};

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s) => clean(s).split(' ').filter(Boolean).map(stem);

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const subseq = (t, w) => { let i = 0; for (const c of w) if (c === t[i]) i++; return i === t.length; };

// how well one typed word matches one indexed word (0 = no match)
function wordScore(t, w, loose) {
  if (t === w) return 10;
  if (w.startsWith(t)) return 8;
  if (t.length >= 3 && w.includes(t)) return 5;
  if (t.length >= 4 && (loose || t.length >= 5)) {
    const max = t.length >= 7 ? 2 : 1;
    if (lev(t, w, max) <= max) return 6 - (t.length >= 7 ? 1 : 0);
    if (lev(t, w.slice(0, t.length), max) <= max) return 4; // typo inside a longer word
  }
  if (loose && t.length >= 3 && subseq(t, w)) return 2;
  return 0;
}

// item: { id, label, hint, kind, icon, color, ...extra }  ->  adds .w (label words) .k (keyword words) .m (module words)
export function buildIndex({ targets = [], modules = {}, extras = [] }) {
  const out = [];
  for (const [key, m] of Object.entries(modules)) {
    if (!m) continue;
    out.push({ id: key, kind: 'nav', path: key, label: m.label, hint: 'Module', icon: m.icon, color: m.color, w: words(m.label), k: words(`${KW[key] || ''} ${m.desc || ''}`), m: [] });
  }
  for (const t of targets) {
    if (t.action) continue;
    out.push({ id: t.id, kind: 'nav', path: t.id, label: t.label, hint: t.moduleLabel, icon: t.icon, color: t.color, w: words(t.label), k: words(KW[t.id] || ''), m: words(t.moduleLabel) });
  }
  for (const e of extras) out.push({ ...e, kind: e.kind || 'action', w: words(e.label), k: words(e.kw || ''), m: [] });
  return out;
}

function scoreItem(item, tokens, whole) {
  let total = 0;
  for (const t of tokens) {
    let best = 0;
    for (const w of item.w) best = Math.max(best, wordScore(t, w, true) * 3);
    for (const w of item.k) best = Math.max(best, wordScore(t, w) * 1.6);
    for (const w of item.m) best = Math.max(best, wordScore(t, w) * 1.2);
    if (!best) return 0;
    total += best;
  }
  const label = clean(item.label);
  if (label === whole) total += 40;
  else if (label.startsWith(whole)) total += 20;
  if (item.kind === 'nav' && item.hint === 'Module') total -= 1; // a screen wins over its module on a tie
  return total;
}

export function search(index, query, limit = 7) {
  const whole = clean(query);
  if (!whole) return [];
  const tokens = words(query);
  if (!tokens.length) return [];
  return index.map((it) => ({ it, s: scoreItem(it, tokens, whole) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.it);
}

// shown when the box is focused but empty
export const suggestions = (index, n = 6) => index.filter((i) => i.kind === 'nav' && i.hint !== 'Module').slice(0, n);
