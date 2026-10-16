// School module for mobile. Mirrors client/src/modules/SchoolModule.jsx (same endpoints and rules).
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { api } from '../api';
import { C, fmt, ymd } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Sheet, Choice, Input, Field, Check, DateField, Press, toast, confirmAsk } from '../ui';
import { useApi } from '../useApi';
import { useSchoolId } from '../useSchool';
import { Pad, List, Row } from './Attendance';

const Gap = ({ h = 12 }) => <View style={{ height: h }} />;
const Chip = ({ children, tone }) => <Text style={{ fontSize: 11, fontWeight: '700', color: tone === 'ok' ? C.ok : tone === 'bad' ? C.bad : C.mute, backgroundColor: tone === 'ok' ? C.okBg : tone === 'bad' ? C.badBg : C.card2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{children}</Text>;
const Sec = ({ children }) => <Text style={{ fontSize: 12, fontWeight: '700', color: C.mute, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 }}>{children}</Text>;
const range = (h) => (h.start_date === h.end_date ? fmt(h.start_date) : `${fmt(h.start_date)} to ${fmt(h.end_date)}`);
const TYPE_LABEL = { holiday: 'Holiday', vacation: 'Vacation', event: 'Event', exam: 'Exam' };
const qsOf = (sid) => `?school_id=${sid}`;

function OptDate({ value, onChange, min }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1 }}>{value ? <DateField value={value} min={min} onChange={onChange} /> : <Btn small kind="ghost" title="Set date" onPress={() => onChange(min || ymd(new Date()))} />}</View>
      {value ? <Btn small kind="ghost" title="Clear" onPress={() => onChange('')} /> : null}
    </View>
  );
}

/* ================================================================== SCHOOLS (list + edit) */
function SchoolForm({ school, me, onSaved }) {
  const can = me.features.includes('edit_school'); const sup = me.role === 'super_admin';
  const [f, setF] = useState({ name: school.name || '', code: school.code || '', address: school.address || '', phone: school.phone || '', email: school.email || '', logo_url: school.logo_url || '', is_active: school.is_active });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try { const body = { ...f }; if (!sup) { delete body.code; delete body.is_active; } await api.patch(`/schools/${school.id}`, body); toast('School saved'); onSaved(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const ro = !can;
  return (<>
    <Field label="School name"><Input value={f.name} onChangeText={set('name')} editable={!ro} /></Field>
    <Field label="Code"><Input autoCapitalize="none" value={f.code} onChangeText={set('code')} editable={!ro && sup} /></Field>
    <Field label="Phone"><Input keyboardType="phone-pad" value={f.phone} onChangeText={set('phone')} editable={!ro} /></Field>
    <Field label="Email"><Input autoCapitalize="none" keyboardType="email-address" value={f.email} onChangeText={set('email')} editable={!ro} /></Field>
    <Field label="Address"><Input multiline value={f.address} onChangeText={set('address')} editable={!ro} /></Field>
    <Field label="Logo URL"><Input autoCapitalize="none" value={f.logo_url} onChangeText={set('logo_url')} editable={!ro} /></Field>
    {sup && can && <Check label="School is active (turning off blocks everyone in it from signing in)" value={f.is_active} onChange={set('is_active')} />}
    <ErrorBox>{err}</ErrorBox>
    {can && <Btn title={busy ? 'Saving...' : 'Save changes'} onPress={save} disabled={busy || !f.name.trim()} />}
  </>);
}

export function SchoolList({ me }) {
  const { data, error, loading, reload } = useApi('/schools');
  const [open, setOpen] = useState(null);
  if (error && !data) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!data) return <Pad><Loading /></Pad>;
  if (!data.length) return <Pad><Empty>No schools yet.</Empty></Pad>;
  return (
    <Pad reload={reload} loading={loading} hasData>
      {data.map((s) => (
        <Press key={s.id} onPress={() => setOpen(s)} style={{ backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line, marginBottom: 10 }}>
          <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink }}>{s.name}</Text>
          <Dim style={{ marginTop: 2 }}>{s.address || 'No address added'}</Dim>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}><Chip tone={s.is_active ? 'ok' : 'bad'}>{s.is_active ? 'Active' : 'Off'}</Chip><Dim>code: {s.code}</Dim></View>
        </Press>))}
      {open && <Sheet title={open.name} onClose={() => setOpen(null)}><SchoolForm key={open.id} school={open} me={me} onSaved={() => { setOpen(null); reload(); }} /></Sheet>}
    </Pad>
  );
}

