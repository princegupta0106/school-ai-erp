import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useData, useApi, setCached } from '../cache.js';
import { Icon, Modal, Empty, Field, Badge, toast, Loading } from '../ui.jsx';
import { scoped } from './AttendanceModule.jsx';
import { DESIGNS, designOf, TYPES, TYPE_LIST, PLACEHOLDERS, buildHTML, printHTML, defaultFields, resolveTemplate, sampleContent, fmtDate } from '../docRender.js';

// ---------------------------------------------------------------- helpers
const sup = (me) => me.role === 'super_admin';
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, v)); const s = p.toString(); return s ? `?${s}` : ''; };
const scopeQ = (me, sid) => (sup(me) ? { school_id: sid } : {});
const metaKey = (sid) => `docs:meta:${sid || 'own'}`;
const useMeta = (me, sid) => useData(metaKey(sid), () => api.get(`/documents/meta${qs(scopeQ(me, sid))}`));
const fmtStamp = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const typeLabel = (k) => TYPES[k]?.short || k;

function useDebounced(v, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

// a page drawn at its real size inside an iframe, scaled down to the width available
function DocPreview({ content, draft, cancelled }) {
  const html = useMemo(() => buildHTML(content, { draft, cancelled }), [content, draft, cancelled]);
  const land = content.orientation === 'landscape';
  const W = land ? 1123 : 794; const H = land ? 794 : 1123;
  const box = useRef(null); const [k, setK] = useState(0.5);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return undefined;
    const fit = () => setK(Math.min(1, (el.clientWidth || W) / W));
    fit(); const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [W]);
  return (
    <div ref={box} className="docprev" style={{ height: H * k }}>
      <iframe title="Document preview" sandbox="" srcDoc={html} style={{ width: W, height: H, transform: `scale(${k})` }} />
    </div>
  );
}

const printContent = (content, opts) => printHTML(buildHTML(content, opts));

// opens one issued document: preview + print (+ cancel for admins)
function DocViewer({ me, sid, id, onClose, onChanged }) {
  const [row, setRow] = useState(null); const [err, setErr] = useState(''); const [cancel, setCancel] = useState(false);
  useEffect(() => { api.get(`/documents/issued/${id}${qs(scopeQ(me, sid))}`).then(setRow).catch((e) => setErr(e.message)); }, [id]); // eslint-disable-line
  const canCancel = me.features.includes('cancel_document') && ['school_admin', 'super_admin'].includes(me.role);
  return (
    <Modal wide title={row ? `${row.title} - ${row.subject_name}` : 'Document'} onClose={onClose}>
      {err && <div className="err">{err}</div>}
      {!row && !err && <Loading />}
      {row && (<>
        <div className="row sp">
          <div className="muted">No. <b>{row.serial_no}</b> - issued {fmtStamp(row.issued_at)}{row.issued_by_name ? ` by ${row.issued_by_name}` : ''} {row.status === 'cancelled' && <Badge tone="off">Cancelled</Badge>}</div>
          <div className="row">
            {row.content && <button className="btn primary" onClick={() => printContent(row.content, { cancelled: row.status === 'cancelled' })}><Icon name="download" size={16} />Print / Save as PDF</button>}
            {canCancel && row.status === 'issued' && <button className="btn danger" onClick={() => setCancel(true)}>Cancel document</button>}
          </div>
        </div>
        {row.status === 'cancelled' && <div className="notice warn">Cancelled{row.cancel_reason ? `: ${row.cancel_reason}` : ''}. {row.content ? '' : 'Please contact the school office for a new one.'}</div>}
        {row.content ? <DocPreview content={row.content} cancelled={row.status === 'cancelled'} /> : null}
        <div className="muted small">Tip: in the print window choose "Save as PDF" to keep a digital copy. Turn on "Background graphics" if the borders do not appear.</div>
      </>)}
      {cancel && <CancelModal id={id} me={me} sid={sid} onClose={() => setCancel(false)} onDone={() => { setCancel(false); onChanged?.(); onClose(); }} />}
    </Modal>
  );
}

