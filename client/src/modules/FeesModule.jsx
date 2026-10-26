import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Modal, Empty, Field, toast, Loading } from '../ui.jsx';
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

// a small modal that asks for a reason (cancel a payment, remove an adjustment)
function ReasonModal({ title, text, confirmLabel, onClose, onConfirm }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await onConfirm(reason.trim()); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}><form className="form" onSubmit={go}>
      <div className="full muted">{text}</div>
      <div className="full"><Field label="Reason (kept in the history)" req><input autoFocus required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      {err && <div className="err full">{err}</div>}
      <button className="btn danger full" disabled={busy || !reason.trim()} style={{ justifyContent: 'center' }}>{busy ? 'Please wait...' : confirmLabel}</button>
    </form></Modal>
  );
}

/* ===================================================================== FEE STRUCTURE */
function ItemForm({ data, cls, item, onClose, onSaved }) {
  const [f, setF] = useState({ name: item?.name || '', amount: item ? String(item.amount) : '', frequency: item?.frequency || 'quarterly' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const fr = data.frequencies.find((x) => x.key === f.frequency);
  const amt = Number(f.amount);
  const each = amt > 0 && fr ? amt / fr.count : null;
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await onSaved(f); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={item ? `Edit fee - Class ${cls.name}` : `Add fee - Class ${cls.name}`} onClose={onClose}><form className="form" onSubmit={save}>
      <div className="full"><Field label="Fee name" req><input autoFocus required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Tuition, Transport, Lab, Admission" /></Field></div>
      <Field label="Total for the session (₹)" req><input required type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="20000" /></Field>
      <Field label="Payment term"><select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>{data.frequencies.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></Field>
      {each !== null && <div className="full notice">{fr.count === 1 ? <>Paid in one go: <b>{rupees(amt)}</b>, due on the session start date.</> : <>Paid in <b>{fr.count} instalments</b> of about <b>{rupees(Math.round(each * 100) / 100)}</b> ({TERM_EVERY[f.frequency]}), the first due on the session start date.</>}</div>}
      {item && <div className="full muted" style={{ fontSize: 13 }}>This changes the fee for every student of Class {cls.name} from now on. Payments already received are kept.</div>}
      {err && <div className="err full">{err}</div>}
      <button className="btn primary full big" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : item ? 'Save changes' : 'Add fee'}</button>
    </form></Modal>
  );
}

function CopyModal({ data, me, sid, onClose, onDone }) {
  const others = data.sessions.filter((s) => s.id !== data.session.id);
  const [from, setFrom] = useState(others[0]?.id || ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post('/fees/structure/copy', { from_session_id: from, to_session_id: data.session.id, ...scopeQ(me, sid) }); toast(r.copied ? `${r.copied} fee${r.copied === 1 ? '' : 's'} copied` : 'Nothing new to copy'); onDone(); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={`Copy fees into ${data.session.name}`} onClose={onClose}><form className="form" onSubmit={go}>
      <div className="full muted">Copies every class's fees from another session. Fees a class already has here are left alone, so it is safe to do twice.</div>
      <div className="full"><Field label="Copy from"><select value={from} onChange={(e) => setFrom(e.target.value)}>{others.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}</select></Field></div>
      {err && <div className="err full">{err}</div>}
      <button className="btn primary full" disabled={busy || !from} style={{ justifyContent: 'center' }}>{busy ? 'Copying...' : 'Copy fees'}</button>
    </form></Modal>
  );
}

export const FeeStructure = scoped(function FeeStructure({ me, sid }) {
  const [sessionId, setSessionId] = useState('');

  const [clsName, setClsName] = useState('');
  const [modal, setModal] = useState(null);
  const { data, error: err, refresh: load } = useApi(`/fees/structure${qs({ ...scopeQ(me, sid), session_id: sessionId })}`);
  useEffect(() => { if (data && !data.classes.some((c) => c.name === clsName)) setClsName(data.classes[0]?.name || ''); }, [data]); // eslint-disable-line

  if (err) return <div className="err">{err}</div>;
  if (!data) return <Loading />;
  const cls = data.classes.find((c) => c.name === clsName);
  const body = (it) => ({ ...it, class_name: cls.name, session_id: data.session.id, ...scopeQ(me, sid) });
  const del = async (it) => {
    if (!confirm(`Remove "${it.name}" from Class ${cls.name}? Every student of this class will no longer be charged for it.`)) return;
    try { await api.del(`/fees/structure/items/${it.id}${qs(scopeQ(me, sid))}`); toast('Fee removed'); load(); } catch (x) { toast(x.message, true); }
  };
  const withFees = data.classes.filter((c) => c.items.length).length;

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className="card row sp">
        <div><b style={{ fontSize: 17 }}>Fees for session</b><div className="muted" style={{ fontSize: 14 }}>{withFees} of {data.classes.length} class{data.classes.length === 1 ? '' : 'es'} have fees set</div></div>
        <div className="row">
          <select aria-label="Session" style={{ width: 'auto' }} value={data.session.id} onChange={(e) => setSessionId(e.target.value)}>{data.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}</select>
          {data.sessions.length > 1 && <button className="btn" onClick={() => setModal({ type: 'copy' })}>Copy from another session</button>}
        </div>
      </div>

      {data.classes.length === 0 ? <Empty>No classes yet. Add classes under Users &gt; Classes first.</Empty> : (<>
        <div className="pills scroll">{data.classes.map((c) => <button key={c.name} className={`pill ${c.name === clsName ? 'on' : ''}`} onClick={() => setClsName(c.name)}>Class {c.name}{c.items.length === 0 && <span className="dot" title="No fees set" />}</button>)}</div>
        {cls && (
          <div className="card stack" style={{ gap: 12 }}>
            <div className="row sp">
              <div><b style={{ fontSize: 17 }}>Class {cls.name}</b><div className="muted" style={{ fontSize: 14 }}>{cls.sections.length ? `Sections ${cls.sections.join(', ')} - ` : ''}{cls.students} student{cls.students === 1 ? '' : 's'}. Same fees for every section.</div></div>
              <button className="btn primary" onClick={() => setModal({ type: 'item' })}><Icon name="plus" size={16} />Add fee</button>
            </div>
            {cls.items.length === 0 ? <Empty>No fees for Class {cls.name} yet. Add the first one, for example Tuition.</Empty> : (
              <div className="scrollx"><table className="ft"><thead><tr><th>Fee</th><th className="amt">Total</th><th>Payment term</th><th className="amt">Each instalment</th><th /></tr></thead><tbody>
                {cls.items.map((it) => (
                  <tr key={it.id}>
                    <td><b>{it.name}</b></td>
                    <td className="amt">{rupees(it.amount)}</td>
                    <td>{TERM_LABEL[it.frequency]}</td>
                    <td className="amt">{it.count === 1 ? '-' : <>{it.count} x {rupees(it.first)}{!it.even && <small className="muted"> (last {rupees(it.last)})</small>}</>}</td>
                    <td className="amt" style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" aria-label={`Edit ${it.name}`} onClick={() => setModal({ type: 'item', item: it })}><Icon name="edit" /></button>
                      <button className="icon-btn" aria-label={`Remove ${it.name}`} onClick={() => del(it)}><Icon name="trash" /></button>
                    </td>
                  </tr>))}
                <tr className="total"><td><b>Total per student</b></td><td className="amt"><b>{rupees(cls.total)}</b></td><td colSpan={3} /></tr>
              </tbody></table></div>)}
            <small className="muted">Instalments start on the session start date ({fmtDate(data.session.start_date)}). Changes apply to every student of this class from now on; payments already received are kept.</small>
          </div>)}
      </>)}

      {modal?.type === 'item' && cls && <ItemForm data={data} cls={cls} item={modal.item} onClose={() => setModal(null)}
        onSaved={async (f) => { if (modal.item) await api.patch(`/fees/structure/items/${modal.item.id}`, body(f)); else await api.post('/fees/structure/items', body(f)); toast(modal.item ? 'Fee updated' : 'Fee added'); load(); }} />}
      {modal?.type === 'copy' && <CopyModal data={data} me={me} sid={sid} onClose={() => setModal(null)} onDone={load} />}
    </div>
  );
});

