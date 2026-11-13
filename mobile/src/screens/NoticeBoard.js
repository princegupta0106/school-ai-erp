import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { api, withQs } from '../api';
import { C, T, dateTime } from '../theme';
import { Dim, Loading, Btn, Choice, Chips, Field, Input, Check, useRun, confirmAsk, toast } from '../ui';
import { Pad, Notice, PageHeader, Section, StatusChip, EmptyState, FormSheet } from '../kit';
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
    <FormSheet title={edit ? 'Edit notice' : 'New notice'} onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel={edit ? 'Save changes' : 'Post notice'} submitDisabled={bad}>
      {!edit && canSchool && canClass && <Field label="Send to"><Choice value={f.audience} onChange={set('audience')} options={[{ value: 'school', label: 'Whole school' }, { value: 'class', label: 'Selected classes' }]} /></Field>}
      {!edit && f.audience === 'class' && (
        <Field label="Classes" hint="Students, parents and teachers of these classes will see it">
          {!classes ? <Dim>Loading classes...</Dim> : classes.length === 0 ? <Dim>No classes available to you.</Dim> : <Chips values={f.class_ids} onChange={set('class_ids')} options={classes.map((c) => ({ value: c.id, label: clsName(c) }))} />}
        </Field>)}
      <Field req label="Title"><Input maxLength={150} value={f.title} onChangeText={set('title')} placeholder="e.g. Parent-teacher meeting on Saturday" /></Field>
      <Field req label="Notice"><Input multiline style={{ minHeight: 140 }} maxLength={5000} value={f.body} onChangeText={set('body')} placeholder="Write the notice..." /></Field>
      <Check label="Pin to the top" value={f.is_pinned} onChange={set('is_pinned')} />
    </FormSheet>
  );
}

function NoticeCard({ n, qs, onChanged, onEdit }) {
  const [open, setOpen] = useState(false);
  const long = n.body.length > 280 || n.body.split('\n').length > 5;
  const act = async (fn, ok) => { try { await fn(); if (ok) toast(ok); onChanged(); } catch (x) { toast(x.message, true); } };
  return (
    <Section title={n.title}
      right={n.can_edit ? <View style={{ flexDirection: 'row', gap: T.sp[1] }}>
        <Btn small kind="ghost" title={n.is_pinned ? 'Unpin' : 'Pin'} onPress={() => act(() => api.patch(withQs(`${base}/announcements/${n.id}`, qs), { is_pinned: !n.is_pinned }), n.is_pinned ? 'Unpinned' : 'Pinned')} />
        <Btn small kind="ghost" title="Edit" onPress={() => onEdit(n)} />
        <Btn small kind="danger" title="Delete" onPress={() => confirmAsk('Delete this notice?', () => act(() => api.del(withQs(`${base}/announcements/${n.id}`, qs)), 'Notice deleted'))} />
      </View> : null}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.sp[2], marginBottom: T.sp[2] }}>
        {n.is_pinned && <StatusChip tone="info">Pinned</StatusChip>}
        {n.audience === 'school' ? <StatusChip tone="mute">Whole school</StatusChip> : n.classes.map((c) => <StatusChip key={c.id} tone="mute">{`Class ${clsName(c)}`}</StatusChip>)}
      </View>
      <Text style={{ color: C.ink, fontSize: T.fs.md, lineHeight: 20 }} numberOfLines={long && !open ? 5 : undefined}>{n.body}</Text>
      {long && <Btn small kind="ghost" title={open ? 'Show less' : 'Read more'} onPress={() => setOpen(!open)} />}
      <Dim style={{ marginTop: T.sp[2] }}>{n.author} · {dateTime(n.created_at)}</Dim>
    </Section>
  );
}

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
  if (!sid) return <Pad><EmptyState icon="school" title="Create a school first" /></Pad>;
  const more = older.more ?? d?.more;
  const all = d ? [...d.pinned, ...d.items, ...older.items] : [];
  return (
    <Pad reload={refresh} loading={loading} hasData={!!d}>
      {picker}
      <PageHeader title="Notice board" sub="Announcements for the school, classes and staff" right={canPost ? <Btn small title="New notice" onPress={() => setForm({})} /> : null} />
      {!!error && <Notice tone="bad">{error}</Notice>}
      {!d ? (error ? <Btn small kind="ghost" title="Retry" onPress={reload} /> : <Loading />) : all.length === 0 ? <Section><EmptyState icon="megaphone" title="No notices yet">{canPost ? 'Post the first one with the button above.' : 'Check back later.'}</EmptyState></Section> : all.map((n) => <NoticeCard key={n.id} n={n} qs={qs} onChanged={refresh} onEdit={setForm} />)}
      {more && <Btn kind="ghost" title={busy ? 'Loading...' : 'Load older notices'} disabled={busy} onPress={loadOlder} />}
      {form && <NoticeForm me={me} qs={qs} sid={sid} edit={form.id ? form : null} onClose={() => setForm(null)} onSaved={refresh} />}
    </Pad>
  );
}
