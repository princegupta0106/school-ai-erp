// Visitors module for mobile. PILOT of the design standard. Mirrors client/src/modules/VisitorsModule.jsx (same endpoints and rules).
// Anatomy: Pad > PageHeader > FilterBar > List > Row.  Create = FormSheet.  Delete = confirmAsk().
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { api } from '../api';
import { C, T } from '../theme';
import { Icon } from '../icons';
import { Dim, Loading, ErrorBox, Btn, Field, Input, DateField, toast, confirmAsk } from '../ui';
import { FilterBar } from '../FilterBar';
import { useApi } from '../useApi';
import { scoped, qs, Pad, Notice, List, Row, PageHeader, StatusChip, EmptyState, FormSheet, TimeField, fdate, clock12 } from '../kit';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = (s) => { const d = new Date(`${s}T00:00:00`); return `${DAY[d.getDay()]}, ${fdate(s)}`; };

/* One form for the list and for the stand-alone Add view. Keeps the school's own clock so the default date / time is right. */
function AddVisitorSheet({ sc, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', purpose: '', date: '', time: '' });
  const [clock, setClock] = useState(null); // the school's current date / time
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const loadClock = useCallback(() => api.get(`/visitors${qs(sc)}`).then((d) => { setClock({ date: d.today, time: d.now }); return d; }).catch(() => null), [sc]);
  useEffect(() => { loadClock().then((d) => d && setF((x) => ({ ...x, date: d.today, time: d.now }))); }, [loadClock]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try { const v = await api.post('/visitors', { ...f, ...sc }); toast('Visitor added'); onSaved(v); } catch (x) { setErr(x.message); setBusy(false); }
  };
  const off = clock && (f.date !== clock.date || f.time !== clock.time);
  return (
    <FormSheet title="Add visitor" onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Add visitor">
      <Field req label="Visitor name"><Input autoFocus maxLength={120} value={f.name} onChangeText={set('name')} placeholder="Name" /></Field>
      <Field label="Purpose (optional)"><Input maxLength={300} value={f.purpose} onChangeText={set('purpose')} placeholder="e.g. Meet principal, parent, delivery" /></Field>
      <Field req label="Date">{f.date ? <DateField value={f.date} onChange={set('date')} /> : <Dim>Loading...</Dim>}</Field>
      <Field req label="Time">{f.time ? <TimeField value={f.time} onChange={set('time')} /> : <Dim>Loading...</Dim>}</Field>
      {off && <View style={{ alignSelf: 'flex-start' }}><Btn small kind="ghost" title="Use current date & time" onPress={() => setF({ ...f, date: clock.date, time: clock.time })} /></View>}
    </FormSheet>
  );
}

/* ================================================================== ADD VISITOR (stand-alone view for gate staff) */
export const AddVisitor = scoped(function AddVisitor({ me, sc, go }) {
  const [open, setOpen] = useState(false); const [last, setLast] = useState(null);
  const canView = me.features.includes('view_visitors');
  return (
    <Pad>
      <PageHeader title="Add visitor" sub="Log who is visiting, with date and time" right={<Btn small title="Add visitor" onPress={() => setOpen(true)} />} />
      {last && <Notice tone="ok">{last.name} added for {fmtDate(last.visit_date)} at {clock12(last.visit_time)}.{canView ? ' ' : ''}{canView && <Text style={{ fontWeight: T.fw.bold, textDecorationLine: 'underline' }} onPress={() => go?.('list')}>See visitors</Text>}</Notice>}
      <List><EmptyState icon="users" title="Log a visitor">Tap Add visitor each time someone arrives. The school's current date and time are filled in for you.</EmptyState></List>
      {open && <AddVisitorSheet sc={sc} onClose={() => setOpen(false)} onSaved={(v) => { setLast(v); setOpen(false); }} />}
    </Pad>
  );
});

/* ================================================================== VISITOR LIST */
export const VisitorList = scoped(function VisitorList({ me, sc }) {
  const [date, setDate] = useState(''); const [q, setQ] = useState(''); const [vsort, setVsort] = useState('old');
  const [adding, setAdding] = useState(false);
  const { data: d, error, loading, reload } = useApi(`/visitors${qs({ ...sc, date })}`);
  const canAdd = me.features.includes('add_visitor');
  const canDel = me.features.includes('delete_visitor');
  const rows = useMemo(() => (d?.visitors || []).filter((v) => !q || `${v.name} ${v.purpose || ''}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (vsort === 'new' ? -1 : 1) * String(a.visit_time).localeCompare(String(b.visit_time))), [d, q, vsort]);
  const del = (v) => confirmAsk(`Delete the entry for ${v.name}?`, async () => { try { await api.del(`/visitors/${v.id}${qs(sc)}`); toast('Entry deleted'); reload(); } catch (x) { toast(x.message, true); } });

  if (error && !d) return <Pad><ErrorBox>{error}</ErrorBox><Btn small kind="ghost" title="Retry" onPress={reload} /></Pad>;
  if (!d) return <Pad><Loading /></Pad>;
  const isToday = d.date === d.today;
  const n = d.visitors.length;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <PageHeader title={isToday ? 'Today' : fmtDate(d.date)} sub={`${isToday ? `${fmtDate(d.today)} · ` : ''}${n} visitor${n === 1 ? '' : 's'}`} right={canAdd ? <Btn small title="Add visitor" onPress={() => setAdding(true)} /> : null} />
      <FilterBar inline q={q} onQ={setQ} placeholder="Search name or purpose" count={rows.length}
        filters={[{ key: 'date', label: 'Date', type: 'date', value: date, onChange: (v) => setDate(v === d.today ? '' : v), chip: (v) => `Date: ${fmtDate(v)}` }]}
        sort={{ value: vsort, onChange: setVsort, def: 'old', options: [{ value: 'old', label: 'Earliest first' }, { value: 'new', label: 'Latest first' }] }} />
      <List>
        {rows.length === 0
          ? <EmptyState icon="users" title={n ? 'No match' : `No visitors ${isToday ? 'yet today' : 'on this day'}`}>{n ? 'Try a different search.' : canAdd ? 'Add the first one with the button above.' : ''}</EmptyState>
          : rows.map((v, i) => (
            <Row key={v.id} last={i === rows.length - 1}>
              <StatusChip tone="info">{clock12(v.visit_time)}</StatusChip>
              <View style={{ flex: 1 }}><Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }}>{v.name}</Text><Dim>{v.purpose || 'No purpose given'}</Dim></View>
              {canDel && <Pressable hitSlop={8} accessibilityLabel={`Delete entry for ${v.name}`} onPress={() => del(v)} style={{ width: T.ctl, height: T.ctl, alignItems: 'center', justifyContent: 'center' }}><Icon name="trash" size={19} color={C.bad} /></Pressable>}
            </Row>))}
      </List>
      {adding && <AddVisitorSheet sc={sc} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </Pad>
  );
});
