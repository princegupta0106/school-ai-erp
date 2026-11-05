// Inventory: stores, categories, vendors, items, purchase orders, GRN (receiving), issuing with receipts, reports.
// Stock only ever changes through the inv_adjust_stock() SQL function (never below zero).
import { Router } from 'express';
import { db, httpError, check, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import { todayStr, validDate } from '../attendance.js';

const r = Router();
const READ = ['view_inventory', 'manage_inventory', 'manage_purchase_orders', 'issue_inventory'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const need = (v, label) => { const s = str(v); if (!s) throw httpError(400, `${label} is required`); return s; };
const num = (v, label, { min = 0, allowZero = true } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || (!allowZero && n === 0)) throw httpError(400, `Enter a valid ${label}`);
  return Math.round(n * 100) / 100;
};
const uid = (v, label = 'item') => { if (!UUID.test(String(v || ''))) throw httpError(400, `Unknown ${label}`); return v; };
const optId = (v, label) => (v ? uid(v, label) : null);
const one = async (q) => { const { data, error } = await q.maybeSingle(); check(error); return data; };

// next running number like PO-0001 (retries if two people save at the same moment)
async function numbered(table, col, prefix, school, insertRow) {
  for (let i = 0; i < 6; i++) {
    const { count, error } = await db.from(table).select('id', { count: 'exact', head: true }).eq('school_id', school);
    check(error);
    const no = `${prefix}-${String((count || 0) + 1 + i).padStart(4, '0')}`;
    const { data, error: e2 } = await db.from(table).insert({ ...insertRow, school_id: school, [col]: no }).select('*').single();
    if (!e2) return data;
    if (e2.code !== '23505') check(e2);
  }
  throw httpError(409, 'Could not create a number, please try again');
}
const mustOwn = async (table, school, id, label) => {
  const row = await one(db.from(table).select('*').eq('id', uid(id, label)).eq('school_id', school));
  if (!row) throw httpError(404, `${label} not found`);
  return row;
};

/* ---------------------------------------------------------------- set-up data */
const loadSetup = async (school) => {
  const [s, c, v] = await Promise.all([
    db.from('inv_stores').select('id,name').eq('school_id', school).order('name'),
    db.from('inv_categories').select('id,name,store_id').eq('school_id', school).order('name'),
    db.from('inv_vendors').select('id,name,category,phone,email,address,notes').eq('school_id', school).order('name'),
  ]);
  check(s.error); check(c.error); check(v.error);
  return { stores: s.data, categories: c.data, vendors: v.data };
};
const loadItems = async (school) => {
  const all = []; // page through (default API limit is 1000)
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('inv_items').select('id,name,store_id,category_id,item_type,unit,qty,reorder_level,rate').eq('school_id', school).order('name').range(from, from + 999);
    check(error); all.push(...data); if (data.length < 1000) break;
  }
  return all.map((i) => ({ ...i, qty: Number(i.qty), reorder_level: Number(i.reorder_level), rate: Number(i.rate), status: Number(i.qty) <= 0 ? 'out' : Number(i.qty) <= Number(i.reorder_level) ? 'low' : 'in' }));
};

r.get('/meta', requireFeature(...READ), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const [setup, items] = await Promise.all([loadSetup(school), loadItems(school)]);
  res.json({ ...setup, items, today: todayStr() });
}));

// simple add / rename / delete for the three set-up lists
const simple = (path, table, fields) => {
  r.post(`/${path}`, requireFeature('manage_inventory'), asyncH(async (req, res) => {
    const school = schoolOf(req); const b = body(req);
    const row = { school_id: school, name: need(b.name, 'Name') };
    for (const f of fields) row[f] = f === 'store_id' ? optId(b[f], 'store') : str(b[f], 300) || null;
    const { data, error } = await db.from(table).insert(row).select('*').single(); check(error);
    res.status(201).json(data);
  }));
  r.patch(`/${path}/:id`, requireFeature('manage_inventory'), asyncH(async (req, res) => {
    const school = schoolOf(req); const b = body(req); const patch = {};
    if (b.name !== undefined) patch.name = need(b.name, 'Name');
    for (const f of fields) if (b[f] !== undefined) patch[f] = f === 'store_id' ? optId(b[f], 'store') : str(b[f], 300) || null;
    const { data, error } = await db.from(table).update(patch).eq('id', uid(req.params.id, 'record')).eq('school_id', school).select('*').single(); check(error);
    res.json(data);
  }));
  r.delete(`/${path}/:id`, requireFeature('manage_inventory'), asyncH(async (req, res) => {
    const school = schoolOf(req);
    check((await db.from(table).delete().eq('id', uid(req.params.id, 'record')).eq('school_id', school)).error);
    res.json({ ok: true });
  }));
};
simple('stores', 'inv_stores', []);
simple('categories', 'inv_categories', ['store_id']);
simple('vendors', 'inv_vendors', ['category', 'phone', 'email', 'address', 'notes']);

