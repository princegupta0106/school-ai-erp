import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Field, toast, Loading, ask, Page, PageBar, Button, Tabs, Section, List, ListRow, StatusBadge as DsBadge, EmptyState, FormDialog, FormGrid, Notice, Choice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
import { scoped } from './AttendanceModule.jsx';

const sq = (me, sid) => (me.role === 'super_admin' ? { school_id: sid } : {});
const qs = (o) => { const p = new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))); const s = p.toString(); return s ? `?${s}` : ''; };
const fmtDT = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtD = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const refNo = (n) => `Q-${String(n).padStart(4, '0')}`;
const TONES = [['warn', 'Orange'], ['info', 'Blue'], ['ok', 'Green'], ['off', 'Red'], ['mute', 'Grey']];

const useMeta = (me, sid) => useApi(`/queries/meta${qs(sq(me, sid))}`, true, { keepPrevious: true });
const tone = (c) => (c === 'off' ? 'bad' : c || 'mute'); // statuses are stored with the old colour name "off" for red
const StatusBadge = ({ s }) => (s ? <DsBadge tone={tone(s.color)}>{s.name}</DsBadge> : <DsBadge tone="mute">No status</DsBadge>);

/* ================================================================== NEW QUERY (the form) */
export const NewQuery = scoped(function NewQuery({ me, sid, go }) {
  const { data: meta, error, refresh } = useMeta(me, sid);
  const [typeId, setTypeId] = useState('');
  const [f, setF] = useState({ name: '', phone: '', subject: '', details: '' });
  const [extra, setExtra] = useState({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  useEffect(() => { if (meta && !typeId && meta.types.length) setTypeId(meta.types[0].id); }, [meta]); // eslint-disable-line
  const type = useMemo(() => meta?.types.find((t) => t.id === typeId), [meta, typeId]);
  if (error) return <Page narrow><Notice tone="bad" action={<Button size="sm" onClick={refresh}>Retry</Button>}>{error}</Notice></Page>;
  if (!meta) return <Loading />;
  if (!meta.types.length) return <Page narrow><PageBar title="New query" /><Section><EmptyState icon="chat" title="No forms are switched on yet">Ask an admin to add one in Forms &amp; statuses.</EmptyState></Section></Page>;

  const pick = (id) => { setTypeId(id); setExtra({}); setErr(''); };
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const row = await api.post('/queries', { ...sq(me, sid), ...f, type_id: typeId, data: extra });
      setLast(row); toast('Query recorded');
      setF({ name: '', phone: '', subject: '', details: '' }); setExtra({});
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const nameLabel = type?.audience === 'internal' ? 'Raised by (name)' : 'Person\'s name (parent / visitor)';
  const setX = (k) => (e) => setExtra({ ...extra, [k]: e.target.value });
  return (
    <Page narrow>
      <PageBar title="New query" sub="Record what a parent, visitor or staff member asked" />
      {meta.types.length > 1 && <Tabs items={meta.types.map((t) => ({ key: t.id, label: t.name }))} value={typeId} onChange={pick} />}
      {last && <Notice tone="ok" action={<Button kind="ghost" size="sm" onClick={() => go('list')}>See all queries</Button>}><span><b>{refNo(last.ref_no)}</b> recorded for {last.name}. It is marked as pending.</span></Notice>}
      <Section>
        <form onSubmit={save}>
          <FormGrid>
            <Field full req label={nameLabel}><input required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Phone"><input type="tel" maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Contact number" /></Field>
            <Field label="Subject"><input maxLength={160} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Short title" /></Field>
            {(type?.fields || []).map((q) => (
              <Field key={q.key} full={q.type === 'textarea'} label={q.label} req={q.required}>
                {q.type === 'select' ? (
                  <select required={q.required} value={extra[q.key] || ''} onChange={setX(q.key)}><option value="">Select</option>{q.options.map((o) => <option key={o}>{o}</option>)}</select>
                ) : q.type === 'textarea' ? (
                  <textarea rows={3} required={q.required} value={extra[q.key] || ''} onChange={setX(q.key)} />
                ) : (
                  <input type={q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text'} required={q.required} value={extra[q.key] || ''} onChange={setX(q.key)} />
                )}
              </Field>))}
            <Field full label="Details / notes"><textarea rows={4} maxLength={3000} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="What does the person want to know or ask?" /></Field>
            {err && <div className="ds-full"><Notice tone="bad">{err}</Notice></div>}
            <div className="ds-full ds-inline"><Button type="submit" kind="primary" loading={busy} disabled={!f.name.trim()}>{`Save ${type?.name?.toLowerCase() || 'query'}`}</Button></div>
          </FormGrid>
        </form>
      </Section>
    </Page>
  );
});

/* ================================================================== LIST */
export const QueryList = scoped(function QueryList({ me, sid }) {
  const { data: meta } = useMeta(me, sid);
  const [flt, setFlt] = useState({ status_id: '', type_id: '', open: '', q: '' });
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setFlt((x) => ({ ...x, q: term })), 300); return () => clearTimeout(t); }, [term]);
  const { data: d, error: err, refresh } = useApi(`/queries${qs({ ...sq(me, sid), ...flt })}`, true, { keepPrevious: true });
  const [open, setOpen] = useState(null);
  if (err) return <Page><Notice tone="bad" action={<Button size="sm" onClick={refresh}>Retry</Button>}>{err}</Notice></Page>;
  if (!d || !meta) return <Loading />;
  const st = (id) => meta.statuses.find((s) => s.id === id);
  const n = d.queries.length;
  return (
    <Page>
      <PageBar title="Queries" sub={`${d.total} in total${d.total > n ? ` - showing the latest ${n}` : ''}`} />
      <FilterBar q={term} onQ={setTerm} placeholder="Search name, phone or subject" count={n}
        filters={[
          { key: 'status', label: 'Status', value: flt.open ? 'open' : flt.status_id, onChange: (v) => setFlt((p) => ({ ...p, open: v === 'open' ? '1' : '', status_id: v === 'open' ? '' : v })), all: 'All statuses', options: [{ value: 'open', label: 'Not finished' }, ...meta.statuses.map((x) => ({ value: x.id, label: x.name }))],
            chip: (v) => `Status: ${v === 'open' ? 'Not finished' : (st(v)?.name || v)}` },
          { key: 'type', label: 'Form', value: flt.type_id, onChange: (v) => setFlt((p) => ({ ...p, type_id: v })), all: 'All forms', options: meta.types.map((t) => ({ value: t.id, label: t.name })) },
        ]} />
      {!d.can_see_all && <Notice tone="info">You can see only the queries you recorded.</Notice>}
      <Section flush>
        {n === 0 ? <EmptyState icon="chat" title="No queries found">Try a different search or filter.</EmptyState> : (
          <List>{d.queries.map((x) => (
            <ListRow key={x.id} onClick={() => setOpen(x.id)} lead={<DsBadge tone="info" dot={false}>{refNo(x.ref_no)}</DsBadge>} title={x.name}
              sub={`${x.type_name}${x.subject ? ` - ${x.subject}` : ''}${x.phone ? ` - ${x.phone}` : ''}`}
              meta={<><StatusBadge s={st(x.status_id)} /><span className="ds-note">{fmtD(x.created_at)}</span></>} />))}</List>)}
      </Section>
      {open && <QueryDetail me={me} sid={sid} id={open} meta={meta} onClose={() => setOpen(null)} onChanged={refresh} />}
    </Page>
  );
});

