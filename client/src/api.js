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
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    if (method !== 'GET' && !quiet && !url.startsWith('/auth/login')) mutSubs.forEach((f) => f(method, url));
    return data;
  } finally { if (!quiet) bump(-1); }
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
};
