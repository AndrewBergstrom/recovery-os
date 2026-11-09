import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPtVisit, ptVisits, visitNumber, nextVisit, groupByMonth, relativeDay } from '../js/pt-schedule.js';
import { zonedToUtc, toIso } from '../js/time.js';

const TZ = 'America/Los_Angeles';
const appt = (id, title, date, time, extra = {}) => ({ id, title, at: toIso(zonedToUtc(date, time, TZ)), ...extra });

const list = [
  appt('c', 'PT visit 3 — HiDEF', '2026-12-02', '10:30'),
  appt('a', 'PT visit 1 — HiDEF', '2026-11-09', '09:00'),
  appt('x', 'Two-week follow-up', '2026-11-20', '14:00', { with: 'Dr. Hannay' }),
  appt('b', 'PT visit 2 — HiDEF', '2026-11-30', '16:15'),
  appt('z', 'PT visit 9 — HiDEF', '2026-12-30', '08:00', { status: 'cancelled' }),
];

test('picks PT visits only, sorted, skipping cancelled and non-PT appointments', () => {
  assert.equal(isPtVisit(list[2]), false);
  assert.deepEqual(ptVisits(list).map((v) => v.id), ['a', 'b', 'c']);
});

test('visit number comes from the title', () => {
  assert.equal(visitNumber(list[0]), 3);
  assert.equal(visitNumber({ title: 'Physical therapy' }), null);
});

test('next visit is the first not yet finished; stays next for 90 minutes', () => {
  const v = ptVisits(list);
  const at = (d, t) => zonedToUtc(d, t, TZ);
  assert.equal(nextVisit(v, at('2026-11-08', '12:00')).id, 'a');
  assert.equal(nextVisit(v, at('2026-11-09', '10:00')).id, 'a');
  assert.equal(nextVisit(v, at('2026-11-09', '10:31')).id, 'b');
  assert.equal(nextVisit(v, at('2027-01-01', '09:00')), null);
});

test('groups by month in the profile time zone (late-evening visit stays on its local day)', () => {
  const v = ptVisits([...list, appt('late', 'PT visit 4 — HiDEF', '2026-11-30', '23:30')]);
  const g = groupByMonth(v, TZ);
  assert.deepEqual(g.map((x) => [x.label, x.visits.length]), [['November 2026', 3], ['December 2026', 1]]);
});

test('relative day labels', () => {
  const now = zonedToUtc('2026-11-09', '08:00', TZ);
  const ms = (d) => zonedToUtc(d, '09:00', TZ);
  assert.equal(relativeDay(ms('2026-11-09'), now, TZ), 'Today');
  assert.equal(relativeDay(ms('2026-11-10'), now, TZ), 'Tomorrow');
  assert.equal(relativeDay(ms('2026-11-14'), now, TZ), 'In 5 days');
  assert.equal(relativeDay(ms('2026-11-08'), now, TZ), 'Yesterday');
});
