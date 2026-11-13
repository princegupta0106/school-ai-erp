import { useCallback, useEffect, useState } from 'react';
import { peek, isFresh, fetchUrl, subscribe } from './cache';

// GET with instant cached data + background refresh. Pass null to skip. reload() forces a fresh fetch.
export function useApi(url) {
  const [data, setData] = useState(() => (url ? peek(url) ?? null : null));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try { setData(await fetchUrl(url)); setError(''); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [url]);
  useEffect(() => {
    if (!url) { setData(null); return undefined; }
    setData(peek(url) ?? null); setError('');
    const off = subscribe(url, (d) => setData(d));
    if (!isFresh(url)) load();
    return off;
  }, [url, load]);
  return { data, error, loading, reload: load };
}
