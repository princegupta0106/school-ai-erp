// Homework module for mobile. Mirrors client/src/modules/HomeworkModule.jsx (same endpoints and rules).
import React, { useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '../api';
import { C, T, fmt, ymd, dateTime } from '../theme';
import { Icon } from '../icons';
import { Dim, Loading, Btn, Choice, Input, Field, DateField, toast, confirmAsk } from '../ui';
import { FilterBar } from '../FilterBar';
import { useApi } from '../useApi';
import { scoped, qs, Pad, Notice, List, Row, PageHeader, Section, StatusChip, EmptyState, FormSheet } from '../kit';

const base = '/homework';
const clsName = (c) => (c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : '');
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// a tone word -> shared StatusChip (the old 'off' grey is now 'mute')
const Chip = ({ children, tone = 'mute' }) => <StatusChip tone={tone === 'off' ? 'mute' : tone === 'brand' ? 'info' : tone}>{children}</StatusChip>;

// file types the server accepts
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const PICK_TYPES = Object.values(MIME);
const mimeOf = (a) => (a.mimeType && a.mimeType !== 'application/octet-stream' ? a.mimeType : MIME[(a.name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream');

// links to files (open in the phone's browser / viewer)
const Files = ({ list }) => (!list?.length ? null : (
  <View style={{ gap: T.sp[2], marginBottom: T.sp[3] }}>
    {list.map((f) => (
      <Pressable key={f.id} onPress={() => Linking.openURL(f.url).catch(() => toast('Could not open this file', true))} style={{ flexDirection: 'row', alignItems: 'center', gap: T.sp[2], alignSelf: 'flex-start', minHeight: T.ctl, backgroundColor: C.soft, borderRadius: T.rad.sm, paddingHorizontal: T.sp[3], maxWidth: '100%' }}>
        <Icon name="download" size={15} color={C.brand} /><Text style={{ color: C.brand, fontSize: T.fs.sm, fontWeight: T.fw.semi, flexShrink: 1 }} numberOfLines={1}>{f.name}</Text><Text style={{ color: C.mute, fontSize: T.fs.xs }}>({size(f.size)})</Text>
      </Pressable>))}
  </View>
));

// choose up to 5 files, 10 MB each
function FilePick({ files, setFiles }) {
  const add = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: PICK_TYPES, multiple: true, copyToCacheDirectory: true });
      if (r.canceled) return;
      const picked = r.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size || 0, type: mimeOf(a) }));
      if (picked.some((f) => f.size > 10 * 1024 * 1024)) toast('Each file must be under 10 MB', true);
      setFiles([...files, ...picked.filter((f) => f.size <= 10 * 1024 * 1024)].slice(0, 5));
    } catch (x) { toast(x.message, true); }
  };
  return (
    <View style={{ gap: T.sp[2] }}>
      {files.map((f, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: T.sp[2], backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: T.rad.sm, paddingLeft: T.sp[3] }}>
          <Icon name="file" size={16} color={C.mute} /><Text style={{ flex: 1, color: C.ink, fontSize: T.fs.sm }} numberOfLines={1}>{f.name} <Text style={{ color: C.mute, fontSize: T.fs.xs }}>({size(f.size)})</Text></Text>
          <Pressable hitSlop={8} accessibilityLabel={`Remove ${f.name}`} onPress={() => setFiles(files.filter((_, j) => j !== i))} style={{ width: T.ctl, height: T.ctl, alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={16} color={C.bad} /></Pressable>
        </View>))}
      <View style={{ alignSelf: 'flex-start' }}><Btn small kind="ghost" title={files.length ? 'Add another file' : 'Choose files'} onPress={add} disabled={files.length >= 5} /></View>
      <Dim>Up to 5 files, 10 MB each (PDF, photo, Word, Excel, PowerPoint, text)</Dim>
    </View>
  );
}
const toForm = (fields, files) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null) fd.append(k, String(v)); });
  files.forEach((f) => fd.append('files', { uri: f.uri, name: f.name, type: f.type }));
  return fd;
};

