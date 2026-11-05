import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useData, invalidate } from '../cache.js';
import { Icon, Modal, Empty, Field, toast, Loading, ask } from '../ui.jsx';
import { scoped } from './AttendanceModule.jsx';
import { printCards, cardsHtml } from '../examCard.js';
import '../exam.css';

/* ------------------------------------------------------------------ helpers */
const sup = (me) => me.role === 'super_admin';
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, v)); const s = p.toString(); return s ? `?${s}` : ''; };
const mk = (me, sid) => {
  const sc = sup(me) ? { school_id: sid } : {};
  return {
    get: (p, params = {}) => api.get(`/examinations${p}${qs({ ...sc, ...params })}`),
    send: (m, p, body = {}) => api[m](`/examinations${p}`, { ...body, ...sc }),
    del: (p, params = {}) => api.del(`/examinations${p}${qs({ ...sc, ...params })}`),
  };
};
const useMeta = (ex, sid) => useData(`exm:meta:${sid}`, () => ex.get('/meta'));
const refreshAll = (refresh) => { invalidate('exm:'); refresh && refresh(); };
const num = (n) => (n === null || n === undefined ? '-' : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const tone = (p) => (p === null || p === undefined ? '' : p >= 75 ? 'hi' : p >= 60 ? 'mid' : p >= 40 ? 'lo' : 'bad');
const barColor = (p) => ({ hi: '#10b981', mid: '#3b82f6', lo: '#f59e0b', bad: '#ef4444', '': '#94a3b8' }[tone(p)]);
const Grade = ({ g, p }) => (g ? <span className={`ex-g ${tone(p)}`}>{g}</span> : <span className="muted">-</span>);
const Mini = ({ p }) => <span className="ex-bar2"><i style={{ width: `${Math.min(100, p ?? 0)}%`, background: barColor(p) }} /></span>;
const Tile = ({ label, value, a, b }) => <div className="ex-tile" style={{ '--t1': a, '--t2': b }}><small>{label}</small><b>{value}</b></div>;
const Hero = () => null; // description banner removed
const labelOf = (c) => c.label || `${c.name}${c.section ? ` ${c.section}` : ''}`;
const CCOL = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#7c3aed', '#2563eb', '#ea580c'];

const statusOf = (s) => (s.published ? ['pub', 'Published'] : s.pct === null ? ['review', 'No marks'] : s.result === 'Pending' ? ['review', 'In progress'] : ['ready', 'Ready to publish']);
const resultLabel = (r) => (r === 'Pending' ? 'In progress' : r);
function ClassPick({ meta, value, onChange, anyClass }) {
  return <select aria-label="Class" value={value || ''} onChange={(e) => onChange(e.target.value)}>{anyClass && <option value="">All my classes</option>}{meta.classes.map((c) => <option key={c.id} value={c.id}>{labelOf(c)}</option>)}</select>;
}
const firstClass = (meta) => meta.classes[0]?.id || '';
const NoClass = () => <Empty>No class is assigned to you yet.</Empty>;

/* ================================================================== 1. EXAMS OF EACH CLASS + GRADING */
export const ExamStructure = scoped(function ExamStructure({ me, sid }) {
  const ex = useMemo(() => mk(me, sid), [me, sid]);
  const { data: meta, error } = useMeta(ex, sid);
  const [tab, setTab] = useState(me.features.includes('manage_exam_structure') ? 'exams' : 'grading');
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  const can = me.features.includes('manage_exam_structure');
  const canGrade = me.features.includes('manage_exam_grading');
  const tabs = [can && ['exams', 'Exams of each class', 'academics'], ['grading', 'Grading criteria', 'check']].filter(Boolean);
  return (
    <div className="ex">
      <Hero title="Exams of each class" text="Choose a class and list its exams, for example 10th: PT1, PT2, Preboard - 8th: PT1, Half Yearly, PT2, Annual. Teachers then enter marks for each exam." />
      <div className="ex-tabs">{tabs.map(([k, l, i]) => <button key={k} className={`ex-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}><Icon name={i} size={16} />{l}</button>)}</div>
      {tab === 'exams' && can && <ClassExams ex={ex} meta={meta} />}
      {tab === 'grading' && <GradingEditor ex={ex} can={canGrade} sid={sid} />}
    </div>
  );
});

const QUICK = ['PT1', 'PT2', 'PT3', 'Half Yearly', 'Preboard', 'Annual'];
function ClassExams({ ex, meta }) {
  const [classId, setClassId] = useState(firstClass(meta));
  const cls = meta.classes.find((c) => c.id === classId) || meta.classes[0];
  const saved = meta.structure.filter((e) => e.class_id === cls?.id);
  const sig = JSON.stringify(saved.map((e) => [e.id, e.name, e.max_marks]));
  const [rows, setRows] = useState([]);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(saved.map((e) => ({ id: e.id, name: e.name, max_marks: e.max_marks }))); setAll(false); }, [cls?.id, sig]);
  if (!cls) return <NoClass />;
  const siblings = meta.classes.filter((c) => c.name === cls.name && c.id !== cls.id);
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; setRows(n); };
  const dirty = JSON.stringify(rows.map((r) => [r.id, r.name, Number(r.max_marks)])) !== sig;
  const copyFrom = (id) => { const src = meta.structure.filter((e) => e.class_id === id); setRows(src.map((e) => ({ name: e.name, max_marks: e.max_marks }))); };
  const save = async () => {
    const removed = saved.filter((e) => !rows.some((r) => r.id === e.id));
    if (removed.length && !(await ask(`Remove ${removed.map((e) => e.name).join(', ')}? Marks already entered for ${removed.length === 1 ? 'it' : 'them'} will be deleted.`))) return;
    setBusy(true);
    try {
      await ex.send('put', '/structure', { class_ids: [cls.id, ...(all ? siblings.map((c) => c.id) : [])], items: rows.map((r) => ({ id: r.id, name: r.name, max_marks: r.max_marks })) });
      toast(all && siblings.length ? `Saved for ${labelOf(cls)} and ${siblings.length} other section${siblings.length === 1 ? '' : 's'}` : 'Saved'); invalidate('exm:');
    } catch (e) { toast(e.message, true); }
    setBusy(false);
  };
  const others = meta.classes.filter((c) => c.id !== cls.id && meta.structure.some((e) => e.class_id === c.id));
  return (
    <>
      <div className="ex-sec">
        <div className="ex-bar"><ClassPick meta={meta} value={cls.id} onChange={setClassId} />
          {others.length > 0 && <select aria-label="Copy exams from" value="" onChange={(e) => e.target.value && copyFrom(e.target.value)}><option value="">Copy exams from…</option>{others.map((c) => <option key={c.id} value={c.id}>{labelOf(c)}</option>)}</select>}</div>
        {!rows.length && <p className="muted">No exams for {labelOf(cls)} yet. Add them below.</p>}
        <div className="scrollx"><table className="ex-tbl"><thead><tr><th>#</th><th>Exam name</th><th>Max marks</th><th /></tr></thead><tbody>
          {rows.map((r, i) => <tr key={r.id || `n${i}`}><td>{i + 1}</td>
            <td><input value={r.name} placeholder="e.g. PT1" onChange={(e) => set(i, 'name', e.target.value)} /></td>
            <td><input type="number" min="1" style={{ width: 90 }} value={r.max_marks} onChange={(e) => set(i, 'max_marks', e.target.value)} /></td>
            <td><div className="row"><button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button className="icon-btn" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="icon-btn" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button></div></td></tr>)}
        </tbody></table></div>
        <div className="chips" style={{ margin: '10px 0' }}>{QUICK.filter((q) => !rows.some((r) => r.name.toLowerCase() === q.toLowerCase())).map((q) => <button key={q} className="ex-chip" style={{ cursor: 'pointer' }} onClick={() => setRows([...rows, { name: q, max_marks: q === 'PT1' || q === 'PT2' || q === 'PT3' ? 20 : 80 }])}>+ {q}</button>)}
          <button className="ex-chip" style={{ cursor: 'pointer' }} onClick={() => setRows([...rows, { name: '', max_marks: 100 }])}>+ Other</button></div>
        {siblings.length > 0 && <label className="row" style={{ gap: 6, margin: '6px 0' }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Use the same exams for all sections of {cls.name} ({siblings.map(labelOf).join(', ')})</label>}
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save exams'}</button>
      </div>
      <div className="ex-sec"><h3>All classes</h3>
        {meta.classes.map((c) => { const l = meta.structure.filter((e) => e.class_id === c.id); return (
          <div key={c.id} className="ex-row" style={{ margin: '6px 0' }}><button className="linkbtn" style={{ width: 90, textAlign: 'left' }} onClick={() => setClassId(c.id)}><b>{labelOf(c)}</b></button>
            <div className="chips grow">{l.length ? l.map((e) => <span key={e.id} className="ex-chip">{e.name} · {num(e.max_marks)}</span>) : <span className="muted">No exams yet</span>}</div></div>); })}
      </div>
    </>
  );
}

function GradingEditor({ ex, can, sid }) {
  const { data, refresh } = useData(`exm:grading:${sid}`, () => ex.get('/grading'));
  const [rows, setRows] = useState([]);
  useEffect(() => { if (data) setRows(data.ranges.map((g) => ({ min_pct: g.min_pct, max_pct: g.max_pct, grade: g.grade, grade_point: g.grade_point, remark: g.remark || '', is_fail: !!g.is_fail }))); }, [data]);
  if (!data) return <Loading />;
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="ex-sec">
      <h3>Grading criteria</h3>
      {data.scope === 'default' && <div className="notice">Showing the standard 9-point scale. Save to make it your own.</div>}
      <div className="scrollx"><table className="ex-tbl"><thead><tr><th>From %</th><th>To %</th><th>Grade</th><th>Grade point</th><th>Remark</th><th className="c">Fail</th><th /></tr></thead><tbody>
        {rows.map((r, i) => <tr key={i}>
          <td><input type="number" style={{ width: 80 }} value={r.min_pct} disabled={!can} onChange={(e) => set(i, 'min_pct', e.target.value)} /></td>
          <td><input type="number" style={{ width: 80 }} value={r.max_pct} disabled={!can} onChange={(e) => set(i, 'max_pct', e.target.value)} /></td>
          <td><input type="text" style={{ width: 70 }} value={r.grade} disabled={!can} onChange={(e) => set(i, 'grade', e.target.value)} /></td>
          <td><input type="number" style={{ width: 80 }} value={r.grade_point} disabled={!can} onChange={(e) => set(i, 'grade_point', e.target.value)} /></td>
          <td><input type="text" value={r.remark} disabled={!can} onChange={(e) => set(i, 'remark', e.target.value)} /></td>
          <td className="c"><input type="checkbox" checked={r.is_fail} disabled={!can} onChange={(e) => set(i, 'is_fail', e.target.checked)} /></td>
          <td>{can && <button className="icon-btn" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button>}</td></tr>)}
      </tbody></table></div>
      {can && <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setRows([...rows, { min_pct: 0, max_pct: 0, grade: '', grade_point: 0, remark: '', is_fail: false }])}><Icon name="plus" size={15} />Add grade range</button>
        <button className="btn primary" onClick={async () => { try { await ex.send('put', '/grading', { ranges: rows }); toast('Grading criteria saved'); invalidate('exm:'); refresh(); } catch (e) { toast(e.message, true); } }}>Save criteria</button>
        {data.scope !== 'default' && <button className="btn danger" onClick={async () => { if (!(await ask('Go back to the standard scale?', { danger: false, yes: 'Reset' }))) return; try { await ex.del('/grading'); invalidate('exm:'); refresh(); } catch (e) { toast(e.message, true); } }}>Reset</button>}</div>}
    </div>
  );
}

/* ================================================================== 2. MARKS ENTRY */
export const ExamMarks = scoped(function ExamMarks({ me, sid }) {
  const ex = useMemo(() => mk(me, sid), [me, sid]);
  const { data: meta, error } = useMeta(ex, sid);
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  if (!meta.classes.length) return <NoClass />;
  return <MarksInner me={me} sid={sid} ex={ex} meta={meta} />;
});
function MarksInner({ me, sid, ex, meta }) {
  const [classId, setClass] = useState(firstClass(meta));
  const [open, setOpen] = useState(null);
  const { data: ov, error, refresh } = useData(`exm:ov:${sid}:${classId}`, () => ex.get('/marks/overview', { class_id: classId }), !!classId);
  const canEnter = me.features.includes('manage_exam_marks');
  if (open) return <MarksSheet ex={ex} sid={sid} examId={open.exam} subjectId={open.subject} canEnter={canEnter} onBack={() => { setOpen(null); invalidate('exm:ov'); refresh(); }} />;
  return (
    <div className="ex">
      <Hero title="Enter marks" text="Pick a class, then open an exam for one of your subjects and enter the marks. You can only enter marks for the subjects you teach in that class." />
      <div className="ex-bar"><ClassPick meta={meta} value={classId} onChange={setClass} /></div>
      {error && <div className="err">{error}</div>}
      {!ov ? <Loading /> : !ov.exams.length ? <Empty>No exams are set for {ov.class.label} yet. {me.features.includes('manage_exam_structure') ? 'Add them under Exam structure.' : 'Ask your school admin to set up the exams of this class.'}</Empty> : !ov.subjects.length ? <Empty>No subjects are set for {ov.class.label}.</Empty> : (
        <div className="scrollx"><table className="ex-tbl"><thead><tr><th>Subject</th>{ov.exams.map((e) => <th key={e.id} className="c">{e.name}<br /><small className="muted">out of {num(e.max_marks)}</small></th>)}</tr></thead><tbody>
          {ov.subjects.map((s) => <tr key={s.id}><td><b>{s.name}</b>{!s.can_edit && <div><small className="muted">view only</small></div>}</td>
            {ov.exams.map((e) => { const c = ov.cells[`${e.id}:${s.id}`]; const n = c?.entered || 0; const full = ov.size > 0 && n >= ov.size; return (
              <td key={e.id} className="c"><button className={`btn ${s.can_edit && canEnter ? 'primary' : ''}`} style={full ? { background: '#10b981', borderColor: '#10b981', color: '#fff' } : undefined} onClick={() => setOpen({ exam: e.id, subject: s.id })}>{n}/{ov.size}{full ? ' ✓' : ''}</button></td>); })}</tr>)}
        </tbody></table><p className="muted" style={{ marginTop: 8 }}>The number shows how many students have marks entered.</p></div>)}
    </div>
  );
}
function MarksSheet({ ex, sid, examId, subjectId, canEnter, onBack }) {
  const { data, error, refresh } = useData(`exm:sheet:${sid}:${examId}:${subjectId}`, () => ex.get('/marks/sheet', { exam_id: examId, subject_id: subjectId }));
  const [rows, setRows] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setRows(data.students.map((s) => ({ ...s, m: s.marks === null ? '' : String(s.marks) }))); }, [data]);
  if (error) return <div className="err">{error}<div><button className="btn" onClick={onBack}>Back</button></div></div>;
  if (!data || !rows) return <Loading />;
  const max = data.exam.max_marks; const canEdit = canEnter && data.can_edit;
  const set = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const bad = (r) => r.m !== '' && (Number.isNaN(Number(r.m)) || Number(r.m) < 0 || Number(r.m) > max);
  const anyBad = rows.some(bad);
  const save = async () => {
    setBusy(true);
    try { await ex.send('put', '/marks/sheet', { exam_id: examId, subject_id: subjectId, items: rows.map((r) => ({ student_id: r.student_id, marks: r.absent || r.m === '' ? null : Number(r.m), absent: r.absent, remark: r.remark || '' })) }); toast('Marks saved'); invalidate('exm:'); refresh(); } catch (e) { toast(e.message, true); }
    setBusy(false);
  };
  return (
    <div className="ex">
      <div className="ex-bar"><button className="btn" onClick={onBack}><Icon name="back" size={16} />Back</button>
        <div className="grow"><b>{data.exam.name} · {data.subject.name}</b> <span className="muted">· {data.class.label} · out of {num(max)}</span></div>
        {canEdit && <button className="btn primary" disabled={busy || anyBad} onClick={save}>{busy ? 'Saving…' : 'Save marks'}</button>}</div>
      {!canEdit && <div className="notice">You can view these marks but not change them{canEnter ? ': you are not assigned to teach this subject in this class.' : '.'}</div>}
      <div className="scrollx"><table className="ex-tbl"><thead><tr><th>#</th><th>Roll</th><th>Student</th><th>Marks (/{num(max)})</th><th className="c">Absent</th><th>%</th><th>Remark</th></tr></thead><tbody>
        {rows.map((r, i) => { const p = r.absent || r.m === '' || bad(r) ? null : Math.round((Number(r.m) / max) * 1000) / 10; return (
          <tr key={r.student_id}><td>{i + 1}</td><td>{r.roll_no ?? '-'}</td><td><b>{r.full_name}</b></td>
            <td><input type="number" step="0.5" style={{ width: 90 }} className={bad(r) ? 'bad' : ''} disabled={!canEdit || r.absent} value={r.absent ? '' : r.m} onChange={(e) => set(i, { m: e.target.value })} /></td>
            <td className="c"><input type="checkbox" disabled={!canEdit} checked={r.absent} onChange={(e) => set(i, { absent: e.target.checked, m: '' })} /></td>
            <td>{p === null ? <span className="muted">-</span> : <><Mini p={p} /> {p}%</>}</td>
            <td><input type="text" placeholder="Good / Can improve…" list="ex-remarks" disabled={!canEdit} value={r.remark || ''} onChange={(e) => set(i, { remark: e.target.value })} /></td></tr>); })}
      </tbody></table>
        <datalist id="ex-remarks">{['Excellent', 'Good', 'Can improve', 'Needs support', 'Needs more practice', 'Very attentive'].map((x) => <option key={x} value={x} />)}</datalist></div>
    </div>
  );
}

/* ================================================================== 3. RESULTS & REPORT CARDS */
export const ExamResults = scoped(function ExamResults({ me, sid }) {
  const ex = useMemo(() => mk(me, sid), [me, sid]);
  const { data: meta, error } = useMeta(ex, sid);
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  if (!meta.classes.length) return <NoClass />;
  return <ResultsInner me={me} sid={sid} ex={ex} meta={meta} />;
});
function ResultsInner({ me, sid, ex, meta }) {
  const [classId, setClass] = useState(firstClass(meta));
  const { data, error, refresh } = useData(`exm:res:${sid}:${classId}`, () => ex.get('/results', { class_id: classId }), !!classId);
  const [sel, setSel] = useState([]); const [open, setOpen] = useState(null); const [view, setView] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => setSel([]), [classId]);
  const canPub = me.features.includes('publish_exam_results');
  const stu = data?.students || [];
  const all = stu.length > 0 && sel.length === stu.length;
  const act = async (unpublish) => {
    setBusy(true);
    try { const r = await ex.send('post', '/results/publish', { class_id: classId, student_ids: sel, unpublish }); toast(unpublish ? 'Report cards unpublished' : `Published for ${r.count} student${r.count === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} have no marks yet)` : ''}`); setSel([]); invalidate('exm:'); refresh(); } catch (e) { toast(e.message, true); }
    setBusy(false);
  };
  const print = async (only) => {
    try { const cards = await ex.get('/report-cards', { class_id: classId }); const list = only ? cards.filter((c) => only.includes(c.student.id)) : cards; if (!list.length) return toast('Nothing to print', true); printCards(list); } catch (e) { toast(e.message, true); }
  };
  const preview = async (s) => { try { setView(await ex.get('/report-card', { class_id: classId, student_id: s.student_id })); } catch (e) { toast(e.message, true); } };
  return (
    <div className="ex">
      <Hero title="Results & report cards" text="Totals, percentages, grades and ranks are worked out from the marks teachers enter. Publish a report card to show it to the student and parents, or print it." />
      <div className="ex-bar"><ClassPick meta={meta} value={classId} onChange={setClass} /></div>
      {error && <div className="err">{error}</div>}
      {!data ? <Loading /> : (
        <>
          <div className="ex-tiles">
            <Tile label="Students" value={data.stats.students} a="#4f46e5" b="#7c3aed" /><Tile label="Class average" value={data.stats.avg_pct === null ? '-' : `${data.stats.avg_pct}%`} a="#0891b2" b="#06b6d4" />
            <Tile label="Passed" value={data.stats.pass} a="#059669" b="#10b981" /><Tile label="Failed" value={data.stats.fail} a="#e11d48" b="#f43f5e" />
            <Tile label="In progress" value={data.stats.pending} a="#d97706" b="#f59e0b" /><Tile label="Published" value={data.stats.published} a="#db2777" b="#ec4899" /></div>
          {data.exams.length > 0 && <div className="chips" style={{ marginBottom: 8 }}><span className="muted">Exams:</span>{data.exams.map((e) => <span key={e.id} className="ex-chip">{e.name} · {num(e.max_marks)}</span>)}</div>}
          <div className="ex-bar">
            <b>{sel.length ? `${sel.length} selected` : 'Select students'}</b><span style={{ flex: 1 }} />
            <button className="btn" onClick={() => print(sel.length ? sel : null)}><Icon name="download" size={15} />{sel.length ? 'Print selected' : 'Print all report cards'}</button>
            {canPub && <button className="btn" disabled={!sel.length || busy} onClick={() => act(true)}>Unpublish</button>}
            {canPub && <button className="btn primary" disabled={!sel.length || busy} onClick={() => act(false)}><Icon name="send" size={15} />Publish report cards</button>}</div>
          {!stu.length ? <Empty>No students in this class.</Empty> : !data.exams.length ? <Empty>No exams are set for this class yet.</Empty> : !data.subjects.length ? <Empty>No subjects are set for this class yet.</Empty> : (
            <div className="scrollx"><table className="ex-tbl"><thead><tr><th><input type="checkbox" checked={all} onChange={() => setSel(all ? [] : stu.map((s) => s.student_id))} /></th><th>#</th><th>Student</th><th className="n">Total marks</th><th>Percentage</th><th className="c">Grade</th><th className="c">Rank</th><th>Result</th><th>Status</th><th /></tr></thead><tbody>
              {stu.map((s, i) => { const [sk, sl] = statusOf(s); return (
                <React.Fragment key={s.student_id}>
                  <tr><td><input type="checkbox" checked={sel.includes(s.student_id)} onChange={() => setSel(sel.includes(s.student_id) ? sel.filter((x) => x !== s.student_id) : [...sel, s.student_id])} /></td>
                    <td>{s.roll_no ?? i + 1}</td><td><button className="linkbtn" style={{ textDecoration: 'none', color: 'var(--ink)' }} onClick={() => setOpen(open === s.student_id ? null : s.student_id)}><b>{s.full_name}</b></button></td>
                    <td className="n">{s.pct === null ? '-' : <><b>{num(s.total)}</b> <span className="muted">/ {num(s.max)}</span></>}</td><td>{s.pct === null ? '-' : <><Mini p={s.pct} /> {s.pct}%</>}</td>
                    <td className="c"><Grade g={s.grade} p={s.pct} /></td><td className="c">{s.rank ?? '-'}</td>
                    <td><span className={`ex-chip ${s.result.toLowerCase()}`}>{resultLabel(s.result)}</span></td><td><span className={`ex-chip ${sk}`}>{sl}</span></td>
                    <td><button className="btn" disabled={s.pct === null} onClick={() => preview(s)}>Report card</button></td></tr>
                  {open === s.student_id && <tr><td /><td colSpan={9}><div className="scrollx"><table className="ex-tbl"><thead><tr><th>Subject</th>{data.exams.map((e) => <th key={e.id} className="c">{e.name}</th>)}<th className="c">Total</th><th className="c">%</th><th className="c">Grade</th></tr></thead><tbody>
                    {s.subjects.map((c) => <tr key={c.subject_id}><td>{c.name}</td>{c.cells.map((p, k) => <td key={k} className="c">{p ? (p.absent ? 'AB' : `${num(p.marks)}/${num(p.max)}`) : <span className="muted">-</span>}</td>)}<td className="c">{c.max ? `${num(c.total)}/${num(c.max)}` : '-'}</td><td className="c">{c.pct ?? '-'}</td><td className="c"><Grade g={c.grade} p={c.pct} /></td></tr>)}
                  </tbody></table></div></td></tr>}
                </React.Fragment>); })}
            </tbody></table></div>)}
        </>)}
      {view && <Modal title={`Report card · ${view.student.name}`} wide onClose={() => setView(null)}>
        <div className="row sp" style={{ marginBottom: 8 }}><span className="muted">{view.class.label}</span><button className="btn primary" onClick={() => printCards([view])}><Icon name="download" size={15} />Print / Save as PDF</button></div>
        <iframe className="ex-frame" title="Report card" srcDoc={cardsHtml([view])} /></Modal>}
    </div>
  );
}

/* ================================================================== 4. ANALYSIS */
export const ExamAnalysis = scoped(function ExamAnalysis({ me, sid }) {
  const ex = useMemo(() => mk(me, sid), [me, sid]);
  const { data: meta, error } = useMeta(ex, sid);
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  if (!meta.classes.length) return <NoClass />;
  return <AnalysisInner sid={sid} ex={ex} meta={meta} />;
});
const Spark = ({ pts }) => {
  if (!pts || pts.length < 2) return <span className="muted">Not enough exams for a trend</span>;
  const w = 220; const h = 44; const xs = (i) => 8 + (i * (w - 16)) / (pts.length - 1); const ys = (v) => h - 6 - (v / 100) * (h - 12);
  return <svg className="ex-spark" viewBox={`0 0 ${w} ${h}`}><polyline fill="none" stroke="#7c3aed" strokeWidth="2.5" points={pts.map((p, i) => `${xs(i)},${ys(p.avg)}`).join(' ')} />{pts.map((p, i) => <g key={i}><circle cx={xs(i)} cy={ys(p.avg)} r="4" fill="#fff" stroke="#7c3aed" strokeWidth="2" /><text x={xs(i)} y={ys(p.avg) - 7} fontSize="9" textAnchor="middle" fill="currentColor">{p.avg}</text></g>)}</svg>;
};
function AnalysisInner({ sid, ex, meta }) {
  const [classId, setClass] = useState('');
  const { data: d, error } = useData(`exm:an:${sid}:${classId}`, () => ex.get('/analytics', { class_id: classId }));
  return (
    <div className="ex">
      <Hero title="Performance analysis" text="Compare classes, find weak subjects and see which students need extra support." />
      <div className="ex-bar"><ClassPick meta={meta} value={classId} onChange={setClass} anyClass /></div>
      {error && <div className="err">{error}</div>}
      {!d ? <Loading /> : !d.summary.with_marks ? <Empty>No marks entered yet.</Empty> : (
        <>
          <div className="ex-tiles"><Tile label="Students with marks" value={d.summary.with_marks} a="#4f46e5" b="#7c3aed" /><Tile label="Average score" value={`${d.summary.avg_pct}%`} a="#0891b2" b="#06b6d4" /><Tile label="Pass rate" value={d.summary.pass_pct === null ? '-' : `${d.summary.pass_pct}%`} a="#059669" b="#10b981" /><Tile label="Top score" value={`${d.summary.highest}%`} a="#d97706" b="#f59e0b" /></div>
          <div className="ex-cols">
            <div className="ex-sec"><h3>Class-wise average score</h3>{d.classes.filter((c) => c.avg_pct !== null).map((c, i) => <div className="ex-hbar" key={c.class_id} style={{ '--c1': CCOL[i % 8], '--c2': CCOL[(i + 3) % 8] }}><span>{c.label}</span><span className="t"><i style={{ width: `${c.avg_pct}%` }} /></span><b>{c.avg_pct}%</b></div>)}</div>
            <div className="ex-sec"><h3>Subject averages</h3>{d.subjects.map((s) => <div className="ex-hbar" key={s.subject_id} style={{ '--c1': barColor(s.avg), '--c2': barColor(s.avg) }}><span>{s.name}</span><span className="t"><i style={{ width: `${s.avg}%` }} /></span><b>{s.avg}%</b></div>)}</div>
          </div>
          <div className="ex-cols">
            <div className="ex-sec"><h3>Weak subjects</h3>{!d.weak.length ? <p className="muted">No subject is averaging below 60%. 🎉</p> : d.weak.map((w) => <div key={w.subject_id} style={{ marginBottom: 10 }}><div className="row sp"><b>{w.name}</b><span className="ex-chip fail">{w.avg}% · below average</span></div>
              {classId && <><Spark pts={w.trend} /><small className="muted">{(w.trend || []).map((t) => t.name).join(' → ')}</small></>}
              {!classId && w.by_class.length > 1 && <small className="muted">Lowest: {[...w.by_class].sort((a, b) => a.avg - b.avg)[0].label} ({[...w.by_class].sort((a, b) => a.avg - b.avg)[0].avg}%)</small>}</div>)}</div>
            <div className="ex-sec"><h3>Grade distribution</h3><div className="chips">{Object.entries(d.grade_dist).map(([g, n]) => <span key={g} className="ex-chip pub">{g}: {n}</span>)}</div>
              <h3 style={{ marginTop: 14 }}>Top performers</h3>{d.top.map((s, i) => <div key={s.student_id} className="ex-row" style={{ margin: '5px 0' }}><span className="ex-chip pass">#{i + 1}</span><span className="grow"><b>{s.full_name}</b> <small className="muted">{s.class_label}</small></span><b>{s.pct}%</b><Grade g={s.grade} p={s.pct} /></div>)}</div>
          </div>
          <div className="ex-sec"><h3>Students who need support</h3>{!d.support.length ? <p className="muted">No student is below 40% or failing a subject.</p> : (
            <div className="scrollx"><table className="ex-tbl"><thead><tr><th>Student</th><th>Class</th><th>Overall</th><th>Needs help in</th></tr></thead><tbody>{d.support.map((s) => <tr key={s.student_id}><td><b>{s.full_name}</b></td><td>{s.class_label}</td><td><Mini p={s.pct} /> {s.pct}%</td><td>{s.weak_subjects.map((x) => <span key={x} className="ex-tag">{x}</span>)}</td></tr>)}</tbody></table></div>)}</div>
        </>)}
    </div>
  );
}

/* ================================================================== 5. MY REPORT CARDS (student / parent) */
export function MyReportCards({ me }) {
  const isParent = me.role === 'parent';
  const { data: kids } = useData('exm:kids', () => api.get('/users/my-children'), isParent);
  const [pick, setPick] = useState('');
  if (isParent && !kids) return <Loading />;
  if (isParent && !kids.length) return <Empty>No student is linked to your account yet. Ask the school office.</Empty>;
  const sid = isParent ? (pick || kids[0].user_id) : me.user_id;
  return (
    <div className="ex">
      {isParent && kids.length > 1 && <div className="pills">{kids.map((k) => <button key={k.user_id} className={`pill ${sid === k.user_id ? 'on' : ''}`} onClick={() => setPick(k.user_id)}>{k.profile?.full_name || k.login_id}</button>)}</div>}
      <MyInner key={sid} studentId={sid} />
    </div>
  );
}
function MyInner({ studentId }) {
  const { data, error } = useData(`exm:my:${studentId}`, () => api.get(`/examinations/my?student_id=${studentId}`));
  const [busy, setBusy] = useState('');
  if (error) return <div className="err">{error}</div>;
  if (!data) return <Loading />;
  const open = async (r) => { setBusy(r.class_id); try { printCards([await api.get(`/examinations/report-card?class_id=${r.class_id}&student_id=${studentId}`)]); } catch (e) { toast(e.message, true); } setBusy(''); };
  return (
    <>
      <Hero title="Report cards" text="Published report cards. Open one to print it or save it as a PDF." />
      {!data.length ? <Empty>No report card has been published yet.</Empty> : (
        <div className="ex-res">{data.map((r, i) => (
          <div key={r.class_id} className="ex-card" style={{ '--cc': CCOL[i % 8] }}>
            <div className="row sp"><h3>{r.class}{r.session ? ` · ${r.session}` : ''}</h3><span className={`ex-chip ${r.result.toLowerCase()}`}>{resultLabel(r.result)}</span></div>
            <small className="muted">{r.exams.join(' · ')}</small>
            <div className="ex-kv"><div>Percentage<b>{r.pct}%</b></div><div>Grade<b>{r.grade || '-'}</b></div><div>Rank<b>{r.rank ? `${r.rank}/${r.class_size}` : '-'}</b></div></div>
            <div className="chips">{r.subjects.map((s) => <span key={s.name} className="ex-chip" style={{ '--cc': barColor(s.pct) }}>{s.name} {s.pct ?? '-'}%</span>)}</div>
            <button className="btn primary" disabled={busy === r.class_id} onClick={() => open(r)}><Icon name="download" size={15} />View / print report card</button>
          </div>))}</div>)}
    </>
  );
}

/* ================================================================== 6. SUBJECTS */
const subjApi = (me, sid) => {
  const sc = sup(me) ? { school_id: sid } : {};
  return {
    list: () => api.get(`/academics/meta${qs(sc)}`),
    add: (body) => api.post('/academics/subjects', { ...body, ...sc }),
    edit: (id, body) => api.patch(`/academics/subjects/${id}`, { ...body, ...sc }),
    del: (id) => api.del(`/academics/subjects/${id}${qs(sc)}`),
  };
};
export const SubjectManager = scoped(function SubjectManager({ me, sid }) {
  const sa = useMemo(() => subjApi(me, sid), [me, sid]);
  const { data: meta, error, refresh } = useData(`exm:subj:${sid}`, () => sa.list());
  const [f, setF] = useState({ name: '', code: '' }); const [busy, setBusy] = useState(false); const [edit, setEdit] = useState(null);
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  const done = async () => { invalidate('exm:'); await refresh(); };
  const add = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await sa.add(f); setF({ name: '', code: '' }); await done(); toast('Subject added'); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const del = async (s) => { if (!(await ask(`Delete subject ${s.name}?`))) return; try { await sa.del(s.id); await done(); toast('Deleted'); } catch (x) { toast(x.message, true); } };
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <form className="card row" onSubmit={add} style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 2, minWidth: 160 }}><Field label="New subject" req><input required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Mathematics" /></Field></div>
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
      {edit && <SubjectEdit sa={sa} s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); done(); toast('Saved'); }} />}
    </div>
  );
});
function SubjectEdit({ sa, s, onClose, onSaved }) {
  const [f, setF] = useState({ name: s.name, code: s.code || '' }); const [err, setErr] = useState('');
  const save = async (e) => { e.preventDefault(); try { await sa.edit(s.id, f); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Edit subject" onClose={onClose}><form className="form" onSubmit={save}>
      <div className="full"><Field label="Name" req><input required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
      <div className="full"><Field label="Code"><input maxLength={12} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field></div>
      {err && <div className="err full">{err}</div>}<button className="btn primary full" style={{ justifyContent: 'center' }}>Save</button>
    </form></Modal>
  );
}
