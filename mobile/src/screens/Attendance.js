// Attendance module for mobile. Mirrors client/src/modules/AttendanceModule.jsx (same endpoints and rules).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, BackHandler, Share } from 'react-native';
import { api } from '../api';
import { C, ymd, timeStr, monthName } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Sheet, Choice, Input, Check, DateField, Press, toast, confirmAsk } from '../ui';
import { useApi } from '../useApi';

/* ---------------------------------------------------------------- shared helpers */
const ST = {
  present: { label: 'Present', color: C.ok, bg: '#dcfce7' },
  absent: { label: 'Absent', color: C.bad, bg: '#fee2e2' },
  late: { label: 'Late', color: C.warn, bg: '#fef3c7' },
  leave: { label: 'Leave', color: C.info, bg: '#dbeafe' },
};
const ORDER = ['present', 'absent', 'late', 'leave'];
const clsName = (c) => `${c.name}${c.section ? ` ${c.section}` : ''}`;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s, long = true) => { if (!s) return ''; const d = new Date(`${s.slice(0, 10)}T00:00:00`); return `${long ? `${DAY[d.getDay()]}, ` : ''}${d.getDate()} ${MON[d.getMonth()]}${long ? ` ${d.getFullYear()}` : ''}`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const qs = (o) => { const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`); return p.length ? `?${p.join('&')}` : ''; };
const path = (p, params, sc) => `/attendance${p}${qs({ ...sc, ...params })}`;

// super admin works inside one school at a time; the choice is remembered between tabs
let chosen = '';
function useScope(me) {
  const sup = me.role === 'super_admin';
  const { data: schools } = useApi(sup ? '/schools' : null);
  const [pick, setPick] = useState(chosen);
  const sid = sup ? (pick || schools?.[0]?.id || '') : me.school_id;
  const picker = sup && schools?.length > 1 ? <View style={{ padding: 16, paddingBottom: 0 }}><Choice value={sid} onChange={(v) => { chosen = v; setPick(v); }} options={schools.map((x) => ({ value: x.id, label: x.name }))} /></View> : null;
  return { sid, picker, sc: sup ? { school_id: sid } : {} };
}
function scoped(Inner) {
  return function Scoped(props) {
    const { sid, picker, sc } = useScope(props.me);
    return <View style={{ flex: 1 }}>{picker}{sid ? <Inner key={sid} {...props} sid={sid} sc={sc} /> : <Empty>Choose a school to continue.</Empty>}</View>;
  };
}
const useClasses = (sc, date = '') => useApi(path('/classes', date ? { date } : {}, sc));

// open "this class on this day" in Take attendance from another tab
let jump = null;

const Pad = ({ children, reload, loading, hasData }) => (
  <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" refreshControl={reload ? <RefreshControl refreshing={!!loading && !!hasData} onRefresh={reload} /> : undefined}>{children}</ScrollView>
);
const Notice = ({ tone = 'info', children }) => {
  const t = { info: ['#e0f2fe', '#075985'], ok: ['#dcfce7', '#166534'], warn: ['#fef3c7', '#92400e'] }[tone];
  return <View style={{ backgroundColor: t[0], borderRadius: 10, padding: 10, marginBottom: 10 }}><Text style={{ color: t[1], fontSize: 13 }}>{children}</Text></View>;
};
const Pct = ({ v, size = 14 }) => <Text style={{ fontWeight: '700', fontSize: size, color: v === null || v === undefined ? C.mute : v >= 90 ? C.ok : v >= 75 ? C.warn : C.bad }}>{v === null || v === undefined ? '-' : `${v}%`}</Text>;
const Bar = ({ v }) => <View style={{ height: 6, borderRadius: 3, backgroundColor: '#e5ece7', overflow: 'hidden', marginTop: 4 }}><View style={{ height: 6, width: `${v || 0}%`, backgroundColor: v >= 90 ? C.ok : v >= 75 ? C.warn : C.bad }} /></View>;
const Roll = ({ n }) => <View style={{ minWidth: 30, height: 26, borderRadius: 8, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}><Text style={{ color: C.brand, fontWeight: '700', fontSize: 12 }}>{n ?? '-'}</Text></View>;
function Tile({ n, label, color, on, onPress }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={{ flex: 1, minWidth: 70, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: '#fff', borderWidth: on ? 2 : 1, borderColor: on ? (color || C.brand) : C.line }}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: color || C.ink }}>{n}</Text>
      <Text style={{ fontSize: 11, color: C.mute }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}
const Tiles = ({ children }) => <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>{children}</View>;
const Row = ({ onPress, children, last }) => (
  <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: last ? 0 : 1, borderColor: C.line }, pressed && onPress && { backgroundColor: C.soft }]}>{children}</Pressable>
);
const List = ({ children }) => <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.line, marginBottom: 12, overflow: 'hidden' }}>{children}</View>;

async function shareCsv(title, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  try { await Share.share({ title, message: rows.map((r) => r.map(esc).join(',')).join('\n') }); } catch (e) { toast(e.message, true); }
}

/* ================================================================= TAKE ATTENDANCE */
function statusLine(c) {
  if (c.state === 'not_marked') return { tone: C.mute, text: 'Not marked yet' };
  const who = c.marked_by.length ? ` by ${c.marked_by.join(', ')}` : '';
  if (c.state === 'partial') return { tone: C.warn, text: `Partly marked ${c.marked}/${c.total_students}${who}` };
  return { tone: C.ok, text: `Marked${who}${c.last_updated ? ` at ${timeStr(c.last_updated)}` : ''}` };
}

function ClassCard({ c, onOpen }) {
  const s = statusLine(c);
  return (
    <Press onPress={() => onOpen(c.id)} style={{ backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line, borderLeftWidth: 4, borderLeftColor: s.tone, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontWeight: '800', fontSize: 17, color: C.ink }}>Class {clsName(c)}</Text>
        {c.is_class_teacher && <Text style={{ fontSize: 11, color: C.brand, backgroundColor: C.soft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden', fontWeight: '600' }}>Class teacher</Text>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}><Icon name={c.state === 'marked' ? 'check' : 'attendance'} size={14} color={s.tone} /><Text style={{ color: s.tone, fontSize: 13, flex: 1 }}>{s.text}</Text></View>
      <Text style={{ marginTop: 6, fontSize: 13 }}>
        {c.marked > 0 ? <>
          <Text style={{ color: C.ok }}>{c.present} present</Text><Text style={{ color: C.mute }}> · </Text><Text style={{ color: C.bad }}>{c.absent} absent</Text>
          {c.late > 0 && <Text style={{ color: C.warn }}> · {c.late} late</Text>}{c.leave > 0 && <Text style={{ color: C.info }}> · {c.leave} leave</Text>}
        </> : <Text style={{ color: C.mute }}>{plural(c.total_students, 'student')}</Text>}
      </Text>
    </Press>
  );
}

function MarkSheet({ me, sc, classId, date, today, active, onBack, onSaved, goRolls }) {
  const [sh, setSh] = useState(null); const [err, setErr] = useState('');
  const [marks, setMarks] = useState({}); const [saved, setSaved] = useState({});
  const [touched, setTouched] = useState(false); const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(''); const [sort, setSort] = useState('roll'); const [filter, setFilter] = useState(''); const [more, setMore] = useState(null);

  const fetchSheet = useCallback(async () => {
    const d = await api.get(path('/sheet', { class_id: classId, date }, sc));
    const s = {}; const m = {};
    d.students.forEach((x) => { s[x.student_id] = x.status; m[x.student_id] = x.status || 'absent'; });
    setSh(d); setSaved(s); setMarks(m); setTouched(false);
    return d;
  }, [sc, classId, date]);
  useEffect(() => { fetchSheet().catch((e) => setErr(e.message)); }, [fetchSheet]);

  const students = sh?.students || [];
  const dirty = students.some((s) => marks[s.student_id] !== saved[s.student_id]);
  const back = useCallback(() => { if (touched && dirty) confirmAsk('You have unsaved changes. Leave without saving?', onBack); else onBack(); }, [touched, dirty, onBack]);
  useEffect(() => {
    if (!active) return undefined;
    const h = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => h.remove();
  }, [active, back]);

  const counts = useMemo(() => { const c = { present: 0, absent: 0, late: 0, leave: 0 }; students.forEach((s) => { c[marks[s.student_id]] += 1; }); return c; }, [students, marks]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = students.filter((s) => (!filter || marks[s.student_id] === filter) && (!needle || `${s.full_name} ${s.login_id} ${s.admission_no || ''} ${s.roll_no ?? ''}`.toLowerCase().includes(needle)));
    return [...list].sort(sort === 'name' ? (a, b) => a.full_name.localeCompare(b.full_name) : (a, b) => (a.roll_no ?? 1e9) - (b.roll_no ?? 1e9) || a.full_name.localeCompare(b.full_name));
  }, [students, marks, q, sort, filter]);

  const can = !!sh?.can_edit;
  const set = (id, status) => { setMarks((m) => ({ ...m, [id]: status })); setTouched(true); };
  const setAll = (status) => { setMarks(Object.fromEntries(students.map((s) => [s.student_id, status]))); setTouched(true); };
  const toggle = (id) => set(id, marks[id] === 'present' ? 'absent' : 'present');

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.put('/attendance/sheet', { class_id: classId, date: sh.date, records: students.map((s) => ({ student_id: s.student_id, status: marks[s.student_id] })), ...sc });
      await fetchSheet(); onSaved?.();
      toast(`Attendance saved - ${counts.absent} absent${r.saved === 0 ? ' (no changes)' : ''}`);
    } catch (x) { setErr(x.message); toast(x.message, true); } finally { setBusy(false); }
  };

  if (err && !sh) return <Pad><View style={{ alignSelf: 'flex-start', marginBottom: 12 }}><Btn small kind="ghost" title="Back" onPress={onBack} /></View><ErrorBox>{err}</ErrorBox></Pad>;
  if (!sh) return <Pad><Loading /></Pad>;

  const st = sh.status; const noRoll = students.filter((s) => !s.roll_no).length;
  const isToday = sh.date === today;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Pressable onPress={back} hitSlop={8} style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><Icon name="back" size={20} color={C.ink} /></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>Class {clsName(sh.class)}</Text>
            <Dim>{isToday ? 'Today · ' : ''}{fmtDate(sh.date)}{sh.teachers.length ? ` · ${sh.teachers.map((t) => t.name).join(', ')}` : ''}</Dim>
          </View>
        </View>

        {sh.holiday && <Notice tone="warn">{fmtDate(sh.date, false)} is marked as {sh.holiday.title} ({sh.holiday.type}) in the school calendar. You can still mark attendance if school was open.</Notice>}
        {!can && <Notice>{sh.edit_note || 'View only'} - you can look but not change this sheet.</Notice>}
        {st.state === 'marked' && <Notice tone="ok">Already marked{st.marked_by.length ? ` by ${st.marked_by.join(', ')}` : ''}{st.last_updated ? ` at ${timeStr(st.last_updated)}` : ''}. {can ? 'No need to redo it - tap a student to change (e.g. came late).' : ''}</Notice>}
        {st.state === 'partial' && <Notice tone="warn">Only {st.marked} of {st.total_students} students are marked{st.marked_by.length ? ` (by ${st.marked_by.join(', ')})` : ''}. The rest are new or were missed - save to mark everyone.</Notice>}
        {st.state === 'not_marked' && students.length > 0 && <Notice>Not marked yet. Everyone starts as Absent - tap a student to mark Present, then save.</Notice>}
        {noRoll > 0 && students.length > 0 && (
          <Notice tone="warn">{noRoll} student{noRoll === 1 ? ' has' : 's have'} no roll number.{goRolls ? ' ' : ''}{goRolls && <Text style={{ textDecorationLine: 'underline', fontWeight: '700' }} onPress={goRolls}>Assign roll numbers</Text>}</Notice>
        )}

        {students.length === 0 ? <Empty>No active students in this class.</Empty> : (<>
          <Tiles>{ORDER.map((k) => <Tile key={k} color={ST[k].color} n={counts[k]} label={ST[k].label} on={filter === k} onPress={() => setFilter(filter === k ? '' : k)} />)}</Tiles>
          <Input placeholder="Search name or roll no." value={q} onChangeText={setQ} />
          <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
            <Btn small kind="ghost" title={sort === 'roll' ? 'Sorted by roll no.' : 'Sorted by name'} onPress={() => setSort(sort === 'roll' ? 'name' : 'roll')} />
            {can && <Btn small kind="ghost" title={counts.present === students.length ? 'Mark all absent' : 'Mark all present'} onPress={() => setAll(counts.present === students.length ? 'absent' : 'present')} />}
          </View>
          <List>
            {rows.length === 0 && <Empty>No student matches.</Empty>}
            {rows.map((s, i) => {
              const id = s.student_id; const cur = marks[id]; const t = ST[cur];
              return (
                <View key={id} style={{ borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderColor: C.line, backgroundColor: cur === 'present' ? '#fff' : t.bg + '88' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Pressable disabled={!can} onPress={() => toggle(id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingLeft: 12 }}>
                      <Roll n={s.roll_no} />
                      <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }} numberOfLines={1}>{s.full_name}</Text>{saved[id] && saved[id] !== cur ? <Text style={{ fontSize: 11, color: C.warn }}>changed</Text> : null}</View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>{cur === 'present' && <Icon name="check" size={13} color={t.color} />}<Text style={{ color: t.color, fontWeight: '700', fontSize: 12 }}>{t.label}</Text></View>
                    </Pressable>
                    {can && <Pressable onPress={() => setMore(more === id ? null : id)} hitSlop={6} style={{ paddingHorizontal: 12, paddingVertical: 14 }}><Icon name="more" size={20} color={C.mute} /></Pressable>}
                  </View>
                  {more === id && <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10 }}>{['late', 'leave'].map((k) => <Btn key={k} small kind={cur === k ? undefined : 'ghost'} title={ST[k].label} onPress={() => { set(id, cur === k ? 'present' : k); setMore(null); }} />)}</View>}
                </View>
              );
            })}
          </List>
        </>)}
      </ScrollView>

      {can && students.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.line }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink }}><Text style={{ fontWeight: '800' }}>{counts.present + counts.late + counts.leave}</Text> / {students.length} here</Text>
            <Text style={{ color: counts.absent ? C.bad : C.mute, fontSize: 12 }}>{counts.absent} absent{dirty ? ' · unsaved changes' : ''}</Text>
          </View>
          <View style={{ minWidth: 150 }}><Btn title={busy ? 'Saving...' : st.state === 'marked' && !dirty ? 'Saved' : st.state === 'marked' ? 'Save changes' : 'Save attendance'} onPress={save} disabled={busy || (!dirty && st.state === 'marked')} /></View>
        </View>
      )}
    </View>
  );
}

export const TakeAttendance = scoped(function Take({ me, sid, sc, active, nonce, go }) {
  const [date, setDate] = useState('');
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = useClasses(sc, date);
  // arriving from a report ("open this class on that day")
  useEffect(() => { if (active && jump) { setDate(jump.date || ''); setOpen(jump.class_id); jump = null; } }, [active, nonce]);

  if (open) {
    return <MarkSheet me={me} sc={sc} classId={open} date={date} today={data?.today} active={active}
      onBack={() => { setOpen(null); reload(); }} onSaved={reload}
      goRolls={me.features.includes('manage_roll_numbers') ? () => { setOpen(null); go?.('rolls'); } : null} />;
  }
  if (error && !data) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!data) return <Pad><Loading /></Pad>;
  const marked = data.classes.filter((c) => c.state === 'marked').length;
  const isToday = data.date === data.today;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>{isToday ? 'Today' : fmtDate(data.date)}</Text>
        <Dim style={{ marginBottom: 10 }}>{isToday ? `${fmtDate(data.today)} · ` : ''}{data.classes.length === 0 ? 'No classes' : `${marked} of ${plural(data.classes.length, 'class').replace('classs', 'classes')} marked`}</Dim>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <DateField value={data.date} max={data.today} onChange={(v) => setDate(v === data.today ? '' : v)} />
          {!isToday && <Btn small kind="ghost" title="Back to today" onPress={() => setDate('')} />}
        </View>
      </Card>
      {data.classes.length === 0
        ? <Empty>{me.features.includes('attendance_all_classes') ? 'This school has no classes yet. Add them under Users > Classes on the web app.' : 'No class is assigned to you yet. Ask your school admin to assign you under Attendance > Class teachers.'}</Empty>
        : data.classes.map((c) => <ClassCard key={c.id} c={c} onOpen={setOpen} />)}
    </Pad>
  );
});

/* ================================================================= REPORTS */
function RangeBar({ today, value, shown, onChange }) {
  const first = (t) => `${t.slice(0, 7)}-01`;
  const back = (t, n) => { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const presets = [['This session', { from: '', to: '' }], ['This month', { from: first(today), to: today }], ['Last 7 days', { from: back(today, 6), to: today }], ['Last 30 days', { from: back(today, 29), to: today }]];
  const same = (a, b) => a.from === b.from && a.to === b.to;
  return (
    <View style={{ marginBottom: 12 }}>
      <Choice value={presets.find(([, v]) => same(value, v))?.[0]} onChange={(l) => onChange(presets.find(([x]) => x === l)[1])} options={presets.map(([l]) => ({ value: l, label: l }))} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}><DateField value={value.from || shown?.from || today} max={today} onChange={(v) => onChange({ from: v, to: value.to || shown?.to || today })} /></View>
        <Text style={{ color: C.mute }}>to</Text>
        <View style={{ flex: 1 }}><DateField value={value.to || shown?.to || today} max={today} onChange={(v) => onChange({ from: value.from || shown?.from || '', to: v })} /></View>
      </View>
    </View>
  );
}
const ClassPick = ({ classes, value, onChange, all }) => (
  <View style={{ marginBottom: 12 }}><Choice value={value} onChange={onChange} options={[...(all ? [{ value: '', label: 'All my classes' }] : []), ...classes.map((c) => ({ value: c.id, label: `Class ${clsName(c)}` }))]} /></View>
);

function DailyReport({ sc, today, onOpen }) {
  const [date, setDate] = useState(today);
  const { data, error, loading } = useApi(path('/reports/daily', { date }, sc));
  return (<>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <DateField value={date} max={today} onChange={setDate} />{date !== today && <Btn small kind="ghost" title="Today" onPress={() => setDate(today)} />}
    </View>
    <ErrorBox>{error}</ErrorBox>
    {!data ? (loading && <Loading />) : (<>
      <Tiles><Tile n={`${data.totals.classes_marked}/${data.totals.classes}`} label="Classes marked" /><Tile color={C.ok} n={data.totals.present} label="Present" /><Tile color={C.bad} n={data.totals.absent} label="Absent" /><Tile color={C.warn} n={data.totals.late} label="Late" /></Tiles>
      {data.classes.length === 0 ? <Empty>No classes to show.</Empty> : (
        <List>{data.classes.map((c, i) => { const s = statusLine(c); return (
          <Row key={c.id} last={i === data.classes.length - 1} onPress={() => onOpen(c.id, date)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: C.ink }}>Class {clsName(c)}</Text>
              <Dim>{c.teachers.length ? c.teachers.join(', ') : 'No teacher assigned'}</Dim>
              <Text style={{ color: s.tone, fontSize: 12, marginTop: 2 }}>{s.text}</Text>
              {c.marked > 0 && <Text style={{ fontSize: 12 }}><Text style={{ color: C.ok }}>{c.present} present</Text><Text style={{ color: C.mute }}> · </Text><Text style={{ color: C.bad }}>{c.absent} absent</Text>{c.late > 0 ? <Text style={{ color: C.warn }}> · {c.late} late</Text> : null}{c.leave > 0 ? <Text style={{ color: C.info }}> · {c.leave} leave</Text> : null}</Text>}
            </View>
            <Icon name="chevron" size={18} color={C.mute} />
          </Row>); })}</List>)}
    </>)}
  </>);
}

function ClassReport({ sc, today, classes, onStudent }) {
  const [classId, setClassId] = useState(classes[0]?.id || '');
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, error, loading } = useApi(classId ? path('/reports/class', { class_id: classId, ...range }, sc) : null);
  const [below, setBelow] = useState(false); const [days, setDays] = useState(false);
  if (!classes.length) return <Empty>No classes available.</Empty>;
  const rows = (data?.students || []).filter((s) => !below || (s.percent !== null && s.percent < 75));
  const share = () => shareCsv(`Attendance ${clsName(data.class)} ${data.range.from} to ${data.range.to}`,
    [['Roll no', 'Name', 'Present', 'Absent', 'Late', 'Leave', 'Days marked', 'Attendance %'], ...data.students.map((s) => [s.roll_no ?? '', s.full_name, s.present, s.absent, s.late, s.leave, s.total, s.percent ?? ''])]);
  return (<>
    <ClassPick classes={classes} value={classId} onChange={setClassId} />
    <RangeBar today={today} value={range} shown={data?.range} onChange={setRange} />
    <ErrorBox>{error}</ErrorBox>
    {!data ? (loading && <Loading />) : (<>
      <Tiles>
        <Tile n={data.working_days} label="Days marked" />
        <Tile n={data.summary.percent === null ? '-' : `${data.summary.percent}%`} label="Class average" color={C.ok} />
        <Tile n={data.students.filter((s) => s.percent !== null && s.percent < 75).length} label="Below 75%" color={C.bad} on={below} onPress={() => setBelow(!below)} />
      </Tiles>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Dim style={{ flex: 1 }}>{fmtDate(data.range.from, false)} to {fmtDate(data.range.to, false)}</Dim>
        <Btn small kind="ghost" title="Share CSV" onPress={share} disabled={!data.students.length} />
      </View>
      {rows.length === 0 ? <Empty>{below ? 'Nobody is below 75%.' : 'No students.'}</Empty> : (
        <List>{rows.map((s, i) => (
          <Row key={s.student_id} last={i === rows.length - 1} onPress={() => onStudent(s)}>
            <Roll n={s.roll_no} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: C.ink }} numberOfLines={1}>{s.full_name}{!s.current ? <Text style={{ color: C.mute, fontWeight: '400' }}> (moved)</Text> : null}</Text>
              <Dim>P {s.present} · A {s.absent} · L {s.late} · Lv {s.leave}</Dim>
              <Bar v={s.percent} />
            </View>
            <Pct v={s.percent} />
          </Row>))}</List>)}
      {data.days.length > 0 && <Card>
        <Pressable onPress={() => setDays(!days)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ fontWeight: '700', color: C.ink }}>Day by day ({data.days.length} days)</Text><Icon name={days ? 'up' : 'down'} size={18} color={C.mute} /></Pressable>
        {days && [...data.days].reverse().map((d) => <View key={d.date} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1, borderColor: C.line, marginTop: 7 }}><Text style={{ color: C.ink, width: 90 }}>{fmtDate(d.date, false)}</Text><Dim style={{ flex: 1 }}>{d.present + d.late} here · {d.absent} absent{d.leave ? ` · ${d.leave} leave` : ''}</Dim><Pct v={d.percent} /></View>)}
      </Card>}
    </>)}
  </>);
}

function StudentSummary({ data }) {
  const s = data.summary;
  return (<>
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>{data.student.full_name}</Text>
          <Dim>{data.student.class ? `Class ${clsName(data.student.class)}` : 'No class'}{data.student.roll_no ? ` · Roll ${data.student.roll_no}` : ''}{data.student.admission_no ? ` · Adm. ${data.student.admission_no}` : ''}</Dim>
        </View>
        <Pct v={s.percent} size={26} />
      </View>
    </Card>
    <Tiles>{ORDER.map((k) => <Tile key={k} color={ST[k].color} n={s[k]} label={ST[k].label} />)}</Tiles>
    <Dim style={{ marginBottom: 12 }}>{fmtDate(data.range.from, false)} to {fmtDate(data.range.to, false)} · {plural(s.total, 'day')} marked</Dim>
    {data.months.length > 0 && <List>{data.months.map((m, i) => (
      <Row key={m.month} last={i === data.months.length - 1}>
        <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{monthName(`${m.month}-01`)}</Text><Dim>P {m.present} · A {m.absent} · L {m.late} · Lv {m.leave}</Dim></View><Pct v={m.percent} />
      </Row>))}</List>}
    {data.absences.length > 0 && <Card>
      <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 8 }}>Days not present</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{data.absences.map((a) => <Text key={a.date} style={{ fontSize: 12, color: ST[a.status].color, backgroundColor: ST[a.status].bg, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' }}>{fmtDate(a.date, false)} · {ST[a.status].label}</Text>)}</View>
    </Card>}
  </>);
}

function StudentReport({ sc, today, picked, setPicked }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const found = useApi(!picked ? path('/students', { q: dq }, sc) : null);
  const { data, error, loading } = useApi(picked ? path(`/reports/student/${picked.student_id}`, range, sc) : null);
  if (!picked) return (<>
    <Input placeholder="Search student by name, ID or roll no." value={q} onChangeText={setQ} />
    <View style={{ height: 12 }} />
    <ErrorBox>{found.error}</ErrorBox>
    {found.data ? (found.data.length === 0 ? <Empty>No student found.</Empty> : (
      <List>{found.data.map((s, i) => <Row key={s.student_id} last={i === found.data.length - 1} onPress={() => setPicked(s)}><Roll n={s.roll_no} /><View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{s.full_name}</Text><Dim>Class {s.class_label} · {s.login_id}</Dim></View><Icon name="chevron" size={18} color={C.mute} /></Row>)}</List>
    )) : found.loading ? <Loading /> : null}
  </>);
  return (<>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}><Btn small kind="ghost" title="Students" onPress={() => setPicked(null)} /><Text style={{ fontWeight: '800', fontSize: 16, color: C.ink, flex: 1 }} numberOfLines={1}>{picked.full_name}</Text></View>
    <RangeBar today={today} value={range} shown={data?.range} onChange={setRange} />
    <ErrorBox>{error}</ErrorBox>
    {!data ? (loading && <Loading />) : <StudentSummary data={data} />}
  </>);
}

function LowReport({ sc, today, classes, onStudent }) {
  const [classId, setClassId] = useState(''); const [limit, setLimit] = useState('75'); const [range, setRange] = useState({ from: '', to: '' });
  const { data, error, loading } = useApi(Number(limit) > 0 ? path('/reports/low', { class_id: classId, threshold: limit, ...range }, sc) : null);
  return (<>
    <ClassPick classes={classes} value={classId} onChange={setClassId} all />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <Dim>Below</Dim><View style={{ width: 80 }}><Input keyboardType="number-pad" value={limit} onChangeText={setLimit} /></View><Dim>%</Dim>
    </View>
    <RangeBar today={today} value={range} shown={data?.range} onChange={setRange} />
    <ErrorBox>{error}</ErrorBox>
    {!data ? (loading && <Loading />) : data.students.length === 0 ? <Empty>Nobody is below {data.threshold}% in this period.</Empty> : (<>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Dim style={{ flex: 1 }}>{plural(data.students.length, 'student')} below {data.threshold}%</Dim>
        <Btn small kind="ghost" title="Share CSV" onPress={() => shareCsv(`Low attendance ${data.range.from} to ${data.range.to}`, [['Class', 'Roll no', 'Name', 'Present', 'Absent', 'Late', 'Leave', 'Attendance %'], ...data.students.map((s) => [s.class_label, s.roll_no ?? '', s.full_name, s.present, s.absent, s.late, s.leave, s.percent])])} />
      </View>
      <List>{data.students.map((s, i) => (
        <Row key={`${s.student_id}${s.class_id}`} last={i === data.students.length - 1} onPress={() => onStudent(s)}>
          <Roll n={s.roll_no} /><View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{s.full_name}</Text><Dim>Class {s.class_label} · {s.absent} absent of {s.total} days</Dim></View><Pct v={s.percent} />
        </Row>))}</List>
    </>)}
  </>);
}

export const AttendanceReports = scoped(function Reports({ me, sc, go }) {
  const [tab, setTab] = useState('daily'); const [picked, setPicked] = useState(null);
  const { data, error, loading, reload } = useClasses(sc);
  if (error && !data) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!data) return <Pad><Loading /></Pad>;
  const openStudent = (s) => { setPicked({ student_id: s.student_id, full_name: s.full_name }); setTab('student'); };
  const openClass = (class_id, date) => { jump = { class_id, date: date === data.today ? '' : date }; go?.('take'); };
  return (
    <Pad reload={reload} loading={loading} hasData>
      <View style={{ marginBottom: 12 }}><Choice value={tab} onChange={setTab} options={[['daily', 'Daily overview'], ['class', 'Class report'], ['student', 'Student report'], ['low', 'Low attendance']].map(([value, label]) => ({ value, label }))} /></View>
      {tab === 'daily' && <DailyReport sc={sc} today={data.today} onOpen={openClass} />}
      {tab === 'class' && <ClassReport sc={sc} today={data.today} classes={data.classes} onStudent={openStudent} />}
      {tab === 'student' && <StudentReport sc={sc} today={data.today} picked={picked} setPicked={setPicked} />}
      {tab === 'low' && <LowReport sc={sc} today={data.today} classes={data.classes} onStudent={openStudent} />}
    </Pad>
  );
});

/* ================================================================= ROLL NUMBERS */
export const RollNumbers = scoped(function Rolls({ sc }) {
  const { data: cl, error: clErr } = useClasses(sc);
  const [classId, setClassId] = useState('');
  const [d, setD] = useState(null); const [vals, setVals] = useState({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const init = (res) => { setD(res); setVals(Object.fromEntries(res.students.map((s) => [s.student_id, s.roll_no ?? '']))); };
  useEffect(() => {
    if (!classId) return;
    setD(null); setErr('');
    api.get(path('/rolls', { class_id: classId }, sc)).then(init).catch((e) => setErr(e.message));
  }, [classId]); // eslint-disable-line
  useEffect(() => { if (!classId && cl?.classes?.length) setClassId(cl.classes[0].id); }, [cl]); // eslint-disable-line

  const dups = useMemo(() => { const c = {}; Object.values(vals).forEach((v) => { if (v !== '') c[v] = (c[v] || 0) + 1; }); return new Set(Object.keys(c).filter((k) => c[k] > 1)); }, [vals]);
  const bad = (v) => v !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 100);
  const dirty = d && d.students.some((s) => String(s.roll_no ?? '') !== String(vals[s.student_id] ?? ''));
  const invalid = Object.values(vals).some(bad) || dups.size > 0;

  const run = async (fn, ok) => { setBusy(true); setErr(''); try { init(await fn()); toast(ok); } catch (x) { setErr(x.message); toast(x.message, true); } finally { setBusy(false); } };
  const save = () => run(() => api.put('/attendance/rolls', { class_id: classId, items: d.students.map((s) => ({ student_id: s.student_id, roll_no: vals[s.student_id] === '' ? null : Number(vals[s.student_id]) })), ...sc }), 'Roll numbers saved');
  const auto = (mode) => {
    const go = () => run(() => api.post('/attendance/rolls/auto', { class_id: classId, mode, ...sc }), mode === 'name' ? 'Numbered A-Z' : 'Missing roll numbers filled');
    if (mode === 'name' && d.students.some((s) => s.roll_no)) return confirmAsk('This renumbers EVERY student 1, 2, 3... in A-Z order of name. Continue?', go);
    if (dirty) return confirmAsk('Discard your unsaved edits?', go);
    return go();
  };
  const pickClass = (id) => { if (dirty) confirmAsk('Discard your unsaved edits?', () => setClassId(id)); else setClassId(id); };

  if (clErr && !cl) return <Pad><ErrorBox>{clErr}</ErrorBox></Pad>;
  if (!cl) return <Pad><Loading /></Pad>;
  if (!cl.classes.length) return <Pad><Empty>No classes available.</Empty></Pad>;
  const sorted = d ? [...d.students].sort((a, b) => (Number(vals[a.student_id]) || 1e9) - (Number(vals[b.student_id]) || 1e9) || a.full_name.localeCompare(b.full_name)) : [];
  return (
    <View style={{ flex: 1 }}>
      <Pad>
        <ClassPick classes={cl.classes} value={classId} onChange={pickClass} />
        <Dim style={{ marginBottom: 12 }}>Roll numbers are 1 to 100 and unique inside one class (Roll 1 can exist in 1A and in 1B). They are cleared at year-end promotion, so assign them again for the new class.</Dim>
        <ErrorBox>{err}</ErrorBox>
        {!d ? (err ? null : <Loading />) : d.students.length === 0 ? <Empty>No active students in this class.</Empty> : (<>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}><Btn small kind="ghost" title="Fill missing numbers" disabled={busy} onPress={() => auto('fill')} /><Btn small kind="ghost" title="Number all A-Z" disabled={busy} onPress={() => auto('name')} /></View>
          <List>{sorted.map((s, i) => {
            const v = vals[s.student_id]; const flagged = bad(v) || (v !== '' && dups.has(String(v)));
            return (
              <Row key={s.student_id} last={i === sorted.length - 1}>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }} numberOfLines={1}>{s.full_name}</Text><Dim>{s.admission_no ? `Adm. ${s.admission_no}` : s.login_id}</Dim></View>
                <View style={{ width: 76 }}><Input keyboardType="number-pad" maxLength={3} placeholder="-" value={String(v)} onChangeText={(t) => setVals({ ...vals, [s.student_id]: t.replace(/[^0-9]/g, '') })} style={[{ textAlign: 'center' }, flagged && { borderColor: C.bad, backgroundColor: '#fee2e2' }]} /></View>
              </Row>);
          })}</List>
        </>)}
      </Pad>
      {d && d.students.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.line }}>
          <Text style={{ flex: 1, color: dups.size > 0 || invalid ? C.bad : C.mute }}>{dups.size > 0 ? 'Duplicate roll numbers' : invalid ? 'Use whole numbers 1-100' : dirty ? 'Unsaved changes' : 'All saved'}</Text>
          <View style={{ minWidth: 150 }}><Btn title={busy ? 'Saving...' : 'Save roll numbers'} disabled={busy || !dirty || invalid} onPress={save} /></View>
        </View>
      )}
    </View>
  );
});

/* ================================================================= CLASS TEACHERS */
function AssignForm({ sc, cls, teachers, onSaved }) {
  const [sel, setSel] = useState(new Set(cls.teachers.map((t) => t.user_id)));
  const [head, setHead] = useState(cls.teachers.find((t) => t.is_class_teacher)?.user_id || '');
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const list = teachers.filter((t) => !q || `${t.full_name} ${t.login_id} ${t.designation || ''}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => { const n = new Set(sel); if (n.has(id)) { n.delete(id); if (head === id) setHead(''); } else n.add(id); setSel(n); };
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.put(`/attendance/classes/${cls.id}/teachers`, { teacher_ids: [...sel], class_teacher_id: head || null, ...sc }); toast('Teachers updated'); await onSaved(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (<>
    <Input placeholder="Search staff" value={q} onChangeText={setQ} />
    <View style={{ height: 10 }} />
    {teachers.length === 0 && <Empty>No staff accounts yet. Create users with the role "Staff" first.</Empty>}
    {list.map((t) => (
      <View key={t.user_id} style={{ borderBottomWidth: 1, borderColor: C.line, paddingVertical: 4 }}>
        <Check label={`${t.full_name}${t.designation ? ` · ${t.designation}` : ''}`} value={sel.has(t.user_id)} onChange={() => toggle(t.user_id)} />
        {sel.has(t.user_id) && <View style={{ alignSelf: 'flex-start', marginBottom: 6, marginLeft: 8 }}><Btn small kind={head === t.user_id ? undefined : 'ghost'} title={head === t.user_id ? '★ Class teacher' : 'Make class teacher'} onPress={() => setHead(head === t.user_id ? '' : t.user_id)} /></View>}
      </View>))}
    <View style={{ height: 12 }} />
    <ErrorBox>{err}</ErrorBox>
    <Btn title={busy ? 'Saving...' : `Save (${sel.size} selected)`} onPress={save} disabled={busy} />
  </>);
}

export const ClassTeachers = scoped(function Teachers({ sc }) {
  const [edit, setEdit] = useState(null);
  const { data: d, error, loading, reload } = useApi(path('/teachers', {}, sc));
  if (error && !d) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!d) return <Pad><Loading /></Pad>;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Dim style={{ marginBottom: 12 }}>Teachers only see the classes assigned to them in Take attendance. Staff with "Access every class" see all classes.</Dim>
      {d.classes.length === 0 ? <Empty>No classes yet. Add them under Users &gt; Classes on the web app.</Empty> : d.classes.map((c) => (
        <Card key={c.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink }}>Class {clsName(c)}</Text>
            <Btn small kind="ghost" title="Edit" onPress={() => setEdit(c)} />
          </View>
          {c.teachers.length === 0 ? <Dim>No teacher assigned</Dim> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{c.teachers.map((t) => <Text key={t.user_id} style={{ fontSize: 12, color: t.is_class_teacher ? C.brand : C.ink, backgroundColor: t.is_class_teacher ? C.soft : '#f1f5f2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', fontWeight: t.is_class_teacher ? '700' : '400' }}>{t.is_class_teacher ? '★ ' : ''}{t.full_name}</Text>)}</View>}
        </Card>))}
      {edit && <Sheet title={`Teachers of class ${clsName(edit)}`} onClose={() => setEdit(null)}><AssignForm sc={sc} cls={edit} teachers={d.teachers} onSaved={async () => { await reload(); setEdit(null); }} /></Sheet>}
    </Pad>
  );
});

// shared building blocks reused by other modules (Academics)
export { scoped, qs, Pad, Notice, Tile, Tiles, Row, List, Bar, Roll, shareCsv };
