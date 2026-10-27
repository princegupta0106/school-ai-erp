import React, { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useData, load } from '../cache.js';
import { Icon, Modal, Field, Badge, Empty, toast, initials, ROLE_LABEL, Loading, ask } from '../ui.jsx';
import { fetchers } from '../fetchers.js';

const ROLES = ['school_admin', 'staff', 'parent', 'student', 'other'];
const refreshUsers = () => load('users', fetchers.users).catch(() => {});
// ---------- shared profile form
const JOB_ROLES = ['school_admin', 'staff', 'other'];
function ProfileFields({ f, setF, role, classes, canEdit = true, canSalary = false }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const d = !canEdit;
  const In = (k, label, type = 'text') => <Field label={label}><input type={type} value={f[k] || ''} onChange={set(k)} disabled={d} /></Field>;
  return (<>
    <div className="sec">Basic details</div>
    <div className="full"><Field label="Full name" req><input required value={f.full_name || ''} onChange={set('full_name')} disabled={d} /></Field></div>
    {In('phone', 'Phone')}{In('email', 'Email')}
    {In('dob', 'Date of birth', 'date')}
    <Field label="Gender"><select value={f.gender || ''} onChange={set('gender')} disabled={d}><option value="">-</option><option>Male</option><option>Female</option><option>Other</option></select></Field>
    {In('blood_group', 'Blood group')}<span />
    {In('emergency_contact_name', 'Emergency contact')}{In('emergency_contact_phone', 'Emergency phone')}
    <div className="full"><Field label="Address"><textarea value={f.address || ''} onChange={set('address')} disabled={d} /></Field></div>
    {JOB_ROLES.includes(role) && (<>
      <div className="sec">Job details</div>
      {In('employee_id', 'Employee ID')}{In('designation', 'Designation (e.g. Maths teacher)')}
      {In('department', 'Department')}{In('qualification', 'Qualification')}
      {In('joining_date', 'Joining date', 'date')}
      {canSalary && <Field label="Monthly salary"><input type="number" min="0" step="0.01" value={f.salary ?? ''} onChange={set('salary')} disabled={d} /></Field>}
    </>)}
    {role === 'student' && (<>
      <div className="sec">School details</div>
      {In('admission_no', 'Admission no.')}<span />
      <div className="full"><Field label="Class" req hint="Roll no. is given automatically"><select required value={f.class_id || ''} onChange={set('class_id')} disabled={d}><option value="">-</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}</select></Field></div>
      <div className="sec">Parents</div>
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
function ChildPicker({ options, value, onChange, names = {} }) {
  const [pick, setPick] = useState('');
  const nm = (id) => { const o = options.find((x) => x.user_id === id); return o ? (o.profile.full_name || o.login_id) : names[id] || 'Student'; };
  const free = options.filter((o) => !value.includes(o.user_id));
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="pills">{value.length === 0 && <span style={{ color: 'var(--mute)' }}>No students linked yet</span>}
        {value.map((id) => <span key={id} className="pill on">{nm(id)} <button type="button" className="icon-btn" style={{ display: 'inline-grid', padding: 0, color: 'inherit' }} aria-label="Remove" onClick={() => onChange(value.filter((v) => v !== id))}>x</button></span>)}</div>
      {options.length > 0 && <div className="row">
        <select style={{ flex: 1 }} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Add a student...</option>{free.map((o) => <option key={o.user_id} value={o.user_id}>{o.profile.full_name || o.login_id} ({o.login_id})</option>)}</select>
        <button type="button" className="btn" disabled={!pick} onClick={() => { onChange([...value, pick]); setPick(''); }}>Add</button></div>}
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
    return (<div key={k}><div className="sec" style={{ margin: '6px 0 8px' }}>{m.label}</div>
      <div className="checks">{list.map((x) => (
        <label key={x.key} className="check"><input type="checkbox" checked={value.includes(x.key)}
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
    <Modal wide title={user.profile.full_name || user.login_id} onClose={onClose}>
      <div className="row"><Badge>{ROLE_LABEL[user.role]}</Badge><Badge tone={user.is_active ? 'ok' : 'off'}>{user.is_active ? 'Active' : 'Off'}</Badge><span style={{ color: 'var(--mute)' }}>ID: {user.login_id}</span></div>
      {err && <div className="err">{err}</div>}

      <form className="card form" onSubmit={saveProfile}>
        <ProfileFields f={f} setF={setF} role={user.role} classes={classes.filter((c) => c.school_id === user.school_id)} canEdit={has('edit_user')} canSalary={has('manage_salary')} />
        {has('edit_user') && <button className="btn primary full" disabled={busy === 'p'} style={{ justifyContent: 'center' }}>Save profile</button>}
      </form>

      {user.role === 'parent' && (
        <div className="card stack"><b>Parent of</b>
          <ChildPicker options={has('edit_user') ? students.filter((x) => x.school_id === user.school_id) : []} value={kids} onChange={setKids}
            names={Object.fromEntries((user.children || []).map((c) => [c.user_id, c.full_name || c.login_id]))} />
          {has('edit_user') && <button className="btn primary" onClick={saveKids} disabled={busy === 'c'}>Save students</button>}
        </div>)}
      {user.role === 'student' && (user.parents || []).length > 0 && (
        <div className="card stack"><b>Parents / guardians</b><div className="pills">{user.parents.map((p) => <span key={p.user_id} className="pill">{p.full_name || p.login_id}</span>)}</div></div>)}

      {has('change_role') && !self && user.role !== 'super_admin' && (
        <div className="card"><Field label="Role"><select value={user.role} onChange={(e) => saveRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field></div>)}

      {has('change_features') && user.role !== 'super_admin' && (
        <div className="card stack">
          <b>Feature access</b>
          {user.role === 'school_admin' ? <span style={{ color: 'var(--mute)' }}>School admins always have every feature of their school.</span> : (<>
            <FeaturePicker me={me} role={user.role} value={feats} onChange={setFeats} />
            <button className="btn primary" onClick={saveFeats} disabled={busy === 'f'}>Save access</button></>)}
        </div>)}

      {(docs.length > 0 || has('upload_document')) && (
        <div className="card stack">
          <b>Documents</b>
          {docs.length === 0 && <span style={{ color: 'var(--mute)' }}>Nothing uploaded yet.</span>}
          <div>{docs.map((d) => (<div key={d.id} className="doc"><Icon name="file" /><a href={d.url} target="_blank" rel="noreferrer">{d.label}</a>
            {has('upload_document') && <button className="icon-btn" onClick={() => delDoc(d.id)} aria-label="Remove document"><Icon name="trash" /></button>}</div>))}</div>
          {has('upload_document') && (<div className="row">
            <input style={{ flex: '1 1 160px' }} placeholder="Label, e.g. Birth certificate" value={label} onChange={(e) => setLabel(e.target.value)} />
            <input style={{ flex: '1 1 200px' }} type="file" ref={fileRef} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" />
            <button className="btn" onClick={upload} disabled={busy === 'u'}><Icon name="upload" size={16} />Upload</button></div>)}
        </div>)}

      {(has('reset_pass') || has('delete_user') || has('edit_user')) && (
        <div className="card stack">
          <b>Account</b>
          {has('reset_pass') && <div className="row"><input style={{ flex: 1 }} type="password" placeholder="New password (6+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /><button className="btn" onClick={reset} disabled={pw.length < 6}><Icon name="key" size={16} />Reset password</button></div>}
          <div className="row">
            {has('edit_user') && !self && <button className="btn" onClick={toggle}>{user.is_active ? 'Turn off account' : 'Turn on account'}</button>}
            {has('delete_user') && !self && <button className="btn danger" onClick={remove}><Icon name="trash" size={16} />Delete user</button>}
          </div>
        </div>)}
    </Modal>
  );
}

// ---------- list (or lookup when the person can only view one user at a time)
export function UserList({ me }) {
  const canList = me.features.includes('get_all_users_school');
  const { data: users, error } = useData('users', fetchers.users, canList);
  const { data: classes = [] } = useData('classes', fetchers.classes, me.features.some((f) => ['get_all_users_school', 'get_user', 'create_user', 'edit_user'].includes(f)));
  const { data: schools } = useData('schools', fetchers.schools, me.role === 'super_admin');
  const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [school, setSchool] = useState('');
  const [open, setOpen] = useState(null); const [look, setLook] = useState(''); const [lerr, setLerr] = useState('');

  const rows = useMemo(() => (users || []).filter((u) => (!role || u.role === role) && (!school || u.school_id === school)
    && (!q || `${u.login_id} ${u.profile.full_name || ''} ${u.profile.phone || ''}`.toLowerCase().includes(q.toLowerCase()))), [users, q, role, school]);

  if (!canList) {
    const find = async (e) => { e.preventDefault(); setLerr(''); try { setOpen(await api.get(`/users/${encodeURIComponent(look.trim())}`)); } catch (x) { setLerr(x.message); } };
    return (<>
      {me.features.includes('get_user') ? (
        <form className="card row" style={{ maxWidth: 560 }} onSubmit={find}><input style={{ flex: 1 }} placeholder="User ID" value={look} onChange={(e) => setLook(e.target.value)} /><button className="btn primary">Find user</button>{lerr && <div className="err">{lerr}</div>}</form>
      ) : <Empty>You can't view users with your current access.</Empty>}
      {open && <UserDrawer me={me} user={open} classes={classes} students={(users || []).filter((x) => x.role === 'student')} onClose={() => setOpen(null)} />}
    </>);
  }
  if (error) return <div className="err">{error}</div>;
  if (!users) return <Loading />;
  const name = (u) => u.profile.full_name || u.login_id;
  return (
    <div className="stack">
      <div className="row">
        <div style={{ position: 'relative', flex: '1 1 220px' }}><input placeholder="Search name, ID or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} /><span style={{ position: 'absolute', left: 11, top: 10, color: 'var(--mute)' }}><Icon name="search" size={18} /></span></div>
        {me.role === 'super_admin' && schools && <select style={{ width: 'auto' }} value={school} onChange={(e) => setSchool(e.target.value)}><option value="">All schools</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      </div>
      <div className="pills scroll">{['', 'school_admin', 'staff', 'parent', 'student', 'other'].map((r) => <button key={r} className={`pill ${role === r ? 'on' : ''}`} onClick={() => setRole(r)}>{r ? ROLE_LABEL[r] : 'All'}</button>)}</div>
      {rows.length === 0 ? <Empty>No users match.</Empty> : (<>
        <div className="card utable" style={{ padding: 0, overflow: 'hidden' }}><table><thead><tr><th>Name</th><th>ID</th><th>Role</th><th>Phone</th><th>Status</th></tr></thead><tbody>
          {rows.map((u) => (<tr key={u.user_id} className="click" onClick={() => setOpen(u)}>
            <td><div className="person"><span className="avatar">{initials(name(u))}</span>{name(u)}</div></td><td>{u.login_id}</td><td>{ROLE_LABEL[u.role]}</td><td>{u.profile.phone || '-'}</td>
            <td><Badge tone={u.is_active ? 'ok' : 'off'}>{u.is_active ? 'Active' : 'Off'}</Badge></td></tr>))}
        </tbody></table></div>
        <div className="ucards">{rows.map((u) => (<button key={u.user_id} className="ucard" onClick={() => setOpen(u)}>
          <div className="person"><span className="avatar">{initials(name(u))}</span><div>{name(u)}<small>{u.login_id}</small></div></div><Badge>{ROLE_LABEL[u.role]}</Badge></button>))}</div>
      </>)}
      {open && <UserDrawer me={me} user={open} classes={classes} students={(users || []).filter((x) => x.role === 'student')} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---------- add user
export function UserAdd({ me, go }) {
  const { data: classes = [] } = useData('classes', fetchers.classes);
  const { data: schools } = useData('schools', fetchers.schools, me.role === 'super_admin');
  const [a, setA] = useState({ password: '', role: 'student', school_id: '' });
  const { data: all } = useData('users', fetchers.users, me.features.includes('get_all_users_school'));
  const [f, setF] = useState(pickProfile({})); const [feats, setFeats] = useState([]); const [kids, setKids] = useState([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const sid = me.role === 'super_admin' ? a.school_id : me.school_id;
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api.post('/users', { ...a, profile: f, features_permission: feats, children: a.role === 'parent' ? kids : [] });
      await refreshUsers(); toast('User created'); go('list');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="card form" style={{ maxWidth: 760 }} onSubmit={save}>
      <div className="sec">Sign-in</div>
      {me.role === 'super_admin' && <div className="full"><Field label="School" req><select required value={a.school_id} onChange={(e) => setA({ ...a, school_id: e.target.value })}><option value="">Choose a school</option>{(schools || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field></div>}
      <Field label="User ID" hint="Made automatically from the school, e.g. AF001"><input disabled readOnly value="Automatic" /></Field>
      <Field label="Password" req hint="At least 6 characters"><input required type="password" value={a.password} onChange={(e) => setA({ ...a, password: e.target.value })} autoComplete="new-password" /></Field>
      <div className="full"><Field label="Role"><select value={a.role} onChange={(e) => setA({ ...a, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field></div>
      <ProfileFields f={f} setF={setF} role={a.role} classes={classes.filter((c) => c.school_id === sid)} canSalary={me.features.includes('manage_salary')} />
      {a.role === 'parent' && (
        <div className="full stack"><div className="sec">Parent of</div>
          <ChildPicker options={(all || []).filter((x) => x.role === 'student' && x.school_id === sid)} value={kids} onChange={setKids} /></div>)}
      {me.features.includes('change_features') && !['school_admin'].includes(a.role) && (<div className="full stack"><div className="sec">Feature access</div><FeaturePicker me={me} role={a.role} value={feats} onChange={setFeats} /></div>)}
      {err && <div className="err full">{err}</div>}
      <button className="btn primary full" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Creating...' : 'Create user'}</button>
      <small className="full" style={{ color: 'var(--mute)' }}>Documents can be uploaded after the user is created.</small>
    </form>
  );
}

// ---------- classes (needed for the student's class)
export function ClassManager({ me }) {
  const { data: classes } = useData('classes', fetchers.classes);
  const { data: schools } = useData('schools', fetchers.schools, me.role === 'super_admin');
  const [name, setName] = useState(''); const [section, setSection] = useState(''); const [level, setLevel] = useState(''); const [school, setSchool] = useState(''); const [err, setErr] = useState('');
  const add = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post('/classes', { name, section, level, school_id: school }); setName(''); setSection(''); setLevel(''); await load('classes', fetchers.classes); } catch (x) { setErr(x.message); }
  };
  const del = async (id) => { if ((await ask('Delete this class? Students in it will have no class.'))) { await api.del(`/classes/${id}`).catch((x) => toast(x.message, true)); load('classes', fetchers.classes); } };
  const sName = (id) => (schools || []).find((s) => s.id === id)?.name;
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <form className="card row" onSubmit={add}>
        {me.role === 'super_admin' && <select required style={{ width: 'auto' }} value={school} onChange={(e) => setSchool(e.target.value)}><option value="">School</option>{(schools || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        <input required style={{ flex: '1 1 120px' }} placeholder="Class, e.g. 5 *" value={name} onChange={(e) => setName(e.target.value)} />
        <input style={{ flex: '1 1 90px' }} placeholder="Section, e.g. A" value={section} onChange={(e) => setSection(e.target.value)} />
        <input type="number" min="1" style={{ flex: '1 1 90px' }} placeholder="Order (1,2,3..)" title="Used for year-end promotion: students move from order n to n+1" value={level} onChange={(e) => setLevel(e.target.value)} />
        <button className="btn primary"><Icon name="plus" size={16} />Add class</button>
        {err && <div className="err">{err}</div>}
      </form>
      <small style={{ color: 'var(--mute)' }}>Order decides promotion: at year end, students in order 5 move to order 6. Classes without an order are skipped.</small>
      {!classes ? <Loading /> : classes.length === 0 ? <Empty>No classes yet. Add the first one above.</Empty> :
        <div className="card" style={{ padding: 0 }}>{classes.map((c) => (<div key={c.id} className="doc" style={{ padding: '10px 16px' }}><b style={{ flex: 1 }}>Class {c.name} {c.section}</b><input type="number" min="1" style={{ width: 90 }} defaultValue={c.level ?? ''} placeholder="Order" aria-label="Class order" onBlur={async (e) => { if (String(c.level ?? '') !== e.target.value) { try { await api.patch(`/classes/${c.id}`, { level: e.target.value }); await load('classes', fetchers.classes); } catch (x) { toast(x.message, true); } } }} />{me.role === 'super_admin' && <span style={{ color: 'var(--mute)' }}>{sName(c.school_id)}</span>}<button className="icon-btn" onClick={() => del(c.id)} aria-label="Delete class"><Icon name="trash" /></button></div>))}</div>}
    </div>
  );
}
