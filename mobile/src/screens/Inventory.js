// Inventory module for mobile. Mirrors client/src/modules/InventoryModule.jsx (same endpoints, permissions and rules).
// Views: Overview, Items & stock, Purchase orders (+ receiving / GRN), Issue items (+ returns, receipts), Stores & vendors, Reports.
// Stock only ever changes on the server (receiving, issuing, returning); the phone just sends the same requests as the web.
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { api } from '../api';
import { C, ymd } from '../theme';
import { Icon } from '../icons';
import { Card, Dim, Empty, Loading, ErrorBox, Btn, Field, Input, Choice, Check, DateField, Sheet, toast, confirmAsk } from '../ui';
import { FilterBar } from '../FilterBar';
import { useApi } from '../useApi';
import { sharePdfHtml, shareTextFile } from '../download';
import {
  scoped, qs, Pad, Row, List, Notice, Avatar, Chip, Stat, StatRow, Kpi, KpiGrid, Section, Soft, Meter, Line, SearchBox, OptDate,
  rupees, fdate, plural, toneColor, useDebounced, dial,
} from '../kit';

const ACCENT = '#16a34a';
const PAGE = 60; // long lists show this many rows, then "Show more"
const can = (me, ...f) => f.some((x) => me.features.includes(x));
const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const STOCK = { in: ['ok', 'In stock'], low: ['warn', 'Low stock'], out: ['bad', 'Out of stock'] };
const PO = { pending: ['warn', 'Pending'], approved: ['info', 'Approved'], received: ['info', 'Part received'], closed: ['ok', 'Received'], cancelled: ['mute', 'Cancelled'] };
const StockChip = ({ k }) => <Chip tone={STOCK[k]?.[0]}>{STOCK[k]?.[1] || k}</Chip>;
const PoChip = ({ k }) => <Chip tone={PO[k]?.[0]}>{PO[k]?.[1] || k}</Chip>;
const useMeta = (sc) => useApi(`/inventory/meta${qs(sc)}`);
const names = (list, id, none = '-') => list.find((x) => x.id === id)?.name || none;
const numText = (t) => t.replace(/[^0-9.]/g, '');
const more = (list, n) => list.slice(0, n);
const ShowMore = ({ total, shown, onMore }) => (total > shown ? <View style={{ marginBottom: 12 }}><Btn small kind="ghost" title={`Show more (${total - shown} left)`} onPress={onMore} /></View> : null);

/* ------------------------------------------------------------------ printable pieces (PDF through the share sheet) */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CSS = 'body{font:14px sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 14px;font-weight:500;color:#555}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ccc;padding:7px 9px;text-align:left}th{background:#f3f3f3}.m{display:flex;justify-content:space-between;margin:6px 0}.sig{display:flex;justify-content:space-between;margin-top:56px}.sig div{border-top:1px solid #333;padding-top:6px;min-width:150px;text-align:center}';
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;
const receiptHtml = (i, school) => page(`<h1>${esc(school || 'School')} - Inventory issue receipt</h1><h2>${esc(i.receipt_no)}</h2>
  <div class="m"><span><b>Issued to:</b> ${esc(i.issued_to_name)}${i.issued_to_code ? ` (${esc(i.issued_to_code)})` : ''}</span><span><b>Date:</b> ${esc(fdate(i.issue_date))}</span></div>
  <table><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit</th></tr>${i.lines.map((l, n) => `<tr><td>${n + 1}</td><td>${esc(l.name)}</td><td>${qty(l.qty)}</td><td>${esc(l.unit)}</td></tr>`).join('')}</table>
  ${i.notes ? `<p><b>Notes:</b> ${esc(i.notes)}</p>` : ''}<div class="sig"><div>Issued by</div><div>Received by</div></div>`);
const shareReceipt = (i, school) => sharePdfHtml(receiptHtml(i, school), i.receipt_no).catch((e) => toast(e.message, true));
const csvText = (rows) => `\ufeff${rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')}`;
const shareCsv = (name, rows) => shareTextFile(name, csvText(rows), 'text/csv').catch((e) => toast(e.message, true));

/* ------------------------------------------------------------------ shared form pieces */
// Pick one item from a long list: a field that opens a search + short result list right under it (no second pop-up).
function ItemPick({ items, value, onPick, stockCap }) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const it = items.find((x) => x.id === value); const dq = q.trim().toLowerCase();
  const found = items.filter((x) => !dq || x.name.toLowerCase().includes(dq));
  if (!open) {
    return (
      <Pressable onPress={() => { setQ(''); setOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 }}>
        <Text style={{ flex: 1, color: it ? C.ink : C.hint, fontSize: 15 }} numberOfLines={1}>{it ? it.name : 'Choose item'}</Text>
        <Icon name="down" size={16} color={C.mute} />
      </Pressable>
    );
  }
  return (
    <View>
      <Input value={q} onChangeText={setQ} placeholder="Search item..." autoFocus autoCorrect={false} />
      <View style={{ marginTop: 8 }}>
        {found.length === 0 ? <Soft>No item matches.</Soft> : (
          <List>
            {more(found, 8).map((x, i, a) => (
              <Row key={x.id} onPress={() => { onPick(x.id); setOpen(false); }} last={i === a.length - 1}>
                <Text style={{ flex: 1, color: C.ink, fontWeight: '600' }} numberOfLines={1}>{x.name}</Text>
                <Text style={{ color: x.status === 'in' || !stockCap ? C.mute : toneColor(STOCK[x.status][0]), fontSize: 12.5 }}>{qty(x.qty)} {x.unit}{stockCap ? ' left' : ''}</Text>
              </Row>
            ))}
          </List>
        )}
        {found.length > 8 && <Dim>Showing 8 of {found.length}. Type to narrow down.</Dim>}
        <Pressable onPress={() => setOpen(false)} hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: 6 }}><Text style={{ color: C.brand, fontWeight: '700' }}>Close list</Text></Pressable>
      </View>
    </View>
  );
}

