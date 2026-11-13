import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useData, load } from '../cache.js';
import { Icon, Field, toast, Loading, ask, Page, PageBar, Button, Section, List, ListRow, StatusBadge, EmptyState, FormDialog, FormGrid, Notice, DataTable } from '../ui.jsx';
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
    <Field full label="School logo" hint="PNG, JPG or WebP, up to 4 MB">
      <div className="ds-logo-row">
        {logo ? <img className="ds-logo" src={logo} alt="School logo" /> : <span className="ds-hint">No logo yet</span>}
        {can && <>
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={up} />
          <Button size="sm" icon="upload" loading={busy} onClick={() => ref.current.click()}>{logo ? 'Change logo' : 'Upload logo'}</Button>
          {logo && <Button size="sm" kind="danger" disabled={busy} onClick={remove}>Remove</Button>}
        </>}
      </div>
    </Field>
  );
}

function SchoolForm({ school, me, onSaved, onClose }) {
  const can = me.features.includes('edit_school');
  const sup = me.role === 'super_admin';
  const [f, setF] = useState({ name: school.name || '', code: school.code || '', address: school.address || '', phone: school.phone || '', email: school.email || '', is_active: school.is_active });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setErr('');
    try { const body = { ...f }; if (!sup) { delete body.code; delete body.is_active; } await api.patch(`/schools/${school.id}`, body); await refreshSchools(); toast('School saved'); onSaved(); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormDialog title={school.name} onClose={onClose} onSubmit={save} busy={busy} error={err} hideFooter={!can} submitLabel="Save changes">
      <FormGrid>
        <Field full req label="School name"><input required value={f.name} onChange={set('name')} disabled={!can} /></Field>
        <Field label="Code" req={sup}><input value={f.code} onChange={set('code')} disabled={!can || !sup} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} disabled={!can} /></Field>
        <Field full label="Email"><input value={f.email} onChange={set('email')} disabled={!can} /></Field>
        <Field full label="Address"><textarea value={f.address} onChange={set('address')} disabled={!can} /></Field>
        <LogoField school={school} can={can} />
        {sup && can && <label className="ds-check ds-full"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />School is active (turning off blocks everyone in it from signing in)</label>}
      </FormGrid>
    </FormDialog>
  );
}

export function SchoolList({ me }) {
  const { data, error, refresh } = useData('schools', fetchers.schools);
  const [open, setOpen] = useState(null);
  if (error) return <Page><Notice tone="bad" action={refresh ? <Button size="sm" onClick={refresh}>Retry</Button> : null}>{error}</Notice></Page>;
  if (!data) return <Loading />;
  return (
    <Page>
      <PageBar title="Schools" sub={`${data.length} school${data.length === 1 ? '' : 's'}`} />
      <Section flush>
        {!data.length ? <EmptyState icon="school" title="No schools yet">Add the first one from New school.</EmptyState> : (
          <List>{data.map((s) => (
            <ListRow key={s.id} onClick={() => setOpen(s)} lead={s.logo_url ? <img className="ds-logo" src={s.logo_url} alt="" /> : <Icon name="school" />} title={s.name}
              sub={[s.code, s.phone].filter(Boolean).join(' - ') || undefined} meta={s.is_active === false ? <StatusBadge tone="bad">Inactive</StatusBadge> : null} />))}</List>)}
      </Section>
      {open && <SchoolForm key={open.id} school={open} me={me} onClose={() => setOpen(null)} onSaved={() => setOpen(null)} />}
    </Page>
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
    <Page narrow>
      <PageBar title="New school" sub="Creates the school and its first admin" />
      <Section>
        <form onSubmit={save}>
          <FormGrid>
            <div className="ds-label ds-full">School</div>
            <Field req label="School name"><input required value={f.name} onChange={set('name')} /></Field>
            <Field req label="Code" hint="Short unique name, e.g. dps-pune"><input required value={f.code} onChange={set('code')} /></Field>
            <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
            <Field label="Email"><input value={f.email} onChange={set('email')} /></Field>
            <Field full label="Address"><textarea value={f.address} onChange={set('address')} /></Field>
            <div className="ds-label ds-full">School admin (gets every feature for this school)</div>
            <Field req label="Admin name"><input required value={f.admin.full_name} onChange={setA('full_name')} /></Field>
            <Field label="Admin login ID" hint="Made automatically, e.g. AF001"><input disabled value="Automatic" readOnly /></Field>
            <Field full req label="Admin password" hint="At least 6 characters"><input required type="password" value={f.admin.password} onChange={setA('password')} autoComplete="new-password" /></Field>
            {err && <div className="ds-full"><Notice tone="bad">{err}</Notice></div>}
            <div className="ds-full ds-inline"><Button type="submit" kind="primary" loading={busy}>Create school</Button></div>
          </FormGrid>
        </form>
      </Section>
    </Page>
  );
}

