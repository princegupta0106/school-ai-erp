// Homework module for mobile. Mirrors client/src/modules/HomeworkModule.jsx (same endpoints and rules).
import React, { useState } from 'react';
import { View, Text, Pressable, Linking, Modal as RNModal, ScrollView } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '../api';
import { C, fmt, ymd, dateTime, live } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Sheet, Choice, Input, Field, DateField, toast, confirmAsk, Notifier } from '../ui';
import { useApi } from '../useApi';
import { scoped, qs, Pad, List } from './Attendance';

const base = '/homework';
const clsName = (c) => (c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : '');
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const Gap = ({ h = 12 }) => <View style={{ height: h }} />;
const TONE = live(() => ({ ok: [C.ok, C.okBg], warn: [C.warn, C.warnBg], info: [C.info, C.infoBg], off: [C.mute, C.muteBg], bad: [C.bad, C.badBg], brand: [C.brand, C.soft] }));
const Chip = ({ children, tone = 'off' }) => <Text style={{ fontSize: 11, fontWeight: '700', color: TONE[tone][0], backgroundColor: TONE[tone][1], paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' }}>{children}</Text>;
const Chips = ({ children }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 }}>{children}</View>;

// file types the server accepts
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const PICK_TYPES = Object.values(MIME);
const mimeOf = (a) => (a.mimeType && a.mimeType !== 'application/octet-stream' ? a.mimeType : MIME[(a.name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream');

// links to files (open in the phone's browser / viewer)
const Files = ({ list }) => (!list?.length ? null : (
  <View style={{ gap: 6, marginBottom: 10 }}>
    {list.map((f) => (
      <Pressable key={f.id} onPress={() => Linking.openURL(f.url).catch(() => toast('Could not open this file', true))} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: C.soft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, maxWidth: '100%' }}>
        <Icon name="download" size={15} color={C.brand} /><Text style={{ color: C.brand, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{f.name}</Text><Text style={{ color: C.mute, fontSize: 12 }}>({size(f.size)})</Text>
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
    <View style={{ gap: 8 }}>
      {files.map((f, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Icon name="file" size={16} color={C.mute} /><Text style={{ flex: 1, color: C.ink }} numberOfLines={1}>{f.name} <Text style={{ color: C.mute, fontSize: 12 }}>({size(f.size)})</Text></Text>
          <Pressable hitSlop={8} onPress={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" size={16} color={C.bad} /></Pressable>
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
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="New homework / file" onClose={onClose}>
      <Choice value={f.needs_submission ? 'a' : 's'} onChange={(v) => set('needs_submission')(v === 'a')} options={[{ value: 'a', label: 'Assignment (students submit)' }, { value: 's', label: 'Study file (read only)' }]} /><Gap />
      <Field req label="Class">{!classes ? <Dim>Loading classes...</Dim> : classes.length === 0 ? <Dim>No classes are assigned to you.</Dim> : <Choice value={f.class_id} onChange={set('class_id')} options={classes.map((c) => ({ value: c.id, label: clsName(c) }))} />}</Field>
      <Field req label="Title"><Input maxLength={150} value={f.title} onChangeText={set('title')} placeholder="e.g. Chapter 4 exercise" /></Field>
      <Field label="Subject (optional)"><Input maxLength={60} value={f.subject} onChangeText={set('subject')} placeholder="e.g. Maths" /></Field>
      <Field label="Instructions"><Input multiline style={{ minHeight: 100 }} maxLength={5000} value={f.description} onChangeText={set('description')} placeholder="What should students do?" /></Field>
      {f.needs_submission && <Field label="Last date to submit (optional)">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>{f.due_date ? <DateField value={f.due_date} min={ymd(new Date())} onChange={set('due_date')} /> : <Btn small kind="ghost" title="Set last date" onPress={() => set('due_date')(ymd(new Date()))} />}</View>
          {f.due_date ? <Btn small kind="ghost" title="Clear" onPress={() => set('due_date')('')} /> : null}
        </View>
      </Field>}
      <Field label="Attach files (optional)"><FilePick files={files} setFiles={setFiles} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Uploading...' : 'Post'} onPress={save} disabled={busy || !f.class_id || !f.title.trim()} />
    </Sheet>
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
      <Pressable disabled={!sub} onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '600', color: C.ink }}>{s.roll_no ? `${s.roll_no}. ` : ''}{s.name}</Text>
          {sub ? <Dim>Submitted {dateTime(sub.submitted_at)}{sub.is_late ? ' (late)' : ''}{sub.marks ? ` · ${sub.marks}` : ''}</Dim> : null}
        </View>
        {!sub ? <Chip>Not submitted</Chip> : sub.status === 'checked' ? <Chip tone="ok">Checked</Chip> : <Chip tone="warn">To check</Chip>}
      </Pressable>
      {open && sub && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 14 }}>
          {sub.note ? <Text style={{ color: C.ink, marginBottom: 10 }}>{sub.note}</Text> : null}
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
    <Sheet title={a.title} onClose={onClose}>
      <ErrorBox>{error}</ErrorBox>
      {!d ? (error ? null : <Loading />) : (<>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          <Chip tone="brand">{clsName(d.assignment.classes)}</Chip>
          {d.assignment.subject ? <Chip>{d.assignment.subject}</Chip> : null}
          {d.assignment.due_date ? <Chip>Due {fmt(d.assignment.due_date)}</Chip> : null}
        </View>
        {d.assignment.description ? <Text style={{ color: C.ink, marginBottom: 12 }}>{d.assignment.description}</Text> : null}
        <Files list={d.assignment.attachments} />
        {d.assignment.needs_submission ? (
          list.length === 0 ? <Empty>No students in this class.</Empty> : <List>{list.map((s, i) => <CheckRow key={s.student_id} sc={sc} s={s} last={i === list.length - 1} onSaved={reload} />)}</List>
        ) : <Dim>This is a study file - students can read it, nothing to submit.</Dim>}
        <Gap h={18} /><Btn kind="ghost" title="Delete this homework" onPress={onDelete} />
      </>)}
    </Sheet>
  );
}


// small bottom list used by the filters
function PickList({ title, all, options, value, onPick, onClose }) {
  return (
    <RNModal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingBottom: 26, maxHeight: '65%' }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 10 }} />
          <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink, paddingHorizontal: 18, marginBottom: 6 }}>{title}</Text>
          <ScrollView>
            {[['', all], ...options.map((o) => [o, o])].map(([v, l]) => (
              <Pressable key={v || 'all'} onPress={() => { onPick(v); onClose(); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, backgroundColor: pressed ? C.muteBg : 'transparent' })}>
                <Text style={{ flex: 1, color: C.ink, fontSize: 15.5, fontWeight: value === v ? '800' : '500' }}>{l}</Text>
                {value === v ? <Text style={{ color: C.brand, fontWeight: '800', fontSize: 16 }}>✓</Text> : null}
              </Pressable>))}
          </ScrollView>
        </Pressable>
        <Notifier />
      </Pressable>
    </RNModal>
  );
}
const FilterChip = ({ label, on, onPress }) => (
  <Pressable onPress={onPress} style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.soft : C.card, alignItems: 'center' }}>
    <Text style={{ color: on ? C.brand : C.ink, fontWeight: on ? '800' : '600', fontSize: 13.5 }} numberOfLines={1}>{label}</Text>
  </Pressable>
);

