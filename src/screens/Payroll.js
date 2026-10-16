import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { api, withQs } from '../api';
import { C, money, fmt, monthName, prevMonth, ymd } from '../theme';
import { Card, Dim, Empty, Loading, ErrorBox, Badge, Btn, Sheet, Choice, Field, Input, DateField, MonthStepper, useRun, confirmAsk } from '../ui';
import { useApi } from '../useApi';
import { useSchoolId } from '../useSchool';
import { Breakdown } from './MyLeave';

function PayForm({ all, onSubmit, busy }) {
  const [f, setF] = useState({ payment_date: ymd(new Date()), payment_method: 'Bank transfer', payment_reference: '' });
  return (
    <View>
      <Field label="Payment date"><DateField value={f.payment_date} onChange={(v) => setF({ ...f, payment_date: v })} /></Field>
      <Field label="Method"><Choice value={f.payment_method} onChange={(v) => setF({ ...f, payment_method: v })} options={['Bank transfer', 'UPI', 'Cheque', 'Cash'].map((m) => ({ value: m, label: m }))} /></Field>
      <Field label="Reference / transaction no. (optional)"><Input value={f.payment_reference} onChangeText={(v) => setF({ ...f, payment_reference: v })} /></Field>
      <Btn title={all ? 'Confirm all paid' : 'Confirm paid'} disabled={busy} onPress={() => onSubmit(f)} />
    </View>
  );
}
function AdjForm({ emps, month, onDone }) {
  const [f, setF] = useState({ user_id: '', kind: 'bonus', label: '', amount: '', period: month });
  const { err, busy, run } = useRun();
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <View>
      <Field label="Employee"><Choice value={f.user_id} onChange={set('user_id')} options={emps.map((e) => ({ value: e.user_id, label: e.full_name }))} /></Field>
      <Field label="Type"><Choice value={f.kind} onChange={set('kind')} options={[{ value: 'bonus', label: 'Bonus (adds)' }, { value: 'deduction', label: 'Deduction (subtracts)' }]} /></Field>
      <Field label="Month"><MonthStepper value={f.period} onChange={set('period')} /></Field>
      <Field label="Reason (employee will see it)"><Input value={f.label} onChangeText={set('label')} placeholder="Diwali bonus / Advance recovery" /></Field>
      <Field label="Amount (₹)"><Input keyboardType="decimal-pad" value={f.amount} onChangeText={set('amount')} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title="Add" disabled={busy} onPress={run(async () => { if (!f.user_id) throw new Error('Choose an employee'); if (!f.label.trim() || !(Number(f.amount) > 0)) throw new Error('Enter a reason and an amount'); await onDone(f); })} />
    </View>
  );
}

