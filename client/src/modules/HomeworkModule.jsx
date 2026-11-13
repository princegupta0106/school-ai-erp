import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Field, toast, Loading, ask, Page, PageBar, Button, Section, List, ListRow, StatusBadge, EmptyState, FormDialog, FormGrid, Notice, Choice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
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
  <div className="ds-chips">
    {list.map((f) => (
      <a key={f.id} className="ds-btn ds-btn-secondary ds-btn-sm" href={f.url} target="_blank" rel="noopener noreferrer" download={f.name}>
        <Icon name="download" size={15} /><span>{f.name} ({size(f.size)})</span>
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
    <div className="ds-stack">
      <input ref={ref} type="file" multiple accept={ACCEPT} onChange={add} disabled={files.length >= 5} />
      {files.map((f, i) => (
        <div key={i} className="ds-spread"><span>{f.name} <span className="ds-note">({size(f.size)})</span></span>
          <Button kind="ghost" size="sm" icon="x" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} /></div>
      ))}
      <p className="ds-note">Up to 5 files, 10 MB each (PDF, photo, Word, Excel, PowerPoint, text)</p>
    </div>
  );
}

/* ===================================================================== TEACHER */
function NewAssignment({ me, sid, onClose, onSaved }) {
  const { data: combos } = useApi(`${base}/combos${qs(sq(me, sid))}`);
  const [f, setF] = useState({ class_id: '', subject_id: '', title: '', subject: '', description: '', due_date: '', needs_submission: true });
  const [files, setFiles] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      Object.entries({ ...f, ...sq(me, sid) }).forEach(([k, v]) => fd.append(k, v));
      files.forEach((x) => fd.append('files', x));
      await api.post(`${base}/assignments`, fd);
      toast('Posted'); onSaved(); onClose();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormDialog title="New homework / file" onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Post" submitDisabled={!f.class_id || !f.title.trim()}>
      <FormGrid>
        <Field full label="Type"><Choice label="Type" value={f.needs_submission} onChange={(v) => setF({ ...f, needs_submission: v })} options={[{ value: true, label: 'Assignment (students submit)' }, { value: false, label: 'Study file (read only)' }]} /></Field>
        <Field full req label="Class & subject">
          {!combos ? <Loading rows={1} /> : combos.length === 0 ? <span className="ds-hint">No class and subject is assigned to you.</span> :
            <select required value={f.class_id ? `${f.class_id}|${f.subject_id}` : ''} onChange={(e) => { const [c, sb = ''] = e.target.value.split('|'); const hit = combos.find((x) => x.class_id === c && (x.subject_id || '') === sb); setF({ ...f, class_id: c || '', subject_id: sb, subject: hit?.subject || '' }); }}>
              <option value="">Choose class & subject</option>{combos.map((c) => <option key={`${c.class_id}|${c.subject_id || ''}`} value={`${c.class_id}|${c.subject_id || ''}`}>{c.class_label}{c.subject ? ` · ${c.subject}` : ''}</option>)}</select>}
        </Field>
        <Field full req label="Title"><input required maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Chapter 4 exercise" /></Field>
        <Field full label="Instructions"><textarea rows={4} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What should students do?" /></Field>
        {f.needs_submission && <Field full label="Last date to submit (optional)"><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>}
        <Field full label="Attach files (optional)"><FilePick files={files} setFiles={setFiles} /></Field>
      </FormGrid>
    </FormDialog>
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
  const badge = !sub ? <StatusBadge tone="bad">Not submitted</StatusBadge> : sub.status === 'checked' ? <StatusBadge tone="ok">Checked</StatusBadge> : <StatusBadge tone="warn">To check</StatusBadge>;
  return (
    <>
      <ListRow onClick={sub ? () => setOpen(!open) : undefined} title={`${s.roll_no ? `${s.roll_no}. ` : ''}${s.name}`}
        sub={sub ? `Submitted ${fmtTime(sub.submitted_at)}${sub.is_late ? ' (late)' : ''}${sub.marks ? ` - ${sub.marks}` : ''}` : undefined} meta={badge} />
      {open && sub && (
        <div className="ds-stack ds-sunk">
          {sub.note && <p className="ds-pre">{sub.note}</p>}
          <Files list={sub.files} />
          <FormGrid>
            <Field label="Marks / grade"><input maxLength={30} value={marks} onChange={(e) => setMarks(e.target.value)} placeholder="e.g. 8/10" /></Field>
            <Field full label="Remark for the student"><textarea rows={2} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Well done / please redo question 3..." /></Field>
          </FormGrid>
          <div className="ds-inline"><Button type="button" kind="primary" loading={busy} onClick={save}>{sub.status === 'checked' ? 'Update' : 'Mark as checked'}</Button></div>
        </div>
      )}
    </>
  );
}