/* ===================================================================== ONE STUDENT'S FEES */
const STATUS = { paid: ['Paid', 'paid'], upcoming: ['Upcoming', 'upcoming'] };
const lineChip = (l) => {
  if (l.status === 'paid') return STATUS.paid;
  if (l.status === 'partial') return ['Part paid', l.overdue ? 'overdue' : 'partial'];
  if (l.status === 'due') return l.overdue ? ['Overdue', 'overdue'] : ['Due today', 'due'];
  return STATUS.upcoming;
};

function PayModal({ d, me, sid, onClose, onPaid }) {
  const t = d.ledger.totals;
  const [f, setF] = useState({ amount: t.due_till_date > 0 ? String(t.due_till_date) : String(t.pending), mode: 'cash', reference: '', note: '', paid_on: d.today });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const amt = Number(f.amount);
  const bad = !(amt > 0) || amt > t.pending + 0.001;
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { onPaid(await api.post(`/fees/students/${d.student.student_id}/payments`, { ...f, session_id: d.session.id, ...scopeQ(me, sid) })); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={`Record payment - ${d.student.full_name}`} onClose={onClose}><form className="form" onSubmit={save}>
      <div className="full notice">Pending <b>{rupees(t.pending)}</b>{t.due_till_date > 0 && <> - due till date <b>{rupees(t.due_till_date)}</b></>}. The money goes to the oldest unpaid fees first.</div>
      <div className="full"><Field label="Amount received (₹)" req><input autoFocus required type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={bad && f.amount !== '' ? 'rollin bad' : ''} style={{ fontSize: 20, fontWeight: 700 }} /></Field></div>
      <div className="full row">
        {t.due_till_date > 0 && <button type="button" className="chip" onClick={() => setF({ ...f, amount: String(t.due_till_date) })}>Due till date {rupees(t.due_till_date)}</button>}
        <button type="button" className="chip" onClick={() => setF({ ...f, amount: String(t.pending) })}>Everything pending {rupees(t.pending)}</button>
      </div>
      {amt > t.pending + 0.001 && <div className="err full">That is more than the pending balance.</div>}
      <Field label="Paid by"><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Payment date" req><input type="date" required max={d.today} value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></Field>
      <div className="full"><Field label="Reference / cheque no. (optional)"><input maxLength={100} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="UPI transaction id, cheque number..." /></Field></div>
      <div className="full"><Field label="Note (optional)"><input maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
      {err && <div className="err full">{err}</div>}
      <button className="btn primary full big" disabled={busy || bad} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : `Record ${amt > 0 ? rupees(amt) : 'payment'}`}</button>
    </form></Modal>
  );
}