/* ---------------------------------------------------------------- items */
const itemRow = (b, school) => ({
  school_id: school, name: need(b.name, 'Item name'),
  store_id: optId(b.store_id, 'store'), category_id: optId(b.category_id, 'category'),
  item_type: b.item_type === 'asset' ? 'asset' : 'consumable', unit: str(b.unit, 20) || 'Nos',
  qty: num(b.qty ?? 0, 'quantity'), reorder_level: num(b.reorder_level ?? 0, 'reorder level'), rate: num(b.rate ?? 0, 'rate'),
});
r.post('/items', requireFeature('manage_inventory'), asyncH(async (req, res) => {
  const { data, error } = await db.from('inv_items').insert(itemRow(body(req), schoolOf(req))).select('*').single(); check(error);
  res.status(201).json(data);
}));
// add many items at once: { items: [{name, ...}] }  (a bad row stops the whole batch, nothing half-saved)
r.post('/items/bulk', requireFeature('manage_inventory'), asyncH(async (req, res) => {
  const school = schoolOf(req); const list = Array.isArray(body(req).items) ? body(req).items : [];
  if (!list.length) throw httpError(400, 'Add at least one item');
  if (list.length > 300) throw httpError(400, 'Add up to 300 items at a time');
  const rows = list.map((b, i) => { try { return itemRow(b, school); } catch (e) { throw httpError(400, `Row ${i + 1}: ${e.message}`); } });
  const { data, error } = await db.from('inv_items').insert(rows).select('id'); check(error);
  res.status(201).json({ added: data.length });
}));
r.patch('/items/:id', requireFeature('manage_inventory'), asyncH(async (req, res) => {
  const school = schoolOf(req); const b = body(req); const old = await mustOwn('inv_items', school, req.params.id, 'Item');
  const next = itemRow({ ...old, ...b }, school); delete next.school_id;
  if (b.qty === undefined) delete next.qty; // stock changes by receiving / issuing; an explicit qty is a manual correction
  const { data, error } = await db.from('inv_items').update(next).eq('id', old.id).select('*').single(); check(error);
  res.json(data);
}));
r.delete('/items/:id', requireFeature('manage_inventory'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const { error } = await db.from('inv_items').delete().eq('id', uid(req.params.id)).eq('school_id', school);
  if (error?.code === '23503') throw httpError(409, 'This item has orders or issues against it, so it cannot be deleted');
  check(error); res.json({ ok: true });
}));

/* ---------------------------------------------------------------- overview */
r.get('/overview', requireFeature(...READ), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const [setup, items, ord, iss] = await Promise.all([
    loadSetup(school), loadItems(school),
    db.from('inv_orders').select('id,po_no,order_date,status,inv_vendors(name),inv_order_lines(qty,rate)').eq('school_id', school).order('created_at', { ascending: false }).limit(60),
    db.from('inv_issues').select('id,receipt_no,issued_to_name,issued_to_code,issue_date,inv_issue_lines(qty)').eq('school_id', school).order('created_at', { ascending: false }).limit(8),
  ]);
  check(ord.error); check(iss.error);
  const orders = ord.data.map((o) => ({ id: o.id, po_no: o.po_no, order_date: o.order_date, status: o.status, vendor: o.inv_vendors?.name || '', total: o.inv_order_lines.reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0) }));
  const count = (st) => orders.filter((o) => o.status === st).length;
  res.json({
    stats: { items: items.length, categories: setup.categories.length, stores: setup.stores.length, vendors: setup.vendors.length, low: items.filter((i) => i.status === 'low').length, out: items.filter((i) => i.status === 'out').length, in_stock: items.filter((i) => i.status === 'in').length, value: items.reduce((s, i) => s + i.qty * i.rate, 0) },
    low_items: items.filter((i) => i.status !== 'in').sort((a, b) => a.qty - b.qty).slice(0, 8),
    by_category: Object.values(items.reduce((m, i) => { const k = i.category_id || 'none'; (m[k] ||= { id: k, name: setup.categories.find((c) => c.id === k)?.name || 'Uncategorised', qty: 0 }).qty += i.qty; return m; }, {})).sort((a, b) => b.qty - a.qty).slice(0, 8),
    orders: { total: orders.length, pending: count('pending'), approved: count('approved'), received: count('received') + count('closed'), recent: orders.slice(0, 5) },
    recent_issues: iss.data.map((i) => ({ id: i.id, receipt_no: i.receipt_no, issued_to_name: i.issued_to_name, issued_to_code: i.issued_to_code, issue_date: i.issue_date, items: i.inv_issue_lines.length })),
  });
}));

