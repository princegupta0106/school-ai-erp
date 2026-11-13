// Transport: overview, buses, routes & stops, students on the bus, and "My transport" for parents / students.
// Talks to /api/transport. Setup order is left to right: Buses -> Routes & stops -> Students.
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Field, toast, Loading, ask, initials, groupByClass, ClassGroup, classText, classColor, Page, PageBar, Button, StatusBadge, KpiGrid, Kpi, Section, EmptyState, FormDialog, FormGrid, Choice, Notice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
import { scoped } from './AttendanceModule.jsx';

/* ------------------------------------------------------------------ helpers */
const sq = (me, sid) => (me.role === 'super_admin' ? { school_id: sid } : {});
const qs = (o) => { const p = new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))); const s = p.toString(); return s ? `?${s}` : ''; };
const can = (me, f) => me.features.includes(f);
const useDebounced = (v, ms = 250) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; };
const clock = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const monthYear = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

// every route / bus gets the same colour every time (from its name)
const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `var(--cat-${n})`);
const hue = (s) => PALETTE[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const LEVEL = { ok: 'var(--st-ok)', warn: 'var(--st-warn)', full: 'var(--st-bad)', over: 'var(--st-bad)' };
const TONE = { bad: 'var(--st-bad)', warn: 'var(--st-warn)', info: 'var(--st-info)' };
const DIR = { one_way: 'One-way', two_way: 'Two-way' };
const DOC_TONE = { ok: 'ok', soon: 'warn', expired: 'bad', missing: 'mute' };

const Soft = ({ children }) => <Notice tone="mute">{children}</Notice>;
const Chip = ({ tone, children, title }) => <span className={`tr-chip ${tone || ''}`} title={title}>{children}</span>;
const Bar = ({ percent, level }) => <div className="tr-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, Math.min(100, percent))}%`, background: LEVEL[level] }} /></div>;

function Ring({ percent, color, size = 76, stroke = 9, children }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(100, percent || 0));
  return (
    <div className="tr-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tr-track)" strokeWidth={stroke} />
        {v > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <div className="tr-ring-t">{children}</div>
    </div>
  );
}

function DocChip({ d }) {
  const text = d.state === 'missing' ? 'not set' : d.state === 'expired' ? 'expired' : d.state === 'soon' ? (d.days === 0 ? 'today' : `${d.days}d left`) : monthYear(d.date);
  return <Chip tone={DOC_TONE[d.state]} title={d.date ? `Valid till ${d.date}` : 'No date saved'}>{d.label}: {text}</Chip>;
}

const Person = ({ role, name, phone }) => (name || phone ? (
  <div className="tr-person"><span className="tr-pr">{role}</span><b>{name || '—'}</b>{phone && <a className="icon-btn" href={`tel:${phone}`} aria-label={`Call ${name || role}`}><Icon name="phone" size={16} /></a>}</div>
) : null);

/* ------------------------------------------------------------------ one ride (used here and on the student profile) */
export function Rides({ rides }) {
  return (
    <div className="tr-rides">
      {rides.map((r) => (
        <div key={r.id} className="tr-ride" style={{ '--c': hue(r.route) }}>
          <div className="tr-ride-top"><b>{r.route}</b>{r.zone && <small>{r.zone}</small>}<StatusBadge tone="mute" dot={false}>{DIR[r.direction] || ''}</StatusBadge></div>
          <div className="tr-times">
            <div><small>Morning pick-up</small><b>{r.pickup_time ? clock(r.pickup_time) : '—'}</b></div>
            <div><small>Afternoon drop</small><b>{r.drop_time ? clock(r.drop_time) : '—'}</b></div>
          </div>
          <div className="tr-where"><Icon name="pin" size={16} /><span>Boards at <b>{r.stop || '—'}</b></span></div>
          {r.bus ? (
            <div className="tr-bus-info">
              <div className="tr-where"><Icon name="bus" size={16} /><span><b>{r.bus.name}</b>{r.bus.reg_no ? ` · ${r.bus.reg_no}` : ''}</span></div>
              <Person role="Driver" name={r.bus.driver_name} phone={r.bus.driver_phone} />
              <Person role="Attendant" name={r.bus.attendant_name} phone={r.bus.attendant_phone} />
            </div>
          ) : <small className="muted">The school has not chosen a bus for this route yet.</small>}
        </div>
      ))}
    </div>
  );
}

/* ================================================================== MY TRANSPORT (parent / student) */
export function MyTransport() {
  const { data, error } = useApi('/transport/my', true, { keepPrevious: true });
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Loading />;
  if (!data.length) return <EmptyState icon="users" title="No student linked">No student is linked to your account.</EmptyState>;
  return (
    <Page className="tr">
      <PageBar title="My transport" sub="Bus, route and timings for your child" />
      {data.map((c) => (
        <Section key={c.student_id} title={c.full_name} sub={c.class_label ? `Class ${c.class_label}` : undefined}>
          {c.assigned ? <Rides rides={c.rides} /> : <Soft>No school bus is assigned yet. If you need transport, please ask the school office.</Soft>}
        </Section>
      ))}
    </Page>
  );
}

/* ================================================================== OVERVIEW */
const Stat = ({ icon, label, value, sub, onClick }) => <Kpi icon={icon} label={label} value={value} sub={sub} onClick={onClick} />;

function GetStarted({ me, go }) {
  const manage = can(me, 'manage_transport'); const assign = can(me, 'assign_transport');
  if (!manage && !assign) return <EmptyState icon="bus" title="Not set up yet">Transport has not been set up yet.</EmptyState>;
  const steps = [
    ['1', 'var(--cat-1)', 'Add your buses', 'Name, seats, driver and document dates.', 'vehicles', manage],
    ['2', 'var(--cat-2)', 'Create routes & stops', 'Give each route a bus, then add its stops in order with timings.', 'routes', manage],
    ['3', 'var(--cat-4)', 'Put students on a route', 'Search a student, pick the route and the stop.', 'students', assign],
  ];
  return (
    <Page className="tr">
      <PageBar title="Transport" sub="Three quick steps to set up. You can change anything later." />
      <div className="tr-steps">
        {steps.map(([n, c, t, d, v, ok]) => (
          <div key={n} className="tr-step" style={{ '--c': c }}>
            <span className="tr-num">{n}</span><b>{t}</b><small>{d}</small>
            {ok && <Button kind="primary" size="sm" onClick={() => go(v)}>Start</Button>}
          </div>
        ))}
      </div>
    </Page>
  );
}

export const TransportOverview = scoped(function Overview({ me, sid, go }) {
  const { data: d, error } = useApi(`/transport/overview${qs(sq(me, sid))}`, true, { keepPrevious: true });
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!d) return <Loading rows={5} />;
  const t = d.totals;
  if (!t.vehicles && !t.routes) return <GetStarted me={me} go={go} />;
  const level = t.percent >= 100 ? 'full' : t.percent >= 90 ? 'warn' : 'ok';
  return (
    <Page className="tr">
      <PageBar title="Transport" sub="Buses, routes and seats at a glance" />
      <KpiGrid>
        <Stat icon="bus" label="Buses" value={t.vehicles} sub={`${t.capacity} seats in total`} onClick={() => go('vehicles')} />
        <Stat icon="pin" label="Routes" value={t.routes} sub={`${t.stops} stops`} onClick={() => go('routes')} />
        <Stat icon="users" label="Students on the bus" value={t.students} sub="across all routes" onClick={() => go('students')} />
        <Stat icon="check" label="Seats free" value={t.available} sub={`${t.occupied} of ${t.capacity} used`} onClick={() => go('vehicles')} />
      </KpiGrid>

      <div className="tr-two">
        <Section title="Seats in use">
          <div className="tr-seats">
            <Ring percent={t.percent} color={LEVEL[level]} size={128} stroke={14}><b className="tr-ring-n">{t.percent}%</b><small>used</small></Ring>
            <div className="tr-leg">
              <div><i style={{ background: LEVEL[level] }} />Seated <b>{t.occupied}</b></div>
              <div><i className="tr-d-track" />Free <b>{t.available}</b></div>
              <div><i className="tr-d-total" />Total seats <b>{t.capacity}</b></div>
            </div>
          </div>
        </Section>

        <Section title="Needs attention" sub={d.alerts.length > 0 ? `${d.alerts.length} to check` : undefined}>
          {d.alerts.length === 0 ? <div className="tr-clear"><Icon name="check" size={18} /> All clear. Nothing needs your attention.</div> : (
            <div className="tr-alerts">{d.alerts.slice(0, 8).map((a, i) => (
              <button key={i} type="button" className="tr-alert" style={{ '--c': TONE[a.tone] }} onClick={() => go(a.view)}><i /><span>{a.text}</span><Icon name="chevron" size={15} /></button>
            ))}{d.alerts.length > 8 && <small className="muted">and {d.alerts.length - 8} more</small>}</div>
          )}
        </Section>
      </div>

      <div className="tr-two">
        <Section title="Buses">
          {d.vehicles.length === 0 ? <Soft>No buses yet.</Soft> : d.vehicles.map((v) => (
            <button key={v.id} type="button" className="tr-line-row" onClick={() => go('vehicles')}>
              <span className="tr-ic sm" style={{ '--c': hue(v.name) }}><Icon name="bus" size={16} /></span>
              <span className="tr-grow"><b>{v.name}</b><small>{v.routes.length ? v.routes.map((r) => r.name).join(', ') : 'No route yet'}</small><Bar percent={v.occupancy.percent} level={v.occupancy.level} /></span>
              <span className="tr-frac"><b>{v.occupancy.students}</b>/{v.occupancy.capacity}</span>
            </button>
          ))}
        </Section>
        <Section title="Routes">
          {d.routes.length === 0 ? <Soft>No routes yet.</Soft> : d.routes.map((r) => (
            <button key={r.id} type="button" className="tr-line-row" onClick={() => go('routes')}>
              <span className="tr-ic sm" style={{ '--c': hue(r.name) }}><Icon name="pin" size={16} /></span>
              <span className="tr-grow"><b>{r.name}</b><small>{[r.zone, r.vehicle ? r.vehicle.name : 'No bus yet', `${r.stops} stop${r.stops === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</small></span>
              <span className="tr-frac"><b>{r.students}</b> <small>student{r.students === 1 ? '' : 's'}</small></span>
            </button>
          ))}
        </Section>
      </div>
    </Page>
  );
});

/* ================================================================== BUSES */
const EMPTY_BUS = { name: '', reg_no: '', capacity: 40, driver_name: '', driver_phone: '', attendant_name: '', attendant_phone: '', insurance_expiry: '', fitness_expiry: '', permit_expiry: '', puc_expiry: '', notes: '' };

function BusForm({ me, sid, bus, onClose, onSaved }) {
  const [f, setF] = useState(() => (bus ? Object.fromEntries(Object.keys(EMPTY_BUS).map((k) => [k, bus[k] ?? ''])) : EMPTY_BUS));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const scope = qs(sq(me, sid));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (bus) await api.patch(`/transport/vehicles/${bus.id}${scope}`, f); else await api.post(`/transport/vehicles${scope}`, f);
      toast(bus ? 'Bus saved' : 'Bus added'); onSaved(); onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    const n = bus.routes.length;
    if (!(await ask(`Delete ${bus.name}?${n ? ` ${n === 1 ? 'Its route' : `Its ${n} routes`} will stay but have no bus.` : ''}`))) return;
    try { await api.del(`/transport/vehicles/${bus.id}${scope}`); toast('Bus deleted'); onSaved(); onClose(); } catch (x) { setErr(x.message); }
  };
  return (
    <FormDialog title={bus ? `Edit ${bus.name}` : 'Add a bus'} onClose={onClose} onSubmit={save} busy={busy} error={err} submitDisabled={!f.name.trim()} wide>
      <FormGrid>
        <Field label="Bus name" req><input autoFocus required value={f.name} onChange={set('name')} placeholder="e.g. Bus 1" maxLength={60} /></Field>
        <Field label="Number plate"><input value={f.reg_no} onChange={set('reg_no')} placeholder="e.g. MH 12 AB 1234" maxLength={20} /></Field>
        <Field label="Seats" req hint="Students can't be added once the bus is full"><input required type="number" min={1} max={200} value={f.capacity} onChange={set('capacity')} /></Field>
        <span />
        <Field label="Driver name"><input value={f.driver_name} onChange={set('driver_name')} maxLength={80} /></Field>
        <Field label="Driver phone"><input inputMode="tel" value={f.driver_phone} onChange={set('driver_phone')} maxLength={20} /></Field>
        <Field label="Attendant name"><input value={f.attendant_name} onChange={set('attendant_name')} maxLength={80} /></Field>
        <Field label="Attendant phone"><input inputMode="tel" value={f.attendant_phone} onChange={set('attendant_phone')} maxLength={20} /></Field>
        <Field label="Document expiry dates" hint="You will see a reminder on the Overview 30 days before each date." full><span /></Field>
        <Field label="Insurance"><input type="date" value={f.insurance_expiry} onChange={set('insurance_expiry')} /></Field>
        <Field label="Fitness certificate"><input type="date" value={f.fitness_expiry} onChange={set('fitness_expiry')} /></Field>
        <Field label="Permit"><input type="date" value={f.permit_expiry} onChange={set('permit_expiry')} /></Field>
        <Field label="Pollution (PUC)"><input type="date" value={f.puc_expiry} onChange={set('puc_expiry')} /></Field>
        <Field label="Notes" full><textarea rows={2} value={f.notes} onChange={set('notes')} maxLength={500} placeholder="Optional" /></Field>
      </FormGrid>
      {bus && <Button kind="danger" size="sm" icon="trash" onClick={remove}>Delete bus</Button>}
    </FormDialog>
  );
}

export const Vehicles = scoped(function Vehicles({ me, sid }) {
  const { data, error, refresh } = useApi(`/transport/vehicles${qs(sq(me, sid))}`, true, { keepPrevious: true });
  const [edit, setEdit] = useState(null);
  const manage = can(me, 'manage_transport');
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Loading />;
  return (
    <Page className="tr">
      <PageBar title="Buses" sub={`${data.length} bus${data.length === 1 ? '' : 'es'} · seats used, driver and document dates`}>
        {manage && <Button kind="primary" icon="plus" onClick={() => setEdit('new')}>Add bus</Button>}
      </PageBar>
      {data.length === 0 ? <EmptyState icon="bus" title="No buses yet">{manage ? 'Tap "Add bus" to start.' : 'The school has not added any buses.'}</EmptyState> : (
        <div className="tr-grid">
          {data.map((v) => {
            const o = v.occupancy;
            return (
              <section key={v.id} className="ds-section tr-bus" style={{ '--c': LEVEL[o.level] }}>
                <header>
                  <span className="tr-ic" style={{ '--c': hue(v.name) }}><Icon name="bus" size={20} /></span>
                  <div><b>{v.name}</b><small>{v.reg_no || 'No number plate'}</small></div>
                  {manage && <button className="icon-btn" aria-label={`Edit ${v.name}`} onClick={() => setEdit(v)}><Icon name="edit" size={18} /></button>}
                </header>
                <div className="tr-bus-mid">
                  <Ring percent={o.percent} color={LEVEL[o.level]}><b>{o.students}</b><small>of {o.capacity}</small></Ring>
                  <div>
                    <b>{o.level === 'full' || o.level === 'over' ? 'Bus is full' : `${o.seats_left} seat${o.seats_left === 1 ? '' : 's'} free`}</b>
                    <div className="tr-chips tr-mt-sm">{v.routes.length ? v.routes.map((r) => <Chip key={r.id}><i className="tr-d" style={{ background: hue(r.name) }} />{r.name}</Chip>) : <Chip tone="mute">No route yet</Chip>}</div>
                  </div>
                </div>
                <Person role="Driver" name={v.driver_name} phone={v.driver_phone} />
                <Person role="Attendant" name={v.attendant_name} phone={v.attendant_phone} />
                <div className="tr-chips tr-mt-md">{v.docs.map((d) => <DocChip key={d.key} d={d} />)}</div>
              </section>
            );
          })}
        </div>
      )}
      {edit && <BusForm me={me} sid={sid} bus={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={refresh} />}
    </Page>
  );
});

/* ================================================================== ROUTES & STOPS */
let presetRoute = ''; // "Students on this route" opens the Students tab already filtered

function RouteForm({ me, sid, route, vehicles, onClose, onSaved }) {
  const [f, setF] = useState({ name: route?.name || '', zone: route?.zone || '', direction: route?.direction || 'two_way', vehicle_id: route?.vehicle?.id || '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const scope = qs(sq(me, sid));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body = { ...f, vehicle_id: f.vehicle_id || null };
      const saved = route ? await api.patch(`/transport/routes/${route.id}${scope}`, body) : await api.post(`/transport/routes${scope}`, body);
      toast(route ? 'Route saved' : 'Route added'); onSaved(saved); onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await ask(`Delete ${route.name} and its ${route.stops.length} stop${route.stops.length === 1 ? '' : 's'}?`))) return;
    try { await api.del(`/transport/routes/${route.id}${scope}`); toast('Route deleted'); onSaved(null); onClose(); } catch (x) { setErr(x.message); }
  };
  return (
    <FormDialog title={route ? `Edit ${route.name}` : 'Add a route'} onClose={onClose} onSubmit={save} busy={busy} error={err} submitDisabled={!f.name.trim()}>
      <FormGrid>
        <Field label="Route name" req><input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Route 1" maxLength={60} /></Field>
        <Field label="Zone / area"><input value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} placeholder="e.g. North Zone" maxLength={60} /></Field>
        <Field label="Travel" full hint={f.direction === 'two_way' ? 'Morning pick-up and afternoon drop on the same route.' : 'The bus runs in one direction only (for example, pick-up only).'}>
          <Choice label="Travel" value={f.direction} onChange={(v) => setF({ ...f, direction: v })} options={Object.entries(DIR).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Bus for this route" full>
          <select value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })}>
            <option value="">No bus yet</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.reg_no ? ` (${v.reg_no})` : ''} · {v.occupancy.seats_left} seats free</option>)}
          </select>
        </Field>
      </FormGrid>
      {route && <Button kind="danger" size="sm" icon="trash" onClick={remove}>Delete route</Button>}
    </FormDialog>
  );
}

function StopForm({ me, sid, stop, onClose, onSaved }) {
  const [f, setF] = useState({ name: stop.name, pickup_time: stop.pickup_time || '', drop_time: stop.drop_time || '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.patch(`/transport/stops/${stop.id}${qs(sq(me, sid))}`, f); toast('Stop saved'); onSaved(); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <FormDialog title="Edit stop" onClose={onClose} onSubmit={save} busy={busy} error={err} submitDisabled={!f.name.trim()}>
      <FormGrid>
        <Field label="Stop name" req full><input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></Field>
        <Field label="Morning pick-up time"><input type="time" value={f.pickup_time} onChange={(e) => setF({ ...f, pickup_time: e.target.value })} /></Field>
        <Field label="Afternoon drop time"><input type="time" value={f.drop_time} onChange={(e) => setF({ ...f, drop_time: e.target.value })} /></Field>
      </FormGrid>
    </FormDialog>
  );
}

function RouteDetail({ me, sid, route, vehicles, onBack, refresh, go }) {
  const manage = can(me, 'manage_transport');
  const color = hue(route.name); const scope = qs(sq(me, sid));
  const [add, setAdd] = useState({ name: '', pickup_time: '', drop_time: '' }); const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [editStop, setEditStop] = useState(null); const [editRoute, setEditRoute] = useState(false);

  const addStop = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post(`/transport/routes/${route.id}/stops${scope}`, add); setAdd({ name: '', pickup_time: '', drop_time: '' }); setAddOpen(false); toast('Stop added'); refresh(); }
    catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const move = async (i, dir) => {
    const ids = route.stops.map((s) => s.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api.put(`/transport/routes/${route.id}/stops/order${scope}`, { ids }); refresh(); } catch (x) { toast(x.message, true); }
  };
  const del = async (s) => {
    if (!(await ask(`Delete the stop "${s.name}"?`))) return;
    try { await api.del(`/transport/stops/${s.id}${scope}`); toast('Stop deleted'); refresh(); } catch (x) { toast(x.message, true); }
  };
  const seeStudents = () => { presetRoute = route.id; go('students'); };

  return (
    <Page className="tr">
      <PageBar lead={<Button size="sm" icon="back" onClick={onBack}>All routes</Button>} title={route.name}
        sub={[route.zone, DIR[route.direction], route.vehicle ? `${route.vehicle.name}${route.vehicle.reg_no ? ` · ${route.vehicle.reg_no}` : ''}` : 'No bus yet', `${route.stops.length} stop${route.stops.length === 1 ? '' : 's'}`, `${route.students} student${route.students === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}>
        <Button icon="users" onClick={seeStudents}>Students</Button>
        {manage && <Button icon="edit" onClick={() => setEditRoute(true)}>Edit</Button>}
      </PageBar>

      <Section title="Stops in order" actions={manage && <Button kind="primary" size="sm" icon="plus" onClick={() => setAddOpen(true)}>Add stop</Button>} className="tr-stops-sec">
        {route.stops.length === 0 ? <Soft>No stops yet.{manage && ' Use "Add stop" to add the first one.'}</Soft> : (
          <ol className="tr-line">
            {route.stops.map((s, i) => (
              <li key={s.id} className="tr-stop">
                <span className="tr-dot">{i + 1}</span>
                <div className="tr-stop-b">
                  <b>{s.name}</b>
                  <small>{s.pickup_time ? `Pick-up ${clock(s.pickup_time)}` : 'No pick-up time'}{s.drop_time ? ` · Drop ${clock(s.drop_time)}` : ''}</small>
                </div>
                <div className="tr-stop-r">
                  <Chip tone={s.students ? '' : 'mute'} title="Students at this stop"><Icon name="users" size={13} /> {s.students}</Chip>
                  {manage && (
                    <span className="tr-acts">
                      <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={17} /></button>
                      <button className="icon-btn" aria-label="Move down" disabled={i === route.stops.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={17} /></button>
                      <button className="icon-btn" aria-label={`Edit ${s.name}`} onClick={() => setEditStop(s)}><Icon name="edit" size={17} /></button>
                      <button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => del(s)}><Icon name="trash" size={17} /></button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {addOpen && (
        <FormDialog title="Add a stop" sub={`To ${route.name}, at the end of the route`} onClose={() => setAddOpen(false)} onSubmit={addStop} busy={busy} submitLabel="Add stop" submitDisabled={!add.name.trim()}>
          <FormGrid>
            <Field label="Stop name" req full><input autoFocus required value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="Stop name" maxLength={80} /></Field>
            <Field label="Pick-up time"><input type="time" value={add.pickup_time} onChange={(e) => setAdd({ ...add, pickup_time: e.target.value })} /></Field>
            <Field label="Drop time"><input type="time" value={add.drop_time} onChange={(e) => setAdd({ ...add, drop_time: e.target.value })} /></Field>
          </FormGrid>
        </FormDialog>
      )}

      {editStop && <StopForm me={me} sid={sid} stop={editStop} onClose={() => setEditStop(null)} onSaved={refresh} />}
      {editRoute && <RouteForm me={me} sid={sid} route={route} vehicles={vehicles} onClose={() => setEditRoute(false)} onSaved={(saved) => { refresh(); if (!saved) onBack(); }} />}
    </Page>
  );
}

export const Routes = scoped(function Routes({ me, sid, go }) {
  const scope = qs(sq(me, sid));
  const { data: routes, error, refresh } = useApi(`/transport/routes${scope}`, true, { keepPrevious: true });
  const { data: vehicles, refresh: refreshBuses } = useApi(`/transport/vehicles${scope}`, true, { keepPrevious: true });
  const [open, setOpen] = useState(''); const [form, setForm] = useState(false);
  const manage = can(me, 'manage_transport');
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!routes || !vehicles) return <Loading />;
  const reload = () => { refresh(); refreshBuses(); };
  const cur = routes.find((r) => r.id === open);
  if (cur) return <RouteDetail me={me} sid={sid} route={cur} vehicles={vehicles} onBack={() => setOpen('')} refresh={reload} go={go} />;
  return (
    <Page className="tr">
      <PageBar title="Routes & stops" sub={`${routes.length} route${routes.length === 1 ? '' : 's'} · tap a route to see and edit its stops`}>
        {manage && <Button kind="primary" icon="plus" onClick={() => setForm(true)}>Add route</Button>}
      </PageBar>
      {routes.length === 0 ? <EmptyState icon="pin" title="No routes yet">{manage ? 'Tap "Add route" to start.' : 'The school has not added any routes.'}</EmptyState> : (
        <div className="tr-grid">
          {routes.map((r) => (
            <button key={r.id} type="button" className="tr-route" style={{ '--c': hue(r.name) }} onClick={() => setOpen(r.id)}>
              <span className="tr-route-h"><b>{r.name}</b><StatusBadge tone="mute" dot={false}>{DIR[r.direction]}</StatusBadge></span>
              {r.zone && <small className="muted">{r.zone}</small>}
              <span className="tr-route-path">{r.stops.length ? `${r.stops[0].name}${r.stops.length > 1 ? ` → ${r.stops[r.stops.length - 1].name}` : ''}` : 'No stops yet'}</span>
              <span className="tr-chips">
                {r.vehicle ? <Chip><Icon name="bus" size={13} /> {r.vehicle.name}</Chip> : <Chip tone="warn">No bus yet</Chip>}
                <Chip tone="mute">{r.stops.length} stop{r.stops.length === 1 ? '' : 's'}</Chip>
                <Chip tone="mute"><Icon name="users" size={13} /> {r.students}</Chip>
              </span>
            </button>
          ))}
        </div>
      )}
      {form && <RouteForm me={me} sid={sid} route={null} vehicles={vehicles} onClose={() => setForm(false)} onSaved={(saved) => { reload(); if (saved?.id) setOpen(saved.id); }} />}
    </Page>
  );
});

/* ================================================================== STUDENTS (everyone, class by class) */
// A student's rides in a modal: change the stop / route of a ride, take it away, or add another route.
function RideEditor({ me, sid, routes, student, onClose, onChanged }) {
  const scope = qs(sq(me, sid));
  const assign = can(me, 'assign_transport');
  const [busyId, setBusyId] = useState(''); const [err, setErr] = useState('');
  const [draft, setDraft] = useState({}); // ride id -> { route_id, stop_id }
  const [add, setAdd] = useState({ route_id: '', stop_id: '' });
  const routeOf = (id) => routes.find((r) => r.id === id);
  const val = (ride) => draft[ride.id] || { route_id: ride.route_id, stop_id: ride.stop_id };
  const free = routes.filter((r) => !student.rides.some((x) => x.route_id === r.id));

  const run = async (key, fn, ok) => {
    setBusyId(key); setErr('');
    try { await fn(); toast(ok); await onChanged(); } catch (x) { setErr(x.message); } finally { setBusyId(''); }
  };
  const save = (ride) => run(ride.id, async () => { await api.patch(`/transport/assignments/${ride.id}${scope}`, val(ride)); setDraft(({ [ride.id]: _gone, ...rest }) => rest); }, 'Saved');
  const remove = async (ride) => { if (await ask(`Take ${student.full_name} off ${ride.route_name}?`)) run(ride.id, () => api.del(`/transport/assignments/${ride.id}${scope}`), 'Removed from the route'); };
  const addRide = (e) => { e.preventDefault(); run('add', async () => { await api.post(`/transport/assignments${scope}`, { student_id: student.student_id, ...add }); setAdd({ route_id: '', stop_id: '' }); }, 'Bus assigned'); };

  const StopSelect = ({ routeId, value, onChange }) => {
    const r = routeOf(routeId);
    return (
      <select required value={value} disabled={!r} onChange={(e) => onChange(e.target.value)} aria-label="Stop">
        <option value="">{r ? (r.stops.length ? 'Choose a stop' : 'This route has no stops yet') : 'Choose a route first'}</option>
        {(r?.stops || []).map((s) => <option key={s.id} value={s.id}>{s.seq}. {s.name}{s.pickup_time ? ` · ${clock(s.pickup_time)}` : ''}</option>)}
      </select>
    );
  };
  const RouteSelect = ({ value, onChange, list }) => (
    <select required value={value} onChange={(e) => onChange(e.target.value)} aria-label="Route">
      <option value="">Choose a route</option>
      {list.map((r) => <option key={r.id} value={r.id}>{r.name}{r.vehicle ? ` · ${r.vehicle.name} (${r.vehicle.seats_left ? `${r.vehicle.seats_left} seats free` : 'full'})` : ' · no bus yet'}</option>)}
    </select>
  );

  return (
    <FormDialog title="Student transport" onClose={onClose} noForm hideFooter wide error={err}>
      <div className="tr-picked" style={{ '--c': classColor(student.class_label) }}>
        <span className="tr-av" style={{ '--c': hue(student.full_name) }}>{initials(student.full_name)}</span>
        <div><b>{student.full_name}</b><small>{[classText(student.class_label), student.roll_no && `Roll ${student.roll_no}`, student.admission_no && `Adm. ${student.admission_no}`].filter(Boolean).join(' · ')}</small></div>
        <StatusBadge tone={student.rides.length ? 'ok' : 'mute'}>{student.rides.length ? `${student.rides.length} route${student.rides.length === 1 ? '' : 's'}` : 'Not on a bus'}</StatusBadge>
      </div>

      {student.rides.length > 0 && (
        <div className="tr-edit-list">
          {student.rides.map((ride) => {
            const v = val(ride); const changed = v.route_id !== ride.route_id || v.stop_id !== ride.stop_id;
            return (
              <div key={ride.id} className="tr-edit" style={{ '--c': hue(ride.route_name) }}>
                <div className="tr-edit-top"><Chip><i className="tr-d" style={{ background: hue(ride.route_name) }} />{ride.route_name}</Chip>{ride.vehicle_name && <small className="muted"><Icon name="bus" size={13} /> {ride.vehicle_name}</small>}<small className="muted">{ride.stop_name}{ride.pickup_time ? ` · pick-up ${clock(ride.pickup_time)}` : ''}</small></div>
                {assign && (
                  <div className="tr-edit-f">
                    <RouteSelect value={v.route_id} list={routes.filter((r) => r.id === ride.route_id || !student.rides.some((x) => x.route_id === r.id))} onChange={(id) => setDraft({ ...draft, [ride.id]: { route_id: id, stop_id: id === ride.route_id ? ride.stop_id : '' } })} />
                    <StopSelect routeId={v.route_id} value={v.stop_id} onChange={(id) => setDraft({ ...draft, [ride.id]: { ...v, stop_id: id } })} />
                    <Button kind="primary" disabled={!changed || !v.stop_id || busyId === ride.id} onClick={() => save(ride)}>Save</Button>
                    <Button kind="danger" icon="trash" disabled={busyId === ride.id} onClick={() => remove(ride)}>Remove</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {assign && (
        free.length > 0 ? (
          <form className="tr-edit tr-edit-new" onSubmit={addRide}>
            <b>{student.rides.length ? 'Add another route' : 'Assign a bus'}</b>
            <div className="tr-edit-f">
              <RouteSelect value={add.route_id} list={free} onChange={(id) => setAdd({ route_id: id, stop_id: '' })} />
              <StopSelect routeId={add.route_id} value={add.stop_id} onChange={(id) => setAdd({ ...add, stop_id: id })} />
              <Button type="submit" kind="primary" icon="plus" loading={busyId === 'add'} disabled={!add.route_id || !add.stop_id}>Assign</Button>
            </div>
          </form>
        ) : <Soft>{routes.length ? 'This student is already on every route.' : 'Create a route first, then you can assign students to it.'}</Soft>
      )}
      {!assign && student.rides.length === 0 && <Soft>This student is not on a school bus.</Soft>}
    </FormDialog>
  );
}

export const Students = scoped(function Students({ me, sid }) {
  const scope = sq(me, sid);
  const [route, setRoute] = useState(() => { const r = presetRoute; presetRoute = ''; return r; });
  const [cls, setCls] = useState(''); const [show, setShow] = useState(route ? 'on' : 'all');
  const [q, setQ] = useState(''); const dq = useDebounced(q.trim().toLowerCase(), 150);
  const [openId, setOpenId] = useState('');
  const routes = useApi(`/transport/routes${qs(scope)}`, true, { keepPrevious: true });
  const list = useApi(`/transport/students${qs(scope)}`, true, { keepPrevious: true });
  if (routes.error) return <Notice tone="bad">{routes.error}</Notice>;
  if (list.error) return <Notice tone="bad">{list.error}</Notice>;
  if (!routes.data || !list.data) return <Loading rows={6} />;

  const all = list.data.students;
  const labels = groupByClass(all, (s) => s.class_label).map((g) => g.label);
  const rows = all.filter((s) => (!cls || (s.class_label || 'No class') === cls)
    && (show === 'all' || (show === 'on' ? s.rides.length > 0 : s.rides.length === 0))
    && (!route || s.rides.some((x) => x.route_id === route))
    && (!dq || `${s.full_name} ${s.login_id || ''} ${s.admission_no || ''} ${s.roll_no ?? ''} ${s.class_label || ''} ${s.rides.map((x) => `${x.route_name} ${x.stop_name}`).join(' ')}`.toLowerCase().includes(dq)));
  const groups = groupByClass(rows, (s) => s.class_label);
  const open = all.find((s) => s.student_id === openId);
  const refreshAll = async () => { await Promise.all([list.refresh(), routes.refresh()]); };
  const filtering = !!(dq || cls || route || show !== 'all');

  return (
    <Page className="tr">
      <PageBar title="Students on the bus" sub="Assign every student to a route and stop" />
      <KpiGrid cols={3}>
        <Stat icon="users" label="All students" value={list.data.total} sub={`${labels.length} class${labels.length === 1 ? '' : 'es'}`} onClick={() => setShow('all')} />
        <Stat icon="bus" label="On a bus" value={list.data.on_bus} sub="has at least one route" onClick={() => setShow('on')} />
        <Stat icon="pin" label="Not on a bus" value={list.data.total - list.data.on_bus} sub="no transport yet" onClick={() => setShow('off')} />
      </KpiGrid>
      <FilterBar q={q} onQ={setQ} placeholder="Search name, admission no., class or stop" count={rows.length}
        filters={[
          { key: 'show', label: 'Transport', value: show === 'all' ? '' : show, onChange: (v) => setShow(v || 'all'), all: 'Everyone', options: [{ value: 'on', label: 'On a bus' }, { value: 'off', label: 'Not on a bus' }] },
          { key: 'cls', label: 'Class', value: cls, onChange: setCls, all: 'All classes', options: labels.map((l) => ({ value: l, label: classText(l) })) },
          { key: 'route', label: 'Route', value: route, onChange: setRoute, all: 'All routes', options: routes.data.map((r) => ({ value: r.id, label: r.name })) },
        ]} />
      {rows.length === 0 ? <EmptyState icon="users" title={filtering ? 'No student matches' : 'No students yet'}>{filtering ? 'Try a different search or filter.' : 'No students in this school yet.'}</EmptyState> : groups.map((g) => {
        const onBus = g.items.filter((s) => s.rides.length).length;
        return (
          <ClassGroup key={g.label} label={g.label} count={g.items.length} open={!!dq} note={`${onBus} on bus`}>
            {g.items.map((s) => (
              <button key={s.student_id} type="button" className="tr-srow" style={{ '--c': hue(s.full_name) }} onClick={() => setOpenId(s.student_id)}>
                <span className="tr-av">{initials(s.full_name)}</span>
                <span className="tr-s-name"><b>{s.full_name}</b><small>{[s.roll_no && `Roll ${s.roll_no}`, s.admission_no && `Adm. ${s.admission_no}`].filter(Boolean).join(' · ') || s.login_id}</small></span>
                <span className="tr-s-rides">
                  {s.rides.length === 0 ? <StatusBadge tone="mute" dot={false}>Not on a bus</StatusBadge> : s.rides.map((x) => <Chip key={x.id} title={x.vehicle_name || ''}><i className="tr-d" style={{ background: hue(x.route_name) }} />{x.route_name} · {x.stop_name}</Chip>)}
                </span>
                <Icon name="chevron" size={17} />
              </button>
            ))}
          </ClassGroup>
        );
      })}
      {open && <RideEditor me={me} sid={sid} routes={routes.data} student={open} onClose={() => setOpenId('')} onChanged={refreshAll} />}
    </Page>
  );
});