function AdjustModal({ d, me, sid, onClose, onDone }) {
  const [f, setF] = useState({ type: 'discount', item_id: '', amount: '', reason: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { onDone(await api.post(`/fees/students/${d.student.student_id}/adjustments`, { ...f, session_id: d.session.id, ...scopeQ(me, sid) })); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={`Adjust fees - ${d.student.full_name}`} onClose={onClose}><form className="form" onSubmit={save}>
      <div className="full muted">Only for this student. The class's fee structure is not changed, and every adjustment stays in the history.</div>
      <div className="full pills">
        <button type="button" className={`pill ${f.type === 'discount' ? 'on' : ''}`} onClick={() => setF({ ...f, type: 'discount' })}>Discount / concession</button>
        <button type="button" className={`pill ${f.type === 'charge' ? 'on' : ''}`} onClick={() => setF({ ...f, type: 'charge' })}>Extra charge</button>
      </div>
      <div className="full"><Field label="Applies to" hint={f.item_id ? 'Spread over that fee\u2019s instalments.' : f.type === 'discount' ? 'Taken off the oldest unpaid fees first.' : 'Due immediately.'}>
        <select value={f.item_id} onChange={(e) => setF({ ...f, item_id: e.target.value })}><option value="">General (whole account)</option>{d.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field></div>
      <div className="full"><Field label="Amount (₹)" req><input autoFocus required type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field></div>
      <div className="full"><Field label="Reason (kept in the history)" req><input required maxLength={200} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={f.type === 'discount' ? 'e.g. Sibling concession, scholarship, does not use bus' : 'e.g. Late fine, lost ID card'} /></Field></div>
      {err && <div className="err full">{err}</div>}
      <button className="btn primary full big" disabled={busy || !f.reason.trim() || !(Number(f.amount) > 0)} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : f.type === 'discount' ? 'Apply discount' : 'Add charge'}</button>
    </form></Modal>
  );
}

function Account({ me, sid, studentId, family, onBack, backLabel }) {
  const [sessionId, setSessionId] = useState('');
  const [modal, setModal] = useState(null); const [last, setLast] = useState(null);
  const url = family ? `/fees/my/${studentId}` : `/fees/students/${studentId}`;
  // set() writes the server's updated account (returned by pay / adjust / cancel) straight into the cache
  const { data: d, error: err, set: setD } = useApi(`${url}${qs({ ...(family ? {} : scopeQ(me, sid)), session_id: sessionId })}`);

  const has = (f) => me.features.includes(f);
  const receipt = async (p) => { try { await api.download(`/fees/payments/${p.id}/receipt${family ? '' : qs(scopeQ(me, sid))}`, `${p.receipt_no}.pdf`); } catch (x) { toast(x.message, true); } };
  const scopeBody = family ? {} : scopeQ(me, sid);

  const header = <div className="row">{onBack && <button className="btn" onClick={onBack}><Icon name="back" size={16} />{backLabel}</button>}</div>;
  if (err) return <>{header}<div className="err">{err}</div></>;
  if (!d) return <>{header}<Loading /></>;
  const t = d.ledger.totals; const s = d.student;
  const other = d.sessions.filter((x) => x.id !== d.session.id && x.pending > 0);
  const canPay = !family && has('collect_fees') && t.pending > 0;
  const canAdjust = !family && has('adjust_fees');
  const canCancel = !family && has('cancel_fee_payment');
  const live = d.payments.filter((p) => p.status === 'received');

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      {header}
      <div className="card row sp">
        <div>
          <b style={{ fontSize: 18 }}>{s.full_name}</b>
          <div className="muted" style={{ fontSize: 14 }}>{s.class_label ? `Class ${s.class_label}` : 'No class assigned'}{s.roll_no ? ` - Roll ${s.roll_no}` : ''}{s.admission_no ? ` - Adm. ${s.admission_no}` : ''}</div>
        </div>
        {d.sessions.length > 1 ? <select aria-label="Session" style={{ width: 'auto' }} value={d.session.id} onChange={(e) => setSessionId(e.target.value)}>{d.sessions.map((x) => <option key={x.id} value={x.id}>{x.name}{x.is_current ? ' (current)' : ''}{x.pending > 0 ? ` - ${rupees(x.pending)} pending` : ''}</option>)}</select> : <span className="chip">{d.session.name}</span>}
      </div>

      {other.length > 0 && <div className="notice warn">Unpaid fees from {other.map((o, i) => <span key={o.id}>{i ? ', ' : ''}<button className="linkbtn" onClick={() => setSessionId(o.id)}>{o.name}: {rupees(o.pending)}</button></span>)}</div>}
      {last && <div className="notice ok row sp"><span>Payment of <b>{rupees(last.amount)}</b> recorded. Receipt <b>{last.receipt_no}</b>.</span><button className="btn" onClick={() => receipt(last)}><Icon name="download" size={16} />Download receipt</button></div>}

      {!d.has_structure && <div className="notice warn">{s.class_name ? `No fees are set for Class ${s.class_name} in ${d.session.name} yet.` : 'This student has no class, so no fees apply.'}{has('manage_fee_structure') && ' Add them under Fees > Fee structure.'}</div>}

      <div className="fsum">
        <div className="tile"><b>{rupees(t.total)}</b><span>Total fees</span></div>
        <div className="tile okc"><b>{rupees(t.paid)}</b><span>Paid</span></div>
        <div className="tile"><b>{rupees(t.pending)}</b><span>Total pending</span></div>
        <div className={`tile ${t.due_till_date > 0 ? 'due' : 'okc'}`}><b>{rupees(t.due_till_date)}</b><span>Due till today</span></div>
      </div>
      <small className="muted">
        {t.pending === 0 ? (d.ledger.lines.length ? 'All fees are paid.' : '') : t.due_till_date === 0 && t.next_due_date ? `Nothing is due yet. Next: ${rupees(t.next_due_amount)} on ${fmtDate(t.next_due_date)}.` : t.next_due_date ? `Next after this: ${rupees(t.next_due_amount)} on ${fmtDate(t.next_due_date)}.` : ''}
        {t.adjustments !== 0 && ` Includes adjustments of ${t.adjustments > 0 ? '+' : '-'}${rupees(Math.abs(t.adjustments))} on the ${rupees(t.structure)} class fees.`}
        {t.excess > 0 && ` ${rupees(t.excess)} was paid in excess of the current fees.`}
      </small>

      {(canPay || canAdjust) && <div className="row">
        {canPay && <button className="btn primary big" onClick={() => setModal('pay')}><Icon name="plus" size={16} />Record payment</button>}
        {canAdjust && <button className="btn" onClick={() => setModal('adjust')}>Adjust fees</button>}
      </div>}

      {d.ledger.lines.length > 0 && (
        <div className="card" style={{ padding: 0 }}><div className="scrollx"><table className="ft">
          <thead><tr><th>Fee</th><th>Due date</th><th className="amt">Amount</th><th className="amt">Paid</th><th className="amt">Pending</th><th>Status</th></tr></thead>
          <tbody>{d.ledger.lines.map((l, i) => { const [label, tone] = lineChip(l); return (
            <tr key={i} className={l.due_date <= d.today && l.pending > 0 ? 'rowdue' : ''}>
              <td>{l.label}{l.discount > 0 && <small className="muted"> (after {rupees(l.discount)} discount)</small>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.due_date)}</td>
              <td className="amt">{rupees(l.amount)}</td><td className="amt">{rupees(l.paid)}</td><td className="amt"><b>{rupees(l.pending)}</b></td>
              <td><span className={`fchip ${tone}`}>{label}</span></td>
            </tr>); })}</tbody></table></div></div>)}

      <div className="card stack" style={{ gap: 4 }}>
        <b>Previous payments</b>
        {d.payments.length === 0 ? <div className="muted" style={{ padding: '10px 0' }}>No payment has been recorded in {d.session.name}.</div> : d.payments.map((p) => (
          <div key={p.id} className="payrow">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={p.status === 'cancelled' ? 'strike' : ''}><b>{rupees(p.amount)}</b> <span className="muted">- {fmtDate(p.paid_on)} - {MODE_LABEL[p.mode] || p.mode}{p.reference ? ` (${p.reference})` : ''}</span></div>
              <small className="muted">{p.receipt_no}{p.received_by ? ` - received by ${p.received_by}` : ''}{p.note ? ` - ${p.note}` : ''}</small>
              {p.status === 'cancelled' && <small className="neg-text">Cancelled{p.cancel_reason ? `: ${p.cancel_reason}` : ''}{p.cancelled_by ? ` (${p.cancelled_by})` : ''}</small>}
            </div>
            <button className="btn" onClick={() => receipt(p)} aria-label={`Download receipt ${p.receipt_no}`}><Icon name="download" size={16} /><span className="hide-sm">Receipt</span></button>
            {canCancel && p.status === 'received' && <button className="icon-btn" aria-label="Cancel payment" title="Cancel this payment" onClick={() => setModal({ cancel: p })}><Icon name="x" /></button>}
          </div>))}
        {live.length > 1 && <small className="muted" style={{ paddingTop: 6 }}>{live.length} payments - {rupees(t.paid)} in total</small>}
      </div>

      {d.adjustments.length > 0 && (
        <div className="card stack" style={{ gap: 4 }}>
          <b>Adjustments</b>
          {d.adjustments.map((a) => (
            <div key={a.id} className="payrow">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={a.voided ? 'strike' : ''}><b className={a.amount < 0 ? 'pos-text' : 'neg-text'}>{a.amount < 0 ? '-' : '+'}{rupees(Math.abs(a.amount))}</b> <span className="muted">- {a.item_name || 'General'} - {a.reason}</span></div>
                <small className="muted">{fmtDate(a.applied_on)}{a.created_by ? ` - by ${a.created_by}` : ''}</small>
                {a.voided && <small className="neg-text">Removed{a.void_reason ? `: ${a.void_reason}` : ''}{a.voided_by ? ` (${a.voided_by})` : ''}</small>}
              </div>
              {canAdjust && !a.voided && <button className="btn" onClick={() => setModal({ void: a })}>Remove</button>}
            </div>))}
        </div>)}

      {modal === 'pay' && <PayModal d={d} me={me} sid={sid} onClose={() => setModal(null)} onPaid={(r) => { setD(r.account); setLast(r.payment); toast('Payment recorded'); }} />}
      {modal === 'adjust' && <AdjustModal d={d} me={me} sid={sid} onClose={() => setModal(null)} onDone={(x) => { setD(x); toast('Fees adjusted'); }} />}
      {modal?.cancel && <ReasonModal title={`Cancel payment ${modal.cancel.receipt_no}`} confirmLabel="Cancel this payment" onClose={() => setModal(null)}
        text={`This marks the ${rupees(modal.cancel.amount)} payment as cancelled and puts the amount back as pending. The receipt stays in the history, marked cancelled.`}
        onConfirm={async (reason) => { setD(await api.post(`/fees/payments/${modal.cancel.id}/cancel`, { reason, ...scopeBody })); setLast(null); toast('Payment cancelled'); }} />}
      {modal?.void && <ReasonModal title="Remove adjustment" confirmLabel="Remove adjustment" onClose={() => setModal(null)}
        text={`${modal.void.amount < 0 ? 'The discount' : 'The extra charge'} of ${rupees(Math.abs(modal.void.amount))} (${modal.void.reason}) will stop applying. It stays in the history.`}
        onConfirm={async (reason) => { setD(await api.post(`/fees/adjustments/${modal.void.id}/void`, { reason, ...scopeBody })); toast('Adjustment removed'); }} />}
    </div>
  );
}

