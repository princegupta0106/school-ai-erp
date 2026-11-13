import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { api, withQs } from '../api';
import { C, money, fmt, span, monthName, ymd } from '../theme';
import { Card, Dim, Empty, Loading, ErrorBox, Badge, Btn, Sheet, Choice, useRun } from '../ui';
import { useApi } from '../useApi';
import { useSchoolId } from '../useSchool';
import ApplyForm from './ApplyForm';

export function Breakdown({ s }) {
  const b = s.breakdown || {}; const leaves = b.leaves || [];
  const Row = ({ l, r, color, bold, sub }) => <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}><View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: bold ? '700' : '400' }}>{l}</Text>{sub ? <Dim>{sub}</Dim> : null}</View><Text style={{ color: color || C.ink, fontWeight: bold ? '700' : '400' }}>{r}</Text></View>;
  return (
    <View>
      <Row l="Monthly salary" r={money(s.base_salary)} />
      <Row l="Leave cut" sub={`${s.unpaid_days} day(s) × ${money(s.rate_per_day)} per day`} r={s.leave_deduction ? `- ${money(s.leave_deduction)}` : money(0)} color={s.leave_deduction ? C.bad : undefined} />
      {(b.bonuses || []).map((x, i) => <Row key={`b${i}`} l={`Bonus: ${x.label}`} r={`+ ${money(x.amount)}`} color={C.ok} />)}
      {(b.deductions || []).map((x, i) => <Row key={`d${i}`} l={`Deduction: ${x.label}`} r={`- ${money(x.amount)}`} color={C.bad} />)}
      <Row bold l="Net pay" r={money(s.net_pay)} />
      {leaves.length > 0 && <Card style={{ marginTop: 10 }}><Text style={{ fontWeight: '700', marginBottom: 6 }}>Leave taken this month</Text>
        {leaves.map((l, i) => <Dim key={i}>{l.type}: {l.taken} day(s) taken, {l.covered} covered by balance, {l.cut} cut from salary ({l.reason})</Dim>)}</Card>}
      <Dim style={{ marginTop: 8 }}>Rate: salary ÷ {b.divisor} ({b.basis === 'working_days' ? 'working days in the month' : b.basis === 'calendar_days' ? 'days in the month' : 'fixed 30 days'})</Dim>
    </View>
  );
}

