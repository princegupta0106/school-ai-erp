// Admissions module for mobile. Mirrors client/src/modules/AdmissionsModule.jsx (same /api/admissions endpoints and rules).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { api } from '../api';
import { C, SH, fmt, initials } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Field, Input, Choice, Check, Sheet, DateField, toast, confirmAsk } from '../ui';
import { useApi } from '../useApi';
import { scoped, qs, Pad, Notice } from './Attendance';

const STAGE = {
  new: ['New', 'info'], contacted: ['Contacted', 'mute'], follow_up: ['Follow-up', 'warn'], pending_documents: ['Pending documents', 'warn'],
  shortlisted: ['Shortlisted', 'brand'], admitted: ['Admitted', 'ok'], rejected: ['Rejected', 'bad'],
};
const STEPS = [['new', 'Enquiry'], ['contacted', 'Contacted'], ['pending_documents', 'Application'], ['shortlisted', 'Shortlisted'], ['admitted', 'Admitted']];
const SRC = { online: 'Online form', walk_in: 'Walk-in', qr: 'QR code', referral: 'Referral', phone: 'Phone call', campaign: 'Campaign', other: 'Other' };
const KIND = { call: 'Call', whatsapp: 'WhatsApp', visit: 'Campus visit', email: 'Email', note: 'Note' };
const tone = (t) => ({ info: [C.info, C.infoBg], mute: [C.mute, C.muteBg], warn: [C.warn, C.warnBg], brand: [C.brand, C.soft], ok: [C.ok, C.okBg], bad: [C.bad, C.badBg] }[t]);
const stepIndex = (e) => (e.stage === 'rejected' ? Math.max(0, e.reached) : e.stage === 'follow_up' ? 1 : Math.max(0, STEPS.findIndex(([k]) => k === e.stage)));
const D = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00`);
const diffDays = (a, b) => Math.round((D(a) - D(b)) / 86400000);
const addDays = (iso, n) => { const d = D(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const classText = (e) => (e.class_name ? `Class ${e.class_name}` : 'Class not set');
const dt = (s) => { const d = new Date(s); const h = d.getHours(); return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const wa = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `https://wa.me/${d.length === 10 ? `91${d}` : d}` : null; };

