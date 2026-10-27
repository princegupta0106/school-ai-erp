import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { downloadPdf } from './docRender.js';

// "Ask AI" chat (same widget as the wholesale ERP). It only talks to /api/ai/*: the portal decides what the person may do.
// Anything that changes data shows a Confirm card first; nothing is saved until the person presses Confirm.
const SUGGEST = [
  { text: 'How many teachers do we have?', need: 'get_all_users_school' },
  { text: 'Who is in class 5 A?', need: 'get_all_users_school' },
  { text: 'Create a new teacher', need: 'create_user' },
  { text: 'Create a student in class 5 A', need: 'create_user' },
  { text: 'Turn off an account', need: 'edit_user' },
  { text: 'Reset a password', need: 'reset_pass' },
  { text: 'Give homework to a class', need: 'manage_homework' },
  { text: 'Who has not submitted my homework?', need: 'manage_homework' },
  { text: 'Enter marks of a test', need: 'manage_assessments' },
  { text: 'Who are the toppers of class 5 A?', need: 'view_academic_reports' },
  { text: 'How did my child do in the exams?', need: 'view_my_academics' },
  { text: 'Download the pending fees list', need: 'view_student_fees' },
  { text: 'Give me a fee receipt', need: 'view_student_fees' },
  { text: 'Download my child’s fee receipt', need: 'view_my_fees' },
  { text: 'Show my documents', need: 'view_my_documents' },
  { text: 'Post a notice for class 5 A', need: 'post_announcement' },
  { text: 'Any new messages?', need: 'use_messages' },
  { text: 'Send a notification to all parents', need: 'send_school_notification' },
  { text: 'What notices are on the board?', need: 'view_announcements' },
];
// files a teacher may attach to homework from the chat (same limits as the Homework page)
const MAX_FILES = 5, MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
const sizeOf = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// **bold** and line breaks only (React escapes everything else)
const rich = (t) => String(t ?? '').split('\n').map((line, i) => (
  <React.Fragment key={i}>{i > 0 && <br />}{line.split(/\*\*(.+?)\*\*/g).map((p, k) => (k % 2 ? <b key={k}>{p}</b> : p))}</React.Fragment>
));

// A file the assistant found or made for the person: receipts, fee statements, fee reports (PDF / CSV) and issued certificates.
// The portal path is fetched with the person's own sign-in, so the server still decides who may open it.
function FileCard({ d }) {
  const [st, setSt] = useState({ busy: false, err: '', done: false });
  const go = async () => {
    setSt({ busy: true, err: '', done: false });
    try {
      if (d.kind === 'document') {                       // certificates are drawn in the browser, then saved as a real PDF file
        const row = await api.get(d.path);
        if (!row.content) throw new Error('This document was cancelled and can no longer be downloaded.');
        await downloadPdf(row.content, { cancelled: row.status === 'cancelled' }, d.filename);
      } else await api.download(d.path, d.filename);
      setSt({ busy: false, err: '', done: true });
    } catch (e) { setSt({ busy: false, err: e.message, done: false }); }
  };
  return (
    <div className="ai-dl">
      <div className="ico" aria-hidden="true">{d.format === 'CSV' ? 'CSV' : 'PDF'}</div>
      <div className="t"><b>{d.label}</b>{d.sub && <small>{d.sub}</small>}{st.err && <small className="bad">{st.err}</small>}{st.done && !st.err && <small className="ok">✓ Downloaded</small>}</div>
      <button className="btn primary" disabled={st.busy} onClick={go}>{st.busy ? 'Preparing…' : '⬇ Download'}</button>
    </div>
  );
}

// reveals text a few characters at a time, so a reply that arrives in one piece still appears progressively
function Typed({ text }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= text.length) return undefined;
    const t = setTimeout(() => setN((v) => Math.min(text.length, v + Math.max(2, Math.ceil(text.length / 90)))), 18);
    return () => clearTimeout(t);
  }, [n, text]);
  return <>{rich(text.slice(0, n))}</>;
}

