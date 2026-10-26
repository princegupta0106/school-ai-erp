import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Empty, Field, toast, Loading } from '../ui.jsx';
import { scoped } from './AttendanceModule.jsx';

const sq = (me, sid) => (me.role === 'super_admin' ? { school_id: sid } : {});
const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

export const AddVisitor = scoped(function AddVisitor({ me, sid, go }) {
  const [f, setF] = useState({ name: '', purpose: '', date: '', time: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  const [clock, setClock] = useState(null); // school's current date/time
  const loadClock = useCallback(() => api.get(`/visitors?${new URLSearchParams({ ...sq(me, sid) })}`).then((d) => { setClock({ date: d.today, time: d.now }); return d; }).catch(() => null), [me, sid]);
  useEffect(() => { loadClock().then((d) => d && setF((x) => ({ ...x, date: d.today, time: d.now }))); }, [loadClock]);

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const v = await api.post('/visitors', { ...f, ...sq(me, sid) });
      setLast(v); toast('Visitor added');
      const d = await loadClock();
      setF({ name: '', purpose: '', date: d?.today || f.date, time: d?.now || f.time });
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <form className="card form" onSubmit={save}>
        <div className="full"><Field label="Visitor name" req><input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" /></Field></div>
        <div className="full"><Field label="Purpose (optional)"><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. Meet principal, parent, delivery" /></Field></div>
        <Field label="Date" req><input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Time" req><input type="time" required value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        {clock && (f.date !== clock.date || f.time !== clock.time) && <div className="full"><button type="button" className="linkbtn" onClick={() => setF({ ...f, date: clock.date, time: clock.time })}>Use current date &amp; time</button></div>}
        {err && <div className="err full">{err}</div>}
        <button className="btn primary full big" disabled={busy || !f.name.trim()} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : 'Add visitor'}</button>
      </form>
      {last && <div className="notice ok"><b>{last.name}</b> added for {fmtDate(last.visit_date)} at {fmtTime(last.visit_time)}.{me.features.includes('view_visitors') && <> <button className="linkbtn" onClick={() => go('list')}>See visitors</button></>}</div>}
    </div>
  );
});

export const VisitorList = scoped(function VisitorList({ me, sid }) {
  const [date, setDate] = useState('');
  const [q, setQ] = useState('');
  const { data: d, error: err, refresh: reload } = useApi(`/visitors?${new URLSearchParams({ ...sq(me, sid), ...(date ? { date } : {}) })}`, true, { keepPrevious: true });
  const canDel = me.features.includes('delete_visitor');
  const rows = useMemo(() => (d?.visitors || []).filter((v) => !q || `${v.name} ${v.purpose || ''}`.toLowerCase().includes(q.toLowerCase())), [d, q]);
  const del = async (v) => { if (!confirm(`Delete the entry for ${v.name}?`)) return; try { await api.del(`/visitors/${v.id}?${new URLSearchParams(sq(me, sid))}`); toast('Entry deleted'); reload(); } catch (x) { toast(x.message, true); } };

  if (err) return <div className="err">{err}</div>;
  if (!d) return <Loading />;
  const isToday = d.date === d.today;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="card row sp">
        <div><b style={{ fontSize: 17 }}>{isToday ? 'Today' : fmtDate(d.date)}</b><div className="muted" style={{ fontSize: 14 }}>{isToday ? `${fmtDate(d.today)} - ` : ''}{d.visitors.length} visitor{d.visitors.length === 1 ? '' : 's'}</div></div>
        <div className="row">
          {!isToday && <button className="btn" onClick={() => setDate('')}>Today</button>}
          <input type="date" aria-label="Date" style={{ width: 'auto' }} value={d.date} onChange={(e) => e.target.value && setDate(e.target.value === d.today ? '' : e.target.value)} />
        </div>
      </div>
      {d.visitors.length > 4 && <div style={{ position: 'relative' }}><input placeholder="Search name or purpose" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} /><span style={{ position: 'absolute', left: 11, top: 10, color: 'var(--mute)' }}><Icon name="search" size={18} /></span></div>}
      {rows.length === 0 ? <Empty>{d.visitors.length ? 'No match.' : `No visitors ${isToday ? 'yet today' : 'on this day'}.`}</Empty> : (
        <div className="card" style={{ padding: 0 }}>{rows.map((v) => (
          <div key={v.id} className="drow" style={{ cursor: 'default' }}>
            <span className="vtime">{fmtTime(v.visit_time)}</span>
            <div style={{ flex: 1, minWidth: 0 }}><b>{v.name}</b><small>{v.purpose || 'No purpose given'}</small></div>
            {canDel && <button className="icon-btn" aria-label="Delete entry" onClick={() => del(v)}><Icon name="trash" /></button>}
          </div>))}</div>)}
    </div>
  );
});