// the rows of an order / an issue: item, quantity (and rate)
function LineEditor({ items, lines, setLines, withRate, stockCap }) {
  const set = (i, patch) => setLines(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const pick = (i, id) => { const it = items.find((x) => x.id === id); set(i, { item_id: id, ...(withRate && it ? { rate: it.rate ? String(it.rate) : '' } : {}) }); };
  return (
    <View>
      {lines.map((l, i) => {
        const it = items.find((x) => x.id === l.item_id); const over = stockCap && it && Number(l.qty) > it.qty;
        return (
          <Card key={i}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}><ItemPick items={items} value={l.item_id} onPick={(id) => pick(i, id)} stockCap={stockCap} /></View>
              <Pressable onPress={() => setLines(lines.length > 1 ? lines.filter((_, n) => n !== i) : [{ item_id: '', qty: '', rate: '' }])} hitSlop={8} accessibilityLabel="Remove row"><Icon name="x" size={19} color={C.mute} /></Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1 }}><Field label={it ? `Quantity (${it.unit})` : 'Quantity'}><Input value={l.qty} onChangeText={(t) => set(i, { qty: numText(t) })} keyboardType="decimal-pad" placeholder="0" /></Field></View>
              {withRate && <View style={{ flex: 1 }}><Field label="Rate"><Input value={l.rate} onChangeText={(t) => set(i, { rate: numText(t) })} keyboardType="decimal-pad" placeholder="0" /></Field></View>}
            </View>
            {over && <Text style={{ color: C.bad, fontSize: 12.5 }}>Only {qty(it.qty)} {it.unit} in stock.</Text>}
            {withRate && !!l.qty && !!l.rate && <Dim>Amount {rupees(Number(l.qty) * Number(l.rate))}</Dim>}
          </Card>
        );
      })}
      <Btn small kind="ghost" title="Add another item" onPress={() => setLines([...lines, { item_id: '', qty: '', rate: '' }])} />
    </View>
  );
}

/* ================================================================== OVERVIEW */
export const InventoryOverview = scoped(function Overview({ me, sc, go }) {
  const { data: d, error, reload, loading } = useApi(`/inventory/overview${qs(sc)}`);
  if (error && !d) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!d) return <Pad><Loading /></Pad>;
  const s = d.stats; const max = Math.max(1, ...d.by_category.map((c) => c.qty));
  const view = (v, ...f) => (can(me, ...f) ? () => go(v) : undefined);
  const items = view('items', 'view_inventory', 'manage_inventory'); const setup = view('setup', 'manage_inventory');
  return (
    <Pad reload={reload} loading={loading} hasData>
      <KpiGrid>
        <Kpi icon="box" color={ACCENT} label="Total items" value={s.items} sub={`${s.stores} ${s.stores === 1 ? 'store' : 'stores'}`} onPress={items} />
        <Kpi icon="grid" color="#0ea5e9" label="Categories" value={s.categories} onPress={setup} />
        <Kpi icon="users" color="#8b5cf6" label="Vendors" value={s.vendors} onPress={setup} />
        <Kpi icon="bell" color={C.warn} label="Low / out of stock" value={s.low + s.out} tone={s.low + s.out ? 'warn' : undefined} sub={s.low + s.out ? 'needs reordering' : 'all good'} onPress={items} />
      </KpiGrid>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {can(me, 'issue_inventory') && <Btn small title="Issue items" onPress={() => go('issue')} />}
        {can(me, 'manage_inventory') && <Btn small kind="ghost" title="Add item" onPress={() => go('items')} />}
        {can(me, 'manage_purchase_orders') && <Btn small kind="ghost" title="Purchase order" onPress={() => go('orders')} />}
        {can(me, 'view_inventory') && <Btn small kind="ghost" title="Reports" onPress={() => go('reports')} />}
      </View>

      <Section title="Stock summary" icon="box" color={ACCENT}>
        <StatRow><Stat n={s.in_stock} label="In stock" tone="ok" /><Stat n={s.low} label="Low" tone={s.low ? 'warn' : undefined} /><Stat n={s.out} label="Out" tone={s.out ? 'bad' : undefined} /></StatRow>
        <Line left="Stock value" right={rupees(s.value)} last />
      </Section>

      <Section title="Stock by category" icon="grid" color="#0ea5e9">
        {d.by_category.length === 0 ? <Soft>No items yet.</Soft> : d.by_category.map((c, i) => (
          <View key={c.id} style={{ paddingVertical: 7 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}><Text style={{ color: C.ink, fontSize: 14 }} numberOfLines={1}>{c.name}</Text><Text style={{ color: C.ink, fontWeight: '700' }}>{qty(c.qty)}</Text></View>
            <View style={{ flexDirection: 'row' }}><Meter pct={Math.max(4, (c.qty / max) * 100)} color={ACCENT} /></View>
          </View>
        ))}
      </Section>

      <Section title="Needs attention" icon="bell" color={C.warn} right={d.low_items.length ? <Chip tone="warn">{d.low_items.length}</Chip> : null}>
        {d.low_items.length === 0 ? <Soft>Nothing is running low.</Soft> : d.low_items.map((i, n) => (
          <Line key={i.id} left={i.name} mid={`reorder at ${qty(i.reorder_level)}`} right={`${qty(i.qty)} ${i.unit}`} rightTone={STOCK[i.status][0]} last={n === d.low_items.length - 1} />
        ))}
      </Section>

      <Section title="Purchase orders" icon="doc" color="#8b5cf6">
        <StatRow><Stat n={d.orders.total} label="Orders" /><Stat n={d.orders.pending} label="Pending" tone={d.orders.pending ? 'warn' : undefined} /><Stat n={d.orders.approved} label="Approved" tone={d.orders.approved ? 'info' : undefined} /><Stat n={d.orders.received} label="Received" tone={d.orders.received ? 'ok' : undefined} /></StatRow>
        {d.orders.recent.map((o, n) => (
          <Row key={o.id} onPress={view('orders', 'manage_purchase_orders', 'view_inventory')} last={n === d.orders.recent.length - 1}>
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>{o.po_no}</Text><Dim>{o.vendor || 'No vendor'} · {fdate(o.order_date)}</Dim></View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={{ color: C.ink, fontWeight: '800' }}>{rupees(o.total)}</Text><PoChip k={o.status} /></View>
          </Row>
        ))}
      </Section>

      <Section title="Recent issues" icon="send" color="#ec4899">
        {d.recent_issues.length === 0 ? <Soft>Nothing issued yet.</Soft> : d.recent_issues.map((i, n) => (
          <Row key={i.id} onPress={view('issue', 'issue_inventory', 'view_inventory')} last={n === d.recent_issues.length - 1}>
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{i.issued_to_name}</Text><Dim>{i.receipt_no} · {fdate(i.issue_date)}</Dim></View>
            <Chip>{plural(i.items, 'item')}</Chip>
          </Row>
        ))}
      </Section>
    </Pad>
  );
});

