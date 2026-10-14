// Documents module for mobile. Mirrors client/src/modules/DocumentsModule.jsx (same endpoints, same wording / design engine).
// Certificates and report cards are drawn from docRender.js (HTML). On the phone the preview is a WebView and
// "Print / Save as PDF" makes a PDF with expo-print and opens the share sheet.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Dimensions } from 'react-native';
import { api } from '../api';
import { C } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Sheet, Choice, Input, Field, DateField, Check, toast, confirmAsk } from '../ui';
import { useApi } from '../useApi';
import { scoped, qs, Pad, Notice, List, Row } from './Attendance';
import { DESIGNS, designOf, TYPES, TYPE_LIST, PLACEHOLDERS, defaultFields, resolveTemplate, sampleContent } from '../docRender';
import { shareDocumentPdf, previewHTML } from '../docPrint';

/* ---------------------------------------------------------------- helpers */
const Gap = ({ h = 12 }) => <View style={{ height: h }} />;
const Sec = ({ children }) => <Text style={{ fontSize: 12, fontWeight: '800', color: C.brand, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>{children}</Text>;
const Pill = ({ children, color = C.mute, bg = '#eef2ef' }) => <Text style={{ fontSize: 11, fontWeight: '700', color, backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{children}</Text>;
const CancelledPill = () => <Pill color={C.bad} bg="#fee2e2">Cancelled</Pill>;
const typeLabel = (k) => TYPES[k]?.short || k;
const fmtStamp = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const HEX = /^#[0-9a-fA-F]{6}$/;
const MORE_COLOURS = ['#1f3a6e', '#7a1f2b', '#0f5fa8', '#0f6b4f', '#374151', '#b4232c', '#7c3aed', '#b45309'];
const useMeta = (sc) => useApi(`/documents/meta${qs(sc)}`);

function useDebounced(v, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

async function sharePdf(content, opts) {
  try { await shareDocumentPdf(content, opts); } catch (x) { toast(x.message, true); }
}

// opens a section only when tapped (replaces <details>)
function Fold({ title, sub, children, open: start = false }) {
  const [open, setOpen] = useState(start);
  return (
    <Card>
      <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.ink }}>{title}</Text>{sub ? <Dim>{sub}</Dim> : null}</View>
        <Icon name={open ? 'up' : 'down'} size={18} color={C.mute} />
      </Pressable>
      {open && <View style={{ marginTop: 12 }}>{children}</View>}
    </Card>
  );
}

/* ---------------------------------------------------------------- the page, drawn at real size and scaled to the phone */
function useWebView() {
  const [W, setW] = useState(null);
  useEffect(() => { let on = true; import('react-native-webview').then((m) => on && setW(() => m.WebView)).catch(() => on && setW(false)); return () => { on = false; }; }, []);
  return W;
}

function DocPreview({ content, draft, cancelled }) {
  const WebView = useWebView();
  const land = content.orientation === 'landscape';
  const W = land ? 1123 : 794; const H = land ? 794 : 1123;
  const width = Dimensions.get('window').width - 32; const k = Math.min(1, width / W);
  const html = useMemo(() => previewHTML(content, { draft, cancelled }, k), [content, draft, cancelled, k]);
  if (WebView === false) return <Notice tone="warn">The preview needs the react-native-webview package. Run run-mobile again to install it. You can still issue and share the PDF.</Notice>;
  return (
    <View style={{ width, height: H * k, borderWidth: 1, borderColor: C.line, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', marginBottom: 12 }}>
      {WebView ? <WebView originWhitelist={['*']} source={{ html }} scrollEnabled={false} style={{ flex: 1, backgroundColor: '#fff' }} javaScriptEnabled /> : <Loading />}
    </View>
  );
}

/* ---------------------------------------------------------------- one issued document (register + my documents) */
function CancelSheet({ id, sc, onClose, onDone }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => { setBusy(true); setErr(''); try { await api.post(`/documents/issued/${id}/cancel${qs(sc)}`, { reason }); toast('Document cancelled'); onDone(); } catch (x) { setErr(x.message); setBusy(false); } };
  return (
    <Sheet title="Cancel this document" onClose={onClose}>
      <Dim style={{ marginBottom: 12 }}>The document stays in the register as cancelled and can no longer be printed by the student or staff member. Its number is never reused.</Dim>
      <Field label="Reason (kept in the history)"><Input maxLength={200} value={reason} onChangeText={setReason} /></Field>
      <ErrorBox>{err}</ErrorBox>
      <Btn kind="danger" title={busy ? 'Please wait...' : 'Cancel document'} onPress={go} disabled={busy || !reason.trim()} />
    </Sheet>
  );
}

function DocViewer({ me, sc = {}, id, onClose, onChanged }) {
  const [row, setRow] = useState(null); const [err, setErr] = useState(''); const [cancel, setCancel] = useState(false);
  useEffect(() => { api.get(`/documents/issued/${id}${qs(sc)}`).then(setRow).catch((e) => setErr(e.message)); }, [id]); // eslint-disable-line
  const canCancel = me.features.includes('cancel_document') && ['school_admin', 'super_admin'].includes(me.role);
  const cancelled = row?.status === 'cancelled';
  return (
    <Sheet title={row ? `${row.title} - ${row.subject_name}` : 'Document'} onClose={onClose}>
      <ErrorBox>{err}</ErrorBox>
      {!row && !err && <Loading />}
      {row && (<>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <Dim>No. <Text style={{ fontWeight: '800', color: C.ink }}>{row.serial_no}</Text> · issued {fmtStamp(row.issued_at)}{row.issued_by_name ? ` by ${row.issued_by_name}` : ''}</Dim>{cancelled && <CancelledPill />}
        </View>
        {cancelled && <Notice tone="warn">Cancelled{row.cancel_reason ? `: ${row.cancel_reason}` : ''}. {row.content ? '' : 'Please contact the school office for a new one.'}</Notice>}
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {row.content && <Btn title="Print / Save as PDF" onPress={() => sharePdf(row.content, { cancelled })} />}
          {canCancel && row.status === 'issued' && <Btn kind="danger" title="Cancel document" onPress={() => setCancel(true)} />}
        </View>
        {row.content ? <DocPreview content={row.content} cancelled={cancelled} /> : null}
        <Dim>Tip: choose "Save to Files" or "Print" in the share sheet to keep a copy.</Dim>
      </>)}
      {cancel && <CancelSheet id={id} sc={sc} onClose={() => setCancel(false)} onDone={() => { setCancel(false); onChanged?.(); onClose(); }} />}
    </Sheet>
  );
}

/* ================================================================== ISSUE */
const SUBJECT_FIELDS = {
  student: [['name', 'Name'], ['class_label', 'Class'], ['roll_no', 'Roll no.'], ['admission_no', 'Admission no.'], ['father', "Father's name"], ['mother', "Mother's name"], ['dob', 'Date of birth', 'date'], ['gender', 'Gender', 'gender']],
  staff: [['name', 'Name'], ['designation', 'Designation'], ['department', 'Department'], ['employee_id', 'Employee ID'], ['joining_date', 'Joining date', 'date'], ['gender', 'Gender', 'gender']],
};
const GENDERS = [{ value: '', label: '-' }, { value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }];

function PersonPicker({ sc, meta, kind, onPick }) {
  const [q, setQ] = useState(''); const [cls, setCls] = useState(''); const dq = useDebounced(q);
  const [rows, setRows] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    if (!dq.trim() && !cls) { setRows([]); return undefined; }
    let live = true; setBusy(true); setErr('');
    api.get(`/documents/people${qs({ ...sc, kind, q: dq.trim(), class_id: cls })}`).then((r) => live && setRows(r)).catch((e) => live && setErr(e.message)).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [dq, cls, kind]); // eslint-disable-line
  return (
    <View>
      <Input placeholder={kind === 'staff' ? 'Search staff by name, employee ID or login' : 'Search student by name, admission no. or login'} value={q} onChangeText={setQ} autoCapitalize="none" />
      {kind === 'student' && <View style={{ marginTop: 10 }}><Choice value={cls} onChange={setCls} options={[{ value: '', label: 'All classes' }, ...(meta.classes || []).map((c) => ({ value: c.id, label: c.label }))]} /></View>}
      <Gap h={10} /><ErrorBox>{err}</ErrorBox>
      {busy && !rows.length ? <Loading /> : !rows.length ? <Dim>{dq.trim() || cls ? 'No one found.' : `Type a name${kind === 'student' ? ' or pick a class' : ''} to find the ${kind}.`}</Dim> : (
        <List>{rows.map((p, i) => (
          <Row key={p.id} last={i === rows.length - 1} onPress={() => onPick(p)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: C.ink }}>{p.name}</Text>
              <Dim>{kind === 'student' ? `${p.class_label || 'No class'}${p.roll_no ? ` · Roll ${p.roll_no}` : ''}${p.admission_no ? ` · Adm ${p.admission_no}` : ''}` : [p.designation, p.employee_id].filter(Boolean).join(' · ') || p.login_id}</Dim>
            </View>
            {p.inactive && <Pill>Left / inactive</Pill>}<Icon name="chevron" size={18} color={C.mute} />
          </Row>))}</List>)}
    </View>
  );
}

function ReportOptions({ pre, opts, setOpts }) {
  const R = pre.report; if (!R) return null;
  const chosen = opts.exam_ids ?? R.available_exams.map((e) => e.exam_id);
  const toggle = (id) => setOpts({ ...opts, exam_ids: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] });
  return (
    <Card>
      <Sec>Marks to print</Sec>
      <Field label="Session"><Choice value={opts.session_id || R.session_id || ''} onChange={(v) => setOpts({ session_id: v, exam_ids: null, include_tests: opts.include_tests })} options={R.sessions.map((s) => ({ value: s.id, label: `${s.name}${s.is_current ? ' (current)' : ''}` }))} /></Field>
      {R.available_exams.length ? (<>
        <Dim style={{ marginBottom: 4 }}>Exams (each becomes a column)</Dim>
        {R.available_exams.map((e) => <Check key={e.exam_id} label={`${e.name}${e.pct !== null && e.pct !== undefined ? ` - ${e.pct}%` : ''}`} value={chosen.includes(e.exam_id)} onChange={() => toggle(e.exam_id)} />)}
      </>) : <Notice tone="warn">This student has no exam marks in this session. Marks are entered under Academics &gt; Tests &amp; marks.</Notice>}
      <Check label="Also show the average of class tests (Tests % column)" value={!!opts.include_tests} onChange={(v) => setOpts({ ...opts, include_tests: v })} />
    </Card>
  );
}

function PlaceholderChips({ onInsert }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {PLACEHOLDERS.map(([k, l]) => <Pressable key={k} onPress={() => onInsert(k)} style={{ borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}><Text style={{ color: C.ink, fontSize: 13 }}>{l}</Text></Pressable>)}
    </ScrollView>
  );
}

function DesignChips({ value, onPick }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {DESIGNS.map((d) => (
        <Pressable key={d.id} onPress={() => onPick(d)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: value === d.id ? 2 : 1, borderColor: value === d.id ? C.brand : C.line, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 }}>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: d.accent }} /><Text style={{ color: C.ink, fontWeight: '600' }}>{d.name}</Text>
        </Pressable>))}
    </ScrollView>
  );
}