/* ---------------------------------------------------------------- purchase orders */
const loadOrder = async (school, id) => {
  const o = await one(db.from('inv_orders').select('id,po_no,order_date,status,notes,vendor_id,created_at,inv_vendors(name,phone),inv_order_lines(id,item_id,qty,rate,received_qty,inv_items(name,unit))').eq('id', uid(id, 'order')).eq('school_id', school));
  if (!o) throw httpError(404, 'Order not found');
  const lines = o.inv_order_lines.map((l) => ({ id: l.id, item_id: l.item_id, name: l.inv_items?.name || '', unit: l.inv_items?.unit || '', qty: Number(l.qty), rate: Number(l.rate), received_qty: Number(l.received_qty) }));
  const grns = await db.from('inv_grns').select('id,grn_no,grn_date,notes,inv_grn_lines(qty,inv_items(name,unit))').eq('order_id', o.id).order('created_at'); check(grns.error);
  return { id: o.id, po_no: o.po_no, order_date: o.order_date, status: o.status, notes: o.notes, vendor_id: o.vendor_id, vendor: o.inv_vendors?.name || '', vendor_phone: o.inv_vendors?.phone || '', lines, total: lines.reduce((s, l) => s + l.qty * l.rate, 0),
    grns: grns.data.map((g) => ({ id: g.id, grn_no: g.grn_no, grn_date: g.grn_date, notes: g.notes, lines: g.inv_grn_lines.map((l) => ({ name: l.inv_items?.name, unit: l.inv_items?.unit, qty: Number(l.qty) })) })) };
};

r.get('/orders', requireFeature(...READ), asyncH(async (req, res) => {
  const school = schoolOf(req);
  let q = db.from('inv_orders').select('id,po_no,order_date,status,vendor_id,inv_vendors(name),inv_order_lines(qty,rate,received_qty,inv_items(name))').eq('school_id', school).order('order_date', { ascending: false }).order('created_at', { ascending: false }).limit(300);
  if (req.query.status) q = q.eq('status', str(req.query.status, 20));
  if (req.query.from) q = q.gte('order_date', validDate(req.query.from));
  if (req.query.to) q = q.lte('order_date', validDate(req.query.to));
  const { data, error } = await q; check(error);
  const text = str(req.query.q, 60).toLowerCase();
  const rows = data.map((o) => ({ id: o.id, po_no: o.po_no, order_date: o.order_date, status: o.status, vendor: o.inv_vendors?.name || '', items: o.inv_order_lines.map((l) => l.inv_items?.name).filter(Boolean),
    total: o.inv_order_lines.reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0), ordered: o.inv_order_lines.reduce((s, l) => s + Number(l.qty), 0), received: o.inv_order_lines.reduce((s, l) => s + Number(l.received_qty), 0) }))
    .filter((o) => !text || `${o.po_no} ${o.vendor} ${o.items.join(' ')}`.toLowerCase().includes(text));
  res.json(rows);
}));
r.get('/orders/:id', requireFeature(...READ), asyncH(async (req, res) => res.json(await loadOrder(schoolOf(req), req.params.id))));

const cleanLines = async (school, raw, withRate = true) => {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) throw httpError(400, 'Add at least one item');
  const merged = new Map();
  for (const l of list) {
    const id = uid(l.item_id); const q = num(l.qty, 'quantity', { allowZero: false });
    const prev = merged.get(id); merged.set(id, { item_id: id, qty: (prev?.qty || 0) + q, rate: withRate ? num(l.rate ?? 0, 'rate') : undefined });
  }
  const { data, error } = await db.from('inv_items').select('id,name,qty').eq('school_id', school).in('id', [...merged.keys()]); check(error);
  if (data.length !== merged.size) throw httpError(400, 'One of the items does not exist any more');
  return { lines: [...merged.values()], items: new Map(data.map((i) => [i.id, i])) };
};

