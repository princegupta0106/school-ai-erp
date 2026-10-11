import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon, Modal, Field, Empty, toast, initials } from '../ui.jsx';
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
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (edit) await api.patch(`${base}/announcements/${edit.id}${qs(sq(me, sid))}`, { title: f.title, body: f.body, is_pinned: f.is_pinned });
      else await api.post(`${base}/announcements`, { ...f, ...sq(me, sid) });
      toast(edit ? 'Notice updated' : 'Notice posted'); onSaved(); onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={edit ? 'Edit notice' : 'New notice'} onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={save}>
        {!edit && canSchool && canClass && <div className="pills"><button type="button" className={`pill ${f.audience === 'school' ? 'on' : ''}`} onClick={() => setF({ ...f, audience: 'school' })}>Whole school</button><button type="button" className={`pill ${f.audience === 'class' ? 'on' : ''}`} onClick={() => setF({ ...f, audience: 'class' })}>Selected classes</button></div>}
        {!edit && f.audience === 'class' && (
          <Field label="Classes (students, parents and teachers of these classes will see it)">
            {classes.length === 0 ? <span className="muted">No classes available to you.</span> : <div className="pills">{classes.map((c) => <button type="button" key={c.id} className={`pill ${f.class_ids.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>{clsName(c)}</button>)}</div>}
          </Field>)}
        <Field label="Title"><input required maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Parent-teacher meeting on Saturday" /></Field>
        <Field label="Notice"><textarea required rows={6} maxLength={5000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Write the notice..." /></Field>
        <label className="check"><input type="checkbox" checked={f.is_pinned} onChange={(e) => setF({ ...f, is_pinned: e.target.checked })} />Pin to the top</label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary big" disabled={busy || !f.title.trim() || !f.body.trim() || (!edit && f.audience === 'class' && f.class_ids.length === 0)} style={{ justifyContent: 'center' }}>{busy ? 'Saving...' : edit ? 'Save changes' : 'Post notice'}</button>
      </form>
    </Modal>
  );
}

function Notice({ n, me, sid, onChanged, onEdit }) {
  const [open, setOpen] = useState(false);
  const long = n.body.length > 280 || n.body.split('\n').length > 5;
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); onChanged(); } catch (x) { toast(x.message, true); } };
  return (
    <article className={`notice-card ${n.is_pinned ? 'pinned' : ''}`}>
      <div className="row sp" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div className="chips">
          {n.is_pinned && <span className="chip head"><Icon name="pin" size={12} />Pinned</span>}
          {n.audience === 'school' ? <span className="chip">Whole school</span> : n.classes.map((c) => <span key={c.id} className="chip">Class {clsName(c)}</span>)}
        </div>
        {n.can_edit && <div className="row" style={{ gap: 0, flexWrap: 'nowrap' }}>
          <button className="icon-btn" aria-label={n.is_pinned ? 'Unpin' : 'Pin'} onClick={() => run(() => api.patch(`${base}/announcements/${n.id}${qs(sq(me, sid))}`, { is_pinned: !n.is_pinned }), n.is_pinned ? 'Unpinned' : 'Pinned')}><Icon name="pin" size={18} /></button>
          <button className="icon-btn" aria-label="Edit" onClick={() => onEdit(n)}><Icon name="edit" size={18} /></button>
          <button className="icon-btn" aria-label="Delete" onClick={() => confirm('Delete this notice?') && run(() => api.del(`${base}/announcements/${n.id}${qs(sq(me, sid))}`), 'Notice deleted')}><Icon name="trash" size={18} /></button>
        </div>}
      </div>
      <h3>{n.title}</h3>
      <p className={`nbody ${long && !open ? 'clamp' : ''}`}>{n.body}</p>
      {long && <button className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Read more'}</button>}
      <small className="muted">{n.author} - {new Date(n.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, {time(n.created_at)}</small>
    </article>
  );
}

export const NoticeBoard = scoped(function NoticeBoard({ me, sid }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [form, setForm] = useState(null); const [busy, setBusy] = useState(false);
  const canPost = me.features.includes('post_announcement') || me.features.includes('post_school_announcement');
  const load = useCallback(() => api.get(`${base}/announcements${qs(sq(me, sid))}`).then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message)), [me, sid]);
  useEffect(() => { load(); }, [load]);
  const older = async () => {
    setBusy(true);
    try { const last = d.items.at(-1); const x = await api.get(`${base}/announcements${qs({ ...sq(me, sid), before: last.created_at })}`); setD({ ...d, items: [...d.items, ...x.items], more: x.more }); }
    catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  if (err) return <div className="err">{err}</div>;
  if (!d) return <Empty>Loading...</Empty>;
  const all = [...d.pinned, ...d.items];
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      {canPost && <button className="btn primary big" style={{ alignSelf: 'flex-start' }} onClick={() => setForm({})}><Icon name="plus" size={18} />New notice</button>}
      {all.length === 0 ? <Empty>No notices yet.</Empty> : all.map((n) => <Notice key={n.id} n={n} me={me} sid={sid} onChanged={load} onEdit={setForm} />)}
      {d.more && <button className="btn" style={{ alignSelf: 'center' }} onClick={older} disabled={busy}>{busy ? 'Loading...' : 'Load older notices'}</button>}
      {form && <NoticeForm me={me} sid={sid} edit={form.id ? form : null} onClose={() => setForm(null)} onSaved={load} />}
    </div>
  );
});

/* ===================================================================== MESSAGES */
function NewChat({ onPick, onClose }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [list, setList] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { let live = true; api.get(`${base}/contacts${qs({ q: dq })}`).then((d) => live && (setList(d), setErr(''))).catch((e) => live && setErr(e.message)); return () => { live = false; }; }, [dq]);
  return (
    <Modal title="New message" onClose={onClose}>
      <div style={{ position: 'relative' }}><input autoFocus placeholder="Search teacher, parent or student name" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} /><span style={{ position: 'absolute', left: 11, top: 10, color: 'var(--mute)' }}><Icon name="search" size={18} /></span></div>
      {err && <div className="err">{err}</div>}
      {list && (list.length === 0 ? <Empty>No one found. You can message the people connected to your classes.</Empty> :
        <div className="card" style={{ padding: 0 }}>{list.map((c) => (
          <button key={c.user_id} className="drow" onClick={() => onPick(c)}><span className="avatar sm">{initials(c.name)}</span><div style={{ flex: 1, minWidth: 0 }}><b>{c.name}</b><small>{c.label}</small></div></button>))}</div>)}
    </Modal>
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
      <div className="thead"><button className="icon-btn back" onClick={onBack} aria-label="Back to chats"><Icon name="back" /></button><span className="avatar sm">{initials(conv.other.name)}</span><div style={{ minWidth: 0 }}><b>{conv.other.name}</b><small>{conv.other.label}</small></div></div>
      <div className="msgs" ref={box} onScroll={(e) => { const t = e.currentTarget; stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 80; }}>
        {!msgs ? <div className="empty">Loading...</div> : (<>
          {more && <button className="btn" style={{ alignSelf: 'center' }} onClick={earlier}>Load earlier messages</button>}
          {msgs.length === 0 && <div className="empty">No messages yet. Say hello!</div>}
          {msgs.map((m, i) => (<React.Fragment key={m.id}>
            {(i === 0 || dayKey(msgs[i - 1].created_at) !== dayKey(m.created_at)) && <div className="dsep"><span>{dayLabel(m.created_at)}</span></div>}
            <div className={`bub ${m.mine ? 'mine' : ''}`}><p>{m.body}</p><small>{time(m.created_at)}</small></div>
          </React.Fragment>))}
        </>)}
      </div>
      <div className="composer">
        <textarea rows={1} value={text} maxLength={2000} placeholder="Type a message" onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="Message" />
        <button className="btn primary send" onClick={send} disabled={busy || !text.trim()} aria-label="Send"><Icon name="send" size={20} /></button>
      </div>
    </div>
  );
}

export function Messages({ me }) {
  const [list, setList] = useState(null); const [err, setErr] = useState('');
  const [active, setActive] = useState(null); const [picking, setPicking] = useState(false);
  const reload = useCallback(() => api.get(`${base}/conversations`).then((d) => { setList(d); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { if (!me.school_id) return undefined; reload(); const t = setInterval(() => !document.hidden && reload(), 15000); return () => clearInterval(t); }, [reload, me.school_id]);
  if (!me.school_id) return <Empty>Messages are for school accounts. Sign in as a school user to chat.</Empty>;
  if (err) return <div className="err">{err}</div>;
  if (!list) return <Empty>Loading...</Empty>;

  const open = (c) => setActive({ id: c.id, other: c.other });
  const start = async (c) => {
    try { const r = await api.post(`${base}/conversations`, { user_id: c.user_id }); setPicking(false); setActive({ id: r.id, other: r.other }); reload(); }
    catch (x) { toast(x.message, true); }
  };
  return (
    <div className={`chatwrap ${active ? 'has-active' : ''}`}>
      <div className="chatlist">
        <button className="btn primary big" style={{ justifyContent: 'center' }} onClick={() => setPicking(true)}><Icon name="plus" size={18} />New message</button>
        {list.length === 0 ? <Empty>No chats yet. Start one with "New message".</Empty> : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>{list.map((c) => (
            <button key={c.id} className={`drow crow ${active?.id === c.id ? 'on' : ''}`} onClick={() => open(c)}>
              <span className="avatar sm">{initials(c.other.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}><b>{c.other.name}</b><small className="ellip">{c.last_mine ? 'You: ' : ''}{c.last_preview}</small></div>
              <div className="cmeta"><small>{when(c.last_message_at)}</small>{c.unread > 0 && <span className="unread">{c.unread}</span>}</div>
            </button>))}</div>)}
      </div>
      <div className="chatmain">
        {active ? <Thread key={active.id} conv={active} onBack={() => { setActive(null); reload(); }} onActivity={reload} /> : <div className="empty nochat">Select a chat or start a new message.</div>}
      </div>
      {picking && <NewChat onPick={start} onClose={() => setPicking(false)} />}
    </div>
  );
}
