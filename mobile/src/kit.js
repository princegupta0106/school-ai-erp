// ONE standard design for every mobile module (see mobile/DESIGN-SYSTEM-MOBILE.md).
// New screens import everything they need from here instead of hand-rolling rows, chips, cards or colours.
// Colours always come from `C` (theme.js) so Light / Dark just work. Nothing in this file hard-codes a theme colour,
// except the per-item accent colours (hueOf) which are the same in both themes on purpose.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, Linking, Platform, ScrollView } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Svg, { Circle } from 'react-native-svg';
import { C, SH, T, money, initials, ymd } from './theme';
import { Icon } from './icons';
import { Card, Btn, DateField, Sheet } from './ui';
import { scoped, qs, Pad, Notice, Row, List } from './screens/Attendance';

// layout helpers that already exist in Attendance.js, re-exported so new modules have one import
export { scoped, qs, Pad, Notice, Row, List, initials };
export const rupees = money;

/* ------------------------------------------------------------------ formatters */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monShort = (m) => MON[Number(String(m).slice(5, 7)) - 1] || '';
export const fdate = (d, withYear = true) => { if (!d) return '-'; const [y, m, day] = String(d).slice(0, 10).split('-').map(Number); return `${day} ${MON[m - 1]}${withYear ? ` ${y}` : ''}`; };
export const clock12 = (t) => { if (!t) return '-'; const [h, m] = String(t).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const pctText = (p) => (p === null || p === undefined ? '-' : `${Math.round(p)}%`);

/* ------------------------------------------------------------------ tones & accent colours */
// tone -> [text colour, background]; read at render time so the theme switch is live
export const toneOf = (t) => ({ ok: [C.ok, C.okBg], bad: [C.bad, C.badBg], warn: [C.warn, C.warnBg], info: [C.info, C.infoBg], mute: [C.mute, C.muteBg] }[t] || [C.mute, C.muteBg]);
// percentage -> tone name (hi = good from, mid = warning from)
export const pctTone = (p, hi = 85, mid = 60) => (p === null || p === undefined ? 'mute' : p >= hi ? 'ok' : p >= mid ? 'warn' : 'bad');
export const toneColor = (t) => toneOf(t)[0];
// a stable accent colour per name (subjects, people, routes)
export const HUES = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6'];
export const hueOf = (s) => HUES[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

/* ------------------------------------------------------------------ small hooks */
export function useDebounced(v, ms = 250) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }
export const dial = (p) => p && Linking.openURL(`tel:${String(p).replace(/\s+/g, '')}`).catch(() => {});

// groups rows by class label ("5 A", "10 B"...) in natural order; rows without a class go last
export function groupByClass(rows, getLabel) {
  const m = new Map();
  for (const r of rows || []) { const l = getLabel(r) || 'No class'; if (!m.has(l)) m.set(l, []); m.get(l).push(r); }
  return [...m.entries()].map(([label, items]) => ({ label, items })).sort((a, b) => (a.label === 'No class') - (b.label === 'No class') || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/* ------------------------------------------------------------------ building blocks */
export const Avatar = ({ name, size = 40, color }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color || hueOf(name), alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.38 }}>{initials(name)}</Text>
  </View>
);

export const Chip = ({ tone = 'mute', children, big }) => {
  const [fg, bg] = toneOf(tone);
  return <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: big ? 12 : 9, paddingVertical: big ? 5 : 3 }}><Text style={{ color: fg, fontSize: big ? 13 : 12, fontWeight: '700' }}>{children}</Text></View>;
};
export const ChipRow = ({ children, style }) => <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, style]}>{children}</View>;

// a number with a label under it (e.g. Present 112)
export const Stat = ({ n, label, tone }) => {
  const [fg, bg] = toneOf(tone);
  return <View style={{ flex: 1, minWidth: 66, alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: tone ? bg : C.muteBg }}><Text style={{ fontSize: 18, fontWeight: '800', color: tone ? fg : C.ink }}>{n}</Text><Text style={{ fontSize: 11, color: tone ? fg : C.mute }} numberOfLines={1}>{label}</Text></View>;
};
export const StatRow = ({ children }) => <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>{children}</View>;

