import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useData, useApi } from '../cache.js';
import { Field, toast, Loading, ask, SaveBar, Page, PageBar, Tabs, KpiGrid, Kpi, Section, List, ListRow, StatusBadge, EmptyState, FormDialog, FormGrid, Notice, Button, Choice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
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
const Failed = ({ error, onBack }) => <Page>{onBack && <div><Button icon="back" onClick={onBack}>Back</Button></div>}<Notice tone="bad">{error}</Notice></Page>;

function csv(name, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([`﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function SessionSelect({ meta, value, onChange }) {
  return (
    <select aria-label="Session" className="ds-ctx-select" value={value} onChange={(e) => onChange(e.target.value)}>
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
  const url = mode === 'my' ? `/academics/my${qs({ student_id: studentId, session_id: session })}` : `/academics/reports/student/${studentId}${qs({ ...scopeQ(me, sid), session_id: session })}`;
  const { data: d, error: err } = useApi(url, true, { keepPrevious: true });
  if (err) return <Failed error={err} onBack={onBack} />;
  if (!d) return <Page><Loading /></Page>;
  const s = d.summary;
  const meta = { sessions: d.sessions };
  return (
    <Page>
      <PageBar lead={onBack ? <Button size="sm" icon="back" onClick={onBack}>Back</Button> : null} title={d.student.name}
        sub={[d.student.class_label && `Class ${d.student.class_label}`, d.student.roll_no && `Roll ${d.student.roll_no}`].filter(Boolean).join(' - ') || 'Student'}>
        <SessionSelect meta={meta} value={session} onChange={setSession} />
      </PageBar>
      <KpiGrid>
        <Kpi label={`Overall${s.overall.grade ? ` (${s.overall.grade})` : ''}`} value={<Pct v={s.overall.pct} />} />
        <Kpi label={`Tests (${s.tests.count})`} value={<Pct v={s.tests.pct} />} />
        <Kpi label={`Exams (${s.exams.count})`} value={<Pct v={s.exams.pct} />} />
        <Kpi label="Subjects" value={d.subjects.length} />
      </KpiGrid>
      <Tabs value={tab} onChange={setTab} items={[{ key: 'overview', label: 'Overview' }, { key: 'subjects', label: 'Subjects' }, { key: 'tests', label: 'Tests', count: d.tests.length }, { key: 'exams', label: 'Exams', count: d.exams.length }]} />
      {tab === 'overview' && <Overview d={d} setTab={setTab} />}
      {tab === 'subjects' && <Subjects d={d} />}
      {tab === 'tests' && <Tests d={d} />}
      {tab === 'exams' && <Exams d={d} />}
    </Page>
  );
}

function Overview({ d, setTab }) {
  const recent = useMemo(() => [...d.tests, ...d.exams.flatMap((e) => e.papers)].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6), [d]);
  if (!d.subjects.length) return <EmptyState icon="academics" title="No marks yet">No marks have been entered yet{d.session_id ? ' for this session' : ''}.</EmptyState>;
  return (<>
    <Section title="Subjects">
      <div className="subjlist">{d.subjects.map((s) => (
        <div key={s.subject_id} className="subjrow"><span className="ellip">{s.name}</span><Bar v={s.overall.pct} /><Pct v={s.overall.pct} /></div>))}</div>
    </Section>
    <Section title="Latest results" flush actions={<Button size="sm" kind="ghost" onClick={() => setTab('tests')}>All tests</Button>}>
      <List>{recent.map((r) => <ResultRow key={r.id} r={r} />)}</List>
    </Section>
  </>);
}

function ResultRow({ r }) {
  return (
    <ListRow title={r.subject} sub={<>{r.title} - {fmtDate(r.date)}{r.kind === 'exam' && <> - <StatusBadge tone="info" dot={false}>Exam</StatusBadge></>}</>}
      meta={r.absent ? <StatusBadge tone="bad">Absent</StatusBadge> : (
        <span className="ds-al-right"><b>{num(r.marks)} <span className="ds-hint">/ {num(r.max_marks)}</span></b>
          <span className="ds-subline"><Pct v={r.pct} /> <Grade g={r.grade} />{r.class_avg_pct !== null ? ` · Class avg ${r.class_avg_pct}%` : ''}</span></span>)} />
  );
}

function Subjects({ d }) {
  if (!d.subjects.length) return <EmptyState icon="academics">No subjects yet.</EmptyState>;
  return <div className="cgrid">{d.subjects.map((s) => (
    <div key={s.subject_id} className="ccard static">
      <div className="ds-spread"><b className="cname">{s.name}</b><span><Pct v={s.overall.pct} /> <Grade g={s.overall.grade} /></span></div>
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
    <select className="ds-ctx-select" value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Subject">
      <option value="">All subjects</option>{d.subjects.filter((s) => s.tests.count || s.tests.absent).map((s) => <option key={s.subject_id} value={s.subject_id}>{s.name}</option>)}</select>
    {rows.length === 0 ? <EmptyState icon="academics">No tests yet.</EmptyState> : <Section flush><List>{rows.map((r) => <ResultRow key={r.id} r={r} />)}</List></Section>}
  </>);
}

function Exams({ d }) {
  if (!d.exams.length) return <EmptyState icon="academics">No exam results yet.</EmptyState>;
  return d.exams.map((e) => (
    <Section key={e.exam_id} flush title={e.name} sub={e.start_date ? fmtDate(e.start_date) : undefined}
      actions={<span className="ds-al-right"><Pct v={e.total.pct} /> <Grade g={e.total.grade} /><span className="ds-subline">{num(e.total.obtained)} / {num(e.total.max)}{e.failed ? ` - ${e.failed} below pass mark` : ''}</span></span>}>
      <List>{e.papers.map((p) => (
        <ListRow key={p.id} title={p.subject}
          meta={p.absent ? <StatusBadge tone="bad">Absent</StatusBadge> : (
            <span className="ds-al-right"><b>{num(p.marks)}</b> <span className="ds-hint">/ {num(p.max_marks)}</span>
              <span className="ds-subline"><Pct v={p.pct} /> <Grade g={p.grade} />{p.class_avg_pct != null ? ` · Class avg ${p.class_avg_pct}%` : ''}</span></span>)} />
      ))}</List>
    </Section>));
}

/* ================================================================== MY MARKS (student / parent) */
export function MyMarks({ me }) {
  const isParent = me.role === 'parent';
  const [pickRaw, setPick] = useState('');
  const { data: kidsData, error: kidsErr } = useApi('/users/my-children', isParent);
  const kids = isParent ? (kidsData ?? (kidsErr ? [] : null)) : null;
  const pick = pickRaw || kids?.[0]?.user_id || ''; // first child is selected by default
  if (!isParent) return <StudentAcademics me={me} studentId={me.user_id} mode="my" />;
  if (!kids) return <Page><Loading /></Page>;
  if (!kids.length) return <Page><EmptyState icon="academics">No student is linked to your account yet. Ask the school office.</EmptyState></Page>;
  return (
    <>
      {kids.length > 1 && <Page><Tabs value={pick} onChange={setPick} items={kids.map((k) => ({ key: k.user_id, label: k.profile?.full_name || k.login_id }))} /></Page>}
      {pick && <StudentAcademics key={pick} me={me} studentId={pick} mode="my" />}
    </>
  );
}

/* ================================================================== TESTS & MARKS (teacher) */
export const TestsAndMarks = scoped(function TestsAndMarks({ me, sid }) {
  const { data: meta, error, refresh } = useMeta(me, sid);
  const [f, setF] = useState({ class_id: '', subject_id: '', kind: '', session_id: '' }); const [tq, setTq] = useState('');
  const [open, setOpen] = useState(null); const [creating, setCreating] = useState(false);
  const canMake = me.features.includes('manage_assessments');

  const { data: list, error: err, refresh: reload } = useApi(`/academics/assessments${qs({ ...scopeQ(me, sid), ...f })}`, !!meta, { keepPrevious: true });
  const shown = list && (tq.trim() ? list.filter((a) => `${a.title} ${a.subject_name} ${a.class_label}`.toLowerCase().includes(tq.trim().toLowerCase())) : list);

  if (error) return <Page><Notice tone="bad">{error}</Notice></Page>;
  if (!meta) return <Page><Loading /></Page>;
  if (open) return <MarksSheet me={me} sid={sid} meta={meta} id={open} onBack={() => { setOpen(null); reload(); }} />;
  if (!meta.classes.length) return <Page><EmptyState icon="academics">{me.features.includes('academics_all_classes') ? 'This school has no classes yet. Add them under Users > Classes.' : 'No class is assigned to you yet. Ask your school admin to assign you under Attendance > Class teachers.'}</EmptyState></Page>;

  return (
    <Page>
      <PageBar title="Tests & marks" sub="Tests and exam papers you can enter marks for">{canMake && <Button kind="primary" icon="plus" onClick={() => setCreating(true)}>New test / exam paper</Button>}</PageBar>
      <FilterBar q={tq} onQ={setTq} placeholder="Search tests and exams" count={shown?.length}
        filters={[
          { key: 'class_id', label: 'Class', value: f.class_id, onChange: (v) => setF((p) => ({ ...p, class_id: v })), all: 'All my classes', options: meta.classes.map((c) => ({ value: c.id, label: c.label })) },
          { key: 'subject_id', label: 'Subject', value: f.subject_id, onChange: (v) => setF((p) => ({ ...p, subject_id: v })), all: 'All subjects', options: meta.subjects.map((x) => ({ value: x.id, label: x.name })) },
          { key: 'kind', label: 'Type', value: f.kind, onChange: (v) => setF((p) => ({ ...p, kind: v })), all: 'Tests & exams', options: [{ value: 'test', label: 'Tests only' }, { value: 'exam', label: 'Exams only' }] },
          { key: 'session_id', label: 'Session', value: f.session_id, onChange: (v) => setF((p) => ({ ...p, session_id: v })), all: meta.sessions.find((x) => x.is_current)?.name ? `${meta.sessions.find((x) => x.is_current).name} (current)` : 'Current session', options: [...meta.sessions.filter((x) => !x.is_current).map((x) => ({ value: x.id, label: x.name })), { value: 'all', label: 'All sessions' }] },
        ]} />
      {err && <Notice tone="bad">{err}</Notice>}
      {!list ? <Loading /> : shown.length === 0 ? <EmptyState icon="academics">Nothing here yet.{canMake && meta.subjects.length === 0 ? ' Ask your admin to add subjects first (Academics > Subjects).' : ''}</EmptyState> : (
        <Section flush><List>{shown.map((a) => (
          <ListRow key={a.id} onClick={() => setOpen(a.id)} title={a.title} wrap
            sub={<>{a.subject_name} - Class {a.class_label} - {fmtDate(a.date)}<span className="ds-chips"><StatusBadge tone={a.kind === 'exam' ? 'info' : 'mute'} dot={false}>{a.kind === 'exam' ? `Exam${a.exam_name ? `: ${a.exam_name}` : ''}` : 'Test'}</StatusBadge><StatusBadge tone="mute" dot={false}>Out of {num(a.max_marks)}</StatusBadge></span></>}
            meta={<span className="ds-al-right"><StatusBadge tone={a.entered === 0 ? 'mute' : a.entered >= a.total_students ? 'ok' : 'warn'}>{a.entered === 0 ? 'No marks yet' : `${a.entered}/${a.total_students} entered`}</StatusBadge>{a.avg_pct !== null && <span className="ds-subline">Average <Pct v={a.avg_pct} /></span>}</span>} />
        ))}</List></Section>)}
      {creating && <CreateModal me={me} sid={sid} meta={meta} defaults={f} refreshMeta={refresh} onClose={() => setCreating(false)} onCreated={(a) => { setCreating(false); setOpen(a.id); }} />}
    </Page>
  );
});

function CreateModal({ me, sid, meta, defaults, onClose, onCreated }) {
  const [kind, setKind] = useState(defaults.kind || 'test');
  const curExams = meta.exams.filter((e) => !meta.current_session_id || e.session_id === meta.current_session_id);
  const [f, setF] = useState({ class_id: defaults.class_id || (meta.classes.length === 1 ? meta.classes[0].id : ''), subject_id: defaults.subject_id || '', exam_id: '', title: '', date: meta.today, max_marks: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { onCreated(await asend('post', me, sid, '/assessments', { ...f, kind })); toast('Created. Now enter the marks'); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormDialog title="New test / exam paper" onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Create and enter marks">
      <FormGrid>
        <Field full label="What is it?"><Choice label="Kind" value={kind} onChange={setKind} options={[{ value: 'test', label: 'Test' }, { value: 'exam', label: 'Exam paper' }]} /></Field>
        <Field label="Class" req><select required value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}><option value="">Choose</option>{meta.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
        <Field label="Subject" req><select required value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">Choose</option>{meta.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        {kind === 'exam'
          ? <Field full label="Exam" req hint={curExams.length ? '' : 'No exam in the current session. An admin creates them under Academics > Exams.'}><select required value={f.exam_id} onChange={(e) => setF({ ...f, exam_id: e.target.value })}><option value="">Choose</option>{curExams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          : <Field full label="Test title" req><input required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Unit test 1, Chapter 3 quiz" /></Field>}
        <Field label="Date" req><input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Maximum marks" req><input type="number" required min="0.5" max="1000" step="any" inputMode="decimal" value={f.max_marks} onChange={(e) => setF({ ...f, max_marks: e.target.value })} placeholder="e.g. 20" /></Field>
      </FormGrid>
    </FormDialog>
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

  if (err) return <Failed error={err} onBack={onBack} />;
  if (!sh) return <Page><Loading /></Page>;
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
  const back = async () => { if (dirty && !(await ask('You have unsaved marks. Leave without saving?'))) return; onBack(); };
  const del = async () => {
    if (!(await ask(`Delete "${a.title}" (${a.subject_name}, Class ${a.class_label}) and all its marks?`))) return;
    try { await adel(me, sid, `/assessments/${id}`); toast('Deleted'); onBack(); } catch (x) { toast(x.message, true); }
  };

  return (
    <Page>
      <PageBar lead={<Button size="sm" icon="back" onClick={back}>Back</Button>} title={a.title}
        sub={`${a.subject_name} - Class ${a.class_label} - ${fmtDate(a.date)} - out of ${num(max)}${a.kind === 'exam' && a.exam_name ? ` - ${a.exam_name}` : ''}`}>
        {canEdit && <><Button icon="edit" onClick={() => setEdit(true)}>Edit</Button><Button kind="danger" icon="trash" onClick={del}>Delete</Button></>}
      </PageBar>
      <KpiGrid cols={5}>
        <Kpi label="Entered" value={`${a.entered}/${a.total_students}`} />
        <Kpi label="Average" value={<Pct v={a.avg_pct} />} />
        <Kpi label="Highest" value={num(a.highest)} /><Kpi label="Lowest" value={num(a.lowest)} />
        <Kpi label={`Passed (${meta.pass_percent}%)`} value={a.entered - a.absent > 0 ? `${a.passed}/${a.entered - a.absent}` : '-'} />
      </KpiGrid>
      {sh.students.length === 0 ? <EmptyState icon="users">No students in this class.</EmptyState> : (
        <Section flush className="alist">{sh.students.map((s, i) => {
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
              {canEdit && <Button size="sm" kind={v.absent ? 'primary' : 'secondary'} aria-pressed={v.absent} onClick={() => set(s.student_id, { absent: !v.absent, marks: '' })}>Absent</Button>}
            </div>);
        })}</Section>)}
      {canEdit && sh.students.length > 0 && (
        <SaveBar dirty={dirty} error={invalid > 0 ? `${invalid} over ${num(max)} or invalid` : ''} summary={`${entered} of ${sh.students.length} filled`}
          action={<Button kind="primary" loading={busy} disabled={!dirty || invalid > 0} onClick={save}>Save marks</Button>} />)}
      {edit && <EditModal me={me} sid={sid} meta={meta} a={a} onClose={() => setEdit(false)} onSaved={(d) => { setEdit(false); apply(d); toast('Updated'); }} />}
    </Page>
  );
}

function EditModal({ me, sid, meta, a, onClose, onSaved }) {
  const [f, setF] = useState({ title: a.title, date: a.date, max_marks: String(a.max_marks), subject_id: a.subject_id });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setErr(''); try { onSaved(await asend('patch', me, sid, `/assessments/${a.id}`, f)); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormDialog title="Edit details" onClose={onClose} onSubmit={save} busy={busy} error={err}>
      <FormGrid>
        <Field full label="Title" req><input required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Subject"><select value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}>{meta.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Date" req><input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field full label="Maximum marks" req><input type="number" required min="0.5" max="1000" step="any" value={f.max_marks} onChange={(e) => setF({ ...f, max_marks: e.target.value })} /></Field>
      </FormGrid>
    </FormDialog>
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

  if (error) return <Page><Notice tone="bad">{error}</Notice></Page>;
  if (!meta) return <Page><Loading /></Page>;
  if (student) return <StudentAcademics me={me} sid={sid} studentId={student} mode="staff" onBack={() => setStudent(null)} />;
  if (!meta.classes.length) return <Page><EmptyState icon="academics">No class available. Ask your school admin to assign you under Attendance &gt; Class teachers.</EmptyState></Page>;
  const sessionExams = meta.exams.filter((e) => (f.session_id === 'all' ? true : e.session_id === (f.session_id || meta.current_session_id)));

  const exportCsv = () => csv(`marks-${rep.class.label.replace(/\s+/g, '_')}.csv`, [
    ['Rank', 'Roll', 'Name', ...rep.subjects.map((s) => `${s.name} %`), 'Obtained', 'Max', 'Overall %', 'Grade'],
    ...rep.students.map((s) => [s.rank ?? '', s.roll_no ?? '', s.full_name, ...rep.subjects.map((x) => s.subjects[x.id]?.pct ?? ''), s.total.obtained, s.total.max, s.total.pct ?? '', s.grade ?? ''])]);

  return (
    <Page>
      <PageBar title="Marks reports" sub="Class results by subject. Tap a student for their full dashboard.">
        <select aria-label="Class" className="ds-ctx-select" value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}>{meta.classes.map((c) => <option key={c.id} value={c.id}>Class {c.label}</option>)}</select>
        <SessionSelect meta={meta} value={f.session_id} onChange={(v) => setF({ ...f, session_id: v, scope: 'all' })} />
        <select aria-label="Report type" className="ds-ctx-select" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
          <option value="all">Tests + exams</option><option value="tests">Tests only</option><option value="exams">All exams</option>
          {sessionExams.map((e) => <option key={e.id} value={e.id}>Exam: {e.name}</option>)}</select>
        {rep && rep.students.length > 0 && <Button icon="download" onClick={exportCsv}>CSV</Button>}
      </PageBar>
      {err && <Notice tone="bad">{err}</Notice>}
      {rep && (rep.summary.assessments === 0 ? <EmptyState icon="academics">No tests or exam papers for this selection yet.</EmptyState> : (<>
        <KpiGrid>
          <Kpi label={`of ${rep.summary.students} students`} value={rep.summary.with_marks} />
          <Kpi label="Class average" value={<Pct v={rep.summary.class_avg} />} />
          <Kpi label={`Passed (${rep.pass_percent}%)`} value={rep.summary.with_marks ? `${rep.summary.passed}/${rep.summary.with_marks}` : '-'} />
          <Kpi label={rep.summary.top ? `Top: ${rep.summary.top.name}` : 'Top'} value={rep.summary.top ? `${rep.summary.top.pct}%` : '-'} />
        </KpiGrid>
        <Section flush><div className="ds-table-wrap"><table className="ds-table ds-table-dense"><thead><tr><th className="ds-al-right">Rank</th><th className="ds-al-right">Roll</th><th>Name</th>{rep.subjects.map((s) => <th key={s.id} className="ds-al-right">{s.name}</th>)}<th className="ds-al-right">Overall</th><th className="ds-al-right">Grade</th></tr></thead><tbody>
          {rep.students.map((s) => (
            <tr key={s.student_id} className="ds-row-click" onClick={() => setStudent(s.student_id)}>
              <td className="ds-al-right">{s.rank ?? '-'}</td><td className="ds-al-right">{s.roll_no ?? '-'}</td><td><b>{s.full_name}</b></td>
              {rep.subjects.map((x) => { const c = s.subjects[x.id]; return <td key={x.id} className="ds-al-right">{c ? (c.pct === null ? <StatusBadge tone="bad" dot={false}>Abs</StatusBadge> : <Pct v={c.pct} />) : <span className="ds-hint">-</span>}</td>; })}
              <td className="ds-al-right"><Pct v={s.total.pct} /></td><td className="ds-al-right"><Grade g={s.grade} /></td>
            </tr>))}
          <tr className="sumrow"><td /><td /><td><b>Class average</b></td>{rep.subjects.map((x) => <td key={x.id} className="ds-al-right"><Pct v={rep.subject_avgs[x.id]} /></td>)}<td className="ds-al-right"><Pct v={rep.summary.class_avg} /></td><td /></tr>
        </tbody></table></div></Section>
        <p className="ds-note">Absent entries are not counted in percentages.</p>
      </>))}
    </Page>
  );
});

/* ================================================================== SUBJECTS (admin) */
export const SubjectManager = scoped(function SubjectManager({ me, sid }) {
  const { data: meta, error, refresh } = useMeta(me, sid);
  const [edit, setEdit] = useState(null);
  if (error) return <Page><Notice tone="bad">{error}</Notice></Page>;
  if (!meta) return <Page><Loading /></Page>;
  const del = async (s) => { if (!(await ask(`Delete subject ${s.name}?`))) return; try { await adel(me, sid, `/subjects/${s.id}`); await refresh(); toast('Deleted'); } catch (x) { toast(x.message, true); } };
  return (
    <Page narrow>
      <PageBar title="Subjects" sub="Subjects teachers can set tests and exam papers for"><Button kind="primary" icon="plus" onClick={() => setEdit({})}>Add subject</Button></PageBar>
      {meta.subjects.length === 0 ? <EmptyState icon="academics" title="No subjects yet">Add the first one.</EmptyState> : (
        <Section flush><List>{meta.subjects.map((s) => (
          <ListRow key={s.id} title={s.name} sub={s.code || undefined}>
            <Button size="sm" icon="edit" aria-label={`Edit ${s.name}`} onClick={() => setEdit(s)} />
            <Button size="sm" kind="danger" icon="trash" aria-label={`Delete ${s.name}`} onClick={() => del(s)} />
          </ListRow>))}</List></Section>)}
      {edit && <SubjectEdit me={me} sid={sid} s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); toast('Saved'); }} />}
    </Page>
  );
});
function SubjectEdit({ me, sid, s, onClose, onSaved }) {
  const isNew = !s.id;
  const [f, setF] = useState({ name: s.name || '', code: s.code || '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setErr(''); try { await (isNew ? asend('post', me, sid, '/subjects', f) : asend('patch', me, sid, `/subjects/${s.id}`, f)); onSaved(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormDialog title={isNew ? 'Add subject' : 'Edit subject'} onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel={isNew ? 'Add subject' : 'Save'}>
      <FormGrid>
        <Field full label="Name" req><input autoFocus required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Mathematics" /></Field>
        <Field full label="Code (optional)"><input maxLength={12} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="MATH" /></Field>
      </FormGrid>
    </FormDialog>
  );
}

/* ================================================================== EXAMS (admin) */
export const ExamManager = scoped(function ExamManager({ me, sid }) {
  const { data: meta, error, refresh } = useMeta(me, sid);
  const [edit, setEdit] = useState(null);
  if (error) return <Page><Notice tone="bad">{error}</Notice></Page>;
  if (!meta) return <Page><Loading /></Page>;
  const sessName = (id) => meta.sessions.find((s) => s.id === id)?.name || 'No session';
  const del = async (x) => { if (!(await ask(`Delete exam "${x.name}"?`))) return; try { await adel(me, sid, `/exams/${x.id}`); await refresh(); toast('Deleted'); } catch (e) { toast(e.message, true); } };
  const groups = [...new Set(meta.exams.map((e) => e.session_id))];
  return (
    <Page narrow>
      <PageBar title="Exams" sub="An exam (e.g. Half-yearly) is created once. Teachers then add a paper for each class and subject."><Button kind="primary" icon="plus" onClick={() => setEdit({})}>New exam</Button></PageBar>
      {meta.exams.length === 0 ? <EmptyState icon="academics" title="No exams yet" /> : groups.map((g) => (
        <Section key={g || 'none'} title={sessName(g)} flush>
          <List>{meta.exams.filter((e) => e.session_id === g).map((e) => (
            <ListRow key={e.id} title={e.name} sub={e.start_date ? `${fmtDate(e.start_date)}${e.end_date ? ` - ${fmtDate(e.end_date)}` : ''}` : 'No dates set'}>
              <Button size="sm" icon="edit" aria-label={`Edit ${e.name}`} onClick={() => setEdit(e)} />
              <Button size="sm" kind="danger" icon="trash" aria-label={`Delete ${e.name}`} onClick={() => del(e)} />
            </ListRow>))}</List>
        </Section>))}
      {edit && <ExamForm me={me} sid={sid} meta={meta} x={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); toast('Saved'); }} />}
    </Page>
  );
});
function ExamForm({ me, sid, meta, x, onClose, onSaved }) {
  const isNew = !x.id;
  const [f, setF] = useState({ name: x.name || '', start_date: x.start_date || '', end_date: x.end_date || '', session_id: x.session_id || meta.current_session_id || '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { await (isNew ? asend('post', me, sid, '/exams', f) : asend('patch', me, sid, `/exams/${x.id}`, f)); onSaved(); } catch (z) { setErr(z.message); setBusy(false); }
  };
  return (
    <FormDialog title={isNew ? 'New exam' : 'Edit exam'} onClose={onClose} onSubmit={save} busy={busy} error={err}>
      <FormGrid>
      <Field full label="Exam name" req><input autoFocus required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Half-yearly, Final, Pre-board" /></Field>
      {isNew && <Field full label="Session"><select value={f.session_id} onChange={(e) => setF({ ...f, session_id: e.target.value })}>{meta.sessions.length === 0 && <option value="">No session set up</option>}{meta.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}</select></Field>}
      <Field label="Starts (optional)"><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
      <Field label="Ends (optional)"><input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
      </FormGrid>
    </FormDialog>
  );
}
