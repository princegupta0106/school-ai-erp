// Users module for mobile. Mirrors client/src/modules/UsersModule.jsx (same endpoints, rules and permissions).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { api } from '../api';
import { C, ROLE_LABEL, initials } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Sheet, Choice, Input, Field, DateField, Check, toast, confirmAsk } from '../ui';
import { useApi } from '../useApi';
import { Pad, List, Row } from './Attendance';

/* ---------------------------------------------------------------- helpers */
const ROLES = ['school_admin', 'staff', 'parent', 'student', 'other'];
const JOB_ROLES = ['school_admin', 'staff', 'other'];
const PF = ['full_name', 'phone', 'email', 'dob', 'gender', 'address', 'admission_no', 'class_id', 'blood_group', 'emergency_contact_name', 'emergency_contact_phone',
  'father_name', 'mother_name', 'father_phone', 'mother_phone', 'father_occupation', 'mother_occupation', 'employee_id', 'designation', 'department', 'qualification', 'joining_date', 'salary'];
const DATES = ['dob', 'joining_date'];
// everything becomes a string for the form (dates are cut to YYYY-MM-DD)
const pickProfile = (p) => Object.fromEntries(PF.map((k) => [k, p?.[k] === null || p?.[k] === undefined ? '' : DATES.includes(k) ? String(p[k]).slice(0, 10) : String(p[k])]));
const nameOf = (u) => u.profile?.full_name || u.login_id;
const cls = (c) => `${c.name}${c.section ? ` ${c.section}` : ''}`;
const Gap = ({ h = 12 }) => <View style={{ height: h }} />;
const Sec = ({ children }) => <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink, marginTop: 8, marginBottom: 10 }}>{children}</Text>;
const Pill = ({ children, color = C.mute, bg = C.muteBg }) => <Text style={{ fontSize: 11, fontWeight: '700', color, backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{children}</Text>;
const Avatar = ({ name }) => <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.brand, fontWeight: '800', fontSize: 14 }}>{initials(name)}</Text></View>;
const StatusPill = ({ on }) => <Pill color={on ? C.ok : C.mute} bg={on ? C.okBg : C.muteBg}>{on ? 'Active' : 'Off'}</Pill>;