// big headline tile: icon, label, value, small line. Tappable when onPress is given.
export function Kpi({ icon, color, label, value, sub, tone, onPress, on }) {
  const accent = color || C.brand; const vc = tone ? toneColor(tone) : C.ink;
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => [{ flexGrow: 1, flexBasis: '46%', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? accent : C.line, padding: 11, ...SH }, pressed && onPress && { opacity: 0.7 }]}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: `${accent}22`, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={19} color={accent} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.mute, fontSize: 11.5, fontWeight: '600' }} numberOfLines={1}>{label}</Text>
        <Text style={{ color: vc, fontSize: 18, fontWeight: '800' }} numberOfLines={1}>{value}</Text>
        {!!sub && <Text style={{ color: C.mute, fontSize: 11.5 }} numberOfLines={1}>{sub}</Text>}
      </View>
    </Pressable>
  );
}
export const KpiGrid = ({ children }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>{children}</View>;

// a card with a coloured icon header. This is the standard "section" of every detail screen.
// flush = no body padding, for lists of Rows (same as web <Section flush>)
export function Section({ title, icon, color, right, flush, children }) {
  const accent = color || C.brand;
  return (
    <Card style={flush ? { padding: 0, overflow: 'hidden' } : undefined}>
      {(!!title || !!right || !!icon) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: flush ? 0 : 12, ...(flush ? { padding: T.sp[3], borderBottomWidth: 1, borderColor: C.line } : null) }}>
        {!!icon && <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: `${accent}22`, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={16} color={accent} /></View>}
        <Text style={{ flex: 1, fontSize: 16, fontWeight: '800', color: C.ink }}>{title}</Text>
        {right}
      </View>}
      {children}
    </Card>
  );
}
// the friendly "nothing here" line inside a section
export const Soft = ({ children }) => <View style={{ backgroundColor: C.muteBg, borderRadius: 10, padding: 12 }}><Text style={{ color: C.mute, fontSize: 13.5 }}>{children}</Text></View>;

// thin progress bar
export const Meter = ({ pct, color, h = 6 }) => <View style={{ flex: 1, height: h, borderRadius: h / 2, backgroundColor: C.line, overflow: 'hidden' }}><View style={{ height: h, width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, backgroundColor: color || C.brand }} /></View>;

// circular gauge with the value in the middle
export function Ring({ value, size = 92, stroke = 10, color, sub }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r; const has = value !== null && value !== undefined; const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.line} strokeWidth={stroke} />
        {has && <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color || C.ok} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} rotation="-90" origin={`${size / 2}, ${size / 2}`} />}
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ fontSize: size * 0.22, fontWeight: '800', color: C.ink }}>{has ? `${Math.round(v)}%` : '-'}</Text>
        {!!sub && <Text style={{ fontSize: 10.5, color: C.mute }}>{sub}</Text>}
      </View>
    </View>
  );
}

// label + value pair, two per row (personal details, vehicle details...)
export const Facts = ({ items }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, marginBottom: 4 }}>
    {items.filter((i) => i && i[1]).map(([l, v]) => <View key={l} style={{ width: '50%', paddingRight: 8 }}><Text style={{ color: C.mute, fontSize: 11.5, fontWeight: '600' }}>{l}</Text><Text style={{ color: C.ink, fontSize: 14, fontWeight: '600' }}>{v}</Text></View>)}
  </View>
);

// "label ........ small ........ value" line used for receipts, instalments, documents, stock lines
export const Line = ({ left, mid, right, rightTone, last }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: last ? 0 : 1, borderColor: C.line }}>
    <Text style={{ flex: 1, color: C.ink, fontSize: 14 }} numberOfLines={1}>{left}</Text>
    {!!mid && <Text style={{ color: C.mute, fontSize: 12 }}>{mid}</Text>}
    <Text style={{ color: rightTone ? toneColor(rightTone) : C.ink, fontWeight: '700', fontSize: 14 }}>{right}</Text>
  </View>
);

// a person with a call button (family, driver, attendant, vendor...)
export const Person = ({ name, role, phone, color, last }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: last ? 0 : 1, borderColor: C.line }}>
    <Avatar name={name} size={36} color={color} />
    <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{name}</Text>{!!role && <Text style={{ color: C.mute, fontSize: 12.5 }} numberOfLines={1}>{role}</Text>}</View>
    {!!phone && <Pressable onPress={() => dial(phone)} hitSlop={8} accessibilityLabel={`Call ${name}`} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.okBg, alignItems: 'center', justifyContent: 'center' }}><Icon name="phone" size={17} color={C.ok} /></Pressable>}
  </View>
);