r.post('/orders', requireFeature('manage_purchase_orders'), asyncH(async (req, res) => {
  const school = schoolOf(req); const b = body(req);
  const { lines } = await cleanLines(school, b.lines);
  if (b.vendor_id) await mustOwn('inv_vendors', school, b.vendor_id, 'Vendor');
  const order = await numbered('inv_orders', 'po_no', 'PO', school, { vendor_id: optId(b.vendor_id, 'vendor'), order_date: validDate(b.date || todayStr()), notes: str(b.notes, 400) || null, created_by: req.user.user_id });
  const ins = await db.from('inv_order_lines').insert(lines.map((l) => ({ order_id: order.id, item_id: l.item_id, qty: l.qty, rate: l.rate }))); 
  if (ins.error) { await db.from('inv_orders').delete().eq('id', order.id); check(ins.error); }
  res.status(201).json(await loadOrder(school, order.id));
}));

// approve / cancel / close (close = stop waiting for the rest of a part-delivered order)
r.post('/orders/:id/status', requireFeature('manage_purchase_orders'), asyncH(async (req, res) => {
  const school = schoolOf(req); const o = await mustOwn('inv_orders', school, req.params.id, 'Order');
  const to = str(body(req).status, 20);
  const ok = { approved: ['pending'], cancelled: ['pending', 'approved'], closed: ['approved', 'received'] };
  if (!ok[to]) throw httpError(400, 'Unknown status');
  if (!ok[to].includes(o.status)) throw httpError(409, `A ${o.status} order cannot be set to ${to}`);
  check((await db.from('inv_orders').update({ status: to }).eq('id', o.id)).error);
  res.json(await loadOrder(school, o.id));
}));
r.delete('/orders/:id', requireFeature('manage_purchase_orders'), asyncH(async (req, res) => {
  const school = schoolOf(req); const o = await mustOwn('inv_orders', school, req.params.id, 'Order');
  if (!['pending', 'cancelled'].includes(o.status)) throw httpError(409, 'Only pending or cancelled orders can be deleted');
  check((await db.from('inv_orders').delete().eq('id', o.id)).error); res.json({ ok: true });
}));

// GRN: record what arrived, add it to stock, close the PO once everything is in.  { lines:[{line_id, qty}], date, notes }
r.post('/orders/:id/receive', requireFeature('manage_purchase_orders'), asyncH(async (req, res) => {
  const school = schoolOf(req); const b = body(req); const o = await mustOwn('inv_orders', school, req.params.id, 'Order');
  if (!['approved', 'received'].includes(o.status)) throw httpError(409, o.status === 'pending' ? 'Approve the order before receiving items' : `A ${o.status} order cannot receive items`);
  const full = await loadOrder(school, o.id);
  const got = (Array.isArray(b.lines) ? b.lines : []).map((l) => ({ line: full.lines.find((x) => x.id === l.line_id), qty: Number(l.qty) })).filter((x) => x.line && x.qty > 0);
  if (!got.length) throw httpError(400, 'Enter the quantity received for at least one item');
  for (const g of got) { num(g.qty, 'quantity', { allowZero: false }); if (g.qty > g.line.qty - g.line.received_qty + 1e-9) throw httpError(400, `${g.line.name}: only ${g.line.qty - g.line.received_qty} still pending`); }
  const grn = await numbered('inv_grns', 'grn_no', 'GRN', school, { order_id: o.id, vendor_id: o.vendor_id, grn_date: validDate(b.date || todayStr()), notes: str(b.notes, 400) || null, created_by: req.user.user_id });
  const done = []; // stock moves are undone if a later step fails
  try {
    check((await db.from('inv_grn_lines').insert(got.map((g) => ({ grn_id: grn.id, item_id: g.line.item_id, qty: g.qty })))).error);
    for (const g of got) {
      check((await db.rpc('inv_adjust_stock', { p_item: g.line.item_id, p_delta: g.qty })).error); done.push(g);
      check((await db.from('inv_order_lines').update({ received_qty: g.line.received_qty + g.qty }).eq('id', g.line.id)).error);
    }
  } catch (e) {
    for (const g of done) await db.rpc('inv_adjust_stock', { p_item: g.line.item_id, p_delta: -g.qty });
    await db.from('inv_grns').delete().eq('id', grn.id); throw e;
  }
  const after = await loadOrder(school, o.id);
  const complete = after.lines.every((l) => l.received_qty + 1e-9 >= l.qty);
  check((await db.from('inv_orders').update({ status: complete ? 'closed' : 'received' }).eq('id', o.id)).error);
  res.status(201).json({ grn_no: grn.grn_no, order: await loadOrder(school, o.id) });
}));

