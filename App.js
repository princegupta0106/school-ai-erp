import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Modal, BackHandler, AppState, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, loadToken, setToken, setUnauthorizedHandler } from './src/api';
import { C, SH, live, initials, ROLE_LABEL, greeting, applyTheme, resolveTheme, loadThemeMode, saveThemeMode } from './src/theme';
import { Icon } from './src/icons';
import { MODULE_UI, viewsFor, allTargets, effectiveShortcuts, prefetchUrls, visibleModules, dockModules, withClientDefaults } from './src/modules';
import { Press, Pane, ScrollFade } from './src/ui';
import { initCache, clearCache, prefetch } from './src/cache';
import { usePrefs } from './src/prefs';
import { useApi } from './src/useApi';
import { setupPush, registerPush, unregisterPush, alertNew, enableLocalAlerts } from './src/push';
import Notifications from './src/screens/Notifications';
import { startBackgroundChecks, stopBackgroundChecks, askBackgroundPermission } from './src/background';
import Login from './src/screens/Login';
import Customize from './src/screens/Customize';
import ChangePassword from './src/screens/ChangePassword';
import Assistant from './src/screens/Assistant';
import Permissions from './src/screens/Permissions';
import Dashboard from './src/screens/Dashboard';

const tint = (c) => `${c}22`;

function Tile({ m, onPress }) {
  const u = MODULE_UI[m.key];
  return (
    <Press onPress={onPress} wrap={{ width: '48.5%', marginBottom: 10 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: C.line, ...SH }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: tint(u.color), alignItems: 'center', justifyContent: 'center' }}><Icon name={u.icon} color={u.color} size={20} /></View>
      <Text style={{ fontWeight: '700', color: C.ink, flex: 1, fontSize: 14 }} numberOfLines={2}>{u.label}</Text>
    </Press>
  );
}

function Home({ me, prefs, update, mods, pinned, byId, open, openCustomize, recent, unread, openInbox }) {
  const shown = mods.filter((m) => !prefs.hidden.includes(m.key));
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
      <Dashboard me={me} go={open} prefs={prefs} update={update} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Text style={sec}>Shortcuts</Text>
        <Pressable onPress={openCustomize} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="sliders" size={15} color={C.brand} /><Text style={{ color: C.brand, fontWeight: '600', fontSize: 13 }}>Customize</Text></Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 }}>
        {pinned.map((id) => { const t = byId[id]; return (
          <Press key={id} onPress={() => open(id)} wrap={{ width: '23%', flexGrow: 1 }} style={{ alignItems: 'center', backgroundColor: C.card, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 4, borderWidth: 1, borderColor: C.line, ...SH }}>
            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: tint(t.color), alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}><Icon name={t.icon} color={t.color} size={22} /></View>
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.ink, textAlign: 'center' }} numberOfLines={2}>{t.label}</Text>
          </Press>); })}
        <Pressable onPress={openCustomize} style={{ width: '23%', flexGrow: 1, alignItems: 'center', paddingVertical: 12 }}>
          <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}><Icon name="plus" color={C.brand} size={22} /></View>
          <Text style={{ fontSize: 12, fontWeight: '600', color: C.mute }}>Add</Text>
        </Pressable>
      </View>
      {recent.length > 0 && (<>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}><Text style={sec}>Latest updates{unread ? ` · ${unread} new` : ''}</Text><Pressable onPress={openInbox}><Text style={{ color: C.brand, fontWeight: '600', fontSize: 13 }}>See all</Text></Pressable></View>
        <View style={{ marginBottom: 20 }}>{recent.map((n) => (
          <Pressable key={n.id} onPress={openInbox} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: n.read_at ? C.card : C.soft, borderRadius: 12, borderWidth: 1, borderColor: n.read_at ? C.line : C.brand, padding: 11, marginBottom: 8 }}>
            <Icon name="bell" size={16} color={C.brand} />
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: n.read_at ? '600' : '800', fontSize: 13 }} numberOfLines={1}>{n.title}</Text>{!!n.body && <Text style={{ color: C.mute, fontSize: 12 }} numberOfLines={1}>{n.body}</Text>}</View>
          </Pressable>))}</View>
      </>)}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}><Text style={sec}>Modules</Text><Text style={{ color: C.mute, fontSize: 12 }}>{shown.length} of {mods.length}</Text></View>
      {mods.length === 0 ? <Text style={{ color: C.mute, textAlign: 'center', paddingVertical: 30 }}>No modules are turned on for your account yet. Ask your school admin.</Text>
        : <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>{shown.map((m) => <Tile key={m.key} m={m} onPress={() => open(m.key)} />)}</View>}
    </ScrollView>
  );
}
const sec = live(() => ({ fontSize: 15, fontWeight: '700', color: C.ink }));

