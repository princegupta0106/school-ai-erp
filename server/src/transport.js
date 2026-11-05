// Transport: buses, routes, stops and which student rides where.
// Routes (routes/transport.js) only check the permission and call these functions.
// Simple rules, always the same:
//   * a route is run by ONE bus (or none yet) and has ordered stops
//   * a student can ride several routes, but each route only once; every ride has a stop on that route
//   * a bus can never hold more students than its seats (a student on two routes of one bus uses ONE seat)
//   * a stop that students use, or a bus that is on a route, can't vanish silently
import { db, httpError, check } from './db.js';
import { todayStr } from './attendance.js';
import * as L from './transportLogic.js';

const one = (x) => (Array.isArray(x) ? x[0] : x);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v) => typeof v === 'string' && UUID.test(v);
const uniq = (e, msg) => { if (e?.code === '23505') throw httpError(409, msg); check(e); };

async function fetchAll(make) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    check(error);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// ---------------------------------------------------------------- reading
async function snapshot(school) {
  const [v, r, s, assignments] = await Promise.all([
    db.from('transport_vehicles').select('*').eq('school_id', school),
    db.from('transport_routes').select('*').eq('school_id', school),
    db.from('transport_stops').select('*').eq('school_id', school),
    fetchAll(() => db.from('transport_assignments').select('id,student_id,route_id,stop_id').eq('school_id', school).order('id')),
  ]);
  check(v.error); check(r.error); check(s.error);
  return { vehicles: v.data, routes: r.data, stops: s.data, assignments };
}
export const loadAll = async (school) => L.compute(await snapshot(school), todayStr());

export async function overview(school) {
  const a = await loadAll(school);
  return {
    today: todayStr(), totals: a.totals, alerts: a.alerts,
    vehicles: a.vehicles.map((v) => ({ id: v.id, name: v.name, reg_no: v.reg_no, occupancy: v.occupancy, routes: v.routes })),
    routes: a.routes.map((r) => ({ id: r.id, name: r.name, zone: r.zone, direction: r.direction, vehicle: r.vehicle, students: r.students, stops: r.stops.length })),
  };
}

// ---------------------------------------------------------------- vehicles
async function getVehicle(school, id) {
  if (!isId(id)) throw httpError(404, 'Bus not found');
  const { data, error } = await db.from('transport_vehicles').select('*').eq('id', id).eq('school_id', school).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Bus not found');
  return data;
}
const vehicleFields = (b, partial) => {
  const o = {}; const has = (k) => !partial || b[k] !== undefined;
  if (has('name')) o.name = L.required(b.name, 'Bus name', 60);
  if (has('reg_no')) o.reg_no = L.cleanPlate(b.reg_no);
  if (has('capacity')) o.capacity = L.cleanCapacity(b.capacity ?? 40);
  for (const k of ['driver_name', 'attendant_name']) if (has(k)) o[k] = L.text(b[k], 80);
  for (const k of ['driver_phone', 'attendant_phone']) if (has(k)) o[k] = L.text(b[k], 20);
  for (const [k, label] of L.DOCS) if (has(k)) o[k] = L.cleanDate(b[k], label);
  if (has('notes')) o.notes = L.text(b.notes, 500);
  return o;
};
export async function createVehicle(school, b) {
  const { data, error } = await db.from('transport_vehicles').insert({ school_id: school, ...vehicleFields(b, false) }).select('*').single();
  uniq(error, 'A bus with that name already exists');
  return data;
}
export async function updateVehicle(school, id, b) {
  const cur = await getVehicle(school, id);
  const f = vehicleFields(b, true);
  if (f.capacity !== undefined && f.capacity !== cur.capacity) {
    const riders = (await loadAll(school)).vehicles.find((v) => v.id === id)?.occupancy.students || 0;
    if (f.capacity < riders) throw httpError(400, `${cur.name} carries ${riders} student${riders === 1 ? '' : 's'}, so it needs at least ${riders} seats. Move some students first.`);
  }
  if (!Object.keys(f).length) return cur;
  const { data, error } = await db.from('transport_vehicles').update({ ...f, updated_at: new Date().toISOString() }).eq('id', id).eq('school_id', school).select('*').single();
  uniq(error, 'A bus with that name already exists');
  return data;
}
export async function deleteVehicle(school, id) {
  const cur = await getVehicle(school, id);
  check((await db.from('transport_vehicles').delete().eq('id', id).eq('school_id', school)).error); // its routes stay, just without a bus
  return { ok: true, name: cur.name };
}