// standard search field (sits above a list, outside the scroll area)
export const SearchBox = ({ value, onChange, placeholder }) => (
  <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, ...SH }}>
      <Icon name="search" size={18} color={C.mute} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder || 'Search...'} placeholderTextColor={C.hint} style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: C.ink }} autoCorrect={false} />
      {!!value && <Pressable onPress={() => onChange('')} hitSlop={8}><Icon name="x" size={16} color={C.mute} /></Pressable>}
    </View>
  </View>
);

// collapsible group header ("Class 5 A - 32 students")
export function Group({ label, count, open, onToggle, children }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 4 }}>
        <Icon name={open ? 'down' : 'chevron'} size={16} color={C.mute} />
        <Text style={{ flex: 1, color: C.ink, fontWeight: '800', fontSize: 15 }}>{label}</Text>
        <Chip>{count}</Chip>
      </Pressable>
      {open && children}
    </View>
  );
}

// "< Back" row at the top of a detail screen
export const BackBar = ({ label = 'Back', onPress }) => (
  <Pressable onPress={onPress} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: 12 }}>
    <Icon name="back" size={18} color={C.brand} /><Text style={{ color: C.brand, fontWeight: '700', fontSize: 15 }}>{label}</Text>
  </Pressable>
);

/* ------------------------------------------------------------------ optional date / time pickers (value '' = not set) */
// value / onChange use "HH:MM" (24 hour)
export function TimeField({ value, onChange }) {
  const [show, setShow] = useState(false);
  const [h, m] = (value || '08:00').split(':').map(Number);
  const d = new Date(); d.setHours(h || 0, m || 0, 0, 0);
  const change = (_, picked) => { if (Platform.OS === 'android') setShow(false); if (picked) onChange(`${String(picked.getHours()).padStart(2, '0')}:${String(picked.getMinutes()).padStart(2, '0')}`); };
  if (Platform.OS === 'ios') return <View style={{ alignItems: 'flex-start' }}><DateTimePicker value={d} mode="time" display="compact" onChange={change} /></View>;
  return (
    <>
      <Pressable onPress={() => setShow(true)} style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 }}><Text style={{ color: C.ink, fontSize: 15 }}>{clock12(value)}</Text></Pressable>
      {show && <DateTimePicker value={d} mode="time" onChange={change} />}
    </>
  );
}
// "Set" button while empty; the picker plus a clear (x) once a value exists
function Clearable({ value, onChange, initial, children }) {
  if (!value) return <View style={{ alignSelf: 'flex-start' }}><Btn small kind="ghost" title="Set" onPress={() => onChange(initial)} /></View>;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}>{children}</View><Pressable onPress={() => onChange('')} hitSlop={10} accessibilityLabel="Clear"><Icon name="x" size={18} color={C.mute} /></Pressable></View>;
}
export const OptDate = ({ value, onChange }) => <Clearable value={value} onChange={onChange} initial={ymd(new Date())}><DateField value={value} onChange={onChange} /></Clearable>;
export const OptTime = ({ value, onChange }) => <Clearable value={value} onChange={onChange} initial="08:00"><TimeField value={value} onChange={onChange} /></Clearable>;


/* =====================================================================================================
   DESIGN SYSTEM v2 additions  (same names and behaviour as client/src/ui.jsx; tokens = T in theme.js)
   Screen anatomy (see /DESIGN-STANDARD.md):  PageHeader > Tabs? > FilterBar? > KpiGrid? > Section / List
   Create / edit = FormSheet.   Delete / dangerous = confirmAsk().
   ===================================================================================================== */

// status word -> one of 5 tones, so "paid" is the same green on every screen (mirrors toneFor on web)
const TONE_WORDS = {
  ok: ['ok', 'paid', 'present', 'approved', 'active', 'done', 'complete', 'completed', 'success', 'in stock', 'received', 'enrolled', 'admitted', 'open', 'good'],
  warn: ['warn', 'due', 'late', 'pending', 'partial', 'low', 'low stock', 'waiting', 'in progress', 'review', 'half day', 'ordered'],
  bad: ['bad', 'overdue', 'absent', 'rejected', 'cancelled', 'canceled', 'failed', 'error', 'out', 'out of stock', 'blocked', 'dropped', 'expired'],
  info: ['info', 'leave', 'on leave', 'draft', 'new', 'scheduled', 'issued', 'sent', 'enquiry', 'applied'],
};
export const toneFor = (status) => {
  const w = String(status ?? '').trim().toLowerCase();
  if (['ok', 'warn', 'bad', 'info', 'mute'].includes(w)) return w;
  for (const t of Object.keys(TONE_WORDS)) if (TONE_WORDS[t].includes(w)) return t;
  return 'mute';
};

