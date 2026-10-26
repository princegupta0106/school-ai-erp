// k6 load test (https://k6.io). Same traffic as quick-load.mjs, with k6's own p95 thresholds and reports.
//
//   k6 run -e BASE=http://localhost:3000 k6-load.js                         # default: ramp 0 -> 50 users
//   k6 run -e BASE=https://your-TEST-server.onrender.com -e PEAK=100 k6-load.js
//   k6 run --out json=result.json k6-load.js                                # keep the raw numbers
//
// Signs in ONCE per persona in setup() (login is rate-limited to 30 per 5 min per IP) and shares the tokens.
// k6 prints p(90), p(95) and the max for every named request at the end; the thresholds below turn red when too slow.
import http from 'k6/http';
import { check, sleep, group } from 'k6';

const BASE = (__ENV.BASE || 'http://localhost:3000').replace(/\/$/, '');
const PEAK = Number(__ENV.PEAK || 50);          // users at the same time at the top of the ramp
const PASSWORD = __ENV.PASSWORD || 'Load@1234';
const P95 = Number(__ENV.P95 || 800);           // ms

export const options = {
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  stages: [
    { duration: '30s', target: Math.ceil(PEAK / 5) },  // warm-up
    { duration: '1m', target: PEAK },                  // ramp to peak
    { duration: '2m', target: PEAK },                  // hold peak
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],                    // under 1% errors
    http_req_duration: [`p(95)<${P95}`, 'p(99)<2000'], // overall
    // per screen (the request names set in `tags` below). Heavy ones get more room.
    'http_req_duration{name:attendance daily}': [`p(95)<${P95}`],
    'http_req_duration{name:attendance class report}': [`p(95)<${P95}`],
    'http_req_duration{name:fee pending}': [`p(95)<${P95}`],
    'http_req_duration{name:audit page 1}': [`p(95)<${P95}`],
    'http_req_duration{name:parent notifications}': [`p(95)<${P95}`],
    'http_req_duration{name:ALL users (heavy)}': ['p(95)<2500'],
  },
};

const day = (back = 0) => new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
const lastWorkday = () => { let b = 1; while (new Date(Date.now() - b * 864e5).getUTCDay() === 0) b++; return day(b); };
const j = (token) => ({ headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });

function login(id) {
  const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ login_id: id, password: PASSWORD }), { headers: { 'Content-Type': 'application/json' } });
  if (r.status !== 200) throw new Error(`Sign-in failed for ${id}: ${r.status} ${r.body}`);
  return r.json('token');
}

export function setup() {
  const admin = login(__ENV.ADMIN || 'bigadmin');
  const teacher = login(__ENV.TEACHER || 'bigteacher1');
  const parent = login(__ENV.PARENT || 'bigparent1');
  const classes = http.get(`${BASE}/api/classes`, j(admin)).json();
  if (!classes.length) throw new Error('No classes - run the seed files first');
  return { admin, teacher, parent, classId: classes[Math.floor(classes.length / 2)].id };
}

const get = (path, token, name) => {
  const r = http.get(`${BASE}/api${path}`, { ...j(token), tags: { name } });
  check(r, { [`${name}: 200`]: (x) => x.status === 200 });
  return r;
};

// three kinds of people, in realistic proportions: 20% office/admin, 25% teachers, 55% parents
export default function (d) {
  const roll = Math.random();
  if (roll < 0.20) {
    group('admin', () => {
      get('/auth/me', d.admin, 'me');
      get('/classes', d.admin, 'classes');
      get(`/attendance/reports/daily?date=${lastWorkday()}`, d.admin, 'attendance daily');
      get(`/attendance/reports/class?class_id=${d.classId}&from=${day(60)}&to=${day(1)}`, d.admin, 'attendance class report');
      get('/fees/students?limit=50', d.admin, 'fee students');
      get('/fees/pending?limit=50', d.admin, 'fee pending');
      get('/fees/payments?limit=50', d.admin, 'fee payments');
      get(`/academics/assessments?class_id=${d.classId}`, d.admin, 'assessments');
      get('/audit?limit=50', d.admin, 'audit page 1');
      if (Math.random() < 0.2) get('/users', d.admin, 'ALL users (heavy)');
    });
  } else if (roll < 0.45) {
    group('teacher', () => {
      get(`/attendance/classes?date=${lastWorkday()}`, d.teacher, 'teacher attendance classes');
      get(`/attendance/sheet?class_id=${d.classId}&date=${lastWorkday()}`, d.teacher, 'attendance sheet');
      get('/homework/assignments', d.teacher, 'homework list');
    });
  } else {
    group('parent', () => {
      get('/notifications', d.parent, 'parent notifications');
      get('/communication/announcements?limit=20', d.parent, 'parent notices');
      get('/communication/conversations', d.parent, 'parent chats');
      get('/fees/my', d.parent, 'parent fees');
    });
  }
  sleep(1 + Math.random() * 3); // people read the screen before the next tap
}
