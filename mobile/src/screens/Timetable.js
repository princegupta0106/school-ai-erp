// Timetable module for mobile. Mirrors client/src/modules/TimetableModule.jsx (same endpoints, permissions and rules).
// The web's wide weekly grids become a DAY selector + a list of periods, and the all-classes / all-teachers matrices become
// collapsible groups (one per class or teacher). Every subject keeps its own colour everywhere (hueOf).
// Views: My timetable, Overview & workload, Class subjects, Class timetable, Auto generate, Teacher timetable, Whole school, Substitutions, Structure.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { api } from '../api';
import { C } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Field, Input, Choice, Chips, Check, DateField, Sheet, toast, confirmAsk } from '../ui';
import { FilterBar } from '../FilterBar';
import { useApi } from '../useApi';
import { sharePdfHtml, shareTextFile } from '../download';
import {
  scoped, qs, Pad, Row, List, Notice, Avatar, Chip, ChipRow, Kpi, KpiGrid, Section, Soft, Meter, Ring, Line, Group,
  TimeField, clock12, fdate, plural, toneColor, hueOf,
} from '../kit';

const ACCENT = '#f59e0b';
const CAP = 40;
const can = (me, ...f) => f.some((x) => me.features.includes(x));
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const clsName = (c) => (c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : '');
const dowOf = (d) => { const n = new Date(`${String(d).slice(0, 10)}T00:00:00`).getDay(); return n === 0 ? 7 : n; };
const keyOf = (s) => `${s.day}|${s.period_id}`;
const firstName = (n) => String(n || '').split(' ')[0];
const intText = (t) => t.replace(/[^0-9]/g, '');
const addMin = (t, m) => { const [h, mi] = String(t || '08:00').split(':').map(Number); const x = Math.min(23 * 60 + 59, h * 60 + mi + m); return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

/* ------------------------------------------------------------------ meta (everything a screen needs to start) */
function useMeta(sc) {
  const r = useApi(`/timetable/meta${qs(sc)}`);
  const T = useMemo(() => {
    const m = r.data; if (!m) return null;
    return {
      teacher: Object.fromEntries(m.teachers.map((t) => [t.user_id, t])), cls: Object.fromEntries(m.classes.map((c) => [c.id, c])),
      subject: Object.fromEntries(m.subjects.map((s) => [s.id, s])), color: Object.fromEntries(m.subjects.map((s) => [s.id, hueOf(s.name)])),
    };
  }, [r.data]);
  return { ...r, meta: r.data, T };
}

/* ------------------------------------------------------------------ PDF / CSV (through the share sheet) */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GRID_CSS = 'body{font:13px sans-serif;margin:22px;color:#111}h1{font-size:20px;margin:0}h2{font-size:14px;margin:2px 0 14px;font-weight:500;color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:7px 8px;text-align:center;vertical-align:middle}th{background:#eef0ff}td.brk{background:#fff4d6;font-weight:600}td small{display:block;color:#555}th small{display:block;font-weight:400;color:#555}';
const gridHtml = ({ title, sub, heads, rows }) => `<!doctype html><html><head><meta charset="utf-8"><style>${GRID_CSS}</style></head><body><h1>${esc(title)}</h1><h2>${esc(sub || '')}</h2><table><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => (c && c.brk ? `<td class="brk" colspan="${heads.length - 1}">${esc(c.brk)}</td>` : i === 0 ? `<th>${c}</th>` : `<td>${c || ''}</td>`)).join('')}</tr>`).join('')}</table></body></html>`;
const shareGrid = (o) => sharePdfHtml(gridHtml(o), o.title, { width: 1123, height: 794 }).catch((e) => toast(e.message, true));
const periodHead = (p) => `${esc(p.name)}<small>${clock12(p.start_time)} - ${clock12(p.end_time)}</small>`;
const weekRows = (meta, cell) => meta.periods.map((p) => (p.is_break ? [periodHead(p), { brk: p.name }] : [periodHead(p), ...meta.settings.days.map((d) => cell(d, p))]));
const shareCsv = (name, rows) => shareTextFile(name, `\ufeff${rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')}`, 'text/csv').catch((e) => toast(e.message, true));

/* ------------------------------------------------------------------ small pieces */
const Dot = ({ color, size = 10 }) => <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
const ShowMore = ({ total, shown, onMore }) => (total > shown ? <View style={{ marginBottom: 12 }}><Btn small kind="ghost" title={`Show more (${total - shown} left)`} onPress={onMore} /></View> : null);
const Hint = ({ children }) => <Notice tone="info">{children}</Notice>;

// a field that looks like an input and opens a PickSheet
const PickBtn = ({ text, placeholder, onPress }) => (
  <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 }}>
    <Text style={{ flex: 1, color: text ? C.ink : C.hint, fontSize: 15 }} numberOfLines={1}>{text || placeholder}</Text>
    <Icon name="down" size={16} color={C.mute} />
  </Pressable>
);

// choose one thing from a long list (teachers, subjects). options: [{ value, label, sub, group }]
function PickSheet({ title, options, value, onPick, onClose }) {
  const [q, setQ] = useState(''); const dq = q.trim().toLowerCase();
  const list = options.filter((o) => !dq || `${o.label} ${o.sub || ''}`.toLowerCase().includes(dq));
  const groups = []; list.forEach((o) => { let g = groups.find((x) => x.name === (o.group || '')); if (!g) { g = { name: o.group || '', items: [] }; groups.push(g); } g.items.push(o); });
  return (
    <Sheet title={title} onClose={onClose}>
      {options.length > 8 && <View style={{ marginBottom: 12 }}><Input value={q} onChangeText={setQ} placeholder="Search..." autoCorrect={false} /></View>}
      {list.length === 0 && <Empty>Nothing matches.</Empty>}
      {groups.map((g) => (
        <View key={g.name || 'all'}>
          {!!g.name && <Text style={{ color: C.mute, fontWeight: '700', fontSize: 12.5, marginBottom: 6, marginTop: 4 }}>{g.name}</Text>}
          <List>
            {g.items.map((o, i) => (
              <Row key={o.value} onPress={() => { onPick(o.value); onClose(); }} last={i === g.items.length - 1}>
                <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: o.value === value ? '800' : '600' }} numberOfLines={1}>{o.label}</Text>{!!o.sub && <Dim>{o.sub}</Dim>}</View>
                {o.value === value && <Icon name="check" size={18} color={C.brand} />}
              </Row>
            ))}
          </List>
        </View>
      ))}
    </Sheet>
  );
}

const dayOptions = (days, today) => days.map((d) => ({ value: d, label: `${DAY[d]}${d === today ? ' (today)' : ''}` }));
const DayPick = ({ days, value, onChange, today }) => <View style={{ marginBottom: 12 }}><Choice value={value} onChange={onChange} options={dayOptions(days, today)} /></View>;
const defaultDay = (meta, today) => (meta.settings.days.includes(today) ? today : meta.settings.days[0]);

