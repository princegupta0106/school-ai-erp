// Fees module for mobile. Mirrors client/src/modules/FeesModule.jsx (same endpoints and rules).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, BackHandler } from 'react-native';
import { api } from '../api';
import { C, fmt, ymd } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Sheet, Choice, Input, Field, DateField, Press, toast, confirmAsk } from '../ui';
import { useApi } from '../useApi';
import { downloadAndShare } from '../download';
import { scoped, qs, Pad, Notice, Tile, Tiles, Row, List, Roll } from './Attendance';

/* ---------------------------------------------------------------- helpers */
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const MODES = [['cash', 'Cash'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['bank_transfer', 'Bank transfer'], ['card', 'Card'], ['other', 'Other']];
const MODE_LABEL = Object.fromEntries(MODES);
const TERM_LABEL = { one_time: 'One time', half_yearly: 'Half yearly', quarterly: 'Quarterly', monthly: 'Monthly' };
const TERM_EVERY = { one_time: '', half_yearly: 'every 6 months', quarterly: 'every 3 months', monthly: 'every month' };
const Gap = ({ h = 12 }) => <View style={{ height: h }} />;
const num = (t) => t.replace(/[^0-9.]/g, '');
const Chip = ({ children, color = C.mute, bg = C.card2 }) => <Text style={{ fontSize: 11, fontWeight: '700', color, backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{children}</Text>;
const IconBtn = ({ name, color = C.mute, onPress }) => <Pressable onPress={onPress} hitSlop={8} style={{ padding: 6 }}><Icon name={name} size={19} color={color} /></Pressable>;

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
    <Sheet title={title} onClose={onClose}>
      <Dim style={{ marginBottom: 12 }}>{text}</Dim>
      <Field label="Reason (kept in the history)"><Input maxLength={200} value={reason} onChangeText={setReason} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn kind="danger" title={busy ? 'Please wait...' : confirmLabel} onPress={go} disabled={busy || !reason.trim()} />
    </Sheet>
  );
}

/* ================================================================== FEE STRUCTURE */
function ItemForm({ data, cls, item, onClose, onSaved }) {
  const [f, setF] = useState({ name: item?.name || '', amount: item ? String(item.amount) : '', frequency: item?.frequency || 'quarterly' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const fr = data.frequencies.find((x) => x.key === f.frequency);
  const amt = Number(f.amount); const each = amt > 0 && fr ? amt / fr.count : null;
  const save = async () => { setBusy(true); setErr(''); try { await onSaved(f); onClose(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <Sheet title={item ? `Edit fee - Class ${cls.name}` : `Add fee - Class ${cls.name}`} onClose={onClose}>
      <Field label="Fee name"><Input maxLength={80} value={f.name} onChangeText={(t) => setF({ ...f, name: t })} placeholder="e.g. Tuition, Transport, Lab, Admission" /></Field>
      <Field label="Total for the session (₹)"><Input keyboardType="decimal-pad" value={f.amount} onChangeText={(t) => setF({ ...f, amount: num(t) })} placeholder="20000" /></Field>
      <Field label="Payment term"><Choice value={f.frequency} onChange={(v) => setF({ ...f, frequency: v })} options={data.frequencies.map((x) => ({ value: x.key, label: x.label }))} /></Field>
      {each !== null && <Notice>{fr.count === 1 ? `Paid in one go: ${rupees(amt)}, due on the session start date.` : `Paid in ${fr.count} instalments of about ${rupees(Math.round(each * 100) / 100)} (${TERM_EVERY[f.frequency]}), the first due on the session start date.`}</Notice>}
      {item && <Dim style={{ marginBottom: 12 }}>This changes the fee for every student of Class {cls.name} from now on. Payments already received are kept.</Dim>}
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : item ? 'Save changes' : 'Add fee'} onPress={save} disabled={busy || !f.name.trim() || !(amt > 0)} />
    </Sheet>
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
    <Sheet title={`Copy fees into ${data.session.name}`} onClose={onClose}>
      <Dim style={{ marginBottom: 12 }}>Copies every class's fees from another session. Fees a class already has here are left alone, so it is safe to do twice.</Dim>
      <Field label="Copy from"><Choice value={from} onChange={setFrom} options={others.map((s) => ({ value: s.id, label: `${s.name}${s.is_current ? ' (current)' : ''}` }))} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Copying...' : 'Copy fees'} onPress={go} disabled={busy || !from} />
    </Sheet>
  );
}

export const FeeStructure = scoped(function FeeStructure({ sc }) {
  const [sessionId, setSessionId] = useState(''); const [clsName, setClsName] = useState(''); const [modal, setModal] = useState(null);
  const { data, error: err, loading, reload } = useApi(`/fees/structure${qs({ ...sc, session_id: sessionId })}`);
  useEffect(() => { if (data && !data.classes.some((c) => c.name === clsName)) setClsName(data.classes[0]?.name || ''); }, [data]); // eslint-disable-line

  if (err && !data) return <Pad><ErrorBox>{err}</ErrorBox></Pad>;
  if (!data) return <Pad><Loading /></Pad>;
  const cls = data.classes.find((c) => c.name === clsName);
  const body = (it) => ({ ...it, class_name: cls.name, session_id: data.session.id, ...sc });
  const del = (it) => confirmAsk(`Remove "${it.name}" from Class ${cls.name}? Every student of this class will no longer be charged for it.`, async () => {
    try { await api.del(`/fees/structure/items/${it.id}${qs(sc)}`); toast('Fee removed'); reload(); } catch (x) { toast(x.message, true); }
  });
  const withFees = data.classes.filter((c) => c.items.length).length;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>Fees for session</Text>
        <Dim style={{ marginBottom: 10 }}>{withFees} of {data.classes.length} class{data.classes.length === 1 ? '' : 'es'} have fees set</Dim>
        <Choice value={data.session.id} onChange={setSessionId} options={data.sessions.map((s) => ({ value: s.id, label: `${s.name}${s.is_current ? ' (current)' : ''}` }))} />
        {data.sessions.length > 1 && <><Gap h={10} /><View style={{ alignSelf: 'flex-start' }}><Btn small kind="ghost" title="Copy from another session" onPress={() => setModal({ type: 'copy' })} /></View></>}
      </Card>
      {data.classes.length === 0 ? <Empty>No classes yet. Add classes under Users &gt; Classes on the web app first.</Empty> : (<>
        <View style={{ marginBottom: 12 }}><Choice value={clsName} onChange={setClsName} options={data.classes.map((c) => ({ value: c.name, label: `Class ${c.name}${c.items.length === 0 ? ' •' : ''}` }))} /></View>
        {cls && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>Class {cls.name}</Text>
                <Dim>{cls.sections.length ? `Sections ${cls.sections.join(', ')} · ` : ''}{cls.students} student{cls.students === 1 ? '' : 's'}. Same fees for every section.</Dim>
              </View>
              <Btn small title="+ Add fee" onPress={() => setModal({ type: 'item' })} />
            </View>
            {cls.items.length === 0 ? <Empty>No fees for Class {cls.name} yet. Add the first one, for example Tuition.</Empty> : (<>
              {cls.items.map((it) => (
                <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderColor: C.line, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: C.ink }}>{it.name}</Text>
                    <Dim>{TERM_LABEL[it.frequency]}{it.count === 1 ? '' : ` · ${it.count} x ${rupees(it.first)}${!it.even ? ` (last ${rupees(it.last)})` : ''}`}</Dim>
                  </View>
                  <Text style={{ fontWeight: '800', color: C.ink }}>{rupees(it.amount)}</Text>
                  <IconBtn name="edit" onPress={() => setModal({ type: 'item', item: it })} /><IconBtn name="trash" color={C.bad} onPress={() => del(it)} />
                </View>))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderColor: C.line }}><Text style={{ fontWeight: '800', color: C.ink }}>Total per student</Text><Text style={{ fontWeight: '800', color: C.accent }}>{rupees(cls.total)}</Text></View>
            </>)}
            <Dim style={{ marginTop: 10 }}>Instalments start on the session start date ({fmt(data.session.start_date)}). Changes apply to every student of this class from now on; payments already received are kept.</Dim>
          </Card>)}
      </>)}
      {modal?.type === 'item' && cls && <ItemForm data={data} cls={cls} item={modal.item} onClose={() => setModal(null)}
        onSaved={async (f) => { if (modal.item) await api.patch(`/fees/structure/items/${modal.item.id}`, body(f)); else await api.post('/fees/structure/items', body(f)); toast(modal.item ? 'Fee updated' : 'Fee added'); reload(); }} />}
      {modal?.type === 'copy' && <CopySheet data={data} sc={sc} onClose={() => setModal(null)} onDone={reload} />}
    </Pad>
  );
});

