import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon, Empty, toast, Loading, Badge, ask } from '../ui.jsx';

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
    <div className="stack">
      <div className="card">
        <div className="row sp" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <b>Backup this school</b>
            <div className="muted">Saves two files: one <b>database file</b> (all records) and one <b>files zip</b> (every document, photo and attachment). You can download both and restore from them any time.</div>
          </div>
          <button className="btn primary" disabled={busy} onClick={create}><Icon name="download" /> {busy && job.kind === 'backup' ? 'Backing up...' : 'Create backup'}</button>
        </div>
        {busy && <div className="muted" style={{ marginTop: 10 }}><b>{job.kind === 'restore' ? 'Restoring' : 'Backing up'}:</b> {job.step} - please keep this page open.</div>}
        {!busy && job.status === 'error' && <div className="err" style={{ marginTop: 10 }}>{job.message}</div>}
        {!busy && job.status === 'done' && <div className="muted" style={{ marginTop: 10 }}>{job.message}</div>}
      </div>

      {err && <div className="err">{err}</div>}
      {!list ? <Loading /> : list.length === 0 ? <Empty>No backups yet. Press "Create backup".</Empty> : (
        <div className="card">
          <b>History</b>
          {list.map((b) => (
            <div key={b.id} className="drow" style={{ display: 'block', padding: '12px 0', borderTop: '1px solid var(--line)' }}>
              <div className="row sp" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b>{when(b.created_at)}</b> <Badge tone={b.kind === 'manual' ? 'ok' : 'mute'}>{KIND[b.kind] || b.kind}</Badge>
                  <div className="muted">
                    {b.created_by ? `By ${b.created_by} - ` : ''}Database {size(b.db_size)} ({(b.rows || 0).toLocaleString('en-IN')} records)
                    {b.has_files ? ` - Files ${size(b.files_size)} (${b.file_count})` : ' - no files copy'}
                  </div>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={() => get(b, 'database')}>Database file</button>
                  {b.has_files && <button className="btn" onClick={() => get(b, 'files')}>Files zip</button>}
                  <button className="btn primary" disabled={busy} onClick={() => restore(b)}>Restore</button>
                  <button className="btn danger" disabled={busy} onClick={() => del(b)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
          <div className="muted" style={{ marginTop: 8 }}>The newest 20 backups are kept; older ones are removed automatically.</div>
        </div>
      )}

      <div className="card">
        <b>Restore from downloaded files</b>
        <div className="muted" style={{ marginBottom: 10 }}>Use this if you saved the two files on your computer. Pick the database file (required) and the files zip (optional), then restore.</div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label>Database file <input type="file" accept=".gz,.json.gz,application/gzip" onChange={(e) => setDbFile(e.target.files[0] || null)} /></label>
          <label>Files zip <input type="file" accept=".zip,application/zip" onChange={(e) => setZipFile(e.target.files[0] || null)} /></label>
          <button className="btn primary" disabled={busy || !dbFile} onClick={restoreFiles}>Restore from these files</button>
        </div>
      </div>
      <div className="muted">Restoring replaces this school's records with the backup. The audit log is never rolled back. Files in storage are put back from the zip; files added after the backup are left alone. If you were not in the backup you may be signed out.</div>
    </div>
  );
}
