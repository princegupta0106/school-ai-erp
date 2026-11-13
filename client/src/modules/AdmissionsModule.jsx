// Admissions: overview, enquiries, pipeline board, add enquiry, reports. Talks to /api/admissions.
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Field, toast, Loading, ask, askText, initials, Page, PageBar, KpiGrid, Kpi, Section, List, ListRow, StatusBadge, EmptyState, FormDialog, FormGrid, Notice, Button, Choice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
import { scoped } from './AttendanceModule.jsx';

const sq = (me, sid) => (me.role === 'super_admin' ? { school_id: sid } : {});
const qs = (o) => { const p = new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))); const s = p.toString(); return s ? `?${s}` : ''; };
const D = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00`);
const fmtD = (s) => (s ? D(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtDT = (s) => new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const addDays = (iso, n) => { const d = D(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const diffDays = (a, b) => Math.round((D(a) - D(b)) / 86400000);

export const STAGE = {
  new: { label: 'New', tone: 'info' }, contacted: { label: 'Contacted', tone: 'mute' }, follow_up: { label: 'Follow-up', tone: 'warn' },
  pending_documents: { label: 'Pending documents', tone: 'warn' }, shortlisted: { label: 'Shortlisted', tone: 'info' },
  admitted: { label: 'Admitted', tone: 'ok' }, rejected: { label: 'Rejected', tone: 'bad' },
};
const STEPS = [['new', 'Enquiry'], ['contacted', 'Contacted'], ['pending_documents', 'Application'], ['shortlisted', 'Shortlisted'], ['admitted', 'Admitted']];
const stepIndex = (e) => (e.stage === 'rejected' ? Math.max(0, e.reached) : e.stage === 'follow_up' ? 1 : Math.max(0, STEPS.findIndex(([k]) => k === e.stage)));
const SRC = { online: 'Online form', walk_in: 'Walk-in', qr: 'QR code', referral: 'Referral', phone: 'Phone call', campaign: 'Campaign', other: 'Other' };
const KIND = { call: 'Call', whatsapp: 'WhatsApp', visit: 'Campus visit', email: 'Email', note: 'Note' };
const waLink = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `https://wa.me/${d.length === 10 ? `91${d}` : d}` : null; };
const useMeta = (me, sid) => useApi(`/admissions/meta${qs(sq(me, sid))}`, true, { keepPrevious: true });
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const classText = (e) => (e.class_name ? `Class ${e.class_name}` : 'Class not set');

function DueChip({ e, today }) {
  if (!e.next_followup_on || ['admitted', 'rejected'].includes(e.stage)) return null;
  const n = diffDays(e.next_followup_on, today);
  if (n < 0) return <StatusBadge tone="bad">{n === -1 ? 'Overdue 1 day' : `Overdue ${-n} days`}</StatusBadge>;
  if (n === 0) return <StatusBadge tone="warn">Due today</StatusBadge>;
  return <StatusBadge tone="mute">{n === 1 ? 'Tomorrow' : fmtD(e.next_followup_on)}</StatusBadge>;
}
const StageBadge = ({ stage }) => <StatusBadge tone={STAGE[stage]?.tone}>{STAGE[stage]?.label || stage}</StatusBadge>;
const Failed = ({ error }) => <Notice tone="bad">{error}</Notice>;
const Bar = ({ value, max = 100, tone }) => <div className="adm-bar"><i className={tone || ''} style={{ width: `${Math.max(2, Math.min(100, pct(value, max)))}%` }} /></div>;

