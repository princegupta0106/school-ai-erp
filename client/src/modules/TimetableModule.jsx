// Timetable & teacher workload.
//   Structure -> Teachers (set inside each teacher's profile: <TeachingCard/>) -> Class timetables -> Workload -> Substitutes.
// Talks to /api/timetable. Colourful on purpose: every subject keeps its own colour everywhere.
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApi, invalidate } from '../cache.js';
import { Icon, Empty, Field, Modal, Badge, toast, Loading, ask, initials } from '../ui.jsx';
import { scoped } from './AttendanceModule.jsx';

/* ------------------------------------------------------------------ helpers */
const sq = (me, sid) => (me.role === 'super_admin' ? { school_id: sid } : {});
const qs = (o) => { const p = new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))); const s = p.toString(); return s ? `?${s}` : ''; };
const can = (me, ...f) => f.some((x) => me.features.includes(x));
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PALETTE = ['#6366f1', '#f97316', '#10b981', '#ec4899', '#0ea5e9', '#eab308', '#8b5cf6', '#ef4444', '#14b8a6', '#d946ef', '#84cc16', '#f43f5e'];
const clsName = (c) => (c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : '');
const dowOf = (d) => { const n = new Date(`${d}T00:00:00`).getDay(); return n === 0 ? 7 : n; };
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function useMeta(me, sid) {
  const r = useApi(`/timetable/meta${qs(sq(me, sid))}`, true, { keepPrevious: true });
  const T = useMemo(() => {
    const m = r.data; if (!m) return null;
    return {
      teacher: Object.fromEntries(m.teachers.map((t) => [t.user_id, t])), cls: Object.fromEntries(m.classes.map((c) => [c.id, c])),
      subject: Object.fromEntries(m.subjects.map((s) => [s.id, s])), color: Object.fromEntries(m.subjects.map((s, i) => [s.id, PALETTE[i % PALETTE.length]])),
      teaching: m.periods.filter((p) => !p.is_break),
    };
  }, [r.data]);
  return { ...r, meta: r.data, T };
}
const keyOf = (s) => `${s.day}|${s.period_id}`;

function downloadCsv(name, rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([`\ufeff${rows.map((r) => r.map(q).join(',')).join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function printGrid({ title, sub, heads, rows }) {
  const w = window.open('', '_blank', 'width=1000,height=800'); if (!w) { toast('Allow pop-ups to print', true); return; }
  w.document.write(`<!doctype html><title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:13px system-ui,sans-serif;margin:22px;color:#111}h1{font-size:20px;margin:0}h2{font-size:14px;margin:2px 0 14px;font-weight:500;color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:7px 8px;text-align:center;vertical-align:middle}th{background:#eef0ff}td.brk{background:#fff4d6;font-weight:600}td small{display:block;color:#555}th small{display:block;font-weight:400;color:#555}</style><h1>${esc(title)}</h1><h2>${esc(sub || '')}</h2><table><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => (c && c.brk ? `<td class="brk" colspan="${heads.length - 1}">${esc(c.brk)}</td>` : i === 0 ? `<th>${c}</th>` : `<td>${c || ''}</td>`)).join('')}</tr>`).join('')}</table><script>onload=()=>setTimeout(()=>print(),250)</script>`);
  w.document.close();
}

/* ------------------------------------------------------------------ small pieces */
const Chip = ({ color, title, sub, tag, onClick, active }) => (
  <button type="button" className={`tt-chip ${active ? 'on' : ''}`} style={{ '--c': color }} onClick={onClick} disabled={!onClick}>
    <b>{title}</b>{sub && <small>{sub}</small>}{tag && <i>{tag}</i>}
  </button>
);
const Stat = ({ n, label, color, icon }) => (
  <div className="tt-stat" style={{ '--c': color }}><span className="tt-stat-ic"><Icon name={icon} size={20} /></span><div><b>{n}</b><span>{label}</span></div></div>
);
const Ring = ({ pct, label, color = '#10b981' }) => {
  const R = 44; const C = 2 * Math.PI * R; const p = Math.max(0, Math.min(100, pct));
  return (
    <svg className="tt-ring" viewBox="0 0 110 110" role="img" aria-label={`${p}% ${label}`}>
      <circle cx="55" cy="55" r={R} fill="none" stroke="color-mix(in srgb,var(--ink) 9%,transparent)" strokeWidth="12" />
      <circle cx="55" cy="55" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(C * p) / 100} ${C}`} transform="rotate(-90 55 55)" />
      <text x="55" y="53" textAnchor="middle" fontSize="22" fontWeight="800" fill="currentColor">{Math.round(p)}%</text>
      <text x="55" y="70" textAnchor="middle" fontSize="10" fill="var(--mute)">{label}</text>
    </svg>
  );
};
const Bar = ({ value, max, color }) => (
  <div className="tt-bar"><i style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%`, background: value > max ? '#ef4444' : color }} /></div>
);
const Err = ({ error }) => (error ? <div className="err">{error}</div> : null);
const Hint = ({ children }) => <div className="tt-hint">{children}</div>;

// the weekly grid used by every screen. cell(day, period) returns what goes inside the box.
function Grid({ meta, cell, todayDay }) {
  const days = meta.settings.days;
  return (
    <div className="tt-wrap">
      <table className="tt-grid">
        <thead><tr><th />{days.map((d) => <th key={d} className={d === todayDay ? 'today' : ''}>{DAY_LONG[d]}</th>)}</tr></thead>
        <tbody>
          {meta.periods.map((p) => (p.is_break
            ? <tr key={p.id} className="tt-break"><th><b>{p.name}</b><small>{p.start_time} - {p.end_time}</small></th><td colSpan={days.length}>☕ {p.name}</td></tr>
            : <tr key={p.id}><th><b>{p.name}</b><small>{p.start_time} - {p.end_time}</small></th>{days.map((d) => <td key={d} className={d === todayDay ? 'today' : ''}>{cell(d, p)}</td>)}</tr>))}
        </tbody>
      </table>
    </div>
  );
}
const NoStructure = ({ go, me }) => (
  <Empty>The timetable structure is not set up yet.{can(me, 'manage_timetable_setup') && go ? <> <button className="btn primary" style={{ marginLeft: 8 }} onClick={() => go('setup')}>Set it up</button></> : ' Ask your school admin to set it up.'}</Empty>
);

