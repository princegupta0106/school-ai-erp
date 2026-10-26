import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Modal, Field, Empty, Badge, toast, Loading } from '../ui.jsx';
import { scoped } from './AttendanceModule.jsx';

const base = '/homework';
const sq = (me, sid) => (me.role === 'super_admin' ? { school_id: sid } : {});
const qs = (o) => { const p = new URLSearchParams(o); const s = p.toString(); return s ? `?${s}` : ''; };
const clsName = (c) => (c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : '');
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtTime = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';

// links to files (open / download)
const Files = ({ list }) => (!list?.length ? null : (
  <div className="stack" style={{ gap: 6 }}>
    {list.map((f) => (
      <a key={f.id} className="chip" href={f.url} target="_blank" rel="noopener noreferrer" download={f.name} style={{ alignSelf: 'flex-start', textDecoration: 'none' }}>
        <Icon name="download" size={14} />{f.name} <span style={{ fontWeight: 400, opacity: .75 }}>({size(f.size)})</span>
      </a>
    ))}
  </div>
));

// choose up to 5 files
function FilePick({ files, setFiles }) {
  const ref = useRef(null);
  const add = (e) => {
    const next = [...files, ...Array.from(e.target.files || [])].slice(0, 5);
    if (next.some((f) => f.size > 10 * 1024 * 1024)) toast('Each file must be under 10 MB', true);
    setFiles(next.filter((f) => f.size <= 10 * 1024 * 1024));
    if (ref.current) ref.current.value = '';
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input ref={ref} type="file" multiple accept={ACCEPT} onChange={add} disabled={files.length >= 5} />
      {files.map((f, i) => (
        <div key={i} className="row sp"><span>{f.name} <small className="muted">({size(f.size)})</small></span>
          <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button></div>
      ))}
      <small className="muted">Up to 5 files, 10 MB each (PDF, photo, Word, Excel, PowerPoint, text)</small>
    </div>
  );
}

/* ===================================================================== TEACHER */
function NewAssignment({ me, sid, onClose, onSaved }) {
  const { data: classes } = useApi(`${base}/classes${qs(sq(me, sid))}`);
  const [f, setF] = useState({ class_id: '', title: '', subject: '', description: '', due_date: '', needs_submission: true });
  const [files, setFiles] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const fd = new FormData();
      Object.entries({ ...f, ...sq(me, sid) }).forEach(([k, v]) => fd.append(k, v));
      files.forEach((x) => fd.append('files', x));
      await api.post(`${base}/assignments`, fd);
      toast('Posted'); onSaved(); onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="New homework / file" onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={save}>
        <div className="pills">
          <button type="button" className={`pill ${f.needs_submission ? 'on' : ''}`} onClick={() => setF({ ...f, needs_submission: true })}>Assignment (students submit)</button>
          <button type="button" className={`pill ${!f.needs_submission ? 'on' : ''}`} onClick={() => setF({ ...f, needs_submission: false })}>Study file (read only)</button>
        </div>
        <Field label="Class" req>
          {!classes ? <Loading rows={1} /> : classes.length === 0 ? <span className="muted">No classes are assigned to you.</span> :
            <select required value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}><option value="">Choose a class</option>{classes.map((c) => <option key={c.id} value={c.id}>{clsName(c)}</option>)}</select>}
        </Field>
        <Field label="Title" req><input required maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Chapter 4 exercise" /></Field>
        <Field label="Subject (optional)"><input maxLength={60} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. Maths" /></Field>
        <Field label="Instructions"><textarea rows={4} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What should students do?" /></Field>
        {f.needs_submission && <Field label="Last date to submit (optional)"><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>}
        <Field label="Attach files (optional)"><FilePick files={files} setFiles={setFiles} /></Field>
        {err && <div className="err">{err}</div>}
        <button className="btn primary big" disabled={busy || !f.class_id || !f.title.trim()} style={{ justifyContent: 'center' }}>{busy ? 'Uploading...' : 'Post'}</button>
      </form>
    </Modal>
  );
}

