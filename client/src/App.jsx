import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { clearCache, setCacheUser } from './cache.js';
import { Icon, Modal, Field, toast, initials, ROLE_LABEL, ErrorBoundary, NetBar, Splash } from './ui.jsx';
import { MODULE_UI } from './registry.js';
import AssistantChat from './AssistantChat.jsx';
import Customize from './Customize.jsx';
import { usePrefs, allTargets, effectiveShortcuts, orderedModules } from './prefs.js';

const parseHash = () => { const [m, v, a] = location.hash.replace(/^#\/?/, '').split('/'); return { m: m || '', v: v || '', a: a || '' }; };
// The signed-in profile is remembered on this device (tied to the current token), so the app can
// paint the real home screen immediately on reload and confirm it with the server in the background.
const ME_KEY = 'sp:me:v1';
// Safety net for a server older than this app: add what each role gets by default on the current server, so the new
// screens (Send notification, Homework) still show up. A screen on an old server then reports that the server needs updating.
const MIRROR = { student: ['view_my_homework'], staff: ['manage_homework'], school_admin: ['manage_homework', 'send_notification', 'send_school_notification'], super_admin: ['manage_homework', 'send_notification', 'send_school_notification'] };
const withDefaults = (m) => (m ? { ...m, features: [...new Set([...(m.features || []), ...(MIRROR[m.role] || [])])] } : m);
const tokTag = () => (getToken() || '').slice(-24);
const readMe = () => {
  try { const c = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); return c && getToken() && c.tok === tokTag() ? c.me : null; } catch { return null; }
};
const saveMe = (me) => { try { localStorage.setItem(ME_KEY, JSON.stringify({ tok: tokTag(), me })); } catch { /* ignore */ } };
const forgetMe = () => { try { localStorage.removeItem(ME_KEY); } catch { /* ignore */ } };
// prefetch everything a module's landing screen needs (module-level data + its first visible tab)
const visibleViews = (me, key) => (MODULE_UI[key]?.views || []).filter((v) => (!v.need || v.need.some((f) => me.features.includes(f))) && (!v.roles || v.roles.includes(me.role)));
const warmView = (me, v) => { try { v?.prefetch?.(me); } catch { /* prefetch is best-effort */ } };
const warmModule = (me, key) => { try { MODULE_UI[key]?.prefetch?.(me); } catch { /* best-effort */ } warmView(me, visibleViews(me, key)[0]); };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function Login({ onDone }) {
  const [f, setF] = useState({ login_id: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post('/auth/login', f); setToken(r.token); onDone(r.me); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="center auth"><form className="card login" onSubmit={go}>
      <div className="brand"><div className="logo"><Icon name="school" /></div><div><b>School Portal</b><small>Sign in to continue</small></div></div>
      <Field label="User ID"><input autoFocus autoComplete="username" value={f.login_id} onChange={(e) => setF({ ...f, login_id: e.target.value })} /></Field>
      <Field label="Password"><input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      {err && <div className="err">{err}</div>}
      <button className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Signing in...' : 'Sign in'}</button>
    </form></div>
  );
}

function ChangePassword({ onClose }) {
  const [f, setF] = useState({ current_password: '', new_password: '' }); const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try { await api.post('/auth/change-password', f); toast('Password changed'); onClose(); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title="Change password" onClose={onClose}><form className="form" onSubmit={save}>
      <div className="full"><Field label="Current password"><input type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field></div>
      <div className="full"><Field label="New password" hint="At least 6 characters"><input type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field></div>
      {err && <div className="err full">{err}</div>}
      <button className="btn primary full" style={{ justifyContent: 'center' }}>Save password</button>
    </form></Modal>
  );
}

export default function App() {
  const [me, setMeRaw] = useState(() => { const m = readMe(); if (m) setCacheUser(m.user_id); return m; });
  const [booting, setBooting] = useState(() => !!getToken() && !readMe());
  const contentRef = useRef(null);
  // one place that changes the signed-in user: keeps the data cache and the saved profile in step
  const setMe = useCallback((m0) => {
    const m = withDefaults(m0);
    if (m) { setCacheUser(m.user_id); saveMe(m); }
    setMeRaw((cur) => (m && cur && JSON.stringify(cur) === JSON.stringify(m) ? cur : m)); // unchanged: keep identity, no re-render
  }, []);
  const [route, setRoute] = useState(parseHash());
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  const [more, setMore] = useState(false);
  const [cz, setCz] = useState(false);
  const [prefs, updatePrefs] = usePrefs(me || {});

  const logout = useCallback(() => { setToken(null); forgetMe(); clearCache(); setMe(null); location.hash = ''; }, [setMe]);
  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);
  // pressing "Sign out" tells the server first, so the sign-out shows in the audit log
  const signOut = useCallback(async () => { try { await api.post('/auth/logout'); } catch { /* sign out anyway */ } logout(); }, [logout]);
  useEffect(() => {
    if (!getToken()) return;
    // 401 is handled by the global handler (signs out). Any other failure (offline, server waking up)
    // keeps the remembered profile so the app still opens; with nothing remembered it falls to sign-in.
    api.get('/auth/me').then(setMe).catch(() => { if (!readMe()) setToken(null); }).finally(() => setBooting(false));
  }, [setMe]);
  useEffect(() => { const h = () => setRoute(parseHash()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);

  // every module / tab the person opens is reported to the audit log (one entry for entering the module, one for the tab)
  const lastNav = useRef({ m: null, v: null });
  useEffect(() => {
    const none = () => { lastNav.current = { m: null, v: null }; };
    if (!me) return none();
    const mod = me.modules.find((m) => m.key === route.m && MODULE_UI[m.key]);
    if (!mod) return none();
    const vs = MODULE_UI[mod.key].views.filter((v) => (!v.need || v.need.some((f) => me.features.includes(f))) && (!v.roles || v.roles.includes(me.role)));
    const v = vs.find((x) => x.key === route.v) || vs[0];
    const prev = lastNav.current;
    if (prev.m === mod.key && prev.v === v?.key) return;
    lastNav.current = { m: mod.key, v: v?.key };
    // sent a moment later so the page's own data requests get the server first
    setTimeout(() => { // never cancelled: every module/tab opened must still reach the audit log
      const first = prev.m !== mod.key ? api.post('/audit/navigate', { module: mod.key }).catch(() => {}) : Promise.resolve();
      if (v) first.then(() => api.post('/audit/navigate', { module: mod.key, view: v.key, view_label: v.label }).catch(() => {}));
    }, 400);
  }, [me, route.m, route.v]);

  // Warm the data behind every module the person can open, one at a time while the browser is idle,
  // so opening one shows content straight away. Skipped on data-saver / very slow connections.
  useEffect(() => {
    if (!me || navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '')) return undefined;
    const jobs = me.modules.filter((m) => MODULE_UI[m.key]).map((m) => () => warmModule(me, m.key));
    let i = 0; let t;
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 60));
    const step = () => { if (i < jobs.length) { jobs[i++](); t = setTimeout(() => idle(step), 120); } };
    t = setTimeout(() => idle(step), 250);
    return () => clearTimeout(t);
  }, [me]);

  // every new screen starts at the top
  useEffect(() => { contentRef.current?.scrollTo?.(0, 0); }, [route.m, route.v]);

  const toggleTheme = () => {
    const d = !dark; setDark(d);
    document.documentElement.dataset.theme = d ? 'dark' : 'light';
    localStorage.theme = d ? 'dark' : 'light';
  };
  const go = (path) => { setMenu(false); setMore(false); location.hash = path; };

  if (booting) return <Splash />;
  if (!me) return <><NetBar /><Login onDone={setMe} /></>;

  const mods = me.modules.filter((m) => MODULE_UI[m.key]);
  const active = mods.find((m) => m.key === route.m);
  const ui = active && MODULE_UI[active.key];
  const views = ui ? ui.views.filter((v) => (!v.need || v.need.some((f) => me.features.includes(f))) && (!v.roles || v.roles.includes(me.role))) : [];
  const view = views.find((v) => v.key === route.v) || views[0];
  const View = view?.component;
  const name = me.profile.full_name || me.login_id;
  const title = active ? ui.label : `${greeting()}, ${name.split(' ')[0]}`;
  const sub = active ? (views.length > 1 ? (view?.title || view?.label) : (me.school?.name || '')) : (me.school?.name || 'Platform');

  // customisation: which cards show, in what order, and the pinned shortcuts
  const targets = allTargets(me, MODULE_UI);
  const byId = Object.fromEntries(targets.map((t) => [t.id, t]));
  const pinned = effectiveShortcuts(prefs, targets);
  const ordered = orderedModules(mods, prefs);
  const shown = ordered.filter((m) => !prefs.hidden.includes(m.key));
  const here = active && view ? `${active.key}/${view.key}` : null;
  const isPinned = here && pinned.includes(here);
  const togglePin = () => updatePrefs((p) => {
    const cur = effectiveShortcuts(p, targets);
    return { ...p, shortcuts: cur.includes(here) ? cur.filter((x) => x !== here) : [...cur, here] };
  });
  const runShortcut = (id) => go(id);
  // bottom bar: Home + the first three modules (the open one always gets a slot) + More
  const dock = [...shown.slice(0, 3)];
  if (active && !dock.some((m) => m.key === active.key)) dock[2] = active;

  const Actions = () => (<>
    <button className="nav" onClick={toggleTheme}><Icon name={dark ? 'sun' : 'moon'} />{dark ? 'Light mode' : 'Dark mode'}</button>
    <button className="nav" onClick={() => { setMenu(false); setMore(false); setCz(true); }}><Icon name="sliders" />Customize home</button>
    <button className="nav" onClick={() => { setMenu(false); setMore(false); setPw(true); }}><Icon name="key" />Change password</button>
    <button className="nav" onClick={signOut}><Icon name="logout" />Sign out</button>
  </>);

  const ModTile = ({ m }) => { const u = MODULE_UI[m.key]; return (
    <button className="mod" style={{ '--c': u.color }} onClick={() => go(m.key)} onPointerEnter={() => warmModule(me, m.key)} onTouchStart={() => warmModule(me, m.key)}>
      <span className="ic"><Icon name={u.icon} size={22} /></span>
      <span className="mt"><b>{u.label}</b></span>
      <Icon name="chevron" size={16} />
    </button>); };

  return (
    <div className="shell">
      <NetBar />
      <aside className="side">
        <div className="brand"><div className="logo"><Icon name="school" /></div><div><b>School Portal</b><small>{me.school?.name || 'Platform'}</small></div></div>
        {active ? (<>
          <button className="nav" onClick={() => go('')}><Icon name="back" />All modules</button>
          <div className="nav-label">{ui.label}</div>
          {views.map((v) => <button key={v.key} className={`nav ${view?.key === v.key ? 'on' : ''}`} onClick={() => go(`${active.key}/${v.key}`)} onPointerEnter={() => warmView(me, v)}>{v.label}</button>)}
        </>) : (<>
          <button className="nav on"><Icon name="home" />Home</button>
          <div className="nav-label">Modules</div>
          {ordered.map((m) => <button key={m.key} className="nav" onClick={() => go(m.key)}><Icon name={MODULE_UI[m.key].icon} />{MODULE_UI[m.key].label}</button>)}
        </>)}
        <div className="grow" /><Actions />
      </aside>

      <div className="main">
        <header className="top">
          <div className="ttl">
            {active && <button className="icon-btn backbtn" onClick={() => go('')} aria-label="Back to home"><Icon name="back" size={22} /></button>}
            {active && <span className="ic sm" style={{ '--c': ui.color }}><Icon name={ui.icon} size={18} /></span>}
            <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
          </div>
          <div className="who">
            {active && view && <button className={`icon-btn pinbtn ${isPinned ? 'on' : ''}`} onClick={togglePin} aria-pressed={!!isPinned} title={isPinned ? 'Remove from home shortcuts' : 'Pin to home shortcuts'}><Icon name="pin" size={19} /></button>}
            <div className="meta"><b>{name}</b><small>{ROLE_LABEL[me.role]}</small></div>
            <button className="avatar" onClick={() => setMenu(!menu)} aria-label="Account menu">{initials(name)}</button>
            {menu && <><div className="scrim" onClick={() => setMenu(false)} /><div className="menu"><Actions /></div></>}
          </div>
        </header>

        {active && <nav className="tabs">{views.map((v) => <button key={v.key} className={`pill ${view?.key === v.key ? 'on' : ''}`} onClick={() => go(`${active.key}/${v.key}`)} onPointerEnter={() => warmView(me, v)} onTouchStart={() => warmView(me, v)}>{v.label}</button>)}</nav>}

        <main className="content" ref={contentRef}>
          <div className="page" key={active && view ? `${active.key}/${view.key}` : active ? active.key : 'home'}>
          {active ? (View && <ErrorBoundary key={`${active.key}/${view.key}`}><View me={me} action={route.a} go={(v) => go(`${active.key}/${v}`)} /></ErrorBoundary>) : (
            mods.length === 0 ? <div className="empty">No modules are turned on for your account yet. Ask your school admin.</div> :
            <div className="home">
              <section>
                <div className="sec-h"><h2>Shortcuts</h2><button className="linkbtn" onClick={() => setCz(true)}><Icon name="sliders" size={15} />Customize</button></div>
                <div className="sc-grid">
                  {pinned.map((id) => { const t = byId[id]; return (
                    <button key={id} className="sc" style={{ '--c': t.color }} onClick={() => runShortcut(id)}>
                      <span className="ic"><Icon name={t.icon} size={22} /></span><b>{t.label}</b>
                    </button>); })}
                  <button className="sc add" onClick={() => setCz(true)}><span className="ic"><Icon name="plus" size={22} /></span><b>{pinned.length ? 'Add' : 'Add shortcuts'}</b></button>
                </div>
              </section>
              <section>
                <div className="sec-h"><h2>Modules</h2><span className="muted small">{shown.length} of {mods.length}</span></div>
                {shown.length === 0
                  ? <div className="empty">All cards are hidden. <button className="linkbtn" onClick={() => setCz(true)}>Choose what to show</button></div>
                  : <div className="grid">{shown.map((m) => <ModTile key={m.key} m={m} />)}</div>}
              </section>
            </div>
          )}
          </div>
        </main>
      </div>

      <nav className="bottom" aria-label="Main">
        <button className={!active ? 'on' : ''} onClick={() => go('')}><Icon name="home" /><span>Home</span></button>
        {dock.map((m) => <button key={m.key} className={active?.key === m.key ? 'on' : ''} onClick={() => go(m.key)}><Icon name={MODULE_UI[m.key].icon} /><span>{MODULE_UI[m.key].label.split(' ')[0]}</span></button>)}
        <button className={more ? 'on' : ''} onClick={() => setMore(true)}><Icon name="grid" /><span>More</span></button>
      </nav>

      {more && (
        <div className="overlay bottom-sheet" onMouseDown={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className="bsheet" role="dialog" aria-label="All modules">
            <div className="grab" />
            <div className="bs-grid">{ordered.map((m) => { const u = MODULE_UI[m.key]; return (
              <button key={m.key} style={{ '--c': u.color }} onClick={() => go(m.key)}><span className="ic"><Icon name={u.icon} size={22} /></span><span>{u.label}</span></button>); })}</div>
            <div className="bs-actions"><Actions /></div>
          </div>
        </div>
      )}

      {pw && <ChangePassword onClose={() => setPw(false)} />}
      {cz && <Customize me={me} prefs={prefs} update={updatePrefs} onClose={() => setCz(false)} />}
      {me.features.includes('use_assistant') && <AssistantChat me={me} />}
    </div>
  );
}