// shown from the moment the message is sent until the first words arrive: the real backend step, a live timer and rotating hints
const HINTS = ['Reading your request…', 'Checking what you are allowed to do…', 'Looking through the school data…', 'Working out the answer…', 'Almost there, still working…'];
function Waiting({ step }) {
  const [sec, setSec] = useState(0);
  useEffect(() => { const t = setInterval(() => setSec((v) => v + 1), 1000); return () => clearInterval(t); }, []);
  const tool = step && step.startsWith('Running');
  const msg = tool ? step : HINTS[Math.min(HINTS.length - 1, Math.floor(sec / 3))];
  return <div className="ai-step"><span className="ai-spin" aria-hidden="true" /> {msg} <small>{sec}s</small></div>;
}

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
      {a.status === 'done' && (a.downloads || []).map((d) => <FileCard key={d.id || d.path} d={d} />)}
      {a.status === 'failed' && <div className="st">{a.message || 'Failed'}</div>}
      {a.status === 'cancelled' && <div className="st muted">Cancelled</div>}
    </div>
  );
}

export default function AssistantChat({ me, ask }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);       // {k:'u'|'a'|'e'|'card'|'choices', ...}
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState(null);
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem('ai_auto') === '1'; } catch { return false; } });
  const [listening, setListening] = useState(false);
  const [files, setFiles] = useState([]);          // chosen, not sent yet (uploaded when the message is sent)
  const [picked, setPicked] = useState('');
  const pick = useRef(null);
  const askSeen = useRef(0);
  const canAttach = (me.features || []).includes('manage_homework');
  const end = useRef(null);
  const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [items, busy, open]);
  useEffect(() => { setConv(null); setItems([]); setFiles([]); }, [me.user_id]);   // never carry a chat over to another sign-in
  useEffect(() => { const k = (e) => e.key === 'Escape' && setOpen(false); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const addFiles = (e) => {
    const chosen = Array.from(e.target.files || []);
    e.target.value = '';
    const big = chosen.filter((f) => f.size > MAX_BYTES);
    const ok = chosen.filter((f) => f.size <= MAX_BYTES && !files.some((x) => x.name === f.name && x.size === f.size));
    const next = [...files, ...ok].slice(0, MAX_FILES);
    setFiles(next);
    setPicked(big.length ? `${big.map((f) => f.name).join(', ')}: over 10 MB, not added` : files.length + ok.length > MAX_FILES ? `Up to ${MAX_FILES} files at a time` : '');
  };

  const send = async (t) => {
    const message = (t ?? text).trim();
    const sending = t === undefined ? files : [];
    if ((!message && !sending.length) || busy) return;
    setText(''); setBusy(true); setPicked('');
    try {
      let attachments;
      if (sending.length) {                          // the files wait in a temporary folder until the homework is confirmed
        const fd = new FormData();
        sending.forEach((f) => fd.append('files', f));
        attachments = (await api.post('/homework/chat-files', fd)).files;
      }
      setFiles([]);
      setItems((x) => [...x.filter((i) => i.k !== 'choices'), { k: 'u', text: message, files: sending.map((f) => f.name) }]);
      const body = { message, conversation_id: conv, auto_confirm: auto, ...(attachments ? { attachments } : {}) };
      let r = null, errMsg = '';
      const onEvent = (ev) => {
        if (ev.t === 'status' || ev.t === 'tool') {            // what the backend is doing right now (shown while waiting)
          setItems((x) => [...x.filter((i) => i.k !== 'step'), { k: 'step', text: ev.text }]);
        } else if (ev.t === 'text') {                          // the AI's words: show them immediately, indicator goes away
          setItems((x) => [...x.filter((i) => i.k !== 'step'), { k: 'a', text: ev.text, live: true, typed: true }]);
        } else if (ev.t === 'done') r = ev.data;
        else if (ev.t === 'error') errMsg = ev.error;
      };
      try { await api.stream('/ai/chat/stream', body, onEvent); }
      catch (e) {
        if (e.status !== 404) throw e;                         // an older server without streaming: use the normal request
        r = await api.post('/ai/chat', body);
      }
      if (errMsg) throw new Error(errMsg);
      if (!r) throw new Error('The connection dropped before the answer finished. Please try again.');
      setConv(r.conversation_id);
      const cards = r.actions || [];
      const missing = !cards.length && /check the card|press confirm/i.test(r.reply || '');
      const norm = (t) => String(t).replace(/\s+/g, ' ').trim().toLowerCase();
      setItems((x) => {
        const live = x.filter((i) => i.live);
        const same = live.length && norm(live.map((i) => i.text).join(' ')) === norm(r.reply || '');   // keep the bubbles already on screen when they match the final answer
        const base = x.filter((i) => i.k !== 'step' && (same || !i.live)).map((i) => (i.live ? { ...i, live: false } : i));
        return [...base,
        ...(r.reply && !missing && !same ? [{ k: 'a', text: r.reply, typed: true }] : []),
        ...(missing ? [{ k: 'e', text: 'The confirm card did not arrive. Please send your request again.' }] : []),
        ...(r.actions || []).map((a) => ({ k: 'card', a })),
        ...((r.downloads || []).length ? [{ k: 'files', list: r.downloads }] : []),
        ...(r.choices?.length ? [{ k: 'choices', options: r.choices }] : [])];
      });
    } catch (e) {
      setText((cur) => cur || message);              // keep what they typed (and the files, if the upload itself failed)
      setItems((x) => [...x.filter((i) => i.k !== 'step'), { k: 'e', text: e.message }]);
    } finally { setBusy(false); }
  };

  // the search bar hands over a question it could not answer with a screen: open the chat and send it
  useEffect(() => {
    if (!ask || ask.n === askSeen.current) return;
    askSeen.current = ask.n; setOpen(true);
    if (ask.text && !busy) send(ask.text);
  }, [ask]); // eslint-disable-line

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
  const reset = () => { setConv(null); setItems([]); setFiles([]); setPicked(''); };
  const chips = SUGGEST.filter((s) => me.features.includes(s.need)).slice(0, 4);
  const first = (me.profile?.full_name || '').split(' ')[0];

  return (<>
    {!open && <button className="ai-fab" onClick={() => setOpen(true)} aria-label="Open AI assistant"><span aria-hidden="true">✨</span><span className="fab-t"> Ask AI</span></button>}
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
            if (i.k === 'u') return <div key={n} className="ai-b u">{i.text}{(i.files || []).map((f, k) => <div key={k} className="ai-file">📎 {f}</div>)}</div>;
            if (i.k === 'a') return <div key={n} className={`ai-b a${i.typed ? ' ai-in' : ''}`}>{i.typed ? <Typed text={i.text} /> : rich(i.text)}</div>;
            if (i.k === 'step') return null;
            if (i.k === 'e') return <div key={n} className="ai-b e">{i.text}</div>;
            if (i.k === 'card') return <Card key={n} a={i.a} busy={busy} onDecide={decide} />;
            if (i.k === 'files') return <div key={n} className="ai-dls">{i.list.map((d) => <FileCard key={d.id || d.path} d={d} />)}</div>;
            return <div key={n} className="ai-ch">{i.options.map((o) => <button key={o} disabled={busy} onClick={() => send(o)}>{o}</button>)}</div>;
          })}
          {pending.length > 1 && (
            <div className="ai-all">
              <button className="btn primary" disabled={busy} onClick={() => decideAll('confirm')}>Confirm all ({pending.length})</button>
              <button className="btn" disabled={busy} onClick={() => decideAll('cancel')}>Cancel all</button>
            </div>
          )}
          {busy && !items.some((i) => i.live) && <Waiting step={items.find((i) => i.k === 'step')?.text} />}
          <div ref={end} />
        </div>
        {(files.length > 0 || picked) && (
          <div className="ai-files">
            {files.map((f, i) => (
              <span key={`${f.name}${i}`} className="ai-chip">📎 <span className="n">{f.name}</span> <small>{sizeOf(f.size)}</small>
                <button type="button" aria-label={`Remove ${f.name}`} disabled={busy} onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button></span>
            ))}
            {picked && <small className="ai-warn">{picked}</small>}
          </div>
        )}
        <form className="ai-f" onSubmit={(e) => { e.preventDefault(); send(); }}>
          {canAttach && <>
            <input ref={pick} type="file" multiple accept={ACCEPT} hidden onChange={addFiles} />
            <button type="button" className="btn" onClick={() => pick.current?.click()} disabled={busy || files.length >= MAX_FILES} title="Attach files to a homework (PDF, photo, Word, Excel, PowerPoint)" aria-label="Attach files">📎</button>
          </>}
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={files.length ? 'Which class is this for?' : 'Type a command…'} autoComplete="off" maxLength={2000} />
          {SR && <button type="button" className="btn" onClick={mic} title="Speak" aria-label="Speak">{listening ? '…' : '🎤'}</button>}
          <button className="btn primary" disabled={busy || (!text.trim() && !files.length)}>Send</button>
        </form>
      </div>
    )}
  </>);
}
