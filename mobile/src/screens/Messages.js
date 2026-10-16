import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native';
import { api } from '../api';
import { C, initials, timeStr, dayKey, dayLabel, when } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Sheet, Input, Press, toast } from '../ui';
import { useApi } from '../useApi';

const base = '/communication';
const Avatar = ({ name, size = 40 }) => <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.brand, fontWeight: '700', fontSize: size * 0.36 }}>{initials(name)}</Text></View>;
const merge = (a, b) => { const seen = new Set(a.map((m) => m.id)); return [...a, ...b.filter((m) => !seen.has(m.id))]; };

function NewChat({ onPick, onClose }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [list, setList] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { let live = true; api.get(`${base}/contacts${dq ? `?q=${encodeURIComponent(dq)}` : ''}`).then((d) => live && (setList(d), setErr(''))).catch((e) => live && setErr(e.message)); return () => { live = false; }; }, [dq]);
  return (
    <Sheet title="New message" onClose={onClose}>
      <Input autoFocus placeholder="Search teacher, parent or student name" value={q} onChangeText={setQ} />
      <View style={{ height: 12 }} />
      <ErrorBox>{err}</ErrorBox>
      {!list ? <Loading /> : list.length === 0 ? <Empty>No one found. You can message the people connected to your classes.</Empty> : (
        <Card style={{ padding: 0 }}>{list.map((c, i) => (
          <Pressable key={c.user_id} onPress={() => onPick(c)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderTopWidth: i ? 1 : 0, borderColor: C.line }}>
            <Avatar name={c.name} /><View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.ink }}>{c.name}</Text><Dim>{c.label}</Dim></View>
          </Pressable>))}</Card>)}
    </Sheet>
  );
}

