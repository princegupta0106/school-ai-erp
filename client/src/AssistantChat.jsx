import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { clearCache } from './cache.js';
import { Icon } from './ui.jsx';

const SUGGEST = [
  { text: 'Create a new school', need: 'create_school' },
  { text: 'List all schools', need: 'create_school' },
  { text: 'Create a new user', need: 'create_user' },
  { text: 'How many teachers do we have?', need: 'get_all_users_school' },
  { text: 'Which classes have attendance marked today?', need: 'mark_attendance' },
  { text: 'Show fee pending for a student', need: 'view_student_fees' },
  { text: 'Apply leave for today', need: 'my_leave' },
  { text: 'What is my leave balance?', need: 'my_leave' },
  { text: 'How much salary will I get this month?', need: 'my_leave' },
  { text: 'Show pending leave requests', need: 'leave_approve' },
];

// Floating chat. It only talks to /api/ai/*: the server decides what the person is allowed to do.
export default function AssistantChat({ me }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState(null);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, open]);

  const absorb = (r) => {
    setConv(r.conversation_id);
    setMsgs((m) => [...m, { role: 'bot', text: r.reply, actions: r.actions || [], pending: (r.pending || []).map((p) => ({ ...p, state: 'open' })) }]);
    if ((r.actions || []).some((a) => a.ok)) clearCache(); // pages show fresh data after the assistant changed something
  };
  const fail = (e) => setMsgs((m) => [...m, { role: 'bot', text: e.message, error: true }]);

  const send = async (t) => {
    const message = (t ?? text).trim();
    if (!message || busy) return;
    setText(''); setBusy(true);
    setMsgs((m) => [...m, { role: 'me', text: message }]);
    try { absorb(await api.post('/ai/chat', { message, conversation_id: conv })); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const decide = async (mi, pid, approve) => {
    setMsgs((m) => m.map((x, i) => (i !== mi ? x : { ...x, pending: x.pending.map((p) => (p.id === pid ? { ...p, state: approve ? 'confirmed' : 'cancelled' } : p)) })));
    setBusy(true);
    try { absorb(await api.post('/ai/confirm', { pending_id: pid, approve })); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const reset = () => { if (conv) api.post('/ai/reset', { conversation_id: conv }).catch(() => {}); setConv(null); setMsgs([]); };
  const chips = SUGGEST.filter((s) => me.features.includes(s.need)).slice(0, 5);

  return (<>
    {!open && <button className="ai-fab" onClick={() => setOpen(true)} aria-label="Open AI assistant"><Icon name="sparkle" size={24} /></button>}
    {open && (
      <div className="ai-panel" role="dialog" aria-label="AI assistant">
        <div className="ai-head">
          <b><Icon name="sparkle" size={18} /> Assistant</b>
          <div className="row">
            <button className="btn" onClick={reset} disabled={!msgs.length}>New chat</button>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><Icon name="x" /></button>
          </div>
        </div>
        <div className="ai-body">
          {!msgs.length && (
            <div className="ai-hello">
              <p>Hi {me.profile.full_name?.split(' ')[0] || ''}! Tell me what to do on the portal, e.g. <i>"create a new teacher"</i> or <i>"apply leave for today"</i>, or just ask me questions. The portal only lets me do what your account is allowed to do.</p>
              <div className="ai-chips">{chips.map((c) => <button key={c.text} className="pill" onClick={() => send(c.text)}>{c.text}</button>)}</div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`ai-msg ${m.role} ${m.error ? 'err' : ''}`}>
              {m.actions?.length > 0 && <div className="ai-acts">{m.actions.map((a, k) => <span key={k} className={`ai-act ${a.ok ? 'ok' : 'bad'}`} title={a.error || ''}>{a.ok ? '✓' : '✕'} {a.tool}</span>)}</div>}
              <div className="ai-text">{m.text}</div>
              {m.pending?.map((p) => (
                <div key={p.id} className="ai-confirm">
                  <small>Please confirm</small>
                  <div>{p.details}</div>
                  {p.state === 'open'
                    ? <div className="row"><button className="btn primary" disabled={busy} onClick={() => decide(i, p.id, true)}>Confirm</button><button className="btn" disabled={busy} onClick={() => decide(i, p.id, false)}>Cancel</button></div>
                    : <em>{p.state === 'confirmed' ? 'Confirmed' : 'Cancelled'}</em>}
                </div>
              ))}
            </div>
          ))}
          {busy && <div className="ai-msg bot"><div className="ai-text ai-dots">Working…</div></div>}
          <div ref={end} />
        </div>
        <form className="ai-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a request…" maxLength={2000} autoFocus />
          <button className="btn primary" disabled={busy || !text.trim()} aria-label="Send"><Icon name="send" size={18} /></button>
        </form>
      </div>
    )}
  </>);
}
