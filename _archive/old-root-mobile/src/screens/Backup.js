// Backup & restore for mobile (school admin). Mirrors client/src/modules/BackupModule.jsx (same endpoints).
// Backup / restore run on the server as background jobs; this screen shows their progress.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { api } from '../api';
import { C, dateTime } from '../theme';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, toast, confirmAsk } from '../ui';
import { downloadAndShare } from '../download';
import { Pad } from './Attendance';

const size = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const KIND = { manual: 'Backup', 'before-restore': 'Safety copy (before a restore)' };

export function Backup() {
  const [list, setList] = useState(null);
  const [job, setJob] = useState({ status: 'idle' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const seen = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.get('/backup'); setList(d.history); setJob(d.job); setErr(''); }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (job.status !== 'running') return undefined;
    const t = setInterval(async () => {
      try { const j = await api.get('/backup/status'); setJob(j); if (j.status !== 'running') load(); } catch { /* next tick */ }
    }, 2000);
    return () => clearInterval(t);
  }, [job.status, load]);

  useEffect(() => {
    if ((job.status === 'done' || job.status === 'error') && seen.current !== job.finishedAt) {
      seen.current = job.finishedAt;
      toast(job.message || (job.status === 'done' ? 'Done' : 'Failed'), job.status === 'error');
    }
  }, [job]);

  const busy = job.status === 'running';
  const run = async (fn) => { try { setJob(await fn()); } catch (e) { toast(e.message, true); } };
  const restore = (b) => confirmAsk(`Restore the school from the backup of ${dateTime(b.created_at)}?\n\nAll current data of this school will be REPLACED${b.has_files ? ' and its files put back' : ''}. A safety copy of the current data is saved first.`, () => run(() => api.post(`/backup/${b.id}/restore`)));
  const del = (b) => confirmAsk(`Delete the saved backup of ${dateTime(b.created_at)}? This cannot be undone.`, async () => { try { await api.del(`/backup/${b.id}`); load(); } catch (e) { toast(e.message, true); } });
  const get = (b, which) => downloadAndShare(`/backup/${b.id}/${which}`, `${which}-${b.id}.${which === 'database' ? 'json.gz' : 'zip'}`, which === 'database' ? 'application/gzip' : 'application/zip').catch((e) => toast(e.message, true));

  return (
    <Pad reload={load} loading={loading} hasData={!!list}>
      <Card>
        <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>Backup this school</Text>
        <Dim style={{ marginTop: 4, marginBottom: 10 }}>Saves two files: one database file (all records) and one files zip (every document, photo and attachment). Download both and restore from them any time.</Dim>
        <Btn title={busy && job.kind === 'backup' ? 'Backing up...' : 'Create backup'} disabled={busy} onPress={() => run(() => api.post('/backup'))} />
        {busy && <Dim style={{ marginTop: 10 }}>{job.kind === 'restore' ? 'Restoring' : 'Backing up'}: {job.step} Keep this screen open.</Dim>}
        {!busy && job.status === 'error' && <ErrorBox>{job.message}</ErrorBox>}
        {!busy && job.status === 'done' && <Dim style={{ marginTop: 10 }}>{job.message}</Dim>}
      </Card>
      <ErrorBox>{err}</ErrorBox>
      {!list ? (err ? null : <Loading />) : list.length === 0 ? <Empty>No backups yet. Press "Create backup".</Empty> : list.map((b) => (
        <Card key={b.id} style={{ marginTop: 12 }}>
          <Text style={{ color: C.ink, fontWeight: '700' }}>{dateTime(b.created_at)}</Text>
          <Dim>{KIND[b.kind] || b.kind}{b.created_by ? ` - by ${b.created_by}` : ''}</Dim>
          <Dim>Database {size(b.db_size)} ({(b.rows || 0).toLocaleString('en-IN')} records){b.has_files ? ` - Files ${size(b.files_size)} (${b.file_count})` : ' - no files copy'}</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <Btn small kind="ghost" title="Database file" onPress={() => get(b, 'database')} />
            {b.has_files && <Btn small kind="ghost" title="Files zip" onPress={() => get(b, 'files')} />}
            <Btn small title="Restore" disabled={busy} onPress={() => restore(b)} />
            <Btn small kind="danger" title="Delete" disabled={busy} onPress={() => del(b)} />
          </View>
        </Card>
      ))}
      <Dim style={{ marginTop: 14 }}>Restoring replaces this school's records with the backup. The audit log is never rolled back. Files added after the backup are left alone. To restore from files saved on a computer, use the web version.</Dim>
    </Pad>
  );
}