/* ================================================================== 1. OVERVIEW + WORKLOAD */
export const TimetableHome = scoped(function TimetableHome({ me, sid, go }) {
  const { meta, T, error } = useMeta(me, sid);
  const { data: w } = useApi(`/timetable/workload${qs(sq(me, sid))}`, true, { keepPrevious: true });
  const [sort, setSort] = useState('load');
  if (error) return <div className="err">{error}</div>;
  if (!meta || !w) return <Loading />;
  if (!meta.periods.length) return <NoStructure go={go} me={me} />;
  const t = w.totals; const cov = t.required ? Math.round((t.scheduled / t.required) * 100) : 0;
  const rows = w.teachers.map((x) => ({ ...x, t: T.teacher[x.teacher_id] })).filter((x) => x.t)
    .sort((a, b) => (sort === 'name' ? a.t.name.localeCompare(b.t.name) : b.assigned - a.assigned));
  const classRows = w.classes.map((c) => ({ ...c, c: T.cls[c.class_id] })).filter((c) => c.c);
  return (
    <div className="stack tt">
      <div className="tt-stats">
        <Stat n={t.teachers} label="Teachers" color="#6366f1" icon="users" />
        <Stat n={t.required} label="Periods planned a week" color="#0ea5e9" icon="calendar" />
        <Stat n={t.scheduled} label="Periods scheduled" color="#10b981" icon="check" />
        <Stat n={t.unassigned} label="Still to schedule" color="#f97316" icon="bolt" />
        <Stat n={t.clashes} label="Clashes" color="#ec4899" icon="shield" />
        <Stat n={t.substitutions_today} label="Substitutions today" color="#8b5cf6" icon="userplus" />
      </div>

      <div className="tt-two">
        <div className="card tt-cov">
          <Ring pct={cov} label="scheduled" />
          <div className="stack" style={{ gap: 6 }}>
            <b>Timetable coverage</b>
            <span className="muted">{t.scheduled} of {t.required} planned periods are placed in class timetables.</span>
            <span className="tt-legend"><i style={{ background: '#10b981' }} />Scheduled {t.scheduled}<i style={{ background: '#f97316' }} />To schedule {t.unassigned}</span>
            {can(me, 'manage_timetable') && <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => go('class')}><Icon name="edit" size={16} />Build class timetables</button>}
          </div>
        </div>
        <div className="card stack" style={{ gap: 8 }}>
          <b>Class-wise coverage</b>
          {classRows.length === 0 ? <span className="muted">No classes yet.</span> : (
            <div className="tt-classes">{classRows.map((c) => (
              <div key={c.class_id} className="tt-cls"><div className="row sp"><b>{clsName(c.c)}</b><small>{c.scheduled}/{c.required || '-'}</small></div>
                <Bar value={c.scheduled} max={c.required || 1} color="#10b981" /></div>))}</div>)}
        </div>
      </div>

      <div className="card stack" style={{ gap: 10 }}>
        <div className="row sp"><b>Teacher workload</b>
          <div className="pills"><button className={`pill ${sort === 'load' ? 'on' : ''}`} onClick={() => setSort('load')}>Busiest first</button><button className={`pill ${sort === 'name' ? 'on' : ''}`} onClick={() => setSort('name')}>A to Z</button></div></div>
        <Hint>Bar = periods a week given in the teacher's profile. Red means over the limit of {w.max_load}.</Hint>
        {rows.length === 0 ? <Empty>No teachers yet.</Empty> : rows.map((x, i) => {
          const col = PALETTE[i % PALETTE.length];
          return (
            <div key={x.teacher_id} className="tt-load">
              <span className="avatar" style={{ background: `color-mix(in srgb,${col} 18%,var(--card))`, color: col, borderColor: `color-mix(in srgb,${col} 40%,transparent)` }}>{initials(x.t.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row sp"><b>{x.t.name}</b><span className={x.assigned > w.max_load ? 'tt-over' : 'muted'}>{x.assigned} / {w.max_load}</span></div>
                <Bar value={x.assigned} max={w.max_load} color={col} />
                <small className="muted">{x.classes} class{x.classes === 1 ? '' : 'es'} - {x.subjects} subject{x.subjects === 1 ? '' : 's'} - {x.scheduled} placed in timetable - {x.free} free periods</small>
              </div>
            </div>);
        })}
      </div>
    </div>
  );
});

/* ================================================================== 2. STRUCTURE (days, periods, breaks) */
const QUICK = [['Period 1', '08:00', '08:45'], ['Period 2', '08:45', '09:30'], ['Period 3', '09:30', '10:15'], ['Morning break', '10:15', '10:35', 1], ['Period 4', '10:35', '11:20'], ['Period 5', '11:20', '12:05'], ['Lunch', '12:05', '12:35', 1], ['Period 6', '12:35', '13:20'], ['Period 7', '13:20', '14:05']];
/* ---- periods per week of every subject in every class: set once here, teachers just take them */
function ClassPeriods({ me, sid, meta, refresh }) {
  const [vals, setVals] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (meta && !vals) { const v = {}; meta.classes.forEach((c) => (meta.class_subjects?.[c.id] || []).forEach((sb) => { v[`${c.id}|${sb}`] = meta.class_periods?.[c.id]?.[sb] ?? ''; })); setVals(v); } }, [meta]); // eslint-disable-line
  if (!vals) return null;
  const subs = meta.subjects.filter((sb) => meta.classes.some((c) => (meta.class_subjects?.[c.id] || []).includes(sb.id)));
  if (!subs.length) return <Hint>Define subjects for each class first (Timetable &gt; Class subjects) - then you can set how many periods a week each one gets.</Hint>;
  const slotsPerWeek = meta.periods.filter((p) => !p.is_break).length * meta.settings.days.length;
  const set = (k, v) => setVals({ ...vals, [k]: v });
  const fillCol = (sb) => { const first = meta.classes.map((c) => vals[`${c.id}|${sb}`]).find((x) => x !== '' && x != null); if (first === undefined) return; const n = { ...vals }; meta.classes.forEach((c) => { if (`${c.id}|${sb}` in n) n[`${c.id}|${sb}`] = first; }); setVals(n); };
  const save = async () => {
    setBusy(true);
    try { await api.put(`/timetable/class-periods${qs(sq(me, sid))}`, { items: Object.entries(vals).map(([k, v]) => { const [class_id, subject_id] = k.split('|'); return { class_id, subject_id, periods_per_week: v }; }) }); toast('Periods per week saved'); await refresh(); }
    catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  return (
    <div className="card stack">
      <b>3. Periods per week - each subject, each class</b>
      <span className="muted">Type how many periods a week a class gets of a subject (e.g. Games 2, Maths 7). Teachers simply take these. "Same for all" copies the first class's number down the column.</span>
      <div className="tt-wrap"><table className="tt-grid"><thead><tr><th>Class</th>{subs.map((sb) => <th key={sb.id}>{sb.name}<br /><button type="button" className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => fillCol(sb.id)}>same for all</button></th>)}<th>Total / {slotsPerWeek}</th></tr></thead>
        <tbody>{meta.classes.map((c) => {
          const tot = subs.reduce((n, sb) => n + (Number(vals[`${c.id}|${sb.id}`]) || 0), 0);
          return <tr key={c.id}><th><b>{clsName(c)}</b></th>{subs.map((sb) => { const k = `${c.id}|${sb.id}`; return <td key={sb.id}>{k in vals ? <input type="number" min="0" max="40" style={{ width: 56 }} value={vals[k]} onChange={(e) => set(k, e.target.value)} /> : <span className="tt-dash">-</span>}</td>; })}<td className={tot > slotsPerWeek ? 'tt-over' : ''}><b>{tot}</b></td></tr>;
        })}</tbody></table></div>
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save periods per week'}</button>
    </div>
  );
}

export const TimetableSetup = scoped(function TimetableSetup({ me, sid }) {
  const { meta, error, refresh } = useMeta(me, sid);
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6]); const [load, setLoad] = useState(30); const [rows, setRows] = useState([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!meta || ready) return;
    setDays(meta.settings.days); setLoad(meta.settings.max_load); setRows(meta.periods.map((p) => ({ ...p }))); setReady(true);
  }, [meta]); // eslint-disable-line
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  const set = (i, patch) => setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const add = (brk) => { const last = rows[rows.length - 1]; setRows([...rows, { name: brk ? 'Break' : `Period ${rows.filter((r) => !r.is_break).length + 1}`, start_time: last?.end_time || '08:00', end_time: '', is_break: !!brk }]); };
  const move = (i, d) => { const n = i + d; if (n < 0 || n >= rows.length) return; const c = [...rows];[c[i], c[n]] = [c[n], c[i]]; setRows(c); };
  const quick = () => setRows(QUICK.map(([name, s, e, b]) => ({ name, start_time: s, end_time: e, is_break: !!b })));
  const save = async () => {
    setErr('');
    const removed = meta.periods.filter((p) => !rows.some((r) => r.id === p.id));
    if (removed.length && !(await ask(`Removing ${removed.map((p) => p.name).join(', ')} also removes its periods from every class timetable. Continue?`, { yes: 'Save anyway', danger: true }))) return;
    setBusy(true);
    try { await api.put(`/timetable/structure${qs(sq(me, sid))}`, { days, max_load: Number(load), periods: rows }); toast('Timetable structure saved'); setReady(false); await refresh(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack tt" style={{ maxWidth: 820 }}>
      <div className="card stack">
        <b>1. School days</b>
        <div className="pills">{[1, 2, 3, 4, 5, 6, 7].map((d) => <button key={d} type="button" className={`pill ${days.includes(d) ? 'on' : ''}`} onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())}>{DAY_LONG[d]}</button>)}</div>
        <div style={{ maxWidth: 260 }}><Field label="Most periods a teacher should take in a week" hint="Used to warn when a teacher is overloaded"><input type="number" min="1" max="80" value={load} onChange={(e) => setLoad(e.target.value)} /></Field></div>
      </div>
      <div className="card stack">
        <div className="row sp"><b>2. The school day</b>
          <div className="row"><button type="button" className="btn" onClick={quick}><Icon name="bolt" size={16} />Quick start</button><button type="button" className="btn" onClick={() => add(false)}><Icon name="plus" size={16} />Period</button><button type="button" className="btn" onClick={() => add(true)}>☕ Break</button></div></div>
        {rows.length === 0 && <Empty>No periods yet. Tap <b>Quick start</b> for a ready-made day, then change the times.</Empty>}
        {rows.map((r, i) => (
          <div key={r.id || i} className={`tt-prow ${r.is_break ? 'brk' : ''}`}>
            <span className="tt-no">{r.is_break ? '☕' : rows.slice(0, i + 1).filter((x) => !x.is_break).length}</span>
            <input aria-label="Name" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            <input aria-label="Starts" type="time" value={r.start_time} onChange={(e) => set(i, { start_time: e.target.value })} />
            <input aria-label="Ends" type="time" value={r.end_time} onChange={(e) => set(i, { end_time: e.target.value })} />
            <label className="check" style={{ padding: '6px 9px' }}><input type="checkbox" checked={r.is_break} onChange={(e) => set(i, { is_break: e.target.checked })} />Break</label>
            <button type="button" className="icon-btn" aria-label="Move up" onClick={() => move(i, -1)}><Icon name="up" size={16} /></button>
            <button type="button" className="icon-btn" aria-label="Move down" onClick={() => move(i, 1)}><Icon name="down" size={16} /></button>
            <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setRows(rows.filter((_, n) => n !== i))}><Icon name="trash" size={16} /></button>
          </div>))}
      </div>
      <Err error={err} />
      <button className="btn primary big" style={{ alignSelf: 'flex-start' }} onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save structure'}</button>
      <ClassPeriods me={me} sid={sid} meta={meta} refresh={refresh} />
      <Hint>Next: open a teacher in <b>Users</b> and tick which subjects they teach in which classes (no period counts there). Then use <b>Auto generate</b>.</Hint>
    </div>
  );
});

