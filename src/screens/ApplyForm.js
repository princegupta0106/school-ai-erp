import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { api, withQs } from '../api';
import { C, ymd } from '../theme';
import { Field, Input, Check, Choice, DateField, Btn, ErrorBox, Dim, useRun } from '../ui';

// Employee applies for leave; approvers can record leave for someone (onBehalfList).
export default function ApplyForm({ types, mode, qs, onBehalfList, onDone }) {
  const today = ymd(new Date());
  const blank = { leave_type_id: types[0]?.id || '', start_date: today, end_date: today, half_day: false, reason: '', user_id: '' };
  const [f, setF] = useState(blank);
  const { err, busy, run } = useRun();
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const submit = run(async () => {
    if (onBehalfList && !f.user_id) throw new Error('Choose an employee');
    if (!onBehalfList && !f.reason.trim()) throw new Error('Please give a reason');
    await api.post(withQs('/payroll/leave', qs), { ...f, end_date: f.end_date || f.start_date, user_id: f.user_id || undefined });
    await onDone();
  }, onBehalfList ? 'Leave recorded' : mode === 'auto' ? 'Leave approved automatically' : 'Leave request sent for approval');
  const label = onBehalfList ? 'Record leave (approved)' : mode === 'auto' ? 'Apply (approved instantly)' : 'Send for approval';
  return (
    <View>
      {onBehalfList && <Field label="Employee"><Choice value={f.user_id} onChange={set('user_id')} options={onBehalfList.map((e) => ({ value: e.user_id, label: e.full_name }))} /></Field>}
      <Field label="Leave type"><Choice value={f.leave_type_id} onChange={set('leave_type_id')} options={types.map((t) => ({ value: t.id, label: t.name + (t.is_paid ? '' : ' (unpaid)') }))} /></Field>
      <Check label="Half day (single date)" value={f.half_day} onChange={(v) => setF((p) => ({ ...p, half_day: v, end_date: v ? p.start_date : p.end_date }))} />
      <Field label="From"><DateField value={f.start_date} onChange={(v) => setF((p) => ({ ...p, start_date: v, end_date: p.half_day || p.end_date < v ? v : p.end_date }))} /></Field>
      <Field label="To"><DateField value={f.half_day ? f.start_date : f.end_date} disabled={f.half_day} min={f.start_date} onChange={set('end_date')} /></Field>
      <Field label="Reason"><Input multiline value={f.reason} onChangeText={set('reason')} placeholder="Why do you need leave?" /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Please wait...' : label} onPress={submit} disabled={busy || !types.length} />
      {!onBehalfList && <Dim style={{ marginTop: 10 }}>Weekly offs and school holidays are not counted. Going over your balance is allowed, but the extra days are cut from that month's salary.</Dim>}
    </View>
  );
}
