import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { api, withQs } from '../api';
import { C } from '../theme';
import { Card, Dim, Empty, Loading, ErrorBox, Badge, Btn, Sheet, Choice, Chips, Field, Input, Check, useRun } from '../ui';
import { useApi } from '../useApi';
import { useSchoolId } from '../useSchool';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PaySettings({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const { data, error, loading, reload } = useApi(sid ? withQs('/payroll/settings', qs) : null);
  const [f, setF] = useState(null); const [nt, setNt] = useState({ name: '', annual_quota: '12', is_paid: true }); const [quota, setQuota] = useState(null);
  useEffect(() => { if (data) setF(data.settings); }, [data]);
  const { run, busy } = useRun(reload);
  if (!sid) return <Empty>Create a school first.</Empty>;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {picker}
      <ErrorBox>{error}</ErrorBox>
      {!data || !f ? (error ? null : <Loading />) : (
        <>
          <Card>
            <Text style={sec}>Approval</Text>
            <Field label="When an employee applies for leave"><Choice value={f.approval_mode} onChange={(v) => setF({ ...f, approval_mode: v })} options={[{ value: 'manual', label: 'Needs approval' }, { value: 'auto', label: 'Approve automatically' }]} /></Field>
            <Text style={sec}>Pay rules</Text>
            <Field label="Weekly off days (not counted as leave)"><Chips values={f.weekly_off} onChange={(v) => setF({ ...f, weekly_off: v })} options={DAYS.map((d, i) => ({ value: i, label: d }))} /></Field>
            <Field label="Per-day salary used for cuts"><Choice value={f.rate_basis} onChange={(v) => setF({ ...f, rate_basis: v })} options={[{ value: 'working_days', label: 'Salary ÷ working days' }, { value: 'calendar_days', label: 'Salary ÷ days in month' }, { value: 'fixed_30', label: 'Salary ÷ 30' }]} /></Field>
            <Btn title="Save rules" disabled={busy} onPress={run(() => api.put(withQs('/payroll/settings', qs), f), 'Saved')} />
          </Card>
          <Card>
            <Text style={sec}>Leave types</Text>
            {data.types.map((t) => (
              <View key={t.id} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: C.line }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ fontWeight: '700', color: C.ink, flex: 1 }}>{t.name}</Text>{!t.is_active && <Badge status="off" />}</View>
                <Dim>{t.is_paid ? `${t.annual_quota} days per year` : 'Unpaid: every day is cut from salary'}</Dim>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  {t.is_paid && <Btn small kind="ghost" title="Quota" onPress={() => setQuota({ id: t.id, name: t.name, v: String(t.annual_quota) })} />}
                  <Btn small kind="ghost" title={t.is_active ? 'Turn off' : 'Turn on'} onPress={run(() => api.patch(withQs(`/payroll/leave-types/${t.id}`, qs), { is_active: !t.is_active }))} />
                </View>
              </View>
            ))}
            <View style={{ borderTopWidth: 1, borderColor: C.line, paddingTop: 12 }}>
              <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 8 }}>Add a leave type</Text>
              <Input placeholder="Casual leave" value={nt.name} onChangeText={(v) => setNt({ ...nt, name: v })} />
              <View style={{ height: 8 }} />
              <Check label="Paid" value={nt.is_paid} onChange={(v) => setNt({ ...nt, is_paid: v })} />
              {nt.is_paid && <Field label="Days per year"><Input keyboardType="decimal-pad" value={nt.annual_quota} onChangeText={(v) => setNt({ ...nt, annual_quota: v })} /></Field>}
              <Btn title="Add" disabled={busy || !nt.name.trim()} onPress={run(async () => { await api.post(withQs('/payroll/leave-types', qs), nt); setNt({ name: '', annual_quota: '12', is_paid: true }); }, 'Added')} />
            </View>
            <Dim style={{ marginTop: 10 }}>Tip: add an unpaid type (untick Paid) like "Loss of pay" for leave that is always cut from salary. After creating types, give balances in Balances & grants.</Dim>
          </Card>
        </>
      )}
      {quota && <Sheet title={`Yearly days · ${quota.name}`} onClose={() => setQuota(null)}>
        <Field label="Days per year"><Input keyboardType="decimal-pad" value={quota.v} onChangeText={(v) => setQuota({ ...quota, v })} /></Field>
        <Btn title="Save" onPress={run(async () => { await api.patch(withQs(`/payroll/leave-types/${quota.id}`, qs), { annual_quota: quota.v }); setQuota(null); }, 'Updated')} />
      </Sheet>}
    </ScrollView>
  );
}
const sec = { fontSize: 14, fontWeight: '700', color: C.ink, marginBottom: 10 };