function Thread({ conv, active, onBack, onActivity }) {
  const [msgs, setMsgs] = useState(null); const [more, setMore] = useState(false);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const box = useRef(null); const ref = useRef([]); const stick = useRef(true);
  ref.current = msgs || [];
  const toEnd = (animated = false) => setTimeout(() => box.current?.scrollToEnd({ animated }), 50);

  useEffect(() => {
    let live = true; setMsgs(null); stick.current = true;
    api.get(`${base}/conversations/${conv.id}/messages`).then((d) => { if (!live) return; setMsgs(d.messages); setMore(d.more); toEnd(); onActivity(); }).catch((e) => toast(e.message, true));
    return () => { live = false; };
  }, [conv.id]); // eslint-disable-line
  // new messages arrive every few seconds while this chat is on screen
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const t = setInterval(async () => {
      try {
        const last = ref.current.at(-1);
        const d = await api.get(`${base}/conversations/${conv.id}/messages${last ? `?after=${encodeURIComponent(last.created_at)}` : ''}`);
        if (!live) return;
        if (last ? d.messages.length : true) { setMsgs((m) => (last ? merge(m || [], d.messages) : d.messages)); if (stick.current) toEnd(true); onActivity(); }
      } catch { /* next tick */ }
    }, 5000);
    return () => { live = false; clearInterval(t); };
  }, [conv.id, active]); // eslint-disable-line

  const earlier = async () => {
    try { const d = await api.get(`${base}/conversations/${conv.id}/messages?before=${encodeURIComponent(ref.current[0].created_at)}`); setMsgs((m) => [...d.messages, ...m]); setMore(d.more); }
    catch (e) { toast(e.message, true); }
  };
  const send = async () => {
    const body = text.trim(); if (!body || busy) return;
    setBusy(true);
    try { const m = await api.post(`${base}/conversations/${conv.id}/messages`, { body }); setText(''); stick.current = true; setMsgs((x) => merge(x || [], [m])); toEnd(true); onActivity(); }
    catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: C.line }}>
        <Pressable onPress={onBack} hitSlop={10}><Icon name="back" size={22} color={C.ink} /></Pressable>
        <Avatar name={conv.other.name} size={36} />
        <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.ink }} numberOfLines={1}>{conv.other.name}</Text><Dim>{conv.other.label}</Dim></View>
      </View>
      <ScrollView ref={box} contentContainerStyle={{ padding: 12, gap: 6 }} keyboardShouldPersistTaps="handled"
        onScroll={(e) => { const t = e.nativeEvent; stick.current = t.contentSize.height - t.contentOffset.y - t.layoutMeasurement.height < 80; }} scrollEventThrottle={100}>
        {!msgs ? <Loading /> : (<>
          {more && <View style={{ alignSelf: 'center' }}><Btn small kind="ghost" title="Load earlier messages" onPress={earlier} /></View>}
          {msgs.length === 0 && <Empty>No messages yet. Say hello!</Empty>}
          {msgs.map((m, i) => (
            <React.Fragment key={m.id}>
              {(i === 0 || dayKey(msgs[i - 1].created_at) !== dayKey(m.created_at)) && <Text style={{ alignSelf: 'center', color: C.mute, fontSize: 12, backgroundColor: '#E4DFD3', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginVertical: 6, overflow: 'hidden' }}>{dayLabel(m.created_at)}</Text>}
              <View style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '82%', backgroundColor: m.mine ? C.brand : '#fff', borderRadius: 16, borderBottomRightRadius: m.mine ? 4 : 16, borderBottomLeftRadius: m.mine ? 16 : 4, paddingHorizontal: 12, paddingVertical: 8, borderWidth: m.mine ? 0 : 1, borderColor: C.line }}>
                <Text style={{ color: m.mine ? '#fff' : C.ink, fontSize: 15 }}>{m.body}</Text>
                <Text style={{ color: m.mine ? '#ffffffb0' : C.mute, fontSize: 10, alignSelf: 'flex-end', marginTop: 2 }}>{timeStr(m.created_at)}</Text>
              </View>
            </React.Fragment>))}
        </>)}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.line }}>
        <TextInput value={text} onChangeText={setText} multiline maxLength={2000} placeholder="Type a message" placeholderTextColor="#9A9A93" style={{ flex: 1, maxHeight: 110, backgroundColor: C.bg, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, color: C.ink }} />
        <Press onPress={send} disabled={busy || !text.trim()} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', opacity: busy || !text.trim() ? 0.5 : 1 }}><Icon name="send" size={19} color="#fff" /></Press>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function Messages({ me, active: onScreen = true }) {
  const [chat, setChat] = useState(null); const [picking, setPicking] = useState(false);
  const { data: list, error, loading, reload } = useApi(me.school_id ? `${base}/conversations` : null);
  // keep the chat list fresh while this tab is showing
  useEffect(() => { if (!me.school_id || !onScreen) return undefined; const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload, me.school_id, onScreen]);
  if (!me.school_id) return <Empty>Messages are for school accounts. Sign in as a school user to chat.</Empty>;
  const start = async (c) => {
    try { const r = await api.post(`${base}/conversations`, { user_id: c.user_id }); setPicking(false); setChat({ id: r.id, other: r.other }); reload(); }
    catch (x) { toast(x.message, true); }
  };
  if (chat) return <Thread key={chat.id} conv={chat} active={onScreen} onBack={() => { setChat(null); reload(); }} onActivity={reload} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={loading && !!list} onRefresh={reload} />}>
      <Btn title="New message" onPress={() => setPicking(true)} />
      <View style={{ height: 12 }} />
      <ErrorBox>{error}</ErrorBox>
      {!list ? (error ? null : <Loading />) : list.length === 0 ? <Empty>No chats yet. Start one with "New message".</Empty> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>{list.map((c, i) => (
          <Pressable key={c.id} onPress={() => setChat({ id: c.id, other: c.other })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderTopWidth: i ? 1 : 0, borderColor: C.line, backgroundColor: pressed ? C.bg : '#fff' })}>
            <Avatar name={c.other.name} />
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.ink }} numberOfLines={1}>{c.other.name}</Text><Dim style={{ marginTop: 1 }}>{c.last_mine ? 'You: ' : ''}{c.last_preview}</Dim></View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}><Dim style={{ fontSize: 11 }}>{c.last_message_at ? when(c.last_message_at) : ''}</Dim>
              {c.unread > 0 && <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{c.unread}</Text></View>}</View>
          </Pressable>))}</Card>)}
      {picking && <NewChat onPick={start} onClose={() => setPicking(false)} />}
    </ScrollView>
  );
}