export default function Payroll({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const [month, setMonth] = useState(prevMonth());
  const manage = me.features.includes('payroll_manage');
  const { data, error, loading, reload } = useApi(sid ? withQs(`/payroll/payslips?period=${month}`, qs) : null);
  const { data: adj, reload: reloadAdj } = useApi(sid ? withQs(`/payroll/adjustments?period=${month}`, qs) : null);
  const { data: emps } = useApi(sid ? withQs('/payroll/employees', qs) : null);
  const { data: audit, reload: reloadAudit } = useApi(sid && manage ? withQs('/payroll/audit', qs) : null);
  const [open, setOpen] = useState(null); const [pay, setPay] = useState(null); const [showAdj, setShowAdj] = useState(false); const [showAudit, setShowAudit] = useState(false);
  const all = async () => { await Promise.all([reload(), reloadAdj(), reloadAudit()]); };
  const { run, busy } = useRun(all);
  if (!sid) return <Empty>Create a school first.</Empty>;
  const rows = data?.rows || [];
  const sum = (k) => rows.reduce((s, x) => s + Number(x[k]), 0);
  const nDraft = rows.filter((x) => x.status === 'draft').length; const nFin = rows.filter((x) => x.status === 'finalized').length;
  const post = (url, body) => api.post(withQs(url, qs), body);
  const Stat = ({ l, v, color }) => <Card style={{ flexGrow: 1, flexBasis: '45%', marginBottom: 0 }}><Dim>{l}</Dim><Text style={{ fontWeight: '700', fontSize: 17, color: color || C.ink }}>{v}</Text></Card>;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={all} />} keyboardShouldPersistTaps="handled">
      {picker}
      <MonthStepper value={month} onChange={setMonth} />
      <View style={{ height: 12 }} />
      {manage && (
        <View style={{ gap: 8, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Btn kind="ghost" title="Prepare / refresh" disabled={busy || !data?.can_generate} onPress={run(() => post('/payroll/payslips/generate', { period: month }), (r) => `Prepared ${r.made} payslip(s)${r.noSalary.length ? `; no salary set for: ${r.noSalary.join(', ')}` : ''}`)} /></View>
            <View style={{ flex: 1 }}><Btn kind="ghost" title="Finalize all" disabled={busy || !nDraft} onPress={() => confirmAsk(`Finalize ${nDraft} draft payslip(s)? Numbers lock and negative leave balances are settled.`, run(() => post('/payroll/payslips/finalize-all', { period: month }), (r) => `Finalized ${r.done}${r.failed.length ? `. Skipped: ${r.failed.join(' | ')}` : ''}`))} /></View>
          </View>
          <Btn title="Mark all paid" disabled={busy || !nFin} onPress={() => setPay({ all: true })} />
        </View>
      )}
      {data && !data.can_generate && <Dim style={{ marginBottom: 12 }}>{monthName(`${month}-01`)} hasn't ended. Payroll for a month is prepared after it finishes. You can still add bonuses or deductions now.</Dim>}
      <ErrorBox>{error}</ErrorBox>
      {data && rows.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <Stat l="Gross salaries" v={money(sum('base_salary'))} /><Stat l="Leave cuts" v={`-${money(sum('leave_deduction'))}`} color={C.bad} />
        <Stat l="Bonuses" v={`+${money(sum('bonus_total'))}`} color={C.ok} /><Stat l="Net to pay" v={money(sum('net_pay'))} /></View>}
      {!data ? (error ? null : <Loading />) : (
        <>
          {rows.length === 0 && <Empty>No payslips for {monthName(`${month}-01`)} yet. {manage && data.can_generate ? 'Press "Prepare / refresh".' : ''}</Empty>}
          {rows.map((x) => (
            <Pressable key={x.id} onPress={() => setOpen(x)}><Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ fontWeight: '700', color: C.ink, flex: 1 }}>{x.employee?.full_name}</Text><Badge status={x.status} /></View>
              <Dim>Salary {money(x.base_salary)} · {x.unpaid_days} unpaid day(s) · cut {money(x.leave_deduction)}</Dim>
              <Dim>Bonus {money(x.bonus_total)} · Other cut {money(x.other_deduction_total)}</Dim>
              <Text style={{ fontWeight: '700', fontSize: 16, marginTop: 4, color: C.ink }}>Net {money(x.net_pay)}</Text>
            </Card></Pressable>
          ))}
          {data.missing.some((m) => !m.has_salary) && <Dim style={{ marginBottom: 12 }}>No salary set (add in Users): {data.missing.filter((m) => !m.has_salary).map((m) => m.full_name).join(', ')}</Dim>}
        </>
      )}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}><Text style={{ fontWeight: '700', color: C.ink, flex: 1 }}>Bonuses & extra deductions · {monthName(`${month}-01`)}</Text>{manage && emps && <Btn small kind="ghost" title="Add" onPress={() => setShowAdj(true)} />}</View>
        {adj?.length === 0 && <Dim>None.</Dim>}
        {adj?.map((a) => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderColor: C.line }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{a.employee?.full_name}</Text><Dim>{a.label}</Dim></View>
            <Text style={{ fontWeight: '700', color: a.kind === 'bonus' ? C.ok : C.bad }}>{a.kind === 'bonus' ? '+' : '-'}{money(a.amount)}</Text>
            {manage && !a.payslip_id && <Btn small kind="ghost" title="Remove" onPress={run(() => api.del(withQs(`/payroll/adjustments/${a.id}`, qs)), 'Removed')} />}
            {a.payslip_id && <Badge status="locked" />}
          </View>
        ))}
        <Dim style={{ marginTop: 8 }}>Adjustments go on the payslip of the month you pick. After a payslip is finalized, add late items to the next month.</Dim>
      </Card>
      {manage && <View style={{ alignSelf: 'flex-start', marginBottom: 12 }}><Btn small kind="ghost" title={`${showAudit ? 'Hide' : 'Show'} activity log`} onPress={() => setShowAudit(!showAudit)} /></View>}
      {showAudit && audit && <Card>{audit.map((a) => (
        <View key={a.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: C.line }}>
          <Text style={{ color: C.ink }}>{a.action.replace(/_/g, ' ')}{a.target ? ` · ${a.target.full_name}` : ''}</Text>
          <Dim>{a.actor?.full_name || 'system'} · {new Date(a.created_at).toLocaleString()}{a.detail?.period ? ` · ${a.detail.period.slice(0, 7)}` : ''}</Dim>
        </View>))}</Card>}

      {open && <Sheet title={`${open.employee?.full_name} · ${monthName(open.period)}`} onClose={() => setOpen(null)}>
        <Breakdown s={open} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 12 }}><Badge status={open.status} />{open.status === 'paid' && <Dim>Paid {fmt(open.payment_date)}{open.payment_method ? ` via ${open.payment_method}` : ''}{open.payment_reference ? ` · ${open.payment_reference}` : ''}</Dim>}</View>
        {manage && <View style={{ gap: 8 }}>
          {open.status === 'draft' && <Btn title="Finalize" disabled={busy} onPress={run(async () => { await post(`/payroll/payslips/${open.id}/finalize`); setOpen(null); }, 'Finalized')} />}
          {open.status === 'finalized' && <Btn title="Mark paid" onPress={() => setPay({ id: open.id })} />}
          {open.status === 'finalized' && <Btn kind="ghost" title="Reopen" onPress={run(async () => { await post(`/payroll/payslips/${open.id}/reopen`); setOpen(null); }, 'Reopened as draft')} />}
        </View>}
      </Sheet>}
      {pay && <Sheet title={pay.all ? 'Mark all finalized payslips paid' : 'Record payment'} onClose={() => setPay(null)}>
        <PayForm all={pay.all} busy={busy} onSubmit={run(async (b) => { await post(pay.all ? '/payroll/payslips/pay-all' : `/payroll/payslips/${pay.id}/pay`, pay.all ? { period: month, ...b } : b); setPay(null); setOpen(null); }, 'Marked as paid')} />
      </Sheet>}
      {showAdj && emps && <Sheet title="Bonus / extra deduction" onClose={() => setShowAdj(false)}>
        <AdjForm emps={emps} month={month} onDone={async (b) => { await api.post(withQs('/payroll/adjustments', qs), b); await all(); setShowAdj(false); }} />
      </Sheet>}
    </ScrollView>
  );
}
