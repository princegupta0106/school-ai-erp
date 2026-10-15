import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, KeyboardAvoidingView, Platform, Switch, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';
import { C } from '../theme';
import { Icon } from '../icons';

// "Ask AI" chat (same behaviour as the web app). Reading things (counts, lists, searches) happens straight away.
// Anything that CHANGES data shows a Confirm card first; nothing is saved until the person taps Confirm
// (unless they switch on auto-confirm). It only talks to /api/ai/*: the server decides what the person may do.
const SUGGEST = [
  { text: 'How many teachers do we have?', need: 'get_all_users_school' },
  { text: 'Who is in class 5 A?', need: 'get_all_users_school' },
  { text: 'Create a new teacher', need: 'create_user' },
  { text: 'Create a student in class 5 A', need: 'create_user' },
  { text: 'Turn off an account', need: 'edit_user' },
  { text: 'Reset a password', need: 'reset_pass' },
];
const AUTO_KEY = 'ai_auto_confirm';

// **bold** only
const Rich = ({ text, style }) => (
  <Text style={style}>{String(text ?? '').split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <Text key={i} style={{ fontWeight: '800' }}>{p}</Text> : p))}</Text>
);

function ActionCard({ a, busy, onDecide }) {
  const border = a.status === 'done' ? C.ok : a.status === 'failed' ? C.bad : a.status === 'cancelled' ? C.line : C.brand;
  return (
    <View style={{ alignSelf: 'stretch', backgroundColor: '#fff', borderWidth: 1, borderColor: border, borderLeftWidth: 4, borderRadius: 12, padding: 12, opacity: a.status === 'cancelled' ? 0.6 : 1 }}>
      <Text style={{ fontWeight: '800', color: C.ink, fontSize: 15, marginBottom: 4 }}>{a.title}</Text>
      {(a.lines || []).map((l, i) => <Text key={i} style={{ color: C.ink, paddingVertical: 1 }}>{l}</Text>)}
      {!!a.footer && <Text style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderColor: C.line, fontWeight: '700', color: C.ink }}>{a.footer}</Text>}
      {a.status === 'pending' && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Pressable disabled={busy} onPress={() => onDecide('confirm', a)} style={{ backgroundColor: C.brand, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, opacity: busy ? 0.5 : 1 }}><Text style={{ color: '#fff', fontWeight: '800' }}>Confirm</Text></Pressable>
          <Pressable disabled={busy} onPress={() => onDecide('cancel', a)} style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, opacity: busy ? 0.5 : 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>Cancel</Text></Pressable>
        </View>
      )}
      {a.status === 'running' && <Text style={{ marginTop: 8, color: C.mute }}>Saving…</Text>}
      {a.status === 'done' && <Text style={{ marginTop: 8, color: C.ok, fontWeight: '700' }}>✓ {a.message || 'Done'}</Text>}
      {a.status === 'failed' && <Text style={{ marginTop: 8, color: C.bad }}>{a.message || 'Failed'}</Text>}
      {a.status === 'cancelled' && <Text style={{ marginTop: 8, color: C.mute }}>Cancelled</Text>}
    </View>
  );
}

