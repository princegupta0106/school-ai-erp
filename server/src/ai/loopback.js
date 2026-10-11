// ---------------------------------------------------------------------------------------------
// How the AI "does things on the website":
//   every tool calls the portal's OWN API (the same /api routes the web pages use), carrying the
//   SIGNED-IN USER'S token. So the backend decides - exactly like for a button click in the UI:
//     * authenticate()      -> who is this, is the account still active
//     * requireFeature()    -> is this person allowed to do it
//     * school scoping      -> only their own school's data
//     * audit middleware    -> logged (tagged "via AI assistant")
//   The AI never gets more power than the person typing to it, and there is no second copy of the
//   business rules to keep in sync. A tool is just "a friendlier, named way to call an endpoint".
// ---------------------------------------------------------------------------------------------
import { cfg } from '../config.js';
import { httpError } from '../db.js';

export function makeApi(token) {
  return async function api(method, path, body) {
    const res = await fetch(`http://127.0.0.1:${cfg.port}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-via': 'ai-assistant', // shows up in the audit log
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(res.status, data.error || `Request failed (${res.status})`);
    return data;
  };
}