function Submissions({ me, sid, a, onClose, onDelete }) {
  const { data: d, error, refresh } = useApi(`${base}/assignments/${a.id}/submissions${qs(sq(me, sid))}`);
  const list = d?.students || [];
  return (
    <FormDialog noForm wide title={a.title} onClose={onClose}>
      {error && <Notice tone="bad" action={<Button size="sm" onClick={refresh}>Retry</Button>}>{error}</Notice>}
      {!d ? <Loading /> : (
        <div className="ds-stack">
          <div className="ds-chips">
            <StatusBadge tone="mute" dot={false}>{clsName(d.assignment.classes)}</StatusBadge>
            {d.assignment.subject && <StatusBadge tone="mute" dot={false}>{d.assignment.subject}</StatusBadge>}
            {d.assignment.due_date && <StatusBadge tone="info" dot={false}>Due {fmtDate(d.assignment.due_date)}</StatusBadge>}
          </div>
          {d.assignment.description && <p className="ds-pre">{d.assignment.description}</p>}
          <Files list={d.assignment.attachments} />
          {d.assignment.needs_submission ? (
            <Section title="Submissions" flush>
              {list.length === 0 ? <EmptyState icon="users" title="No students in this class" /> : <List>{list.map((s) => <CheckRow key={s.student_id} me={me} sid={sid} s={s} onSaved={refresh} />)}</List>}
            </Section>
          ) : <p className="ds-hint">This is a study file - students can read it, nothing to submit.</p>}
          <div className="ds-inline"><Button kind="danger" icon="trash" onClick={onDelete}>Delete this homework</Button></div>
        </div>
      )}
    </FormDialog>
  );
}

export const Homework = scoped(function Homework({ me, sid }) {
  const { data: list, error, refresh } = useApi(`${base}/assignments${qs(sq(me, sid))}`);
  const [form, setForm] = useState(false); const [open, setOpen] = useState(null); const [fc, setFc] = useState(''); const [fs, setFs] = useState(''); const [chk, setChk] = useState(''); const [hq, setHq] = useState(''); const [hsort, setHsort] = useState('new');
  const del = async (a) => {
    if (!(await ask(`Delete "${a.title}"? Student submissions will be deleted too.`))) return;
    try { await api.del(`${base}/assignments/${a.id}${qs(sq(me, sid))}`); toast('Deleted'); refresh(); } catch (x) { toast(x.message, true); }
  };
  if (error) return <Page><Notice tone="bad" action={<Button size="sm" onClick={refresh}>Retry</Button>}>{error}</Notice></Page>;
  if (!list) return <Loading />;
  const classes = [...new Set(list.map((x) => clsName(x.classes)).filter(Boolean))]; const subjects = [...new Set(list.map((x) => x.subject).filter(Boolean))];
  const shown = list.filter((x) => (!fc || clsName(x.classes) === fc) && (!fs || x.subject === fs) && (!chk || x.to_check > 0) && (!hq.trim() || String(x.title || '').toLowerCase().includes(hq.trim().toLowerCase())))
    .sort((a, b) => hsort === 'old' ? String(a.created_at).localeCompare(String(b.created_at)) : hsort === 'title' ? String(a.title).localeCompare(String(b.title)) : String(b.created_at).localeCompare(String(a.created_at)));
  return (
    <Page>
      <PageBar title="Homework" sub={`${list.length} posted`}><Button kind="primary" icon="plus" onClick={() => setForm(true)}>New homework / file</Button></PageBar>
      <FilterBar q={hq} onQ={setHq} placeholder="Search homework" count={shown.length}
        filters={[
          { key: 'c', label: 'Class', value: fc, onChange: setFc, all: 'All classes', options: classes },
          { key: 's', label: 'Subject', value: fs, onChange: setFs, all: 'All subjects', options: subjects },
          { key: 'k', label: 'Status', value: chk, onChange: setChk, all: 'All status', options: [{ value: 'check', label: 'To check' }] },
        ]}
        sort={{ value: hsort, onChange: setHsort, def: 'new', options: [{ value: 'new', label: 'Newest first' }, { value: 'old', label: 'Oldest first' }, { value: 'title', label: 'Title A-Z' }] }} />
      <Section flush>
        {shown.length === 0 ? <EmptyState icon="doc" title={list.length ? 'No homework matches' : 'Nothing posted yet'}>{list.length ? 'Try different filters.' : 'Post the first one with the button above.'}</EmptyState> : (
          <List>{shown.map((a) => (
            <ListRow key={a.id} onClick={() => setOpen(a)} title={a.title} sub={`${[clsName(a.classes), a.subject].filter(Boolean).join(' - ')}${a.classes || a.subject ? ' - ' : ''}Posted ${fmtTime(a.created_at)}`}
              meta={a.needs_submission ? <>{a.to_check > 0 && <StatusBadge tone="warn">{a.to_check} to check</StatusBadge>}<StatusBadge tone={a.total_students && a.submitted >= a.total_students ? 'ok' : 'mute'} dot={false}>{a.submitted}/{a.total_students} submitted</StatusBadge></> : <StatusBadge tone="info" dot={false}>Study file</StatusBadge>} />))}</List>)}
      </Section>
      {form && <NewAssignment me={me} sid={sid} onClose={() => setForm(false)} onSaved={refresh} />}
      {open && <Submissions me={me} sid={sid} a={open} onClose={() => { setOpen(null); refresh(); }} onDelete={() => { const x = open; setOpen(null); del(x); }} />}
    </Page>
  );
});

