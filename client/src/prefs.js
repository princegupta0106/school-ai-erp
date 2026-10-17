// Per-user home-page preferences, saved in the database (users.ui_prefs) with a browser copy as backup.
//   hidden:    module keys the user chose NOT to show on Home
//   order:     module keys in the order the user wants them
//   shortcuts: pinned items, e.g. 'payroll/my' (a tab) or 'payroll/my/apply' (a direct action)
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { toast } from './ui.jsx';

const key = (me) => `portal.prefs.${me.user_id || me.login_id}`;

// Things that can be pinned as a one-tap shortcut on top of every tab.
// "apply" opens the Apply for leave form directly.
export const ACTIONS = [
  { id: 'payroll/my/apply', label: 'Apply for leave', icon: 'plus', need: ['my_leave'], base: 'payroll/my' },
];

export const defaultPrefs = () => ({ hidden: [], order: [], shortcuts: null, dashHidden: [], dashOrder: [] }); // null = use smart defaults

const clean = (p) => ({
  hidden: Array.isArray(p?.hidden) ? p.hidden : [],
  order: Array.isArray(p?.order) ? p.order : [],
  shortcuts: Array.isArray(p?.shortcuts) ? p.shortcuts : null,
  dashHidden: Array.isArray(p?.dashHidden) ? p.dashHidden : [], // dashboard cards the user removed
  dashOrder: Array.isArray(p?.dashOrder) ? p.dashOrder : [],
});
export function loadLocal(me) {
  try { const raw = localStorage.getItem(key(me)); return raw ? clean(JSON.parse(raw)) : null; } catch { return null; }
}
const saveLocal = (me, p) => { try { localStorage.setItem(key(me), JSON.stringify(p)); } catch { /* storage full or blocked */ } };

// Source of truth is the database (me.ui_prefs). The browser copy only makes the first paint instant
// and covers the case where the server could not be reached.
export function usePrefs(me) {
  const id = me.user_id || me.login_id;
  const initial = () => (me.ui_prefs ? clean(me.ui_prefs) : (id && loadLocal(me)) || defaultPrefs());
  const [prefs, setPrefs] = useState(initial);
  const timer = useRef(null);
  const latest = useRef(prefs);

  useEffect(() => { // signed in (or switched user): take the saved layout
    const p = initial(); latest.current = p; setPrefs(p);
    // first time on this account: if the person had a layout saved only in this browser, move it to the database
    if (id && me.ui_prefs == null && loadLocal(me)) api.put('/auth/prefs', loadLocal(me)).catch(() => {});
  }, [id]); // eslint-disable-line

  const flush = useCallback(() => {
    clearTimeout(timer.current); timer.current = null;
    return api.put('/auth/prefs', latest.current).catch(() => toast('Could not save your home settings. Will retry on next change.', true));
  }, []);
  useEffect(() => () => { if (timer.current) flush(); }, [flush]); // save anything pending when the app closes/unmounts

  const update = useCallback((fn) => setPrefs((cur) => {
    const next = clean(fn(cur));
    latest.current = next; saveLocal(me, next);
    clearTimeout(timer.current); timer.current = setTimeout(flush, 700); // one save after a burst of taps
    return next;
  }), [id, flush]); // eslint-disable-line
  return [prefs, update];
}

// every tab the user may open, as { id, label, module, moduleLabel, icon }
export function allTargets(me, MODULE_UI) {
  const out = [];
  for (const m of me.modules) {
    const ui = MODULE_UI[m.key]; if (!ui) continue;
    const views = ui.views.filter((v) => (!v.need || v.need.some((f) => me.features.includes(f))) && (!v.roles || v.roles.includes(me.role)));
    for (const v of views) {
      out.push({ id: `${m.key}/${v.key}`, label: v.label, module: m.key, moduleLabel: ui.label, icon: ui.icon, color: ui.color });
      for (const a of ACTIONS) if (a.base === `${m.key}/${v.key}` && a.need.some((f) => me.features.includes(f))) {
        out.push({ id: a.id, label: a.label, module: m.key, moduleLabel: ui.label, icon: a.icon, color: ui.color, action: true });
      }
    }
  }
  return out;
}

// what to show before the user has customised anything
const SMART_DEFAULTS = ['payroll/my/apply', 'attendance/take', 'communication/board', 'fees/students', 'academics/tests'];
export function effectiveShortcuts(prefs, targets) {
  const ids = new Set(targets.map((t) => t.id));
  const list = prefs.shortcuts ?? SMART_DEFAULTS.filter((id) => ids.has(id)).slice(0, 4);
  return list.filter((id) => ids.has(id));
}

// module list in the user's chosen order (new modules appear at the end)
export function orderedModules(mods, prefs) {
  const pos = (k) => { const i = prefs.order.indexOf(k); return i < 0 ? 1e6 : i; };
  return [...mods].sort((a, b) => pos(a.key) - pos(b.key));
}