// <StatusChip>Paid</StatusChip> picks the tone from the word; or tone="warn". (Chip stays for explicit tones.)
export const StatusChip = ({ tone, children }) => <Chip tone={tone || toneFor(children)}>{children}</Chip>;

// Title (+ subtitle) on the left, small actions on the right. First thing on a screen that is not a detail screen.
// lead = something before the title, e.g. a Back button (same as web PageBar lead)
export const PageHeader = ({ title, sub, right, lead }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.sp[3], marginBottom: T.sp[3] }}>
    {lead}
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: T.fs.lg, fontWeight: T.fw.bold, color: C.ink }} numberOfLines={1}>{title}</Text>
      {!!sub && <Text style={{ fontSize: T.fs.xs, color: C.mute, marginTop: 1 }} numberOfLines={2}>{sub}</Text>}
    </View>
    {right}
  </View>
);

// Tabs switch between VIEWS of one screen (not filters; filters use FilterBar).  items: [{ key, label, count? }]
export function Tabs({ items, value, onChange }) {
  return (
    <View style={{ borderBottomWidth: 1, borderColor: C.line, marginBottom: T.sp[3] }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: T.sp[1] }}>
        {items.map((t) => {
          const on = value === t.key;
          return (
            <Pressable key={t.key} onPress={() => onChange(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={({ pressed }) => [{ minHeight: T.ctl, paddingHorizontal: T.sp[4], flexDirection: 'row', alignItems: 'center', gap: T.sp[2], borderBottomWidth: 2, borderColor: on ? C.brand : 'transparent', marginBottom: -1 }, pressed && { opacity: 0.6 }]}>
              <Text style={{ fontSize: T.fs.sm, fontWeight: T.fw.semi, color: on ? C.brand : C.mute }}>{t.label}</Text>
              {t.count != null && (
                <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: T.rad.pill, backgroundColor: on ? C.soft : C.muteBg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: T.fs.xs, fontWeight: T.fw.bold, color: on ? C.brand : C.mute }}>{t.count}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Same "nothing here" block everywhere (use inside a Section or on its own).
export const EmptyState = ({ icon = 'box', title, children, action }) => (
  <View style={{ alignItems: 'center', paddingVertical: T.sp[6], paddingHorizontal: T.sp[4], gap: T.sp[2] }}>
    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={22} color={C.brand} /></View>
    {!!title && <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }}>{title}</Text>}
    {!!children && <Text style={{ fontSize: T.fs.sm, color: C.mute, textAlign: 'center' }}>{children}</Text>}
    {action}
  </View>
);

// Every create / edit form opens in this: same header, same docked footer (Cancel + primary), same error slot.
// <FormSheet title="Add visitor" onClose={..} onSubmit={save} busy={saving} error={err} submitLabel="Save">...<Field/>...</FormSheet>
export function FormSheet({ title, onClose, onSubmit, busy, error, submitDisabled, submitLabel = 'Save', cancelLabel = 'Cancel', danger, hideFooter, children }) {
  const footer = hideFooter ? null : (
    <View style={{ flexDirection: 'row', gap: T.sp[3], padding: T.sp[4], backgroundColor: C.card, borderTopWidth: 1, borderColor: C.line }}>
      <View style={{ flex: 1 }}><Btn title={cancelLabel} kind="ghost" onPress={onClose} disabled={busy} /></View>
      <View style={{ flex: 1 }}><Btn title={busy ? 'Please wait...' : submitLabel} kind={danger ? 'danger' : undefined} onPress={onSubmit} disabled={busy || submitDisabled} /></View>
    </View>
  );
  return (
    <Sheet title={title} onClose={onClose} footer={footer}>
      {children}
      {!!error && <View style={{ backgroundColor: C.badBg, borderRadius: T.rad.sm, padding: T.sp[3], marginTop: T.sp[2] }}><Text style={{ color: C.bad, fontSize: T.fs.sm, fontWeight: T.fw.medium }}>{error}</Text></View>}
    </Sheet>
  );
}
