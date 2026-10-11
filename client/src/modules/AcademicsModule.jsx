import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useData } from '../cache.js';
import { Icon, Modal, Empty, Field, toast } from '../ui.jsx';
import { scoped } from './AttendanceModule.jsx';

/* ------------------------------------------------------------------ helpers */
const sup = (me) => me.role === 'super_admin';
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, v)); const s = p.toString(); return s ? `?${s}` : ''; };
const scopeQ = (me, sid) => (sup(me) ? { school_id: sid } : {});
const aget = (me, sid, path, params = {}) => api.get(`/academics${path}${qs({ ...scopeQ(me, sid), ...params })}`);
const asend = (method, me, sid, path, body = {}) => api[method](`/academics${path}`, { ...body, ...scopeQ(me, sid) });
const adel = (me, sid, path) => api.del(`/academics${path}${qs(scopeQ(me, sid))}`);
const fmtDate = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, o) : '');
const num = (n) => (n === null || n === undefined ? '-' : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const tone = (v) => (v >= 75 ? 'ok' : v >= 50 ? 'mid' : 'low');

const useMeta = (me, sid) => useData(`acad:meta:${sid}`, () => aget(me, sid, '/meta'));
const Pct = ({ v }) => (v === null || v === undefined ? <span className="pct none">-</span> : <span className={`pct ${tone(v)}`}>{v}%</span>);
const Bar = ({ v }) => <span className="bar"><i className={tone(v ?? 0)} style={{ width: `${Math.min(100, v ?? 0)}%` }} /></span>;
const Grade = ({ g }) => (g ? <span className={`grade g-${g[0]}`}>{g}</span> : null);
const Tile = ({ n, label }) => <div className="tile"><b>{n}</b><span>{label}</span></div>;

function csv(name, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([`﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function SessionSelect({ meta, value, onChange }) {
  return (
    <select aria-label="Session" style={{ width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{meta.sessions.find((s) => s.is_current)?.name ? `${meta.sessions.find((s) => s.is_current).name} (current)` : 'Current session'}</option>
      {meta.sessions.filter((s) => !s.is_current).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      <option value="all">All sessions</option>
    </select>
  );
}

/* ================================================================== STUDENT DASHBOARD (marks, subjects, tests, exams) */
// mode 'my' = a student / parent reading their own data, 'staff' = a teacher opening a student from a report
export function StudentAcademics({ me, sid, studentId, mode, onBack }) {
  const [session, setSession] = useState('');
  const [tab, setTab] = useState('overview');
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => {
    let live = true; setErr('');
    const p = mode === 'my' ? api.get(`/academics/my${qs({ student_id: studentId, session_id: session })}`) : aget(me, sid, `/reports/student/${studentId}`, { session_id: session });
    p.then((x) => live && setD(x)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [studentId, session, mode, sid]); // eslint-disable-line
  if (err) return <div className="stack">{onBack && <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={onBack}><Icon name="back" />Back</button>}<div className="err">{err}</div></div>;
  if (!d) return <Empty>Loading...</Empty>;
  const s = d.summary;
  const meta = { sessions: d.sessions };
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="card row sp">
        <div className="row">
          {onBack && <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>}
          <div><b style={{ fontSize: 18 }}>{d.student.name}</b><div className="muted" style={{ fontSize: 14 }}>{[d.student.class_label && `Class ${d.student.class_label}`, d.student.roll_no && `Roll ${d.student.roll_no}`].filter(Boolean).join(' - ') || 'Student'}</div></div>
        </div>
        <SessionSelect meta={meta} value={session} onChange={setSession} />
      </div>
      <div className="asum">
        <div className="tile big"><b><Pct v={s.overall.pct} /></b><span>Overall {s.overall.grade ? `(${s.overall.grade})` : ''}</span></div>
        <div className="tile"><b><Pct v={s.tests.pct} /></b><span>Tests ({s.tests.count})</span></div>
        <div className="tile"><b><Pct v={s.exams.pct} /></b><span>Exams ({s.exams.count})</span></div>
        <div className="tile"><b>{d.subjects.length}</b><span>Subjects</span></div>
      </div>
      <nav className="pills">{[['overview', 'Overview'], ['subjects', 'Subjects'], ['tests', `Tests (${d.tests.length})`], ['exams', `Exams (${d.exams.length})`]].map(([k, l]) => <button key={k} className={`pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {tab === 'overview' && <Overview d={d} setTab={setTab} />}
      {tab === 'subjects' && <Subjects d={d} />}
      {tab === 'tests' && <Tests d={d} />}
      {tab === 'exams' && <Exams d={d} />}
    </div>
  );
}

function Overview({ d, setTab }) {
  const recent = useMemo(() => [...d.tests, ...d.exams.flatMap((e) => e.papers)].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6), [d]);
  if (!d.subjects.length) return <Empty>No marks have been entered yet{d.session_id ? ' for this session' : ''}.</Empty>;
  return (<>
    <div className="card">
      <b>Subjects</b>
      <div className="subjlist">{d.subjects.map((s) => (
        <div key={s.subject_id} className="subjrow"><span className="ellip">{s.name}</span><Bar v={s.overall.pct} /><Pct v={s.overall.pct} /></div>))}</div>
    </div>
    <div className="card" style={{ padding: 0 }}>
      <div className="row sp" style={{ padding: '14px 16px 6px' }}><b>Latest results</b><button className="linkbtn" onClick={() => setTab('tests')}>All tests</button></div>
      {recent.map((r) => <ResultRow key={r.id} r={r} />)}
    </div>
  </>);
}

function ResultRow({ r }) {
  return (
    <div className="drow" style={{ cursor: 'default' }}>
      <div style={{ flex: 1, minWidth: 0 }}><b className="ellip" style={{ display: 'block' }}>{r.subject}</b><small>{r.title} - {fmtDate(r.date)}{r.kind === 'exam' && <> - <span className="chip">Exam</span></>}</small></div>
      <div className="dstate">
        {r.absent ? <span className="chip absent">Absent</span> : <><b>{num(r.marks)} <span className="muted" style={{ fontWeight: 400 }}>/ {num(r.max_marks)}</span></b><span><Pct v={r.pct} /> <Grade g={r.grade} /></span></>}
        {r.class_avg_pct !== null && !r.absent && <small>Class avg {r.class_avg_pct}%</small>}
      </div>
    </div>
  );
}

function Subjects({ d }) {
  if (!d.subjects.length) return <Empty>No subjects yet.</Empty>;
  return <div className="cgrid">{d.subjects.map((s) => (
    <div key={s.subject_id} className={`ccard static`}>
      <div className="row sp"><b className="cname" style={{ fontSize: 18 }}>{s.name}</b><span><Pct v={s.overall.pct} /> <Grade g={s.overall.grade} /></span></div>
      <Bar v={s.overall.pct} />
      <div className="mini"><span>Tests: {s.tests.count ? `${s.tests.pct}% (${s.tests.count})` : 'none'}</span><span>Exams: {s.exams.count ? `${s.exams.pct}% (${s.exams.count})` : 'none'}</span></div>
      {s.recent.length > 1 && <Spark pts={s.recent.map((x) => x.pct)} />}
    </div>))}</div>;
}
function Spark({ pts }) {
  const w = 160; const h = 34; const step = w / (pts.length - 1);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(h - 3 - (Math.min(100, p) / 100) * (h - 6)).toFixed(1)}`).join('');
  return <svg width={w} height={h} role="img" aria-label={`Recent results: ${pts.join('%, ')}%`}><path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function Tests({ d }) {
  const [sub, setSub] = useState('');
  const rows = d.tests.filter((t) => !sub || t.subject_id === sub);
  return (<>
    <select style={{ width: 'auto', alignSelf: 'flex-start' }} value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Subject">
      <option value="">All subjects</option>{d.subjects.filter((s) => s.tests.count || s.tests.absent).map((s) => <option key={s.subject_id} value={s.subject_id}>{s.name}</option>)}</select>
    {rows.length === 0 ? <Empty>No tests yet.</Empty> : <div className="card" style={{ padding: 0 }}>{rows.map((r) => <ResultRow key={r.id} r={r} />)}</div>}
  </>);
}

function Exams({ d }) {
  if (!d.exams.length) return <Empty>No exam results yet.</Empty>;
  return d.exams.map((e) => (
    <div key={e.exam_id} className="card" style={{ padding: 0 }}>
      <div className="row sp" style={{ padding: '14px 16px' }}>
        <div><b style={{ fontSize: 17 }}>{e.name}</b>{e.start_date && <div className="muted" style={{ fontSize: 13 }}>{fmtDate(e.start_date)}</div>}</div>
        <div className="dstate"><span><Pct v={e.total.pct} /> <Grade g={e.total.grade} /></span><small>{num(e.total.obtained)} / {num(e.total.max)}{e.failed ? ` - ${e.failed} below pass mark` : ''}</small></div>
      </div>
      <div className="scrollx"><table className="rt"><thead><tr><th>Subject</th><th className="n">Marks</th><th className="n">Out of</th><th>%</th><th className="n">Grade</th><th className="n">Class avg</th></tr></thead><tbody>
        {e.papers.map((p) => <tr key={p.id}><td>{p.subject}</td>{p.absent ? <td colSpan={4}><span className="chip absent">Absent</span></td> : <><td className="n"><b>{num(p.marks)}</b></td><td className="n">{num(p.max_marks)}</td><td><Pct v={p.pct} /></td><td className="n"><Grade g={p.grade} /></td></>}<td className="n muted">{p.class_avg_pct !== null && !p.absent ? `${p.class_avg_pct}%` : ''}</td></tr>)}
      </tbody></table></div>
    </div>));
}

/* ================================================================== MY MARKS (student / parent) */
export function MyMarks({ me }) {
  const isParent = me.role === 'parent';
  const [kids, setKids] = useState(null); const [pick, setPick] = useState('');
  useEffect(() => {
    if (!isParent) return;
    api.get('/users/my-children').then((k) => { setKids(k); if (k.length) setPick(k[0].user_id); }).catch(() => setKids([]));
  }, [isParent]);
  if (!isParent) return <StudentAcademics me={me} studentId={me.user_id} mode="my" />;
  if (!kids) return <Empty>Loading...</Empty>;
  if (!kids.length) return <Empty>No student is linked to your account yet. Ask the school office.</Empty>;
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      {kids.length > 1 && <div className="pills">{kids.map((k) => <button key={k.user_id} className={`pill ${pick === k.user_id ? 'on' : ''}`} onClick={() => setPick(k.user_id)}>{k.profile?.full_name || k.login_id}</button>)}</div>}
      {pick && <StudentAcademics key={pick} me={me} studentId={pick} mode="my" />}
    </div>
  );
}

/* ================================================================== TESTS & MARKS (teacher) */
export const TestsAndMarks = scoped(function TestsAndMarks({ me, sid }) {
  const { data: meta, error, refresh } = useMeta(me, sid);
  const [f, setF] = useState({ class_id: '', subject_id: '', kind: '', session_id: '' });
  const [list, setList] = useState(null); const [err, setErr] = useState('');
  const [open, setOpen] = useState(null); const [creating, setCreating] = useState(false);
  const canMake = me.features.includes('manage_assessments');

  const reload = useCallback(() => aget(me, sid, '/assessments', f).then((x) => { setList(x); setErr(''); }).catch((e) => setErr(e.message)), [me, sid, f]);
  useEffect(() => { if (meta) reload(); }, [meta, reload]);

  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Empty>Loading...</Empty>;
  if (open) return <MarksSheet me={me} sid={sid} meta={meta} id={open} onBack={() => { setOpen(null); reload(); }} />;
  if (!meta.classes.length) return <Empty>{me.features.includes('academics_all_classes') ? 'This school has no classes yet. Add them under Users > Classes.' : 'No class is assigned to you yet. Ask your school admin to assign you under Attendance > Class teachers.'}</Empty>;

  return (
    <div className="stack">
      <div className="card row sp">
        <div className="row">
          <select aria-label="Class" style={{ width: 'auto' }} value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}><option value="">All my classes</option>{meta.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <select aria-label="Subject" style={{ width: 'auto' }} value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">All subjects</option>{meta.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select aria-label="Type" style={{ width: 'auto' }} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Tests &amp; exams</option><option value="test">Tests only</option><option value="exam">Exams only</option></select>
          <SessionSelect meta={meta} value={f.session_id} onChange={(v) => setF({ ...f, session_id: v })} />
        </div>
        {canMake && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />New test / exam paper</button>}
      </div>
      {err && <div className="err">{err}</div>}
      {!list ? <Empty>Loading...</Empty> : list.length === 0 ? <Empty>Nothing here yet.{canMake && meta.subjects.length === 0 ? ' Ask your admin to add subjects first (Academics > Subjects).' : ''}</Empty> : (
        <div className="card" style={{ padding: 0 }}>{list.map((a) => (
          <button key={a.id} className="drow" onClick={() => setOpen(a.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b className="ellip" style={{ display: 'block' }}>{a.title}</b>
              <small>{a.subject_name} - Class {a.class_label} - {fmtDate(a.date)}</small>
              <div className="chips" style={{ marginTop: 4 }}><span className={`chip ${a.kind === 'exam' ? 'head' : ''}`}>{a.kind === 'exam' ? `Exam${a.exam_name ? `: ${a.exam_name}` : ''}` : 'Test'}</span><span className="chip">Out of {num(a.max_marks)}</span></div>
            </div>
            <div className="dstate">
              <span className={`cstate ${a.entered === 0 ? 'none' : a.entered >= a.total_students ? 'done' : 'part'}`}>{a.entered === 0 ? 'No marks yet' : `${a.entered}/${a.total_students} entered`}</span>
              {a.avg_pct !== null && <small>Average <Pct v={a.avg_pct} /></small>}
            </div>
          </button>))}</div>)}
      {creating && <CreateModal me={me} sid={sid} meta={meta} defaults={f} refreshMeta={refresh} onClose={() => setCreating(false)} onCreated={(a) => { setCreating(false); setOpen(a.id); }} />}
    </div>
  );
});

function CreateModal({ me, sid, meta, defaults, onClose, onCreated }) {
  const [kind, setKind] = useState(defaults.kind || 'test');
  const curExams = meta.exams.filter((e) => !meta.current_session_id || e.session_id === meta.current_session_id);
  const [f, setF] = useState({ class_id: defaults.class_id || (meta.classes.length === 1 ? meta.classes[0].id : ''), subject_id: defaults.subject_id || '', exam_id: '', title: '', date: meta.today, max_marks: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { onCreated(await asend('post', me, sid, '/assessments', { ...f, kind })); toast('Created. Now enter the marks'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="New test / exam paper" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="full pills"><button type="button" className={`pill ${kind === 'test' ? 'on' : ''}`} onClick={() => setKind('test')}>Test</button><button type="button" className={`pill ${kind === 'exam' ? 'on' : ''}`} onClick={() => setKind('exam')}>Exam paper</button></div>
        <Field label="Class"><select required value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}><option value="">Choose</option>{meta.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
        <Field label="Subject"><select required value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">Choose</option>{meta.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        {kind === 'exam'
          ? <div className="full"><Field label="Exam" hint={curExams.length ? '' : 'No exam in the current session. An admin creates them under Academics > Exams.'}><select required value={f.exam_id} onChange={(e) => setF({ ...f, exam_id: e.target.value })}><option value="">Choose</option>{curExams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field></div>
          : <div className="full"><Field label="Test title"><input required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Unit test 1, Chapter 3 quiz" /></Field></div>}
        <Field label="Date"><input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Maximum marks"><input type="number" required min="0.5" max="1000" step="any" inputMode="decimal" value={f.max_marks} onChange={(e) => setF({ ...f, max_marks: e.target.value })} placeholder="e.g. 20" /></Field>
        {err && <div className="err full">{err}</div>}
        <button className="btn primary full big" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Creating...' : 'Create and enter marks'}</button>
      </form>
    </Modal>
  );
}

function MarksSheet({ me, sid, meta, id, onBack }) {
  const [sh, setSh] = useState(null); const [err, setErr] = useState('');
  const [vals, setVals] = useState({}); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const canEdit = me.features.includes('manage_assessments');
  const apply = (d) => {
    const v = {}; d.students.forEach((s) => { v[s.student_id] = { marks: s.marks === null ? '' : String(s.marks), absent: s.absent }; });
    setSh(d); setVals(v); setDirty(false);
  };
  useEffect(() => { aget(me, sid, `/assessments/${id}`).then(apply).catch((e) => setErr(e.message)); }, [id]); // eslint-disable-line
  useEffect(() => { if (!dirty) return undefined; const h = (e) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);

  if (err) return <div className="stack"><button className="btn" style={{ alignSelf: 'flex-start' }} onClick={onBack}><Icon name="back" />Back</button><div className="err">{err}</div></div>;
  if (!sh) return <Empty>Loading...</Empty>;
  const a = sh.assessment; const max = a.max_marks;
  const bad = (v) => v.marks !== '' && !v.absent && (!Number.isFinite(Number(v.marks)) || Number(v.marks) < 0 || Number(v.marks) > max);
  const invalid = sh.students.filter((s) => bad(vals[s.student_id])).length;
  const entered = sh.students.filter((s) => vals[s.student_id].absent || vals[s.student_id].marks !== '').length;
  const set = (sidn, patch) => { setVals((v) => ({ ...v, [sidn]: { ...v[sidn], ...patch } })); setDirty(true); };
  const next = (e, i) => { if (e.key === 'Enter') { e.preventDefault(); document.querySelector(`[data-mi="${i + 1}"]`)?.focus(); } };

  const save = async () => {
    setBusy(true);
    try {
      const items = sh.students.map((s) => { const v = vals[s.student_id]; return { student_id: s.student_id, absent: v.absent, marks: v.absent || v.marks === '' ? null : Number(v.marks) }; });
      apply(await asend('put', me, sid, `/assessments/${id}/marks`, { items })); toast('Marks saved');
    } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const back = () => { if (dirty && !confirm('You have unsaved marks. Leave without saving?')) return; onBack(); };
  const del = async () => {
    if (!confirm(`Delete "${a.title}" (${a.subject_name}, Class ${a.class_label}) and all its marks?`)) return;
    try { await adel(me, sid, `/assessments/${id}`); toast('Deleted'); onBack(); } catch (x) { toast(x.message, true); }
  };

  return (
    <div className="sheetwrap">
      <div className="card row sp">
        <div className="row">
          <button className="icon-btn" onClick={back} aria-label="Back"><Icon name="back" /></button>
          <div><b style={{ fontSize: 18 }}>{a.title}</b><div className="muted" style={{ fontSize: 14 }}>{a.subject_name} - Class {a.class_label} - {fmtDate(a.date)} - out of {num(max)}{a.kind === 'exam' && a.exam_name ? ` - ${a.exam_name}` : ''}</div></div>
        </div>
        {canEdit && <div className="row"><button className="btn" onClick={() => setEdit(true)}><Icon name="edit" size={16} />Edit</button><button className="btn danger" onClick={del}><Icon name="trash" size={16} />Delete</button></div>}
      </div>
      <div className="asum slim" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
        <Tile n={`${a.entered}/${a.total_students}`} label="Entered" />
        <div className="tile"><b><Pct v={a.avg_pct} /></b><span>Average</span></div>
        <Tile n={num(a.highest)} label="Highest" /><Tile n={num(a.lowest)} label="Lowest" />
        <Tile n={a.entered - a.absent > 0 ? `${a.passed}/${a.entered - a.absent}` : '-'} label={`Passed (${meta.pass_percent}%)`} />
      </div>
      {sh.students.length === 0 ? <Empty>No students in this class.</Empty> : (
        <div className="card alist" style={{ padding: 0 }}>{sh.students.map((s, i) => {
          const v = vals[s.student_id]; const isBad = bad(v);
          const pct = v.marks !== '' && !v.absent && !isBad ? Math.round((Number(v.marks) / max) * 1000) / 10 : null;
          return (
            <div key={s.student_id} className={`mrow ${v.absent ? 'absent' : ''}`}>
              <span className="roll sm">{s.roll_no ?? '-'}</span>
              <div className="aname"><b>{s.full_name}</b></div>
              <span className="mpct">{pct !== null && <Pct v={pct} />}</span>
              <input className={`minput ${isBad ? 'bad' : ''}`} data-mi={i} inputMode="decimal" aria-label={`Marks for ${s.full_name}`} placeholder={v.absent ? 'Abs' : `/ ${num(max)}`}
                value={v.absent ? '' : v.marks} disabled={v.absent} readOnly={!canEdit}
                onChange={(e) => set(s.student_id, { marks: e.target.value.replace(/[^0-9.]/g, '') })} onKeyDown={(e) => next(e, i)} />
              {canEdit && <button type="button" className={`abtn ${v.absent ? 'on' : ''}`} aria-pressed={v.absent} onClick={() => set(s.student_id, { absent: !v.absent, marks: '' })}>Absent</button>}
            </div>);
        })}</div>)}
      {canEdit && sh.students.length > 0 && (
        <div className="asave">
          <div className="sum">{entered} of {sh.students.length} filled{invalid > 0 && <span className="a"> - {invalid} over {num(max)} or invalid</span>}{dirty && <span className="dot" title="Unsaved changes" />}</div>
          <button className="btn primary big" disabled={busy || !dirty || invalid > 0} onClick={save}>{busy ? 'Saving...' : 'Save marks'}</button>
        </div>)}
      {edit && <EditModal me={me} sid={sid} meta={meta} a={a} onClose={() => setEdit(false)} onSaved={(d) => { setEdit(false); apply(d); toast('Updated'); }} />}
    </div>
  );
}

function EditModal({ me, sid, meta, a, onClose, onSaved }) {
  const [f, setF] = useState({ title: a.title, date: a.date, max_marks: String(a.max_marks), subject_id: a.subject_id });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { onSaved(await asend('patch', me, sid, `/assessments/${a.id}`, f)); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <Modal title="Edit details" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="full"><Field label="Title"><input required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field></div>
        <Field label="Subject"><select value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}>{meta.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Date"><input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <div className="full"><Field label="Maximum marks"><input type="number" required min="0.5" max="1000" step="any" value={f.max_marks} onChange={(e) => setF({ ...f, max_marks: e.target.value })} /></Field></div>
        {err && <div className="err full">{err}</div>}
        <button className="btn primary full" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : 'Save'}</button>
      </form>
    </Modal>
  );
}

/* ================================================================== REPORTS (teacher / admin) */
export const AcademicReports = scoped(function AcademicReports({ me, sid }) {
  const { data: meta, error } = useMeta(me, sid);
  const [f, setF] = useState({ class_id: '', session_id: '', scope: 'all' });
  const [rep, setRep] = useState(null); const [err, setErr] = useState(''); const [student, setStudent] = useState(null);
  useEffect(() => { if (meta && !f.class_id && meta.classes.length) setF((x) => ({ ...x, class_id: meta.classes[0].id })); }, [meta]); // eslint-disable-line
  useEffect(() => {
    if (!f.class_id) return undefined;
    let live = true; setErr('');
    aget(me, sid, '/reports/class', f).then((x) => live && setRep(x)).catch((e) => { if (live) { setErr(e.message); setRep(null); } });
    return () => { live = false; };
  }, [f.class_id, f.session_id, f.scope, sid]); // eslint-disable-line

  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Empty>Loading...</Empty>;
  if (student) return <StudentAcademics me={me} sid={sid} studentId={student} mode="staff" onBack={() => setStudent(null)} />;
  if (!meta.classes.length) return <Empty>No class available. Ask your school admin to assign you under Attendance &gt; Class teachers.</Empty>;
  const sessionExams = meta.exams.filter((e) => (f.session_id === 'all' ? true : e.session_id === (f.session_id || meta.current_session_id)));

  const exportCsv = () => csv(`marks-${rep.class.label.replace(/\s+/g, '_')}.csv`, [
    ['Rank', 'Roll', 'Name', ...rep.subjects.map((s) => `${s.name} %`), 'Obtained', 'Max', 'Overall %', 'Grade'],
    ...rep.students.map((s) => [s.rank ?? '', s.roll_no ?? '', s.full_name, ...rep.subjects.map((x) => s.subjects[x.id]?.pct ?? ''), s.total.obtained, s.total.max, s.total.pct ?? '', s.grade ?? ''])]);

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="card row sp">
        <div className="row">
          <select aria-label="Class" style={{ width: 'auto' }} value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}>{meta.classes.map((c) => <option key={c.id} value={c.id}>Class {c.label}</option>)}</select>
          <SessionSelect meta={meta} value={f.session_id} onChange={(v) => setF({ ...f, session_id: v, scope: 'all' })} />
          <select aria-label="Report type" style={{ width: 'auto' }} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
            <option value="all">Tests + exams</option><option value="tests">Tests only</option><option value="exams">All exams</option>
            {sessionExams.map((e) => <option key={e.id} value={e.id}>Exam: {e.name}</option>)}</select>
        </div>
        {rep && rep.students.length > 0 && <button className="btn" onClick={exportCsv}><Icon name="download" size={16} />CSV</button>}
      </div>
      {err && <div className="err">{err}</div>}
      {rep && (rep.summary.assessments === 0 ? <Empty>No tests or exam papers for this selection yet.</Empty> : (<>
        <div className="asum slim">
          <Tile n={rep.summary.with_marks} label={`of ${rep.summary.students} students`} />
          <div className="tile"><b><Pct v={rep.summary.class_avg} /></b><span>Class average</span></div>
          <Tile n={rep.summary.with_marks ? `${rep.summary.passed}/${rep.summary.with_marks}` : '-'} label={`Passed (${rep.pass_percent}%)`} />
          <Tile n={rep.summary.top ? `${rep.summary.top.pct}%` : '-'} label={rep.summary.top ? `Top: ${rep.summary.top.name}` : 'Top'} />
        </div>
        <div className="card scrollx" style={{ padding: 0 }}><table className="rt"><thead><tr><th className="n">Rank</th><th className="n">Roll</th><th>Name</th>{rep.subjects.map((s) => <th key={s.id} className="n">{s.name}</th>)}<th className="n">Overall</th><th className="n">Grade</th></tr></thead><tbody>
          {rep.students.map((s) => (
            <tr key={s.student_id} className="click" onClick={() => setStudent(s.student_id)}>
              <td className="n">{s.rank ?? '-'}</td><td className="n">{s.roll_no ?? '-'}</td><td><b>{s.full_name}</b></td>
              {rep.subjects.map((x) => { const c = s.subjects[x.id]; return <td key={x.id} className="n">{c ? (c.pct === null ? <span className="chip absent">Abs</span> : <Pct v={c.pct} />) : <span className="muted">-</span>}</td>; })}
              <td className="n"><Pct v={s.total.pct} /></td><td className="n"><Grade g={s.grade} /></td>
            </tr>))}
          <tr className="sumrow"><td /><td /><td><b>Class average</b></td>{rep.subjects.map((x) => <td key={x.id} className="n"><Pct v={rep.subject_avgs[x.id]} /></td>)}<td className="n"><Pct v={rep.summary.class_avg} /></td><td /></tr>
        </tbody></table></div>
        <div className="muted" style={{ fontSize: 13 }}>Tap a student to see their full dashboard. Absent entries are not counted in percentages.</div>
      </>))}
    </div>
  );
});

/* ================================================================== SUBJECTS (admin) */
export const SubjectManager = scoped(function SubjectManager({ me, sid }) {
  const { data: meta, error, refresh } = useMeta(me, sid);
  const [f, setF] = useState({ name: '', code: '' }); const [busy, setBusy] = useState(false); const [edit, setEdit] = useState(null);
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Empty>Loading...</Empty>;
  const add = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await asend('post', me, sid, '/subjects', f); setF({ name: '', code: '' }); await refresh(); toast('Subject added'); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const del = async (s) => { if (!confirm(`Delete subject ${s.name}?`)) return; try { await adel(me, sid, `/subjects/${s.id}`); await refresh(); toast('Deleted'); } catch (x) { toast(x.message, true); } };
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <form className="card row" onSubmit={add} style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 2, minWidth: 160 }}><Field label="New subject"><input required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Mathematics" /></Field></div>
        <div style={{ flex: 1, minWidth: 90 }}><Field label="Code (optional)"><input maxLength={12} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="MATH" /></Field></div>
        <button className="btn primary" disabled={busy}><Icon name="plus" />Add</button>
      </form>
      {meta.subjects.length === 0 ? <Empty>No subjects yet. Add the first one above.</Empty> : (
        <div className="card" style={{ padding: 0 }}>{meta.subjects.map((s) => (
          <div key={s.id} className="drow" style={{ cursor: 'default' }}>
            <div style={{ flex: 1 }}><b>{s.name}</b>{s.code && <small>{s.code}</small>}</div>
            <button className="icon-btn" aria-label={`Edit ${s.name}`} onClick={() => setEdit(s)}><Icon name="edit" /></button>
            <button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => del(s)}><Icon name="trash" /></button>
          </div>))}</div>)}
      {edit && <SubjectEdit me={me} sid={sid} s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); toast('Saved'); }} />}
    </div>
  );
});
function SubjectEdit({ me, sid, s, onClose, onSaved }) {
  const [f, setF] = useState({ name: s.name, code: s.code || '' }); const [err, setErr] = useState('');
  const save = async (e) => { e.preventDefault(); try { await asend('patch', me, sid, `/subjects/${s.id}`, f); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Edit subject" onClose={onClose}><form className="form" onSubmit={save}>
      <div className="full"><Field label="Name"><input required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
      <div className="full"><Field label="Code"><input maxLength={12} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field></div>
      {err && <div className="err full">{err}</div>}<button className="btn primary full" style={{ justifyContent: 'center' }}>Save</button>
    </form></Modal>
  );
}

/* ================================================================== EXAMS (admin) */
export const ExamManager = scoped(function ExamManager({ me, sid }) {
  const { data: meta, error, refresh } = useMeta(me, sid);
  const [edit, setEdit] = useState(null);
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Empty>Loading...</Empty>;
  const sessName = (id) => meta.sessions.find((s) => s.id === id)?.name || 'No session';
  const del = async (x) => { if (!confirm(`Delete exam "${x.name}"?`)) return; try { await adel(me, sid, `/exams/${x.id}`); await refresh(); toast('Deleted'); } catch (e) { toast(e.message, true); } };
  const groups = [...new Set(meta.exams.map((e) => e.session_id))];
  return (
    <div className="stack" style={{ maxWidth: 700 }}>
      <div className="card row sp"><div><b>Exams</b><div className="muted" style={{ fontSize: 14 }}>An exam (e.g. Half-yearly) is created once. Teachers then add a paper for each class and subject.</div></div>
        <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" />New exam</button></div>
      {meta.exams.length === 0 ? <Empty>No exams yet.</Empty> : groups.map((g) => (
        <div key={g || 'none'}><div className="nav-label" style={{ margin: '4px 4px 6px' }}>{sessName(g)}</div>
          <div className="card" style={{ padding: 0 }}>{meta.exams.filter((e) => e.session_id === g).map((e) => (
            <div key={e.id} className="drow" style={{ cursor: 'default' }}>
              <div style={{ flex: 1 }}><b>{e.name}</b><small>{e.start_date ? `${fmtDate(e.start_date)}${e.end_date ? ` - ${fmtDate(e.end_date)}` : ''}` : 'No dates set'}</small></div>
              <button className="icon-btn" aria-label={`Edit ${e.name}`} onClick={() => setEdit(e)}><Icon name="edit" /></button>
              <button className="icon-btn" aria-label={`Delete ${e.name}`} onClick={() => del(e)}><Icon name="trash" /></button>
            </div>))}</div></div>))}
      {edit && <ExamForm me={me} sid={sid} meta={meta} x={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); toast('Saved'); }} />}
    </div>
  );
});
function ExamForm({ me, sid, meta, x, onClose, onSaved }) {
  const isNew = !x.id;
  const [f, setF] = useState({ name: x.name || '', start_date: x.start_date || '', end_date: x.end_date || '', session_id: x.session_id || meta.current_session_id || '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await (isNew ? asend('post', me, sid, '/exams', f) : asend('patch', me, sid, `/exams/${x.id}`, f)); onSaved(); } catch (z) { setErr(z.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={isNew ? 'New exam' : 'Edit exam'} onClose={onClose}><form className="form" onSubmit={save}>
      <div className="full"><Field label="Exam name"><input required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Half-yearly, Final, Pre-board" /></Field></div>
      {isNew && <div className="full"><Field label="Session"><select value={f.session_id} onChange={(e) => setF({ ...f, session_id: e.target.value })}>{meta.sessions.length === 0 && <option value="">No session set up</option>}{meta.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}</select></Field></div>}
      <Field label="Starts (optional)"><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
      <Field label="Ends (optional)"><input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
      {err && <div className="err full">{err}</div>}<button className="btn primary full" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : 'Save'}</button>
    </form></Modal>
  );
}
