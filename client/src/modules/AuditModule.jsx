import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useData } from '../cache.js';
import { fetchers } from '../fetchers.js';
import { toast, Loading, Page, PageBar, Button, Section, DataTable, StatusBadge, EmptyState, FormDialog, Notice } from '../ui.jsx';
import { FilterBar } from '../FilterBar.jsx';

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
    <FormDialog title="Log entry" onClose={onClose} wide hideFooter>
      <dl className="ds-kv">{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v || '-'}</dd></React.Fragment>)}</dl>
      {Object.keys(rest).length > 0 && <>
        <div className="ds-label">Details recorded</div>
        <pre className="ds-code">{JSON.stringify(rest, null, 2)}</pre>
      </>}
      <p className="ds-note">Passwords, salary figures and message text are never stored in the log.</p>
    </FormDialog>
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
  const sv = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const cols = [
    { key: 'created_at', label: 'When', nowrap: true, render: (l) => when(l.created_at) },
    ...(sup ? [{ key: 'school', label: 'School', render: (l) => l.school_name || (l.school_id ? 'Removed school' : 'Platform') }] : []),
    { key: 'actor', label: 'Who', primary: true, render: (l) => <>{l.actor_name || l.actor_login || 'Unknown'}<span className="ds-subline">{ROLE[l.actor_role] || (l.actor_login ? 'Not signed in' : '')}</span></> },
    { key: 'summary', label: 'What', render: (l) => <>{l.summary}<span className="ds-subline">{KIND[l.kind]}</span></> },
    { key: 'module', label: 'Module', render: (l) => MODULES[l.module] || l.module },
    { key: 'success', label: 'Result', render: (l) => <StatusBadge tone={l.success ? 'ok' : 'bad'}>{l.success ? 'OK' : 'Failed'}</StatusBadge> },
  ];
  return (
    <Page>
      <PageBar title="Audit log" sub={`${sup ? 'Everything that happens on the platform, for every school.' : 'Everything that happens in your school.'} Entries cannot be edited or deleted.`}>
        <Button icon="download" onClick={exportCsv}>Export CSV</Button>
      </PageBar>
      <FilterBar q={f.q} onQ={(v) => setF((x) => ({ ...x, q: v }))} placeholder="Search who, what, or who it was done to..." count={rows ? rows.length : undefined}
        filters={[
          sup && { key: 'school_id', label: 'School', value: f.school_id, onChange: sv('school_id'), all: 'All schools', options: [{ value: 'platform', label: 'Platform only (no school)' }, ...(schools || []).map((x) => ({ value: x.id, label: x.name }))], type: 'select' },
          { key: 'module', label: 'Module', value: f.module, onChange: sv('module'), all: 'All modules', options: Object.entries(MODULES).map(([k, v]) => ({ value: k, label: v })), type: 'select' },
          { key: 'kind', label: 'Type', value: f.kind, onChange: sv('kind'), all: 'Changes, views & sign-ins', options: [{ value: 'change', label: 'Changes only' }, { value: 'view', label: 'Views only' }, { value: 'auth', label: 'Sign-ins only' }] },
          { key: 'result', label: 'Result', value: f.result, onChange: sv('result'), all: 'Any result', options: [{ value: 'ok', label: 'Successful' }, { value: 'failed', label: 'Failed / refused' }] },
          { key: 'from', label: 'From date', type: 'date', value: f.from, onChange: sv('from') },
          { key: 'to', label: 'To date', type: 'date', value: f.to, onChange: sv('to') },
        ].filter(Boolean)} />
      {err && <Notice tone="bad" action={<Button size="sm" onClick={load}>Retry</Button>}>{err}</Notice>}
      {!rows ? <Loading /> : (
        <Section flush>
          <DataTable columns={cols} rows={rows} onRowClick={setOpen} empty={err ? <EmptyState icon="shield" title="Could not load the log" /> : <EmptyState icon="shield" title="No log entries match">Try a wider date range or fewer filters.</EmptyState>} />
        </Section>
      )}
      {next && <div className="ds-more"><Button loading={more} onClick={loadMore}>Load older entries</Button></div>}
      {open && <Detail log={open} sup={sup} onClose={() => setOpen(null)} />}
    </Page>
  );
}