function CheckRow({ me, sid, s, onSaved }) {
  const sub = s.submission;
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState(sub?.marks || ''); const [feedback, setFeedback] = useState(sub?.feedback || ''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.patch(`${base}/submissions/${sub.id}${qs(sq(me, sid))}`, { marks, feedback }); toast('Saved'); onSaved(); setOpen(false); }
    catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const badge = !sub ? <Badge tone="off">Not submitted</Badge> : sub.status === 'checked' ? <Badge tone="ok">Checked</Badge> : <Badge tone="warn">To check</Badge>;
  return (
    <div style={{ borderTop: '1px solid var(--line)' }}>
      <button type="button" className="drow" style={{ borderTop: 0 }} disabled={!sub} onClick={() => setOpen(!open)}>
        <div style={{ flex: 1, minWidth: 0 }}><b>{s.roll_no ? `${s.roll_no}. ` : ''}{s.name}</b>{sub && <small>Submitted {fmtTime(sub.submitted_at)}{sub.is_late ? ' (late)' : ''}{sub.marks ? ` - ${sub.marks}` : ''}</small>}</div>
        {badge}
      </button>
      {open && sub && (
        <div className="stack" style={{ padding: '4px 16px 16px', gap: 10 }}>
          {sub.note && <p className="nbody" style={{ margin: 0 }}>{sub.note}</p>}
          <Files list={sub.files} />
          <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
            <div style={{ width: 140 }}><Field label="Marks / grade"><input maxLength={30} value={marks} onChange={(e) => setMarks(e.target.value)} placeholder="e.g. 8/10" /></Field></div>
          </div>
          <Field label="Remark for the student"><textarea rows={2} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Well done / please redo question 3..." /></Field>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={save}>{busy ? 'Saving...' : sub.status === 'checked' ? 'Update' : 'Mark as checked'}</button>
        </div>
      )}
    </div>
  );
}

function Submissions({ me, sid, a, onClose }) {
  const { data: d, error, refresh } = useApi(`${base}/assignments/${a.id}/submissions${qs(sq(me, sid))}`);
  const list = d?.students || [];
  return (
    <Modal title={a.title} onClose={onClose} wide>
      {error && <div className="err">{error}</div>}
      {!d ? <Loading /> : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="chip">{clsName(d.assignment.classes)}</span>
            {d.assignment.subject && <span className="chip">{d.assignment.subject}</span>}
            {d.assignment.due_date && <span className="chip">Due {fmtDate(d.assignment.due_date)}</span>}
          </div>
          {d.assignment.description && <p className="nbody" style={{ margin: 0 }}>{d.assignment.description}</p>}
          <Files list={d.assignment.attachments} />
          {d.assignment.needs_submission ? (
            <div className="card" style={{ padding: 0 }}>
              {list.length === 0 ? <Empty>No students in this class.</Empty> : list.map((s) => <CheckRow key={s.student_id} me={me} sid={sid} s={s} onSaved={refresh} />)}
            </div>
          ) : <small className="muted">This is a study file - students can read it, nothing to submit.</small>}
        </div>
      )}
    </Modal>
  );
}

export const Homework = scoped(function Homework({ me, sid }) {
  const { data: list, error, refresh } = useApi(`${base}/assignments${qs(sq(me, sid))}`);
  const [form, setForm] = useState(false); const [open, setOpen] = useState(null);
  const del = async (a) => {
    if (!confirm(`Delete "${a.title}"? Student submissions will be deleted too.`)) return;
    try { await api.del(`${base}/assignments/${a.id}${qs(sq(me, sid))}`); toast('Deleted'); refresh(); } catch (x) { toast(x.message, true); }
  };
  if (error) return <div className="err">{error}</div>;
  if (!list) return <Loading />;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <button className="btn primary big" style={{ alignSelf: 'flex-start' }} onClick={() => setForm(true)}><Icon name="plus" size={18} />New homework / file</button>
      {list.length === 0 ? <Empty>Nothing posted yet.</Empty> : list.map((a) => (
        <article key={a.id} className="notice-card">
          <div className="row sp" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <div className="chips">
              <span className="chip head">{clsName(a.classes)}</span>
              {a.subject && <span className="chip">{a.subject}</span>}
              {a.due_date && <span className="chip">Due {fmtDate(a.due_date)}</span>}
              {!a.needs_submission && <span className="chip">Study file</span>}
            </div>
            <button className="icon-btn" aria-label="Delete" onClick={() => del(a)}><Icon name="trash" size={18} /></button>
          </div>
          <h3>{a.title}</h3>
          <div className="row sp">
            {a.needs_submission
              ? <span>{a.submitted}/{a.total_students} submitted{a.to_check > 0 && <> - <Badge tone="warn">{a.to_check} to check</Badge></>}</span>
              : <small className="muted">{a.attachments.length} file(s)</small>}
            <button className="btn" onClick={() => setOpen(a)}>{a.needs_submission ? 'View submissions' : 'Open'}</button>
          </div>
          <small className="muted">Posted {fmtTime(a.created_at)}</small>
        </article>
      ))}
      {form && <NewAssignment me={me} sid={sid} onClose={() => setForm(false)} onSaved={refresh} />}
      {open && <Submissions me={me} sid={sid} a={open} onClose={() => { setOpen(null); refresh(); }} />}
    </div>
  );
});