/* ---- one day, everybody: rows = classes (or teachers), columns = periods. Used by Auto generate preview and Whole school. */
function DayMatrix({ meta, T, slots, day, mode }) {
  const at = new Map(slots.filter((x) => x.day === day).map((x) => [`${mode === 'teacher' ? x.teacher_id : x.class_id}|${x.period_id}`, x]));
  const short = (n) => String(n || '').split(' ')[0];
  const rows = mode === 'teacher' ? meta.teachers.filter((t) => slots.some((x) => x.teacher_id === t.user_id)).map((t) => ({ id: t.user_id, label: t.name, sub: t.designation })) : meta.classes.map((c) => ({ id: c.id, label: clsName(c) }));
  return (
    <div className="tt-wrap"><table className="tt-grid tt-school">
      <thead><tr><th>{mode === 'teacher' ? 'Teacher' : 'Class'}</th>{meta.periods.map((p) => <th key={p.id}>{p.name}<small>{p.start_time}-{p.end_time}</small></th>)}</tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}><th><b>{r.label}</b>{r.sub ? <small>{r.sub}</small> : null}</th>{meta.periods.map((p) => {
          if (p.is_break) return <td key={p.id} className="tt-brkcell">☕</td>;
          const x = at.get(`${r.id}|${p.id}`);
          if (!x) return <td key={p.id}><span className="tt-dash">{mode === 'teacher' ? 'free' : '-'}</span></td>;
          return <td key={p.id}><Chip color={T.color[x.subject_id]} title={T.subject[x.subject_id]?.name} sub={mode === 'teacher' ? clsName(T.cls[x.class_id]) : short(T.teacher[x.teacher_id]?.name)} /></td>;
        })}</tr>))}</tbody>
    </table></div>
  );
}

/* ================================================================== 3. CLASS TIMETABLE (builder) */
function CellEditor({ me, sid, cls, day, period, current, T, onClose, onSaved }) {
  const { data: opts, error } = useApi(`/timetable/classes/${cls.id}/options${qs({ ...sq(me, sid), day, period_id: period.id })}`);
  const [busy, setBusy] = useState(false);
  const put = async (o) => {
    setBusy(true);
    try {
      const r = await api.put(`/timetable/classes/${cls.id}/slot${qs(sq(me, sid))}`, { day, period_id: period.id, subject_id: o?.subject_id || '', teacher_id: o?.teacher_id || '' });
      if (r.warning) toast(r.warning, true); else toast(o ? 'Period saved' : 'Period cleared');
      onSaved(); onClose();
    } catch (x) { toast(x.message, true); setBusy(false); }
  };
  return (
    <Modal title={`${DAY_LONG[day]} - ${period.name} - Class ${clsName(cls)}`} onClose={onClose}>
      <Hint>{period.start_time} - {period.end_time}. Pick who takes this class now. Teachers already busy at this time are greyed out.</Hint>
      <Err error={error} />
      {!opts && !error ? <Loading rows={3} /> : opts && opts.length === 0 ? (
        <Empty>No teacher has been given this class yet. Open a teacher's profile (Users) and add the class and subject under <b>Teaching</b>.</Empty>
      ) : (
        <div className="tt-opts">{(opts || []).map((o) => {
          const sel = current && current.teacher_id === o.teacher_id && current.subject_id === o.subject_id;
          return (
            <button key={`${o.teacher_id}|${o.subject_id}`} className={`tt-opt ${sel ? 'sel' : ''}`} style={{ '--c': T.color[o.subject_id] }} disabled={busy || !!o.busy} onClick={() => put(o)}>
              <b>{T.subject[o.subject_id]?.name}</b><span>{T.teacher[o.teacher_id]?.name || 'Teacher'}</span>
              <small>{o.busy ? `Busy in Class ${o.busy}` : sel ? 'Selected now' : `${o.scheduled} of ${o.periods_per_week} placed`}</small>
            </button>);
        })}</div>)}
      {current && <button className="btn danger" style={{ marginTop: 12 }} disabled={busy} onClick={() => put(null)}><Icon name="trash" size={16} />Clear this period</button>}
    </Modal>
  );
}

