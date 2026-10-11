// Tiny stale-while-revalidate store. A module prefetches its data when it opens
// (or right after login), so switching tabs inside it never waits on the network.
import { useEffect, useState, useCallback } from 'react';

const store = new Map();
const subs = new Set();
const inflight = new Map();

export const setCached = (k, v) => { store.set(k, v); subs.forEach((f) => f()); };
export const clearCache = () => { store.clear(); subs.forEach((f) => f()); };

export function load(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().then((v) => { setCached(key, v); return v; }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
export const prefetch = (key, fn) => (store.has(key) ? Promise.resolve(store.get(key)) : load(key, fn)).catch(() => {});

export function useData(key, fn, enabled = true) {
  const [, force] = useState(0);
  const [error, setError] = useState(null);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => subs.delete(f); }, []);
  const refresh = useCallback(() => load(key, fn).catch((e) => { setError(e.message); }), [key]); // eslint-disable-line
  useEffect(() => { if (enabled) refresh(); }, [key, enabled]); // eslint-disable-line
  return { data: store.get(key), error, refresh, loading: enabled && !store.has(key) && !error };
}