function useDebounced(v, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/* ---------------------------------------------------------------- shared profile form */
function ProfileFields({ f, setF, role, classes, canEdit = true, canSalary = false }) {
  const d = !canEdit;
  const In = (k, label, extra = {}) => <Field label={label}><Input editable={!d} value={f[k] || ''} onChangeText={(t) => setF({ ...f, [k]: t })} {...extra} /></Field>;
  const Dt = (k, label) => <Field label={label}><DateField value={f[k] || ''} disabled={d} onChange={(v) => setF({ ...f, [k]: v })} /></Field>;
  return (<>
    <Sec>Basic details</Sec>
    <Field req label="Full name"><Input editable={!d} autoCapitalize="words" value={f.full_name || ''} onChangeText={(t) => setF({ ...f, full_name: t })} /></Field>
    {In('phone', 'Phone', { keyboardType: 'phone-pad' })}
    {In('email', 'Email', { keyboardType: 'email-address', autoCapitalize: 'none' })}
    {Dt('dob', 'Date of birth')}
    <Field label="Gender"><Choice value={f.gender || ''} onChange={(v) => !d && setF({ ...f, gender: v })} options={[{ value: '', label: '-' }, { value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }]} /></Field>
    {In('blood_group', 'Blood group')}
    {In('emergency_contact_name', 'Emergency contact')}
    {In('emergency_contact_phone', 'Emergency phone', { keyboardType: 'phone-pad' })}
    {In('address', 'Address', { multiline: true })}
    {JOB_ROLES.includes(role) && (<>
      <Sec>Job details</Sec>
      {In('employee_id', 'Employee ID')}
      {In('designation', 'Designation (e.g. Maths teacher)')}
      {In('department', 'Department')}
      {In('qualification', 'Qualification')}
      {Dt('joining_date', 'Joining date')}
      {canSalary && In('salary', 'Monthly salary', { keyboardType: 'decimal-pad' })}
    </>)}
    {role === 'student' && (<>
      <Sec>School details</Sec>
      {In('admission_no', 'Admission no.')}
      <Field req label="Class" hint="Roll no. is given automatically"><Choice value={f.class_id || ''} onChange={(v) => !d && setF({ ...f, class_id: v })} options={[{ value: '', label: '-' }, ...classes.map((c) => ({ value: c.id, label: cls(c) }))]} /></Field>
      <Sec>Parents</Sec>
      {In('father_name', "Father's name")}
      {In('father_phone', "Father's phone", { keyboardType: 'phone-pad' })}
      {In('father_occupation', "Father's occupation")}
      {In('mother_name', "Mother's name")}
      {In('mother_phone', "Mother's phone", { keyboardType: 'phone-pad' })}
      {In('mother_occupation', "Mother's occupation")}
    </>)}
  </>);
}

// "parent of": chips of linked students + a search box to add more
function ChildPicker({ options, value, onChange, names = {} }) {
  const [q, setQ] = useState('');
  const nm = (id) => { const o = options.find((x) => x.user_id === id); return o ? nameOf(o) : names[id] || 'Student'; };
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return [];
    return options.filter((o) => !value.includes(o.user_id) && `${nameOf(o)} ${o.login_id}`.toLowerCase().includes(t)).slice(0, 6);
  }, [q, options, value]);
  return (
    <View>
      {value.length === 0 ? <Dim style={{ marginBottom: 8 }}>No students linked yet</Dim> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {value.map((id) => (
            <Pressable key={id} onPress={() => onChange(value.filter((v) => v !== id))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.brand, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
              <Text style={{ color: '#fff', fontSize: 14 }}>{nm(id)}</Text><Icon name="x" size={14} color="#fff" />
            </Pressable>))}
        </View>)}
      {options.length > 0 && <>
        <Input placeholder="Search a student to add..." value={q} onChangeText={setQ} autoCapitalize="none" />
        {matches.length > 0 && <View style={{ marginTop: 8 }}><List>{matches.map((o, i) => (
          <Row key={o.user_id} last={i === matches.length - 1} onPress={() => { onChange([...value, o.user_id]); setQ(''); }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{nameOf(o)}</Text><Dim>{o.login_id}</Dim></View><Icon name="plus" size={18} color={C.brand} />
          </Row>))}</List></View>}
        {q.trim() !== '' && matches.length === 0 && <Dim style={{ marginTop: 6 }}>No matching student.</Dim>}
      </>}
    </View>
  );
}

// role-restricted features (e.g. adjust_fees = admins only, view_my_fees = parents/students) show only for the right role
function FeaturePicker({ me, role, value, onChange }) {
  const sup = me.role === 'super_admin';
  const forRole = (x) => !x.roles || x.roles.includes(role);
  const canGrant = (x) => me.features.includes(x.key) || (x.roles && !x.roles.includes(me.role));
  return (<>{Object.entries(me.catalog || {}).map(([k, m]) => {
    const list = m.features.filter((x) => canGrant(x) && forRole(x) && (!x.superOnly || sup));
    if (!list.length) return null;
    return (
      <View key={k} style={{ marginBottom: 6 }}>
        <Sec>{m.label}</Sec>
        {list.map((x) => <Check key={x.key} label={x.label} value={value.includes(x.key)} onChange={(on) => onChange(on ? [...value, x.key] : value.filter((v) => v !== x.key))} />)}
      </View>);
  })}</>);
}

