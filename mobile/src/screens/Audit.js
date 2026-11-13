// Audit logs for mobile (read-only). Mirrors client/src/modules/AuditModule.jsx (same endpoints and filters).
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { api } from '../api';
import { C, T, dateTime } from '../theme';
import { Dim, Loading, Btn, toast } from '../ui';
import { FilterBar } from '../FilterBar';
import { useApi } from '../useApi';
import { downloadAndShare } from '../download';
import { qs, Pad, List, Row, Notice, PageHeader, StatusChip, EmptyState, FormSheet } from '../kit';

const MODULES = {
  auth: 'Sign-in & account', school: 'School', users: 'Users', attendance: 'Attendance', visitors: 'Visitors', queries: 'Queries', fees: 'Fees',
  communication: 'Communication', academics: 'Academics', homework: 'Homework', documents: 'Documents', payroll: 'Payroll & Leave', audit: 'Audit logs', backup: 'Backup & restore', system: 'Other',
};
const KIND = { change: 'Change', view: 'Viewed', auth: 'Sign-in' };
const ROLE = { super_admin: 'Super admin', school_admin: 'School admin', parent: 'Parent', staff: 'Staff', student: 'Student', other: 'Other' };
const EMPTY = { q: '', module: '', kind: '', result: '', from: '', to: '', school_id: '' };
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
    <FormSheet title="Log entry" onClose={onClose} hideFooter>
      {rows.map(([k, v], i) => (
        <View key={k} style={{ paddingVertical: T.sp[2], borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderColor: C.line }}>
          <Text style={{ color: C.mute, fontSize: T.fs.xs, fontWeight: T.fw.semi }}>{k}</Text>
          <Text style={{ color: C.ink, fontSize: T.fs.md, marginTop: 2 }} selectable>{v || '-'}</Text>
        </View>))}
      {Object.keys(rest).length > 0 && <>
        <Text style={{ color: C.mute, fontSize: T.fs.xs, fontWeight: T.fw.semi, marginTop: T.sp[4], marginBottom: T.sp[2] }}>DETAILS RECORDED</Text>
        <Text selectable style={{ fontFamily: 'monospace', fontSize: T.fs.xs, color: C.ink, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: T.rad.md, padding: T.sp[3] }}>{JSON.stringify(rest, null, 2)}</Text>
      </>}
      <Dim style={{ marginTop: T.sp[3] }}>Passwords, salary figures and message text are never stored in the log.</Dim>
    </FormSheet>
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
  const rows = data ? [...data.logs, ...older] : null;

  return (
    <Pad reload={reload} loading={loading} hasData={!!data}>
      <PageHeader title="Audit log" sub={`${sup ? 'Everything that happens on the platform, for every school.' : 'Everything that happens in your school.'} Entries cannot be edited or deleted.`}
        right={<Btn small kind="ghost" title="Export CSV" onPress={exportCsv} />} />
      <FilterBar inline q={f.q} onQ={set('q')} placeholder="Search who, what, or who it was done to..." count={rows?.length}
        filters={[
          sup && { key: 'school_id', label: 'School', value: f.school_id, onChange: set('school_id'), all: 'All schools', options: [{ value: 'platform', label: 'Platform only' }, ...(schools || []).map((x) => ({ value: x.id, label: x.name }))] },
          { key: 'module', label: 'Module', value: f.module, onChange: set('module'), all: 'All modules', options: Object.entries(MODULES).map(([value, label]) => ({ value, label })) },
          { key: 'kind', label: 'Type', value: f.kind, onChange: set('kind'), all: 'All', options: [{ value: 'change', label: 'Changes' }, { value: 'view', label: 'Views' }, { value: 'auth', label: 'Sign-ins' }] },
          { key: 'result', label: 'Result', value: f.result, onChange: set('result'), all: 'Any result', options: [{ value: 'ok', label: 'Successful' }, { value: 'failed', label: 'Failed / refused' }] },
          { key: 'from', label: 'From date', type: 'date', value: f.from, onChange: set('from') },
          { key: 'to', label: 'To date', type: 'date', value: f.to, onChange: set('to') },
        ].filter(Boolean)} />
      {!!error && <Notice tone="bad">{error}</Notice>}
      {!rows ? (error ? <Btn small kind="ghost" title="Retry" onPress={reload} /> : <Loading />) : (
        <List>{rows.length === 0 ? <EmptyState icon="shield" title="No log entries match">Try a wider date range or fewer filters.</EmptyState> : rows.map((l, i) => (
          <Row key={l.id} last={i === rows.length - 1} onPress={() => setOpen(l)}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.mute, fontSize: T.fs.xs }}>{dateTime(l.created_at)}</Text>
              <Text style={{ color: C.ink, fontSize: T.fs.md, fontWeight: T.fw.semi, marginTop: 2 }}>{l.summary}</Text>
              <Text style={{ color: C.mute, fontSize: T.fs.xs, marginTop: 2 }}>
                {l.actor_name || l.actor_login || 'Unknown'}{l.actor_role ? ` (${ROLE[l.actor_role] || l.actor_role})` : ''} · {MODULES[l.module] || l.module} · {KIND[l.kind] || l.kind}{sup ? ` · ${l.school_name || (l.school_id ? 'Removed school' : 'Platform')}` : ''}
              </Text>
            </View>
            <StatusChip tone={l.success ? 'ok' : 'bad'}>{l.success ? 'OK' : 'Failed'}</StatusChip>
          </Row>))}</List>)}
      {next && <View style={{ alignSelf: 'center' }}><Btn kind="ghost" title={more ? 'Loading...' : 'Load older entries'} onPress={loadMore} disabled={more} /></View>}
      {open && <Detail log={open} sup={sup} onClose={() => setOpen(null)} />}
    </Pad>
  );
}
