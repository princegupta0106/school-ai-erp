import React, { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useData, load } from '../cache.js';
import { Icon, Field, toast, initials, ROLE_LABEL, Loading, ask, groupByClass, ClassGroup, classText, Page, PageBar, Button, Section, List, ListRow, DataTable, StatusBadge, EmptyState, FormDialog, FormGrid, Notice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
import { fetchers } from '../fetchers.js';
import { TeachingCard, TeachingEditor, saveTeaching } from './TimetableModule.jsx';

const ROLES = ['school_admin', 'staff', 'parent', 'student', 'other'];
const refreshUsers = () => load('users', fetchers.users).catch(() => {});
// ---------- shared profile form
const JOB_ROLES = ['school_admin', 'staff', 'other'];
function ProfileFields({ f, setF, role, classes, canEdit = true, canSalary = false }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const d = !canEdit;
  const In = (k, label, type = 'text', full) => <Field full={full} label={label}><input type={type} value={f[k] || ''} onChange={set(k)} disabled={d} /></Field>;
  return (<>
    <div className="ds-label ds-full">Basic details</div>
    <Field full req label="Full name"><input required value={f.full_name || ''} onChange={set('full_name')} disabled={d} /></Field>
    {In('phone', 'Phone')}{In('email', 'Email')}
    {In('dob', 'Date of birth', 'date')}
    <Field label="Gender"><select value={f.gender || ''} onChange={set('gender')} disabled={d}><option value="">-</option><option>Male</option><option>Female</option><option>Other</option></select></Field>
    {In('blood_group', 'Blood group')}
    {In('emergency_contact_name', 'Emergency contact')}{In('emergency_contact_phone', 'Emergency phone')}
    <Field full label="Address"><textarea value={f.address || ''} onChange={set('address')} disabled={d} /></Field>
    {JOB_ROLES.includes(role) && (<>
      <div className="ds-label ds-full">Job details</div>
      {In('employee_id', 'Employee ID')}{In('designation', 'Designation (e.g. Maths teacher)')}
      {In('department', 'Department')}{In('qualification', 'Qualification')}
      {In('joining_date', 'Joining date', 'date')}
      {canSalary && <Field label="Monthly salary"><input type="number" min="0" step="0.01" value={f.salary ?? ''} onChange={set('salary')} disabled={d} /></Field>}
    </>)}
    {role === 'student' && (<>
      <div className="ds-label ds-full">School details</div>
      {In('admission_no', 'Admission no.')}
      <Field req label="Class" hint="Roll no. is given automatically"><select required value={f.class_id || ''} onChange={set('class_id')} disabled={d}><option value="">-</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}</select></Field>
      <div className="ds-label ds-full">Parents</div>
      {In('father_name', "Father's name")}{In('father_phone', "Father's phone")}
      {In('father_occupation', "Father's occupation")}<span />
      {In('mother_name', "Mother's name")}{In('mother_phone', "Mother's phone")}
      {In('mother_occupation', "Mother's occupation")}
    </>)}
  </>);
}
const PF = ['full_name', 'phone', 'email', 'dob', 'gender', 'address', 'admission_no', 'class_id', 'blood_group', 'emergency_contact_name', 'emergency_contact_phone',
  'father_name', 'mother_name', 'father_phone', 'mother_phone', 'father_occupation', 'mother_occupation', 'employee_id', 'designation', 'department', 'qualification', 'joining_date', 'salary'];
const pickProfile = (p) => Object.fromEntries(PF.map((k) => [k, p?.[k] ?? '']));