/* ===================================================================== STUDENT FEES (staff) */
export const StudentFees = scoped(function StudentFees({ me, sid }) {
  const [picked, setPicked] = useState(null);
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [classId, setClassId] = useState('');
  const { data: classes = [] } = useApi(`/fees/classes${qs(scopeQ(me, sid))}`);
  const { data: list, error: err } = useApi(`/fees/students${qs({ ...scopeQ(me, sid), q: dq, class_id: classId })}`, !picked, { keepPrevious: true });

  if (picked) return <Account me={me} sid={sid} studentId={picked.student_id} onBack={() => setPicked(null)} backLabel="Students" />;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="row">
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}><input autoFocus placeholder="Search by name, ID, admission or roll no." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} /><span style={{ position: 'absolute', left: 11, top: 10, color: 'var(--mute)' }}><Icon name="search" size={18} /></span></div>
        <select aria-label="Class" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.section ? ` ${c.section}` : ''}</option>)}</select>
      </div>
      {err && <div className="err">{err}</div>}
      {!list ? <Loading /> : list.length === 0 ? <Empty>No student found.</Empty> : (
        <div className="card" style={{ padding: 0 }}>{list.map((s) => (
          <button key={s.student_id} className="drow" onClick={() => setPicked(s)}>
            <span className="roll sm">{s.roll_no ?? '-'}</span>
            <div style={{ flex: 1, minWidth: 0 }}><b>{s.full_name}</b><small>Class {s.class_label}{s.admission_no ? ` - Adm. ${s.admission_no}` : ''} - {s.login_id}</small></div>
          </button>))}
          {list.length === 50 && <div className="muted" style={{ padding: 10, textAlign: 'center', fontSize: 13 }}>Showing the first 50. Type more of the name to narrow it down.</div>}
        </div>)}
    </div>
  );
});

