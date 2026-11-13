// Queries module for mobile. Mirrors client/src/modules/QueriesModule.jsx (same endpoints and rules).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { api } from '../api';
import { C, T } from '../theme';
import { Dim, Loading, Btn, Field, Input, Choice, Check, toast, confirmAsk } from '../ui';
import { FilterBar } from '../FilterBar';
import { useApi } from '../useApi';
import { scoped, qs, Pad, Notice, List, Row, PageHeader, Tabs, Section, StatusChip, EmptyState, FormSheet } from '../kit';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (s) => { const d = new Date(s); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const fmtDT = (s) => { const d = new Date(s); const h = d.getHours(); return `${DAY[d.getDay()]}, ${fmtD(s)}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const refNo = (n) => `Q-${String(n).padStart(4, '0')}`;
const tone = (c) => (c === 'off' ? 'bad' : c || 'mute'); // statuses are stored with the old colour name "off" for red
const COLORS = [['warn', 'Orange'], ['info', 'Blue'], ['ok', 'Green'], ['off', 'Red'], ['mute', 'Grey']];

const Pill = ({ s }) => <StatusChip tone={s ? tone(s.color) : 'mute'}>{s ? s.name : 'No status'}</StatusChip>;
const Label = ({ children }) => <Text style={{ color: C.mute, fontSize: T.fs.xs, marginTop: T.sp[2] }}>{children}</Text>;
const useMeta = (sc) => useApi(`/queries/meta${qs(sc)}`);

/* ================================================================== NEW QUERY */
export const NewQuery = scoped(function NewQuery({ sc, go }) {
  const { data: meta, error, reload } = useMeta(sc);
  const [typeId, setTypeId] = useState('');
  const [f, setF] = useState({ name: '', phone: '', subject: '', details: '' });
  const [extra, setExtra] = useState({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  useEffect(() => { if (meta && !meta.types.find((t) => t.id === typeId) && meta.types.length) setTypeId(meta.types[0].id); }, [meta]); // eslint-disable-line
  const type = useMemo(() => meta?.types.find((t) => t.id === typeId), [meta, typeId]);
  if (error && !meta) return <Pad><Notice tone="bad">{error}</Notice><Btn small kind="ghost" title="Retry" onPress={reload} /></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  if (!meta.types.length) return <Pad><PageHeader title="New query" /><Section><EmptyState icon="chat" title="No forms are switched on yet">Ask an admin to add one in Forms & statuses.</EmptyState></Section></Pad>;
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const row = await api.post('/queries', { ...sc, ...f, type_id: typeId, data: extra });
      setLast(row); toast('Query recorded');
      setF({ name: '', phone: '', subject: '', details: '' }); setExtra({});
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const missing = (type?.fields || []).some((q) => q.required && !String(extra[q.key] || '').trim());
  return (
    <Pad>
      <PageHeader title="New query" sub="Record what a parent, visitor or staff member asked" />
      {meta.types.length > 1 && <Tabs items={meta.types.map((t) => ({ key: t.id, label: t.name }))} value={typeId} onChange={(v) => { setTypeId(v); setExtra({}); setErr(''); }} />}
      {last && <Notice tone="ok">{refNo(last.ref_no)} recorded for {last.name}. It is marked as pending. <Text style={{ fontWeight: T.fw.bold, textDecorationLine: 'underline' }} onPress={() => go?.('list')}>See all queries</Text></Notice>}
      <Section>
        <Field req label={type?.audience === 'internal' ? 'Raised by (name)' : "Person's name (parent / visitor)"}><Input maxLength={120} value={f.name} onChangeText={set('name')} /></Field>
        <Field label="Phone"><Input keyboardType="phone-pad" maxLength={30} value={f.phone} onChangeText={set('phone')} placeholder="Contact number" /></Field>
        <Field label="Subject"><Input maxLength={160} value={f.subject} onChangeText={set('subject')} placeholder="Short title" /></Field>
        {(type?.fields || []).map((q) => (
          <Field key={q.key} req={q.required} label={q.label}>
            {q.type === 'select'
              ? <Choice value={extra[q.key] || ''} onChange={(v) => setExtra({ ...extra, [q.key]: v })} options={q.options.map((o) => ({ value: o, label: o }))} />
              : <Input multiline={q.type === 'textarea'} keyboardType={q.type === 'number' ? 'numeric' : 'default'} placeholder={q.type === 'date' ? 'YYYY-MM-DD' : undefined} maxLength={500} value={extra[q.key] || ''} onChangeText={(v) => setExtra({ ...extra, [q.key]: v })} />}
          </Field>))}
        <Field label="Details / notes"><Input multiline maxLength={3000} value={f.details} onChangeText={set('details')} placeholder="What does the person want to know or ask?" /></Field>
        {!!err && <Notice tone="bad">{err}</Notice>}
        <Btn title={busy ? 'Saving...' : `Save ${type?.name?.toLowerCase() || 'query'}`} onPress={save} disabled={busy || !f.name.trim() || missing} />
      </Section>
    </Pad>
  );
});

/* ================================================================== LIST */
export const QueryList = scoped(function QueryList({ me, sc }) {
  const { data: meta } = useMeta(sc);
  const [flt, setFlt] = useState({ status: '', type_id: '' });
  const [term, setTerm] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  const params = { ...sc, q, type_id: flt.type_id, ...(flt.status === 'open' ? { open: '1' } : flt.status ? { status_id: flt.status } : {}) };
  const { data: d, error, loading, reload } = useApi(`/queries${qs(params)}`);
  const [open, setOpen] = useState(null);
  if (error && !d) return <Pad><Notice tone="bad">{error}</Notice><Btn small kind="ghost" title="Retry" onPress={reload} /></Pad>;
  if (!d || !meta) return <Pad><Loading /></Pad>;
  const st = (id) => meta.statuses.find((s) => s.id === id);
  const n = d.queries.length;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <PageHeader title="Queries" sub={`${d.total} in total${d.total > n ? ` · showing the latest ${n}` : ''}`} />
      <FilterBar inline q={term} onQ={setTerm} placeholder="Search name, phone or subject" count={n}
        filters={[
          { key: 'status', label: 'Status', value: flt.status, onChange: (v) => setFlt((p) => ({ ...p, status: v })), all: 'All statuses', options: [{ value: 'open', label: 'Not finished' }, ...meta.statuses.map((x) => ({ value: x.id, label: x.name }))], chip: (v) => `Status: ${v === 'open' ? 'Not finished' : (st(v)?.name || v)}` },
          { key: 'type', label: 'Form', value: flt.type_id, onChange: (v) => setFlt((p) => ({ ...p, type_id: v })), all: 'All forms', options: meta.types.map((t) => ({ value: t.id, label: t.name })) },
        ]} />
      {!d.can_see_all && <Notice>You can see only the queries you recorded.</Notice>}
      <List>
        {n === 0 ? <EmptyState icon="chat" title="No queries found">Try a different search or filter.</EmptyState> : d.queries.map((x, i) => (
          <Row key={x.id} last={i === n - 1} onPress={() => setOpen(x.id)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }}>{x.name}</Text>
              <Dim>{refNo(x.ref_no)} · {x.type_name}{x.subject ? ` · ${x.subject}` : ''}</Dim>
              {x.phone ? <Dim>{x.phone}</Dim> : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: T.sp[1] }}><Pill s={st(x.status_id)} /><Dim>{fmtD(x.created_at)}</Dim></View>
          </Row>))}
      </List>
      {open && <QueryDetail me={me} sc={sc} id={open} meta={meta} onClose={() => setOpen(null)} onChanged={reload} />}
    </Pad>
  );
});

function QueryDetail({ me, sc, id, meta, onClose, onChanged }) {
  const { data: x, error, reload } = useApi(`/queries/${id}${qs(sc)}`);
  const [statusId, setStatusId] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const canUpdate = me.features.includes('update_query'); const canDel = me.features.includes('delete_query');
  const type = meta.types.find((t) => t.id === x?.type_id);
  const st = (v) => meta.statuses.find((s) => s.id === v);
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.patch(`/queries/${id}`, { ...sc, status_id: statusId ?? x.status_id, note }); setNote(''); setStatusId(null); toast('Saved'); await reload(); onChanged(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const del = () => confirmAsk(`Delete ${refNo(x.ref_no)} for ${x.name}? This cannot be undone.`, async () => { try { await api.del(`/queries/${id}${qs(sc)}`); toast('Deleted'); onChanged(); onClose(); } catch (e) { toast(e.message, true); } });
  const answers = x ? (type?.fields || Object.keys(x.data || {}).map((k) => ({ key: k, label: k }))).filter((q) => x.data?.[q.key]) : [];
  return (
    <FormSheet title={x ? `${refNo(x.ref_no)} · ${x.type_name}` : 'Query'} onClose={onClose} onSubmit={save} busy={busy} error={err}
      hideFooter={!canUpdate || !x} cancelLabel="Close" submitLabel="Save update" submitDisabled={!note.trim() && (statusId === null || statusId === x?.status_id)}>
      {error && !x ? <Notice tone="bad">{error}</Notice> : !x ? <Loading /> : (
        <View>
          <Section>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: T.sp[2] }}><Text style={{ fontSize: T.fs.lg, fontWeight: T.fw.bold, color: C.ink, flex: 1 }}>{x.name}</Text><Pill s={st(x.status_id)} /></View>
            <Dim>{x.phone || 'No phone'} · {fmtDT(x.created_at)}{x.created_by_name ? ` · by ${x.created_by_name}` : ''}</Dim>
            {x.subject ? <><Label>Subject</Label><Text style={{ color: C.ink, fontWeight: T.fw.semi }}>{x.subject}</Text></> : null}
            {answers.map((q) => <View key={q.key}><Label>{q.label}</Label><Text style={{ color: C.ink }}>{x.data[q.key]}</Text></View>)}
            {x.details ? <><Label>Details</Label><Text style={{ color: C.ink }}>{x.details}</Text></> : null}
          </Section>
          {canUpdate && (
            <Section title="Update">
              <Field label="Status"><Choice value={statusId ?? x.status_id ?? ''} onChange={setStatusId} options={meta.statuses.map((s) => ({ value: s.id, label: s.name }))} /></Field>
              <Field label="Add a note (optional)"><Input multiline maxLength={1000} value={note} onChangeText={setNote} placeholder="e.g. Called back, visit booked for Monday" /></Field>
            </Section>)}
          <Section title="History" flush>
            {x.notes.length === 0 ? <EmptyState icon="chat" title="No updates yet" /> : x.notes.map((n, i) => (
              <Row key={n.id} last={i === x.notes.length - 1}>
                <View style={{ flex: 1 }}>
                  {n.status_name ? <Text style={{ color: C.ink }}>Status changed to <Text style={{ fontWeight: T.fw.bold }}>{n.status_name}</Text></Text> : null}
                  {n.note ? <Text style={{ color: C.ink }}>{n.note}</Text> : null}
                  <Dim>{n.by || 'Someone'} · {fmtDT(n.created_at)}</Dim>
                </View>
              </Row>))}
          </Section>
          {canDel && <Btn kind="danger" title="Delete this query" onPress={del} />}
        </View>)}
    </FormSheet>
  );
}

/* ================================================================== SETTINGS: forms + statuses */
export const QuerySettings = scoped(function QuerySettings({ sc }) {
  const { data: meta, error, reload } = useMeta(sc);
  const [editType, setEditType] = useState(null); const [editStatus, setEditStatus] = useState(null);
  if (error && !meta) return <Pad><Notice tone="bad">{error}</Notice><Btn small kind="ghost" title="Retry" onPress={reload} /></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  const run = async (fn, msg) => { try { await fn(); if (msg) toast(msg); reload(); } catch (x) { toast(x.message, true); } };
  const toggle = (t) => run(() => api.patch(`/queries/types/${t.id}`, { ...sc, is_active: !t.is_active }));
  const delType = (t) => confirmAsk(`Delete the form "${t.name}"?`, () => run(() => api.del(`/queries/types/${t.id}${qs(sc)}`), 'Deleted'));
  const delStatus = (s) => confirmAsk(`Delete the status "${s.name}"?`, () => run(() => api.del(`/queries/statuses/${s.id}${qs(sc)}`), 'Deleted'));
  const makeDefault = (s) => run(() => api.patch(`/queries/statuses/${s.id}`, { ...sc, is_default: true }));
  const Actions = ({ onEdit, onDelete }) => <View style={{ flexDirection: 'row', gap: T.sp[2], marginTop: T.sp[2], flexWrap: 'wrap' }}><Btn small kind="ghost" title="Edit" onPress={onEdit} /><Btn small kind="danger" title="Delete" onPress={onDelete} /></View>;
  return (
    <Pad reload={reload} hasData>
      <PageHeader title="Forms & statuses" sub="What people fill in, and the stages a query moves through" />
      <Section title="Forms" flush right={<Btn small title="New form" onPress={() => setEditType({})} />}>
        {meta.types.length === 0 ? <EmptyState icon="chat" title="No forms yet">Add the first form with the button above.</EmptyState> : meta.types.map((t, i) => (
          <Row key={t.id} last={i === meta.types.length - 1}>
            <View style={{ flex: 1, opacity: t.is_active ? 1 : 0.6 }}>
              <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }}>{t.name}</Text>
              <Dim>{t.audience === 'internal' ? 'Internal' : 'Parents / visitors'} · {t.fields.length} extra question{t.fields.length === 1 ? '' : 's'}{t.is_active ? '' : ' · switched off'}</Dim>
              <Check label={t.is_active ? 'Switched on' : 'Switched off'} value={t.is_active} onChange={() => toggle(t)} />
              <Actions onEdit={() => setEditType(t)} onDelete={() => delType(t)} />
            </View>
          </Row>))}
      </Section>
      <Section title="Statuses" flush right={<Btn small title="New status" onPress={() => setEditStatus({})} />}>
        {meta.statuses.map((s, i) => (
          <Row key={s.id} last={i === meta.statuses.length - 1}>
            <View style={{ flex: 1, alignItems: 'flex-start', gap: T.sp[1] }}>
              <Pill s={s} />
              <Dim>{s.is_closed ? 'Counts as finished' : 'Still open'}{s.is_default ? ' · used for new queries' : ''}</Dim>
              <View style={{ flexDirection: 'row', gap: T.sp[2], flexWrap: 'wrap', marginTop: T.sp[1] }}>
                {!s.is_default && !s.is_closed && <Btn small kind="ghost" title="Use for new queries" onPress={() => makeDefault(s)} />}
                <Btn small kind="ghost" title="Edit" onPress={() => setEditStatus(s)} />
                <Btn small kind="danger" title="Delete" onPress={() => delStatus(s)} />
              </View>
            </View>
          </Row>))}
      </Section>
      {editType && <TypeEditor sc={sc} t={editType} onClose={() => setEditType(null)} onSaved={() => { setEditType(null); reload(); toast('Saved'); }} />}
      {editStatus && <StatusEditor sc={sc} s={editStatus} onClose={() => setEditStatus(null)} onSaved={() => { setEditStatus(null); reload(); toast('Saved'); }} />}
    </Pad>
  );
});

function TypeEditor({ sc, t, onClose, onSaved }) {
  const [f, setF] = useState({ name: t.name || '', audience: t.audience || 'external' });
  const [fields, setFields] = useState((t.fields || []).map((x) => ({ ...x, options: (x.options || []).join(', ') })));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const setField = (i, patch) => setFields(fields.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true); setErr('');
    const body = { ...sc, ...f, fields: fields.map((x) => ({ ...x, options: x.type === 'select' ? x.options.split(',') : undefined })) };
    try { if (t.id) await api.patch(`/queries/types/${t.id}`, body); else await api.post('/queries/types', body); onSaved(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormSheet title={t.id ? 'Edit form' : 'New form'} onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Save form" submitDisabled={!f.name.trim()}>
      <Field req label="Form name"><Input maxLength={60} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="e.g. Transport request" /></Field>
      <Field label="Who is it for?"><Choice value={f.audience} onChange={(v) => setF({ ...f, audience: v })} options={[{ value: 'external', label: 'Parents / visitors' }, { value: 'internal', label: 'Internal (staff)' }]} /></Field>
      <Dim>Every form already asks for name, phone, subject and details. Add extra questions below.</Dim>
      {fields.map((x, i) => (
        <Section key={i} title={`Question ${i + 1}`} right={<Btn small kind="danger" title="Remove" onPress={() => setFields(fields.filter((_, j) => j !== i))} />}>
          <Field label="Question"><Input maxLength={80} value={x.label} onChangeText={(v) => setField(i, { label: v })} /></Field>
          <Field label="Answer type"><Choice value={x.type} onChange={(v) => setField(i, { type: v })} options={[['text', 'Short text'], ['textarea', 'Long text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Choose from list']].map(([value, label]) => ({ value, label }))} /></Field>
          {x.type === 'select' && <Field label="Choices (comma separated)"><Input value={x.options} onChangeText={(v) => setField(i, { options: v })} placeholder="Yes, No, Maybe" /></Field>}
          <Check label="Required" value={!!x.required} onChange={(v) => setField(i, { required: v })} />
        </Section>))}
      <View style={{ alignSelf: 'flex-start', marginTop: T.sp[2] }}><Btn small kind="ghost" title="Add question" onPress={() => setFields([...fields, { label: '', type: 'text', required: false, options: '' }])} /></View>
    </FormSheet>
  );
}

function StatusEditor({ sc, s, onClose, onSaved }) {
  const [f, setF] = useState({ name: s.name || '', color: s.color || 'info', is_closed: !!s.is_closed });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { if (s.id) await api.patch(`/queries/statuses/${s.id}`, { ...sc, ...f }); else await api.post('/queries/statuses', { ...sc, ...f }); onSaved(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormSheet title={s.id ? 'Edit status' : 'New status'} onClose={onClose} onSubmit={save} busy={busy} error={err} submitDisabled={!f.name.trim()}>
      <Field req label="Status name"><Input maxLength={40} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="e.g. Waiting for documents" /></Field>
      <Field label="Colour"><Choice value={f.color} onChange={(v) => setF({ ...f, color: v })} options={COLORS.map(([value, label]) => ({ value, label }))} /></Field>
      <Check label="This status means the query is finished" value={f.is_closed} onChange={(v) => setF({ ...f, is_closed: v })} />
    </FormSheet>
  );
}