function CancelModal({ id, me, sid, onClose, onDone }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post(`/documents/issued/${id}/cancel${qs(scopeQ(me, sid))}`, { reason }); toast('Document cancelled'); onDone(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title="Cancel this document" onClose={onClose}><form className="form" onSubmit={go}>
      <div className="full muted">The document stays in the register as cancelled and can no longer be printed by the student or staff member. Its number is never reused.</div>
      <div className="full"><Field label="Reason (kept in the history)" req><input autoFocus required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      {err && <div className="err full">{err}</div>}
      <button className="btn danger full" disabled={busy || !reason.trim()} style={{ justifyContent: 'center' }}>{busy ? 'Please wait...' : 'Cancel document'}</button>
    </form></Modal>
  );
}

const Notice = ({ tone = 'info', children }) => <div className={`notice ${tone}`}>{children}</div>;

/* ===================================================================== ISSUE */
const SUBJECT_FIELDS = {
  student: [['name', 'Name'], ['class_label', 'Class'], ['roll_no', 'Roll no.'], ['admission_no', 'Admission no.'], ['father', "Father's name"], ['mother', "Mother's name"], ['dob', 'Date of birth', 'date'], ['gender', 'Gender', 'gender']],
  staff: [['name', 'Name'], ['designation', 'Designation'], ['department', 'Department'], ['employee_id', 'Employee ID'], ['joining_date', 'Joining date', 'date'], ['gender', 'Gender', 'gender']],
};

function PersonPicker({ me, sid, meta, kind, onPick }) {
  const [q, setQ] = useState(''); const [cls, setCls] = useState(''); const dq = useDebounced(q);
  const [rows, setRows] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    if (!dq.trim() && !cls) { setRows([]); return; }
    setBusy(true); setErr('');
    api.get(`/documents/people${qs({ ...scopeQ(me, sid), kind, q: dq.trim(), class_id: cls })}`).then(setRows).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  }, [dq, cls, kind]); // eslint-disable-line
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row">
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}><input autoFocus placeholder={kind === 'staff' ? 'Search staff by name, employee ID or login' : 'Search student by name, admission no. or login'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {kind === 'student' && <select style={{ width: 'auto' }} value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{(meta.classes || []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>}
      </div>
      {err && <div className="err">{err}</div>}
      {!rows.length && !busy && <div className="muted">{dq.trim() || cls ? 'No one found.' : `Type a name${kind === 'student' ? ' or pick a class' : ''} to find the ${kind}.`}</div>}
      <div className="plist">{rows.map((p) => (
        <button key={p.id} className="pitem" onClick={() => onPick(p)}>
          <b>{p.name}</b>
          <small>{kind === 'student' ? `${p.class_label || 'No class'}${p.roll_no ? ` - Roll ${p.roll_no}` : ''}${p.admission_no ? ` - Adm ${p.admission_no}` : ''}` : [p.designation, p.employee_id].filter(Boolean).join(' - ') || p.login_id}</small>
          {p.inactive && <Badge tone="off">Left / inactive</Badge>}
        </button>))}</div>
    </div>
  );
}

function ReportOptions({ pre, opts, setOpts }) {
  const R = pre.report; if (!R) return null;
  const toggle = (id) => { const cur = opts.exam_ids ?? R.available_exams.map((e) => e.exam_id); setOpts({ ...opts, exam_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }); };
  const chosen = opts.exam_ids ?? R.available_exams.map((e) => e.exam_id);
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="sec">Marks to print</div>
      <Field label="Session"><select value={opts.session_id || R.session_id || ''} onChange={(e) => setOpts({ session_id: e.target.value, exam_ids: null, include_tests: opts.include_tests })}>
        {R.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}</select></Field>
      {R.available_exams.length ? (
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted">Exams (each becomes a column)</span>
          {R.available_exams.map((e) => <label key={e.exam_id} className="chk"><input type="checkbox" checked={chosen.includes(e.exam_id)} onChange={() => toggle(e.exam_id)} /> {e.name}{e.pct !== null && e.pct !== undefined ? <small className="muted"> - {e.pct}%</small> : ''}</label>)}
        </div>
      ) : <Notice tone="warn">This student has no exam marks in this session. Marks are entered under Academics &gt; Tests &amp; marks.</Notice>}
      <label className="chk"><input type="checkbox" checked={!!opts.include_tests} onChange={(e) => setOpts({ ...opts, include_tests: e.target.checked })} /> Also show the average of class tests (Tests % column)</label>
    </div>
  );
}