function QueryDetail({ me, sid, id, meta, onClose, onChanged }) {
  const { data: x, error, refresh } = useApi(`/queries/${id}${qs(sq(me, sid))}`, true);
  const [statusId, setStatusId] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const canUpdate = me.features.includes('update_query'); const canDel = me.features.includes('delete_query');
  const type = meta.types.find((t) => t.id === x?.type_id);
  const st = (sid2) => meta.statuses.find((s) => s.id === sid2);
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.patch(`/queries/${id}`, { ...sq(me, sid), status_id: statusId ?? x.status_id, note }); setNote(''); setStatusId(null); toast('Saved'); await refresh(); onChanged(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const del = async () => { if (!(await ask(`Delete ${refNo(x.ref_no)} for ${x.name}? This cannot be undone.`))) return; try { await api.del(`/queries/${id}${qs(sq(me, sid))}`); toast('Deleted'); onChanged(); onClose(); } catch (e) { toast(e.message, true); } };
  const noChange = !note.trim() && (statusId === null || statusId === x?.status_id);
  return (
    <FormDialog title={x ? `${refNo(x.ref_no)} - ${x.type_name}` : 'Query'} onClose={onClose} wide onSubmit={save} busy={busy} error={err}
      hideFooter={!canUpdate || !x} submitLabel="Save update" submitDisabled={noChange} cancelLabel="Close">
      {error ? <Notice tone="bad">{error}</Notice> : !x ? <Loading /> : (
        <div className="ds-stack">
          <div className="ds-spread"><div><b>{x.name}</b><span className="ds-subline">{x.phone || 'No phone'} - {fmtDT(x.created_at)}{x.created_by_name ? ` - by ${x.created_by_name}` : ''}</span></div><StatusBadge s={st(x.status_id)} /></div>
          {x.subject && <dl className="ds-kv"><dt>Subject</dt><dd><b>{x.subject}</b></dd></dl>}
          {Object.keys(x.data || {}).length > 0 && (
            <dl className="ds-kv ds-sunk">{(type?.fields || Object.keys(x.data).map((k) => ({ key: k, label: k }))).filter((q) => x.data[q.key]).map((q) => <React.Fragment key={q.key}><dt>{q.label}</dt><dd>{x.data[q.key]}</dd></React.Fragment>)}</dl>)}
          {x.details && <dl className="ds-kv"><dt>Details</dt><dd className="ds-pre">{x.details}</dd></dl>}
          {canUpdate && (
            <FormGrid>
              <Field full label="Status"><select value={statusId ?? x.status_id ?? ''} onChange={(e) => setStatusId(e.target.value)}>{meta.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? ' (finished)' : ''}</option>)}</select></Field>
              <Field full label="Add a note (optional)"><textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called back, visit booked for Monday" /></Field>
            </FormGrid>)}
          <div className="ds-label">History</div>
          {x.notes.length === 0 ? <p className="ds-hint">No updates yet.</p> : (
            <List>{x.notes.map((n) => (
              <ListRow wrap key={n.id} title={n.status_name ? `Status changed to ${n.status_name}` : (n.note || 'Update')} sub={`${n.status_name && n.note ? `${n.note} - ` : ''}${n.by || 'Someone'} - ${fmtDT(n.created_at)}`} />))}</List>)}
          {canDel && <div className="ds-inline"><Button kind="danger" icon="trash" onClick={del}>Delete query</Button></div>}
        </div>)}
    </FormDialog>
  );
}

