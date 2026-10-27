import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Platform, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '../api';
import { downloadAndShare } from '../download';
import { shareDocumentPdf } from '../docPrint';
import { C, SH } from '../theme';
import { Icon } from '../icons';
import { KeyboardSafe, toast, confirmAsk, Notifier } from '../ui';

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
  { text: 'Give homework to a class', need: 'manage_homework' },
  { text: 'Who has not submitted my homework?', need: 'manage_homework' },
  { text: 'Enter marks of a test', need: 'manage_assessments' },
  { text: 'Who are the toppers of class 5 A?', need: 'view_academic_reports' },
  { text: 'How did my child do in the exams?', need: 'view_my_academics' },
  { text: 'Download the pending fees list', need: 'view_student_fees' },
  { text: 'Give me a fee receipt', need: 'view_student_fees' },
  { text: 'Download my child’s fee receipt', need: 'view_my_fees' },
  { text: 'Show my documents', need: 'view_my_documents' },
  { text: 'Post a notice for class 5 A', need: 'post_announcement' },
  { text: 'Any new messages?', need: 'use_messages' },
  { text: 'Send a notification to all parents', need: 'send_school_notification' },
  { text: 'What notices are on the board?', need: 'view_announcements' },
];
// files a teacher may attach to homework from the chat (same limits as the Homework screen)
const MAX_FILES = 5, MAX_BYTES = 10 * 1024 * 1024;
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const mimeOf = (a) => (a.mimeType && a.mimeType !== 'application/octet-stream' ? a.mimeType : MIME[(a.name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream');
const sizeOf = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const AUTO_KEY = 'ai_auto_confirm';

// **bold** only
const Rich = ({ text, style }) => (
  <Text style={style}>{String(text ?? '').split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <Text key={i} style={{ fontWeight: '800' }}>{p}</Text> : p))}</Text>
);

// A file the assistant found or made: receipts, fee statements, fee reports (PDF / CSV) and issued certificates.
// It is fetched with the person's own sign-in and opens the phone's share / save sheet.
function FileCard({ d }) {
  const [st, setSt] = useState({ busy: false, err: '', done: false });
  const go = async () => {
    setSt({ busy: true, err: '', done: false });
    try {
      if (d.kind === 'document') {
        const row = await api.get(d.path);
        if (!row.content) throw new Error('This document was cancelled and can no longer be downloaded.');
        await shareDocumentPdf(row.content, { cancelled: row.status === 'cancelled' });
      } else await downloadAndShare(d.path, d.filename, d.format === 'CSV' ? 'text/csv' : 'application/pdf');
      setSt({ busy: false, err: '', done: true });
    } catch (e) { setSt({ busy: false, err: e.message, done: false }); }
  };
  return (
    <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, ...SH, borderLeftWidth: 4, borderLeftColor: C.brand, borderRadius: 12, padding: 10 }}>
      <View style={{ width: 42, height: 42, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.brand, fontWeight: '800', fontSize: 12 }}>{d.format === 'CSV' ? 'CSV' : 'PDF'}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, fontWeight: '800' }}>{d.label}</Text>
        {!!d.sub && <Text style={{ color: C.mute, fontSize: 12 }}>{d.sub}</Text>}
        {!!st.err && <Text style={{ color: C.bad, fontSize: 12 }}>{st.err}</Text>}
        {st.done && !st.err && <Text style={{ color: C.ok, fontSize: 12 }}>✓ Ready: choose Save or Share on the sheet that opened</Text>}
      </View>
      <Pressable disabled={st.busy} onPress={go} style={{ backgroundColor: C.brand, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, minWidth: 84, alignItems: 'center', opacity: st.busy ? 0.6 : 1 }}>
        {st.busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '800' }}>⬇ Download</Text>}
      </Pressable>
    </View>
  );
}