export const IssueDocument = scoped(function IssueDocument({ me, sid, go }) {
  const { data: meta, error } = useMeta(me, sid);
  const [type, setType] = useState(''); const [kind, setKind] = useState('student');
  const [person, setPerson] = useState(null); const [pre, setPre] = useState(null);
  const [ropts, setRopts] = useState({ session_id: '', exam_ids: null, include_tests: false });
  const [form, setForm] = useState(null); const [fields, setFields] = useState({}); const [subject, setSubject] = useState({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(null);
  const bodyRef = useRef(null);
  const T = type ? TYPES[type] : null;

  const pickType = (k) => {
    setType(k); setPerson(null); setPre(null); setForm(null); setDone(null); setErr('');
    setKind(TYPES[k].kind.includes('student') ? 'student' : 'staff');
  };
  const reset = () => { setPerson(null); setPre(null); setForm(null); setDone(null); setErr(''); setRopts({ session_id: '', exam_ids: null, include_tests: false }); };

  // load details of the chosen person (and, for a report card, the marks)
  const loadPre = useCallback(async (p, opts, keepForm) => {
    setErr('');
    try {
      const r = await api.get(`/documents/people/${p.id}/prefill${qs({ ...scopeQ(me, sid), type, session_id: opts.session_id, exam_ids: opts.exam_ids ? opts.exam_ids.join(',') || 'none' : '', include_tests: opts.include_tests ? '1' : '' })}`);
      setPre(r);
      if (!keepForm) {
        const t = resolveTemplate(type, meta.templates[type], r.subject.kind);
        setForm(t); setSubject(r.subject);
        setFields(defaultFields(type, { session: r.session_name, today: meta.today, subject: r.subject }));
      }
    } catch (x) { setErr(x.message); if (!keepForm) setPerson(null); }
  }, [type, sid, meta]); // eslint-disable-line

  const pick = (p) => { setPerson(p); setPre(null); loadPre(p, ropts, false); };
  const setR = (o) => { setRopts(o); if (person) loadPre(person, o, true); };

  const content = useMemo(() => (pre && form ? {
    type, ...form, school: meta.letterhead, subject, fields, report: pre.report, session_name: pre.session_name, issued_on: meta.today, serial_no: '',
  } : null), [pre, form, subject, fields, type, meta]);

  const issue = async (andPrint) => {
    setBusy(true); setErr('');
    try {
      const row = await api.post(`/documents/issue${qs(scopeQ(me, sid))}`, {
        type, subject_id: person.id, title: form.title, body: form.body, design: form.design, accent: form.accent, orientation: form.orientation, inset: form.inset, bg_url: form.bg_url,
        subject, fields, report: type === 'report_card' ? { session_id: ropts.session_id || pre.report?.session_id, exam_ids: ropts.exam_ids ?? pre.report?.available_exams.map((e) => e.exam_id), include_tests: ropts.include_tests } : undefined,
      });
      setDone(row); toast(`Issued ${row.serial_no}`);
      if (andPrint) printContent(row.content);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  const insertAt = (key) => {
    const ta = bodyRef.current; const tok = `{{${key}}}`;
    if (!ta) { setForm({ ...form, body: `${form.body}${tok}` }); return; }
    const a = ta.selectionStart ?? form.body.length; const b = ta.selectionEnd ?? a;
    setForm({ ...form, body: form.body.slice(0, a) + tok + form.body.slice(b) });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(a + tok.length, a + tok.length); }, 0);
  };

  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;

  // ---- done
  if (done) return (
    <div className="stack">
      <div className="card stack">
        <div className="row"><Icon name="check" size={22} /><b style={{ fontSize: 18 }}>{done.title} issued to {done.subject_name}</b></div>
        <div className="muted">Number <b>{done.serial_no}</b>. {done.subject_role === 'student' ? 'The student and parents' : 'They'} can also see it under Documents &gt; My documents.</div>
        <div className="row">
          <button className="btn primary" onClick={() => printContent(done.content)}><Icon name="download" size={16} />Print / Save as PDF</button>
          <button className="btn" onClick={() => { const t = type; reset(); setType(t); }}>Issue another {typeLabel(type).toLowerCase()}</button>
          {me.features.some((f) => ['view_issued_documents', 'issue_documents'].includes(f)) && <button className="btn" onClick={() => go('issued')}>Open the register</button>}
        </div>
      </div>
      <DocPreview content={done.content} />
    </div>
  );

  return (
    <div className="stack">
      {/* 1. type */}
      <div className="card stack" style={{ gap: 10 }}>
        <div className="sec">1. What do you want to issue?</div>
        <div className="typegrid">{TYPE_LIST.map((t) => (
          <button key={t.key} className={`typecard ${type === t.key ? 'on' : ''}`} onClick={() => pickType(t.key)}><b>{t.short}</b><small>{t.desc}</small></button>))}</div>
      </div>

      {/* 2. person */}
      {T && !person && (<>
        <div className="row sp"><div className="sec" style={{ margin: 0 }}>2. Who is it for?</div>
          {T.kind.length > 1 && <div className="seg2">{T.kind.map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'student' ? 'Student' : 'Teacher / staff'}</button>)}</div>}
        </div>
        <PersonPicker key={`${type}-${kind}`} me={me} sid={sid} meta={meta} kind={kind} onPick={pick} />
        {err && <div className="err">{err}</div>}
      </>)}

      {/* 3. details */}
      {T && person && !content && !err && <Empty>Loading {person.name}...</Empty>}
      {T && person && err && !content && <div className="err">{err}</div>}
      {T && person && content && (
        <div className="docgrid">
          <div className="stack" style={{ minWidth: 0 }}>
            <div className="card row sp"><div><b>{subject.name}</b><div className="muted small">{T.label}{pre.inactive ? ' - this person has left / is inactive' : ''}</div></div><button className="btn" onClick={reset}>Change person</button></div>
            {type === 'report_card' && <ReportOptions pre={pre} opts={ropts} setOpts={setR} />}

            {T.fields.some((f) => !f.kind || f.kind === pre.subject.kind) && (
              <div className="card"><div className="sec">Details for this {typeLabel(type).toLowerCase()}</div>
                <div className="form" style={{ marginTop: 10 }}>{T.fields.filter((f) => !f.kind || f.kind === pre.subject.kind).map((f) => (
                  <div key={f.key} className={f.wide ? 'full' : ''}><Field label={f.label} req={f.required}>
                    {f.area ? <textarea rows={3} value={fields[f.key] || ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />
                      : <input type={f.type === 'date' ? 'date' : 'text'} placeholder={f.ph || ''} value={fields[f.key] || ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />}
                  </Field></div>))}</div></div>)}

            <details className="card">
              <summary><b>Details printed from the profile</b> <span className="muted small">- check, correct for this document only</span></summary>
              <div className="form" style={{ marginTop: 12 }}>{SUBJECT_FIELDS[pre.subject.kind].map(([k, label, t]) => (
                <Field key={k} label={label}>
                  {t === 'gender' ? <select value={subject[k] || ''} onChange={(e) => setSubject({ ...subject, [k]: e.target.value })}><option value="">-</option><option>Male</option><option>Female</option><option>Other</option></select>
                    : <input type={t === 'date' ? 'date' : 'text'} value={subject[k] ?? ''} onChange={(e) => setSubject({ ...subject, [k]: e.target.value })} />}
                </Field>))}</div>
              <div className="muted small" style={{ marginTop: 8 }}>Gender decides he / she, his / her in the wording. Changes here are not saved to the profile.</div>
            </details>

            <details className="card">
              <summary><b>Design &amp; wording</b> <span className="muted small">- {designOf(form.design).name}{T.layout === 'report' || T.layout === 'tc' ? '' : ', edit the text'}</span></summary>
              <div className="stack" style={{ marginTop: 12, gap: 12 }}>
                <div className="designs">{DESIGNS.map((d) => <button key={d.id} className={`dchip ${form.design === d.id ? 'on' : ''}`} onClick={() => setForm({ ...form, design: d.id, accent: d.accent })}><i style={{ background: d.accent }} />{d.name}</button>)}</div>
                <div className="form">
                  <Field label="Heading"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                  <Field label="Colour"><input type="color" value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} style={{ height: 42, padding: 4 }} /></Field>
                  <Field label="Page"><select value={form.orientation} onChange={(e) => setForm({ ...form, orientation: e.target.value })}><option value="portrait">Portrait (A4)</option><option value="landscape">Landscape (A4)</option></select></Field>
                </div>
                {T.layout !== 'tc' && T.layout !== 'report' && (<>
                  <Field label={T.layout === 'award' ? 'Text under the name' : 'Wording'} hint="Placeholders such as {{name}} are filled in automatically. Edit here only for this document - to change it for every document use Templates & designs.">
                    <textarea ref={bodyRef} rows={9} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
                  </Field>
                  <div className="phs">{PLACEHOLDERS.map(([k, l]) => <button type="button" key={k} className="ph" onClick={() => insertAt(k)} title={`{{${k}}}`}>{l}</button>)}</div>
                </>)}
                {(T.layout === 'tc' || T.layout === 'report') && <Field label={T.layout === 'report' ? 'Note at the bottom (grading scale)' : 'Closing line'}><textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>}
              </div>
            </details>

            {err && <div className="err">{err}</div>}
            <div className="row">
              <button className="btn primary big" disabled={busy} onClick={() => issue(true)}><Icon name="download" size={18} />{busy ? 'Issuing...' : 'Issue & print'}</button>
              <button className="btn big" disabled={busy} onClick={() => issue(false)}>Issue only</button>
            </div>
            <div className="muted small">Issuing gives the document its number and saves a copy that never changes. {kind === 'student' ? 'The student and parents' : 'The person'} will see it in Documents &gt; My documents.</div>
          </div>
          <div className="docside"><div className="sec" style={{ marginBottom: 8 }}>Live preview</div><DocPreview content={content} draft /></div>
        </div>
      )}
    </div>
  );
});

/* ===================================================================== REGISTER */
export const IssuedList = scoped(function IssuedList({ me, sid }) {
  const [type, setType] = useState(''); const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [page, setPage] = useState(0);
  const dq = useDebounced(q); const [open, setOpen] = useState(null);
  const { data: res, error: err, refresh: load } = useApi(`/documents/issued${qs({ ...scopeQ(me, sid), type, status, q: dq.trim(), page })}`, true, { keepPrevious: true });
  useEffect(() => { setPage(0); }, [type, status, dq]);
  return (
    <div className="stack">
      <div className="card row">
        <input style={{ flex: 1, minWidth: 180 }} placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{TYPE_LIST.map((t) => <option key={t.key} value={t.key}>{t.short}</option>)}</select>
        <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Issued &amp; cancelled</option><option value="issued">Issued</option><option value="cancelled">Cancelled</option></select>
      </div>
      {err && <div className="err">{err}</div>}
      {!res && !err && <Loading />}
      {res && !res.rows.length && <Empty>No documents yet.</Empty>}
      {res && res.rows.length > 0 && (
        <div className="card scrollx" style={{ padding: 0 }}>
          <table className="rt"><thead><tr><th>Number</th><th>Document</th><th>Issued to</th><th>Class</th><th>Date</th><th>By</th><th></th></tr></thead>
            <tbody>{res.rows.map((r) => (
              <tr key={r.id}><td><b>{r.serial_no}</b></td><td>{typeLabel(r.doc_type)} {r.status === 'cancelled' && <Badge tone="off">Cancelled</Badge>}</td><td>{r.subject_name}</td><td>{r.class_label || '-'}</td><td>{fmtStamp(r.issued_at)}</td><td>{r.issued_by_name || '-'}</td>
                <td><button className="btn" onClick={() => setOpen(r.id)}>Open</button></td></tr>))}</tbody></table>
        </div>)}
      {res && res.total > res.limit && (
        <div className="row sp"><span className="muted">{res.page * res.limit + 1}-{Math.min(res.total, (res.page + 1) * res.limit)} of {res.total}</span>
          <div className="row"><button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className="btn" disabled={(page + 1) * res.limit >= res.total} onClick={() => setPage(page + 1)}>Next</button></div></div>)}
      {open && <DocViewer me={me} sid={sid} id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
});

/* ===================================================================== MY DOCUMENTS */
export function MyDocuments({ me }) {
  const { data, error } = useData('docs:my', () => api.get('/documents/my'));
  const [open, setOpen] = useState(null);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <Loading />;
  const other = data.some((d) => !d.mine);
  return (
    <div className="stack">
      {!data.length && <Empty>No documents have been issued to you yet. Ask the school office if you need a certificate.</Empty>}
      <div className="mydocs">{data.map((d) => (
        <button key={d.id} className={`mydoc ${d.status}`} onClick={() => setOpen(d.id)}>
          <div className="mic"><Icon name="doc" size={20} /></div>
          <div className="mtx"><b>{d.title}</b>
            <small>{other && !d.mine ? `${d.subject_name} - ` : ''}No. {d.serial_no} - {fmtStamp(d.issued_at)}</small></div>
          {d.status === 'cancelled' && <Badge tone="off">Cancelled</Badge>}
        </button>))}</div>
      {open && <DocViewer me={me} id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ===================================================================== TEMPLATES & DESIGNS */
function ImageInput({ me, sid, kind, label, value, onChange, hint }) {
  const ref = useRef(null); const [busy, setBusy] = useState(false);
  const up = async () => {
    const f = ref.current.files[0]; if (!f) return;
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', f); fd.append('kind', kind); const r = await api.post(`/documents/images${qs(scopeQ(me, sid))}`, fd); onChange(r.url); toast('Image uploaded - remember to Save'); } catch (x) { toast(x.message, true); } finally { setBusy(false); ref.current.value = ''; }
  };
  return (
    <Field label={label} hint={hint}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input placeholder="https://... (link to an image)" value={value || ''} onChange={(e) => onChange(e.target.value)} />
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={up} />
        <button type="button" className="btn" disabled={busy} onClick={() => ref.current.click()}><Icon name="upload" size={16} />{busy ? '...' : 'Upload'}</button>
        {value && <button type="button" className="btn" onClick={() => onChange('')} aria-label="Remove"><Icon name="x" size={16} /></button>}
      </div>
    </Field>
  );
}

export const Templates = scoped(function Templates({ me, sid }) {
  const { data: meta, error } = useMeta(me, sid);
  const [type, setType] = useState('bonafide'); const [t, setT] = useState(null); const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const T = TYPES[type];
  useEffect(() => {
    if (!meta) return;
    const saved = meta.templates[type]; const r = resolveTemplate(type, saved, 'student');
    setT({ ...r, body_staff: saved?.settings?.body_staff ?? (T.bodyStaff || ''), has: !!saved });
  }, [meta, type]); // eslint-disable-line
  const draft = useMemo(() => (t && meta ? sampleContent(type, meta.letterhead, { ...t, settings: { inset: t.inset, body_staff: t.body_staff } }) : null), [t, meta, type]);
  const save = async () => {
    setBusy(true);
    try {
      const m = await api.put(`/documents/templates/${type}${qs(scopeQ(me, sid))}`, { title: t.title, body: t.body, body_staff: t.body_staff, design: t.design, accent: t.accent, orientation: t.orientation, bg_url: t.bg_url, settings: { inset: t.inset } });
      setCached(metaKey(sid), m); toast('Saved - new documents will use this');
    } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!confirm('Go back to the built-in wording and design for this document?')) return;
    setBusy(true);
    try { setCached(metaKey(sid), await api.del(`/documents/templates/${type}${qs(scopeQ(me, sid))}`)); toast('Reset to default'); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const insertAt = (key) => {
    const ta = bodyRef.current; const tok = `{{${key}}}`; const a = ta?.selectionStart ?? t.body.length; const b = ta?.selectionEnd ?? a;
    setT({ ...t, body: t.body.slice(0, a) + tok + t.body.slice(b) });
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(a + tok.length, a + tok.length); }, 0);
  };
  if (error) return <div className="err">{error}</div>;
  if (!meta || !t) return <Loading />;
  const free = T.layout !== 'tc' && T.layout !== 'report';
  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 10 }}>
        <div className="sec">Document</div>
        <div className="designs">{TYPE_LIST.map((x) => <button key={x.key} className={`dchip ${type === x.key ? 'on' : ''}`} onClick={() => setType(x.key)}>{x.short}{meta.templates[x.key] ? ' *' : ''}</button>)}</div>
        <div className="muted small">* has a saved school version. Anything not saved uses the built-in wording.</div>
      </div>
      <div className="docgrid">
        <div className="stack" style={{ minWidth: 0 }}>
          <div className="card stack" style={{ gap: 12 }}>
            <div className="sec">Design</div>
            <div className="thumbs">{DESIGNS.map((d) => (
              <button key={d.id} className={`thumb ${t.design === d.id ? 'on' : ''}`} onClick={() => setT({ ...t, design: d.id, accent: d.accent })}>
                <div className="thumbbox"><ThumbPreview content={{ ...sampleContent(type === 'report_card' ? 'bonafide' : type, meta.letterhead, { design: d.id }), design: d.id, accent: d.accent, orientation: t.orientation, bg_url: '' }} /></div>
                <b>{d.name}</b><small>{d.desc}</small></button>))}</div>
            <div className="form">
              <Field label="Heading"><input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} /></Field>
              <Field label="Colour"><input type="color" value={t.accent} onChange={(e) => setT({ ...t, accent: e.target.value })} style={{ height: 42, padding: 4 }} /></Field>
              <Field label="Page"><select value={t.orientation} onChange={(e) => setT({ ...t, orientation: e.target.value })}><option value="portrait">Portrait (A4)</option><option value="landscape">Landscape (A4)</option></select></Field>
            </div>
          </div>
          <div className="card stack" style={{ gap: 12 }}>
            <div className="sec">Use your own certificate design (optional)</div>
            <div className="muted small">Download any certificate background you like (A4 size, without text) from a design site such as Canva, Freepik or Pngtree - respecting their licence - then upload it here or paste its link. The wording is printed on top of it.</div>
            <ImageInput me={me} sid={sid} kind="background" label="Background image" value={t.bg_url} onChange={(v) => setT({ ...t, bg_url: v })} />
            {t.bg_url && <Field label={`Keep text away from the edges: ${t.inset} mm`} hint="Increase this so the text stays inside the border of your design"><input type="range" min="5" max="45" value={t.inset} onChange={(e) => setT({ ...t, inset: Number(e.target.value) })} /></Field>}
          </div>
          <div className="card stack" style={{ gap: 12 }}>
            <div className="sec">Wording</div>
            {free ? (<>
              <Field label={T.kind.includes('staff') && T.kind.includes('student') ? 'For students' : T.kind[0] === 'staff' ? 'For staff' : 'Wording'}>
                <textarea ref={bodyRef} rows={9} value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} /></Field>
              {T.kind.includes('staff') && T.kind.includes('student') && <Field label="For teachers / staff"><textarea rows={7} value={t.body_staff} onChange={(e) => setT({ ...t, body_staff: e.target.value })} /></Field>}
              <div className="phs">{PLACEHOLDERS.map(([k, l]) => <button type="button" key={k} className="ph" onClick={() => insertAt(k)} title={`{{${k}}}`}>{l}</button>)}</div>
            </>) : (
              <Field label={T.layout === 'report' ? 'Note at the bottom (grading scale)' : 'Closing line'} hint="The table of details / marks is fixed; only this line is yours to change."><textarea rows={3} value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} /></Field>)}
          </div>
          <div className="row">
            <button className="btn primary big" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save'}</button>
            {meta.templates[type] && <button className="btn" disabled={busy} onClick={reset}>Reset to default</button>}
          </div>
        </div>
        <div className="docside"><div className="sec" style={{ marginBottom: 8 }}>Preview (sample student)</div>{draft && <DocPreview content={draft} />}</div>
      </div>
    </div>
  );
});