export const Homework = scoped(function Homework({ sc }) {
  const { data: list, error, loading, reload } = useApi(`${base}/assignments${qs(sc)}`);
  const [form, setForm] = useState(false); const [open, setOpen] = useState(null); const [fc, setFc] = useState(''); const [fs, setFs] = useState(''); const [chk, setChk] = useState(''); const [pick, setPick] = useState(null);
  const del = (a) => confirmAsk(`Delete "${a.title}"? Student submissions will be deleted too.`, async () => {
    try { await api.del(`${base}/assignments/${a.id}${qs(sc)}`); toast('Deleted'); reload(); } catch (x) { toast(x.message, true); }
  });
  if (error && !list) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!list) return <Pad><Loading /></Pad>;
  const classes = [...new Set(list.map((x) => clsName(x.classes)).filter(Boolean))]; const subjects = [...new Set(list.map((x) => x.subject).filter(Boolean))];
  const shown = list.filter((x) => (!fc || clsName(x.classes) === fc) && (!fs || x.subject === fs) && (!chk || x.to_check > 0));
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Btn title="+ New homework / file" onPress={() => setForm(true)} /><Gap />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <FilterChip label={fc || 'All classes'} on={!!fc} onPress={() => setPick('class')} />
        <FilterChip label={fs || 'All subjects'} on={!!fs} onPress={() => setPick('subject')} />
        <FilterChip label={chk || 'All status'} on={!!chk} onPress={() => setPick('status')} />
      </View><Gap />
      {shown.length === 0 ? <Empty>{list.length ? 'No homework matches these filters.' : 'Nothing posted yet.'}</Empty> : (
        <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: 'hidden' }}>
          {shown.map((a, i) => {
            const pct = a.total_students ? Math.round((a.submitted / a.total_students) * 100) : 0;
            return (
              <Pressable key={a.id} onPress={() => setOpen(a)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderColor: C.line, backgroundColor: pressed ? C.muteBg : 'transparent' })}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15.5, fontWeight: '700', color: C.ink }} numberOfLines={1}>{a.title}</Text>
                  <Text style={{ color: C.mute, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>Posted {dateTime(a.created_at)}</Text>
                </View>
                {a.needs_submission ? (
                  <View style={{ alignItems: 'flex-end', width: 84, gap: 5 }}>
                    <Text style={{ fontWeight: '800', color: C.ink }}>{a.submitted}<Text style={{ color: C.mute, fontWeight: '600' }}>/{a.total_students}</Text></Text>
                    <View style={{ height: 5, alignSelf: 'stretch', borderRadius: 3, backgroundColor: C.line, overflow: 'hidden' }}><View style={{ width: `${pct}%`, height: '100%', backgroundColor: C.brand }} /></View>
                    {a.to_check > 0 ? <Text style={{ fontSize: 11.5, fontWeight: '700', color: C.warn }}>{a.to_check} to check</Text> : null}
                  </View>
                ) : <Chip tone="info">Study file</Chip>}
                <Text style={{ color: C.hint, fontSize: 20, marginTop: -2 }}>›</Text>
              </Pressable>);
          })}
        </View>)}
      {pick === 'class' && <PickList title="Class" all="All classes" options={classes} value={fc} onPick={setFc} onClose={() => setPick(null)} />}
      {pick === 'subject' && <PickList title="Subject" all="All subjects" options={subjects} value={fs} onPick={setFs} onClose={() => setPick(null)} />}
      {pick === 'status' && <PickList title="Status" all="All status" options={['To check']} value={chk} onPick={setChk} onClose={() => setPick(null)} />}
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
  return (
    <Sheet title={a?.title || 'Homework'} onClose={onClose}>
      <ErrorBox>{error}</ErrorBox>
      {!a ? (error ? null : <Loading />) : (<>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {a.subject ? <Chip>{a.subject}</Chip> : null}{a.due_date ? <Chip>Due {fmt(a.due_date)}</Chip> : null}{a.teacher ? <Chip>{a.teacher}</Chip> : null}
        </View>
        {a.description ? <Text style={{ color: C.ink, marginBottom: 12 }}>{a.description}</Text> : null}
        {a.attachments.length > 0 && <><Text style={{ fontWeight: '700', color: C.ink, marginBottom: 6 }}>Files from your teacher</Text><Files list={a.attachments} /></>}
        {a.needs_submission && (
          <Card>
            <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 8 }}>Your submission</Text>
            {my && <>
              <Dim style={{ marginBottom: 8 }}>Submitted {dateTime(my.submitted_at)}{my.is_late ? ' (late)' : ''}</Dim>
              {my.note ? <Text style={{ color: C.ink, marginBottom: 8 }}>{my.note}</Text> : null}
              <Files list={my.files} />
            </>}
            {locked && (
              <View style={{ backgroundColor: C.okBg, borderRadius: 10, padding: 10 }}>
                <Text style={{ fontWeight: '700', color: C.ok }}>Checked{my.marks ? ` - ${my.marks}` : ''}</Text>
                {my.feedback ? <Text style={{ color: C.ok, marginTop: 4 }}>{my.feedback}</Text> : null}
              </View>)}
            {!locked && (<>
              <Field label={my ? 'Submit again (replaces your earlier submission)' : 'Upload your work'}><FilePick files={files} setFiles={setFiles} /></Field>
              <Field label="Note for the teacher (optional)"><Input multiline maxLength={2000} value={note} onChangeText={setNote} /></Field>
              <ErrorBox>{err}</ErrorBox>
              <Btn title={busy ? 'Uploading...' : my ? 'Replace submission' : 'Submit'} onPress={send} disabled={busy || (!files.length && !note.trim())} />
            </>)}
          </Card>)}
      </>)}
    </Sheet>
  );
}

