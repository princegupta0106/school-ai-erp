// Students module for mobile: searchable class-wise list + one-student profile.
// Uses GET /student-profile/search (list) and GET /student-profile/:id (profile). Attendance for "this month" comes
// from the existing /attendance/reports/student/:id (staff) or /attendance/my (family) endpoints.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Linking } from 'react-native';
import { api } from '../api';
import { C } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Input, Choice } from '../ui';
import { useApi } from '../useApi';
import { scoped, qs, Pad, Row, List, Roll } from './Attendance';

const Gap = ({ h = 12 }) => <View style={{ height: h }} />;
const Sec = ({ children }) => <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink, marginBottom: 8 }}>{children}</Text>;
const KV = ({ k, v }) => (v ? <View style={{ flexDirection: 'row', paddingVertical: 3 }}><Text style={{ width: 110, color: C.mute, fontSize: 13 }}>{k}</Text><Text style={{ flex: 1, color: C.ink, fontSize: 13, fontWeight: '600' }}>{String(v)}</Text></View> : null);
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const digits = (p) => String(p || '').replace(/[^0-9+]/g, '');
const waNumber = (p) => { const d = digits(p).replace(/^\+/, ''); return d.length === 10 ? `91${d}` : d; }; // 10-digit Indian numbers get +91
const monthRange = () => { const n = new Date(); const p = (x) => String(x).padStart(2, '0'); return { from: `${n.getFullYear()}-${p(n.getMonth() + 1)}-01`, to: `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}` }; };
const useDebounced = (v, ms = 300) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; };

/* ------------------------------------------------------------ list */
export const StudentList = scoped(function StudentList({ sc, go }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [cls, setCls] = useState('');
  const { data: list, error } = useApi(`/student-profile/search${qs({ ...sc, q: dq })}`);
  const classes = [...new Set((list || []).map((s) => s.class_label).filter(Boolean))];
  const shown = (list || []).filter((s) => !cls || s.class_label === cls);
  return (
    <Pad>
      <Input placeholder="Search by name, ID or roll no." value={q} onChangeText={setQ} />
      <Gap h={10} />
      <View style={{ marginBottom: 12 }}><Choice value={cls} onChange={setCls} options={[{ value: '', label: 'All classes' }, ...classes.map((c) => ({ value: c, label: `Class ${c}` }))]} /></View>
      <ErrorBox>{error}</ErrorBox>
      {!list ? (error ? null : <Loading />) : shown.length === 0 ? <Empty>No student found.</Empty> : (
        <List>{shown.slice(0, 200).map((s, i) => (
          <Row key={s.student_id} last={i === shown.length - 1 || i === 199} onPress={() => go(`profile/${s.student_id}`)}>
            <Roll n={s.roll_no} />
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{s.full_name}</Text><Dim>Class {s.class_label} · {s.login_id}</Dim></View>
            <Icon name="chevron" size={18} color={C.mute} />
          </Row>))}
        </List>)}
    </Pad>
  );
});

/* ------------------------------------------------------------ profile */
function Contact({ label, name, phone }) {
  if (!phone) return null;
  return (
    <View style={{ paddingVertical: 8 }}>
      <Text style={{ color: C.ink, fontWeight: '700' }}>{name || label}</Text>
      <Dim>{label} · {phone}</Dim>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        <View style={{ flex: 1 }}><Btn small title="Call" onPress={() => Linking.openURL(`tel:${digits(phone)}`)} /></View>
        <View style={{ flex: 1 }}><Btn small kind="ghost" title="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${waNumber(phone)}`)} /></View>
      </View>
    </View>
  );
}