/* ================================================================== CREATE SCHOOL */
export function SchoolNew({ go }) {
  const blank = { name: '', code: '', address: '', phone: '', email: '', admin: { login_id: '', password: '', full_name: '' } };
  const [f, setF] = useState(blank); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const setA = (k) => (v) => setF((p) => ({ ...p, admin: { ...p.admin, [k]: v } }));
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.post('/schools', f); toast('School and admin created'); setF(blank); go?.('list'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Pad>
      <Card>
        <Sec>School</Sec>
        <Field label="School name"><Input value={f.name} onChangeText={set('name')} /></Field>
        <Field label="Code" hint="Short unique name, e.g. dps-pune"><Input autoCapitalize="none" value={f.code} onChangeText={set('code')} /></Field>
        <Field label="Phone"><Input keyboardType="phone-pad" value={f.phone} onChangeText={set('phone')} /></Field>
        <Field label="Email"><Input autoCapitalize="none" keyboardType="email-address" value={f.email} onChangeText={set('email')} /></Field>
        <Field label="Address"><Input multiline value={f.address} onChangeText={set('address')} /></Field>
        <Sec>School admin (gets every feature for this school)</Sec>
        <Field label="Admin name"><Input value={f.admin.full_name} onChangeText={setA('full_name')} /></Field>
        <Field label="Admin login ID"><Input autoCapitalize="none" autoCorrect={false} value={f.admin.login_id} onChangeText={setA('login_id')} /></Field>
        <Field label="Admin password" hint="At least 6 characters"><Input secureTextEntry autoCapitalize="none" value={f.admin.password} onChangeText={setA('password')} /></Field>
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Creating...' : 'Create school'} onPress={save} disabled={busy || !f.name.trim() || !f.code.trim() || !f.admin.login_id.trim() || f.admin.password.length < 6} />
      </Card>
    </Pad>
  );
}

