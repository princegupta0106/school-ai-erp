// Transport: buses, routes, stops and student rides. Logic lives in ../transport.js.
import { Router } from 'express';
import { httpError, asyncH } from '../db.js';
import { requireFeature, isSuper } from '../auth.js';
import * as T from '../transport.js';

const r = Router();
const READ = ['view_transport', 'manage_transport', 'assign_transport'];
const schoolOf = (req) => {
  const id = isSuper(req) ? (req.query.school_id || req.body?.school_id) : req.user.school_id;
  if (!id) throw httpError(400, 'Pick a school');
  return id;
};
const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const opt = (v) => { if (v && !T.isId(v)) throw httpError(400, 'Unknown item'); return v || undefined; };

// ---- the signed-in student / parent: my (my child's) bus details - their own data, no school-wide access
r.get('/my', requireFeature('view_my_transport'), asyncH(async (req, res) => res.json(await T.myTransport(req.user))));

// ---- read
r.get('/overview', requireFeature(...READ), asyncH(async (req, res) => res.json(await T.overview(schoolOf(req)))));
r.get('/vehicles', requireFeature(...READ), asyncH(async (req, res) => res.json((await T.loadAll(schoolOf(req))).vehicles)));
r.get('/routes', requireFeature(...READ), asyncH(async (req, res) => res.json((await T.loadAll(schoolOf(req))).routes)));
r.get('/students', requireFeature(...READ), asyncH(async (req, res) => res.json(await T.listStudents(schoolOf(req)))));
r.get('/assignments', requireFeature(...READ), asyncH(async (req, res) => {
  res.json(await T.listAssignments(schoolOf(req), { route_id: opt(req.query.route_id), vehicle_id: opt(req.query.vehicle_id), stop_id: opt(req.query.stop_id), q: req.query.q }));
}));

// ---- buses
r.post('/vehicles', requireFeature('manage_transport'), asyncH(async (req, res) => res.status(201).json(await T.createVehicle(schoolOf(req), body(req)))));
r.patch('/vehicles/:id', requireFeature('manage_transport'), asyncH(async (req, res) => res.json(await T.updateVehicle(schoolOf(req), req.params.id, body(req)))));
r.delete('/vehicles/:id', requireFeature('manage_transport'), asyncH(async (req, res) => res.json(await T.deleteVehicle(schoolOf(req), req.params.id))));

// ---- routes and their stops
r.post('/routes', requireFeature('manage_transport'), asyncH(async (req, res) => res.status(201).json(await T.createRoute(schoolOf(req), body(req)))));
r.patch('/routes/:id', requireFeature('manage_transport'), asyncH(async (req, res) => res.json(await T.updateRoute(schoolOf(req), req.params.id, body(req)))));
r.delete('/routes/:id', requireFeature('manage_transport'), asyncH(async (req, res) => res.json(await T.deleteRoute(schoolOf(req), req.params.id))));
r.post('/routes/:id/stops', requireFeature('manage_transport'), asyncH(async (req, res) => res.status(201).json(await T.addStop(schoolOf(req), req.params.id, body(req)))));
r.put('/routes/:id/stops/order', requireFeature('manage_transport'), asyncH(async (req, res) => res.json(await T.reorderStops(schoolOf(req), req.params.id, body(req).ids))));
r.patch('/stops/:id', requireFeature('manage_transport'), asyncH(async (req, res) => res.json(await T.updateStop(schoolOf(req), req.params.id, body(req)))));
r.delete('/stops/:id', requireFeature('manage_transport'), asyncH(async (req, res) => res.json(await T.deleteStop(schoolOf(req), req.params.id))));

// ---- students on the bus
r.get('/students/search', requireFeature('assign_transport'), asyncH(async (req, res) => res.json(await T.searchStudents(schoolOf(req), req.query.q))));
r.post('/assignments', requireFeature('assign_transport'), asyncH(async (req, res) => res.status(201).json(await T.assign(schoolOf(req), req.user.user_id, body(req)))));
r.patch('/assignments/:id', requireFeature('assign_transport'), asyncH(async (req, res) => res.json(await T.updateAssignment(schoolOf(req), req.params.id, body(req)))));
r.delete('/assignments/:id', requireFeature('assign_transport'), asyncH(async (req, res) => res.json(await T.removeAssignment(schoolOf(req), req.params.id))));

export default r;
