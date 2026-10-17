import React from 'react';
import { Icon, Modal } from './ui.jsx';
import { MODULE_UI } from './registry.js';
import { dashItems } from './Dashboard.jsx';
import { allTargets, effectiveShortcuts, orderedModules } from './prefs.js';

const Switch = ({ on, onChange, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>
);

const move = (arr, i, d) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };

// Lets the person decide what Home shows: which module cards, in what order, and which one-tap shortcuts.
export default function Customize({ me, prefs, update, onClose }) {
  const targets = allTargets(me, MODULE_UI);
  const byId = Object.fromEntries(targets.map((t) => [t.id, t]));
  const pinned = effectiveShortcuts(prefs, targets);
  const mods = orderedModules(me.modules.filter((m) => MODULE_UI[m.key]), prefs);

  const setShortcuts = (list) => update((p) => ({ ...p, shortcuts: list }));
  const setOrder = (list) => update((p) => ({ ...p, order: list.map((m) => m.key) }));
  const toggleModule = (k, show) => update((p) => ({ ...p, hidden: show ? p.hidden.filter((x) => x !== k) : [...new Set([...p.hidden, k])] }));
  const groups = [...new Set(targets.map((t) => t.moduleLabel))].map((label) => ({ label, items: targets.filter((t) => t.moduleLabel === label && !pinned.includes(t.id)) })).filter((g) => g.items.length);

  const di = dashItems(me);
  const dpos = (id) => { const i = (prefs.dashOrder || []).indexOf(id); return i < 0 ? 1e6 : i; };
  const dgroup = (g) => di.filter((x) => x.group === g).sort((a, b) => dpos(a.id) - dpos(b.id));
  const toggleDash = (id, show) => update((p) => ({ ...p, dashHidden: show ? (p.dashHidden || []).filter((x) => x !== id) : [...new Set([...(p.dashHidden || []), id])] }));
  const moveDash = (g, i, d) => { const list = dgroup(g); const next = move(list, i, d).map((x) => x.id); update((p) => ({ ...p, dashOrder: [...next, ...(p.dashOrder || []).filter((x) => !next.includes(x))] })); };
  const dashRows = (g, title, sub) => dgroup(g).length > 0 && (
    <section className="cz">
      <div className="cz-h"><h3>{title}</h3><span>{sub}</span></div>
      <div className="cz-list">
        {dgroup(g).map((x, i, arr) => { const on = !(prefs.dashHidden || []).includes(x.id); return (
          <div key={x.id} className={`cz-row ${on ? '' : 'off'}`}>
            <div className="cz-t"><b>{x.label}</b></div>
            <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => moveDash(g, i, -1)}><Icon name="up" size={18} /></button>
            <button className="icon-btn" aria-label="Move down" disabled={i === arr.length - 1} onClick={() => moveDash(g, i, 1)}><Icon name="down" size={18} /></button>
            <Switch on={on} onChange={(v) => toggleDash(x.id, v)} label={`Show ${x.label}`} />
          </div>); })}
      </div>
    </section>
  );

  return (
    <Modal title="Customize home" onClose={onClose}>
      <section className="cz">
        <div className="cz-h"><h3>Shortcuts</h3><span>Shown at the top of Home, one tap away</span></div>
        {pinned.length === 0 && <div className="cz-empty">No shortcuts yet. Add some below.</div>}
        <div className="cz-list">
          {pinned.map((id, i) => { const t = byId[id]; return (
            <div key={id} className="cz-row">
              <span className="cz-ic" style={{ '--c': t.color }}><Icon name={t.icon} size={18} /></span>
              <div className="cz-t"><b>{t.label}</b><small>{t.moduleLabel}</small></div>
              <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => setShortcuts(move(pinned, i, -1))}><Icon name="up" size={18} /></button>
              <button className="icon-btn" aria-label="Move down" disabled={i === pinned.length - 1} onClick={() => setShortcuts(move(pinned, i, 1))}><Icon name="down" size={18} /></button>
              <button className="icon-btn" aria-label={`Remove ${t.label}`} onClick={() => setShortcuts(pinned.filter((x) => x !== id))}><Icon name="x" size={18} /></button>
            </div>); })}
        </div>
        {groups.length > 0 && <div className="cz-add">
          <div className="cz-sub">Add a shortcut</div>
          {groups.map((g) => (
            <div key={g.label} className="cz-group"><small>{g.label}</small>
              <div className="chips">{g.items.map((t) => <button key={t.id} className="addchip" onClick={() => setShortcuts([...pinned, t.id])}><Icon name="plus" size={14} />{t.label}</button>)}</div>
            </div>))}
        </div>}
      </section>

      {dashRows('stat', 'Dashboard numbers', 'The small colourful number cards at the top')}
      {dashRows('card', 'Dashboard cards', 'Charts and lists on Home. Remove what you don\'t need')}

      <section className="cz">
        <div className="cz-h"><h3>Home cards</h3><span>Choose which modules to show and their order</span></div>
        <div className="cz-list">
          {mods.map((m, i) => { const u = MODULE_UI[m.key]; const on = !prefs.hidden.includes(m.key); return (
            <div key={m.key} className={`cz-row ${on ? '' : 'off'}`}>
              <span className="cz-ic" style={{ '--c': u.color }}><Icon name={u.icon} size={18} /></span>
              <div className="cz-t"><b>{u.label}</b></div>
              <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => setOrder(move(mods, i, -1))}><Icon name="up" size={18} /></button>
              <button className="icon-btn" aria-label="Move down" disabled={i === mods.length - 1} onClick={() => setOrder(move(mods, i, 1))}><Icon name="down" size={18} /></button>
              <Switch on={on} onChange={(v) => toggleModule(m.key, v)} label={`Show ${u.label}`} />
            </div>); })}
        </div>
      </section>

      <div className="row sp">
        <button className="btn" onClick={() => update(() => ({ hidden: [], order: [], shortcuts: null, dashHidden: [], dashOrder: [] }))}>Reset to default</button>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
