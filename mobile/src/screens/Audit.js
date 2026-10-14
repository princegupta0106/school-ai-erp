// Audit logs for mobile (read-only). Mirrors client/src/modules/AuditModule.jsx (same endpoints and filters).
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { api } from '../api';
import { C, dateTime } from '../theme';
import { Dim, Empty, Loading, ErrorBox, Btn, Sheet, Choice, Input, Field, DateField, toast } from '../ui';
import { useApi } from '../useApi';
import { downloadAndShare } from '../download';
import { qs, Pad, List } from './Attendance';

const MODULES = {
  auth: 'Sign-in & account', school: 'School', users: 'Users', attendance: 'Attendance', visitors: 'Visitors', fees: 'Fees',
  communication: 'Communication', academics: 'Academics', homework: 'Homework', documents: 'Documents', payroll: 'Payroll & Leave', ai: 'AI assistant', audit: 'Audit logs', system: 'Other',
};
const KIND = { change: 'Change', view: 'Viewed', auth: 'Sign-in' };
const ROLE = { super_admin: 'Super admin', school_admin: 'School admin', parent: 'Parent', staff: 'Staff', student: 'Student', other: 'Other' };
const EMPTY = { q: '', module: '', kind: '', result: '', from: '', to: '', school_id: '' };
const Gap = ({ h = 12 }) => <View style={{ height: h }} />;
const Chip = ({ ok }) => <Text style={{ fontSize: 11, fontWeight: '700', color: ok ? C.ok : C.bad, backgroundColor: ok ? '#dcfce7' : '#fee2e2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{ok ? 'OK' : 'Failed'}</Text>;

function Detail({ log, sup, onClose }) {
  const rows = [
    ['When', dateTime(log.created_at)],
    ['Who', `${log.actor_name || log.actor_login || 'Unknown'}${log.actor_login && log.actor_name ? ` (${log.actor_login})` : ''}${log.actor_role ? ` - ${ROLE[log.actor_role] || log.actor_role}` : ''}`],
    sup && ['School', log.school_name || (log.school_id ? 'Removed school' : 'Platform (no school)')],
    ['What', log.summary],
    log.entity_label && ['Target', log.entity_label],
    ['Module', MODULES[log.module] || log.module],
    ['Type', KIND[log.kind] || log.kind],
    ['Result', log.success ? `Success (${log.status_code})` : `Failed (${log.status_code})${log.detail?.error ? ` - ${log.detail.error}` : ''}`],
    ['Action code', log.action],
    ['Request', `${log.method} ${log.path}`],
    ['IP address', log.ip],
    ['Device', log.user_agent],
  ].filter(Boolean);
  const { error: _e, ...rest } = log.detail || {};
  return (
    <Sheet title="Log entry" onClose={onClose}>
      {rows.map(([k, v]) => (
        <View key={k} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: C.line }}>
          <Text style={{ color: C.mute, fontSize: 12, fontWeight: '600' }}>{k}</Text>
          <Text style={{ color: C.ink, marginTop: 2 }} selectable>{v || '-'}</Text>
        </View>))}
      {Object.keys(rest).length > 0 && <>
        <Text style={{ color: C.mute, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 16, marginBottom: 6 }}>Details recorded</Text>
        <Text selectable style={{ fontFamily: 'monospace', fontSize: 12, color: C.ink, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10 }}>{JSON.stringify(rest, null, 2)}</Text>
      </>}
      <Dim style={{ marginTop: 12 }}>Passwords, salary figures and message text are never stored in the log.</Dim>
    </Sheet>
  );
}

function OptDate({ value, onChange }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1 }}>{value ? <DateField value={value} onChange={onChange} /> : <Btn small kind="ghost" title="Set date" onPress={() => onChange(new Date().toISOString().slice(0, 10))} />}</View>
      {value ? <Btn small kind="ghost" title="Clear" onPress={() => onChange('')} /> : null}
    </View>
  );
}

