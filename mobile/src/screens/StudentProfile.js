// Student 360 profile for mobile. Mirrors client/src/modules/StudentProfileModule.jsx (same endpoints, same rules).
//   MyStudentProfile  - student / parent: own or linked children
//   StudentProfile    - staff / admin: search, pick, open
import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { C } from '../theme';
import { Card, Dim, Empty, Loading, ErrorBox, Choice } from '../ui';
import { FilterBar } from '../FilterBar';
import { useApi } from '../useApi';
import {
  scoped, Pad, Row, List, Avatar, Chip, ChipRow, Stat, StatRow, Kpi, KpiGrid, Section, Soft, Meter, Ring, Facts, Line, Person, SearchBox, Group, BackBar,
  rupees, fdate, clock12, monShort, pctText, pctTone, toneColor, hueOf, useDebounced, groupByClass,
} from '../kit';

const HW_STATE = { checked: ['ok', 'Checked'], submitted: ['info', 'Submitted'], pending: ['warn', 'Pending'], overdue: ['bad', 'Overdue'], info: ['mute', 'For reading'] };
const DIR = { one_way: 'One-way', two_way: 'Two-way' };

/* ------------------------------------------------------------------ sections */
function AttendanceSection({ a }) {
  if (!a) return <Soft>Attendance is not available.</Soft>;
  const s = a.summary; const months = (a.months || []).slice(-8);
  if (!s.total) return <Soft>No attendance has been marked yet.</Soft>;
  const col = toneColor(pctTone(s.percent, 90, 75));
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 14 }}>
        <Ring value={s.percent} color={col} sub={`${s.total} days`} />
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Stat n={s.present} label="Present" tone="ok" /><Stat n={s.absent} label="Absent" tone="bad" />
          <Stat n={s.late} label="Late" tone="warn" /><Stat n={s.leave} label="Leave" tone="info" />
        </View>
      </View>
      {months.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
          {months.map((m) => (
            <View key={m.month} style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ height: 56, width: '100%', justifyContent: 'flex-end', backgroundColor: C.muteBg, borderRadius: 6, overflow: 'hidden' }}>
                <View style={{ height: `${Math.max(8, m.percent ?? 0)}%`, backgroundColor: toneColor(pctTone(m.percent, 90, 75)) }} />
              </View>
              <Text style={{ color: C.mute, fontSize: 10.5, marginTop: 3 }}>{monShort(m.month)}</Text>
              <Text style={{ color: C.ink, fontSize: 11, fontWeight: '700' }}>{pctText(m.percent)}</Text>
            </View>
          ))}
        </View>
      )}
      {a.absences?.length > 0 && (
        <>
          <Dim style={{ marginBottom: 6, fontWeight: '600' }}>Recent absences</Dim>
          <ChipRow>{a.absences.slice(0, 6).map((x) => <Chip key={x.date} tone={x.status === 'absent' ? 'bad' : x.status === 'late' ? 'warn' : 'info'}>{fdate(x.date, false)} · {x.status}</Chip>)}</ChipRow>
        </>
      )}
    </>
  );
}

function MarksSection({ ac }) {
  if (!ac) return <Soft>Marks are not available.</Soft>;
  const subs = ac.subjects || []; const exams = ac.exams || [];
  if (!subs.length) return <Soft>No marks have been entered yet.</Soft>;
  return (
    <>
      {subs.map((s) => {
        const p = s.overall?.pct; const col = hueOf(s.name);
        return (
          <View key={s.subject_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: col }} />
            <Text style={{ width: 96, color: C.ink, fontWeight: '600' }} numberOfLines={1}>{s.name}</Text>
            <Meter pct={p} color={col} />
            <Text style={{ width: 40, textAlign: 'right', fontWeight: '800', color: toneColor(pctTone(p)) }}>{pctText(p)}</Text>
            <Text style={{ width: 22, color: C.mute, fontSize: 12 }}>{s.overall?.grade || ''}</Text>
          </View>
        );
      })}
      {exams.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {exams.slice(0, 4).map((e) => {
            const p = e.total?.pct; const fg = toneColor(pctTone(p));
            return (
              <View key={e.exam_id} style={{ flexGrow: 1, flexBasis: '46%', backgroundColor: C.muteBg, borderRadius: 12, padding: 10 }}>
                <Text style={{ color: C.mute, fontSize: 12 }} numberOfLines={1}>{e.name}</Text>
                <Text style={{ color: fg, fontSize: 20, fontWeight: '800' }}>{pctText(p)}</Text>
                <Text style={{ color: C.mute, fontSize: 11.5 }} numberOfLines={1}>{e.total?.grade ? `Grade ${e.total.grade}` : ''}{e.failed ? ` · ${e.failed} to improve` : ''}</Text>
              </View>
            );
          })}
        </View>
      )}
    </>
  );
}