// ---------------------------------------------------------------- routes
async function getRoute(school, id) {
  if (!isId(id)) throw httpError(404, 'Route not found');
  const { data, error } = await db.from('transport_routes').select('*').eq('id', id).eq('school_id', school).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Route not found');
  return data;
}
async function checkVehicle(school, vehicleId) {
  if (!vehicleId) return null;
  return getVehicle(school, vehicleId);
}
// the students of a bus, plus those of one more route: must fit the seats
async function assertFits(school, vehicle, routeId) {
  const snap = await snapshot(school);
  const routeIds = new Set(snap.routes.filter((r) => r.vehicle_id === vehicle.id).map((r) => r.id));
  routeIds.add(routeId);
  const riders = new Set(snap.assignments.filter((a) => routeIds.has(a.route_id)).map((a) => a.student_id));
  if (riders.size > vehicle.capacity) throw httpError(409, `${vehicle.name} has ${vehicle.capacity} seats but this would put ${riders.size} students on it. Pick another bus or add seats first.`);
}
export async function createRoute(school, b) {
  const vehicle = await checkVehicle(school, b.vehicle_id || null);
  const dir = b.direction || 'two_way';
  if (!L.DIRECTIONS.includes(dir)) throw httpError(400, 'Direction must be one-way or two-way');
  const { data, error } = await db.from('transport_routes').insert({ school_id: school, name: L.required(b.name, 'Route name', 60), zone: L.text(b.zone, 60), direction: dir, vehicle_id: vehicle?.id || null }).select('*').single();
  uniq(error, 'A route with that name already exists');
  return data;
}
export async function updateRoute(school, id, b) {
  const cur = await getRoute(school, id);
  const f = {};
  if (b.name !== undefined) f.name = L.required(b.name, 'Route name', 60);
  if (b.zone !== undefined) f.zone = L.text(b.zone, 60);
  if (b.direction !== undefined) { if (!L.DIRECTIONS.includes(b.direction)) throw httpError(400, 'Direction must be one-way or two-way'); f.direction = b.direction; }
  if (b.vehicle_id !== undefined) {
    const v = await checkVehicle(school, b.vehicle_id || null);
    f.vehicle_id = v?.id || null;
    if (v && v.id !== cur.vehicle_id) await assertFits(school, v, id);
  }
  if (!Object.keys(f).length) return cur;
  const { data, error } = await db.from('transport_routes').update({ ...f, updated_at: new Date().toISOString() }).eq('id', id).eq('school_id', school).select('*').single();
  uniq(error, 'A route with that name already exists');
  return data;
}
export async function deleteRoute(school, id) {
  const cur = await getRoute(school, id);
  const { count } = await db.from('transport_assignments').select('id', { count: 'exact', head: true }).eq('route_id', id);
  if (count) throw httpError(409, `${count} student${count === 1 ? ' rides' : 's ride'} ${cur.name}. Remove them from the route first.`);
  check((await db.from('transport_routes').delete().eq('id', id).eq('school_id', school)).error);
  return { ok: true, name: cur.name };
}