const Pill = ({ label, t }) => { const [fg, bg] = tone(t); return <Text style={{ color: fg, backgroundColor: bg, fontSize: 11.5, fontWeight: '700', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99, overflow: 'hidden' }}>{label}</Text>; };
const StagePill = ({ stage }) => <Pill label={STAGE[stage][0]} t={STAGE[stage][1]} />;
function DuePill({ e, today }) {
  if (!e.next_followup_on || ['admitted', 'rejected'].includes(e.stage)) return null;
  const n = diffDays(e.next_followup_on, today);
  if (n < 0) return <Pill label={`Overdue ${-n}d`} t="bad" />;
  if (n === 0) return <Pill label="Due today" t="warn" />;
  return <Pill label={n === 1 ? 'Tomorrow' : fmt(e.next_followup_on)} t="mute" />;
}
const Avatar = ({ name, size = 42 }) => <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.brand, fontWeight: '800', fontSize: size * 0.36 }}>{initials(name)}</Text></View>;
const Meter = ({ v, max, color }) => <View style={{ height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden', marginTop: 5 }}><View style={{ height: 8, borderRadius: 4, width: `${Math.max(2, pct(v, max))}%`, backgroundColor: color || C.brand }} /></View>;
const Metric = ({ label, value, sub, subColor }) => (
  <View style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14, ...SH }}>
    <Text style={{ color: C.mute, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>
    <Text style={{ color: C.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginVertical: 2 }}>{value}</Text>
    <Text style={{ color: subColor || C.mute, fontSize: 12, fontWeight: '600' }}>{sub}</Text>
  </View>
);
const H = ({ children }) => <Text style={{ color: C.mute, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>{children}</Text>;
const Row2 = ({ a, b, c }) => <View style={{ marginBottom: 12 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: C.ink, fontWeight: '600', flex: 1 }}>{a}</Text><Text style={{ color: C.mute, fontSize: 13 }}>{b}</Text></View>{c}</View>;

const useMeta = (sc) => useApi(`/admissions/meta${qs(sc)}`);
const blank = (meta) => ({ student_name: '', class_id: '', parent_name: '', phone: '', email: '', locality: '', gender: '', dob: '', source: 'walk_in', assigned_to: '', next_followup_on: meta?.today || '', notes: '' });
const classOpts = (meta) => [{ value: '', label: 'Not decided' }, ...meta.classes.map((c) => ({ value: c.id, label: `Class ${c.name}${c.section ? ` ${c.section}` : ''}` }))];

function EnquiryFields({ f, setF, meta }) {
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <>
      <Field req label="Student name"><Input maxLength={120} value={f.student_name} onChangeText={set('student_name')} placeholder="Full name" /></Field>
      <Field label="Applying for class"><Choice value={f.class_id || ''} onChange={set('class_id')} options={classOpts(meta)} /></Field>
      <Field label="Parent / guardian"><Input maxLength={120} value={f.parent_name || ''} onChangeText={set('parent_name')} placeholder="Name" /></Field>
      <Field req label="Phone"><Input keyboardType="phone-pad" maxLength={20} value={f.phone || ''} onChangeText={set('phone')} placeholder="10-digit mobile number" /></Field>
      <Field label="Email"><Input keyboardType="email-address" autoCapitalize="none" value={f.email || ''} onChangeText={set('email')} placeholder="Optional" /></Field>
      <Field label="Locality / area" hint="Used in locality reports"><Input maxLength={80} value={f.locality || ''} onChangeText={set('locality')} placeholder="e.g. Baner" /></Field>
      <Field label="How did they find us?"><Choice value={f.source} onChange={set('source')} options={Object.entries(SRC).map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="Assigned to"><Choice value={f.assigned_to || ''} onChange={set('assigned_to')} options={[{ value: '', label: 'Me' }, ...meta.staff.map((s) => ({ value: s.user_id, label: s.name }))]} /></Field>
      <Field label="Next follow-up"><DateField value={f.next_followup_on || meta.today} min={meta.today || undefined} onChange={set('next_followup_on')} /></Field>
      <Field label="Notes"><Input multiline maxLength={1000} value={f.notes || ''} onChangeText={set('notes')} placeholder="What did the parent ask for?" /></Field>
    </>
  );
}

/* ================================================================== ADD ENQUIRY */
export const AddEnquiry = scoped(function AddEnquiry({ me, sc, go }) {
  const { data: meta, error } = useMeta(sc);
  const [f, setF] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  useEffect(() => { if (meta && !f) setF(blank(meta)); }, [meta]); // eslint-disable-line
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta || !f) return <Pad><Loading /></Pad>;
  const save = async () => {
    setBusy(true); setErr('');
    try { const row = await api.post('/admissions', { ...sc, ...f }); setLast(row); toast('Enquiry added'); setF(blank(meta)); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Pad>
      {last && <Notice tone="ok">{last.student_name} was added. A follow-up is set for {fmt(last.next_followup_on) || 'later'}.{me.features.includes('view_enquiries') ? ' ' : ''}{me.features.includes('view_enquiries') && <Text style={{ fontWeight: '700', textDecorationLine: 'underline' }} onPress={() => go('list')}>See all enquiries</Text>}</Notice>}
      <Card>
        <EnquiryFields f={f} setF={setF} meta={meta} />
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Saving...' : 'Add enquiry'} onPress={save} disabled={busy || !f.student_name.trim() || !String(f.phone).trim()} />
      </Card>
    </Pad>
  );
});

/* ================================================================== DETAIL (one enquiry) */
function Detail({ id, me, sc, onClose }) {
  const { data: e, error, reload } = useApi(`/admissions/${id}${qs(sc)}`);
  const { data: meta } = useMeta(sc);
  const [mode, setMode] = useState('view'); // view | reject | docs | edit | admit
  const [kind, setKind] = useState('call'); const [note, setNote] = useState(''); const [next, setNext] = useState('');
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [f, setF] = useState(null);
  const [admit, setAdmit] = useState({ class_id: '', parent: true, pw: '', ppw: '' }); const [err, setErr] = useState('');
  const can = (x) => me.features.includes(x);
  const today = meta?.today;
  useEffect(() => { if (e && today && !['admitted', 'rejected'].includes(e.stage)) setNext(e.next_followup_on && e.next_followup_on >= today ? e.next_followup_on : addDays(today, 1)); }, [e?.id, e?.next_followup_on, today]); // eslint-disable-line
  const run = async (fn, msg) => { setBusy(true); setErr(''); try { const r = await fn(); toast(msg); await reload(); return r; } catch (x) { setErr(x.message); toast(x.message, true); } finally { setBusy(false); } };
  const closed = e && ['admitted', 'rejected'].includes(e.stage);
  const move = (stage, extra = {}) => run(() => api.post(`/admissions/${id}/stage${qs(sc)}`, { stage, ...extra }), `Moved to ${STAGE[stage][0]}`).then(() => { setMode('view'); setReason(''); });
  const del = () => confirmAsk(`Delete the enquiry for ${e.student_name}? This removes its history too.`, async () => { try { await api.del(`/admissions/${id}${qs(sc)}`); toast('Enquiry deleted'); onClose(); } catch (x) { toast(x.message, true); } });

  let body;
  if (error && !e) body = <ErrorBox>{error}</ErrorBox>;
  else if (!e) body = <Loading />;
  else if (done) {
    body = (
      <View>
        <Notice tone="ok">{e.student_name} is now a student (admission no. {done.student.admission_no}). Share these sign-in details with the family. The passwords are shown only now.</Notice>
        <Card><Text selectable style={{ color: C.ink, lineHeight: 22 }}>{`Admission no: ${done.student.admission_no}\nUser ID: ${done.student.login_id}\nPassword: ${done.student.password}${done.parent ? `\n\nParent user ID: ${done.parent.login_id}\nParent password: ${done.parent.password}` : ''}`}</Text></Card>
        <Btn title="Done" onPress={onClose} />
      </View>
    );
  } else if (mode === 'edit' && f && meta) {
    body = (
      <View>
        <EnquiryFields f={f} setF={setF} meta={{ ...meta, today: '' }} />
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Saving...' : 'Save changes'} disabled={busy || !f.student_name?.trim()} onPress={() => run(() => api.patch(`/admissions/${id}${qs(sc)}`, f), 'Saved').then(() => setMode('view'))} />
        <View style={{ height: 8 }} /><Btn kind="ghost" title="Cancel" onPress={() => setMode('view')} />
      </View>
    );
  } else if (mode === 'admit' && meta) {
    body = (
      <View>
        <Dim style={{ marginBottom: 12 }}>Everything entered for this enquiry is copied into the new student profile. No duplicate typing.</Dim>
        <Field req label="Admit into class"><Choice value={admit.class_id} onChange={(v) => setAdmit({ ...admit, class_id: v })} options={meta.classes.map((c) => ({ value: c.id, label: `Class ${c.name}${c.section ? ` ${c.section}` : ''}` }))} /></Field>
        <Check label="Also create a parent login linked to this student" value={admit.parent} onChange={(v) => setAdmit({ ...admit, parent: v })} />
        <View style={{ height: 8 }} />
        <Field label="Student password" hint="Leave blank to generate one"><Input value={admit.pw} onChangeText={(v) => setAdmit({ ...admit, pw: v })} autoCapitalize="none" /></Field>
        {admit.parent && <Field label="Parent password" hint="Leave blank to generate one"><Input value={admit.ppw} onChangeText={(v) => setAdmit({ ...admit, ppw: v })} autoCapitalize="none" /></Field>}
        <ErrorBox>{err}</ErrorBox>
        <Btn title={busy ? 'Admitting...' : 'Confirm admission'} disabled={busy || !admit.class_id} onPress={async () => { const r = await run(() => api.post(`/admissions/${id}/admit${qs(sc)}`, { class_id: admit.class_id, create_parent: admit.parent, password: admit.pw, parent_password: admit.ppw }), 'Student admitted'); if (r) setDone(r); }} />
        <View style={{ height: 8 }} /><Btn kind="ghost" title="Cancel" onPress={() => setMode('view')} />
      </View>
    );
  } else if (mode === 'reject' || mode === 'docs') {
    body = (
      <View>
        <Field req={mode === 'reject'} label={mode === 'reject' ? 'Why is this enquiry being closed?' : 'Which documents are still missing?'} hint={mode === 'reject' ? 'The reason shows up in drop-off reports' : 'Optional'}><Input multiline value={reason} onChangeText={setReason} maxLength={200} placeholder={mode === 'reject' ? 'e.g. Chose another school, fees too high' : 'e.g. Birth certificate, transfer certificate'} /></Field>
        <ErrorBox>{err}</ErrorBox>
        <Btn kind={mode === 'reject' ? 'danger' : undefined} title={mode === 'reject' ? 'Reject enquiry' : 'Move to Pending documents'} disabled={busy || (mode === 'reject' && !reason.trim())} onPress={() => (mode === 'reject' ? move('rejected', { reason }) : move('pending_documents', { missing_docs: reason }))} />
        <View style={{ height: 8 }} /><Btn kind="ghost" title="Back" onPress={() => { setMode('view'); setReason(''); }} />
      </View>
    );
  } else {
    const idx = stepIndex(e); const link = wa(e.phone);
    body = (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <Avatar name={e.student_name} size={52} />
          <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontSize: 19, fontWeight: '800' }}>{e.student_name}</Text><Dim>{classText(e)} · {SRC[e.source]}</Dim></View>
        </View>
        <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>{STEPS.map(([k], i) => <View key={k} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= idx && e.stage !== 'rejected' || i < idx ? C.brand : C.line }} />)}</View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}><Dim>{e.stage === 'rejected' ? `Closed (reached ${STEPS[idx][1]})` : STEPS[idx][1]}</Dim><Dim>Step {Math.min(idx + 1, 5)} of 5</Dim></View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}><StagePill stage={e.stage} /><DuePill e={e} today={today} /></View>
        {e.stage === 'rejected' && !!e.lost_reason && <Notice tone="warn">Reason: {e.lost_reason}</Notice>}
        {e.stage === 'pending_documents' && !!e.missing_docs && <Notice tone="warn">Missing: {e.missing_docs}</Notice>}
        {e.stage === 'admitted' && <Notice tone="ok">Admitted {fmt(e.admitted_at)}. The student profile was created from this enquiry.</Notice>}

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {!!e.phone && <Btn kind="ghost" title="Call" onPress={() => Linking.openURL(`tel:${e.phone}`)} />}
          {!!link && <Btn kind="ghost" title="WhatsApp" onPress={() => Linking.openURL(link)} />}
          {can('update_enquiry') && !closed && <Btn kind="ghost" title="Edit" onPress={() => { setF({ ...blank(meta), ...Object.fromEntries(Object.entries(e).filter(([, v]) => v != null)) }); setMode('edit'); }} />}
        </View>

        {!closed && can('update_enquiry') && (
          <Card>
            <H>Log a follow-up</H>
            <Choice value={kind} onChange={setKind} options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} />
            <View style={{ height: 10 }} />
            <Input multiline value={note} onChangeText={setNote} maxLength={1000} placeholder="What was discussed?" />
            <View style={{ height: 10 }} />
            <Field label="Next follow-up">{!!next && <DateField value={next} min={today} onChange={setNext} />}</Field>
            <Choice value={null} onChange={(n) => setNext(addDays(today, n))} options={[{ value: 1, label: 'Tomorrow' }, { value: 3, label: 'In 3 days' }, { value: 7, label: 'Next week' }]} />
            <View style={{ height: 12 }} />
            <ErrorBox>{err}</ErrorBox>
            <Btn title={busy ? 'Saving...' : 'Save follow-up'} disabled={busy || (kind === 'note' && !note.trim())} onPress={() => run(() => api.post(`/admissions/${id}/activity${qs(sc)}`, { kind, note, next_followup_on: next || null }), 'Follow-up saved').then(() => setNote(''))} />
          </Card>
        )}
        {!closed && can('update_enquiry') && (
          <Card>
            <H>Move to stage</H>
            <Choice value={e.stage} onChange={(s) => { if (s === e.stage) return; if (s === 'pending_documents') { setReason(e.missing_docs || ''); setMode('docs'); } else move(s); }} options={['contacted', 'follow_up', 'pending_documents', 'shortlisted'].map((s) => ({ value: s, label: STAGE[s][0] }))} />
            <View style={{ height: 10 }} /><View style={{ alignSelf: 'flex-start' }}><Btn small kind="ghost" title="Reject / drop" onPress={() => setMode('reject')} /></View>
          </Card>
        )}
        {e.stage === 'rejected' && can('update_enquiry') && <View style={{ marginBottom: 12 }}><Btn kind="ghost" title="Reopen enquiry" onPress={() => move('contacted')} /></View>}
        {can('admit_student') && !closed && <View style={{ marginBottom: 12 }}><Btn title="Admit student" onPress={() => { setAdmit({ class_id: e.class_id || '', parent: true, pw: '', ppw: '' }); setMode('admit'); }} /></View>}

        <Card>
          <H>Details</H>
          {[['Parent / guardian', e.parent_name], ['Phone', e.phone], ['Email', e.email], ['Locality', e.locality], ['Date of birth', e.dob && fmt(e.dob)], ['Assigned to', e.assigned_name], ['Notes', e.notes]].filter(([, v]) => v).map(([k, v]) => <View key={k} style={{ marginBottom: 8 }}><Dim>{k}</Dim><Text style={{ color: C.ink, fontWeight: '500' }}>{v}</Text></View>)}
        </Card>
        <Card>
          <H>History</H>
          {e.activity.map((a, i) => (
            <View key={a.id} style={{ flexDirection: 'row', gap: 12, paddingBottom: i === e.activity.length - 1 ? 0 : 14 }}>
              <View style={{ alignItems: 'center' }}><View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: a.kind === 'stage' || a.kind === 'admitted' ? C.ok : C.brand }} />{i < e.activity.length - 1 && <View style={{ width: 2, flex: 1, backgroundColor: C.line, marginTop: 2 }} />}</View>
              <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>{a.kind === 'created' ? 'Enquiry added' : a.kind === 'stage' ? 'Stage changed' : a.kind === 'admitted' ? 'Admitted' : KIND[a.kind]}</Text>{!!a.note && <Text style={{ color: C.ink, marginTop: 2 }}>{a.note}</Text>}<Dim style={{ marginTop: 2 }}>{dt(a.created_at)}{a.by_name ? ` · ${a.by_name}` : ''}</Dim></View>
            </View>))}
        </Card>
        {can('delete_enquiry') && <View style={{ alignSelf: 'flex-start' }}><Btn small kind="ghost" title="Delete enquiry" onPress={del} /></View>}
      </View>
    );
  }
  return <Sheet title={mode === 'edit' ? 'Edit enquiry' : mode === 'admit' ? 'Admit student' : 'Enquiry'} onClose={onClose}>{body}</Sheet>;
}

