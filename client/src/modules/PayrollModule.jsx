import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { useData, useApi as useCachedApi } from '../cache.js';
import { Modal, Field, Badge, Empty, toast, Loading } from '../ui.jsx';
import { fetchers } from '../fetchers.js';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmt = (d) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const monthName = (p) => new Date(`${p.slice(0, 7)}-01T00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const span = (x) => (x.start_date === x.end_date ? fmt(x.start_date) : `${fmt(x.start_date)} to ${fmt(x.end_date)}`);
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const TONE = { pending: 'warn', approved: 'ok', rejected: 'off', cancelled: 'mute', draft: 'mute', finalized: 'info', paid: 'ok' };
const S = ({ s }) => <Badge tone={TONE[s]}>{s}</Badge>;
const dim = { color: 'var(--mute)', fontSize: 13 };
const balTone = (n) => (n < 0 ? 'var(--bad)' : 'var(--ink)');

// school (super admin picks one; everyone else is fixed to their own)
function useSchoolId(me) {
  const sup = me.role === 'super_admin';
  const { data: schools } = useData('schools', fetchers.schools, sup);
  const [pick, setPick] = useState('');
  const sid = sup ? (pick || schools?.[0]?.id || '') : me.school_id;
  const picker = sup && schools && <select style={{ width: 'auto' }} value={sid} onChange={(e) => setPick(e.target.value)}>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>;
  return { sid, picker, qs: sup ? `school_id=${sid}` : '' };
}
const withQs = (url, qs) => (qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url);
// cached GET: shows the last copy straight away, refreshes in the background; reload() forces a fresh fetch
function useApi(url) {
  const r = useCachedApi(url, !!url);
  return { data: r.data, error: r.error || '', reload: r.refresh };
}
const useRun = (reload) => {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = (fn, msg) => async (e) => { e?.preventDefault?.(); setErr(''); setBusy(true); try { const r = await fn(e); await reload?.(); if (msg) toast(typeof msg === 'function' ? msg(r) : msg); return r; } catch (x) { setErr(x.message); toast(x.message, true); } finally { setBusy(false); } };
  return { err, busy, run, setErr };
};

function Breakdown({ s }) {
  const b = s.breakdown || {}; const leaves = b.leaves || [];
  return (
    <div className="stack" style={{ gap: 10 }}>
      <table><tbody>
        <tr><td>Monthly salary</td><td style={{ textAlign: 'right' }}>{money(s.base_salary)}</td></tr>
        <tr><td>Leave cut <div style={dim}>{s.unpaid_days} day(s) × {money(s.rate_per_day)} per day</div></td><td style={{ textAlign: 'right', color: s.leave_deduction ? 'var(--bad)' : undefined }}>{s.leave_deduction ? `- ${money(s.leave_deduction)}` : money(0)}</td></tr>
        {(b.bonuses || []).map((x, i) => <tr key={`b${i}`}><td>Bonus: {x.label}</td><td style={{ textAlign: 'right', color: 'var(--ok)' }}>+ {money(x.amount)}</td></tr>)}
        {(b.deductions || []).map((x, i) => <tr key={`d${i}`}><td>Deduction: {x.label}</td><td style={{ textAlign: 'right', color: 'var(--bad)' }}>- {money(x.amount)}</td></tr>)}
        <tr><td><b>Net pay</b></td><td style={{ textAlign: 'right' }}><b>{money(s.net_pay)}</b></td></tr>
      </tbody></table>
      {leaves.length > 0 && <div className="card stack" style={{ gap: 6 }}><b>Leave taken this month</b>
        {leaves.map((l, i) => <div key={i} style={dim}>{l.type}: {l.taken} day(s) taken, {l.covered} covered by balance, <b style={{ color: l.cut ? 'var(--bad)' : 'inherit' }}>{l.cut} cut from salary</b> ({l.reason})</div>)}
        {leaves.some((l) => l.cut > 0 && l.reason === 'Balance ran out') && <div style={dim}>Days cut from salary are added back to your leave balance when the payslip is finalized, so you are never charged twice.</div>}
      </div>}
      <div style={dim}>Rate: salary ÷ {b.divisor} ({b.basis === 'working_days' ? 'working days in the month' : b.basis === 'calendar_days' ? 'days in the month' : 'fixed 30 days'})</div>
    </div>
  );
}

// =============================================================== employee: my leave & pay
function ApplyForm({ types, mode, onDone, sid, qs, onBehalfList }) {
  const blank = { leave_type_id: types[0]?.id || '', start_date: '', end_date: '', half_day: false, reason: '', user_id: '' };
  const [f, setF] = useState(blank);
  const { err, busy, run } = useRun();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form" onSubmit={run(async () => { await api.post(withQs('/payroll/leave', qs), { ...f, end_date: f.end_date || f.start_date, user_id: f.user_id || undefined }); setF(blank); await onDone(); }, onBehalfList ? 'Leave recorded' : mode === 'auto' ? 'Leave approved automatically' : 'Leave request sent for approval')}>
      {onBehalfList && <div className="full"><Field label="Employee" req><select required value={f.user_id} onChange={set('user_id')}><option value="">Choose...</option>{onBehalfList.map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name}</option>)}</select></Field></div>}
      <Field label="Leave type" req><select required value={f.leave_type_id} onChange={set('leave_type_id')}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_paid ? '' : ' (unpaid)'}</option>)}</select></Field>
      <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.half_day} onChange={(e) => setF({ ...f, half_day: e.target.checked, end_date: e.target.checked ? f.start_date : f.end_date })} />Half day (single date)</label>
      <Field label="From" req><input required type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.half_day ? e.target.value : f.end_date })} /></Field>
      <Field label="To"><input type="date" disabled={f.half_day} min={f.start_date} value={f.half_day ? f.start_date : f.end_date} onChange={set('end_date')} /></Field>
      <div className="full"><Field label="Reason" req><textarea value={f.reason} onChange={set('reason')} required={!onBehalfList} /></Field></div>
      {err && <div className="err full">{err}</div>}
      <button className="btn primary full" disabled={busy || !types.length} style={{ justifyContent: 'center' }}>{onBehalfList ? 'Record leave (approved)' : mode === 'auto' ? 'Apply (approved instantly)' : 'Send for approval'}</button>
      {!onBehalfList && <div className="full" style={dim}>Weekly offs and school holidays are not counted. Going over your balance is allowed, but the extra days are cut from that month's salary.</div>}
    </form>
  );
}

export function MyLeave({ me, action }) {
  const { sid, picker, qs } = useSchoolId(me);
  const { data, error, reload } = useApi(sid ? withQs('/payroll/me', qs) : null);
  const [slip, setSlip] = useState(null); const [apply, setApply] = useState(action === 'apply'); const [tab, setTab] = useState('leave');
  const { run } = useRun(reload);
  useEffect(() => { if (action === 'apply') history.replaceState(null, '', '#payroll/my'); }, []); // eslint-disable-line
  if (!me.school_id) return <Empty>Self-service is for school employees. Sign in as a staff member to use it.</Empty>;
  if (error) return <div className="err">{error}</div>;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="grid stats">
        {data.balances.length === 0 && <Empty>No leave types set up yet.</Empty>}
        {data.balances.map((b) => (
          <div key={b.type_id} className={`card stat ${b.balance < 0 ? 'bad' : b.balance === 0 ? 'warn' : 'ok'}`}><div style={dim}>{b.name} balance</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: balTone(b.balance) }}>{b.balance}</div>
            <div style={dim}>{b.balance < 0 ? 'Over by ' + Math.abs(b.balance) + ' day(s): extra days are cut from salary' : 'days available'}{b.pending ? ` · ${b.pending} pending` : ''}</div></div>))}
      </div>
      <div className="row sp"><div className="pills scroll">{[['leave', 'Leave history'], ['pay', 'Salary & payslips'], ['book', 'Balance history']].map(([k, l]) => <button key={k} className={`pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
        <button className="btn primary" onClick={() => setApply(true)}><span>Apply for leave</span></button></div>

      {tab === 'leave' && <div className="card stack" style={{ gap: 0 }}>
        {data.requests.length === 0 && <Empty>No leave applied yet.</Empty>}
        {data.requests.map((q) => (
          <div key={q.id} className={`doc st-${q.status}`}><div style={{ flex: 1 }}><b>{span(q)}</b> · {q.days} day(s){q.half_day ? ' (half)' : ''} · {data.types.find((t) => t.id === q.leave_type_id)?.name || 'Leave'}
            <div style={dim}>{q.reason}{q.decision_note ? ` · Note: ${q.decision_note}` : ''}{q.auto_approved ? ' · auto-approved' : ''}</div></div>
            <S s={q.status} />
            {(q.status === 'pending' || (q.status === 'approved' && q.start_date >= new Date().toLocaleDateString('en-CA'))) && <button className="btn" onClick={run(() => api.post(withQs(`/payroll/leave/${q.id}/cancel`, qs)), 'Cancelled')}>Cancel</button>}
          </div>))}
      </div>}

      {tab === 'pay' && <>
        {data.upcoming.length > 0 && <div className="card stack"><b>Coming up (estimate, not final)</b>
          {data.upcoming.map((u) => <div key={u.period} className="doc"><div style={{ flex: 1 }}><b>{monthName(u.period)}</b><div style={dim}>{u.unpaid_days ? `${u.unpaid_days} day(s) cut = -${money(u.leave_deduction)}` : 'No leave cut'}{u.bonus_total ? ` · bonus +${money(u.bonus_total)}` : ''}{u.other_deduction_total ? ` · deductions -${money(u.other_deduction_total)}` : ''} · {u.ended ? 'payment is being prepared' : 'month in progress'}</div></div><b>{money(u.net_pay)}</b></div>)}</div>}
        <div className="card stack" style={{ gap: 0 }}><b style={{ marginBottom: 6 }}>Payment history</b>
          {data.payslips.length === 0 && <Empty>No finalized payslips yet. Last month's salary appears here once payroll finalizes it.</Empty>}
          {data.payslips.map((p) => <button key={p.id} className="doc" style={{ background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', width: '100%' }} onClick={() => setSlip(p)}>
            <div style={{ flex: 1 }}><b>{monthName(p.period)}</b><div style={dim}>{p.status === 'paid' ? `Paid on ${fmt(p.payment_date)}${p.payment_method ? ` via ${p.payment_method}` : ''}` : 'Finalized, payment pending'}</div></div>
            <S s={p.status} /><b>{money(p.net_pay)}</b></button>)}</div>
        {!data.has_salary && <div style={dim}>Your salary hasn't been set yet, ask your admin.</div>}
      </>}

      {tab === 'book' && <div className="card stack" style={{ gap: 0 }}>
        {data.ledger.length === 0 && <Empty>Nothing yet.</Empty>}
        {data.ledger.map((x) => <div key={x.id} className="doc"><div style={{ flex: 1 }}>{x.note}<div style={dim}>{fmt(x.entry_date)} · {x.kind}</div></div><b style={{ color: x.days < 0 ? 'var(--bad)' : 'var(--ok)' }}>{x.days > 0 ? '+' : ''}{x.days}</b></div>)}</div>}

      {apply && <Modal title="Apply for leave" onClose={() => setApply(false)}><ApplyForm types={data.types} mode={data.approval_mode} qs={qs} onDone={async () => { await reload(); setApply(false); }} /></Modal>}
      {slip && <Modal title={`Payslip · ${monthName(slip.period)}`} onClose={() => setSlip(null)}><Breakdown s={slip} />{slip.status === 'paid' && <div style={dim}>Paid on {fmt(slip.payment_date)}{slip.payment_reference ? ` · Ref ${slip.payment_reference}` : ''}</div>}</Modal>}
    </div>
  );
}

// =============================================================== approver: all requests
export function LeaveRequests({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const [status, setStatus] = useState('pending');
  const { data, error, reload } = useApi(sid ? withQs(`/payroll/leave${status ? `?status=${status}` : ''}`, qs) : null);
  const { data: st } = useApi(sid ? withQs('/payroll/settings', qs) : null);
  const { data: emps } = useApi(sid && me.features.includes('leave_approve') ? withQs('/payroll/employees', qs) : null);
  const { run } = useRun(reload); const [note, setNote] = useState({}); const [rec, setRec] = useState(false);
  const can = me.features.includes('leave_approve');
  if (!sid) return <Empty>Create a school first.</Empty>;
  return (
    <div className="stack">
      <div className="row sp">{picker}<div className="pills scroll">{['pending', 'approved', 'rejected', 'cancelled', ''].map((s) => <button key={s} className={`pill t-${s || 'all'} ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s || 'all'}</button>)}</div>
        {can && st && <button className="btn" onClick={() => setRec(true)}>Record leave for someone</button>}</div>
      {st && <div style={dim}>Approval mode: <b>{st.settings.approval_mode === 'auto' ? 'automatic (requests are approved instantly)' : 'manual (needs an approver)'}</b></div>}
      {error && <div className="err">{error}</div>}
      {!data ? <Loading /> : data.length === 0 ? <Empty>No requests here.</Empty> : (
        <div className="card stack" style={{ gap: 0 }}>{data.map((q) => (
          <div key={q.id} className={`doc st-${q.status}`} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}><b>{q.employee?.full_name}</b> · {span(q)} · {q.days} day(s){q.half_day ? ' (half)' : ''}
              <div style={dim}>{st?.types.find((t) => t.id === q.leave_type_id)?.name} · {q.reason || 'no reason given'}</div>
              {q.decision_note && <div style={dim}>Note: {q.decision_note}{q.decider ? ` (${q.decider.full_name})` : ''}</div>}</div>
            <S s={q.status} />
            {can && q.status === 'pending' && <div className="row">
              <input style={{ width: 140 }} placeholder="Note (optional)" value={note[q.id] || ''} onChange={(e) => setNote({ ...note, [q.id]: e.target.value })} />
              <button className="btn primary" onClick={run(() => api.post(withQs(`/payroll/leave/${q.id}/approve`, qs), { note: note[q.id] }), 'Approved')}>Approve</button>
              <button className="btn danger" onClick={run(() => api.post(withQs(`/payroll/leave/${q.id}/reject`, qs), { note: note[q.id] }), 'Rejected')}>Reject</button></div>}
            {can && q.status === 'approved' && <button className="btn" onClick={() => confirm('Cancel this approved leave? The balance is restored.') && run(() => api.post(withQs(`/payroll/leave/${q.id}/cancel`, qs)), 'Cancelled')()}>Cancel leave</button>}
          </div>))}</div>)}
      {rec && st && emps && <Modal title="Record leave for an employee" onClose={() => setRec(false)}><ApplyForm types={st.types.filter((t) => t.is_active)} qs={qs} onBehalfList={emps} onDone={async () => { await reload(); setRec(false); }} /></Modal>}
    </div>
  );
}

// =============================================================== balances, grants
export function Balances({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const { data, error, reload } = useApi(sid ? withQs('/payroll/balances', qs) : null);
  const { data: st } = useApi(sid ? withQs('/payroll/settings', qs) : null);
  const [led, setLed] = useState(null); const [grant, setGrant] = useState(false);
  const canGrant = me.features.includes('leave_grant');
  const { run } = useRun();
  const types = st?.types.filter((t) => t.is_paid && t.is_active) || [];
  const openLedger = (e) => run(async () => setLed({ e, rows: await api.get(withQs(`/payroll/ledger/${e.user_id}`, qs)) }))();
  if (!sid) return <Empty>Create a school first.</Empty>;
  return (
    <div className="stack">
      <div className="row sp">{picker}{canGrant && <button className="btn primary" onClick={() => setGrant(true)}>Grant / allot leave</button>}</div>
      {error && <div className="err">{error}</div>}
      {!data || !st ? <Loading /> : (
        <div className="card" style={{ overflowX: 'auto' }}><table><thead><tr><th>Employee</th>{types.map((t) => <th key={t.id}>{t.name}</th>)}<th /></tr></thead><tbody>
          {data.map((e) => <tr key={e.user_id}><td><b>{e.full_name}</b><div style={dim}>{e.designation || e.login_id}</div></td>
            {types.map((t) => { const b = e.balances.find((x) => x.type_id === t.id); return <td key={t.id} style={{ color: balTone(b?.balance || 0), fontWeight: 600 }}>{b?.balance ?? 0}{b?.pending ? <span style={dim}> (+{b.pending} pending)</span> : null}</td>; })}
            <td><button className="btn" onClick={() => openLedger(e)}>History</button></td></tr>)}
        </tbody></table>{data.length === 0 && <Empty>No employees yet.</Empty>}</div>)}
      {led && <Modal title={`Leave book · ${led.e.full_name}`} onClose={() => setLed(null)}><div className="card stack" style={{ gap: 0 }}>
        {led.rows.length === 0 && <Empty>No entries.</Empty>}
        {led.rows.map((x) => <div key={x.id} className="doc"><div style={{ flex: 1 }}>{x.note}<div style={dim}>{fmt(x.entry_date)} · {x.kind}</div></div><b style={{ color: x.days < 0 ? 'var(--bad)' : 'var(--ok)' }}>{x.days > 0 ? '+' : ''}{x.days}</b></div>)}</div></Modal>}
      {grant && data && <Modal title="Grant / allot leave" onClose={() => setGrant(false)}><GrantForm types={types} emps={data} qs={qs} onDone={async () => { await reload(); setGrant(false); }} /></Modal>}
    </div>
  );
}
function GrantForm({ types, emps, qs, onDone }) {
  const year = new Date().getFullYear();
  const [f, setF] = useState({ kind: 'allotment', leave_type_id: types[0]?.id || '', days: '', note: '', period_key: `${year}-${year + 1}`, all: true, user_ids: [], effective_date: '' });
  const { err, busy, run } = useRun();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pick = (id) => setF({ ...f, user_ids: f.user_ids.includes(id) ? f.user_ids.filter((x) => x !== id) : [...f.user_ids, id] });
  const allot = f.kind === 'allotment';
  return (
    <form className="form" onSubmit={run(async () => { const body = { ...f, all: allot && f.all, effective_date: f.effective_date || undefined }; const r = await api.post(withQs('/payroll/grants', qs), body); await onDone(); return r; }, (r) => `Done for ${r.done} employee(s)${r.skipped ? `, ${r.skipped} already had it` : ''}`)}>
      <div className="full"><Field label="What are you doing?"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        <option value="allotment">Yearly allotment (uses the quota of the leave type, once per period)</option>
        <option value="grant">Grant extra days (bonus leave)</option>
        <option value="adjustment">Adjustment (+ or -, to fix a balance)</option></select></Field></div>
      <Field label="Leave type"><select value={f.leave_type_id} onChange={set('leave_type_id')}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}{allot ? ` (${t.annual_quota} days)` : ''}</option>)}</select></Field>
      {allot ? <Field label="Period" hint="Stops giving it twice"><input value={f.period_key} onChange={set('period_key')} /></Field> : <Field label="Days" hint="e.g. 2, 0.5, -1"><input type="number" step="0.5" value={f.days} onChange={set('days')} /></Field>}
      {!allot && <div className="full"><Field label="Note (visible to employee)" req><input required value={f.note} onChange={set('note')} /></Field></div>}
      <div className="full"><Field label="Effective date" hint="Leave empty for today. Use an earlier date only to cover a month not yet finalized."><input type="date" value={f.effective_date} onChange={set('effective_date')} /></Field></div>
      {allot && <label className="check full"><input type="checkbox" checked={f.all} onChange={(e) => setF({ ...f, all: e.target.checked })} />All employees</label>}
      {(!allot || !f.all) && <div className="checks full">{emps.map((e) => <label key={e.user_id} className="check"><input type="checkbox" checked={f.user_ids.includes(e.user_id)} onChange={() => pick(e.user_id)} />{e.full_name}</label>)}</div>}
      {err && <div className="err full">{err}</div>}
      <button className="btn primary full" disabled={busy || !f.leave_type_id} style={{ justifyContent: 'center' }}>Save</button>
    </form>
  );
}

// =============================================================== payroll
export function Payroll({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const [month, setMonth] = useState(prevMonth());
  const { data, error, reload } = useApi(sid ? withQs(`/payroll/payslips?period=${month}`, qs) : null);
  const { data: adj, reload: reloadAdj } = useApi(sid ? withQs(`/payroll/adjustments?period=${month}`, qs) : null);
  const { data: emps } = useApi(sid ? withQs('/payroll/employees', qs) : null);
  const { data: audit, reload: reloadAudit } = useApi(sid && me.features.includes('payroll_manage') ? withQs('/payroll/audit', qs) : null);
  const [open, setOpen] = useState(null); const [pay, setPay] = useState(null); const [showAdj, setShowAdj] = useState(false); const [showAudit, setShowAudit] = useState(false);
  const all = async () => { await Promise.all([reload(), reloadAdj(), reloadAudit()]); };
  const { run, busy } = useRun(all);
  const manage = me.features.includes('payroll_manage');
  if (!sid) return <Empty>Create a school first.</Empty>;
  const rows = data?.rows || [];
  const sum = (k) => rows.reduce((s, x) => s + Number(x[k]), 0);
  const nDraft = rows.filter((x) => x.status === 'draft').length, nFin = rows.filter((x) => x.status === 'finalized').length;
  const post = (url, body) => api.post(withQs(url, qs), body);
  return (
    <div className="stack">
      <div className="row sp">{picker}<div className="row"><input type="month" style={{ width: 'auto' }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        {manage && <>
          <button className="btn" disabled={busy || !data?.can_generate} title={data?.can_generate ? '' : 'Month has not ended'} onClick={run(() => post('/payroll/payslips/generate', { period: month }), (r) => `Prepared ${r.made} payslip(s)${r.noSalary.length ? `; no salary set for: ${r.noSalary.join(', ')}` : ''}`)}>Prepare / refresh</button>
          <button className="btn" disabled={busy || !nDraft} onClick={() => confirm(`Finalize ${nDraft} draft payslip(s)? Numbers lock and negative leave balances are settled.`) && run(() => post('/payroll/payslips/finalize-all', { period: month }), (r) => `Finalized ${r.done}${r.failed.length ? `. Skipped: ${r.failed.join(' | ')}` : ''}`)()}>Finalize all</button>
          <button className="btn primary" disabled={busy || !nFin} onClick={() => setPay({ all: true })}>Mark all paid</button></>}</div></div>
      {data && !data.can_generate && <div style={dim}>{monthName(`${month}-01`)} hasn't ended. Payroll for a month is prepared after it finishes. You can still add bonuses or deductions now.</div>}
      {error && <div className="err">{error}</div>}
      {data && rows.length > 0 && <div className="grid stats">
        <div className="card"><div style={dim}>Gross salaries</div><b>{money(sum('base_salary'))}</b></div>
        <div className="card"><div style={dim}>Leave cuts</div><b style={{ color: 'var(--bad)' }}>-{money(sum('leave_deduction'))}</b></div>
        <div className="card"><div style={dim}>Bonuses</div><b style={{ color: 'var(--ok)' }}>+{money(sum('bonus_total'))}</b></div>
        <div className="card"><div style={dim}>Net to pay</div><b>{money(sum('net_pay'))}</b></div></div>}
      {!data ? <Loading /> : (
        <div className="card" style={{ overflowX: 'auto' }}><table><thead><tr><th>Employee</th><th>Salary</th><th>Unpaid days</th><th>Leave cut</th><th>Bonus</th><th>Other cut</th><th>Net</th><th>Status</th></tr></thead><tbody>
          {rows.map((x) => <tr key={x.id} className="click" onClick={() => setOpen(x)}><td><b>{x.employee?.full_name}</b></td><td>{money(x.base_salary)}</td><td>{x.unpaid_days}</td><td>{money(x.leave_deduction)}</td><td>{money(x.bonus_total)}</td><td>{money(x.other_deduction_total)}</td><td><b>{money(x.net_pay)}</b></td><td><S s={x.status} /></td></tr>)}
        </tbody></table>
        {rows.length === 0 && <Empty>No payslips for {monthName(`${month}-01`)} yet. {manage && data.can_generate ? 'Press "Prepare / refresh".' : ''}</Empty>}
        {data.missing.some((m) => !m.has_salary) && <div style={dim}>No salary set (add in Users): {data.missing.filter((m) => !m.has_salary).map((m) => m.full_name).join(', ')}</div>}</div>)}

      <div className="card stack"><div className="row sp"><b>Bonuses & extra deductions · {monthName(`${month}-01`)}</b>{manage && emps && <button className="btn" onClick={() => setShowAdj(true)}>Add</button>}</div>
        {adj?.length === 0 && <span style={dim}>None.</span>}
        {adj?.map((a) => <div key={a.id} className="doc"><div style={{ flex: 1 }}><b>{a.employee?.full_name}</b> · {a.label}</div><b style={{ color: a.kind === 'bonus' ? 'var(--ok)' : 'var(--bad)' }}>{a.kind === 'bonus' ? '+' : '-'}{money(a.amount)}</b>
          {manage && !a.payslip_id && <button className="btn" onClick={run(() => api.del(withQs(`/payroll/adjustments/${a.id}`, qs)), 'Removed')}>Remove</button>}{a.payslip_id && <Badge>locked</Badge>}</div>)}
        <div style={dim}>Adjustments go on the payslip of the month you pick. After a payslip is finalized, add late items to the next month.</div></div>
      {manage && <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAudit(!showAudit)}>{showAudit ? 'Hide' : 'Show'} activity log</button>}
      {showAudit && audit && <div className="card stack" style={{ gap: 0 }}>{audit.map((a) => <div key={a.id} className="doc"><div style={{ flex: 1 }}>{a.action.replace(/_/g, ' ')}{a.target ? ` · ${a.target.full_name}` : ''}<div style={dim}>{a.actor?.full_name || 'system'} · {new Date(a.created_at).toLocaleString()} {a.detail?.period ? `· ${a.detail.period.slice(0, 7)}` : ''}</div></div></div>)}</div>}

      {open && <Modal title={`${open.employee?.full_name} · ${monthName(open.period)}`} onClose={() => setOpen(null)}>
        <Breakdown s={open} /><div className="row"><S s={open.status} />{open.status === 'paid' && <span style={dim}>Paid {fmt(open.payment_date)}{open.payment_method ? ` via ${open.payment_method}` : ''}{open.payment_reference ? ` · ${open.payment_reference}` : ''}</span>}</div>
        {manage && <div className="row">
          {open.status === 'draft' && <button className="btn primary" disabled={busy} onClick={run(async () => { await post(`/payroll/payslips/${open.id}/finalize`); setOpen(null); }, 'Finalized')}>Finalize</button>}
          {open.status === 'finalized' && <button className="btn primary" onClick={() => { setPay({ id: open.id }); }}>Mark paid</button>}
          {open.status === 'finalized' && <button className="btn" onClick={run(async () => { await post(`/payroll/payslips/${open.id}/reopen`); setOpen(null); }, 'Reopened as draft')}>Reopen</button>}</div>}</Modal>}
      {pay && <PayModal onClose={() => setPay(null)} onSubmit={run(async (b) => { await post(pay.all ? '/payroll/payslips/pay-all' : `/payroll/payslips/${pay.id}/pay`, pay.all ? { period: month, ...b } : b); setPay(null); setOpen(null); }, 'Marked as paid')} all={pay.all} />}
      {showAdj && emps && <Modal title="Bonus / extra deduction" onClose={() => setShowAdj(false)}><AdjForm emps={emps} month={month} onDone={async (b) => { await api.post(withQs('/payroll/adjustments', qs), b); await all(); setShowAdj(false); toast('Added'); }} /></Modal>}
    </div>
  );
}
function PayModal({ onClose, onSubmit, all }) {
  const [f, setF] = useState({ payment_date: new Date().toLocaleDateString('en-CA'), payment_method: 'Bank transfer', payment_reference: '' });
  return <Modal title={all ? 'Mark all finalized payslips paid' : 'Record payment'} onClose={onClose}><form className="form" onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
    <Field label="Payment date" req><input type="date" required value={f.payment_date} onChange={(e) => setF({ ...f, payment_date: e.target.value })} /></Field>
    <Field label="Method"><select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}>{['Bank transfer', 'UPI', 'Cheque', 'Cash'].map((m) => <option key={m}>{m}</option>)}</select></Field>
    <div className="full"><Field label="Reference / transaction no. (optional)"><input value={f.payment_reference} onChange={(e) => setF({ ...f, payment_reference: e.target.value })} /></Field></div>
    <button className="btn primary full" style={{ justifyContent: 'center' }}>Confirm paid</button></form></Modal>;
}
function AdjForm({ emps, month, onDone }) {
  const [f, setF] = useState({ user_id: '', kind: 'bonus', label: '', amount: '', period: month });
  const { err, busy, run } = useRun();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return <form className="form" onSubmit={run(() => onDone(f))}>
    <div className="full"><Field label="Employee" req><select required value={f.user_id} onChange={set('user_id')}><option value="">Choose...</option>{emps.map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name}</option>)}</select></Field></div>
    <Field label="Type"><select value={f.kind} onChange={set('kind')}><option value="bonus">Bonus (adds)</option><option value="deduction">Deduction (subtracts)</option></select></Field>
    <Field label="Month" req><input type="month" required value={f.period} onChange={set('period')} /></Field>
    <div className="full"><Field label="Reason (employee will see it)" req><input required value={f.label} onChange={set('label')} placeholder="Diwali bonus / Advance recovery" /></Field></div>
    <div className="full"><Field label="Amount (₹)" req><input required type="number" min="1" step="0.01" value={f.amount} onChange={set('amount')} /></Field></div>
    {err && <div className="err full">{err}</div>}
    <button className="btn primary full" disabled={busy} style={{ justifyContent: 'center' }}>Add</button></form>;
}

// =============================================================== rules
export function PaySettings({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const { data, error, reload } = useApi(sid ? withQs('/payroll/settings', qs) : null);
  const [f, setF] = useState(null); const [nt, setNt] = useState({ name: '', annual_quota: 12, is_paid: true });
  useEffect(() => { if (data) setF(data.settings); }, [data]);
  const { run } = useRun(reload);
  if (!sid) return <Empty>Create a school first.</Empty>;
  if (error) return <div className="err">{error}</div>;
  if (!data || !f) return <Loading />;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      {picker}
      <form className="card form" onSubmit={run(() => api.put(withQs('/payroll/settings', qs), f), 'Saved')}>
        <div className="sec">Approval</div>
        <div className="full"><Field label="When an employee applies for leave"><select value={f.approval_mode} onChange={(e) => setF({ ...f, approval_mode: e.target.value })}>
          <option value="manual">Needs approval (admin or anyone with the approve permission)</option><option value="auto">Approve automatically</option></select></Field></div>
        <div className="sec">Pay rules</div>
        <div className="full"><Field label="Weekly off days (not counted as leave)"><div className="checks">{DAYS.map((d, i) => <label key={d} className="check"><input type="checkbox" checked={f.weekly_off.includes(i)} onChange={(e) => setF({ ...f, weekly_off: e.target.checked ? [...f.weekly_off, i] : f.weekly_off.filter((x) => x !== i) })} />{d}</label>)}</div></Field></div>
        <div className="full"><Field label="Per-day salary used for cuts"><select value={f.rate_basis} onChange={(e) => setF({ ...f, rate_basis: e.target.value })}>
          <option value="working_days">Salary ÷ working days of that month</option><option value="calendar_days">Salary ÷ days in that month</option><option value="fixed_30">Salary ÷ 30</option></select></Field></div>
        <button className="btn primary full" style={{ justifyContent: 'center' }}>Save rules</button>
      </form>
      <div className="card stack"><b>Leave types</b>
        {data.types.map((t) => <div key={t.id} className="doc"><div style={{ flex: 1 }}><b>{t.name}</b><div style={dim}>{t.is_paid ? `${t.annual_quota} days per year` : 'Unpaid: every day is cut from salary'}</div></div>
          {!t.is_active && <Badge tone="off">off</Badge>}
          {t.is_paid && <button className="btn" onClick={() => { const v = prompt(`Yearly days for ${t.name}`, t.annual_quota); if (v !== null) run(() => api.patch(withQs(`/payroll/leave-types/${t.id}`, qs), { annual_quota: v }), 'Updated')(); }}>Quota</button>}
          <button className="btn" onClick={run(() => api.patch(withQs(`/payroll/leave-types/${t.id}`, qs), { is_active: !t.is_active }))}>{t.is_active ? 'Turn off' : 'Turn on'}</button></div>)}
        <form className="row" onSubmit={run(async () => { await api.post(withQs('/payroll/leave-types', qs), nt); setNt({ name: '', annual_quota: 12, is_paid: true }); }, 'Added')}>
          <input required style={{ flex: '2 1 150px' }} placeholder="Casual leave *" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />
          <input type="number" min="0" step="0.5" style={{ flex: '1 1 90px' }} disabled={!nt.is_paid} value={nt.annual_quota} onChange={(e) => setNt({ ...nt, annual_quota: e.target.value })} aria-label="Days per year" />
          <label className="check"><input type="checkbox" checked={nt.is_paid} onChange={(e) => setNt({ ...nt, is_paid: e.target.checked })} />Paid</label>
          <button className="btn">Add</button></form>
        <div style={dim}>Tip: add an unpaid type (untick Paid) like "Loss of pay" for leave that is always cut from salary. After creating types, give balances in Balances & grants.</div></div>
    </div>
  );
}
