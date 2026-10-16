import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal as RNModal, ScrollView, ActivityIndicator, Platform, Switch, Alert, Animated, Easing, Keyboard, KeyboardAvoidingView } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, SH, live, ymd, monthName, shiftMonth } from './theme';

export const toast = (msg, bad) => Alert.alert(bad ? 'Error' : 'Done', msg);
export const confirmAsk = (msg, onYes) => Alert.alert('Please confirm', msg, [{ text: 'No', style: 'cancel' }, { text: 'Yes', onPress: onYes }]);

export const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;
export const Dim = ({ children, style }) => <Text style={[{ color: C.mute, fontSize: 13 }, style]}>{children}</Text>;
export const Empty = ({ children }) => <Text style={s.empty}>{children}</Text>;
function Bone({ w, h = 14, style }) {
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => { const a = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: true })])); a.start(); return () => a.stop(); }, [v]);
  return <Animated.View style={[{ width: w, height: h, borderRadius: 7, backgroundColor: C.skel, opacity: v }, style]} />;
}
export const Loading = () => (
  <View>{[0, 1, 2].map((i) => <View key={i} style={s.card}><Bone w="45%" h={12} /><Bone w="70%" h={22} style={{ marginTop: 10 }} /><Bone w="55%" h={12} style={{ marginTop: 10 }} /></View>)}</View>
);