// one day as a list of periods. get(p) -> { title, sub, color } or null (nothing in that period)
function PeriodList({ meta, get, onPress, empty = '-' }) {
  return (
    <List>
      {meta.periods.map((p, i) => {
        const last = i === meta.periods.length - 1;
        const left = <View style={{ width: 84 }}><Text style={{ color: C.ink, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{p.name}</Text><Text style={{ color: C.mute, fontSize: 11.5 }}>{clock12(p.start_time)}</Text></View>;
        if (p.is_break) return <Row key={p.id} last={last}>{left}<Chip>Break · {clock12(p.start_time)} - {clock12(p.end_time)}</Chip></Row>;
        const c = get(p);
        return (
          <Row key={p.id} onPress={onPress ? () => onPress(p, c) : undefined} last={last}>
            {left}
            {c ? <><Dot color={c.color} /><View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{c.title}</Text>{!!c.sub && <Dim>{c.sub}</Dim>}</View></> : <Text style={{ flex: 1, color: C.hint }}>{empty}</Text>}
            {!!onPress && <Icon name={c ? 'chevron' : 'plus'} size={16} color={C.mute} />}
          </Row>
        );
      })}
    </List>
  );
}

// one day, everybody: a collapsible group per class (or per teacher). Replaces the wide classes x periods table.
function DayByEntity({ meta, T, slots, day, mode }) {
  const [open, setOpen] = useState({});
  const at = new Map(slots.filter((x) => x.day === day).map((x) => [`${mode === 'teacher' ? x.teacher_id : x.class_id}|${x.period_id}`, x]));
  const ents = mode === 'teacher'
    ? meta.teachers.filter((t) => slots.some((x) => x.teacher_id === t.user_id)).map((t) => ({ id: t.user_id, label: t.name }))
    : meta.classes.map((c) => ({ id: c.id, label: `Class ${clsName(c)}` }));
  if (ents.length === 0) return <Empty>{mode === 'teacher' ? 'No teacher has periods yet.' : 'No classes yet.'}</Empty>;
  return (
    <View>
      {ents.map((e) => {
        const n = meta.periods.filter((p) => !p.is_break && at.get(`${e.id}|${p.id}`)).length;
        const isOpen = open[e.id] ?? ents.length === 1;
        return (
          <Group key={e.id} label={e.label} count={plural(n, 'period')} open={isOpen} onToggle={() => setOpen((o) => ({ ...o, [e.id]: !isOpen }))}>
            <PeriodList meta={meta} empty={mode === 'teacher' ? 'free' : '-'} get={(p) => {
              const x = at.get(`${e.id}|${p.id}`); if (!x) return null;
              return { title: T.subject[x.subject_id]?.name || '', color: T.color[x.subject_id], sub: mode === 'teacher' ? `Class ${clsName(T.cls[x.class_id])}` : T.teacher[x.teacher_id]?.name };
            }} />
          </Group>
        );
      })}
    </View>
  );
}

const NoStructure = ({ me, go }) => (
  <Pad>
    <Empty>The timetable structure is not set up yet.{can(me, 'manage_timetable_setup') && go ? '' : ' Ask your school admin to set it up.'}</Empty>
    {can(me, 'manage_timetable_setup') && !!go && <Btn title="Set it up" onPress={() => go('setup')} />}
  </Pad>
);

/* ================================================================== 7. MY TIMETABLE (teacher: own, student / parent: the class) */
export function MyTimetable() {
  const { data: m, error, reload, loading } = useApi('/timetable/my');
  const [kid, setKid] = useState(''); const [day, setDay] = useState(0);
  const T = useMemo(() => (m ? {
    cls: Object.fromEntries(m.classes.map((c) => [c.id, c])), subject: Object.fromEntries(m.subjects.map((s) => [s.id, s])), color: Object.fromEntries(m.subjects.map((s) => [s.id, hueOf(s.name)])),
    teacher: Object.fromEntries((m.teachers || []).map((t) => [t.user_id, t])), period: Object.fromEntries(m.periods.map((p) => [p.id, p])),
  } : null), [m]);
  if (error && !m) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!m) return <Pad><Loading /></Pad>;
  if (m.kind === 'none') return <Pad><Empty>Timetables belong to a school.</Empty></Pad>;
  if (!m.periods.length) return <Pad><Empty>The timetable has not been set up yet.</Empty></Pad>;
  const meta = { periods: m.periods, settings: m.settings };
  const d = day || defaultDay(meta, m.day);

  if (m.kind === 'class') {
    const kids = m.children || []; const k = kids.find((x) => x.user_id === kid) || kids[0];
    if (!k || !k.class_id) return <Pad><Empty>No class found.</Empty></Pad>;
    const at = Object.fromEntries(m.slots.filter((s) => s.class_id === k.class_id).map((s) => [keyOf(s), s]));
    const today = m.subs.filter((s) => s.class_id === k.class_id && s.sub_date === m.today);
    return (
      <Pad reload={reload} loading={loading} hasData>
        {kids.length > 1 && <View style={{ marginBottom: 12 }}><Choice value={k.user_id} onChange={setKid} options={kids.map((x) => ({ value: x.user_id, label: x.name }))} /></View>}
        <Section title={`Class ${clsName(T.cls[k.class_id])}`} icon="calendar" color={ACCENT}><Dim style={{ marginTop: -6 }}>{k.name}'s weekly timetable</Dim></Section>
        {today.length > 0 && <Notice tone="warn">Today: {today.map((s) => `${T.period[s.period_id]?.name} is taken by ${T.teacher[s.substitute_teacher_id]?.name}`).join('; ')}.</Notice>}
        {m.slots.filter((s) => s.class_id === k.class_id).length === 0 ? <Empty>The timetable for this class is not ready yet.</Empty> : (
          <>
            <DayPick days={meta.settings.days} value={d} onChange={setDay} today={m.day} />
            <PeriodList meta={meta} get={(p) => { const s = at[`${d}|${p.id}`]; return s ? { title: T.subject[s.subject_id]?.name, color: T.color[s.subject_id], sub: T.teacher[s.teacher_id]?.name } : null; }} />
          </>
        )}
      </Pad>
    );
  }

  const at = Object.fromEntries(m.slots.map((s) => [keyOf(s), s]));
  const todays = m.slots.filter((s) => s.day === m.day).length + m.duties.filter((s) => s.sub_date === m.today).length;
  const planned = (m.assignments || []).reduce((n, a) => n + a.periods_per_week, 0);
  return (
    <Pad reload={reload} loading={loading} hasData>
      <KpiGrid>
        <Kpi icon="calendar" color="#6366f1" label="Periods a week" value={m.slots.length} />
        <Kpi icon="bolt" color="#f97316" label="Periods today" value={todays} />
        <Kpi icon="check" color="#10b981" label="Workload" value={`${planned}/${m.max_load}`} sub="planned / limit" tone={planned > m.max_load ? 'bad' : undefined} />
      </KpiGrid>
      {m.duties.length > 0 && (
        <Section title="Your cover duties" icon="userplus" color="#8b5cf6">
          {m.duties.map((s, i) => <Line key={s.id} left={`${fdate(s.sub_date)} · ${T.period[s.period_id]?.name} (${clock12(T.period[s.period_id]?.start_time)})`} mid={T.subject[s.subject_id]?.name} right={`Class ${clsName(T.cls[s.class_id])}`} last={i === m.duties.length - 1} />)}
        </Section>
      )}
      {m.covered.length > 0 && <Notice tone="ok">Your classes are covered: {m.covered.map((s) => `${fdate(s.sub_date)} ${T.period[s.period_id]?.name} (${T.teacher[s.substitute_teacher_id]?.name})`).join('; ')}.</Notice>}
      {m.slots.length === 0 ? <Empty>No periods in your timetable yet.</Empty> : (
        <>
          <DayPick days={meta.settings.days} value={d} onChange={setDay} today={m.day} />
          <PeriodList meta={meta} empty="free" get={(p) => { const s = at[`${d}|${p.id}`]; return s ? { title: `Class ${clsName(T.cls[s.class_id])}`, color: T.color[s.subject_id], sub: T.subject[s.subject_id]?.name } : null; }} />
        </>
      )}
    </Pad>
  );
}

/* ================================================================== 1. OVERVIEW + WORKLOAD */
export const TimetableHome = scoped(function TimetableHome({ me, sc, go }) {
  const { meta, T, error, reload, loading } = useMeta(sc);
  const wq = useApi(`/timetable/workload${qs(sc)}`);
  const [sort, setSort] = useState('load'); const [shown, setShown] = useState(CAP);
  const w = wq.data;
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta || !w) return <Pad><Loading /></Pad>;
  if (!meta.periods.length) return <NoStructure go={go} me={me} />;
  const t = w.totals; const cov = t.required ? Math.round((t.scheduled / t.required) * 100) : 0;
  const rows = w.teachers.map((x) => ({ ...x, t: T.teacher[x.teacher_id] })).filter((x) => x.t).sort((a, b) => (sort === 'name' ? a.t.name.localeCompare(b.t.name) : b.assigned - a.assigned));
  const classRows = w.classes.map((c) => ({ ...c, c: T.cls[c.class_id] })).filter((c) => c.c);
  return (
    <Pad reload={() => { reload(); wq.reload(); }} loading={loading || wq.loading} hasData>
      <KpiGrid>
        <Kpi icon="users" color="#6366f1" label="Teachers" value={t.teachers} />
        <Kpi icon="calendar" color="#0ea5e9" label="Planned a week" value={t.required} sub="periods" />
        <Kpi icon="check" color="#10b981" label="Scheduled" value={t.scheduled} sub="periods placed" />
        <Kpi icon="bolt" color="#f97316" label="Still to schedule" value={t.unassigned} tone={t.unassigned ? 'warn' : undefined} />
        <Kpi icon="shield" color="#ec4899" label="Clashes" value={t.clashes} />
        <Kpi icon="userplus" color="#8b5cf6" label="Substitutions today" value={t.substitutions_today} onPress={can(me, 'manage_substitutions', 'view_timetable') ? () => go('subs') : undefined} />
      </KpiGrid>

      <Section title="Timetable coverage" icon="calendar" color={ACCENT}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <Ring value={cov} size={100} stroke={12} color={toneColor(cov >= 90 ? 'ok' : cov >= 60 ? 'warn' : 'bad')} sub="scheduled" />
          <View style={{ flex: 1, gap: 8 }}>
            <Dim>{t.scheduled} of {t.required} planned periods are placed in class timetables.</Dim>
            {can(me, 'manage_timetable') && <Btn small title="Build class timetables" onPress={() => go('class')} />}
          </View>
        </View>
      </Section>

      <Section title="Class-wise coverage" icon="school" color="#10b981">
        {classRows.length === 0 ? <Soft>No classes yet.</Soft> : classRows.map((c) => (
          <View key={c.class_id} style={{ paddingVertical: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}><Text style={{ color: C.ink, fontWeight: '700' }}>{clsName(c.c)}</Text><Dim>{c.scheduled}/{c.required || '-'}</Dim></View>
            <View style={{ flexDirection: 'row' }}><Meter pct={c.required ? (c.scheduled / c.required) * 100 : 0} color={toneColor(c.required && c.scheduled >= c.required ? 'ok' : 'info')} /></View>
          </View>
        ))}
      </Section>

      <Section title="Teacher workload" icon="users" color="#6366f1">
        <Dim style={{ marginTop: -6, marginBottom: 10 }}>Bar = periods a week given to the teacher. Red means over the limit of {w.max_load}.</Dim>
        <FilterBar inline sort={{ value: sort, onChange: setSort, def: 'load', options: [{ value: 'load', label: 'Busiest first' }, { value: 'name', label: 'A to Z' }] }} />
        {rows.length === 0 ? <Soft>No teachers yet.</Soft> : (
          <>
            {rows.slice(0, shown).map((x, i, a) => {
              const over = x.assigned > w.max_load;
              return (
                <View key={x.teacher_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: i === a.length - 1 ? 0 : 1, borderColor: C.line }}>
                  <Avatar name={x.t.name} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{x.t.name}</Text>
                    <Dim>{plural(x.classes, 'class').replace('classs', 'classes')} · {plural(x.subjects, 'subject')} · {x.scheduled} placed · {x.free} free</Dim>
                    <View style={{ flexDirection: 'row', marginTop: 5 }}><Meter pct={(x.assigned / (w.max_load || 1)) * 100} color={over ? C.bad : C.ok} /></View>
                  </View>
                  <Text style={{ color: over ? C.bad : C.ink, fontWeight: '800' }}>{x.assigned}<Text style={{ color: C.mute, fontWeight: '500' }}>/{w.max_load}</Text></Text>
                </View>
              );
            })}
            <ShowMore total={rows.length} shown={shown} onMore={() => setShown((n) => n + CAP)} />
          </>
        )}
      </Section>
    </Pad>
  );
});