// ---------------------------------------------------------------- stops
async function getStop(school, id) {
  if (!isId(id)) throw httpError(404, 'Stop not found');
  const { data, error } = await db.from('transport_stops').select('*').eq('id', id).eq('school_id', school).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Stop not found');
  return data;
}
export async function addStop(school, routeId, b) {
  await getRoute(school, routeId);
  const { data: last } = await db.from('transport_stops').select('seq').eq('route_id', routeId).order('seq', { ascending: false }).limit(1);
  const seq = (last?.[0]?.seq || 0) + 1;
  const { data, error } = await db.from('transport_stops').insert({ school_id: school, route_id: routeId, seq, name: L.required(b.name, 'Stop name', 80), pickup_time: L.cleanTime(b.pickup_time, 'Pick-up time'), drop_time: L.cleanTime(b.drop_time, 'Drop time') }).select('*').single();
  check(error);
  return data;
}
export async function updateStop(school, id, b) {
  const cur = await getStop(school, id);
  const f = {};
  if (b.name !== undefined) f.name = L.required(b.name, 'Stop name', 80);
  if (b.pickup_time !== undefined) f.pickup_time = L.cleanTime(b.pickup_time, 'Pick-up time');
  if (b.drop_time !== undefined) f.drop_time = L.cleanTime(b.drop_time, 'Drop time');
  if (!Object.keys(f).length) return cur;
  const { data, error } = await db.from('transport_stops').update(f).eq('id', id).eq('school_id', school).select('*').single();
  check(error);
  return data;
}
async function resequence(routeId) {
  const { data, error } = await db.from('transport_stops').select('id').eq('route_id', routeId).order('seq');
  check(error);
  for (let i = 0; i < data.length; i += 1) check((await db.from('transport_stops').update({ seq: i + 1 }).eq('id', data[i].id)).error);
}
export async function deleteStop(school, id) {
  const cur = await getStop(school, id);
  const { count } = await db.from('transport_assignments').select('id', { count: 'exact', head: true }).eq('stop_id', id);
  if (count) throw httpError(409, `${count} student${count === 1 ? ' uses' : 's use'} the stop "${cur.name}". Move them to another stop first.`);
  check((await db.from('transport_stops').delete().eq('id', id).eq('school_id', school)).error);
  await resequence(cur.route_id);
  return { ok: true, name: cur.name };
}
export async function reorderStops(school, routeId, ids) {
  await getRoute(school, routeId);
  const { data, error } = await db.from('transport_stops').select('id').eq('route_id', routeId).eq('school_id', school);
  check(error);
  const order = L.checkOrder(data.map((s) => s.id), ids);
  for (let i = 0; i < order.length; i += 1) check((await db.from('transport_stops').update({ seq: i + 1 }).eq('id', order[i])).error);
  return { ok: true };
}

// ---------------------------------------------------------------- students on transport
const classLabel = (c) => (c ? `${c.name}${c.section ? ` ${c.section}` : ''}` : null);

async function studentProfiles(ids) {
  const map = new Map();
  const list = [...new Set(ids)];
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await db.from('profiles').select('user_id,full_name,roll_no,admission_no,phone,class_id,classes(name,section),users!inner(login_id)').in('user_id', list.slice(i, i + 200));
    check(error);
    data.forEach((p) => map.set(p.user_id, { student_id: p.user_id, full_name: p.full_name || one(p.users)?.login_id || 'Student', login_id: one(p.users)?.login_id, roll_no: p.roll_no, admission_no: p.admission_no, class_label: classLabel(one(p.classes)) }));
  }
  return map;
}