function FeesSection({ f }) {
  if (!f) return <Soft>Fee details are not shared with your role.</Soft>;
  if (f.error) return <Soft>Fees are not available right now.</Soft>;
  const t = f.ledger.totals; const paidPct = t.total ? (t.paid / t.total) * 100 : 0;
  if (!f.has_structure && !t.total) return <Soft>No fee structure has been set for this class yet.</Soft>;
  const upcoming = (f.ledger.lines || []).filter((l) => l.pending > 0).slice(0, 4);
  const receipts = (f.payments || []).filter((p) => p.status !== 'cancelled').slice(0, 3);
  return (
    <>
      <StatRow>
        <Stat n={rupees(t.paid)} label="Paid" tone="ok" />
        <Stat n={rupees(t.pending)} label="Balance" tone={t.pending > 0 ? 'bad' : 'ok'} />
        <Stat n={rupees(t.total)} label={`Total${f.session?.name ? ` (${f.session.name})` : ''}`} />
      </StatRow>
      <View style={{ flexDirection: 'row', marginBottom: 10 }}><Meter pct={paidPct} color={C.ok} h={8} /></View>
      <Text style={{ color: C.ink, fontSize: 13.5, marginBottom: 8 }}>
        {t.pending <= 0 ? 'All fees are paid.' : t.due_till_date > 0 ? `${rupees(t.due_till_date)} is due now.` : t.next_due_date ? `Next payment ${rupees(t.next_due_amount)} on ${fdate(t.next_due_date)}.` : ''}
      </Text>
      {upcoming.map((l, i) => <Line key={i} left={l.label} mid={fdate(l.due_date, false)} right={rupees(l.pending)} rightTone={l.overdue ? 'bad' : undefined} last={i === upcoming.length - 1 && !receipts.length} />)}
      {receipts.length > 0 && <Dim style={{ marginTop: 8, fontWeight: '600' }}>Latest receipts</Dim>}
      {receipts.map((p, i) => <Line key={p.id} left={`#${p.receipt_no}`} mid={fdate(p.paid_on, false)} right={rupees(p.amount)} rightTone="ok" last={i === receipts.length - 1} />)}
    </>
  );
}

function HomeworkSection({ h }) {
  if (!h) return <Soft>Homework is not available.</Soft>;
  if (!h.total) return <Soft>No homework has been posted for this class yet.</Soft>;
  return (
    <>
      <StatRow><Stat n={h.submitted} label="Done" tone="ok" /><Stat n={h.pending} label="Pending" tone="warn" /><Stat n={h.overdue} label="Overdue" tone="bad" /></StatRow>
      {h.items.slice(0, 6).map((i, idx) => {
        const [t, l] = HW_STATE[i.state] || HW_STATE.info;
        return (
          <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: idx === Math.min(h.items.length, 6) - 1 ? 0 : 1, borderColor: C.line }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: hueOf(i.subject) }} />
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{i.title}</Text><Text style={{ color: C.mute, fontSize: 12 }} numberOfLines={1}>{i.subject || 'General'}{i.due_date ? ` · due ${fdate(i.due_date, false)}` : ''}</Text></View>
            <Chip tone={t}>{l}{i.late ? ' · late' : ''}</Chip>
          </View>
        );
      })}
    </>
  );
}