/* ================================================================== CLASS SUBJECTS (subjects + teacher + periods a week of each class) */
export const ClassPlan = scoped(function ClassPlan({ me, sc }) {
  const { meta, T, error, reload, loading } = useMeta(sc);
  const [cid, setCid] = useState(''); const [rows, setRows] = useState(null); const [also, setAlso] = useState([]); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const [pickIdx, setPickIdx] = useState(null); const [adding, setAdding] = useState(false);
  const built = useRef('');
  const classId = cid || meta?.classes?.[0]?.id || '';
  const can2 = can(me, 'manage_timetable_setup', 'manage_timetable');
  const original = (m, c) => [...new Set([...(m.class_subjects?.[c] || []), ...m.assignments.filter((a) => a.class_id === c).map((a) => a.subject_id)])]
    .map((sb) => ({ subject_id: sb, teacher_id: m.assignments.find((a) => a.class_id === c && a.subject_id === sb)?.teacher_id || '', periods_per_week: String(m.class_periods?.[c]?.[sb] ?? '') }));
  useEffect(() => {
    if (!meta || !classId) return;
    if (dirty && built.current === classId) return;
    built.current = classId; setRows(original(meta, classId)); setAlso([]); setDirty(false);
  }, [meta, classId]); // eslint-disable-line
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta || !rows) return <Pad><Loading /></Pad>;
  if (!meta.classes.length) return <Pad><Empty>Add classes first (Users, Classes).</Empty></Pad>;
  if (!meta.subjects.length) return <Pad><Empty>Add subjects first (Academics, Subjects), then choose which classes study them here.</Empty></Pad>;
  const cls = T.cls[classId]; const orig = original(meta, classId);
  const slotsPerWeek = meta.periods.filter((p) => !p.is_break).length * meta.settings.days.length;
  const total = rows.reduce((n, r) => n + (Number(r.periods_per_week) || 0), 0);
  const patch = (i, o) => { setRows(rows.map((r, n) => (n === i ? { ...r, ...o } : r))); setDirty(true); };
  const free = meta.subjects.filter((sb) => !rows.some((r) => r.subject_id === sb.id));
  const teacherOpts = (sb) => {
    const mine = new Set(meta.assignments.filter((a) => a.subject_id === sb).map((a) => a.teacher_id)); const sn = T.subject[sb]?.name;
    return [{ value: '', label: 'No teacher' }, ...meta.teachers.filter((t) => mine.has(t.user_id)).map((t) => ({ value: t.user_id, label: t.name, sub: t.designation, group: `Teaches ${sn}` })), ...meta.teachers.filter((t) => !mine.has(t.user_id)).map((t) => ({ value: t.user_id, label: t.name, sub: t.designation, group: 'Other teachers' }))];
  };
  const loadOf = (tid) => meta.assignments.filter((a) => a.teacher_id === tid && a.class_id !== classId).reduce((n, a) => n + a.periods_per_week, 0) + rows.filter((r) => r.teacher_id === tid).reduce((n, r) => n + (Number(r.periods_per_week) || 0), 0);
  const changes = rows.some((r) => { const o = orig.find((x) => x.subject_id === r.subject_id); return o && o.teacher_id && o.teacher_id !== r.teacher_id; }) || orig.some((o) => !rows.some((r) => r.subject_id === o.subject_id));
  const overT = [...new Set(rows.map((r) => r.teacher_id).filter(Boolean))].filter((t) => loadOf(t) > meta.settings.max_load);
  const doSave = async () => {
    setBusy(true);
    try {
      await api.put(`/timetable/class-plan/${classId}${qs(sc)}`, { items: rows.map((r) => ({ subject_id: r.subject_id, teacher_id: r.teacher_id || null, periods_per_week: r.periods_per_week })), copy_to: also });
      toast('Saved'); setDirty(false); built.current = ''; await reload();
    } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const save = () => {
    if (changes || also.length) confirmAsk(`Removing a subject or changing its teacher clears those periods from the timetable${also.length ? `, and this list replaces the subjects of ${plural(also.length, 'other class').replace('classs', 'classes')}` : ''}. Continue?`, doSave, { yes: 'Save', danger: true });
    else doSave();
  };
  const switchTo = (id) => { const go = () => { setDirty(false); built.current = ''; setCid(id); }; if (dirty) confirmAsk('Discard unsaved changes?', go, { yes: 'Discard', danger: true }); else go(); };
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Hint>For each class: choose its subjects, the teacher of each, and how many periods a week it gets. Then use Auto generate to rebuild the timetable.</Hint>
      <View style={{ marginBottom: 12 }}><Choice value={classId} onChange={switchTo} options={meta.classes.map((c) => ({ value: c.id, label: clsName(c) }))} /></View>
      <Section title={`Class ${clsName(cls)}`} icon="school" color={ACCENT} right={<Chip tone={total > slotsPerWeek ? 'bad' : 'mute'}>{total}/{slotsPerWeek} a week</Chip>}>
        {rows.length === 0 && <Soft>No subjects yet. Add some below.</Soft>}
        {rows.map((r, i) => (
          <View key={r.subject_id} style={{ paddingVertical: 10, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderColor: C.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Dot color={T.color[r.subject_id]} /><Text style={{ flex: 1, color: C.ink, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{T.subject[r.subject_id]?.name}</Text>
              {can2 && <Pressable onPress={() => { setRows(rows.filter((_, n) => n !== i)); setDirty(true); }} hitSlop={8} accessibilityLabel="Remove subject"><Icon name="trash" size={18} color={C.bad} /></Pressable>}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View style={{ flex: 1 }}>{can2 ? <PickBtn text={T.teacher[r.teacher_id]?.name} placeholder="No teacher" onPress={() => setPickIdx(i)} /> : <Text style={{ color: C.ink }}>{T.teacher[r.teacher_id]?.name || 'No teacher'}</Text>}</View>
              <View style={{ width: 84 }}><Input value={r.periods_per_week} editable={can2} onChangeText={(v) => patch(i, { periods_per_week: intText(v) })} keyboardType="number-pad" placeholder="/wk" maxLength={2} /></View>
            </View>
          </View>
        ))}
        {can2 && free.length > 0 && <View style={{ marginTop: 12 }}><Btn small kind="ghost" title="Add a subject" onPress={() => setAdding(true)} /></View>}
        {overT.length > 0 && <View style={{ marginTop: 10 }}><Notice tone="warn">Over the weekly limit ({meta.settings.max_load}): {overT.map((t) => `${T.teacher[t]?.name} (${loadOf(t)})`).join(', ')}</Notice></View>}
      </Section>

      {can2 && meta.classes.length > 1 && (
        <Section title="Also give this exact plan to" icon="users" color="#8b5cf6">
          <Dim style={{ marginTop: -6, marginBottom: 10 }}>Subjects, teachers and periods are copied to the classes you tick.</Dim>
          <Chips values={also} onChange={setAlso} options={meta.classes.filter((c) => c.id !== classId).map((c) => ({ value: c.id, label: clsName(c) }))} />
        </Section>
      )}
      {can2 && <Btn title={busy ? 'Saving...' : 'Save class plan'} onPress={save} disabled={busy || (!dirty && !also.length)} />}

      {pickIdx !== null && rows[pickIdx] && <PickSheet title={`Teacher for ${T.subject[rows[pickIdx].subject_id]?.name}`} options={teacherOpts(rows[pickIdx].subject_id)} value={rows[pickIdx].teacher_id} onPick={(v) => patch(pickIdx, { teacher_id: v })} onClose={() => setPickIdx(null)} />}
      {adding && <PickSheet title="Add a subject" options={free.map((sb) => ({ value: sb.id, label: sb.name }))} value="" onPick={(v) => { setRows([...rows, { subject_id: v, teacher_id: '', periods_per_week: '' }]); setDirty(true); }} onClose={() => setAdding(false)} />}
    </Pad>
  );
});

/* ================================================================== 3. CLASS TIMETABLE (builder) */
function CellEditor({ sc, cls, day, period, current, T, onClose, onSaved }) {
  const { data: opts, error } = useApi(`/timetable/classes/${cls.id}/options${qs({ ...sc, day, period_id: period.id })}`);
  const [busy, setBusy] = useState(false);
  const put = async (o) => {
    setBusy(true);
    try {
      const r = await api.put(`/timetable/classes/${cls.id}/slot${qs(sc)}`, { day, period_id: period.id, subject_id: o?.subject_id || '', teacher_id: o?.teacher_id || '' });
      if (r.warning) toast(r.warning, true); else toast(o ? 'Period saved' : 'Period cleared');
      onSaved(); onClose();
    } catch (x) { toast(x.message, true); setBusy(false); }
  };
  return (
    <Sheet title={`${DAY_LONG[day]} · ${period.name}`} onClose={onClose}>
      <Dim style={{ marginBottom: 10 }}>Class {clsName(cls)} · {clock12(period.start_time)} - {clock12(period.end_time)}</Dim>
      <Hint>Pick who takes this class now. Teachers already busy at this time are greyed out.</Hint>
      <ErrorBox>{error}</ErrorBox>
      {!opts && !error ? <Loading /> : opts && opts.length === 0 ? (
        <Empty>No teacher has been given this class yet. Set it in Class subjects, or in the teacher's profile (Users) under Teaching.</Empty>
      ) : (
        <List>
          {(opts || []).map((o, i, a) => {
            const sel = current && current.teacher_id === o.teacher_id && current.subject_id === o.subject_id;
            return (
              <View key={`${o.teacher_id}|${o.subject_id}`} style={{ opacity: o.busy ? 0.45 : 1 }}>
                <Row onPress={busy || o.busy ? undefined : () => put(o)} last={i === a.length - 1}>
                  <Dot color={T.color[o.subject_id]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.ink, fontWeight: '800' }}>{T.subject[o.subject_id]?.name}</Text>
                    <Text style={{ color: C.ink }}>{T.teacher[o.teacher_id]?.name || 'Teacher'}</Text>
                    <Dim>{o.busy ? `Busy in Class ${o.busy}` : sel ? 'Selected now' : `${o.scheduled} of ${o.periods_per_week} placed`}</Dim>
                  </View>
                  {sel && <Icon name="check" size={18} color={C.brand} />}
                </Row>
              </View>
            );
          })}
        </List>
      )}
      {current && <View style={{ marginTop: 6 }}><Btn kind="danger" title="Clear this period" onPress={() => put(null)} disabled={busy} /></View>}
    </Sheet>
  );
}

// subject-wise view of one class: each subject with its teacher, weekly count and exact days / periods
function SubjectWise({ meta, T, classId, slots }) {
  const subjectIds = [...new Set([...(meta.class_subjects?.[classId] || []), ...meta.assignments.filter((a) => a.class_id === classId).map((a) => a.subject_id)])];
  const pname = Object.fromEntries(meta.periods.map((p) => [p.id, p.name.replace(/^Period\s*/i, 'P')]));
  const order = Object.fromEntries(meta.periods.map((p, i) => [p.id, i]));
  if (!subjectIds.length) return <Empty>No subjects defined for this class yet (Class subjects).</Empty>;
  return (
    <View>
      {subjectIds.map((sub) => {
        const mine = slots.filter((s) => s.subject_id === sub).sort((a, b) => (a.day - b.day) || (order[a.period_id] - order[b.period_id]));
        const teachers = [...new Set([...meta.assignments.filter((a) => a.class_id === classId && a.subject_id === sub).map((a) => a.teacher_id), ...mine.map((s) => s.teacher_id)])];
        const planned = meta.assignments.filter((a) => a.class_id === classId && a.subject_id === sub).reduce((n, a) => n + a.periods_per_week, 0);
        return (
          <Card key={sub} style={{ borderLeftWidth: 5, borderLeftColor: T.color[sub] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ flex: 1, color: C.ink, fontWeight: '800', fontSize: 15 }}>{T.subject[sub]?.name}</Text><Chip tone={planned && mine.length > planned ? 'bad' : 'mute'}>{mine.length}{planned ? `/${planned}` : ''} a week</Chip></View>
            <Dim style={{ marginVertical: 4 }}>{teachers.length ? teachers.map((t) => T.teacher[t]?.name || 'Teacher').join(', ') : 'No teacher yet'}</Dim>
            <ChipRow>{mine.length ? mine.map((s) => <Chip key={s.id} tone="info">{DAY[s.day]} {pname[s.period_id]}</Chip>) : <Chip>Not placed yet</Chip>}</ChipRow>
          </Card>
        );
      })}
    </View>
  );
}

export const ClassTimetable = scoped(function ClassTimetable({ me, sc }) {
  const { meta, T, error, reload } = useMeta(sc);
  const [cid, setCid] = useState(''); const [edit, setEdit] = useState(null); const [view, setView] = useState('grid'); const [day, setDay] = useState(0);
  const canEdit = can(me, 'manage_timetable');
  const classId = cid || meta?.classes?.[0]?.id || '';
  const sl = useApi(classId ? `/timetable/slots${qs({ ...sc, class_id: classId })}` : null);
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  if (!meta.periods.length) return <NoStructure me={me} />;
  if (!meta.classes.length) return <Pad><Empty>Add classes first (Users, Classes).</Empty></Pad>;
  const cls = T.cls[classId]; const slots = sl.data || []; const at = Object.fromEntries(slots.map((s) => [keyOf(s), s]));
  const d = day || defaultDay(meta, dowOf(meta.today));
  const req = meta.assignments.filter((a) => a.class_id === classId);
  const noTeacher = (meta.class_subjects?.[classId] || []).filter((s2) => !req.some((a) => a.subject_id === s2)).map((s2) => T.subject[s2]?.name).filter(Boolean);
  const placed = (a) => slots.filter((s) => s.teacher_id === a.teacher_id && s.subject_id === a.subject_id).length;
  const share = () => shareGrid({ title: `Timetable - Class ${clsName(cls)}`, heads: ['', ...meta.settings.days.map((x) => DAY_LONG[x])], rows: weekRows(meta, (x, p) => { const s = at[`${x}|${p.id}`]; return s ? `<b>${esc(T.subject[s.subject_id]?.name)}</b><small>${esc(T.teacher[s.teacher_id]?.name)}</small>` : ''; }) });
  const clear = () => confirmAsk(`Delete the whole timetable of Class ${clsName(cls)}?`, async () => {
    try { await api.post(`/timetable/clear${qs(sc)}`, { class_ids: [classId] }); toast('Timetable deleted'); sl.reload(); reload(); } catch (x) { toast(x.message, true); }
  }, { yes: 'Delete', danger: true });
  return (
    <Pad reload={() => { sl.reload(); reload(); }} loading={sl.loading} hasData>
      <View style={{ marginBottom: 12 }}><Choice value={classId} onChange={(v) => setCid(v)} options={meta.classes.map((c) => ({ value: c.id, label: clsName(c) }))} /></View>
      <View style={{ marginBottom: 12 }}><Choice value={view} onChange={setView} options={[{ value: 'grid', label: 'Day-wise' }, { value: 'subject', label: 'Subject-wise' }]} /></View>
      {view === 'subject' ? <SubjectWise meta={meta} T={T} classId={classId} slots={slots} /> : (
        <>
          <DayPick days={meta.settings.days} value={d} onChange={setDay} today={dowOf(meta.today)} />
          {!sl.data && !sl.error ? <Loading /> : (
            <PeriodList meta={meta} onPress={canEdit ? (p, c) => setEdit({ d, p, s: at[`${d}|${p.id}`] }) : undefined}
              get={(p) => { const s = at[`${d}|${p.id}`]; return s ? { title: T.subject[s.subject_id]?.name, color: T.color[s.subject_id], sub: T.teacher[s.teacher_id]?.name } : null; }} />
          )}
          {canEdit && <Dim style={{ marginBottom: 12 }}>Tap a period to choose or change who takes it.</Dim>}
        </>
      )}

      <Section title={`Subjects & teachers of Class ${clsName(cls)}`} icon="academics" color={ACCENT}>
        {req.length === 0 ? <Soft>No teacher has been given this class yet. Use Class subjects to set subjects and teachers.</Soft> : req.map((a, i) => {
          const n = placed(a); const col = T.color[a.subject_id];
          return (
            <View key={`${a.teacher_id}${a.subject_id}`} style={{ paddingVertical: 8, borderBottomWidth: i === req.length - 1 ? 0 : 1, borderColor: C.line }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Dot color={col} /><View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>{T.subject[a.subject_id]?.name}</Text><Dim>{T.teacher[a.teacher_id]?.name || 'Teacher'}</Dim></View>
                <Text style={{ color: n > a.periods_per_week ? C.bad : n === a.periods_per_week ? C.ok : C.mute, fontWeight: '800' }}>{n}/{a.periods_per_week}</Text>
              </View>
              <View style={{ flexDirection: 'row', marginTop: 6 }}><Meter pct={a.periods_per_week ? (n / a.periods_per_week) * 100 : 0} color={n > a.periods_per_week ? C.bad : col} /></View>
            </View>
          );
        })}
        {noTeacher.length > 0 && <View style={{ marginTop: 10 }}><Notice tone="warn">No teacher yet for: {noTeacher.join(', ')}. Add a teacher in Class subjects so it can be scheduled.</Notice></View>}
      </Section>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Btn small kind="ghost" title="Share PDF" onPress={share} disabled={!slots.length} /></View>
        {canEdit && slots.length > 0 && <View style={{ flex: 1 }}><Btn small kind="danger" title="Delete timetable" onPress={clear} /></View>}
      </View>
      {edit && <CellEditor sc={sc} cls={cls} day={edit.d} period={edit.p} current={edit.s} T={T} onClose={() => setEdit(null)} onSaved={() => { sl.reload(); reload(); }} />}
    </Pad>
  );
});

/* ================================================================== 3b. AUTO GENERATE */
export const AutoTimetable = scoped(function AutoTimetable({ sc }) {
  const { meta, T, error, reload } = useMeta(sc);
  const [sel, setSel] = useState(null); const [mode, setMode] = useState('replace'); const [auto, setAuto] = useState(true);
  const [res, setRes] = useState(null); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false); const [pday, setPday] = useState(0); const [who, setWho] = useState('class');
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  if (!meta.periods.length) return <NoStructure me={{ features: [] }} />;
  const all = meta.classes.map((c) => c.id); const chosen = sel || all;
  const pd = pday || meta.settings.days[0];
  const pick = (v) => { setSel(v); setRes(null); setSaved(false); };
  const run = async (apply) => {
    setBusy(true);
    try {
      const r = await api.post(`/timetable/auto-generate${qs(sc)}`, { class_ids: chosen, mode, auto_assign: auto, apply, seed: apply ? res?.seed : undefined });
      setRes(r);
      if (apply) { toast(`Timetable saved - ${plural(r.placed, 'period')} placed`); setSaved(true); reload(); }
    } catch (x) { toast(x.message, true); }
    setBusy(false);
  };
  const wipe = () => confirmAsk(`Delete the saved timetable of ${chosen.length === all.length ? 'ALL classes' : plural(chosen.length, 'class').replace('classs', 'classes')}? This cannot be undone.`, async () => {
    try { const r2 = await api.post(`/timetable/clear${qs(sc)}`, { class_ids: chosen.length === all.length ? [] : chosen }); toast(`Deleted ${plural(r2.removed, 'period')}`); setRes(null); reload(); } catch (x) { toast(x.message, true); }
  }, { yes: 'Delete', danger: true });
  const tag = (id, sub) => `${clsName(T.cls[id])} - ${T.subject[sub]?.name}`;
  const missing = res ? res.shortfall.reduce((n, x) => n + x.missing, 0) : 0;
  return (
    <Pad reload={reload} hasData>
      <Hint>Set the periods per week in Structure, and give each class its subjects and teachers in Class subjects. A teacher gets the same period for the same class every day; daily subjects go first, light subjects (1-3 a week) go to the last periods. No teacher is ever in two classes at once; weekly limit {meta.settings.max_load}.</Hint>
      <Section title="1. Classes" icon="school" color={ACCENT} right={<View style={{ flexDirection: 'row', gap: 8 }}><Btn small kind="ghost" title="All" onPress={() => pick(null)} /><Btn small kind="ghost" title="None" onPress={() => pick([])} /></View>}>
        <Chips values={chosen} onChange={pick} options={meta.classes.map((c) => ({ value: c.id, label: clsName(c) }))} />
      </Section>
      <Section title="2. If a class already has some periods" icon="sliders" color="#6366f1">
        <Choice value={mode} onChange={(v) => { setMode(v); setRes(null); }} options={[{ value: 'fill', label: 'Keep them, fill empty' }, { value: 'replace', label: 'Fresh timetable' }]} />
        <Check label="If a subject has no teacher in a class, pick one who already teaches it (lightest load first)" value={auto} onChange={(v) => { setAuto(v); setRes(null); }} />
      </Section>
      <View style={{ gap: 10, marginBottom: 12 }}>
        <Btn title={busy ? 'Working...' : res && !res.applied ? 'Try another arrangement' : 'Preview timetable'} onPress={() => run(false)} disabled={busy || !chosen.length} />
        {res && !res.applied && <Btn kind="ghost" title="Save this timetable" onPress={() => run(true)} disabled={busy} />}
        <Btn kind="danger" title="Delete old timetable" onPress={wipe} disabled={busy || !chosen.length} />
      </View>

      {res && (
        <Section title={`${res.applied ? 'Saved' : 'Preview'}: ${plural(res.placed, 'period')} placed`} icon="check" color="#10b981">
          {res.new_assignments > 0 && <Dim style={{ marginTop: -6, marginBottom: 8 }}>{plural(res.new_assignments, 'teacher')} auto-selected</Dim>}
          <ChipRow style={{ marginBottom: 8 }}>{res.per_class.map((c) => <Chip key={c.class_id} tone={c.placed + c.kept >= c.slots_total ? 'ok' : 'info'}>{clsName(T.cls[c.class_id])}: {c.placed + c.kept}/{c.slots_total}</Chip>)}</ChipRow>
          {missing > 0 && <Notice tone="warn">Could not place {plural(missing, 'period')} (no free common slot, or teacher limit reached): {res.shortfall.map((x) => `${tag(x.class_id, x.subject_id)} (${x.missing} short, ${T.teacher[x.teacher_id]?.name || 'teacher'})`).join('; ')}</Notice>}
          {res.notes.length > 0 && <Notice tone="warn">Note: {res.notes.map((x) => `${tag(x.class_id, x.subject_id)} - ${x.text}`).join('; ')}</Notice>}
          {!res.applied && <Dim>Not saved yet. Check each day below, then Save this timetable (or Try another arrangement).</Dim>}
          {saved && <Dim>Saved. Open Class timetable to fine-tune any period by hand.</Dim>}
        </Section>
      )}
      {res && res.slots && (
        <>
          <DayPick days={meta.settings.days} value={pd} onChange={setPday} />
          <View style={{ marginBottom: 12 }}><Choice value={who} onChange={setWho} options={[{ value: 'class', label: 'All classes' }, { value: 'teacher', label: 'All teachers' }]} /></View>
          <DayByEntity meta={meta} T={T} slots={res.slots} day={pd} mode={who} />
        </>
      )}
    </Pad>
  );
});

/* ================================================================== 4. TEACHER TIMETABLE */
export const TeacherTimetable = scoped(function TeacherTimetable({ me, sc }) {
  const { meta, T, error, reload } = useMeta(sc);
  const [tid, setTid] = useState(''); const [pick, setPick] = useState(false); const [day, setDay] = useState(0);
  const teacherId = tid || meta?.teachers?.[0]?.user_id || '';
  const sl = useApi(teacherId ? `/timetable/slots${qs({ ...sc, teacher_id: teacherId })}` : null);
  const wq = useApi(`/timetable/workload${qs(sc)}`);
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  if (!meta.periods.length) return <NoStructure me={me} />;
  if (!meta.teachers.length) return <Pad><Empty>No teachers yet.</Empty></Pad>;
  const slots = sl.data || []; const at = Object.fromEntries(slots.map((s) => [keyOf(s), s]));
  const mine = meta.assignments.filter((a) => a.teacher_id === teacherId);
  const stat = wq.data?.teachers.find((x) => x.teacher_id === teacherId);
  const name = T.teacher[teacherId]?.name || ''; const d = day || defaultDay(meta, dowOf(meta.today));
  const lab = (s) => `${clsName(T.cls[s.class_id])} - ${T.subject[s.subject_id]?.name}`;
  const share = () => shareGrid({ title: `Timetable - ${name}`, sub: plural(slots.length, 'period') + ' a week', heads: ['', ...meta.settings.days.map((x) => DAY_LONG[x])], rows: weekRows(meta, (x, p) => { const s = at[`${x}|${p.id}`]; return s ? `<b>${esc(clsName(T.cls[s.class_id]))}</b><small>${esc(T.subject[s.subject_id]?.name)}</small>` : ''; }) });
  const csv = () => shareCsv(`timetable-${name.replace(/\s+/g, '-')}.csv`, [['Period', 'Time', ...meta.settings.days.map((x) => DAY_LONG[x])], ...meta.periods.map((p) => [p.name, `${p.start_time}-${p.end_time}`, ...meta.settings.days.map((x) => (p.is_break ? 'Break' : (at[`${x}|${p.id}`] ? lab(at[`${x}|${p.id}`]) : '')))])]);
  return (
    <Pad reload={() => { reload(); sl.reload(); wq.reload(); }} loading={sl.loading} hasData>
      <View style={{ marginBottom: 12 }}><PickBtn text={name} placeholder="Choose a teacher" onPress={() => setPick(true)} /></View>
      <KpiGrid>
        <Kpi icon="calendar" color="#6366f1" label="In timetable" value={slots.length} sub="periods a week" />
        <Kpi icon="bolt" color="#f97316" label="Planned" value={stat?.assigned ?? 0} sub={`limit ${meta.settings.max_load}`} tone={(stat?.assigned ?? 0) > meta.settings.max_load ? 'bad' : undefined} />
        <Kpi icon="school" color="#10b981" label="Classes" value={stat?.classes ?? 0} />
        <Kpi icon="academics" color="#ec4899" label="Subjects" value={stat?.subjects ?? 0} />
      </KpiGrid>
      <DayPick days={meta.settings.days} value={d} onChange={setDay} today={dowOf(meta.today)} />
      {!sl.data && !sl.error ? <Loading /> : <PeriodList meta={meta} empty="free" get={(p) => { const s = at[`${d}|${p.id}`]; return s ? { title: `Class ${clsName(T.cls[s.class_id])}`, color: T.color[s.subject_id], sub: T.subject[s.subject_id]?.name } : null; }} />}
      <Section title="Teaches" icon="academics" color={ACCENT}>
        {mine.length === 0 ? <Soft>Nothing assigned yet. Add classes and subjects in Class subjects.</Soft> : <ChipRow>{mine.map((a) => <Chip key={a.class_id + a.subject_id} tone="info">{T.subject[a.subject_id]?.name} · Class {clsName(T.cls[a.class_id])} · {a.periods_per_week}/wk</Chip>)}</ChipRow>}
      </Section>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Btn small kind="ghost" title="Share PDF" onPress={share} disabled={!slots.length} /></View>
        <View style={{ flex: 1 }}><Btn small kind="ghost" title="Export CSV" onPress={csv} disabled={!slots.length} /></View>
      </View>
      {pick && <PickSheet title="Teacher" value={teacherId} options={meta.teachers.map((t) => ({ value: t.user_id, label: t.name, sub: t.designation }))} onPick={(v) => { setTid(v); }} onClose={() => setPick(false)} />}
    </Pad>
  );
});

/* ================================================================== 5. WHOLE SCHOOL (one day, every class or teacher) */
export const SchoolTimetable = scoped(function SchoolTimetable({ me, sc }) {
  const { meta, T, error, reload } = useMeta(sc);
  const sl = useApi(`/timetable/slots${qs(sc)}`);
  const [day, setDay] = useState(0); const [who, setWho] = useState('class');
  const slots = sl.data;
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta || !slots) return <Pad><Loading /></Pad>;
  if (!meta.periods.length) return <NoStructure me={me} />;
  const d = day || defaultDay(meta, dowOf(meta.today));
  const at = new Map(slots.filter((s) => s.day === d).map((s) => [`${s.class_id}|${s.period_id}`, s]));
  const share = () => shareGrid({ title: `School timetable - ${DAY_LONG[d]}`, heads: ['Class', ...meta.periods.map(periodHead)], rows: meta.classes.map((c) => [esc(clsName(c)), ...meta.periods.map((p) => { if (p.is_break) return '<span style="color:#999">break</span>'; const s = at.get(`${c.id}|${p.id}`); return s ? `<b>${esc(T.subject[s.subject_id]?.name)}</b><small>${esc(firstName(T.teacher[s.teacher_id]?.name))}</small>` : ''; })]) });
  return (
    <Pad reload={() => { reload(); sl.reload(); }} loading={sl.loading} hasData>
      <DayPick days={meta.settings.days} value={d} onChange={setDay} today={dowOf(meta.today)} />
      <View style={{ marginBottom: 12 }}><Choice value={who} onChange={setWho} options={[{ value: 'class', label: 'Classes' }, { value: 'teacher', label: 'Teachers' }]} /></View>
      <DayByEntity key={`${d}-${who}`} meta={meta} T={T} slots={slots} day={d} mode={who} />
      <Btn small kind="ghost" title={`Share ${DAY[d]} timetable (PDF)`} onPress={share} />
    </Pad>
  );
});

/* ================================================================== 6. SUBSTITUTIONS */
export const Substitutions = scoped(function Substitutions({ me, sc }) {
  const { meta, T, error, reload } = useMeta(sc);
  const [date, setDate] = useState(''); const [tid, setTid] = useState(''); const [pick, setPick] = useState({}); const [pickT, setPickT] = useState(false); const [pickFor, setPickFor] = useState(null);
  const when = date || meta?.today || '';
  const plan = useApi(tid && when ? `/timetable/substitutions/plan${qs({ ...sc, date: when, teacher_id: tid })}` : null);
  const week = useApi(meta ? `/timetable/substitutions${qs({ ...sc, from: meta.today })}` : null);
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  if (!meta.periods.length) return <NoStructure me={me} />;
  const refreshAll = () => { plan.reload(); week.reload(); };
  const per = Object.fromEntries(meta.periods.map((p) => [p.id, p]));
  const data = plan.data; const manage = can(me, 'manage_substitutions');
  const assign = async (p) => {
    const k = `${p.class_id}|${p.period_id}`; const who = pick[k] || p.candidates[0]?.teacher_id;
    if (!who) { toast('Choose a teacher', true); return; }
    try { await api.post(`/timetable/substitutions${qs(sc)}`, { date: when, class_id: p.class_id, period_id: p.period_id, substitute_teacher_id: who }); toast('Substitute assigned'); refreshAll(); } catch (x) { toast(x.message, true); }
  };
  const remove = async (id) => { try { await api.del(`/timetable/substitutions/${id}${qs(sc)}`); toast('Substitution removed'); refreshAll(); } catch (x) { toast(x.message, true); } };
  const candLabel = (c) => `${T.teacher[c.teacher_id]?.name || 'Teacher'}${c.same_subject ? ' · teaches this subject' : c.same_class ? ' · knows this class' : ''}`;
  const pf = pickFor && data?.periods.find((p) => `${p.class_id}|${p.period_id}` === pickFor);
  return (
    <Pad reload={() => { reload(); refreshAll(); }} hasData>
      {manage && (
        <Section title="Teacher absent?" icon="userplus" color="#8b5cf6">
          <Field label="Date"><DateField value={when} onChange={setDate} /></Field>
          <Field label="Absent teacher"><PickBtn text={T.teacher[tid]?.name} placeholder="Choose the absent teacher" onPress={() => setPickT(true)} /></Field>
          {tid && !data && !plan.error && <Dim>Checking...</Dim>}
          <ErrorBox>{plan.error}</ErrorBox>
          {tid && data && data.school_day === false && <Hint>{DAY_LONG[data.day]} is not a school day.</Hint>}
          {tid && data && data.absent_on_leave && <Hint>This teacher has approved leave on this date.</Hint>}
          {tid && data && data.school_day && data.periods.length === 0 && <Soft>{T.teacher[tid]?.name} has no classes on {fdate(when)}.</Soft>}
          {tid && data && data.periods.map((p) => {
            const k = `${p.class_id}|${p.period_id}`; const pr = per[p.period_id]; const col = T.color[p.subject_id];
            const chosen = p.candidates.find((c) => c.teacher_id === (pick[k] || p.candidates[0]?.teacher_id));
            return (
              <Card key={k} style={{ borderLeftWidth: 5, borderLeftColor: col, marginTop: 10, marginBottom: 0 }}>
                <Text style={{ color: C.ink, fontWeight: '800' }}>{pr?.name} <Text style={{ color: C.mute, fontWeight: '500' }}>· {clock12(pr?.start_time)} - {clock12(pr?.end_time)}</Text></Text>
                <ChipRow style={{ marginVertical: 6 }}><Chip>Class {clsName(T.cls[p.class_id])}</Chip><Chip tone="info">{T.subject[p.subject_id]?.name}</Chip></ChipRow>
                {p.substitution ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, color: C.ink }}>Covered by <Text style={{ fontWeight: '800' }}>{T.teacher[p.substitution.substitute_teacher_id]?.name}</Text></Text>
                    <Btn small kind="danger" title="Remove" onPress={() => remove(p.substitution.id)} />
                  </View>
                ) : p.candidates.length === 0 ? <Dim>Nobody is free in this period.</Dim> : (
                  <View style={{ gap: 8 }}>
                    <PickBtn text={chosen ? `${chosen.same_subject ? '⭐ ' : ''}${candLabel(chosen)} · ${chosen.load_today} today` : ''} placeholder="Choose a teacher" onPress={() => setPickFor(k)} />
                    <Btn small title="Assign" onPress={() => assign(p)} />
                  </View>
                )}
              </Card>
            );
          })}
        </Section>
      )}

      <Section title="Upcoming substitutions" icon="calendar" color={ACCENT}>
        {!week.data ? <Loading /> : week.data.length === 0 ? <Soft>None in the next 7 days.</Soft> : week.data.map((s, i) => (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: i === week.data.length - 1 ? 0 : 1, borderColor: C.line }}>
            <Dot color={T.color[s.subject_id] || '#6366f1'} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.ink, fontWeight: '700' }}>{fdate(s.sub_date)} · {per[s.period_id]?.name} · Class {clsName(T.cls[s.class_id])}</Text>
              <Dim>{T.teacher[s.absent_teacher_id]?.name || 'Teacher'} → {T.teacher[s.substitute_teacher_id]?.name}</Dim>
            </View>
            {manage && <Pressable onPress={() => remove(s.id)} hitSlop={8} accessibilityLabel="Remove substitution"><Icon name="trash" size={18} color={C.bad} /></Pressable>}
          </View>
        ))}
      </Section>

      {pickT && <PickSheet title="Absent teacher" value={tid} options={meta.teachers.map((t) => ({ value: t.user_id, label: t.name, sub: t.designation }))} onPick={setTid} onClose={() => setPickT(false)} />}
      {pf && <PickSheet title="Substitute teacher" value={pick[pickFor] || pf.candidates[0]?.teacher_id} options={pf.candidates.map((c) => ({ value: c.teacher_id, label: `${c.same_subject ? '⭐ ' : ''}${candLabel(c)}`, sub: `${c.load_today} periods today` }))} onPick={(v) => setPick({ ...pick, [pickFor]: v })} onClose={() => setPickFor(null)} />}
    </Pad>
  );
});