function ColourField({ value, onChange }) {
  const ok = HEX.test(value || '');
  return (
    <Field label="Colour" hint={ok ? undefined : 'Use a colour like #1f3a6e'}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
        {MORE_COLOURS.map((c) => <Pressable key={c} onPress={() => onChange(c)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: value?.toLowerCase() === c ? 3 : 1, borderColor: value?.toLowerCase() === c ? C.ink : C.line }} />)}
      </ScrollView>
      <Input autoCapitalize="none" maxLength={7} value={value || ''} onChangeText={onChange} style={!ok && value ? { borderColor: C.bad } : undefined} />
    </Field>
  );
}

const ORIENT = [{ value: 'portrait', label: 'Portrait (A4)' }, { value: 'landscape', label: 'Landscape (A4)' }];

// inserts {{key}} at the cursor of a body TextInput
function useBodyInsert(get, set) {
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const insert = (key) => {
    const body = get(); const tok = `{{${key}}}`; const a = Math.min(sel.start ?? body.length, body.length); const b = Math.min(sel.end ?? a, body.length);
    set(body.slice(0, a) + tok + body.slice(b)); setSel({ start: a + tok.length, end: a + tok.length });
  };
  return { onSelectionChange: (e) => setSel(e.nativeEvent.selection), insert };
}

