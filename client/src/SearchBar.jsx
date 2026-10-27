import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import { buildIndex, search, suggestions } from './search.js';

// Top search bar: finds any screen / action (fuzzy). If nothing matches, offers to ask the AI assistant.
// Shortcuts: "/" or Ctrl/Cmd+K to focus, arrows + Enter to choose, Esc to close.
export default function SearchBar({ targets, modules, extras, canAsk, onGo, onAsk }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const box = useRef(null); const input = useRef(null);
  const index = useMemo(() => buildIndex({ targets, modules, extras }), [targets, modules, extras]);
  const found = useMemo(() => (q.trim() ? search(index, q, 7) : suggestions(index, 6)), [index, q]);
  const typed = q.trim();
  const rows = [...found.map((f) => ({ ...f, row: 'hit' })), ...(typed && canAsk ? [{ row: 'ai', id: '__ai', label: typed }] : [])];
  useEffect(() => setSel(0), [q]);

  useEffect(() => {
    const key = (e) => {
      const t = e.target; const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', key); document.addEventListener('mousedown', away);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('mousedown', away); };
  }, []);

  const done = () => { setQ(''); setOpen(false); input.current?.blur(); };
  const choose = (r) => {
    if (!r) return;
    if (r.row === 'ai') onAsk(typed);
    else if (r.kind === 'action') r.run?.();
    else onGo(r.path);
    done();
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setSel((s) => Math.min(s + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(rows[sel]); }
    else if (e.key === 'Escape') { if (q) setQ(''); else done(); }
  };

  return (
    <div className="sbar" ref={box} role="search">
      <Icon name="search" size={17} />
      <input ref={input} value={q} placeholder="Search anything or ask AI…  ( / )" aria-label="Search the portal" autoComplete="off" maxLength={200}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
      {q && <button type="button" className="icon-btn sclear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(''); input.current?.focus(); }}><Icon name="x" size={16} /></button>}
      {open && (
        <div className="sres" role="listbox">
          {!typed && <div className="shead">Jump to</div>}
          {typed && !found.length && <div className="shead">No screen matches “{typed}”</div>}
          {rows.map((r, i) => r.row === 'ai' ? (
            <button key="ai" type="button" role="option" aria-selected={i === sel} className={`sitem ai ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => choose(r)}>
              <span className="sic" style={{ '--c': '#7c3aed' }}><Icon name="sparkle" size={17} /></span>
              <span className="st"><b>Ask AI: “{r.label}”</b><small>{found.length ? 'Not what you wanted? Let the assistant handle it' : 'Let the assistant answer or do it for you'}</small></span>
            </button>
          ) : (
            <button key={r.id} type="button" role="option" aria-selected={i === sel} className={`sitem ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => choose(r)}>
              <span className="sic" style={{ '--c': r.color || 'var(--accent)' }}><Icon name={r.icon || 'chevron'} size={17} /></span>
              <span className="st"><b>{r.label}</b><small>{r.hint}</small></span>
              <Icon name="chevron" size={14} />
            </button>
          ))}
          {typed && !found.length && !canAsk && <div className="shead">Try different words, e.g. “fees”, “attendance”, “certificate”.</div>}
        </div>
      )}
    </div>
  );
}