function ActionCard({ a, busy, onDecide }) {
  const border = a.status === 'done' ? C.ok : a.status === 'failed' ? C.bad : a.status === 'cancelled' ? C.line : C.brand;
  return (
    <View style={{ alignSelf: 'stretch', backgroundColor: C.card, borderWidth: 1, borderColor: border, borderLeftWidth: 4, borderRadius: 12, padding: 12, opacity: a.status === 'cancelled' ? 0.6 : 1 }}>
      <Text style={{ fontWeight: '800', color: C.ink, fontSize: 15, marginBottom: 4 }}>{a.title}</Text>
      {(a.lines || []).map((l, i) => <Text key={i} style={{ color: C.ink, paddingVertical: 1 }}>{l}</Text>)}
      {!!a.footer && <Text style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderColor: C.line, fontWeight: '700', color: C.ink }}>{a.footer}</Text>}
      {a.status === 'pending' && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Pressable disabled={busy} onPress={() => onDecide('confirm', a)} style={{ backgroundColor: C.brand, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, opacity: busy ? 0.5 : 1 }}><Text style={{ color: '#fff', fontWeight: '800' }}>Confirm</Text></Pressable>
          <Pressable disabled={busy} onPress={() => onDecide('cancel', a)} style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, opacity: busy ? 0.5 : 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>Cancel</Text></Pressable>
        </View>
      )}
      {a.status === 'running' && <Text style={{ marginTop: 8, color: C.mute }}>Saving…</Text>}
      {a.status === 'done' && <Text style={{ marginTop: 8, color: C.ok, fontWeight: '700' }}>✓ {a.message || 'Done'}</Text>}
      {a.status === 'done' && (a.downloads || []).length > 0 && <View style={{ gap: 8, marginTop: 10 }}>{a.downloads.map((d) => <FileCard key={d.id || d.path} d={d} />)}</View>}
      {a.status === 'failed' && <Text style={{ marginTop: 8, color: C.bad }}>{a.message || 'Failed'}</Text>}
      {a.status === 'cancelled' && <Text style={{ marginTop: 8, color: C.mute }}>Cancelled</Text>}
    </View>
  );
}