/* ---------------------------------------------------------------- one user (every action is gated by a feature) */
function UserSheet({ me, user: initial, classes, students, onClose }) {
  const has = (f) => me.features.includes(f);
  const [user, setUser] = useState(initial);
  const [f, setF] = useState(pickProfile(initial.profile));
  const [feats, setFeats] = useState(initial.profile?.features_permission || []);
  const [kids, setKids] = useState((initial.children || []).map((c) => c.user_id));
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const [label, setLabel] = useState(''); const [picked, setPicked] = useState(null);
  const self = user.user_id === me.user_id;

  const apply = (u) => { setUser(u); setF(pickProfile(u.profile)); setFeats(u.profile?.features_permission || []); setKids((u.children || []).map((c) => c.user_id)); };
  useEffect(() => { if (has('get_user')) api.get(`/users/${initial.user_id}`).then(apply).catch(() => {}); }, []); // eslint-disable-line

  const run = (name, fn, okMsg, keepForm) => async () => {
    setBusy(name); setErr('');
    try {
      const r = await fn();
      if (r?.user_id) { if (keepForm) setUser(r); else apply(r); }
      if (okMsg) toast(okMsg);
      return r;
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  };
  const saveProfile = run('p', () => api.patch(`/users/${user.user_id}`, { profile: f }), 'Profile saved');
  const saveKids = run('c', () => api.put(`/users/${user.user_id}/children`, { student_ids: kids }), 'Students linked');
  const saveRole = (role) => confirmAsk(`Change ${nameOf(user)} to ${ROLE_LABEL[role]}?`, run('r', () => api.patch(`/users/${user.user_id}/role`, { role }), 'Role changed'));
  const saveFeats = run('f', () => api.patch(`/users/${user.user_id}/features`, { features_permission: feats }), 'Access updated');
  const toggle = run('a', () => api.patch(`/users/${user.user_id}`, { is_active: !user.is_active }), 'Updated', true);
  const reset = run('k', async () => { await api.post(`/users/${user.user_id}/reset-password`, { password: pw }); setPw(''); }, 'Password reset');
  const delDoc = (id) => confirmAsk('Remove this document?', run('d', () => api.del(`/users/${user.user_id}/documents/${id}`), 'Document removed', true));
  const remove = () => confirmAsk(`Delete ${nameOf(user)}? This cannot be undone.`, async () => {
    try { await api.del(`/users/${user.user_id}`); toast('User deleted'); onClose(); } catch (x) { setErr(x.message); }
  });

  const pickFile = async () => {
    try {
      const DP = await import('expo-document-picker');
      const r = await DP.getDocumentAsync({ type: ['application/pdf', 'image/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], copyToCacheDirectory: true });
      if (!r.canceled && r.assets?.[0]) setPicked(r.assets[0]);
    } catch (x) { toast(x.message || 'Could not open the file picker', true); }
  };
  const upload = run('u', async () => {
    if (!picked) throw new Error('Choose a file first');
    const fd = new FormData();
    fd.append('file', { uri: picked.uri, name: picked.name || 'document', type: picked.mimeType || 'application/octet-stream' });
    fd.append('label', label);
    const r = await api.post(`/users/${user.user_id}/documents`, fd);
    setPicked(null); setLabel(''); return r;
  }, 'Document uploaded', true);
  const openDoc = (d) => Linking.openURL(d.url).catch(() => toast('Could not open the document', true));

  const docs = user.profile?.documents || [];
  const canEdit = has('edit_user');
  return (
    <Sheet title={nameOf(user)} onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Pill color={C.brand} bg={C.soft}>{ROLE_LABEL[user.role]}</Pill><StatusPill on={user.is_active} /><Dim>ID: {user.login_id}</Dim>
      </View>
      <ErrorBox>{err}</ErrorBox>

      <Card>
        <ProfileFields f={f} setF={setF} role={user.role} classes={classes.filter((c) => c.school_id === user.school_id)} canEdit={canEdit} canSalary={has('manage_salary')} />
        {canEdit && <Btn title={busy === 'p' ? 'Saving...' : 'Save profile'} onPress={saveProfile} disabled={busy === 'p'} />}
      </Card>

      {user.role === 'parent' && (
        <Card>
          <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 10 }}>Parent of</Text>
          <ChildPicker options={canEdit ? students.filter((x) => x.school_id === user.school_id) : []} value={kids} onChange={canEdit ? setKids : () => {}}
            names={Object.fromEntries((user.children || []).map((c) => [c.user_id, c.full_name || c.login_id]))} />
          {canEdit && <><Gap h={10} /><Btn title={busy === 'c' ? 'Saving...' : 'Save students'} onPress={saveKids} disabled={busy === 'c'} /></>}
        </Card>)}
      {user.role === 'student' && (user.parents || []).length > 0 && (
        <Card>
          <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 8 }}>Parents / guardians</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{user.parents.map((p) => <Pill key={p.user_id}>{p.full_name || p.login_id}</Pill>)}</View>
        </Card>)}

      {has('change_role') && !self && user.role !== 'super_admin' && (
        <Card>
          <Field label="Role"><Choice value={user.role} onChange={(r) => r !== user.role && saveRole(r)} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></Field>
        </Card>)}

      {has('change_features') && user.role !== 'super_admin' && (
        <Card>
          <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 6 }}>Feature access</Text>
          {user.role === 'school_admin' ? <Dim>School admins always have every feature of their school.</Dim> : (<>
            <FeaturePicker me={me} role={user.role} value={feats} onChange={setFeats} />
            <Gap h={6} /><Btn title={busy === 'f' ? 'Saving...' : 'Save access'} onPress={saveFeats} disabled={busy === 'f'} />
          </>)}
        </Card>)}

      {(docs.length > 0 || has('upload_document')) && (
        <Card>
          <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 6 }}>Documents</Text>
          {docs.length === 0 && <Dim>Nothing uploaded yet.</Dim>}
          {docs.map((d) => (
            <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: C.line }}>
              <Icon name="file" size={18} color={C.mute} />
              <Pressable style={{ flex: 1 }} onPress={() => openDoc(d)}><Text style={{ color: C.brand, fontWeight: '600' }} numberOfLines={2}>{d.label}</Text></Pressable>
              {has('upload_document') && <Pressable hitSlop={8} onPress={() => delDoc(d.id)} style={{ padding: 6 }}><Icon name="trash" size={19} color={C.bad} /></Pressable>}
            </View>))}
          {has('upload_document') && (<View style={{ marginTop: 10 }}>
            <Input placeholder="Label, e.g. Birth certificate" value={label} onChangeText={setLabel} />
            <Gap h={8} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Btn small kind="ghost" title={picked ? 'Change file' : 'Choose file'} onPress={pickFile} />
              <Text style={{ flex: 1, color: C.mute, fontSize: 13 }} numberOfLines={1}>{picked ? picked.name : 'PDF, image or Word, up to 10 MB'}</Text>
            </View>
            <Gap h={8} /><Btn small title={busy === 'u' ? 'Uploading...' : 'Upload'} onPress={upload} disabled={busy === 'u' || !picked} />
          </View>)}
        </Card>)}

      {(has('reset_pass') || has('delete_user') || has('edit_user')) && (
        <Card>
          <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 10 }}>Account</Text>
          {has('reset_pass') && <>
            <Input secureTextEntry placeholder="New password (6+ characters)" value={pw} onChangeText={setPw} autoCapitalize="none" autoComplete="off" />
            <Gap h={8} /><Btn small kind="ghost" title={busy === 'k' ? 'Resetting...' : 'Reset password'} onPress={reset} disabled={busy === 'k' || pw.length < 6} /><Gap />
          </>}
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            {canEdit && !self && <Btn small kind="ghost" title={user.is_active ? 'Turn off account' : 'Turn on account'} onPress={toggle} disabled={busy === 'a'} />}
            {has('delete_user') && !self && <Btn small kind="danger" title="Delete user" onPress={remove} />}
          </View>
        </Card>)}
    </Sheet>
  );
}

