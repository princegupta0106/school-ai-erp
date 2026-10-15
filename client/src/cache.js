// Stale-while-revalidate data cache.
//
//  * Anything read through useData / useApi is shown INSTANTLY from the cache (memory, and
//    localStorage after a reload) while a fresh copy is fetched in the background. When the
//    server answers, the screen updates in place - and only if the data actually changed.
//  * Requests for the same key are shared; an older response can never overwrite a newer one.
//  * Any write (POST/PATCH/PUT/DELETE) marks everything stale, so the next screen re-checks.
//  * The persisted copy is namespaced per user and wiped on sign-out.
import { useEffect, useState, useCallback, useRef } from 'react';
import { api, onMutation } from './api.js';
import { toast } from './ui.jsx';

const PREFIX = 'sp:cache:v1:';
const MAX_AGE = 24 * 60 * 60 * 1000; // persisted data older than a day is ignored
const MAX_BYTES = 1_500_000;         // total size kept in localStorage
const MAX_ENTRY = 250_000;           // single responses bigger than this are memory-only
const FRESH_MS = 2500;               // a result this young is not fetched again (prefetch -> open)

const store = new Map();      // key -> data
const stamp = new Map();      // key -> when it was last fetched
const stale = new Set();      // keys that must be re-checked (a write happened since)
const inflight = new Map();   // key -> promise
const seq = new Map();        // key -> number of the newest request (older answers are dropped)
const fnFor = new Map();      // key -> fetch function
const listeners = new Map();  // key -> Set<fn> of mounted components
let epoch = 0;                // bumps on sign-in/out so late answers can't leak between users
let ns = null;                // current user id (storage namespace)
let timer = null;
let lastWarn = 0;

const listen = (key, f) => {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(f);
  return () => { set.delete(f); if (!set.size) listeners.delete(key); };
};
const notify = (key) => listeners.get(key)?.forEach((f) => f());
const notifyAll = () => listeners.forEach((set) => set.forEach((f) => f()));
const sameJSON = (a, b) => { if (a === b) return true; try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
const isFresh = (key, ms = FRESH_MS) => store.has(key) && !stale.has(key) && Date.now() - (stamp.get(key) || 0) < ms;
export const normUrl = (u) => (u ? u.replace(/\?$/, '') : u); // "/visitors?" and "/visitors" are the same page

// ---------------------------------------------------------------- persistence
function persistNow() {
  timer = null;
  if (!ns) return;
  try {
    const rows = [];
    store.forEach((v, k) => {
      let n; try { n = JSON.stringify(v).length; } catch { return; }
      if (n <= MAX_ENTRY) rows.push([k, stamp.get(k) || 0, v, n]);
    });
    rows.sort((a, b) => b[1] - a[1]); // newest first, so the oldest are the ones dropped
    const items = {}; let size = 0;
    for (const [k, t, v, n] of rows) { size += n; if (size > MAX_BYTES) break; items[k] = [t, v]; }
    localStorage.setItem(PREFIX + ns, JSON.stringify(items));
  } catch { /* storage full or blocked - the in-memory cache still works */ }
}
const schedulePersist = () => { if (ns && !timer) timer = setTimeout(persistNow, 600); };
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); persistNow(); } });

function hydrate() {
  try {
    const raw = localStorage.getItem(PREFIX + ns);
    if (!raw) return;
    const now = Date.now();
    Object.entries(JSON.parse(raw)).forEach(([k, [t, v]]) => {
      if (now - t < MAX_AGE) { store.set(k, v); stamp.set(k, t); stale.add(k); } // show now, re-check on first use
    });
  } catch { /* corrupt entry - start empty */ }
}

// Call when we know who is signed in (before the first screen renders).
export function setCacheUser(id) {
  const next = id ? String(id) : null;
  if (next === ns) return;
  if (timer) { clearTimeout(timer); persistNow(); }
  epoch += 1; ns = next;
  store.clear(); stamp.clear(); stale.clear(); inflight.clear(); seq.clear();
  if (ns) hydrate();
  notifyAll();
}
// Sign-out: forget everything, in memory and on disk.
export function clearCache() {
  epoch += 1; ns = null;
  clearTimeout(timer); timer = null;
  store.clear(); stamp.clear(); stale.clear(); inflight.clear(); seq.clear();
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  notifyAll();
}