export const ClassTimetable = scoped(function ClassTimetable({ me, sid }) {
  const { meta, T, error } = useMeta(me, sid);
  const [cid, setCid] = useState(''); const [edit, setEdit] = useState(null); const [view, setView] = useState('grid');
  const canEdit = can(me, 'manage_timetable');
  const classId = cid || meta?.classes?.[0]?.id || '';
  const sl = useApi(classId ? `/timetable/slots${qs({ ...sq(me, sid), class_id: classId })}` : '', !!classId, { keepPrevious: true });
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  if (!meta.periods.length) return <NoStructure me={me} />;
  if (!meta.classes.length) return <Empty>Add classes first (Users, Classes).</Empty>;
  const cls = T.cls[classId]; const slots = sl.data || [];
  const at = Object.fromEntries(slots.map((s) => [keyOf(s), s]));
  const req = meta.assignments.filter((a) => a.class_id === classId);
  const noTeacher = (meta.class_subjects?.[classId] || []).filter((sid2) => !req.some((a) => a.subject_id === sid2)).map((sid2) => T.subject[sid2]?.name).filter(Boolean);
  const placed = (a) => slots.filter((s) => s.teacher_id === a.teacher_id && s.subject_id === a.subject_id).length;
  const textOf = (d, p) => { const s = at[`${d}|${p.id}`]; return s ? `<b>${esc(T.subject[s.subject_id]?.name)}</b><small>${esc(T.teacher[s.teacher_id]?.name)}</small>` : ''; };
  const print = () => printGrid({ title: `Timetable - Class ${clsName(cls)}`, sub: meta.periods.length ? '' : '', heads: ['', ...meta.settings.days.map((d) => DAY_LONG[d])], rows: meta.periods.map((p) => (p.is_break ? [`${esc(p.name)}<small>${p.start_time} - ${p.end_time}</small>`, { brk: p.name }] : [`${esc(p.name)}<small>${p.start_time} - ${p.end_time}</small>`, ...meta.settings.days.map((d) => textOf(d, p))])) });
  return (
    <div className="stack tt">
      <div className="row sp">
        <div className="pills scroll">{meta.classes.map((c) => <button key={c.id} className={`pill ${c.id === classId ? 'on' : ''}`} onClick={() => setCid(c.id)}>{clsName(c)}</button>)}</div>
        <div className="row">{canEdit && slots.length > 0 && <button className="btn danger" onClick={async () => { if (!(await ask(`Delete the whole timetable of Class ${clsName(cls)}?`, { yes: 'Delete', danger: true }))) return; try { await api.post(`/timetable/clear${qs(sq(me, sid))}`, { class_ids: [classId] }); toast('Timetable deleted'); invalidate('/timetable'); sl.refresh(); } catch (x) { toast(x.message, true); } }}><Icon name="trash" size={16} />Delete</button>}<div className="pills"><button className={`pill ${view === 'grid' ? 'on' : ''}`} onClick={() => setView('grid')}>Day-wise</button><button className={`pill ${view === 'subject' ? 'on' : ''}`} onClick={() => setView('subject')}>Subject-wise</button></div>
        <button className="btn" onClick={print}><Icon name="file" size={16} />Print</button></div>
      </div>
      {view === 'subject' && <SubjectWise meta={meta} T={T} classId={classId} slots={slots} />}
      {view === 'grid' && <Grid meta={meta} cell={(d, p) => {
        const s = at[`${d}|${p.id}`];
        if (s) return <Chip color={T.color[s.subject_id]} title={T.subject[s.subject_id]?.name} sub={T.teacher[s.teacher_id]?.name} onClick={canEdit ? () => setEdit({ d, p, s }) : undefined} />;
        return canEdit ? <button type="button" className="tt-empty" aria-label="Add period" onClick={() => setEdit({ d, p })}><Icon name="plus" size={16} /></button> : <span className="tt-dash">-</span>;
      }} />}
      <div className="card stack" style={{ gap: 10 }}>
        <b>Subjects & teachers of {/^class\b/i.test(clsName(cls)) ? '' : 'Class '}{clsName(cls)}</b>
        {req.length === 0 ? <span className="muted">No teacher has been given this class yet. In <b>Users</b>, open a teacher and add this class under <b>Teaching</b>.</span> : (
          <div className="tt-req">{req.map((a) => {
            const n = placed(a); const col = T.color[a.subject_id];
            return (
              <div key={`${a.teacher_id}${a.subject_id}`} className="tt-reqrow" style={{ '--c': col }}>
                <span className="tt-dot" /><div style={{ flex: 1, minWidth: 0 }}><b>{T.subject[a.subject_id]?.name}</b><small>{T.teacher[a.teacher_id]?.name || 'Teacher'}</small></div>
                <div style={{ width: 110 }}><Bar value={n} max={a.periods_per_week} color={col} /></div><span className={n > a.periods_per_week ? 'tt-over' : n === a.periods_per_week ? 'tt-done' : 'muted'}>{n}/{a.periods_per_week}</span>
              </div>);
          })}</div>)}
        {noTeacher.length > 0 && <div className="notice warn">No teacher yet for: <b>{noTeacher.join(', ')}</b>. Add the class + subject in a teacher's profile (Users) so it can be scheduled.</div>}
      </div>
      {edit && <CellEditor me={me} sid={sid} cls={cls} day={edit.d} period={edit.p} current={edit.s} T={T} onClose={() => setEdit(null)} onSaved={sl.refresh} />}
    </div>
  );
});

/* ---- subject-wise view of one class: each subject with its teacher, weekly count and exact days/periods */
function SubjectWise({ meta, T, classId, slots }) {
  const subjectIds = [...new Set([...(meta.class_subjects?.[classId] || []), ...meta.assignments.filter((a) => a.class_id === classId).map((a) => a.subject_id)])];
  const pname = Object.fromEntries(meta.periods.map((p) => [p.id, p.name.replace(/^Period\s*/i, 'P')]));
  const order = Object.fromEntries(meta.periods.map((p, i) => [p.id, i]));
  if (!subjectIds.length) return <Empty>No subjects defined for this class yet (Timetable &gt; Class subjects).</Empty>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {subjectIds.map((sub) => {
        const mine = slots.filter((s) => s.subject_id === sub).sort((a, b) => (a.day - b.day) || (order[a.period_id] - order[b.period_id]));
        const teachers = [...new Set([...meta.assignments.filter((a) => a.class_id === classId && a.subject_id === sub).map((a) => a.teacher_id), ...mine.map((s) => s.teacher_id)])];
        const planned = meta.assignments.filter((a) => a.class_id === classId && a.subject_id === sub).reduce((n, a) => n + a.periods_per_week, 0);
        return (
          <div key={sub} className="card" style={{ borderLeft: `5px solid ${T.color[sub]}` }}>
            <div className="row sp"><b>{T.subject[sub]?.name}</b><span className={mine.length > planned && planned ? 'tt-over' : 'muted'}>{mine.length}{planned ? ` / ${planned}` : ''} periods a week</span></div>
            <div className="muted" style={{ margin: '4px 0 8px' }}>{teachers.length ? teachers.map((t) => T.teacher[t]?.name || 'Teacher').join(', ') : 'No teacher yet'}</div>
            <div className="pills">{mine.length ? mine.map((s) => <span key={s.id} className="tt-tag" style={{ '--c': T.color[sub] }}>{DAY[s.day]} {pname[s.period_id]}</span>) : <span className="muted">Not placed in the timetable yet</span>}</div>
          </div>);
      })}
    </div>
  );
}