export default function App() {
  const [me, setMe] = useState(null); const [booting, setBooting] = useState(true);
  const [themeMode, setThemeMode] = useState('light'); const [, repaint] = useState(0);
  // choose Light / Dark: recolour everything, remember the choice
  const chooseTheme = useCallback((m) => { applyTheme(m); setThemeMode(m); saveThemeMode(m); repaint((n) => n + 1); }, []);
  const logout = useCallback(async () => { await unregisterPush(); await stopBackgroundChecks(); await setToken(null); await clearCache(); setMe(null); }, []);
  const signedIn = useCallback(async (m) => { await initCache(m.user_id); setMe(withClientDefaults(m)); }, []);
  useEffect(() => {
    setUnauthorizedHandler(logout);
    (async () => { const m = await loadThemeMode(); applyTheme(m); setThemeMode(m); if (await loadToken()) { try { await signedIn(await api.get('/auth/me')); } catch { await setToken(null); } } setBooting(false); })();
  }, [logout, signedIn]);
  if (booting) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator size="large" color={C.brand} /></View>;
  return <SafeAreaProvider><StatusBar style={resolveTheme(themeMode) === 'dark' ? 'light' : 'dark'} />{me ? <Shell me={me} logout={logout} themeMode={themeMode} chooseTheme={chooseTheme} /> : <Login onDone={signedIn} />}</SafeAreaProvider>;
}