// School admin: the log of their own school.  Super admin: all schools (pick one, or "All schools").
export function AuditLogs({ me }) {
  const sup = me.role === 'super_admin';
  const { data: schools } = useApi(sup ? '/schools' : null);
  const [f, setF] = useState(EMPTY); const [applied, setApplied] = useState(EMPTY); const [showF, setShowF] = useState(false);
  const [older, setOlder] = useState([]); const [next, setNext] = useState(null); const [more, setMore] = useState(false); const [open, setOpen] = useState(null);

  // text search waits for a pause in typing; the other filters apply straight away
  useEffect(() => { const t = setTimeout(() => setApplied(f), f.q === applied.q ? 0 : 350); return () => clearTimeout(t); }, [f]); // eslint-disable-line
  const url = `/audit${qs(applied)}`;
  const { data, error, loading, reload } = useApi(url);
  useEffect(() => { setOlder([]); setNext(data?.next || null); }, [data]);

  const loadMore = async () => {
    setMore(true);
    try { const d = await api.get(`/audit${qs({ ...applied, before: next })}`); setOlder((r) => [...r, ...d.logs]); setNext(d.next); }
    catch (e) { toast(e.message, true); } finally { setMore(false); }
  };
  const exportCsv = () => downloadAndShare(`/audit/export${qs(applied)}`, 'audit-log.csv', 'text/csv').catch((e) => toast(e.message, true));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const active = Object.entries(applied).filter(([k, v]) => v && k !== 'q').length;
  const rows = data ? [...data.logs, ...older] : null;

  return (
    <Pad reload={reload} loading={loading} hasData={!!data}>
      <Dim style={{ marginBottom: 10 }}>{sup ? 'Everything that happens on the platform, for every school.' : 'Everything that happens in your school.'} Entries cannot be edited or deleted.</Dim>
      <Input placeholder="Search who, what, or who it was done to..." value={f.q} onChangeText={set('q')} />
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
        <Btn small kind="ghost" title={`${showF ? 'Hide' : 'Show'} filters${active ? ` (${active})` : ''}`} onPress={() => setShowF(!showF)} />
        <Btn small kind="ghost" title="Export CSV" onPress={exportCsv} />
        {dirty && <Btn small kind="ghost" title="Clear" onPress={() => { setF(EMPTY); setApplied(EMPTY); }} />}
      </View>
      {showF && (
        <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, marginBottom: 12 }}>
          {sup && <Field label="School"><Choice value={f.school_id} onChange={set('school_id')} options={[{ value: '', label: 'All schools' }, { value: 'platform', label: 'Platform only' }, ...(schools || []).map((s) => ({ value: s.id, label: s.name }))]} /></Field>}
          <Field label="Module"><Choice value={f.module} onChange={set('module')} options={[{ value: '', label: 'All modules' }, ...Object.entries(MODULES).map(([value, label]) => ({ value, label }))]} /></Field>
          <Field label="Type"><Choice value={f.kind} onChange={set('kind')} options={[{ value: '', label: 'All' }, { value: 'change', label: 'Changes' }, { value: 'view', label: 'Views' }, { value: 'auth', label: 'Sign-ins' }]} /></Field>
          <Field label="Result"><Choice value={f.result} onChange={set('result')} options={[{ value: '', label: 'Any result' }, { value: 'ok', label: 'Successful' }, { value: 'failed', label: 'Failed / refused' }]} /></Field>
          <Field label="From"><OptDate value={f.from} onChange={set('from')} /></Field>
          <Field label="To"><OptDate value={f.to} onChange={set('to')} /></Field>
        </View>)}

      <ErrorBox>{error}</ErrorBox>
      {!rows ? (error ? null : <Loading />) : rows.length === 0 && !error ? <Empty>No log entries match.</Empty> : (
        <List>{rows.map((l, i) => (
          <Pressable key={l.id} onPress={() => setOpen(l)} style={({ pressed }) => [{ padding: 12, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderColor: C.line }, pressed && { backgroundColor: C.soft }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: C.mute, fontSize: 12, flex: 1 }}>{dateTime(l.created_at)}</Text>
              <Chip ok={l.success} />
            </View>
            <Text style={{ color: C.ink, marginTop: 4 }}>{l.summary}</Text>
            <Text style={{ color: C.mute, fontSize: 12, marginTop: 3 }}>
              {l.actor_name || l.actor_login || 'Unknown'}{l.actor_role ? ` (${ROLE[l.actor_role] || l.actor_role})` : ''} · {MODULES[l.module] || l.module} · {KIND[l.kind] || l.kind}{sup ? ` · ${l.school_name || (l.school_id ? 'Removed school' : 'Platform')}` : ''}
            </Text>
          </Pressable>))}</List>)}
      {next && <View style={{ alignSelf: 'center' }}><Btn kind="ghost" title={more ? 'Loading...' : 'Load older entries'} onPress={loadMore} disabled={more} /></View>}
      {open && <Detail log={open} sup={sup} onClose={() => setOpen(null)} />}
    </Pad>
  );
}
