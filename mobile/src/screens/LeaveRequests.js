import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { api, withQs } from '../api';
import { C, span } from '../theme';
import { Card, Dim, Empty, Loading, ErrorBox, Badge, Btn, Sheet, Choice, Input, useRun, confirmAsk } from '../ui';
import { useApi } from '../useApi';
import { useSchoolId } from '../useSchool';
import ApplyForm from './ApplyForm';

export default function LeaveRequests({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useApi(sid ? withQs(`/payroll/leave${status ? `?status=${status}` : ''}`, qs) : null);
  const { data: st } = useApi(sid ? withQs('/payroll/settings', qs) : null);
  const can = me.features.includes('leave_approve');
  const { data: emps } = useApi(sid && can ? withQs('/payroll/employees', qs) : null);
  const { run } = useRun(reload);
  const [note, setNote] = useState({}); const [rec, setRec] = useState(false);
  if (!sid) return <Empty>Create a school first.</Empty>;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {picker}
      <Choice value={status} onChange={setStatus} options={['', 'pending', 'approved', 'rejected', 'cancelled'].map((x) => ({ value: x, label: x ? x[0].toUpperCase() + x.slice(1) : 'All' }))} />
      <View style={{ height: 12 }} />
      {can && st && emps && <><Btn kind="ghost" title="Record leave for someone" onPress={() => setRec(true)} /><View style={{ height: 12 }} /></>}
      {st && <Dim style={{ marginBottom: 12 }}>Approval mode: {st.settings.approval_mode === 'auto' ? 'automatic (requests are approved instantly)' : 'manual (needs an approver)'}</Dim>}
      <ErrorBox>{error}</ErrorBox>
      {!data ? (error ? null : <Loading />) : data.length === 0 ? <Empty>No requests here.</Empty> : data.map((q) => (
        <Card key={q.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ flex: 1, fontWeight: '700', color: C.ink }}>{q.employee?.full_name}</Text><Badge status={q.status} />
          </View>
          <Text style={{ color: C.ink, marginTop: 2 }}>{span(q)} · {q.days} day(s){q.half_day ? ' (half)' : ''}</Text>
          <Dim>{st?.types.find((t) => t.id === q.leave_type_id)?.name} · {q.reason || 'no reason given'}</Dim>
          {q.decision_note ? <Dim>Note: {q.decision_note}{q.decider ? ` (${q.decider.full_name})` : ''}</Dim> : null}
          {can && q.status === 'pending' && (
            <View style={{ marginTop: 10, gap: 8 }}>
              <Input placeholder="Note (optional)" value={note[q.id] || ''} onChangeText={(v) => setNote({ ...note, [q.id]: v })} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Btn title="Approve" onPress={run(() => api.post(withQs(`/payroll/leave/${q.id}/approve`, qs), { note: note[q.id] }), 'Approved')} /></View>
                <View style={{ flex: 1 }}><Btn kind="danger" title="Reject" onPress={run(() => api.post(withQs(`/payroll/leave/${q.id}/reject`, qs), { note: note[q.id] }), 'Rejected')} /></View>
              </View>
            </View>
          )}
          {can && q.status === 'approved' && <View style={{ alignSelf: 'flex-start', marginTop: 8 }}><Btn small kind="ghost" title="Cancel leave" onPress={() => confirmAsk('Cancel this approved leave? The balance is restored.', run(() => api.post(withQs(`/payroll/leave/${q.id}/cancel`, qs)), 'Cancelled'))} /></View>}
        </Card>
      ))}
      {rec && st && emps && <Sheet title="Record leave for an employee" onClose={() => setRec(false)}><ApplyForm types={st.types.filter((t) => t.is_active)} qs={qs} onBehalfList={emps} onDone={async () => { await reload(); setRec(false); }} /></Sheet>}
    </ScrollView>
  );
}
