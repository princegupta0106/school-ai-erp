// Stale-while-revalidate cache for GET requests: screens show the last copy instantly and refresh quietly.
// Kept in memory and mirrored to AsyncStorage so even a fresh app launch opens with content.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, onMutation } from './api';

const mem = new Map();      // url -> { data, t }
const inflight = new Map(); // url -> promise
const subs = new Map();     // url -> Set(fn)
const FRESH_MS = 15000;
let storeKey = null; let saveTimer = null; let refetchTimer = null;

export const peek = (url) => mem.get(url)?.data;
export const isFresh = (url) => { const e = mem.get(url); return !!e && Date.now() - e.t < FRESH_MS; };

export function subscribe(url, fn) {
  if (!subs.has(url)) subs.set(url, new Set());
  subs.get(url).add(fn);
  return () => { subs.get(url)?.delete(fn); };
}

function persist() {
  if (!storeKey) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {}; for (const [k, v] of mem) out[k] = v;
    AsyncStorage.setItem(storeKey, JSON.stringify(out)).catch(() => {});
  }, 1200);
}

export function fetchUrl(url) {
  if (inflight.has(url)) return inflight.get(url);
  const p = api.get(url)
    .then((data) => { mem.set(url, { data, t: Date.now() }); subs.get(url)?.forEach((f) => f(data)); persist(); return data; })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
export const prefetch = (url) => { if (!isFresh(url)) fetchUrl(url).catch(() => {}); };

export async function initCache(userId) {
  storeKey = `cache.${userId}`;
  try { const raw = await AsyncStorage.getItem(storeKey); if (raw) { const o = JSON.parse(raw); for (const k of Object.keys(o)) mem.set(k, { data: o[k].data, t: 0 }); } } catch { /* ignore */ }
}
export async function clearCache() {
  mem.clear(); clearTimeout(saveTimer);
  if (storeKey) await AsyncStorage.removeItem(storeKey).catch(() => {});
  storeKey = null;
}

// after any change (approve, apply, save...) quietly refresh every screen that is currently open
onMutation(() => {
  for (const e of mem.values()) e.t = 0;
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(() => { for (const [url, set] of subs) if (set.size) fetchUrl(url).catch(() => {}); }, 400);
});
