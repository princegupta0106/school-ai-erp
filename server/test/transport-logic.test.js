import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, occupancy, docState, checkOrder, cleanTime, cleanCapacity, cleanDate } from '../src/transportLogic.js';

const today = '2026-11-04';
const veh = (o) => ({ id: 'v1', name: 'Bus 1', capacity: 2, ...o });
const route = (o) => ({ id: 'r1', name: 'Route 1', vehicle_id: 'v1', ...o });
const stop = (o) => ({ id: 's1', route_id: 'r1', name: 'Green Park', seq: 1, pickup_time: '07:10:00', ...o });
const asg = (student_id, o = {}) => ({ id: `a-${student_id}`, student_id, route_id: 'r1', stop_id: 's1', ...o });

test('occupancy levels', () => {
  assert.equal(occupancy(45, 20).level, 'ok');
  assert.equal(occupancy(45, 41).level, 'warn');
  assert.equal(occupancy(45, 45).level, 'full');
  assert.equal(occupancy(45, 46).level, 'over');
  assert.deepEqual(occupancy(45, 42), { students: 42, capacity: 45, seats_left: 3, percent: 93, level: 'warn' });
});

test('document expiry states', () => {
  assert.equal(docState('k', 'Insurance', null, today).state, 'missing');
  assert.equal(docState('k', 'Insurance', '2026-11-03', today).state, 'expired');
  assert.equal(docState('k', 'Insurance', '2026-11-04', today).state, 'soon');
  assert.equal(docState('k', 'Insurance', '2026-12-04', today).state, 'soon');
  assert.equal(docState('k', 'Insurance', '2026-12-05', today).state, 'ok');
});

test('a student on two routes of one bus uses one seat', () => {
  const r = compute({
    vehicles: [veh()], routes: [route(), route({ id: 'r2', name: 'Route 2' })],
    stops: [stop(), stop({ id: 's2', route_id: 'r2' })],
    assignments: [asg('a'), asg('a', { id: 'x', route_id: 'r2', stop_id: 's2' }), asg('b')],
  }, today);
  assert.equal(r.vehicles[0].occupancy.students, 2);
  assert.equal(r.totals.students, 2);
  assert.equal(r.routes[0].stops[0].pickup_time, '07:10');
  assert.equal(r.routes[0].stops[0].students, 3 - 1); // a and b on s1 of r1; a on s2 of r2
});

test('alerts: most urgent first, with plain wording', () => {
  const r = compute({
    vehicles: [veh({ insurance_expiry: '2026-10-30', capacity: 2 }), veh({ id: 'v2', name: 'Bus 2', fitness_expiry: '2026-11-10' })],
    routes: [route(), route({ id: 'r2', name: 'Route 2', vehicle_id: null })],
    stops: [stop()], assignments: [asg('a'), asg('b')],
  }, today);
  const t = r.alerts.map((a) => a.text);
  assert.equal(r.alerts[0].tone, 'bad');
  assert.match(t[0], /Insurance expired 5 days ago/);
  assert.ok(t.some((x) => /Bus 1 is full \(2\/2\)/.test(x)));
  assert.ok(t.some((x) => /Bus 2: Fitness certificate expires in 6 days/.test(x)));
  assert.ok(t.some((x) => /Route 2 has no bus/.test(x)));
  assert.ok(t.some((x) => /Route 2 has no stops yet/.test(x)));
  assert.ok(t.some((x) => /Bus 2 is not on any route yet/.test(x)));
  assert.ok(r.alerts.findIndex((a) => a.tone === 'bad') < r.alerts.findIndex((a) => a.tone === 'warn'));
});

test('stops come back in route order', () => {
  const r = compute({ vehicles: [veh()], routes: [route()], stops: [stop({ id: 'b', seq: 2, name: 'B' }), stop({ id: 'a', seq: 1, name: 'A' })], assignments: [] }, today);
  assert.deepEqual(r.routes[0].stops.map((s) => s.name), ['A', 'B']);
});

test('validators', () => {
  assert.equal(cleanTime(''), null);
  assert.equal(cleanTime('07:30:00'), '07:30');
  assert.throws(() => cleanTime('7.30'), /07:30/);
  assert.throws(() => cleanCapacity(0));
  assert.throws(() => cleanCapacity('abc'));
  assert.equal(cleanCapacity('45'), 45);
  assert.throws(() => cleanDate('2026-13-40'));
  assert.equal(cleanDate(''), null);
  assert.deepEqual(checkOrder(['a', 'b'], ['b', 'a']), ['b', 'a']);
  assert.throws(() => checkOrder(['a', 'b'], ['a']));
  assert.throws(() => checkOrder(['a', 'b'], ['a', 'a']));
});