/* ================================================================== USERS LIST */
export function UserList({ me }) {
  const canList = me.features.includes('get_all_users_school');
  const sup = me.role === 'super_admin';
  const { data: users, error, loading, reload } = useApi(canList ? '/users' : null);
  const { data: classes } = useApi(me.features.some((x) => ['get_all_users_school', 'get_user', 'create_user', 'edit_user'].includes(x)) ? '/classes' : null);
  const { data: schools } = useApi(sup ? '/schools' : null);
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [role, setRole] = useState(''); const [school, setSchool] = useState('');
  const [open, setOpen] = useState(null); const [look, setLook] = useState(''); const [lerr, setLerr] = useState(''); const [limit, setLimit] = useState(60);

  const rows = useMemo(() => (users || []).filter((u) => (!role || u.role === role) && (!school || u.school_id === school)
    && (!dq || `${u.login_id} ${u.profile?.full_name || ''} ${u.profile?.phone || ''}`.toLowerCase().includes(dq.toLowerCase()))), [users, dq, role, school]);
  useEffect(() => setLimit(60), [dq, role, school]);
  const students = useMemo(() => (users || []).filter((x) => x.role === 'student'), [users]);

  const sheet = open && <UserSheet key={open.user_id} me={me} user={open} classes={classes || []} students={students} onClose={() => setOpen(null)} />;

  if (!canList) {
    const find = async () => { setLerr(''); try { setOpen(await api.get(`/users/${encodeURIComponent(look.trim())}`)); } catch (x) { setLerr(x.message); } };
    return (
      <Pad>
        {me.features.includes('get_user') ? (
          <Card>
            <Field label="Find a user"><Input placeholder="User ID" value={look} onChangeText={setLook} autoCapitalize="none" autoCorrect={false} /></Field>
            <ErrorBox>{lerr}</ErrorBox>
            <Btn title="Find user" onPress={find} disabled={!look.trim()} />
          </Card>) : <Empty>You can't view users with your current access.</Empty>}
        {sheet}
      </Pad>
    );
  }
  if (error && !users) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!users) return <Pad><Loading /></Pad>;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Input placeholder="Search name, ID or phone" value={q} onChangeText={setQ} autoCapitalize="none" />
      <Gap h={10} />
      {sup && schools && schools.length > 0 && <View style={{ marginBottom: 10 }}><Choice value={school} onChange={setSchool} options={[{ value: '', label: 'All schools' }, ...schools.map((s) => ({ value: s.id, label: s.name }))]} /></View>}
      <View style={{ marginBottom: 12 }}><Choice value={role} onChange={setRole} options={['', 'school_admin', 'staff', 'parent', 'student', 'other'].map((r) => ({ value: r, label: r ? ROLE_LABEL[r] : 'All' }))} /></View>
      <Dim style={{ marginBottom: 8 }}>{rows.length} user{rows.length === 1 ? '' : 's'}</Dim>
      {rows.length === 0 ? <Empty>No users match.</Empty> : (
        <List>{rows.slice(0, limit).map((u, i, a) => (
          <Row key={u.user_id} last={i === a.length - 1 && rows.length <= limit} onPress={() => setOpen(u)}>
            <Avatar name={nameOf(u)} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: C.ink }} numberOfLines={1}>{nameOf(u)}</Text>
              <Dim numberOfLines={1}>{u.login_id}{u.profile?.phone ? ` · ${u.profile.phone}` : ''}</Dim>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}><Pill color={C.brand} bg={C.soft}>{ROLE_LABEL[u.role]}</Pill>{!u.is_active && <StatusPill on={false} />}</View>
          </Row>))}
          {rows.length > limit && <View style={{ padding: 10, alignItems: 'center' }}><Btn small kind="ghost" title={`Show more (${rows.length - limit} left)`} onPress={() => setLimit(limit + 60)} /></View>}
        </List>)}
      {sheet}
    </Pad>
  );
}

