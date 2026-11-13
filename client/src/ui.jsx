import React, { useEffect, useState } from 'react';
import { onNetActivity } from './api.js';

const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  school: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6M12 10h.01',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8',
  back: 'm15 18-6-6 6-6',
  profile: 'M16 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 16c.5-1.5 1.7-2 3-2s2.5.5 3 2',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  x: 'M18 6 6 18M6 6l12 12',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3',
  paperclip: 'M21.4 11.6l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  attendance: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 3h6v4H9zM9 14l2 2 4-4',
  check: 'M20 6 9 17l-5-5',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1zM16 8.5a5 5 0 0 1 0 7',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  pin: 'M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  academics: 'M22 10 12 5 2 10l10 5 10-5zM6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 10v6',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4M3 7h16a1 1 0 0 1 1 1v3M16 14h4v-3h-4a1.5 1.5 0 0 0 0 3z',
  rupee: 'M6 3h12M6 8h12M6 13h4.5a4.5 4.5 0 0 0 0-10M6 13l8.5 8',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  chevron: 'm9 18 6-6-6-6',
  up: 'm18 15-6-6-6 6',
  down: 'm6 9 6 6 6-6',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  userplus: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  bus: 'M8 6v6M15 6v6M2 12h19.6M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3M9 18h5M5 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0M14 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
};
export const Icon = ({ name, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name]} /></svg>
);

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="sheet-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint, req, full }) => (
  <label className={`field${full ? ' ds-full' : ''}`}><span>{label}{req && <b className="req" aria-hidden="true"> *</b>}</span>{children}{hint && <small>{hint}</small>}</label>
);

export const Empty = ({ children }) => <div className="empty">{children}</div>;

// Placeholder shown while a page's data is on its way. It stays invisible for the first ~120ms,
// so quick loads never flash a skeleton - the content just fades in.
export const Loading = ({ rows = 4 }) => (
  <div className="skel" role="status" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="skel-row" style={{ animationDelay: `${i * 90}ms` }} />)}
  </div>
);

// Full-screen placeholder used only while the very first sign-in check is running.
export const Splash = () => <div className="center"><div className="splash"><div className="logo"><Icon name="school" /></div></div></div>;

// Thin bar at the very top of the screen while the app is talking to the server for longer than ~350ms.
export function NetBar() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let t = null;
    const off = onNetActivity((n) => {
      if (n > 0) { if (!t) t = setTimeout(() => setBusy(true), 350); } else { clearTimeout(t); t = null; setBusy(false); }
    });
    return () => { clearTimeout(t); off(); };
  }, []);
  return <div className={`netbar ${busy ? 'on' : ''}`} aria-hidden="true"><i /></div>;
}
export const Badge = ({ children, tone }) => <span className={`badge ${tone || ''}`}>{children}</span>;

let toastTimer;
export function toast(msg, bad) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.className = bad ? 'bad show' : 'show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.className = ''), 3200);
}

export const ROLE_LABEL = { super_admin: 'Super admin', school_admin: 'School admin', parent: 'Parent', staff: 'Staff', student: 'Student', other: 'Other' };
export const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();

// If a page crashes, show what happened (and a way out) instead of a blank white screen.
export class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Page crashed:', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <b>Something went wrong on this page.</b>
        <p className="muted" style={{ margin: '8px 0 12px' }}>{String(this.state.error.message || this.state.error)}</p>
        <div className="row">
          <button className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn" onClick={() => { location.hash = ''; location.reload(); }}>Go to home</button>
        </div>
      </div>
    );
  }
}

// A fixed-height scroll area. A soft fade shows on the edge where more content is hidden (bottom while at the top, top once scrolled).
export function ScrollFade({ className = '', children, ...rest }) {
  const ref = React.useRef(null); const [f, setF] = React.useState({ t: false, b: false });
  const calc = () => { const e = ref.current; if (!e) return; const t = e.scrollTop > 4; const b = e.scrollHeight - e.scrollTop - e.clientHeight > 4; setF((o) => (o.t === t && o.b === b ? o : { t, b })); };
  React.useEffect(() => {
    calc(); const e = ref.current; if (!e) return undefined;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(calc);
    if (ro) { ro.observe(e); Array.from(e.children).forEach((c) => ro.observe(c)); }
    window.addEventListener('resize', calc);
    return () => { ro && ro.disconnect(); window.removeEventListener('resize', calc); };
  });
  return <div ref={ref} onScroll={calc} className={`sf ${f.t ? 'sf-t' : ''} ${f.b ? 'sf-b' : ''} ${className}`} {...rest}>{children}</div>;
}

