// Transport module for mobile. Mirrors client/src/modules/TransportModule.jsx (same endpoints, same rules).
// Setup order, left to right: Buses -> Routes & stops -> Students.   Parents / students only see "My transport".
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { api } from '../api';
import { C } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Field, Input, Choice, Sheet, toast, confirmAsk } from '../ui';
import { FilterBar } from '../FilterBar';
import { useApi } from '../useApi';
import {
  scoped, qs, Pad, Row, List, Avatar, Chip, ChipRow, Stat, Kpi, KpiGrid, Section, Soft, Meter, Ring, Person, SearchBox, Group, BackBar, OptDate, OptTime,
  clock12, monShort, plural, toneColor, hueOf, useDebounced, groupByClass,
} from '../kit';
import { Rides } from './StudentProfile';

const can = (me, f) => me.features.includes(f);
const DIR = { one_way: 'One-way', two_way: 'Two-way' };
const LEVEL_TONE = { ok: 'ok', warn: 'warn', full: 'bad', over: 'bad' };
const DOC_TONE = { ok: 'ok', soon: 'warn', expired: 'bad', missing: 'mute' };
const day = (d) => (d ? String(d).slice(0, 10) : '');
const monthYear = (d) => `${monShort(d)} ${String(d).slice(0, 4)}`;
const ACCENT = '#f97316';
let presetRoute = ''; // "Students on this route" opens the Students tab already filtered

/* ================================================================== MY TRANSPORT (parent / student) */
export function MyTransport() {
  const { data, error, reload, loading } = useApi('/transport/my');
  if (error && !data) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!data) return <Pad><Loading /></Pad>;
  if (!data.length) return <Pad><Empty>No student is linked to your account.</Empty></Pad>;
  return (
    <Pad reload={reload} loading={loading} hasData>
      {data.map((c) => (
        <Section key={c.student_id} title={c.full_name} icon="bus" color={ACCENT} right={c.class_label ? <Chip>Class {c.class_label}</Chip> : null}>
          {c.assigned ? <Rides rides={c.rides} /> : <Soft>No school bus is assigned yet. If you need transport, please ask the school office.</Soft>}
        </Section>
      ))}
    </Pad>
  );
}

/* ================================================================== OVERVIEW */
function GetStarted({ me, go }) {
  const manage = can(me, 'manage_transport'); const assign = can(me, 'assign_transport');
  if (!manage && !assign) return <Pad><Empty>Transport has not been set up yet.</Empty></Pad>;
  const steps = [['1', 'Add your buses', 'Name, seats, driver and document dates.', 'vehicles', manage], ['2', 'Create routes & stops', 'Give each route a bus, then add its stops in order with timings.', 'routes', manage], ['3', 'Put students on a route', 'Search a student, pick the route and the stop.', 'students', assign]];
  return (
    <Pad>
      <Section title="Let's set up school transport" icon="bus" color={ACCENT}><Dim>Three quick steps. You can change anything later.</Dim></Section>
      {steps.map(([n, t, d, v, ok]) => (
        <Card key={n}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800' }}>{n}</Text></View>
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '800', fontSize: 15 }}>{t}</Text><Dim>{d}</Dim></View>
          </View>
          {ok && <View style={{ marginTop: 12 }}><Btn small title="Start" onPress={() => go(v)} /></View>}
        </Card>
      ))}
    </Pad>
  );
}

