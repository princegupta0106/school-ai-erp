import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useData, load } from '../cache.js';
import { Icon, Modal, Field, Badge, Empty, toast, Loading } from '../ui.jsx';
import { fetchers } from '../fetchers.js';

const refreshSchools = () => load('schools', fetchers.schools);

// school logo: upload a picture (no links)
function LogoField({ school, can, onChange }) {
  const ref = useRef(null); const [busy, setBusy] = useState(false); const [logo, setLogo] = useState(school.logo_url || '');
  const up = async () => {
    const file = ref.current.files[0]; if (!file) return;
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', file); const r = await api.post(`/schools/${school.id}/logo`, fd); setLogo(r.logo_url || ''); await refreshSchools(); toast('Logo saved'); onChange?.(); }
    catch (x) { toast(x.message, true); } finally { setBusy(false); ref.current.value = ''; }
  };
  const remove = async () => {
    setBusy(true);
    try { await api.del(`/schools/${school.id}/logo`); setLogo(''); await refreshSchools(); toast('Logo removed'); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  return (
    <Field label="School logo" hint="PNG, JPG or WebP, up to 4 MB">
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
        {logo ? <img src={logo} alt="School logo" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 10, border: '1px solid var(--line)', background: '#fff' }} /> : <span style={{ color: 'var(--mute)' }}>No logo yet</span>}
        {can && <>
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={up} />
          <button type="button" className="btn" disabled={busy} onClick={() => ref.current.click()}><Icon name="upload" size={16} />{busy ? '...' : logo ? 'Change logo' : 'Upload logo'}</button>
          {logo && <button type="button" className="btn" disabled={busy} onClick={remove}>Remove</button>}
        </>}
      </div>
    </Field>
  );
}

function SchoolForm({ school, me, onSaved }) {
  const can = me.features.includes('edit_school');
  const sup = me.role === 'super_admin';
  const [f, setF] = useState({ name: school.name || '', code: school.code || '', address: school.address || '', phone: school.phone || '', email: school.email || '', is_active: school.is_active });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const body = { ...f }; if (!sup) { delete body.code; delete body.is_active; } await api.patch(`/schools/${school.id}`, body); await refreshSchools(); toast('School saved'); onSaved(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="form" onSubmit={save}>
      <div className="full"><Field label="School name" req><input required value={f.name} onChange={set('name')} disabled={!can} /></Field></div>
      <Field label="Code" req={sup}><input value={f.code} onChange={set('code')} disabled={!can || !sup} /></Field>
      <Field label="Phone"><input value={f.phone} onChange={set('phone')} disabled={!can} /></Field>
      <div className="full"><Field label="Email"><input value={f.email} onChange={set('email')} disabled={!can} /></Field></div>
      <div className="full"><Field label="Address"><textarea value={f.address} onChange={set('address')} disabled={!can} /></Field></div>
      <div className="full"><LogoField school={school} can={can} /></div>
      {sup && can && <label className="check full"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />School is active (turning off blocks everyone in it from signing in)</label>}
      {err && <div className="err full">{err}</div>}
      {can && <button className="btn primary full" disabled={busy} style={{ justifyContent: 'center' }}>Save changes</button>}
    </form>
  );
}

export function SchoolList({ me }) {
  const { data, error } = useData('schools', fetchers.schools);
  const [open, setOpen] = useState(null);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <Loading />;
  if (!data.length) return <Empty>No schools yet.</Empty>;
  return (
    <>
      <div className="grid">{data.map((s) => (
        <button key={s.id} className="mod" onClick={() => setOpen(s)}>
          <b>{s.name}</b>
        </button>))}
      </div>
      {open && <Modal title={open.name} onClose={() => setOpen(null)}><SchoolForm key={open.id} school={open} me={me} onSaved={() => setOpen(null)} /></Modal>}
    </>
  );
}

export function SchoolNew({ go }) {
  const blank = { name: '', code: '', address: '', phone: '', email: '', admin: { password: '', full_name: '' } };
  const [f, setF] = useState(blank); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setA = (k) => (e) => setF({ ...f, admin: { ...f.admin, [k]: e.target.value } });
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post('/schools', f); await refreshSchools(); load('users', fetchers.users).catch(() => {}); toast('School and admin created'); go('list'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="card form" style={{ maxWidth: 760 }} onSubmit={save}>
      <div className="sec">School</div>
      <Field label="School name" req><input required value={f.name} onChange={set('name')} /></Field>
      <Field label="Code" req hint="Short unique name, e.g. dps-pune"><input required value={f.code} onChange={set('code')} /></Field>
      <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
      <Field label="Email"><input value={f.email} onChange={set('email')} /></Field>
      <div className="full"><Field label="Address"><textarea value={f.address} onChange={set('address')} /></Field></div>
      <div className="sec">School admin (gets every feature for this school)</div>
      <Field label="Admin name" req><input required value={f.admin.full_name} onChange={setA('full_name')} /></Field>
      <Field label="Admin login ID" hint="Made automatically, e.g. AF001"><input disabled value="Automatic" readOnly /></Field>
      <div className="full"><Field label="Admin password" req hint="At least 6 characters"><input required type="password" value={f.admin.password} onChange={setA('password')} autoComplete="new-password" /></Field></div>
      {err && <div className="err full">{err}</div>}
      <button className="btn primary full" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Creating...' : 'Create school'}</button>
    </form>
  );
}