// find a student to put on a bus (any active student of the school who has not graduated)
export async function searchStudents(school, q) {
  const needle = String(q || '').trim().replace(/[,()%*\\]/g, ' ').slice(0, 40).trim();
  if (!needle) return [];
  const { data, error } = await db.from('profiles')
    .select('user_id,full_name,roll_no,admission_no,extra,classes(name,section),users!inner(login_id,is_active,role)')
    .eq('school_id', school).eq('users.role', 'student').eq('users.is_active', true)
    .or(`full_name.ilike.%${needle}%,admission_no.ilike.%${needle}%`).order('full_name').limit(30);
  check(error);
  const rows = data.filter((p) => p.extra?.graduated !== true);
  const { data: rides, error: e2 } = rows.length ? await db.from('transport_assignments').select('student_id,route_id,transport_routes(name)').in('student_id', rows.map((p) => p.user_id)) : { data: [], error: null };
  check(e2);
  const on = new Map();
  rides.forEach((a) => { if (!on.has(a.student_id)) on.set(a.student_id, []); on.get(a.student_id).push(one(a.transport_routes)?.name); });
  return rows.map((p) => ({ student_id: p.user_id, full_name: p.full_name || one(p.users).login_id, login_id: one(p.users).login_id, roll_no: p.roll_no, admission_no: p.admission_no, class_label: classLabel(one(p.classes)), routes: on.get(p.user_id) || [] }));
}

// EVERY active student of the school with the rides they have (none, one or several). The screen groups them class by class.
export async function listStudents(school) {
  const [all, rows] = await Promise.all([
    loadAll(school),
    fetchAll(() => db.from('profiles')
      .select('user_id,full_name,roll_no,admission_no,class_id,extra,classes(name,section,level),users!inner(login_id,is_active,role)')
      .eq('school_id', school).eq('users.role', 'student').eq('users.is_active', true).order('user_id')),
  ]);
  const assignments = await fetchAll(() => db.from('transport_assignments').select('id,student_id,route_id,stop_id').eq('school_id', school).order('id'));
  const routeOf = new Map(all.routes.map((r) => [r.id, r]));
  const stopOf = new Map(all.routes.flatMap((r) => r.stops.map((s) => [s.id, s])));
  const rides = new Map();
  for (const a of assignments) {
    const r = routeOf.get(a.route_id); const s = stopOf.get(a.stop_id);
    if (!rides.has(a.student_id)) rides.set(a.student_id, []);
    rides.get(a.student_id).push({ id: a.id, route_id: a.route_id, route_name: r?.name || '', vehicle_name: r?.vehicle?.name || null, stop_id: a.stop_id, stop_name: s?.name || '', pickup_time: s?.pickup_time || null, drop_time: s?.drop_time || null });
  }
  const students = rows.filter((p) => p.extra?.graduated !== true).map((p) => {
    const c = one(p.classes);
    return {
      student_id: p.user_id, full_name: p.full_name || one(p.users).login_id, login_id: one(p.users).login_id, roll_no: p.roll_no, admission_no: p.admission_no,
      class_id: p.class_id || null, class_label: classLabel(c), level: c?.level ?? null,
      rides: (rides.get(p.user_id) || []).sort((a, b) => L.natural(a.route_name, b.route_name)),
    };
  }).sort((a, b) => (a.level ?? 1e9) - (b.level ?? 1e9) || String(a.class_label || '~').localeCompare(String(b.class_label || '~'), undefined, { numeric: true }) || (a.roll_no ?? 1e9) - (b.roll_no ?? 1e9) || a.full_name.localeCompare(b.full_name));
  return { total: students.length, on_bus: students.filter((s) => s.rides.length).length, students };
}