/* ================================================================== ITEMS & STOCK */
function ItemForm({ sc, meta, item, onClose, onSaved }) {
  const [f, setF] = useState(item ? { ...item, qty: String(item.qty), reorder_level: String(item.reorder_level), rate: String(item.rate), store_id: item.store_id || '', category_id: item.category_id || '' } : { name: '', store_id: '', category_id: '', item_type: 'consumable', unit: 'Nos', qty: '', reorder_level: '', rate: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const cats = meta.categories.filter((c) => !f.store_id || c.store_id === f.store_id || !c.store_id);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const b = { name: f.name, store_id: f.store_id, category_id: f.category_id, item_type: f.item_type, unit: f.unit, reorder_level: f.reorder_level, rate: f.rate };
      if (item) { if (Number(f.qty) !== item.qty) b.qty = f.qty; await api.patch(`/inventory/items/${item.id}${qs(sc)}`, b); } else await api.post(`/inventory/items${qs(sc)}`, { ...b, qty: f.qty });
      toast(item ? 'Item updated' : 'Item added'); onSaved(); onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const remove = () => confirmAsk(`Delete ${item.name}?`, async () => {
    try { await api.del(`/inventory/items/${item.id}${qs(sc)}`); toast('Item deleted'); onSaved(); onClose(); } catch (x) { setErr(x.message); toast(x.message, true); }
  });
  return (
    <Sheet title={item ? 'Edit item' : 'Add item'} onClose={onClose}>
      <Card>
        <Field req label="Item name"><Input value={f.name} onChangeText={set('name')} maxLength={120} /></Field>
        <Field label="Store"><Choice value={f.store_id} onChange={(v) => setF((p) => ({ ...p, store_id: v, category_id: '' }))} options={[{ value: '', label: 'No store' }, ...meta.stores.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        <Field label="Category"><Choice value={f.category_id} onChange={set('category_id')} options={[{ value: '', label: 'No category' }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} /></Field>
        <Field label="Item type"><Choice value={f.item_type} onChange={set('item_type')} options={[{ value: 'consumable', label: 'Consumable (used up)' }, { value: 'asset', label: 'Asset (returnable)' }]} /></Field>
      </Card>
      <Card>
        <Field label="Unit"><Input value={f.unit} onChangeText={set('unit')} placeholder="Nos, box, kg..." maxLength={20} /></Field>
        <Field label={item ? 'Stock in hand' : 'Opening stock'} hint={item ? 'Change only to correct a count' : ''}><Input value={f.qty} onChangeText={(t) => set('qty')(numText(t))} keyboardType="decimal-pad" placeholder="0" /></Field>
        <Field label="Reorder level" hint="Shown as low stock at or below this"><Input value={f.reorder_level} onChangeText={(t) => set('reorder_level')(numText(t))} keyboardType="decimal-pad" placeholder="0" /></Field>
        <Field label="Rate"><Input value={f.rate} onChangeText={(t) => set('rate')(numText(t))} keyboardType="decimal-pad" placeholder="0" /></Field>
      </Card>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Save item'} onPress={save} disabled={busy || !f.name.trim()} />
      {item && <View style={{ marginTop: 10 }}><Btn kind="danger" title="Delete item" onPress={remove} /></View>}
    </Sheet>
  );
}

function BulkAdd({ sc, meta, onClose, onSaved }) {
  const [text, setText] = useState(''); const [store, setStore] = useState(''); const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const rows = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, q, unit, level, rate] = l.split(/[,\t]/).map((x) => x.trim()); return { name, qty: q || 0, unit: unit || 'Nos', reorder_level: level || 0, rate: rate || 0, store_id: store, category_id: cat }; });
  const save = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/inventory/items/bulk${qs(sc)}`, { items: rows }); toast(`${plural(r.added, 'item')} added`); onSaved(); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Add many items" onClose={onClose}>
      <Card>
        <Field label="Store"><Choice value={store} onChange={(v) => { setStore(v); setCat(''); }} options={[{ value: '', label: 'No store' }, ...meta.stores.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        <Field label="Category"><Choice value={cat} onChange={setCat} options={[{ value: '', label: 'No category' }, ...meta.categories.filter((c) => !store || c.store_id === store || !c.store_id).map((c) => ({ value: c.id, label: c.name }))]} /></Field>
      </Card>
      <Card>
        <Field label="One item per line" hint="name, stock, unit, reorder level, rate (only the name is needed; you can paste from Excel)">
          <Input multiline value={text} onChangeText={setText} style={{ minHeight: 160 }} autoCapitalize="none" placeholder={'Notebook, 250, Nos, 50, 40\nBall pen, 120, Nos, 30, 10\nA4 paper, 40, ream, 50, 280'} />
        </Field>
      </Card>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : `Add ${plural(rows.length, 'item')}`} onPress={save} disabled={busy || !rows.length} />
    </Sheet>
  );
}

export const Items = scoped(function Items({ me, sc }) {
  const { data: meta, error, reload, loading } = useMeta(sc);
  const [q, setQ] = useState(''); const dq = useDebounced(q.trim().toLowerCase(), 150);
  const [store, setStore] = useState(''); const [cat, setCat] = useState(''); const [st, setSt] = useState(''); const [isort, setIsort] = useState('name');
  const [form, setForm] = useState(null); const [bulk, setBulk] = useState(false); const [shown, setShown] = useState(PAGE);
  const manage = can(me, 'manage_inventory');
  if (error && !meta) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  const count = (k) => meta.items.filter((i) => i.status === k).length;
  const rows = meta.items.filter((i) => (!dq || i.name.toLowerCase().includes(dq)) && (!store || i.store_id === store) && (!cat || i.category_id === cat) && (!st || i.status === st)).sort((a, b) => isort === 'low' ? a.qty - b.qty : isort === 'high' ? b.qty - a.qty : String(a.name).localeCompare(String(b.name)));
  const pick = (setter) => (v) => { setter(v); setShown(PAGE); };
  return (
    <View style={{ flex: 1 }}>
      <FilterBar q={q} onQ={(v) => { setQ(v); setShown(PAGE); }} placeholder="Search items..." count={rows.length}
        filters={[
          meta.stores.length > 0 && { key: 'store', label: 'Store', value: store, onChange: (v) => { pick(setStore)(v); setCat(''); }, all: 'All stores', options: meta.stores.map((x) => ({ value: x.id, label: x.name })) },
          meta.categories.length > 0 && { key: 'cat', label: 'Category', value: cat, onChange: pick(setCat), all: 'All categories', options: meta.categories.filter((c) => !store || c.store_id === store).map((c) => ({ value: c.id, label: c.name })) },
          { key: 'st', label: 'Stock status', value: st, onChange: pick(setSt), all: 'Any status', options: [{ value: 'in', label: 'In stock' }, { value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }] },
        ].filter(Boolean)}
        sort={{ value: isort, onChange: pick(setIsort), def: 'name', options: [{ value: 'name', label: 'Name A-Z' }, { value: 'low', label: 'Lowest stock first' }, { value: 'high', label: 'Highest stock first' }] }} />
      <Pad reload={reload} loading={loading} hasData>
        <KpiGrid>
          <Kpi icon="check" color="#10b981" label="In stock" value={count('in')} on={st === 'in'} onPress={() => pick(setSt)(st === 'in' ? '' : 'in')} />
          <Kpi icon="bell" color={C.warn} label="Low stock" value={count('low')} on={st === 'low'} onPress={() => pick(setSt)(st === 'low' ? '' : 'low')} />
          <Kpi icon="x" color="#ef4444" label="Out of stock" value={count('out')} on={st === 'out'} onPress={() => pick(setSt)(st === 'out' ? '' : 'out')} />
          <Kpi icon="box" color={ACCENT} label="Total items" value={meta.items.length} on={!st} onPress={() => pick(setSt)('')} />
        </KpiGrid>
        {manage && <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}><View style={{ flex: 1 }}><Btn small title="Add item" onPress={() => setForm({})} /></View><View style={{ flex: 1 }}><Btn small kind="ghost" title="Add many" onPress={() => setBulk(true)} /></View></View>}
        {rows.length === 0 ? <Empty>{meta.items.length ? 'No item matches.' : manage ? 'No items yet. Add stores and categories in Stores & vendors, then add your first item.' : 'No items yet.'}</Empty> : (
          <>
            <List>
              {more(rows, shown).map((i, n, a) => (
                <Row key={i.id} onPress={manage ? () => setForm(i) : undefined} last={n === a.length - 1}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{i.name}</Text>
                    <Dim>{[names(meta.categories, i.category_id, ''), names(meta.stores, i.store_id, ''), i.item_type === 'asset' ? 'asset' : ''].filter(Boolean).join(' · ') || 'No category'}</Dim>
                    <Dim>Reorder at {qty(i.reorder_level)}</Dim>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16 }}>{qty(i.qty)} <Text style={{ color: C.mute, fontSize: 12, fontWeight: '500' }}>{i.unit}</Text></Text>
                    <StockChip k={i.status} />
                  </View>
                  {manage && <Icon name="chevron" size={16} color={C.mute} />}
                </Row>
              ))}
            </List>
            <ShowMore total={rows.length} shown={shown} onMore={() => setShown((n) => n + PAGE)} />
          </>
        )}
        {form && <ItemForm sc={sc} meta={meta} item={form.id ? form : null} onClose={() => setForm(null)} onSaved={reload} />}
        {bulk && <BulkAdd sc={sc} meta={meta} onClose={() => setBulk(false)} onSaved={reload} />}
      </Pad>
    </View>
  );
});

/* ================================================================== STORES & VENDORS */
function SimpleForm({ sc, path, one, row, extra, fields, onClose, onSaved }) {
  const [f, setF] = useState(row ? { ...row } : { name: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try { if (f.id) await api.patch(`/inventory/${path}/${f.id}${qs(sc)}`, f); else await api.post(`/inventory/${path}${qs(sc)}`, f); toast('Saved'); onSaved(); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const remove = () => confirmAsk(`Delete ${f.name}?`, async () => { try { await api.del(`/inventory/${path}/${f.id}${qs(sc)}`); toast('Deleted'); onSaved(); onClose(); } catch (x) { setErr(x.message); toast(x.message, true); } });
  const kb = { phone: 'phone-pad', email: 'email-address' };
  return (
    <Sheet title={`${f.id ? 'Edit' : 'Add'} ${one}`} onClose={onClose}>
      <Card>
        <Field req label="Name"><Input value={f.name} onChangeText={set('name')} maxLength={120} /></Field>
        {extra?.(f, set)}
        {(fields || []).map(([k, label]) => <Field key={k} label={label}><Input value={f[k] || ''} onChangeText={set(k)} keyboardType={kb[k]} autoCapitalize={k === 'email' ? 'none' : undefined} multiline={k === 'address'} maxLength={300} /></Field>)}
      </Card>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Save'} onPress={save} disabled={busy || !f.name.trim()} />
      {f.id && <View style={{ marginTop: 10 }}><Btn kind="danger" title={`Delete ${one}`} onPress={remove} /></View>}
    </Sheet>
  );
}

function ListEditor({ sc, title, one, hint, icon, color, path, rows, extra, fields, onChanged, render, withCall }) {
  const [f, setF] = useState(null);
  return (
    <Section title={title} icon={icon} color={color} right={<Btn small title="Add" onPress={() => setF({ row: null })} />}>
      <Dim style={{ marginTop: -6, marginBottom: 10 }}>{hint}</Dim>
      {rows.length === 0 ? <Soft>None yet.</Soft> : rows.map((r, i) => (
        <Row key={r.id} onPress={() => setF({ row: r })} last={i === rows.length - 1}>
          <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{r.name}</Text>{!!render(r) && <Dim>{render(r)}</Dim>}</View>
          {withCall && !!r.phone && <Pressable onPress={() => dial(r.phone)} hitSlop={8} accessibilityLabel={`Call ${r.name}`} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.okBg, alignItems: 'center', justifyContent: 'center' }}><Icon name="phone" size={16} color={C.ok} /></Pressable>}
          <Icon name="edit" size={17} color={C.brand} />
        </Row>
      ))}
      {f && <SimpleForm sc={sc} path={path} one={one} row={f.row} extra={extra} fields={fields} onClose={() => setF(null)} onSaved={onChanged} />}
    </Section>
  );
}

export const InventorySetup = scoped(function Setup({ sc }) {
  const { data: m, error, reload, loading } = useMeta(sc);
  if (error && !m) return <Pad><ErrorBox>{error}</ErrorBox></Pad>;
  if (!m) return <Pad><Loading /></Pad>;
  const p = { sc, onChanged: reload };
  return (
    <Pad reload={reload} loading={loading} hasData>
      <ListEditor {...p} title="Stores" one="store" icon="school" color={ACCENT} hint="e.g. Main store, Lab store, Sports store" path="stores" rows={m.stores}
        render={(s) => `${plural(m.categories.filter((c) => c.store_id === s.id).length, 'category').replace('categorys', 'categories')} · ${plural(m.items.filter((i) => i.store_id === s.id).length, 'item')}`} />
      <ListEditor {...p} title="Categories" one="category" icon="grid" color="#0ea5e9" hint="Organise items under each store" path="categories" rows={m.categories}
        render={(c) => `${names(m.stores, c.store_id, 'All stores')} · ${plural(m.items.filter((i) => i.category_id === c.id).length, 'item')}`}
        extra={(f, set) => <Field label="Store"><Choice value={f.store_id || ''} onChange={set('store_id')} options={[{ value: '', label: 'All stores' }, ...m.stores.map((s) => ({ value: s.id, label: s.name }))]} /></Field>} />
      <ListEditor {...p} title="Vendors" one="vendor" icon="users" color="#8b5cf6" hint="Who you buy from" path="vendors" rows={m.vendors} withCall
        fields={[['category', 'Supplies (e.g. Stationery)'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address']]} render={(v) => [v.category, v.phone, v.email].filter(Boolean).join(' · ')} />
    </Pad>
  );
});

/* ================================================================== PURCHASE ORDERS */
function NewOrder({ sc, meta, onClose, onSaved }) {
  const [f, setF] = useState({ vendor_id: '', date: meta.today, notes: '' }); const [lines, setLines] = useState([{ item_id: '', qty: '', rate: '' }]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const low = meta.items.filter((i) => i.status !== 'in');
  const save = async () => {
    setBusy(true); setErr('');
    try { const o = await api.post(`/inventory/orders${qs(sc)}`, { ...f, lines: lines.filter((l) => l.item_id) }); toast(`${o.po_no} created`); onSaved(); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="New purchase order" onClose={onClose}>
      <Card>
        <Field label="Vendor"><Choice value={f.vendor_id} onChange={(v) => setF({ ...f, vendor_id: v })} options={[{ value: '', label: 'No vendor' }, ...meta.vendors.map((v) => ({ value: v.id, label: v.name }))]} /></Field>
        <Field label="Order date"><DateField value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label="Notes"><Input value={f.notes} onChangeText={(v) => setF({ ...f, notes: v })} maxLength={400} placeholder="Optional" /></Field>
      </Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Text style={{ flex: 1, color: C.ink, fontWeight: '800', fontSize: 16 }}>Items</Text>
        {low.length > 0 && <Btn small kind="ghost" title="Fill with low-stock items" onPress={() => setLines(low.slice(0, 20).map((i) => ({ item_id: i.id, qty: String(Math.max(1, (i.reorder_level || 1) * 2 - i.qty)), rate: i.rate ? String(i.rate) : '' })))} />}
      </View>
      <LineEditor items={meta.items} lines={lines} setLines={setLines} withRate />
      <Card style={{ marginTop: 12 }}><Line left="Total" right={rupees(total)} last /></Card>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Create order'} onPress={save} disabled={busy || !lines.some((l) => l.item_id && Number(l.qty) > 0)} />
    </Sheet>
  );
}

function OrderView({ me, sc, id, onClose, onChanged }) {
  const { data: o, error, reload } = useApi(`/inventory/orders/${id}${qs(sc)}`);
  const [recv, setRecv] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const manage = can(me, 'manage_purchase_orders');
  const done = () => { reload(); onChanged(); };
  const status = (to, msg, opts) => {
    const go = async () => { try { await api.post(`/inventory/orders/${id}/status${qs(sc)}`, { status: to }); toast('Order updated'); done(); } catch (x) { toast(x.message, true); } };
    if (msg) confirmAsk(msg, go, opts); else go();
  };
  const receive = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/inventory/orders/${id}/receive${qs(sc)}`, { lines: Object.entries(recv.q).map(([line_id, q]) => ({ line_id, qty: q })).filter((l) => Number(l.qty) > 0), date: recv.date });
      toast(`${r.grn_no} saved, stock updated`); setRecv(null); done();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={o ? o.po_no : 'Purchase order'} onClose={onClose}>
      {!o ? (error ? <ErrorBox>{error}</ErrorBox> : <Loading />) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '800', fontSize: 16 }}>{o.vendor || 'No vendor'}</Text><Dim>{fdate(o.order_date)}</Dim></View>
              <PoChip k={o.status} />
              {!!o.vendor_phone && <Pressable onPress={() => dial(o.vendor_phone)} hitSlop={8} accessibilityLabel="Call vendor" style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.okBg, alignItems: 'center', justifyContent: 'center' }}><Icon name="phone" size={17} color={C.ok} /></Pressable>}
            </View>
            {!!o.notes && <Dim style={{ marginTop: 8 }}>{o.notes}</Dim>}
          </Card>

          <Section title="Items" icon="box" color={ACCENT}>
            {o.lines.map((l, i) => {
              const left = l.qty - l.received_qty;
              return (
                <View key={l.id} style={{ paddingVertical: 9, borderBottomWidth: i === o.lines.length - 1 ? 0 : 1, borderColor: C.line }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>{l.name}</Text><Dim>{qty(l.qty)} {l.unit} × {rupees(l.rate)} · {qty(l.received_qty)} of {qty(l.qty)} received</Dim></View>
                    {!recv && <Text style={{ color: C.ink, fontWeight: '800' }}>{rupees(l.qty * l.rate)}</Text>}
                  </View>
                  {recv && (
                    <View style={{ marginTop: 8 }}>
                      <Field label={left > 0 ? `Received now (up to ${qty(left)} ${l.unit})` : 'Fully received'}>
                        <Input value={recv.q[l.id] ?? ''} editable={left > 0} onChangeText={(t) => setRecv({ ...recv, q: { ...recv.q, [l.id]: numText(t) } })} keyboardType="decimal-pad" placeholder={`0 / ${qty(left)}`} />
                      </Field>
                    </View>
                  )}
                </View>
              );
            })}
            <View style={{ marginTop: 6 }}><Line left="Total" right={rupees(o.total)} last /></View>
          </Section>

          {o.grns.length > 0 && (
            <Section title="Goods received" icon="check" color="#10b981">
              {o.grns.map((g, i) => <Line key={g.id} left={g.grn_no} mid={fdate(g.grn_date)} right={g.lines.map((l) => `${l.name} ${qty(l.qty)}`).join(', ')} last={i === o.grns.length - 1} />)}
            </Section>
          )}

          <ErrorBox>{err}</ErrorBox>
          {manage && (recv ? (
            <Card>
              <Field label="Received on"><DateField value={recv.date} onChange={(v) => setRecv({ ...recv, date: v })} /></Field>
              <Btn title={busy ? 'Saving...' : 'Save GRN & add to stock'} onPress={receive} disabled={busy} />
              <View style={{ marginTop: 10 }}><Btn kind="ghost" title="Cancel" onPress={() => setRecv(null)} /></View>
            </Card>
          ) : (
            <View style={{ gap: 10 }}>
              {o.status === 'pending' && <Btn title="Approve" onPress={() => status('approved')} />}
              {['approved', 'received'].includes(o.status) && <Btn title="Receive items" onPress={() => { setErr(''); setRecv({ q: Object.fromEntries(o.lines.map((l) => [l.id, String(l.qty - l.received_qty)])), date: ymd(new Date()) }); }} />}
              {['approved', 'received'].includes(o.status) && <Btn kind="ghost" title="Close order" onPress={() => status('closed', 'Close this order? Pending items will not be expected any more.', { yes: 'Close order' })} />}
              {['pending', 'approved'].includes(o.status) && <Btn kind="danger" title="Cancel order" onPress={() => status('cancelled', 'Cancel this purchase order?', { yes: 'Cancel order', danger: true })} />}
            </View>
          ))}
        </>
      )}
    </Sheet>
  );
}