/* ===================================================================== STUDENT */
function statusOf(a) {
  if (!a.needs_submission) return { label: 'Study file', tone: 'info' };
  if (a.my?.status === 'checked') return { label: 'Checked', tone: 'ok' };
  if (a.my) return { label: 'Submitted', tone: 'info' };
  if (a.due_date && a.due_date < today()) return { label: 'Overdue', tone: 'bad' };
  return { label: 'Pending', tone: 'warn' };
}

function AssignmentView({ id, onClose, onSaved }) {
  const { data: a, error, refresh } = useApi(`${base}/my/${id}`);
  const [files, setFiles] = useState([]); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const my = a?.my; const locked = my?.status === 'checked';
  const send = async () => {
    setBusy(true); setErr('');
    try {
      const fd = new FormData(); fd.append('note', note);
      files.forEach((x) => fd.append('files', x));
      await api.post(`${base}/my/${id}/submit`, fd);
      toast('Submitted'); setFiles([]); setNote(''); refresh(); onSaved();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const canSubmit = !!a?.needs_submission && !locked;
  return (
    <FormDialog wide title={a?.title || 'Homework'} onClose={onClose} onSubmit={send} busy={busy} error={err}
      hideFooter={!canSubmit} cancelLabel="Close" submitLabel={my ? 'Replace submission' : 'Submit'} submitDisabled={!files.length && !note.trim()}>
      {error && <Notice tone="bad" action={<Button size="sm" onClick={refresh}>Retry</Button>}>{error}</Notice>}
      {!a ? <Loading /> : (
        <div className="ds-stack">
          <div className="ds-chips">
            {a.subject && <StatusBadge tone="mute" dot={false}>{a.subject}</StatusBadge>}
            {a.due_date && <StatusBadge tone="info" dot={false}>Due {fmtDate(a.due_date)}</StatusBadge>}
            {a.teacher && <StatusBadge tone="mute" dot={false}>{a.teacher}</StatusBadge>}
          </div>
          {a.description && <p className="ds-pre">{a.description}</p>}
          {a.attachments.length > 0 && <><div className="ds-label">Files from your teacher</div><Files list={a.attachments} /></>}
          {a.needs_submission && (
            <Section title="Your submission">
              <div className="ds-stack">
                {my && <>
                  <p className="ds-note">Submitted {fmtTime(my.submitted_at)}{my.is_late ? ' (late)' : ''}</p>
                  {my.note && <p className="ds-pre">{my.note}</p>}
                  <Files list={my.files} />
                </>}
                {locked && <Notice tone="ok"><span><b>Checked{my.marks ? ` - ${my.marks}` : ''}</b>{my.feedback ? ` - ${my.feedback}` : ''}</span></Notice>}
                {!locked && (
                  <FormGrid>
                    <Field full label={my ? 'Submit again (replaces your earlier submission)' : 'Upload your work'}><FilePick files={files} setFiles={setFiles} /></Field>
                    <Field full label="Note for the teacher (optional)"><textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                  </FormGrid>
                )}
              </div>
            </Section>
          )}
        </div>
      )}
    </FormDialog>
  );
}

export function MyHomework() {
  const { data: list, error, refresh } = useApi(`${base}/my`);
  const [open, setOpen] = useState(null);
  if (error) return <Page><Notice tone="bad" action={<Button size="sm" onClick={refresh}>Retry</Button>}>{error}</Notice></Page>;
  if (!list) return <Loading />;
  return (
    <Page>
      <PageBar title="My homework" sub={`${list.length} item${list.length === 1 ? '' : 's'}`} />
      <Section flush>
        {list.length === 0 ? <EmptyState icon="doc" title="No homework yet">New homework from your teachers will show up here.</EmptyState> : (
          <List>{list.map((a) => { const st = statusOf(a); return (
            <ListRow key={a.id} onClick={() => setOpen(a.id)} title={a.title} sub={`${a.subject || 'Homework'}${a.due_date && a.needs_submission ? ` · Due ${fmtDate(a.due_date)}` : ''}${a.my?.marks ? ` · ${a.my.marks}` : ''}`}
              meta={<StatusBadge tone={st.tone}>{st.label}</StatusBadge>} />); })}</List>)}
      </Section>
      {open && <AssignmentView id={open} onClose={() => setOpen(null)} onSaved={refresh} />}
    </Page>
  );
}