// ---------- shared: which school are we working on? (super admin picks, everyone else = own school)
function useSchool(me) {
  const sup = me.role === 'super_admin';
  const { data: schools } = useData('schools', fetchers.schools, sup);
  const [pick, setPick] = useState('');
  const sid = sup ? (pick || schools?.[0]?.id || '') : me.school_id;
  const picker = sup && schools && (
    <select aria-label="School" value={sid} onChange={(e) => setPick(e.target.value)}>
      {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>);
  return { sid, picker };
}
const useSessions = (sid) => useData(`sessions:${sid}`, () => fetchers.sessions(sid), !!sid);
const useHolidays = (sid) => useData(`holidays:${sid}`, () => fetchers.holidays(sid), !!sid);
const fmt = (d) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const range = (h) => (h.start_date === h.end_date ? fmt(h.start_date) : `${fmt(h.start_date)} to ${fmt(h.end_date)}`);
const TYPE_LABEL = { holiday: 'Holiday', vacation: 'Vacation', event: 'Event', exam: 'Exam' };

function SessionDialog({ sid, onClose, onSaved }) {
  const [ns, setNs] = useState({ name: '', start_date: '', end_date: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setErr(''); try { await api.post(`/calendar/sessions?school_id=${sid}`, ns); toast('Session added'); onSaved(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormDialog title="Add session" onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Add session">
      <FormGrid>
        <Field full req label="Session name"><input autoFocus required placeholder="e.g. 2026-2027" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} /></Field>
        <Field req label="Starts"><input required type="date" value={ns.start_date} onChange={(e) => setNs({ ...ns, start_date: e.target.value })} /></Field>
        <Field req label="Ends"><input required type="date" value={ns.end_date} min={ns.start_date} onChange={(e) => setNs({ ...ns, end_date: e.target.value })} /></Field>
      </FormGrid>
    </FormDialog>
  );
}

function HolidayDialog({ sid, sessionId, onClose, onSaved }) {
  const [nh, setNh] = useState({ title: '', start_date: '', end_date: '', type: 'holiday' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setErr(''); try { await api.post(`/calendar/holidays?school_id=${sid}`, { ...nh, session_id: sessionId || undefined }); toast('Added'); onSaved(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormDialog title="Add holiday or event" onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Add">
      <FormGrid>
        <Field full req label="Title"><input autoFocus required placeholder="e.g. Diwali break" value={nh.title} onChange={(e) => setNh({ ...nh, title: e.target.value })} /></Field>
        <Field req label="From"><input required type="date" value={nh.start_date} onChange={(e) => setNh({ ...nh, start_date: e.target.value })} /></Field>
        <Field label="To (optional)"><input type="date" value={nh.end_date} min={nh.start_date} onChange={(e) => setNh({ ...nh, end_date: e.target.value })} /></Field>
        <Field full label="Type"><select value={nh.type} onChange={(e) => setNh({ ...nh, type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </FormGrid>
    </FormDialog>
  );
}

// ---------- sessions + holidays
export function Calendar({ me }) {
  const { sid, picker } = useSchool(me);
  const edit = me.features.includes('manage_calendar');
  const { data: sessions } = useSessions(sid);
  const { data: holidays } = useHolidays(sid);
  const [sel, setSel] = useState(null);
  const [dlg, setDlg] = useState(null); // 'session' | 'holiday'
  const [err, setErr] = useState('');
  if (!sid) return <Page><PageBar title="Sessions & holidays" /><Section><EmptyState icon="school" title="Create a school first" /></Section></Page>;
  if (!sessions || !holidays) return <Loading />;

  const current = sessions.find((s) => s.is_current);
  const active = sel ?? current?.id ?? '';
  const shown = holidays.filter((h) => !active || h.session_id === active);
  const reload = () => Promise.all([load(`sessions:${sid}`, () => fetchers.sessions(sid)), load(`holidays:${sid}`, () => fetchers.holidays(sid))]);
  const run = (fn, msg) => async () => { setErr(''); try { await fn(); await reload(); if (msg) toast(msg); } catch (x) { setErr(x.message); } };
  const delSession = (s) => async () => { if (await ask(`Delete session ${s.name}?`)) run(() => api.del(`/calendar/sessions/${s.id}?school_id=${sid}`))(); };
  const delHoliday = (h) => async () => { if (await ask(`Delete "${h.title}"?`)) run(() => api.del(`/calendar/holidays/${h.id}?school_id=${sid}`))(); };
  const saved = () => { setDlg(null); reload(); };

  return (
    <Page>
      <PageBar title="Sessions & holidays" sub="School years, holidays and events">{picker}</PageBar>
      {err && <Notice tone="bad">{err}</Notice>}
      <Section title="Sessions" flush actions={edit && <Button kind="primary" size="sm" icon="plus" onClick={() => setDlg('session')}>Add session</Button>}>
        {sessions.length === 0 ? <EmptyState icon="calendar" title="No session yet">Add the first one, e.g. 2026-2027.</EmptyState> : (
          <List>{sessions.map((s) => (
            <ListRow key={s.id} title={s.name} sub={`${fmt(s.start_date)} to ${fmt(s.end_date)}`} meta={<>{s.is_current && <StatusBadge tone="ok">Current</StatusBadge>}{s.promoted_at && <StatusBadge tone="mute">Promoted</StatusBadge>}</>}>
              {edit && !s.is_current && <span className="ds-inline">
                <Button size="sm" onClick={run(() => api.patch(`/calendar/sessions/${s.id}?school_id=${sid}`, { is_current: true }), 'Session changed')}>Make current</Button>
                <Button kind="ghost" size="sm" icon="trash" aria-label={`Delete session ${s.name}`} onClick={delSession(s)} />
              </span>}
            </ListRow>))}</List>)}
      </Section>

      <Section title="Holidays and events" flush
        actions={<>
          <select aria-label="Session" value={active} onChange={(e) => setSel(e.target.value)}><option value="">All sessions</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          {edit && <Button kind="primary" size="sm" icon="plus" onClick={() => setDlg('holiday')}>Add</Button>}
        </>}>
        {shown.length === 0 ? <EmptyState icon="calendar" title="Nothing added for this session" /> : (
          <List>{shown.map((h) => (
            <ListRow key={h.id} title={h.title} sub={range(h)} meta={<StatusBadge tone="info" dot={false}>{TYPE_LABEL[h.type]}</StatusBadge>}>
              {edit && <Button kind="ghost" size="sm" icon="trash" aria-label={`Delete ${h.title}`} onClick={delHoliday(h)} />}
            </ListRow>))}</List>)}
      </Section>
      {dlg === 'session' && <SessionDialog sid={sid} onClose={() => setDlg(null)} onSaved={saved} />}
      {dlg === 'holiday' && <HolidayDialog sid={sid} sessionId={active} onClose={() => setDlg(null)} onSaved={saved} />}
    </Page>
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

  if (!sid) return <Page><PageBar title="Promotion" /><Section><EmptyState icon="school" title="Create a school first" /></Section></Page>;
  if (!sessions) return <Loading />;
  if (!current) return <Page><PageBar title="Promotion">{picker}</PageBar><Section><EmptyState icon="calendar" title="No current session">Set a current session in Sessions &amp; holidays first.</EmptyState></Section></Page>;

  const call = async (dry) => {
    setBusy(true); setErr('');
    try { return await api.post(`/schools/${sid}/promote`, { dry_run: dry, final_class_action: final, new_session: ns }); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const preview = async () => { const r = await call(true); if (r) setPlan(r); };
  const promote = async () => {
    if (!(await ask(`Promote ${plan.moving + plan.graduating} students and start ${ns.name}? This cannot be undone.`, { danger: false, yes: 'Promote' }))) return;
    const r = await call(false);
    if (r) { toast('Promotion done'); setPlan(null); await Promise.all([load(`sessions:${sid}`, () => fetchers.sessions(sid)), load('users', fetchers.users).catch(() => {})]); }
  };
  const same = plan && plan.session === current.name;

  return (
    <Page>
      <PageBar title="Promotion" sub={`End of year: move everyone one class up and open the next session`}>{picker}</PageBar>
      <Section title={`Closing session: ${current.name}`}>
        <FormGrid>
          <Field full label="Students of the last class" hint="Last class = the highest class order you have set in Users > Classes">
            <select value={final} onChange={(e) => { setFinal(e.target.value); setPlan(null); }}><option value="deactivate">Mark as graduated and turn off their accounts</option><option value="keep">Mark as graduated, keep accounts on</option></select></Field>
          <div className="ds-label ds-full">Next session</div>
          <Field full label="Name"><input value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} /></Field>
          <Field label="Starts"><input type="date" value={ns.start_date} onChange={(e) => setNs({ ...ns, start_date: e.target.value })} /></Field>
          <Field label="Ends"><input type="date" value={ns.end_date} onChange={(e) => setNs({ ...ns, end_date: e.target.value })} /></Field>
          {err && <div className="ds-full"><Notice tone="bad">{err}</Notice></div>}
          <div className="ds-full ds-inline"><Button kind="primary" loading={busy} onClick={preview}>Preview what will change</Button></div>
        </FormGrid>
      </Section>

      {plan && same && (
        <Section title={`${plan.moving} moving up, ${plan.graduating} graduating`} sub={plan.unplaced ? `${plan.unplaced} skipped (no class or class order set)` : undefined} flush
          actions={<Button kind="primary" size="sm" disabled={busy || !ns.name || !ns.start_date || !ns.end_date} onClick={promote}>{`Promote and start ${ns.name || 'next session'}`}</Button>}>
          <DataTable dense rowKey={(r, i) => i} empty={<EmptyState icon="users" title="No students to move">No students were found in classes that have an order number.</EmptyState>}
            columns={[
              { key: 'from', label: 'From', primary: true, render: (p) => `${p.from_name} ${p.from_section}` },
              { key: 'to', label: 'To', render: (p) => (p.to_name ? `${p.to_name} ${p.to_section}` : 'Graduates') },
              { key: 'students', label: 'Students', align: 'right' },
            ]} rows={plan.plan} />
        </Section>)}
    </Page>
  );
}