function Profile({ me, sc, id, goTo, onBack }) {
  const has = (...f) => f.some((x) => me.features.includes(x));
  const { data: p, error } = useApi(`/student-profile/${id}${qs(sc)}`);
  const family = !!p?.viewer?.family;
  // sections follow the person's features (family always sees their own child's data)
  const canAtt = family || has('view_attendance_reports');
  const canFees = !!p?.viewer?.can_fees && (family || has('view_student_fees', 'collect_fees', 'adjust_fees'));
  const canMarks = family || has('view_academic_reports');
  const canDocs = family || has('view_issued_documents', 'issue_documents');
  const canCollect = !family && has('view_student_fees', 'collect_fees', 'adjust_fees');
  const canIssue = !family && has('issue_documents');

  // attendance for THIS MONTH, from the existing attendance endpoints
  const r = monthRange();
  const attUrl = !p || !canAtt ? null : family ? `/attendance/my${qs({ student_id: id, ...r })}` : `/attendance/reports/student/${id}${qs({ ...sc, ...r })}`;
  const { data: att } = useApi(attUrl);

  if (error && !p) return <Pad><ErrorBox>{error}</ErrorBox>{onBack && <Btn kind="ghost" title="Back to list" onPress={onBack} />}</Pad>;
  if (!p) return <Pad><Loading /></Pad>;
  const s = p.student;
  const parents = [
    { label: 'Father', name: s.father_name, phone: s.father_phone },
    { label: 'Mother', name: s.mother_name, phone: s.mother_phone },
    ...((p.parents || []).error ? [] : (p.parents || [])).filter((x) => x.phone && ![s.father_phone, s.mother_phone].includes(x.phone)).map((x) => ({ label: 'Guardian', name: x.full_name, phone: x.phone })),
  ].filter((x) => x.phone);
  const due = p.fees?.ledger?.totals?.due_till_date;
  const tests = (p.academics?.tests || []).slice(0, 4);
  const exams = (p.academics?.exams || []).slice(0, 2);
  const docs = Array.isArray(p.documents) ? p.documents : [];

  return (
    <Pad>
      {onBack && <><Btn small kind="ghost" title="‹ All students" onPress={onBack} /><Gap h={10} /></>}
      <Card>
        <Text style={{ fontSize: 19, fontWeight: '800', color: C.ink }}>{s.full_name}</Text>
        <Dim>{s.class_label ? `Class ${s.class_label}` : 'No class'}{s.active === false ? ' · inactive' : ''}</Dim>
        <Gap h={6} />
        <KV k="Roll no." v={s.roll_no} /><KV k="Admission no." v={s.admission_no} /><KV k="Login ID" v={s.login_id} />
      </Card>

      {parents.length > 0 && <Card><Sec>Parents</Sec>{parents.map((x, i) => <Contact key={i} {...x} />)}</Card>}

      {canAtt && (
        <Card>
          <Sec>Attendance this month</Sec>
          {!att ? <Dim>Loading…</Dim> : att.summary?.percent == null ? <Dim>No attendance marked this month.</Dim> : (<>
            <Text style={{ fontSize: 26, fontWeight: '800', color: att.summary.percent < 75 ? C.bad : C.ok }}>{att.summary.percent}%</Text>
            <Dim>{att.summary.present} present · {att.summary.absent} absent · {att.summary.late} late · {att.summary.leave} leave</Dim>
          </>)}
        </Card>)}

      {canFees && (
        <Card>
          <Sec>Fees</Sec>
          {p.fees?.ledger ? <Text style={{ fontSize: 22, fontWeight: '800', color: due > 0 ? C.bad : C.ok }}>{due > 0 ? `${rupees(due)} due` : 'No dues'}</Text> : <Dim>Fee details unavailable.</Dim>}
          {canCollect && <><Gap h={8} /><Btn title="Collect" onPress={() => goTo(`fees/students/${id}`)} /></>}
        </Card>)}

      {canMarks && (
        <Card>
          <Sec>Latest marks</Sec>
          {tests.length === 0 && exams.length === 0 ? <Dim>No marks yet.</Dim> : (<>
            {tests.map((t) => <View key={t.id} style={{ flexDirection: 'row', paddingVertical: 3 }}><Text style={{ flex: 1, color: C.ink, fontSize: 13 }} numberOfLines={1}>{t.subject}{t.title ? ` · ${t.title}` : ''}</Text><Text style={{ color: C.ink, fontWeight: '700', fontSize: 13 }}>{t.absent ? 'Absent' : `${t.marks ?? '-'}/${t.max_marks}`}</Text></View>)}
            {exams.map((e) => <View key={e.exam_id} style={{ flexDirection: 'row', paddingVertical: 3 }}><Text style={{ flex: 1, color: C.ink, fontSize: 13 }} numberOfLines={1}>{e.name}</Text><Text style={{ color: C.ink, fontWeight: '700', fontSize: 13 }}>{e.total?.pct != null ? `${e.total.pct}%` : '-'}</Text></View>)}
          </>)}
        </Card>)}

      {canDocs && (
        <Card>
          <Sec>Issued documents</Sec>
          {docs.length === 0 ? <Dim>None issued yet.</Dim> : docs.map((d) => <View key={d.id} style={{ paddingVertical: 4 }}><Text style={{ color: C.ink, fontSize: 13, fontWeight: '600' }}>{d.title || d.doc_type}</Text><Dim>{d.serial_no} · {d.issued_at ? new Date(d.issued_at).toLocaleDateString('en-IN') : ''}{d.status === 'cancelled' ? ' · cancelled' : ''}</Dim></View>)}
          {canIssue && <><Gap h={8} /><Btn title="Issue document" onPress={() => goTo(`documents/issue/${id}`)} /></>}
        </Card>)}
      {!canDocs && canIssue && <Btn title="Issue document" onPress={() => goTo(`documents/issue/${id}`)} />}
    </Pad>
  );
}

// the profile tab: staff arrive here by tapping a student; a parent / student sees their own child(ren)
export const StudentProfile = scoped(function StudentProfile({ me, sc, action, go, goTo }) {
  const [picked, setPicked] = useState(null);
  useEffect(() => { if (action) setPicked(action); }, [action]);
  const staff = me.features.includes('view_student_profile');
  const { data: mine } = useApi(staff ? null : '/student-profile/my');
  const back = useCallback(() => { setPicked(null); go('list'); }, [go]);
  const id = picked || (!staff && mine?.length === 1 ? mine[0].student_id : null);
  if (id) return <Profile key={id} me={me} sc={sc} id={id} goTo={goTo} onBack={staff ? back : (mine?.length > 1 ? () => setPicked(null) : null)} />;
  if (staff) return <Pad><Empty>Open a student from the Students tab to see their profile.</Empty><Btn title="Go to students" onPress={() => go('list')} /></Pad>;
  if (!mine) return <Pad><Loading /></Pad>;
  if (!mine.length) return <Pad><Empty>No student is linked to your account yet.</Empty></Pad>;
  return <Pad><List>{mine.map((s, i) => <Row key={s.student_id} last={i === mine.length - 1} onPress={() => setPicked(s.student_id)}><Roll n={s.roll_no} /><View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{s.full_name}</Text><Dim>Class {s.class_label}</Dim></View><Icon name="chevron" size={18} color={C.mute} /></Row>)}</List></Pad>;
});