// "parent of": chips of linked students + a picker to add more
function ChildPicker({ options, value, onChange, names = {}, classes = [] }) {
  const clsLabel = (o) => { const c = classes.find((x) => x.id === o.profile.class_id); return c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : ''; };
  const [pick, setPick] = useState('');
  const nm = (id) => { const o = options.find((x) => x.user_id === id); return o ? (o.profile.full_name || o.login_id) : names[id] || 'Student'; };
  const free = options.filter((o) => !value.includes(o.user_id));
  return (
    <div className="ds-stack">
      <div className="ds-chips">{value.length === 0 && <span className="ds-hint">No students linked yet</span>}
        {value.map((id) => <span key={id} className="ds-fb-chip">{nm(id)} <button type="button" aria-label={`Remove ${nm(id)}`} onClick={() => onChange(value.filter((v) => v !== id))}><Icon name="x" size={13} /></button></span>)}</div>
      {options.length > 0 && <div className="ds-inline">
        <select aria-label="Add a student" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Add a student...</option>{groupByClass(free, clsLabel).map((g) => <optgroup key={g.label} label={classText(g.label)}>{g.items.map((o) => <option key={o.user_id} value={o.user_id}>{o.profile.full_name || o.login_id} ({o.login_id})</option>)}</optgroup>)}</select>
        <Button disabled={!pick} onClick={() => { onChange([...value, pick]); setPick(''); }}>Add</Button></div>}
    </div>
  );
}

function FeaturePicker({ me, role, value, onChange }) {
  const sup = me.role === 'super_admin';
  // role-restricted features (e.g. adjust_fees = admins only, view_my_fees = parents/students) show only for the right role
  const forRole = (x) => !x.roles || x.roles.includes(role);
  const canGrant = (x) => me.features.includes(x.key) || (x.roles && !x.roles.includes(me.role));
  return (<>{Object.entries(me.catalog).map(([k, m]) => {
    const list = m.features.filter((x) => canGrant(x) && forRole(x) && (!x.superOnly || sup));
    if (!list.length) return null;
    return (<div key={k}><div className="ds-label">{m.label}</div>
      <div className="ds-checks">{list.map((x) => (
        <label key={x.key} className="ds-check"><input type="checkbox" checked={value.includes(x.key)}
          onChange={(e) => onChange(e.target.checked ? [...value, x.key] : value.filter((v) => v !== x.key))} />{x.label}</label>))}</div></div>);
  })}</>);
}