/* ---------------------------------------------------------------- issuing */
// who can receive items: students and staff of this school
r.get('/recipients', requireFeature('issue_inventory'), asyncH(async (req, res) => {
  const school = schoolOf(req); const q = str(req.query.q, 40).replace(/[%,()]/g, ' ').trim();
  let query = db.from('profiles').select('user_id,full_name,admission_no,classes(name,section),users!inner(login_id,role,is_active)').eq('school_id', school).eq('users.is_active', true).in('users.role', ['student', 'staff', 'other', 'school_admin']).order('full_name').limit(25);
  if (q) query = query.or(`full_name.ilike.%${q}%,admission_no.ilike.%${q}%`);
  const { data, error } = await query; check(error);
  res.json(data.map((p) => ({ user_id: p.user_id, name: p.full_name || p.users.login_id, code: p.admission_no || p.users.login_id, role: p.users.role, class: p.classes ? `${p.classes.name}${p.classes.section ? ` ${p.classes.section}` : ''}` : '' })));
}));

const loadIssue = async (school, id) => {
  const i = await one(db.from('inv_issues').select('id,receipt_no,issued_to,issued_to_name,issued_to_code,issue_date,notes,created_at,inv_issue_lines(id,item_id,qty,returned_qty,inv_items(name,unit))').eq('id', uid(id, 'issue')).eq('school_id', school));
  if (!i) throw httpError(404, 'Receipt not found');
  return { id: i.id, receipt_no: i.receipt_no, issued_to: i.issued_to, issued_to_name: i.issued_to_name, issued_to_code: i.issued_to_code, issue_date: i.issue_date, notes: i.notes,
    lines: i.inv_issue_lines.map((l) => ({ id: l.id, item_id: l.item_id, name: l.inv_items?.name || '', unit: l.inv_items?.unit || '', qty: Number(l.qty), returned_qty: Number(l.returned_qty) })) };
};
r.get('/issues', requireFeature(...READ), asyncH(async (req, res) => {
  const school = schoolOf(req);
  let q = db.from('inv_issues').select('id,receipt_no,issued_to_name,issued_to_code,issue_date,inv_issue_lines(qty,returned_qty,inv_items(name))').eq('school_id', school).order('issue_date', { ascending: false }).order('created_at', { ascending: false }).limit(300);
  if (req.query.from) q = q.gte('issue_date', validDate(req.query.from));
  if (req.query.to) q = q.lte('issue_date', validDate(req.query.to));
  const { data, error } = await q; check(error);
  const text = str(req.query.q, 60).toLowerCase();
  res.json(data.map((i) => ({ id: i.id, receipt_no: i.receipt_no, issued_to_name: i.issued_to_name, issued_to_code: i.issued_to_code, issue_date: i.issue_date, items: i.inv_issue_lines.map((l) => l.inv_items?.name).filter(Boolean), qty: i.inv_issue_lines.reduce((s, l) => s + Number(l.qty), 0), returned: i.inv_issue_lines.reduce((s, l) => s + Number(l.returned_qty), 0) }))
    .filter((i) => !text || `${i.receipt_no} ${i.issued_to_name} ${i.issued_to_code || ''} ${i.items.join(' ')}`.toLowerCase().includes(text)));
}));
r.get('/issues/:id', requireFeature(...READ), asyncH(async (req, res) => res.json(await loadIssue(schoolOf(req), req.params.id))));

