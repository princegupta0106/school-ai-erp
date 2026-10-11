import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { clearCache } from './cache.js';
import { Icon, Modal, Field, toast, initials, ROLE_LABEL, ErrorBoundary } from './ui.jsx';
import { MODULE_UI } from './registry.js';
import AssistantChat from './AssistantChat.jsx';

const parseHash = () => { const [m, v] = location.hash.replace(/^#\/?/, '').split('/'); return { m: m || '', v: v || '' }; };

function Login({ onDone }) {
  const [f, setF] = useState({ login_id: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post('/auth/login', f); setToken(r.token); onDone(r.me); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="center"><form className="card login" onSubmit={go}>
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
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(!!getToken());
  const [route, setRoute] = useState(parseHash());
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);

  const logout = useCallback(() => { setToken(null); clearCache(); setMe(null); location.hash = ''; }, []);
  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);
  // pressing "Sign out" tells the server first, so the sign-out shows in the audit log
  const signOut = useCallback(async () => { try { await api.post('/auth/logout'); } catch { /* sign out anyway */ } logout(); }, [logout]);
  useEffect(() => {
    if (!getToken()) return;
    api.get('/auth/me').then(setMe).catch(() => setToken(null)).finally(() => setBooting(false));
  }, []);
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
    const first = prev.m !== mod.key ? api.post('/audit/navigate', { module: mod.key }).catch(() => {}) : Promise.resolve();
    if (v) first.then(() => api.post('/audit/navigate', { module: mod.key, view: v.key, view_label: v.label }).catch(() => {}));
  }, [me, route.m, route.v]);

  // warm every module the user can open, so opening one is instant
  useEffect(() => { if (me) me.modules.forEach((m) => MODULE_UI[m.key]?.prefetch?.(me)); }, [me]);

  const toggleTheme = () => {
    const d = !dark; setDark(d);
    document.documentElement.dataset.theme = d ? 'dark' : '';
    localStorage.theme = d ? 'dark' : 'light';
  };
  const go = (path) => { setMenu(false); location.hash = path; };

  if (booting) return <div className="center"><span className="empty">Loading...</span></div>;
  if (!me) return <Login onDone={setMe} />;

  const mods = me.modules.filter((m) => MODULE_UI[m.key]);
  const active = mods.find((m) => m.key === route.m);
  const ui = active && MODULE_UI[active.key];
  const views = ui ? ui.views.filter((v) => (!v.need || v.need.some((f) => me.features.includes(f))) && (!v.roles || v.roles.includes(me.role))) : [];
  const view = views.find((v) => v.key === route.v) || views[0];
  const title = active ? (view?.title || ui.label) : `Hello, ${me.profile.full_name || me.login_id}`;
  const sub = active ? ui.label : 'Choose a module';
  const View = view?.component;

  const Actions = () => (<>
    <button className="nav" onClick={toggleTheme}><Icon name={dark ? 'sun' : 'moon'} />{dark ? 'Light mode' : 'Dark mode'}</button>
    <button className="nav" onClick={() => { setMenu(false); setPw(true); }}><Icon name="key" />Change password</button>
    <button className="nav" onClick={signOut}><Icon name="logout" />Sign out</button>
  </>);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><div className="logo"><Icon name="school" /></div><div><b>School Portal</b><small>{me.school?.name || 'Platform'}</small></div></div>
        {active ? (<>
          <button className="nav" onClick={() => go('')}><Icon name="back" />All modules</button>
          <div className="nav-label">{ui.label}</div>
          {views.map((v) => <button key={v.key} className={`nav ${view?.key === v.key ? 'on' : ''}`} onClick={() => go(`${active.key}/${v.key}`)}>{v.label}</button>)}
        </>) : (<>
          <button className="nav on"><Icon name="home" />Home</button>
          <div className="nav-label">Modules</div>
          {mods.map((m) => <button key={m.key} className="nav" onClick={() => go(m.key)}><Icon name={MODULE_UI[m.key].icon} />{MODULE_UI[m.key].label}</button>)}
        </>)}
        <div className="grow" /><Actions />
      </aside>

      <div className="main">
        <header className="top">
          <div><h1>{title}</h1><p>{sub}</p></div>
          <div className="who">
            <div className="meta"><b>{me.profile.full_name || me.login_id}</b><small>{ROLE_LABEL[me.role]}</small></div>
            <button className="avatar" onClick={() => setMenu(!menu)} aria-label="Account menu">{initials(me.profile.full_name || me.login_id)}</button>
            {menu && <div className="menu"><Actions /></div>}
          </div>
        </header>

        {active && <nav className="tabs">{views.map((v) => <button key={v.key} className={`pill ${view?.key === v.key ? 'on' : ''}`} onClick={() => go(`${active.key}/${v.key}`)}>{v.label}</button>)}</nav>}

        <main className="content">
          {active ? (View && <ErrorBoundary key={`${active.key}/${view.key}`}><View me={me} go={(v) => go(`${active.key}/${v}`)} /></ErrorBoundary>) : (
            mods.length === 0 ? <div className="empty">No modules are turned on for your account yet. Ask your school admin.</div> :
            <div className="grid">{mods.map((m) => { const u = MODULE_UI[m.key]; return (
              <button key={m.key} className="mod" onClick={() => go(m.key)} onPointerEnter={() => u.prefetch?.(me)}>
                <div className="ic" style={{ background: u.color }}><Icon name={u.icon} size={24} /></div>
                <b>{u.label}</b><span>{u.desc}</span><em>{m.features.length} feature{m.features.length > 1 ? 's' : ''}</em>
              </button>); })}</div>
          )}
        </main>
      </div>

      <nav className="bottom">
        <button className={!active ? 'on' : ''} onClick={() => go('')}><Icon name="home" />Home</button>
        {mods.map((m) => <button key={m.key} className={active?.key === m.key ? 'on' : ''} onClick={() => go(m.key)}><Icon name={MODULE_UI[m.key].icon} />{MODULE_UI[m.key].label}</button>)}
      </nav>
      {pw && <ChangePassword onClose={() => setPw(false)} />}
      {me.features.includes('use_assistant') && <AssistantChat me={me} />}
    </div>
  );
}
