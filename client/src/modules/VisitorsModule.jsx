// Visitors (web). PILOT of the design standard: Page > PageBar > FilterBar > Section > List, create = FormDialog, delete = ask().
// Mirrors mobile/src/screens/Visitors.js (same endpoints, same rules).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Field, toast, Loading, ask, Page, PageBar, Button, Section, List, ListRow, StatusBadge, EmptyState, FormDialog, FormGrid, Notice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
import { scoped } from './AttendanceModule.jsx';

const sq = (me, sid) => (me.role === 'super_admin' ? { school_id: sid } : {});
const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

/* One form, used by the list (dialog) and by the stand-alone Add view. Keeps the school's own clock so the default date/time is right. */
function AddVisitorDialog({ me, sid, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', purpose: '', date: '', time: '' });
  const [clock, setClock] = useState(null); // the school's current date / time
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const loadClock = useCallback(() => api.get(`/visitors?${new URLSearchParams({ ...sq(me, sid) })}`).then((d) => { setClock({ date: d.today, time: d.now }); return d; }).catch(() => null), [me, sid]);
  useEffect(() => { loadClock().then((d) => d && setF((x) => ({ ...x, date: d.today, time: d.now }))); }, [loadClock]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setBusy(true); setErr('');
    try { const v = await api.post('/visitors', { ...f, ...sq(me, sid) }); toast('Visitor added'); onSaved(v); } catch (x) { setErr(x.message); setBusy(false); }
  };
  const off = clock && (f.date !== clock.date || f.time !== clock.time);
  return (
    <FormDialog title="Add visitor" onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Add visitor">
      <FormGrid>
        <Field full req label="Visitor name"><input autoFocus required maxLength={120} value={f.name} onChange={set('name')} placeholder="Name" /></Field>
        <Field full label="Purpose (optional)"><input maxLength={300} value={f.purpose} onChange={set('purpose')} placeholder="e.g. Meet principal, parent, delivery" /></Field>
        <Field req label="Date"><input type="date" required value={f.date} onChange={set('date')} /></Field>
        <Field req label="Time"><input type="time" required value={f.time} onChange={set('time')} /></Field>
        {off && <div className="ds-full"><Button kind="ghost" size="sm" onClick={() => setF({ ...f, date: clock.date, time: clock.time })}>Use current date &amp; time</Button></div>}
      </FormGrid>
    </FormDialog>
  );
}

/* Stand-alone "Add visitor" view (for gate staff who may add but not view the list). Same dialog, same rules. */
export const AddVisitor = scoped(function AddVisitor({ me, sid, go }) {
  const [open, setOpen] = useState(false); const [last, setLast] = useState(null);
  const canView = me.features.includes('view_visitors');
  return (
    <Page narrow>
      <PageBar title="Add visitor" sub="Log who is visiting, with date and time"><Button kind="primary" icon="plus" onClick={() => setOpen(true)}>Add visitor</Button></PageBar>
      {last && <Notice tone="ok" action={canView ? <Button kind="ghost" size="sm" onClick={() => go('list')}>See visitors</Button> : null}><b>{last.name}</b> added for {fmtDate(last.visit_date)} at {fmtTime(last.visit_time)}.</Notice>}
      <Section><EmptyState icon="users" title="Log a visitor">Tap Add visitor each time someone arrives. The school's current date and time are filled in for you.</EmptyState></Section>
      {open && <AddVisitorDialog me={me} sid={sid} onClose={() => setOpen(false)} onSaved={(v) => { setLast(v); setOpen(false); }} />}
    </Page>
  );
});

export const VisitorList = scoped(function VisitorList({ me, sid }) {
  const [date, setDate] = useState('');
  const [q, setQ] = useState(''); const [vsort, setVsort] = useState('old');
  const [adding, setAdding] = useState(false);
  const { data: d, error: err, refresh: reload } = useApi(`/visitors?${new URLSearchParams({ ...sq(me, sid), ...(date ? { date } : {}) })}`, true, { keepPrevious: true });
  const canAdd = me.features.includes('add_visitor');
  const canDel = me.features.includes('delete_visitor');
  const rows = useMemo(() => (d?.visitors || [])
    .filter((v) => !q || `${v.name} ${v.purpose || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (vsort === 'new' ? -1 : 1) * String(a.visit_time).localeCompare(String(b.visit_time))), [d, q, vsort]);
  const del = async (v) => { if (!(await ask(`Delete the entry for ${v.name}?`))) return; try { await api.del(`/visitors/${v.id}?${new URLSearchParams(sq(me, sid))}`); toast('Entry deleted'); reload(); } catch (x) { toast(x.message, true); } };

  if (err && !d) return <Page><Notice tone="bad" action={<Button size="sm" onClick={reload}>Retry</Button>}>{err}</Notice></Page>;
  if (!d) return <Loading />;
  const isToday = d.date === d.today;
  const n = d.visitors.length;
  return (
    <Page>
      <PageBar title={isToday ? 'Today' : fmtDate(d.date)} sub={`${isToday ? `${fmtDate(d.today)} - ` : ''}${n} visitor${n === 1 ? '' : 's'}`}>
        {canAdd && <Button kind="primary" icon="plus" onClick={() => setAdding(true)}>Add visitor</Button>}
      </PageBar>
      <FilterBar q={q} onQ={setQ} placeholder="Search name or purpose" count={rows.length}
        filters={[{ key: 'date', label: 'Date', type: 'date', value: date, onChange: (v) => setDate(v === d.today ? '' : v), chip: (v) => `Date: ${fmtDate(v)}` }]}
        sort={{ value: vsort, onChange: setVsort, def: 'old', options: [{ value: 'old', label: 'Earliest first' }, { value: 'new', label: 'Latest first' }] }} />
      <Section flush>
        {rows.length === 0
          ? <EmptyState icon="users" title={n ? 'No match' : `No visitors ${isToday ? 'yet today' : 'on this day'}`}>{n ? 'Try a different search.' : canAdd ? 'Add the first one with the button above.' : ''}</EmptyState>
          : <List>{rows.map((v) => (
            <ListRow key={v.id} lead={<StatusBadge tone="info" dot={false}>{fmtTime(v.visit_time)}</StatusBadge>} title={v.name} sub={v.purpose || 'No purpose given'}>
              {canDel && <Button kind="ghost" size="sm" icon="trash" aria-label={`Delete entry for ${v.name}`} onClick={() => del(v)} />}
            </ListRow>))}</List>}
      </Section>
      {adding && <AddVisitorDialog me={me} sid={sid} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </Page>
  );
});
