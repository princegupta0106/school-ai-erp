import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useData } from '../cache.js';
import { Icon, Modal, Empty, toast } from '../ui.jsx';
import { fetchers } from '../fetchers.js';

const ST = {
  present: { short: 'P', label: 'Present' },
  absent: { short: 'A', label: 'Absent' },
  late: { short: 'L', label: 'Late' },
  leave: { short: 'Lv', label: 'Leave' },
};
const ORDER = ['present', 'absent', 'late', 'leave'];
const clsName = (c) => `${c.name}${c.section ? ` ${c.section}` : ''}`;
const fmtDate = (d, o = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, o) : '');
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const fmtMonth = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

// remembered between tabs (module-level, so changing tab keeps the school and "open this class" jumps work)
let chosenSchool = '';
let jump = null;

const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, v)); const s = p.toString(); return s ? `?${s}` : ''; };
const sup = (me) => me.role === 'super_admin';
const scopeQ = (me, sid) => (sup(me) ? { school_id: sid } : {});
const get = (me, sid, path, params = {}) => api.get(`/attendance${path}${qs({ ...scopeQ(me, sid), ...params })}`);
const send = (method, me, sid, path, body = {}) => api[method](`/attendance${path}`, { ...body, ...scopeQ(me, sid) });

function useGet(me, sid, path, params, enabled = true) {
  const [st, setSt] = useState({ data: null, error: '', loading: enabled });
  const key = JSON.stringify([sid, path, params, enabled]);
  useEffect(() => {
    if (!enabled) { setSt({ data: null, error: '', loading: false }); return undefined; }
    let live = true;
    setSt((s) => ({ ...s, loading: true, error: '' }));
    get(me, sid, path, params).then((d) => live && setSt({ data: d, error: '', loading: false })).catch((e) => live && setSt({ data: null, error: e.message, loading: false }));
    return () => { live = false; };
  }, [key]); // eslint-disable-line
  return st;
}

// the class list (with "marked today?" state) is cached, so tabs open instantly
const useClasses = (me, sid, date = '') => useData(`att:classes:${sid}:${date || 'today'}`, () => fetchers.attClasses(sup(me) ? sid : undefined, date));

