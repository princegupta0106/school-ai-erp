// Transport rules that need no database (so they are easy to test and to re-use):
// validation, bus occupancy, vehicle-document expiry and the "needs attention" list.
// transport.js loads the rows and feeds them in here.
const httpError = (status, message) => Object.assign(new Error(message), { status }); // same as db.js, kept local so this file needs no database

export const SOON_DAYS = 30; // a document that expires within this many days is flagged
export const DOCS = [
  ['insurance_expiry', 'Insurance'],
  ['fitness_expiry', 'Fitness certificate'],
  ['permit_expiry', 'Permit'],
  ['puc_expiry', 'Pollution (PUC)'],
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
export const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

export const text = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
export function required(v, what, max) {
  const s = String(v ?? '').trim();
  if (!s) throw httpError(400, `${what} is required`);
  if (s.length > max) throw httpError(400, `${what} is too long (max ${max} characters)`);
  return s;
}
export function cleanTime(v, what = 'Time') {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).slice(0, 5);
  if (!TIME.test(s)) throw httpError(400, `${what} must look like 07:30`);
  return s;
}
export function cleanDate(v, what = 'Date') {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  const t = new Date(`${s}T00:00:00Z`);
  if (!DATE.test(s) || Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== s) throw httpError(400, `${what} is not a valid date`);
  return s;
}
export function cleanCapacity(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 200) throw httpError(400, 'Seats must be a whole number from 1 to 200');
  return n;
}
export const cleanPlate = (v) => { const s = text(v, 20); return s ? s.toUpperCase() : null; };
export const DIRECTIONS = ['one_way', 'two_way'];

export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

// one document: how many days are left and a simple state
export function docState(key, label, date, today) {
  const d = date ? String(date).slice(0, 10) : null;
  if (!d) return { key, label, date: null, days: null, state: 'missing' };
  const days = daysBetween(today, d);
  return { key, label, date: d, days, state: days < 0 ? 'expired' : days <= SOON_DAYS ? 'soon' : 'ok' };
}
export const vehicleDocs = (v, today) => DOCS.map(([k, label]) => docState(k, label, v[k], today));

// seats: how full is a bus?  level: ok < 90% <= warn < 100% <= full
export function occupancy(capacity, students) {
  const cap = Math.max(0, Number(capacity) || 0);
  const percent = cap ? Math.round((students / cap) * 100) : 0;
  return { students, capacity: cap, seats_left: Math.max(0, cap - students), percent, level: students > cap ? 'over' : percent >= 100 ? 'full' : percent >= 90 ? 'warn' : 'ok' };
}