// ---------------------------------------------------------------- core
function commit(key, v) {
  stamp.set(key, Date.now()); stale.delete(key);
  if (store.has(key) && sameJSON(store.get(key), v)) { schedulePersist(); return; } // unchanged: no re-render
  store.set(key, v); notify(key); schedulePersist();
}

function fetchKey(key, fn, fresh) {
  if (!fresh && inflight.has(key)) return inflight.get(key);
  const n = (seq.get(key) || 0) + 1; seq.set(key, n);
  const ep = epoch;
  const p = Promise.resolve().then(fn).then((v) => {
    if (ep === epoch && seq.get(key) === n) commit(key, v);
    return v;
  }).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

export const peek = (key) => store.get(key);
// write a value straight into the cache (e.g. the server returned the updated record)
export function setCached(key, v) {
  seq.set(key, (seq.get(key) || 0) + 1); // anything still in flight is now older than this
  store.set(key, v); stamp.set(key, Date.now()); stale.delete(key);
  notify(key); schedulePersist();
}
export const invalidate = (prefix = '') => { store.forEach((_, k) => k.startsWith(prefix) && stale.add(k)); };
// explicit re-fetch after the caller changed something: always goes to the server
export const load = (key, fn) => fetchKey(key, fn, true);
// warm a key in the background; skipped if we already have a recent copy
export const prefetch = (key, fn) => (isFresh(key, 30000) ? Promise.resolve(store.get(key)) : fetchKey(key, fn, false)).catch(() => {});
export const prefetchApi = (url) => { const u = normUrl(url); return prefetch(u, () => api.get(u)); };

onMutation((method, url) => {
  store.forEach((_, k) => stale.add(k));
  // the assistant changes data on the server: re-check whatever is on screen right now
  if (url.startsWith('/ai')) listeners.forEach((_, key) => { const f = fnFor.get(key); if (f) fetchKey(key, f, true).catch(() => {}); });
});

// ---------------------------------------------------------------- hooks
export function useData(key, fn, enabled = true, opts = {}) {
  const [, force] = useState(0);
  const lastRef = useRef(); // last data shown, for keepPrevious
  const [err, setErr] = useState(null);
  const fnRef = useRef(fn); fnRef.current = fn;
  const on = !!key && enabled;

  useEffect(() => (key ? listen(key, () => force((n) => n + 1)) : undefined), [key]);

  const run = useCallback((fresh) => fetchKey(key, () => fnRef.current(), fresh)
    .then((v) => { setErr((e) => (e && e.key === key ? null : e)); return v; })
    .catch((e) => {
      setErr({ key, msg: e?.message || 'Something went wrong' });
      // we are still showing the saved copy: say so once in a while instead of replacing the screen with an error
      if (store.has(key) && Date.now() - lastWarn > 15000) { lastWarn = Date.now(); toast("Couldn't refresh - showing saved data", true); }
    }), [key]);

  useEffect(() => {
    if (!on) return undefined;
    fnFor.set(key, () => fnRef.current());
    if (!isFresh(key)) run(false);
    // coming back to the tab / network: quietly re-check data that has gone a bit old
    const wake = () => { if (!document.hidden && !isFresh(key, 30000)) run(false); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    return () => { document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); };
  }, [key, on, run]);

  const refresh = useCallback(() => run(true), [run]);
  const cur = key ? store.get(key) : undefined;
  // A failed background refresh must not wipe a screen that already has data: only report the error when there is nothing to show.
  const error = err && err.key === key && cur === undefined ? err.msg : null;
  if (cur !== undefined) lastRef.current = cur;
  // keepPrevious: while a new key (another date / filter / search) loads, keep showing the old result instead of blanking the screen
  const data = cur !== undefined || !opts.keepPrevious ? cur : lastRef.current;
  return { data, error, refresh, loading: on && !store.has(key) && !error, placeholder: cur === undefined && data !== undefined };
}

// GET a URL through the cache. `set` replaces the cached value (use it with a mutation's response).
export function useApi(rawUrl, enabled = true, opts = {}) {
  const url = normUrl(rawUrl);
  const r = useData(url, () => api.get(url), enabled && !!url, opts);
  const set = useCallback((v) => { if (url) setCached(url, typeof v === 'function' ? v(store.get(url)) : v); }, [url]);
  return { ...r, set };
}