/* ================================================================== TEACHER */
function NewAssignment({ sc, onClose, onSaved }) {
  const { data: classes } = useApi(`${base}/classes${qs(sc)}`);
  const [f, setF] = useState({ class_id: '', title: '', subject: '', description: '', due_date: '', needs_submission: true });
  const [files, setFiles] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.post(`${base}/assignments`, toForm({ ...f, ...sc }, files)); toast('Posted'); onSaved(); onClose(); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormSheet title="New homework / file" onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel="Post" submitDisabled={!f.class_id || !f.title.trim()}>
      <Field label="Type"><Choice value={f.needs_submission ? 'a' : 's'} onChange={(v) => set('needs_submission')(v === 'a')} options={[{ value: 'a', label: 'Assignment (students submit)' }, { value: 's', label: 'Study file (read only)' }]} /></Field>
      <Field req label="Class">{!classes ? <Dim>Loading classes...</Dim> : classes.length === 0 ? <Dim>No classes are assigned to you.</Dim> : <Choice value={f.class_id} onChange={set('class_id')} options={classes.map((c) => ({ value: c.id, label: clsName(c) }))} />}</Field>
      <Field req label="Title"><Input maxLength={150} value={f.title} onChangeText={set('title')} placeholder="e.g. Chapter 4 exercise" /></Field>
      <Field label="Subject (optional)"><Input maxLength={60} value={f.subject} onChangeText={set('subject')} placeholder="e.g. Maths" /></Field>
      <Field label="Instructions"><Input multiline style={{ minHeight: 100 }} maxLength={5000} value={f.description} onChangeText={set('description')} placeholder="What should students do?" /></Field>
      {f.needs_submission && <Field label="Last date to submit (optional)">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.sp[3] }}>
          <View style={{ flex: 1 }}>{f.due_date ? <DateField value={f.due_date} min={ymd(new Date())} onChange={set('due_date')} /> : <Btn small kind="ghost" title="Set last date" onPress={() => set('due_date')(ymd(new Date()))} />}</View>
          {f.due_date ? <Btn small kind="ghost" title="Clear" onPress={() => set('due_date')('')} /> : null}
        </View>
      </Field>}
      <Field label="Attach files (optional)"><FilePick files={files} setFiles={setFiles} /></Field>
    </FormSheet>
  );
}

function CheckRow({ sc, s, last, onSaved }) {
  const sub = s.submission;
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState(sub?.marks || ''); const [feedback, setFeedback] = useState(sub?.feedback || ''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.patch(`${base}/submissions/${sub.id}${qs(sc)}`, { marks, feedback }); toast('Saved'); onSaved(); setOpen(false); }
    catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderColor: C.line }}>
      <Row last onPress={sub ? () => setOpen(!open) : undefined}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }}>{s.roll_no ? `${s.roll_no}. ` : ''}{s.name}</Text>
          {sub ? <Dim>Submitted {dateTime(sub.submitted_at)}{sub.is_late ? ' (late)' : ''}{sub.marks ? ` · ${sub.marks}` : ''}</Dim> : null}
        </View>
        {!sub ? <Chip tone="bad">Not submitted</Chip> : sub.status === 'checked' ? <Chip tone="ok">Checked</Chip> : <Chip tone="warn">To check</Chip>}
      </Row>
      {open && sub && (
        <View style={{ paddingHorizontal: T.sp[3], paddingBottom: T.sp[4] }}>
          {sub.note ? <Text style={{ color: C.ink, fontSize: T.fs.md, marginBottom: T.sp[3] }}>{sub.note}</Text> : null}
          <Files list={sub.files} />
          <Field label="Marks / grade"><Input maxLength={30} value={marks} onChangeText={setMarks} placeholder="e.g. 8/10" /></Field>
          <Field label="Remark for the student"><Input multiline maxLength={2000} value={feedback} onChangeText={setFeedback} placeholder="Well done / please redo question 3..." /></Field>
          <View style={{ alignSelf: 'flex-start' }}><Btn small title={busy ? 'Saving...' : sub.status === 'checked' ? 'Update' : 'Mark as checked'} onPress={save} disabled={busy} /></View>
        </View>)}
    </View>
  );
}

function Submissions({ sc, a, onClose, onDelete }) {
  const { data: d, error, reload } = useApi(`${base}/assignments/${a.id}/submissions${qs(sc)}`);
  const list = d?.students || [];
  return (
    <FormSheet title={a.title} onClose={onClose} hideFooter>
      {!!error && <Notice tone="bad">{error}</Notice>}
      {!d ? (error ? <Btn small kind="ghost" title="Retry" onPress={reload} /> : <Loading />) : (<>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.sp[2], marginBottom: T.sp[3] }}>
          <Chip tone="info">{clsName(d.assignment.classes)}</Chip>
          {d.assignment.subject ? <Chip>{d.assignment.subject}</Chip> : null}
          {d.assignment.due_date ? <Chip>{`Due ${fmt(d.assignment.due_date)}`}</Chip> : null}
        </View>
        {d.assignment.description ? <Text style={{ color: C.ink, fontSize: T.fs.md, marginBottom: T.sp[3] }}>{d.assignment.description}</Text> : null}
        <Files list={d.assignment.attachments} />
        {d.assignment.needs_submission ? (
          <Section title="Submissions" flush>{list.length === 0 ? <EmptyState icon="users" title="No students in this class" /> : list.map((s, i) => <CheckRow key={s.student_id} sc={sc} s={s} last={i === list.length - 1} onSaved={reload} />)}</Section>
        ) : <Dim>This is a study file - students can read it, nothing to submit.</Dim>}
        <View style={{ marginTop: T.sp[4] }}><Btn kind="danger" title="Delete this homework" onPress={onDelete} /></View>
      </>)}
    </FormSheet>
  );
}

