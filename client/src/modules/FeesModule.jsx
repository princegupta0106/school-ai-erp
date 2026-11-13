// Fees (web). PILOT of the design standard: Page > PageBar > Tabs > Section > DataTable / List, every form = FormDialog, status = StatusBadge.
// Same endpoints and rules as before; mirrors mobile/src/screens/Fees.js.
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Field, toast, Loading, ask, groupByClass, ClassGroup, Page, PageBar, Tabs, KpiGrid, Kpi, Section, DataTable, List, ListRow, StatusBadge, EmptyState, FormDialog, FormGrid, Notice, Button, Choice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
import { scoped } from './AttendanceModule.jsx';

// ---------------------------------------------------------------- helpers
const sup = (me) => me.role === 'super_admin';
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, v)); const s = p.toString(); return s ? `?${s}` : ''; };
const scopeQ = (me, sid) => (sup(me) ? { school_id: sid } : {});
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, o) : '');
const MODES = [['cash', 'Cash'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['bank_transfer', 'Bank transfer'], ['card', 'Card'], ['other', 'Other']];
const MODE_LABEL = Object.fromEntries(MODES);
const TERM_LABEL = { one_time: 'One time', half_yearly: 'Half yearly', quarterly: 'Quarterly', monthly: 'Monthly' };
const TERM_EVERY = { one_time: '', half_yearly: 'every 6 months', quarterly: 'every 3 months', monthly: 'every month' };

function useDebounced(v, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
const Failed = ({ error, onRetry }) => <Notice tone="bad" action={onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : null}>{error}</Notice>;
const num = (set, f, k) => (e) => set({ ...f, [k]: e.target.value });

// asks for a reason (cancel a payment, remove an adjustment)
function ReasonDialog({ title, text, confirmLabel, onClose, onConfirm }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => { setBusy(true); setErr(''); try { await onConfirm(reason.trim()); onClose(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormDialog title={title} onClose={onClose} onSubmit={go} busy={busy} error={err} danger submitLabel={confirmLabel} submitDisabled={!reason.trim()}>
      <Notice tone="warn">{text}</Notice>
      <Field label="Reason (kept in the history)" req><input autoFocus required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormDialog>
  );
}

/* ===================================================================== FEE STRUCTURE */
function ItemDialog({ data, cls, item, onClose, onSaved }) {
  const [f, setF] = useState({ name: item?.name || '', amount: item ? String(item.amount) : '', frequency: item?.frequency || 'quarterly' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const fr = data.frequencies.find((x) => x.key === f.frequency);
  const amt = Number(f.amount);
  const each = amt > 0 && fr ? amt / fr.count : null;
  const save = async () => { setBusy(true); setErr(''); try { await onSaved(f); onClose(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormDialog title={item ? `Edit fee - Class ${cls.name}` : `Add fee - Class ${cls.name}`} onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel={item ? 'Save changes' : 'Add fee'}>
      <FormGrid>
        <Field full req label="Fee name"><input autoFocus required maxLength={80} value={f.name} onChange={num(setF, f, 'name')} placeholder="e.g. Tuition, Transport, Lab, Admission" /></Field>
        <Field req label="Total for the session (₹)"><input required type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={num(setF, f, 'amount')} placeholder="20000" /></Field>
        <Field label="Payment term"><select value={f.frequency} onChange={num(setF, f, 'frequency')}>{data.frequencies.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></Field>
        {each !== null && <div className="ds-full"><Notice tone="info">{fr.count === 1 ? <>Paid in one go: <b>{rupees(amt)}</b>, due on the session start date.</> : <>Paid in <b>{fr.count} instalments</b> of about <b>{rupees(Math.round(each * 100) / 100)}</b> ({TERM_EVERY[f.frequency]}), the first due on the session start date.</>}</Notice></div>}
        {item && <div className="ds-full"><Notice tone="mute">This changes the fee for every student of Class {cls.name} from now on. Payments already received are kept.</Notice></div>}
      </FormGrid>
    </FormDialog>
  );
}

function CopyDialog({ data, me, sid, onClose, onDone }) {
  const others = data.sessions.filter((s) => s.id !== data.session.id);
  const [from, setFrom] = useState(others[0]?.id || ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post('/fees/structure/copy', { from_session_id: from, to_session_id: data.session.id, ...scopeQ(me, sid) }); toast(r.copied ? `${r.copied} fee${r.copied === 1 ? '' : 's'} copied` : 'Nothing new to copy'); onDone(); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormDialog title={`Copy fees into ${data.session.name}`} onClose={onClose} onSubmit={go} busy={busy} error={err} submitLabel="Copy fees" submitDisabled={!from}>
      <Notice tone="mute">Copies every class's fees from another session. Fees a class already has here are left alone, so it is safe to do twice.</Notice>
      <Field label="Copy from"><select value={from} onChange={(e) => setFrom(e.target.value)}>{others.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}</select></Field>
    </FormDialog>
  );
}

export const FeeStructure = scoped(function FeeStructure({ me, sid }) {
  const [sessionId, setSessionId] = useState('');
  const [clsName, setClsName] = useState('');
  const [modal, setModal] = useState(null);
  const { data, error: err, refresh: load } = useApi(`/fees/structure${qs({ ...scopeQ(me, sid), session_id: sessionId })}`);
  useEffect(() => { if (data && !data.classes.some((c) => c.name === clsName)) setClsName(data.classes[0]?.name || ''); }, [data]); // eslint-disable-line

  if (err && !data) return <Page><Failed error={err} onRetry={load} /></Page>;
  if (!data) return <Loading />;
  const cls = data.classes.find((c) => c.name === clsName);
  const body = (it) => ({ ...it, class_name: cls.name, session_id: data.session.id, ...scopeQ(me, sid) });
  const del = async (it) => {
    if (!(await ask(`Remove "${it.name}" from Class ${cls.name}? Every student of this class will no longer be charged for it.`))) return;
    try { await api.del(`/fees/structure/items/${it.id}${qs(scopeQ(me, sid))}`); toast('Fee removed'); load(); } catch (x) { toast(x.message, true); }
  };
  const withFees = data.classes.filter((c) => c.items.length).length;
  const cols = [
    { key: 'name', label: 'Fee', primary: true, render: (it) => it.name },
    { key: 'amount', label: 'Total', align: 'right', render: (it) => rupees(it.amount) },
    { key: 'term', label: 'Payment term', render: (it) => TERM_LABEL[it.frequency] },
    { key: 'each', label: 'Each instalment', align: 'right', render: (it) => (it.count === 1 ? '-' : <>{it.count} x {rupees(it.first)}{!it.even && <span className="ds-sub"> (last {rupees(it.last)})</span>}</>) },
    { key: 'act', label: '', align: 'right', nowrap: true, render: (it) => (<>
      <Button kind="ghost" size="sm" icon="edit" aria-label={`Edit ${it.name}`} onClick={() => setModal({ type: 'item', item: it })} />
      <Button kind="ghost" size="sm" icon="trash" aria-label={`Remove ${it.name}`} onClick={() => del(it)} /></>) },
  ];

  return (
    <Page>
      <PageBar title="Fees for session" sub={`${withFees} of ${data.classes.length} class${data.classes.length === 1 ? '' : 'es'} have fees set`}>
        <select aria-label="Session" value={data.session.id} onChange={(e) => setSessionId(e.target.value)}>{data.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}</select>
        {data.sessions.length > 1 && <Button onClick={() => setModal({ type: 'copy' })}>Copy from another session</Button>}
        {cls && <Button kind="primary" icon="plus" onClick={() => setModal({ type: 'item' })}>Add fee</Button>}
      </PageBar>

      {data.classes.length === 0 ? <Section><EmptyState icon="users" title="No classes yet">Add classes under Users &gt; Classes first.</EmptyState></Section> : (<>
        <Tabs value={clsName} onChange={setClsName} items={data.classes.map((c) => ({ key: c.name, label: `Class ${c.name}`, count: c.items.length }))} />
        {cls && (
          <Section title={`Class ${cls.name}`} sub={`${cls.sections.length ? `Sections ${cls.sections.join(', ')} - ` : ''}${cls.students} student${cls.students === 1 ? '' : 's'}. Same fees for every section.`} flush>
            <DataTable columns={cols} rows={cls.items}
              empty={<EmptyState icon="box" title={`No fees for Class ${cls.name} yet`} action={<Button kind="primary" size="sm" icon="plus" onClick={() => setModal({ type: 'item' })}>Add fee</Button>}>Add the first one, for example Tuition.</EmptyState>}
              foot={(c) => (c.key === 'name' ? 'Total per student' : c.key === 'amount' ? rupees(cls.total) : null)} />
          </Section>)}
        <Notice tone="mute">Instalments start on the session start date ({fmtDate(data.session.start_date)}). Changes apply to every student of this class from now on; payments already received are kept.</Notice>
      </>)}

      {modal?.type === 'item' && cls && <ItemDialog data={data} cls={cls} item={modal.item} onClose={() => setModal(null)}
        onSaved={async (f) => { if (modal.item) await api.patch(`/fees/structure/items/${modal.item.id}`, body(f)); else await api.post('/fees/structure/items', body(f)); toast(modal.item ? 'Fee updated' : 'Fee added'); load(); }} />}
      {modal?.type === 'copy' && <CopyDialog data={data} me={me} sid={sid} onClose={() => setModal(null)} onDone={load} />}
    </Page>
  );
});

/* ===================================================================== ONE STUDENT'S FEES */
// ledger line -> [label, tone]
const lineBadge = (l) => {
  if (l.status === 'paid') return ['Paid', 'ok'];
  if (l.status === 'partial') return ['Part paid', l.overdue ? 'bad' : 'warn'];
  if (l.status === 'due') return l.overdue ? ['Overdue', 'bad'] : ['Due today', 'warn'];
  return ['Upcoming', 'mute'];
};

function PayDialog({ d, me, sid, onClose, onPaid }) {
  const t = d.ledger.totals;
  const [f, setF] = useState({ amount: t.due_till_date > 0 ? String(t.due_till_date) : String(t.pending), mode: 'cash', reference: '', note: '', paid_on: d.today });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const amt = Number(f.amount);
  const over = amt > t.pending + 0.001;
  const bad = !(amt > 0) || over;
  const save = async () => { setBusy(true); setErr(''); try { onPaid(await api.post(`/fees/students/${d.student.student_id}/payments`, { ...f, session_id: d.session.id, ...scopeQ(me, sid) })); onClose(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormDialog title={`Record payment - ${d.student.full_name}`} onClose={onClose} onSubmit={save} busy={busy} error={err || (over ? 'That is more than the pending balance.' : '')} submitLabel={`Record ${amt > 0 ? rupees(amt) : 'payment'}`} submitDisabled={bad}>
      <FormGrid>
        <div className="ds-full"><Notice tone="info">Pending <b>{rupees(t.pending)}</b>{t.due_till_date > 0 && <> - due till date <b>{rupees(t.due_till_date)}</b></>}. The money goes to the oldest unpaid fees first.</Notice></div>
        <Field full req label="Amount received (₹)"><input autoFocus required type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={num(setF, f, 'amount')} className={`ds-input-lg ${bad && f.amount !== '' ? 'ds-invalid' : ''}`} /></Field>
        <div className="ds-full ds-quick">
          {t.due_till_date > 0 && <Button size="sm" onClick={() => setF({ ...f, amount: String(t.due_till_date) })}>Due till date {rupees(t.due_till_date)}</Button>}
          <Button size="sm" onClick={() => setF({ ...f, amount: String(t.pending) })}>Everything pending {rupees(t.pending)}</Button>
        </div>
        <Field label="Paid by"><select value={f.mode} onChange={num(setF, f, 'mode')}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field req label="Payment date"><input type="date" required max={d.today} value={f.paid_on} onChange={num(setF, f, 'paid_on')} /></Field>
        <Field full label="Reference / cheque no. (optional)"><input maxLength={100} value={f.reference} onChange={num(setF, f, 'reference')} placeholder="UPI transaction id, cheque number..." /></Field>
        <Field full label="Note (optional)"><input maxLength={300} value={f.note} onChange={num(setF, f, 'note')} /></Field>
      </FormGrid>
    </FormDialog>
  );
}

function AdjustDialog({ d, me, sid, onClose, onDone }) {
  const [f, setF] = useState({ type: 'discount', item_id: '', amount: '', reason: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setErr(''); try { onDone(await api.post(`/fees/students/${d.student.student_id}/adjustments`, { ...f, session_id: d.session.id, ...scopeQ(me, sid) })); onClose(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormDialog title={`Adjust fees - ${d.student.full_name}`} onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel={f.type === 'discount' ? 'Apply discount' : 'Add charge'} submitDisabled={!f.reason.trim() || !(Number(f.amount) > 0)}>
      <Notice tone="mute">Only for this student. The class's fee structure is not changed, and every adjustment stays in the history.</Notice>
      <Choice label="Adjustment type" value={f.type} onChange={(v) => setF({ ...f, type: v })} options={[{ value: 'discount', label: 'Discount / concession' }, { value: 'charge', label: 'Extra charge' }]} />
      <Field label="Applies to" hint={f.item_id ? 'Spread over that fee’s instalments.' : f.type === 'discount' ? 'Taken off the oldest unpaid fees first.' : 'Due immediately.'}>
        <select value={f.item_id} onChange={num(setF, f, 'item_id')}><option value="">General (whole account)</option>{d.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
      <Field req label="Amount (₹)"><input autoFocus required type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={num(setF, f, 'amount')} /></Field>
      <Field req label="Reason (kept in the history)"><input required maxLength={200} value={f.reason} onChange={num(setF, f, 'reason')} placeholder={f.type === 'discount' ? 'e.g. Sibling concession, scholarship, does not use bus' : 'e.g. Late fine, lost ID card'} /></Field>
    </FormDialog>
  );
}

function Account({ me, sid, studentId, family, onBack, backLabel }) {
  const [sessionId, setSessionId] = useState('');
  const [modal, setModal] = useState(null); const [last, setLast] = useState(null);
  const url = family ? `/fees/my/${studentId}` : `/fees/students/${studentId}`;
  // set() writes the server's updated account (returned by pay / adjust / cancel) straight into the cache
  const { data: d, error: err, set: setD, refresh: reload } = useApi(`${url}${qs({ ...(family ? {} : scopeQ(me, sid)), session_id: sessionId })}`);

  const has = (f) => me.features.includes(f);
  const receipt = async (p) => { try { await api.download(`/fees/payments/${p.id}/receipt${family ? '' : qs(scopeQ(me, sid))}`, `${p.receipt_no}.pdf`); } catch (x) { toast(x.message, true); } };
  const scopeBody = family ? {} : scopeQ(me, sid);
  const back = onBack ? <Button kind="ghost" icon="back" onClick={onBack}>{backLabel}</Button> : null;

  if (err && !d) return <Page><PageBar title="Fees" lead={back} /><Failed error={err} onRetry={reload} /></Page>;
  if (!d) return <Page><PageBar title="Fees" lead={back} /><Loading /></Page>;
  const t = d.ledger.totals; const s = d.student;
  const other = d.sessions.filter((x) => x.id !== d.session.id && x.pending > 0);
  const canPay = !family && has('collect_fees') && t.pending > 0;
  const canAdjust = !family && has('adjust_fees');
  const canCancel = !family && has('cancel_fee_payment');
  const live = d.payments.filter((p) => p.status === 'received');
  const lineCols = [
    { key: 'label', label: 'Fee', primary: true, render: (l) => <>{l.label}{l.discount > 0 && <span className="ds-sub"> (after {rupees(l.discount)} discount)</span>}</> },
    { key: 'due', label: 'Due date', nowrap: true, render: (l) => fmtDate(l.due_date) },
    { key: 'amount', label: 'Amount', align: 'right', render: (l) => rupees(l.amount) },
    { key: 'paid', label: 'Paid', align: 'right', render: (l) => rupees(l.paid) },
    { key: 'pending', label: 'Pending', align: 'right', render: (l) => <b>{rupees(l.pending)}</b> },
    { key: 'status', label: 'Status', render: (l) => { const [label, tone] = lineBadge(l); return <StatusBadge tone={tone}>{label}</StatusBadge>; } },
  ];
  const summary = t.pending === 0 ? (d.ledger.lines.length ? 'All fees are paid.' : '') : t.due_till_date === 0 && t.next_due_date ? `Nothing is due yet. Next: ${rupees(t.next_due_amount)} on ${fmtDate(t.next_due_date)}.` : t.next_due_date ? `Next after this: ${rupees(t.next_due_amount)} on ${fmtDate(t.next_due_date)}.` : '';
  const extra = `${t.adjustments !== 0 ? ` Includes adjustments of ${t.adjustments > 0 ? '+' : '-'}${rupees(Math.abs(t.adjustments))} on the ${rupees(t.structure)} class fees.` : ''}${t.excess > 0 ? ` ${rupees(t.excess)} was paid in excess of the current fees.` : ''}`;

  return (
    <Page>
      <PageBar lead={back} title={s.full_name} sub={`${s.class_label ? `Class ${s.class_label}` : 'No class assigned'}${s.roll_no ? ` - Roll ${s.roll_no}` : ''}${s.admission_no ? ` - Adm. ${s.admission_no}` : ''}`}>
        {d.sessions.length > 1
          ? <select aria-label="Session" value={d.session.id} onChange={(e) => setSessionId(e.target.value)}>{d.sessions.map((x) => <option key={x.id} value={x.id}>{x.name}{x.is_current ? ' (current)' : ''}{x.pending > 0 ? ` - ${rupees(x.pending)} pending` : ''}</option>)}</select>
          : <StatusBadge tone="mute" dot={false}>{d.session.name}</StatusBadge>}
        {canAdjust && <Button onClick={() => setModal('adjust')}>Adjust fees</Button>}
        {canPay && <Button kind="primary" icon="plus" onClick={() => setModal('pay')}>Record payment</Button>}
      </PageBar>

      {other.length > 0 && <Notice tone="warn">Unpaid fees from {other.map((o, i) => <span key={o.id}>{i ? ', ' : ''}<Button kind="ghost" size="sm" onClick={() => setSessionId(o.id)}>{o.name}: {rupees(o.pending)}</Button></span>)}</Notice>}
      {last && <Notice tone="ok" action={<Button size="sm" icon="download" onClick={() => receipt(last)}>Download receipt</Button>}><span>Payment of <b>{rupees(last.amount)}</b> recorded. Receipt <b>{last.receipt_no}</b>.</span></Notice>}
      {!d.has_structure && <Notice tone="warn">{s.class_name ? `No fees are set for Class ${s.class_name} in ${d.session.name} yet.` : 'This student has no class, so no fees apply.'}{has('manage_fee_structure') && ' Add them under Fees > Fee structure.'}</Notice>}

      <KpiGrid>
        <Kpi label="Total fees" value={rupees(t.total)} />
        <Kpi label="Paid" value={rupees(t.paid)} tone="ok" />
        <Kpi label="Total pending" value={rupees(t.pending)} />
        <Kpi label="Due till today" value={rupees(t.due_till_date)} tone={t.due_till_date > 0 ? 'warn' : 'ok'} />
      </KpiGrid>
      {(summary || extra) && <Notice tone="mute">{`${summary}${extra}`.trim()}</Notice>}

      {d.ledger.lines.length > 0 && <Section title="Fees" flush><DataTable columns={lineCols} rows={d.ledger.lines} rowKey={(l, i) => i} /></Section>}

      <Section title="Previous payments" sub={live.length > 1 ? `${live.length} payments - ${rupees(t.paid)} in total` : undefined} flush>
        {d.payments.length === 0 ? <EmptyState icon="box" title="No payments yet">No payment has been recorded in {d.session.name}.</EmptyState> : (
          <List>{d.payments.map((p) => (
            <ListRow key={p.id} wrap
              title={p.status === 'cancelled' ? <s>{rupees(p.amount)}</s> : rupees(p.amount)}
              sub={`${fmtDate(p.paid_on)} - ${MODE_LABEL[p.mode] || p.mode}${p.reference ? ` (${p.reference})` : ''} - ${p.receipt_no}${p.received_by ? ` - received by ${p.received_by}` : ''}${p.note ? ` - ${p.note}` : ''}${p.status === 'cancelled' ? ` - Cancelled${p.cancel_reason ? `: ${p.cancel_reason}` : ''}${p.cancelled_by ? ` (${p.cancelled_by})` : ''}` : ''}`}
              meta={p.status === 'cancelled' ? <StatusBadge tone="bad">Cancelled</StatusBadge> : null}>
              <Button size="sm" icon="download" aria-label={`Download receipt ${p.receipt_no}`} onClick={() => receipt(p)}>Receipt</Button>
              {canCancel && p.status === 'received' && <Button kind="ghost" size="sm" icon="x" aria-label="Cancel payment" title="Cancel this payment" onClick={() => setModal({ cancel: p })} />}
            </ListRow>))}</List>)}
      </Section>

      {d.adjustments.length > 0 && (
        <Section title="Adjustments" flush>
          <List>{d.adjustments.map((a) => (
            <ListRow key={a.id} wrap
              title={<span className={a.voided ? '' : a.amount < 0 ? 'ds-c-ok' : 'ds-c-bad'}>{a.voided ? <s>{a.amount < 0 ? '-' : '+'}{rupees(Math.abs(a.amount))}</s> : <>{a.amount < 0 ? '-' : '+'}{rupees(Math.abs(a.amount))}</>}</span>}
              sub={`${a.item_name || 'General'} - ${a.reason} - ${fmtDate(a.applied_on)}${a.created_by ? ` - by ${a.created_by}` : ''}${a.voided ? ` - Removed${a.void_reason ? `: ${a.void_reason}` : ''}${a.voided_by ? ` (${a.voided_by})` : ''}` : ''}`}
              meta={a.voided ? <StatusBadge tone="mute">Removed</StatusBadge> : null}>
              {canAdjust && !a.voided && <Button size="sm" onClick={() => setModal({ void: a })}>Remove</Button>}
            </ListRow>))}</List>
        </Section>)}

      {modal === 'pay' && <PayDialog d={d} me={me} sid={sid} onClose={() => setModal(null)} onPaid={(r) => { setD(r.account); setLast(r.payment); toast('Payment recorded'); }} />}
      {modal === 'adjust' && <AdjustDialog d={d} me={me} sid={sid} onClose={() => setModal(null)} onDone={(x) => { setD(x); toast('Fees adjusted'); }} />}
      {modal?.cancel && <ReasonDialog title={`Cancel payment ${modal.cancel.receipt_no}`} confirmLabel="Cancel this payment" onClose={() => setModal(null)}
        text={`This marks the ${rupees(modal.cancel.amount)} payment as cancelled and puts the amount back as pending. The receipt stays in the history, marked cancelled.`}
        onConfirm={async (reason) => { setD(await api.post(`/fees/payments/${modal.cancel.id}/cancel`, { reason, ...scopeBody })); setLast(null); toast('Payment cancelled'); }} />}
      {modal?.void && <ReasonDialog title="Remove adjustment" confirmLabel="Remove adjustment" onClose={() => setModal(null)}
        text={`${modal.void.amount < 0 ? 'The discount' : 'The extra charge'} of ${rupees(Math.abs(modal.void.amount))} (${modal.void.reason}) will stop applying. It stays in the history.`}
        onConfirm={async (reason) => { setD(await api.post(`/fees/adjustments/${modal.void.id}/void`, { reason, ...scopeBody })); toast('Adjustment removed'); }} />}
    </Page>
  );
}

/* ===================================================================== STUDENT FEES (staff) */
export const StudentFees = scoped(function StudentFees({ me, sid }) {
  const [picked, setPicked] = useState(null);
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [classId, setClassId] = useState('');
  const { data: classes = [] } = useApi(`/fees/classes${qs(scopeQ(me, sid))}`);
  const { data: list, error: err, refresh: reload } = useApi(`/fees/students${qs({ ...scopeQ(me, sid), q: dq, class_id: classId, limit: 3000 })}`, !picked, { keepPrevious: true });

  if (picked) return <Account me={me} sid={sid} studentId={picked.student_id} onBack={() => setPicked(null)} backLabel="Students" />;
  return (
    <Page>
      <PageBar title="Student fees" sub="Open a student to record a payment or adjust fees" />
      <FilterBar q={q} onQ={setQ} placeholder="Search by name, ID, admission or roll no." count={list?.length}
        filters={[{ key: 'cls', label: 'Class', value: classId, onChange: setClassId, all: 'All classes', options: classes.map((c) => ({ value: c.id, label: `${c.name}${c.section ? ` ${c.section}` : ''}` })) }]} />
      {err && <Failed error={err} onRetry={reload} />}
      {!list ? <Loading /> : list.length === 0 ? <Section><EmptyState icon="users" title="No student found">Try a different name or class.</EmptyState></Section> : groupByClass(list, (s) => s.class_label).map((g) => (
        <ClassGroup key={g.label} label={g.label} count={g.items.length} open={!!dq || !!classId}>
          <List>{g.items.map((s) => (
            <ListRow key={s.student_id} onClick={() => setPicked(s)} lead={<StatusBadge tone="mute" dot={false}>{s.roll_no ?? '-'}</StatusBadge>} title={s.full_name} sub={`${s.admission_no ? `Adm. ${s.admission_no} - ` : ''}${s.login_id}`} />))}</List>
        </ClassGroup>))}
    </Page>
  );
});

/* ===================================================================== MY FEES (parent / student, read only) */
export function MyFees({ me }) {
  const { data: kids, error: err, refresh: reload } = useApi('/fees/my'); const [open, setOpen] = useState(null);
  const single = kids?.length === 1;
  useEffect(() => { if (single) setOpen(kids[0].student_id); }, [single]); // eslint-disable-line

  if (err && !kids) return <Page><Failed error={err} onRetry={reload} /></Page>;
  if (!kids) return <Loading />;
  if (kids.length === 0) return <Page><Section><EmptyState icon="users" title="No student linked">No student is linked to your account yet. Ask the school office.</EmptyState></Section></Page>;
  if (open) return <Account me={me} family studentId={open} onBack={single ? null : () => setOpen(null)} backLabel="My children" />;
  const kidStatus = (k) => (!k.summary ? null : k.summary.due_till_date > 0 ? <StatusBadge tone="bad">{`${rupees(k.summary.due_till_date)} due`}</StatusBadge> : k.summary.pending > 0 ? <StatusBadge tone="mute">Nothing due yet</StatusBadge> : <StatusBadge tone="ok">All paid</StatusBadge>);
  return (
    <Page>
      <PageBar title="My children" sub="Open a child to see fees and payments" />
      <Section flush><List>{kids.map((k) => <ListRow key={k.student_id} onClick={() => setOpen(k.student_id)} title={k.full_name} sub={k.class_label ? `Class ${k.class_label}` : 'No class'} meta={kidStatus(k)} />)}</List></Section>
    </Page>
  );
}