/* ================================================================== ADD USER */
export function UserAdd({ me, go }) {
  const sup = me.role === 'super_admin';
  const { data: classes } = useApi('/classes');
  const { data: schools } = useApi(sup ? '/schools' : null);
  const { data: all } = useApi(me.features.includes('get_all_users_school') ? '/users' : null);
  const [a, setA] = useState({ password: '', role: 'student', school_id: '' });
  const [f, setF] = useState(pickProfile({})); const [feats, setFeats] = useState([]); const [kids, setKids] = useState([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const sid = sup ? a.school_id : me.school_id;

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api.post('/users', { ...a, profile: f, features_permission: feats, children: a.role === 'parent' ? kids : [] });
      toast('User created'); setA({ password: '', role: 'student', school_id: a.school_id }); setF(pickProfile({})); setFeats([]); setKids([]); go?.('list');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const ready = !!(f.full_name || '').trim() && a.password.length >= 6 && (!sup || a.school_id) && (a.role !== 'student' || f.class_id);
  return (
    <Pad>
      <Card>
        <Sec>Sign-in</Sec>
        {sup && <Field req label="School"><Choice value={a.school_id} onChange={(v) => setA({ ...a, school_id: v })} options={(schools || []).map((s) => ({ value: s.id, label: s.name }))} /></Field>}
        <Field label="User ID" hint="Made automatically from the school, e.g. AF001"><Input value="Automatic" editable={false} /></Field>
        <Field req label="Password" hint="At least 6 characters"><Input secureTextEntry value={a.password} onChangeText={(t) => setA({ ...a, password: t })} autoCapitalize="none" autoComplete="off" /></Field>
        <Field label="Role"><Choice value={a.role} onChange={(v) => setA({ ...a, role: v })} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></Field>
        <ProfileFields f={f} setF={setF} role={a.role} classes={(classes || []).filter((c) => c.school_id === sid)} canSalary={me.features.includes('manage_salary')} />
        {a.role === 'parent' && (<><Sec>Parent of</Sec><ChildPicker options={(all || []).filter((x) => x.role === 'student' && x.school_id === sid)} value={kids} onChange={setKids} /></>)}
        {me.features.includes('change_features') && a.role !== 'school_admin' && (<><Sec>Feature access</Sec><FeaturePicker me={me} role={a.role} value={feats} onChange={setFeats} /></>)}
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Creating...' : 'Create user'} onPress={save} disabled={busy || !ready} />
        <Dim style={{ marginTop: 10 }}>Documents can be uploaded after the user is created.</Dim>
      </Card>
    </Pad>
  );
}

/* ================================================================== CLASSES */
function ClassRow({ c, last, school, onChanged }) {
  const [lv, setLv] = useState(c.level === null || c.level === undefined ? '' : String(c.level));
  const saveLevel = async () => {
    if (String(c.level ?? '') === lv) return;
    try { await api.patch(`/classes/${c.id}`, { level: lv }); onChanged(); } catch (x) { toast(x.message, true); setLv(c.level === null || c.level === undefined ? '' : String(c.level)); }
  };
  const del = () => confirmAsk('Delete this class? Students in it will have no class.', async () => { try { await api.del(`/classes/${c.id}`); onChanged(); } catch (x) { toast(x.message, true); } });
  return (
    <Row last={last}>
      <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.ink }}>Class {cls(c)}</Text>{school ? <Dim>{school}</Dim> : null}</View>
      <Input style={{ width: 80, textAlign: 'center', paddingVertical: 8 }} keyboardType="number-pad" placeholder="Order" value={lv} onChangeText={(t) => setLv(t.replace(/[^0-9]/g, ''))} onEndEditing={saveLevel} />
      <Pressable hitSlop={8} onPress={del} style={{ padding: 6 }}><Icon name="trash" size={19} color={C.bad} /></Pressable>
    </Row>
  );
}