export const Homework = scoped(function Homework({ sc }) {
  const { data: list, error, loading, reload } = useApi(`${base}/assignments${qs(sc)}`);
  const [form, setForm] = useState(false); const [open, setOpen] = useState(null); const [fc, setFc] = useState(''); const [fs, setFs] = useState(''); const [chk, setChk] = useState(''); const [hq, setHq] = useState(''); const [hsort, setHsort] = useState('new');
  const del = (a) => confirmAsk(`Delete "${a.title}"? Student submissions will be deleted too.`, async () => {
    try { await api.del(`${base}/assignments/${a.id}${qs(sc)}`); toast('Deleted'); reload(); } catch (x) { toast(x.message, true); }
  });
  if (error && !list) return <Pad><Notice tone="bad">{error}</Notice><Btn small kind="ghost" title="Retry" onPress={reload} /></Pad>;
  if (!list) return <Pad><Loading /></Pad>;
  const classes = [...new Set(list.map((x) => clsName(x.classes)).filter(Boolean))]; const subjects = [...new Set(list.map((x) => x.subject).filter(Boolean))];
  const shown = list.filter((x) => (!fc || clsName(x.classes) === fc) && (!fs || x.subject === fs) && (!chk || x.to_check > 0) && (!hq.trim() || String(x.title || '').toLowerCase().includes(hq.trim().toLowerCase())))
    .sort((a, b) => hsort === 'old' ? String(a.created_at).localeCompare(String(b.created_at)) : hsort === 'title' ? String(a.title).localeCompare(String(b.title)) : String(b.created_at).localeCompare(String(a.created_at)));
  return (
    <Pad reload={reload} loading={loading} hasData>
      <PageHeader title="Homework" sub={`${list.length} posted`} right={<Btn small title="New homework / file" onPress={() => setForm(true)} />} />
      <FilterBar inline q={hq} onQ={setHq} placeholder="Search homework" count={shown.length}
        filters={[
          { key: 'c', label: 'Class', value: fc, onChange: setFc, all: 'All classes', options: classes },
          { key: 's', label: 'Subject', value: fs, onChange: setFs, all: 'All subjects', options: subjects },
          { key: 'k', label: 'Status', value: chk, onChange: setChk, all: 'All status', options: ['To check'] },
        ]}
        sort={{ value: hsort, onChange: setHsort, def: 'new', options: [{ value: 'new', label: 'Newest first' }, { value: 'old', label: 'Oldest first' }, { value: 'title', label: 'Title A-Z' }] }} />
      <List>
        {shown.length === 0 ? <EmptyState icon="doc" title={list.length ? 'No homework matches' : 'Nothing posted yet'}>{list.length ? 'Try different filters.' : 'Post the first one with the button above.'}</EmptyState> : shown.map((a, i) => (
          <Row key={a.id} last={i === shown.length - 1} onPress={() => setOpen(a)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }} numberOfLines={1}>{a.title}</Text>
              <Dim>{[clsName(a.classes), a.subject].filter(Boolean).join(' · ')}{a.classes || a.subject ? ' · ' : ''}Posted {dateTime(a.created_at)}</Dim>
            </View>
            {a.needs_submission ? (
              <View style={{ alignItems: 'flex-end', gap: T.sp[1] }}>
                <Chip tone={a.total_students && a.submitted >= a.total_students ? 'ok' : 'mute'}>{`${a.submitted}/${a.total_students} submitted`}</Chip>
                {a.to_check > 0 ? <Chip tone="warn">{`${a.to_check} to check`}</Chip> : null}
              </View>
            ) : <Chip tone="info">Study file</Chip>}
          </Row>))}
      </List>
      {form && <NewAssignment sc={sc} onClose={() => setForm(false)} onSaved={reload} />}
      {open && <Submissions sc={sc} a={open} onClose={() => { setOpen(null); reload(); }} onDelete={() => { const x = open; setOpen(null); del(x); }} />}
    </Pad>
  );
});

