import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Empty, Field, Modal, Badge, toast, Loading, ask } from '../ui.jsx';
import { scoped } from './AttendanceModule.jsx';

const sq = (me, sid) => (me.role === 'super_admin' ? { school_id: sid } : {});
const qs = (o) => { const p = new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))); const s = p.toString(); return s ? `?${s}` : ''; };
const fmtDT = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtD = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const refNo = (n) => `Q-${String(n).padStart(4, '0')}`;
const TONES = [['warn', 'Orange'], ['info', 'Blue'], ['ok', 'Green'], ['off', 'Red'], ['mute', 'Grey']];

const useMeta = (me, sid) => useApi(`/queries/meta${qs(sq(me, sid))}`, true, { keepPrevious: true });
const StatusBadge = ({ s }) => (s ? <Badge tone={s.color}>{s.name}</Badge> : <Badge tone="mute">No status</Badge>);

/* ================================================================== NEW QUERY (the form) */
export const NewQuery = scoped(function NewQuery({ me, sid, go }) {
  const { data: meta, error } = useMeta(me, sid);
  const [typeId, setTypeId] = useState('');
  const [f, setF] = useState({ name: '', phone: '', subject: '', details: '' });
  const [extra, setExtra] = useState({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  useEffect(() => { if (meta && !typeId && meta.types.length) setTypeId(meta.types[0].id); }, [meta]); // eslint-disable-line
  const type = useMemo(() => meta?.types.find((t) => t.id === typeId), [meta, typeId]);
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  if (!meta.types.length) return <Empty>No forms are switched on yet. Ask an admin to add one in Forms &amp; statuses.</Empty>;

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
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div className="pills">{meta.types.map((t) => <button key={t.id} type="button" className={`pill ${t.id === typeId ? 'on' : ''}`} onClick={() => pick(t.id)}>{t.name}</button>)}</div>
      <form className="card form" onSubmit={save}>
        <div className="full"><Field label={nameLabel} req><input required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
        <Field label="Phone"><input type="tel" maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Contact number" /></Field>
        <Field label="Subject"><input maxLength={160} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Short title" /></Field>
        {(type?.fields || []).map((q) => (
          <div key={q.key} className={q.type === 'textarea' ? 'full' : ''}>
            <Field label={q.label} req={q.required}>
              {q.type === 'select' ? (
                <select required={q.required} value={extra[q.key] || ''} onChange={(e) => setExtra({ ...extra, [q.key]: e.target.value })}><option value="">Select</option>{q.options.map((o) => <option key={o}>{o}</option>)}</select>
              ) : q.type === 'textarea' ? (
                <textarea rows={3} required={q.required} value={extra[q.key] || ''} onChange={(e) => setExtra({ ...extra, [q.key]: e.target.value })} />
              ) : (
                <input type={q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text'} required={q.required} value={extra[q.key] || ''} onChange={(e) => setExtra({ ...extra, [q.key]: e.target.value })} />
              )}
            </Field>
          </div>))}
        <div className="full"><Field label="Details / notes"><textarea rows={4} maxLength={3000} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="What does the person want to know or ask?" /></Field></div>
        {err && <div className="err full">{err}</div>}
        <button className="btn primary full big" disabled={busy || !f.name.trim()} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : `Save ${type?.name?.toLowerCase() || 'query'}`}</button>
      </form>
      {last && <div className="notice ok"><b>{refNo(last.ref_no)}</b> recorded for {last.name}. It is marked as pending.{' '}<button className="linkbtn" onClick={() => go('list')}>See all queries</button></div>}
    </div>
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
  if (err) return <div className="err">{err}</div>;
  if (!d || !meta) return <Loading />;
  const st = (id) => meta.statuses.find((s) => s.id === id);
  return (
    <div className="stack" style={{ maxWidth: 1040 }}>
      <div className="card row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}><input placeholder="Search name, phone or subject" value={term} onChange={(e) => setTerm(e.target.value)} style={{ paddingLeft: 36 }} /><span style={{ position: 'absolute', left: 11, top: 10, color: 'var(--mute)' }}><Icon name="search" size={18} /></span></div>
        <select style={{ width: 'auto' }} value={flt.open ? 'open' : flt.status_id} onChange={(e) => setFlt({ ...flt, open: e.target.value === 'open' ? '1' : '', status_id: e.target.value === 'open' ? '' : e.target.value })}>
          <option value="">All statuses</option><option value="open">Not finished</option>{meta.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select style={{ width: 'auto' }} value={flt.type_id} onChange={(e) => setFlt({ ...flt, type_id: e.target.value })}>
          <option value="">All forms</option>{meta.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {!d.can_see_all && <div className="notice">You can see only the queries you recorded.</div>}
      {d.queries.length === 0 ? <Empty>No queries found.</Empty> : (
        <div className="card" style={{ padding: 0 }}>{d.queries.map((x) => (
          <button key={x.id} className="drow" onClick={() => setOpen(x.id)}>
            <span className="vtime" style={{ minWidth: 70 }}>{refNo(x.ref_no)}</span>
            <div style={{ flex: 1, minWidth: 0 }}><b>{x.name}</b><small>{x.type_name}{x.subject ? ` - ${x.subject}` : ''}{x.phone ? ` - ${x.phone}` : ''}</small></div>
            <div style={{ textAlign: 'right' }}><StatusBadge s={st(x.status_id)} /><small>{fmtD(x.created_at)}</small></div>
          </button>))}</div>)}
      {d.total > d.size && <div className="muted" style={{ fontSize: 13 }}>Showing the latest {d.queries.length} of {d.total}. Use search or filters to narrow down.</div>}
      {open && <QueryDetail me={me} sid={sid} id={open} meta={meta} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  );
});

function QueryDetail({ me, sid, id, meta, onClose, onChanged }) {
  const { data: x, error, refresh } = useApi(`/queries/${id}${qs(sq(me, sid))}`, true);
  const [statusId, setStatusId] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const canUpdate = me.features.includes('update_query'); const canDel = me.features.includes('delete_query');
  const type = meta.types.find((t) => t.id === x?.type_id);
  const st = (sid2) => meta.statuses.find((s) => s.id === sid2);
  const save = async () => {
    setBusy(true);
    try { await api.patch(`/queries/${id}`, { ...sq(me, sid), status_id: statusId ?? x.status_id, note }); setNote(''); setStatusId(null); toast('Saved'); await refresh(); onChanged(); } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const del = async () => { if (!(await ask(`Delete ${refNo(x.ref_no)} for ${x.name}? This cannot be undone.`))) return; try { await api.del(`/queries/${id}${qs(sq(me, sid))}`); toast('Deleted'); onChanged(); onClose(); } catch (e) { toast(e.message, true); } };
  return (
    <Modal title={x ? `${refNo(x.ref_no)} - ${x.type_name}` : 'Query'} onClose={onClose} wide>
      {error ? <div className="err">{error}</div> : !x ? <Loading /> : (
        <div className="stack">
          <div className="row sp"><div><b style={{ fontSize: 17 }}>{x.name}</b><div className="muted" style={{ fontSize: 14 }}>{x.phone || 'No phone'} - {fmtDT(x.created_at)}{x.created_by_name ? ` - by ${x.created_by_name}` : ''}</div></div><StatusBadge s={st(x.status_id)} /></div>
          {x.subject && <div><small className="muted">Subject</small><div><b>{x.subject}</b></div></div>}
          {Object.keys(x.data || {}).length > 0 && (
            <div className="card form" style={{ background: 'var(--bg)' }}>{(type?.fields || Object.keys(x.data).map((k) => ({ key: k, label: k }))).filter((q) => x.data[q.key]).map((q) => <div key={q.key}><small className="muted">{q.label}</small><div>{x.data[q.key]}</div></div>)}</div>)}
          {x.details && <div><small className="muted">Details</small><div style={{ whiteSpace: 'pre-wrap' }}>{x.details}</div></div>}
          {canUpdate && (
            <div className="card form">
              <div className="full"><Field label="Status"><select value={statusId ?? x.status_id ?? ''} onChange={(e) => setStatusId(e.target.value)}>{meta.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? ' (finished)' : ''}</option>)}</select></Field></div>
              <div className="full"><Field label="Add a note (optional)"><textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called back, visit booked for Monday" /></Field></div>
              <button className="btn primary full" disabled={busy || (!note.trim() && (statusId === null || statusId === x.status_id))} onClick={save} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : 'Save update'}</button>
            </div>)}
          <div>
            <b>History</b>
            {x.notes.length === 0 ? <div className="muted" style={{ fontSize: 14 }}>No updates yet.</div> : x.notes.map((n) => (
              <div key={n.id} className="drow" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>{n.status_name && <div>Status changed to <b>{n.status_name}</b></div>}{n.note && <div style={{ whiteSpace: 'pre-wrap' }}>{n.note}</div>}<small>{n.by || 'Someone'} - {fmtDT(n.created_at)}</small></div>
              </div>))}
          </div>
          {canDel && <button className="btn" onClick={del} style={{ alignSelf: 'flex-start' }}><Icon name="trash" />Delete</button>}
        </div>)}
    </Modal>
  );
}

/* ================================================================== SETTINGS: forms + statuses */
export const QuerySettings = scoped(function QuerySettings({ me, sid }) {
  const { data: meta, error, refresh } = useMeta(me, sid);
  const [editType, setEditType] = useState(null); const [editStatus, setEditStatus] = useState(null);
  if (error) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  const q = sq(me, sid);
  const toggle = async (t) => { try { await api.patch(`/queries/types/${t.id}`, { ...q, is_active: !t.is_active }); refresh(); } catch (x) { toast(x.message, true); } };
  const delType = async (t) => { if (!(await ask(`Delete the form "${t.name}"?`))) return; try { await api.del(`/queries/types/${t.id}${qs(q)}`); toast('Deleted'); refresh(); } catch (x) { toast(x.message, true); } };
  const delStatus = async (s) => { if (!(await ask(`Delete the status "${s.name}"?`))) return; try { await api.del(`/queries/statuses/${s.id}${qs(q)}`); toast('Deleted'); refresh(); } catch (x) { toast(x.message, true); } };
  const makeDefault = async (s) => { try { await api.patch(`/queries/statuses/${s.id}`, { ...q, is_default: true }); refresh(); } catch (x) { toast(x.message, true); } };
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="row sp"><b style={{ fontSize: 17 }}>Forms</b><button className="btn primary" onClick={() => setEditType({})}><Icon name="plus" />New form</button></div>
      <div className="card" style={{ padding: 0 }}>{meta.types.map((t) => (
        <div key={t.id} className="drow" style={{ cursor: 'default', opacity: t.is_active ? 1 : 0.55 }}>
          <div style={{ flex: 1 }}><b>{t.name}</b><small>{t.audience === 'internal' ? 'Internal' : 'Parents / visitors'} - {t.fields.length} extra question{t.fields.length === 1 ? '' : 's'}{t.is_active ? '' : ' - switched off'}</small></div>
          <button className="btn" onClick={() => toggle(t)}>{t.is_active ? 'Switch off' : 'Switch on'}</button>
          <button className="icon-btn" aria-label={`Edit ${t.name}`} onClick={() => setEditType(t)}><Icon name="edit" /></button>
          <button className="icon-btn" aria-label={`Delete ${t.name}`} onClick={() => delType(t)}><Icon name="trash" /></button>
        </div>))}</div>
      <div className="row sp"><b style={{ fontSize: 17 }}>Statuses</b><button className="btn primary" onClick={() => setEditStatus({})}><Icon name="plus" />New status</button></div>
      <div className="card" style={{ padding: 0 }}>{meta.statuses.map((s) => (
        <div key={s.id} className="drow" style={{ cursor: 'default' }}>
          <div style={{ flex: 1 }}><Badge tone={s.color}>{s.name}</Badge> <small style={{ display: 'inline', marginLeft: 8 }}>{s.is_closed ? 'Counts as finished' : 'Still open'}{s.is_default ? ' - used for new queries' : ''}</small></div>
          {!s.is_default && !s.is_closed && <button className="linkbtn" onClick={() => makeDefault(s)}>Use for new queries</button>}
          <button className="icon-btn" aria-label={`Edit ${s.name}`} onClick={() => setEditStatus(s)}><Icon name="edit" /></button>
          <button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => delStatus(s)}><Icon name="trash" /></button>
        </div>))}</div>
      {editType && <TypeEditor q={q} t={editType} onClose={() => setEditType(null)} onSaved={() => { setEditType(null); refresh(); toast('Saved'); }} />}
      {editStatus && <StatusEditor q={q} s={editStatus} onClose={() => setEditStatus(null)} onSaved={() => { setEditStatus(null); refresh(); toast('Saved'); }} />}
    </div>
  );
});

function TypeEditor({ q, t, onClose, onSaved }) {
  const [f, setF] = useState({ name: t.name || '', audience: t.audience || 'external' });
  const [fields, setFields] = useState((t.fields || []).map((x) => ({ ...x, options: (x.options || []).join(', ') })));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const setField = (i, patch) => setFields(fields.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const body = { ...q, ...f, fields: fields.map((x) => ({ ...x, options: x.type === 'select' ? x.options.split(',') : undefined })) };
    try { if (t.id) await api.patch(`/queries/types/${t.id}`, body); else await api.post('/queries/types', body); onSaved(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={t.id ? 'Edit form' : 'New form'} onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <Field label="Form name" req><input required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Transport request" /></Field>
        <Field label="Who is it for?"><select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="external">Parents / visitors</option><option value="internal">Internal (staff)</option></select></Field>
        <div className="full"><small className="muted">Every form already asks for name, phone, subject and details. Add extra questions below.</small></div>
        {fields.map((x, i) => (
          <div key={i} className="full card form" style={{ background: 'var(--bg)' }}>
            <Field label="Question"><input required maxLength={80} value={x.label} onChange={(e) => setField(i, { label: e.target.value })} /></Field>
            <Field label="Answer type"><select value={x.type} onChange={(e) => setField(i, { type: e.target.value })}><option value="text">Short text</option><option value="textarea">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Choose from list</option></select></Field>
            {x.type === 'select' && <div className="full"><Field label="Choices (comma separated)"><input required value={x.options} onChange={(e) => setField(i, { options: e.target.value })} placeholder="Yes, No, Maybe" /></Field></div>}
            <label className="row" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto' }} checked={!!x.required} onChange={(e) => setField(i, { required: e.target.checked })} />Required</label>
            <button type="button" className="btn" onClick={() => setFields(fields.filter((_, j) => j !== i))}><Icon name="trash" />Remove</button>
          </div>))}
        <div className="full"><button type="button" className="btn" onClick={() => setFields([...fields, { label: '', type: 'text', required: false, options: '' }])}><Icon name="plus" />Add question</button></div>
        {err && <div className="err full">{err}</div>}
        <button className="btn primary full" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : 'Save form'}</button>
      </form>
    </Modal>
  );
}

function StatusEditor({ q, s, onClose, onSaved }) {
  const [f, setF] = useState({ name: s.name || '', color: s.color || 'info', is_closed: !!s.is_closed });
  const [err, setErr] = useState('');
  const save = async (e) => { e.preventDefault(); try { if (s.id) await api.patch(`/queries/statuses/${s.id}`, { ...q, ...f }); else await api.post('/queries/statuses', { ...q, ...f }); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={s.id ? 'Edit status' : 'New status'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="full"><Field label="Status name" req><input required maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Waiting for documents" /></Field></div>
        <div className="full"><Field label="Colour"><div className="pills">{TONES.map(([k, l]) => <button key={k} type="button" className={`pill ${f.color === k ? 'on' : ''}`} onClick={() => setF({ ...f, color: k })}>{l}</button>)}</div></Field></div>
        <label className="full row" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto' }} checked={f.is_closed} onChange={(e) => setF({ ...f, is_closed: e.target.checked })} />This status means the query is finished</label>
        {err && <div className="err full">{err}</div>}
        <button className="btn primary full" style={{ justifyContent: 'center' }}>Save</button>
      </form>
    </Modal>
  );
}