/* ================================================================== 2. STRUCTURE (days, periods, breaks, periods per week) */
const QUICK = [['Period 1', '08:00', '08:45'], ['Period 2', '08:45', '09:30'], ['Period 3', '09:30', '10:15'], ['Morning break', '10:15', '10:35', 1], ['Period 4', '10:35', '11:20'], ['Period 5', '11:20', '12:05'], ['Lunch', '12:05', '12:35', 1], ['Period 6', '12:35', '13:20'], ['Period 7', '13:20', '14:05']];

// periods per week of every subject in every class: set once here, teachers just take them
function ClassPeriods({ sc, meta, T, reload }) {
  const [vals, setVals] = useState(null); const [cid, setCid] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (meta && !vals) { const v = {}; meta.classes.forEach((c) => (meta.class_subjects?.[c.id] || []).forEach((sb) => { v[`${c.id}|${sb}`] = String(meta.class_periods?.[c.id]?.[sb] ?? ''); })); setVals(v); } }, [meta]); // eslint-disable-line
  if (!vals) return null;
  const withSubjects = meta.classes.filter((c) => (meta.class_subjects?.[c.id] || []).length);
  if (!withSubjects.length) return <Hint>Define subjects for each class first (Class subjects), then you can set how many periods a week each one gets.</Hint>;
  const classId = withSubjects.some((c) => c.id === cid) ? cid : withSubjects[0].id; const cls = T.cls[classId];
  const subs = meta.class_subjects[classId];
  const slotsPerWeek = meta.periods.filter((p) => !p.is_break).length * meta.settings.days.length;
  const tot = subs.reduce((n, sb) => n + (Number(vals[`${classId}|${sb}`]) || 0), 0);
  const fillAll = (sb) => { const v = vals[`${classId}|${sb}`]; const n = { ...vals }; meta.classes.forEach((c) => { if (`${c.id}|${sb}` in n) n[`${c.id}|${sb}`] = v; }); setVals(n); toast('Copied to every class that studies it'); };
  const save = async () => {
    setBusy(true);
    try { await api.put(`/timetable/class-periods${qs(sc)}`, { items: Object.entries(vals).map(([k, v]) => { const [class_id, subject_id] = k.split('|'); return { class_id, subject_id, periods_per_week: v }; }) }); toast('Periods per week saved'); await reload(); }
    catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  return (
    <Section title="3. Periods per week" icon="calendar" color="#10b981" right={<Chip tone={tot > slotsPerWeek ? 'bad' : 'mute'}>{tot}/{slotsPerWeek}</Chip>}>
      <Dim style={{ marginTop: -6, marginBottom: 10 }}>How many periods a week a class gets of each subject (e.g. Games 2, Maths 7). "Same for all" copies a number to every class that studies the subject.</Dim>
      <View style={{ marginBottom: 10 }}><Choice value={classId} onChange={setCid} options={withSubjects.map((c) => ({ value: c.id, label: clsName(c) }))} /></View>
      {subs.map((sb, i) => (
        <View key={sb} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: i === subs.length - 1 ? 0 : 1, borderColor: C.line }}>
          <Dot color={T.color[sb]} /><Text style={{ flex: 1, color: C.ink, fontWeight: '700' }} numberOfLines={1}>{T.subject[sb]?.name}</Text>
          {meta.classes.length > 1 && <Pressable onPress={() => fillAll(sb)} hitSlop={6}><Text style={{ color: C.brand, fontSize: 12.5, fontWeight: '700' }}>Same for all</Text></Pressable>}
          <View style={{ width: 70 }}><Input value={vals[`${classId}|${sb}`] ?? ''} onChangeText={(v) => setVals({ ...vals, [`${classId}|${sb}`]: intText(v) })} keyboardType="number-pad" maxLength={2} placeholder="0" /></View>
        </View>
      ))}
      <Dim style={{ marginTop: 8, marginBottom: 10 }}>Class {clsName(cls)} uses {tot} of {slotsPerWeek} periods a week.</Dim>
      <Btn title={busy ? 'Saving...' : 'Save periods per week'} onPress={save} disabled={busy} />
    </Section>
  );
}