/* ================================================================== OVERVIEW */
export const AdmissionsHome = scoped(function AdmissionsHome({ me, sc, go }) {
  const { data: d, error, loading, reload } = useApi(`/admissions/summary${qs(sc)}`);
  const [open, setOpen] = useState(null);
  if (error && !d) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!d) return <Pad><Loading /></Pad>;
  const g = (a, b) => (b ? `${a >= b ? '↑' : '↓'} ${Math.abs(pct(a - b, b))}% vs last month` : `${a} this month`);
  const f = d.funnel;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <Metric label="Total enquiries" value={d.total} sub={g(d.created.this, d.created.last)} subColor={C.ok} />
        <Metric label="Follow-ups due today" value={d.due_count} sub={d.overdue_count ? `${d.overdue_count} overdue` : 'Nothing overdue'} subColor={d.overdue_count ? C.warn : C.ok} />
        <Metric label="In progress" value={d.in_progress} sub={`${d.awaiting_docs} awaiting documents`} />
        <Metric label="Admitted" value={d.by_stage.admitted} sub={g(d.admitted.this, d.admitted.last)} subColor={C.ok} />
      </View>
      <Card>
        <H>Follow-ups to do</H>
        {d.due.length === 0 ? <Dim>You are all caught up. No follow-ups are due.</Dim> : d.due.map((e, i) => (
          <Pressable key={e.id} onPress={() => setOpen(e.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: C.line, opacity: pressed ? 0.6 : 1 })}>
            <Avatar name={e.student_name} />
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>{e.student_name}</Text><Dim numberOfLines={1}>{e.class_name ? `Class ${e.class_name}` : 'Class not set'}{e.assigned_name ? ` · ${e.assigned_name}` : ''}</Dim></View>
            <DuePill e={e} today={d.today} />
          </Pressable>))}
        {d.due.length > 0 && me.features.includes('view_enquiries') && <View style={{ marginTop: 8, alignSelf: 'flex-start' }}><Btn small kind="ghost" title="All enquiries" onPress={() => go('list')} /></View>}
      </Card>
      <Card>
        <H>Conversion funnel</H>
        {f.map((s, i) => <Row2 key={s.key} a={s.label} b={`${s.n}${i ? ` · ${pct(s.n, f[i - 1].n)}%` : ''}`} c={<Meter v={s.n} max={f[0].n || 1} color={s.key === 'admitted' ? C.ok : C.brand} />} />)}
      </Card>
      <Card>
        <H>Source performance</H>
        {d.sources.length === 0 ? <Dim>No data yet.</Dim> : d.sources.slice(0, 5).map((s) => <Row2 key={s.source} a={SRC[s.source]} b={`${s.total} · ${pct(s.admitted, s.total)}% admitted`} c={<Meter v={s.admitted} max={s.total} />} />)}
      </Card>
      {open && <Detail id={open} me={me} sc={sc} onClose={() => { setOpen(null); reload(); }} />}
    </Pad>
  );
});