export default function Assistant({ me, onClose }) {
  const [items, setItems] = useState([]);   // {k:'u'|'a'|'e'|'card'|'choices', ...}
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState(null);
  const [auto, setAuto] = useState(false);
  const scroll = useRef(null);
  useEffect(() => { AsyncStorage.getItem(AUTO_KEY).then((v) => setAuto(v === '1')).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60); return () => clearTimeout(t); }, [items, busy]);

  const send = async (t) => {
    const message = (t ?? text).trim();
    if (!message || busy) return;
    setText(''); setBusy(true);
    setItems((x) => [...x.filter((i) => i.k !== 'choices'), { k: 'u', text: message }]);
    try {
      const r = await api.post('/ai/chat', { message, conversation_id: conv, auto_confirm: auto });
      setConv(r.conversation_id);
      const cards = r.actions || [];
      const missing = !cards.length && /check the card|press confirm/i.test(r.reply || '');
      setItems((x) => [...x,
        ...(r.reply && !missing ? [{ k: 'a', text: r.reply }] : []),
        ...(missing ? [{ k: 'e', text: 'The confirm card did not arrive. Please send your request again.' }] : []),
        ...cards.map((a) => ({ k: 'card', a })),
        ...(r.choices?.length ? [{ k: 'choices', options: r.choices }] : [])]);
    } catch (e) { setItems((x) => [...x, { k: 'e', text: e.message }]); } finally { setBusy(false); }
  };

  const decide = async (what, a) => {
    setBusy(true);
    try {
      const r = await api.post(`/ai/${what}`, { action_id: a.id, conversation_id: conv });
      setItems((x) => x.map((i) => (i.k === 'card' && i.a.id === a.id ? { k: 'card', a: r.action } : i)));
    } catch (e) { setItems((x) => [...x, { k: 'e', text: e.message }]); } finally { setBusy(false); }
  };
  const pending = items.filter((i) => i.k === 'card' && i.a.status === 'pending').map((i) => i.a);
  const decideAll = async (what) => { for (const a of pending) await decide(what, a); };

  const toggleAuto = (on) => {
    const apply = () => { setAuto(on); AsyncStorage.setItem(AUTO_KEY, on ? '1' : '0').catch(() => {}); };
    if (!on) return apply();
    Alert.alert('Turn on auto-confirm?', 'Changes (users, passwords, roles, deletions) will be saved immediately without asking.', [{ text: 'No', style: 'cancel' }, { text: 'Turn on', style: 'destructive', onPress: apply }]);
  };
  const reset = () => { setConv(null); setItems([]); };
  const chips = SUGGEST.filter((s) => (me.features || []).includes(s.need)).slice(0, 4);
  const first = (me.profile?.full_name || '').split(' ')[0];

  const bubble = (u) => ({ maxWidth: '88%', alignSelf: u ? 'flex-end' : 'flex-start', backgroundColor: u ? C.brand : '#fff', borderWidth: u ? 0 : 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 });
  const chip = { borderWidth: 1, borderColor: C.brand, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: '#fff' };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.brand }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.brand }}>
          <Icon name="sparkle" size={20} color="#fff" />
          <Text style={{ flex: 1, color: '#fff', fontWeight: '800', fontSize: 17 }}>AI assistant</Text>
          <Text style={{ color: '#e2f1e8', fontSize: 12 }}>auto-confirm</Text>
          <Switch value={auto} onValueChange={toggleAuto} trackColor={{ true: '#86efac', false: '#ffffff55' }} thumbColor="#fff" />
          <Pressable onPress={reset} hitSlop={10}><Text style={{ color: '#fff', fontSize: 20 }}>↺</Text></Pressable>
          <Pressable onPress={onClose} hitSlop={10}><Icon name="x" size={22} color="#fff" /></Pressable>
        </View>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 10 }} keyboardShouldPersistTaps="handled">
            {!items.length && (
              <View style={bubble(false)}>
                <Text style={{ color: C.ink }}>Hi{first ? ` ${first}` : ''}! Tell me what to do in the Users module, for example:</Text>
                <Text style={{ color: C.mute, fontSize: 13, marginTop: 6, lineHeight: 20 }}>• How many teachers do we have?{'\n'}• Create a student Rahul Sharma in class 5 A{'\n'}• Turn off the account of Ravi Kumar{'\n'}• Reset password of a teacher</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {chips.map((c) => <Pressable key={c.text} onPress={() => send(c.text)} style={chip}><Text style={{ color: C.brand, fontWeight: '600', fontSize: 13 }}>{c.text}</Text></Pressable>)}
                </View>
              </View>
            )}
            {items.map((i, n) => {
              if (i.k === 'u') return <View key={n} style={bubble(true)}><Text style={{ color: '#fff' }}>{i.text}</Text></View>;
              if (i.k === 'a') return <View key={n} style={bubble(false)}><Rich text={i.text} style={{ color: C.ink }} /></View>;
              if (i.k === 'e') return <View key={n} style={{ ...bubble(false), backgroundColor: '#fdecea', borderColor: '#f5c6c2' }}><Text style={{ color: C.bad }}>{i.text}</Text></View>;
              if (i.k === 'card') return <ActionCard key={n} a={i.a} busy={busy} onDecide={decide} />;
              return (
                <View key={n} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {i.options.map((o) => <Pressable key={o} disabled={busy} onPress={() => send(o)} style={chip}><Text style={{ color: C.brand, fontWeight: '600' }}>{o}</Text></Pressable>)}
                </View>
              );
            })}
            {pending.length > 1 && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable disabled={busy} onPress={() => decideAll('confirm')} style={{ flex: 1, backgroundColor: C.brand, borderRadius: 10, paddingVertical: 11, alignItems: 'center', opacity: busy ? 0.5 : 1 }}><Text style={{ color: '#fff', fontWeight: '800' }}>Confirm all ({pending.length})</Text></Pressable>
                <Pressable disabled={busy} onPress={() => decideAll('cancel')} style={{ flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 11, alignItems: 'center', opacity: busy ? 0.5 : 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>Cancel all</Text></Pressable>
              </View>
            )}
            {busy && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator size="small" color={C.brand} /><Text style={{ color: C.mute }}>Thinking…</Text></View>}
          </ScrollView>
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.line }}>
            <View style={{ flexDirection: 'row', gap: 8, padding: 10 }}>
              <TextInput value={text} onChangeText={setText} placeholder="Type a command…" placeholderTextColor="#9aa5b1" maxLength={2000} onSubmitEditing={() => send()} returnKeyType="send"
                style={{ flex: 1, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink }} />
              <Pressable disabled={busy || !text.trim()} onPress={() => send()} style={{ backgroundColor: C.brand, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', opacity: busy || !text.trim() ? 0.5 : 1 }}><Icon name="send" size={19} color="#fff" /></Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
