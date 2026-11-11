// Admissions: overview, enquiries, pipeline board, add enquiry, reports. Talks to /api/admissions.
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Empty, Field, Modal, Badge, toast, Loading, ask, askText, initials, SearchInput } from '../ui.jsx';
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
  pending_documents: { label: 'Pending documents', tone: 'warn' }, shortlisted: { label: 'Shortlisted', tone: '' },
  admitted: { label: 'Admitted', tone: 'ok' }, rejected: { label: 'Rejected', tone: 'off' },
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
  if (n < 0) return <Badge tone="off">{n === -1 ? 'Overdue 1 day' : `Overdue ${-n} days`}</Badge>;
  if (n === 0) return <Badge tone="warn">Due today</Badge>;
  return <Badge tone="mute">{n === 1 ? 'Tomorrow' : fmtD(e.next_followup_on)}</Badge>;
}
const StageBadge = ({ stage }) => <Badge tone={STAGE[stage]?.tone}>{STAGE[stage]?.label || stage}</Badge>;
const Bar = ({ value, max = 100, tone }) => <div className="adm-bar"><i className={tone || ''} style={{ width: `${Math.max(2, Math.min(100, pct(value, max)))}%` }} /></div>;

/* ============================================================ ENQUIRY FORM FIELDS (add + edit) */
function EnquiryFields({ f, setF, meta }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
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
      <div className="full"><span className="adm-lbl">How did they find us?</span><div className="pills">{Object.entries(SRC).map(([k, v]) => <button type="button" key={k} className={`pill ${f.source === k ? 'on' : ''}`} onClick={() => setF({ ...f, source: k })}>{v}</button>)}</div></div>
      <Field label="Assigned to"><select value={f.assigned_to || ''} onChange={set('assigned_to')}><option value="">Me</option>{meta.staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}</select></Field>
      <Field label="Next follow-up"><input type="date" value={f.next_followup_on || ''} min={meta.today} onChange={set('next_followup_on')} /></Field>
      <div className="full"><Field label="Notes"><textarea rows={3} value={f.notes || ''} onChange={set('notes')} placeholder="What did the parent ask for?" maxLength={1000} /></Field></div>
    </>
  );
}
const blank = (meta) => ({ student_name: '', class_id: '', parent_name: '', phone: '', email: '', locality: '', gender: '', dob: '', source: 'walk_in', assigned_to: '', next_followup_on: meta?.today || '', notes: '' });

