// Inventory: overview, items & stock, set-up (stores / categories / vendors), purchase orders + GRN, issuing with receipts, reports.
// Talks to /api/inventory. Layout is mobile-first: cards on phones, tables from tablet width up.
import React, { useMemo, useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApi } from '../cache.js';
import { Icon, Empty, Field, Modal, Badge, toast, Loading, ask, SearchInput } from '../ui.jsx';
import { scoped } from './AttendanceModule.jsx';

const sq = (me, sid) => (me.role === 'super_admin' ? { school_id: sid } : {});
const qs = (o) => { const p = new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))); const s = p.toString(); return s ? `?${s}` : ''; };
const can = (me, ...f) => f.some((x) => me.features.includes(x));
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmt = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const useDebounced = (v, ms = 250) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; };
const STOCK = { in: ['ok', 'In stock'], low: ['warn', 'Low stock'], out: ['off', 'Out of stock'] };
const PO = { pending: ['warn', 'Pending'], approved: ['info', 'Approved'], received: ['info', 'Part received'], closed: ['ok', 'Received'], cancelled: ['mute', 'Cancelled'] };
const Pill = ({ map, k }) => <Badge tone={map[k]?.[0]}>{map[k]?.[1] || k}</Badge>;

function download(name, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([`\ufeff${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function printHtml(title, html) {
  const w = window.open('', '_blank', 'width=820,height=900'); if (!w) { toast('Allow pop-ups to print', true); return; }
  w.document.write(`<!doctype html><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 14px;font-weight:500;color:#555}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ccc;padding:7px 9px;text-align:left}th{background:#f3f3f3}.m{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin:6px 0}.sig{display:flex;justify-content:space-between;margin-top:56px}.sig div{border-top:1px solid #333;padding-top:6px;min-width:150px;text-align:center}</style>${html}<script>onload=()=>setTimeout(()=>print(),250)</script>`);
  w.document.close();
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function printReceipt(i, school) {
  printHtml(i.receipt_no, `<h1>${esc(school || 'School')} - Inventory issue receipt</h1><h2>${esc(i.receipt_no)}</h2>
    <div class="m"><span><b>Issued to:</b> ${esc(i.issued_to_name)}${i.issued_to_code ? ` (${esc(i.issued_to_code)})` : ''}</span><span><b>Date:</b> ${esc(fmt(i.issue_date))}</span></div>
    <table><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit</th></tr>${i.lines.map((l, n) => `<tr><td>${n + 1}</td><td>${esc(l.name)}</td><td>${qty(l.qty)}</td><td>${esc(l.unit)}</td></tr>`).join('')}</table>
    ${i.notes ? `<p><b>Notes:</b> ${esc(i.notes)}</p>` : ''}<div class="sig"><div>Issued by</div><div>Received by</div></div>`);
}

/* --------------------------------------------------------------- small shared pieces */
const Stat = ({ n, label, tone, to, go }) => <button type="button" className={`inv-stat ${tone || ''}`} onClick={to ? () => go(to) : undefined} disabled={!to}><b>{n}</b><span>{label}</span></button>;
const SearchBox = SearchInput;
const useMeta = (me, sid) => useApi(`/inventory/meta${qs(sq(me, sid))}`, true, { keepPrevious: true });

// pick items for an order / an issue: a list of rows { item_id, qty, rate? }
function LinePicker({ items, lines, setLines, withRate, stockCap }) {
  const set = (i, patch) => setLines(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const pick = (i, id) => { const it = items.find((x) => x.id === id); set(i, { item_id: id, ...(withRate && it ? { rate: it.rate || '' } : {}) }); };
  return (
    <div className="inv-lines">
      {lines.map((l, i) => {
        const it = items.find((x) => x.id === l.item_id);
        return (
          <div key={i} className="inv-line">
            <select value={l.item_id} onChange={(e) => pick(i, e.target.value)} aria-label="Item"><option value="">Choose item</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}{stockCap ? ` (${qty(x.qty)} left)` : ''}</option>)}</select>
            <input type="number" min="0" step="any" inputMode="decimal" placeholder="Qty" aria-label="Quantity" value={l.qty} max={stockCap && it ? it.qty : undefined} onChange={(e) => set(i, { qty: e.target.value })} />
            {withRate && <input type="number" min="0" step="any" inputMode="decimal" placeholder="Rate ₹" aria-label="Rate" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />}
            <button type="button" className="icon-btn" aria-label="Remove row" onClick={() => setLines(lines.length > 1 ? lines.filter((_, n) => n !== i) : [{ item_id: '', qty: '', rate: '' }])}><Icon name="x" size={18} /></button>
          </div>
        );
      })}
      <button type="button" className="btn" onClick={() => setLines([...lines, { item_id: '', qty: '', rate: '' }])}><Icon name="plus" size={16} /> Add another item</button>
    </div>
  );
}

/* =============================================================== OVERVIEW */
export const InventoryHome = scoped(function InventoryHome({ me, sid, go }) {
  const { data: d, error } = useApi(`/inventory/overview${qs(sq(me, sid))}`, true, { keepPrevious: true });
  if (error) return <div className="err">{error}</div>;
  if (!d) return <Loading />;
  const s = d.stats; const max = Math.max(1, ...d.by_category.map((c) => c.qty));
  const canGo = (view, ...f) => (can(me, ...f) ? view : null);
  return (
    <div className="stack inv" style={{ maxWidth: 1100 }}>
      <div className="inv-stats">
        <Stat n={s.items} label="Total items" go={go} to={canGo('items', 'view_inventory', 'manage_inventory')} />
        <Stat n={s.categories} label="Categories" go={go} to={canGo('setup', 'manage_inventory')} />
        <Stat n={s.vendors} label="Vendors" go={go} to={canGo('setup', 'manage_inventory')} />
        <Stat n={s.low + s.out} label="Low / out of stock" tone={s.low + s.out ? 'warn' : ''} go={go} to={canGo('items', 'view_inventory', 'manage_inventory')} />
      </div>
      <div className="inv-quick">
        {can(me, 'manage_inventory') && <button className="btn" onClick={() => go('items')}><Icon name="plus" size={16} /> Add item</button>}
        {can(me, 'manage_purchase_orders') && <button className="btn" onClick={() => go('orders')}><Icon name="doc" size={16} /> Purchase order</button>}
        {can(me, 'issue_inventory') && <button className="btn primary" onClick={() => go('issue')}><Icon name="send" size={16} /> Issue items</button>}
        {can(me, 'view_inventory') && <button className="btn" onClick={() => go('reports')}><Icon name="download" size={16} /> Reports</button>}
      </div>
      <div className="inv-grid">
        <div className="card"><h3 className="inv-h">Stock summary</h3>
          <div className="inv-mini"><div><b className="ok">{s.in_stock}</b><span>In stock</span></div><div><b className="warn">{s.low}</b><span>Low</span></div><div><b className="bad">{s.out}</b><span>Out</span></div><div><b>{money(s.value)}</b><span>Value</span></div></div>
          <h3 className="inv-h" style={{ marginTop: 16 }}>Stock by category</h3>
          {d.by_category.length === 0 ? <div className="muted">No items yet.</div> : d.by_category.map((c) => <div key={c.id} className="inv-bar"><span>{c.name}</span><i><u style={{ width: `${Math.max(4, (c.qty / max) * 100)}%` }} /></i><b>{qty(c.qty)}</b></div>)}
        </div>
        <div className="card"><h3 className="inv-h">Needs attention</h3>
          {d.low_items.length === 0 ? <div className="muted">Nothing is running low.</div> : d.low_items.map((i) => <div key={i.id} className="inv-row"><div><b>{i.name}</b><small>Reorder at {qty(i.reorder_level)}</small></div><span className={`inv-qty ${i.status}`}>{qty(i.qty)} {i.unit}</span></div>)}
        </div>
        <div className="card"><h3 className="inv-h">Purchase orders</h3>
          <div className="inv-mini"><div><b>{d.orders.total}</b><span>Orders</span></div><div><b className="warn">{d.orders.pending}</b><span>Pending</span></div><div><b>{d.orders.approved}</b><span>Approved</span></div><div><b className="ok">{d.orders.received}</b><span>Received</span></div></div>
          {d.orders.recent.map((o) => <div key={o.id} className="inv-row"><div><b>{o.po_no}</b><small>{o.vendor || 'No vendor'} · {fmt(o.order_date)}</small></div><div style={{ textAlign: 'right' }}><b>{money(o.total)}</b><div><Pill map={PO} k={o.status} /></div></div></div>)}
        </div>
        <div className="card"><h3 className="inv-h">Recent issues</h3>
          {d.recent_issues.length === 0 ? <div className="muted">Nothing issued yet.</div> : d.recent_issues.map((i) => <div key={i.id} className="inv-row"><div><b>{i.issued_to_name}</b><small>{i.receipt_no} · {fmt(i.issue_date)}</small></div><span className="muted">{i.items} item{i.items === 1 ? '' : 's'}</span></div>)}
        </div>
      </div>
    </div>
  );
});

/* =============================================================== ITEMS */
function ItemForm({ me, sid, meta, item, onClose, onSaved }) {
  const [f, setF] = useState(item ? { ...item, qty: item.qty } : { name: '', store_id: '', category_id: '', item_type: 'consumable', unit: 'Nos', qty: '', reorder_level: '', rate: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const cats = meta.categories.filter((c) => !f.store_id || c.store_id === f.store_id || !c.store_id);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const b = { ...f, ...sq(me, sid) };
      if (item) { b.qty = Number(f.qty) !== item.qty ? f.qty : undefined; await api.patch(`/inventory/items/${item.id}${qs(sq(me, sid))}`, b); } else await api.post('/inventory/items', b);
      toast(item ? 'Item updated' : 'Item added'); onSaved(); onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={item ? 'Edit item' : 'Add item'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="full"><Field label="Item name" req><input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
        <Field label="Store"><select value={f.store_id || ''} onChange={(e) => setF({ ...f, store_id: e.target.value, category_id: '' })}><option value="">No store</option>{meta.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Category"><select value={f.category_id || ''} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">No category</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Item type"><select value={f.item_type} onChange={(e) => setF({ ...f, item_type: e.target.value })}><option value="consumable">Consumable (used up)</option><option value="asset">Asset (returnable)</option></select></Field>
        <Field label="Unit"><input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="Nos, box, kg..." /></Field>
        <Field label={item ? 'Stock in hand' : 'Opening stock'} hint={item ? 'Change only to correct a count' : ''}><input type="number" min="0" step="any" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Reorder level" hint="Shown as low stock at or below this"><input type="number" min="0" step="any" inputMode="decimal" value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: e.target.value })} /></Field>
        <Field label="Rate (₹)"><input type="number" min="0" step="any" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
        {err && <div className="err full">{err}</div>}
        <button className="btn primary full" style={{ justifyContent: 'center' }} disabled={busy || !f.name.trim()}>{busy ? 'Saving...' : 'Save item'}</button>
      </form>
    </Modal>
  );
}

function BulkAdd({ me, sid, meta, onClose, onSaved }) {
  const [text, setText] = useState(''); const [store, setStore] = useState(''); const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const rows = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, q, unit, level, rate] = l.split(/[,\t]/).map((x) => x.trim()); return { name, qty: q || 0, unit: unit || 'Nos', reorder_level: level || 0, rate: rate || 0, store_id: store, category_id: cat }; });
  const save = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post('/inventory/items/bulk', { items: rows, ...sq(me, sid) }); toast(`${r.added} items added`); onSaved(); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add many items" onClose={onClose}>
      <div className="stack" style={{ maxWidth: 'none' }}>
        <div className="form"><Field label="Store"><select value={store} onChange={(e) => { setStore(e.target.value); setCat(''); }}><option value="">No store</option>{meta.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Category"><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">No category</option>{meta.categories.filter((c) => !store || c.store_id === store || !c.store_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
        <Field label="One item per line" hint="name, stock, unit, reorder level, rate  (only the name is needed; you can paste from Excel)">
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Notebook, 250, Nos, 50, 40\nBall pen, 120, Nos, 30, 10\nA4 paper, 40, ream, 50, 280'} /></Field>
        {err && <div className="err">{err}</div>}
        <button className="btn primary big" style={{ justifyContent: 'center' }} disabled={busy || !rows.length} onClick={save}>{busy ? 'Saving...' : `Add ${rows.length} item${rows.length === 1 ? '' : 's'}`}</button>
      </div>
    </Modal>
  );
}

export const Items = scoped(function Items({ me, sid }) {
  const { data: meta, error, refresh } = useMeta(me, sid);
  const [q, setQ] = useState(''); const [store, setStore] = useState(''); const [cat, setCat] = useState(''); const [st, setSt] = useState(''); const [form, setForm] = useState(null); const [bulk, setBulk] = useState(false);
  const manage = can(me, 'manage_inventory');
  const rows = useMemo(() => (meta?.items || []).filter((i) => (!q || i.name.toLowerCase().includes(q.toLowerCase())) && (!store || i.store_id === store) && (!cat || i.category_id === cat) && (!st || i.status === st)), [meta, q, store, cat, st]);
  if (error && !meta) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  const nm = (list, id) => list.find((x) => x.id === id)?.name || '-';
  const del = async (i) => { if (!(await ask(`Delete ${i.name}?`))) return; try { await api.del(`/inventory/items/${i.id}${qs(sq(me, sid))}`); toast('Item deleted'); refresh(); } catch (x) { toast(x.message, true); } };
  const count = (k) => meta.items.filter((i) => i.status === k).length;
  return (
    <div className="stack inv" style={{ maxWidth: 1100 }}>
      <div className="inv-stats">
        <Stat n={count('in')} label="In stock" /><Stat n={count('low')} label="Low stock" tone="warn" /><Stat n={count('out')} label="Out of stock" tone="bad" /><Stat n={meta.items.length} label="Total items" />
      </div>
      <div className="card ds-toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search items..." />
        <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="Store"><option value="">All stores</option>{meta.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{meta.categories.filter((c) => !store || c.store_id === store).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select>
        {manage && <div className="row"><button className="btn primary" onClick={() => setForm({})}><Icon name="plus" size={16} /> Add item</button><button className="btn" onClick={() => setBulk(true)}>Add many</button></div>}
      </div>
      {rows.length === 0 ? <Empty>{meta.items.length ? 'No item matches.' : manage ? 'No items yet. Add stores and categories in Set-up, then add your first item.' : 'No items yet.'}</Empty> : (
        <>
          <div className="card inv-table" style={{ padding: 0 }}>
            <table><thead><tr><th>Item</th><th>Category</th><th>Store</th><th className="r">Stock</th><th className="r">Reorder</th><th>Status</th>{manage && <th />}</tr></thead>
              <tbody>{rows.map((i) => <tr key={i.id}><td><b>{i.name}</b>{i.item_type === 'asset' && <small className="muted"> · asset</small>}</td><td>{nm(meta.categories, i.category_id)}</td><td>{nm(meta.stores, i.store_id)}</td><td className="r"><b>{qty(i.qty)}</b> {i.unit}</td><td className="r">{qty(i.reorder_level)}</td><td><Pill map={STOCK} k={i.status} /></td>
                {manage && <td className="r"><button className="icon-btn" aria-label="Edit" onClick={() => setForm(i)}><Icon name="edit" size={17} /></button><button className="icon-btn" aria-label="Delete" onClick={() => del(i)}><Icon name="trash" size={17} /></button></td>}</tr>)}</tbody></table>
          </div>
          <div className="inv-cards">{rows.map((i) => (
            <div key={i.id} className="card inv-card">
              <div className="row sp"><b>{i.name}</b><Pill map={STOCK} k={i.status} /></div>
              <div className="muted">{nm(meta.categories, i.category_id)} · {nm(meta.stores, i.store_id)}</div>
              <div className="row sp"><span><b className="inv-big">{qty(i.qty)}</b> {i.unit} <small className="muted">(reorder at {qty(i.reorder_level)})</small></span>
                {manage && <span><button className="icon-btn" aria-label="Edit" onClick={() => setForm(i)}><Icon name="edit" size={18} /></button><button className="icon-btn" aria-label="Delete" onClick={() => del(i)}><Icon name="trash" size={18} /></button></span>}</div>
            </div>))}</div>
        </>)}
      {form && <ItemForm me={me} sid={sid} meta={meta} item={form.id ? form : null} onClose={() => setForm(null)} onSaved={refresh} />}
      {bulk && <BulkAdd me={me} sid={sid} meta={meta} onClose={() => setBulk(false)} onSaved={refresh} />}
    </div>
  );
});

/* =============================================================== SET-UP: stores / categories / vendors */
function ListEditor({ me, sid, title, hint, path, rows, extra, fields, onChanged, render }) {
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { if (f.id) await api.patch(`/inventory/${path}/${f.id}${qs(sq(me, sid))}`, f); else await api.post(`/inventory/${path}`, { ...f, ...sq(me, sid) }); toast('Saved'); setF(null); onChanged(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const del = async (r) => { if (!(await ask(`Delete ${r.name}?`))) return; try { await api.del(`/inventory/${path}/${r.id}${qs(sq(me, sid))}`); toast('Deleted'); onChanged(); } catch (x) { toast(x.message, true); } };
  return (
    <div className="card">
      <div className="card-head"><div><h3>{title}</h3><small>{hint}</small></div><button className="btn sm primary" onClick={() => { setErr(''); setF({ name: '' }); }}><Icon name="plus" size={14} />Add</button></div>
      {rows.length === 0 ? <div className="muted" style={{ padding: '14px 0' }}>None yet.</div> : rows.map((r) => (
        <div key={r.id} className="inv-row"><div style={{ minWidth: 0 }}><b>{r.name}</b><small>{render ? render(r) : ''}</small></div>
          <span><button className="icon-btn" aria-label="Edit" onClick={() => { setErr(''); setF({ ...r }); }}><Icon name="edit" size={17} /></button><button className="icon-btn" aria-label="Delete" onClick={() => del(r)}><Icon name="trash" size={17} /></button></span></div>))}
      {f && <Modal title={`${f.id ? 'Edit' : 'Add'} ${title.toLowerCase().replace(/s$/, '')}`} onClose={() => setF(null)}>
        <form className="form" onSubmit={save}>
          <div className="full"><Field label="Name" req><input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
          {extra?.(f, setF)}
          {fields?.map(([k, label, full]) => <div key={k} className={full ? 'full' : ''}><Field label={label}><input value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field></div>)}
          {err && <div className="err full">{err}</div>}
          <button className="btn primary full" style={{ justifyContent: 'center' }} disabled={busy || !f.name.trim()}>{busy ? 'Saving...' : 'Save'}</button>
        </form></Modal>}
    </div>
  );
}
export const Setup = scoped(function Setup({ me, sid }) {
  const { data: m, error, refresh } = useMeta(me, sid);
  if (error && !m) return <div className="err">{error}</div>;
  if (!m) return <Loading />;
  const p = { me, sid, onChanged: refresh };
  return (
    <div className="stack inv" style={{ maxWidth: 1100 }}>
      <div className="inv-grid">
        <ListEditor {...p} title="Stores" hint="e.g. Main store, Lab store, Sports store" path="stores" rows={m.stores} render={(s) => `${m.categories.filter((c) => c.store_id === s.id).length} categories · ${m.items.filter((i) => i.store_id === s.id).length} items`} />
        <ListEditor {...p} title="Categories" hint="Organise items under each store" path="categories" rows={m.categories} render={(c) => `${m.stores.find((s) => s.id === c.store_id)?.name || 'All stores'} · ${m.items.filter((i) => i.category_id === c.id).length} items`}
          extra={(f, setF) => <div className="full"><Field label="Store"><select value={f.store_id || ''} onChange={(e) => setF({ ...f, store_id: e.target.value })}><option value="">All stores</option>{m.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field></div>} />
      </div>
      <ListEditor {...p} title="Vendors" hint="Who you buy from" path="vendors" rows={m.vendors} fields={[['category', 'Supplies (e.g. Stationery)'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address', true]]} render={(v) => [v.category, v.phone, v.email].filter(Boolean).join(' · ')} />
    </div>
  );
});

/* =============================================================== PURCHASE ORDERS */
function NewOrder({ me, sid, meta, onClose, onSaved }) {
  const [f, setF] = useState({ vendor_id: '', date: meta.today, notes: '' }); const [lines, setLines] = useState([{ item_id: '', qty: '', rate: '' }]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const o = await api.post('/inventory/orders', { ...f, ...sq(me, sid), lines: lines.filter((l) => l.item_id) }); toast(`${o.po_no} created`); onSaved(); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const low = meta.items.filter((i) => i.status !== 'in');
  return (
    <Modal title="New purchase order" onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <Field label="Vendor"><select value={f.vendor_id} onChange={(e) => setF({ ...f, vendor_id: e.target.value })}><option value="">Choose vendor</option>{meta.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <Field label="Order date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <div className="full"><b>Items</b>{low.length > 0 && <button type="button" className="linkbtn" style={{ marginLeft: 10 }} onClick={() => setLines(low.slice(0, 20).map((i) => ({ item_id: i.id, qty: Math.max(1, (i.reorder_level || 1) * 2 - i.qty), rate: i.rate || '' })))}>Fill with low-stock items</button>}</div>
        <div className="full"><LinePicker items={meta.items} lines={lines} setLines={setLines} withRate /></div>
        <div className="full"><Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        <div className="full row sp"><b>Total: {money(total)}</b></div>
        {err && <div className="err full">{err}</div>}
        <button className="btn primary full big" style={{ justifyContent: 'center' }} disabled={busy}>{busy ? 'Saving...' : 'Create order'}</button>
      </form>
    </Modal>
  );
}

function OrderView({ me, sid, id, onClose, onChanged }) {
  const { data: o, refresh } = useApi(`/inventory/orders/${id}${qs(sq(me, sid))}`, true);
  const [recv, setRecv] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const manage = can(me, 'manage_purchase_orders');
  const done = () => { refresh(); onChanged(); };
  const status = async (to, msg) => { if (msg && !(await ask(msg, { danger: to === 'cancelled', yes: 'Yes' }))) return; try { await api.post(`/inventory/orders/${id}/status${qs(sq(me, sid))}`, { status: to }); toast('Order updated'); done(); } catch (x) { toast(x.message, true); } };
  const receive = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/inventory/orders/${id}/receive`, { ...sq(me, sid), lines: Object.entries(recv.q).map(([line_id, q]) => ({ line_id, qty: q })).filter((l) => Number(l.qty) > 0), date: recv.date }); toast(`${r.grn_no} saved, stock updated`); setRecv(null); done(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={o ? o.po_no : 'Purchase order'} onClose={onClose} wide>
      {!o ? <Loading /> : (
        <div className="stack" style={{ maxWidth: 'none' }}>
          <div className="row sp"><div><b>{o.vendor || 'No vendor'}</b><div className="muted">{fmt(o.order_date)}{o.vendor_phone ? ` · ${o.vendor_phone}` : ''}</div></div><Pill map={PO} k={o.status} /></div>
          <div className="inv-lines ro">{o.lines.map((l) => (
            <div key={l.id} className="inv-row"><div><b>{l.name}</b><small>{qty(l.qty)} {l.unit} × {money(l.rate)}</small></div>
              {recv ? <input className="inv-recv" type="number" min="0" step="any" inputMode="decimal" max={l.qty - l.received_qty} placeholder={`0 / ${qty(l.qty - l.received_qty)}`} value={recv.q[l.id] ?? ''} disabled={l.received_qty >= l.qty} onChange={(e) => setRecv({ ...recv, q: { ...recv.q, [l.id]: e.target.value } })} aria-label={`Received ${l.name}`} />
                : <div style={{ textAlign: 'right' }}><b>{money(l.qty * l.rate)}</b><small>{qty(l.received_qty)} of {qty(l.qty)} received</small></div>}</div>))}</div>
          <div className="row sp"><b>Total {money(o.total)}</b>{o.notes && <span className="muted">{o.notes}</span>}</div>
          {o.grns.length > 0 && <div><b>Goods received</b>{o.grns.map((g) => <div key={g.id} className="inv-row"><div><b>{g.grn_no}</b><small>{fmt(g.grn_date)} · {g.lines.map((l) => `${l.name} ${qty(l.qty)}`).join(', ')}</small></div></div>)}</div>}
          {err && <div className="err">{err}</div>}
          {manage && (recv ? (
            <div className="row"><input type="date" style={{ width: 'auto' }} value={recv.date} onChange={(e) => setRecv({ ...recv, date: e.target.value })} aria-label="Received on" /><button className="btn primary" disabled={busy} onClick={receive}>{busy ? 'Saving...' : 'Save GRN & add to stock'}</button><button className="btn" onClick={() => setRecv(null)}>Cancel</button></div>
          ) : (
            <div className="row">
              {o.status === 'pending' && <button className="btn primary" onClick={() => status('approved')}>Approve</button>}
              {['approved', 'received'].includes(o.status) && <button className="btn primary" onClick={() => setRecv({ q: Object.fromEntries(o.lines.map((l) => [l.id, l.qty - l.received_qty])), date: new Date().toISOString().slice(0, 10) })}>Receive items</button>}
              {['approved', 'received'].includes(o.status) && <button className="btn" onClick={() => status('closed', 'Close this order? Pending items will not be expected any more.')}>Close order</button>}
              {['pending', 'approved'].includes(o.status) && <button className="btn danger" onClick={() => status('cancelled', 'Cancel this purchase order?')}>Cancel order</button>}
            </div>))}
        </div>)}
    </Modal>
  );
}

export const Orders = scoped(function Orders({ me, sid }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [status, setStatus] = useState(''); const [open, setOpen] = useState(null); const [adding, setAdding] = useState(false);
  const { data: rows, error, refresh } = useApi(`/inventory/orders${qs({ ...sq(me, sid), q: dq, status })}`, true, { keepPrevious: true });
  const { data: meta, refresh: refreshMeta } = useMeta(me, sid);
  const manage = can(me, 'manage_purchase_orders');
  const all = () => { refresh(); refreshMeta(); };
  if (error && !rows) return <div className="err">{error}</div>;
  return (
    <div className="stack inv" style={{ maxWidth: 1100 }}>
      <div className="card ds-toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search PO number, vendor or item..." />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All orders</option>{Object.entries(PO).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
        {manage && <button className="btn primary" disabled={!meta} onClick={() => setAdding(true)}><Icon name="plus" size={16} /> New order</button>}
      </div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>No purchase orders found.</Empty> : (
        <div className="card" style={{ padding: 0 }}>{rows.map((o) => (
          <button key={o.id} className="drow inv-order" onClick={() => setOpen(o.id)}>
            <div style={{ flex: 1, minWidth: 0 }}><b>{o.po_no}</b> <span className="muted">· {o.vendor || 'No vendor'}</span><small>{fmt(o.order_date)} · {o.items.slice(0, 3).join(', ')}{o.items.length > 3 ? ` +${o.items.length - 3}` : ''}</small></div>
            <div style={{ textAlign: 'right' }}><b>{money(o.total)}</b><div><Pill map={PO} k={o.status} /></div></div>
          </button>))}</div>)}
      {adding && meta && <NewOrder me={me} sid={sid} meta={meta} onClose={() => setAdding(false)} onSaved={all} />}
      {open && <OrderView me={me} sid={sid} id={open} onClose={() => setOpen(null)} onChanged={all} />}
    </div>
  );
});

/* =============================================================== ISSUE ITEMS */
function Recipient({ me, sid, value, onPick }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 300);
  const { data: list } = useApi(`/inventory/recipients${qs({ ...sq(me, sid), q: dq })}`, !value);
  if (value) return <div className="inv-pick"><div><b>{value.name}</b><small>{value.code}{value.class ? ` · Class ${value.class}` : ''}</small></div><button type="button" className="linkbtn" onClick={() => onPick(null)}>Change</button></div>;
  return (
    <div>
      <SearchBox value={q} onChange={setQ} placeholder="Search student or staff by name or ID..." />
      <div className="inv-results">{(list || []).map((p) => <button type="button" key={p.user_id} className="drow" onClick={() => onPick(p)}><div style={{ flex: 1 }}><b>{p.name}</b><small>{p.code} · {p.role === 'student' ? `Class ${p.class || '-'}` : 'Staff'}</small></div></button>)}{list && !list.length && <div className="muted" style={{ padding: 10 }}>No one found.</div>}</div>
    </div>
  );
}
function IssueDetail({ me, sid, id, school, onClose, onChanged }) {
  const { data: i, refresh } = useApi(`/inventory/issues/${id}${qs(sq(me, sid))}`, true);
  const [ret, setRet] = useState(null); const [err, setErr] = useState('');
  const giveBack = async () => {
    try { await api.post(`/inventory/issues/${id}/return${qs(sq(me, sid))}`, { lines: Object.entries(ret).map(([line_id, q]) => ({ line_id, qty: q })).filter((l) => Number(l.qty) > 0) }); toast('Stock updated'); setRet(null); refresh(); onChanged(); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={i ? i.receipt_no : 'Receipt'} onClose={onClose}>
      {!i ? <Loading /> : (
        <div className="stack" style={{ maxWidth: 'none' }}>
          <div className="row sp"><div><b>{i.issued_to_name}</b><div className="muted">{i.issued_to_code} · {fmt(i.issue_date)}</div></div><button className="btn" onClick={() => printReceipt(i, school)}><Icon name="doc" size={16} /> Print receipt</button></div>
          {i.lines.map((l) => (
            <div key={l.id} className="inv-row"><div><b>{l.name}</b><small>{qty(l.qty)} {l.unit}{l.returned_qty ? ` · ${qty(l.returned_qty)} returned` : ''}</small></div>
              {ret && l.returned_qty < l.qty && <input className="inv-recv" type="number" min="0" step="any" inputMode="decimal" max={l.qty - l.returned_qty} placeholder={`0 / ${qty(l.qty - l.returned_qty)}`} value={ret[l.id] ?? ''} onChange={(e) => setRet({ ...ret, [l.id]: e.target.value })} aria-label={`Return ${l.name}`} />}</div>))}
          {i.notes && <div className="muted">{i.notes}</div>}
          {err && <div className="err">{err}</div>}
          {can(me, 'issue_inventory') && (ret ? <div className="row"><button className="btn primary" onClick={giveBack}>Save return</button><button className="btn" onClick={() => setRet(null)}>Cancel</button></div>
            : i.lines.some((l) => l.returned_qty < l.qty) && <div><button className="btn" onClick={() => { setErr(''); setRet({}); }}>Take items back</button></div>)}
        </div>)}
    </Modal>
  );
}
export const IssueItems = scoped(function IssueItems({ me, sid }) {
  const { data: meta, refresh: refreshMeta, error } = useMeta(me, sid);
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [open, setOpen] = useState(null);
  const { data: rows, refresh } = useApi(`/inventory/issues${qs({ ...sq(me, sid), q: dq })}`, true, { keepPrevious: true });
  const { data: school } = useApi('/schools', can(me, 'get_school', 'edit_school'));
  const schoolName = (school || []).find((s) => s.id === (sid || me.school_id))?.name || school?.[0]?.name;
  const [who, setWho] = useState(null); const [manual, setManual] = useState(''); const [lines, setLines] = useState([{ item_id: '', qty: '' }]); const [f, setF] = useState({ date: '', notes: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [last, setLast] = useState(null);
  const canIssue = can(me, 'issue_inventory');
  if (error && !meta) return <div className="err">{error}</div>;
  if (!meta) return <Loading />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await api.post('/inventory/issues', { ...sq(me, sid), user_id: who?.user_id, name: manual, date: f.date || meta.today, notes: f.notes, lines: lines.filter((l) => l.item_id) });
      toast(`${r.receipt_no} issued`); setLast(r); setWho(null); setManual(''); setLines([{ item_id: '', qty: '' }]); setF({ date: '', notes: '' }); refresh(); refreshMeta();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack inv" style={{ maxWidth: 1100 }}>
      {canIssue && (
        <form className="card form" onSubmit={submit}>
          <div className="full"><b>New issue</b></div>
          <div className="full"><Field label="Issue to" req><Recipient me={me} sid={sid} value={who} onPick={setWho} /></Field>
            {!who && <div style={{ marginTop: 8 }}><input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="...or type a name / department (no account)" aria-label="Name" /></div>}</div>
          <div className="full"><LinePicker items={meta.items.filter((i) => i.qty > 0)} lines={lines} setLines={setLines} stockCap /></div>
          <Field label="Date"><input type="date" value={f.date || meta.today} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {err && <div className="err full">{err}</div>}
          <button className="btn primary full big" style={{ justifyContent: 'center' }} disabled={busy || (!who && !manual.trim())}>{busy ? 'Saving...' : 'Issue items'}</button>
        </form>)}
      {last && <div className="notice ok row sp"><span><b>{last.receipt_no}</b> issued to {last.issued_to_name}.</span><button className="btn" onClick={() => printReceipt(last, schoolName)}><Icon name="doc" size={16} /> Print receipt</button></div>}
      <div className="card ds-toolbar"><SearchBox value={q} onChange={setQ} placeholder="Search receipt no., name, employee code or item..." /></div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nothing issued yet.</Empty> : (
        <div className="card" style={{ padding: 0 }}>{rows.map((i) => (
          <button key={i.id} className="drow inv-order" onClick={() => setOpen(i.id)}>
            <div style={{ flex: 1, minWidth: 0 }}><b>{i.issued_to_name}</b> <span className="muted">· {i.issued_to_code}</span><small>{i.receipt_no} · {fmt(i.issue_date)} · {i.items.slice(0, 3).join(', ')}{i.items.length > 3 ? ` +${i.items.length - 3}` : ''}</small></div>
            <div style={{ textAlign: 'right' }}><b>{qty(i.qty)}</b><small>{i.returned ? `${qty(i.returned)} returned` : 'issued'}</small></div>
          </button>))}</div>)}
      {open && <IssueDetail me={me} sid={sid} id={open} school={schoolName} onClose={() => setOpen(null)} onChanged={() => { refresh(); refreshMeta(); }} />}
    </div>
  );
});

/* =============================================================== REPORTS */
export const InventoryReports = scoped(function InventoryReports({ me, sid }) {
  const [tab, setTab] = useState('stock'); const [store, setStore] = useState(''); const [cat, setCat] = useState(''); const [type, setType] = useState(''); const [lowOnly, setLowOnly] = useState(false);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const { data: meta } = useMeta(me, sid);
  const stockOk = can(me, 'view_inventory', 'manage_inventory');
  const { data: stock } = useApi(`/inventory/reports/stock${qs(sq(me, sid))}`, tab === 'stock' && stockOk);
  const { data: iss } = useApi(`/inventory/reports/issues${qs({ ...sq(me, sid), from, to })}`, tab === 'issues');
  const rows = useMemo(() => (stock || []).filter((i) => (!store || i.store_id === store) && (!cat || i.category_id === cat) && (!type || i.item_type === type) && (!lowOnly || i.status !== 'in')), [stock, store, cat, type, lowOnly]);
  const exportStock = () => download('inventory-stock.csv', [['Item', 'Store', 'Category', 'Type', 'Unit', 'Stock', 'Reorder level', 'Rate', 'Value', 'Status'], ...rows.map((i) => [i.name, i.store, i.category, i.item_type, i.unit, i.qty, i.reorder_level, i.rate, i.value, STOCK[i.status][1]])]);
  const exportIssues = () => download('inventory-issues.csv', [['Receipt', 'Date', 'Issued to', 'Code', 'Item', 'Qty', 'Returned'], ...(iss || []).map((l) => [l.receipt_no, l.date, l.to, l.code, l.item, l.qty, l.returned])]);
  const printStock = () => printHtml('Stock report', `<h1>Stock report</h1><h2>${new Date().toLocaleDateString()}</h2><table><tr><th>Item</th><th>Store</th><th>Category</th><th>Stock</th><th>Reorder</th><th>Value</th></tr>${rows.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.store)}</td><td>${esc(i.category)}</td><td>${qty(i.qty)} ${esc(i.unit)}</td><td>${qty(i.reorder_level)}</td><td>${money(i.value)}</td></tr>`).join('')}</table>`);
  const printIssues = () => printHtml('Issue report', `<h1>Issued items</h1><h2>${esc(from || 'Start')} to ${esc(to || 'today')}</h2><table><tr><th>Receipt</th><th>Date</th><th>Issued to</th><th>Item</th><th>Qty</th><th>Returned</th></tr>${(iss || []).map((l) => `<tr><td>${esc(l.receipt_no)}</td><td>${esc(fmt(l.date))}</td><td>${esc(l.to)} ${esc(l.code || '')}</td><td>${esc(l.item)}</td><td>${qty(l.qty)}</td><td>${qty(l.returned)}</td></tr>`).join('')}</table>`);
  const total = rows.reduce((s, i) => s + i.value, 0);
  return (
    <div className="stack inv" style={{ maxWidth: 1100 }}>
      <div className="pills">
        {stockOk && <button className={`pill ${tab === 'stock' ? 'on' : ''}`} onClick={() => setTab('stock')}>Stock</button>}
        <button className={`pill ${tab === 'issues' ? 'on' : ''}`} onClick={() => setTab('issues')}>Issued & returned</button>
      </div>
      {tab === 'stock' ? (
        <>
          <div className="card ds-toolbar">
            <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="Store"><option value="">All stores</option>{(meta?.stores || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{(meta?.categories || []).filter((c) => !store || c.store_id === store).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Item type"><option value="">All types</option><option value="consumable">Consumable</option><option value="asset">Asset</option></select>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto' }} checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low / out only</label>
            <div className="row"><button className="btn" onClick={printStock} disabled={!rows.length}>Print</button><button className="btn" onClick={exportStock} disabled={!rows.length}>Export to Excel</button></div>
          </div>
          {!stock ? <Loading /> : rows.length === 0 ? <Empty>No items match.</Empty> : (
            <>
              <div className="muted">{rows.length} items · stock value {money(total)}</div>
              <div className="card inv-table" style={{ padding: 0 }}><table><thead><tr><th>Item</th><th>Store</th><th>Category</th><th className="r">Stock</th><th className="r">Reorder</th><th className="r">Value</th><th>Status</th></tr></thead>
                <tbody>{rows.map((i) => <tr key={i.id}><td><b>{i.name}</b></td><td>{i.store || '-'}</td><td>{i.category || '-'}</td><td className="r">{qty(i.qty)} {i.unit}</td><td className="r">{qty(i.reorder_level)}</td><td className="r">{money(i.value)}</td><td><Pill map={STOCK} k={i.status} /></td></tr>)}</tbody></table></div>
              <div className="inv-cards">{rows.map((i) => <div key={i.id} className="card inv-card"><div className="row sp"><b>{i.name}</b><Pill map={STOCK} k={i.status} /></div><div className="muted">{i.category || '-'} · {i.store || '-'}</div><div className="row sp"><span><b className="inv-big">{qty(i.qty)}</b> {i.unit}</span><span>{money(i.value)}</span></div></div>)}</div>
            </>)}
        </>
      ) : (
        <>
          <div className="card ds-toolbar">
            <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <div className="row"><button className="btn" onClick={printIssues} disabled={!iss?.length}>Print</button><button className="btn" onClick={exportIssues} disabled={!iss?.length}>Export to Excel</button></div>
          </div>
          {!iss ? <Loading /> : iss.length === 0 ? <Empty>Nothing issued in this period.</Empty> : (
            <>
              <div className="card inv-table" style={{ padding: 0 }}><table><thead><tr><th>Date</th><th>Receipt</th><th>Issued to</th><th>Item</th><th className="r">Qty</th><th className="r">Returned</th></tr></thead>
                <tbody>{iss.map((l, n) => <tr key={n}><td>{fmt(l.date)}</td><td>{l.receipt_no}</td><td><b>{l.to}</b> <small className="muted">{l.code}</small></td><td>{l.item}</td><td className="r">{qty(l.qty)} {l.unit}</td><td className="r">{qty(l.returned)}</td></tr>)}</tbody></table></div>
              <div className="inv-cards">{iss.map((l, n) => <div key={n} className="card inv-card"><div className="row sp"><b>{l.item}</b><span><b>{qty(l.qty)}</b> {l.unit}</span></div><div className="muted">{l.to} {l.code ? `(${l.code})` : ''}</div><small className="muted">{l.receipt_no} · {fmt(l.date)}{l.returned ? ` · ${qty(l.returned)} returned` : ''}</small></div>)}</div>
            </>)}
        </>)}
    </div>
  );
});
