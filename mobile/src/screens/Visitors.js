// Visitors module for mobile. Mirrors client/src/modules/VisitorsModule.jsx (same endpoints and rules).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { api } from '../api';
import { C } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Field, Input, DateField, toast, confirmAsk } from '../ui';
import { useApi } from '../useApi';
import { scoped, qs, Pad, Notice, List } from './Attendance';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s) => { const d = new Date(`${s}T00:00:00`); return `${DAY[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

// value / onChange use "HH:MM" (24 hour)
function TimeField({ value, onChange }) {
  const [show, setShow] = useState(false);
  const [h, m] = (value || '00:00').split(':').map(Number);
  const d = new Date(); d.setHours(h || 0, m || 0, 0, 0);
  const change = (_, picked) => { if (Platform.OS === 'android') setShow(false); if (picked) onChange(`${String(picked.getHours()).padStart(2, '0')}:${String(picked.getMinutes()).padStart(2, '0')}`); };
  if (Platform.OS === 'ios') return <View style={{ alignItems: 'flex-start' }}><DateTimePicker value={d} mode="time" display="compact" onChange={change} /></View>;
  return (
    <>
      <Pressable onPress={() => setShow(true)} style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}><Text style={{ color: C.ink, fontSize: 15 }}>{value ? fmtTime(value) : 'Pick a time'}</Text></Pressable>
      {show && <DateTimePicker value={d} mode="time" onChange={change} />}
    </>
  );
}

/* ================================================================== ADD VISITOR */
export const AddVisitor = scoped(function AddVisitor({ me, sc, go }) {
  const [f, setF] = useState({ name: '', purpose: '', date: '', time: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  const [clock, setClock] = useState(null); // the school's current date / time
  const loadClock = useCallback(() => api.get(`/visitors${qs(sc)}`).then((d) => { setClock({ date: d.today, time: d.now }); return d; }).catch(() => null), [sc]);
  useEffect(() => { loadClock().then((d) => d && setF((x) => ({ ...x, date: d.today, time: d.now }))); }, [loadClock]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const v = await api.post('/visitors', { ...f, ...sc });
      setLast(v); toast('Visitor added');
      const d = await loadClock();
      setF({ name: '', purpose: '', date: d?.today || f.date, time: d?.now || f.time });
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Pad>
      <Card>
        <Field label="Visitor name"><Input maxLength={120} value={f.name} onChangeText={set('name')} placeholder="Name" /></Field>
        <Field label="Purpose (optional)"><Input maxLength={300} value={f.purpose} onChangeText={set('purpose')} placeholder="e.g. Meet principal, parent, delivery" /></Field>
        <Field label="Date">{f.date ? <DateField value={f.date} onChange={set('date')} /> : <Dim>Loading...</Dim>}</Field>
        <Field label="Time">{f.time ? <TimeField value={f.time} onChange={set('time')} /> : <Dim>Loading...</Dim>}</Field>
        {clock && (f.date !== clock.date || f.time !== clock.time) && <View style={{ alignSelf: 'flex-start', marginBottom: 12 }}><Btn small kind="ghost" title="Use current date & time" onPress={() => setF({ ...f, date: clock.date, time: clock.time })} /></View>}
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Saving...' : 'Add visitor'} onPress={save} disabled={busy || !f.name.trim() || !f.date || !f.time} />
      </Card>
      {last && <Notice tone="ok">{last.name} added for {fmtDate(last.visit_date)} at {fmtTime(last.visit_time)}.{me.features.includes('view_visitors') ? ' ' : ''}{me.features.includes('view_visitors') && <Text style={{ fontWeight: '700', textDecorationLine: 'underline' }} onPress={() => go?.('list')}>See visitors</Text>}</Notice>}
    </Pad>
  );
});

/* ================================================================== VISITOR LIST */
export const VisitorList = scoped(function VisitorList({ me, sc }) {
  const [date, setDate] = useState(''); const [q, setQ] = useState('');
  const { data: d, error, loading, reload } = useApi(`/visitors${qs({ ...sc, date })}`);
  const canDel = me.features.includes('delete_visitor');
  const rows = useMemo(() => (d?.visitors || []).filter((v) => !q || `${v.name} ${v.purpose || ''}`.toLowerCase().includes(q.toLowerCase())), [d, q]);
  const del = (v) => confirmAsk(`Delete the entry for ${v.name}?`, async () => { try { await api.del(`/visitors/${v.id}${qs(sc)}`); toast('Entry deleted'); reload(); } catch (x) { toast(x.message, true); } });

  if (error && !d) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!d) return <Pad><Loading /></Pad>;
  const isToday = d.date === d.today;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>{isToday ? 'Today' : fmtDate(d.date)}</Text>
        <Dim style={{ marginBottom: 10 }}>{isToday ? `${fmtDate(d.today)} · ` : ''}{d.visitors.length} visitor{d.visitors.length === 1 ? '' : 's'}</Dim>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <DateField value={d.date} max={d.today} onChange={(v) => setDate(v === d.today ? '' : v)} />
          {!isToday && <Btn small kind="ghost" title="Today" onPress={() => setDate('')} />}
        </View>
      </Card>
      {d.visitors.length > 4 && <><Input placeholder="Search name or purpose" value={q} onChangeText={setQ} /><View style={{ height: 12 }} /></>}
      {rows.length === 0 ? <Empty>{d.visitors.length ? 'No match.' : `No visitors ${isToday ? 'yet today' : 'on this day'}.`}</Empty> : (
        <List>{rows.map((v, i) => (
          <View key={v.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderColor: C.line }}>
            <Text style={{ width: 70, color: C.brand, fontWeight: '700', fontSize: 13 }}>{fmtTime(v.visit_time)}</Text>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{v.name}</Text><Dim>{v.purpose || 'No purpose given'}</Dim></View>
            {canDel && <Pressable hitSlop={8} onPress={() => del(v)} style={{ padding: 6 }}><Icon name="trash" size={19} color={C.bad} /></Pressable>}
          </View>))}</List>)}
    </Pad>
  );
});
