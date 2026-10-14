import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { api, withQs } from '../api';
import { C, fmt, ymd } from '../theme';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Sheet, Choice, Field, Input, Check, DateField, useRun } from '../ui';
import { useApi } from '../useApi';
import { useSchoolId } from '../useSchool';

const tone = (n) => (n < 0 ? C.bad : C.ink);

function GrantForm({ types, emps, qs, onDone }) {
  const year = new Date().getFullYear();
  const [f, setF] = useState({ kind: 'allotment', leave_type_id: types[0]?.id || '', days: '', note: '', period_key: `${year}-${year + 1}`, all: true, user_ids: [], effective_date: '' });
  const { err, busy, run } = useRun();
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const allot = f.kind === 'allotment';
  const pick = (id) => setF((p) => ({ ...p, user_ids: p.user_ids.includes(id) ? p.user_ids.filter((x) => x !== id) : [...p.user_ids, id] }));
  const submit = run(async () => {
    const r = await api.post(withQs('/payroll/grants', qs), { ...f, all: allot && f.all, effective_date: f.effective_date || undefined });
    await onDone(); return r;
  }, (r) => `Done for ${r.done} employee(s)${r.skipped ? `, ${r.skipped} already had it` : ''}`);
  return (
    <View>
      <Field label="What are you doing?"><Choice value={f.kind} onChange={set('kind')} options={[{ value: 'allotment', label: 'Yearly allotment' }, { value: 'grant', label: 'Extra days' }, { value: 'adjustment', label: 'Adjustment' }]} /></Field>
      <Dim style={{ marginBottom: 12 }}>{allot ? 'Uses the quota of the leave type, once per period.' : f.kind === 'grant' ? 'Bonus leave days.' : 'Plus or minus days, to fix a balance.'}</Dim>
      <Field label="Leave type"><Choice value={f.leave_type_id} onChange={set('leave_type_id')} options={types.map((t) => ({ value: t.id, label: t.name + (allot ? ` (${t.annual_quota})` : '') }))} /></Field>
      {allot ? <Field label="Period" hint="Stops giving it twice"><Input value={f.period_key} onChangeText={set('period_key')} /></Field>
        : <Field label="Days" hint="e.g. 2, 0.5, -1"><Input keyboardType="numbers-and-punctuation" value={String(f.days)} onChangeText={set('days')} /></Field>}
      {!allot && <Field label="Note (visible to employee)"><Input value={f.note} onChangeText={set('note')} /></Field>}
      <Field label="Effective date" hint="Leave as today unless covering a month not yet finalized.">
        <DateField value={f.effective_date || ymd(new Date())} onChange={set('effective_date')} />
      </Field>
      {allot && <Check label="All employees" value={f.all} onChange={set('all')} />}
      {(!allot || !f.all) && emps.map((e) => <Check key={e.user_id} label={e.full_name} value={f.user_ids.includes(e.user_id)} onChange={() => pick(e.user_id)} />)}
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Save'} onPress={submit} disabled={busy || !f.leave_type_id} />
    </View>
  );
}

export default function Balances({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const { data, error, loading, reload } = useApi(sid ? withQs('/payroll/balances', qs) : null);
  const { data: st } = useApi(sid ? withQs('/payroll/settings', qs) : null);
  const [led, setLed] = useState(null); const [grant, setGrant] = useState(false);
  const { run } = useRun();
  const canGrant = me.features.includes('leave_grant');
  const types = st?.types.filter((t) => t.is_paid && t.is_active) || [];
  const openLedger = (e) => run(async () => setLed({ e, rows: await api.get(withQs(`/payroll/ledger/${e.user_id}`, qs)) }))();
  if (!sid) return <Empty>Create a school first.</Empty>;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}>
      {picker}
      {canGrant && st && data && <><Btn title="Grant / allot leave" onPress={() => setGrant(true)} /><View style={{ height: 12 }} /></>}
      <ErrorBox>{error}</ErrorBox>
      {!data || !st ? (error ? null : <Loading />) : data.length === 0 ? <Empty>No employees yet.</Empty> : data.map((e) => (
        <Card key={e.user_id}>
          <Text style={{ fontWeight: '700', color: C.ink }}>{e.full_name}</Text>
          <Dim>{e.designation || e.login_id}</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginVertical: 8 }}>
            {types.map((t) => { const b = e.balances.find((x) => x.type_id === t.id); return (
              <View key={t.id}><Dim>{t.name}</Dim><Text style={{ fontWeight: '700', fontSize: 18, color: tone(b?.balance || 0) }}>{b?.balance ?? 0}{b?.pending ? <Text style={{ color: C.mute, fontSize: 12, fontWeight: '400' }}> (+{b.pending} pending)</Text> : null}</Text></View>); })}
          </View>
          <View style={{ alignSelf: 'flex-start' }}><Btn small kind="ghost" title="History" onPress={() => openLedger(e)} /></View>
        </Card>
      ))}
      {led && <Sheet title={`Leave book · ${led.e.full_name}`} onClose={() => setLed(null)}><Card>
        {led.rows.length === 0 && <Empty>No entries.</Empty>}
        {led.rows.map((x) => <View key={x.id} style={{ flexDirection: 'row', paddingVertical: 8, borderTopWidth: 1, borderColor: C.line }}><View style={{ flex: 1 }}><Text>{x.note}</Text><Dim>{fmt(x.entry_date)} · {x.kind}</Dim></View><Text style={{ fontWeight: '700', color: x.days < 0 ? C.bad : C.ok }}>{x.days > 0 ? '+' : ''}{x.days}</Text></View>)}
      </Card></Sheet>}
      {grant && data && <Sheet title="Grant / allot leave" onClose={() => setGrant(false)}><GrantForm types={types} emps={data} qs={qs} onDone={async () => { await reload(); setGrant(false); }} /></Sheet>}
    </ScrollView>
  );
}