// super admin works inside one school at a time
export function scoped(Inner) {
  return function Scoped(props) {
    const { me } = props;
    const isSup = sup(me);
    const { data: schools } = useData('schools', fetchers.schools, isSup);
    const [sid, setSid] = useState(isSup ? chosenSchool : me.school_id);
    useEffect(() => { if (isSup && !sid && schools?.length === 1) { chosenSchool = schools[0].id; setSid(schools[0].id); } }, [schools]); // eslint-disable-line
    return (
      <div className="stack">
        {isSup && <select style={{ width: 'auto', alignSelf: 'flex-start' }} value={sid} onChange={(e) => { chosenSchool = e.target.value; setSid(e.target.value); }}>
          <option value="">Choose a school</option>{(schools || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        {sid ? <Inner key={sid} {...props} sid={sid} /> : <Empty>Choose a school to continue.</Empty>}
      </div>
    );
  };
}

const Pct = ({ v }) => (v === null || v === undefined ? <span className="pct none">-</span> : <span className={`pct ${v >= 90 ? 'ok' : v >= 75 ? 'mid' : 'low'}`}>{v}%</span>);
const Tile = ({ n, label, tone, on, onClick }) => (
  <button type="button" className={`tile ${tone || ''} ${on ? 'on' : ''}`} onClick={onClick} disabled={!onClick}><b>{n}</b><span>{label}</span></button>
);
const Notice = ({ tone = 'info', children }) => <div className={`notice ${tone}`}>{children}</div>;

function csv(name, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([`\ufeff${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ===================================================================== TAKE ATTENDANCE */
function statusLine(c) {
  if (c.state === 'not_marked') return { tone: 'none', text: 'Not marked yet' };
  const who = c.marked_by.length ? ` by ${c.marked_by.join(', ')}` : '';
  if (c.state === 'partial') return { tone: 'part', text: `Partly marked ${c.marked}/${c.total_students}${who}` };
  return { tone: 'done', text: `Marked${who}${c.last_updated ? ` at ${fmtTime(c.last_updated)}` : ''}` };
}

function ClassCard({ c, onOpen }) {
  const s = statusLine(c);
  return (
    <button className={`ccard ${s.tone}`} onClick={() => onOpen(c.id)}>
      <div className="row sp"><b className="cname">{clsName(c)}</b>{c.is_class_teacher && <span className="chip">Class teacher</span>}</div>
      <div className={`cstate ${s.tone}`}><Icon name={s.tone === 'done' ? 'check' : 'attendance'} size={15} />{s.text}</div>
      {c.marked > 0 ? (
        <div className="mini"><span className="p">{c.present} present</span><span className="a">{c.absent} absent</span>{c.late > 0 && <span className="l">{c.late} late</span>}{c.leave > 0 && <span className="v">{c.leave} leave</span>}</div>
      ) : <div className="mini"><span>{c.total_students} student{c.total_students === 1 ? '' : 's'}</span></div>}
    </button>
  );
}

export const TakeAttendance = scoped(function Take({ me, sid, go }) {
  const init = useRef(null);
  if (init.current === null) { init.current = jump || {}; jump = null; }
  const [date, setDate] = useState(init.current.date || '');
  const [open, setOpen] = useState(init.current.class_id || null);
  const { data, error, refresh } = useClasses(me, sid, date);

  if (open && data) {
    return <Sheet me={me} sid={sid} classId={open} date={date} today={data.today}
      onBack={() => { setOpen(null); refresh(); }} onSaved={refresh}
      goRolls={me.features.includes('manage_roll_numbers') ? () => go('rolls') : null} />;
  }
  if (error) return <div className="err">{error}</div>;
  if (!data) return <Empty>Loading...</Empty>;
  const marked = data.classes.filter((c) => c.state === 'marked').length;
  const isToday = data.date === data.today;
  return (
    <>
      <div className="card row sp">
        <div>
          <b style={{ fontSize: 17 }}>{isToday ? 'Today' : fmtDate(data.date)}</b>
          <div style={{ color: 'var(--mute)', fontSize: 14 }}>{isToday ? `${fmtDate(data.today)} - ` : ''}{data.classes.length === 0 ? 'No classes' : `${marked} of ${data.classes.length} class${data.classes.length === 1 ? '' : 'es'} marked`}</div>
        </div>
        <div className="row">
          {!isToday && <button className="btn" onClick={() => setDate('')}>Back to today</button>}
          <input type="date" aria-label="Attendance date" style={{ width: 'auto' }} max={data.today} value={data.date} onChange={(e) => e.target.value && setDate(e.target.value === data.today ? '' : e.target.value)} />
        </div>
      </div>
      {data.classes.length === 0
        ? <Empty>{me.features.includes('attendance_all_classes') ? 'This school has no classes yet. Add them under Users > Classes.' : 'No class is assigned to you yet. Ask your school admin to assign you under Attendance > Class teachers.'}</Empty>
        : <div className="cgrid">{data.classes.map((c) => <ClassCard key={c.id} c={c} onOpen={setOpen} />)}</div>}
    </>
  );
});

function Sheet({ me, sid, classId, date, today, onBack, onSaved, goRolls }) {
  const [sh, setSh] = useState(null); const [err, setErr] = useState('');
  const [marks, setMarks] = useState({}); const [saved, setSaved] = useState({});
  const [touched, setTouched] = useState(false); const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(''); const [sort, setSort] = useState('roll'); const [filter, setFilter] = useState(''); const [more, setMore] = useState(null);

  const fetchSheet = useCallback(async () => {
    const d = await get(me, sid, '/sheet', { class_id: classId, date });
    const s = {}; const m = {};
    d.students.forEach((x) => { s[x.student_id] = x.status; m[x.student_id] = x.status || 'absent'; });
    setSh(d); setSaved(s); setMarks(m); setTouched(false);
    return d;
  }, [me, sid, classId, date]);
  useEffect(() => { fetchSheet().catch((e) => setErr(e.message)); }, [fetchSheet]);

  const students = sh?.students || [];
  const dirty = students.some((s) => marks[s.student_id] !== saved[s.student_id]);
  useEffect(() => {
    if (!touched || !dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [touched, dirty]);

  const counts = useMemo(() => { const c = { present: 0, absent: 0, late: 0, leave: 0 }; students.forEach((s) => { c[marks[s.student_id]] += 1; }); return c; }, [students, marks]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = students.filter((s) => (!filter || marks[s.student_id] === filter)
      && (!needle || `${s.full_name} ${s.login_id} ${s.admission_no || ''} ${s.roll_no ?? ''}`.toLowerCase().includes(needle)));
    return [...list].sort(sort === 'name' ? (a, b) => a.full_name.localeCompare(b.full_name) : (a, b) => (a.roll_no ?? 1e9) - (b.roll_no ?? 1e9) || a.full_name.localeCompare(b.full_name));
  }, [students, marks, q, sort, filter]);

  const can = !!sh?.can_edit;
  const set = (id, status) => { setMarks((m) => ({ ...m, [id]: status })); setTouched(true); };
  const setAll = (status) => { setMarks(Object.fromEntries(students.map((s) => [s.student_id, status]))); setTouched(true); };
  const back = () => { if (touched && dirty && !confirm('You have unsaved changes. Leave without saving?')) return; onBack(); };

  const toggle = (id) => set(id, marks[id] === 'present' ? 'absent' : 'present');

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await send('put', me, sid, '/sheet', { class_id: classId, date: sh.date, records: students.map((s) => ({ student_id: s.student_id, status: marks[s.student_id] })) });
      await fetchSheet(); onSaved?.();
      toast(`Attendance saved - ${counts.absent} absent${r.saved === 0 ? ' (no changes)' : ''}`);
    } catch (x) { setErr(x.message); toast(x.message, true); } finally { setBusy(false); }
  };

  if (err && !sh) return <><button className="btn" onClick={onBack}><Icon name="back" size={16} />Back</button><div className="err">{err}</div></>;
  if (!sh) return <Empty>Loading...</Empty>;

  const st = sh.status; const noRoll = students.filter((s) => !s.roll_no).length;
  const isToday = sh.date === today;
  return (
    <div className="sheetwrap">
      <div className="row sp">
        <div className="row"><button className="btn" onClick={back}><Icon name="back" size={16} />Classes</button>
          <div><b style={{ fontSize: 19 }}>Class {clsName(sh.class)}</b><div style={{ color: 'var(--mute)', fontSize: 14 }}>{isToday ? 'Today' : ''} {fmtDate(sh.date)}{sh.teachers.length ? ` - ${sh.teachers.map((t) => t.name).join(', ')}` : ''}</div></div></div>
      </div>

      {sh.holiday && <Notice tone="warn">{fmtDate(sh.date, { day: 'numeric', month: 'short' })} is marked as <b>{sh.holiday.title}</b> ({sh.holiday.type}) in the school calendar. You can still mark attendance if school was open.</Notice>}
      {!can && <Notice>{sh.edit_note || 'View only'} - you can look but not change this sheet.</Notice>}
      {st.state === 'marked' && <Notice tone="ok"><b>Already marked{st.marked_by.length ? ` by ${st.marked_by.join(', ')}` : ''}</b>{st.last_updated ? ` at ${fmtTime(st.last_updated)}` : ''}. {can ? 'No need to redo it - tap a student to change (e.g. came late).' : ''}</Notice>}
      {st.state === 'partial' && <Notice tone="warn"><b>Only {st.marked} of {st.total_students} students are marked</b>{st.marked_by.length ? ` (by ${st.marked_by.join(', ')})` : ''}. The rest are new or were missed - save to mark everyone.</Notice>}
      {st.state === 'not_marked' && students.length > 0 && <Notice>Not marked yet. Everyone starts as <b>Absent</b> - tap a student to mark Present, then save.</Notice>}
      {noRoll > 0 && students.length > 0 && <Notice tone="warn">{noRoll} student{noRoll === 1 ? ' has' : 's have'} no roll number.{goRolls && <> <button className="linkbtn" onClick={goRolls}>Assign roll numbers</button></>}</Notice>}

      {students.length === 0 ? <Empty>No active students in this class.</Empty> : (<>
        <div className="asum slim">
          {ORDER.map((k) => <Tile key={k} tone={k} n={counts[k]} label={ST[k].label} on={filter === k} onClick={() => setFilter(filter === k ? '' : k)} />)}
        </div>

        <div className="atools">
          <div style={{ position: 'relative', flex: '1 1 150px' }}><input placeholder="Search name or roll no." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} /><span style={{ position: 'absolute', left: 11, top: 10, color: 'var(--mute)' }}><Icon name="search" size={18} /></span></div>
          <button className="btn" onClick={() => setSort(sort === 'roll' ? 'name' : 'roll')}>{sort === 'roll' ? 'Roll no.' : 'Name'}</button>
          {can && <button className="btn" onClick={() => setAll(counts.present === students.length ? 'absent' : 'present')}>{counts.present === students.length ? 'All absent' : 'All present'}</button>}
        </div>

        <div className="card alist">
          {rows.length === 0 && <div className="empty">No student matches.</div>}
          {rows.map((s) => {
            const cur = marks[s.student_id]; const id = s.student_id;
            return (
              <div key={id} className={`arow ${cur}`}>
                <div className="atap" role="button" tabIndex={can ? 0 : -1} aria-pressed={cur === 'present'} onClick={() => can && toggle(id)} onKeyDown={(e) => can && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(id))}>
                  <span className="roll">{s.roll_no ?? '-'}</span>
                  <div className="aname"><b>{s.full_name}</b>{saved[id] && saved[id] !== cur && <small>changed</small>}</div>
                  <span className={`state ${cur}`}>{cur === 'present' && <Icon name="check" size={15} />}{ST[cur].label}</span>
                </div>
                {can && <button type="button" className="morebtn" aria-label="Late or leave" onClick={() => setMore(more === id ? null : id)}>&#8943;</button>}
                {more === id && <div className="moreopts">{['late', 'leave'].map((k) => <button key={k} type="button" className={`btn ${cur === k ? 'primary' : ''}`} onClick={() => { set(id, cur === k ? 'present' : k); setMore(null); }}>{ST[k].label}</button>)}</div>}
              </div>);
          })}
        </div>

        {can && <div className="asave">
          <div className="sum"><b>{counts.present + counts.late + counts.leave}</b> / {students.length} here{counts.absent > 0 && <> - <span className="a"><b>{counts.absent}</b> absent</span></>}{dirty && <span className="dot" title="Unsaved changes" />}</div>
          {err && <span className="err">{err}</span>}
          <button className="btn primary big" onClick={save} disabled={busy || (!dirty && st.state === 'marked')}>{busy ? 'Saving...' : st.state === 'marked' && !dirty ? 'Saved' : st.state === 'marked' ? 'Save changes' : 'Save attendance'}</button>
        </div>}
      </>)}
    </div>
  );
}

/* ===================================================================== REPORTS */
function RangeBar({ today, value, shown, shownDefault, onChange }) {
  const first = (t) => `${t.slice(0, 7)}-01`;
  const back = (t, n) => { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const presets = [
    ['This session', { from: '', to: '' }],
    ['This month', { from: first(today), to: today }],
    ['Last 7 days', { from: back(today, 6), to: today }],
    ['Last 30 days', { from: back(today, 29), to: today }],
  ];
  const same = (a, b) => a.from === b.from && a.to === b.to;
  return (
    <div className="row">
      <div className="pills">{presets.map(([l, v]) => <button key={l} className={`pill ${same(value, v) ? 'on' : ''}`} onClick={() => onChange(v)}>{l}</button>)}</div>
      <input type="date" aria-label="From date" style={{ width: 'auto' }} max={today} value={value.from || shown?.from || ''} onChange={(e) => onChange({ from: e.target.value, to: value.to || shown?.to || today })} />
      <span style={{ color: 'var(--mute)' }}>to</span>
      <input type="date" aria-label="To date" style={{ width: 'auto' }} max={today} value={value.to || shown?.to || today} onChange={(e) => onChange({ from: value.from || shown?.from || '', to: e.target.value })} />
    </div>
  );
}
const ClassSelect = ({ classes, value, onChange, all }) => (
  <select style={{ width: 'auto', minWidth: 150 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Class">
    {all ? <option value="">All my classes</option> : <option value="" disabled>Choose a class</option>}
    {classes.map((c) => <option key={c.id} value={c.id}>Class {clsName(c)}</option>)}
  </select>
);

function DailyReport({ me, sid, today, onOpen }) {
  const [date, setDate] = useState(today);
  const { data, error, loading } = useGet(me, sid, '/reports/daily', { date });
  return (<>
    <div className="row"><input type="date" style={{ width: 'auto' }} max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />{date !== today && <button className="btn" onClick={() => setDate(today)}>Today</button>}</div>
    {error && <div className="err">{error}</div>}
    {!data ? (loading && <Empty>Loading...</Empty>) : (<>
      <div className="asum"><Tile n={`${data.totals.classes_marked}/${data.totals.classes}`} label="Classes marked" /><Tile tone="present" n={data.totals.present} label="Present" /><Tile tone="absent" n={data.totals.absent} label="Absent" /><Tile tone="late" n={data.totals.late} label="Late" /></div>
      {data.classes.length === 0 ? <Empty>No classes to show.</Empty> : (
        <div className="card" style={{ padding: 0 }}>{data.classes.map((c) => { const s = statusLine(c); return (
          <button key={c.id} className="drow" onClick={() => onOpen(c.id, date)}>
            <div style={{ flex: 1, minWidth: 0 }}><b>Class {clsName(c)}</b><small>{c.teachers.length ? c.teachers.join(', ') : 'No teacher assigned'}</small></div>
            <div className="dstate"><span className={`cstate ${s.tone}`}>{s.text}</span>{c.marked > 0 && <small><span style={{ color: 'var(--ok)' }}>{c.present} present</span> - <span style={{ color: 'var(--bad)' }}>{c.absent} absent</span>{c.late > 0 ? ` - ${c.late} late` : ''}{c.leave > 0 ? ` - ${c.leave} leave` : ''}</small>}</div>
          </button>); })}</div>)}
    </>)}
  </>);
}

function ClassReport({ me, sid, today, classes, onStudent }) {
  const [classId, setClassId] = useState(classes[0]?.id || '');
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, error, loading } = useGet(me, sid, '/reports/class', { class_id: classId, ...range }, !!classId);
  const [below, setBelow] = useState(false);
  if (!classes.length) return <Empty>No classes available.</Empty>;
  const rows = (data?.students || []).filter((s) => !below || (s.percent !== null && s.percent < 75));
  const download = () => csv(`attendance-${clsName(data.class).replace(/\s+/g, '')}-${data.range.from}-to-${data.range.to}.csv`,
    [['Roll no', 'Name', 'Present', 'Absent', 'Late', 'Leave', 'Days marked', 'Attendance %'], ...data.students.map((s) => [s.roll_no ?? '', s.full_name, s.present, s.absent, s.late, s.leave, s.total, s.percent ?? ''])]);
  return (<>
    <div className="row"><ClassSelect classes={classes} value={classId} onChange={setClassId} /></div>
    <RangeBar today={today} value={range} shown={data?.range} onChange={setRange} />
    {error && <div className="err">{error}</div>}
    {!data ? (loading && <Empty>Loading...</Empty>) : (<>
      <div className="asum"><Tile n={data.working_days} label="Days marked" /><Tile n={data.summary.percent === null ? '-' : `${data.summary.percent}%`} label="Class average" tone="present" /><Tile n={data.students.filter((s) => s.percent !== null && s.percent < 75).length} label="Below 75%" tone="absent" onClick={() => setBelow(!below)} on={below} /></div>
      <div className="row sp"><small style={{ color: 'var(--mute)' }}>{fmtDate(data.range.from)} to {fmtDate(data.range.to)}</small><button className="btn" onClick={download} disabled={!data.students.length}><Icon name="download" size={16} />Download CSV</button></div>
      {rows.length === 0 ? <Empty>{below ? 'Nobody is below 75%.' : 'No students.'}</Empty> : (
        <div className="card scrollx" style={{ padding: 0 }}><table className="rt"><thead><tr><th>Roll</th><th>Name</th><th className="n">P</th><th className="n">A</th><th className="n">L</th><th className="n">Lv</th><th>Attendance</th></tr></thead><tbody>
          {rows.map((s) => <tr key={s.student_id} className="click" onClick={() => onStudent(s)}><td><span className="roll sm">{s.roll_no ?? '-'}</span></td><td>{s.full_name}{!s.current && <small className="muted"> (moved)</small>}</td>
            <td className="n">{s.present}</td><td className="n">{s.absent}</td><td className="n">{s.late}</td><td className="n">{s.leave}</td>
            <td><div className="bar"><i className={s.percent === null ? '' : s.percent >= 90 ? 'ok' : s.percent >= 75 ? 'mid' : 'low'} style={{ width: `${s.percent || 0}%` }} /></div><Pct v={s.percent} /></td></tr>)}
        </tbody></table></div>)}
      {data.days.length > 0 && <details className="card"><summary><b>Day by day</b> ({data.days.length} days)</summary>
        <div className="days">{[...data.days].reverse().map((d) => <div key={d.date} className="dayrow"><span>{fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span><span className="muted">{d.present + d.late} here - {d.absent} absent{d.leave ? ` - ${d.leave} leave` : ''}</span><Pct v={d.percent} /></div>)}</div></details>}
    </>)}
  </>);
}

function StudentReport({ me, sid, today, picked, setPicked }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const found = useGet(me, sid, '/students', { q: dq }, !picked);
  const { data, error, loading } = useGet(me, sid, `/reports/student/${picked?.student_id || 'x'}`, range, !!picked);
  if (!picked) return (<>
    <div style={{ position: 'relative', maxWidth: 420 }}><input autoFocus placeholder="Search student by name, ID or roll no." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} /><span style={{ position: 'absolute', left: 11, top: 10, color: 'var(--mute)' }}><Icon name="search" size={18} /></span></div>
    {found.error && <div className="err">{found.error}</div>}
    {found.data && (found.data.length === 0 ? <Empty>No student found.</Empty> :
      <div className="card" style={{ padding: 0 }}>{found.data.map((s) => <button key={s.student_id} className="drow" onClick={() => setPicked(s)}><span className="roll sm">{s.roll_no ?? '-'}</span><div style={{ flex: 1 }}><b>{s.full_name}</b><small>Class {s.class_label} - {s.login_id}</small></div></button>)}</div>)}
  </>);
  return (<>
    <div className="row"><button className="btn" onClick={() => setPicked(null)}><Icon name="back" size={16} />Students</button><b style={{ fontSize: 17 }}>{picked.full_name}</b></div>
    <RangeBar today={today} value={range} shown={data?.range} onChange={setRange} />
    {error && <div className="err">{error}</div>}
    {!data ? (loading && <Empty>Loading...</Empty>) : <StudentSummary data={data} />}
  </>);
}

function StudentSummary({ data }) {
  const s = data.summary;
  return (<>
    <div className="card row sp"><div><b style={{ fontSize: 17 }}>{data.student.full_name}</b><div className="muted">{data.student.class ? `Class ${clsName(data.student.class)}` : 'No class'}{data.student.roll_no ? ` - Roll ${data.student.roll_no}` : ''}{data.student.admission_no ? ` - Adm. ${data.student.admission_no}` : ''}</div></div><div style={{ fontSize: 26 }}><Pct v={s.percent} /></div></div>
    <div className="asum"><Tile tone="present" n={s.present} label="Present" /><Tile tone="absent" n={s.absent} label="Absent" /><Tile tone="late" n={s.late} label="Late" /><Tile tone="leave" n={s.leave} label="Leave" /></div>
    <small className="muted">{fmtDate(data.range.from)} to {fmtDate(data.range.to)} - {s.total} day{s.total === 1 ? '' : 's'} marked</small>
    {data.months.length > 0 && <div className="card scrollx" style={{ padding: 0 }}><table className="rt"><thead><tr><th>Month</th><th className="n">P</th><th className="n">A</th><th className="n">L</th><th className="n">Lv</th><th>%</th></tr></thead><tbody>
      {data.months.map((m) => <tr key={m.month}><td>{fmtMonth(m.month)}</td><td className="n">{m.present}</td><td className="n">{m.absent}</td><td className="n">{m.late}</td><td className="n">{m.leave}</td><td><Pct v={m.percent} /></td></tr>)}</tbody></table></div>}
    {data.absences.length > 0 && <div className="card"><b>Days not present</b><div className="pills" style={{ marginTop: 10 }}>{data.absences.map((a) => <span key={a.date} className={`chip ${a.status}`}>{fmtDate(a.date, { day: 'numeric', month: 'short' })} - {ST[a.status].label}</span>)}</div></div>}
  </>);
}

function LowReport({ me, sid, today, classes, onStudent }) {
  const [classId, setClassId] = useState(''); const [limit, setLimit] = useState('75'); const [range, setRange] = useState({ from: '', to: '' });
  const { data, error, loading } = useGet(me, sid, '/reports/low', { class_id: classId, threshold: limit, ...range }, Number(limit) > 0);
  return (<>
    <div className="row"><ClassSelect classes={classes} value={classId} onChange={setClassId} all />
      <label className="row" style={{ gap: 6 }}><span className="muted">Below</span><input type="number" min="1" max="100" style={{ width: 80 }} value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Attendance limit in percent" /><span className="muted">%</span></label></div>
    <RangeBar today={today} value={range} shown={data?.range} onChange={setRange} />
    {error && <div className="err">{error}</div>}
    {!data ? (loading && <Empty>Loading...</Empty>) : data.students.length === 0 ? <Empty>Nobody is below {data.threshold}% in this period.</Empty> : (<>
      <div className="row sp"><small className="muted">{data.students.length} student{data.students.length === 1 ? '' : 's'} below {data.threshold}%</small>
        <button className="btn" onClick={() => csv(`low-attendance-${data.range.from}-to-${data.range.to}.csv`, [['Class', 'Roll no', 'Name', 'Present', 'Absent', 'Late', 'Leave', 'Attendance %'], ...data.students.map((s) => [s.class_label, s.roll_no ?? '', s.full_name, s.present, s.absent, s.late, s.leave, s.percent])])}><Icon name="download" size={16} />Download CSV</button></div>
      <div className="card" style={{ padding: 0 }}>{data.students.map((s) => <button key={`${s.student_id}${s.class_id}`} className="drow" onClick={() => onStudent(s)}><span className="roll sm">{s.roll_no ?? '-'}</span><div style={{ flex: 1 }}><b>{s.full_name}</b><small>Class {s.class_label} - {s.absent} absent of {s.total} days</small></div><Pct v={s.percent} /></button>)}</div>
    </>)}
  </>);
}

export const AttendanceReports = scoped(function Reports({ me, sid, go }) {
  const [tab, setTab] = useState('daily'); const [picked, setPicked] = useState(null);
  const { data } = useClasses(me, sid);
  if (!data) return <Empty>Loading...</Empty>;
  const openStudent = (s) => { setPicked({ student_id: s.student_id, full_name: s.full_name }); setTab('student'); };
  const openClass = (class_id, date) => { jump = { class_id, date: date === data.today ? '' : date }; go('take'); };
  return (<>
    <div className="pills">{[['daily', 'Daily overview'], ['class', 'Class report'], ['student', 'Student report'], ['low', 'Low attendance']].map(([k, l]) => <button key={k} className={`pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'daily' && <DailyReport me={me} sid={sid} today={data.today} onOpen={openClass} />}
    {tab === 'class' && <ClassReport me={me} sid={sid} today={data.today} classes={data.classes} onStudent={openStudent} />}
    {tab === 'student' && <StudentReport me={me} sid={sid} today={data.today} picked={picked} setPicked={setPicked} />}
    {tab === 'low' && <LowReport me={me} sid={sid} today={data.today} classes={data.classes} onStudent={openStudent} />}
  </>);
});

/* ===================================================================== ROLL NUMBERS */
export const RollNumbers = scoped(function Rolls({ me, sid }) {
  const { data: cl } = useClasses(me, sid);
  const [classId, setClassId] = useState('');
  const [d, setD] = useState(null); const [vals, setVals] = useState({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const init = (res) => { setD(res); setVals(Object.fromEntries(res.students.map((s) => [s.student_id, s.roll_no ?? '']))); };
  useEffect(() => {
    if (!classId) return;
    setD(null); setErr('');
    get(me, sid, '/rolls', { class_id: classId }).then(init).catch((e) => setErr(e.message));
  }, [classId]); // eslint-disable-line
  useEffect(() => { if (!classId && cl?.classes?.length) setClassId(cl.classes[0].id); }, [cl]); // eslint-disable-line

  const dups = useMemo(() => { const c = {}; Object.values(vals).forEach((v) => { if (v !== '') c[v] = (c[v] || 0) + 1; }); return new Set(Object.keys(c).filter((k) => c[k] > 1)); }, [vals]);
  const bad = (v) => v !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 100);
  const dirty = d && d.students.some((s) => String(s.roll_no ?? '') !== String(vals[s.student_id] ?? ''));
  const invalid = Object.values(vals).some(bad) || dups.size > 0;

  const run = async (fn, ok) => { setBusy(true); setErr(''); try { init(await fn()); toast(ok); } catch (x) { setErr(x.message); toast(x.message, true); } finally { setBusy(false); } };
  const save = () => run(() => send('put', me, sid, '/rolls', { class_id: classId, items: d.students.map((s) => ({ student_id: s.student_id, roll_no: vals[s.student_id] === '' ? null : Number(vals[s.student_id]) })) }), 'Roll numbers saved');
  const auto = (mode) => {
    if (dirty && !confirm('Discard your unsaved edits?')) return;
    if (mode === 'name' && d.students.some((s) => s.roll_no) && !confirm('This renumbers EVERY student 1, 2, 3... in A-Z order of name. Continue?')) return;
    run(() => send('post', me, sid, '/rolls/auto', { class_id: classId, mode }), mode === 'name' ? 'Numbered A-Z' : 'Missing roll numbers filled');
  };
  const pickClass = (id) => { if (dirty && !confirm('Discard your unsaved edits?')) return; setClassId(id); };

  if (!cl) return <Empty>Loading...</Empty>;
  if (!cl.classes.length) return <Empty>No classes available.</Empty>;
  return (<>
    <div className="row"><ClassSelect classes={cl.classes} value={classId} onChange={pickClass} /></div>
    <small className="muted">Roll numbers are 1 to 100 and unique inside one class (Roll 1 can exist in 1A and in 1B). They are cleared at year-end promotion, so assign them again for the new class.</small>
    {err && <div className="err">{err}</div>}
    {!d ? <Empty>{err ? '' : 'Loading...'}</Empty> : d.students.length === 0 ? <Empty>No active students in this class.</Empty> : (<>
      <div className="row"><button className="btn" disabled={busy} onClick={() => auto('fill')}>Fill missing numbers</button><button className="btn" disabled={busy} onClick={() => auto('name')}>Number all A-Z</button></div>
      <div className="card" style={{ padding: 0 }}>{[...d.students].sort((a, b) => (Number(vals[a.student_id]) || 1e9) - (Number(vals[b.student_id]) || 1e9) || a.full_name.localeCompare(b.full_name)).map((s) => {
        const v = vals[s.student_id]; const flagged = bad(v) || (v !== '' && dups.has(String(v)));
        return (<div key={s.student_id} className="drow" style={{ cursor: 'default' }}>
          <div style={{ flex: 1, minWidth: 0 }}><b>{s.full_name}</b><small>{s.admission_no ? `Adm. ${s.admission_no}` : s.login_id}</small></div>
          <input type="number" min="1" max="100" inputMode="numeric" className={`rollin ${flagged ? 'bad' : ''}`} aria-label={`Roll no. of ${s.full_name}`} value={v} placeholder="-" onChange={(e) => setVals({ ...vals, [s.student_id]: e.target.value })} />
        </div>); })}</div>
      <div className="asave"><div className="sum">{dups.size > 0 ? <span className="err">Duplicate roll numbers</span> : invalid ? <span className="err">Use whole numbers 1-100</span> : dirty ? 'Unsaved changes' : 'All saved'}{dirty && <span className="dot" />}</div>
        <button className="btn primary big" disabled={busy || !dirty || invalid} onClick={save}>{busy ? 'Saving...' : 'Save roll numbers'}</button></div>
    </>)}
  </>);
});

/* ===================================================================== CLASS TEACHERS */
function AssignModal({ me, sid, cls, teachers, onClose, onSaved }) {
  const [sel, setSel] = useState(new Set(cls.teachers.map((t) => t.user_id)));
  const [head, setHead] = useState(cls.teachers.find((t) => t.is_class_teacher)?.user_id || '');
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const list = teachers.filter((t) => !q || `${t.full_name} ${t.login_id} ${t.designation || ''}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => { const n = new Set(sel); if (n.has(id)) { n.delete(id); if (head === id) setHead(''); } else n.add(id); setSel(n); };
  const save = async () => {
    setBusy(true); setErr('');
    try { await send('put', me, sid, `/classes/${cls.id}/teachers`, { teacher_ids: [...sel], class_teacher_id: head || null }); toast('Teachers updated'); onSaved(); onClose(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Teachers of class ${clsName(cls)}`} onClose={onClose}>
      <input placeholder="Search staff" value={q} onChange={(e) => setQ(e.target.value)} />
      {teachers.length === 0 && <Empty>No staff accounts yet. Create users with the role "Staff" first.</Empty>}
      <div className="card" style={{ padding: 0 }}>{list.map((t) => (
        <div key={t.user_id} className="drow" style={{ cursor: 'default' }}>
          <label className="row" style={{ flex: 1, flexWrap: 'nowrap', cursor: 'pointer' }}><input type="checkbox" style={{ width: 20, height: 20 }} checked={sel.has(t.user_id)} onChange={() => toggle(t.user_id)} />
            <span><b>{t.full_name}</b><small style={{ display: 'block', color: 'var(--mute)' }}>{t.designation || t.login_id}</small></span></label>
          {sel.has(t.user_id) && <button type="button" className={`btn ${head === t.user_id ? 'primary' : ''}`} onClick={() => setHead(head === t.user_id ? '' : t.user_id)} title="Mark as the class teacher"><Icon name="star" size={15} />Class teacher</button>}
        </div>))}</div>
      {err && <div className="err">{err}</div>}
      <button className="btn primary" style={{ justifyContent: 'center' }} disabled={busy} onClick={save}>Save ({sel.size} selected)</button>
    </Modal>
  );
}

export const ClassTeachers = scoped(function Teachers({ me, sid }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [edit, setEdit] = useState(null);
  const reload = useCallback(() => get(me, sid, '/teachers').then(setD).catch((e) => setErr(e.message)), [me, sid]);
  useEffect(() => { reload(); }, [reload]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <Empty>Loading...</Empty>;
  return (<>
    <small className="muted">Teachers only see the classes assigned to them in Take attendance. Staff with "Access every class" see all classes.</small>
    {d.classes.length === 0 ? <Empty>No classes yet. Add them under Users &gt; Classes.</Empty> : (
      <div className="cgrid">{d.classes.map((c) => (
        <div key={c.id} className="ccard static">
          <div className="row sp"><b className="cname">Class {clsName(c)}</b><button className="btn" onClick={() => setEdit(c)}><Icon name="edit" size={15} />Edit</button></div>
          {c.teachers.length === 0 ? <span className="muted">No teacher assigned</span> : <div className="pills">{c.teachers.map((t) => <span key={t.user_id} className={`chip ${t.is_class_teacher ? 'head' : ''}`}>{t.is_class_teacher && <Icon name="star" size={12} />} {t.full_name}</span>)}</div>}
        </div>))}</div>)}
    {edit && <AssignModal me={me} sid={sid} cls={edit} teachers={d.teachers} onClose={() => setEdit(null)} onSaved={reload} />}
  </>);
});
