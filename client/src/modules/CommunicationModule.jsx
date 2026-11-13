import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Field, toast, initials, Loading, ask, Page, PageBar, Button, Section, List, ListRow, StatusBadge, EmptyState, FormDialog, FormGrid, Notice, Choice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';
import { scoped } from './AttendanceModule.jsx';

const base = '/communication';
const sq = (me, sid) => (me.role === 'super_admin' ? { school_id: sid } : {});
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, v)); const s = p.toString(); return s ? `?${s}` : ''; };
const clsName = (c) => `${c.name}${c.section ? ` ${c.section}` : ''}`;
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayKey = (iso) => new Date(iso).toDateString();
const dayLabel = (iso) => {
  const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  return d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const when = (iso) => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? time(iso) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };

/* ===================================================================== NOTICE BOARD */
function NoticeForm({ me, sid, edit, onClose, onSaved }) {
  const canSchool = me.features.includes('post_school_announcement');
  const canClass = me.features.includes('post_announcement');
  const [f, setF] = useState({ title: edit?.title || '', body: edit?.body || '', audience: canSchool ? 'school' : 'class', class_ids: [], is_pinned: !!edit?.is_pinned });
  const [classes, setClasses] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!edit && canClass) api.get(`${base}/announcement-classes${qs(sq(me, sid))}`).then(setClasses).catch(() => {}); }, []); // eslint-disable-line
  const toggle = (id) => setF((x) => ({ ...x, class_ids: x.class_ids.includes(id) ? x.class_ids.filter((c) => c !== id) : [...x.class_ids, id] }));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (edit) await api.patch(`${base}/announcements/${edit.id}${qs(sq(me, sid))}`, { title: f.title, body: f.body, is_pinned: f.is_pinned });
      else await api.post(`${base}/announcements`, { ...f, ...sq(me, sid) });
      toast(edit ? 'Notice updated' : 'Notice posted'); onSaved(); onClose();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <FormDialog title={edit ? 'Edit notice' : 'New notice'} onClose={onClose} onSubmit={save} busy={busy} error={err} submitLabel={edit ? 'Save changes' : 'Post notice'}
      submitDisabled={!f.title.trim() || !f.body.trim() || (!edit && f.audience === 'class' && f.class_ids.length === 0)}>
      <FormGrid>
        {!edit && canSchool && canClass && <Field full label="Send to"><Choice label="Audience" value={f.audience} onChange={(v) => setF({ ...f, audience: v })} options={[{ value: 'school', label: 'Whole school' }, { value: 'class', label: 'Selected classes' }]} /></Field>}
        {!edit && f.audience === 'class' && (
          <Field full label="Classes (students, parents and teachers of these classes will see it)">
            {classes.length === 0 ? <span className="ds-hint">No classes available to you.</span> : <div className="ds-choice">{classes.map((c) => <button type="button" key={c.id} className={`ds-choice-o ${f.class_ids.includes(c.id) ? 'on' : ''}`} aria-pressed={f.class_ids.includes(c.id)} onClick={() => toggle(c.id)}>{clsName(c)}</button>)}</div>}
          </Field>)}
        <Field full req label="Title"><input autoFocus required maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Parent-teacher meeting on Saturday" /></Field>
        <Field full req label="Notice"><textarea required rows={6} maxLength={5000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Write the notice..." /></Field>
        <label className="ds-check ds-full"><input type="checkbox" checked={f.is_pinned} onChange={(e) => setF({ ...f, is_pinned: e.target.checked })} />Pin to the top</label>
      </FormGrid>
    </FormDialog>
  );
}