export const TransportOverview = scoped(function Overview({ me, sc, go }) {
  const { data: d, error, reload, loading } = useApi(`/transport/overview${qs(sc)}`);
  if (error && !d) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!d) return <Pad><Loading /></Pad>;
  const t = d.totals;
  if (!t.vehicles && !t.routes) return <GetStarted me={me} go={go} />;
  const lvl = t.percent >= 100 ? 'bad' : t.percent >= 90 ? 'warn' : 'ok';
  return (
    <Pad reload={reload} loading={loading} hasData>
      <KpiGrid>
        <Kpi icon="bus" color={ACCENT} label="Buses" value={t.vehicles} sub={`${t.capacity} seats in total`} onPress={() => go('vehicles')} />
        <Kpi icon="pin" color="#0ea5e9" label="Routes" value={t.routes} sub={plural(t.stops, 'stop')} onPress={() => go('routes')} />
        <Kpi icon="users" color="#10b981" label="On the bus" value={t.students} sub="across all routes" onPress={() => go('students')} />
        <Kpi icon="check" color="#8b5cf6" label="Seats free" value={t.available} sub={`${t.occupied} of ${t.capacity} used`} onPress={() => go('vehicles')} />
      </KpiGrid>

      <Section title="Seats in use" icon="users" color="#8b5cf6">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <Ring value={t.percent} size={110} stroke={13} color={toneColor(lvl)} sub="used" />
          <View style={{ flex: 1, gap: 8 }}><Stat n={t.occupied} label="Seated" tone={lvl} /><Stat n={t.available} label="Free" /></View>
        </View>
      </Section>

      <Section title="Needs attention" icon="bell" color={C.warn} right={d.alerts.length > 0 ? <Chip tone="warn">{d.alerts.length}</Chip> : null}>
        {d.alerts.length === 0 ? <Soft>All clear. Nothing needs your attention.</Soft> : (
          <>
            {d.alerts.slice(0, 8).map((a, i) => (
              <Row key={i} onPress={() => go(a.view)} last={i === Math.min(d.alerts.length, 8) - 1}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: toneColor(a.tone === 'bad' ? 'bad' : a.tone === 'warn' ? 'warn' : 'info') }} />
                <Text style={{ flex: 1, color: C.ink, fontSize: 14 }}>{a.text}</Text>
                <Icon name="chevron" size={16} color={C.mute} />
              </Row>
            ))}
            {d.alerts.length > 8 && <Dim style={{ marginTop: 6 }}>and {d.alerts.length - 8} more</Dim>}
          </>
        )}
      </Section>

      <Section title="Buses" icon="bus" color={ACCENT}>
        {d.vehicles.length === 0 ? <Soft>No buses yet.</Soft> : d.vehicles.map((v, i) => (
          <Row key={v.id} onPress={() => go('vehicles')} last={i === d.vehicles.length - 1}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.ink, fontWeight: '700' }}>{v.name}</Text>
              <Dim>{v.routes.length ? v.routes.map((r) => r.name).join(', ') : 'No route yet'}</Dim>
              <View style={{ flexDirection: 'row', marginTop: 5 }}><Meter pct={v.occupancy.percent} color={toneColor(LEVEL_TONE[v.occupancy.level])} /></View>
            </View>
            <Text style={{ color: C.ink, fontWeight: '800' }}>{v.occupancy.students}<Text style={{ color: C.mute, fontWeight: '500' }}>/{v.occupancy.capacity}</Text></Text>
          </Row>
        ))}
      </Section>

      <Section title="Routes" icon="pin" color="#0ea5e9">
        {d.routes.length === 0 ? <Soft>No routes yet.</Soft> : d.routes.map((r, i) => (
          <Row key={r.id} onPress={() => go('routes')} last={i === d.routes.length - 1}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: hueOf(r.name) }} />
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>{r.name}</Text><Dim>{[r.zone, r.vehicle ? r.vehicle.name : 'No bus yet', plural(r.stops, 'stop')].filter(Boolean).join(' · ')}</Dim></View>
            <Text style={{ color: C.ink, fontWeight: '800' }}>{r.students}</Text>
          </Row>
        ))}
      </Section>
    </Pad>
  );
});

/* ================================================================== BUSES */
const EMPTY_BUS = { name: '', reg_no: '', capacity: '40', driver_name: '', driver_phone: '', attendant_name: '', attendant_phone: '', insurance_expiry: '', fitness_expiry: '', permit_expiry: '', puc_expiry: '', notes: '' };