export const TimetableSetup = scoped(function TimetableSetup({ sc }) {
  const { meta, T, error, reload, loading } = useMeta(sc);
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6]); const [load, setLoad] = useState('30'); const [rows, setRows] = useState([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!meta || ready) return;
    setDays(meta.settings.days); setLoad(String(meta.settings.max_load)); setRows(meta.periods.map((p) => ({ ...p }))); setReady(true);
  }, [meta]); // eslint-disable-line
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  const set = (i, patch) => setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const add = (brk) => { const last = rows[rows.length - 1]; const start = last?.end_time || '08:00'; setRows([...rows, { name: brk ? 'Break' : `Period ${rows.filter((r) => !r.is_break).length + 1}`, start_time: start, end_time: addMin(start, brk ? 20 : 45), is_break: !!brk }]); };
  const move = (i, d) => { const n = i + d; if (n < 0 || n >= rows.length) return; const c = [...rows]; [c[i], c[n]] = [c[n], c[i]]; setRows(c); };
  const quick = () => setRows(QUICK.map(([name, s, e, b]) => ({ name, start_time: s, end_time: e, is_break: !!b })));
  const doSave = async () => {
    setBusy(true);
    try { await api.put(`/timetable/structure${qs(sc)}`, { days, max_load: Number(load), periods: rows }); toast('Timetable structure saved'); setReady(false); await reload(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const save = () => {
    setErr('');
    const removed = meta.periods.filter((p) => !rows.some((r) => r.id === p.id));
    if (removed.length) confirmAsk(`Removing ${removed.map((p) => p.name).join(', ')} also removes its periods from every class timetable. Continue?`, doSave, { yes: 'Save anyway', danger: true });
    else doSave();
  };
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Section title="1. School days" icon="calendar" color={ACCENT}>
        <Chips values={days} onChange={(v) => setDays([...v].sort())} options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: DAY_LONG[d] }))} />
        <View style={{ marginTop: 12 }}><Field label="Most periods a teacher should take in a week" hint="Used to warn when a teacher is overloaded"><Input value={load} onChangeText={(v) => setLoad(intText(v))} keyboardType="number-pad" maxLength={2} /></Field></View>
      </Section>

      <Section title="2. The school day" icon="bolt" color="#6366f1">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Btn small kind="ghost" title="Quick start" onPress={quick} /><Btn small kind="ghost" title="Add period" onPress={() => add(false)} /><Btn small kind="ghost" title="Add break" onPress={() => add(true)} />
        </View>
        {rows.length === 0 && <Soft>No periods yet. Tap Quick start for a ready-made day, then change the times.</Soft>}
        {rows.map((r, i) => (
          <Card key={r.id || `n${i}`} style={{ backgroundColor: r.is_break ? C.warnBg : C.card }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <View style={{ minWidth: 28, height: 28, borderRadius: 14, backgroundColor: r.is_break ? C.warn : ACCENT, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{r.is_break ? 'B' : rows.slice(0, i + 1).filter((x) => !x.is_break).length}</Text></View>
              <View style={{ flex: 1 }}><Input value={r.name} onChangeText={(v) => set(i, { name: v })} maxLength={40} /></View>
              <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={{ opacity: i === 0 ? 0.25 : 1 }}><Icon name="up" size={18} color={C.mute} /></Pressable>
              <Pressable onPress={() => move(i, 1)} disabled={i === rows.length - 1} hitSlop={6} style={{ opacity: i === rows.length - 1 ? 0.25 : 1 }}><Icon name="down" size={18} color={C.mute} /></Pressable>
              <Pressable onPress={() => setRows(rows.filter((_, n) => n !== i))} hitSlop={6}><Icon name="trash" size={18} color={C.bad} /></Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label="Starts"><TimeField value={r.start_time} onChange={(v) => set(i, { start_time: v })} /></Field></View>
              <View style={{ flex: 1 }}><Field label="Ends"><TimeField value={r.end_time || addMin(r.start_time, 45)} onChange={(v) => set(i, { end_time: v })} /></Field></View>
            </View>
            <Check label="This is a break" value={!!r.is_break} onChange={(v) => set(i, { is_break: v })} />
          </Card>
        ))}
      </Section>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Save structure'} onPress={save} disabled={busy} />
      <View style={{ height: 14 }} />
      <ClassPeriods sc={sc} meta={meta} T={T} reload={reload} />
      <Hint>Next: set each class's subjects and teachers in Class subjects (or in a teacher's profile under Users), then use Auto generate.</Hint>
    </Pad>
  );
});