// ---------- user drawer: every action is gated by a feature
function UserDrawer({ me, user: initial, onClose, classes, students = [] }) {
  const has = (f) => me.features.includes(f);
  const [user, setUser] = useState(initial);
  const [f, setF] = useState(pickProfile(initial.profile));
  const [feats, setFeats] = useState(initial.profile.features_permission || []);
  const [kids, setKids] = useState((initial.children || []).map((c) => c.user_id));
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const fileRef = useRef(); const [label, setLabel] = useState('');
  const self = user.user_id === me.user_id;

  React.useEffect(() => { if (has('get_user')) api.get(`/users/${initial.user_id}`).then((u) => { setUser(u); setF(pickProfile(u.profile)); setFeats(u.profile.features_permission || []); setKids((u.children || []).map((c) => c.user_id)); }).catch(() => {}); }, []); // eslint-disable-line

  const run = (name, fn, okMsg) => async (e) => {
    e?.preventDefault?.(); setBusy(name); setErr('');
    try { const r = await fn(); if (r?.user_id) { setUser(r); } await refreshUsers(); if (okMsg) toast(okMsg); return r; }
    catch (x) { setErr(x.message); } finally { setBusy(''); }
  };
  const saveProfile = run('p', () => api.patch(`/users/${user.user_id}`, { profile: f }), 'Profile saved');
  const saveKids = run('c', () => api.put(`/users/${user.user_id}/children`, { student_ids: kids }), 'Students linked');
  const saveRole = (role) => run('r', () => api.patch(`/users/${user.user_id}/role`, { role }), 'Role changed')();
  const saveFeats = run('f', () => api.patch(`/users/${user.user_id}/features`, { features_permission: feats }), 'Access updated');
  const toggle = run('a', () => api.patch(`/users/${user.user_id}`, { is_active: !user.is_active }), 'Updated');
  const reset = run('k', async () => { await api.post(`/users/${user.user_id}/reset-password`, { password: pw }); setPw(''); }, 'Password reset');
  const upload = run('u', async () => {
    const file = fileRef.current.files[0]; if (!file) throw new Error('Choose a file first');
    const fd = new FormData(); fd.append('file', file); fd.append('label', label);
    const r = await api.post(`/users/${user.user_id}/documents`, fd); fileRef.current.value = ''; setLabel(''); return r;
  }, 'Document uploaded');
  const delDoc = (id) => run('d', () => api.del(`/users/${user.user_id}/documents/${id}`), 'Document removed')();
  const remove = async () => {
    if (!(await ask(`Delete ${user.profile.full_name || user.login_id}? This cannot be undone.`))) return;
    try { await api.del(`/users/${user.user_id}`); await refreshUsers(); toast('User deleted'); onClose(); } catch (x) { setErr(x.message); }
  };
  const docs = user.profile.documents || [];

  return (
    <FormDialog noForm wide title={user.profile.full_name || user.login_id} sub={`ID: ${user.login_id}`} onClose={onClose}>
      <div className="ds-stack">
        <div className="ds-inline"><StatusBadge tone="info" dot={false}>{ROLE_LABEL[user.role]}</StatusBadge><StatusBadge tone={user.is_active ? 'ok' : 'bad'}>{user.is_active ? 'Active' : 'Off'}</StatusBadge></div>
        {err && <Notice tone="bad">{err}</Notice>}

        <Section title="Profile">
          <form onSubmit={saveProfile}>
            <FormGrid>
              <ProfileFields f={f} setF={setF} role={user.role} classes={classes.filter((c) => c.school_id === user.school_id)} canEdit={has('edit_user')} canSalary={has('manage_salary')} />
              {has('edit_user') && <div className="ds-full ds-inline"><Button type="submit" kind="primary" loading={busy === 'p'}>Save profile</Button></div>}
            </FormGrid>
          </form>
        </Section>

        {JOB_ROLES.includes(user.role) && user.school_id && (has('edit_user') || has('manage_timetable')) && <TeachingCard me={me} user={user} />}

        {user.role === 'parent' && (
          <Section title="Parent of" actions={has('edit_user') && <Button kind="primary" size="sm" loading={busy === 'c'} onClick={saveKids}>Save students</Button>}>
            <ChildPicker options={has('edit_user') ? students.filter((x) => x.school_id === user.school_id) : []} value={kids} onChange={setKids} classes={classes}
              names={Object.fromEntries((user.children || []).map((c) => [c.user_id, c.full_name || c.login_id]))} />
          </Section>)}
        {user.role === 'student' && (user.parents || []).length > 0 && (
          <Section title="Parents / guardians"><div className="ds-chips">{user.parents.map((p) => <StatusBadge key={p.user_id} tone="mute" dot={false}>{p.full_name || p.login_id}</StatusBadge>)}</div></Section>)}

        {has('change_role') && !self && user.role !== 'super_admin' && (
          <Section title="Role"><Field label="Role"><select value={user.role} onChange={(e) => saveRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field></Section>)}

        {has('change_features') && user.role !== 'super_admin' && (
          <Section title="Feature access" actions={user.role !== 'school_admin' && <Button kind="primary" size="sm" loading={busy === 'f'} onClick={saveFeats}>Save access</Button>}>
            {user.role === 'school_admin' ? <p className="ds-hint">School admins always have every feature of their school.</p> : <FeaturePicker me={me} role={user.role} value={feats} onChange={setFeats} />}
          </Section>)}

        {(docs.length > 0 || has('upload_document')) && (
          <Section title="Documents" flush={docs.length > 0}>
            {docs.length === 0 ? <p className="ds-hint">Nothing uploaded yet.</p> : (
              <List>{docs.map((d) => (
                <ListRow key={d.id} lead={<Icon name="file" />} title={<a href={d.url} target="_blank" rel="noreferrer">{d.label}</a>}>
                  {has('upload_document') && <Button kind="ghost" size="sm" icon="trash" aria-label={`Remove ${d.label}`} onClick={() => delDoc(d.id)} />}
                </ListRow>))}</List>)}
            {has('upload_document') && (
              <div className="ds-file-row">
                <Field label="Label"><input placeholder="e.g. Birth certificate" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
                <Field label="File"><input type="file" ref={fileRef} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" /></Field>
                <Button icon="upload" loading={busy === 'u'} onClick={upload}>Upload</Button>
              </div>)}
          </Section>)}

        {(has('reset_pass') || has('delete_user') || has('edit_user')) && (
          <Section title="Account">
            <div className="ds-stack">
              {has('reset_pass') && <div className="ds-inline"><input className="ds-grow" type="password" aria-label="New password" placeholder="New password (6+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /><Button icon="key" disabled={pw.length < 6} onClick={reset}>Reset password</Button></div>}
              <div className="ds-inline">
                {has('edit_user') && !self && <Button onClick={toggle}>{user.is_active ? 'Turn off account' : 'Turn on account'}</Button>}
                {has('delete_user') && !self && <Button kind="danger" icon="trash" onClick={remove}>Delete user</Button>}
              </div>
            </div>
          </Section>)}
      </div>
    </FormDialog>
  );
}

// ---------- list (or lookup when the person can only view one user at a time)
const activeBadge = (u) => <StatusBadge tone={u.is_active ? 'ok' : 'bad'}>{u.is_active ? 'Active' : 'Off'}</StatusBadge>;
export function UserList({ me }) {
  const canList = me.features.includes('get_all_users_school');
  const { data: users, error, refresh } = useData('users', fetchers.users, canList);
  const { data: classes = [] } = useData('classes', fetchers.classes, me.features.some((f) => ['get_all_users_school', 'get_user', 'create_user', 'edit_user'].includes(f)));
  const { data: schools } = useData('schools', fetchers.schools, me.role === 'super_admin');
  const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [school, setSchool] = useState('');
  const [open, setOpen] = useState(null); const [look, setLook] = useState(''); const [lerr, setLerr] = useState('');

  const rows = useMemo(() => (users || []).filter((u) => (!role || u.role === role) && (!school || u.school_id === school)
    && (!q || `${u.login_id} ${u.profile.full_name || ''} ${u.profile.phone || ''}`.toLowerCase().includes(q.toLowerCase()))), [users, q, role, school]);

  if (!canList) {
    const find = async (e) => { e.preventDefault(); setLerr(''); try { setOpen(await api.get(`/users/${encodeURIComponent(look.trim())}`)); } catch (x) { setLerr(x.message); } };
    return (
      <Page narrow>
        <PageBar title="Find a user" sub="Look someone up by their user ID" />
        {me.features.includes('get_user') ? (
          <Section>
            <form className="ds-inline" onSubmit={find}>
              <input className="ds-grow" aria-label="User ID" placeholder="User ID" value={look} onChange={(e) => setLook(e.target.value)} />
              <Button type="submit" kind="primary" disabled={!look.trim()}>Find user</Button>
            </form>
            {lerr && <Notice tone="bad">{lerr}</Notice>}
          </Section>
        ) : <Section><EmptyState icon="shield" title="No access">You can't view users with your current access.</EmptyState></Section>}
        {open && <UserDrawer me={me} user={open} classes={classes} students={(users || []).filter((x) => x.role === 'student')} onClose={() => setOpen(null)} />}
      </Page>
    );
  }
  if (error) return <Page><Notice tone="bad" action={<Button size="sm" onClick={refresh}>Retry</Button>}>{error}</Notice></Page>;
  if (!users) return <Loading />;
  const name = (u) => u.profile.full_name || u.login_id;
  const clsOf = (id) => { const c = classes.find((x) => x.id === id); return c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : ''; };
  const cols = [
    { key: 'name', label: 'Name', primary: true, render: (u) => <span className="ds-person"><span className="avatar">{initials(name(u))}</span>{name(u)}</span> },
    { key: 'login_id', label: 'ID' },
    { key: 'role', label: 'Role', render: (u) => ROLE_LABEL[u.role] },
    { key: 'phone', label: 'Phone', render: (u) => u.profile.phone || '-' },
    { key: 'is_active', label: 'Status', render: activeBadge },
  ];
  return (
    <Page>
      <PageBar title="Users" sub={`${rows.length} of ${users.length} user${users.length === 1 ? '' : 's'}`} />
      <FilterBar q={q} onQ={setQ} placeholder="Search name, ID or phone" count={rows.length}
        filters={[
          { key: 'role', label: 'Role', value: role, onChange: setRole, all: 'All roles', options: ['school_admin', 'staff', 'parent', 'student', 'other'].map((r) => ({ value: r, label: ROLE_LABEL[r] })) },
          me.role === 'super_admin' && schools && { key: 'school', label: 'School', value: school, onChange: setSchool, all: 'All schools', options: schools.map((x) => ({ value: x.id, label: x.name })) },
        ].filter(Boolean)} />
      {rows.length === 0 ? <Section><EmptyState icon="users" title="No users match">Try a different search or filter.</EmptyState></Section> : role === 'student' ? (
        groupByClass(rows, (u) => clsOf(u.profile.class_id)).map((g) => (
          <ClassGroup key={g.label} label={g.label} count={g.items.length} open={!!q}>
            <List>{g.items.map((u) => (
              <ListRow key={u.user_id} onClick={() => setOpen(u)} lead={<span className="avatar">{initials(name(u))}</span>} title={name(u)}
                sub={`${u.profile.roll_no ? `Roll ${u.profile.roll_no} - ` : ''}${u.login_id}`} meta={activeBadge(u)} />))}</List>
          </ClassGroup>))
      ) : (
        <Section flush><DataTable columns={cols} rows={rows} rowKey={(u) => u.user_id} onRowClick={setOpen} /></Section>
      )}
      {open && <UserDrawer me={me} user={open} classes={classes} students={(users || []).filter((x) => x.role === 'student')} onClose={() => setOpen(null)} />}
    </Page>
  );
}

// ---------- add user
export function UserAdd({ me, go }) {
  const { data: classes = [] } = useData('classes', fetchers.classes);
  const { data: schools } = useData('schools', fetchers.schools, me.role === 'super_admin');
  const [a, setA] = useState({ password: '', role: 'student', school_id: '' });
  const { data: all } = useData('users', fetchers.users, me.features.includes('get_all_users_school'));
  const [f, setF] = useState(pickProfile({})); const [feats, setFeats] = useState([]); const [kids, setKids] = useState([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [teach, setTeach] = useState([]);
  const [teaches, setTeaches] = useState(true);
  const sid = me.role === 'super_admin' ? a.school_id : me.school_id;
  const canTeach = JOB_ROLES.includes(a.role) && (me.features.includes('edit_user') || me.features.includes('manage_timetable'));
  // a teacher always starts with at least one class + subject (like a student always has a class)
  const mustTeach = canTeach && a.role === 'staff' && teaches;
  const save = async (e) => {
    e.preventDefault(); setErr('');
    if (mustTeach && teach.length === 0) { setErr('Add at least one class and subject this teacher teaches (under Teaching), or switch "This person teaches" off.'); return; }
    setBusy(true);
    try {
      const created = await api.post('/users', { ...a, profile: f, features_permission: feats, children: a.role === 'parent' ? kids : [] });
      let note = 'User created';
      if (canTeach && (teaches || a.role !== 'staff') && teach.length && created?.user_id) {
        try { await saveTeaching(me, sid, created.user_id, teach); } catch (x) { note = `User created, but teaching details were not saved (${x.message}). Add them from the profile.`; }
      }
      await refreshUsers(); toast(note); go('list');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Page narrow>
      <PageBar title="Add user" sub="Documents can be uploaded after the user is created" />
      <Section>
        <form onSubmit={save}>
          <FormGrid>
            <div className="ds-label ds-full">Sign-in</div>
            {me.role === 'super_admin' && <Field full req label="School"><select required value={a.school_id} onChange={(e) => setA({ ...a, school_id: e.target.value })}><option value="">Choose a school</option>{(schools || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
            <Field label="User ID" hint="Made automatically from the school, e.g. AF001"><input disabled readOnly value="Automatic" /></Field>
            <Field req label="Password" hint="At least 6 characters"><input required type="password" value={a.password} onChange={(e) => setA({ ...a, password: e.target.value })} autoComplete="new-password" /></Field>
            <Field full label="Role"><select value={a.role} onChange={(e) => setA({ ...a, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
            <ProfileFields f={f} setF={setF} role={a.role} classes={classes.filter((c) => c.school_id === sid)} canSalary={me.features.includes('manage_salary')} />
            {canTeach && (
              <div className="ds-full ds-stack"><div className="ds-label">Teaching (class + subject)</div>
                {a.role === 'staff' && <label className="ds-check"><input type="checkbox" checked={teaches} onChange={(e) => setTeaches(e.target.checked)} /><span>This person teaches (needs at least one class + subject)</span></label>}
                {(teaches || a.role !== 'staff') && (sid ? <TeachingEditor me={me} sid={sid} rows={teach} onChange={setTeach} /> : <p className="ds-hint">Choose a school first.</p>)}
                <p className="ds-note">{a.role === 'staff' ? 'Switch off for office staff, drivers and other non-teaching roles.' : 'Optional for this role.'}</p></div>)}
            {a.role === 'parent' && (
              <div className="ds-full ds-stack"><div className="ds-label">Parent of</div>
                <ChildPicker options={(all || []).filter((x) => x.role === 'student' && x.school_id === sid)} value={kids} onChange={setKids} classes={classes} /></div>)}
            {me.features.includes('change_features') && !['school_admin'].includes(a.role) && (<div className="ds-full ds-stack"><div className="ds-label">Feature access</div><FeaturePicker me={me} role={a.role} value={feats} onChange={setFeats} /></div>)}
            {err && <div className="ds-full"><Notice tone="bad">{err}</Notice></div>}
            <div className="ds-full ds-inline"><Button type="submit" kind="primary" loading={busy}>Create user</Button></div>
          </FormGrid>
        </form>
      </Section>
    </Page>
  );
}

// ---------- classes (needed for the student's class)
function ClassDialog({ me, schools, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', section: '', level: '', school_id: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.post('/classes', f); await load('classes', fetchers.classes); toast('Class added'); onSaved(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormDialog title="Add class" onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Add class">
      <FormGrid>
        {me.role === 'super_admin' && <Field full req label="School"><select required value={f.school_id} onChange={(e) => setF({ ...f, school_id: e.target.value })}><option value="">Choose a school</option>{(schools || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
        <Field req label="Class" hint="e.g. 5"><input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Section" hint="e.g. A"><input value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} /></Field>
        <Field full label="Order" hint="Used for year-end promotion: students move from order n to n+1"><input type="number" min="1" placeholder="1, 2, 3..." value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></Field>
      </FormGrid>
    </FormDialog>
  );
}

export function ClassManager({ me }) {
  const { data: classes, error, refresh } = useData('classes', fetchers.classes);
  const { data: schools } = useData('schools', fetchers.schools, me.role === 'super_admin');
  const [adding, setAdding] = useState(false);
  const del = async (id) => { if ((await ask('Delete this class? Students in it will have no class.'))) { await api.del(`/classes/${id}`).catch((x) => toast(x.message, true)); load('classes', fetchers.classes); } };
  const sName = (id) => (schools || []).find((s) => s.id === id)?.name;
  return (
    <Page narrow>
      <PageBar title="Classes" sub="Order decides promotion: at year end, students in order 5 move to order 6. Classes without an order are skipped."><Button kind="primary" icon="plus" onClick={() => setAdding(true)}>Add class</Button></PageBar>
      {error && <Notice tone="bad" action={<Button size="sm" onClick={refresh}>Retry</Button>}>{error}</Notice>}
      <Section flush>
        {!classes ? <Loading /> : classes.length === 0 ? <EmptyState icon="school" title="No classes yet">Add the first one with the button above.</EmptyState> : (
          <List>{classes.map((c) => (
            <ListRow key={c.id} title={`Class ${c.name} ${c.section || ''}`.trim()} sub={me.role === 'super_admin' ? sName(c.school_id) : undefined}>
              <input className="ds-input-sm" type="number" min="1" defaultValue={c.level ?? ''} placeholder="Order" aria-label={`Order for class ${c.name} ${c.section || ''}`}
                onBlur={async (e) => { if (String(c.level ?? '') !== e.target.value) { try { await api.patch(`/classes/${c.id}`, { level: e.target.value }); await load('classes', fetchers.classes); } catch (x) { toast(x.message, true); } } }} />
              <Button kind="ghost" size="sm" icon="trash" aria-label={`Delete class ${c.name} ${c.section || ''}`} onClick={() => del(c.id)} />
            </ListRow>))}</List>)}
      </Section>
      {adding && <ClassDialog me={me} schools={schools} onClose={() => setAdding(false)} onSaved={() => setAdding(false)} />}
    </Page>
  );
}
