import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../cache.js';
import { Icon, Empty, Loading, initials, groupByClass, ClassGroup } from '../ui.jsx';
import { scoped } from './AttendanceModule.jsx';
import { Rides } from './TransportModule.jsx';

/* ------------------------------------------------------------------ helpers */
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fdate = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, o) : '—');
const mon = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });
const useDebounced = (v, ms = 250) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; };
const tone = (p, hi = 85, mid = 60) => (p === null || p === undefined ? 'mute' : p >= hi ? 'ok' : p >= mid ? 'warn' : 'bad');
const HUES = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6'];
const hueOf = (s) => HUES[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const STATE = { checked: ['ok', 'Checked'], submitted: ['info', 'Submitted'], pending: ['warn', 'Pending'], overdue: ['bad', 'Overdue'], info: ['mute', 'For reading'] };

/* ------------------------------------------------------------------ small visuals */
function Ring({ value, size = 92, stroke = 10, color = 'var(--sp-ok)', label, sub }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="sp-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${value ?? 'no data'}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sp-track)" strokeWidth={stroke} />
        {value !== null && value !== undefined && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <div className="sp-ring-t"><b>{value === null || value === undefined ? '–' : `${Math.round(value)}%`}</b>{sub && <small>{sub}</small>}</div>
    </div>
  );
}
const Bar = ({ pct, color }) => <div className="sp-bar"><i style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, background: color }} /></div>;

function Card({ id, title, icon, color, action, children, cls = '' }) {
  return (
    <section id={id} className={`sp-card ${cls}`} style={{ '--c': color }}>
      <header><span className="sp-ic"><Icon name={icon} size={17} /></span><h3>{title}</h3><span className="sp-act">{action}</span></header>
      {children}
    </section>
  );
}
const Kpi = ({ icon, color, label, value, sub, t }) => (
  <div className={`sp-kpi ${t || ''}`} style={{ '--c': color }}>
    <span className="sp-ic"><Icon name={icon} size={18} /></span>
    <div><small>{label}</small><b>{value}</b>{sub && <em>{sub}</em>}</div>
  </div>
);
const Fact = ({ label, value }) => (value ? <div className="sp-fact"><small>{label}</small><b>{value}</b></div> : null);
const Soft = ({ children }) => <div className="sp-soft">{children}</div>;

/* ------------------------------------------------------------------ sections */
function Attendance({ a }) {
  if (!a) return <Soft>Attendance is not available.</Soft>;
  const s = a.summary; const months = a.months || [];
  if (!s.total) return <Soft>No attendance has been marked yet.</Soft>;
  return (
    <>
      <div className="sp-att">
        <Ring value={s.percent} color={s.percent >= 90 ? 'var(--sp-ok)' : s.percent >= 75 ? 'var(--sp-warn)' : 'var(--sp-bad)'} label="Attendance" sub={`${s.total} days`} />
        <div className="sp-chips">
          <span className="sp-chip ok"><b>{s.present}</b>Present</span><span className="sp-chip bad"><b>{s.absent}</b>Absent</span>
          <span className="sp-chip warn"><b>{s.late}</b>Late</span><span className="sp-chip info"><b>{s.leave}</b>Leave</span>
        </div>
      </div>
      {months.length > 0 && (
        <div className="sp-months" aria-label="Attendance by month">
          {months.slice(-8).map((m) => (
            <div key={m.month} title={`${mon(m.month)}: ${m.percent ?? 0}%`}>
              <div className="sp-col"><i className={tone(m.percent, 90, 75)} style={{ height: `${Math.max(6, m.percent ?? 0)}%` }} /></div>
              <small>{mon(m.month)}</small><b>{m.percent === null ? '–' : `${Math.round(m.percent)}%`}</b>
            </div>
          ))}
        </div>
      )}
      {a.absences?.length > 0 && (
        <div className="sp-rec"><small>Recent absences</small>
          <div className="sp-dots">{a.absences.slice(0, 6).map((x) => <span key={x.date} className={`sp-chip mini ${x.status === 'absent' ? 'bad' : x.status === 'late' ? 'warn' : 'info'}`}>{fdate(x.date, { day: 'numeric', month: 'short' })} · {x.status}</span>)}</div>
        </div>
      )}
    </>
  );
}

