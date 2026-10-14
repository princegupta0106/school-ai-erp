import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Modal, KeyboardAvoidingView, Platform, Animated, PanResponder } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { api } from './api';
import { C } from './theme';
import { Icon } from './icons';
import { Press, Btn, Dim } from './ui';

const SUGGEST = [
  { text: 'Create a new school', need: 'create_school' },
  { text: 'List all schools', need: 'create_school' },
  { text: 'Create a new user', need: 'create_user' },
  { text: 'How many teachers do we have?', need: 'get_all_users_school' },
  { text: 'Which classes have attendance marked today?', need: 'mark_attendance' },
  { text: 'Show fee pending for a student', need: 'view_student_fees' },
  { text: 'Apply leave for today', need: 'my_leave' },
  { text: 'What is my leave balance?', need: 'my_leave' },
  { text: 'How much salary will I get this month?', need: 'my_leave' },
  { text: 'Show pending leave requests', need: 'leave_approve' },
];

// Floating assistant button + full-screen chat. Talks only to /api/ai/*; the server decides what the person may do.
// The round assistant button: drag it anywhere, tap to open. It snaps to the nearest side edge and remembers where you left it.
const FAB = 54; const MARGIN = 8; const TOP_MIN = 56; const BOTTOM_GAP = 70; // bottom gap keeps it clear of the tab bar
let savedFab = null; // { right: bool, y: number } - kept while the app runs, mirrored to AsyncStorage
function DraggableFab({ onPress, children }) {
  const [box, setBox] = useState(null);
  const pos = useRef(new Animated.ValueXY({ x: -200, y: -200 })).current;
  const cur = useRef({ x: 0, y: 0 }); const start = useRef({ x: 0, y: 0 }); const dims = useRef({ w: 0, h: 0 }); const tap = useRef(onPress);
  tap.current = onPress;

  const place = (right, y, animate) => {
    const { w, h } = dims.current; if (!w) return;
    const ny = Math.min(Math.max(y, TOP_MIN), Math.max(TOP_MIN, h - FAB - BOTTOM_GAP));
    const nx = right ? w - FAB - MARGIN : MARGIN;
    cur.current = { x: nx, y: ny }; savedFab = { right, y: ny };
    if (animate) Animated.spring(pos, { toValue: { x: nx, y: ny }, useNativeDriver: true, friction: 7, tension: 80 }).start();
    else pos.setValue({ x: nx, y: ny });
  };
  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout; dims.current = { w: width, h: height };
    const apply = () => { place(savedFab ? savedFab.right : true, savedFab ? savedFab.y : height - FAB - 78, false); setBox({ width, height }); };
    if (savedFab) apply();
    else AsyncStorage.getItem('assistant.fab').then((raw) => { if (raw) { try { const p = JSON.parse(raw); if (typeof p.y === 'number') savedFab = { right: !!p.right, y: p.y }; } catch { /* ignore */ } } }).catch(() => {}).finally(apply);
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = { ...cur.current }; pos.stopAnimation(); },
    onPanResponderMove: (_, g) => {
      const { w, h } = dims.current;
      const x = Math.min(Math.max(start.current.x + g.dx, 0), w - FAB); const y = Math.min(Math.max(start.current.y + g.dy, 0), h - FAB);
      cur.current = { x, y }; pos.setValue({ x, y });
    },
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) { place(savedFab ? savedFab.right : true, cur.current.y, false); tap.current(); return; }
      const right = cur.current.x + FAB / 2 > dims.current.w / 2;
      place(right, cur.current.y, true);
      AsyncStorage.setItem('assistant.fab', JSON.stringify(savedFab)).catch(() => {});
    },
    onPanResponderTerminate: () => { place(savedFab ? savedFab.right : true, cur.current.y, true); },
  })).current;

  return (
    <View pointerEvents="box-none" onLayout={onLayout} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      {box && (
        <Animated.View {...pan.panHandlers} accessibilityRole="button" accessibilityLabel="Open assistant"
          style={{ position: 'absolute', left: 0, top: 0, width: FAB, height: FAB, borderRadius: FAB / 2, backgroundColor: C.soft, borderWidth: 1, borderColor: '#c9dccf', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, transform: pos.getTranslateTransform() }}>
          {children}
        </Animated.View>)}
    </View>
  );
}