function BusForm({ sc, bus, onClose, onSaved }) {
  const [f, setF] = useState(() => (bus ? Object.fromEntries(Object.keys(EMPTY_BUS).map((k) => [k, k.endsWith('_expiry') ? day(bus[k]) : String(bus[k] ?? '')])) : EMPTY_BUS));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { ...f, capacity: Number(f.capacity) };
      if (bus) await api.patch(`/transport/vehicles/${bus.id}${qs(sc)}`, body); else await api.post(`/transport/vehicles${qs(sc)}`, body);
      toast(bus ? 'Bus saved' : 'Bus added'); onSaved(); onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const remove = () => {
    const n = bus.routes.length;
    confirmAsk(`Delete ${bus.name}?${n ? ` ${n === 1 ? 'Its route' : `Its ${n} routes`} will stay but have no bus.` : ''}`, async () => {
      try { await api.del(`/transport/vehicles/${bus.id}${qs(sc)}`); toast('Bus deleted'); onSaved(); onClose(); } catch (x) { setErr(x.message); }
    });
  };
  return (
    <Sheet title={bus ? `Edit ${bus.name}` : 'Add a bus'} onClose={onClose}>
      <Card>
        <Field req label="Bus name"><Input value={f.name} onChangeText={set('name')} placeholder="e.g. Bus 1" maxLength={60} /></Field>
        <Field label="Number plate"><Input value={f.reg_no} onChangeText={set('reg_no')} placeholder="e.g. MH 12 AB 1234" maxLength={20} autoCapitalize="characters" /></Field>
        <Field req label="Seats" hint="Students can't be added once the bus is full"><Input value={f.capacity} onChangeText={(v) => set('capacity')(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={3} /></Field>
      </Card>
      <Card>
        <Field label="Driver name"><Input value={f.driver_name} onChangeText={set('driver_name')} maxLength={80} /></Field>
        <Field label="Driver phone"><Input value={f.driver_phone} onChangeText={set('driver_phone')} keyboardType="phone-pad" maxLength={20} /></Field>
        <Field label="Attendant name"><Input value={f.attendant_name} onChangeText={set('attendant_name')} maxLength={80} /></Field>
        <Field label="Attendant phone"><Input value={f.attendant_phone} onChangeText={set('attendant_phone')} keyboardType="phone-pad" maxLength={20} /></Field>
      </Card>
      <Card>
        <Text style={{ color: C.ink, fontWeight: '800', marginBottom: 2 }}>Document expiry dates</Text>
        <Dim style={{ marginBottom: 12 }}>You will see a reminder on the Overview 30 days before each date.</Dim>
        <Field label="Insurance"><OptDate value={f.insurance_expiry} onChange={set('insurance_expiry')} /></Field>
        <Field label="Fitness certificate"><OptDate value={f.fitness_expiry} onChange={set('fitness_expiry')} /></Field>
        <Field label="Permit"><OptDate value={f.permit_expiry} onChange={set('permit_expiry')} /></Field>
        <Field label="Pollution (PUC)"><OptDate value={f.puc_expiry} onChange={set('puc_expiry')} /></Field>
        <Field label="Notes"><Input multiline value={f.notes} onChangeText={set('notes')} maxLength={500} placeholder="Optional" /></Field>
      </Card>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Save'} onPress={save} disabled={busy || !f.name.trim() || !Number(f.capacity)} />
      {bus && <View style={{ marginTop: 10 }}><Btn kind="danger" title="Delete bus" onPress={remove} /></View>}
    </Sheet>
  );
}

function DocChip({ d }) {
  const text = d.state === 'missing' ? 'not set' : d.state === 'expired' ? 'expired' : d.state === 'soon' ? (d.days === 0 ? 'today' : `${d.days}d left`) : monthYear(d.date);
  return <Chip tone={DOC_TONE[d.state]}>{d.label}: {text}</Chip>;
}

export const Vehicles = scoped(function Vehicles({ me, sc }) {
  const { data, error, reload, loading } = useApi(`/transport/vehicles${qs(sc)}`);
  const [edit, setEdit] = useState(null); const manage = can(me, 'manage_transport');
  if (error && !data) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!data) return <Pad><Loading /></Pad>;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '800', fontSize: 17 }}>{data.length} {data.length === 1 ? 'bus' : 'buses'}</Text><Dim>Seats, driver and document dates</Dim></View>
        {manage && <Btn small title="Add bus" onPress={() => setEdit('new')} />}
      </View>
      {data.length === 0 && <Empty>No buses yet.{manage ? ' Tap "Add bus" to start.' : ''}</Empty>}
      {data.map((v) => {
        const o = v.occupancy; const tone = LEVEL_TONE[o.level]; const full = o.level === 'full' || o.level === 'over';
        return (
          <Section key={v.id} title={v.name} icon="bus" color={hueOf(v.name)} right={manage ? <Pressable onPress={() => setEdit(v)} hitSlop={10} accessibilityLabel={`Edit ${v.name}`}><Icon name="edit" size={19} color={C.brand} /></Pressable> : null}>
            <Dim style={{ marginTop: -6, marginBottom: 10 }}>{v.reg_no || 'No number plate'}</Dim>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 }}>
              <Ring value={o.percent} size={78} stroke={9} color={toneColor(tone)} sub={`${o.students}/${o.capacity}`} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontWeight: '800', marginBottom: 6 }}>{full ? 'Bus is full' : `${plural(o.seats_left, 'seat')} free`}</Text>
                <ChipRow>{v.routes.length ? v.routes.map((r) => <Chip key={r.id}>{r.name}</Chip>) : <Chip>No route yet</Chip>}</ChipRow>
              </View>
            </View>
            {!!v.driver_name && <Person name={v.driver_name} role="Driver" phone={v.driver_phone} last={!v.attendant_name} />}
            {!!v.attendant_name && <Person name={v.attendant_name} role="Attendant" phone={v.attendant_phone} last />}
            <ChipRow style={{ marginTop: 10 }}>{v.docs.map((d) => <DocChip key={d.key} d={d} />)}</ChipRow>
          </Section>
        );
      })}
      {edit && <BusForm sc={sc} bus={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Pad>
  );
});