export const IssueDocument = scoped(function IssueDocument({ me, sc, go }) {
  const { data: meta, error } = useMeta(sc);
  const [type, setType] = useState(''); const [kind, setKind] = useState('student');
  const [person, setPerson] = useState(null); const [pre, setPre] = useState(null);
  const [ropts, setRopts] = useState({ session_id: '', exam_ids: null, include_tests: false });
  const [form, setForm] = useState(null); const [fields, setFields] = useState({}); const [subject, setSubject] = useState({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(null);
  const T = type ? TYPES[type] : null;
  const ins = useBodyInsert(() => form?.body || '', (b) => setForm({ ...form, body: b }));

  const pickType = (k) => { setType(k); setPerson(null); setPre(null); setForm(null); setDone(null); setErr(''); setKind(TYPES[k].kind.includes('student') ? 'student' : 'staff'); };
  const reset = () => { setPerson(null); setPre(null); setForm(null); setDone(null); setErr(''); setRopts({ session_id: '', exam_ids: null, include_tests: false }); };

  // load details of the chosen person (and, for a report card, the marks)
  const loadPre = useCallback(async (p, opts, keepForm) => {
    setErr('');
    try {
      const r = await api.get(`/documents/people/${p.id}/prefill${qs({ ...sc, type, session_id: opts.session_id, exam_ids: opts.exam_ids ? opts.exam_ids.join(',') || 'none' : '', include_tests: opts.include_tests ? '1' : '' })}`);
      setPre(r);
      if (!keepForm) {
        setForm(resolveTemplate(type, meta.templates[type], r.subject.kind)); setSubject(r.subject);
        setFields(defaultFields(type, { session: r.session_name, today: meta.today, subject: r.subject }));
      }
    } catch (x) { setErr(x.message); if (!keepForm) setPerson(null); }
  }, [type, sc, meta]); // eslint-disable-line

  const pick = (p) => { setPerson(p); setPre(null); loadPre(p, ropts, false); };
  const setR = (o) => { setRopts(o); if (person) loadPre(person, o, true); };

  const content = useMemo(() => (pre && form ? {
    type, ...form, school: meta.letterhead, subject, fields, report: pre.report, session_name: pre.session_name, issued_on: meta.today, serial_no: '',
  } : null), [pre, form, subject, fields, type, meta]);

  const issue = async (andShare) => {
    setBusy(true); setErr('');
    try {
      const row = await api.post(`/documents/issue${qs(sc)}`, {
        type, subject_id: person.id, title: form.title, body: form.body, design: form.design, accent: form.accent, orientation: form.orientation, inset: form.inset, bg_url: form.bg_url,
        subject, fields, report: type === 'report_card' ? { session_id: ropts.session_id || pre.report?.session_id, exam_ids: ropts.exam_ids ?? pre.report?.available_exams.map((e) => e.exam_id), include_tests: ropts.include_tests } : undefined,
      });
      setDone(row); toast(`Issued ${row.serial_no}`);
      if (andShare) sharePdf(row.content);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;

  // ---- done
  if (done) return (
    <Pad>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="check" size={22} color={C.ok} /><Text style={{ flex: 1, fontSize: 17, fontWeight: '800', color: C.ink }}>{done.title} issued to {done.subject_name}</Text></View>
        <Dim style={{ marginVertical: 8 }}>Number {done.serial_no}. {done.subject_role === 'student' ? 'The student and parents' : 'They'} can also see it under Documents &gt; My documents.</Dim>
        <Btn title="Print / Save as PDF" onPress={() => sharePdf(done.content)} /><Gap h={8} />
        <Btn kind="ghost" title={`Issue another ${typeLabel(type).toLowerCase()}`} onPress={() => { const t = type; reset(); setType(t); }} />
        {me.features.some((f) => ['view_issued_documents', 'issue_documents'].includes(f)) && <><Gap h={8} /><Btn kind="ghost" title="Open the register" onPress={() => go('issued')} /></>}
      </Card>
      <DocPreview content={done.content} />
    </Pad>
  );

  const subjFields = T && person && pre ? SUBJECT_FIELDS[pre.subject.kind] : [];
  return (
    <Pad>
      <Card>
        <Sec>1. What do you want to issue?</Sec>
        {TYPE_LIST.map((t, i) => (
          <Pressable key={t.key} onPress={() => pickType(t.key)} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: type === t.key ? C.brand : C.line, alignItems: 'center', justifyContent: 'center' }}>{type === t.key && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.brand }} />}</View>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: C.ink }}>{t.short}</Text><Dim>{t.desc}</Dim></View>
          </Pressable>))}
      </Card>

      {T && !person && (
        <Card>
          <Sec>2. Who is it for?</Sec>
          {T.kind.length > 1 && <View style={{ marginBottom: 10 }}><Choice value={kind} onChange={setKind} options={T.kind.map((k) => ({ value: k, label: k === 'student' ? 'Student' : 'Teacher / staff' }))} /></View>}
          <PersonPicker key={`${type}-${kind}`} sc={sc} meta={meta} kind={kind} onPick={pick} />
          <ErrorBox>{err}</ErrorBox>
        </Card>)}

      {T && person && !content && !err && <Loading />}
      {T && person && err && !content && <ErrorBox>{err}</ErrorBox>}
      {T && person && content && (<>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', color: C.ink, fontSize: 16 }}>{subject.name}</Text><Dim>{T.label}{pre.inactive ? ' - this person has left / is inactive' : ''}</Dim></View>
            <Btn small kind="ghost" title="Change" onPress={reset} />
          </View>
        </Card>
        {type === 'report_card' && <ReportOptions pre={pre} opts={ropts} setOpts={setR} />}

        {T.fields.some((f) => !f.kind || f.kind === pre.subject.kind) && (
          <Card>
            <Sec>Details for this {typeLabel(type).toLowerCase()}</Sec>
            {T.fields.filter((f) => !f.kind || f.kind === pre.subject.kind).map((f) => (
              <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                {f.type === 'date' ? <DateField value={fields[f.key] || ''} onChange={(v) => setFields({ ...fields, [f.key]: v })} />
                  : <Input multiline={!!f.area} placeholder={f.ph || ''} value={fields[f.key] || ''} onChangeText={(t) => setFields({ ...fields, [f.key]: t })} />}
              </Field>))}
          </Card>)}

        <Fold title="Details printed from the profile" sub="Check, correct for this document only">
          {subjFields.map(([k, label, t]) => (
            <Field key={k} label={label}>
              {t === 'gender' ? <Choice value={subject[k] || ''} onChange={(v) => setSubject({ ...subject, [k]: v })} options={GENDERS} />
                : t === 'date' ? <DateField value={subject[k] || ''} onChange={(v) => setSubject({ ...subject, [k]: v })} />
                  : <Input value={subject[k] === null || subject[k] === undefined ? '' : String(subject[k])} onChangeText={(x) => setSubject({ ...subject, [k]: x })} />}
            </Field>))}
          <Dim>Gender decides he / she, his / her in the wording. Changes here are not saved to the profile.</Dim>
        </Fold>

        <Fold title="Design & wording" sub={`${designOf(form.design).name}${T.layout === 'report' || T.layout === 'tc' ? '' : ', edit the text'}`}>
          <DesignChips value={form.design} onPick={(d) => setForm({ ...form, design: d.id, accent: d.accent })} /><Gap />
          <Field label="Heading"><Input value={form.title} onChangeText={(t) => setForm({ ...form, title: t })} /></Field>
          <ColourField value={form.accent} onChange={(v) => setForm({ ...form, accent: v })} />
          <Field label="Page"><Choice value={form.orientation} onChange={(v) => setForm({ ...form, orientation: v })} options={ORIENT} /></Field>
          {T.layout !== 'tc' && T.layout !== 'report' ? (<>
            <Field label={T.layout === 'award' ? 'Text under the name' : 'Wording'} hint="Placeholders such as {{name}} are filled in automatically. Edit here only for this document - to change it for every document use Templates & designs.">
              <Input multiline style={{ minHeight: 170 }} value={form.body} onChangeText={(t) => setForm({ ...form, body: t })} onSelectionChange={ins.onSelectionChange} />
            </Field>
            <Dim style={{ marginBottom: 4 }}>Tap to insert at the cursor:</Dim>
            <PlaceholderChips onInsert={ins.insert} />
          </>) : <Field label={T.layout === 'report' ? 'Note at the bottom (grading scale)' : 'Closing line'}><Input multiline value={form.body} onChangeText={(t) => setForm({ ...form, body: t })} /></Field>}
        </Fold>

        <Sec>Live preview</Sec>
        <DocPreview content={content} draft />
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Issuing...' : 'Issue & share PDF'} onPress={() => issue(true)} disabled={busy} /><Gap h={8} />
        <Btn kind="ghost" title="Issue only" onPress={() => issue(false)} disabled={busy} />
        <Dim style={{ marginTop: 10 }}>Issuing gives the document its number and saves a copy that never changes. {kind === 'student' ? 'The student and parents' : 'The person'} will see it in Documents &gt; My documents.</Dim>
      </>)}
    </Pad>
  );
});