/* ================================================================== SETTINGS: forms + statuses */
export const QuerySettings = scoped(function QuerySettings({ me, sid }) {
  const { data: meta, error, refresh } = useMeta(me, sid);
  const [editType, setEditType] = useState(null); const [editStatus, setEditStatus] = useState(null);
  if (error) return <Page narrow><Notice tone="bad" action={<Button size="sm" onClick={refresh}>Retry</Button>}>{error}</Notice></Page>;
  if (!meta) return <Loading />;
  const q = sq(me, sid);
  const toggle = async (t) => { try { await api.patch(`/queries/types/${t.id}`, { ...q, is_active: !t.is_active }); refresh(); } catch (x) { toast(x.message, true); } };
  const delType = async (t) => { if (!(await ask(`Delete the form "${t.name}"?`))) return; try { await api.del(`/queries/types/${t.id}${qs(q)}`); toast('Deleted'); refresh(); } catch (x) { toast(x.message, true); } };
  const delStatus = async (s) => { if (!(await ask(`Delete the status "${s.name}"?`))) return; try { await api.del(`/queries/statuses/${s.id}${qs(q)}`); toast('Deleted'); refresh(); } catch (x) { toast(x.message, true); } };
  const makeDefault = async (s) => { try { await api.patch(`/queries/statuses/${s.id}`, { ...q, is_default: true }); refresh(); } catch (x) { toast(x.message, true); } };
  return (
    <Page narrow>
      <PageBar title="Forms & statuses" sub="What people fill in, and the stages a query moves through" />
      <Section title="Forms" sub="What people fill in when they raise a query" flush actions={<Button kind="primary" size="sm" icon="plus" onClick={() => setEditType({})}>New form</Button>}>
        {meta.types.length === 0 ? <EmptyState icon="chat" title="No forms yet">Add the first form with the button above.</EmptyState> : (
          <List>{meta.types.map((t) => (
            <ListRow key={t.id} title={t.name} sub={`${t.audience === 'internal' ? 'Internal' : 'Parents / visitors'} - ${t.fields.length} extra question${t.fields.length === 1 ? '' : 's'}${t.is_active ? '' : ' - switched off'}`}
              meta={t.is_active ? null : <DsBadge tone="mute" dot={false}>Off</DsBadge>}>
              <span className="ds-inline">
                <Button size="sm" onClick={() => toggle(t)}>{t.is_active ? 'Switch off' : 'Switch on'}</Button>
                <Button kind="ghost" size="sm" icon="edit" aria-label={`Edit ${t.name}`} onClick={() => setEditType(t)} />
                <Button kind="ghost" size="sm" icon="trash" aria-label={`Delete ${t.name}`} onClick={() => delType(t)} />
              </span>
            </ListRow>))}</List>)}
      </Section>
      <Section title="Statuses" sub="Stages a response moves through" flush actions={<Button kind="primary" size="sm" icon="plus" onClick={() => setEditStatus({})}>New status</Button>}>
        <List>{meta.statuses.map((s) => (
          <ListRow key={s.id} lead={<DsBadge tone={tone(s.color)}>{s.name}</DsBadge>} title={s.is_closed ? 'Counts as finished' : 'Still open'} sub={s.is_default ? 'Used for new queries' : undefined}>
            <span className="ds-inline">
              {!s.is_default && !s.is_closed && <Button kind="ghost" size="sm" onClick={() => makeDefault(s)}>Use for new queries</Button>}
              <Button kind="ghost" size="sm" icon="edit" aria-label={`Edit ${s.name}`} onClick={() => setEditStatus(s)} />
              <Button kind="ghost" size="sm" icon="trash" aria-label={`Delete ${s.name}`} onClick={() => delStatus(s)} />
            </span>
          </ListRow>))}</List>
      </Section>
      {editType && <TypeEditor q={q} t={editType} onClose={() => setEditType(null)} onSaved={() => { setEditType(null); refresh(); toast('Saved'); }} />}
      {editStatus && <StatusEditor q={q} s={editStatus} onClose={() => setEditStatus(null)} onSaved={() => { setEditStatus(null); refresh(); toast('Saved'); }} />}
    </Page>
  );
});

