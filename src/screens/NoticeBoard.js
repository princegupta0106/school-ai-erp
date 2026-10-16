import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { api, withQs } from '../api';
import { C, dateTime } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Sheet, Choice, Chips, Field, Input, Check, useRun, confirmAsk, toast } from '../ui';
import { useApi } from '../useApi';
import { useSchoolId } from '../useSchool';

const base = '/communication';
const clsName = (c) => `${c.name}${c.section ? ` ${c.section}` : ''}`;

function NoticeForm({ me, qs, sid, edit, onClose, onSaved }) {
  const canSchool = me.features.includes('post_school_announcement');
  const canClass = me.features.includes('post_announcement');
  const [f, setF] = useState({ title: edit?.title || '', body: edit?.body || '', audience: canSchool ? 'school' : 'class', class_ids: [], is_pinned: !!edit?.is_pinned });
  const { data: classes } = useApi(!edit && canClass ? withQs(`${base}/announcement-classes`, qs) : null);
  const { err, busy, run } = useRun();
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const bad = !f.title.trim() || !f.body.trim() || (!edit && f.audience === 'class' && f.class_ids.length === 0);
  const save = run(async () => {
    if (edit) await api.patch(withQs(`${base}/announcements/${edit.id}`, qs), { title: f.title, body: f.body, is_pinned: f.is_pinned });
    else await api.post(`${base}/announcements`, { ...f, ...(me.role === 'super_admin' ? { school_id: sid } : {}) });
    onSaved(); onClose();
  }, edit ? 'Notice updated' : 'Notice posted');
  return (
    <Sheet title={edit ? 'Edit notice' : 'New notice'} onClose={onClose}>
      {!edit && canSchool && canClass && <Field label="Send to"><Choice value={f.audience} onChange={set('audience')} options={[{ value: 'school', label: 'Whole school' }, { value: 'class', label: 'Selected classes' }]} /></Field>}
      {!edit && f.audience === 'class' && (
        <Field label="Classes" hint="Students, parents and teachers of these classes will see it">
          {!classes ? <Dim>Loading classes...</Dim> : classes.length === 0 ? <Dim>No classes available to you.</Dim> : <Chips values={f.class_ids} onChange={set('class_ids')} options={classes.map((c) => ({ value: c.id, label: clsName(c) }))} />}
        </Field>)}
      <Field label="Title"><Input maxLength={150} value={f.title} onChangeText={set('title')} placeholder="e.g. Parent-teacher meeting on Saturday" /></Field>
      <Field label="Notice"><Input multiline style={{ minHeight: 140 }} maxLength={5000} value={f.body} onChangeText={set('body')} placeholder="Write the notice..." /></Field>
      <Check label="Pin to the top" value={f.is_pinned} onChange={set('is_pinned')} />
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : edit ? 'Save changes' : 'Post notice'} disabled={busy || bad} onPress={save} />
    </Sheet>
  );
}

const Chip = ({ children, head }) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: head ? C.soft : C.card2, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>{children}</View>;

function Notice({ n, qs, onChanged, onEdit }) {
  const [open, setOpen] = useState(false);
  const long = n.body.length > 280 || n.body.split('\n').length > 5;
  const act = async (fn, ok) => { try { await fn(); if (ok) toast(ok); onChanged(); } catch (x) { toast(x.message, true); } };
  return (
    <Card style={n.is_pinned ? { borderColor: C.accent, borderWidth: 1.5 } : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 }}>
          {n.is_pinned && <Chip head><Icon name="pin" size={12} color={C.accent} /><Text style={{ color: C.accent, fontSize: 12, fontWeight: '700' }}>Pinned</Text></Chip>}
          {n.audience === 'school' ? <Chip><Text style={chipTxt}>Whole school</Text></Chip> : n.classes.map((c) => <Chip key={c.id}><Text style={chipTxt}>Class {clsName(c)}</Text></Chip>)}
        </View>
        {n.can_edit && <View style={{ flexDirection: 'row', gap: 14, marginLeft: 8 }}>
          <Pressable hitSlop={8} onPress={() => act(() => api.patch(withQs(`${base}/announcements/${n.id}`, qs), { is_pinned: !n.is_pinned }), n.is_pinned ? 'Unpinned' : 'Pinned')}><Icon name="pin" size={18} color={n.is_pinned ? C.accent : C.mute} /></Pressable>
          <Pressable hitSlop={8} onPress={() => onEdit(n)}><Icon name="edit" size={18} color={C.mute} /></Pressable>
          <Pressable hitSlop={8} onPress={() => confirmAsk('Delete this notice?', () => act(() => api.del(withQs(`${base}/announcements/${n.id}`, qs)), 'Notice deleted'))}><Icon name="trash" size={18} color={C.bad} /></Pressable>
        </View>}
      </View>
      <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink, marginTop: 8 }}>{n.title}</Text>
      <Text style={{ color: C.ink, marginTop: 4, lineHeight: 20 }} numberOfLines={long && !open ? 5 : undefined}>{n.body}</Text>
      {long && <Pressable onPress={() => setOpen(!open)}><Text style={{ color: C.accent, fontWeight: '600', marginTop: 4 }}>{open ? 'Show less' : 'Read more'}</Text></Pressable>}
      <Dim style={{ marginTop: 8 }}>{n.author} · {dateTime(n.created_at)}</Dim>
    </Card>
  );
}
const chipTxt = { color: C.mute, fontSize: 12, fontWeight: '600' };

export default function NoticeBoard({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const canPost = me.features.includes('post_announcement') || me.features.includes('post_school_announcement');
  const url = sid ? withQs(`${base}/announcements`, qs) : null;
  const { data: d, error, loading, reload } = useApi(url);
  const [older, setOlder] = useState({ items: [], more: null }); const [busy, setBusy] = useState(false); const [form, setForm] = useState(null);
  const refresh = async () => { setOlder({ items: [], more: null }); await reload(); };
  const loadOlder = async () => {
    setBusy(true);
    try { const last = [...d.items, ...older.items].at(-1); const x = await api.get(withQs(`${base}/announcements`, `${qs ? `${qs}&` : ''}before=${encodeURIComponent(last.created_at)}`)); setOlder({ items: [...older.items, ...x.items], more: x.more }); }
    catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  if (!sid) return <Empty>Create a school first.</Empty>;
  const more = older.more ?? d?.more;
  const all = d ? [...d.pinned, ...d.items, ...older.items] : [];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }} refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={refresh} />}>
      {picker}
      {canPost && <><Btn title="New notice" onPress={() => setForm({})} /><View style={{ height: 12 }} /></>}
      <ErrorBox>{error}</ErrorBox>
      {!d ? (error ? null : <Loading />) : all.length === 0 ? <Empty>No notices yet.</Empty> : all.map((n) => <Notice key={n.id} n={n} qs={qs} onChanged={refresh} onEdit={setForm} />)}
      {more && <Btn kind="ghost" title={busy ? 'Loading...' : 'Load older notices'} disabled={busy} onPress={loadOlder} />}
      {form && <NoticeForm me={me} qs={qs} sid={sid} edit={form.id ? form : null} onClose={() => setForm(null)} onSaved={refresh} />}
    </ScrollView>
  );
}