/* ================================================================== ROUTES & STOPS */
function RouteForm({ sc, route, vehicles, onClose, onSaved }) {
  const [f, setF] = useState({ name: route?.name || '', zone: route?.zone || '', direction: route?.direction || 'two_way', vehicle_id: route?.vehicle?.id || '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { ...f, vehicle_id: f.vehicle_id || null };
      const saved = route ? await api.patch(`/transport/routes/${route.id}${qs(sc)}`, body) : await api.post(`/transport/routes${qs(sc)}`, body);
      toast(route ? 'Route saved' : 'Route added'); onSaved(saved); onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const remove = () => confirmAsk(`Delete ${route.name} and its ${plural(route.stops.length, 'stop')}?`, async () => {
    try { await api.del(`/transport/routes/${route.id}${qs(sc)}`); toast('Route deleted'); onSaved(null); onClose(); } catch (x) { setErr(x.message); }
  });
  return (
    <Sheet title={route ? `Edit ${route.name}` : 'Add a route'} onClose={onClose}>
      <Card>
        <Field req label="Route name"><Input value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="e.g. Route 1" maxLength={60} /></Field>
        <Field label="Zone / area"><Input value={f.zone} onChangeText={(v) => setF({ ...f, zone: v })} placeholder="e.g. North Zone" maxLength={60} /></Field>
        <Field label="Travel" hint={f.direction === 'two_way' ? 'Morning pick-up and afternoon drop on the same route.' : 'The bus runs in one direction only (for example, pick-up only).'}>
          <Choice value={f.direction} onChange={(v) => setF({ ...f, direction: v })} options={Object.entries(DIR).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Bus for this route">
          <Choice value={f.vehicle_id} onChange={(v) => setF({ ...f, vehicle_id: v })} options={[{ value: '', label: 'No bus yet' }, ...vehicles.map((v) => ({ value: v.id, label: `${v.name} · ${v.occupancy.seats_left} free` }))]} />
        </Field>
      </Card>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Save'} onPress={save} disabled={busy || !f.name.trim()} />
      {route && <View style={{ marginTop: 10 }}><Btn kind="danger" title="Delete route" onPress={remove} /></View>}
    </Sheet>
  );
}

function StopForm({ sc, stop, onClose, onSaved }) {
  const [f, setF] = useState({ name: stop.name, pickup_time: stop.pickup_time || '', drop_time: stop.drop_time || '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.patch(`/transport/stops/${stop.id}${qs(sc)}`, f); toast('Stop saved'); onSaved(); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Edit stop" onClose={onClose}>
      <Card>
        <Field req label="Stop name"><Input value={f.name} onChangeText={(v) => setF({ ...f, name: v })} maxLength={80} /></Field>
        <Field label="Morning pick-up time"><OptTime value={f.pickup_time} onChange={(v) => setF({ ...f, pickup_time: v })} /></Field>
        <Field label="Afternoon drop time"><OptTime value={f.drop_time} onChange={(v) => setF({ ...f, drop_time: v })} /></Field>
      </Card>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Save'} onPress={save} disabled={busy || !f.name.trim()} />
    </Sheet>
  );
}

function RouteDetail({ me, sc, route, vehicles, onBack, refresh, go }) {
  const manage = can(me, 'manage_transport'); const color = hueOf(route.name);
  const [add, setAdd] = useState({ name: '', pickup_time: '', drop_time: '' });
  const [busy, setBusy] = useState(false); const [editStop, setEditStop] = useState(null); const [editRoute, setEditRoute] = useState(false);
  const stops = route.stops;

  const addStop = async () => {
    setBusy(true);
    try { await api.post(`/transport/routes/${route.id}/stops${qs(sc)}`, add); setAdd({ name: '', pickup_time: '', drop_time: '' }); refresh(); toast('Stop added'); }
    catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const move = async (i, dir) => {
    const ids = stops.map((s) => s.id); const j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api.put(`/transport/routes/${route.id}/stops/order${qs(sc)}`, { ids }); refresh(); } catch (x) { toast(x.message, true); }
  };
  const del = (s) => confirmAsk(`Delete the stop "${s.name}"?`, async () => { try { await api.del(`/transport/stops/${s.id}${qs(sc)}`); toast('Stop deleted'); refresh(); } catch (x) { toast(x.message, true); } });

  return (
    <Pad reload={refresh} hasData>
      <BackBar label="All routes" onPress={onBack} />
      <Card style={{ borderLeftWidth: 5, borderLeftColor: color }}>
        <Text style={{ color: C.ink, fontSize: 20, fontWeight: '800' }}>{route.name}</Text>
        <ChipRow style={{ marginTop: 8 }}>
          {!!route.zone && <Chip>{route.zone}</Chip>}<Chip>{DIR[route.direction]}</Chip>
          <Chip tone={route.vehicle ? 'info' : 'warn'}>{route.vehicle ? `${route.vehicle.name}${route.vehicle.reg_no ? ` · ${route.vehicle.reg_no}` : ''}` : 'No bus yet'}</Chip>
          <Chip>{plural(stops.length, 'stop')}</Chip><Chip>{plural(route.students, 'student')}</Chip>
        </ChipRow>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <View style={{ flex: 1 }}><Btn small kind="ghost" title="Students" onPress={() => { presetRoute = route.id; go('students'); }} /></View>
          {manage && <View style={{ flex: 1 }}><Btn small kind="ghost" title="Edit route" onPress={() => setEditRoute(true)} /></View>}
        </View>
      </Card>

      <Section title="Stops in order" icon="pin" color={color}>
        {stops.length === 0 ? <Soft>No stops yet.{manage ? ' Add the first stop below.' : ''}</Soft> : stops.map((s, i) => (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: i === stops.length - 1 ? 0 : 1, borderColor: C.line }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{s.name}</Text>
              <Dim>{s.pickup_time ? `Pick-up ${clock12(s.pickup_time)}` : 'No pick-up time'}{s.drop_time ? ` · Drop ${clock12(s.drop_time)}` : ''}</Dim>
            </View>
            <Chip tone={s.students ? 'info' : 'mute'}>{s.students}</Chip>
            {manage && (
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable disabled={i === 0} onPress={() => move(i, -1)} hitSlop={6} style={{ opacity: i === 0 ? 0.25 : 1 }}><Icon name="up" size={18} color={C.mute} /></Pressable>
                <Pressable disabled={i === stops.length - 1} onPress={() => move(i, 1)} hitSlop={6} style={{ opacity: i === stops.length - 1 ? 0.25 : 1 }}><Icon name="down" size={18} color={C.mute} /></Pressable>
                <Pressable onPress={() => setEditStop(s)} hitSlop={6}><Icon name="edit" size={18} color={C.brand} /></Pressable>
                <Pressable onPress={() => del(s)} hitSlop={6}><Icon name="trash" size={18} color={C.bad} /></Pressable>
              </View>
            )}
          </View>
        ))}
        {manage && (
          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderColor: C.line }}>
            <Field label="New stop"><Input value={add.name} onChangeText={(v) => setAdd({ ...add, name: v })} placeholder="Stop name" maxLength={80} /></Field>
            <Field label="Pick-up time"><OptTime value={add.pickup_time} onChange={(v) => setAdd({ ...add, pickup_time: v })} /></Field>
            <Field label="Drop time"><OptTime value={add.drop_time} onChange={(v) => setAdd({ ...add, drop_time: v })} /></Field>
            <Btn title={busy ? 'Adding...' : 'Add stop'} onPress={addStop} disabled={busy || !add.name.trim()} />
          </View>
        )}
      </Section>

      {editStop && <StopForm sc={sc} stop={editStop} onClose={() => setEditStop(null)} onSaved={refresh} />}
      {editRoute && <RouteForm sc={sc} route={route} vehicles={vehicles} onClose={() => setEditRoute(false)} onSaved={(saved) => { refresh(); if (!saved) onBack(); }} />}
    </Pad>
  );
}

export const Routes = scoped(function Routes({ me, sc, go }) {
  const routesQ = useApi(`/transport/routes${qs(sc)}`); const busesQ = useApi(`/transport/vehicles${qs(sc)}`);
  const [open, setOpen] = useState(''); const [form, setForm] = useState(false); const manage = can(me, 'manage_transport');
  const routes = routesQ.data; const vehicles = busesQ.data;
  if ((routesQ.error && !routes) || (busesQ.error && !vehicles)) return <Pad><ErrorBox>{routesQ.error || busesQ.error}</ErrorBox></Pad>;
  if (!routes || !vehicles) return <Pad><Loading /></Pad>;
  const reload = () => { routesQ.reload(); busesQ.reload(); };
  const cur = routes.find((r) => r.id === open);
  if (cur) return <RouteDetail me={me} sc={sc} route={cur} vehicles={vehicles} onBack={() => setOpen('')} refresh={reload} go={go} />;
  return (
    <Pad reload={reload} loading={routesQ.loading} hasData>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '800', fontSize: 17 }}>{plural(routes.length, 'route')}</Text><Dim>Tap a route to see and edit its stops</Dim></View>
        {manage && <Btn small title="Add route" onPress={() => setForm(true)} />}
      </View>
      {routes.length === 0 && <Empty>No routes yet.{manage ? ' Tap "Add route" to start.' : ''}</Empty>}
      {routes.map((r) => (
        <Pressable key={r.id} onPress={() => setOpen(r.id)} style={({ pressed }) => pressed && { opacity: 0.7 }}>
          <Card style={{ borderLeftWidth: 5, borderLeftColor: hueOf(r.name) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ flex: 1, color: C.ink, fontWeight: '800', fontSize: 16 }}>{r.name}</Text><Chip>{DIR[r.direction]}</Chip></View>
            {!!r.zone && <Dim style={{ marginTop: 2 }}>{r.zone}</Dim>}
            <Text style={{ color: C.ink, fontSize: 13.5, marginVertical: 8 }}>{r.stops.length ? `${r.stops[0].name}${r.stops.length > 1 ? `  →  ${r.stops[r.stops.length - 1].name}` : ''}` : 'No stops yet'}</Text>
            <ChipRow>
              <Chip tone={r.vehicle ? 'info' : 'warn'}>{r.vehicle ? r.vehicle.name : 'No bus yet'}</Chip>
              <Chip>{plural(r.stops.length, 'stop')}</Chip><Chip>{plural(r.students, 'student')}</Chip>
            </ChipRow>
          </Card>
        </Pressable>
      ))}
      {form && <RouteForm sc={sc} route={null} vehicles={vehicles} onClose={() => setForm(false)} onSaved={(saved) => { reload(); if (saved?.id) setOpen(saved.id); }} />}
    </Pad>
  );
});

