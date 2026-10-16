// Academics module for mobile. Mirrors client/src/modules/AcademicsModule.jsx (same endpoints and rules).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, BackHandler, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { api } from '../api';
import { C, fmt } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Sheet, Choice, Input, Field, DateField, toast, confirmAsk } from '../ui';
import { useApi } from '../useApi';
import { scoped, qs, Pad, Tile, Tiles, Row, List, Bar, Roll, shareCsv } from './Attendance';

/* ---------------------------------------------------------------- helpers */
const apath = (p, params, sc) => `/academics${p}${qs({ ...sc, ...params })}`;
const num = (n) => (n === null || n === undefined ? '-' : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const pctColor = (v) => (v >= 75 ? C.ok : v >= 50 ? C.warn : C.bad);
const useMeta = (sc) => useApi(apath('/meta', {}, sc));

const Pct = ({ v, size = 14 }) => <Text style={{ fontWeight: '700', fontSize: size, color: v === null || v === undefined ? C.mute : pctColor(v) }}>{v === null || v === undefined ? '-' : `${v}%`}</Text>;
const PBar = ({ v }) => <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden', marginTop: 4 }}><View style={{ height: 6, width: `${Math.min(100, v ?? 0)}%`, backgroundColor: pctColor(v ?? 0) }} /></View>;
const GRADE = { A: [C.ok, C.okBg], B: [C.info, C.infoBg], C: [C.warn, C.warnBg] };
const Grade = ({ g }) => { if (!g) return null; const t = GRADE[g[0]] || [C.bad, C.badBg]; return <Text style={{ color: t[0], backgroundColor: t[1], fontWeight: '700', fontSize: 12, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' }}>{g}</Text>; };
const Chip = ({ children, tone }) => <Text style={{ fontSize: 11, fontWeight: '600', color: tone === 'bad' ? C.bad : tone === 'brand' ? C.accent : C.mute, backgroundColor: tone === 'bad' ? C.badBg : tone === 'brand' ? C.soft : C.card2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{children}</Text>;
const Gap = ({ h = 12 }) => <View style={{ height: h }} />;

function SessionPick({ sessions, value, onChange }) {
  const cur = sessions.find((s) => s.is_current);
  return <Choice value={value} onChange={onChange} options={[{ value: '', label: cur ? `${cur.name} (current)` : 'Current session' }, ...sessions.filter((s) => !s.is_current).map((s) => ({ value: s.id, label: s.name })), { value: 'all', label: 'All sessions' }]} />;
}

/* ================================================================== STUDENT DASHBOARD */
// mode 'my' = a student / parent reading their own data, 'staff' = a teacher opening a student from a report
function StudentAcademics({ sc, studentId, mode, onBack, header }) {
  const [session, setSession] = useState(''); const [tab, setTab] = useState('overview'); const [sub, setSub] = useState('');
  const url = mode === 'my' ? `/academics/my${qs({ student_id: studentId, session_id: session })}` : `/academics/reports/student/${studentId}${qs({ ...sc, session_id: session })}`;
  const { data: d, error, reload, loading } = useApi(url);
  if (error && !d) return <Pad>{header}{onBack && <><View style={{ alignSelf: 'flex-start' }}><Btn small kind="ghost" title="Back" onPress={onBack} /></View><Gap /></>}<ErrorBox>{error}</ErrorBox></Pad>;
  if (!d) return <Pad>{header}<Loading /></Pad>;
  const s = d.summary;
  const recent = [...d.tests, ...d.exams.flatMap((e) => e.papers)].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  return (
    <Pad reload={reload} loading={loading} hasData>
      {header}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {onBack && <Pressable onPress={onBack} hitSlop={8}><Icon name="back" size={22} color={C.ink} /></Pressable>}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{d.student.name}</Text>
            <Dim>{[d.student.class_label && `Class ${d.student.class_label}`, d.student.roll_no && `Roll ${d.student.roll_no}`].filter(Boolean).join(' · ') || 'Student'}</Dim>
          </View>
        </View>
        <Gap h={10} />
        <SessionPick sessions={d.sessions} value={session} onChange={setSession} />
      </Card>
      <Tiles>
        <Tile n={s.overall.pct === null ? '-' : `${s.overall.pct}%`} label={`Overall${s.overall.grade ? ` (${s.overall.grade})` : ''}`} color={s.overall.pct === null ? C.mute : pctColor(s.overall.pct)} />
        <Tile n={s.tests.pct === null ? '-' : `${s.tests.pct}%`} label={`Tests (${s.tests.count})`} />
        <Tile n={s.exams.pct === null ? '-' : `${s.exams.pct}%`} label={`Exams (${s.exams.count})`} />
        <Tile n={d.subjects.length} label="Subjects" />
      </Tiles>
      <View style={{ marginBottom: 12 }}><Choice value={tab} onChange={setTab} options={[['overview', 'Overview'], ['subjects', 'Subjects'], ['tests', `Tests (${d.tests.length})`], ['exams', `Exams (${d.exams.length})`]].map(([value, label]) => ({ value, label }))} /></View>

      {tab === 'overview' && (!d.subjects.length ? <Empty>No marks have been entered yet{d.session_id ? ' for this session' : ''}.</Empty> : <>
        <Card>
          <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 6 }}>Subjects</Text>
          {d.subjects.map((x) => <View key={x.subject_id} style={{ marginTop: 8 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: C.ink, flex: 1 }} numberOfLines={1}>{x.name}</Text><Pct v={x.overall.pct} /></View><PBar v={x.overall.pct} /></View>)}
        </Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><Text style={{ fontWeight: '700', color: C.ink }}>Latest results</Text><Pressable onPress={() => setTab('tests')}><Text style={{ color: C.accent, fontWeight: '600' }}>All tests</Text></Pressable></View>
        <List>{recent.map((r, i) => <ResultRow key={r.id} r={r} last={i === recent.length - 1} />)}</List>
      </>)}

      {tab === 'subjects' && (!d.subjects.length ? <Empty>No subjects yet.</Empty> : d.subjects.map((x) => (
        <Card key={x.subject_id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ fontSize: 17, fontWeight: '800', color: C.ink, flex: 1 }}>{x.name}</Text><View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Pct v={x.overall.pct} /><Grade g={x.overall.grade} /></View></View>
          <PBar v={x.overall.pct} />
          <Dim style={{ marginTop: 8 }}>Tests: {x.tests.count ? `${x.tests.pct}% (${x.tests.count})` : 'none'}   ·   Exams: {x.exams.count ? `${x.exams.pct}% (${x.exams.count})` : 'none'}</Dim>
          {x.recent.length > 1 && <Spark pts={x.recent.map((p) => p.pct)} />}
        </Card>)))}

      {tab === 'tests' && <>
        <View style={{ marginBottom: 12 }}><Choice value={sub} onChange={setSub} options={[{ value: '', label: 'All subjects' }, ...d.subjects.filter((x) => x.tests.count || x.tests.absent).map((x) => ({ value: x.subject_id, label: x.name }))]} /></View>
        {(() => { const rows = d.tests.filter((t) => !sub || t.subject_id === sub); return rows.length === 0 ? <Empty>No tests yet.</Empty> : <List>{rows.map((r, i) => <ResultRow key={r.id} r={r} last={i === rows.length - 1} />)}</List>; })()}
      </>}

      {tab === 'exams' && (!d.exams.length ? <Empty>No exam results yet.</Empty> : d.exams.map((e) => (
        <View key={e.exam_id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <View style={{ flex: 1 }}><Text style={{ fontSize: 16, fontWeight: '800', color: C.ink }}>{e.name}</Text>{e.start_date ? <Dim>{fmt(e.start_date)}</Dim> : null}</View>
            <View style={{ alignItems: 'flex-end' }}><View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Pct v={e.total.pct} size={16} /><Grade g={e.total.grade} /></View><Dim>{num(e.total.obtained)} / {num(e.total.max)}{e.failed ? ` · ${e.failed} below pass` : ''}</Dim></View>
          </View>
          <List>{e.papers.map((p, i) => (
            <Row key={p.id} last={i === e.papers.length - 1}>
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{p.subject}</Text>{p.class_avg_pct !== null && !p.absent ? <Dim>Class avg {p.class_avg_pct}%</Dim> : null}</View>
              {p.absent ? <Chip tone="bad">Absent</Chip> : <View style={{ alignItems: 'flex-end' }}><Text style={{ fontWeight: '700', color: C.ink }}>{num(p.marks)} <Text style={{ color: C.mute, fontWeight: '400' }}>/ {num(p.max_marks)}</Text></Text><View style={{ flexDirection: 'row', gap: 6 }}><Pct v={p.pct} /><Grade g={p.grade} /></View></View>}
            </Row>))}</List>
        </View>)))}
    </Pad>
  );
}

function ResultRow({ r, last }) {
  return (
    <Row last={last}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600', color: C.ink }} numberOfLines={1}>{r.subject}</Text>
        <Dim>{r.title} · {fmt(r.date)}</Dim>
        {r.kind === 'exam' && <View style={{ alignSelf: 'flex-start', marginTop: 3 }}><Chip>Exam</Chip></View>}
      </View>
      {r.absent ? <Chip tone="bad">Absent</Chip> : (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontWeight: '700', color: C.ink }}>{num(r.marks)} <Text style={{ color: C.mute, fontWeight: '400' }}>/ {num(r.max_marks)}</Text></Text>
          <View style={{ flexDirection: 'row', gap: 6 }}><Pct v={r.pct} /><Grade g={r.grade} /></View>
          {r.class_avg_pct !== null && <Dim style={{ fontSize: 11 }}>Class avg {r.class_avg_pct}%</Dim>}
        </View>)}
    </Row>
  );
}

function Spark({ pts }) {
  const w = 180; const h = 34; const step = w / (pts.length - 1);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(h - 3 - (Math.min(100, p) / 100) * (h - 6)).toFixed(1)}`).join('');
  return <View style={{ marginTop: 8 }}><Svg width={w} height={h}><Path d={d} fill="none" stroke={C.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /></Svg></View>;
}

/* ================================================================== MY MARKS (student / parent) */
export function MyMarks({ me }) {
  const isParent = me.role === 'parent';
  const [pickRaw, setPick] = useState('');
  const { data: kidsData, error: kidsErr } = useApi(isParent ? '/users/my-children' : null);
  const kids = isParent ? (kidsData ?? (kidsErr ? [] : null)) : null;
  const pick = pickRaw || kids?.[0]?.user_id || '';
  if (!isParent) return <StudentAcademics sc={{}} studentId={me.user_id} mode="my" />;
  if (!kids) return <Pad><Loading /></Pad>;
  if (!kids.length) return <Pad><Empty>No student is linked to your account yet. Ask the school office.</Empty></Pad>;
  const header = kids.length > 1 ? <View style={{ marginBottom: 12 }}><Choice value={pick} onChange={setPick} options={kids.map((k) => ({ value: k.user_id, label: k.profile?.full_name || k.login_id }))} /></View> : null;
  return pick ? <StudentAcademics key={pick} sc={{}} studentId={pick} mode="my" header={header} /> : null;
}

/* ================================================================== TESTS & MARKS (teacher) */
export const TestsAndMarks = scoped(function TestsAndMarks({ me, sc, active }) {
  const { data: meta, error, reload: reloadMeta } = useMeta(sc);
  const [f, setF] = useState({ class_id: '', subject_id: '', kind: '', session_id: '' });
  const [open, setOpen] = useState(null); const [creating, setCreating] = useState(false);
  const canMake = me.features.includes('manage_assessments');
  const { data: list, error: err, loading, reload } = useApi(meta ? apath('/assessments', f, sc) : null);

  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  if (open) return <MarksSheet me={me} sc={sc} meta={meta} id={open} active={active} onBack={() => { setOpen(null); reload(); }} />;
  if (!meta.classes.length) return <Pad><Empty>{me.features.includes('academics_all_classes') ? 'This school has no classes yet. Add them under Users > Classes on the web app.' : 'No class is assigned to you yet. Ask your school admin to assign you under Attendance > Class teachers.'}</Empty></Pad>;
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Pad reload={reload} loading={loading} hasData={!!list}>
      {canMake && <><Btn title="+ New test / exam paper" onPress={() => setCreating(true)} /><Gap /></>}
      <View style={{ gap: 8, marginBottom: 12 }}>
        <Choice value={f.class_id} onChange={set('class_id')} options={[{ value: '', label: 'All my classes' }, ...meta.classes.map((c) => ({ value: c.id, label: c.label }))]} />
        <Choice value={f.subject_id} onChange={set('subject_id')} options={[{ value: '', label: 'All subjects' }, ...meta.subjects.map((s) => ({ value: s.id, label: s.name }))]} />
        <Choice value={f.kind} onChange={set('kind')} options={[{ value: '', label: 'Tests & exams' }, { value: 'test', label: 'Tests only' }, { value: 'exam', label: 'Exams only' }]} />
        <SessionPick sessions={meta.sessions} value={f.session_id} onChange={set('session_id')} />
      </View>
      <ErrorBox>{err}</ErrorBox>
      {!list ? (err ? null : <Loading />) : list.length === 0 ? <Empty>Nothing here yet.{canMake && meta.subjects.length === 0 ? ' Ask your admin to add subjects first (Academics > Subjects).' : ''}</Empty> : (
        <List>{list.map((a, i) => (
          <Row key={a.id} last={i === list.length - 1} onPress={() => setOpen(a.id)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: C.ink }} numberOfLines={1}>{a.title}</Text>
              <Dim>{a.subject_name} · Class {a.class_label} · {fmt(a.date)}</Dim>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}><Chip tone={a.kind === 'exam' ? 'brand' : undefined}>{a.kind === 'exam' ? `Exam${a.exam_name ? `: ${a.exam_name}` : ''}` : 'Test'}</Chip><Chip>Out of {num(a.max_marks)}</Chip></View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 12, color: a.entered === 0 ? C.mute : a.entered >= a.total_students ? C.ok : C.warn }}>{a.entered === 0 ? 'No marks yet' : `${a.entered}/${a.total_students} entered`}</Text>
              {a.avg_pct !== null && <Text style={{ fontSize: 12, color: C.mute }}>Avg <Pct v={a.avg_pct} /></Text>}
            </View>
          </Row>))}</List>)}
      {creating && <CreateSheet sc={sc} meta={meta} defaults={f} onClose={() => setCreating(false)} onCreated={(a) => { setCreating(false); setOpen(a.id); }} />}
    </Pad>
  );
});

function CreateSheet({ sc, meta, defaults, onClose, onCreated }) {
  const [kind, setKind] = useState(defaults.kind || 'test');
  const curExams = meta.exams.filter((e) => !meta.current_session_id || e.session_id === meta.current_session_id);
  const [f, setF] = useState({ class_id: defaults.class_id || (meta.classes.length === 1 ? meta.classes[0].id : ''), subject_id: defaults.subject_id || '', exam_id: '', title: '', date: meta.today, max_marks: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try { const a = await api.post('/academics/assessments', { ...f, kind, ...sc }); toast('Created. Now enter the marks'); onCreated(a); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="New test / exam paper" onClose={onClose}>
      <Choice value={kind} onChange={setKind} options={[{ value: 'test', label: 'Test' }, { value: 'exam', label: 'Exam paper' }]} /><Gap />
      <Field label="Class"><Choice value={f.class_id} onChange={set('class_id')} options={meta.classes.map((c) => ({ value: c.id, label: c.label }))} /></Field>
      <Field label="Subject"><Choice value={f.subject_id} onChange={set('subject_id')} options={meta.subjects.map((s) => ({ value: s.id, label: s.name }))} /></Field>
      {kind === 'exam'
        ? <Field label="Exam" hint={curExams.length ? '' : 'No exam in the current session. An admin creates them under Academics > Exams.'}><Choice value={f.exam_id} onChange={set('exam_id')} options={curExams.map((x) => ({ value: x.id, label: x.name }))} /></Field>
        : <Field label="Test title"><Input maxLength={120} value={f.title} onChangeText={set('title')} placeholder="e.g. Unit test 1, Chapter 3 quiz" /></Field>}
      <Field label="Date"><DateField value={f.date} onChange={set('date')} /></Field>
      <Field label="Maximum marks"><Input keyboardType="decimal-pad" value={f.max_marks} onChangeText={(t) => set('max_marks')(t.replace(/[^0-9.]/g, ''))} placeholder="e.g. 20" /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Creating...' : 'Create and enter marks'} onPress={save} disabled={busy || !f.class_id || !f.subject_id || !f.max_marks || (kind === 'exam' ? !f.exam_id : !f.title.trim())} />
    </Sheet>
  );
}

function MarksSheet({ me, sc, meta, id, active, onBack }) {
  const [sh, setSh] = useState(null); const [err, setErr] = useState('');
  const [vals, setVals] = useState({}); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false); const refs = useRef({});
  const canEdit = me.features.includes('manage_assessments');
  const apply = (d) => {
    const v = {}; d.students.forEach((s) => { v[s.student_id] = { marks: s.marks === null ? '' : String(s.marks), absent: s.absent }; });
    setSh(d); setVals(v); setDirty(false);
  };
  useEffect(() => { api.get(apath(`/assessments/${id}`, {}, sc)).then(apply).catch((e) => setErr(e.message)); }, [id]); // eslint-disable-line
  const back = useCallback(() => { if (dirty) confirmAsk('You have unsaved marks. Leave without saving?', onBack); else onBack(); }, [dirty, onBack]);
  useEffect(() => {
    if (!active) return undefined;
    const h = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => h.remove();
  }, [active, back]);

  if (err && !sh) return <Pad><View style={{ alignSelf: 'flex-start' }}><Btn small kind="ghost" title="Back" onPress={onBack} /></View><Gap /><ErrorBox>{err}</ErrorBox></Pad>;
  if (!sh) return <Pad><Loading /></Pad>;
  const a = sh.assessment; const max = a.max_marks;
  const bad = (v) => v.marks !== '' && !v.absent && (!Number.isFinite(Number(v.marks)) || Number(v.marks) < 0 || Number(v.marks) > max);
  const invalid = sh.students.filter((s) => bad(vals[s.student_id])).length;
  const entered = sh.students.filter((s) => vals[s.student_id].absent || vals[s.student_id].marks !== '').length;
  const set = (sid, patch) => { setVals((v) => ({ ...v, [sid]: { ...v[sid], ...patch } })); setDirty(true); };

  const save = async () => {
    setBusy(true);
    try {
      const items = sh.students.map((s) => { const v = vals[s.student_id]; return { student_id: s.student_id, absent: v.absent, marks: v.absent || v.marks === '' ? null : Number(v.marks) }; });
      apply(await api.put(`/academics/assessments/${id}/marks`, { items, ...sc })); toast('Marks saved');
    } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const del = () => confirmAsk(`Delete "${a.title}" (${a.subject_name}, Class ${a.class_label}) and all its marks?`, async () => {
    try { await api.del(apath(`/assessments/${id}`, {}, sc)); toast('Deleted'); onBack(); } catch (x) { toast(x.message, true); }
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Pressable onPress={back} hitSlop={8} style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}><Icon name="back" size={20} color={C.ink} /></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{a.title}</Text>
            <Dim>{a.subject_name} · Class {a.class_label} · {fmt(a.date)} · out of {num(max)}{a.kind === 'exam' && a.exam_name ? ` · ${a.exam_name}` : ''}</Dim>
          </View>
        </View>
        {canEdit && <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}><Btn small kind="ghost" title="Edit details" onPress={() => setEdit(true)} /><Btn small kind="danger" title="Delete" onPress={del} /></View>}
        <Tiles>
          <Tile n={`${a.entered}/${a.total_students}`} label="Entered" />
          <Tile n={a.avg_pct === null ? '-' : `${a.avg_pct}%`} label="Average" color={a.avg_pct === null ? C.mute : pctColor(a.avg_pct)} />
          <Tile n={num(a.highest)} label="Highest" /><Tile n={num(a.lowest)} label="Lowest" />
          <Tile n={a.entered - a.absent > 0 ? `${a.passed}/${a.entered - a.absent}` : '-'} label={`Passed (${meta.pass_percent}%)`} />
        </Tiles>
        {sh.students.length === 0 ? <Empty>No students in this class.</Empty> : (
          <List>{sh.students.map((s, i) => {
            const v = vals[s.student_id]; const isBad = bad(v);
            const pct = v.marks !== '' && !v.absent && !isBad ? Math.round((Number(v.marks) / max) * 1000) / 10 : null;
            return (
              <View key={s.student_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: i === sh.students.length - 1 ? 0 : 1, borderColor: C.line, backgroundColor: v.absent ? C.badBg : C.card }}>
                <Roll n={s.roll_no} />
                <Text style={{ flex: 1, fontWeight: '600', color: C.ink }} numberOfLines={2}>{s.full_name}</Text>
                <View style={{ width: 44, alignItems: 'flex-end' }}>{pct !== null && <Pct v={pct} />}</View>
                <TextInput ref={(r) => { refs.current[i] = r; }} editable={canEdit && !v.absent} keyboardType="decimal-pad" returnKeyType="next" blurOnSubmit={false}
                  onSubmitEditing={() => refs.current[i + 1]?.focus()} placeholder={v.absent ? 'Abs' : `/ ${num(max)}`} placeholderTextColor="#8aa598"
                  value={v.absent ? '' : v.marks} onChangeText={(t) => set(s.student_id, { marks: t.replace(/[^0-9.]/g, '') })}
                  style={{ width: 70, textAlign: 'center', borderWidth: 1, borderColor: isBad ? C.bad : C.line, backgroundColor: isBad ? C.badBg : v.absent ? C.card2 : C.card, borderRadius: 10, paddingVertical: 8, fontSize: 15, color: C.ink }} />
                {canEdit && <Pressable onPress={() => set(s.student_id, { absent: !v.absent, marks: '' })} style={{ paddingHorizontal: 8, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: v.absent ? C.bad : C.line, backgroundColor: v.absent ? C.danger : C.card }}><Text style={{ fontSize: 11, fontWeight: '700', color: v.absent ? '#fff' : C.mute }}>Abs</Text></Pressable>}
              </View>);
          })}</List>)}
      </ScrollView>
      {canEdit && sh.students.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: C.card, borderTopWidth: 1, borderColor: C.line }}>
          <View style={{ flex: 1 }}><Text style={{ color: C.ink }}>{entered} of {sh.students.length} filled</Text>{invalid > 0 ? <Text style={{ color: C.bad, fontSize: 12 }}>{invalid} over {num(max)} or invalid</Text> : dirty ? <Text style={{ color: C.warn, fontSize: 12 }}>Unsaved changes</Text> : null}</View>
          <View style={{ minWidth: 130 }}><Btn title={busy ? 'Saving...' : 'Save marks'} onPress={save} disabled={busy || !dirty || invalid > 0} /></View>
        </View>)}
      {edit && <EditSheet sc={sc} meta={meta} a={a} onClose={() => setEdit(false)} onSaved={(d) => { setEdit(false); apply(d); toast('Updated'); }} />}
    </KeyboardAvoidingView>
  );
}

function EditSheet({ sc, meta, a, onClose, onSaved }) {
  const [f, setF] = useState({ title: a.title, date: a.date, max_marks: String(a.max_marks), subject_id: a.subject_id });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => { setBusy(true); setErr(''); try { onSaved(await api.patch(`/academics/assessments/${a.id}`, { ...f, ...sc })); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <Sheet title="Edit details" onClose={onClose}>
      <Field label="Title"><Input maxLength={120} value={f.title} onChangeText={set('title')} /></Field>
      <Field label="Subject"><Choice value={f.subject_id} onChange={set('subject_id')} options={meta.subjects.map((s) => ({ value: s.id, label: s.name }))} /></Field>
      <Field label="Date"><DateField value={f.date} onChange={set('date')} /></Field>
      <Field label="Maximum marks"><Input keyboardType="decimal-pad" value={f.max_marks} onChangeText={(t) => set('max_marks')(t.replace(/[^0-9.]/g, ''))} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Save'} onPress={save} disabled={busy || !f.title.trim() || !f.max_marks} />
    </Sheet>
  );
}

/* ================================================================== REPORTS (teacher / admin) */
export const AcademicReports = scoped(function AcademicReports({ sc, sid }) {
  const { data: meta, error } = useMeta(sc);
  const [f, setF] = useState({ class_id: '', session_id: '', scope: 'all' });
  const [student, setStudent] = useState(null);
  useEffect(() => { if (meta && !f.class_id && meta.classes.length) setF((x) => ({ ...x, class_id: meta.classes[0].id })); }, [meta]); // eslint-disable-line
  const { data: rep, error: err, loading, reload } = useApi(meta && f.class_id ? apath('/reports/class', f, sc) : null);

  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  if (student) return <StudentAcademics sc={sc} studentId={student} mode="staff" onBack={() => setStudent(null)} />;
  if (!meta.classes.length) return <Pad><Empty>No class available. Ask your school admin to assign you under Attendance &gt; Class teachers.</Empty></Pad>;
  const sessionExams = meta.exams.filter((e) => (f.session_id === 'all' ? true : e.session_id === (f.session_id || meta.current_session_id)));
  const exportCsv = () => shareCsv(`Marks ${rep.class.label}`, [
    ['Rank', 'Roll', 'Name', ...rep.subjects.map((s) => `${s.name} %`), 'Obtained', 'Max', 'Overall %', 'Grade'],
    ...rep.students.map((s) => [s.rank ?? '', s.roll_no ?? '', s.full_name, ...rep.subjects.map((x) => s.subjects[x.id]?.pct ?? ''), s.total.obtained, s.total.max, s.total.pct ?? '', s.grade ?? ''])]);
  return (
    <Pad reload={reload} loading={loading} hasData={!!rep}>
      <View style={{ gap: 8, marginBottom: 12 }}>
        <Choice value={f.class_id} onChange={(v) => setF({ ...f, class_id: v })} options={meta.classes.map((c) => ({ value: c.id, label: `Class ${c.label}` }))} />
        <SessionPick sessions={meta.sessions} value={f.session_id} onChange={(v) => setF({ ...f, session_id: v, scope: 'all' })} />
        <Choice value={f.scope} onChange={(v) => setF({ ...f, scope: v })} options={[{ value: 'all', label: 'Tests + exams' }, { value: 'tests', label: 'Tests only' }, { value: 'exams', label: 'All exams' }, ...sessionExams.map((e) => ({ value: e.id, label: `Exam: ${e.name}` }))]} />
      </View>
      <ErrorBox>{err}</ErrorBox>
      {!rep ? (err ? null : <Loading />) : rep.summary.assessments === 0 ? <Empty>No tests or exam papers for this selection yet.</Empty> : (<>
        <Tiles>
          <Tile n={rep.summary.with_marks} label={`of ${rep.summary.students} students`} />
          <Tile n={rep.summary.class_avg === null ? '-' : `${rep.summary.class_avg}%`} label="Class average" color={rep.summary.class_avg === null ? C.mute : pctColor(rep.summary.class_avg)} />
          <Tile n={rep.summary.with_marks ? `${rep.summary.passed}/${rep.summary.with_marks}` : '-'} label={`Passed (${rep.pass_percent}%)`} />
          <Tile n={rep.summary.top ? `${rep.summary.top.pct}%` : '-'} label={rep.summary.top ? `Top: ${rep.summary.top.name}` : 'Top'} />
        </Tiles>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Dim style={{ flex: 1 }}>Tap a student for their full dashboard. Absent entries are not counted.</Dim>
          {rep.students.length > 0 && <Btn small kind="ghost" title="Share CSV" onPress={exportCsv} />}
        </View>
        <List>{rep.students.map((s, i) => (
          <Row key={s.student_id} last={i === rep.students.length - 1} onPress={() => setStudent(s.student_id)}>
            <View style={{ width: 28, alignItems: 'center' }}><Text style={{ fontWeight: '800', color: s.rank && s.rank <= 3 ? C.accent : C.mute }}>{s.rank ?? '-'}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: C.ink }} numberOfLines={1}>{s.roll_no ? `${s.roll_no}. ` : ''}{s.full_name}</Text>
              <Dim numberOfLines={2}>{rep.subjects.map((x) => { const c = s.subjects[x.id]; return `${x.name} ${c ? (c.pct === null ? 'Abs' : `${c.pct}%`) : '-'}`; }).join(' · ')}</Dim>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}><Pct v={s.total.pct} /><Grade g={s.grade} /></View>
          </Row>))}</List>
        <Dim>Subject averages: {rep.subjects.map((x) => `${x.name} ${rep.subject_avgs[x.id] ?? '-'}${rep.subject_avgs[x.id] != null ? '%' : ''}`).join(' · ')}</Dim>
      </>)}
    </Pad>
  );
});

/* ================================================================== SUBJECTS (admin) */
export const SubjectManager = scoped(function SubjectManager({ sc }) {
  const { data: meta, error, reload } = useMeta(sc);
  const [f, setF] = useState({ name: '', code: '' }); const [busy, setBusy] = useState(false); const [edit, setEdit] = useState(null);
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  const add = async () => {
    setBusy(true);
    try { await api.post('/academics/subjects', { ...f, ...sc }); setF({ name: '', code: '' }); await reload(); toast('Subject added'); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const del = (s) => confirmAsk(`Delete subject ${s.name}?`, async () => { try { await api.del(apath(`/subjects/${s.id}`, {}, sc)); await reload(); toast('Deleted'); } catch (x) { toast(x.message, true); } });
  return (
    <Pad reload={reload} hasData>
      <Card>
        <Field label="New subject"><Input maxLength={60} value={f.name} onChangeText={(t) => setF({ ...f, name: t })} placeholder="e.g. Mathematics" /></Field>
        <Field label="Code (optional)"><Input maxLength={12} autoCapitalize="characters" value={f.code} onChangeText={(t) => setF({ ...f, code: t })} placeholder="MATH" /></Field>
        <Btn title={busy ? 'Adding...' : 'Add subject'} onPress={add} disabled={busy || !f.name.trim()} />
      </Card>
      {meta.subjects.length === 0 ? <Empty>No subjects yet. Add the first one above.</Empty> : (
        <List>{meta.subjects.map((s, i) => (
          <Row key={s.id} last={i === meta.subjects.length - 1}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{s.name}</Text>{s.code ? <Dim>{s.code}</Dim> : null}</View>
            <Pressable onPress={() => setEdit(s)} hitSlop={8} style={{ padding: 6 }}><Icon name="edit" size={19} color={C.mute} /></Pressable>
            <Pressable onPress={() => del(s)} hitSlop={8} style={{ padding: 6 }}><Icon name="trash" size={19} color={C.bad} /></Pressable>
          </Row>))}</List>)}
      {edit && <SubjectEdit sc={sc} s={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await reload(); toast('Saved'); }} />}
    </Pad>
  );
});
function SubjectEdit({ sc, s, onClose, onSaved }) {
  const [f, setF] = useState({ name: s.name, code: s.code || '' }); const [err, setErr] = useState('');
  const save = async () => { try { await api.patch(`/academics/subjects/${s.id}`, { ...f, ...sc }); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Sheet title="Edit subject" onClose={onClose}>
      <Field label="Name"><Input maxLength={60} value={f.name} onChangeText={(t) => setF({ ...f, name: t })} /></Field>
      <Field label="Code"><Input maxLength={12} autoCapitalize="characters" value={f.code} onChangeText={(t) => setF({ ...f, code: t })} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title="Save" onPress={save} disabled={!f.name.trim()} />
    </Sheet>
  );
}

/* ================================================================== EXAMS (admin) */
export const ExamManager = scoped(function ExamManager({ sc }) {
  const { data: meta, error, reload } = useMeta(sc);
  const [edit, setEdit] = useState(null);
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  const sessName = (id) => meta.sessions.find((s) => s.id === id)?.name || 'No session';
  const del = (x) => confirmAsk(`Delete exam "${x.name}"?`, async () => { try { await api.del(apath(`/exams/${x.id}`, {}, sc)); await reload(); toast('Deleted'); } catch (e) { toast(e.message, true); } });
  const groups = [...new Set(meta.exams.map((e) => e.session_id))];
  return (
    <Pad reload={reload} hasData>
      <Dim style={{ marginBottom: 10 }}>An exam (e.g. Half-yearly) is created once. Teachers then add a paper for each class and subject.</Dim>
      <Btn title="+ New exam" onPress={() => setEdit({})} /><Gap />
      {meta.exams.length === 0 ? <Empty>No exams yet.</Empty> : groups.map((g) => (
        <View key={g || 'none'}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.mute, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{sessName(g)}</Text>
          <List>{meta.exams.filter((e) => e.session_id === g).map((e, i, arr) => (
            <Row key={e.id} last={i === arr.length - 1}>
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{e.name}</Text><Dim>{e.start_date ? `${fmt(e.start_date)}${e.end_date ? ` to ${fmt(e.end_date)}` : ''}` : 'No dates set'}</Dim></View>
              <Pressable onPress={() => setEdit(e)} hitSlop={8} style={{ padding: 6 }}><Icon name="edit" size={19} color={C.mute} /></Pressable>
              <Pressable onPress={() => del(e)} hitSlop={8} style={{ padding: 6 }}><Icon name="trash" size={19} color={C.bad} /></Pressable>
            </Row>))}</List>
        </View>))}
      {edit && <ExamForm sc={sc} meta={meta} x={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await reload(); toast('Saved'); }} />}
    </Pad>
  );
});
function OptDate({ value, onChange }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1 }}>{value ? <DateField value={value} onChange={onChange} /> : <Btn small kind="ghost" title="Set date" onPress={() => onChange(new Date().toISOString().slice(0, 10))} />}</View>
      {value ? <Btn small kind="ghost" title="Clear" onPress={() => onChange('')} /> : null}
    </View>
  );
}
function ExamForm({ sc, meta, x, onClose, onSaved }) {
  const isNew = !x.id;
  const [f, setF] = useState({ name: x.name || '', start_date: x.start_date || '', end_date: x.end_date || '', session_id: x.session_id || meta.current_session_id || '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try { await (isNew ? api.post('/academics/exams', { ...f, ...sc }) : api.patch(`/academics/exams/${x.id}`, { ...f, ...sc })); onSaved(); } catch (z) { setErr(z.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={isNew ? 'New exam' : 'Edit exam'} onClose={onClose}>
      <Field label="Exam name"><Input maxLength={80} value={f.name} onChangeText={set('name')} placeholder="e.g. Half-yearly, Final, Pre-board" /></Field>
      {isNew && <Field label="Session">{meta.sessions.length === 0 ? <Dim>No session set up</Dim> : <Choice value={f.session_id} onChange={set('session_id')} options={meta.sessions.map((s) => ({ value: s.id, label: `${s.name}${s.is_current ? ' (current)' : ''}` }))} />}</Field>}
      <Field label="Starts (optional)"><OptDate value={f.start_date} onChange={set('start_date')} /></Field>
      <Field label="Ends (optional)"><OptDate value={f.end_date} onChange={set('end_date')} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Save'} onPress={save} disabled={busy || !f.name.trim()} />
    </Sheet>
  );
}
