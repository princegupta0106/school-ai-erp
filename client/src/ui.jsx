import React, { useEffect, useState } from 'react';
import { onNetActivity } from './api.js';

const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  school: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6M12 10h.01',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8',
  back: 'm15 18-6-6 6-6',
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
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  chevron: 'm9 18 6-6-6-6',
  up: 'm18 15-6-6-6 6',
  down: 'm6 9 6 6 6-6',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
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

export const Field = ({ label, children, hint, req }) => (
  <label className="field"><span>{label}{req && <b className="req" aria-hidden="true"> *</b>}</span>{children}{hint && <small>{hint}</small>}</label>
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