/* ================================================================== STUDENTS (class by class) */
// A student's rides in a sheet: change the stop / route of a ride, take it away, or add another route.
function RideEditor({ sc, routes, student, canAssign, onClose, onChanged }) {
  const [busyId, setBusyId] = useState(''); const [err, setErr] = useState('');
  const [draft, setDraft] = useState({}); // ride id -> { route_id, stop_id }
  const [add, setAdd] = useState({ route_id: '', stop_id: '' });
  const routeOf = (id) => routes.find((r) => r.id === id);
  const val = (ride) => draft[ride.id] || { route_id: ride.route_id, stop_id: ride.stop_id };
  const free = routes.filter((r) => !student.rides.some((x) => x.route_id === r.id));
  const routeOpts = (list) => list.map((r) => ({ value: r.id, label: `${r.name}${r.vehicle ? ` · ${r.vehicle.seats_left ? `${r.vehicle.seats_left} free` : 'full'}` : ' · no bus'}` }));
  const stopOpts = (routeId) => (routeOf(routeId)?.stops || []).map((s) => ({ value: s.id, label: `${s.seq}. ${s.name}${s.pickup_time ? ` · ${clock12(s.pickup_time)}` : ''}` }));

  const run = async (key, fn, ok) => {
    setBusyId(key); setErr('');
    try { await fn(); toast(ok); await onChanged(); } catch (x) { setErr(x.message); toast(x.message, true); } finally { setBusyId(''); }
  };
  const save = (ride) => run(ride.id, async () => { await api.patch(`/transport/assignments/${ride.id}${qs(sc)}`, val(ride)); setDraft(({ [ride.id]: _gone, ...rest }) => rest); }, 'Saved');
  const remove = (ride) => confirmAsk(`Take ${student.full_name} off ${ride.route_name}?`, () => run(ride.id, () => api.del(`/transport/assignments/${ride.id}${qs(sc)}`), 'Removed from the route'), { yes: 'Remove', danger: true });
  const addRide = () => run('add', async () => { await api.post(`/transport/assignments${qs(sc)}`, { student_id: student.student_id, ...add }); setAdd({ route_id: '', stop_id: '' }); }, 'Bus assigned');

  return (
    <Sheet title="Student transport" onClose={onClose}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={student.full_name} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16 }}>{student.full_name}</Text>
            <Dim>{[student.class_label && `Class ${student.class_label}`, student.roll_no && `Roll ${student.roll_no}`, student.admission_no && `Adm. ${student.admission_no}`].filter(Boolean).join(' · ')}</Dim>
          </View>
          <Chip tone={student.rides.length ? 'ok' : 'mute'}>{student.rides.length ? plural(student.rides.length, 'route') : 'Not on a bus'}</Chip>
        </View>
      </Card>

      {student.rides.map((ride) => {
        const v = val(ride); const changed = v.route_id !== ride.route_id || v.stop_id !== ride.stop_id;
        return (
          <Card key={ride.id} style={{ borderLeftWidth: 5, borderLeftColor: hueOf(ride.route_name) }}>
            <Text style={{ color: C.ink, fontWeight: '800' }}>{ride.route_name}{ride.vehicle_name ? <Text style={{ color: C.mute, fontWeight: '500' }}>  ·  {ride.vehicle_name}</Text> : null}</Text>
            <Dim style={{ marginBottom: canAssign ? 10 : 0 }}>{ride.stop_name}{ride.pickup_time ? ` · pick-up ${clock12(ride.pickup_time)}` : ''}</Dim>
            {canAssign && (
              <>
                <Field label="Route"><Choice value={v.route_id} onChange={(id) => setDraft({ ...draft, [ride.id]: { route_id: id, stop_id: id === ride.route_id ? ride.stop_id : '' } })} options={routeOpts(routes.filter((r) => r.id === ride.route_id || !student.rides.some((x) => x.route_id === r.id)))} /></Field>
                <Field label="Stop">{stopOpts(v.route_id).length ? <Choice value={v.stop_id} onChange={(id) => setDraft({ ...draft, [ride.id]: { ...v, stop_id: id } })} options={stopOpts(v.route_id)} /> : <Dim>This route has no stops yet.</Dim>}</Field>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><Btn small title="Save" onPress={() => save(ride)} disabled={!changed || !v.stop_id || busyId === ride.id} /></View>
                  <View style={{ flex: 1 }}><Btn small kind="danger" title="Remove" onPress={() => remove(ride)} disabled={busyId === ride.id} /></View>
                </View>
              </>
            )}
          </Card>
        );
      })}

      {canAssign && (free.length > 0 ? (
        <Section title={student.rides.length ? 'Add another route' : 'Assign a bus'} icon="plus" color={C.ok}>
          <Field label="Route"><Choice value={add.route_id} onChange={(id) => setAdd({ route_id: id, stop_id: '' })} options={routeOpts(free)} /></Field>
          {!!add.route_id && <Field label="Stop">{stopOpts(add.route_id).length ? <Choice value={add.stop_id} onChange={(id) => setAdd({ ...add, stop_id: id })} options={stopOpts(add.route_id)} /> : <Dim>This route has no stops yet.</Dim>}</Field>}
          <Btn title={busyId === 'add' ? 'Saving...' : 'Assign'} onPress={addRide} disabled={!add.route_id || !add.stop_id || busyId === 'add'} />
        </Section>
      ) : <Soft>{routes.length ? 'This student is already on every route.' : 'Create a route first, then you can assign students to it.'}</Soft>)}
      {!canAssign && student.rides.length === 0 && <Soft>This student is not on a school bus.</Soft>}
      <ErrorBox>{err}</ErrorBox>
    </Sheet>
  );
}