function Academics({ ac }) {
  if (!ac) return <Soft>Marks are not available.</Soft>;
  const subs = ac.subjects || []; const exams = ac.exams || [];
  if (!subs.length) return <Soft>No marks have been entered yet.</Soft>;
  return (
    <>
      <div className="sp-subj">
        {subs.map((s) => {
          const p = s.overall?.pct; const col = hueOf(s.name);
          return (
            <div className="sp-srow" key={s.subject_id}>
              <span className="sp-dot" style={{ background: col }} /><b>{s.name}</b>
              <Bar pct={p} color={col} /><span className={`sp-pct ${tone(p)}`}>{p === null || p === undefined ? '–' : `${Math.round(p)}%`}</span><em>{s.overall?.grade || ''}</em>
            </div>
          );
        })}
      </div>
      {exams.length > 0 && (
        <div className="sp-exams">
          {exams.slice(0, 4).map((e) => (
            <div key={e.exam_id} className={`sp-exam ${tone(e.total?.pct)}`}>
              <small>{e.name}</small><b>{e.total?.pct === null || e.total?.pct === undefined ? '–' : `${Math.round(e.total.pct)}%`}</b>
              <span>{e.total?.grade ? `Grade ${e.total.grade}` : ''}{e.failed ? ` · ${e.failed} to improve` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Fees({ f, go, staff }) {
  if (!f) return <Soft>Fee details are not shared with your role.</Soft>;
  if (f.error) return <Soft>Fees are not available right now.</Soft>;
  const t = f.ledger.totals; const paidPct = t.total ? (t.paid / t.total) * 100 : 0;
  if (!f.has_structure && !t.total) return <Soft>No fee structure has been set for this class yet.</Soft>;
  const upcoming = (f.ledger.lines || []).filter((l) => l.pending > 0).slice(0, 4);
  return (
    <>
      <div className="sp-fee-top">
        <div className="sp-money"><small>Paid</small><b className="ok">{rupees(t.paid)}</b></div>
        <div className="sp-money"><small>Balance</small><b className={t.pending > 0 ? 'bad' : 'ok'}>{rupees(t.pending)}</b></div>
        <div className="sp-money"><small>Total ({f.session?.name})</small><b>{rupees(t.total)}</b></div>
      </div>
      <Bar pct={paidPct} color="var(--sp-ok)" />
      <div className="sp-note">{t.pending <= 0 ? '✅ All fees are paid.' : t.due_till_date > 0 ? <>⚠️ <b>{rupees(t.due_till_date)}</b> is due now.</> : t.next_due_date ? <>Next payment <b>{rupees(t.next_due_amount)}</b> on {fdate(t.next_due_date)}.</> : null}</div>
      {upcoming.length > 0 && <div className="sp-lines">{upcoming.map((l, i) => <div key={i}><span>{l.label}</span><small>{fdate(l.due_date, { day: 'numeric', month: 'short' })}</small><b className={l.overdue ? 'bad' : ''}>{rupees(l.pending)}</b></div>)}</div>}
      {f.payments?.length > 0 && (
        <div className="sp-rec"><small>Latest receipts</small>
          <div className="sp-lines">{f.payments.filter((p) => p.status !== 'cancelled').slice(0, 3).map((p) => <div key={p.id}><span>#{p.receipt_no}</span><small>{fdate(p.paid_on, { day: 'numeric', month: 'short' })}</small><b className="ok">{rupees(p.amount)}</b></div>)}</div>
        </div>
      )}
      {staff && go && <button className="btn sp-link" onClick={() => go('fees', 'students')}>Open in Fees <Icon name="chevron" size={15} /></button>}
    </>
  );
}

function Homework({ h }) {
  if (!h) return <Soft>Homework is not available.</Soft>;
  if (!h.total) return <Soft>No homework has been posted for this class yet.</Soft>;
  return (
    <>
      <div className="sp-chips">
        <span className="sp-chip ok"><b>{h.submitted}</b>Done</span><span className="sp-chip warn"><b>{h.pending}</b>Pending</span><span className="sp-chip bad"><b>{h.overdue}</b>Overdue</span>
      </div>
      <div className="sp-hw">
        {h.items.slice(0, 6).map((i) => { const [t, l] = STATE[i.state] || STATE.info; return (
          <div key={i.id}><span className="sp-dot" style={{ background: hueOf(i.subject) }} /><div><b>{i.title}</b><small>{i.subject || 'General'}{i.due_date ? ` · due ${fdate(i.due_date, { day: 'numeric', month: 'short' })}` : ''}</small></div><span className={`sp-chip mini ${t}`}>{l}{i.late ? ' · late' : ''}</span></div>
        ); })}
      </div>
    </>
  );
}

function Personal({ s, parents }) {
  const guardians = [
    s.father_name && { n: s.father_name, r: 'Father', p: s.father_phone, o: s.father_occupation },
    s.mother_name && { n: s.mother_name, r: 'Mother', p: s.mother_phone, o: s.mother_occupation },
  ].filter(Boolean);
  const linked = (parents || []).filter((p) => !guardians.some((g) => g.p && g.p === p.phone));
  return (
    <>
      <div className="sp-facts">
        <Fact label="Date of birth" value={s.dob ? fdate(s.dob) : null} /><Fact label="Gender" value={s.gender} /><Fact label="Blood group" value={s.blood_group} />
        <Fact label="Admission no." value={s.admission_no} /><Fact label="Phone" value={s.phone} /><Fact label="Email" value={s.email} />
      </div>
      {s.address && <div className="sp-addr"><Icon name="pin" size={15} /><span>{s.address}</span></div>}
      <div className="sp-fam">
        {guardians.map((g) => <div key={g.r} className="sp-person"><span className="sp-av" style={{ background: hueOf(g.n) }}>{initials(g.n)}</span><div><b>{g.n}</b><small>{g.r}{g.o ? ` · ${g.o}` : ''}</small></div>{g.p && <a className="icon-btn" href={`tel:${g.p}`} aria-label={`Call ${g.n}`}><Icon name="phone" size={17} /></a>}</div>)}
        {linked.map((p) => <div key={p.user_id} className="sp-person"><span className="sp-av" style={{ background: hueOf(p.full_name) }}>{initials(p.full_name)}</span><div><b>{p.full_name}</b><small>Parent account{p.phone ? ` · ${p.phone}` : ''}</small></div>{p.phone && <a className="icon-btn" href={`tel:${p.phone}`} aria-label="Call"><Icon name="phone" size={17} /></a>}</div>)}
        {s.emergency_contact_name && <div className="sp-person emg"><span className="sp-av" style={{ background: '#ef4444' }}>!</span><div><b>{s.emergency_contact_name}</b><small>Emergency contact</small></div>{s.emergency_contact_phone && <a className="icon-btn" href={`tel:${s.emergency_contact_phone}`} aria-label="Call emergency contact"><Icon name="phone" size={17} /></a>}</div>}
      </div>
    </>
  );
}

function Documents({ docs }) {
  if (!docs) return <Soft>Documents are not available.</Soft>;
  if (!docs.length) return <Soft>No certificates or report cards issued yet.</Soft>;
  return <div className="sp-lines docs">{docs.map((d) => <div key={d.id}><span><Icon name="doc" size={15} /> {d.title || d.doc_type}</span><small>{fdate(d.issued_at)}</small><b className={d.status === 'cancelled' ? 'bad' : ''}>{d.status === 'cancelled' ? 'Cancelled' : `#${d.serial_no}`}</b></div>)}</div>;
}

/* ------------------------------------------------------------------ the whole profile */
const NAV = [['sp-att', 'Attendance'], ['sp-acad', 'Marks'], ['sp-fees', 'Fees'], ['sp-hw', 'Homework'], ['sp-info', 'Family'], ['sp-docs', 'Documents'], ['sp-bus', 'Transport']];

function Profile({ me, studentId, sid, go, onBack }) {
  const [session, setSession] = useState('');
  const q = new URLSearchParams({ ...(me.role === 'super_admin' ? { school_id: sid } : {}), ...(session ? { session_id: session } : {}) }).toString();
  const { data: d, error } = useApi(`/student-profile/${studentId}${q ? `?${q}` : ''}`, true, { keepPrevious: true });
  const root = useRef(null);
  if (error) return <div className="stack">{onBack && <button className="btn" onClick={onBack}><Icon name="back" size={16} /> Back</button>}<div className="err">{error}</div></div>;
  if (!d) return <Loading rows={6} />;
  const s = d.student; const att = d.attendance && !d.attendance.error ? d.attendance : null;
  const ac = d.academics && !d.academics.error ? d.academics : null; const fe = d.fees && !d.fees.error ? d.fees : d.fees;
  const hw = d.homework && !d.homework.error ? d.homework : null; const docs = Array.isArray(d.documents) ? d.documents : null;
  const ap = att?.summary?.percent ?? null; const mp = ac?.summary?.overall?.pct ?? null; const t = fe?.ledger?.totals;
  const col = hueOf(s.full_name);
  const jump = (id) => root.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const sessions = ac?.sessions || [];
  const bus = d.transport && !d.transport.error ? d.transport : null; const showBus = !!(d.viewer.can_transport && bus); // hidden if the school has not set up transport

  return (
    <div className="sp" ref={root}>
      {onBack && <button className="btn sp-back" onClick={onBack}><Icon name="back" size={16} /> All students</button>}

      <div className="sp-hero" style={{ '--c': col }}>
        <div className="sp-avatar" style={{ background: `linear-gradient(135deg, ${col}, color-mix(in srgb, ${col} 55%, #000))` }}>{initials(s.full_name)}</div>
        <div className="sp-id">
          <h2>{s.full_name}</h2>
          <div className="sp-meta">
            {s.class_label && <span>Class {s.class_label}</span>}{s.roll_no && <span>Roll {s.roll_no}</span>}{s.admission_no && <span>Adm. {s.admission_no}</span>}<span>ID {s.login_id}</span>
          </div>
          <div className="sp-tags">{s.graduated && <span className="sp-chip info">Left school</span>}{d.tags.map((x, i) => <span key={i} className={`sp-chip ${x.tone}`}>{x.label}</span>)}</div>
        </div>
        {sessions.length > 1 && (
          <select className="sp-sess" aria-label="Academic session" value={ac?.session_id || ''} onChange={(e) => setSession(e.target.value)}>
            {sessions.map((x) => <option key={x.id} value={x.id}>{x.name}{x.is_current ? ' (current)' : ''}</option>)}
          </select>
        )}
      </div>

      <div className="sp-kpis">
        <Kpi icon="attendance" color="#0ea5e9" label="Attendance" value={ap === null ? '–' : `${Math.round(ap)}%`} sub={att ? `${att.summary.absent} absent` : ''} t={tone(ap, 90, 75)} />
        <Kpi icon="academics" color="#8b5cf6" label="Average marks" value={mp === null ? '–' : `${Math.round(mp)}%`} sub={ac?.summary?.overall?.grade ? `Grade ${ac.summary.overall.grade}` : ''} t={tone(mp)} />
        {d.viewer.can_fees && <Kpi icon="rupee" color="#10b981" label="Fee balance" value={t ? rupees(t.pending) : '–'} sub={t ? (t.pending <= 0 ? 'All paid' : t.due_till_date > 0 ? `${rupees(t.due_till_date)} due now` : 'Not yet due') : ''} t={t ? (t.pending <= 0 ? 'ok' : t.due_till_date > 0 ? 'bad' : 'warn') : ''} />}
        <Kpi icon="file" color="#f59e0b" label="Homework" value={hw ? `${hw.submitted}/${hw.submitted + hw.pending + hw.overdue}` : '–'} sub={hw ? (hw.overdue ? `${hw.overdue} overdue` : hw.pending ? `${hw.pending} pending` : 'Up to date') : ''} t={hw ? (hw.overdue ? 'bad' : hw.pending ? 'warn' : 'ok') : ''} />
      </div>

      <nav className="sp-nav" aria-label="Profile sections">{NAV.filter(([id]) => (id !== 'sp-fees' || d.viewer.can_fees) && (id !== 'sp-bus' || showBus)).map(([id, l]) => <button key={id} className="pill" onClick={() => jump(id)}>{l}</button>)}</nav>

      <div className="sp-grid">
        <Card id="sp-att" title="Attendance" icon="attendance" color="#0ea5e9" cls="w5"><Attendance a={att} /></Card>
        <Card id="sp-acad" title="Marks & performance" icon="academics" color="#8b5cf6" cls="w7"><Academics ac={ac} /></Card>
        {d.viewer.can_fees && <Card id="sp-fees" title="Fees" icon="rupee" color="#10b981" cls="w7"><Fees f={fe} go={go} staff={!d.viewer.family && me.features.some((f) => ['view_student_fees', 'collect_fees'].includes(f))} /></Card>}
        <Card id="sp-hw" title="Homework" icon="file" color="#f59e0b" cls={d.viewer.can_fees ? 'w5' : 'w12'}><Homework h={hw} /></Card>
        <Card id="sp-info" title="Personal & family" icon="users" color="#ec4899" cls="w7"><Personal s={s} parents={Array.isArray(d.parents) ? d.parents : []} /></Card>
        <Card id="sp-docs" title="Certificates & report cards" icon="doc" color="#65a30d" cls="w5"><Documents docs={docs} /></Card>
        {showBus && <Card id="sp-bus" title="Transport" icon="bus" color="#f97316" cls="w12">{bus.assigned ? <Rides rides={bus.rides} /> : <Soft>No school bus is assigned.</Soft>}</Card>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ entry points */
// staff: search, pick, open
export const StudentProfile = scoped(function StaffProfile({ me, sid, go }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [pick, setPick] = useState(() => { try { return sessionStorage.getItem('sp:last') || ''; } catch { return ''; } });
  const sq = me.role === 'super_admin' ? `&school_id=${sid}` : '';
  const { data: list, loading, error } = useApi(`/student-profile/search?q=${encodeURIComponent(dq)}${sq}`, !pick, { keepPrevious: true });
  const open = (id) => { setPick(id); try { sessionStorage.setItem('sp:last', id); } catch { /* ignore */ } };
  const close = () => { setPick(''); try { sessionStorage.removeItem('sp:last'); } catch { /* ignore */ } };
  if (pick) return <Profile key={pick} me={me} sid={sid} studentId={pick} onBack={close} go={(m, v) => { location.hash = `${m}/${v}`; }} />;
  return (
    <div className="stack">
      <div className="sp-search"><Icon name="search" size={18} /><input autoFocus placeholder="Search by name, roll no. or ID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {error && <div className="err">{error}</div>}
      {!list && loading && <Loading />}
      {list && !list.length && <Empty>{q ? 'No student matches that search.' : 'No students found in the classes you can use.'}</Empty>}
      {groupByClass(list || [], (x) => x.class_label).map((g) => (
        <ClassGroup key={g.label} label={g.label} count={g.items.length} open={!!q}>
          <div className="sp-list">
            {g.items.map((x) => (
              <button key={x.student_id} className="sp-li" onClick={() => open(x.student_id)} style={{ '--c': hueOf(x.full_name) }}>
                <span className="sp-av" style={{ background: hueOf(x.full_name) }}>{initials(x.full_name)}</span>
                <span><b>{x.full_name}</b><small>{x.roll_no ? `Roll ${x.roll_no} · ` : ''}{x.login_id}</small></span>
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </div>
        </ClassGroup>
      ))}
    </div>
  );
});

// parent / student: own (or children's) profile
export function MyStudentProfile({ me }) {
  const { data: kids, error } = useApi('/student-profile/my', true);
  const [pick, setPick] = useState('');
  const cur = pick || kids?.[0]?.student_id;
  if (error) return <div className="err">{error}</div>;
  if (!kids) return <Loading rows={6} />;
  if (!kids.length) return <Empty>No student is linked to your account yet. Ask the school office.</Empty>;
  return (
    <div className="stack sp-wrap">
      {kids.length > 1 && <div className="pills scroll">{kids.map((k) => <button key={k.student_id} className={`pill ${cur === k.student_id ? 'on' : ''}`} onClick={() => setPick(k.student_id)}>{k.full_name}</button>)}</div>}
      <Profile key={cur} me={me} studentId={cur} sid={me.school_id} go={null} />
    </div>
  );
}