// Turns the raw rows into what the screens show. Everything is worked out here, once.
//   vehicles[] {..., occupancy, docs, routes:[{id,name}]}   routes[] {..., stops:[{..., students}], students, vehicle}
export function compute({ vehicles, routes, stops, assignments }, today) {
  const stopsByRoute = new Map();
  for (const s of stops) { if (!stopsByRoute.has(s.route_id)) stopsByRoute.set(s.route_id, []); stopsByRoute.get(s.route_id).push(s); }
  const perStop = new Map(); const perRoute = new Map(); const studentsOfRoute = new Map();
  for (const a of assignments) {
    perStop.set(a.stop_id, (perStop.get(a.stop_id) || 0) + 1);
    perRoute.set(a.route_id, (perRoute.get(a.route_id) || 0) + 1);
    if (!studentsOfRoute.has(a.route_id)) studentsOfRoute.set(a.route_id, new Set());
    studentsOfRoute.get(a.route_id).add(a.student_id);
  }

  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const outVehicles = vehicles.map((v) => {
    const mine = routes.filter((r) => r.vehicle_id === v.id);
    const riders = new Set();
    mine.forEach((r) => (studentsOfRoute.get(r.id) || new Set()).forEach((s) => riders.add(s)));
    return {
      ...v,
      routes: mine.map((r) => ({ id: r.id, name: r.name })).sort((a, b) => natural(a.name, b.name)),
      occupancy: occupancy(v.capacity, riders.size),
      docs: vehicleDocs(v, today),
    };
  }).sort((a, b) => natural(a.name, b.name));

  const occOf = new Map(outVehicles.map((v) => [v.id, v.occupancy]));
  const outRoutes = routes.map((r) => {
    const v = vById.get(r.vehicle_id);
    return {
      ...r,
      vehicle: v ? { id: v.id, name: v.name, reg_no: v.reg_no, capacity: v.capacity, seats_left: occOf.get(v.id).seats_left } : null,
      students: perRoute.get(r.id) || 0,
      stops: (stopsByRoute.get(r.id) || []).slice().sort((a, b) => a.seq - b.seq).map((s) => ({
        id: s.id, route_id: s.route_id, name: s.name, seq: s.seq, pickup_time: hhmm(s.pickup_time), drop_time: hhmm(s.drop_time), students: perStop.get(s.id) || 0,
      })),
    };
  }).sort((a, b) => natural(a.name, b.name));

  const capacity = outVehicles.reduce((n, v) => n + v.occupancy.capacity, 0);
  const occupied = outVehicles.reduce((n, v) => n + v.occupancy.students, 0);
  const totals = {
    vehicles: outVehicles.length, routes: outRoutes.length, stops: stops.length,
    students: new Set(assignments.map((a) => a.student_id)).size,
    capacity, occupied, available: Math.max(0, capacity - occupied), percent: capacity ? Math.round((occupied / capacity) * 100) : 0,
  };
  return { vehicles: outVehicles, routes: outRoutes, totals, alerts: buildAlerts(outVehicles, outRoutes) };
}

// "Needs attention": most urgent first. `view` / `ref` tell the screen where to jump.
export function buildAlerts(vehicles, routes) {
  const bad = []; const warn = []; const info = [];
  for (const v of vehicles) {
    for (const d of v.docs) {
      if (d.state === 'expired') bad.push({ tone: 'bad', view: 'vehicles', ref: v.id, text: `${v.name}: ${d.label} expired ${-d.days === 0 ? 'today' : `${-d.days} day${-d.days === 1 ? '' : 's'} ago`}` });
      else if (d.state === 'soon') warn.push({ tone: 'warn', view: 'vehicles', ref: v.id, text: `${v.name}: ${d.label} ${d.days === 0 ? 'expires today' : `expires in ${d.days} day${d.days === 1 ? '' : 's'}`}` });
    }
    const o = v.occupancy;
    if (o.level === 'over') bad.push({ tone: 'bad', view: 'vehicles', ref: v.id, text: `${v.name} is over capacity (${o.students}/${o.capacity})` });
    else if (o.level === 'full') warn.push({ tone: 'warn', view: 'vehicles', ref: v.id, text: `${v.name} is full (${o.students}/${o.capacity})` });
    else if (o.level === 'warn') warn.push({ tone: 'warn', view: 'vehicles', ref: v.id, text: `${v.name} is almost full (${o.students}/${o.capacity})` });
    if (!v.routes.length) info.push({ tone: 'info', view: 'routes', ref: null, text: `${v.name} is not on any route yet` });
  }
  for (const r of routes) {
    if (!r.vehicle) warn.push({ tone: 'warn', view: 'routes', ref: r.id, text: `${r.name} has no bus${r.students ? ` (${r.students} student${r.students === 1 ? '' : 's'} on it)` : ''}` });
    if (!r.stops.length) warn.push({ tone: 'warn', view: 'routes', ref: r.id, text: `${r.name} has no stops yet` });
  }
  return [...bad, ...warn, ...info];
}

// the new stop order must contain exactly the stops the route has now
export function checkOrder(currentIds, wantedIds) {
  if (!Array.isArray(wantedIds) || wantedIds.length !== currentIds.length) throw httpError(400, 'Stop list is out of date, reload and try again');
  const have = new Set(currentIds);
  if (new Set(wantedIds).size !== wantedIds.length || wantedIds.some((i) => !have.has(i))) throw httpError(400, 'Stop list is out of date, reload and try again');
  return wantedIds;
}
