import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useData, useApi, setCached } from '../cache.js';
import { Icon, Field, toast, Loading, ask, groupByClass, ClassGroup, Page, PageBar, Section, DataTable, List, ListRow, StatusBadge, EmptyState, FormDialog, FormGrid, Notice, Button, Choice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
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
const Failed = ({ error }) => <Notice tone="bad">{error}</Notice>;
const Cancelled = () => <StatusBadge tone="bad">Cancelled</StatusBadge>;

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
    <FormDialog wide title={row ? `${row.title} - ${row.subject_name}` : 'Document'} onClose={onClose} hideFooter>
      {err && <Failed error={err} />}
      {!row && !err && <Loading />}
      {row && (<>
        <div className="ds-spread">
          <p className="ds-hint">No. <b>{row.serial_no}</b> - issued {fmtStamp(row.issued_at)}{row.issued_by_name ? ` by ${row.issued_by_name}` : ''} {row.status === 'cancelled' && <Cancelled />}</p>
          <div className="ds-inline">
            {row.content && <Button kind="primary" icon="download" onClick={() => printContent(row.content, { cancelled: row.status === 'cancelled' })}>Print / Save as PDF</Button>}
            {canCancel && row.status === 'issued' && <Button kind="danger" onClick={() => setCancel(true)}>Cancel document</Button>}
          </div>
        </div>
        {row.status === 'cancelled' && <Notice tone="warn">Cancelled{row.cancel_reason ? `: ${row.cancel_reason}` : ''}. {row.content ? '' : 'Please contact the school office for a new one.'}</Notice>}
        {row.content ? <DocPreview content={row.content} cancelled={row.status === 'cancelled'} /> : null}
        <p className="ds-note">Tip: in the print window choose "Save as PDF" to keep a digital copy. Turn on "Background graphics" if the borders do not appear.</p>
      </>)}
      {cancel && <CancelModal id={id} me={me} sid={sid} onClose={() => setCancel(false)} onDone={() => { setCancel(false); onChanged?.(); onClose(); }} />}
    </FormDialog>
  );
}

function CancelModal({ id, me, sid, onClose, onDone }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await api.post(`/documents/issued/${id}/cancel${qs(scopeQ(me, sid))}`, { reason }); toast('Document cancelled'); onDone(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormDialog title="Cancel this document" onClose={onClose} onSubmit={go} busy={busy} error={err} danger submitLabel="Cancel document" cancelLabel="Keep it" submitDisabled={!reason.trim()}>
      <Notice tone="warn">The document stays in the register as cancelled and can no longer be printed by the student or staff member. Its number is never reused.</Notice>
      <Field label="Reason (kept in the history)" req><input autoFocus required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormDialog>
  );
}

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
    <Section>
      <div className="ds-stack">
      <FilterBar q={q} onQ={setQ} placeholder={kind === 'staff' ? 'Search staff by name, employee ID or login' : 'Search student by name, admission no. or login'}
        filters={kind === 'student' ? [{ key: 'cls', label: 'Class', value: cls, onChange: setCls, all: 'All classes', options: (meta.classes || []).map((c) => ({ value: c.id, label: c.label })) }] : []} />
      {err && <Failed error={err} />}
      {!rows.length && !busy && <p className="ds-hint">{dq.trim() || cls ? 'No one found.' : `Type a name${kind === 'student' ? ' or pick a class' : ''} to find the ${kind}.`}</p>}
      {(kind === 'student' ? groupByClass(rows, (p) => p.class_label) : [{ label: '', items: rows }]).map((g) => {
        const list = (
          <div className="plist">{g.items.map((p) => (
            <button key={p.id} className="pitem" onClick={() => onPick(p)}>
              <b>{p.name}</b>
              <small>{kind === 'student' ? `${p.roll_no ? `Roll ${p.roll_no}` : ''}${p.admission_no ? `${p.roll_no ? ' - ' : ''}Adm ${p.admission_no}` : ''}` : [p.designation, p.employee_id].filter(Boolean).join(' - ') || p.login_id}</small>
              {p.inactive && <StatusBadge tone="bad">Left / inactive</StatusBadge>}
            </button>))}</div>
        );
        return kind === 'student' ? <ClassGroup key={g.label} label={g.label} count={g.items.length} open>{list}</ClassGroup> : <React.Fragment key="all">{list}</React.Fragment>;
      })}
      </div>
    </Section>
  );
}