// Button/tile with a soft press-in scale. `wrap` styles the outer touch area (width, flex), `style` the visible box.
export function Press({ onPress, style, wrap, children, disabled, ...rest }) {
  const sc = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  return (
    <Pressable onPress={onPress} onPressIn={() => to(0.96)} onPressOut={() => to(1)} disabled={disabled} style={wrap} {...rest}>
      <Animated.View style={[style, { transform: [{ scale: sc }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// Fades + slides in. Used for module open (x) and tab change (y). Stays mounted when inactive so tabs keep their state.
export function Pane({ active = true, from = 'y', children, style }) {
  const v = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => { if (active) { v.setValue(0); Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); } }, [active, v]);
  const move = v.interpolate({ inputRange: [0, 1], outputRange: [from === 'x' ? 28 : 10, 0] });
  return <Animated.View style={[{ flex: 1, display: active ? 'flex' : 'none', opacity: v, transform: [from === 'x' ? { translateX: move } : { translateY: move }] }, style]}>{children}</Animated.View>;
}
export const ErrorBox = ({ children }) => (children ? <Text style={s.err}>{children}</Text> : null);

const TONES = live(() => ({ off: C.mute, locked: C.mute, pending: C.warn, approved: C.ok, rejected: C.bad, cancelled: C.mute, draft: C.mute, finalized: C.info, paid: C.ok }));
export const Badge = ({ status }) => <Text style={[s.badge, { color: TONES[status] || C.mute, backgroundColor: `${TONES[status] || C.mute}1F` }]}>{status}</Text>;

export function Btn({ title, onPress, kind, disabled, small }) {
  const bg = kind === 'danger' ? C.bad : kind === 'ghost' ? C.card : C.brand;
  const fg = kind === 'ghost' ? C.ink : '#fff';
  return (
    <Press onPress={onPress} disabled={disabled} style={[s.btn, small && { paddingVertical: 7, paddingHorizontal: 12 }, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, kind === 'ghost' ? { borderWidth: 1, borderColor: C.line, ...SH } : { shadowColor: bg, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 }]}>
      <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 13 : 15 }}>{title}</Text>
    </Press>
  );
}

export const Field = ({ label, children, hint }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={s.label}>{label}</Text>
    {children}
    {hint ? <Dim style={{ marginTop: 3 }}>{hint}</Dim> : null}
  </View>
);
export const Input = (p) => <TextInput placeholderTextColor={C.hint} {...p} style={[s.input, p.multiline && { minHeight: 70, textAlignVertical: 'top' }, p.style]} />;

export const Check = ({ label, value, onChange }) => (
  <Pressable onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
    <Switch value={value} onValueChange={onChange} trackColor={{ true: C.brand, false: C.line }} />
    <Text style={{ color: C.ink, flex: 1 }}>{label}</Text>
  </Pressable>
);

// Pill-style single choice (replaces <select>)
export function Choice({ options, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={({ pressed }) => [s.pill, pressed && { opacity: 0.6 }, value === o.value && s.pillOn]}>
          <Text style={{ color: value === o.value ? C.brand : C.ink, fontSize: 14, fontWeight: value === o.value ? '700' : '500' }}>{o.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// value / onChange use "YYYY-MM-DD"
export function DateField({ value, onChange, disabled, min, max }) {
  const [show, setShow] = useState(false);
  const d = value ? new Date(`${value}T00:00:00`) : new Date();
  const change = (_, picked) => { if (Platform.OS === 'android') setShow(false); if (picked) onChange(ymd(picked)); };
  if (Platform.OS === 'ios') {
    return <View style={{ alignItems: 'flex-start', opacity: disabled ? 0.5 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}><DateTimePicker value={d} mode="date" display="compact" minimumDate={min ? new Date(`${min}T00:00:00`) : undefined} maximumDate={max ? new Date(`${max}T00:00:00`) : undefined} onChange={change} /></View>;
  }
  return (
    <>
      <Pressable disabled={disabled} onPress={() => setShow(true)} style={[s.input, { opacity: disabled ? 0.5 : 1 }]}><Text style={{ color: C.ink }}>{value || 'Pick a date'}</Text></Pressable>
      {show && <DateTimePicker value={d} mode="date" minimumDate={min ? new Date(`${min}T00:00:00`) : undefined} maximumDate={max ? new Date(`${max}T00:00:00`) : undefined} onChange={change} />}
    </>
  );
}

export function Sheet({ title, onClose, children }) {
  return (
    <RNModal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={s.sheetHead}><Text style={{ fontSize: 18, fontWeight: '700', color: C.ink, flex: 1 }}>{title}</Text><Pressable onPress={onClose}><Text style={{ color: C.brand, fontSize: 16, fontWeight: '600' }}>Close</Text></Pressable></View>
        <KbView><ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView></KbView>
      </SafeAreaView>
    </RNModal>
  );
}

// Runs an async action with busy state + error toast, then reloads.
export function useRun(reload) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = (fn, msg) => async () => {
    setErr(''); setBusy(true);
    try { const r = await fn(); await reload?.(); if (msg) toast(typeof msg === 'function' ? msg(r) : msg); return r; }
    catch (x) { setErr(x.message); toast(x.message, true); }
    finally { setBusy(false); }
  };
  return { busy, err, run };
}

export function MonthStepper({ value, onChange }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, ...SH }}>
      <Pressable onPress={() => onChange(shiftMonth(value, -1))} style={{ padding: 12 }}><Text style={{ color: C.brand, fontSize: 18, fontWeight: '700' }}>‹</Text></Pressable>
      <Text style={{ fontWeight: '700', color: C.ink }}>{monthName(`${value}-01`)}</Text>
      <Pressable onPress={() => onChange(shiftMonth(value, 1))} style={{ padding: 12 }}><Text style={{ color: C.brand, fontSize: 18, fontWeight: '700' }}>›</Text></Pressable>
    </View>
  );
}

// multi-select chips (e.g. weekly off days)
export function Chips({ options, values, onChange }) {
  const flip = (v) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => flip(o.value)} style={[s.pill, values.includes(o.value) && s.pillOn]}>
          <Text style={{ color: values.includes(o.value) ? C.brand : C.ink, fontWeight: values.includes(o.value) ? '700' : '500' }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// Keeps the bottom of a screen above the on-screen keyboard. Android Modals do not resize when the keyboard opens, so we measure
// how much of this view the keyboard actually covers and pad by exactly that (0 when the window already resized by itself).
export function useKeyboardInset(ref) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow', (e) => {
      const top = e.endCoordinates?.screenY; const h = e.endCoordinates?.height || 0;
      const calc = (bottom) => setInset(Math.max(0, Math.min(h, bottom - top)));
      if (ref?.current?.measureInWindow && top != null) ref.current.measureInWindow((x, y, w, ht) => calc(y + ht)); else setInset(h);
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setInset(0));
    return () => { show.remove(); hide.remove(); };
  }, [ref]);
  return inset;
}
export function KbView({ children, style, onInset }) {
  const ref = useRef(null); const inset = useKeyboardInset(ref);
  useEffect(() => { onInset?.(inset); }, [inset]); // eslint-disable-line
  return <View ref={ref} collapsable={false} style={[{ flex: 1 }, style, { paddingBottom: inset }]}>{children}</View>;
}

