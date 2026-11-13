import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://school-ai-erp.onrender.com').replace(/\/$/, '');
let token = null;
let onUnauthorized = () => {};
const mutSubs = new Set();
export const onMutation = (f) => { mutSubs.add(f); return () => mutSubs.delete(f); };
export const authHeader = () => (token ? { Authorization: `Bearer ${token}` } : {});
export const setUnauthorizedHandler = (f) => { onUnauthorized = f; };
export const loadToken = async () => { token = await AsyncStorage.getItem('token'); return token; };
export const setToken = async (t) => { token = t; if (t) await AsyncStorage.setItem('token', t); else await AsyncStorage.removeItem('token'); };

async function request(method, url, body) {
  const sentToken = token; // which session this request belongs to
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(`${API_URL}/api${url}`, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) }); }
  catch { throw new Error(`Cannot reach the server at ${API_URL}. Is it running, and is your phone on the same Wi-Fi?`); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // only sign out when the request carried the CURRENT session's token - a late 401 from a request sent before sign-in must not kick a fresh session out
    if (res.status === 401 && !url.startsWith('/auth/login') && sentToken && sentToken === token) onUnauthorized();
    // the phone app is newer than the server it talks to: say so instead of a bare "Not found"
    if (res.status === 404 && /^\/(homework|notifications|queries)/.test(url) && (data.error || 'Not found') === 'Not found') throw new Error('Your server does not have this feature yet. Ask your admin to deploy the latest server version, then try again.');
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  if (method !== 'GET' && !url.startsWith('/auth/login') && !url.startsWith('/audit/navigate')) mutSubs.forEach((f) => f(method, url));
  return data;
}
export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  patch: (u, b) => request('PATCH', u, b ?? {}),
  put: (u, b) => request('PUT', u, b ?? {}),
  del: (u) => request('DELETE', u),
};
export const withQs = (url, qs) => (qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url);