export default function MyLeave({ me, action, nonce }) {
  const { sid, picker, qs } = useSchoolId(me);
  const { data, error, loading, reload } = useApi(sid ? withQs('/payroll/me', qs) : null);
  const [tab, setTab] = useState('leave'); const [apply, setApply] = useState(action === 'apply'); const [slip, setSlip] = useState(null);
  const { run } = useRun(reload);
  useEffect(() => { if (action === 'apply') setApply(true); }, [action, nonce]);
  const refresh = <RefreshControl refreshing={loading && !!data} onRefresh={reload} />;
  if (!me.school_id) return <Empty>Self-service is for school employees. Sign in as a staff member to use it.</Empty>;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={refresh}>
      {picker}
      <ErrorBox>{error}</ErrorBox>
      {!data ? (error ? null : <Loading />) : (
        <>
          {data.balances.length === 0 && <Empty>No leave types set up yet.</Empty>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            {data.balances.map((b) => (
              <Card key={b.type_id} style={{ flexGrow: 1, flexBasis: '45%', marginBottom: 0, borderLeftWidth: 4, borderLeftColor: b.balance < 0 ? C.bad : b.balance === 0 ? C.warn : C.ok }}>
                <Dim>{b.name} balance</Dim>
                <Text style={{ fontSize: 28, fontWeight: '700', color: b.balance < 0 ? C.bad : C.ink }}>{b.balance}</Text>
                <Dim>{b.balance < 0 ? `Over by ${Math.abs(b.balance)} day(s): extra days are cut from salary` : 'days available'}{b.pending ? ` · ${b.pending} pending` : ''}</Dim>
              </Card>
            ))}
          </View>
          <Btn title="Apply for leave" onPress={() => setApply(true)} />
          <View style={{ height: 12 }} />
          <Choice value={tab} onChange={setTab} options={[{ value: 'leave', label: 'Leave history' }, { value: 'pay', label: 'Salary & payslips' }, { value: 'book', label: 'Balance history' }]} />
          <View style={{ height: 12 }} />

          {tab === 'leave' && <Card>
            {data.requests.length === 0 && <Empty>No leave applied yet.</Empty>}
            {data.requests.map((q) => (
              <View key={q.id} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: C.line }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ flex: 1, fontWeight: '700', color: C.ink }}>{span(q)}</Text><Badge status={q.status} />
                </View>
                <Text style={{ color: C.ink }}>{q.days} day(s){q.half_day ? ' (half)' : ''} · {data.types.find((t) => t.id === q.leave_type_id)?.name || 'Leave'}</Text>
                <Dim>{q.reason}{q.decision_note ? ` · Note: ${q.decision_note}` : ''}{q.auto_approved ? ' · auto-approved' : ''}</Dim>
                {(q.status === 'pending' || (q.status === 'approved' && q.start_date >= ymd(new Date()))) && <View style={{ alignSelf: 'flex-start', marginTop: 8 }}><Btn small kind="ghost" title="Cancel" onPress={run(() => api.post(withQs(`/payroll/leave/${q.id}/cancel`, qs)), 'Cancelled')} /></View>}
              </View>
            ))}
          </Card>}

          {tab === 'pay' && <>
            {data.upcoming.length > 0 && <Card><Text style={{ fontWeight: '700', marginBottom: 6 }}>Coming up (estimate, not final)</Text>
              {data.upcoming.map((u) => (
                <View key={u.period} style={{ flexDirection: 'row', paddingVertical: 8, borderTopWidth: 1, borderColor: C.line }}>
                  <View style={{ flex: 1 }}><Text style={{ fontWeight: '600' }}>{monthName(u.period)}</Text>
                    <Dim>{u.unpaid_days ? `${u.unpaid_days} day(s) cut = -${money(u.leave_deduction)}` : 'No leave cut'}{u.bonus_total ? ` · bonus +${money(u.bonus_total)}` : ''}{u.other_deduction_total ? ` · deductions -${money(u.other_deduction_total)}` : ''} · {u.ended ? 'payment is being prepared' : 'month in progress'}</Dim></View>
                  <Text style={{ fontWeight: '700' }}>{money(u.net_pay)}</Text>
                </View>))}</Card>}
            <Card><Text style={{ fontWeight: '700', marginBottom: 6 }}>Payment history</Text>
              {data.payslips.length === 0 && <Empty>No finalized payslips yet. Last month's salary appears here once payroll finalizes it.</Empty>}
              {data.payslips.map((p) => (
                <Pressable key={p.id} onPress={() => setSlip(p)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderTopWidth: 1, borderColor: C.line }}>
                  <View style={{ flex: 1 }}><Text style={{ fontWeight: '600' }}>{monthName(p.period)}</Text><Dim>{p.status === 'paid' ? `Paid on ${fmt(p.payment_date)}${p.payment_method ? ` via ${p.payment_method}` : ''}` : 'Finalized, payment pending'}</Dim></View>
                  <Badge status={p.status} /><Text style={{ fontWeight: '700' }}>{money(p.net_pay)}</Text>
                </Pressable>))}</Card>
            {!data.has_salary && <Dim>Your salary hasn't been set yet, ask your admin.</Dim>}
          </>}

          {tab === 'book' && <Card>
            {data.ledger.length === 0 && <Empty>Nothing yet.</Empty>}
            {data.ledger.map((x) => (
              <View key={x.id} style={{ flexDirection: 'row', paddingVertical: 8, borderTopWidth: 1, borderColor: C.line }}>
                <View style={{ flex: 1 }}><Text>{x.note}</Text><Dim>{fmt(x.entry_date)} · {x.kind}</Dim></View>
                <Text style={{ fontWeight: '700', color: x.days < 0 ? C.bad : C.ok }}>{x.days > 0 ? '+' : ''}{x.days}</Text>
              </View>))}
          </Card>}
        </>
      )}
      {apply && data && <Sheet title="Apply for leave" onClose={() => setApply(false)}><ApplyForm types={data.types} mode={data.approval_mode} qs={qs} onDone={async () => { await reload(); setApply(false); }} /></Sheet>}
      {slip && <Sheet title={`Payslip · ${monthName(slip.period)}`} onClose={() => setSlip(null)}><Breakdown s={slip} />{slip.status === 'paid' && <Dim style={{ marginTop: 10 }}>Paid on {fmt(slip.payment_date)}{slip.payment_reference ? ` · Ref ${slip.payment_reference}` : ''}</Dim>}</Sheet>}
    </ScrollView>
  );
}
