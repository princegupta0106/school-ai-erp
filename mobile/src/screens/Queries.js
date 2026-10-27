// Queries module for mobile. Mirrors client/src/modules/QueriesModule.jsx (same endpoints and rules).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { api } from '../api';
import { C } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Field, Input, Choice, Check, Sheet, toast, confirmAsk } from '../ui';
import { useApi } from '../useApi';
import { scoped, qs, Pad, Notice, List } from './Attendance';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (s) => { const d = new Date(s); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const fmtDT = (s) => { const d = new Date(s); const h = d.getHours(); return `${DAY[d.getDay()]}, ${fmtD(s)}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const refNo = (n) => `Q-${String(n).padStart(4, '0')}`;
const tone = (t) => ({ ok: [C.ok, C.okBg], off: [C.bad, C.badBg], warn: [C.warn, C.warnBg], info: [C.info, C.infoBg], mute: [C.mute, C.muteBg] }[t] || [C.mute, C.muteBg]);
const COLORS = [['warn', 'Orange'], ['info', 'Blue'], ['ok', 'Green'], ['off', 'Red'], ['mute', 'Grey']];

function Pill({ s }) {
  const [fg, bg] = tone(s?.color);
  return <Text style={{ color: fg, backgroundColor: bg, fontSize: 12, fontWeight: '700', paddingHorizontal: 9, paddingVertical: 2, borderRadius: 99, overflow: 'hidden' }}>{s ? s.name : 'No status'}</Text>;
}
const Label = ({ children }) => <Text style={{ color: C.mute, fontSize: 12, marginTop: 8 }}>{children}</Text>;
const useMeta = (sc) => useApi(`/queries/meta${qs(sc)}`);

/* ================================================================== NEW QUERY */
export const NewQuery = scoped(function NewQuery({ sc, go }) {
  const { data: meta, error } = useMeta(sc);
  const [typeId, setTypeId] = useState('');
  const [f, setF] = useState({ name: '', phone: '', subject: '', details: '' });
  const [extra, setExtra] = useState({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  useEffect(() => { if (meta && !meta.types.find((t) => t.id === typeId) && meta.types.length) setTypeId(meta.types[0].id); }, [meta]); // eslint-disable-line
  const type = useMemo(() => meta?.types.find((t) => t.id === typeId), [meta, typeId]);
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  if (!meta.types.length) return <Pad><Empty>No forms are switched on yet. Ask an admin to add one in Forms & statuses.</Empty></Pad>;
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
      <View style={{ marginBottom: 12 }}><Choice value={typeId} onChange={(v) => { setTypeId(v); setExtra({}); setErr(''); }} options={meta.types.map((t) => ({ value: t.id, label: t.name }))} /></View>
      <Card>
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
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Saving...' : `Save ${type?.name?.toLowerCase() || 'query'}`} onPress={save} disabled={busy || !f.name.trim() || missing} />
      </Card>
      {last && <View style={{ marginTop: 12 }}><Notice tone="ok">{refNo(last.ref_no)} recorded for {last.name}. It is marked as pending. <Text style={{ fontWeight: '700', textDecorationLine: 'underline' }} onPress={() => go?.('list')}>See all queries</Text></Notice></View>}
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
  if (error && !d) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!d || !meta) return <Pad><Loading /></Pad>;
  const st = (id) => meta.statuses.find((s) => s.id === id);
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Input placeholder="Search name, phone or subject" value={term} onChangeText={setTerm} />
      <View style={{ height: 10 }} />
      <Choice value={flt.status} onChange={(v) => setFlt({ ...flt, status: v })} options={[{ value: '', label: 'All' }, { value: 'open', label: 'Not finished' }, ...meta.statuses.map((s) => ({ value: s.id, label: s.name }))]} />
      <View style={{ height: 8 }} />
      <Choice value={flt.type_id} onChange={(v) => setFlt({ ...flt, type_id: v })} options={[{ value: '', label: 'All forms' }, ...meta.types.map((t) => ({ value: t.id, label: t.name }))]} />
      <View style={{ height: 12 }} />
      {!d.can_see_all && <Notice>You can see only the queries you recorded.</Notice>}
      {d.queries.length === 0 ? <Empty>No queries found.</Empty> : (
        <List>{d.queries.map((x, i) => (
          <Pressable key={x.id} onPress={() => setOpen(x.id)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: i === d.queries.length - 1 ? 0 : 1, borderColor: C.line }, pressed && { opacity: 0.6 }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: C.ink }}>{x.name}</Text>
              <Dim>{refNo(x.ref_no)} · {x.type_name}{x.subject ? ` · ${x.subject}` : ''}</Dim>
              {x.phone ? <Dim>{x.phone}</Dim> : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}><Pill s={st(x.status_id)} /><Dim>{fmtD(x.created_at)}</Dim></View>
          </Pressable>))}</List>)}
      {d.total > d.size && <Dim>Showing the latest {d.queries.length} of {d.total}. Use search or filters to narrow down.</Dim>}
      {open && <QueryDetail me={me} sc={sc} id={open} meta={meta} onClose={() => setOpen(null)} onChanged={reload} />}
    </Pad>
  );
});

function QueryDetail({ me, sc, id, meta, onClose, onChanged }) {
  const { data: x, error, reload } = useApi(`/queries/${id}${qs(sc)}`);
  const [statusId, setStatusId] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const canUpdate = me.features.includes('update_query'); const canDel = me.features.includes('delete_query');
  const type = meta.types.find((t) => t.id === x?.type_id);
  const st = (v) => meta.statuses.find((s) => s.id === v);
  const save = async () => {
    setBusy(true);
    try { await api.patch(`/queries/${id}`, { ...sc, status_id: statusId ?? x.status_id, note }); setNote(''); setStatusId(null); toast('Saved'); await reload(); onChanged(); } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const del = () => confirmAsk(`Delete ${refNo(x.ref_no)} for ${x.name}? This cannot be undone.`, async () => { try { await api.del(`/queries/${id}${qs(sc)}`); toast('Deleted'); onChanged(); onClose(); } catch (e) { toast(e.message, true); } });
  const answers = x ? (type?.fields || Object.keys(x.data || {}).map((k) => ({ key: k, label: k }))).filter((q) => x.data?.[q.key]) : [];
  return (
    <Sheet title={x ? `${refNo(x.ref_no)} · ${x.type_name}` : 'Query'} onClose={onClose}>
      {error && !x ? <ErrorBox>{error}</ErrorBox> : !x ? <Loading /> : (
        <View>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ fontSize: 17, fontWeight: '800', color: C.ink, flex: 1 }}>{x.name}</Text><Pill s={st(x.status_id)} /></View>
            <Dim>{x.phone || 'No phone'} · {fmtDT(x.created_at)}{x.created_by_name ? ` · by ${x.created_by_name}` : ''}</Dim>
            {x.subject ? <><Label>Subject</Label><Text style={{ color: C.ink, fontWeight: '600' }}>{x.subject}</Text></> : null}
            {answers.map((q) => <View key={q.key}><Label>{q.label}</Label><Text style={{ color: C.ink }}>{x.data[q.key]}</Text></View>)}
            {x.details ? <><Label>Details</Label><Text style={{ color: C.ink }}>{x.details}</Text></> : null}
          </Card>
          {canUpdate && (
            <Card>
              <Field label="Status"><Choice value={statusId ?? x.status_id ?? ''} onChange={setStatusId} options={meta.statuses.map((s) => ({ value: s.id, label: s.name }))} /></Field>
              <Field label="Add a note (optional)"><Input multiline maxLength={1000} value={note} onChangeText={setNote} placeholder="e.g. Called back, visit booked for Monday" /></Field>
              <Btn title={busy ? 'Saving...' : 'Save update'} onPress={save} disabled={busy || (!note.trim() && (statusId === null || statusId === x.status_id))} />
            </Card>)}
          <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 6 }}>History</Text>
          {x.notes.length === 0 ? <Dim>No updates yet.</Dim> : (
            <List>{x.notes.map((n, i) => (
              <View key={n.id} style={{ padding: 12, borderBottomWidth: i === x.notes.length - 1 ? 0 : 1, borderColor: C.line }}>
                {n.status_name ? <Text style={{ color: C.ink }}>Status changed to <Text style={{ fontWeight: '700' }}>{n.status_name}</Text></Text> : null}
                {n.note ? <Text style={{ color: C.ink }}>{n.note}</Text> : null}
                <Dim>{n.by || 'Someone'} · {fmtDT(n.created_at)}</Dim>
              </View>))}</List>)}
          {canDel && <Btn kind="danger" title="Delete this query" onPress={del} />}
        </View>)}
    </Sheet>
  );
}

/* ================================================================== SETTINGS: forms + statuses */
export const QuerySettings = scoped(function QuerySettings({ sc }) {
  const { data: meta, error, reload } = useMeta(sc);
  const [editType, setEditType] = useState(null); const [editStatus, setEditStatus] = useState(null);
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  const run = async (fn, msg) => { try { await fn(); if (msg) toast(msg); reload(); } catch (x) { toast(x.message, true); } };
  const toggle = (t) => run(() => api.patch(`/queries/types/${t.id}`, { ...sc, is_active: !t.is_active }));
  const delType = (t) => confirmAsk(`Delete the form "${t.name}"?`, () => run(() => api.del(`/queries/types/${t.id}${qs(sc)}`), 'Deleted'));
  const delStatus = (s) => confirmAsk(`Delete the status "${s.name}"?`, () => run(() => api.del(`/queries/statuses/${s.id}${qs(sc)}`), 'Deleted'));
  const makeDefault = (s) => run(() => api.patch(`/queries/statuses/${s.id}`, { ...sc, is_default: true }));
  const IconBtn = ({ name, onPress, color }) => <Pressable hitSlop={8} onPress={onPress} style={{ padding: 6 }}><Icon name={name} size={19} color={color || C.mute} /></Pressable>;
  return (
    <Pad reload={reload} hasData>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>Forms</Text><Btn small title="New form" onPress={() => setEditType({})} /></View>
      <List>{meta.types.map((t, i) => (
        <View key={t.id} style={{ padding: 12, borderBottomWidth: i === meta.types.length - 1 ? 0 : 1, borderColor: C.line, opacity: t.is_active ? 1 : 0.55 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.ink }}>{t.name}</Text><Dim>{t.audience === 'internal' ? 'Internal' : 'Parents / visitors'} · {t.fields.length} extra question{t.fields.length === 1 ? '' : 's'}{t.is_active ? '' : ' · switched off'}</Dim></View>
            <IconBtn name="edit" onPress={() => setEditType(t)} /><IconBtn name="trash" color={C.bad} onPress={() => delType(t)} />
          </View>
          <Check label={t.is_active ? 'Switched on' : 'Switched off'} value={t.is_active} onChange={() => toggle(t)} />
        </View>))}</List>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>Statuses</Text><Btn small title="New status" onPress={() => setEditStatus({})} /></View>
      <List>{meta.statuses.map((s, i) => (
        <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderBottomWidth: i === meta.statuses.length - 1 ? 0 : 1, borderColor: C.line }}>
          <View style={{ flex: 1, alignItems: 'flex-start', gap: 4 }}>
            <Pill s={s} />
            <Dim>{s.is_closed ? 'Counts as finished' : 'Still open'}{s.is_default ? ' · used for new queries' : ''}</Dim>
            {!s.is_default && !s.is_closed && <Text style={{ color: C.brand, fontWeight: '600', fontSize: 13 }} onPress={() => makeDefault(s)}>Use for new queries</Text>}
          </View>
          <IconBtn name="edit" onPress={() => setEditStatus(s)} /><IconBtn name="trash" color={C.bad} onPress={() => delStatus(s)} />
        </View>))}</List>
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
    try { if (t.id) await api.patch(`/queries/types/${t.id}`, body); else await api.post('/queries/types', body); onSaved(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={t.id ? 'Edit form' : 'New form'} onClose={onClose}>
      <Card>
        <Field req label="Form name"><Input maxLength={60} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="e.g. Transport request" /></Field>
        <Field label="Who is it for?"><Choice value={f.audience} onChange={(v) => setF({ ...f, audience: v })} options={[{ value: 'external', label: 'Parents / visitors' }, { value: 'internal', label: 'Internal (staff)' }]} /></Field>
        <Dim>Every form already asks for name, phone, subject and details. Add extra questions below.</Dim>
      </Card>
      {fields.map((x, i) => (
        <Card key={i}>
          <Field label="Question"><Input maxLength={80} value={x.label} onChangeText={(v) => setField(i, { label: v })} /></Field>
          <Field label="Answer type"><Choice value={x.type} onChange={(v) => setField(i, { type: v })} options={[['text', 'Short text'], ['textarea', 'Long text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Choose from list']].map(([value, label]) => ({ value, label }))} /></Field>
          {x.type === 'select' && <Field label="Choices (comma separated)"><Input value={x.options} onChangeText={(v) => setField(i, { options: v })} placeholder="Yes, No, Maybe" /></Field>}
          <Check label="Required" value={!!x.required} onChange={(v) => setField(i, { required: v })} />
          <Btn small kind="ghost" title="Remove question" onPress={() => setFields(fields.filter((_, j) => j !== i))} />
        </Card>))}
      <View style={{ marginBottom: 12, alignSelf: 'flex-start' }}><Btn small kind="ghost" title="Add question" onPress={() => setFields([...fields, { label: '', type: 'text', required: false, options: '' }])} /></View>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Save form'} onPress={save} disabled={busy || !f.name.trim()} />
    </Sheet>
  );
}

function StatusEditor({ sc, s, onClose, onSaved }) {
  const [f, setF] = useState({ name: s.name || '', color: s.color || 'info', is_closed: !!s.is_closed });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { if (s.id) await api.patch(`/queries/statuses/${s.id}`, { ...sc, ...f }); else await api.post('/queries/statuses', { ...sc, ...f }); onSaved(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={s.id ? 'Edit status' : 'New status'} onClose={onClose}>
      <Card>
        <Field req label="Status name"><Input maxLength={40} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="e.g. Waiting for documents" /></Field>
        <Field label="Colour"><Choice value={f.color} onChange={(v) => setF({ ...f, color: v })} options={COLORS.map(([value, label]) => ({ value, label }))} /></Field>
        <Check label="This status means the query is finished" value={f.is_closed} onChange={(v) => setF({ ...f, is_closed: v })} />
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Saving...' : 'Save'} onPress={save} disabled={busy || !f.name.trim()} />
      </Card>
    </Sheet>
  );
}