export const TransportStudents = scoped(function TransportStudents({ me, sc, active, nonce }) {
  const [route, setRoute] = useState(() => { const r = presetRoute; presetRoute = ''; return r; });
  const [cls, setCls] = useState(''); const [show, setShow] = useState(route ? 'on' : 'all');
  const [q, setQ] = useState(''); const dq = useDebounced(q.trim().toLowerCase(), 150);
  const [openId, setOpenId] = useState(''); const [shut, setShut] = useState({});
  // the tab stays mounted, so pick up "Students on this route" whenever it becomes the visible tab
  useEffect(() => { if (active && presetRoute) { setRoute(presetRoute); setShow('on'); presetRoute = ''; } }, [active, nonce]);
  const routesQ = useApi(`/transport/routes${qs(sc)}`); const listQ = useApi(`/transport/students${qs(sc)}`);
  if ((routesQ.error && !routesQ.data) || (listQ.error && !listQ.data)) return <Pad><ErrorBox>{routesQ.error || listQ.error}</ErrorBox></Pad>;
  if (!routesQ.data || !listQ.data) return <Pad><Loading /></Pad>;

  const all = listQ.data.students; const routes = routesQ.data;
  const labels = groupByClass(all, (s) => s.class_label).map((g) => g.label);
  const rows = all.filter((s) => (!cls || (s.class_label || 'No class') === cls)
    && (show === 'all' || (show === 'on' ? s.rides.length > 0 : s.rides.length === 0))
    && (!route || s.rides.some((x) => x.route_id === route))
    && (!dq || `${s.full_name} ${s.login_id || ''} ${s.admission_no || ''} ${s.roll_no ?? ''} ${s.class_label || ''} ${s.rides.map((x) => `${x.route_name} ${x.stop_name}`).join(' ')}`.toLowerCase().includes(dq)));
  const groups = groupByClass(rows, (s) => s.class_label);
  const open = all.find((s) => s.student_id === openId);
  const reload = async () => { await Promise.all([listQ.reload(), routesQ.reload()]); };
  const filtering = !!(dq || cls || route || show !== 'all');
  const isOpen = (g) => (shut[g.label] !== undefined ? !shut[g.label] : !!dq);

  return (
    <View style={{ flex: 1 }}>
      <FilterBar q={q} onQ={setQ} placeholder="Search name, admission no., class or stop" count={rows.length}
        filters={[
          { key: 'cls', label: 'Class', value: cls, onChange: setCls, all: 'All classes', options: labels.map((l) => ({ value: l, label: l === 'No class' ? l : `Class ${l}` })) },
          { key: 'route', label: 'Route', value: route, onChange: setRoute, all: 'All routes', options: routes.map((r) => ({ value: r.id, label: r.name })) },
        ]} />
      <Pad reload={reload} loading={listQ.loading} hasData>
        <KpiGrid>
          <Kpi icon="users" color="#6366f1" label="All students" value={listQ.data.total} sub={plural(labels.length, 'class').replace('classs', 'classes')} on={show === 'all'} onPress={() => setShow('all')} />
          <Kpi icon="bus" color="#10b981" label="On a bus" value={listQ.data.on_bus} sub="at least one route" on={show === 'on'} onPress={() => setShow('on')} />
          <Kpi icon="pin" color={ACCENT} label="Not on a bus" value={listQ.data.total - listQ.data.on_bus} sub="no transport yet" on={show === 'off'} onPress={() => setShow('off')} />
        </KpiGrid>
        {rows.length === 0 && <Empty>{filtering ? 'No student matches.' : 'No students in this school yet.'}</Empty>}
        {groups.map((g) => (
          <Group key={g.label} label={g.label === 'No class' ? g.label : `Class ${g.label}`} count={`${g.items.filter((s) => s.rides.length).length}/${g.items.length} on bus`} open={isOpen(g)} onToggle={() => setShut((c) => ({ ...c, [g.label]: isOpen(g) }))}>
            <List>
              {g.items.map((s, i) => (
                <Row key={s.student_id} onPress={() => setOpenId(s.student_id)} last={i === g.items.length - 1}>
                  <Avatar name={s.full_name} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{s.full_name}</Text>
                    <Dim>{[s.roll_no && `Roll ${s.roll_no}`, s.admission_no && `Adm. ${s.admission_no}`].filter(Boolean).join(' · ') || s.login_id}</Dim>
                    <ChipRow style={{ marginTop: 5 }}>{s.rides.length === 0 ? <Chip>Not on a bus</Chip> : s.rides.map((x) => <Chip key={x.id} tone="info">{x.route_name} · {x.stop_name}</Chip>)}</ChipRow>
                  </View>
                  <Icon name="chevron" size={16} color={C.mute} />
                </Row>
              ))}
            </List>
          </Group>
        ))}
        {open && <RideEditor sc={sc} routes={routes} student={open} canAssign={can(me, 'assign_transport')} onClose={() => setOpenId('')} onChanged={reload} />}
      </Pad>
    </View>
  );
});