/* ================================================================== CLASS SUBJECTS (subjects + teacher + periods a week of each class, one screen) */
export const ClassPlan = scoped(function ClassPlan({ me, sid }) {
  const { meta, T, error, refresh } = useMeta(me, sid);
  const [cid, setCid] = useState(''); const [rows, setRows] = useState(null); const [also, setAlso] = useState([]); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const classId = cid || meta?.classes?.[0]?.id || '';
  const can2 = can(me, 'manage_timetable_setup', 'manage_timetable');
  const built = React.useRef('');
  const original = (m, c) => [...new Set([...(m.class_subjects?.[c] || []), ...m.assignments.filter((a) => a.class_id === c).map((a) => a.subject_id)])].map((sb) => ({ subject_id: sb, teacher_id: m.assignments.find((a) => a.class_id === c && a.subject_id === sb)?.teacher_id || '', periods_per_week: m.class_periods?.[c]?.[sb] ?? '' }));
  useEffect(() => {
    if (!meta || !classId) return;
    if (dirty && built.current === classId) return;
    built.current = classId; setRows(original(meta, classId)); setAlso([]); setDirty(false);
  }, [meta, classId]); // eslint-disable-line
  if (error) return <div className="err">{error}</div>;
  if (!meta || !rows) return <Loading />;
  if (!meta.classes.length) return <Empty>Add classes first (Users, Classes).</Empty>;
  if (!meta.subjects.length) return <Empty>Add subjects first (Exams & Report Cards, Subjects), then choose which classes study them here.</Empty>;
  const cls = T.cls[classId]; const orig = original(meta, classId);
  const slotsPerWeek = meta.periods.filter((p) => !p.is_break).length * meta.settings.days.length;
  const total = rows.reduce((n, r) => n + (Number(r.periods_per_week) || 0), 0);
  const patch = (i, o) => { setRows(rows.map((r, n) => (n === i ? { ...r, ...o } : r))); setDirty(true); };
  const free = meta.subjects.filter((sb) => !rows.some((r) => r.subject_id === sb.id));
  const teacherOpts = (sb) => {
    const mine = new Set(meta.assignments.filter((a) => a.subject_id === sb).map((a) => a.teacher_id));
    return [meta.teachers.filter((t) => mine.has(t.user_id)), meta.teachers.filter((t) => !mine.has(t.user_id))];
  };
  const loadOf = (tid) => meta.assignments.filter((a) => a.teacher_id === tid && a.class_id !== classId).reduce((n, a) => n + a.periods_per_week, 0) + rows.filter((r) => r.teacher_id === tid).reduce((n, r) => n + (Number(r.periods_per_week) || 0), 0);
  const changes = rows.some((r) => { const o = orig.find((x) => x.subject_id === r.subject_id); return o && o.teacher_id && o.teacher_id !== r.teacher_id; }) || orig.some((o) => !rows.some((r) => r.subject_id === o.subject_id));
  const save = async () => {
    if ((changes || also.length) && !(await ask(`Removing a subject or changing its teacher clears those periods from the timetable${also.length ? `, and this list replaces the subjects of ${also.length} other class(es)` : ''}. Continue?`, { yes: 'Save', danger: true }))) return;
    setBusy(true);
    try {
      await api.put(`/timetable/class-plan/${classId}${qs(sq(me, sid))}`, { items: rows.map((r) => ({ subject_id: r.subject_id, teacher_id: r.teacher_id || null, periods_per_week: r.periods_per_week })), copy_to: also });
      toast('Saved'); invalidate('/timetable'); invalidate('acad:'); setDirty(false); built.current = ''; await refresh();
    } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const overT = [...new Set(rows.map((r) => r.teacher_id).filter(Boolean))].filter((t) => loadOf(t) > meta.settings.max_load);
  return (
    <div className="stack tt" style={{ maxWidth: 900 }}>
      <Hint>For each class: choose its subjects, the teacher of each, and how many periods a week it gets. Change the teacher or remove a subject any time - then use <b>Auto generate</b> to rebuild the timetable.</Hint>
      <div className="pills scroll">{meta.classes.map((c) => <button key={c.id} className={`pill ${c.id === classId ? 'on' : ''}`} onClick={() => { if (dirty && !window.confirm('Discard unsaved changes?')) return; setDirty(false); built.current = ''; setCid(c.id); }}>{clsName(c)}</button>)}</div>
      <div className="card stack" style={{ gap: 8 }}>
        <div className="row sp"><b>Class {clsName(cls)}</b><span className={total > slotsPerWeek ? 'tt-over' : 'muted'}>{total} of {slotsPerWeek} periods a week used</span></div>
        {rows.length === 0 && <span className="muted">No subjects yet. Add some below.</span>}
        {rows.map((r, i) => {
          const [mine, others] = teacherOpts(r.subject_id);
          return (
            <div key={r.subject_id} className="tt-trow" style={{ '--c': T.color[r.subject_id], flexWrap: 'wrap' }}>
              <span className="tt-dot" /><b style={{ flex: '1 1 140px', minWidth: 0 }}>{T.subject[r.subject_id]?.name}</b>
              <select aria-label="Teacher" style={{ flex: '1 1 200px' }} disabled={!can2} value={r.teacher_id} onChange={(e) => patch(i, { teacher_id: e.target.value })}>
                <option value="">No teacher</option>
                {mine.length > 0 && <optgroup label={`Teaches ${T.subject[r.subject_id]?.name}`}>{mine.map((t) => <option key={t.user_id} value={t.user_id}>{t.name}</option>)}</optgroup>}
                {others.length > 0 && <optgroup label="Other teachers">{others.map((t) => <option key={t.user_id} value={t.user_id}>{t.name}</option>)}</optgroup>}
              </select>
              <input type="number" min="0" max="40" aria-label="Periods per week" style={{ width: 64 }} disabled={!can2} value={r.periods_per_week} onChange={(e) => patch(i, { periods_per_week: e.target.value })} /><small className="muted">/wk</small>
              {can2 && <button type="button" className="icon-btn" aria-label="Remove subject" onClick={() => { setRows(rows.filter((_, n) => n !== i)); setDirty(true); }}><Icon name="trash" size={16} /></button>}
            </div>);
        })}
        {can2 && free.length > 0 && <div><div className="muted" style={{ marginBottom: 6 }}>Add a subject</div><div className="pills">{free.map((sb) => <button key={sb.id} type="button" className="pill" onClick={() => { setRows([...rows, { subject_id: sb.id, teacher_id: '', periods_per_week: '' }]); setDirty(true); }}><Icon name="plus" size={12} /> {sb.name}</button>)}</div></div>}
        {overT.length > 0 && <div className="notice warn">Over the weekly limit ({meta.settings.max_load}): {overT.map((t) => `${T.teacher[t]?.name} (${loadOf(t)})`).join(', ')}</div>}
      </div>
      {can2 && meta.classes.length > 1 && (
        <div className="card stack" style={{ gap: 8 }}><b>Also give this exact plan (subjects, teachers, periods) to</b>
          <div className="pills">{meta.classes.filter((c) => c.id !== classId).map((c) => <button key={c.id} type="button" className={`pill ${also.includes(c.id) ? 'on' : ''}`} onClick={() => setAlso(also.includes(c.id) ? also.filter((x) => x !== c.id) : [...also, c.id])}>{clsName(c)}</button>)}</div></div>)}
      {can2 && <button className="btn primary big" style={{ alignSelf: 'flex-start' }} disabled={busy || !dirty && !also.length} onClick={save}>{busy ? 'Saving...' : 'Save class plan'}</button>}
    </div>
  );
});

/* ================================================================== 3b. AUTO GENERATE */
export const AutoTimetable = scoped(function AutoTimetable({ me, sid }) {
  const { meta, T, error, refresh } = useMeta(me, sid);
  const [sel, setSel] = useState(null); const [mode, setMode] = useState('replace'); const [auto, setAuto] = useState(true);
  const [res, setRes] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [pday, setPday] = useState(0);
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  if (!meta.periods.length) return <NoStructure me={me} />;
  const chosen = sel || new Set(meta.classes.map((c) => c.id));
  const pd = pday || meta.settings.days[0];
  const toggle = (id) => { const n = new Set(chosen); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); setRes(null); };
  const run = async (apply) => {
    setBusy(true); setMsg('');
    try {
      const r = await api.post(`/timetable/auto-generate${qs(sq(me, sid))}`, { class_ids: [...chosen], mode, auto_assign: auto, apply, seed: apply ? res?.seed : undefined });
      setRes(r);
      if (apply) { toast(`Timetable saved - ${r.placed} periods placed`); setMsg('saved'); refresh && refresh(); }
    } catch (x) { toast(x.message, true); }
    setBusy(false);
  };
  const tag = (id, sub) => `${clsName(T.cls[id])} - ${T.subject[sub]?.name}`;
  const totalMissing = res ? res.shortfall.reduce((n, x) => n + x.missing, 0) : 0;
  return (
    <div className="stack tt">
      <Hint>Set the periods per week of each subject in <b>Structure</b>, and give teachers their classes (Users &gt; teacher &gt; Teaching). The timetable is kept predictable: a teacher gets the same period for the same class on every day of the week (e.g. Period 2 in Class 6 A daily). Daily subjects go first, in the early periods; light subjects (1-3 a week, like games) go to Wednesday and Saturday, in the last periods. No teacher is ever in two classes at once; weekly limit {meta.settings.max_load}.</Hint>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="row sp"><b>1. Classes</b><span className="row"><button className="btn" onClick={() => { setSel(new Set(meta.classes.map((c) => c.id))); setRes(null); }}>All</button><button className="btn" onClick={() => { setSel(new Set()); setRes(null); }}>None</button></span></div>
        <div className="pills">{meta.classes.map((c) => <button key={c.id} className={`pill ${chosen.has(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>{clsName(c)}</button>)}</div>
        <b>2. If a class already has some periods</b>
        <div className="pills"><button className={`pill ${mode === 'fill' ? 'on' : ''}`} onClick={() => { setMode('fill'); setRes(null); }}>Keep them, fill the empty boxes</button><button className={`pill ${mode === 'replace' ? 'on' : ''}`} onClick={() => { setMode('replace'); setRes(null); }}>Clear and make a fresh timetable</button></div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setRes(null); }} style={{ width: 'auto' }} /> If a subject has no teacher in a class, pick one who already teaches that subject (lightest load first)</label>
        <div className="row"><button className="btn primary" disabled={busy || !chosen.size} onClick={() => run(false)}><Icon name="bolt" size={16} />{res ? 'Try another arrangement' : 'Preview timetable'}</button>
          {res && !res.applied && <button className="btn" disabled={busy} onClick={() => run(true)}><Icon name="check" size={16} />Save this timetable</button>}
          <button className="btn danger" disabled={busy || !chosen.size} onClick={async () => { if (!(await ask(`Delete the saved timetable of ${chosen.size === meta.classes.length ? 'ALL classes' : `${chosen.size} class(es)`}? This cannot be undone.`, { yes: 'Delete', danger: true }))) return; try { const r2 = await api.post(`/timetable/clear${qs(sq(me, sid))}`, { class_ids: chosen.size === meta.classes.length ? [] : [...chosen] }); toast(`Deleted ${r2.removed} periods`); invalidate('/timetable'); setRes(null); refresh && refresh(); } catch (x) { toast(x.message, true); } }}><Icon name="trash" size={16} />Delete old timetable</button></div>
      </div>
      {res && (
        <div className="card stack" style={{ gap: 10 }}>
          <b>{res.applied ? 'Saved' : 'Preview'}: {res.placed} periods placed{res.new_assignments ? `, ${res.new_assignments} teacher(s) auto-selected` : ''}</b>
          <div className="pills">{res.per_class.map((c) => <span key={c.class_id} className="tt-tag" style={{ '--c': (c.placed + c.kept) >= c.slots_total ? '#10b981' : '#6366f1' }}>{clsName(T.cls[c.class_id])}: {c.placed + c.kept}/{c.slots_total}</span>)}</div>
          {totalMissing > 0 && <div className="notice warn">Could not place {totalMissing} period(s) (no free common slot, or teacher limit reached):<br />{res.shortfall.map((x) => `${tag(x.class_id, x.subject_id)} (${x.missing} short, ${T.teacher[x.teacher_id]?.name || 'teacher'})`).join('; ')}</div>}
          {res.notes.length > 0 && <div className="notice warn">Note: {res.notes.map((x) => `${tag(x.class_id, x.subject_id)} - ${x.text}`).join('; ')}</div>}
          {!res.applied && <span className="muted">Not saved yet. Check each day below (all classes and all teachers), then press <b>Save this timetable</b> (or <b>Try another arrangement</b>).</span>}
          {msg === 'saved' && <span className="muted">Saved. Open <b>Class timetable</b> to fine-tune any box by hand.</span>}
        </div>)}
      {res && res.slots && (
        <div className="stack">
          <div className="pills scroll">{meta.settings.days.map((x) => <button key={x} className={`pill ${x === pd ? 'on' : ''}`} onClick={() => setPday(x)}>{DAY_LONG[x]}</button>)}</div>
          <div className="card stack" style={{ gap: 8 }}><b>{DAY_LONG[pd]} - all classes</b><DayMatrix meta={meta} T={T} slots={res.slots} day={pd} mode="class" /></div>
          <div className="card stack" style={{ gap: 8 }}><b>{DAY_LONG[pd]} - all teachers</b><DayMatrix meta={meta} T={T} slots={res.slots} day={pd} mode="teacher" /></div>
        </div>)}
    </div>
  );
});

/* ================================================================== 4. TEACHER TIMETABLE */
export const TeacherTimetable = scoped(function TeacherTimetable({ me, sid }) {
  const { meta, T, error } = useMeta(me, sid);
  const [tid, setTid] = useState('');
  const teacherId = tid || meta?.teachers?.[0]?.user_id || '';
  const sl = useApi(teacherId ? `/timetable/slots${qs({ ...sq(me, sid), teacher_id: teacherId })}` : '', !!teacherId, { keepPrevious: true });
  const { data: w } = useApi(`/timetable/workload${qs(sq(me, sid))}`, true, { keepPrevious: true });
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  if (!meta.periods.length) return <NoStructure me={me} />;
  if (!meta.teachers.length) return <Empty>No teachers yet.</Empty>;
  const slots = sl.data || []; const at = Object.fromEntries(slots.map((s) => [keyOf(s), s]));
  const mine = meta.assignments.filter((a) => a.teacher_id === teacherId);
  const stat = w?.teachers.find((x) => x.teacher_id === teacherId);
  const name = T.teacher[teacherId]?.name || '';
  const lab = (s) => `${clsName(T.cls[s.class_id])} - ${T.subject[s.subject_id]?.name}`;
  const print = () => printGrid({ title: `Timetable - ${name}`, sub: `${slots.length} periods a week`, heads: ['', ...meta.settings.days.map((d) => DAY_LONG[d])], rows: meta.periods.map((p) => (p.is_break ? [`${esc(p.name)}<small>${p.start_time} - ${p.end_time}</small>`, { brk: p.name }] : [`${esc(p.name)}<small>${p.start_time} - ${p.end_time}</small>`, ...meta.settings.days.map((d) => { const s = at[`${d}|${p.id}`]; return s ? `<b>${esc(clsName(T.cls[s.class_id]))}</b><small>${esc(T.subject[s.subject_id]?.name)}</small>` : ''; })])) });
  const excel = () => downloadCsv(`timetable-${name.replace(/\s+/g, '-')}.csv`, [['Period', 'Time', ...meta.settings.days.map((d) => DAY_LONG[d])], ...meta.periods.map((p) => [p.name, `${p.start_time}-${p.end_time}`, ...meta.settings.days.map((d) => (p.is_break ? 'Break' : (at[`${d}|${p.id}`] ? lab(at[`${d}|${p.id}`]) : '')))])]);
  return (
    <div className="stack tt">
      <div className="row sp">
        <select style={{ width: 'auto', minWidth: 220 }} value={teacherId} onChange={(e) => setTid(e.target.value)}>{meta.teachers.map((t) => <option key={t.user_id} value={t.user_id}>{t.name}{t.designation ? ` (${t.designation})` : ''}</option>)}</select>
        <div className="row"><button className="btn" onClick={print}><Icon name="file" size={16} />Print</button><button className="btn" onClick={excel}><Icon name="download" size={16} />Excel</button></div>
      </div>
      <div className="tt-stats">
        <Stat n={slots.length} label="Periods in timetable" color="#6366f1" icon="calendar" />
        <Stat n={stat?.assigned ?? 0} label={`Planned (limit ${meta.settings.max_load})`} color="#f97316" icon="bolt" />
        <Stat n={stat?.classes ?? 0} label="Classes" color="#10b981" icon="school" />
        <Stat n={stat?.subjects ?? 0} label="Subjects" color="#ec4899" icon="academics" />
      </div>
      <Grid meta={meta} cell={(d, p) => { const s = at[`${d}|${p.id}`]; return s ? <Chip color={T.color[s.subject_id]} title={clsName(T.cls[s.class_id])} sub={T.subject[s.subject_id]?.name} /> : <span className="tt-dash">free</span>; }} />
      <div className="card stack" style={{ gap: 8 }}>
        <b>Teaches</b>
        {mine.length === 0 ? <span className="muted">Nothing assigned yet. Add classes and subjects in this teacher's profile (Users).</span> : <div className="pills">{mine.map((a) => <span key={a.class_id + a.subject_id} className="tt-tag" style={{ '--c': T.color[a.subject_id] }}>{T.subject[a.subject_id]?.name} - Class {clsName(T.cls[a.class_id])} - {a.periods_per_week}/wk</span>)}</div>}
      </div>
    </div>
  );
});

/* ================================================================== 5. WHOLE SCHOOL (one day, every class) */
export const SchoolTimetable = scoped(function SchoolTimetable({ me, sid }) {
  const { meta, T, error } = useMeta(me, sid);
  const { data: slots } = useApi(`/timetable/slots${qs(sq(me, sid))}`, true, { keepPrevious: true });
  const [day, setDay] = useState(0); const [who, setWho] = useState('class');
  if (error) return <div className="err">{error}</div>;
  if (!meta || !slots) return <Loading />;
  if (!meta.periods.length) return <NoStructure me={me} />;
  const d = day || (meta.settings.days.includes(dowOf(meta.today)) ? dowOf(meta.today) : meta.settings.days[0]);
  const at = new Map(slots.filter((s) => s.day === d).map((s) => [`${s.class_id}|${s.period_id}`, s]));
  const short = (n) => String(n || '').split(' ')[0];
  const print = () => printGrid({ title: `School timetable - ${DAY_LONG[d]}`, sub: '', heads: ['Class', ...meta.periods.map((p) => `${esc(p.name)}<small>${p.start_time}-${p.end_time}</small>`)], rows: meta.classes.map((c) => [esc(clsName(c)), ...meta.periods.map((p) => { if (p.is_break) return '<span style="color:#999">break</span>'; const s = at.get(`${c.id}|${p.id}`); return s ? `<b>${esc(T.subject[s.subject_id]?.name)}</b><small>${esc(short(T.teacher[s.teacher_id]?.name))}</small>` : ''; })]) });
  return (
    <div className="stack tt">
      <div className="row sp"><div className="pills scroll">{meta.settings.days.map((x) => <button key={x} className={`pill ${x === d ? 'on' : ''}`} onClick={() => setDay(x)}>{DAY_LONG[x]}</button>)}</div>
        <div className="row"><div className="pills"><button className={`pill ${who === 'class' ? 'on' : ''}`} onClick={() => setWho('class')}>Classes</button><button className={`pill ${who === 'teacher' ? 'on' : ''}`} onClick={() => setWho('teacher')}>Teachers</button></div>
        <button className="btn" onClick={print}><Icon name="file" size={16} />Print</button></div></div>
      <DayMatrix meta={meta} T={T} slots={slots} day={d} mode={who} />
    </div>
  );
});

/* ================================================================== 6. SUBSTITUTIONS */
export const Substitutions = scoped(function Substitutions({ me, sid }) {
  const { meta, T, error } = useMeta(me, sid);
  const [date, setDate] = useState(''); const [tid, setTid] = useState(''); const [pick, setPick] = useState({});
  const when = date || meta?.today || '';
  const plan = useApi(tid && when ? `/timetable/substitutions/plan${qs({ ...sq(me, sid), date: when, teacher_id: tid })}` : '', !!(tid && when), { keepPrevious: true });
  const week = useApi(meta ? `/timetable/substitutions${qs({ ...sq(me, sid), from: meta.today })}` : '', !!meta, { keepPrevious: true });
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  if (!meta.periods.length) return <NoStructure me={me} />;
  const refreshAll = () => { plan.refresh(); week.refresh(); };
  const assign = async (p) => {
    const k = `${p.class_id}|${p.period_id}`; const who = pick[k] || p.candidates[0]?.teacher_id;
    if (!who) { toast('Choose a teacher', true); return; }
    try { await api.post(`/timetable/substitutions${qs(sq(me, sid))}`, { date: when, class_id: p.class_id, period_id: p.period_id, substitute_teacher_id: who }); toast('Substitute assigned'); refreshAll(); }
    catch (x) { toast(x.message, true); }
  };
  const remove = async (id) => { try { await api.del(`/timetable/substitutions/${id}${qs(sq(me, sid))}`); toast('Substitution removed'); refreshAll(); } catch (x) { toast(x.message, true); } };
  const per = Object.fromEntries(meta.periods.map((p) => [p.id, p]));
  const data = plan.data;
  return (
    <div className="stack tt" style={{ maxWidth: 900 }}>
      {can(me, 'manage_substitutions') && (
        <div className="card stack">
          <b>Teacher absent?</b>
          <div className="row">
            <input type="date" style={{ width: 'auto' }} value={when} onChange={(e) => setDate(e.target.value)} />
            <select style={{ flex: '1 1 220px' }} value={tid} onChange={(e) => setTid(e.target.value)}><option value="">Choose the absent teacher</option>{meta.teachers.map((t) => <option key={t.user_id} value={t.user_id}>{t.name}</option>)}</select>
          </div>
          {tid && data && data.school_day === false && <Hint>{DAY_LONG[data.day]} is not a school day.</Hint>}
          {tid && data && data.absent_on_leave && <Hint>This teacher has approved leave on this date.</Hint>}
          {tid && data && data.school_day && data.periods.length === 0 && <Empty>{T.teacher[tid]?.name} has no classes on {fmtDate(when)}.</Empty>}
          {tid && data && data.periods.map((p) => {
            const k = `${p.class_id}|${p.period_id}`; const per1 = per[p.period_id]; const col = T.color[p.subject_id];
            return (
              <div key={k} className="tt-sub" style={{ '--c': col }}>
                <div className="tt-sub-h"><span className="tt-dot" /><b>{per1?.name}</b><span className="muted">{per1?.start_time} - {per1?.end_time}</span><Badge>Class {clsName(T.cls[p.class_id])}</Badge><Badge tone="info">{T.subject[p.subject_id]?.name}</Badge></div>
                {p.substitution ? (
                  <div className="row sp"><span>Covered by <b>{T.teacher[p.substitution.substitute_teacher_id]?.name}</b></span><button className="btn danger" onClick={() => remove(p.substitution.id)}>Remove</button></div>
                ) : p.candidates.length === 0 ? <span className="muted">Nobody is free in this period.</span> : (
                  <div className="row">
                    <select style={{ flex: '1 1 220px' }} value={pick[k] || p.candidates[0].teacher_id} onChange={(e) => setPick({ ...pick, [k]: e.target.value })}>
                      {p.candidates.map((c) => <option key={c.teacher_id} value={c.teacher_id}>{c.same_subject ? '⭐ ' : ''}{T.teacher[c.teacher_id]?.name} {c.same_subject ? '(teaches this subject)' : c.same_class ? '(knows this class)' : ''} - {c.load_today} today</option>)}
                    </select>
                    <button className="btn primary" onClick={() => assign(p)}><Icon name="userplus" size={16} />Assign</button>
                  </div>)}
              </div>);
          })}
        </div>)}
      <div className="card stack" style={{ gap: 8 }}>
        <b>Upcoming substitutions</b>
        {!week.data ? <Loading rows={2} /> : week.data.length === 0 ? <span className="muted">None in the next 7 days.</span> : week.data.map((s) => (
          <div key={s.id} className="tt-subrow" style={{ '--c': T.color[s.subject_id] || '#6366f1' }}>
            <span className="tt-dot" /><b>{fmtDate(s.sub_date)}</b><span>{per[s.period_id]?.name}</span><Badge>Class {clsName(T.cls[s.class_id])}</Badge>
            <span className="muted" style={{ flex: 1 }}>{T.teacher[s.absent_teacher_id]?.name || 'Teacher'} {'->'} <b style={{ color: 'var(--ink)' }}>{T.teacher[s.substitute_teacher_id]?.name}</b></span>
            {can(me, 'manage_substitutions') && <button className="icon-btn" aria-label="Remove substitution" onClick={() => remove(s.id)}><Icon name="trash" size={16} /></button>}
          </div>))}
      </div>
    </div>
  );
});

/* ================================================================== 7. MY TIMETABLE (teacher: own, student / parent: the class) */
export function MyTimetable({ me }) {
  const { data: m, error } = useApi('/timetable/my', true, { keepPrevious: true });
  const [kid, setKid] = useState('');
  const T = useMemo(() => (m ? {
    cls: Object.fromEntries(m.classes.map((c) => [c.id, c])), subject: Object.fromEntries(m.subjects.map((s) => [s.id, s])), color: Object.fromEntries(m.subjects.map((s, i) => [s.id, PALETTE[i % PALETTE.length]])),
    teacher: Object.fromEntries((m.teachers || []).map((t) => [t.user_id, t])), period: Object.fromEntries(m.periods.map((p) => [p.id, p])),
  } : null), [m]);
  if (error) return <div className="err">{error}</div>;
  if (!m) return <Loading />;
  if (m.kind === 'none') return <Empty>Timetables belong to a school.</Empty>;
  if (!m.periods.length) return <Empty>The timetable has not been set up yet.</Empty>;
  const meta = { periods: m.periods, settings: m.settings };

  if (m.kind === 'class') {
    const kids = m.children || [];
    const k = kids.find((x) => x.user_id === kid) || kids[0];
    if (!k || !k.class_id) return <Empty>No class found.</Empty>;
    const slots = m.slots.filter((s) => s.class_id === k.class_id); const at = Object.fromEntries(slots.map((s) => [keyOf(s), s]));
    const today = m.subs.filter((s) => s.class_id === k.class_id && s.sub_date === m.today);
    return (
      <div className="stack tt">
        {kids.length > 1 && <div className="pills">{kids.map((x) => <button key={x.user_id} className={`pill ${x.user_id === k.user_id ? 'on' : ''}`} onClick={() => setKid(x.user_id)}>{x.name}</button>)}</div>}
        <div className="tt-banner"><b>Class {clsName(T.cls[k.class_id])}</b><span>{k.name}'s weekly timetable</span></div>
        {today.length > 0 && <div className="notice warn">Today: {today.map((s) => `${T.period[s.period_id]?.name} is taken by ${T.teacher[s.substitute_teacher_id]?.name}`).join('; ')}.</div>}
        {slots.length === 0 ? <Empty>The timetable for this class is not ready yet.</Empty> : (
          <Grid meta={meta} todayDay={m.day} cell={(d, p) => { const s = at[`${d}|${p.id}`]; return s ? <Chip color={T.color[s.subject_id]} title={T.subject[s.subject_id]?.name} sub={T.teacher[s.teacher_id]?.name} /> : <span className="tt-dash">-</span>; }} />)}
      </div>
    );
  }

  const at = Object.fromEntries(m.slots.map((s) => [keyOf(s), s]));
  const todays = m.slots.filter((s) => s.day === m.day).length + m.duties.filter((s) => s.sub_date === m.today).length;
  const planned = (m.assignments || []).reduce((n, a) => n + a.periods_per_week, 0);
  return (
    <div className="stack tt">
      <div className="tt-stats">
        <Stat n={m.slots.length} label="Periods a week" color="#6366f1" icon="calendar" />
        <Stat n={todays} label="Periods today" color="#f97316" icon="bolt" />
        <Stat n={`${planned}/${m.max_load}`} label="Workload (planned / limit)" color="#10b981" icon="check" />
      </div>
      {m.duties.length > 0 && (
        <div className="card stack" style={{ gap: 8 }}><b>Your cover duties</b>
          {m.duties.map((s) => <div key={s.id} className="tt-subrow" style={{ '--c': T.color[s.subject_id] || '#8b5cf6' }}><span className="tt-dot" /><b>{fmtDate(s.sub_date)}</b><span>{T.period[s.period_id]?.name} ({T.period[s.period_id]?.start_time})</span><Badge>Class {clsName(T.cls[s.class_id])}</Badge><span className="muted">{T.subject[s.subject_id]?.name}</span></div>)}
        </div>)}
      {m.covered.length > 0 && <div className="notice ok">Your classes are covered: {m.covered.map((s) => `${fmtDate(s.sub_date)} ${T.period[s.period_id]?.name} (${T.teacher[s.substitute_teacher_id]?.name})`).join('; ')}.</div>}
      {m.slots.length === 0 ? <Empty>No periods in your timetable yet.</Empty> : (
        <Grid meta={meta} todayDay={m.day} cell={(d, p) => { const s = at[`${d}|${p.id}`]; return s ? <Chip color={T.color[s.subject_id]} title={`Class ${clsName(T.cls[s.class_id])}`} sub={T.subject[s.subject_id]?.name} /> : <span className="tt-dash">free</span>; }} />)}
    </div>
  );
}

/* ================================================================== TEACHING (lives in the teacher's profile and in "Add user") */
// rows: [{class_id, subject_id, periods_per_week}]. Pure editor, the parent decides when to save.
export function TeachingEditor({ me, sid, rows, onChange }) {
  const { data: meta, error } = useApi(`/timetable/meta${qs(sq(me, sid))}`, !!(sid || me.role !== 'super_admin'), { keepPrevious: true });
  const [subject, setSubject] = useState(''); const [ppw, setPpw] = useState(5); const [picked, setPicked] = useState([]);
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading rows={2} />;
  const color = Object.fromEntries(meta.subjects.map((s, i) => [s.id, PALETTE[i % PALETTE.length]]));
  const subj = Object.fromEntries(meta.subjects.map((s) => [s.id, s])); const cls = Object.fromEntries(meta.classes.map((c) => [c.id, c]));
  const has = (c, s) => rows.some((r) => r.class_id === c && r.subject_id === s);
  // a class that has a subject list only accepts those subjects (set under Timetable > Class subjects)
  const studies = (c, s) => { const l = meta.class_subjects?.[c]; return !l?.length || !s || l.includes(s); };
  const addMany = () => {
    if (!subject || !picked.length) { toast('Choose a subject and at least one class', true); return; }
    const n = 5; // placeholder only - the real number comes from Timetable > Structure
    onChange([...rows, ...picked.filter((c) => !has(c, subject)).map((c) => ({ class_id: c, subject_id: subject, periods_per_week: n }))]);
    setPicked([]);
  };
  const total = rows.reduce((n, r) => n + (Number(meta.class_periods?.[r.class_id]?.[r.subject_id] ?? r.periods_per_week) || 0), 0);
  const over = total > meta.settings.max_load;
  const sorted = [...rows].map((r, i) => ({ ...r, i })).sort((a, b) => (subj[a.subject_id]?.name || '').localeCompare(subj[b.subject_id]?.name || '') || clsName(cls[a.class_id]).localeCompare(clsName(cls[b.class_id]), undefined, { numeric: true }));
  if (!meta.subjects.length || !meta.classes.length) return <Hint>Add subjects (Exams & Report Cards, Subjects) and classes (Users, Classes) first, then come back here.</Hint>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="tt-add">
        <div className="row">
          <select style={{ flex: '1 1 180px' }} value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">Subject...</option>{meta.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
        <div className="pills">{meta.classes.map((c) => <button type="button" key={c.id} disabled={!!subject && (has(c.id, subject) || !studies(c.id, subject))} title={subject && !studies(c.id, subject) ? 'This class does not study this subject. Add it under Timetable > Class subjects.' : ''} className={`pill ${picked.includes(c.id) ? 'on' : ''}`} onClick={() => setPicked(picked.includes(c.id) ? picked.filter((x) => x !== c.id) : [...picked, c.id])}>{clsName(c)}</button>)}</div>
        <button type="button" className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={addMany}><Icon name="plus" size={16} />Add {picked.length > 1 ? `${picked.length} classes` : 'class'}</button>
      </div>
      {rows.length === 0 ? <span className="muted">Not teaching any class yet. Pick a subject, tick the classes, tap Add (periods per week are set by the admin in Timetable > Structure). Greyed-out classes do not study that subject.</span> : (
        <div className="tt-trows">{sorted.map((r) => (
          <div key={r.i} className="tt-trow" style={{ '--c': color[r.subject_id] }}>
            <span className="tt-dot" /><b style={{ flex: 1, minWidth: 0 }}>{subj[r.subject_id]?.name}<small>Class {clsName(cls[r.class_id])}</small></b>
            {r.scheduled > 0 && <small className="muted">{r.scheduled} placed</small>}
            <small className="muted">{meta.class_periods?.[r.class_id]?.[r.subject_id] ?? '?'} /wk</small>
            <button type="button" className="icon-btn" aria-label="Remove" onClick={() => onChange(rows.filter((_, n) => n !== r.i))}><Icon name="x" size={16} /></button>
          </div>))}</div>)}
      <div className={`tt-total ${over ? 'over' : ''}`}>Total workload: <b>{total}</b> periods a week (limit {meta.settings.max_load}){over ? ' - over the limit' : ''}</div>
    </div>
  );
}

// the card inside an existing teacher's profile
export function TeachingCard({ me, user }) {
  const sid = user.school_id;
  const url = `/timetable/teachers/${user.user_id}/assignments${qs(sq(me, sid))}`;
  const [rows, setRows] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const editable = can(me, 'edit_user', 'manage_timetable');
  useEffect(() => { api.get(url).then((r) => setRows(r)).catch((x) => { setErr(x.message); setRows([]); }); }, [url]);
  const save = async () => {
    setBusy(true); setErr('');
    try { const r = await api.put(url, { items: rows.map(({ class_id, subject_id, periods_per_week }) => ({ class_id, subject_id, periods_per_week: Number(periods_per_week) })) }); toast(r.removed_periods ? `Saved. ${r.removed_periods} timetable period(s) removed` : 'Teaching details saved'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="card stack tt-prof">
      <div className="row sp"><b>Teaching: classes & subjects</b><Badge tone="info">Timetable</Badge></div>
      <small className="muted">Choose what this teacher teaches (class + subject). Only these can be put in the class timetable for them, and used for tests and reports.</small>
      {rows !== null && rows.length === 0 && editable && <div className="notice warn">No class + subject given yet. Teaching staff need at least one.</div>}
      {rows === null ? <Loading rows={2} /> : editable ? <TeachingEditor me={me} sid={sid} rows={rows} onChange={setRows} /> : <span className="muted">You can't edit this.</span>}
      <Err error={err} />
      {rows !== null && editable && <button type="button" className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save teaching details'}</button>}
    </div>
  );
}

// saves the list after a new user is created
export const saveTeaching = (me, sid, userId, rows) => api.put(`/timetable/teachers/${userId}/assignments${qs(sq(me, sid))}`, { items: rows.map(({ class_id, subject_id, periods_per_week }) => ({ class_id, subject_id, periods_per_week: Number(periods_per_week) })) });