// who rides what (filter by route, bus, stop or a name search)
export async function listAssignments(school, { route_id, vehicle_id, stop_id, q }) {
  const all = await loadAll(school);
  const routeOf = new Map(all.routes.map((r) => [r.id, r]));
  const stopOf = new Map(all.routes.flatMap((r) => r.stops.map((s) => [s.id, s])));
  let routeIds = null;
  if (route_id) routeIds = [route_id];
  else if (vehicle_id) routeIds = all.routes.filter((r) => r.vehicle?.id === vehicle_id).map((r) => r.id);
  if (routeIds && !routeIds.length) return { total: 0, rows: [] };
  const rows = await fetchAll(() => {
    let query = db.from('transport_assignments').select('id,student_id,route_id,stop_id,created_at').eq('school_id', school).order('id');
    if (routeIds) query = query.in('route_id', routeIds);
    if (stop_id) query = query.eq('stop_id', stop_id);
    return query;
  });
  const people = await studentProfiles(rows.map((a) => a.student_id));
  const needle = String(q || '').trim().toLowerCase();
  const out = rows.map((a) => {
    const p = people.get(a.student_id) || { student_id: a.student_id, full_name: 'Student' };
    const r = routeOf.get(a.route_id); const s = stopOf.get(a.stop_id);
    return { id: a.id, ...p, route_id: a.route_id, route_name: r?.name || '', zone: r?.zone || null, vehicle_name: r?.vehicle?.name || null, stop_id: a.stop_id, stop_name: s?.name || '', stop_seq: s?.seq || 0, pickup_time: s?.pickup_time || null, drop_time: s?.drop_time || null };
  }).filter((x) => !needle || `${x.full_name} ${x.login_id || ''} ${x.admission_no || ''} ${x.roll_no ?? ''} ${x.class_label || ''} ${x.stop_name}`.toLowerCase().includes(needle))
    .sort((a, b) => L.natural(a.route_name, b.route_name) || a.stop_seq - b.stop_seq || a.full_name.localeCompare(b.full_name));
  return { total: out.length, rows: out.slice(0, 500) };
}

async function assertStudent(school, studentId) {
  if (!isId(studentId)) throw httpError(400, 'Pick a student');
  const { data, error } = await db.from('profiles').select('user_id,full_name,extra,users!inner(role,is_active,school_id)').eq('user_id', studentId).maybeSingle();
  check(error);
  const u = data && one(data.users);
  if (!data || !u || u.role !== 'student' || u.school_id !== school) throw httpError(404, 'Student not found');
  if (!u.is_active) throw httpError(400, 'This student account is switched off');
  if (data.extra?.graduated === true) throw httpError(400, 'This student has already left the school');
  return data;
}
// a seat must be free on the route's bus (a student already on that bus keeps their seat)
async function assertSeat(school, studentId, route) {
  if (!route.vehicle_id) return;
  const all = await snapshot(school);
  const v = all.vehicles.find((x) => x.id === route.vehicle_id);
  if (!v) return;
  const routeIds = new Set(all.routes.filter((r) => r.vehicle_id === v.id).map((r) => r.id));
  const riders = new Set(all.assignments.filter((a) => routeIds.has(a.route_id)).map((a) => a.student_id));
  if (riders.has(studentId)) return;
  if (riders.size >= v.capacity) throw httpError(409, `${v.name} is full (${riders.size}/${v.capacity}). Pick another route or add seats to the bus.`);
}
async function stopOnRoute(school, routeId, stopId) {
  if (!isId(stopId)) throw httpError(400, 'Pick a stop');
  const { data, error } = await db.from('transport_stops').select('id,route_id').eq('id', stopId).eq('school_id', school).maybeSingle();
  check(error);
  if (!data || data.route_id !== routeId) throw httpError(400, 'That stop is not on this route');
}

export async function assign(school, by, b) {
  const route = await getRoute(school, b.route_id);
  await assertStudent(school, b.student_id);
  await stopOnRoute(school, route.id, b.stop_id);
  const { data: dup } = await db.from('transport_assignments').select('id').eq('student_id', b.student_id).eq('route_id', route.id).maybeSingle();
  if (dup) throw httpError(409, `This student already rides ${route.name}. Change their stop instead.`);
  await assertSeat(school, b.student_id, route);
  const { data, error } = await db.from('transport_assignments').insert({ school_id: school, student_id: b.student_id, route_id: route.id, stop_id: b.stop_id, created_by: by }).select('id,student_id,route_id,stop_id').single();
  uniq(error, 'This student already rides that route');
  return data;
}