// Clean confirm / text prompts (replace the browser's confirm() and prompt()). Both return a Promise.
function dlg(build) {
  return new Promise((res) => {
    const wrap = document.createElement('div'); wrap.className = 'dlg-scrim';
    const box = document.createElement('div'); box.className = 'dlg'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
    wrap.appendChild(box); document.body.appendChild(wrap);
    const done = (v) => { document.removeEventListener('keydown', key, true); wrap.remove(); res(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', key, true);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(null); });
    build(box, done);
  });
}
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export function ask(msg, opts = {}) {
  const danger = opts.danger ?? /^(delete|remove)/i.test(msg);
  const yes = opts.yes || (/^remove/i.test(msg) ? 'Remove' : danger ? 'Delete' : 'Continue');
  return dlg((box, done) => {
    box.appendChild(mk('h3', '', opts.title || 'Please confirm')); box.appendChild(mk('p', '', msg));
    const row = mk('div', 'dlg-b'); const n = mk('button', 'btn', 'Cancel'); const y = mk('button', `btn ${danger ? 'danger solid' : 'primary'}`, yes);
    n.onclick = () => done(false); y.onclick = () => done(true); row.append(n, y); box.appendChild(row); y.focus();
  }).then((v) => v === true);
}
export function askText(label, value = '', opts = {}) {
  return dlg((box, done) => {
    box.appendChild(mk('h3', '', label)); const inp = mk('input'); inp.value = value == null ? '' : String(value); box.appendChild(inp);
    const row = mk('div', 'dlg-b'); const n = mk('button', 'btn', 'Cancel'); const y = mk('button', 'btn primary', opts.yes || 'Save');
    n.onclick = () => done(null); y.onclick = () => done(inp.value); inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); };
    row.append(n, y); box.appendChild(row); inp.focus(); inp.select();
  });
}

/* ===== class-wise student lists (used wherever students are shown) =====
   classRank puts classes in school order: Playgroup, Nursery, LKG, UKG, 1, 2 ... 12, then anything else, "No class" last. */
export function classRank(label) {
  const s = String(label || '').trim().replace(/^class\s+/i, '');
  if (!s || /^no class$/i.test(s)) return [9e6, ''];
  const m = s.match(/^(\d+)\s*(.*)$/);
  if (m) return [Number(m[1]), m[2].toUpperCase()];
  const w = s.toLowerCase();
  const early = [['play', -5], ['pre', -4], ['nur', -3], ['lkg', -2], ['kg1', -2], ['ukg', -1], ['kg2', -1]].find(([k]) => w.startsWith(k));
  return early ? [early[1], s.toUpperCase()] : [1e6, s.toUpperCase()];
}
export const compareClass = (a, b) => { const x = classRank(a); const y = classRank(b); return x[0] - y[0] || x[1].localeCompare(y[1], undefined, { numeric: true }); };
const CLASS_COLORS = ['#f97316', '#0ea5e9', '#8b5cf6', '#10b981', '#ec4899', '#14b8a6', '#6366f1', '#ca8a04', '#d946ef', '#ef4444', '#22c55e', '#3b82f6'];
export const classColor = (label) => { const [n, sec] = classRank(label); return n >= 9e6 ? '#64748b' : CLASS_COLORS[(((n > 1e5 ? 0 : n + 5) + (sec ? sec.charCodeAt(0) : 0)) % CLASS_COLORS.length + CLASS_COLORS.length) % CLASS_COLORS.length]; };
export const classText = (label) => (label && !/^no class$/i.test(label) ? `Class ${String(label).replace(/^class\s+/i, '')}` : 'No class');

/** [{label, items}] in school order. getLabel(item) gives "10 A" / "Nursery" / empty. */
export function groupByClass(items, getLabel) {
  const map = new Map();
  for (const it of items) { const l = String(getLabel(it) || '').trim() || 'No class'; if (!map.has(l)) map.set(l, []); map.get(l).push(it); }
  return [...map.entries()].sort((a, b) => compareClass(a[0], b[0])).map(([label, list]) => ({ label, items: list }));
}