export default function Assistant({ me, onClose, initial }) {
  const [items, setItems] = useState([]);   // {k:'u'|'a'|'e'|'card'|'choices', ...}
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState(null);
  const [auto, setAuto] = useState(false);
  const [files, setFiles] = useState([]);      // chosen, not sent yet (uploaded when the message is sent)
  const [kb, setKb] = useState(0);             // height of the keyboard covering this screen (0 = closed)
  const canAttach = (me.features || []).includes('manage_homework');
  const scroll = useRef(null);
  useEffect(() => { AsyncStorage.getItem(AUTO_KEY).then((v) => setAuto(v === '1')).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60); return () => clearTimeout(t); }, [items, busy]);
  // when the keyboard opens, keep the latest messages in view above it
  useEffect(() => { if (!kb) return; const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80); return () => clearTimeout(t); }, [kb]);

  const attach = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: Object.values(MIME), multiple: true, copyToCacheDirectory: true });
      if (r.canceled) return;
      const got = r.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size || 0, type: mimeOf(a) }));
      const big = got.filter((f) => f.size > MAX_BYTES);
      if (big.length) toast(`${big.map((f) => f.name).join(', ')}: each file must be under 10 MB.`, true);
      const ok = got.filter((f) => f.size <= MAX_BYTES && !files.some((x) => x.name === f.name && x.size === f.size));
      if (files.length + ok.length > MAX_FILES) toast(`Up to ${MAX_FILES} files at a time.`, true);
      setFiles([...files, ...ok].slice(0, MAX_FILES));
    } catch (e) { toast(e.message, true); }
  };

  const send = async (t) => {
    const message = (t ?? text).trim();
    const sending = t === undefined ? files : [];
    if ((!message && !sending.length) || busy) return;
    setText(''); setBusy(true);
    try {
      let attachments;
      if (sending.length) {                    // the files wait in a temporary folder until the homework is confirmed
        const fd = new FormData();
        sending.forEach((f) => fd.append('files', { uri: f.uri, name: f.name, type: f.type }));
        attachments = (await api.post('/homework/chat-files', fd)).files;
      }
      setFiles([]);
      setItems((x) => [...x.filter((i) => i.k !== 'choices'), { k: 'u', text: message, files: sending.map((f) => f.name) }]);
      const r = await api.post('/ai/chat', { message, conversation_id: conv, auto_confirm: auto, ...(attachments ? { attachments } : {}) });
      setConv(r.conversation_id);
      const cards = r.actions || [];
      const missing = !cards.length && /check the card|press confirm/i.test(r.reply || '');
      setItems((x) => [...x,
        ...(r.reply && !missing ? [{ k: 'a', text: r.reply }] : []),
        ...(missing ? [{ k: 'e', text: 'The confirm card did not arrive. Please send your request again.' }] : []),
        ...cards.map((a) => ({ k: 'card', a })),
        ...((r.downloads || []).length ? [{ k: 'files', list: r.downloads }] : []),
        ...(r.choices?.length ? [{ k: 'choices', options: r.choices }] : [])]);
    } catch (e) {
      setText((cur) => cur || message);        // keep what they typed (and the files, if the upload itself failed)
      setItems((x) => [...x, { k: 'e', text: e.message }]);
    } finally { setBusy(false); }
  };

  // a question handed over by the search bar (no screen matched it): send it as soon as the chat opens
  useEffect(() => { if (initial) send(initial); }, []); // eslint-disable-line

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
    confirmAsk('Changes (users, passwords, roles, deletions) will be saved immediately without asking.', apply, { title: 'Turn on auto-confirm?', yes: 'Turn on', danger: true });
  };
  const reset = () => { setConv(null); setItems([]); setFiles([]); };
  const chips = SUGGEST.filter((s) => (me.features || []).includes(s.need)).slice(0, 4);
  const first = (me.profile?.full_name || '').split(' ')[0];

  const bubble = (u) => ({ maxWidth: '88%', alignSelf: u ? 'flex-end' : 'flex-start', backgroundColor: u ? C.brand : C.card, borderWidth: u ? 0 : 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 });
  const chip = { borderWidth: 1, borderColor: C.brand, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: C.card };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.brand }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.brand }}>
          <Icon name="sparkle" size={20} color="#fff" />
          <Text style={{ flex: 1, color: '#fff', fontWeight: '800', fontSize: 17 }}>AI assistant</Text>
          <Text style={{ color: '#DFEEE3', fontSize: 12 }}>auto-confirm</Text>
          <Switch value={auto} onValueChange={toggleAuto} trackColor={{ true: '#86efac', false: '#ffffff55' }} thumbColor="#fff" />
          <Pressable onPress={reset} hitSlop={10}><Text style={{ color: '#fff', fontSize: 20 }}>↺</Text></Pressable>
          <Pressable onPress={onClose} hitSlop={10}><Icon name="x" size={22} color="#fff" /></Pressable>
        </View>
        <KeyboardSafe style={{ backgroundColor: C.bg }} onInset={setKb}>
          <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 10 }} keyboardShouldPersistTaps="handled">
            {!items.length && (
              <View style={bubble(false)}>
                <Text style={{ color: C.ink }}>Hi{first ? ` ${first}` : ''}! {canAttach ? 'Tell me what to do, for example:' : 'Tell me what to do in the Users module, for example:'}</Text>
                <Text style={{ color: C.mute, fontSize: 13, marginTop: 6, lineHeight: 20 }}>{canAttach
                  ? '• Homework for 5 A maths, exercise 3.2, last date Friday (tap the paperclip to attach the worksheet)\n• Who has not submitted the English homework?\n• Give Rahul 8/10 on the fractions worksheet'
                  : '• How many teachers do we have?\n• Create a student Rahul Sharma in class 5 A\n• Turn off the account of Ravi Kumar\n• Reset password of a teacher'}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {chips.map((c) => <Pressable key={c.text} onPress={() => send(c.text)} style={chip}><Text style={{ color: C.brand, fontWeight: '600', fontSize: 13 }}>{c.text}</Text></Pressable>)}
                </View>
              </View>
            )}
            {items.map((i, n) => {
              if (i.k === 'u') return <View key={n} style={bubble(true)}>{!!i.text && <Text style={{ color: '#fff' }}>{i.text}</Text>}{(i.files || []).map((f, k) => <Text key={k} style={{ color: '#DFEEE3', fontSize: 13, marginTop: 3 }} numberOfLines={1}>📎 {f}</Text>)}</View>;
              if (i.k === 'a') return <View key={n} style={bubble(false)}><Rich text={i.text} style={{ color: C.ink }} /></View>;
              if (i.k === 'e') return <View key={n} style={{ ...bubble(false), backgroundColor: C.badBg, borderColor: C.badLine }}><Text style={{ color: C.bad }}>{i.text}</Text></View>;
              if (i.k === 'card') return <ActionCard key={n} a={i.a} busy={busy} onDecide={decide} />;
              if (i.k === 'files') return <View key={n} style={{ gap: 8, alignSelf: 'stretch' }}>{i.list.map((d) => <FileCard key={d.id || d.path} d={d} />)}</View>;
              return (
                <View key={n} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {i.options.map((o) => <Pressable key={o} disabled={busy} onPress={() => send(o)} style={chip}><Text style={{ color: C.brand, fontWeight: '600' }}>{o}</Text></Pressable>)}
                </View>
              );
            })}
            {pending.length > 1 && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable disabled={busy} onPress={() => decideAll('confirm')} style={{ flex: 1, backgroundColor: C.brand, borderRadius: 10, paddingVertical: 11, alignItems: 'center', opacity: busy ? 0.5 : 1 }}><Text style={{ color: '#fff', fontWeight: '800' }}>Confirm all ({pending.length})</Text></Pressable>
                <Pressable disabled={busy} onPress={() => decideAll('cancel')} style={{ flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 11, alignItems: 'center', opacity: busy ? 0.5 : 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>Cancel all</Text></Pressable>
              </View>
            )}
            {busy && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator size="small" color={C.brand} /><Text style={{ color: C.mute }}>Thinking…</Text></View>}
          </ScrollView>
          <SafeAreaView edges={kb ? [] : ['bottom']} style={{ backgroundColor: C.card, borderTopWidth: 1, borderColor: C.line }}>
            {files.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, paddingTop: 8 }}>
                {files.map((f, i) => (
                  <View key={`${f.name}${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingLeft: 10, paddingRight: 6, paddingVertical: 4 }}>
                    <Icon name="paperclip" size={13} color={C.mute} />
                    <Text style={{ color: C.ink, fontSize: 13, flexShrink: 1 }} numberOfLines={1}>{f.name} <Text style={{ color: C.mute, fontSize: 11 }}>{sizeOf(f.size)}</Text></Text>
                    <Pressable disabled={busy} hitSlop={8} onPress={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" size={14} color={C.bad} /></Pressable>
                  </View>))}
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 8, padding: 10 }}>
              {canAttach && <Pressable disabled={busy || files.length >= MAX_FILES} onPress={attach} accessibilityLabel="Attach files" style={{ borderWidth: 1, borderColor: C.line, ...SH, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', opacity: busy || files.length >= MAX_FILES ? 0.5 : 1 }}><Icon name="paperclip" size={19} color={C.brand} /></Pressable>}
              <TextInput value={text} onChangeText={setText} onFocus={() => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 250)} placeholder={files.length ? 'Which class is this for?' : 'Type a command…'} placeholderTextColor={C.hint} maxLength={2000} onSubmitEditing={() => send()} returnKeyType="send"
                style={{ flex: 1, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink }} />
              <Pressable disabled={busy || (!text.trim() && !files.length)} onPress={() => send()} style={{ backgroundColor: C.brand, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', opacity: busy || (!text.trim() && !files.length) ? 0.5 : 1 }}><Icon name="send" size={19} color="#fff" /></Pressable>
            </View>
          </SafeAreaView>
        </KeyboardSafe>
      </SafeAreaView>
      <Notifier />
    </Modal>
  );
}