function NoticeCard({ n, me, sid, onChanged, onEdit }) {
  const [open, setOpen] = useState(false);
  const long = n.body.length > 280 || n.body.split('\n').length > 5;
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); onChanged(); } catch (x) { toast(x.message, true); } };
  return (
    <Section className={n.is_pinned ? 'pinned' : ''} title={n.title} sub={`${n.author} - ${new Date(n.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${time(n.created_at)}`}
      actions={<span className="ds-inline">
        {n.is_pinned && <StatusBadge tone="info" dot={false}>Pinned</StatusBadge>}
        {n.audience === 'school' ? <StatusBadge tone="mute" dot={false}>Whole school</StatusBadge> : n.classes.map((c) => <StatusBadge key={c.id} tone="mute" dot={false}>Class {clsName(c)}</StatusBadge>)}
        {n.can_edit && <>
          <Button kind="ghost" size="sm" icon="pin" aria-label={n.is_pinned ? 'Unpin' : 'Pin'} onClick={() => run(() => api.patch(`${base}/announcements/${n.id}${qs(sq(me, sid))}`, { is_pinned: !n.is_pinned }), n.is_pinned ? 'Unpinned' : 'Pinned')} />
          <Button kind="ghost" size="sm" icon="edit" aria-label="Edit" onClick={() => onEdit(n)} />
          <Button kind="ghost" size="sm" icon="trash" aria-label="Delete" onClick={async () => (await ask('Delete this notice?')) && run(() => api.del(`${base}/announcements/${n.id}${qs(sq(me, sid))}`), 'Notice deleted')} />
        </>}
      </span>}>
      <p className={`ds-pre ${long && !open ? 'nbody clamp' : 'nbody'}`}>{n.body}</p>
      {long && <Button kind="ghost" size="sm" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Read more'}</Button>}
    </Section>
  );
}

export const NoticeBoard = scoped(function NoticeBoard({ me, sid }) {
  const [form, setForm] = useState(null); const [busy, setBusy] = useState(false);
  const canPost = me.features.includes('post_announcement') || me.features.includes('post_school_announcement');
  const { data: d, error: err, refresh: load, set: setD } = useApi(`${base}/announcements${qs(sq(me, sid))}`);
  const older = async () => {
    setBusy(true);
    try { const last = d.items.at(-1); const x = await api.get(`${base}/announcements${qs({ ...sq(me, sid), before: last.created_at })}`); setD({ ...d, items: [...d.items, ...x.items], more: x.more }); }
    catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  if (err) return <Page><Notice tone="bad" action={<Button size="sm" onClick={load}>Retry</Button>}>{err}</Notice></Page>;
  if (!d) return <Loading />;
  const all = [...d.pinned, ...d.items];
  return (
    <Page>
      <PageBar title="Notice board" sub="Announcements for the school, classes and staff">
        {canPost && <Button kind="primary" icon="plus" onClick={() => setForm({})}>New notice</Button>}
      </PageBar>
      {all.length === 0 ? <Section><EmptyState icon="megaphone" title="No notices yet">{canPost ? 'Post the first one with the button above.' : 'Check back later.'}</EmptyState></Section> : all.map((n) => <NoticeCard key={n.id} n={n} me={me} sid={sid} onChanged={load} onEdit={setForm} />)}
      {d.more && <div className="ds-more"><Button loading={busy} onClick={older}>Load older notices</Button></div>}
      {form && <NoticeForm me={me} sid={sid} edit={form.id ? form : null} onClose={() => setForm(null)} onSaved={load} />}
    </Page>
  );
});

/* ===================================================================== MESSAGES */
function NewChat({ onPick, onClose }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [list, setList] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { let live = true; api.get(`${base}/contacts${qs({ q: dq })}`).then((d) => live && (setList(d), setErr(''))).catch((e) => live && setErr(e.message)); return () => { live = false; }; }, [dq]);
  return (
    <FormDialog title="New message" onClose={onClose} hideFooter>
      <FilterBar q={q} onQ={setQ} placeholder="Search teacher, parent or student name" />
      {err && <Notice tone="bad">{err}</Notice>}
      {list && (list.length === 0 ? <EmptyState icon="users" title="No one found">You can message the people connected to your classes.</EmptyState> :
        <Section flush><List>{list.map((c) => (
          <ListRow key={c.user_id} onClick={() => onPick(c)} lead={<span className="avatar sm">{initials(c.name)}</span>} title={c.name} sub={c.label} />))}</List></Section>)}
    </FormDialog>
  );
}