async function getAssignment(school, id) {
  if (!isId(id)) throw httpError(404, 'Not found');
  const { data, error } = await db.from('transport_assignments').select('*').eq('id', id).eq('school_id', school).maybeSingle();
  check(error);
  if (!data) throw httpError(404, 'Not found');
  return data;
}
// change the stop, or move the student to another route (+ stop)
export async function updateAssignment(school, id, b) {
  const cur = await getAssignment(school, id);
  const routeId = b.route_id || cur.route_id;
  const route = await getRoute(school, routeId);
  await stopOnRoute(school, routeId, b.stop_id || cur.stop_id);
  if (routeId !== cur.route_id) {
    const { data: dup } = await db.from('transport_assignments').select('id').eq('student_id', cur.student_id).eq('route_id', routeId).maybeSingle();
    if (dup) throw httpError(409, `This student already rides ${route.name}.`);
    await assertSeat(school, cur.student_id, route);
  }
  const { data, error } = await db.from('transport_assignments').update({ route_id: routeId, stop_id: b.stop_id || cur.stop_id }).eq('id', id).eq('school_id', school).select('id,student_id,route_id,stop_id').single();
  uniq(error, 'This student already rides that route');
  return data;
}
export async function removeAssignment(school, id) {
  await getAssignment(school, id);
  check((await db.from('transport_assignments').delete().eq('id', id).eq('school_id', school)).error);
  return { ok: true };
}

// ---------------------------------------------------------------- one student (profile page + parent/student view)
export async function studentTransport(school, studentId) {
  const { data, error } = await db.from('transport_assignments').select('id,route_id,stop_id').eq('school_id', school).eq('student_id', studentId);
  check(error);
  if (!data.length) return { assigned: false, rides: [] };
  const [{ data: routes, error: e1 }, { data: stops, error: e2 }] = await Promise.all([
    db.from('transport_routes').select('id,name,zone,direction,vehicle_id,transport_vehicles(name,reg_no,driver_name,driver_phone,attendant_name,attendant_phone)').in('id', data.map((a) => a.route_id)),
    db.from('transport_stops').select('id,name,seq,pickup_time,drop_time').in('id', data.map((a) => a.stop_id)),
  ]);
  check(e1); check(e2);
  const rOf = new Map(routes.map((r) => [r.id, r])); const sOf = new Map(stops.map((s) => [s.id, s]));
  const rides = data.map((a) => {
    const r = rOf.get(a.route_id); const s = sOf.get(a.stop_id); const v = one(r?.transport_vehicles);
    return {
      id: a.id, route: r?.name || '', zone: r?.zone || null, direction: r?.direction || 'two_way',
      stop: s?.name || '', pickup_time: L.hhmm(s?.pickup_time), drop_time: L.hhmm(s?.drop_time),
      bus: v ? { name: v.name, reg_no: v.reg_no, driver_name: v.driver_name, driver_phone: v.driver_phone, attendant_name: v.attendant_name, attendant_phone: v.attendant_phone } : null,
    };
  }).sort((a, b) => L.natural(a.route, b.route));
  return { assigned: true, rides };
}

// the signed-in student, or the children of the signed-in parent
export async function myTransport(user) {
  let ids = [];
  if (user.role === 'student') ids = [user.user_id];
  else {
    const { data, error } = await db.from('parent_students').select('student_id').eq('parent_id', user.user_id);
    check(error);
    ids = data.map((x) => x.student_id);
  }
  if (!ids.length || !user.school_id) return [];
  const people = await studentProfiles(ids);
  const out = [];
  for (const id of ids) {
    const p = people.get(id);
    if (!p) continue;
    out.push({ student_id: id, full_name: p.full_name, class_label: p.class_label, ...(await studentTransport(user.school_id, id)) });
  }
  return out.sort((a, b) => a.full_name.localeCompare(b.full_name));
}