export const Orders = scoped(function Orders({ me, sc }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q.trim()); const [status, setStatus] = useState(''); const [open, setOpen] = useState(''); const [adding, setAdding] = useState(false); const [shown, setShown] = useState(PAGE);
  const ordersQ = useApi(`/inventory/orders${qs({ ...sc, q: dq, status })}`); const metaQ = useMeta(sc);
  const manage = can(me, 'manage_purchase_orders'); const rows = ordersQ.data;
  if (ordersQ.error && !rows) return <Pad><ErrorBox>{ordersQ.error}</ErrorBox></Pad>;
  const all = () => { ordersQ.reload(); metaQ.reload(); };
  return (
    <View style={{ flex: 1 }}>
      <FilterBar q={q} onQ={(v) => { setQ(v); setShown(PAGE); }} placeholder="Search PO number, vendor or item" count={rows?.length}
        filters={[{ key: 'status', label: 'Order status', value: status, onChange: (v) => { setStatus(v); setShown(PAGE); }, all: 'All orders', options: Object.entries(PO).map(([value, v]) => ({ value, label: v[1] })) }]} />
      <Pad reload={all} loading={ordersQ.loading} hasData={!!rows}>
        {manage && <View style={{ marginBottom: 12 }}><Btn title="New purchase order" onPress={() => setAdding(true)} disabled={!metaQ.data} /></View>}
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>No purchase orders found.</Empty> : (
          <>
            <List>
              {more(rows, shown).map((o, i, a) => (
                <Row key={o.id} onPress={() => setOpen(o.id)} last={i === a.length - 1}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{o.po_no} <Text style={{ color: C.mute, fontWeight: '500' }}>· {o.vendor || 'No vendor'}</Text></Text>
                    <Dim>{fdate(o.order_date)}</Dim>
                    <Dim>{o.items.slice(0, 3).join(', ')}{o.items.length > 3 ? ` +${o.items.length - 3}` : ''}</Dim>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={{ color: C.ink, fontWeight: '800' }}>{rupees(o.total)}</Text><PoChip k={o.status} /></View>
                </Row>
              ))}
            </List>
            <ShowMore total={rows.length} shown={shown} onMore={() => setShown((n) => n + PAGE)} />
          </>
        )}
        {adding && metaQ.data && <NewOrder sc={sc} meta={metaQ.data} onClose={() => setAdding(false)} onSaved={all} />}
        {!!open && <OrderView me={me} sc={sc} id={open} onClose={() => setOpen('')} onChanged={all} />}
      </Pad>
    </View>
  );
});