function Thread({ conv, onBack, onActivity }) {
  const [msgs, setMsgs] = useState(null); const [more, setMore] = useState(false);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const box = useRef(null); const ref = useRef([]); const stick = useRef(true);
  ref.current = msgs || [];

  const merge = (a, b) => { const seen = new Set(a.map((m) => m.id)); return [...a, ...b.filter((m) => !seen.has(m.id))]; };
  const toEnd = () => requestAnimationFrame(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; });

  useEffect(() => {
    let live = true; setMsgs(null); stick.current = true;
    api.get(`${base}/conversations/${conv.id}/messages`).then((d) => { if (!live) return; setMsgs(d.messages); setMore(d.more); toEnd(); onActivity(); }).catch((e) => toast(e.message, true));
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const last = ref.current.at(-1);
        const d = await api.get(`${base}/conversations/${conv.id}/messages${last ? qs({ after: last.created_at }) : ''}`);
        if (!live) return;
        if (last ? d.messages.length : true) { setMsgs((m) => (last ? merge(m || [], d.messages) : d.messages)); if (stick.current) toEnd(); onActivity(); }
      } catch { /* try again on the next tick */ }
    }, 5000);
    return () => { live = false; clearInterval(t); };
  }, [conv.id]); // eslint-disable-line

  const earlier = async () => {
    const first = ref.current[0]; const h = box.current.scrollHeight;
    try { const d = await api.get(`${base}/conversations/${conv.id}/messages${qs({ before: first.created_at })}`); setMsgs((m) => [...d.messages, ...m]); setMore(d.more); requestAnimationFrame(() => { box.current.scrollTop = box.current.scrollHeight - h; }); }
    catch (e) { toast(e.message, true); }
  };
  const send = async () => {
    const body = text.trim(); if (!body || busy) return;
    setBusy(true);
    try { const m = await api.post(`${base}/conversations/${conv.id}/messages`, { body }); setText(''); stick.current = true; setMsgs((x) => merge(x || [], [m])); toEnd(); onActivity(); }
    catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(pointer:coarse)').matches) { e.preventDefault(); send(); } };

  return (
    <div className="thread">
      <div className="thead"><button className="icon-btn back" onClick={onBack} aria-label="Back to chats"><Icon name="back" /></button><span className="avatar sm">{initials(conv.other.name)}</span><div className="ds-grow"><b>{conv.other.name}</b><small>{conv.other.label}</small></div></div>
      <div className="msgs" ref={box} onScroll={(e) => { const t = e.currentTarget; stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 80; }}>
        {!msgs ? <Loading rows={3} /> : (<>
          {more && <div className="ds-more"><Button size="sm" onClick={earlier}>Load earlier messages</Button></div>}
          {msgs.length === 0 && <EmptyState icon="chat" title="No messages yet">Say hello!</EmptyState>}
          {msgs.map((m, i) => (<React.Fragment key={m.id}>
            {(i === 0 || dayKey(msgs[i - 1].created_at) !== dayKey(m.created_at)) && <div className="dsep"><span>{dayLabel(m.created_at)}</span></div>}
            <div className={`bub ${m.mine ? 'mine' : ''}`}><p>{m.body}</p><small>{time(m.created_at)}</small></div>
          </React.Fragment>))}
        </>)}
      </div>
      <div className="composer">
        <textarea rows={1} value={text} maxLength={2000} placeholder="Type a message" onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="Message" />
        <Button kind="primary" className="send" icon="send" onClick={send} disabled={busy || !text.trim()} aria-label="Send" />
      </div>
    </div>
  );
}