// ---------- shared: which school are we working on? (super admin picks, everyone else = own school)
function useSchool(me) {
  const sup = me.role === 'super_admin';
  const { data: schools } = useData('schools', fetchers.schools, sup);
  const [pick, setPick] = useState('');
  const sid = sup ? (pick || schools?.[0]?.id || '') : me.school_id;
  const picker = sup && schools && (
    <select style={{ width: 'auto', maxWidth: '100%' }} value={sid} onChange={(e) => setPick(e.target.value)}>
      {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>);
  return { sid, picker };
}
const useSessions = (sid) => useData(`sessions:${sid}`, () => fetchers.sessions(sid), !!sid);
const useHolidays = (sid) => useData(`holidays:${sid}`, () => fetchers.holidays(sid), !!sid);
const fmt = (d) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const range = (h) => (h.start_date === h.end_date ? fmt(h.start_date) : `${fmt(h.start_date)} to ${fmt(h.end_date)}`);
const TYPE_LABEL = { holiday: 'Holiday', vacation: 'Vacation', event: 'Event', exam: 'Exam' };

// ---------- sessions + holidays
export function Calendar({ me }) {
  const { sid, picker } = useSchool(me);
  const edit = me.features.includes('manage_calendar');
  const { data: sessions } = useSessions(sid);
  const { data: holidays } = useHolidays(sid);
  const [sel, setSel] = useState(null);
  const [ns, setNs] = useState({ name: '', start_date: '', end_date: '' });
  const [nh, setNh] = useState({ title: '', start_date: '', end_date: '', type: 'holiday' });
  const [err, setErr] = useState('');
  if (!sid) return <Empty>Create a school first.</Empty>;
  if (!sessions || !holidays) return <Loading />;

  const current = sessions.find((s) => s.is_current);
  const active = sel ?? current?.id ?? '';
  const shown = holidays.filter((h) => !active || h.session_id === active);
  const reload = () => Promise.all([load(`sessions:${sid}`, () => fetchers.sessions(sid)), load(`holidays:${sid}`, () => fetchers.holidays(sid))]);
  const run = (fn, msg) => async (e) => { e?.preventDefault?.(); setErr(''); try { await fn(); await reload(); if (msg) toast(msg); } catch (x) { setErr(x.message); } };

  return (
    <div className="stack">
      {picker}
      {err && <div className="err">{err}</div>}
      <div className="card stack">
        <b>Sessions</b>
        {sessions.length === 0 && <span style={{ color: 'var(--mute)' }}>No session yet. Add the first one below, e.g. 2026-2027.</span>}
        <div>{sessions.map((s) => (
          <div key={s.id} className="doc">
            <b style={{ flex: 1 }}>{s.name} <small style={{ color: 'var(--mute)', fontWeight: 400 }}>{fmt(s.start_date)} to {fmt(s.end_date)}</small></b>
            {s.is_current && <Badge tone="ok">Current</Badge>}{s.promoted_at && <Badge>Promoted</Badge>}
            {edit && !s.is_current && <button className="btn" onClick={run(() => api.patch(`/calendar/sessions/${s.id}?school_id=${sid}`, { is_current: true }), 'Session changed')}>Make current</button>}
            {edit && !s.is_current && <button className="icon-btn" aria-label="Delete session" onClick={run(() => api.del(`/calendar/sessions/${s.id}?school_id=${sid}`))}><Icon name="trash" /></button>}
          </div>))}</div>
        {edit && <form className="row" onSubmit={run(async () => { await api.post(`/calendar/sessions?school_id=${sid}`, ns); setNs({ name: '', start_date: '', end_date: '' }); }, 'Session added')}>
          <input required style={{ flex: '1 1 130px' }} placeholder="2026-2027 *" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} />
          <input required type="date" style={{ flex: '1 1 140px' }} value={ns.start_date} onChange={(e) => setNs({ ...ns, start_date: e.target.value })} aria-label="Start date" />
          <input required type="date" style={{ flex: '1 1 140px' }} value={ns.end_date} onChange={(e) => setNs({ ...ns, end_date: e.target.value })} aria-label="End date" />
          <button className="btn"><Icon name="plus" size={16} />Add session</button></form>}
      </div>

      <div className="card stack">
        <div className="row sp"><b>Holidays and events</b>
          <select style={{ width: 'auto' }} value={active} onChange={(e) => setSel(e.target.value)}><option value="">All sessions</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        {shown.length === 0 ? <span style={{ color: 'var(--mute)' }}>Nothing added for this session.</span> : (
          <div>{shown.map((h) => (<div key={h.id} className="doc"><div style={{ flex: 1 }}><b>{h.title}</b><div style={{ color: 'var(--mute)', fontSize: 13 }}>{range(h)}</div></div>
            <Badge>{TYPE_LABEL[h.type]}</Badge>
            {edit && <button className="icon-btn" aria-label="Delete" onClick={run(() => api.del(`/calendar/holidays/${h.id}?school_id=${sid}`))}><Icon name="trash" /></button>}</div>))}</div>)}
        {edit && <form className="row" onSubmit={run(async () => { await api.post(`/calendar/holidays?school_id=${sid}`, { ...nh, session_id: active || undefined }); setNh({ title: '', start_date: '', end_date: '', type: 'holiday' }); }, 'Added')}>
          <input required style={{ flex: '2 1 160px' }} placeholder="Diwali break *" value={nh.title} onChange={(e) => setNh({ ...nh, title: e.target.value })} />
          <input required type="date" style={{ flex: '1 1 140px' }} value={nh.start_date} onChange={(e) => setNh({ ...nh, start_date: e.target.value })} aria-label="From" />
          <input type="date" style={{ flex: '1 1 140px' }} value={nh.end_date} min={nh.start_date} onChange={(e) => setNh({ ...nh, end_date: e.target.value })} aria-label="To (optional)" />
          <select style={{ flex: '1 1 110px' }} value={nh.type} onChange={(e) => setNh({ ...nh, type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn"><Icon name="plus" size={16} />Add</button></form>}
      </div>
    </div>
  );
}

// ---------- end of year: preview, then promote everyone one class up and open the next session
export function Promotion({ me }) {
  const { sid, picker } = useSchool(me);
  const { data: sessions } = useSessions(sid);
  const current = sessions?.find((s) => s.is_current);
  const [final, setFinal] = useState('deactivate');
  const [ns, setNs] = useState({ name: '', start_date: '', end_date: '' });
  const [plan, setPlan] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    setPlan(null);
    if (!current) return;
    const m = /(\d{4})\D+(\d{4})/.exec(current.name);
    const yr = (d) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
    setNs({ name: m ? `${+m[1] + 1}-${+m[2] + 1}` : '', start_date: yr(current.start_date), end_date: yr(current.end_date) });
  }, [current?.id]); // eslint-disable-line

  if (!sid) return <Empty>Create a school first.</Empty>;
  if (!sessions) return <Loading />;
  if (!current) return <Empty>Set a current session in "Sessions & holidays" first.</Empty>;

  const call = async (dry) => {
    setBusy(true); setErr('');
    try { return await api.post(`/schools/${sid}/promote`, { dry_run: dry, final_class_action: final, new_session: ns }); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const preview = async () => { const r = await call(true); if (r) setPlan(r); };
  const promote = async () => {
    if (!confirm(`Promote ${plan.moving + plan.graduating} students and start ${ns.name}? This cannot be undone.`)) return;
    const r = await call(false);
    if (r) { toast('Promotion done'); setPlan(null); await Promise.all([load(`sessions:${sid}`, () => fetchers.sessions(sid)), load('users', fetchers.users).catch(() => {})]); }
  };
  const same = plan && plan.session === current.name;

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      {picker}
      <div className="card form">
        <div className="sec">Closing session: {current.name}</div>
        <div className="full"><Field label="Students of the last class" hint="Last class = the highest class order you have set in Users > Classes">
          <select value={final} onChange={(e) => { setFinal(e.target.value); setPlan(null); }}><option value="deactivate">Mark as graduated and turn off their accounts</option><option value="keep">Mark as graduated, keep accounts on</option></select></Field></div>
        <div className="sec">Next session</div>
        <Field label="Name"><input value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} /></Field><span />
        <Field label="Starts"><input type="date" value={ns.start_date} onChange={(e) => setNs({ ...ns, start_date: e.target.value })} /></Field>
        <Field label="Ends"><input type="date" value={ns.end_date} onChange={(e) => setNs({ ...ns, end_date: e.target.value })} /></Field>
        {err && <div className="err full">{err}</div>}
        <button className="btn full" onClick={preview} disabled={busy} style={{ justifyContent: 'center' }}>Preview what will change</button>
      </div>

      {plan && same && (
        <div className="card stack">
          <b>{plan.moving} moving up, {plan.graduating} graduating{plan.unplaced ? `, ${plan.unplaced} skipped (no class or class order set)` : ''}</b>
          {plan.plan.length === 0 ? <span style={{ color: 'var(--mute)' }}>No students found in classes that have an order number.</span> : (
            <table><thead><tr><th>From</th><th>To</th><th>Students</th></tr></thead><tbody>
              {plan.plan.map((p, i) => <tr key={i}><td>{p.from_name} {p.from_section}</td><td>{p.to_name ? `${p.to_name} ${p.to_section}` : 'Graduates'}</td><td>{p.students}</td></tr>)}</tbody></table>)}
          <button className="btn primary" onClick={promote} disabled={busy || !ns.name || !ns.start_date || !ns.end_date} style={{ justifyContent: 'center' }}>Promote students and start {ns.name || 'next session'}</button>
        </div>)}
    </div>
  );
}
