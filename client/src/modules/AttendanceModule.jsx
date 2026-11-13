import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useData, useApi } from '../cache.js';
import { Icon, toast, Loading, ask, Page, PageBar, Tabs, KpiGrid, Kpi, Section, DataTable, List, ListRow, StatusBadge, EmptyState, FormDialog, Notice, Button, SaveBar } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
import { fetchers } from '../fetchers.js';

const ST = {
  present: { short: 'P', label: 'Present' },
  absent: { short: 'A', label: 'Absent' },
  late: { short: 'L', label: 'Late' },
  leave: { short: 'Lv', label: 'Leave' },
};
const ORDER = ['present', 'absent', 'late', 'leave'];
const clsName = (c) => `${c.name}${c.section ? ` ${c.section}` : ''}`;
// the class name often already starts with "Class" (e.g. "Class 1"), so only add the word when it is missing
const clsLabel = (c) => { const n = clsName(c); return /^class\b/i.test(n) ? n : `Class ${n}`; };
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

// cached report read: same params show the last result at once and refresh behind it
function useGet(me, sid, path, params, enabled = true) {
  const { data, error, loading } = useApi(`/attendance${path}${qs({ ...scopeQ(me, sid), ...params })}`, enabled, { keepPrevious: true });
  return { data: data ?? null, error: error || '', loading };
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
        {isSup && <select className="ds-ctx-select" aria-label="School" value={sid} onChange={(e) => { chosenSchool = e.target.value; setSid(e.target.value); }}>
          <option value="">Choose a school</option>{(schools || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        {sid ? <Inner key={sid} {...props} sid={sid} /> : <EmptyState icon="attendance">Choose a school to continue.</EmptyState>}
      </div>
    );
  };
}

const Pct = ({ v }) => (v === null || v === undefined ? <span className="pct none">-</span> : <span className={`pct ${v >= 90 ? 'ok' : v >= 75 ? 'mid' : 'low'}`}>{v}%</span>);
const Tile = ({ n, label, tone, on, onClick }) => (
  <button type="button" className={`tile ${tone || ''} ${on ? 'on' : ''}`} onClick={onClick} disabled={!onClick}><b>{n}</b><span>{label}</span></button>
);

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
      <div className="ccard-top"><b className="cname">{clsLabel(c)}</b>{c.is_class_teacher && <StatusBadge tone="info" dot={false}>Class teacher</StatusBadge>}</div>
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
  if (error) return <Page><Notice tone="bad">{error}</Notice></Page>;
  if (!data) return <Page><Loading /></Page>;
  const marked = data.classes.filter((c) => c.state === 'marked').length;
  const isToday = data.date === data.today;
  return (
    <Page>
      <PageBar title={isToday ? 'Today' : fmtDate(data.date)} sub={`${isToday ? `${fmtDate(data.today)} · ` : ''}${data.classes.length === 0 ? 'No classes' : `${marked} of ${data.classes.length} class${data.classes.length === 1 ? '' : 'es'} marked`}`}>
        {!isToday && <Button size="sm" onClick={() => setDate('')}>Back to today</Button>}
        <input type="date" aria-label="Attendance date" max={data.today} value={data.date} onChange={(e) => e.target.value && setDate(e.target.value === data.today ? '' : e.target.value)} />
      </PageBar>
      {data.classes.length === 0
        ? <EmptyState icon="attendance">{me.features.includes('attendance_all_classes') ? 'This school has no classes yet. Add them under Users > Classes.' : 'No class is assigned to you yet. Ask your school admin to assign you under Attendance > Class teachers.'}</EmptyState>
        : <div className="cgrid">{data.classes.map((c) => <ClassCard key={c.id} c={c} onOpen={setOpen} />)}</div>}
    </Page>
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
  const back = async () => { if (touched && dirty && !(await ask('You have unsaved changes. Leave without saving?'))) return; onBack(); };

  const toggle = (id) => set(id, marks[id] === 'present' ? 'absent' : 'present');

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await send('put', me, sid, '/sheet', { class_id: classId, date: sh.date, records: students.map((s) => ({ student_id: s.student_id, status: marks[s.student_id] })) });
      await fetchSheet(); onSaved?.();
      toast(`Attendance saved - ${counts.absent} absent${r.saved === 0 ? ' (no changes)' : ''}`);
    } catch (x) { setErr(x.message); toast(x.message, true); } finally { setBusy(false); }
  };

  if (err && !sh) return <Page><PageBar title="Attendance" lead={<Button size="sm" icon="back" onClick={onBack}>Back</Button>} /><Notice tone="bad">{err}</Notice></Page>;
  if (!sh) return <Page><Loading /></Page>;

  const st = sh.status; const noRoll = students.filter((s) => !s.roll_no).length;
  const isToday = sh.date === today;
  return (
    <Page>
      <PageBar sticky lead={<Button size="sm" icon="back" onClick={back}>Classes</Button>} title={clsLabel(sh.class)}
        sub={err ? <span className="ds-savebar-e">{err}</span> : `${isToday ? 'Today · ' : ''}${fmtDate(sh.date)}${sh.teachers.length ? ` - ${sh.teachers.map((t) => t.name).join(', ')}` : ''}`}>
        {can && <>
          <span className="ds-bar-note"><b>{counts.present + counts.late + counts.leave}</b>/{students.length} here{dirty && <i className="ds-savebar-d" title="Unsaved changes" />}</span>
          <Button kind="primary" onClick={save} loading={busy} disabled={!dirty && st.state === 'marked'}>{st.state === 'marked' && !dirty ? 'Saved' : st.state === 'marked' ? 'Save changes' : 'Save attendance'}</Button>
        </>}
      </PageBar>

      {sh.holiday && <Notice tone="warn">{fmtDate(sh.date, { day: 'numeric', month: 'short' })} is marked as <b>{sh.holiday.title}</b> ({sh.holiday.type}) in the school calendar. You can still mark attendance if school was open.</Notice>}
      {!can && <Notice>{sh.edit_note || 'View only'} - you can look but not change this sheet.</Notice>}
      {st.state === 'marked' && <Notice tone="ok"><b>Already marked{st.marked_by.length ? ` by ${st.marked_by.join(', ')}` : ''}</b>{st.last_updated ? ` at ${fmtTime(st.last_updated)}` : ''}. {can ? 'No need to redo it - tap a student to change (e.g. came late).' : ''}</Notice>}
      {st.state === 'partial' && <Notice tone="warn"><b>Only {st.marked} of {st.total_students} students are marked</b>{st.marked_by.length ? ` (by ${st.marked_by.join(', ')})` : ''}. The rest are new or were missed - save to mark everyone.</Notice>}
      {st.state === 'not_marked' && students.length > 0 && <Notice>Not marked yet. Everyone starts as <b>Absent</b> - tap a student to mark Present, then save.</Notice>}
      {noRoll > 0 && students.length > 0 && <Notice tone="warn">{noRoll} student{noRoll === 1 ? ' has' : 's have'} no roll number.{goRolls && <> <Button size="sm" kind="ghost" onClick={goRolls}>Assign roll numbers</Button></>}</Notice>}

      {students.length === 0 ? <EmptyState icon="attendance">No active students in this class.</EmptyState> : (<>
        <div className="asum slim">
          {ORDER.map((k) => <Tile key={k} tone={k} n={counts[k]} label={ST[k].label} on={filter === k} onClick={() => setFilter(filter === k ? '' : k)} />)}
        </div>

        <FilterBar q={q} onQ={setQ} placeholder="Search name or roll no." count={rows.length}
          filters={[{ key: 'st', label: 'Status', value: filter, onChange: setFilter, options: ORDER.map((k) => ({ value: k, label: ST[k].label })), all: 'Everyone' }]}
          sort={{ value: sort, onChange: setSort, def: 'roll', options: [{ value: 'roll', label: 'Roll no.' }, { value: 'name', label: 'Name A-Z' }] }}
          end={can && <Button onClick={() => setAll(counts.present === students.length ? 'absent' : 'present')}>{counts.present === students.length ? 'All absent' : 'All present'}</Button>} />

        <Section flush className="alist">
          {rows.length === 0 && <EmptyState icon="search" title="No student matches" />}
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
                {more === id && <div className="moreopts">{['late', 'leave'].map((k) => <Button key={k} size="sm" kind={cur === k ? 'primary' : 'secondary'} onClick={() => { set(id, cur === k ? 'present' : k); setMore(null); }}>{ST[k].label}</Button>)}</div>}
              </div>);
          })}
        </Section>

      </>)}
    </Page>
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
    <div className="ds-inline">
      <Tabs items={presets.map(([l]) => ({ key: l, label: l }))} value={presets.find(([, v]) => same(value, v))?.[0]} onChange={(k) => onChange(presets.find(([l]) => l === k)[1])} />
      <input type="date" aria-label="From date" max={today} value={value.from || shown?.from || ''} onChange={(e) => onChange({ from: e.target.value, to: value.to || shown?.to || today })} />
      <span className="ds-hint">to</span>
      <input type="date" aria-label="To date" max={today} value={value.to || shown?.to || today} onChange={(e) => onChange({ from: value.from || shown?.from || '', to: e.target.value })} />
    </div>
  );
}
const ClassSelect = ({ classes, value, onChange, all }) => (
  <select className="ds-ctx-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Class">
    {all ? <option value="">All my classes</option> : <option value="" disabled>Choose a class</option>}
    {classes.map((c) => <option key={c.id} value={c.id}>{clsLabel(c)}</option>)}
  </select>
);