/* ============================================================ ENQUIRY FORM FIELDS (add + edit) */
function EnquiryFields({ f, setF, meta }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <FormGrid>
      <Field label="Student name" req><input required value={f.student_name} onChange={set('student_name')} placeholder="Full name" maxLength={120} /></Field>
      <Field label="Applying for class">
        <select value={f.class_id || ''} onChange={set('class_id')}><option value="">Not decided</option>{meta.classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}{c.section ? ` ${c.section}` : ''}</option>)}</select>
      </Field>
      <Field label="Parent / guardian"><input value={f.parent_name || ''} onChange={set('parent_name')} placeholder="Name" maxLength={120} /></Field>
      <Field label="Phone" req><input required inputMode="tel" value={f.phone || ''} onChange={set('phone')} placeholder="10-digit mobile number" maxLength={20} /></Field>
      <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} placeholder="Optional" /></Field>
      <Field label="Locality / area" hint="Used in locality reports"><input value={f.locality || ''} onChange={set('locality')} placeholder="e.g. Baner" maxLength={80} /></Field>
      <Field label="Gender"><select value={f.gender || ''} onChange={set('gender')}><option value="">Not set</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field>
      <Field label="Date of birth"><input type="date" value={f.dob || ''} onChange={set('dob')} /></Field>
      <Field full label="How did they find us?"><Choice label="Source" value={f.source} onChange={(k) => setF({ ...f, source: k })} options={Object.entries(SRC).map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="Assigned to"><select value={f.assigned_to || ''} onChange={set('assigned_to')}><option value="">Me</option>{meta.staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}</select></Field>
      <Field label="Next follow-up"><input type="date" value={f.next_followup_on || ''} min={meta.today} onChange={set('next_followup_on')} /></Field>
      <Field full label="Notes"><textarea rows={3} value={f.notes || ''} onChange={set('notes')} placeholder="What did the parent ask for?" maxLength={1000} /></Field>
    </FormGrid>
  );
}
const blank = (meta) => ({ student_name: '', class_id: '', parent_name: '', phone: '', email: '', locality: '', gender: '', dob: '', source: 'walk_in', assigned_to: '', next_followup_on: meta?.today || '', notes: '' });

