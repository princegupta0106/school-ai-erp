import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useData } from '../cache.js';
import { fetchers } from '../fetchers.js';
import { Icon, Empty, Modal, toast, Loading } from '../ui.jsx';

const MODULES = {
  auth: 'Sign-in & account', school: 'School', users: 'Users', attendance: 'Attendance', visitors: 'Visitors', fees: 'Fees',
  communication: 'Communication', academics: 'Academics', documents: 'Documents', payroll: 'Payroll & Leave', ai: 'AI assistant', audit: 'Audit logs', backup: 'Backup & restore', system: 'Other',
};
const KIND = { change: 'Change', view: 'Viewed', auth: 'Sign-in' };
const ROLE = { super_admin: 'Super admin', school_admin: 'School admin', parent: 'Parent', staff: 'Staff', student: 'Student', other: 'Other' };
const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const EMPTY = { q: '', module: '', kind: '', result: '', from: '', to: '', school_id: '' };

function Detail({ log, sup, onClose }) {
  const rows = [
    ['When', when(log.created_at)],
    ['Who', `${log.actor_name || log.actor_login || 'Unknown'}${log.actor_login && log.actor_name ? ` (${log.actor_login})` : ''}${log.actor_role ? ` - ${ROLE[log.actor_role] || log.actor_role}` : ''}`],
    sup && ['School', log.school_name || (log.school_id ? 'Removed school' : 'Platform (no school)')],
    ['What', log.summary],
    log.entity_label && ['Target', log.entity_label],
    ['Module', MODULES[log.module] || log.module],
    ['Type', KIND[log.kind] || log.kind],
    ['Result', log.success ? `Success (${log.status_code})` : `Failed (${log.status_code})${log.detail?.error ? ` - ${log.detail.error}` : ''}`],
    ['Action code', log.action],
    ['Request', `${log.method} ${log.path}`],
    ['IP address', log.ip],
    ['Device', log.user_agent],
  ].filter(Boolean);
  const { error: _e, ...rest } = log.detail || {};
  return (
    <Modal title="Log entry" onClose={onClose} wide>
      <dl className="kv">{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v || '-'}</dd></React.Fragment>)}</dl>
      {Object.keys(rest).length > 0 && <>
        <div className="nav-label" style={{ margin: '14px 0 6px' }}>Details recorded</div>
        <pre className="pre">{JSON.stringify(rest, null, 2)}</pre>
      </>}
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Passwords, salary figures and message text are never stored in the log.</p>
    </Modal>
  );
}

// School admin: the log of their own school.  Super admin: all schools (pick one, or "All schools").
export function AuditLogs({ me }) {
  const sup = me.role === 'super_admin';
  const { data: schools } = useData('schools', fetchers.schools, sup);
  const [f, setF] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [rows, setRows] = useState(null); const [next, setNext] = useState(null);
  const [err, setErr] = useState(''); const [more, setMore] = useState(false); const [open, setOpen] = useState(null);

  // text search waits for a pause in typing; dropdowns / dates apply straight away
  useEffect(() => { const t = setTimeout(() => setApplied(f), f.q === applied.q ? 0 : 350); return () => clearTimeout(t); }, [f]); // eslint-disable-line

  const params = useCallback((extra = {}) => new URLSearchParams(Object.entries({ ...applied, ...extra }).filter(([, v]) => v)), [applied]);
  const load = useCallback(() => {
    setRows(null); setErr('');
    api.get(`/audit?${params()}`).then((d) => { setRows(d.logs); setNext(d.next); }).catch((e) => { setErr(e.message); setRows([]); });
  }, [params]);
  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    setMore(true);
    try { const d = await api.get(`/audit?${params({ before: next })}`); setRows((r) => [...r, ...d.logs]); setNext(d.next); }
    catch (e) { toast(e.message, true); } finally { setMore(false); }
  };
  const exportCsv = () => api.download(`/audit/export?${params()}`, 'audit-log.csv').catch((e) => toast(e.message, true));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY);

  return (
    <div className="stack">
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row sp">
          <div className="muted" style={{ fontSize: 14 }}>
            {sup ? 'Everything that happens on the platform, for every school.' : 'Everything that happens in your school.'} Entries cannot be edited or deleted.
          </div>
          <button className="btn" onClick={exportCsv}><Icon name="download" size={16} />Export CSV</button>
        </div>
        <div className="row">
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200 }}>
            <input placeholder="Search who, what, or who it was done to..." value={f.q} onChange={set('q')} />
          </div>
          {sup && <select style={{ width: 'auto' }} value={f.school_id} onChange={set('school_id')}>
            <option value="">All schools</option><option value="platform">Platform only (no school)</option>
            {(schools || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>}
          <select style={{ width: 'auto' }} value={f.module} onChange={set('module')}>
            <option value="">All modules</option>{Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select style={{ width: 'auto' }} value={f.kind} onChange={set('kind')}>
            <option value="">Changes, views &amp; sign-ins</option><option value="change">Changes only</option><option value="view">Views only</option><option value="auth">Sign-ins only</option>
          </select>
          <select style={{ width: 'auto' }} value={f.result} onChange={set('result')}>
            <option value="">Any result</option><option value="ok">Successful</option><option value="failed">Failed / refused</option>
          </select>
        </div>
        <div className="row">
          <label className="row" style={{ gap: 6 }}><span className="muted" style={{ fontSize: 13 }}>From</span><input type="date" style={{ width: 'auto' }} value={f.from} max={f.to || undefined} onChange={set('from')} /></label>
          <label className="row" style={{ gap: 6 }}><span className="muted" style={{ fontSize: 13 }}>To</span><input type="date" style={{ width: 'auto' }} value={f.to} min={f.from || undefined} onChange={set('to')} /></label>
          {dirty && <button className="linkbtn" onClick={() => { setF(EMPTY); setApplied(EMPTY); }}>Clear filters</button>}
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {!rows ? <Loading /> : rows.length === 0 && !err ? <Empty>No log entries match.</Empty> : (
        <div className="card scrollx" style={{ padding: 0 }}>
          <table className="rt audit">
            <thead><tr><th>When</th>{sup && <th>School</th>}<th>Who</th><th>What</th><th>Module</th><th>Result</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="click" onClick={() => setOpen(l)}>
                  <td>{when(l.created_at)}</td>
                  {sup && <td>{l.school_name || (l.school_id ? 'Removed school' : <span className="muted">Platform</span>)}</td>}
                  <td><b>{l.actor_name || l.actor_login || 'Unknown'}</b><div className="muted" style={{ fontSize: 12 }}>{ROLE[l.actor_role] || (l.actor_login ? 'Not signed in' : '')}</div></td>
                  <td className="what">{l.summary}<div className="muted" style={{ fontSize: 12 }}>{KIND[l.kind]}</div></td>
                  <td>{MODULES[l.module] || l.module}</td>
                  <td>{l.success ? <span className="badge ok">OK</span> : <span className="badge off">Failed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && <button className="btn" style={{ alignSelf: 'center' }} disabled={more} onClick={loadMore}>{more ? 'Loading...' : 'Load older entries'}</button>}
      {open && <Detail log={open} sup={sup} onClose={() => setOpen(null)} />}
    </div>
  );
}