/* ================================================================== SESSIONS + HOLIDAYS */
export function Calendar({ me }) {
  const { sid, picker } = useSchoolId(me);
  const edit = me.features.includes('manage_calendar');
  const { data: sessions, error: e1, loading, reload: r1 } = useApi(sid ? `/calendar/sessions${qsOf(sid)}` : null);
  const { data: holidays, error: e2, reload: r2 } = useApi(sid ? `/calendar/holidays${qsOf(sid)}` : null);
  const [sel, setSel] = useState(null); const [err, setErr] = useState('');
  const today = ymd(new Date());
  const [ns, setNs] = useState({ name: '', start_date: today, end_date: today });
  const [nh, setNh] = useState({ title: '', start_date: today, end_date: '', type: 'holiday' });
  if (!sid) return <Pad><Empty>Create a school first.</Empty></Pad>;
  if ((e1 || e2) && !sessions) return <Pad>{picker}<ErrorBox>{e1 || e2}</ErrorBox></Pad>;
  if (!sessions || !holidays) return <Pad>{picker}<Loading /></Pad>;

  const current = sessions.find((s) => s.is_current);
  const active = sel ?? current?.id ?? '';
  const shown = holidays.filter((h) => !active || h.session_id === active);
  const reload = () => Promise.all([r1(), r2()]);
  const run = (fn, msg) => async () => { setErr(''); try { await fn(); await reload(); if (msg) toast(msg); } catch (x) { setErr(x.message); } };
  const delSession = (s) => confirmAsk(`Delete session ${s.name}?`, run(() => api.del(`/calendar/sessions/${s.id}${qsOf(sid)}`)));
  const delHoliday = (h) => confirmAsk(`Delete "${h.title}"?`, run(() => api.del(`/calendar/holidays/${h.id}${qsOf(sid)}`)));

  return (
    <Pad reload={reload} loading={loading} hasData>
      {picker}
      <ErrorBox>{err}</ErrorBox>
      <Card>
        <Text style={{ fontWeight: '800', color: C.ink, fontSize: 16, marginBottom: 6 }}>Sessions</Text>
        {sessions.length === 0 && <Dim>No session yet. Add the first one below, e.g. 2026-2027.</Dim>}
        {sessions.map((s) => (
          <View key={s.id} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: C.line, marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.ink }}>{s.name}</Text><Dim>{fmt(s.start_date)} to {fmt(s.end_date)}</Dim></View>
              {s.is_current ? <Chip tone="ok">Current</Chip> : null}{s.promoted_at ? <Chip>Promoted</Chip> : null}
              {edit && !s.is_current && <Pressable hitSlop={8} onPress={() => delSession(s)}><Icon name="trash" size={19} color={C.bad} /></Pressable>}
            </View>
            {edit && !s.is_current && <View style={{ alignSelf: 'flex-start', marginTop: 8 }}><Btn small kind="ghost" title="Make current" onPress={run(() => api.patch(`/calendar/sessions/${s.id}${qsOf(sid)}`, { is_current: true }), 'Session changed')} /></View>}
          </View>))}
        {edit && (<>
          <View style={{ borderTopWidth: 1, borderColor: C.line, marginTop: 10, paddingTop: 12 }}>
            <Field label="New session"><Input value={ns.name} onChangeText={(t) => setNs({ ...ns, name: t })} placeholder="2026-2027" /></Field>
            <Field label="Starts"><DateField value={ns.start_date} onChange={(v) => setNs({ ...ns, start_date: v })} /></Field>
            <Field label="Ends"><DateField value={ns.end_date} min={ns.start_date} onChange={(v) => setNs({ ...ns, end_date: v })} /></Field>
            <Btn title="Add session" disabled={!ns.name.trim()} onPress={run(async () => { await api.post(`/calendar/sessions${qsOf(sid)}`, ns); setNs({ name: '', start_date: today, end_date: today }); }, 'Session added')} />
          </View>
        </>)}
      </Card>

      <Card>
        <Text style={{ fontWeight: '800', color: C.ink, fontSize: 16, marginBottom: 8 }}>Holidays and events</Text>
        <Choice value={active} onChange={setSel} options={[{ value: '', label: 'All sessions' }, ...sessions.map((s) => ({ value: s.id, label: s.name }))]} />
        {shown.length === 0 ? <Dim style={{ marginTop: 10 }}>Nothing added for this session.</Dim> : shown.map((h) => (
          <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderTopWidth: 1, borderColor: C.line, marginTop: 10 }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.ink }}>{h.title}</Text><Dim>{range(h)}</Dim></View>
            <Chip>{TYPE_LABEL[h.type]}</Chip>
            {edit && <Pressable hitSlop={8} onPress={() => delHoliday(h)}><Icon name="trash" size={19} color={C.bad} /></Pressable>}
          </View>))}
        {edit && (
          <View style={{ borderTopWidth: 1, borderColor: C.line, marginTop: 10, paddingTop: 12 }}>
            <Field label="Add holiday / event"><Input value={nh.title} onChangeText={(t) => setNh({ ...nh, title: t })} placeholder="Diwali break" /></Field>
            <Field label="From"><DateField value={nh.start_date} onChange={(v) => setNh({ ...nh, start_date: v, end_date: nh.end_date && nh.end_date < v ? '' : nh.end_date })} /></Field>
            <Field label="To (optional)"><OptDate value={nh.end_date} min={nh.start_date} onChange={(v) => setNh({ ...nh, end_date: v })} /></Field>
            <Field label="Type"><Choice value={nh.type} onChange={(v) => setNh({ ...nh, type: v })} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
            <Btn title="Add" disabled={!nh.title.trim()} onPress={run(async () => { await api.post(`/calendar/holidays${qsOf(sid)}`, { ...nh, end_date: nh.end_date || undefined, session_id: active || undefined }); setNh({ title: '', start_date: today, end_date: '', type: 'holiday' }); }, 'Added')} />
          </View>)}
      </Card>
    </Pad>
  );
}