/** One collapsible class section. `open` forces it open (e.g. while searching). */
export function ClassGroup({ label, count, note, open, children }) {
  const [shut, setShut] = useState(false);
  const c = classColor(label); const isOpen = open || !shut;
  return (
    <section className="cg" style={{ '--c': c }}>
      <button type="button" className="cg-h" aria-expanded={isOpen} onClick={() => setShut(isOpen)}>
        <span className="cg-badge">{classText(label).replace('Class ', '')}</span>
        <b>{classText(label)}</b>
        <span className="cg-n">{count} student{count === 1 ? '' : 's'}</span>
        {note && <span className="cg-note">{note}</span>}
        <svg className="cg-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {isOpen && <div className="cg-b">{children}</div>}
    </section>
  );
}


/* ===================== DESIGN SYSTEM COMPONENTS (styles live in ds.css, all classes prefixed ds-) ===================== */
// Title (+ optional subtitle) on the left, actions on the right. `lead` = something before the title, e.g. a Back button.
export const PageBar = ({ title, sub, lead, children, sticky, className = '' }) => (
  <div className={`ds-bar ${sticky ? 'ds-bar-sticky' : ''} ${className}`}>
    {lead && <div className="ds-bar-lead">{lead}</div>}
    <div className="ds-bar-t"><b className="ds-title">{title}</b>{sub ? <div className="ds-sub">{sub}</div> : null}</div>
    {children ? <div className="ds-bar-a">{children}</div> : null}
  </div>
);
// One wrapping row for search + filters + actions. Put <ToolbarEnd> around the buttons that should hug the right edge.
export const Toolbar = ({ children, className = '' }) => <div className={`ds-toolbar ${className}`}>{children}</div>;
export const ToolbarEnd = ({ children }) => <div className="ds-toolbar-end">{children}</div>;
export const SearchInput = ({ value, onChange, placeholder = 'Search...', autoFocus, className = '', ...rest }) => (
  <label className={`ds-search ${className}`}><Icon name="search" size={18} />
    <input type="search" value={value} autoFocus={autoFocus} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...rest} />
  </label>
);
// Scroll area for a fixed-height card. Put an empty-state in <div className="ds-fill">.
export const CardBody = ({ children }) => <div className="ds-card-body">{children}</div>;
// Docked save bar. summary = left text, error = red message, dirty = shows the unsaved dot, action = the button(s).
export const SaveBar = ({ summary, error, dirty, action }) => (
  <div className="ds-savebar">
    <div className="ds-savebar-s">{error ? <span className="ds-savebar-e">{error}</span> : summary}{dirty && <i className="ds-savebar-d" title="Unsaved changes" />}</div>
    <div className="ds-savebar-a">{action}</div>
  </div>
);


/* =====================================================================================================
   DESIGN SYSTEM v2  -  the ONE set of building blocks every module uses (styles: ds.css, tokens: tokens.css)
   Page anatomy (see /DESIGN-STANDARD.md):   Page > PageBar > Tabs? > FilterBar? > KpiGrid? > Section / DataTable / ListRow
   Create / edit = FormDialog.  Delete / dangerous = ask().  Nothing here hard-codes a colour, size or radius.
   ===================================================================================================== */

/** Wrap every screen in <Page>. It gives the standard max width and the standard vertical rhythm between blocks. */
export const Page = ({ children, narrow, className = '' }) => <div className={`ds-page ${narrow ? 'ds-page-narrow' : ''} ${className}`}>{children}</div>;

/** Map any status word to one of 5 tones, so "paid" is the same green in Fees, Payroll and Inventory. */
const TONE_WORDS = {
  ok: ['ok', 'paid', 'present', 'approved', 'active', 'done', 'complete', 'completed', 'success', 'in stock', 'received', 'enrolled', 'admitted', 'open', 'good'],
  warn: ['warn', 'due', 'late', 'pending', 'partial', 'low', 'low stock', 'waiting', 'in progress', 'review', 'half day', 'ordered'],
  bad: ['bad', 'overdue', 'absent', 'rejected', 'cancelled', 'canceled', 'failed', 'error', 'out', 'out of stock', 'blocked', 'dropped', 'expired'],
  info: ['info', 'leave', 'on leave', 'draft', 'new', 'scheduled', 'issued', 'sent', 'enquiry', 'applied'],
};
export const toneFor = (status) => {
  const s = String(status ?? '').trim().toLowerCase();
  if (['ok', 'warn', 'bad', 'info', 'mute'].includes(s)) return s;
  for (const t of Object.keys(TONE_WORDS)) if (TONE_WORDS[t].includes(s)) return t;
  return 'mute';
};