/* ================================================================== ISSUE ITEMS */
function Recipient({ sc, value, onPick }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q.trim(), 300);
  const { data: list } = useApi(value ? null : `/inventory/recipients${qs({ ...sc, q: dq })}`);
  if (value) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.muteBg, borderRadius: 12, padding: 10 }}>
        <Avatar name={value.name} size={36} />
        <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{value.name}</Text><Dim>{value.code}{value.class ? ` · Class ${value.class}` : ''}</Dim></View>
        <Pressable onPress={() => onPick(null)} hitSlop={8}><Text style={{ color: C.brand, fontWeight: '700' }}>Change</Text></Pressable>
      </View>
    );
  }
  return (
    <View>
      <Input value={q} onChangeText={setQ} placeholder="Search student or staff by name or ID" autoCorrect={false} />
      <View style={{ marginTop: 8 }}>
        {!list ? <Dim>Searching...</Dim> : list.length === 0 ? <Soft>No one found.</Soft> : (
          <List>
            {list.map((p, i) => (
              <Row key={p.user_id} onPress={() => onPick(p)} last={i === list.length - 1}>
                <Avatar name={p.name} size={34} />
                <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{p.name}</Text><Dim>{p.code} · {p.role === 'student' ? `Class ${p.class || '-'}` : 'Staff'}</Dim></View>
              </Row>
            ))}
          </List>
        )}
      </View>
    </View>
  );
}