/* ================================================================== ENQUIRIES (list + stage filter = pipeline) */
const VIEWS = [['all', 'All', {}], ['due', 'Due today', { due: 'today' }], ['late', 'Overdue', { due: 'overdue' }], ['new', 'New', { stage: 'new' }], ['pending_documents', 'Pending documents', { stage: 'pending_documents' }], ['shortlisted', 'Shortlisted', { stage: 'shortlisted' }], ['admitted', 'Admitted', { stage: 'admitted' }], ['rejected', 'Rejected', { stage: 'rejected' }]];
export const EnquiryList = scoped(function EnquiryList({ me, sc }) {
  const [view, setView] = useState('all'); const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [cls, setCls] = useState(''); const [open, setOpen] = useState(null);
  const { data: meta } = useMeta(sc);
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const { data: d, error, loading, reload } = useApi(`/admissions${qs({ ...sc, ...VIEWS.find((v) => v[0] === view)[2], q: dq, class_id: cls })}`);
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Input placeholder="Search student, parent or phone" value={q} onChangeText={setQ} />
      <View style={{ height: 10 }} />
      <Choice value={view} onChange={setView} options={VIEWS.map(([value, label]) => ({ value, label }))} />
      {!!meta && meta.classes.length > 1 && <><View style={{ height: 8 }} /><Choice value={cls} onChange={setCls} options={[{ value: '', label: 'All classes' }, ...meta.classes.map((c) => ({ value: c.id, label: `Class ${c.name}${c.section ? ` ${c.section}` : ''}` }))]} /></>}
      <View style={{ height: 12 }} />
      {error && !d ? <ErrorBox>{error}</ErrorBox> : !d ? <Loading /> : d.rows.length === 0 ? <Empty>{dq || cls || view !== 'all' ? 'No enquiries match these filters.' : 'No enquiries yet. Add the first one to start tracking admissions.'}</Empty> : (
        <>
          <Dim style={{ marginBottom: 8 }}>{d.total} enquir{d.total === 1 ? 'y' : 'ies'}</Dim>
          {d.rows.map((e) => (
            <Pressable key={e.id} onPress={() => setOpen(e.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, marginBottom: 10, opacity: pressed ? 0.7 : 1, ...SH })}>
              <Avatar name={e.student_name} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{e.student_name}</Text>
                <Dim numberOfLines={1}>{classText(e)} · {SRC[e.source]}{e.parent_name ? ` · ${e.parent_name}` : ''}</Dim>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}><StagePill stage={e.stage} /><DuePill e={e} today={d.today} /></View>
              </View>
              {!!e.phone && <Pressable hitSlop={8} onPress={() => Linking.openURL(`tel:${e.phone}`)} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Call parent"><Icon name="phone" size={20} color={C.brand} /></Pressable>}
            </Pressable>))}
        </>)}
      {open && <Detail id={open} me={me} sc={sc} onClose={() => { setOpen(null); reload(); }} />}
    </Pad>
  );
});

