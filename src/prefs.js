import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

// Same shape as the web app ({hidden, order, shortcuts}) and saved to the same place (/auth/prefs), so layouts sync.
const clean = (p) => ({ hidden: Array.isArray(p?.hidden) ? p.hidden : [], order: Array.isArray(p?.order) ? p.order : [], shortcuts: Array.isArray(p?.shortcuts) ? p.shortcuts : null });
export function usePrefs(me) {
  const id = me.user_id || me.login_id;
  const [prefs, setPrefs] = useState(clean(me.ui_prefs));
  const timer = useRef(null); const latest = useRef(prefs);
  useEffect(() => {
    const p = clean(me.ui_prefs); latest.current = p; setPrefs(p);
    if (me.ui_prefs == null) AsyncStorage.getItem(`prefs.${id}`).then((raw) => { if (raw) { const l = clean(JSON.parse(raw)); latest.current = l; setPrefs(l); } }).catch(() => {});
  }, [id]); // eslint-disable-line
  const update = useCallback((fn) => setPrefs((cur) => {
    const next = clean(fn(cur)); latest.current = next;
    AsyncStorage.setItem(`prefs.${id}`, JSON.stringify(next)).catch(() => {});
    clearTimeout(timer.current); timer.current = setTimeout(() => api.put('/auth/prefs', latest.current).catch(() => {}), 700);
    return next;
  }), [id]);
  return [prefs, update];
}