function ReportOptions({ pre, opts, setOpts }) {
  const R = pre.report; if (!R) return null;
  const toggle = (id) => { const cur = opts.exam_ids ?? R.available_exams.map((e) => e.exam_id); setOpts({ ...opts, exam_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }); };
  const chosen = opts.exam_ids ?? R.available_exams.map((e) => e.exam_id);
  return (
    <Section title="Marks to print">
      <div className="ds-stack">
        <Field label="Session"><select value={opts.session_id || R.session_id || ''} onChange={(e) => setOpts({ session_id: e.target.value, exam_ids: null, include_tests: opts.include_tests })}>
          {R.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}</select></Field>
        {R.available_exams.length ? (
          <div className="ds-stack">
            <span className="ds-hint">Exams (each becomes a column)</span>
            {R.available_exams.map((e) => <label key={e.exam_id} className="ds-check"><input type="checkbox" checked={chosen.includes(e.exam_id)} onChange={() => toggle(e.exam_id)} /> {e.name}{e.pct !== null && e.pct !== undefined ? <span className="ds-note"> - {e.pct}%</span> : ''}</label>)}
          </div>
        ) : <Notice tone="warn">This student has no exam marks in this session. Marks are entered under Exams &amp; Report Cards &gt; Enter marks.</Notice>}
        <label className="ds-check"><input type="checkbox" checked={!!opts.include_tests} onChange={(e) => setOpts({ ...opts, include_tests: e.target.checked })} /> Also show the average of class tests (Tests % column)</label>
      </div>
    </Section>
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

  if (error) return <Page><Failed error={error} /></Page>;
  if (!meta) return <Page><Loading /></Page>;

  // ---- done
  if (done) return (
    <Page>
      <PageBar title="Issue document" />
      <Section>
        <div className="ds-stack">
          <div className="ds-inline"><span className="ds-c-ok"><Icon name="check" size={22} /></span><b>{done.title} issued to {done.subject_name}</b></div>
          <p className="ds-hint">Number <b>{done.serial_no}</b>. {done.subject_role === 'student' ? 'The student and parents' : 'They'} can also see it under Documents &gt; My documents.</p>
          <div className="ds-inline">
            <Button kind="primary" icon="download" onClick={() => printContent(done.content)}>Print / Save as PDF</Button>
            <Button onClick={() => { const t = type; reset(); setType(t); }}>Issue another {typeLabel(type).toLowerCase()}</Button>
            {me.features.some((f) => ['view_issued_documents', 'issue_documents'].includes(f)) && <Button onClick={() => go('issued')}>Open the register</Button>}
          </div>
        </div>
      </Section>
      <DocPreview content={done.content} />
    </Page>
  );

  return (
    <Page>
      <PageBar title="Issue document" sub="Certificates, letters and report cards with a number you can trace" />
      {/* 1. type */}
      <Section title="1. What do you want to issue?">
        <div className="typegrid">{TYPE_LIST.map((t) => (
          <button key={t.key} className={`typecard ${type === t.key ? 'on' : ''}`} onClick={() => pickType(t.key)}><b>{t.short}</b><small>{t.desc}</small></button>))}</div>
      </Section>

      {/* 2. person */}
      {T && !person && (<>
        <Section title="2. Who is it for?" actions={T.kind.length > 1 ? <Choice label="Person kind" value={kind} onChange={setKind} options={T.kind.map((k) => ({ value: k, label: k === 'student' ? 'Student' : 'Teacher / staff' }))} /> : null} flush>
          <PersonPicker key={`${type}-${kind}`} me={me} sid={sid} meta={meta} kind={kind} onPick={pick} />
        </Section>
        {err && <Failed error={err} />}
      </>)}

      {/* 3. details */}
      {T && person && !content && !err && <EmptyState icon="doc" title={`Loading ${person.name}...`} />}
      {T && person && err && !content && <Failed error={err} />}
      {T && person && content && (
        <div className="docgrid">
          <div className="ds-stack">
            <Section><div className="ds-spread"><div><b>{subject.name}</b><span className="ds-subline">{T.label}{pre.inactive ? ' - this person has left / is inactive' : ''}</span></div><Button onClick={reset}>Change person</Button></div></Section>
            {type === 'report_card' && <ReportOptions pre={pre} opts={ropts} setOpts={setR} />}

            {T.fields.some((f) => !f.kind || f.kind === pre.subject.kind) && (
              <Section title={`Details for this ${typeLabel(type).toLowerCase()}`}>
                <FormGrid>{T.fields.filter((f) => !f.kind || f.kind === pre.subject.kind).map((f) => (
                  <Field key={f.key} full={f.wide} label={f.label} req={f.required}>
                    {f.area ? <textarea rows={3} value={fields[f.key] || ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />
                      : <input type={f.type === 'date' ? 'date' : 'text'} placeholder={f.ph || ''} value={fields[f.key] || ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />}
                  </Field>))}</FormGrid>
              </Section>)}

            <details className="ds-section ds-details">
              <summary><b>Details printed from the profile</b> <span className="ds-note">- check, correct for this document only</span></summary>
              <FormGrid>{SUBJECT_FIELDS[pre.subject.kind].map(([k, label, t]) => (
                <Field key={k} label={label}>
                  {t === 'gender' ? <select value={subject[k] || ''} onChange={(e) => setSubject({ ...subject, [k]: e.target.value })}><option value="">-</option><option>Male</option><option>Female</option><option>Other</option></select>
                    : <input type={t === 'date' ? 'date' : 'text'} value={subject[k] ?? ''} onChange={(e) => setSubject({ ...subject, [k]: e.target.value })} />}
                </Field>))}</FormGrid>
              <p className="ds-note">Gender decides he / she, his / her in the wording. Changes here are not saved to the profile.</p>
            </details>

            <details className="ds-section ds-details">
              <summary><b>Design &amp; wording</b> <span className="ds-note">- {designOf(form.design).name}{T.layout === 'report' || T.layout === 'tc' ? '' : ', edit the text'}</span></summary>
              <div className="ds-stack">
                <div className="designs">{DESIGNS.map((d) => <button key={d.id} className={`dchip ${form.design === d.id ? 'on' : ''}`} onClick={() => setForm({ ...form, design: d.id, accent: d.accent })}><i style={{ background: d.accent }} />{d.name}</button>)}</div>
                <FormGrid>
                  <Field label="Heading"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                  <Field label="Colour"><input type="color" className="ds-color" value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} /></Field>
                  <Field label="Page"><select value={form.orientation} onChange={(e) => setForm({ ...form, orientation: e.target.value })}><option value="portrait">Portrait (A4)</option><option value="landscape">Landscape (A4)</option></select></Field>
                </FormGrid>
                {T.layout !== 'tc' && T.layout !== 'report' && (<>
                  <Field label={T.layout === 'award' ? 'Text under the name' : 'Wording'} hint="Placeholders such as {{name}} are filled in automatically. Edit here only for this document - to change it for every document use Templates & designs.">
                    <textarea ref={bodyRef} rows={9} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
                  </Field>
                  <div className="phs">{PLACEHOLDERS.map(([k, l]) => <button type="button" key={k} className="ph" onClick={() => insertAt(k)} title={`{{${k}}}`}>{l}</button>)}</div>
                </>)}
                {(T.layout === 'tc' || T.layout === 'report') && <Field label={T.layout === 'report' ? 'Note at the bottom (grading scale)' : 'Closing line'}><textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>}
              </div>
            </details>

            {err && <Failed error={err} />}
            <div className="ds-inline">
              <Button kind="primary" icon="download" loading={busy} onClick={() => issue(true)}>Issue &amp; print</Button>
              <Button disabled={busy} onClick={() => issue(false)}>Issue only</Button>
            </div>
            <p className="ds-note">Issuing gives the document its number and saves a copy that never changes. {kind === 'student' ? 'The student and parents' : 'The person'} will see it in Documents &gt; My documents.</p>
          </div>
          <div className="docside"><Section title="Live preview"><DocPreview content={content} draft /></Section></div>
        </div>
      )}
    </Page>
  );
});

/* ===================================================================== REGISTER */
export const IssuedList = scoped(function IssuedList({ me, sid }) {
  const [type, setType] = useState(''); const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [page, setPage] = useState(0);
  const dq = useDebounced(q); const [open, setOpen] = useState(null);
  const { data: res, error: err, refresh: load } = useApi(`/documents/issued${qs({ ...scopeQ(me, sid), type, status, q: dq.trim(), page })}`, true, { keepPrevious: true });
  useEffect(() => { setPage(0); }, [type, status, dq]);
  const columns = [
    { key: 'serial_no', label: 'Number', primary: true, render: (r) => <b>{r.serial_no}</b> },
    { key: 'doc_type', label: 'Document', render: (r) => <>{typeLabel(r.doc_type)} {r.status === 'cancelled' && <Cancelled />}</> },
    { key: 'subject_name', label: 'Issued to' },
    { key: 'class_label', label: 'Class', render: (r) => r.class_label || '-' },
    { key: 'issued_at', label: 'Date', render: (r) => fmtStamp(r.issued_at) },
    { key: 'issued_by_name', label: 'By', render: (r) => r.issued_by_name || '-' },
    { key: 'open', label: '', align: 'right', render: (r) => <Button size="sm" onClick={() => setOpen(r.id)}>Open</Button> },
  ];
  return (
    <Page>
      <PageBar title="Issued documents" sub={res ? `${res.total} in the register` : undefined} />
      <FilterBar q={q} onQ={setQ} placeholder="Search name or number" count={res?.rows.length}
        filters={[
          { key: 'type', label: 'Document type', value: type, onChange: setType, all: 'All types', options: TYPE_LIST.map((t) => ({ value: t.key, label: t.short })) },
          { key: 'status', label: 'Status', value: status, onChange: setStatus, all: 'Issued & cancelled', options: [{ value: 'issued', label: 'Issued' }, { value: 'cancelled', label: 'Cancelled' }] },
        ]} />
      {err && <Failed error={err} />}
      {!res && !err && <Loading />}
      {res && <Section flush><DataTable columns={columns} rows={res.rows} empty={<EmptyState icon="doc" title="No documents yet" />} /></Section>}
      {res && res.total > res.limit && (
        <div className="ds-spread"><span className="ds-hint">{res.page * res.limit + 1}-{Math.min(res.total, (res.page + 1) * res.limit)} of {res.total}</span>
          <div className="ds-inline"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button disabled={(page + 1) * res.limit >= res.total} onClick={() => setPage(page + 1)}>Next</Button></div></div>)}
      {open && <DocViewer me={me} sid={sid} id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </Page>
  );
});

/* ===================================================================== MY DOCUMENTS */
export function MyDocuments({ me }) {
  const { data, error } = useData('docs:my', () => api.get('/documents/my'));
  const [open, setOpen] = useState(null);
  if (error) return <Page><Failed error={error} /></Page>;
  if (!data) return <Page><Loading /></Page>;
  const other = data.some((d) => !d.mine);
  return (
    <Page>
      <PageBar title="My documents" sub="Certificates and letters issued to you" />
      {!data.length ? <EmptyState icon="doc" title="No documents yet">No documents have been issued to you yet. Ask the school office if you need a certificate.</EmptyState> : (
        <Section flush>
          <List>{data.map((d) => (
            <ListRow key={d.id} onClick={() => setOpen(d.id)} lead={<Icon name="doc" size={20} />} title={d.title}
              sub={`${other && !d.mine ? `${d.subject_name} - ` : ''}No. ${d.serial_no} - ${fmtStamp(d.issued_at)}`}
              meta={d.status === 'cancelled' ? <Cancelled /> : null} />
          ))}</List>
        </Section>
      )}
      {open && <DocViewer me={me} id={open} onClose={() => setOpen(null)} />}
    </Page>
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
      <div className="ds-inline ds-nowrap">
        <input placeholder="https://... (link to an image)" value={value || ''} onChange={(e) => onChange(e.target.value)} />
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={up} />
        <Button icon="upload" loading={busy} onClick={() => ref.current.click()}>Upload</Button>
        {value && <Button aria-label="Remove" icon="x" onClick={() => onChange('')} />}
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
    if (!(await ask('Go back to the built-in wording and design for this document?'))) return;
    setBusy(true);
    try { setCached(metaKey(sid), await api.del(`/documents/templates/${type}${qs(scopeQ(me, sid))}`)); toast('Reset to default'); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const insertAt = (key) => {
    const ta = bodyRef.current; const tok = `{{${key}}}`; const a = ta?.selectionStart ?? t.body.length; const b = ta?.selectionEnd ?? a;
    setT({ ...t, body: t.body.slice(0, a) + tok + t.body.slice(b) });
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(a + tok.length, a + tok.length); }, 0);
  };
  if (error) return <Page><Failed error={error} /></Page>;
  if (!meta || !t) return <Page><Loading /></Page>;
  const free = T.layout !== 'tc' && T.layout !== 'report';
  return (
    <Page>
      <PageBar title="Templates & designs" sub="Wording and look of every document type">
        {meta.templates[type] && <Button disabled={busy} onClick={reset}>Reset to default</Button>}
        <Button kind="primary" loading={busy} onClick={save}>Save</Button>
      </PageBar>
      <Section title="Document" sub="* has a saved school version. Anything not saved uses the built-in wording.">
        <div className="designs">{TYPE_LIST.map((x) => <button key={x.key} className={`dchip ${type === x.key ? 'on' : ''}`} onClick={() => setType(x.key)}>{x.short}{meta.templates[x.key] ? ' *' : ''}</button>)}</div>
      </Section>
      <div className="docgrid">
        <div className="ds-stack">
          <Section title="Design">
            <div className="ds-stack">
              <div className="thumbs">{DESIGNS.map((d) => (
                <button key={d.id} className={`thumb ${t.design === d.id ? 'on' : ''}`} onClick={() => setT({ ...t, design: d.id, accent: d.accent })}>
                  <div className="thumbbox"><ThumbPreview content={{ ...sampleContent(type === 'report_card' ? 'bonafide' : type, meta.letterhead, { design: d.id }), design: d.id, accent: d.accent, orientation: t.orientation, bg_url: '' }} /></div>
                  <b>{d.name}</b><small>{d.desc}</small></button>))}</div>
              <FormGrid>
                <Field label="Heading"><input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} /></Field>
                <Field label="Colour"><input type="color" className="ds-color" value={t.accent} onChange={(e) => setT({ ...t, accent: e.target.value })} /></Field>
                <Field label="Page"><select value={t.orientation} onChange={(e) => setT({ ...t, orientation: e.target.value })}><option value="portrait">Portrait (A4)</option><option value="landscape">Landscape (A4)</option></select></Field>
              </FormGrid>
            </div>
          </Section>
          <Section title="Use your own certificate design (optional)" sub="Download any certificate background you like (A4 size, without text) from a design site such as Canva, Freepik or Pngtree, respecting their licence, then upload it here or paste its link. The wording is printed on top of it.">
            <div className="ds-stack">
              <ImageInput me={me} sid={sid} kind="background" label="Background image" value={t.bg_url} onChange={(v) => setT({ ...t, bg_url: v })} />
              {t.bg_url && <Field label={`Keep text away from the edges: ${t.inset} mm`} hint="Increase this so the text stays inside the border of your design"><input type="range" min="5" max="45" value={t.inset} onChange={(e) => setT({ ...t, inset: Number(e.target.value) })} /></Field>}
            </div>
          </Section>
          <Section title="Wording">
            <div className="ds-stack">
              {free ? (<>
                <Field label={T.kind.includes('staff') && T.kind.includes('student') ? 'For students' : T.kind[0] === 'staff' ? 'For staff' : 'Wording'}>
                  <textarea ref={bodyRef} rows={9} value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} /></Field>
                {T.kind.includes('staff') && T.kind.includes('student') && <Field label="For teachers / staff"><textarea rows={7} value={t.body_staff} onChange={(e) => setT({ ...t, body_staff: e.target.value })} /></Field>}
                <div className="phs">{PLACEHOLDERS.map(([k, l]) => <button type="button" key={k} className="ph" onClick={() => insertAt(k)} title={`{{${k}}}`}>{l}</button>)}</div>
              </>) : (
                <Field label={T.layout === 'report' ? 'Note at the bottom (grading scale)' : 'Closing line'} hint="The table of details / marks is fixed; only this line is yours to change."><textarea rows={3} value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} /></Field>)}
            </div>
          </Section>
        </div>
        <div className="docside"><Section title="Preview" sub="Sample student">{draft && <DocPreview content={draft} />}</Section></div>
      </div>
    </Page>
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
    e?.preventDefault?.(); setBusy(true);
    try { setCached(metaKey(sid), await api.put(`/documents/settings${qs(scopeQ(me, sid))}`, f)); toast('Letterhead saved'); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  if (error) return <Page><Failed error={error} /></Page>;
  if (!meta || !f) return <Page><Loading /></Page>;
  return (
    <Page>
      <PageBar title="Letterhead" sub={`School name, address, phone and email come from the School module (${meta.letterhead.name})`}>
        <Button kind="primary" loading={busy} onClick={save}>Save</Button>
      </PageBar>
      <div className="docgrid">
        <form className="ds-stack" onSubmit={save}>
          <Section title="Printed at the top of every document">
            <FormGrid>
              <Field full label="Line under the name" hint='e.g. "Affiliated to CBSE, Affiliation No. 2130456"'><input value={f.tagline || ''} onChange={set('tagline')} maxLength={160} /></Field>
              <Field full label="Registration line" hint='e.g. "UDISE 09123456789  |  Reg. No. 45/2001"'><input value={f.reg_line || ''} onChange={set('reg_line')} maxLength={160} /></Field>
              <Field label="Place (for 'Place: ...')"><input value={f.place || ''} onChange={set('place')} /></Field>
              <Field label="Footer note"><input value={f.footer_note || ''} onChange={set('footer_note')} maxLength={300} /></Field>
            </FormGrid>
          </Section>
          <Section title="Signature">
            <div className="ds-stack">
              <FormGrid>
                <Field label="Principal's name"><input value={f.principal_name || ''} onChange={set('principal_name')} /></Field>
                <Field label="Title"><input placeholder="Principal" value={f.principal_title || ''} onChange={set('principal_title')} /></Field>
              </FormGrid>
              <ImageInput me={me} sid={sid} kind="signature" label="Signature image" value={f.signature_url} onChange={(v) => setF({ ...f, signature_url: v })} hint="Photo of the signature on white / transparent background (PNG works best)" />
              <ImageInput me={me} sid={sid} kind="seal" label="School seal / stamp" value={f.seal_url} onChange={(v) => setF({ ...f, seal_url: v })} />
              <ImageInput me={me} sid={sid} kind="logo" label="Logo (only if different from the School module)" value={f.logo_url} onChange={(v) => setF({ ...f, logo_url: v })} />
            </div>
          </Section>
        </form>
        <div className="docside"><Section title="Preview">{draft && <DocPreview content={draft} />}</Section></div>
      </div>
    </Page>
  );
});

export { fmtDate };
