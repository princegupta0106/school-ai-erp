// Full-screen search: finds any screen / action (fuzzy). If nothing matches, offers "Ask AI".
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from './theme';
import { Icon } from './icons';
import { buildIndex, search, suggestions } from './search';

const tint = (c) => (String(c).startsWith('#') && String(c).length === 7 ? `${c}22` : C.soft);

// The pill shown under the header; tapping it opens the sheet.
export function SearchPill({ onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel="Search" style={{ marginHorizontal: 14, marginBottom: 8, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 }}>
      <Icon name="search" size={17} color={C.mute} />
      <Text style={{ color: C.hint, flex: 1 }} numberOfLines={1}>Search anything or ask AI…</Text>
    </Pressable>
  );
}

export default function SearchSheet({ targets, modules, extras, canAsk, onGo, onAsk, onClose }) {
  const [q, setQ] = useState('');
  const index = useMemo(() => buildIndex({ targets, modules, extras }), [targets, modules, extras]);
  const typed = q.trim();
  const found = useMemo(() => (typed ? search(index, q, 8) : suggestions(index, 7)), [index, q, typed]);
  const choose = (r) => {
    onClose();
    if (r.kind === 'action') r.run?.();
    else onGo(r.path);
  };
  const ask = () => { onClose(); onAsk(typed); };
  return (
    <Modal animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
          <View style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: C.card, borderWidth: 1, borderColor: C.brand, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 }}>
            <Icon name="search" size={18} color={C.mute} />
            <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Search anything or ask AI…" placeholderTextColor={C.hint} autoCorrect={false} autoCapitalize="none" returnKeyType="search" maxLength={200}
              onSubmitEditing={() => (found[0] ? choose(found[0]) : canAsk && typed ? ask() : null)} style={{ flex: 1, color: C.ink, fontSize: 15, paddingVertical: 0 }} />
            {q ? <Pressable hitSlop={10} onPress={() => setQ('')}><Icon name="x" size={17} color={C.mute} /></Pressable> : null}
          </View>
          <Pressable onPress={onClose} hitSlop={8}><Text style={{ color: C.brand, fontWeight: '700', fontSize: 15 }}>Cancel</Text></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 40 }}>
          <Text style={{ color: C.mute, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>{!typed ? 'JUMP TO' : found.length ? 'SCREENS & ACTIONS' : `NO SCREEN MATCHES “${typed.toUpperCase()}”`}</Text>
          {found.length > 0 && (
            <View style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden', marginBottom: 12 }}>
              {found.map((r, i) => (
                <Pressable key={r.id} onPress={() => choose(r)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderBottomWidth: i === found.length - 1 ? 0 : 1, borderColor: C.line }, pressed && { opacity: 0.6 }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: tint(r.color), alignItems: 'center', justifyContent: 'center' }}><Icon name={r.icon || 'chevron'} size={19} color={r.color || C.brand} /></View>
                  <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{r.label}</Text><Text style={{ color: C.mute, fontSize: 12 }} numberOfLines={1}>{r.hint}</Text></View>
                  <Icon name="chevron" size={16} color={C.mute} />
                </Pressable>))}
            </View>)}
          {typed && canAsk && (
            <Pressable onPress={ask} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: '#7c3aed55' }, pressed && { opacity: 0.6 }]}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#7c3aed22', alignItems: 'center', justifyContent: 'center' }}><Icon name="sparkle" size={19} color="#7c3aed" /></View>
              <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={2}>Ask AI: “{typed}”</Text><Text style={{ color: C.mute, fontSize: 12 }}>{found.length ? 'Not what you wanted? Let the assistant handle it' : 'Let the assistant answer or do it for you'}</Text></View>
            </Pressable>)}
          {typed && !found.length && !canAsk && <Text style={{ color: C.mute }}>Try different words, e.g. “fees”, “attendance”, “certificate”.</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