/* ===================================================================== STUDENT */
function statusOf(a) {
  if (!a.needs_submission) return { label: 'Study file', tone: 'info' };
  if (a.my?.status === 'checked') return { label: 'Checked', tone: 'ok' };
  if (a.my) return { label: 'Submitted', tone: 'info' };
  if (a.due_date && a.due_date < today()) return { label: 'Overdue', tone: 'off' };
  return { label: 'Pending', tone: 'warn' };
}

function AssignmentView({ id, onClose, onSaved }) {
  const { data: a, error, refresh } = useApi(`${base}/my/${id}`);
  const [files, setFiles] = useState([]); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const fd = new FormData(); fd.append('note', note);
      files.forEach((x) => fd.append('files', x));
      await api.post(`${base}/my/${id}/submit`, fd);
      toast('Submitted'); setFiles([]); setNote(''); refresh(); onSaved();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const my = a?.my; const locked = my?.status === 'checked';
  return (
    <Modal title={a?.title || 'Homework'} onClose={onClose} wide>
      {error && <div className="err">{error}</div>}
      {!a ? <Loading /> : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 8 }}>
            {a.subject && <span className="chip">{a.subject}</span>}
            {a.due_date && <span className="chip">Due {fmtDate(a.due_date)}</span>}
            {a.teacher && <span className="chip">{a.teacher}</span>}
          </div>
          {a.description && <p className="nbody" style={{ margin: 0 }}>{a.description}</p>}
          {a.attachments.length > 0 && <div className="stack" style={{ gap: 6 }}><b>Files from your teacher</b><Files list={a.attachments} /></div>}
          {a.needs_submission && (
            <div className="card stack" style={{ gap: 12 }}>
              <b>Your submission</b>
              {my && <>
                <small className="muted">Submitted {fmtTime(my.submitted_at)}{my.is_late ? ' (late)' : ''}</small>
                {my.note && <p className="nbody" style={{ margin: 0 }}>{my.note}</p>}
                <Files list={my.files} />
              </>}
              {locked && (
                <div className="notice ok">
                  <b>Checked{my.marks ? ` - ${my.marks}` : ''}</b>
                  {my.feedback && <div>{my.feedback}</div>}
                </div>
              )}
              {!locked && (
                <form className="stack" style={{ gap: 12 }} onSubmit={send}>
                  <Field label={my ? 'Submit again (replaces your earlier submission)' : 'Upload your work'}><FilePick files={files} setFiles={setFiles} /></Field>
                  <Field label="Note for the teacher (optional)"><textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                  {err && <div className="err">{err}</div>}
                  <button className="btn primary big" disabled={busy || (!files.length && !note.trim())} style={{ justifyContent: 'center' }}><Icon name="upload" size={18} />{busy ? 'Uploading...' : my ? 'Replace submission' : 'Submit'}</button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function MyHomework() {
  const { data: list, error, refresh } = useApi(`${base}/my`);
  const [open, setOpen] = useState(null);
  if (error) return <div className="err">{error}</div>;
  if (!list) return <Loading />;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      {list.length === 0 ? <Empty>No homework yet.</Empty> : list.map((a) => {
        const st = statusOf(a);
        return (
          <article key={a.id} className="notice-card">
            <div className="row sp" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <div className="chips">
                {a.subject && <span className="chip">{a.subject}</span>}
                {a.due_date && a.needs_submission && <span className="chip">Due {fmtDate(a.due_date)}</span>}
              </div>
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>
            <h3>{a.title}</h3>
            <div className="row sp">
              <small className="muted">{a.teacher ? `${a.teacher} - ` : ''}{fmtTime(a.created_at)}{a.my?.marks ? ` - ${a.my.marks}` : ''}</small>
              <button className="btn" onClick={() => setOpen(a.id)}>{a.needs_submission ? (a.my ? 'View' : 'Open & submit') : 'Open'}</button>
            </div>
          </article>
        );
      })}
      {open && <AssignmentView id={open} onClose={() => setOpen(null)} onSaved={refresh} />}
    </div>
  );
}