/* ================================================================== REGISTER */
export const IssuedList = scoped(function IssuedList({ me, sc }) {
  const [type, setType] = useState(''); const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [page, setPage] = useState(0);
  const dq = useDebounced(q); const [open, setOpen] = useState(null);
  const { data: res, error: err, loading, reload } = useApi(`/documents/issued${qs({ ...sc, type, status, q: dq.trim(), page })}`);
  useEffect(() => { setPage(0); }, [type, status, dq]);
  return (
    <Pad reload={reload} loading={loading} hasData={!!res}>
      <Input placeholder="Search name or number" value={q} onChangeText={setQ} autoCapitalize="none" /><Gap h={10} />
      <View style={{ marginBottom: 10 }}><Choice value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...TYPE_LIST.map((t) => ({ value: t.key, label: t.short }))]} /></View>
      <View style={{ marginBottom: 12 }}><Choice value={status} onChange={setStatus} options={[{ value: '', label: 'Issued & cancelled' }, { value: 'issued', label: 'Issued' }, { value: 'cancelled', label: 'Cancelled' }]} /></View>
      <ErrorBox>{err}</ErrorBox>
      {!res && !err && <Loading />}
      {res && !res.rows.length && <Empty>No documents yet.</Empty>}
      {res && res.rows.length > 0 && (
        <List>{res.rows.map((r, i) => (
          <Row key={r.id} last={i === res.rows.length - 1} onPress={() => setOpen(r.id)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: C.ink }}>{r.subject_name}</Text>
              <Dim>{typeLabel(r.doc_type)}{r.class_label ? ` · ${r.class_label}` : ''} · {fmtStamp(r.issued_at)}</Dim>
              <Dim>{r.serial_no}{r.issued_by_name ? ` · by ${r.issued_by_name}` : ''}</Dim>
            </View>
            {r.status === 'cancelled' && <CancelledPill />}<Icon name="chevron" size={18} color={C.mute} />
          </Row>))}</List>)}
      {res && res.total > res.limit && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Dim>{res.page * res.limit + 1}-{Math.min(res.total, (res.page + 1) * res.limit)} of {res.total}</Dim>
          <View style={{ flexDirection: 'row', gap: 8 }}><Btn small kind="ghost" title="Previous" disabled={page === 0} onPress={() => setPage(page - 1)} /><Btn small kind="ghost" title="Next" disabled={(page + 1) * res.limit >= res.total} onPress={() => setPage(page + 1)} /></View>
        </View>)}
      {open && <DocViewer me={me} sc={sc} id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </Pad>
  );
});