// iOS: the built-in KeyboardAvoidingView. Android: KbView above (works inside Modals and with edge-to-edge screens).
export function KeyboardSafe({ children, style, iosOffset = 0, onInset }) {
  if (Platform.OS === 'ios') return <KeyboardAvoidingView style={[{ flex: 1 }, style]} behavior="padding" keyboardVerticalOffset={iosOffset}>{children}</KeyboardAvoidingView>;
  return <KbView style={style} onInset={onInset}>{children}</KbView>;
}

// A ScrollView that shows a soft shadow/fade on the edge where more content is hidden, so it is obvious you can scroll.
// vertical (default): fades at the bottom / top.  horizontal: fades at the right / left.  `fade` = the colour behind it.
function Edge({ side, color, size }) {
  const v = side === 'top' || side === 'bottom';
  const pos = { top: { top: 0, left: 0, right: 0, height: size }, bottom: { bottom: 0, left: 0, right: 0, height: size }, left: { left: 0, top: 0, bottom: 0, width: size }, right: { right: 0, top: 0, bottom: 0, width: size } }[side];
  const [x1, y1, x2, y2] = { top: [0, 0, 0, 1], bottom: [0, 1, 0, 0], left: [0, 0, 1, 0], right: [1, 0, 0, 0] }[side];
  return (
    <View pointerEvents="none" style={[{ position: 'absolute' }, pos]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs><LinearGradient id={`g${side}`} x1={x1} y1={y1} x2={x2} y2={y2}><Stop offset="0" stopColor={color} stopOpacity="1" /><Stop offset="0.45" stopColor={color} stopOpacity="0.75" /><Stop offset="1" stopColor={color} stopOpacity="0" /></LinearGradient></Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#g${side})`} />
      </Svg>
      <View style={[{ position: 'absolute', backgroundColor: C.line, opacity: 0.9 }, v ? { [side]: 0, left: 0, right: 0, height: 1 } : { [side]: 0, top: 0, bottom: 0, width: 1 }]} />
    </View>
  );
}
export function ScrollFade({ horizontal, fade, size = 28, style, contentContainerStyle, children, ...rest }) {
  const [m, setM] = useState({ off: 0, content: 0, view: 0 });
  const color = fade || C.bg;
  const more = m.content - m.view > 4;
  const atStart = m.off <= 2; const atEnd = m.off + m.view >= m.content - 2;
  const sides = horizontal ? ['left', 'right'] : ['top', 'bottom'];
  return (
    <View style={style}>
      <ScrollView {...rest} horizontal={horizontal} scrollEventThrottle={16}
        contentContainerStyle={contentContainerStyle}
        onLayout={(e) => { const L = e.nativeEvent.layout; setM((c) => ({ ...c, view: horizontal ? L.width : L.height })); rest.onLayout?.(e); }}
        onContentSizeChange={(w, h) => setM((c) => ({ ...c, content: horizontal ? w : h }))}
        onScroll={(e) => { const n = e.nativeEvent; setM((c) => ({ ...c, off: horizontal ? n.contentOffset.x : n.contentOffset.y })); rest.onScroll?.(e); }}>
        {children}
      </ScrollView>
      {more && !atStart && <Edge side={sides[0]} color={color} size={size} />}
      {more && !atEnd && <Edge side={sides[1]} color={color} size={size} />}
    </View>
  );
}

const s = live(() => ({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.line, marginBottom: 12, ...SH },
  empty: { color: C.mute, textAlign: 'center', paddingVertical: 24 },
  err: { color: C.bad, backgroundColor: C.badBg, padding: 10, borderRadius: 10, marginBottom: 12 },
  badge: { fontSize: 12, fontWeight: '700', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden', textTransform: 'capitalize' },
  btn: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { color: C.mute, fontSize: 13, marginBottom: 6, fontWeight: '600' },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: C.ink },
  pill: { borderWidth: 1, borderColor: C.line, backgroundColor: C.card, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  pillOn: { backgroundColor: C.soft, borderColor: C.brand },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderColor: C.line, backgroundColor: C.card },
}));
