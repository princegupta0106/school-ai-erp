import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { toast, Loading, ask, Page, PageBar, Button, Section, List, ListRow, StatusBadge, EmptyState, Notice, Field } from '../ui.jsx';

const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const size = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const KIND = { manual: 'Backup', 'before-restore': 'Safety copy (before a restore)' };

export function Backup() {
  const [list, setList] = useState(null);
  const [job, setJob] = useState({ status: 'idle' });
  const [err, setErr] = useState('');
  const [dbFile, setDbFile] = useState(null);
  const [zipFile, setZipFile] = useState(null);
  const seen = useRef(null); // the finished job we already announced

  const load = useCallback(async () => {
    try { const d = await api.get('/backup'); setList(d.history); setJob(d.job); setErr(''); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // while a job runs, ask for its progress every 2 seconds
  useEffect(() => {
    if (job.status !== 'running') return undefined;
    const t = setInterval(async () => {
      try {
        const j = await api.get('/backup/status');
        setJob(j);
        if (j.status !== 'running') load();
      } catch { /* try again on the next tick */ }
    }, 2000);
    return () => clearInterval(t);
  }, [job.status, load]);

  useEffect(() => {
    if (job.status === 'done' || job.status === 'error') {
      if (seen.current === job.finishedAt) return;
      seen.current = job.finishedAt;
      toast(job.message || (job.status === 'done' ? 'Done' : 'Failed'), job.status === 'error');
    }
  }, [job]);

  const busy = job.status === 'running';
  const run = async (fn) => { try { setJob(await fn()); } catch (e) { toast(e.message, true); } };

  const create = () => run(() => api.post('/backup'));
  const restore = async (b) => {
    if (!(await ask(`Restore the school from the backup of ${when(b.created_at)}?\n\nAll current data of this school will be REPLACED by the data in the backup${b.has_files ? ' and its files put back' : ''}.\nA safety copy of the current data is saved first.`))) return;
    run(() => api.post(`/backup/${b.id}/restore`));
  };
  const restoreFiles = async () => {
    if (!dbFile) return toast('Choose the database file first', true);
    if (!(await ask('Restore the school from these files?\n\nAll current data of this school will be REPLACED. A safety copy of the current data is saved first.'))) return;
    const fd = new FormData();
    fd.append('database', dbFile);
    if (zipFile) fd.append('files', zipFile);
    run(async () => { const j = await api.post('/backup/restore-upload', fd); setDbFile(null); setZipFile(null); return j; });
  };
  const del = async (b) => {
    if (!(await ask(`Delete the saved backup of ${when(b.created_at)}? This cannot be undone.`))) return;
    try { await api.del(`/backup/${b.id}`); await load(); toast('Deleted'); } catch (e) { toast(e.message, true); }
  };
  const get = async (b, which) => { try { await api.download(`/backup/${b.id}/${which}`, `${which}-${b.id}`); } catch (e) { toast(e.message, true); } };

  return (
    <Page>
      <PageBar title="Backup & restore" sub="Saves one database file (all records) and one files zip (every document, photo and attachment). Download both and restore from them any time.">
        <Button kind="primary" icon="download" loading={busy && job.kind === 'backup'} disabled={busy} onClick={create}>{busy && job.kind === 'backup' ? 'Backing up...' : 'Create backup'}</Button>
      </PageBar>
      {busy && <Notice tone="info"><span><b>{job.kind === 'restore' ? 'Restoring' : 'Backing up'}:</b> {job.step} - please keep this page open.</span></Notice>}
      {!busy && job.status === 'error' && <Notice tone="bad">{job.message}</Notice>}
      {!busy && job.status === 'done' && <Notice tone="ok">{job.message}</Notice>}
      {err && <Notice tone="bad" action={<Button size="sm" onClick={load}>Retry</Button>}>{err}</Notice>}

      <Section title="History" sub="The newest 20 backups are kept; older ones are removed automatically." flush>
        {!list ? <Loading /> : list.length === 0 ? <EmptyState icon="download" title="No backups yet">Press Create backup to save the first one.</EmptyState> : (
          <List>{list.map((b) => (
            <ListRow wrap key={b.id} title={when(b.created_at)} meta={<StatusBadge tone={b.kind === 'manual' ? 'ok' : 'mute'} dot={false}>{KIND[b.kind] || b.kind}</StatusBadge>}
              sub={`${b.created_by ? `By ${b.created_by} - ` : ''}Database ${size(b.db_size)} (${(b.rows || 0).toLocaleString('en-IN')} records)${b.has_files ? ` - Files ${size(b.files_size)} (${b.file_count})` : ' - no files copy'}`}>
              <span className="ds-inline">
                <Button size="sm" onClick={() => get(b, 'database')}>Database file</Button>
                {b.has_files && <Button size="sm" onClick={() => get(b, 'files')}>Files zip</Button>}
                <Button size="sm" kind="primary" disabled={busy} onClick={() => restore(b)}>Restore</Button>
                <Button size="sm" kind="danger" icon="trash" disabled={busy} aria-label={`Delete backup of ${when(b.created_at)}`} onClick={() => del(b)} />
              </span>
            </ListRow>))}</List>
        )}
      </Section>

      <Section title="Restore from downloaded files" sub="Use this if you saved the two files on your computer. Pick the database file (required) and the files zip (optional).">
        <div className="ds-file-row">
          <Field label="Database file" req><input type="file" accept=".gz,.json.gz,application/gzip" onChange={(e) => setDbFile(e.target.files[0] || null)} /></Field>
          <Field label="Files zip"><input type="file" accept=".zip,application/zip" onChange={(e) => setZipFile(e.target.files[0] || null)} /></Field>
          <Button kind="primary" disabled={busy || !dbFile} onClick={restoreFiles}>Restore from these files</Button>
        </div>
      </Section>
      <p className="ds-note">Restoring replaces this school's records with the backup. The audit log is never rolled back. Files in storage are put back from the zip; files added after the backup are left alone. If you were not in the backup you may be signed out.</p>
    </Page>
  );
}