/* ================================================================== ONE STUDENT'S FEES */
const lineChip = (l) => {
  if (l.status === 'paid') return ['Paid', C.ok, C.okBg];
  if (l.status === 'partial') return l.overdue ? ['Part paid · overdue', C.bad, C.badBg] : ['Part paid', C.warn, C.warnBg];
  if (l.status === 'due') return l.overdue ? ['Overdue', C.bad, C.badBg] : ['Due today', C.warn, C.warnBg];
  return ['Upcoming', C.mute, C.card2];
};

function PayForm({ d, sc, onClose, onPaid }) {
  const t = d.ledger.totals;
  const [f, setF] = useState({ amount: t.due_till_date > 0 ? String(t.due_till_date) : String(t.pending), mode: 'cash', reference: '', note: '', paid_on: d.today });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const amt = Number(f.amount); const over = amt > t.pending + 0.001; const bad = !(amt > 0) || over;
  const save = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/fees/students/${d.student.student_id}/payments`, { ...f, session_id: d.session.id, ...sc }); onPaid(r); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Sheet title={`Record payment - ${d.student.full_name}`} onClose={onClose}>
      <Notice>Pending {rupees(t.pending)}{t.due_till_date > 0 ? ` · due till date ${rupees(t.due_till_date)}` : ''}. The money goes to the oldest unpaid fees first.</Notice>
      <Field label="Amount received (₹)"><Input keyboardType="decimal-pad" value={f.amount} onChangeText={(x) => setF({ ...f, amount: num(x) })} style={[{ fontSize: 20, fontWeight: '700' }, bad && f.amount !== '' && { borderColor: C.bad, backgroundColor: C.badBg }]} /></Field>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {t.due_till_date > 0 && <Btn small kind="ghost" title={`Due till date ${rupees(t.due_till_date)}`} onPress={() => setF({ ...f, amount: String(t.due_till_date) })} />}
        <Btn small kind="ghost" title={`Everything pending ${rupees(t.pending)}`} onPress={() => setF({ ...f, amount: String(t.pending) })} />
      </View>
      {over && <ErrorBox>That is more than the pending balance.</ErrorBox>}
      <Field label="Paid by"><Choice value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={MODES.map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="Payment date"><DateField value={f.paid_on} max={d.today} onChange={(v) => setF({ ...f, paid_on: v })} /></Field>
      <Field label="Reference / cheque no. (optional)"><Input maxLength={100} value={f.reference} onChangeText={(x) => setF({ ...f, reference: x })} placeholder="UPI transaction id, cheque number..." /></Field>
      <Field label="Note (optional)"><Input maxLength={300} value={f.note} onChangeText={(x) => setF({ ...f, note: x })} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : `Record ${amt > 0 ? rupees(amt) : 'payment'}`} onPress={save} disabled={busy || bad} />
    </Sheet>
  );
}

function AdjustForm({ d, sc, onClose, onDone }) {
  const [f, setF] = useState({ type: 'discount', item_id: '', amount: '', reason: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setErr(''); try { await api.post(`/fees/students/${d.student.student_id}/adjustments`, { ...f, session_id: d.session.id, ...sc }); onDone(); onClose(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <Sheet title={`Adjust fees - ${d.student.full_name}`} onClose={onClose}>
      <Dim style={{ marginBottom: 12 }}>Only for this student. The class's fee structure is not changed, and every adjustment stays in the history.</Dim>
      <Choice value={f.type} onChange={(v) => setF({ ...f, type: v })} options={[{ value: 'discount', label: 'Discount / concession' }, { value: 'charge', label: 'Extra charge' }]} /><Gap />
      <Field label="Applies to" hint={f.item_id ? 'Spread over that fee’s instalments.' : f.type === 'discount' ? 'Taken off the oldest unpaid fees first.' : 'Due immediately.'}>
        <Choice value={f.item_id} onChange={(v) => setF({ ...f, item_id: v })} options={[{ value: '', label: 'General (whole account)' }, ...d.items.map((i) => ({ value: i.id, label: i.name }))]} /></Field>
      <Field label="Amount (₹)"><Input keyboardType="decimal-pad" value={f.amount} onChangeText={(x) => setF({ ...f, amount: num(x) })} /></Field>
      <Field label="Reason (kept in the history)"><Input maxLength={200} value={f.reason} onChangeText={(x) => setF({ ...f, reason: x })} placeholder={f.type === 'discount' ? 'e.g. Sibling concession, scholarship' : 'e.g. Late fine, lost ID card'} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : f.type === 'discount' ? 'Apply discount' : 'Add charge'} onPress={save} disabled={busy || !f.reason.trim() || !(Number(f.amount) > 0)} />
    </Sheet>
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

  const back = onBack ? <View style={{ alignSelf: 'flex-start', marginBottom: 12 }}><Btn small kind="ghost" title="‹ Back" onPress={onBack} /></View> : null;
  if (err && !d) return <Pad>{back}<ErrorBox>{err}</ErrorBox></Pad>;
  if (!d) return <Pad>{back}<Loading /></Pad>;
  const t = d.ledger.totals; const s = d.student;
  const other = d.sessions.filter((x) => x.id !== d.session.id && x.pending > 0);
  const canPay = !family && has('collect_fees') && t.pending > 0;
  const canAdjust = !family && has('adjust_fees');
  const canCancel = !family && has('cancel_fee_payment');
  const live = d.payments.filter((p) => p.status === 'received');
  const hint = t.pending === 0 ? (d.ledger.lines.length ? 'All fees are paid.' : '') : t.due_till_date === 0 && t.next_due_date ? `Nothing is due yet. Next: ${rupees(t.next_due_amount)} on ${fmt(t.next_due_date)}.` : t.next_due_date ? `Next after this: ${rupees(t.next_due_amount)} on ${fmt(t.next_due_date)}.` : '';
  return (
    <Pad reload={reload} loading={loading} hasData>
      {back}
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{s.full_name}</Text>
        <Dim style={{ marginBottom: 10 }}>{s.class_label ? `Class ${s.class_label}` : 'No class assigned'}{s.roll_no ? ` · Roll ${s.roll_no}` : ''}{s.admission_no ? ` · Adm. ${s.admission_no}` : ''}</Dim>
        {d.sessions.length > 1 ? <Choice value={d.session.id} onChange={setSessionId} options={d.sessions.map((x) => ({ value: x.id, label: `${x.name}${x.is_current ? ' (current)' : ''}${x.pending > 0 ? ` - ${rupees(x.pending)} pending` : ''}` }))} /> : <View style={{ alignSelf: 'flex-start' }}><Chip>{d.session.name}</Chip></View>}
      </Card>

      {other.length > 0 && <Notice tone="warn">Unpaid fees from {other.map((o) => `${o.name}: ${rupees(o.pending)}`).join(', ')}. Use the session picker above to open {other.length === 1 ? 'it' : 'them'}.</Notice>}
      {last && <Notice tone="ok">Payment of {rupees(last.amount)} recorded. Receipt {last.receipt_no}. <Text style={{ fontWeight: '700', textDecorationLine: 'underline' }} onPress={() => receipt(last)}>Download receipt</Text></Notice>}
      {!d.has_structure && <Notice tone="warn">{s.class_name ? `No fees are set for Class ${s.class_name} in ${d.session.name} yet.` : 'This student has no class, so no fees apply.'}{has('manage_fee_structure') ? ' Add them under Fees > Fee structure.' : ''}</Notice>}

      <Tiles>
        <Tile n={rupees(t.total)} label="Total fees" />
        <Tile n={rupees(t.paid)} label="Paid" color={C.ok} />
        <Tile n={rupees(t.pending)} label="Total pending" />
        <Tile n={rupees(t.due_till_date)} label="Due till today" color={t.due_till_date > 0 ? C.bad : C.ok} />
      </Tiles>
      {(hint || t.adjustments !== 0 || t.excess > 0) ? <Dim style={{ marginBottom: 12 }}>
        {hint}{t.adjustments !== 0 ? ` Includes adjustments of ${t.adjustments > 0 ? '+' : '-'}${rupees(Math.abs(t.adjustments))} on the ${rupees(t.structure)} class fees.` : ''}{t.excess > 0 ? ` ${rupees(t.excess)} was paid in excess of the current fees.` : ''}
      </Dim> : null}

      {(canPay || canAdjust) && <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        {canPay && <View style={{ flex: 1 }}><Btn title="Record payment" onPress={() => setModal('pay')} /></View>}
        {canAdjust && <View style={{ flex: canPay ? 0 : 1 }}><Btn kind="ghost" title="Adjust fees" onPress={() => setModal('adjust')} /></View>}
      </View>}

      {d.ledger.lines.length > 0 && <List>{d.ledger.lines.map((l, i) => { const [label, color, bg] = lineChip(l); return (
        <Row key={i} last={i === d.ledger.lines.length - 1}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600', color: C.ink }}>{l.label}</Text>
            <Dim>Due {fmt(l.due_date)}{l.discount > 0 ? ` · after ${rupees(l.discount)} discount` : ''}</Dim>
            <Dim>{rupees(l.amount)} · paid {rupees(l.paid)}</Dim>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={{ fontWeight: '800', color: l.pending > 0 ? C.ink : C.mute }}>{rupees(l.pending)}</Text><Chip color={color} bg={bg}>{label}</Chip></View>
        </Row>); })}</List>}

      <Card>
        <Text style={{ fontWeight: '700', color: C.ink }}>Previous payments</Text>
        {d.payments.length === 0 ? <Dim style={{ paddingVertical: 10 }}>No payment has been recorded in {d.session.name}.</Dim> : d.payments.map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderColor: C.line, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.ink, textDecorationLine: p.status === 'cancelled' ? 'line-through' : 'none' }}><Text style={{ fontWeight: '800' }}>{rupees(p.amount)}</Text><Text style={{ color: C.mute }}> · {fmt(p.paid_on)} · {MODE_LABEL[p.mode] || p.mode}{p.reference ? ` (${p.reference})` : ''}</Text></Text>
              <Dim>{p.receipt_no}{p.received_by ? ` · received by ${p.received_by}` : ''}{p.note ? ` · ${p.note}` : ''}</Dim>
              {p.status === 'cancelled' && <Text style={{ color: C.bad, fontSize: 12 }}>Cancelled{p.cancel_reason ? `: ${p.cancel_reason}` : ''}{p.cancelled_by ? ` (${p.cancelled_by})` : ''}</Text>}
            </View>
            <IconBtn name="download" color={C.accent} onPress={() => receipt(p)} />
            {canCancel && p.status === 'received' && <IconBtn name="x" color={C.bad} onPress={() => setModal({ cancel: p })} />}
          </View>))}
        {live.length > 1 && <Dim style={{ paddingTop: 6 }}>{live.length} payments · {rupees(t.paid)} in total</Dim>}
      </Card>

      {d.adjustments.length > 0 && <Card>
        <Text style={{ fontWeight: '700', color: C.ink }}>Adjustments</Text>
        {d.adjustments.map((a) => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderColor: C.line, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ textDecorationLine: a.voided ? 'line-through' : 'none' }}><Text style={{ fontWeight: '800', color: a.amount < 0 ? C.ok : C.bad }}>{a.amount < 0 ? '-' : '+'}{rupees(Math.abs(a.amount))}</Text><Text style={{ color: C.mute }}> · {a.item_name || 'General'} · {a.reason}</Text></Text>
              <Dim>{fmt(a.applied_on)}{a.created_by ? ` · by ${a.created_by}` : ''}</Dim>
              {a.voided && <Text style={{ color: C.bad, fontSize: 12 }}>Removed{a.void_reason ? `: ${a.void_reason}` : ''}{a.voided_by ? ` (${a.voided_by})` : ''}</Text>}
            </View>
            {canAdjust && !a.voided && <Btn small kind="ghost" title="Remove" onPress={() => setModal({ void: a })} />}
          </View>))}
      </Card>}

      {modal === 'pay' && <PayForm d={d} sc={sc} onClose={() => setModal(null)} onPaid={(r) => { setLast(r.payment); toast('Payment recorded'); reload(); }} />}
      {modal === 'adjust' && <AdjustForm d={d} sc={sc} onClose={() => setModal(null)} onDone={() => { toast('Fees adjusted'); reload(); }} />}
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
  const { data: list, error: err } = useApi(picked ? null : `/fees/students${qs({ ...sc, q: dq, class_id: classId })}`);
  const close = useCallback(() => setPicked(null), []);

  if (picked) return <Account me={me} sc={sc} studentId={picked.student_id} active={active} onBack={close} />;
  return (
    <Pad>
      <Input placeholder="Search by name, ID, admission or roll no." value={q} onChangeText={setQ} />
      <Gap h={10} />
      <View style={{ marginBottom: 12 }}><Choice value={classId} onChange={setClassId} options={[{ value: '', label: 'All classes' }, ...classes.map((c) => ({ value: c.id, label: `${c.name}${c.section ? ` ${c.section}` : ''}` }))]} /></View>
      <ErrorBox>{err}</ErrorBox>
      {!list ? (err ? null : <Loading />) : list.length === 0 ? <Empty>No student found.</Empty> : (
        <List>{list.map((s, i) => (
          <Row key={s.student_id} last={i === list.length - 1} onPress={() => setPicked(s)}>
            <Roll n={s.roll_no} />
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.ink }}>{s.full_name}</Text><Dim>Class {s.class_label}{s.admission_no ? ` · Adm. ${s.admission_no}` : ''} · {s.login_id}</Dim></View>
            <Icon name="chevron" size={18} color={C.mute} />
          </Row>))}
          {list.length === 50 && <Dim style={{ padding: 10, textAlign: 'center' }}>Showing the first 50. Type more of the name to narrow it down.</Dim>}
        </List>)}
    </Pad>
  );
});

/* ================================================================== MY FEES (parent / student, read only) */
export function MyFees({ me, active }) {
  const { data: kids, error: err, loading, reload } = useApi('/fees/my'); const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  const single = kids?.length === 1;
  useEffect(() => { if (single) setOpen(kids[0].student_id); }, [single]); // eslint-disable-line

  if (err && !kids) return <Pad><ErrorBox>{err}</ErrorBox></Pad>;
  if (!kids) return <Pad><Loading /></Pad>;
  if (kids.length === 0) return <Pad><Empty>No student is linked to your account yet. Ask the school office.</Empty></Pad>;
  if (open) return <Account me={me} family sc={{}} studentId={open} active={active} onBack={single ? null : close} />;
  return (
    <Pad reload={reload} loading={loading} hasData>
      {kids.map((k) => (
        <Press key={k.student_id} onPress={() => setOpen(k.student_id)} style={{ backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line, marginBottom: 10 }}>
          <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink }}>{k.full_name}</Text>
          <Dim>{k.class_label ? `Class ${k.class_label}` : 'No class'}</Dim>
          {k.summary && <Text style={{ marginTop: 6, fontWeight: '700', color: k.summary.due_till_date > 0 ? C.bad : C.ok }}>{k.summary.due_till_date > 0 ? `${rupees(k.summary.due_till_date)} due` : k.summary.pending > 0 ? 'Nothing due yet' : 'All paid'}</Text>}
        </Press>))}
    </Pad>
  );
}