export function ClassManager({ me }) {
  const sup = me.role === 'super_admin';
  const { data: classes, error, loading, reload } = useApi('/classes');
  const { data: schools } = useApi(sup ? '/schools' : null);
  const [name, setName] = useState(''); const [section, setSection] = useState(''); const [level, setLevel] = useState(''); const [school, setSchool] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const sId = sup ? (school || schools?.[0]?.id || '') : me.school_id;
  const sName = (id) => (schools || []).find((s) => s.id === id)?.name;

  const add = async () => {
    setErr(''); setBusy(true);
    try { await api.post('/classes', { name, section, level, school_id: sId }); setName(''); setSection(''); setLevel(''); await reload(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (error && !classes) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!classes) return <Pad><Loading /></Pad>;
  const shown = classes.filter((c) => !sup || c.school_id === sId);
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Card>
        <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink, marginBottom: 10 }}>Add a class</Text>
        {sup && schools && <Field req label="School"><Choice value={sId} onChange={setSchool} options={schools.map((s) => ({ value: s.id, label: s.name }))} /></Field>}
        <Field req label="Class"><Input placeholder="e.g. 5" value={name} onChangeText={setName} /></Field>
        <Field label="Section (optional)"><Input placeholder="e.g. A" value={section} onChangeText={setSection} autoCapitalize="characters" /></Field>
        <Field label="Order (optional)" hint="Used for year-end promotion: students in order 5 move to order 6. Classes without an order are skipped."><Input keyboardType="number-pad" placeholder="1, 2, 3..." value={level} onChangeText={(t) => setLevel(t.replace(/[^0-9]/g, ''))} /></Field>
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Adding...' : 'Add class'} onPress={add} disabled={busy || !name.trim() || !sId} />
      </Card>
      {shown.length === 0 ? <Empty>No classes yet. Add the first one above.</Empty> : (
        <List>{shown.map((c, i) => <ClassRow key={c.id} c={c} last={i === shown.length - 1} school={sup && !school ? sName(c.school_id) : ''} onChanged={reload} />)}</List>)}
    </Pad>
  );
}
