import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { api, withQs } from '../api';
import { Dim, Empty, ErrorBox, Btn, Choice, Chips, Field, Input, useRun } from '../ui';
import { useApi } from '../useApi';
import { useSchoolId } from '../useSchool';

const clsName = (c) => `${c.name}${c.section ? ` ${c.section}` : ''}`;
const WHO = [{ value: 'all', label: 'Everyone' }, { value: 'students', label: 'Students' }, { value: 'parents', label: 'Parents' }, { value: 'staff', label: 'Staff' }];

// Communication > Send notification: a quick push alert (not a notice-board post). Needs the "send notification" features.
export default function SendNotification({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const canSchool = me.features.includes('send_school_notification'); const canClass = me.features.includes('send_notification');
  const blank = { title: '', body: '', audience: canSchool ? 'school' : 'class', who: 'all', class_ids: [] };
  const [f, setF] = useState(blank);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const { data: classes } = useApi(sid && canClass ? withQs('/notifications/classes', qs) : null);
  const { err, busy, run } = useRun();
  const bad = !f.title.trim() || (f.audience === 'class' && f.class_ids.length === 0);
  const send = run(async () => {
    const r = await api.post('/notifications/send', { ...f, ...(me.role === 'super_admin' ? { school_id: sid } : {}) });
    setF(blank); return r;
  }, (r) => (r.sent ? `Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}` : 'Nobody to send to'));
  if (!sid) return <Empty>Create a school first.</Empty>;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
      {picker}
      <Dim style={{ marginBottom: 12 }}>Sends an alert to people's phones and into their notification bell. For longer announcements use the Notice board.</Dim>
      {canSchool && canClass && <Field label="Send to"><Choice value={f.audience} onChange={set('audience')} options={[{ value: 'school', label: 'Whole school' }, { value: 'class', label: 'Selected classes' }]} /></Field>}
      {f.audience === 'school' && <Field label="Who"><Choice value={f.who} onChange={set('who')} options={WHO} /></Field>}
      {f.audience === 'class' && (
        <Field label="Classes" hint="Students, parents and teachers of these classes">
          {!classes ? <Dim>Loading classes...</Dim> : classes.length === 0 ? <Dim>No classes available to you.</Dim> : <Chips values={f.class_ids} onChange={set('class_ids')} options={classes.map((c) => ({ value: c.id, label: clsName(c) }))} />}
        </Field>)}
      <Field label="Title"><Input maxLength={100} value={f.title} onChangeText={set('title')} placeholder="e.g. School closed tomorrow" /></Field>
      <Field label="Message (optional)"><Input multiline maxLength={500} value={f.body} onChangeText={set('body')} placeholder="A short message..." /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Sending...' : 'Send notification'} disabled={busy || bad} onPress={send} />
    </ScrollView>
  );
}