function DailyReport({ me, sid, today, onOpen }) {
  const [date, setDate] = useState(today);
  const { data, error, loading } = useGet(me, sid, '/reports/daily', { date });
  return (<>
    <div className="ds-inline"><input type="date" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />{date !== today && <Button onClick={() => setDate(today)}>Today</Button>}</div>
    {error && <Notice tone="bad">{error}</Notice>}
    {!data ? (loading && <Loading />) : (<>
      <KpiGrid><Kpi label="Classes marked" value={`${data.totals.classes_marked}/${data.totals.classes}`} /><Kpi label="Present" tone="ok" value={data.totals.present} /><Kpi label="Absent" tone="bad" value={data.totals.absent} /><Kpi label="Late" tone="warn" value={data.totals.late} /></KpiGrid>
      {data.classes.length === 0 ? <EmptyState icon="attendance">No classes to show.</EmptyState> : (
        <Section flush><List>{data.classes.map((c) => { const s = statusLine(c); return (
          <ListRow key={c.id} onClick={() => onOpen(c.id, date)} title={clsLabel(c)} sub={c.teachers.length ? c.teachers.join(', ') : 'No teacher assigned'}
            meta={<span className="ds-al-right"><span className={`cstate ${s.tone}`}>{s.text}</span>{c.marked > 0 && <span className="ds-subline">{c.present} present - {c.absent} absent{c.late > 0 ? ` - ${c.late} late` : ''}{c.leave > 0 ? ` - ${c.leave} leave` : ''}</span>}</span>} />); })}</List></Section>)}
    </>)}
  </>);
}