/* ================================================================== PROMOTION (end of year) */
export function Promotion({ me }) {
  const { sid, picker } = useSchoolId(me);
  const { data: sessions, error } = useApi(sid ? `/calendar/sessions${qsOf(sid)}` : null);
  const current = sessions?.find((s) => s.is_current);
  const [final, setFinal] = useState('deactivate');
  const [ns, setNs] = useState({ name: '', start_date: '', end_date: '' });
  const [plan, setPlan] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlan(null);
    if (!current) return;
    const m = /(\d{4})\D+(\d{4})/.exec(current.name);
    const yr = (d) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
    setNs({ name: m ? `${+m[1] + 1}-${+m[2] + 1}` : '', start_date: yr(current.start_date), end_date: yr(current.end_date) });
  }, [current?.id]); // eslint-disable-line

  if (!sid) return <Pad><Empty>Create a school first.</Empty></Pad>;
  if (error && !sessions) return <Pad>{picker}<ErrorBox>{error}</ErrorBox></Pad>;
  if (!sessions) return <Pad>{picker}<Loading /></Pad>;
  if (!current) return <Pad>{picker}<Empty>Set a current session in "Sessions & holidays" first.</Empty></Pad>;

  const call = async (dry) => {
    setBusy(true); setErr('');
    try { return await api.post(`/schools/${sid}/promote`, { dry_run: dry, final_class_action: final, new_session: ns }); }
    catch (x) { setErr(x.message); return null; } finally { setBusy(false); }
  };
  const preview = async () => { const r = await call(true); if (r) setPlan(r); };
  const promote = () => confirmAsk(`Promote ${plan.moving + plan.graduating} students and start ${ns.name}? This cannot be undone.`, async () => {
    const r = await call(false);
    if (r) { toast('Promotion done'); setPlan(null); }
  });
  const same = plan && plan.session === current.name;

  return (
    <Pad>
      {picker}
      <Card>
        <Sec>Closing session: {current.name}</Sec>
        <Field label="Students of the last class" hint="Last class = the highest class order you have set in Users > Classes">
          <Choice value={final} onChange={(v) => { setFinal(v); setPlan(null); }} options={[{ value: 'deactivate', label: 'Graduate + turn off accounts' }, { value: 'keep', label: 'Graduate, keep accounts on' }]} />
        </Field>
        <Sec>Next session</Sec>
        <Field label="Name"><Input value={ns.name} onChangeText={(t) => setNs({ ...ns, name: t })} /></Field>
        <Field label="Starts">{ns.start_date ? <DateField value={ns.start_date} onChange={(v) => setNs({ ...ns, start_date: v })} /> : <Dim>-</Dim>}</Field>
        <Field label="Ends">{ns.end_date ? <DateField value={ns.end_date} onChange={(v) => setNs({ ...ns, end_date: v })} /> : <Dim>-</Dim>}</Field>
        <ErrorBox>{err}</ErrorBox>
        <Btn kind="ghost" title="Preview what will change" onPress={preview} disabled={busy} />
      </Card>

      {plan && same && (
        <Card>
          <Text style={{ fontWeight: '800', color: C.ink }}>{plan.moving} moving up, {plan.graduating} graduating{plan.unplaced ? `, ${plan.unplaced} skipped (no class or class order set)` : ''}</Text>
          {plan.plan.length === 0 ? <Dim style={{ marginTop: 8 }}>No students found in classes that have an order number.</Dim> : plan.plan.map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderColor: C.line, marginTop: 8 }}>
              <Text style={{ flex: 1, color: C.ink }}>{p.from_name} {p.from_section}  →  {p.to_name ? `${p.to_name} ${p.to_section}` : 'Graduates'}</Text>
              <Text style={{ fontWeight: '700', color: C.ink }}>{p.students}</Text>
            </View>))}
          <Gap />
          <Btn title={`Promote students and start ${ns.name || 'next session'}`} onPress={promote} disabled={busy || !ns.name || !ns.start_date || !ns.end_date} />
        </Card>)}
    </Pad>
  );
}