/** Status pill. <StatusBadge>Paid</StatusBadge> picks the tone from the word; or pass tone="warn" explicitly. */
export const StatusBadge = ({ tone, children, dot = true, title }) => (
  <span className={`ds-badge ds-t-${tone || toneFor(children)} ${dot ? 'ds-badge-dot' : ''}`} title={title}>{children}</span>
);

/** One button to rule them all. kind: primary | secondary (default) | ghost | danger.  size: md (default) | sm. */
export const Button = ({ kind = 'secondary', size = 'md', icon, loading, children, className = '', type = 'button', ...rest }) => (
  <button type={type} className={`ds-btn ds-btn-${kind} ds-btn-${size} ${className}`} disabled={loading || rest.disabled} {...rest}>
    {loading ? <span className="ds-spin" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
    {children != null && children !== false ? <span>{children}</span> : null}
  </button>
);

/** Tabs switch between VIEWS of the same screen (not filters; filters use FilterBar).  items: [{ key, label, count? }] */
export const Tabs = ({ items, value, onChange, className = '' }) => (
  <div className={`ds-tabs ${className}`} role="tablist">
    {items.map((t) => (
      <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className={`ds-tab ${value === t.key ? 'on' : ''}`} onClick={() => onChange(t.key)}>
        {t.label}{t.count != null && <span className="ds-tab-n">{t.count}</span>}
      </button>
    ))}
  </div>
);

/** Headline numbers. <KpiGrid><Kpi label="Students" value={412} sub="12 new" tone="ok" /></KpiGrid>  tone colours the number only. */
export const KpiGrid = ({ children, cols }) => <div className="ds-kpis" style={cols ? { '--ds-kpi-cols': cols } : undefined}>{children}</div>;
export const Kpi = ({ label, value, sub, tone, icon, onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`ds-kpi ${onClick ? 'ds-kpi-click' : ''}`} onClick={onClick}>
      {icon && <span className="ds-kpi-ic"><Icon name={icon} size={18} /></span>}
      <span className="ds-kpi-t"><span className="ds-kpi-l">{label}</span><b className={`ds-kpi-v ${tone ? `ds-c-${tone}` : ''}`}>{value}</b>{sub ? <span className="ds-kpi-s">{sub}</span> : null}</span>
    </Tag>
  );
};

/** A titled card: title/sub on the left, small actions on the right, then the body.  flush = no body padding (for tables / lists). */
export const Section = ({ title, sub, actions, flush, children, className = '' }) => (
  <section className={`ds-section ${className}`}>
    {(title || actions) && (
      <header className="ds-section-h">
        <div className="ds-section-t">{title && <h3>{title}</h3>}{sub ? <span>{sub}</span> : null}</div>
        {actions ? <div className="ds-section-a">{actions}</div> : null}
      </header>
    )}
    <div className={flush ? 'ds-section-b flush' : 'ds-section-b'}>{children}</div>
  </section>
);

/** Same empty / loading look everywhere. */
export const EmptyState = ({ icon = 'box', title, children, action }) => (
  <div className="ds-empty"><span className="ds-empty-ic"><Icon name={icon} size={22} /></span>{title && <b>{title}</b>}{children ? <p>{children}</p> : null}{action}</div>
);

/** Responsive table: a real table from 760px up, stacked cards on phones. Nothing to configure per screen.
 *  columns: [{ key, label, render?(row), align?: 'right'|'center', primary?: true (card title on phones), nowrap?: true }]
 *  rows: array of objects. rowKey: (row, index) => id. onRowClick optional. empty: node shown when there are no rows.
 *  foot: (column) => node for a totals row under the table (return null for columns with nothing to show). */