function FamilySection({ s, parents }) {
  const guardians = [
    s.father_name && { n: s.father_name, r: 'Father', p: s.father_phone, o: s.father_occupation },
    s.mother_name && { n: s.mother_name, r: 'Mother', p: s.mother_phone, o: s.mother_occupation },
  ].filter(Boolean);
  const linked = (parents || []).filter((p) => !guardians.some((g) => g.p && g.p === p.phone));
  const all = [
    ...guardians.map((g) => ({ key: g.r, name: g.n, role: `${g.r}${g.o ? ` · ${g.o}` : ''}`, phone: g.p })),
    ...linked.map((p) => ({ key: p.user_id, name: p.full_name, role: `Parent account${p.phone ? ` · ${p.phone}` : ''}`, phone: p.phone })),
    ...(s.emergency_contact_name ? [{ key: 'emg', name: s.emergency_contact_name, role: 'Emergency contact', phone: s.emergency_contact_phone, color: C.bad }] : []),
  ];
  return (
    <>
      <Facts items={[['Date of birth', s.dob ? fdate(s.dob) : null], ['Gender', s.gender], ['Blood group', s.blood_group], ['Admission no.', s.admission_no], ['Phone', s.phone], ['Email', s.email]]} />
      {!!s.address && <Text style={{ color: C.mute, fontSize: 13.5, marginVertical: 8 }}>{s.address}</Text>}
      {all.map((p, i) => <Person key={p.key} name={p.name} role={p.role} phone={p.phone} color={p.color} last={i === all.length - 1} />)}
    </>
  );
}

function DocumentsSection({ docs }) {
  if (!docs) return <Soft>Documents are not available.</Soft>;
  if (!docs.length) return <Soft>No certificates or report cards issued yet.</Soft>;
  return docs.map((d, i) => <Line key={d.id} left={d.title || d.doc_type} mid={fdate(d.issued_at, false)} right={d.status === 'cancelled' ? 'Cancelled' : `#${d.serial_no}`} rightTone={d.status === 'cancelled' ? 'bad' : undefined} last={i === docs.length - 1} />);
}

