// Fees module for mobile. PILOT of the design standard. Mirrors client/src/modules/FeesModule.jsx (same endpoints and rules).
// Anatomy: Pad > PageHeader > Tabs > Section > Row.  Every form = FormSheet.  Deletes = confirmAsk().  Status = StatusChip.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, BackHandler } from 'react-native';
import { api } from '../api';
import { C, T, fmt } from '../theme';
import { Icon } from '../icons';
import { Dim, Loading, ErrorBox, Btn, Choice, Input, Field, DateField, toast, confirmAsk } from '../ui';
import { FilterBar } from '../FilterBar';
import { useApi } from '../useApi';
import { downloadAndShare } from '../download';
import { scoped, qs, Pad, Notice, Row, PageHeader, Tabs, Section, KpiGrid, Kpi, StatusChip, EmptyState, FormSheet } from '../kit';

/* ---------------------------------------------------------------- helpers */
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const MODES = [['cash', 'Cash'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['bank_transfer', 'Bank transfer'], ['card', 'Card'], ['other', 'Other']];
const MODE_LABEL = Object.fromEntries(MODES);
const TERM_LABEL = { one_time: 'One time', half_yearly: 'Half yearly', quarterly: 'Quarterly', monthly: 'Monthly' };
const TERM_EVERY = { one_time: '', half_yearly: 'every 6 months', quarterly: 'every 3 months', monthly: 'every month' };
const num = (t) => t.replace(/[^0-9.]/g, '');
// 44px tap target icon button (web: Button kind="ghost" size="sm" icon=...)
const IconBtn = ({ name, label, color = C.mute, onPress }) => <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={4} style={{ width: T.ctl, height: T.ctl, alignItems: 'center', justifyContent: 'center' }}><Icon name={name} size={19} color={color} /></Pressable>;
const Failed = ({ error, onRetry }) => <><ErrorBox>{error}</ErrorBox><View style={{ alignSelf: 'flex-start' }}><Btn small kind="ghost" title="Retry" onPress={onRetry} /></View></>;
const Gap = () => <View style={{ height: T.sp[3] }} />;

function useDebounced(v, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

// asks for a reason (cancel a payment, remove an adjustment)
function ReasonSheet({ title, text, confirmLabel, onClose, onConfirm }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => { setBusy(true); setErr(''); try { await onConfirm(reason.trim()); onClose(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormSheet title={title} onClose={onClose} onSubmit={go} busy={busy} error={err} danger submitLabel={confirmLabel} submitDisabled={!reason.trim()}>
      <Notice tone="warn">{text}</Notice>
      <Field req label="Reason (kept in the history)"><Input maxLength={200} value={reason} onChangeText={setReason} /></Field>
    </FormSheet>
  );
}

/* ================================================================== FEE STRUCTURE */
function ItemSheet({ data, cls, item, onClose, onSaved }) {
  const [f, setF] = useState({ name: item?.name || '', amount: item ? String(item.amount) : '', frequency: item?.frequency || 'quarterly' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const fr = data.frequencies.find((x) => x.key === f.frequency);
  const amt = Number(f.amount); const each = amt > 0 && fr ? amt / fr.count : null;
  const save = async () => { setBusy(true); setErr(''); try { await onSaved(f); onClose(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormSheet title={item ? `Edit fee - Class ${cls.name}` : `Add fee - Class ${cls.name}`} onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel={item ? 'Save changes' : 'Add fee'} submitDisabled={!f.name.trim() || !(amt > 0)}>
      <Field req label="Fee name"><Input maxLength={80} value={f.name} onChangeText={(t) => setF({ ...f, name: t })} placeholder="e.g. Tuition, Transport, Lab, Admission" /></Field>
      <Field req label="Total for the session (₹)"><Input keyboardType="decimal-pad" value={f.amount} onChangeText={(t) => setF({ ...f, amount: num(t) })} placeholder="20000" /></Field>
      <Field label="Payment term"><Choice value={f.frequency} onChange={(v) => setF({ ...f, frequency: v })} options={data.frequencies.map((x) => ({ value: x.key, label: x.label }))} /></Field>
      {each !== null && <Notice tone="info">{fr.count === 1 ? `Paid in one go: ${rupees(amt)}, due on the session start date.` : `Paid in ${fr.count} instalments of about ${rupees(Math.round(each * 100) / 100)} (${TERM_EVERY[f.frequency]}), the first due on the session start date.`}</Notice>}
      {item && <Notice tone="mute">This changes the fee for every student of Class {cls.name} from now on. Payments already received are kept.</Notice>}
    </FormSheet>
  );
}

function CopySheet({ data, sc, onClose, onDone }) {
  const others = data.sessions.filter((s) => s.id !== data.session.id);
  const [from, setFrom] = useState(others[0]?.id || ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post('/fees/structure/copy', { from_session_id: from, to_session_id: data.session.id, ...sc }); toast(r.copied ? `${r.copied} fee${r.copied === 1 ? '' : 's'} copied` : 'Nothing new to copy'); onDone(); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormSheet title={`Copy fees into ${data.session.name}`} onClose={onClose} onSubmit={go} busy={busy} error={err} submitLabel="Copy fees" submitDisabled={!from}>
      <Notice tone="mute">Copies every class's fees from another session. Fees a class already has here are left alone, so it is safe to do twice.</Notice>
      <Field label="Copy from"><Choice value={from} onChange={setFrom} options={others.map((s) => ({ value: s.id, label: `${s.name}${s.is_current ? ' (current)' : ''}` }))} /></Field>
    </FormSheet>
  );
}

export const FeeStructure = scoped(function FeeStructure({ sc }) {
  const [sessionId, setSessionId] = useState(''); const [clsName, setClsName] = useState(''); const [modal, setModal] = useState(null);
  const { data, error: err, loading, reload } = useApi(`/fees/structure${qs({ ...sc, session_id: sessionId })}`);
  useEffect(() => { if (data && !data.classes.some((c) => c.name === clsName)) setClsName(data.classes[0]?.name || ''); }, [data]); // eslint-disable-line

  if (err && !data) return <Pad><Failed error={err} onRetry={reload} /></Pad>;
  if (!data) return <Pad><Loading /></Pad>;
  const cls = data.classes.find((c) => c.name === clsName);
  const body = (it) => ({ ...it, class_name: cls.name, session_id: data.session.id, ...sc });
  const del = (it) => confirmAsk(`Remove "${it.name}" from Class ${cls.name}? Every student of this class will no longer be charged for it.`, async () => {
    try { await api.del(`/fees/structure/items/${it.id}${qs(sc)}`); toast('Fee removed'); reload(); } catch (x) { toast(x.message, true); }
  });
  const withFees = data.classes.filter((c) => c.items.length).length;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <PageHeader title="Fees for session" sub={`${withFees} of ${data.classes.length} class${data.classes.length === 1 ? '' : 'es'} have fees set`} right={cls ? <Btn small title="Add fee" onPress={() => setModal({ type: 'item' })} /> : null} />
      <Choice value={data.session.id} onChange={setSessionId} options={data.sessions.map((s) => ({ value: s.id, label: `${s.name}${s.is_current ? ' (current)' : ''}` }))} />
      {data.sessions.length > 1 && <View style={{ alignSelf: 'flex-start', marginTop: T.sp[2] }}><Btn small kind="ghost" title="Copy from another session" onPress={() => setModal({ type: 'copy' })} /></View>}
      <Gap />
      {data.classes.length === 0 ? <Section><EmptyState icon="users" title="No classes yet">Add classes under Users &gt; Classes on the web app first.</EmptyState></Section> : (<>
        <Tabs value={clsName} onChange={setClsName} items={data.classes.map((c) => ({ key: c.name, label: `Class ${c.name}`, count: c.items.length }))} />
        {cls && (
          <Section title={`Class ${cls.name}`} flush>
            <Dim style={{ padding: T.sp[3], paddingBottom: 0 }}>{cls.sections.length ? `Sections ${cls.sections.join(', ')} · ` : ''}{cls.students} student{cls.students === 1 ? '' : 's'}. Same fees for every section.</Dim>
            {cls.items.length === 0
              ? <EmptyState icon="box" title={`No fees for Class ${cls.name} yet`} action={<Btn small title="Add fee" onPress={() => setModal({ type: 'item' })} />}>Add the first one, for example Tuition.</EmptyState>
              : (<>
                {cls.items.map((it) => (
                  <Row key={it.id}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }}>{it.name}</Text>
                      <Dim>{TERM_LABEL[it.frequency]}{it.count === 1 ? '' : ` · ${it.count} x ${rupees(it.first)}${!it.even ? ` (last ${rupees(it.last)})` : ''}`}</Dim>
                    </View>
                    <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.bold, color: C.ink }}>{rupees(it.amount)}</Text>
                    <IconBtn name="edit" label={`Edit ${it.name}`} onPress={() => setModal({ type: 'item', item: it })} />
                    <IconBtn name="trash" label={`Remove ${it.name}`} color={C.bad} onPress={() => del(it)} />
                  </Row>))}
                <Row last><Text style={{ flex: 1, fontSize: T.fs.md, fontWeight: T.fw.bold, color: C.ink }}>Total per student</Text><Text style={{ fontSize: T.fs.md, fontWeight: T.fw.bold, color: C.ink }}>{rupees(cls.total)}</Text></Row>
              </>)}
          </Section>)}
        <Gap />
        <Notice tone="mute">Instalments start on the session start date ({fmt(data.session.start_date)}). Changes apply to every student of this class from now on; payments already received are kept.</Notice>
      </>)}
      {modal?.type === 'item' && cls && <ItemSheet data={data} cls={cls} item={modal.item} onClose={() => setModal(null)}
        onSaved={async (f) => { if (modal.item) await api.patch(`/fees/structure/items/${modal.item.id}`, body(f)); else await api.post('/fees/structure/items', body(f)); toast(modal.item ? 'Fee updated' : 'Fee added'); reload(); }} />}
      {modal?.type === 'copy' && <CopySheet data={data} sc={sc} onClose={() => setModal(null)} onDone={reload} />}
    </Pad>
  );
});

/* ================================================================== ONE STUDENT'S FEES */
// ledger line -> [label, tone]
const lineBadge = (l) => {
  if (l.status === 'paid') return ['Paid', 'ok'];
  if (l.status === 'partial') return [l.overdue ? 'Part paid · overdue' : 'Part paid', l.overdue ? 'bad' : 'warn'];
  if (l.status === 'due') return l.overdue ? ['Overdue', 'bad'] : ['Due today', 'warn'];
  return ['Upcoming', 'mute'];
};

function PaySheet({ d, sc, onClose, onPaid }) {
  const t = d.ledger.totals;
  const [f, setF] = useState({ amount: t.due_till_date > 0 ? String(t.due_till_date) : String(t.pending), mode: 'cash', reference: '', note: '', paid_on: d.today });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const amt = Number(f.amount); const over = amt > t.pending + 0.001; const bad = !(amt > 0) || over;
  const save = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/fees/students/${d.student.student_id}/payments`, { ...f, session_id: d.session.id, ...sc }); onPaid(r); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormSheet title={`Record payment - ${d.student.full_name}`} onClose={onClose} onSubmit={save} busy={busy} error={err || (over ? 'That is more than the pending balance.' : '')} submitLabel={`Record ${amt > 0 ? rupees(amt) : 'payment'}`} submitDisabled={bad}>
      <Notice tone="info">Pending {rupees(t.pending)}{t.due_till_date > 0 ? ` · due till date ${rupees(t.due_till_date)}` : ''}. The money goes to the oldest unpaid fees first.</Notice>
      <Field req label="Amount received (₹)"><Input keyboardType="decimal-pad" value={f.amount} onChangeText={(x) => setF({ ...f, amount: num(x) })} style={[{ fontSize: T.fs.xl, fontWeight: T.fw.bold }, bad && f.amount !== '' && { borderColor: C.bad, backgroundColor: C.badBg }]} /></Field>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.sp[2], marginBottom: T.sp[3] }}>
        {t.due_till_date > 0 && <Btn small kind="ghost" title={`Due till date ${rupees(t.due_till_date)}`} onPress={() => setF({ ...f, amount: String(t.due_till_date) })} />}
        <Btn small kind="ghost" title={`Everything pending ${rupees(t.pending)}`} onPress={() => setF({ ...f, amount: String(t.pending) })} />
      </View>
      <Field label="Paid by"><Choice value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={MODES.map(([value, label]) => ({ value, label }))} /></Field>
      <Field req label="Payment date"><DateField value={f.paid_on} max={d.today} onChange={(v) => setF({ ...f, paid_on: v })} /></Field>
      <Field label="Reference / cheque no. (optional)"><Input maxLength={100} value={f.reference} onChangeText={(x) => setF({ ...f, reference: x })} placeholder="UPI transaction id, cheque number..." /></Field>
      <Field label="Note (optional)"><Input maxLength={300} value={f.note} onChangeText={(x) => setF({ ...f, note: x })} /></Field>
    </FormSheet>
  );
}

function AdjustSheet({ d, sc, onClose, onDone }) {
  const [f, setF] = useState({ type: 'discount', item_id: '', amount: '', reason: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setErr(''); try { await api.post(`/fees/students/${d.student.student_id}/adjustments`, { ...f, session_id: d.session.id, ...sc }); onDone(); onClose(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormSheet title={`Adjust fees - ${d.student.full_name}`} onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel={f.type === 'discount' ? 'Apply discount' : 'Add charge'} submitDisabled={!f.reason.trim() || !(Number(f.amount) > 0)}>
      <Notice tone="mute">Only for this student. The class's fee structure is not changed, and every adjustment stays in the history.</Notice>
      <Choice value={f.type} onChange={(v) => setF({ ...f, type: v })} options={[{ value: 'discount', label: 'Discount / concession' }, { value: 'charge', label: 'Extra charge' }]} /><Gap />
      <Field label="Applies to" hint={f.item_id ? 'Spread over that fee’s instalments.' : f.type === 'discount' ? 'Taken off the oldest unpaid fees first.' : 'Due immediately.'}>
        <Choice value={f.item_id} onChange={(v) => setF({ ...f, item_id: v })} options={[{ value: '', label: 'General (whole account)' }, ...d.items.map((i) => ({ value: i.id, label: i.name }))]} /></Field>
      <Field req label="Amount (₹)"><Input keyboardType="decimal-pad" value={f.amount} onChangeText={(x) => setF({ ...f, amount: num(x) })} /></Field>
      <Field req label="Reason (kept in the history)"><Input maxLength={200} value={f.reason} onChangeText={(x) => setF({ ...f, reason: x })} placeholder={f.type === 'discount' ? 'e.g. Sibling concession, scholarship' : 'e.g. Late fine, lost ID card'} /></Field>
    </FormSheet>
  );
}

function Account({ me, sc, studentId, family, active, onBack }) {
  const [sessionId, setSessionId] = useState(''); const [modal, setModal] = useState(null); const [last, setLast] = useState(null);
  const url = family ? `/fees/my/${studentId}` : `/fees/students/${studentId}`;
  const { data: d, error: err, loading, reload } = useApi(`${url}${qs({ ...(family ? {} : sc), session_id: sessionId })}`);
  useEffect(() => {
    if (!active || !onBack) return undefined;
    const h = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => h.remove();
  }, [active, onBack]);

  const has = (f) => me.features.includes(f);
  const receipt = async (p) => { try { await downloadAndShare(`/fees/payments/${p.id}/receipt${family ? '' : qs(sc)}`, `${p.receipt_no}.pdf`); } catch (x) { toast(x.message, true); } };
  const scopeBody = family ? {} : sc;
  const back = onBack ? <Btn small kind="ghost" title="‹ Back" onPress={onBack} /> : null;

  if (err && !d) return <Pad><PageHeader title="Fees" lead={back} /><Failed error={err} onRetry={reload} /></Pad>;
  if (!d) return <Pad><PageHeader title="Fees" lead={back} /><Loading /></Pad>;
  const t = d.ledger.totals; const s = d.student;
  const other = d.sessions.filter((x) => x.id !== d.session.id && x.pending > 0);
  const canPay = !family && has('collect_fees') && t.pending > 0;
  const canAdjust = !family && has('adjust_fees');
  const canCancel = !family && has('cancel_fee_payment');
  const live = d.payments.filter((p) => p.status === 'received');
  const hint = t.pending === 0 ? (d.ledger.lines.length ? 'All fees are paid.' : '') : t.due_till_date === 0 && t.next_due_date ? `Nothing is due yet. Next: ${rupees(t.next_due_amount)} on ${fmt(t.next_due_date)}.` : t.next_due_date ? `Next after this: ${rupees(t.next_due_amount)} on ${fmt(t.next_due_date)}.` : '';
  const extra = `${t.adjustments !== 0 ? ` Includes adjustments of ${t.adjustments > 0 ? '+' : '-'}${rupees(Math.abs(t.adjustments))} on the ${rupees(t.structure)} class fees.` : ''}${t.excess > 0 ? ` ${rupees(t.excess)} was paid in excess of the current fees.` : ''}`;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <PageHeader lead={back} title={s.full_name} sub={`${s.class_label ? `Class ${s.class_label}` : 'No class assigned'}${s.roll_no ? ` · Roll ${s.roll_no}` : ''}${s.admission_no ? ` · Adm. ${s.admission_no}` : ''}`} />
      {d.sessions.length > 1
        ? <View style={{ marginBottom: T.sp[3] }}><Choice value={d.session.id} onChange={setSessionId} options={d.sessions.map((x) => ({ value: x.id, label: `${x.name}${x.is_current ? ' (current)' : ''}${x.pending > 0 ? ` - ${rupees(x.pending)} pending` : ''}` }))} /></View>
        : <View style={{ alignSelf: 'flex-start', marginBottom: T.sp[3] }}><StatusChip tone="mute">{d.session.name}</StatusChip></View>}
      {(canPay || canAdjust) && <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: T.sp[2], marginBottom: T.sp[3] }}>
        {canAdjust && <Btn small kind="ghost" title="Adjust fees" onPress={() => setModal('adjust')} />}
        {canPay && <Btn small title="Record payment" onPress={() => setModal('pay')} />}
      </View>}

      {other.length > 0 && <Notice tone="warn">Unpaid fees from {other.map((o) => `${o.name}: ${rupees(o.pending)}`).join(', ')}. Use the session picker above to open {other.length === 1 ? 'it' : 'them'}.</Notice>}
      {last && <Notice tone="ok">Payment of {rupees(last.amount)} recorded. Receipt {last.receipt_no}. <Text style={{ fontWeight: T.fw.bold, textDecorationLine: 'underline' }} onPress={() => receipt(last)}>Download receipt</Text></Notice>}
      {!d.has_structure && <Notice tone="warn">{s.class_name ? `No fees are set for Class ${s.class_name} in ${d.session.name} yet.` : 'This student has no class, so no fees apply.'}{has('manage_fee_structure') ? ' Add them under Fees > Fee structure.' : ''}</Notice>}

      <KpiGrid>
        <Kpi icon="wallet" label="Total fees" value={rupees(t.total)} />
        <Kpi icon="check" label="Paid" value={rupees(t.paid)} tone="ok" />
        <Kpi icon="doc" label="Total pending" value={rupees(t.pending)} />
        <Kpi icon="calendar" label="Due till today" value={rupees(t.due_till_date)} tone={t.due_till_date > 0 ? 'warn' : 'ok'} />
      </KpiGrid>
      {(hint || extra) ? <Notice tone="mute">{`${hint}${extra}`.trim()}</Notice> : null}

      {d.ledger.lines.length > 0 && <Section title="Fees" flush>{d.ledger.lines.map((l, i) => { const [label, tone] = lineBadge(l); return (
        <Row key={i} last={i === d.ledger.lines.length - 1}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }}>{l.label}</Text>
            <Dim>Due {fmt(l.due_date)}{l.discount > 0 ? ` · after ${rupees(l.discount)} discount` : ''}</Dim>
            <Dim>{rupees(l.amount)} · paid {rupees(l.paid)}</Dim>
          </View>
          <View style={{ alignItems: 'flex-end', gap: T.sp[1] }}><Text style={{ fontSize: T.fs.md, fontWeight: T.fw.bold, color: l.pending > 0 ? C.ink : C.mute }}>{rupees(l.pending)}</Text><StatusChip tone={tone}>{label}</StatusChip></View>
        </Row>); })}</Section>}

      <Section title="Previous payments" flush right={live.length > 1 ? <Dim>{live.length} payments · {rupees(t.paid)}</Dim> : null}>
        {d.payments.length === 0
          ? <EmptyState icon="box" title="No payments yet">No payment has been recorded in {d.session.name}.</EmptyState>
          : d.payments.map((p, i) => (
            <Row key={p.id} last={i === d.payments.length - 1}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.bold, color: C.ink, textDecorationLine: p.status === 'cancelled' ? 'line-through' : 'none' }}>{rupees(p.amount)}</Text>
                <Dim>{fmt(p.paid_on)} · {MODE_LABEL[p.mode] || p.mode}{p.reference ? ` (${p.reference})` : ''}</Dim>
                <Dim>{p.receipt_no}{p.received_by ? ` · received by ${p.received_by}` : ''}{p.note ? ` · ${p.note}` : ''}</Dim>
                {p.status === 'cancelled' && <Text style={{ color: C.bad, fontSize: T.fs.xs }}>Cancelled{p.cancel_reason ? `: ${p.cancel_reason}` : ''}{p.cancelled_by ? ` (${p.cancelled_by})` : ''}</Text>}
              </View>
              {p.status === 'cancelled' && <StatusChip tone="bad">Cancelled</StatusChip>}
              <IconBtn name="download" label={`Download receipt ${p.receipt_no}`} color={C.brand} onPress={() => receipt(p)} />
              {canCancel && p.status === 'received' && <IconBtn name="x" label="Cancel payment" color={C.bad} onPress={() => setModal({ cancel: p })} />}
            </Row>))}
      </Section>

      {d.adjustments.length > 0 && <Section title="Adjustments" flush>{d.adjustments.map((a, i) => (
        <Row key={a.id} last={i === d.adjustments.length - 1}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.bold, color: a.voided ? C.mute : a.amount < 0 ? C.ok : C.bad, textDecorationLine: a.voided ? 'line-through' : 'none' }}>{a.amount < 0 ? '-' : '+'}{rupees(Math.abs(a.amount))}</Text>
            <Dim>{a.item_name || 'General'} · {a.reason}</Dim>
            <Dim>{fmt(a.applied_on)}{a.created_by ? ` · by ${a.created_by}` : ''}</Dim>
            {a.voided && <Text style={{ color: C.bad, fontSize: T.fs.xs }}>Removed{a.void_reason ? `: ${a.void_reason}` : ''}{a.voided_by ? ` (${a.voided_by})` : ''}</Text>}
          </View>
          {a.voided && <StatusChip tone="mute">Removed</StatusChip>}
          {canAdjust && !a.voided && <Btn small kind="ghost" title="Remove" onPress={() => setModal({ void: a })} />}
        </Row>))}</Section>}

      {modal === 'pay' && <PaySheet d={d} sc={sc} onClose={() => setModal(null)} onPaid={(r) => { setLast(r.payment); toast('Payment recorded'); reload(); }} />}
      {modal === 'adjust' && <AdjustSheet d={d} sc={sc} onClose={() => setModal(null)} onDone={() => { toast('Fees adjusted'); reload(); }} />}
      {modal?.cancel && <ReasonSheet title={`Cancel payment ${modal.cancel.receipt_no}`} confirmLabel="Cancel this payment" onClose={() => setModal(null)}
        text={`This marks the ${rupees(modal.cancel.amount)} payment as cancelled and puts the amount back as pending. The receipt stays in the history, marked cancelled.`}
        onConfirm={async (reason) => { await api.post(`/fees/payments/${modal.cancel.id}/cancel`, { reason, ...scopeBody }); setLast(null); toast('Payment cancelled'); reload(); }} />}
      {modal?.void && <ReasonSheet title="Remove adjustment" confirmLabel="Remove adjustment" onClose={() => setModal(null)}
        text={`${modal.void.amount < 0 ? 'The discount' : 'The extra charge'} of ${rupees(Math.abs(modal.void.amount))} (${modal.void.reason}) will stop applying. It stays in the history.`}
        onConfirm={async (reason) => { await api.post(`/fees/adjustments/${modal.void.id}/void`, { reason, ...scopeBody }); toast('Adjustment removed'); reload(); }} />}
    </Pad>
  );
}

/* ================================================================== STUDENT FEES (staff) */
export const StudentFees = scoped(function StudentFees({ me, sc, active }) {
  const [picked, setPicked] = useState(null);
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [classId, setClassId] = useState('');
  const { data: classes = [] } = useApi(`/fees/classes${qs(sc)}`);
  const { data: list, error: err, reload } = useApi(picked ? null : `/fees/students${qs({ ...sc, q: dq, class_id: classId })}`);
  const close = useCallback(() => setPicked(null), []);

  if (picked) return <Account me={me} sc={sc} studentId={picked.student_id} active={active} onBack={close} />;
  return (
    <Pad>
      <PageHeader title="Student fees" sub="Open a student to record a payment or adjust fees" />
      <FilterBar inline q={q} onQ={setQ} placeholder="Search by name, ID, admission or roll no." count={list?.length}
        filters={[{ key: 'cls', label: 'Class', value: classId, onChange: setClassId, all: 'All classes', options: classes.map((c) => ({ value: c.id, label: `${c.name}${c.section ? ` ${c.section}` : ''}` })) }]} />
      {err && <Failed error={err} onRetry={reload} />}
      {!list ? (err ? null : <Loading />) : (
        <Section flush>
          {list.length === 0
            ? <EmptyState icon="users" title="No student found">Try a different name or class.</EmptyState>
            : <>
              {list.map((s, i) => (
                <Row key={s.student_id} last={i === list.length - 1 && list.length !== 50} onPress={() => setPicked(s)}>
                  <StatusChip tone="mute">{String(s.roll_no ?? '-')}</StatusChip>
                  <View style={{ flex: 1 }}><Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }}>{s.full_name}</Text><Dim>Class {s.class_label}{s.admission_no ? ` · Adm. ${s.admission_no}` : ''} · {s.login_id}</Dim></View>
                  <Icon name="chevron" size={18} color={C.mute} />
                </Row>))}
              {list.length === 50 && <Dim style={{ padding: T.sp[3], textAlign: 'center' }}>Showing the first 50. Type more of the name to narrow it down.</Dim>}
            </>}
        </Section>)}
    </Pad>
  );
});

/* ================================================================== MY FEES (parent / student, read only) */
export function MyFees({ me, active }) {
  const { data: kids, error: err, loading, reload } = useApi('/fees/my'); const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  const single = kids?.length === 1;
  useEffect(() => { if (single) setOpen(kids[0].student_id); }, [single]); // eslint-disable-line

  if (err && !kids) return <Pad><Failed error={err} onRetry={reload} /></Pad>;
  if (!kids) return <Pad><Loading /></Pad>;
  if (kids.length === 0) return <Pad><Section><EmptyState icon="users" title="No student linked">No student is linked to your account yet. Ask the school office.</EmptyState></Section></Pad>;
  if (open) return <Account me={me} family sc={{}} studentId={open} active={active} onBack={single ? null : close} />;
  const kidStatus = (k) => (!k.summary ? null : k.summary.due_till_date > 0 ? <StatusChip tone="bad">{`${rupees(k.summary.due_till_date)} due`}</StatusChip> : k.summary.pending > 0 ? <StatusChip tone="mute">Nothing due yet</StatusChip> : <StatusChip tone="ok">All paid</StatusChip>);
  return (
    <Pad reload={reload} loading={loading} hasData>
      <PageHeader title="My children" sub="Open a child to see fees and payments" />
      <Section flush>{kids.map((k, i) => (
        <Row key={k.student_id} last={i === kids.length - 1} onPress={() => setOpen(k.student_id)}>
          <View style={{ flex: 1 }}><Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }}>{k.full_name}</Text><Dim>{k.class_label ? `Class ${k.class_label}` : 'No class'}</Dim></View>
          {kidStatus(k)}<Icon name="chevron" size={18} color={C.mute} />
        </Row>))}</Section>
    </Pad>
  );
}
