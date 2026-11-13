import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useData, useApi as useCachedApi } from '../cache.js';
import { Field, toast, Loading, ask, askText, Page, PageBar, Tabs, KpiGrid, Kpi, Section, DataTable, List, ListRow, StatusBadge, EmptyState, FormDialog, FormGrid, Notice, Button } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
import { fetchers } from '../fetchers.js';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmt = (d) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const monthName = (p) => new Date(`${p.slice(0, 7)}-01T00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const span = (x) => (x.start_date === x.end_date ? fmt(x.start_date) : `${fmt(x.start_date)} to ${fmt(x.end_date)}`);
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const TONE = { pending: 'warn', approved: 'ok', rejected: 'bad', cancelled: 'mute', draft: 'mute', finalized: 'info', paid: 'ok' };
const S = ({ s }) => <StatusBadge tone={TONE[s]}>{s}</StatusBadge>;
const balTone = (n) => (n < 0 ? 'bad' : n === 0 ? 'warn' : undefined);
const cap = (x) => x[0].toUpperCase() + x.slice(1);

// school (super admin picks one; everyone else is fixed to their own)
function useSchoolId(me) {
  const sup = me.role === 'super_admin';
  const { data: schools } = useData('schools', fetchers.schools, sup);
  const [pick, setPick] = useState('');
  const sid = sup ? (pick || schools?.[0]?.id || '') : me.school_id;
  const picker = sup && schools && <select value={sid} onChange={(e) => setPick(e.target.value)} aria-label="School">{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>;
  return { sid, picker, qs: sup ? `school_id=${sid}` : '' };
}
const withQs = (url, qs) => (qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url);
// cached GET: shows the last copy straight away, refreshes in the background; reload() forces a fresh fetch
function useApi(url) {
  const r = useCachedApi(url, !!url);
  return { data: r.data, error: r.error || '', reload: r.refresh };
}
// run(fn, msg, quiet): quiet = the error shows inside a dialog, so no toast
const useRun = (reload) => {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = (fn, msg, quiet) => async (e) => { e?.preventDefault?.(); setErr(''); setBusy(true); try { const r = await fn(e); await reload?.(); if (msg) toast(typeof msg === 'function' ? msg(r) : msg); return r; } catch (x) { setErr(x.message); if (!quiet) toast(x.message, true); } finally { setBusy(false); } };
  return { err, busy, run, setErr };
};
const Failed = ({ error, onRetry }) => <Notice tone="bad" action={onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : null}>{error}</Notice>;
const NoSchool = () => <Page><EmptyState icon="school" title="No school yet">Create a school first.</EmptyState></Page>;
const Amt = ({ n, sign }) => <b className={sign === '-' ? 'ds-c-bad' : sign === '+' ? 'ds-c-ok' : ''}>{sign}{money(n)}</b>;

function Breakdown({ s }) {
  const b = s.breakdown || {}; const leaves = b.leaves || [];
  return (
    <div className="ds-stack">
      <dl className="ds-kv">
        <dt>Monthly salary</dt><dd>{money(s.base_salary)}</dd>
        <dt>Leave cut</dt><dd className={s.leave_deduction ? 'ds-c-bad' : ''}>{s.leave_deduction ? `- ${money(s.leave_deduction)}` : money(0)}<span className="ds-subline">{s.unpaid_days} day(s) × {money(s.rate_per_day)} per day</span></dd>
        {(b.bonuses || []).map((x, i) => <React.Fragment key={`b${i}`}><dt>Bonus</dt><dd className="ds-c-ok">+ {money(x.amount)}<span className="ds-subline">{x.label}</span></dd></React.Fragment>)}
        {(b.deductions || []).map((x, i) => <React.Fragment key={`d${i}`}><dt>Deduction</dt><dd className="ds-c-bad">- {money(x.amount)}<span className="ds-subline">{x.label}</span></dd></React.Fragment>)}
        <dt><b>Net pay</b></dt><dd><b>{money(s.net_pay)}</b></dd>
      </dl>
      {leaves.length > 0 && (
        <Section title="Leave taken this month">
          <div className="ds-stack">
            {leaves.map((l, i) => <p key={i} className="ds-hint">{l.type}: {l.taken} day(s) taken, {l.covered} covered by balance, <b className={l.cut ? 'ds-c-bad' : ''}>{l.cut} cut from salary</b> ({l.reason})</p>)}
            {leaves.some((l) => l.cut > 0 && l.reason === 'Balance ran out') && <p className="ds-note">Days cut from salary are added back to your leave balance when the payslip is finalized, so you are never charged twice.</p>}
          </div>
        </Section>
      )}
      <p className="ds-note">Rate: salary ÷ {b.divisor} ({b.basis === 'working_days' ? 'working days in the month' : b.basis === 'calendar_days' ? 'days in the month' : 'fixed 30 days'})</p>
    </div>
  );
}

// =============================================================== employee: my leave & pay
function ApplyForm({ types, mode, onDone, qs, onBehalfList, onClose }) {
  const blank = { leave_type_id: types[0]?.id || '', start_date: '', end_date: '', half_day: false, reason: '', user_id: '' };
  const [f, setF] = useState(blank);
  const { err, busy, run } = useRun();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const msg = onBehalfList ? 'Leave recorded' : mode === 'auto' ? 'Leave approved automatically' : 'Leave request sent for approval';
  return (
    <FormDialog title={onBehalfList ? 'Record leave for an employee' : 'Apply for leave'} onClose={onClose} busy={busy} error={err} submitDisabled={!types.length}
      submitLabel={onBehalfList ? 'Record leave (approved)' : mode === 'auto' ? 'Apply (approved instantly)' : 'Send for approval'}
      onSubmit={run(async () => { await api.post(withQs('/payroll/leave', qs), { ...f, end_date: f.end_date || f.start_date, user_id: f.user_id || undefined }); setF(blank); await onDone(); }, msg, true)}>
      <FormGrid>
        {onBehalfList && <Field full label="Employee" req><select required value={f.user_id} onChange={set('user_id')}><option value="">Choose...</option>{onBehalfList.map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name}</option>)}</select></Field>}
        <Field label="Leave type" req><select required value={f.leave_type_id} onChange={set('leave_type_id')}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_paid ? '' : ' (unpaid)'}</option>)}</select></Field>
        <Field label="Half day"><label className="ds-check"><input type="checkbox" checked={f.half_day} onChange={(e) => setF({ ...f, half_day: e.target.checked, end_date: e.target.checked ? f.start_date : f.end_date })} />Half day (single date)</label></Field>
        <Field label="From" req><input required type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.half_day ? e.target.value : f.end_date })} /></Field>
        <Field label="To"><input type="date" disabled={f.half_day} min={f.start_date} value={f.half_day ? f.start_date : f.end_date} onChange={set('end_date')} /></Field>
        <Field full label="Reason" req={!onBehalfList}><textarea value={f.reason} onChange={set('reason')} required={!onBehalfList} /></Field>
        {!onBehalfList && <p className="ds-hint ds-full">Weekly offs and school holidays are not counted. Going over your balance is allowed, but the extra days are cut from that month's salary.</p>}
      </FormGrid>
    </FormDialog>
  );
}

const LedgerRows = ({ rows }) => (rows.length === 0 ? <EmptyState icon="doc" title="No entries" /> : (
  <List>{rows.map((x) => <ListRow key={x.id} title={x.note} sub={`${fmt(x.entry_date)} · ${x.kind}`} meta={<b className={x.days < 0 ? 'ds-c-bad' : 'ds-c-ok'}>{x.days > 0 ? '+' : ''}{x.days}</b>} />)}</List>
));

export function MyLeave({ me, action }) {
  const { sid, picker, qs } = useSchoolId(me);
  const { data, error, reload } = useApi(sid ? withQs('/payroll/me', qs) : null);
  const [slip, setSlip] = useState(null); const [apply, setApply] = useState(action === 'apply'); const [tab, setTab] = useState('leave');
  const { run } = useRun(reload);
  useEffect(() => { if (action === 'apply') history.replaceState(null, '', '#payroll/my'); }, []); // eslint-disable-line
  if (!me.school_id) return <Page><EmptyState icon="users" title="For school employees">Self-service is for school employees. Sign in as a staff member to use it.</EmptyState></Page>;
  if (error) return <Page><Failed error={error} onRetry={reload} /></Page>;
  if (!data) return <Page><Loading /></Page>;
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <Page>
      <PageBar title="My leave & pay" sub="Balances, leave history and payslips">{picker}<Button kind="primary" icon="plus" onClick={() => setApply(true)}>Apply for leave</Button></PageBar>
      {data.balances.length === 0 ? <EmptyState icon="calendar" title="No leave types yet">Your admin has not set up leave types.</EmptyState> : (
        <KpiGrid>{data.balances.map((b) => <Kpi key={b.type_id} label={`${b.name} balance`} value={b.balance} tone={balTone(b.balance)} sub={`${b.balance < 0 ? `Over by ${Math.abs(b.balance)} day(s): cut from salary` : 'days available'}${b.pending ? ` · ${b.pending} pending` : ''}`} />)}</KpiGrid>
      )}
      <Tabs value={tab} onChange={setTab} items={[{ key: 'leave', label: 'Leave history' }, { key: 'pay', label: 'Salary & payslips' }, { key: 'book', label: 'Balance history' }]} />

      {tab === 'leave' && (
        <Section flush>
          {data.requests.length === 0 ? <EmptyState icon="calendar" title="No leave applied yet" action={<Button kind="primary" onClick={() => setApply(true)}>Apply for leave</Button>} /> : (
            <List>{data.requests.map((q) => (
              <ListRow wrap key={q.id} title={`${span(q)} · ${q.days} day(s)${q.half_day ? ' (half)' : ''}`}
                sub={`${data.types.find((t) => t.id === q.leave_type_id)?.name || 'Leave'} · ${q.reason}${q.decision_note ? ` · Note: ${q.decision_note}` : ''}${q.auto_approved ? ' · auto-approved' : ''}`}
                meta={<S s={q.status} />}>
                {(q.status === 'pending' || (q.status === 'approved' && q.start_date >= today)) && <Button size="sm" onClick={run(() => api.post(withQs(`/payroll/leave/${q.id}/cancel`, qs)), 'Cancelled')}>Cancel</Button>}
              </ListRow>
            ))}</List>
          )}
        </Section>
      )}

      {tab === 'pay' && <>
        {!data.has_salary && <Notice tone="warn">Your salary has not been set yet. Ask your admin.</Notice>}
        {data.upcoming.length > 0 && (
          <Section title="Coming up" sub="Estimate, not final" flush>
            <List>{data.upcoming.map((u) => (
              <ListRow wrap key={u.period} title={monthName(u.period)}
                sub={`${u.unpaid_days ? `${u.unpaid_days} day(s) cut = -${money(u.leave_deduction)}` : 'No leave cut'}${u.bonus_total ? ` · bonus +${money(u.bonus_total)}` : ''}${u.other_deduction_total ? ` · deductions -${money(u.other_deduction_total)}` : ''} · ${u.ended ? 'payment is being prepared' : 'month in progress'}`}
                meta={<b>{money(u.net_pay)}</b>} />
            ))}</List>
          </Section>
        )}
        <Section title="Payment history" flush>
          {data.payslips.length === 0 ? <EmptyState icon="wallet" title="No finalized payslips yet">Last month's salary appears here once payroll finalizes it.</EmptyState> : (
            <List>{data.payslips.map((p) => (
              <ListRow key={p.id} onClick={() => setSlip(p)} title={monthName(p.period)}
                sub={p.status === 'paid' ? `Paid on ${fmt(p.payment_date)}${p.payment_method ? ` via ${p.payment_method}` : ''}` : 'Finalized, payment pending'}
                meta={<><S s={p.status} /><b>{money(p.net_pay)}</b></>} />
            ))}</List>
          )}
        </Section>
      </>}

      {tab === 'book' && <Section flush><LedgerRows rows={data.ledger} /></Section>}

      {apply && <ApplyForm types={data.types} mode={data.approval_mode} qs={qs} onClose={() => setApply(false)} onDone={async () => { await reload(); setApply(false); }} />}
      {slip && (
        <FormDialog title={`Payslip · ${monthName(slip.period)}`} onClose={() => setSlip(null)} hideFooter>
          <Breakdown s={slip} />
          {slip.status === 'paid' && <p className="ds-hint">Paid on {fmt(slip.payment_date)}{slip.payment_reference ? ` · Ref ${slip.payment_reference}` : ''}</p>}
        </FormDialog>
      )}
    </Page>
  );
}

// =============================================================== approver: all requests
export function LeaveRequests({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const [status, setStatus] = useState('');
  const { data, error, reload } = useApi(sid ? withQs(`/payroll/leave${status ? `?status=${status}` : ''}`, qs) : null);
  const { data: st } = useApi(sid ? withQs('/payroll/settings', qs) : null);
  const { data: emps } = useApi(sid && me.features.includes('leave_approve') ? withQs('/payroll/employees', qs) : null);
  const { run } = useRun(reload); const [note, setNote] = useState({}); const [rec, setRec] = useState(false);
  const can = me.features.includes('leave_approve');
  if (!sid) return <NoSchool />;
  return (
    <Page>
      <PageBar title="Leave requests" sub={st ? `Approval: ${st.settings.approval_mode === 'auto' ? 'automatic, requests are approved instantly' : 'manual, needs an approver'}` : undefined}>
        {picker}{can && st && <Button kind="primary" icon="plus" onClick={() => setRec(true)}>Record leave</Button>}
      </PageBar>
      <FilterBar filters={[{ key: 'status', label: 'Status', value: status, onChange: setStatus, all: 'All requests', options: ['pending', 'approved', 'rejected', 'cancelled'].map((x) => ({ value: x, label: cap(x) })) }]} />
      {error && <Failed error={error} onRetry={reload} />}
      {!data ? <Loading /> : data.length === 0 ? <EmptyState icon="calendar" title="No requests here" /> : (
        <Section flush>
          <List>{data.map((q) => (
            <ListRow wrap key={q.id} title={`${q.employee?.full_name} · ${span(q)} · ${q.days} day(s)${q.half_day ? ' (half)' : ''}`}
              sub={`${st?.types.find((t) => t.id === q.leave_type_id)?.name || 'Leave'} · ${q.reason || 'no reason given'}${q.decision_note ? ` · Note: ${q.decision_note}${q.decider ? ` (${q.decider.full_name})` : ''}` : ''}`}
              meta={<S s={q.status} />}>
              {can && q.status === 'pending' && <>
                <input className="ds-input-sm" placeholder="Note (optional)" aria-label="Note" value={note[q.id] || ''} onChange={(e) => setNote({ ...note, [q.id]: e.target.value })} />
                <Button size="sm" kind="primary" onClick={run(() => api.post(withQs(`/payroll/leave/${q.id}/approve`, qs), { note: note[q.id] }), 'Approved')}>Approve</Button>
                <Button size="sm" kind="danger" onClick={run(() => api.post(withQs(`/payroll/leave/${q.id}/reject`, qs), { note: note[q.id] }), 'Rejected')}>Reject</Button>
              </>}
              {can && q.status === 'approved' && <Button size="sm" onClick={async () => (await ask('Cancel this approved leave? The balance is restored.')) && run(() => api.post(withQs(`/payroll/leave/${q.id}/cancel`, qs)), 'Cancelled')()}>Cancel leave</Button>}
            </ListRow>
          ))}</List>
        </Section>
      )}
      {rec && st && emps && <ApplyForm types={st.types.filter((t) => t.is_active)} qs={qs} onBehalfList={emps} onClose={() => setRec(false)} onDone={async () => { await reload(); setRec(false); }} />}
    </Page>
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
  if (!sid) return <NoSchool />;
  const columns = data && st ? [
    { key: 'full_name', label: 'Employee', primary: true, render: (e) => <><b>{e.full_name}</b><span className="ds-subline">{e.designation || e.login_id}</span></> },
    ...types.map((t) => ({ key: `t${t.id}`, label: t.name, align: 'right', render: (e) => { const b = e.balances.find((x) => x.type_id === t.id); const tone = balTone(b?.balance || 0); return <><b className={tone ? `ds-c-${tone}` : ''}>{b?.balance ?? 0}</b>{b?.pending ? <span className="ds-subline">+{b.pending} pending</span> : null}</>; } })),
    { key: 'act', label: '', align: 'right', render: (e) => <Button size="sm" onClick={() => openLedger(e)}>History</Button> },
  ] : [];
  return (
    <Page>
      <PageBar title="Balances & grants" sub="Leave balance of every employee">{picker}{canGrant && <Button kind="primary" icon="plus" onClick={() => setGrant(true)}>Grant / allot leave</Button>}</PageBar>
      {error && <Failed error={error} />}
      {!data || !st ? <Loading /> : <Section flush><DataTable columns={columns} rows={data} rowKey={(e) => e.user_id} empty={<EmptyState icon="users" title="No employees yet" />} /></Section>}
      {led && <FormDialog title={`Leave book · ${led.e.full_name}`} onClose={() => setLed(null)} hideFooter><LedgerRows rows={led.rows} /></FormDialog>}
      {grant && data && <GrantForm types={types} emps={data} qs={qs} onClose={() => setGrant(false)} onDone={async () => { await reload(); setGrant(false); }} />}
    </Page>
  );
}
function GrantForm({ types, emps, qs, onDone, onClose }) {
  const year = new Date().getFullYear();
  const [f, setF] = useState({ kind: 'allotment', leave_type_id: types[0]?.id || '', days: '', note: '', period_key: `${year}-${year + 1}`, all: true, user_ids: [], effective_date: '' });
  const { err, busy, run } = useRun();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pick = (id) => setF({ ...f, user_ids: f.user_ids.includes(id) ? f.user_ids.filter((x) => x !== id) : [...f.user_ids, id] });
  const allot = f.kind === 'allotment';
  return (
    <FormDialog title="Grant / allot leave" onClose={onClose} busy={busy} error={err} submitDisabled={!f.leave_type_id}
      onSubmit={run(async () => { const body = { ...f, all: allot && f.all, effective_date: f.effective_date || undefined }; const r = await api.post(withQs('/payroll/grants', qs), body); await onDone(); return r; }, (r) => `Done for ${r.done} employee(s)${r.skipped ? `, ${r.skipped} already had it` : ''}`, true)}>
      <FormGrid>
        <Field full label="What are you doing?"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="allotment">Yearly allotment (uses the quota of the leave type, once per period)</option>
          <option value="grant">Grant extra days (bonus leave)</option>
          <option value="adjustment">Adjustment (+ or -, to fix a balance)</option></select></Field>
        <Field label="Leave type"><select value={f.leave_type_id} onChange={set('leave_type_id')}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}{allot ? ` (${t.annual_quota} days)` : ''}</option>)}</select></Field>
        {allot ? <Field label="Period" hint="Stops giving it twice"><input value={f.period_key} onChange={set('period_key')} /></Field> : <Field label="Days" hint="e.g. 2, 0.5, -1"><input type="number" step="0.5" value={f.days} onChange={set('days')} /></Field>}
        {!allot && <Field full label="Note (visible to employee)" req><input required value={f.note} onChange={set('note')} /></Field>}
        <Field full label="Effective date" hint="Leave empty for today. Use an earlier date only to cover a month not yet finalized."><input type="date" value={f.effective_date} onChange={set('effective_date')} /></Field>
        {allot && <label className="ds-check ds-full"><input type="checkbox" checked={f.all} onChange={(e) => setF({ ...f, all: e.target.checked })} />All employees</label>}
        {(!allot || !f.all) && <div className="ds-checks ds-full">{emps.map((e) => <label key={e.user_id} className="ds-check"><input type="checkbox" checked={f.user_ids.includes(e.user_id)} onChange={() => pick(e.user_id)} />{e.full_name}</label>)}</div>}
      </FormGrid>
    </FormDialog>
  );
}

// =============================================================== payroll
export function Payroll({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const [month, setMonth] = useState(prevMonth());
  const { data, error, reload } = useApi(sid ? withQs(`/payroll/payslips?period=${month}`, qs) : null);
  const { data: adj, reload: reloadAdj } = useApi(sid ? withQs(`/payroll/adjustments?period=${month}`, qs) : null);
  const { data: emps, reload: reloadEmps } = useApi(sid ? withQs('/payroll/employees', qs) : null);
  const { data: audit, reload: reloadAudit } = useApi(sid && me.features.includes('payroll_manage') ? withQs('/payroll/audit', qs) : null);
  const [open, setOpen] = useState(null); const [pay, setPay] = useState(null); const [showAdj, setShowAdj] = useState(false); const [showAudit, setShowAudit] = useState(false);
  const all = async () => { await Promise.all([reload(), reloadAdj(), reloadAudit()]); };
  const { run, busy } = useRun(all);
  const manage = me.features.includes('payroll_manage');
  if (!sid) return <NoSchool />;
  const rows = data?.rows || [];
  const sum = (k) => rows.reduce((s, x) => s + Number(x[k]), 0);
  const nDraft = rows.filter((x) => x.status === 'draft').length, nFin = rows.filter((x) => x.status === 'finalized').length;
  const post = (url, body) => api.post(withQs(url, qs), body);
  const columns = [
    { key: 'emp', label: 'Employee', primary: true, render: (x) => <b>{x.employee?.full_name}</b> },
    { key: 'base_salary', label: 'Salary', align: 'right', render: (x) => money(x.base_salary) },
    { key: 'unpaid_days', label: 'Unpaid days', align: 'right' },
    { key: 'leave_deduction', label: 'Leave cut', align: 'right', render: (x) => money(x.leave_deduction) },
    { key: 'bonus_total', label: 'Bonus', align: 'right', render: (x) => money(x.bonus_total) },
    { key: 'other_deduction_total', label: 'Other cut', align: 'right', render: (x) => money(x.other_deduction_total) },
    { key: 'net_pay', label: 'Net', align: 'right', render: (x) => <b>{money(x.net_pay)}</b> },
    { key: 'status', label: 'Status', render: (x) => <S s={x.status} /> },
  ];
  const missing = data?.missing.filter((m) => !m.has_salary) || [];
  return (
    <Page>
      <PageBar title="Payroll" sub={monthName(`${month}-01`)}>
        {picker}
        <input type="month" value={month} aria-label="Month" onChange={(e) => e.target.value && setMonth(e.target.value)} />
        {manage && <>
          <Button disabled={busy || !data?.can_generate} title={data?.can_generate ? '' : 'Month has not ended'} onClick={run(() => post('/payroll/payslips/generate', { period: month }), (r) => `Prepared ${r.made} payslip(s)${r.noSalary.length ? `; no salary set for: ${r.noSalary.join(', ')}` : ''}`)}>Prepare / refresh</Button>
          <Button disabled={busy || !nDraft} onClick={async () => (await ask(`Finalize ${nDraft} draft payslip(s)? Numbers lock and negative leave balances are settled.`)) && run(() => post('/payroll/payslips/finalize-all', { period: month }), (r) => `Finalized ${r.done}${r.failed.length ? `. Skipped: ${r.failed.join(' | ')}` : ''}`)()}>Finalize all</Button>
          <Button kind="primary" disabled={busy || !nFin} onClick={() => setPay({ all: true })}>Mark all paid</Button>
        </>}
      </PageBar>
      {data && !data.can_generate && <Notice tone="info">{monthName(`${month}-01`)} has not ended. Payroll for a month is prepared after it finishes. You can still add bonuses or deductions now.</Notice>}
      {error && <Failed error={error} onRetry={reload} />}
      {data && rows.length > 0 && (
        <KpiGrid>
          <Kpi label="Gross salaries" value={money(sum('base_salary'))} />
          <Kpi label="Leave cuts" value={`-${money(sum('leave_deduction'))}`} tone="bad" />
          <Kpi label="Bonuses" value={`+${money(sum('bonus_total'))}`} tone="ok" />
          <Kpi label="Net to pay" value={money(sum('net_pay'))} />
        </KpiGrid>
      )}
      {!data ? <Loading /> : (
        <Section flush>
          <DataTable columns={columns} rows={rows} onRowClick={setOpen}
            empty={<EmptyState icon="wallet" title={`No payslips for ${monthName(`${month}-01`)} yet`}>{manage && data.can_generate ? 'Press "Prepare / refresh".' : ''}</EmptyState>} />
        </Section>
      )}
      {missing.length > 0 && <Notice tone="warn">No salary set yet for: {missing.map((m) => m.full_name).join(', ')}. Set it in Staff salaries below.</Notice>}

      {manage && emps && <SalaryCard emps={emps} qs={qs} onSaved={async () => { await Promise.all([reloadEmps(), reload()]); }} />}
      <Reports qs={qs} month={month} />
      <Section title={`Bonuses & extra deductions · ${monthName(`${month}-01`)}`} sub="Adjustments go on the payslip of the month you pick. After a payslip is finalized, add late items to the next month." flush
        actions={manage && emps ? <Button size="sm" kind="primary" icon="plus" onClick={() => setShowAdj(true)}>Add</Button> : null}>
        {adj?.length ? (
          <List>{adj.map((a) => (
            <ListRow key={a.id} title={a.employee?.full_name} sub={a.label} meta={<><Amt n={a.amount} sign={a.kind === 'bonus' ? '+' : '-'} />{a.payslip_id && <StatusBadge tone="mute" dot={false}>locked</StatusBadge>}</>}>
              {manage && !a.payslip_id && <Button size="sm" kind="danger" onClick={run(() => api.del(withQs(`/payroll/adjustments/${a.id}`, qs)), 'Removed')}>Remove</Button>}
            </ListRow>
          ))}</List>
        ) : <EmptyState icon="wallet" title="None this month" />}
      </Section>
      {manage && <div className="ds-more"><Button kind="ghost" onClick={() => setShowAudit(!showAudit)}>{showAudit ? 'Hide' : 'Show'} activity log</Button></div>}
      {showAudit && audit && (
        <Section title="Activity log" flush>
          <List>{audit.map((a) => <ListRow key={a.id} title={`${a.action.replace(/_/g, ' ')}${a.target ? ` · ${a.target.full_name}` : ''}`} sub={`${a.actor?.full_name || 'system'} · ${new Date(a.created_at).toLocaleString()}${a.detail?.period ? ` · ${a.detail.period.slice(0, 7)}` : ''}`} />)}</List>
        </Section>
      )}

      {open && (
        <FormDialog title={`${open.employee?.full_name} · ${monthName(open.period)}`} onClose={() => setOpen(null)} hideFooter>
          <Breakdown s={open} />
          <div className="ds-inline"><S s={open.status} />{open.status === 'paid' && <span className="ds-hint">Paid {fmt(open.payment_date)}{open.payment_method ? ` via ${open.payment_method}` : ''}{open.payment_reference ? ` · ${open.payment_reference}` : ''}</span>}</div>
          {manage && (
            <div className="ds-inline">
              {open.status === 'draft' && <Button kind="primary" disabled={busy} onClick={run(async () => { await post(`/payroll/payslips/${open.id}/finalize`); setOpen(null); }, 'Finalized')}>Finalize</Button>}
              {open.status === 'finalized' && <Button kind="primary" onClick={() => setPay({ id: open.id })}>Mark paid</Button>}
              {open.status === 'finalized' && <Button onClick={run(async () => { await post(`/payroll/payslips/${open.id}/reopen`); setOpen(null); }, 'Reopened as draft')}>Reopen</Button>}
            </div>
          )}
        </FormDialog>
      )}
      {pay && <PayModal onClose={() => setPay(null)} all={pay.all} onSubmit={run(async (b) => { await post(pay.all ? '/payroll/payslips/pay-all' : `/payroll/payslips/${pay.id}/pay`, pay.all ? { period: month, ...b } : b); setPay(null); setOpen(null); }, 'Marked as paid')} busy={busy} />}
      {showAdj && emps && <AdjForm emps={emps} month={month} onClose={() => setShowAdj(false)} onDone={async (b) => { await api.post(withQs('/payroll/adjustments', qs), b); await all(); setShowAdj(false); toast('Added'); }} />}
    </Page>
  );
}
// monthly salary of every active employee; finance sets it here (no need to open Users)
function SalaryCard({ emps, qs, onSaved }) {
  const [edit, setEdit] = useState(null);
  const notSet = emps.filter((e) => !(e.salary > 0));
  return (
    <Section title="Staff salaries (monthly)" sub="Leave cuts and bonuses are added on top when payslips are prepared. Changing a salary affects draft payslips only after Prepare / refresh." flush
      actions={notSet.length > 0 ? <StatusBadge tone="warn">{notSet.length} not set</StatusBadge> : null}>
      {emps.length === 0 ? <EmptyState icon="users" title="No active staff yet">Add them in Users first.</EmptyState> : (
        <List>{emps.map((e) => (
          <ListRow key={e.user_id} title={e.full_name} sub={e.designation || e.login_id} meta={<b className={e.salary > 0 ? '' : 'ds-c-warn'}>{e.salary > 0 ? money(e.salary) : 'Not set'}</b>}>
            <Button size="sm" onClick={() => setEdit(e)}>{e.salary > 0 ? 'Change' : 'Set salary'}</Button>
          </ListRow>
        ))}</List>
      )}
      {edit && <SalaryForm emp={edit} qs={qs} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); await onSaved(); }} />}
    </Section>
  );
}
function SalaryForm({ emp, qs, onDone, onClose }) {
  const [v, setV] = useState(emp.salary > 0 ? String(emp.salary) : '');
  const { err, busy, run } = useRun();
  return (
    <FormDialog title={`Salary · ${emp.full_name}`} onClose={onClose} busy={busy} error={err} submitLabel="Save salary" onSubmit={run(async () => { await api.put(withQs(`/payroll/employees/${emp.user_id}/salary`, qs), { salary: v }); await onDone(); }, 'Salary saved', true)}>
      <Field label="Monthly salary (₹)" req hint="Gross per month, before leave cuts"><input autoFocus required type="number" min="0" step="0.01" value={v} onChange={(e) => setV(e.target.value)} /></Field>
    </FormDialog>
  );
}
// downloads: attendance register and salary register for the month picked above
function Reports({ qs, month }) {
  const [busy, setBusy] = useState('');
  const get = (kind, format) => async () => {
    setBusy(kind + format);
    try { await api.download(withQs(`/payroll/reports/${kind}?period=${month}&format=${format}`, qs), `${kind}-${month}.${format}`); }
    catch (x) { toast(x.message, true); }
    finally { setBusy(''); }
  };
  const wait = (k, idle) => (busy === k ? 'Preparing...' : idle);
  return (
    <Section title={`Reports · ${monthName(`${month}-01`)}`} sub="Attendance comes from approved leave: present days = working days minus leave. Weekly offs and school holidays are not counted. The current month is counted up to today.">
      <div className="ds-stack">
        <div className="ds-inline"><span className="ds-label">Attendance</span>
          <Button disabled={!!busy} onClick={get('attendance', 'csv')}>{wait('attendancecsv', 'Register (Excel / CSV)')}</Button>
          <Button disabled={!!busy} onClick={get('attendance', 'pdf')}>{wait('attendancepdf', 'Summary (PDF)')}</Button></div>
        <div className="ds-inline"><span className="ds-label">Salary</span>
          <Button disabled={!!busy} onClick={get('salary', 'csv')}>{wait('salarycsv', 'Register (Excel / CSV)')}</Button>
          <Button disabled={!!busy} onClick={get('salary', 'pdf')}>{wait('salarypdf', 'Register (PDF)')}</Button></div>
      </div>
    </Section>
  );
}

function PayModal({ onClose, onSubmit, all, busy }) {
  const [f, setF] = useState({ payment_date: new Date().toLocaleDateString('en-CA'), payment_method: 'Bank transfer', payment_reference: '' });
  return (
    <FormDialog title={all ? 'Mark all finalized payslips paid' : 'Record payment'} onClose={onClose} busy={busy} submitLabel="Confirm paid" onSubmit={() => onSubmit(f)}>
      <FormGrid>
        <Field label="Payment date" req><input type="date" required value={f.payment_date} onChange={(e) => setF({ ...f, payment_date: e.target.value })} /></Field>
        <Field label="Method"><select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}>{['Bank transfer', 'UPI', 'Cheque', 'Cash'].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field full label="Reference / transaction no. (optional)"><input value={f.payment_reference} onChange={(e) => setF({ ...f, payment_reference: e.target.value })} /></Field>
      </FormGrid>
    </FormDialog>
  );
}
function AdjForm({ emps, month, onDone, onClose }) {
  const [f, setF] = useState({ user_id: '', kind: 'bonus', label: '', amount: '', period: month });
  const { err, busy, run } = useRun();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="Bonus / extra deduction" onClose={onClose} busy={busy} error={err} submitLabel="Add" onSubmit={run(() => onDone(f), null, true)}>
      <FormGrid>
        <Field full label="Employee" req><select required value={f.user_id} onChange={set('user_id')}><option value="">Choose...</option>{emps.map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name}</option>)}</select></Field>
        <Field label="Type"><select value={f.kind} onChange={set('kind')}><option value="bonus">Bonus (adds)</option><option value="deduction">Deduction (subtracts)</option></select></Field>
        <Field label="Month" req><input type="month" required value={f.period} onChange={set('period')} /></Field>
        <Field full label="Reason (employee will see it)" req><input required value={f.label} onChange={set('label')} placeholder="Diwali bonus / Advance recovery" /></Field>
        <Field full label="Amount (₹)" req><input required type="number" min="1" step="0.01" value={f.amount} onChange={set('amount')} /></Field>
      </FormGrid>
    </FormDialog>
  );
}

// =============================================================== rules
export function PaySettings({ me }) {
  const { sid, picker, qs } = useSchoolId(me);
  const { data, error, reload } = useApi(sid ? withQs('/payroll/settings', qs) : null);
  const [f, setF] = useState(null); const [typeDlg, setTypeDlg] = useState(false);
  useEffect(() => { if (data) setF(data.settings); }, [data]);
  const { run, busy } = useRun(reload);
  if (!sid) return <NoSchool />;
  if (error) return <Page><Failed error={error} onRetry={reload} /></Page>;
  if (!data || !f) return <Page><Loading /></Page>;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <Page>
      <PageBar title="Leave rules" sub="Approval, pay rules and leave types">{picker}</PageBar>
      <form className="ds-stack" onSubmit={run(() => api.put(withQs('/payroll/settings', qs), f), 'Saved')}>
        <Section title="Approval and pay rules" actions={<Button type="submit" kind="primary" size="sm" loading={busy}>Save rules</Button>}>
          <FormGrid>
            <Field full label="When an employee applies for leave"><select value={f.approval_mode} onChange={(e) => setF({ ...f, approval_mode: e.target.value })}>
              <option value="manual">Needs approval (admin or anyone with the approve permission)</option><option value="auto">Approve automatically</option></select></Field>
            <Field full label="Weekly off days (not counted as leave)"><div className="ds-checks">{DAYS.map((d, i) => <label key={d} className="ds-check"><input type="checkbox" checked={f.weekly_off.includes(i)} onChange={(e) => setF({ ...f, weekly_off: e.target.checked ? [...f.weekly_off, i] : f.weekly_off.filter((x) => x !== i) })} />{d}</label>)}</div></Field>
            <Field full label="Per-day salary used for cuts"><select value={f.rate_basis} onChange={(e) => setF({ ...f, rate_basis: e.target.value })}>
              <option value="working_days">Salary ÷ working days of that month</option><option value="calendar_days">Salary ÷ days in that month</option><option value="fixed_30">Salary ÷ 30</option></select></Field>
          </FormGrid>
        </Section>
      </form>
      <Section title="Leave types" sub="Tip: add an unpaid type (untick Paid) like Loss of pay for leave that is always cut from salary. After creating types, give balances in Balances & grants." flush
        actions={<Button size="sm" kind="primary" icon="plus" onClick={() => setTypeDlg(true)}>Add type</Button>}>
        {data.types.length === 0 ? <EmptyState icon="calendar" title="No leave types yet" /> : (
          <List>{data.types.map((t) => (
            <ListRow key={t.id} title={t.name} sub={t.is_paid ? `${t.annual_quota} days per year` : 'Unpaid: every day is cut from salary'} meta={!t.is_active ? <StatusBadge tone="bad">Off</StatusBadge> : null}>
              {t.is_paid && <Button size="sm" onClick={async () => { const v = await askText(`Yearly days for ${t.name}`, t.annual_quota); if (v !== null) run(() => api.patch(withQs(`/payroll/leave-types/${t.id}`, qs), { annual_quota: v }), 'Updated')(); }}>Quota</Button>}
              <Button size="sm" onClick={run(() => api.patch(withQs(`/payroll/leave-types/${t.id}`, qs), { is_active: !t.is_active }))}>{t.is_active ? 'Turn off' : 'Turn on'}</Button>
            </ListRow>
          ))}</List>
        )}
      </Section>
      {typeDlg && <TypeDialog qs={qs} onClose={() => setTypeDlg(false)} onDone={reload} />}
    </Page>
  );
}
function TypeDialog({ qs, onClose, onDone }) {
  const [nt, setNt] = useState({ name: '', annual_quota: 12, is_paid: true });
  const { err, busy, run } = useRun(onDone);
  return (
    <FormDialog title="Add leave type" onClose={onClose} busy={busy} error={err} submitLabel="Add" onSubmit={run(async () => { await api.post(withQs('/payroll/leave-types', qs), nt); onClose(); }, 'Added', true)}>
      <FormGrid>
        <Field full label="Name" req><input autoFocus required value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} placeholder="Casual leave" /></Field>
        <Field label="Days per year"><input type="number" min="0" step="0.5" disabled={!nt.is_paid} value={nt.annual_quota} onChange={(e) => setNt({ ...nt, annual_quota: e.target.value })} /></Field>
        <Field label="Paid"><label className="ds-check"><input type="checkbox" checked={nt.is_paid} onChange={(e) => setNt({ ...nt, is_paid: e.target.checked })} />Paid leave</label></Field>
      </FormGrid>
    </FormDialog>
  );
}
