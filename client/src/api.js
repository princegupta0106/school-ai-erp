let onUnauthorized = () => {};

// --- network activity (drives the thin progress bar) and mutation events (drive cache invalidation) ---
let active = 0;
const netSubs = new Set();
const bump = (n) => { active += n; netSubs.forEach((f) => f(active)); };
export const onNetActivity = (f) => { netSubs.add(f); f(active); return () => netSubs.delete(f); };
const mutSubs = new Set();
export const onMutation = (f) => { mutSubs.add(f); return () => mutSubs.delete(f); };
const QUIET = ['/audit/navigate']; // background pings never light up the progress bar
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export const getToken = () => localStorage.getItem('token');
export const setToken = (t) => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token'));

async function request(method, url, body) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const quiet = QUIET.some((p) => url.startsWith(p));
  if (!quiet) bump(1);
  try {
    const res = await fetch(`/api${url}`, { method, headers, body: payload });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && !url.startsWith('/auth/login')) onUnauthorized();
      if (res.status === 404 && /^\/(homework|notifications)/.test(url) && (data.error || 'Not found') === 'Not found') throw new Error('The server is older than this app and does not have this feature yet. Deploy the latest server folder, then try again.');
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    if (method !== 'GET' && !quiet && !url.startsWith('/auth/login')) mutSubs.forEach((f) => f(method, url));
    return data;
  } finally { if (!quiet) bump(-1); }
}
// POST that answers with newline-delimited JSON events; onEvent is called for each one as it arrives
async function stream(url, body, onEvent) {
  const t = getToken();
  const res = await fetch(`/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    if (res.status === 401) onUnauthorized();
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `Request failed (${res.status})`); err.status = res.status; throw err;
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  const line = (l) => { if (!l.trim()) return; try { onEvent(JSON.parse(l)); } catch { /* ignore a broken line */ } };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  line(buf);
}
// downloads a file (e.g. a PDF receipt) with the sign-in token and hands it to the browser
async function download(url, fallbackName) {
  const t = getToken();
  const res = await fetch(`/api${url}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Download failed (${res.status})`);
  }
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}
export const api = {
  download,
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  patch: (u, b) => request('PATCH', u, b ?? {}),
  put: (u, b) => request('PUT', u, b ?? {}),
  del: (u) => request('DELETE', u),
  stream,
};