function ThumbPreview({ content }) {
  const html = useMemo(() => buildHTML(content, {}), [content]);
  const land = content.orientation === 'landscape';
  const W = land ? 1123 : 794; const H = land ? 794 : 1123; const k = 150 / W;
  return <iframe title="Design" sandbox="" srcDoc={html} tabIndex={-1} style={{ width: W, height: H, transform: `scale(${k})`, transformOrigin: '0 0', border: 0, pointerEvents: 'none', display: 'block' }} />;
}

/* ===================================================================== LETTERHEAD */
export const Letterhead = scoped(function Letterhead({ me, sid }) {
  const { data: meta, error } = useMeta(me, sid);
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (meta) setF({ ...meta.settings, logo_url: meta.settings.logo_url || '', signature_url: meta.settings.signature_url || '', seal_url: meta.settings.seal_url || '' }); }, [meta]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const draft = useMemo(() => (meta && f ? sampleContent('bonafide', { ...meta.letterhead, ...f, name: meta.letterhead.name, principal_title: f.principal_title || 'Principal', logo_url: f.logo_url || meta.letterhead.logo_url }, null) : null), [meta, f]);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { setCached(metaKey(sid), await api.put(`/documents/settings${qs(scopeQ(me, sid))}`, f)); toast('Letterhead saved'); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  if (error) return <div className="err">{error}</div>;
  if (!meta || !f) return <Loading />;
  return (
    <div className="docgrid">
      <form className="stack" style={{ minWidth: 0 }} onSubmit={save}>
        <div className="card stack" style={{ gap: 12 }}>
          <div className="sec">Printed at the top of every document</div>
          <div className="muted small">School name, address, phone and email come from the School module ({meta.letterhead.name}).</div>
          <div className="form">
            <div className="full"><Field label="Line under the name" hint='e.g. "Affiliated to CBSE, Affiliation No. 2130456"'><input value={f.tagline || ''} onChange={set('tagline')} maxLength={160} /></Field></div>
            <div className="full"><Field label="Registration line" hint='e.g. "UDISE 09123456789  |  Reg. No. 45/2001"'><input value={f.reg_line || ''} onChange={set('reg_line')} maxLength={160} /></Field></div>
            <Field label="Place (for 'Place: ...')"><input value={f.place || ''} onChange={set('place')} /></Field>
            <Field label="Footer note"><input value={f.footer_note || ''} onChange={set('footer_note')} maxLength={300} /></Field>
          </div>
        </div>
        <div className="card stack" style={{ gap: 12 }}>
          <div className="sec">Signature</div>
          <div className="form">
            <Field label="Principal's name"><input value={f.principal_name || ''} onChange={set('principal_name')} /></Field>
            <Field label="Title"><input placeholder="Principal" value={f.principal_title || ''} onChange={set('principal_title')} /></Field>
          </div>
          <ImageInput me={me} sid={sid} kind="signature" label="Signature image" value={f.signature_url} onChange={(v) => setF({ ...f, signature_url: v })} hint="Photo of the signature on white / transparent background (PNG works best)" />
          <ImageInput me={me} sid={sid} kind="seal" label="School seal / stamp" value={f.seal_url} onChange={(v) => setF({ ...f, seal_url: v })} />
          <ImageInput me={me} sid={sid} kind="logo" label="Logo (only if different from the School module)" value={f.logo_url} onChange={(v) => setF({ ...f, logo_url: v })} />
        </div>
        <div className="row"><button className="btn primary big" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button></div>
      </form>
      <div className="docside"><div className="sec" style={{ marginBottom: 8 }}>Preview</div>{draft && <DocPreview content={draft} />}</div>
    </div>
  );
});

export { fmtDate };