// one bus ride: route, timings, boarding stop, bus, driver, attendant (the Transport part reuses this)
export function Rides({ rides }) {
  return rides.map((r) => (
    <View key={r.id} style={{ borderWidth: 1, borderColor: C.line, borderLeftWidth: 4, borderLeftColor: hueOf(r.route), borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text style={{ flex: 1, color: C.ink, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{r.route}{r.zone ? <Text style={{ color: C.mute, fontWeight: '500' }}>  {r.zone}</Text> : null}</Text>
        {!!DIR[r.direction] && <Chip>{DIR[r.direction]}</Chip>}
      </View>
      <StatRow>
        <Stat n={r.pickup_time ? clock12(r.pickup_time) : '-'} label="Morning pick-up" />
        <Stat n={r.drop_time ? clock12(r.drop_time) : '-'} label="Afternoon drop" />
      </StatRow>
      <Text style={{ color: C.ink, fontSize: 14, marginBottom: 6 }}>Boards at <Text style={{ fontWeight: '800' }}>{r.stop || '-'}</Text></Text>
      {r.bus ? (
        <>
          <Text style={{ color: C.mute, fontSize: 13, marginBottom: 4 }}>{r.bus.name}{r.bus.reg_no ? ` · ${r.bus.reg_no}` : ''}</Text>
          {!!r.bus.driver_name && <Person name={r.bus.driver_name} role="Driver" phone={r.bus.driver_phone} last={!r.bus.attendant_name} />}
          {!!r.bus.attendant_name && <Person name={r.bus.attendant_name} role="Attendant" phone={r.bus.attendant_phone} last />}
        </>
      ) : <Dim>The school has not chosen a bus for this route yet.</Dim>}
    </View>
  ));
}

/* ------------------------------------------------------------------ the whole profile */
function Profile({ me, studentId, sid, onBack }) {
  const [session, setSession] = useState(''); const [tab, setTab] = useState('att');
  const q = [me.role === 'super_admin' && sid ? `school_id=${sid}` : '', session ? `session_id=${session}` : ''].filter(Boolean).join('&');
  const { data, error, reload, loading } = useApi(`/student-profile/${studentId}${q ? `?${q}` : ''}`);
  const keep = useRef(null); useEffect(() => { if (data) keep.current = data; }, [data]);
  const d = data || keep.current; // keep showing the old numbers while another session loads

  if (error && !d) return <Pad>{onBack && <BackBar label="All students" onPress={onBack} />}<ErrorBox>{error}</ErrorBox></Pad>;
  if (!d) return <Pad>{onBack && <BackBar label="All students" onPress={onBack} />}<Loading /></Pad>;

  const s = d.student; const att = d.attendance && !d.attendance.error ? d.attendance : null;
  const ac = d.academics && !d.academics.error ? d.academics : null; const fe = d.fees;
  const hw = d.homework && !d.homework.error ? d.homework : null; const docs = Array.isArray(d.documents) ? d.documents : null;
  const ap = att?.summary?.percent ?? null; const mp = ac?.summary?.overall?.pct ?? null; const t = fe?.ledger?.totals;
  const bus = d.transport && !d.transport.error ? d.transport : null; const showBus = !!(d.viewer.can_transport && bus);
  const sessions = ac?.sessions || []; const col = hueOf(s.full_name);

  const tabs = [{ value: 'att', label: 'Attendance' }, { value: 'marks', label: 'Marks' }, ...(d.viewer.can_fees ? [{ value: 'fees', label: 'Fees' }] : []), { value: 'hw', label: 'Homework' }, { value: 'family', label: 'Family' }, { value: 'docs', label: 'Documents' }, ...(showBus ? [{ value: 'bus', label: 'Transport' }] : [])];
  const cur = tabs.some((x) => x.value === tab) ? tab : 'att';

  return (
    <Pad reload={reload} loading={loading} hasData>
      {onBack && <BackBar label="All students" onPress={onBack} />}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={s.full_name} size={64} color={col} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink, fontSize: 19, fontWeight: '800' }}>{s.full_name}</Text>
            <Text style={{ color: C.mute, fontSize: 13, marginTop: 2 }}>{[s.class_label && `Class ${s.class_label}`, s.roll_no && `Roll ${s.roll_no}`, s.admission_no && `Adm. ${s.admission_no}`, `ID ${s.login_id}`].filter(Boolean).join('  ·  ')}</Text>
          </View>
        </View>
        {(s.graduated || d.tags.length > 0) && <ChipRow style={{ marginTop: 12 }}>{s.graduated && <Chip tone="info">Left school</Chip>}{d.tags.map((x, i) => <Chip key={i} tone={x.tone}>{x.label}</Chip>)}</ChipRow>}
        {sessions.length > 1 && <View style={{ marginTop: 12 }}><Choice value={ac?.session_id || ''} onChange={setSession} options={sessions.map((x) => ({ value: x.id, label: `${x.name}${x.is_current ? ' (current)' : ''}` }))} /></View>}
      </Card>

      <KpiGrid>
        <Kpi icon="attendance" color="#0ea5e9" label="Attendance" value={pctText(ap)} sub={att ? `${att.summary.absent} absent` : ''} tone={pctTone(ap, 90, 75)} on={cur === 'att'} onPress={() => setTab('att')} />
        <Kpi icon="academics" color="#8b5cf6" label="Average marks" value={pctText(mp)} sub={ac?.summary?.overall?.grade ? `Grade ${ac.summary.overall.grade}` : ''} tone={pctTone(mp)} on={cur === 'marks'} onPress={() => setTab('marks')} />
        {d.viewer.can_fees && <Kpi icon="rupee" color="#10b981" label="Fee balance" value={t ? rupees(t.pending) : '-'} sub={t ? (t.pending <= 0 ? 'All paid' : t.due_till_date > 0 ? `${rupees(t.due_till_date)} due now` : 'Not yet due') : ''} tone={t ? (t.pending <= 0 ? 'ok' : t.due_till_date > 0 ? 'bad' : 'warn') : undefined} on={cur === 'fees'} onPress={() => setTab('fees')} />}
        <Kpi icon="file" color="#f59e0b" label="Homework" value={hw ? `${hw.submitted}/${hw.submitted + hw.pending + hw.overdue}` : '-'} sub={hw ? (hw.overdue ? `${hw.overdue} overdue` : hw.pending ? `${hw.pending} pending` : 'Up to date') : ''} tone={hw ? (hw.overdue ? 'bad' : hw.pending ? 'warn' : 'ok') : undefined} on={cur === 'hw'} onPress={() => setTab('hw')} />
      </KpiGrid>

      <View style={{ marginBottom: 12 }}><Choice value={cur} onChange={setTab} options={tabs} /></View>

      {cur === 'att' && <Section title="Attendance" icon="attendance" color="#0ea5e9"><AttendanceSection a={att} /></Section>}
      {cur === 'marks' && <Section title="Marks & performance" icon="academics" color="#8b5cf6"><MarksSection ac={ac} /></Section>}
      {cur === 'fees' && d.viewer.can_fees && <Section title="Fees" icon="rupee" color="#10b981"><FeesSection f={fe} /></Section>}
      {cur === 'hw' && <Section title="Homework" icon="file" color="#f59e0b"><HomeworkSection h={hw} /></Section>}
      {cur === 'family' && <Section title="Personal & family" icon="users" color="#ec4899"><FamilySection s={s} parents={Array.isArray(d.parents) ? d.parents : []} /></Section>}
      {cur === 'docs' && <Section title="Certificates & report cards" icon="doc" color="#65a30d"><DocumentsSection docs={docs} /></Section>}
      {cur === 'bus' && showBus && <Section title="Transport" icon="bus" color="#f97316">{bus.assigned ? <Rides rides={bus.rides} /> : <Soft>No school bus is assigned.</Soft>}</Section>}
    </Pad>
  );
}

/* ------------------------------------------------------------------ entry points */
// staff / admin: search, pick, open
export const StudentProfile = scoped(function StaffProfile({ me, sid, sc }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [pick, setPick] = useState(''); const [shut, setShut] = useState({});
  const { data, error, loading, reload } = useApi(pick ? null : `/student-profile/search?q=${encodeURIComponent(dq)}${sc.school_id ? `&school_id=${sc.school_id}` : ''}`);
  const keep = useRef(null); useEffect(() => { if (data) keep.current = data; }, [data]);
  const list = data || keep.current; // no flicker while typing

  if (pick) return <Profile key={pick} me={me} sid={sid} studentId={pick} onBack={() => setPick('')} />;
  const groups = groupByClass(list || [], (x) => x.class_label);
  const isOpen = (g) => (shut[g.label] !== undefined ? !shut[g.label] : !!dq || groups.length === 1);
  return (
    <View style={{ flex: 1 }}>
      <FilterBar q={q} onQ={setQ} placeholder="Search by name, roll no. or ID..." />
      <Pad reload={reload} loading={loading} hasData={!!list}>
        {error && !list && <ErrorBox>{error}</ErrorBox>}
        {!list && !error && <Loading />}
        {list && !list.length && <Empty>{dq ? 'No student matches that search.' : 'No students found in the classes you can use.'}</Empty>}
        {groups.map((g) => (
          <Group key={g.label} label={g.label === 'No class' ? g.label : `Class ${g.label}`} count={g.items.length} open={isOpen(g)} onToggle={() => setShut((c) => ({ ...c, [g.label]: isOpen(g) }))}>
            <List>
              {g.items.map((x, i) => (
                <Row key={x.student_id} onPress={() => setPick(x.student_id)} last={i === g.items.length - 1}>
                  <Avatar name={x.full_name} size={36} />
                  <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{x.full_name}</Text><Text style={{ color: C.mute, fontSize: 12.5 }} numberOfLines={1}>{x.roll_no ? `Roll ${x.roll_no} · ` : ''}{x.login_id}</Text></View>
                </Row>
              ))}
            </List>
          </Group>
        ))}
      </Pad>
    </View>
  );
});

// parent / student: own (or children's) profile
export function MyStudentProfile({ me }) {
  const { data: kids, error } = useApi('/student-profile/my');
  const [pick, setPick] = useState('');
  const cur = pick || kids?.[0]?.student_id;
  if (error && !kids) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!kids) return <Pad><Loading /></Pad>;
  if (!kids.length) return <Pad><Empty>No student is linked to your account yet. Ask the school office.</Empty></Pad>;
  return (
    <View style={{ flex: 1 }}>
      {kids.length > 1 && <View style={{ paddingHorizontal: 16, paddingTop: 12 }}><Choice value={cur} onChange={setPick} options={kids.map((k) => ({ value: k.student_id, label: k.full_name }))} /></View>}
      <Profile key={cur} me={me} sid={me.school_id} studentId={cur} />
    </View>
  );
}