export function MyHomework() {
  const { data: list, error, loading, reload } = useApi(`${base}/my`);
  const [open, setOpen] = useState(null);
  if (error && !list) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!list) return <Pad><Loading /></Pad>;
  return (
    <Pad reload={reload} loading={loading} hasData>
      {list.length === 0 ? <Empty>No homework yet.</Empty> : (
        <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: 'hidden' }}>
          {list.map((a, i) => { const st = statusOf(a); return (
            <Pressable key={a.id} onPress={() => setOpen(a.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: i ? 1 : 0, borderColor: C.line, backgroundColor: pressed ? C.muteBg : 'transparent' })}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15.5, fontWeight: '700', color: C.ink }} numberOfLines={1}>{a.title}</Text>
                <Text style={{ color: C.mute, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>{a.subject || 'Homework'}{a.due_date && a.needs_submission ? ` · Due ${fmt(a.due_date)}` : ''}{a.my?.marks ? ` · ${a.my.marks}` : ''}</Text>
              </View>
              <Chip tone={st.tone}>{st.label}</Chip>
              <Text style={{ color: C.hint, fontSize: 20, marginTop: -2 }}>›</Text>
            </Pressable>); })}
        </View>)}
      {open && <AssignmentView id={open} onClose={() => setOpen(null)} onSaved={reload} />}
    </Pad>
  );
}
