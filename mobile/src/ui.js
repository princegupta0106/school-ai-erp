import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal as RNModal, ScrollView, ActivityIndicator, Platform, Switch, StyleSheet, Alert, Animated, Easing } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, ymd, monthName, shiftMonth } from './theme';

export const toast = (msg, bad) => Alert.alert(bad ? 'Error' : 'Done', msg);
export const confirmAsk = (msg, onYes) => Alert.alert('Please confirm', msg, [{ text: 'No', style: 'cancel' }, { text: 'Yes', onPress: onYes }]);

export const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;
export const Dim = ({ children, style }) => <Text style={[{ color: C.mute, fontSize: 13 }, style]}>{children}</Text>;
export const Empty = ({ children }) => <Text style={s.empty}>{children}</Text>;
function Bone({ w, h = 14, style }) {
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => { const a = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: true })])); a.start(); return () => a.stop(); }, [v]);
  return <Animated.View style={[{ width: w, height: h, borderRadius: 7, backgroundColor: '#d5e1d9', opacity: v }, style]} />;
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

const TONES = { off: C.mute, locked: C.mute, pending: C.warn, approved: C.ok, rejected: C.bad, cancelled: C.mute, draft: C.mute, finalized: C.info, paid: C.ok };
export const Badge = ({ status }) => <Text style={[s.badge, { color: TONES[status] || C.mute, borderColor: TONES[status] || C.mute }]}>{status}</Text>;

export function Btn({ title, onPress, kind, disabled, small }) {
  const bg = kind === 'danger' ? C.bad : kind === 'ghost' ? '#fff' : C.brand;
  const fg = kind === 'ghost' ? C.ink : '#fff';
  return (
    <Press onPress={onPress} disabled={disabled} style={[s.btn, small && { paddingVertical: 7, paddingHorizontal: 12 }, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, kind === 'ghost' && { borderWidth: 1, borderColor: C.line }]}>
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
export const Input = (p) => <TextInput placeholderTextColor="#9aa5b1" {...p} style={[s.input, p.multiline && { minHeight: 70, textAlignVertical: 'top' }, p.style]} />;

export const Check = ({ label, value, onChange }) => (
  <Pressable onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
    <Switch value={value} onValueChange={onChange} trackColor={{ true: C.brand }} />
    <Text style={{ color: C.ink, flex: 1 }}>{label}</Text>
  </Pressable>
);

// Pill-style single choice (replaces <select>)
export function Choice({ options, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={({ pressed }) => [s.pill, pressed && { opacity: 0.6 }, value === o.value && { backgroundColor: C.brand, borderColor: C.brand }]}>
          <Text style={{ color: value === o.value ? '#fff' : C.ink, fontSize: 14 }}>{o.label}</Text>
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
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
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
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10 }}>
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
        <Pressable key={o.value} onPress={() => flip(o.value)} style={[s.pill, values.includes(o.value) && { backgroundColor: C.brand, borderColor: C.brand }]}>
          <Text style={{ color: values.includes(o.value) ? '#fff' : C.ink }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line, marginBottom: 12 },
  empty: { color: C.mute, textAlign: 'center', paddingVertical: 24 },
  err: { color: C.bad, backgroundColor: '#fee2e2', padding: 10, borderRadius: 10, marginBottom: 12 },
  badge: { fontSize: 12, fontWeight: '600', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden', textTransform: 'capitalize' },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { color: C.mute, fontSize: 13, marginBottom: 5, fontWeight: '600' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink },
  pill: { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
});