/* ================================================================== REPORTS */
export const AdmissionReports = scoped(function AdmissionReports({ sc }) {
  const { data: d, error, loading, reload } = useApi(`/admissions/summary${qs(sc)}`);
  if (error && !d) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!d) return <Pad><Loading /></Pad>;
  const f = d.funnel;
  return (
    <Pad reload={reload} loading={loading} hasData>
      <Card>
        <H>Enquiry to admission</H>
        {f.map((s, i) => <Row2 key={s.key} a={s.label} b={`${s.n}${i ? ` · ${pct(s.n, f[i - 1].n)}% of previous` : ''}`} c={<Meter v={s.n} max={f[0].n || 1} color={s.key === 'admitted' ? C.ok : C.brand} />} />)}
        <Dim>Overall conversion: {pct(f[3].n, f[0].n)}% of enquiries become admissions.</Dim>
      </Card>
      <Card>
        <H>Drop-off reasons</H>
        {d.drop_reasons.length === 0 ? <Dim>No rejected enquiries yet.</Dim> : d.drop_reasons.map((r) => <Row2 key={r.reason} a={r.reason} b={r.n} c={<Meter v={r.n} max={d.drop_reasons[0].n} color={C.bad} />} />)}
      </Card>
      <Card>
        <H>Source performance</H>
        {d.sources.length === 0 ? <Dim>No data yet.</Dim> : d.sources.map((s) => <Row2 key={s.source} a={SRC[s.source]} b={`${s.admitted} of ${s.total} · ${pct(s.admitted, s.total)}%`} c={<Meter v={s.admitted} max={s.total} />} />)}
      </Card>
      <Card>
        <H>Locality analysis</H>
        {d.localities.length === 0 ? <Dim>Add a locality on enquiries to see where families come from.</Dim> : d.localities.map((l) => <Row2 key={l.locality} a={l.locality} b={`${l.total} enquiries · ${l.admitted} admitted`} c={<Meter v={l.total} max={d.localities[0].total} />} />)}
      </Card>
    </Pad>
  );
});