function TypeEditor({ q, t, onClose, onSaved }) {
  const [f, setF] = useState({ name: t.name || '', audience: t.audience || 'external' });
  const [fields, setFields] = useState((t.fields || []).map((x) => ({ ...x, options: (x.options || []).join(', ') })));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const setField = (i, patch) => setFields(fields.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true); setErr('');
    const body = { ...q, ...f, fields: fields.map((x) => ({ ...x, options: x.type === 'select' ? x.options.split(',') : undefined })) };
    try { if (t.id) await api.patch(`/queries/types/${t.id}`, body); else await api.post('/queries/types', body); onSaved(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <FormDialog title={t.id ? 'Edit form' : 'New form'} sub="Every form already asks for name, phone, subject and details. Add extra questions below." onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Save form" wide>
      <FormGrid>
        <Field req label="Form name"><input required autoFocus maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Transport request" /></Field>
        <Field label="Who is it for?"><select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="external">Parents / visitors</option><option value="internal">Internal (staff)</option></select></Field>
      </FormGrid>
      <div className="ds-label">Extra questions</div>
      <div className="ds-stack">
        {fields.map((x, i) => (
          <div key={i} className="ds-sunk">
            <FormGrid>
              <Field label="Question"><input required maxLength={80} value={x.label} onChange={(e) => setField(i, { label: e.target.value })} /></Field>
              <Field label="Answer type"><select value={x.type} onChange={(e) => setField(i, { type: e.target.value })}><option value="text">Short text</option><option value="textarea">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Choose from list</option></select></Field>
              {x.type === 'select' && <Field full label="Choices (comma separated)"><input required value={x.options} onChange={(e) => setField(i, { options: e.target.value })} placeholder="Yes, No, Maybe" /></Field>}
              <label className="ds-check"><input type="checkbox" checked={!!x.required} onChange={(e) => setField(i, { required: e.target.checked })} />Required</label>
              <div className="ds-inline"><Button kind="danger" size="sm" icon="trash" onClick={() => setFields(fields.filter((_, j) => j !== i))}>Remove</Button></div>
            </FormGrid>
          </div>))}
        <div className="ds-inline"><Button icon="plus" onClick={() => setFields([...fields, { label: '', type: 'text', required: false, options: '' }])}>Add question</Button></div>
      </div>
    </FormDialog>
  );
}

function StatusEditor({ q, s, onClose, onSaved }) {
  const [f, setF] = useState({ name: s.name || '', color: s.color || 'info', is_closed: !!s.is_closed });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setErr(''); try { if (s.id) await api.patch(`/queries/statuses/${s.id}`, { ...q, ...f }); else await api.post('/queries/statuses', { ...q, ...f }); onSaved(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <FormDialog title={s.id ? 'Edit status' : 'New status'} onClose={onClose} onSubmit={save} busy={busy} error={err}>
      <FormGrid>
        <Field full req label="Status name"><input required autoFocus maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Waiting for documents" /></Field>
        <Field full label="Colour"><Choice label="Colour" options={TONES.map(([value, label]) => ({ value, label }))} value={f.color} onChange={(v) => setF({ ...f, color: v })} /></Field>
        <label className="ds-check ds-full"><input type="checkbox" checked={f.is_closed} onChange={(e) => setF({ ...f, is_closed: e.target.checked })} />This status means the query is finished</label>
      </FormGrid>
    </FormDialog>
  );
}