export function DataTable({ columns, rows, rowKey = (r) => r.id, onRowClick, empty, dense, foot }) {
  if (!rows || !rows.length) return empty || <EmptyState title="Nothing here yet" />;
  return (
    <div className="ds-table-wrap">
      <table className={`ds-table ${dense ? 'ds-table-dense' : ''}`}>
        <thead><tr>{columns.map((c) => <th key={c.key} className={c.align ? `ds-al-${c.align}` : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className={onRowClick ? 'ds-row-click' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={`${c.align ? `ds-al-${c.align}` : ''} ${c.primary ? 'ds-td-primary' : ''} ${c.nowrap ? 'ds-nowrap' : ''}`}>{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot ? <tfoot><tr>{columns.map((c) => <td key={c.key} data-label={c.label} className={c.align ? `ds-al-${c.align}` : ''}>{foot(c)}</td>)}</tr></tfoot> : null}
      </table>
    </div>
  );
}

/** Rows for people / things (students, items, requests).  <ListRow lead={<Avatar/>} title sub meta={<StatusBadge/>} onClick>
 *  wrap = let the second line wrap (records with notes / reasons); children = small action buttons after the meta. */
export const List = ({ children }) => <div className="ds-list">{children}</div>;
export const ListRow = ({ lead, title, sub, meta, onClick, wrap, children }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`ds-lrow ${onClick ? 'ds-lrow-click' : ''} ${wrap ? 'ds-lrow-wrap' : ''}`} onClick={onClick}>
      {lead ? <span className="ds-lrow-lead">{lead}</span> : null}
      <span className="ds-lrow-t"><b>{title}</b>{sub ? <span>{sub}</span> : null}</span>
      {meta ? <span className="ds-lrow-meta">{meta}</span> : null}
      {children}
      {onClick ? <Icon name="chevron" size={16} /> : null}
    </Tag>
  );
};

/** Every create / edit form opens in this. Same header, same docked footer (Cancel left of the primary button), same error slot.
 *  <FormDialog title="Add visitor" onClose={..} onSubmit={save} busy={saving} error={err} submitLabel="Save">...<Field/>...</FormDialog> */
export function FormDialog({ title, sub, onClose, onSubmit, busy, error, submitDisabled, submitLabel = 'Save', cancelLabel = 'Cancel', wide, danger, hideFooter, noForm, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // noForm: a detail dialog with several independent sections, each with its own <form> and Save button (nested forms are not valid HTML)
  const Wrap = noForm ? 'div' : 'form';
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Wrap className={`sheet ds-dlg ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} {...(noForm ? {} : { onSubmit: (e) => { e.preventDefault(); if (!busy && onSubmit) onSubmit(e); } })}>
        <div className="sheet-head ds-dlg-h"><div><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="sheet-body ds-dlg-b">{children}{error ? <div className="ds-dlg-err" role="alert">{error}</div> : null}</div>
        {!hideFooter && (
          <div className="ds-dlg-f">
            <Button onClick={onClose} disabled={busy}>{cancelLabel}</Button>
            <Button type="submit" kind={danger ? 'danger' : 'primary'} loading={busy} disabled={submitDisabled}>{submitLabel}</Button>
          </div>
        )}
      </Wrap>
    </div>
  );
}

/** Inline message under a header or after an action ("Visitor added...").  tone: ok | warn | bad | info | mute.  action = optional button / link. */
export const Notice = ({ tone = 'info', children, action }) => <div className={`ds-notice ds-t-${tone}`} role="status"><span>{children}</span>{action}</div>;

/** Two-column field grid for forms (one column on phones). Give a Field `full` to span both columns. */
export const FormGrid = ({ children }) => <div className="ds-form">{children}</div>;

/** Pick ONE option inside a form (same name and options as mobile Choice). Not for switching views: that is Tabs.  options: [{ value, label }] */
export const Choice = ({ options, value, onChange, label }) => (
  <div className="ds-choice" role="radiogroup" aria-label={label}>
    {options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`ds-choice-o ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div>
);

/** Pick SEVERAL options inside a form (days, classes, subjects). Same look as Choice; options: [{ value, label, disabled?, title? }], values: array of selected values. */
export const MultiChoice = ({ options, values, onToggle, label }) => (
  <div className="ds-choice" role="group" aria-label={label}>
    {options.map((o) => <button key={o.value} type="button" aria-pressed={values.includes(o.value)} disabled={o.disabled} title={o.title} className={`ds-choice-o ${values.includes(o.value) ? 'on' : ''}`} onClick={() => onToggle(o.value)}>{o.label}</button>)}
  </div>
);