function Shell({ me, logout, themeMode, chooseTheme }) {
  const [route, setRoute] = useState({ m: null, v: null, a: null, n: 0 });
  const [visited, setVisited] = useState([]); // tabs opened in this module stay mounted, so switching is instant and keeps their state
  const [more, setMore] = useState(false); const [cz, setCz] = useState(false); const [pw, setPw] = useState(false); const [perm, setPerm] = useState(false);
  const { height: winH } = useWindowDimensions();
  const [prefs, updatePrefs] = usePrefs(me);
  const [inbox, setInbox] = useState(false); const [ai, setAi] = useState(false);
  const { data: nd, reload: reloadNotes } = useApi('/notifications?limit=30');
  const unread = nd?.unread || 0;

  const mods = visibleModules(me);
  const targets = allTargets(me); const byId = Object.fromEntries(targets.map((t) => [t.id, t]));
  const pinned = effectiveShortcuts(prefs, targets);
  const active = mods.find((m) => m.key === route.m);
  const ui = active && MODULE_UI[active.key];
  const views = active ? viewsFor(me, active.key) : [];
  const view = views.find((v) => v.key === route.v) || views[0];
  
  // every module / tab opened is recorded in the audit log (same as the web app)
  const lastNav = useRef({ m: null, v: null });
  useEffect(() => {
    if (!active) { lastNav.current = { m: null, v: null }; return; }
    const prev = lastNav.current; const vk = view?.key || null;
    lastNav.current = { m: active.key, v: vk };
    if (prev.m === active.key && prev.v === vk) return;
    setTimeout(() => { // sent a moment later so the screen's own data requests go first; never cancelled
      const first = prev.m !== active.key ? api.post('/audit/navigate', { module: active.key }).catch(() => {}) : Promise.resolve();
      if (view) first.then(() => api.post('/audit/navigate', { module: active.key, view: view.key, view_label: view.label }).catch(() => {}));
    }, 400);
  }, [active?.key, view?.key]); // eslint-disable-line

  // 'payroll' | 'payroll/my' | 'payroll/my/apply' -> route
  const go = (path) => {
    setMore(false);
    const [m, v, a] = (path || '').split('/');
    const vs = m ? viewsFor(me, m) : [];
    const vk = v || vs[0]?.key || null;
    setRoute((r) => ({ m: m || null, v: v || null, a: a || null, n: r.n + 1 }));
    setVisited((cur) => (m ? [...(m === route.m ? cur : []), ...(vk && !(m === route.m && cur.includes(vk)) ? [vk] : [])] : []));
  };
  // notifications: refresh the bell every 45s and whenever the app comes back to the front; switch on phone push; open the right screen when one is tapped
  const goRef = useRef(go); goRef.current = go;
  useEffect(() => {
    const t = setInterval(() => reloadNotes(), 45000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') reloadNotes(); });
    let off = () => {};
    setupPush({
      onReceive: () => reloadNotes(),
      onTap: (d) => { reloadNotes(); if (d?.module && MODULE_UI[d.module]) goRef.current(`${d.module}${d.view ? `/${d.view}` : ''}`); else setInbox(true); },
    }).then((o) => { off = o; });
    registerPush().then((r) => { if (!r.ok) return enableLocalAlerts().then((ok) => ok && startBackgroundChecks().then(askBackgroundPermission)); startBackgroundChecks(); }).catch(() => {});
    return () => { clearInterval(t); sub.remove(); off(); };
  }, []); // eslint-disable-line
  useEffect(() => { if (nd?.items) alertNew(nd.items); }, [nd]);
  const openNote = (n) => { setInbox(false); if (n.module && MODULE_UI[n.module] && viewsFor(me, n.module).length) go(`${n.module}${n.view ? `/${n.view}` : ''}`); };
  // warm every live screen's data one by one in the background, so first opens are instant
  useEffect(() => {
    const urls = [];
    for (const m of mods) for (const v of viewsFor(me, m.key)) urls.push(...prefetchUrls(me, m.key, v.key));
    let i = 0; let t;
    const step = () => { if (i < urls.length) { prefetch(urls[i++]); t = setTimeout(step, 120); } };
    t = setTimeout(step, 300);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line
  useEffect(() => { // Android back button goes Home first
    const h = BackHandler.addEventListener('hardwareBackPress', () => { if (route.m) { go(''); return true; } return false; });
    return () => h.remove();
  }, [route.m]); // eslint-disable-line

  const name = me.profile?.full_name || me.login_id;
  const here = active && view ? `${active.key}/${view.key}` : null;
  const isPinned = here && pinned.includes(here);
  const togglePin = () => updatePrefs((p) => { const cur = effectiveShortcuts(p, targets); return { ...p, shortcuts: cur.includes(here) ? cur.filter((x) => x !== here) : [...cur, here] }; });
  const shown = mods.filter((m) => !prefs.hidden.includes(m.key));
  const dock = dockModules(me, shown);
  if (active && !dock.some((m) => m.key === active.key)) dock[2] = active;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>
        {active && <Pressable onPress={() => go('')} hitSlop={10}><Icon name="back" size={24} color={C.ink} /></Pressable>}
        {active && <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: tint(ui.color), alignItems: 'center', justifyContent: 'center' }}><Icon name={ui.icon} color={ui.color} size={18} /></View>}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: -0.4 }} numberOfLines={1}>{active ? ui.label : `${greeting()}, ${name.split(' ')[0]}`}</Text>
          <Text style={{ fontSize: 12, color: C.mute }} numberOfLines={1}>{active ? (views.length > 1 ? view?.label : me.school?.name || '') : (me.school?.name || 'Platform')}</Text>
        </View>
        {active && view && <Pressable onPress={togglePin} hitSlop={10}><Icon name="pin" size={20} color={isPinned ? C.brand : C.mute} /></Pressable>}
        <Pressable onPress={() => setInbox(true)} hitSlop={6} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', ...SH }}>
          <Icon name="bell" size={19} color={C.brand} />
          {unread > 0 && <View style={{ position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.bad, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{unread > 99 ? '99+' : unread}</Text></View>}
        </Pressable>
        <Pressable onPress={() => setMore(true)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.info, fontWeight: '700' }}>{initials(name)}</Text></Pressable>
      </View>

      {active && views.length > 1 && (
        <View style={{ borderBottomWidth: 1, borderColor: C.line }}>
          <ScrollFade horizontal fade={C.bg} size={26} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 8, paddingBottom: 10 }}>
            {views.map((v) => { const on = view?.key === v.key; return (
              <Pressable key={v.key} onPressIn={() => prefetchUrls(me, active.key, v.key).forEach(prefetch)} onPress={() => go(`${active.key}/${v.key}`)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? C.soft : C.card, borderWidth: 1, borderColor: on ? C.brand : C.line }}>
                <Text style={{ color: on ? C.brand : C.mute, fontWeight: '600', fontSize: 13 }}>{v.label}</Text>
              </Pressable>); })}
          </ScrollFade>
        </View>
      )}

      <View style={{ flex: 1 }}>
        {!active ? <Pane key="home" from="y"><Home me={me} prefs={prefs} update={updatePrefs} mods={mods} pinned={pinned} byId={byId} open={go} openCustomize={() => setCz(true)} recent={(nd?.items || []).slice(0, 3)} unread={unread} openInbox={() => setInbox(true)} /></Pane>
          : (
            <Pane key={active.key} from="x">
              {views.length === 0 && <Text style={{ padding: 24, color: C.mute, textAlign: 'center' }}>You don't have access to anything in this module.</Text>}
              {views.filter((v) => v.key === view?.key || visited.includes(v.key)).map((v) => {
                const Screen = v.component; const on = v.key === view?.key;
                return <Pane key={v.key} active={on} from="y"><Screen me={me} active={on} action={on ? route.a : null} nonce={route.n} title={v.label} go={(vk) => go(`${active.key}/${vk}`)} /></Pane>;
              })}
            </Pane>
          )}
      </View>

      <View style={{ flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderColor: C.line, paddingHorizontal: 6, shadowColor: '#14202A', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 8 }}>
        <Pressable onPress={() => go('')} style={navItem}><NavIcon name="home" on={!active} /><Text style={[navTxt, !active && { color: C.brand }]}>Home</Text></Pressable>
        {dock.map((m) => { const on = active?.key === m.key; return (
          <Pressable key={m.key} onPress={() => go(m.key)} style={navItem}><NavIcon name={MODULE_UI[m.key].icon} on={on} /><Text style={[navTxt, on && { color: C.brand }]} numberOfLines={1}>{MODULE_UI[m.key].label.split(' ')[0]}</Text></Pressable>); })}
        <Pressable onPress={() => setMore(true)} style={navItem}><NavIcon name="grid" on={more} /><Text style={[navTxt, more && { color: C.brand }]}>More</Text></Pressable>
      </View>

      <Modal visible={more} transparent animationType="slide" onRequestClose={() => setMore(false)}>
        <Pressable style={{ flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' }} onPress={() => setMore(false)}>
          <Pressable style={{ backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 30, maxHeight: winH * 0.94 }} onPress={() => {}}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 12 }} />
            <View style={{ marginBottom: 12 }}><Text style={{ fontWeight: '700', color: C.ink, fontSize: 16 }}>{name}</Text><Text style={{ color: C.mute }}>{ROLE_LABEL[me.role]}{me.school ? ` · ${me.school.name}` : ''}</Text></View>
            {/* shadow/fade at the top and bottom edge shows when more modules are hidden and can be scrolled to */}
            <ScrollFade fade={C.bg} size={34} style={{ maxHeight: Math.max(160, Math.min(380, winH * 0.32)) }} showsVerticalScrollIndicator={false}><View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 14 }}>{mods.map((m) => <Tile key={m.key} m={m} onPress={() => go(m.key)} />)}</View></ScrollFade>
            <View style={{ paddingVertical: 10 }}>
              <Text style={{ color: C.mute, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>APPEARANCE</Text>
              <View style={{ flexDirection: 'row', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 3 }}>
                {[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([k, l, ic]) => { const on = themeMode === k; return (
                  <Pressable key={k} onPress={() => chooseTheme(k)} accessibilityLabel={`${l} theme`} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9, backgroundColor: on ? C.soft : 'transparent', borderWidth: on ? 1 : 0, borderColor: C.brand }}>
                    <Icon name={ic} size={16} color={on ? C.brand : C.mute} /><Text style={{ color: on ? C.brand : C.mute, fontWeight: on ? '800' : '600', fontSize: 13 }}>{l}</Text>
                  </Pressable>); })}
              </View>
            </View>
            {[['sliders', 'Customize home', () => { setMore(false); setCz(true); }], ['shield', 'App permissions', () => { setMore(false); setPerm(true); }], ['key', 'Change password', () => { setMore(false); setPw(true); }], ['logout', 'Sign out', logout]].map(([ic, l, fn]) => (
              <Pressable key={l} onPress={fn} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}><Icon name={ic} size={20} color={C.mute} /><Text style={{ color: C.ink, fontWeight: '500' }}>{l}</Text></Pressable>))}
          </Pressable>
        </Pressable>
      </Modal>
      {me.features.includes('use_assistant') && !ai && (
        <Pressable onPress={() => setAi(true)} accessibilityLabel="Open AI assistant" style={{ position: 'absolute', right: 14, bottom: 76, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.brand, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12, elevation: 6, shadowColor: '#0E5A52', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}>
          <Icon name="sparkle" size={18} color="#fff" /><Text style={{ color: '#fff', fontWeight: '800' }}>Ask AI</Text>
        </Pressable>
      )}
      {ai && <Assistant me={me} onClose={() => setAi(false)} />}
      {inbox && <Notifications data={nd} reload={reloadNotes} onClose={() => setInbox(false)} onOpen={openNote} />}
      {cz && <Customize me={me} prefs={prefs} update={updatePrefs} onClose={() => setCz(false)} />}
      {pw && <ChangePassword onClose={() => setPw(false)} />}
      {perm && <Permissions onClose={() => setPerm(false)} />}
    </SafeAreaView>
  );
}
const navItem = { flex: 1, alignItems: 'center', paddingVertical: 9, gap: 2 };
const navTxt = live(() => ({ fontSize: 11, fontWeight: '600', color: C.mute }));
const NavIcon = ({ name, on }) => <View style={{ width: 54, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.soft : 'transparent' }}><Icon name={name} size={22} color={on ? C.brand : C.mute} /></View>;