/* ===================================================================== MY FEES (parent / student, read only) */
export function MyFees({ me }) {
  const { data: kids, error: err } = useApi('/fees/my'); const [open, setOpen] = useState(null);
  const single = kids?.length === 1;
  useEffect(() => { if (single) setOpen(kids[0].student_id); }, [single]); // eslint-disable-line

  if (err) return <div className="err">{err}</div>;
  if (!kids) return <Loading />;
  if (kids.length === 0) return <Empty>No student is linked to your account yet. Ask the school office.</Empty>;
  if (open) return <Account me={me} family studentId={open} onBack={single ? null : () => setOpen(null)} backLabel="My children" />;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="grid">{kids.map((k) => (
        <button key={k.student_id} className="mod" onClick={() => setOpen(k.student_id)}>
          <b>{k.full_name}</b><span>{k.class_label ? `Class ${k.class_label}` : 'No class'}</span>
          {k.summary && <em style={{ color: k.summary.due_till_date > 0 ? 'var(--a)' : 'var(--p)', fontWeight: 700, fontSize: 15 }}>{k.summary.due_till_date > 0 ? `${rupees(k.summary.due_till_date)} due` : k.summary.pending > 0 ? 'Nothing due yet' : 'All paid'}</em>}
        </button>))}</div>
    </div>
  );
}