const Roll = ({ n }) => <span className="roll sm">{n ?? '-'}</span>;
const CsvBtn = ({ onClick, disabled }) => <Button size="sm" icon="download" onClick={onClick} disabled={disabled}>Download CSV</Button>;

function ClassReport({ me, sid, today, classes, onStudent }) {
  const [classId, setClassId] = useState(classes[0]?.id || '');
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, error, loading } = useGet(me, sid, '/reports/class', { class_id: classId, ...range }, !!classId);
  const [below, setBelow] = useState(false);
  if (!classes.length) return <EmptyState icon="attendance">No classes available.</EmptyState>;
  const rows = (data?.students || []).filter((s) => !below || (s.percent !== null && s.percent < 75));
  const download = () => csv(`attendance-${clsName(data.class).replace(/\s+/g, '')}-${data.range.from}-to-${data.range.to}.csv`,
    [['Roll no', 'Name', 'Present', 'Absent', 'Late', 'Leave', 'Days marked', 'Attendance %'], ...data.students.map((s) => [s.roll_no ?? '', s.full_name, s.present, s.absent, s.late, s.leave, s.total, s.percent ?? ''])]);
  const columns = [
    { key: 'roll', label: 'Roll', render: (s) => <Roll n={s.roll_no} /> },
    { key: 'name', label: 'Name', primary: true, render: (s) => <>{s.full_name}{!s.current && <span className="ds-subline">moved</span>}</> },
    { key: 'present', label: 'P', align: 'right' }, { key: 'absent', label: 'A', align: 'right' }, { key: 'late', label: 'L', align: 'right' }, { key: 'leave', label: 'Lv', align: 'right' },
    { key: 'pct', label: 'Attendance', render: (s) => <><div className="bar"><i className={s.percent === null ? '' : s.percent >= 90 ? 'ok' : s.percent >= 75 ? 'mid' : 'low'} style={{ width: `${s.percent || 0}%` }} /></div><Pct v={s.percent} /></> },
  ];
  return (<>
    <div className="ds-inline"><ClassSelect classes={classes} value={classId} onChange={setClassId} /></div>
    <RangeBar today={today} value={range} shown={data?.range} onChange={setRange} />
    {error && <Notice tone="bad">{error}</Notice>}
    {!data ? (loading && <Loading />) : (<>
      <KpiGrid>
        <Kpi label="Days marked" value={data.working_days} />
        <Kpi label="Class average" tone="ok" value={data.summary.percent === null ? '-' : `${data.summary.percent}%`} />
        <Kpi label="Below 75% (tap to filter)" tone="bad" value={data.students.filter((s) => s.percent !== null && s.percent < 75).length} onClick={() => setBelow(!below)} />
      </KpiGrid>
      <div className="ds-spread"><span className="ds-hint">{fmtDate(data.range.from)} to {fmtDate(data.range.to)}{below ? ' · only below 75%' : ''}</span><CsvBtn onClick={download} disabled={!data.students.length} /></div>
      <Section flush><DataTable columns={columns} rows={rows} rowKey={(s) => s.student_id} onRowClick={onStudent} empty={<EmptyState icon="attendance">{below ? 'Nobody is below 75%.' : 'No students.'}</EmptyState>} /></Section>
      {data.days.length > 0 && (
        <details className="ds-section ds-details"><summary><b>Day by day</b> ({data.days.length} days)</summary>
          <div className="days">{[...data.days].reverse().map((d) => <div key={d.date} className="dayrow"><span>{fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span><span className="ds-hint">{d.present + d.late} here - {d.absent} absent{d.leave ? ` - ${d.leave} leave` : ''}</span><Pct v={d.percent} /></div>)}</div></details>)}
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
    <label className="ds-search"><Icon name="search" size={18} /><input type="search" autoFocus placeholder="Search student by name, ID or roll no." value={q} onChange={(e) => setQ(e.target.value)} /></label>
    {found.error && <Notice tone="bad">{found.error}</Notice>}
    {found.data && (found.data.length === 0 ? <EmptyState icon="search">No student found.</EmptyState> : (
      <Section flush><List>{found.data.map((s) => <ListRow key={s.student_id} onClick={() => setPicked(s)} lead={<Roll n={s.roll_no} />} title={s.full_name} sub={`${s.class_label} - ${s.login_id}`} />)}</List></Section>))}
  </>);
  return (<>
    <div className="ds-inline"><Button icon="back" onClick={() => setPicked(null)}>Students</Button><b>{picked.full_name}</b></div>
    <RangeBar today={today} value={range} shown={data?.range} onChange={setRange} />
    {error && <Notice tone="bad">{error}</Notice>}
    {!data ? (loading && <Loading />) : <StudentSummary data={data} />}
  </>);
}

function StudentSummary({ data }) {
  const s = data.summary;
  const monthCols = [
    { key: 'month', label: 'Month', primary: true, render: (m) => fmtMonth(m.month) },
    { key: 'present', label: 'P', align: 'right' }, { key: 'absent', label: 'A', align: 'right' }, { key: 'late', label: 'L', align: 'right' }, { key: 'leave', label: 'Lv', align: 'right' },
    { key: 'pct', label: '%', render: (m) => <Pct v={m.percent} /> },
  ];
  return (<>
    <Section><div className="ds-spread"><div><b>{data.student.full_name}</b><span className="ds-subline">{data.student.class ? clsLabel(data.student.class) : 'No class'}{data.student.roll_no ? ` - Roll ${data.student.roll_no}` : ''}{data.student.admission_no ? ` - Adm. ${data.student.admission_no}` : ''}</span></div><Pct v={s.percent} /></div></Section>
    <KpiGrid><Kpi tone="ok" label="Present" value={s.present} /><Kpi tone="bad" label="Absent" value={s.absent} /><Kpi tone="warn" label="Late" value={s.late} /><Kpi tone="info" label="Leave" value={s.leave} /></KpiGrid>
    <p className="ds-hint">{fmtDate(data.range.from)} to {fmtDate(data.range.to)} - {s.total} day{s.total === 1 ? '' : 's'} marked</p>
    {data.months.length > 0 && <Section title="By month" flush><DataTable columns={monthCols} rows={data.months} rowKey={(m) => m.month} /></Section>}
    {data.absences.length > 0 && <Section title="Days not present"><div className="ds-chips">{data.absences.map((a) => <StatusBadge key={a.date} tone={a.status === 'absent' ? 'bad' : a.status === 'late' ? 'warn' : 'info'}>{fmtDate(a.date, { day: 'numeric', month: 'short' })} - {ST[a.status].label}</StatusBadge>)}</div></Section>}
  </>);
}

function LowReport({ me, sid, today, classes, onStudent }) {
  const [classId, setClassId] = useState(''); const [limit, setLimit] = useState('75'); const [range, setRange] = useState({ from: '', to: '' });
  const { data, error, loading } = useGet(me, sid, '/reports/low', { class_id: classId, threshold: limit, ...range }, Number(limit) > 0);
  return (<>
    <div className="ds-inline"><ClassSelect classes={classes} value={classId} onChange={setClassId} all />
      <label className="ds-inline"><span className="ds-hint">Below</span><input type="number" min="1" max="100" className="ds-input-sm" value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Attendance limit in percent" /><span className="ds-hint">%</span></label></div>
    <RangeBar today={today} value={range} shown={data?.range} onChange={setRange} />
    {error && <Notice tone="bad">{error}</Notice>}
    {!data ? (loading && <Loading />) : data.students.length === 0 ? <EmptyState icon="check">Nobody is below {data.threshold}% in this period.</EmptyState> : (<>
      <div className="ds-spread"><span className="ds-hint">{data.students.length} student{data.students.length === 1 ? '' : 's'} below {data.threshold}%</span>
        <CsvBtn onClick={() => csv(`low-attendance-${data.range.from}-to-${data.range.to}.csv`, [['Class', 'Roll no', 'Name', 'Present', 'Absent', 'Late', 'Leave', 'Attendance %'], ...data.students.map((s) => [s.class_label, s.roll_no ?? '', s.full_name, s.present, s.absent, s.late, s.leave, s.percent])])} /></div>
      <Section flush><List>{data.students.map((s) => <ListRow key={`${s.student_id}${s.class_id}`} onClick={() => onStudent(s)} lead={<Roll n={s.roll_no} />} title={s.full_name} sub={`${s.class_label} - ${s.absent} absent of ${s.total} days`} meta={<Pct v={s.percent} />} />)}</List></Section>
    </>)}
  </>);
}

export const AttendanceReports = scoped(function Reports({ me, sid, go }) {
  const [tab, setTab] = useState('daily'); const [picked, setPicked] = useState(null);
  const { data } = useClasses(me, sid);
  if (!data) return <Page><Loading /></Page>;
  const openStudent = (s) => { setPicked({ student_id: s.student_id, full_name: s.full_name }); setTab('student'); };
  const openClass = (class_id, date) => { jump = { class_id, date: date === data.today ? '' : date }; go('take'); };
  return (
    <Page>
      <PageBar title="Attendance reports" sub="Daily overview, class, student and low attendance" />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'daily', label: 'Daily overview' }, { key: 'class', label: 'Class report' }, { key: 'student', label: 'Student report' }, { key: 'low', label: 'Low attendance' }]} />
      {tab === 'daily' && <DailyReport me={me} sid={sid} today={data.today} onOpen={openClass} />}
      {tab === 'class' && <ClassReport me={me} sid={sid} today={data.today} classes={data.classes} onStudent={openStudent} />}
      {tab === 'student' && <StudentReport me={me} sid={sid} today={data.today} picked={picked} setPicked={setPicked} />}
      {tab === 'low' && <LowReport me={me} sid={sid} today={data.today} classes={data.classes} onStudent={openStudent} />}
    </Page>
  );
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
  const auto = async (mode) => {
    if (dirty && !(await ask('Discard your unsaved edits?'))) return;
    if (mode === 'name' && d.students.some((s) => s.roll_no) && !(await ask('This renumbers EVERY student 1, 2, 3... in A-Z order of name. Continue?'))) return;
    run(() => send('post', me, sid, '/rolls/auto', { class_id: classId, mode }), mode === 'name' ? 'Numbered A-Z' : 'Missing roll numbers filled');
  };
  const pickClass = async (id) => { if (dirty && !(await ask('Discard your unsaved edits?'))) return; setClassId(id); };

  if (!cl) return <Page><Loading /></Page>;
  if (!cl.classes.length) return <Page><EmptyState icon="attendance">No classes available.</EmptyState></Page>;
  return (
    <Page>
      <PageBar title="Roll numbers" sub="Roll numbers are 1 to 100 and unique inside one class. They are cleared at year-end promotion, so assign them again for the new class.">
        <ClassSelect classes={cl.classes} value={classId} onChange={pickClass} />
      </PageBar>
      {err && <Notice tone="bad">{err}</Notice>}
      {!d ? (err ? null : <Loading rows={3} />) : d.students.length === 0 ? <EmptyState icon="users">No active students in this class.</EmptyState> : (<>
        <div className="ds-inline"><Button size="sm" disabled={busy} onClick={() => auto('fill')}>Fill missing numbers</Button><Button size="sm" disabled={busy} onClick={() => auto('name')}>Number all A–Z</Button></div>
        <Section flush><List>{[...d.students].sort((a, b) => (Number(vals[a.student_id]) || 1e9) - (Number(vals[b.student_id]) || 1e9) || a.full_name.localeCompare(b.full_name)).map((s) => {
          const v = vals[s.student_id]; const flagged = bad(v) || (v !== '' && dups.has(String(v)));
          return (
            <ListRow key={s.student_id} title={s.full_name} sub={s.admission_no ? `Adm. ${s.admission_no}` : s.login_id}
              meta={<input type="number" min="1" max="100" inputMode="numeric" className={`rollin ${flagged ? 'bad' : ''}`} aria-label={`Roll no. of ${s.full_name}`} value={v} placeholder="-" onChange={(e) => setVals({ ...vals, [s.student_id]: e.target.value })} />} />);
        })}</List></Section>
        <SaveBar dirty={dirty} error={dups.size > 0 ? 'Duplicate roll numbers' : invalid ? 'Use whole numbers 1-100' : ''} summary={dirty ? 'Unsaved changes' : 'All saved'}
          action={<Button kind="primary" loading={busy} disabled={!dirty || invalid} onClick={save}>Save roll numbers</Button>} />
      </>)}
    </Page>
  );
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
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormDialog title={`Teachers - ${clsLabel(cls)}`} onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel={`Save (${sel.size} selected)`}>
      <input type="search" placeholder="Search staff" aria-label="Search staff" value={q} onChange={(e) => setQ(e.target.value)} />
      {teachers.length === 0 && <EmptyState icon="users">No staff accounts yet. Create users with the role "Staff" first.</EmptyState>}
      <Section flush><List>{list.map((t) => (
        <ListRow key={t.user_id} lead={<input type="checkbox" aria-label={`Select ${t.full_name}`} checked={sel.has(t.user_id)} onChange={() => toggle(t.user_id)} />} title={t.full_name} sub={t.designation || t.login_id}>
          {sel.has(t.user_id) && <Button size="sm" icon="star" kind={head === t.user_id ? 'primary' : 'secondary'} title="Mark as the class teacher" onClick={() => setHead(head === t.user_id ? '' : t.user_id)}>Class teacher</Button>}
        </ListRow>))}</List></Section>
    </FormDialog>
  );
}