function IssueForm({ sc, meta, onClose, onDone }) {
  const [who, setWho] = useState(null); const [manual, setManual] = useState(''); const [lines, setLines] = useState([{ item_id: '', qty: '' }]); const [f, setF] = useState({ date: meta.today, notes: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/inventory/issues${qs(sc)}`, { user_id: who?.user_id, name: manual, date: f.date || meta.today, notes: f.notes, lines: lines.filter((l) => l.item_id) });
      toast(`${r.receipt_no} issued`); onDone(r); onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const ok = (who || manual.trim()) && lines.some((l) => l.item_id && Number(l.qty) > 0);
  return (
    <Sheet title="Issue items" onClose={onClose}>
      <Card>
        <Field req label="Issue to"><Recipient sc={sc} value={who} onPick={setWho} /></Field>
        {!who && <Field label="...or type a name / department (no account)"><Input value={manual} onChangeText={setManual} maxLength={120} placeholder="e.g. Science department" /></Field>}
      </Card>
      <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16, marginBottom: 10 }}>Items</Text>
      <LineEditor items={meta.items.filter((i) => i.qty > 0)} lines={lines} setLines={setLines} stockCap />
      <Card style={{ marginTop: 12 }}>
        <Field label="Date"><DateField value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label="Notes"><Input value={f.notes} onChangeText={(v) => setF({ ...f, notes: v })} maxLength={400} placeholder="Optional" /></Field>
      </Card>
      <ErrorBox>{err}</ErrorBox>
      <Btn title={busy ? 'Saving...' : 'Issue items'} onPress={submit} disabled={busy || !ok} />
    </Sheet>
  );
}

function IssueDetail({ me, sc, id, school, onClose, onChanged }) {
  const { data: i, error, reload } = useApi(`/inventory/issues/${id}${qs(sc)}`);
  const [ret, setRet] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const giveBack = async () => {
    setBusy(true); setErr('');
    try { await api.post(`/inventory/issues/${id}/return${qs(sc)}`, { lines: Object.entries(ret).map(([line_id, q]) => ({ line_id, qty: q })).filter((l) => Number(l.qty) > 0) }); toast('Stock updated'); setRet(null); reload(); onChanged(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={i ? i.receipt_no : 'Receipt'} onClose={onClose}>
      {!i ? (error ? <ErrorBox>{error}</ErrorBox> : <Loading />) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={i.issued_to_name} size={42} />
              <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '800', fontSize: 16 }}>{i.issued_to_name}</Text><Dim>{[i.issued_to_code, fdate(i.issue_date)].filter(Boolean).join(' · ')}</Dim></View>
            </View>
            {!!i.notes && <Dim style={{ marginTop: 8 }}>{i.notes}</Dim>}
            <View style={{ marginTop: 12 }}><Btn small kind="ghost" title="Share receipt (PDF)" onPress={() => shareReceipt(i, school)} /></View>
          </Card>
          <Section title="Items issued" icon="box" color={ACCENT}>
            {i.lines.map((l, n) => (
              <View key={l.id} style={{ paddingVertical: 9, borderBottomWidth: n === i.lines.length - 1 ? 0 : 1, borderColor: C.line }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>{l.name}</Text><Dim>{qty(l.qty)} {l.unit}{l.returned_qty ? ` · ${qty(l.returned_qty)} returned` : ''}</Dim></View>
                  {l.returned_qty >= l.qty && <Chip tone="ok">Returned</Chip>}
                </View>
                {ret && l.returned_qty < l.qty && (
                  <View style={{ marginTop: 8 }}><Field label={`Take back (up to ${qty(l.qty - l.returned_qty)} ${l.unit})`}><Input value={ret[l.id] ?? ''} onChangeText={(t) => setRet({ ...ret, [l.id]: numText(t) })} keyboardType="decimal-pad" placeholder="0" /></Field></View>
                )}
              </View>
            ))}
          </Section>
          <ErrorBox>{err}</ErrorBox>
          {can(me, 'issue_inventory') && (ret ? (
            <View style={{ gap: 10 }}><Btn title={busy ? 'Saving...' : 'Save return'} onPress={giveBack} disabled={busy || !Object.values(ret).some((v) => Number(v) > 0)} /><Btn kind="ghost" title="Cancel" onPress={() => setRet(null)} /></View>
          ) : i.lines.some((l) => l.returned_qty < l.qty) && <Btn kind="ghost" title="Take items back" onPress={() => { setErr(''); setRet({}); }} />)}
        </>
      )}
    </Sheet>
  );
}

export const IssueItems = scoped(function IssueItems({ me, sc, sid }) {
  const metaQ = useMeta(sc);
  const [q, setQ] = useState(''); const dq = useDebounced(q.trim()); const [open, setOpen] = useState(''); const [form, setForm] = useState(false); const [last, setLast] = useState(null); const [shown, setShown] = useState(PAGE);
  const listQ = useApi(`/inventory/issues${qs({ ...sc, q: dq })}`);
  const { data: schools } = useApi(me.role === 'super_admin' ? '/schools' : null);
  const school = me.school?.name || (schools || []).find((s) => s.id === sid)?.name || schools?.[0]?.name;
  const canIssue = can(me, 'issue_inventory'); const meta = metaQ.data; const rows = listQ.data;
  if (metaQ.error && !meta) return <Pad><ErrorBox>{metaQ.error}</ErrorBox></Pad>;
  if (!meta) return <Pad><Loading /></Pad>;
  const all = () => { listQ.reload(); metaQ.reload(); };
  return (
    <View style={{ flex: 1 }}>
      <SearchBox value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Search receipt, name, ID or item" />
      <Pad reload={all} loading={listQ.loading} hasData={!!rows}>
        {canIssue && <View style={{ marginBottom: 12 }}><Btn title="New issue" onPress={() => setForm(true)} /></View>}
        {last && (
          <Card>
            <Notice tone="ok"><Text style={{ fontWeight: '800' }}>{last.receipt_no}</Text> issued to {last.issued_to_name}.</Notice>
            <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Btn small kind="ghost" title="Share receipt (PDF)" onPress={() => shareReceipt(last, school)} /></View><View style={{ flex: 1 }}><Btn small kind="ghost" title="Dismiss" onPress={() => setLast(null)} /></View></View>
          </Card>
        )}
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nothing issued yet.</Empty> : (
          <>
            <List>
              {more(rows, shown).map((i, n, a) => (
                <Row key={i.id} onPress={() => setOpen(i.id)} last={n === a.length - 1}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{i.issued_to_name} <Text style={{ color: C.mute, fontWeight: '500' }}>· {i.issued_to_code}</Text></Text>
                    <Dim>{i.receipt_no} · {fdate(i.issue_date)}</Dim>
                    <Dim>{i.items.slice(0, 3).join(', ')}{i.items.length > 3 ? ` +${i.items.length - 3}` : ''}</Dim>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}><Text style={{ color: C.ink, fontWeight: '800' }}>{qty(i.qty)}</Text><Dim>{i.returned ? `${qty(i.returned)} returned` : 'issued'}</Dim></View>
                </Row>
              ))}
            </List>
            <ShowMore total={rows.length} shown={shown} onMore={() => setShown((n) => n + PAGE)} />
          </>
        )}
        {form && <IssueForm sc={sc} meta={meta} onClose={() => setForm(false)} onDone={(r) => { setLast(r); all(); }} />}
        {!!open && <IssueDetail me={me} sc={sc} id={open} school={school} onClose={() => setOpen('')} onChanged={all} />}
      </Pad>
    </View>
  );
});

/* ================================================================== REPORTS */
export const InventoryReports = scoped(function InventoryReports({ me, sc }) {
  const stockOk = can(me, 'view_inventory', 'manage_inventory');
  const [tab, setTab] = useState(stockOk ? 'stock' : 'issues'); const [store, setStore] = useState(''); const [cat, setCat] = useState(''); const [type, setType] = useState(''); const [lowOnly, setLowOnly] = useState(false);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [shown, setShown] = useState(PAGE);
  const metaQ = useMeta(sc);
  const stockQ = useApi(tab === 'stock' && stockOk ? `/inventory/reports/stock${qs(sc)}` : null);
  const issQ = useApi(tab === 'issues' ? `/inventory/reports/issues${qs({ ...sc, from, to })}` : null);
  const meta = metaQ.data; const stock = stockQ.data; const iss = issQ.data;
  const rows = (stock || []).filter((i) => (!store || i.store_id === store) && (!cat || i.category_id === cat) && (!type || i.item_type === type) && (!lowOnly || i.status !== 'in'));
  const total = rows.reduce((s, i) => s + i.value, 0);
  const err = tab === 'stock' ? stockQ.error : issQ.error; const cur = tab === 'stock' ? stockQ : issQ;
  const exportStock = () => shareCsv('inventory-stock.csv', [['Item', 'Store', 'Category', 'Type', 'Unit', 'Stock', 'Reorder level', 'Rate', 'Value', 'Status'], ...rows.map((i) => [i.name, i.store, i.category, i.item_type, i.unit, i.qty, i.reorder_level, i.rate, i.value, STOCK[i.status][1]])]);
  const exportIssues = () => shareCsv('inventory-issues.csv', [['Receipt', 'Date', 'Issued to', 'Code', 'Item', 'Qty', 'Returned'], ...(iss || []).map((l) => [l.receipt_no, l.date, l.to, l.code, l.item, l.qty, l.returned])]);
  const pdfStock = () => sharePdfHtml(page(`<h1>Stock report</h1><h2>${esc(new Date().toLocaleDateString())}</h2><table><tr><th>Item</th><th>Store</th><th>Category</th><th>Stock</th><th>Reorder</th><th>Value</th></tr>${rows.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.store)}</td><td>${esc(i.category)}</td><td>${qty(i.qty)} ${esc(i.unit)}</td><td>${qty(i.reorder_level)}</td><td>${rupees(i.value)}</td></tr>`).join('')}</table>`), 'Stock report').catch((e) => toast(e.message, true));
  const pdfIssues = () => sharePdfHtml(page(`<h1>Issued items</h1><h2>${esc(from ? fdate(from) : 'Start')} to ${esc(to ? fdate(to) : 'today')}</h2><table><tr><th>Receipt</th><th>Date</th><th>Issued to</th><th>Item</th><th>Qty</th><th>Returned</th></tr>${(iss || []).map((l) => `<tr><td>${esc(l.receipt_no)}</td><td>${esc(fdate(l.date))}</td><td>${esc(l.to)} ${esc(l.code || '')}</td><td>${esc(l.item)}</td><td>${qty(l.qty)}</td><td>${qty(l.returned)}</td></tr>`).join('')}</table>`), 'Issue report').catch((e) => toast(e.message, true));
  const reset = (f) => (v) => { f(v); setShown(PAGE); };
  return (
    <Pad reload={() => { cur.reload(); metaQ.reload(); }} loading={cur.loading} hasData={!!(stock || iss)}>
      <View style={{ marginBottom: 12 }}><Choice value={tab} onChange={(v) => { setTab(v); setShown(PAGE); }} options={[...(stockOk ? [{ value: 'stock', label: 'Stock' }] : []), { value: 'issues', label: 'Issued & returned' }]} /></View>
      {tab === 'stock' ? (
        <>
          <FilterBar inline count={rows.length}
            filters={[
              meta && meta.stores.length > 0 && { key: 'store', label: 'Store', value: store, onChange: (v) => { reset(setStore)(v); setCat(''); }, all: 'All stores', options: meta.stores.map((x) => ({ value: x.id, label: x.name })) },
              meta && meta.categories.length > 0 && { key: 'cat', label: 'Category', value: cat, onChange: reset(setCat), all: 'All categories', options: meta.categories.filter((c) => !store || c.store_id === store).map((c) => ({ value: c.id, label: c.name })) },
              { key: 'type', label: 'Item type', value: type, onChange: reset(setType), all: 'All types', options: [{ value: 'consumable', label: 'Consumable' }, { value: 'asset', label: 'Asset' }] },
              { key: 'low', label: 'Stock level', value: lowOnly ? 'low' : '', onChange: (v) => reset(setLowOnly)(v === 'low'), all: 'All items', options: [{ value: 'low', label: 'Low / out only' }] },
            ].filter(Boolean)} />
          <View style={{ flexDirection: 'row', gap: 10, marginVertical: 10 }}><View style={{ flex: 1 }}><Btn small kind="ghost" title="Share PDF" onPress={pdfStock} disabled={!rows.length} /></View><View style={{ flex: 1 }}><Btn small kind="ghost" title="Export CSV" onPress={exportStock} disabled={!rows.length} /></View></View>
          {err && !stock ? <ErrorBox>{err}</ErrorBox> : !stock ? <Loading /> : rows.length === 0 ? <Empty>No items match.</Empty> : (
            <>
              <KpiGrid><Kpi icon="box" color={ACCENT} label="Items" value={rows.length} /><Kpi icon="rupee" color="#8b5cf6" label="Stock value" value={rupees(total)} /></KpiGrid>
              <List>
                {more(rows, shown).map((i, n, a) => (
                  <Row key={i.id} last={n === a.length - 1}>
                    <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{i.name}</Text><Dim>{i.category || '-'} · {i.store || '-'}</Dim><Dim>Reorder at {qty(i.reorder_level)} · {rupees(i.value)}</Dim></View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={{ color: C.ink, fontWeight: '800' }}>{qty(i.qty)} <Text style={{ color: C.mute, fontSize: 12, fontWeight: '500' }}>{i.unit}</Text></Text><StockChip k={i.status} /></View>
                  </Row>
                ))}
              </List>
              <ShowMore total={rows.length} shown={shown} onMore={() => setShown((n) => n + PAGE)} />
            </>
          )}
        </>
      ) : (
        <>
          <Card>
            <FilterBar inline count={iss?.length}
              filters={[
                { key: 'from', label: 'From date', type: 'date', value: from, onChange: reset(setFrom) },
                { key: 'to', label: 'To date', type: 'date', value: to, onChange: reset(setTo) },
              ]} />
            <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Btn small kind="ghost" title="Share PDF" onPress={pdfIssues} disabled={!iss?.length} /></View><View style={{ flex: 1 }}><Btn small kind="ghost" title="Export CSV" onPress={exportIssues} disabled={!iss?.length} /></View></View>
          </Card>
          {err && !iss ? <ErrorBox>{err}</ErrorBox> : !iss ? <Loading /> : iss.length === 0 ? <Empty>Nothing issued in this period.</Empty> : (
            <>
              <List>
                {more(iss, shown).map((l, n, a) => (
                  <Row key={n} last={n === a.length - 1}>
                    <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }} numberOfLines={1}>{l.item}</Text><Dim>{l.to}{l.code ? ` (${l.code})` : ''}</Dim><Dim>{l.receipt_no} · {fdate(l.date)}</Dim></View>
                    <View style={{ alignItems: 'flex-end' }}><Text style={{ color: C.ink, fontWeight: '800' }}>{qty(l.qty)} <Text style={{ color: C.mute, fontSize: 12, fontWeight: '500' }}>{l.unit}</Text></Text>{!!l.returned && <Dim>{qty(l.returned)} returned</Dim>}</View>
                  </Row>
                ))}
              </List>
              <ShowMore total={iss.length} shown={shown} onMore={() => setShown((n) => n + PAGE)} />
            </>
          )}
        </>
      )}
    </Pad>
  );
});