/* ============================================================ ADD ENQUIRY */
export const AddEnquiry = scoped(function AddEnquiry({ me, sid, go }) {
  const { data: meta, error } = useMeta(me, sid);
  const [f, setF] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  useEffect(() => { if (meta && !f) setF(blank(meta)); }, [meta]); // eslint-disable-line
  if (error) return <Page narrow><Failed error={error} /></Page>;
  if (!meta || !f) return <Page narrow><Loading /></Page>;
  const save = async () => {
    setBusy(true); setErr('');
    try { const row = await api.post('/admissions', { ...sq(me, sid), ...f }); setLast(row); toast('Enquiry added'); setF(blank(meta)); window.scrollTo?.(0, 0); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Page narrow>
      <PageBar title="Add enquiry" sub="Record a new admission enquiry" />
      {last && <Notice tone="ok" action={me.features.includes('view_enquiries') ? <Button size="sm" onClick={() => go('list')}>See all enquiries</Button> : null}><b>{last.student_name}</b> was added and a follow-up is set for {fmtD(last.next_followup_on) || 'later'}.</Notice>}
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="ds-stack">
        <Section><EnquiryFields f={f} setF={setF} meta={meta} /></Section>
        {err && <Notice tone="bad">{err}</Notice>}
        <div className="ds-spread"><span /><Button type="submit" kind="primary" loading={busy} disabled={!f.student_name.trim() || !f.phone.trim()}>Add enquiry</Button></div>
      </form>
    </Page>
  );
});

/* ============================================================ ENQUIRY DRAWER (history, follow-up, stage, admit) */
function EnquiryDrawer({ id, me, sid, onClose }) {
  const q = qs(sq(me, sid));
  const { data: e, error, refresh } = useApi(`/admissions/${id}${q}`, true, { keepPrevious: true });
  const { data: meta } = useMeta(me, sid);
  const [kind, setKind] = useState('call'); const [note, setNote] = useState(''); const [next, setNext] = useState(''); const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null); const [admit, setAdmit] = useState(false); const [done, setDone] = useState(null);
  useEffect(() => { const k = (ev) => ev.key === 'Escape' && !edit && !admit && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, edit, admit]);
  const can = (f) => me.features.includes(f);
  const today = meta?.today;
  useEffect(() => { if (e && today && !['admitted', 'rejected'].includes(e.stage)) setNext(e.next_followup_on && e.next_followup_on >= today ? e.next_followup_on : addDays(today, 1)); }, [e?.id, e?.next_followup_on, today]); // eslint-disable-line

  const run = async (fn, msg) => { setBusy(true); try { await fn(); toast(msg); await refresh(); } catch (x) { toast(x.message, true); } finally { setBusy(false); } };
  const log = () => run(async () => { await api.post(`/admissions/${id}/activity${q}`, { kind, note, next_followup_on: next || null }); setNote(''); }, 'Follow-up saved');
  const move = async (stage) => {
    const body = { stage };
    if (stage === 'rejected') { const r = await askText('Why is this enquiry being closed? (shows in drop-off reports)', '', { yes: 'Reject' }); if (r === null) return; if (!r.trim()) return toast('A reason is needed', true); body.reason = r; }
    if (stage === 'pending_documents') { const d = await askText('Which documents are still missing? (optional)', e.missing_docs || '', { yes: 'Move' }); if (d === null) return; body.missing_docs = d; }
    run(() => api.post(`/admissions/${id}/stage${q}`, body), `Moved to ${STAGE[stage].label}`);
  };
  const del = async () => { if (!(await ask(`Delete the enquiry for ${e.student_name}? This removes its history too.`))) return; try { await api.del(`/admissions/${id}${q}`); toast('Enquiry deleted'); onClose(); } catch (x) { toast(x.message, true); } };
  const wa = e && waLink(e.phone);
  const closed = e && ['admitted', 'rejected'].includes(e.stage);

  return (
    <div className="adm-scrim" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <aside className="adm-drawer" role="dialog" aria-label="Enquiry details">
        {error ? <div className="adm-pad"><Failed error={error} /></div> : !e ? <div className="adm-pad"><Loading /></div> : (
          <>
            <header className="adm-dh">
              <div className="avatar big">{initials(e.student_name)}</div>
              <div className="ds-grow"><h2>{e.student_name}</h2><div className="muted">{classText(e)} · {SRC[e.source]}{e.session_name ? ` · ${e.session_name}` : ''}</div></div>
              <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
            </header>
            <div className="adm-db">
              <div className="adm-steps" aria-label="Progress">
                {STEPS.map(([k, l], i) => <div key={k} className={`s ${i < stepIndex(e) ? 'done' : ''} ${i === stepIndex(e) && e.stage !== 'rejected' ? 'cur' : ''}`}><i />{l}</div>)}
              </div>
              <div className="ds-inline"><StageBadge stage={e.stage} /><DueChip e={e} today={today} />{e.stage === 'rejected' && e.lost_reason && <span className="muted">Reason: {e.lost_reason}</span>}</div>

              <div className="adm-actions">
                {e.phone && <a className="ds-btn ds-btn-secondary ds-btn-md" href={`tel:${e.phone}`}><Icon name="phone" size={17} /><span>Call</span></a>}
                {wa && <a className="ds-btn ds-btn-secondary ds-btn-md" href={wa} target="_blank" rel="noreferrer"><Icon name="chat" size={17} /><span>WhatsApp</span></a>}
                {can('update_enquiry') && !closed && <Button icon="edit" onClick={() => setEdit({ ...e })}>Edit</Button>}
              </div>

              {!closed && can('update_enquiry') && (
                <Section title="Log a follow-up">
                  <div className="ds-stack">
                    <Choice label="Kind" value={kind} onChange={setKind} options={['call', 'whatsapp', 'visit', 'email', 'note'].map((k) => ({ value: k, label: KIND[k] }))} />
                    <textarea rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="What was discussed?" maxLength={1000} />
                    <div className="adm-next"><Field label="Next follow-up"><input type="date" value={next} min={today} onChange={(ev) => setNext(ev.target.value)} /></Field>
                      <div className="ds-chips">{[['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([l, n]) => <Button key={l} size="sm" onClick={() => setNext(addDays(today, n))}>{l}</Button>)}</div></div>
                    <div className="ds-spread"><span /><Button kind="primary" loading={busy} disabled={kind === 'note' && !note.trim()} onClick={log}>Save follow-up</Button></div>
                  </div>
                </Section>
              )}

              {!closed && can('update_enquiry') && (
                <Section title="Move to stage">
                  <div className="ds-stack">
                    <div className="ds-chips">{['contacted', 'follow_up', 'pending_documents', 'shortlisted'].map((st) => <Button key={st} size="sm" disabled={busy || e.stage === st} onClick={() => move(st)}>{STAGE[st].label}</Button>)}
                      <Button size="sm" kind="danger" disabled={busy} onClick={() => move('rejected')}>Reject / drop</Button></div>
                    {e.stage === 'pending_documents' && e.missing_docs && <p className="ds-hint">Missing: {e.missing_docs}</p>}
                  </div>
                </Section>
              )}
              {e.stage === 'rejected' && can('update_enquiry') && <Button disabled={busy} onClick={() => move('contacted')}>Reopen enquiry</Button>}

              {can('admit_student') && !closed && <Button kind="primary" icon="userplus" disabled={busy} onClick={() => setAdmit(true)}>Admit student</Button>}
              {e.stage === 'admitted' && <Notice tone="ok">Admitted {fmtD(e.admitted_at)}. The student profile was created from this enquiry.</Notice>}

              <Section title="Details">
                <dl className="ds-kv">
                  <dt>Parent / guardian</dt><dd>{e.parent_name || '—'}</dd>
                  <dt>Phone</dt><dd>{e.phone || '—'}</dd>
                  {e.email && <><dt>Email</dt><dd>{e.email}</dd></>}
                  {e.locality && <><dt>Locality</dt><dd>{e.locality}</dd></>}
                  {e.dob && <><dt>Date of birth</dt><dd>{fmtD(e.dob)}</dd></>}
                  <dt>Assigned to</dt><dd>{e.assigned_name || '—'}</dd>
                  {e.notes && <><dt>Notes</dt><dd>{e.notes}</dd></>}
                </dl>
              </Section>

              <Section title="History">
                <ol className="adm-tl">{e.activity.map((a) => (
                  <li key={a.id}><i className={a.kind === 'stage' || a.kind === 'admitted' ? 'st' : ''} /><div><b>{a.kind === 'created' ? 'Enquiry added' : a.kind === 'stage' ? 'Stage changed' : a.kind === 'admitted' ? 'Admitted' : KIND[a.kind]}</b>{a.note && <p>{a.note}</p>}<small>{fmtDT(a.created_at)}{a.by_name ? ` · ${a.by_name}` : ''}</small></div></li>))}</ol>
              </Section>
              {can('delete_enquiry') && <div><Button kind="danger" size="sm" onClick={del}>Delete enquiry</Button></div>}
            </div>
          </>
        )}
      </aside>
      {edit && meta && <EditForm e={edit} meta={meta} q={q} onClose={() => setEdit(null)} onDone={() => { setEdit(null); refresh(); }} />}
      {admit && e && meta && <AdmitForm e={e} meta={meta} q={q} done={done} setDone={setDone} onClose={() => (done ? (setAdmit(false), onClose()) : setAdmit(false))} onFinish={() => { setAdmit(false); setDone(null); onClose(); }} />}
    </div>
  );
}

function EditForm({ e, meta, q, onDone, onClose }) {
  const [f, setF] = useState({ ...blank(meta), ...Object.fromEntries(Object.entries(e).filter(([, v]) => v != null)) });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setErr(''); try { await api.patch(`/admissions/${e.id}${q}`, f); toast('Saved'); onDone(); } catch (x) { setErr(x.message); setBusy(false); } };
  return <FormDialog title="Edit enquiry" wide onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Save changes"><EnquiryFields f={f} setF={setF} meta={{ ...meta, today: '' }} /></FormDialog>;
}

function AdmitForm({ e, meta, q, done, setDone, onFinish, onClose }) {
  const [classId, setClassId] = useState(e.class_id || ''); const [parent, setParent] = useState(true);
  const [pw, setPw] = useState(''); const [ppw, setPpw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr('');
    try { setDone(await api.post(`/admissions/${e.id}/admit${q}`, { class_id: classId, create_parent: parent, password: pw, parent_password: ppw })); toast('Student admitted'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (done) {
    const text = `${e.student_name}\nAdmission no: ${done.student.admission_no}\nUser ID: ${done.student.login_id}\nPassword: ${done.student.password}${done.parent ? `\n\nParent user ID: ${done.parent.login_id}\nParent password: ${done.parent.password}` : ''}`;
    return (
      <FormDialog title={`Admitted ${e.student_name}`} onClose={onClose} hideFooter>
        <Notice tone="ok"><b>{e.student_name}</b> is now a student (admission no. {done.student.admission_no}, roll no. {done.student.roll_no ?? '—'}). Share these sign-in details with the family. The passwords are shown only now.</Notice>
        <pre className="ds-code ds-pre">{text}</pre>
        <div className="ds-inline"><Button onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Copied'))}>Copy details</Button><Button kind="primary" onClick={onFinish}>Done</Button></div>
      </FormDialog>
    );
  }
  return (
    <FormDialog title={`Admit ${e.student_name}`} onClose={onClose} onSubmit={submit} busy={busy} error={err} submitLabel="Confirm admission" submitDisabled={!classId}>
      <FormGrid>
        <p className="ds-hint ds-full">Everything already entered for this enquiry is copied into the new student profile, with no duplicate typing.</p>
        <Field full label="Admit into class" req><select required value={classId} onChange={(ev) => setClassId(ev.target.value)}><option value="">Choose class</option>{meta.classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}{c.section ? ` ${c.section}` : ''}</option>)}</select></Field>
        <label className="ds-check ds-full"><input type="checkbox" checked={parent} onChange={(ev) => setParent(ev.target.checked)} /> Also create a parent login linked to this student</label>
        <Field label="Student password" hint="Leave blank to generate one"><input value={pw} onChange={(ev) => setPw(ev.target.value)} autoComplete="off" /></Field>
        {parent && <Field label="Parent password" hint="Leave blank to generate one"><input value={ppw} onChange={(ev) => setPpw(ev.target.value)} autoComplete="off" /></Field>}
      </FormGrid>
    </FormDialog>
  );
}

/* ============================================================ OVERVIEW */
const Avatar = ({ name }) => <span className="avatar">{initials(name)}</span>;
const Funnel = ({ rows, bar }) => rows.map((r) => <div key={r.key} className="adm-f"><div><b>{r.label}</b><span>{r.note}</span></div><Bar value={r.value} max={r.max} tone={r.tone} /></div>);

export const AdmissionsHome = scoped(function AdmissionsHome({ me, sid, go }) {
  const { data: d, error } = useApi(`/admissions/summary${qs(sq(me, sid))}`, true, { keepPrevious: true });
  const [open, setOpen] = useState(null);
  if (error) return <Page><Failed error={error} /></Page>;
  if (!d) return <Page><Loading /></Page>;
  const trend = (a, b) => (b ? `${a >= b ? '↑' : '↓'} ${Math.abs(pct(a - b, b))}% vs last month` : `${a} this month`);
  const f = d.funnel;
  return (
    <Page>
      <PageBar title="Admissions" sub="Overview of enquiries and follow-ups">{me.features.includes('view_enquiries') && <Button onClick={() => go('list')}>All enquiries</Button>}</PageBar>
      <KpiGrid>
        <Kpi label="Total enquiries" value={d.total} sub={trend(d.created.this, d.created.last)} />
        <Kpi label="Follow-ups due today" value={d.due_count} tone={d.overdue_count ? 'warn' : undefined} sub={d.overdue_count ? `${d.overdue_count} overdue` : 'Nothing overdue'} />
        <Kpi label="Applications in progress" value={d.in_progress} sub={`${d.awaiting_docs} awaiting documents`} />
        <Kpi label="Confirmed admissions" value={d.by_stage.admitted} tone="ok" sub={trend(d.admitted.this, d.admitted.last)} />
      </KpiGrid>
      <div className="adm-grid">
        <Section title="Follow-ups to do" flush>
          {d.due.length === 0 ? <EmptyState icon="check" title="All caught up">No follow-ups are due.</EmptyState> : (
            <List>{d.due.map((e) => (
              <ListRow key={e.id} onClick={() => setOpen(e.id)} lead={<Avatar name={e.student_name} />} title={e.student_name}
                sub={`${e.class_name ? `Class ${e.class_name}` : 'Class not set'}${e.assigned_name ? ` · ${e.assigned_name}` : ''}${e.note ? ` · ${e.note.slice(0, 60)}` : ''}`}
                meta={<DueChip e={e} today={d.today} />} />
            ))}</List>
          )}
        </Section>
        <div className="ds-stack">
          <Section title="Conversion funnel">
            <Funnel rows={f.map((x, i) => ({ key: x.key, label: x.label, note: `${x.n}${i > 0 ? ` · ${pct(x.n, f[i - 1].n)}%` : ''}`, value: x.n, max: f[0].n || 1, tone: x.key === 'admitted' ? 'ok' : '' }))} />
          </Section>
          <Section title="Source performance">
            {d.sources.length === 0 ? <EmptyState icon="sparkle" title="No data yet" /> : <Funnel rows={d.sources.slice(0, 5).map((x) => ({ key: x.source, label: SRC[x.source], note: `${x.total} · ${pct(x.admitted, x.total)}% admitted`, value: x.admitted, max: x.total }))} />}
          </Section>
        </div>
      </div>
      {open && <EnquiryDrawer id={open} me={me} sid={sid} onClose={() => setOpen(null)} />}
    </Page>
  );
});

/* ============================================================ ENQUIRIES (list) */
const VIEWS = [['all', 'All', {}], ['due', 'Due today', { due: 'today' }], ['late', 'Overdue', { due: 'overdue' }], ['new', 'New', { stage: 'new' }], ['pending_documents', 'Pending documents', { stage: 'pending_documents' }], ['shortlisted', 'Shortlisted', { stage: 'shortlisted' }], ['admitted', 'Admitted', { stage: 'admitted' }], ['rejected', 'Rejected', { stage: 'rejected' }]];
export const EnquiryList = scoped(function EnquiryList({ me, sid }) {
  const { data: meta } = useMeta(me, sid);
  const [view, setView] = useState('all'); const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [source, setSource] = useState(''); const [cls, setCls] = useState(''); const [open, setOpen] = useState(null);
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const params = { ...sq(me, sid), ...VIEWS.find((v) => v[0] === view)[2], q: dq, source, class_id: cls };
  const { data: d, error } = useApi(`/admissions${qs(params)}`, true, { keepPrevious: true });
  const exportCsv = () => {
    const rows = [['Student', 'Class', 'Parent', 'Phone', 'Source', 'Stage', 'Next follow-up', 'Assigned to', 'Added'], ...d.rows.map((e) => [e.student_name, e.class_name || '', e.parent_name || '', e.phone || '', SRC[e.source], STAGE[e.stage].label, e.next_followup_on || '', e.assigned_name || '', e.created_at.slice(0, 10)])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'admission-enquiries.csv'; a.click();
  };
  const filtered = dq || source || cls || view !== 'all';
  return (
    <Page>
      <PageBar title="Enquiries" sub={d ? `${d.total} enquir${d.total === 1 ? 'y' : 'ies'}${d.total > d.rows.length ? `, showing latest ${d.rows.length}` : ''}` : undefined}>
        {d?.rows.length > 0 && <Button icon="download" onClick={exportCsv}>Export</Button>}
      </PageBar>
      <FilterBar q={q} onQ={setQ} placeholder="Search student, parent or phone" count={d?.rows.length}
        filters={[
          { key: 'view', label: 'Show', value: view === 'all' ? '' : view, onChange: (v) => setView(v || 'all'), options: VIEWS.filter((v) => v[0] !== 'all').map(([k, l]) => ({ value: k, label: l })), all: 'All enquiries', chip: (v) => VIEWS.find((x) => x[0] === v)?.[1] },
          { key: 'cls', label: 'Class', value: cls, onChange: setCls, options: (meta?.classes || []).map((c) => ({ value: c.id, label: `Class ${c.name}${c.section ? ` ${c.section}` : ''}` })), all: 'All classes' },
          { key: 'source', label: 'Source', value: source, onChange: setSource, options: Object.entries(SRC).map(([k, v]) => ({ value: k, label: v })), all: 'All sources' },
        ]} />
      {error ? <Failed error={error} /> : !d ? <Loading /> : d.rows.length === 0 ? (
        <EmptyState icon="userplus" title={filtered ? 'No enquiries match these filters' : 'No enquiries yet'}>{filtered ? '' : 'Add the first one to start tracking admissions.'}</EmptyState>
      ) : (
        <Section flush>
          <List>{d.rows.map((e) => (
            <ListRow key={e.id} onClick={() => setOpen(e.id)} lead={<Avatar name={e.student_name} />} title={e.student_name}
              sub={`${classText(e)} · ${SRC[e.source]}${e.parent_name ? ` · ${e.parent_name}` : ''}${e.phone ? ` · ${e.phone}` : ''}`}
              meta={<><StageBadge stage={e.stage} /><DueChip e={e} today={d.today} /></>} />
          ))}</List>
        </Section>
      )}
      {open && <EnquiryDrawer id={open} me={me} sid={sid} onClose={() => setOpen(null)} />}
    </Page>
  );
});

/* ============================================================ PIPELINE (board) */
const COLS = [['new', 'New', ['new']], ['contacted', 'Contacted', ['contacted', 'follow_up']], ['pending_documents', 'Pending documents', ['pending_documents']], ['shortlisted', 'Shortlisted', ['shortlisted']], ['admitted', 'Admitted', ['admitted']]];
export const Pipeline = scoped(function Pipeline({ me, sid }) {
  const { data: meta } = useMeta(me, sid);
  const [q, setQ] = useState(''); const [cls, setCls] = useState(''); const [open, setOpen] = useState(null);
  const { data: d, error } = useApi(`/admissions${qs({ ...sq(me, sid), class_id: cls })}`, true, { keepPrevious: true });
  const rows = useMemo(() => (d?.rows || []).filter((e) => !q || `${e.student_name} ${e.parent_name || ''} ${e.phone || ''}`.toLowerCase().includes(q.toLowerCase())), [d, q]);
  if (error) return <Page><Failed error={error} /></Page>;
  return (
    <Page>
      <PageBar title="Pipeline" sub="Enquiries by stage" />
      <FilterBar q={q} onQ={setQ} placeholder="Search in pipeline"
        filters={[{ key: 'cls', label: 'Class', value: cls, onChange: setCls, options: (meta?.classes || []).map((c) => ({ value: c.id, label: `Class ${c.name}${c.section ? ` ${c.section}` : ''}` })), all: 'All classes' }]} />
      {!d ? <Loading /> : (
        <div className="adm-board">
          {COLS.map(([key, label, stages]) => {
            const items = rows.filter((e) => stages.includes(e.stage));
            return (
              <section key={key} className="adm-col" aria-label={label}>
                <div className="adm-colh"><b>{label}</b><span>{items.length}</span></div>
                <div className="adm-cards">
                  {items.length === 0 && <div className="adm-none">Nothing here</div>}
                  {items.slice(0, 40).map((e) => (
                    <button key={e.id} className="adm-card" onClick={() => setOpen(e.id)}>
                      <b>{e.student_name}</b><small>{classText(e)} · {SRC[e.source]}</small>
                      <div className="adm-cf"><DueChip e={e} today={d.today} />{e.assigned_name && <span className="avatar sm" title={e.assigned_name}>{initials(e.assigned_name)}</span>}</div>
                    </button>))}
                </div>
              </section>);
          })}
        </div>)}
      {open && <EnquiryDrawer id={open} me={me} sid={sid} onClose={() => setOpen(null)} />}
    </Page>
  );
});

/* ============================================================ REPORTS */
export const AdmissionReports = scoped(function AdmissionReports({ me, sid }) {
  const { data: d, error } = useApi(`/admissions/summary${qs(sq(me, sid))}`, true, { keepPrevious: true });
  if (error) return <Page><Failed error={error} /></Page>;
  if (!d) return <Page><Loading /></Page>;
  const f = d.funnel;
  return (
    <Page>
      <PageBar title="Admission reports" sub="Where enquiries come from and where they drop off" />
      <div className="adm-grid">
        <Section title="Enquiry to admission" sub={`Overall conversion: ${pct(f[3].n, f[0].n)}% of enquiries become admissions.`}>
          <Funnel rows={f.map((x, i) => ({ key: x.key, label: x.label, note: `${x.n}${i > 0 ? ` · ${pct(x.n, f[i - 1].n)}% of previous` : ''}`, value: x.n, max: f[0].n || 1, tone: x.key === 'admitted' ? 'ok' : '' }))} />
        </Section>
        <Section title="Drop-off reasons">
          {d.drop_reasons.length === 0 ? <EmptyState icon="check" title="No rejected enquiries yet" /> : <Funnel rows={d.drop_reasons.map((r) => ({ key: r.reason, label: r.reason, note: r.n, value: r.n, max: d.drop_reasons[0].n, tone: 'bad' }))} />}
        </Section>
      </div>
      <div className="adm-grid">
        <Section title="Source performance">
          {d.sources.length === 0 ? <EmptyState icon="sparkle" title="No data yet" /> : <Funnel rows={d.sources.map((x) => ({ key: x.source, label: SRC[x.source], note: `${x.admitted} of ${x.total} · ${pct(x.admitted, x.total)}%`, value: x.admitted, max: x.total }))} />}
        </Section>
        <Section title="Locality analysis">
          {d.localities.length === 0 ? <EmptyState icon="pin" title="No localities yet">Add a locality on enquiries to see where families come from.</EmptyState> : <Funnel rows={d.localities.map((l) => ({ key: l.locality, label: l.locality, note: `${l.total} enquiries · ${l.admitted} admitted`, value: l.total, max: d.localities[0].total }))} />}
        </Section>
      </div>
    </Page>
  );
});