export const ClassTeachers = scoped(function Teachers({ me, sid }) {
  const [edit, setEdit] = useState(null);
  const { data: d, error: err, refresh: reload } = useApi(`/attendance/teachers${qs(scopeQ(me, sid))}`);
  if (err) return <Page><Notice tone="bad">{err}</Notice></Page>;
  if (!d) return <Page><Loading /></Page>;
  return (
    <Page>
      <PageBar title="Class teachers" sub='Teachers only see the classes assigned to them in Take attendance. Staff with "Access every class" see all classes.' />
      {d.classes.length === 0 ? <EmptyState icon="users">No classes yet. Add them under Users &gt; Classes.</EmptyState> : (
        <div className="cgrid">{d.classes.map((c) => (
          <button key={c.id} type="button" className="ccard static" onClick={() => setEdit(c)} aria-label={`Edit teachers of ${clsLabel(c)}`}>
            <div className="ccard-top"><b className="cname">{clsLabel(c)}</b><span className="ccard-go"><Icon name="edit" size={15} /></span></div>
            {c.teachers.length === 0 ? <span className="ds-hint">No teacher assigned</span> : <div className="ds-chips">{c.teachers.map((t) => <StatusBadge key={t.user_id} tone={t.is_class_teacher ? 'info' : 'mute'} dot={false}>{t.is_class_teacher ? '★ ' : ''}{t.full_name}</StatusBadge>)}</div>}
          </button>))}</div>)}
      {edit && <AssignModal me={me} sid={sid} cls={edit} teachers={d.teachers} onClose={() => setEdit(null)} onSaved={reload} />}
    </Page>
  );
});