/* ================================================================== MY DOCUMENTS */
export function MyDocuments({ me }) {
  const { data, error, loading, reload } = useApi('/documents/my');
  const [open, setOpen] = useState(null);
  if (error && !data) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!data) return <Pad><Loading /></Pad>;
  const other = data.some((d) => !d.mine);
  return (
    <Pad reload={reload} loading={loading} hasData>
      {!data.length && <Empty>No documents have been issued to you yet. Ask the school office if you need a certificate.</Empty>}
      {data.map((d) => (
        <Pressable key={d.id} onPress={() => setOpen(d.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 10, opacity: d.status === 'cancelled' ? 0.7 : 1 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}><Icon name="doc" size={20} color={C.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', color: C.ink }}>{d.title}</Text>
            <Dim>{other && !d.mine ? `${d.subject_name} · ` : ''}No. {d.serial_no} · {fmtStamp(d.issued_at)}</Dim>
          </View>
          {d.status === 'cancelled' && <CancelledPill />}
        </Pressable>))}
      {open && <DocViewer me={me} id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </Pad>
  );
}

/* ================================================================== image field (upload or link) */
function ImageInput({ sc, kind, label, value, onChange, hint }) {
  const [busy, setBusy] = useState(false);
  const up = async () => {
    try {
      const DP = await import('expo-document-picker');
      const r = await DP.getDocumentAsync({ type: ['image/png', 'image/jpeg', 'image/webp'], copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0]; setBusy(true);
      const fd = new FormData(); fd.append('file', { uri: a.uri, name: a.name || 'image.png', type: a.mimeType || 'image/png' }); fd.append('kind', kind);
      const res = await api.post(`/documents/images${qs(sc)}`, fd); onChange(res.url); toast('Image uploaded - remember to Save');
    } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  return (
    <Field label={label} hint={hint}>
      <Input placeholder="https://... (link to an image)" value={value || ''} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Btn small kind="ghost" title={busy ? 'Uploading...' : 'Upload image'} onPress={up} disabled={busy} />
        {!!value && <Btn small kind="ghost" title="Remove" onPress={() => onChange('')} />}
      </View>
    </Field>
  );
}

/* ================================================================== TEMPLATES & DESIGNS */
export const Templates = scoped(function Templates({ me, sc }) {
  const { data: meta, error, reload } = useMeta(sc);
  const [type, setType] = useState('bonafide'); const [t, setT] = useState(null); const [busy, setBusy] = useState(false);
  const T = TYPES[type];
  const ins = useBodyInsert(() => t?.body || '', (b) => setT({ ...t, body: b }));
  useEffect(() => {
    if (!meta) return;
    const saved = meta.templates[type]; const r = resolveTemplate(type, saved, 'student');
    setT({ ...r, body_staff: saved?.settings?.body_staff ?? (T.bodyStaff || ''), has: !!saved });
  }, [meta, type]); // eslint-disable-line
  const draft = useMemo(() => (t && meta ? sampleContent(type, meta.letterhead, { ...t, settings: { inset: t.inset, body_staff: t.body_staff } }) : null), [t, meta, type]);
  const save = async () => {
    setBusy(true);
    try { await api.put(`/documents/templates/${type}${qs(sc)}`, { title: t.title, body: t.body, body_staff: t.body_staff, design: t.design, accent: t.accent, orientation: t.orientation, bg_url: t.bg_url, settings: { inset: t.inset } }); toast('Saved - new documents will use this'); reload(); }
    catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const reset = () => confirmAsk('Go back to the built-in wording and design for this document?', async () => {
    setBusy(true);
    try { await api.del(`/documents/templates/${type}${qs(sc)}`); toast('Reset to default'); reload(); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  });
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta || !t) return <Pad><Loading /></Pad>;
  const free = T.layout !== 'tc' && T.layout !== 'report';
  const both = T.kind.includes('staff') && T.kind.includes('student');
  return (
    <Pad>
      <Card>
        <Sec>Document</Sec>
        <Choice value={type} onChange={setType} options={TYPE_LIST.map((x) => ({ value: x.key, label: `${x.short}${meta.templates[x.key] ? ' *' : ''}` }))} />
        <Dim style={{ marginTop: 8 }}>* has a saved school version. Anything not saved uses the built-in wording.</Dim>
      </Card>
      <Card>
        <Sec>Design</Sec>
        <DesignChips value={t.design} onPick={(d) => setT({ ...t, design: d.id, accent: d.accent })} />
        <Dim style={{ marginTop: 6, marginBottom: 12 }}>{designOf(t.design).desc}</Dim>
        <Field label="Heading"><Input value={t.title} onChangeText={(x) => setT({ ...t, title: x })} /></Field>
        <ColourField value={t.accent} onChange={(v) => setT({ ...t, accent: v })} />
        <Field label="Page"><Choice value={t.orientation} onChange={(v) => setT({ ...t, orientation: v })} options={ORIENT} /></Field>
      </Card>
      <Fold title="Use your own certificate design (optional)" sub={t.bg_url ? 'A background image is set' : 'Upload a background image'}>
        <Dim style={{ marginBottom: 10 }}>Download any certificate background you like (A4 size, without text) from a design site such as Canva, Freepik or Pngtree - respecting their licence - then upload it here or paste its link. The wording is printed on top of it.</Dim>
        <ImageInput sc={sc} kind="background" label="Background image" value={t.bg_url} onChange={(v) => setT({ ...t, bg_url: v })} />
        {!!t.bg_url && <Field label={`Keep text away from the edges: ${t.inset} mm`} hint="Increase this so the text stays inside the border of your design">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Btn small kind="ghost" title="-" onPress={() => setT({ ...t, inset: Math.max(5, t.inset - 2) })} /><Text style={{ fontWeight: '700', color: C.ink, minWidth: 50, textAlign: 'center' }}>{t.inset} mm</Text><Btn small kind="ghost" title="+" onPress={() => setT({ ...t, inset: Math.min(45, t.inset + 2) })} />
          </View></Field>}
      </Fold>
      <Card>
        <Sec>Wording</Sec>
        {free ? (<>
          <Field label={both ? 'For students' : T.kind[0] === 'staff' ? 'For staff' : 'Wording'}><Input multiline style={{ minHeight: 170 }} value={t.body} onChangeText={(x) => setT({ ...t, body: x })} onSelectionChange={ins.onSelectionChange} /></Field>
          {both && <Field label="For teachers / staff"><Input multiline style={{ minHeight: 130 }} value={t.body_staff} onChangeText={(x) => setT({ ...t, body_staff: x })} /></Field>}
          <Dim style={{ marginBottom: 4 }}>Tap to insert in the student wording at the cursor:</Dim>
          <PlaceholderChips onInsert={ins.insert} />
        </>) : <Field label={T.layout === 'report' ? 'Note at the bottom (grading scale)' : 'Closing line'} hint="The table of details / marks is fixed; only this line is yours to change."><Input multiline value={t.body} onChangeText={(x) => setT({ ...t, body: x })} /></Field>}
      </Card>
      <Sec>Preview (sample student)</Sec>
      {draft && <DocPreview content={draft} />}
      <Btn title={busy ? 'Saving...' : 'Save'} onPress={save} disabled={busy || !HEX.test(t.accent || '')} />
      {meta.templates[type] && <><Gap h={8} /><Btn kind="ghost" title="Reset to default" onPress={reset} disabled={busy} /></>}
    </Pad>
  );
});

/* ================================================================== LETTERHEAD */
export const Letterhead = scoped(function Letterhead({ me, sc }) {
  const { data: meta, error, reload } = useMeta(sc);
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (meta) setF({ ...meta.settings, logo_url: meta.settings.logo_url || '', signature_url: meta.settings.signature_url || '', seal_url: meta.settings.seal_url || '' }); }, [meta]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const draft = useMemo(() => (meta && f ? sampleContent('bonafide', { ...meta.letterhead, ...f, name: meta.letterhead.name, principal_title: f.principal_title || 'Principal', logo_url: f.logo_url || meta.letterhead.logo_url }, null) : null), [meta, f]);
  const save = async () => {
    setBusy(true);
    try { await api.put(`/documents/settings${qs(sc)}`, f); toast('Letterhead saved'); reload(); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta || !f) return <Pad><Loading /></Pad>;
  return (
    <Pad>
      <Card>
        <Sec>Printed at the top of every document</Sec>
        <Dim style={{ marginBottom: 12 }}>School name, address, phone and email come from the School module ({meta.letterhead.name}).</Dim>
        <Field label="Line under the name" hint='e.g. "Affiliated to CBSE, Affiliation No. 2130456"'><Input value={f.tagline || ''} onChangeText={set('tagline')} maxLength={160} /></Field>
        <Field label="Registration line" hint='e.g. "UDISE 09123456789  |  Reg. No. 45/2001"'><Input value={f.reg_line || ''} onChangeText={set('reg_line')} maxLength={160} /></Field>
        <Field label="Place (for 'Place: ...')"><Input value={f.place || ''} onChangeText={set('place')} /></Field>
        <Field label="Footer note"><Input value={f.footer_note || ''} onChangeText={set('footer_note')} maxLength={300} /></Field>
      </Card>
      <Card>
        <Sec>Signature</Sec>
        <Field label="Principal's name"><Input value={f.principal_name || ''} onChangeText={set('principal_name')} /></Field>
        <Field label="Title"><Input placeholder="Principal" value={f.principal_title || ''} onChangeText={set('principal_title')} /></Field>
        <ImageInput sc={sc} kind="signature" label="Signature image" value={f.signature_url} onChange={set('signature_url')} hint="Photo of the signature on white / transparent background (PNG works best)" />
        <ImageInput sc={sc} kind="seal" label="School seal / stamp" value={f.seal_url} onChange={set('seal_url')} />
        <ImageInput sc={sc} kind="logo" label="Logo (only if different from the School module)" value={f.logo_url} onChange={set('logo_url')} />
      </Card>
      <Sec>Preview</Sec>
      {draft && <DocPreview content={draft} />}
      <Btn title={busy ? 'Saving...' : 'Save'} onPress={save} disabled={busy} />
    </Pad>
  );
});