export function Messages({ me }) {
  const [active, setActive] = useState(null); const [picking, setPicking] = useState(false);
  const { data: list, error: err, refresh: reload } = useApi(`${base}/conversations`, !!me.school_id);
  // the first load comes from the cache; this keeps the list fresh while the screen stays open
  useEffect(() => { if (!me.school_id) return undefined; const t = setInterval(() => !document.hidden && reload(), 15000); return () => clearInterval(t); }, [reload, me.school_id]);
  if (!me.school_id) return <Page><PageBar title="Messages" /><Section><EmptyState icon="chat" title="Messages are for school accounts">Sign in as a school user to chat.</EmptyState></Section></Page>;
  if (err) return <Page><Notice tone="bad" action={<Button size="sm" onClick={reload}>Retry</Button>}>{err}</Notice></Page>;
  if (!list) return <Loading />;

  const open = (c) => setActive({ id: c.id, other: c.other });
  const start = async (c) => {
    try { const r = await api.post(`${base}/conversations`, { user_id: c.user_id }); setPicking(false); setActive({ id: r.id, other: r.other }); reload(); }
    catch (x) { toast(x.message, true); }
  };
  return (
    <div className={`chatwrap ${active ? 'has-active' : ''}`}>
      <div className="chatlist">
        <PageBar title="Messages" sub="Chat with parents, staff and students"><Button kind="primary" icon="plus" onClick={() => setPicking(true)}>New message</Button></PageBar>
        {list.length === 0 ? <Section><EmptyState icon="chat" title="No chats yet">Start one with New message.</EmptyState></Section> : (
          <Section flush><List>{list.map((c) => (
            <ListRow key={c.id} onClick={() => open(c)} lead={<span className="avatar sm">{initials(c.other.name)}</span>} title={c.other.name} sub={`${c.last_mine ? 'You: ' : ''}${c.last_preview}`}
              meta={<><span className="ds-note">{when(c.last_message_at)}</span>{c.unread > 0 && <span className="unread">{c.unread}</span>}</>} />))}</List></Section>)}
      </div>
      <div className="chatmain">
        {active ? <Thread key={active.id} conv={active} onBack={() => { setActive(null); reload(); }} onActivity={reload} /> : <EmptyState icon="chat" title="Select a chat">Or start a new message.</EmptyState>}
      </div>
      {picking && <NewChat onPick={start} onClose={() => setPicking(false)} />}
    </div>
  );
}

/* ===================================================================== SEND NOTIFICATION */
// A quick push alert + inbox entry (shown in the phone app's bell). Not a notice-board post.
const WHO = [['all', 'Everyone'], ['students', 'Students'], ['parents', 'Parents'], ['staff', 'Staff']];
export const SendNotification = scoped(function SendNotification({ me, sid }) {
  const canSchool = me.features.includes('send_school_notification'); const canClass = me.features.includes('send_notification');
  const blank = { title: '', body: '', audience: canSchool ? 'school' : 'class', who: 'all', class_ids: [] };
  const [f, setF] = useState(blank); const [classes, setClasses] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (canClass) api.get(`/notifications/classes${qs(sq(me, sid))}`).then(setClasses).catch(() => {}); }, [sid]); // eslint-disable-line
  const toggle = (id) => setF((x) => ({ ...x, class_ids: x.class_ids.includes(id) ? x.class_ids.filter((c) => c !== id) : [...x.class_ids, id] }));
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post('/notifications/send', { ...f, ...sq(me, sid) }); toast(r.sent ? `Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}` : 'Nobody to send to'); setF(blank); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Page narrow>
      <PageBar title="Send notification" sub="Sends an alert to people's phones and into the notification bell of the phone app. For longer announcements use the Notice board." />
      <Section>
        <form onSubmit={send}>
          <FormGrid>
            {canSchool && canClass && <Field full label="Send to"><Choice label="Audience" value={f.audience} onChange={(v) => setF({ ...f, audience: v })} options={[{ value: 'school', label: 'Whole school' }, { value: 'class', label: 'Selected classes' }]} /></Field>}
            {f.audience === 'school' && <Field full label="Who"><Choice label="Who" value={f.who} onChange={(v) => setF({ ...f, who: v })} options={WHO.map(([value, label]) => ({ value, label }))} /></Field>}
            {f.audience === 'class' && (
              <Field full label="Classes (students, parents and teachers of these classes)">
                {classes.length === 0 ? <span className="ds-hint">No classes available to you.</span> : <div className="ds-choice">{classes.map((c) => <button type="button" key={c.id} className={`ds-choice-o ${f.class_ids.includes(c.id) ? 'on' : ''}`} aria-pressed={f.class_ids.includes(c.id)} onClick={() => toggle(c.id)}>{clsName(c)}</button>)}</div>}
              </Field>)}
            <Field full req label="Title"><input required maxLength={100} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. School closed tomorrow" /></Field>
            <Field full label="Message (optional)"><textarea rows={4} maxLength={500} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="A short message..." /></Field>
            {err && <div className="ds-full"><Notice tone="bad">{err}</Notice></div>}
            <div className="ds-full ds-inline"><Button type="submit" kind="primary" icon="send" loading={busy} disabled={!f.title.trim() || (f.audience === 'class' && f.class_ids.length === 0)}>Send notification</Button></div>
          </FormGrid>
        </form>
      </Section>
    </Page>
  );
});