// { user_id, lines:[{item_id, qty}], date, notes }  - or a name typed in (visitor / department) when there is no account
r.post('/issues', requireFeature('issue_inventory'), asyncH(async (req, res) => {
  const school = schoolOf(req); const b = body(req);
  const { lines, items } = await cleanLines(school, b.lines, false);
  for (const l of lines) { const it = items.get(l.item_id); if (Number(it.qty) < l.qty) throw httpError(400, `${it.name}: only ${Number(it.qty)} in stock`); }
  let name = str(b.name, 120); let code = str(b.code, 40) || null; let userId = null;
  if (b.user_id) {
    const p = await one(db.from('profiles').select('user_id,full_name,admission_no,users!inner(login_id)').eq('user_id', uid(b.user_id, 'person')).eq('school_id', school));
    if (!p) throw httpError(404, 'Person not found');
    userId = p.user_id; name = p.full_name || p.users.login_id; code = p.admission_no || p.users.login_id;
  }
  if (!name) throw httpError(400, 'Choose who the items are issued to');
  const issue = await numbered('inv_issues', 'receipt_no', 'ISS', school, { issued_to: userId, issued_to_name: name, issued_to_code: code, issue_date: validDate(b.date || todayStr()), notes: str(b.notes, 400) || null, created_by: req.user.user_id });
  const done = [];
  try {
    check((await db.from('inv_issue_lines').insert(lines.map((l) => ({ issue_id: issue.id, item_id: l.item_id, qty: l.qty })))).error);
    for (const l of lines) { check((await db.rpc('inv_adjust_stock', { p_item: l.item_id, p_delta: -l.qty })).error); done.push(l); }
  } catch (e) {
    for (const l of done) await db.rpc('inv_adjust_stock', { p_item: l.item_id, p_delta: l.qty });
    await db.from('inv_issues').delete().eq('id', issue.id); throw e;
  }
  res.status(201).json(await loadIssue(school, issue.id));
}));

// { lines:[{line_id, qty}] } put returned items back into stock
r.post('/issues/:id/return', requireFeature('issue_inventory'), asyncH(async (req, res) => {
  const school = schoolOf(req); const issue = await loadIssue(school, req.params.id);
  const back = (Array.isArray(body(req).lines) ? body(req).lines : []).map((l) => ({ line: issue.lines.find((x) => x.id === l.line_id), qty: Number(l.qty) })).filter((x) => x.line && x.qty > 0);
  if (!back.length) throw httpError(400, 'Enter a quantity to take back');
  for (const g of back) { num(g.qty, 'quantity', { allowZero: false }); if (g.qty > g.line.qty - g.line.returned_qty + 1e-9) throw httpError(400, `${g.line.name}: only ${g.line.qty - g.line.returned_qty} can be returned`); }
  for (const g of back) {
    check((await db.rpc('inv_adjust_stock', { p_item: g.line.item_id, p_delta: g.qty })).error);
    check((await db.from('inv_issue_lines').update({ returned_qty: g.line.returned_qty + g.qty }).eq('id', g.line.id)).error);
  }
  res.json(await loadIssue(school, issue.id));
}));

/* ---------------------------------------------------------------- reports (stock list + issue history; the web app prints / exports CSV) */
r.get('/reports/stock', requireFeature('view_inventory', 'manage_inventory'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  const [setup, items] = await Promise.all([loadSetup(school), loadItems(school)]);
  const st = new Map(setup.stores.map((s) => [s.id, s.name])); const ct = new Map(setup.categories.map((c) => [c.id, c.name]));
  res.json(items.map((i) => ({ ...i, store: st.get(i.store_id) || '', category: ct.get(i.category_id) || '', value: Math.round(i.qty * i.rate * 100) / 100 })));
}));
r.get('/reports/issues', requireFeature('view_inventory', 'issue_inventory'), asyncH(async (req, res) => {
  const school = schoolOf(req);
  let q = db.from('inv_issue_lines').select('qty,returned_qty,inv_items(name,unit),inv_issues!inner(receipt_no,issued_to_name,issued_to_code,issue_date,school_id)').eq('inv_issues.school_id', school).order('id').limit(2000);
  if (req.query.from) q = q.gte('inv_issues.issue_date', validDate(req.query.from));
  if (req.query.to) q = q.lte('inv_issues.issue_date', validDate(req.query.to));
  const { data, error } = await q; check(error);
  res.json(data.map((l) => ({ receipt_no: l.inv_issues.receipt_no, date: l.inv_issues.issue_date, to: l.inv_issues.issued_to_name, code: l.inv_issues.issued_to_code, item: l.inv_items?.name, unit: l.inv_items?.unit, qty: Number(l.qty), returned: Number(l.returned_qty) }))
    .sort((a, b) => b.date.localeCompare(a.date)));
}));

export default r;