/* ================================================================== STUDENT */
function statusOf(a) {
  if (!a.needs_submission) return { label: 'Study file', tone: 'info' };
  if (a.my?.status === 'checked') return { label: 'Checked', tone: 'ok' };
  if (a.my) return { label: 'Submitted', tone: 'info' };
  if (a.due_date && a.due_date < ymd(new Date())) return { label: 'Overdue', tone: 'bad' };
  return { label: 'Pending', tone: 'warn' };
}

function AssignmentView({ id, onClose, onSaved }) {
  const { data: a, error, reload } = useApi(`${base}/my/${id}`);
  const [files, setFiles] = useState([]); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr('');
    try { await api.post(`${base}/my/${id}/submit`, toForm({ note }, files)); toast('Submitted'); setFiles([]); setNote(''); reload(); onSaved(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const my = a?.my; const locked = my?.status === 'checked';
  const canSubmit = !!a?.needs_submission && !locked;
  return (
    <FormSheet title={a?.title || 'Homework'} onClose={onClose} onSubmit={send} busy={busy} error={err} hideFooter={!canSubmit} cancelLabel="Close" submitLabel={my ? 'Replace submission' : 'Submit'} submitDisabled={!files.length && !note.trim()}>
      {!!error && <Notice tone="bad">{error}</Notice>}
      {!a ? (error ? <Btn small kind="ghost" title="Retry" onPress={reload} /> : <Loading />) : (<>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.sp[2], marginBottom: T.sp[3] }}>
          {a.subject ? <Chip>{a.subject}</Chip> : null}{a.due_date ? <Chip tone="info">{`Due ${fmt(a.due_date)}`}</Chip> : null}{a.teacher ? <Chip>{a.teacher}</Chip> : null}
        </View>
        {a.description ? <Text style={{ color: C.ink, fontSize: T.fs.md, marginBottom: T.sp[3] }}>{a.description}</Text> : null}
        {a.attachments.length > 0 && <><Text style={{ fontSize: T.fs.sm, fontWeight: T.fw.semi, color: C.mute, marginBottom: T.sp[2] }}>FILES FROM YOUR TEACHER</Text><Files list={a.attachments} /></>}
        {a.needs_submission && (
          <Section title="Your submission">
            {my && <>
              <Dim style={{ marginBottom: T.sp[2] }}>Submitted {dateTime(my.submitted_at)}{my.is_late ? ' (late)' : ''}</Dim>
              {my.note ? <Text style={{ color: C.ink, fontSize: T.fs.md, marginBottom: T.sp[2] }}>{my.note}</Text> : null}
              <Files list={my.files} />
            </>}
            {locked && <Notice tone="ok">{`Checked${my.marks ? ` - ${my.marks}` : ''}${my.feedback ? ` - ${my.feedback}` : ''}`}</Notice>}
            {!locked && (<>
              <Field label={my ? 'Submit again (replaces your earlier submission)' : 'Upload your work'}><FilePick files={files} setFiles={setFiles} /></Field>
              <Field label="Note for the teacher (optional)"><Input multiline maxLength={2000} value={note} onChangeText={setNote} /></Field>
            </>)}
          </Section>)}
      </>)}
    </FormSheet>
  );
}

export function MyHomework() {
  const { data: list, error, loading, reload } = useApi(`${base}/my`);
  const [open, setOpen] = useState(null);
  if (error && !list) return <Pad><Notice tone="bad">{error}</Notice><Btn small kind="ghost" title="Retry" onPress={reload} /></Pad>;
  if (!list) return <Pad><Loading /></Pad>;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <PageHeader title="My homework" sub={`${list.length} item${list.length === 1 ? '' : 's'}`} />
      <List>
        {list.length === 0 ? <EmptyState icon="doc" title="No homework yet">New homework from your teachers will show up here.</EmptyState> : list.map((a, i) => { const st = statusOf(a); return (
          <Row key={a.id} last={i === list.length - 1} onPress={() => setOpen(a.id)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: T.fs.md, fontWeight: T.fw.semi, color: C.ink }} numberOfLines={1}>{a.title}</Text>
              <Dim>{a.subject || 'Homework'}{a.due_date && a.needs_submission ? ` · Due ${fmt(a.due_date)}` : ''}{a.my?.marks ? ` · ${a.my.marks}` : ''}</Dim>
            </View>
            <Chip tone={st.tone}>{st.label}</Chip>
          </Row>); })}
      </List>
      {open && <AssignmentView id={open} onClose={() => setOpen(null)} onSaved={reload} />}
    </Pad>
  );
}