export default function AssistantChat({ me, hidden }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState(null); const [files, setFiles] = useState([]); const [uploading, setUploading] = useState(false);
  const end = useRef(null);
  useEffect(() => { setTimeout(() => end.current?.scrollToEnd({ animated: true }), 60); }, [msgs, busy, open]);

  const absorb = (r) => {
    setConv(r.conversation_id);
    setMsgs((m) => [...m, { role: 'bot', text: r.reply, actions: r.actions || [], pending: (r.pending || []).map((p) => ({ ...p, state: 'open' })) }]);
  };
  const fail = (e) => setMsgs((m) => [...m, { role: 'bot', text: e.message, error: true }]);

  const send = async (t) => {
    const message = (t ?? text).trim() || (files.length ? 'Please summarise the attached file.' : '');
    if (!message || busy || uploading) return;
    setText(''); setBusy(true);
    const sent = files.filter((f) => f.kind === 'inline');
    setFiles((f) => f.filter((x) => x.kind !== 'inline'));
    setMsgs((m) => [...m, { role: 'me', text: message, files: sent.map((f) => f.name) }]);
    try { absorb(await api.post('/ai/chat', { message, conversation_id: conv })); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const decide = async (mi, pid, approve) => {
    setMsgs((m) => m.map((x, i) => (i !== mi ? x : { ...x, pending: x.pending.map((p) => (p.id === pid ? { ...p, state: approve ? 'confirmed' : 'cancelled' } : p)) })));
    setBusy(true);
    try { absorb(await api.post('/ai/confirm', { pending_id: pid, approve })); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const attach = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/*', 'application/json', 'image/*'], copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      if (a.size && a.size > 8 * 1024 * 1024) return fail(new Error('That file is over 8 MB'));
      setUploading(true);
      const fd = new FormData();
      fd.append('file', { uri: a.uri, name: a.name || 'file', type: a.mimeType || 'application/octet-stream' });
      if (conv) fd.append('conversation_id', conv);
      const up = await api.post('/ai/upload', fd);
      setConv(up.conversation_id); setFiles((f) => [...f, up.file]);
    } catch (x) { fail(x); } finally { setUploading(false); }
  };
  const unattach = (f) => { setFiles((x) => x.filter((y) => y.id !== f.id)); if (conv) api.post('/ai/remove-file', { conversation_id: conv, file_id: f.id }).catch(() => {}); };
  const reset = () => { if (conv) api.post('/ai/reset', { conversation_id: conv }).catch(() => {}); setConv(null); setMsgs([]); setFiles([]); };
  const chips = SUGGEST.filter((s) => me.features.includes(s.need)).slice(0, 5);

  return (
    <>
      {!open && !hidden && (
        <DraggableFab onPress={() => setOpen(true)}>
          <Icon name="sparkle" size={24} color={C.brand} />
        </DraggableFab>
      )}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: C.line, gap: 10 }}>
              <Icon name="sparkle" size={20} color={C.brand} /><Text style={{ fontWeight: '800', fontSize: 17, color: C.ink, flex: 1 }}>Assistant</Text>
              <Btn small kind="ghost" title="New chat" disabled={!msgs.length && !files.length} onPress={reset} />
              <Pressable onPress={() => setOpen(false)} hitSlop={10}><Icon name="x" size={22} color={C.ink} /></Pressable>
            </View>
            <ScrollView ref={end} contentContainerStyle={{ padding: 14, gap: 10 }} keyboardShouldPersistTaps="handled">
              {!msgs.length && (
                <View>
                  <Text style={{ color: C.ink, lineHeight: 21 }}>Hi {me.profile?.full_name?.split(' ')[0] || ''}! Tell me what to do on the portal, e.g. "create a new teacher" or "apply leave for today", or just ask me questions. The portal only lets me do what your account is allowed to do.</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                    {chips.map((c) => <Pressable key={c.text} onPress={() => send(c.text)} style={({ pressed }) => ({ borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.soft : '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 })}><Text style={{ color: C.ink, fontSize: 13 }}>{c.text}</Text></Pressable>)}
                  </View>
                </View>
              )}
              {msgs.map((m, i) => (
                <View key={i} style={{ alignSelf: m.role === 'me' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
                  {m.actions?.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>{m.actions.map((a, k) => <Text key={k} style={{ fontSize: 11, fontWeight: '600', color: a.ok ? C.ok : C.bad, backgroundColor: a.ok ? '#e2f1e8' : '#fde8e8', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{a.ok ? '✓' : '✕'} {a.tool}</Text>)}</View>}
                  <View style={{ backgroundColor: m.role === 'me' ? C.brand : m.error ? '#fde8e8' : '#fff', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9, borderWidth: m.role === 'me' ? 0 : 1, borderColor: C.line }}>
                    <Text style={{ color: m.role === 'me' ? '#fff' : m.error ? C.bad : C.ink, fontSize: 15, lineHeight: 21 }} selectable>{m.text}</Text>
                    {m.files?.length > 0 && m.files.map((n, k) => <Text key={k} style={{ color: '#ffffffcc', fontSize: 12, marginTop: 4 }}>📎 {n}</Text>)}
                  </View>
                  {m.pending?.map((p) => (
                    <View key={p.id} style={{ marginTop: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: C.warn, borderRadius: 14, padding: 12 }}>
                      <Dim>Please confirm</Dim>
                      <Text style={{ color: C.ink, marginVertical: 6 }}>{p.details}</Text>
                      {p.state === 'open'
                        ? <View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 1 }}><Btn small title="Confirm" disabled={busy} onPress={() => decide(i, p.id, true)} /></View><View style={{ flex: 1 }}><Btn small kind="ghost" title="Cancel" disabled={busy} onPress={() => decide(i, p.id, false)} /></View></View>
                        : <Text style={{ color: C.mute, fontStyle: 'italic' }}>{p.state === 'confirmed' ? 'Confirmed' : 'Cancelled'}</Text>}
                    </View>
                  ))}
                </View>
              ))}
              {busy && <View style={{ alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderColor: C.line }}><Text style={{ color: C.mute }}>Working…</Text></View>}
            </ScrollView>
            {files.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingTop: 8, backgroundColor: '#fff' }}>
                {files.map((f) => <Pressable key={f.id} onPress={() => unattach(f)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.soft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ color: C.brand, fontSize: 12 }}>📎 {f.name}</Text><Icon name="x" size={12} color={C.brand} /></Pressable>)}
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.line }}>
              <Pressable onPress={attach} disabled={busy || uploading} hitSlop={6} style={{ padding: 8, opacity: busy || uploading ? 0.4 : 1 }}><Icon name="paperclip" size={22} color={C.mute} /></Pressable>
              <TextInput value={text} onChangeText={setText} multiline maxLength={2000} placeholder={uploading ? 'Reading file…' : files.length ? 'Ask about the file…' : 'Type a request…'} placeholderTextColor="#9aa5b1" style={{ flex: 1, maxHeight: 110, backgroundColor: C.bg, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, color: C.ink }} />
              <Press onPress={() => send()} disabled={busy || uploading || (!text.trim() && !files.length)} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', opacity: busy || uploading || (!text.trim() && !files.length) ? 0.5 : 1 }}><Icon name="send" size={19} color="#fff" /></Press>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