/* ============================================================ ADD ENQUIRY */
export const AddEnquiry = scoped(function AddEnquiry({ me, sid, go }) {
  const { data: meta, error } = useMeta(me, sid);
  const [f, setF] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  useEffect(() => { if (meta && !f) setF(blank(meta)); }, [meta]); // eslint-disable-line
  if (error) return <div className="err">{error}</div>;
  if (!meta || !f) return <Loading />;
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const row = await api.post('/admissions', { ...sq(me, sid), ...f }); setLast(row); toast('Enquiry added'); setF(blank(meta)); window.scrollTo?.(0, 0); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      {last && <div className="notice ok"><b>{last.student_name}</b> was added and a follow-up is set for {fmtD(last.next_followup_on) || 'later'}.{me.features.includes('view_enquiries') && <> <button className="linkbtn" onClick={() => go('list')}>See all enquiries</button></>}</div>}
      <form className="card form" onSubmit={save}>
        <EnquiryFields f={f} setF={setF} meta={meta} />
        {err && <div className="err full">{err}</div>}
        <button className="btn primary full big" disabled={busy || !f.student_name.trim() || !f.phone.trim()} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : 'Add enquiry'}</button>
      </form>
    </div>
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
        {error ? <div className="err" style={{ margin: 16 }}>{error}</div> : !e ? <div style={{ padding: 16 }}><Loading /></div> : (
          <>
            <header className="adm-dh">
              <div className="avatar big">{initials(e.student_name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}><h2>{e.student_name}</h2><div className="muted">{classText(e)} · {SRC[e.source]}{e.session_name ? ` · ${e.session_name}` : ''}</div></div>
              <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
            </header>
            <div className="adm-db">
              <div className="adm-steps" aria-label="Progress">
                {STEPS.map(([k, l], i) => <div key={k} className={`s ${i < stepIndex(e) ? 'done' : ''} ${i === stepIndex(e) && e.stage !== 'rejected' ? 'cur' : ''}`}><i />{l}</div>)}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><StageBadge stage={e.stage} /><DueChip e={e} today={today} />{e.stage === 'rejected' && e.lost_reason && <span className="muted">Reason: {e.lost_reason}</span>}</div>

              <div className="adm-actions">
                {e.phone && <a className="btn" href={`tel:${e.phone}`}><Icon name="phone" size={17} /> Call</a>}
                {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer"><Icon name="chat" size={17} /> WhatsApp</a>}
                {can('update_enquiry') && !closed && <button className="btn" onClick={() => setEdit({ ...e })}><Icon name="edit" size={17} /> Edit</button>}
              </div>

              {!closed && can('update_enquiry') && (
                <section className="card adm-sec">
                  <h3>Log a follow-up</h3>
                  <div className="pills">{['call', 'whatsapp', 'visit', 'email', 'note'].map((k) => <button key={k} className={`pill ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{KIND[k]}</button>)}</div>
                  <textarea rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="What was discussed?" maxLength={1000} />
                  <div className="adm-next"><Field label="Next follow-up"><input type="date" value={next} min={today} onChange={(ev) => setNext(ev.target.value)} /></Field>
                    <div className="pills">{[['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([l, n]) => <button key={l} className="pill" onClick={() => setNext(addDays(today, n))}>{l}</button>)}</div></div>
                  <button className="btn primary" disabled={busy || (kind === 'note' && !note.trim())} onClick={log}>Save follow-up</button>
                </section>
              )}

              {!closed && can('update_enquiry') && (
                <section className="card adm-sec">
                  <h3>Move to stage</h3>
                  <div className="pills">{['contacted', 'follow_up', 'pending_documents', 'shortlisted'].map((s) => <button key={s} className={`pill ${e.stage === s ? 'on' : ''}`} disabled={busy || e.stage === s} onClick={() => move(s)}>{STAGE[s].label}</button>)}
                    <button className="pill bad" disabled={busy} onClick={() => move('rejected')}>Reject / drop</button></div>
                  {e.stage === 'pending_documents' && e.missing_docs && <div className="muted">Missing: {e.missing_docs}</div>}
                </section>
              )}
              {e.stage === 'rejected' && can('update_enquiry') && <button className="btn" disabled={busy} onClick={() => move('contacted')}>Reopen enquiry</button>}

              {can('admit_student') && !closed && <button className="btn primary big adm-admit" disabled={busy} onClick={() => setAdmit(true)}><Icon name="userplus" size={18} /> Admit student</button>}
              {e.stage === 'admitted' && <div className="notice ok">Admitted {fmtD(e.admitted_at)}. The student profile was created from this enquiry.</div>}

              <section className="card adm-sec">
                <h3>Details</h3>
                <dl className="adm-dl">
                  <dt>Parent / guardian</dt><dd>{e.parent_name || '—'}</dd>
                  <dt>Phone</dt><dd>{e.phone || '—'}</dd>
                  {e.email && <><dt>Email</dt><dd>{e.email}</dd></>}
                  {e.locality && <><dt>Locality</dt><dd>{e.locality}</dd></>}
                  {e.dob && <><dt>Date of birth</dt><dd>{fmtD(e.dob)}</dd></>}
                  <dt>Assigned to</dt><dd>{e.assigned_name || '—'}</dd>
                  {e.notes && <><dt>Notes</dt><dd>{e.notes}</dd></>}
                </dl>
              </section>

              <section className="card adm-sec">
                <h3>History</h3>
                <ol className="adm-tl">{e.activity.map((a) => (
                  <li key={a.id}><i className={a.kind === 'stage' || a.kind === 'admitted' ? 'st' : ''} /><div><b>{a.kind === 'created' ? 'Enquiry added' : a.kind === 'stage' ? 'Stage changed' : a.kind === 'admitted' ? 'Admitted' : KIND[a.kind]}</b>{a.note && <p>{a.note}</p>}<small>{fmtDT(a.created_at)}{a.by_name ? ` · ${a.by_name}` : ''}</small></div></li>))}</ol>
              </section>
              {can('delete_enquiry') && <button className="linkbtn" style={{ alignSelf: 'flex-start', color: 'var(--bad)' }} onClick={del}>Delete enquiry</button>}
            </div>
          </>
        )}
      </aside>
      {edit && meta && <Modal title="Edit enquiry" wide onClose={() => setEdit(null)}><EditForm e={edit} meta={meta} q={q} onDone={() => { setEdit(null); refresh(); }} /></Modal>}
      {admit && e && meta && <Modal title={`Admit ${e.student_name}`} onClose={() => (done ? (setAdmit(false), onClose()) : setAdmit(false))}><AdmitForm e={e} meta={meta} q={q} done={done} setDone={setDone} onFinish={() => { setAdmit(false); setDone(null); onClose(); }} /></Modal>}
    </div>
  );
}

function EditForm({ e, meta, q, onDone }) {
  const [f, setF] = useState({ ...blank(meta), ...Object.fromEntries(Object.entries(e).filter(([, v]) => v != null)) });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (ev) => { ev.preventDefault(); setBusy(true); setErr(''); try { await api.patch(`/admissions/${e.id}${q}`, f); toast('Saved'); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return <form className="form" onSubmit={save}><EnquiryFields f={f} setF={setF} meta={{ ...meta, today: '' }} />{err && <div className="err full">{err}</div>}<button className="btn primary full big" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : 'Save changes'}</button></form>;
}

function AdmitForm({ e, meta, q, done, setDone, onFinish }) {
  const [classId, setClassId] = useState(e.class_id || ''); const [parent, setParent] = useState(true);
  const [pw, setPw] = useState(''); const [ppw, setPpw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (ev) => {
    ev.preventDefault(); setBusy(true); setErr('');
    try { setDone(await api.post(`/admissions/${e.id}/admit${q}`, { class_id: classId, create_parent: parent, password: pw, parent_password: ppw })); toast('Student admitted'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (done) {
    const text = `${e.student_name}\nAdmission no: ${done.student.admission_no}\nUser ID: ${done.student.login_id}\nPassword: ${done.student.password}${done.parent ? `\n\nParent user ID: ${done.parent.login_id}\nParent password: ${done.parent.password}` : ''}`;
    return (
      <div className="stack">
        <div className="notice ok"><b>{e.student_name}</b> is now a student (admission no. {done.student.admission_no}, roll no. {done.student.roll_no ?? '—'}). Share these sign-in details with the family — the passwords are shown only now.</div>
        <pre className="adm-cred">{text}</pre>
        <div className="row"><button className="btn" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Copied'))}>Copy details</button><button className="btn primary" onClick={onFinish}>Done</button></div>
      </div>
    );
  }
  return (
    <form className="form" onSubmit={submit}>
      <div className="full muted">Everything already entered for this enquiry is copied into the new student profile, with no duplicate typing.</div>
      <div className="full"><Field label="Admit into class" req><select required value={classId} onChange={(ev) => setClassId(ev.target.value)}><option value="">Choose class</option>{meta.classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}{c.section ? ` ${c.section}` : ''}</option>)}</select></Field></div>
      <label className="full adm-check"><input type="checkbox" checked={parent} onChange={(ev) => setParent(ev.target.checked)} /> Also create a parent login linked to this student</label>
      <Field label="Student password" hint="Leave blank to generate one"><input value={pw} onChange={(ev) => setPw(ev.target.value)} autoComplete="off" /></Field>
      {parent && <Field label="Parent password" hint="Leave blank to generate one"><input value={ppw} onChange={(ev) => setPpw(ev.target.value)} autoComplete="off" /></Field>}
      {err && <div className="err full">{err}</div>}
      <button className="btn primary full big" disabled={busy || !classId} style={{ justifyContent: 'center' }}>{busy ? 'Admitting...' : 'Confirm admission'}</button>
    </form>
  );
}

/* ============================================================ OVERVIEW */
export const AdmissionsHome = scoped(function AdmissionsHome({ me, sid, go }) {
  const { data: d, error } = useApi(`/admissions/summary${qs(sq(me, sid))}`, true, { keepPrevious: true });
  const [open, setOpen] = useState(null);
  if (error) return <div className="err">{error}</div>;
  if (!d) return <Loading />;
  const growth = d.created.last ? `${d.created.this >= d.created.last ? '↑' : '↓'} ${Math.abs(pct(d.created.this - d.created.last, d.created.last))}% vs last month` : `${d.created.this} this month`;
  const agrowth = d.admitted.last ? `${d.admitted.this >= d.admitted.last ? '↑' : '↓'} ${Math.abs(pct(d.admitted.this - d.admitted.last, d.admitted.last))}% vs last month` : `${d.admitted.this} this month`;
  const f = d.funnel;
  return (
    <div className="stack adm">
      <div className="adm-kpis">
        <div className="card adm-k"><span>Total enquiries</span><b>{d.total}</b><small className="up">{growth}</small></div>
        <div className="card adm-k"><span>Follow-ups due today</span><b>{d.due_count}</b><small className={d.overdue_count ? 'warn' : 'up'}>{d.overdue_count ? `${d.overdue_count} overdue` : 'Nothing overdue'}</small></div>
        <div className="card adm-k"><span>Applications in progress</span><b>{d.in_progress}</b><small>{d.awaiting_docs} awaiting documents</small></div>
        <div className="card adm-k"><span>Confirmed admissions</span><b>{d.by_stage.admitted}</b><small className="up">{agrowth}</small></div>
      </div>
      <div className="adm-grid">
        <section className="card" style={{ padding: 0 }}>
          <div className="adm-ch"><h3>Follow-ups to do</h3>{me.features.includes('view_enquiries') && <button className="linkbtn" onClick={() => go('list')}>All enquiries</button>}</div>
          {d.due.length === 0 ? <div style={{ padding: '4px 18px 18px' }}><Empty>You are all caught up. No follow-ups are due.</Empty></div> : d.due.map((e) => (
            <button key={e.id} className="drow" onClick={() => setOpen(e.id)}>
              <div className="avatar">{initials(e.student_name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}><b>{e.student_name}</b><small>{e.class_name ? `Class ${e.class_name}` : 'Class not set'}{e.assigned_name ? ` · ${e.assigned_name}` : ''}{e.note ? ` · ${e.note.slice(0, 60)}` : ''}</small></div>
              <DueChip e={e} today={d.today} />
            </button>))}
        </section>
        <section className="card">
          <h3 className="adm-h">Conversion funnel</h3>
          {f.map((s, i) => <div key={s.key} className="adm-f"><div><b>{s.label}</b><span>{s.n}{i > 0 && ` · ${pct(s.n, f[i - 1].n)}%`}</span></div><Bar value={s.n} max={f[0].n || 1} tone={s.key === 'admitted' ? 'ok' : ''} /></div>)}
          <h3 className="adm-h" style={{ marginTop: 22 }}>Source performance</h3>
          {d.sources.length === 0 ? <Empty>No data yet.</Empty> : d.sources.slice(0, 5).map((s) => <div key={s.source} className="adm-f"><div><b>{SRC[s.source]}</b><span>{s.total} · {pct(s.admitted, s.total)}% admitted</span></div><Bar value={s.admitted} max={s.total} /></div>)}
        </section>
      </div>
      {open && <EnquiryDrawer id={open} me={me} sid={sid} onClose={() => setOpen(null)} />}
    </div>
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
  return (
    <div className="stack adm">
      <div className="ds-toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search student, parent or phone" />
        <select aria-label="Class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{(meta?.classes || []).map((c) => <option key={c.id} value={c.id}>Class {c.name}{c.section ? ` ${c.section}` : ''}</option>)}</select>
        <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}><option value="">All sources</option>{Object.entries(SRC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {d?.rows.length > 0 && <button className="btn" onClick={exportCsv}><Icon name="download" size={17} /> Export</button>}
      </div>
      <div className="pills adm-views">{VIEWS.map(([k, l]) => <button key={k} className={`pill ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>{l}</button>)}</div>
      {error ? <div className="err">{error}</div> : !d ? <Loading /> : d.rows.length === 0 ? <Empty>{dq || source || cls || view !== 'all' ? 'No enquiries match these filters.' : 'No enquiries yet. Add the first one to start tracking admissions.'}</Empty> : (
        <div className="card" style={{ padding: 0 }}>
          <div className="adm-count">{d.total} enquir{d.total === 1 ? 'y' : 'ies'}{d.total > d.rows.length ? ` (showing latest ${d.rows.length})` : ''}</div>
          {d.rows.map((e) => (
            <button key={e.id} className="drow adm-row" onClick={() => setOpen(e.id)}>
              <div className="avatar">{initials(e.student_name)}</div>
              <div className="adm-main"><b>{e.student_name}</b><small>{classText(e)} · {SRC[e.source]}</small></div>
              <div className="adm-par hide-sm"><span>{e.parent_name || '—'}</span><small>{e.phone}</small></div>
              <div className="adm-st"><StageBadge stage={e.stage} /><DueChip e={e} today={d.today} /></div>
              <Icon name="chevron" size={18} />
            </button>))}
        </div>)}
      {open && <EnquiryDrawer id={open} me={me} sid={sid} onClose={() => setOpen(null)} />}
    </div>
  );
});

/* ============================================================ PIPELINE (board) */
const COLS = [['new', 'New', ['new']], ['contacted', 'Contacted', ['contacted', 'follow_up']], ['pending_documents', 'Pending documents', ['pending_documents']], ['shortlisted', 'Shortlisted', ['shortlisted']], ['admitted', 'Admitted', ['admitted']]];
export const Pipeline = scoped(function Pipeline({ me, sid }) {
  const { data: meta } = useMeta(me, sid);
  const [q, setQ] = useState(''); const [cls, setCls] = useState(''); const [open, setOpen] = useState(null);
  const { data: d, error } = useApi(`/admissions${qs({ ...sq(me, sid), class_id: cls })}`, true, { keepPrevious: true });
  const rows = useMemo(() => (d?.rows || []).filter((e) => !q || `${e.student_name} ${e.parent_name || ''} ${e.phone || ''}`.toLowerCase().includes(q.toLowerCase())), [d, q]);
  if (error) return <div className="err">{error}</div>;
  return (
    <div className="stack adm">
      <div className="ds-toolbar">
        <div className="adm-search"><Icon name="search" size={18} /><input placeholder="Search in pipeline" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{(meta?.classes || []).map((c) => <option key={c.id} value={c.id}>Class {c.name}{c.section ? ` ${c.section}` : ''}</option>)}</select>
      </div>
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
    </div>
  );
});

/* ============================================================ REPORTS */
export const AdmissionReports = scoped(function AdmissionReports({ me, sid }) {
  const { data: d, error } = useApi(`/admissions/summary${qs(sq(me, sid))}`, true, { keepPrevious: true });
  if (error) return <div className="err">{error}</div>;
  if (!d) return <Loading />;
  const f = d.funnel;
  return (
    <div className="stack adm">
      <div className="adm-grid">
        <section className="card">
          <h3 className="adm-h">Enquiry to admission</h3>
          {f.map((s, i) => <div key={s.key} className="adm-f"><div><b>{s.label}</b><span>{s.n}{i > 0 ? ` · ${pct(s.n, f[i - 1].n)}% of previous` : ''}</span></div><Bar value={s.n} max={f[0].n || 1} tone={s.key === 'admitted' ? 'ok' : ''} /></div>)}
          <p className="muted" style={{ marginTop: 14 }}>Overall conversion: <b>{pct(f[3].n, f[0].n)}%</b> of enquiries become admissions.</p>
        </section>
        <section className="card">
          <h3 className="adm-h">Drop-off reasons</h3>
          {d.drop_reasons.length === 0 ? <Empty>No rejected enquiries yet.</Empty> : d.drop_reasons.map((r) => <div key={r.reason} className="adm-f"><div><b>{r.reason}</b><span>{r.n}</span></div><Bar value={r.n} max={d.drop_reasons[0].n} tone="bad" /></div>)}
        </section>
      </div>
      <div className="adm-grid">
        <section className="card">
          <h3 className="adm-h">Source performance</h3>
          {d.sources.length === 0 ? <Empty>No data yet.</Empty> : d.sources.map((s) => <div key={s.source} className="adm-f"><div><b>{SRC[s.source]}</b><span>{s.admitted} of {s.total} · {pct(s.admitted, s.total)}%</span></div><Bar value={s.admitted} max={s.total} /></div>)}
        </section>
        <section className="card">
          <h3 className="adm-h">Locality analysis</h3>
          {d.localities.length === 0 ? <Empty>Add a locality on enquiries to see where families come from.</Empty> : d.localities.map((l) => <div key={l.locality} className="adm-f"><div><b>{l.locality}</b><span>{l.total} enquiries · {l.admitted} admitted</span></div><Bar value={l.total} max={d.localities[0].total} /></div>)}
        </section>
      </div>
    </div>
  );
});
