import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// "Ask AI" chat (same widget as the wholesale ERP). It only talks to /api/ai/*: the portal decides what the person may do.
// Anything that changes data shows a Confirm card first; nothing is saved until the person presses Confirm.
const SUGGEST = [
  { text: 'How many teachers do we have?', need: 'get_all_users_school' },
  { text: 'Who is in class 5 A?', need: 'get_all_users_school' },
  { text: 'Create a new teacher', need: 'create_user' },
  { text: 'Create a student in class 5 A', need: 'create_user' },
  { text: 'Turn off an account', need: 'edit_user' },
  { text: 'Reset a password', need: 'reset_pass' },
];

// **bold** and line breaks only (React escapes everything else)
const rich = (t) => String(t ?? '').split('\n').map((line, i) => (
  <React.Fragment key={i}>{i > 0 && <br />}{line.split(/\*\*(.+?)\*\*/g).map((p, k) => (k % 2 ? <b key={k}>{p}</b> : p))}</React.Fragment>
));

function Card({ a, busy, onDecide }) {
  return (
    <div className={`ai-card ${a.status}`}>
      <h4>{a.title}</h4>
      {(a.lines || []).map((l, i) => <div className="l" key={i}>{l}</div>)}
      {a.footer && <div className="f">{a.footer}</div>}
      {a.status === 'pending' && (
        <div className="r2">
          <button className="btn primary" disabled={busy} onClick={() => onDecide('confirm', a)}>Confirm</button>
          <button className="btn" disabled={busy} onClick={() => onDecide('cancel', a)}>Cancel</button>
        </div>
      )}
      {a.status === 'running' && <div className="st muted">Saving…</div>}
      {a.status === 'done' && <div className="st">✓ {a.message || 'Done'}</div>}
      {a.status === 'failed' && <div className="st">{a.message || 'Failed'}</div>}
      {a.status === 'cancelled' && <div className="st muted">Cancelled</div>}
    </div>
  );
}

export default function AssistantChat({ me }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);       // {k:'u'|'a'|'e'|'card'|'choices', ...}
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState(null);
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem('ai_auto') === '1'; } catch { return false; } });
  const [listening, setListening] = useState(false);
  const end = useRef(null);
  const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [items, busy, open]);
  useEffect(() => { setConv(null); setItems([]); }, [me.user_id]);   // never carry a chat over to another sign-in
  useEffect(() => { const k = (e) => e.key === 'Escape' && setOpen(false); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const send = async (t) => {
    const message = (t ?? text).trim();
    if (!message || busy) return;
    setText(''); setBusy(true);
    setItems((x) => [...x.filter((i) => i.k !== 'choices'), { k: 'u', text: message }]);
    try {
      const r = await api.post('/ai/chat', { message, conversation_id: conv, auto_confirm: auto });
      setConv(r.conversation_id);
      const cards = r.actions || [];
      const missing = !cards.length && /check the card|press confirm/i.test(r.reply || '');
      setItems((x) => [...x,
        ...(r.reply && !missing ? [{ k: 'a', text: r.reply }] : []),
        ...(missing ? [{ k: 'e', text: 'The confirm card did not arrive. Please send your request again.' }] : []),
        ...(r.actions || []).map((a) => ({ k: 'card', a })),
        ...(r.choices?.length ? [{ k: 'choices', options: r.choices }] : [])]);
    } catch (e) { setItems((x) => [...x, { k: 'e', text: e.message }]); } finally { setBusy(false); }
  };

  const decide = async (what, a) => {
    setBusy(true);
    try {
      const r = await api.post(`/ai/${what}`, { action_id: a.id, conversation_id: conv });
      setItems((x) => x.map((i) => (i.k === 'card' && i.a.id === a.id ? { k: 'card', a: r.action } : i)));
    } catch (e) { setItems((x) => [...x, { k: 'e', text: e.message }]); } finally { setBusy(false); }
  };

  const pending = items.filter((i) => i.k === 'card' && i.a.status === 'pending').map((i) => i.a);
  const decideAll = async (what) => {
    for (const a of pending) await decide(what, a);
  };

  const toggleAuto = (on) => {
    if (on && !window.confirm('Auto-confirm saves users, passwords, roles and deletions immediately without asking. Turn on?')) return;
    setAuto(on);
    try { localStorage.setItem('ai_auto', on ? '1' : '0'); } catch { /* private mode */ }
  };
  const mic = () => {
    if (!SR || listening) return;
    const r = new SR(); r.lang = 'en-IN'; r.interimResults = false;
    r.onresult = (ev) => setText(ev.results[0][0].transcript);
    r.onend = () => setListening(false);
    setListening(true); r.start();
  };
  const reset = () => { setConv(null); setItems([]); };
  const chips = SUGGEST.filter((s) => me.features.includes(s.need)).slice(0, 4);
  const first = (me.profile?.full_name || '').split(' ')[0];

  return (<>
    {!open && <button className="ai-fab" onClick={() => setOpen(true)} aria-label="Open AI assistant">✨ Ask AI</button>}
    {open && (
      <div className="ai-panel" role="dialog" aria-label="AI assistant">
        <div className="ai-h">
          <b>AI assistant</b>
          <label title="Skip the confirm card (not recommended)"><input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} /> auto-confirm</label>
          <button onClick={reset} title="New chat" aria-label="New chat">↺</button>
          <button onClick={() => setOpen(false)} title="Close" aria-label="Close">✕</button>
        </div>
        <div className="ai-m">
          {!items.length && (
            <div className="ai-b a">Hi{first ? ` ${first}` : ''}! Tell me what to do in the Users module, for example:
              <div className="ai-hint">• How many teachers do we have?<br />• Create a student Rahul Sharma in class 5 A<br />• Turn off the account of Ravi Kumar<br />• Reset password of a teacher</div>
              <div className="ai-ch">{chips.map((c) => <button key={c.text} onClick={() => send(c.text)}>{c.text}</button>)}</div>
            </div>
          )}
          {items.map((i, n) => {
            if (i.k === 'u') return <div key={n} className="ai-b u">{i.text}</div>;
            if (i.k === 'a') return <div key={n} className="ai-b a">{rich(i.text)}</div>;
            if (i.k === 'e') return <div key={n} className="ai-b e">{i.text}</div>;
            if (i.k === 'card') return <Card key={n} a={i.a} busy={busy} onDecide={decide} />;
            return <div key={n} className="ai-ch">{i.options.map((o) => <button key={o} disabled={busy} onClick={() => send(o)}>{o}</button>)}</div>;
          })}
          {pending.length > 1 && (
            <div className="ai-all">
              <button className="btn primary" disabled={busy} onClick={() => decideAll('confirm')}>Confirm all ({pending.length})</button>
              <button className="btn" disabled={busy} onClick={() => decideAll('cancel')}>Cancel all</button>
            </div>
          )}
          {busy && <div className="ai-dots">Thinking…</div>}
          <div ref={end} />
        </div>
        <form className="ai-f" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type or speak a command…" autoComplete="off" maxLength={2000} />
          {SR && <button type="button" className="btn" onClick={mic} title="Speak" aria-label="Speak">{listening ? '…' : '🎤'}</button>}
          <button className="btn primary" disabled={busy || !text.trim()}>Send</button>
        </form>
      </div>
    )}
  </>);
}
