import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, localDateString, localTimeString, daysSinceSurgery, dayLabel, nextOccurrence, previousOccurrence, datetimeLocalValue, parseDatetimeLocal, addDays, daysBetween, greeting, describeWhen } from '../js/time.js';

const TZ = 'America/Los_Angeles';

test('wall clock ↔ UTC conversions in Los Angeles across DST', () => {
  // PST (UTC−8)
  const nov = zonedToUtc('2026-11-06', '21:06', TZ);
  assert.equal(new Date(nov).toISOString(), '2026-11-07T05:06:00.000Z');
  assert.equal(localDateString(nov, TZ), '2026-11-06');
  assert.equal(localTimeString(nov, TZ), '21:06');
  // PDT (UTC−7)
  const jul = zonedToUtc('2026-07-04', '12:00', TZ);
  assert.equal(new Date(jul).toISOString(), '2026-07-04T19:00:00.000Z');
  // round trip through datetime-local
  assert.equal(datetimeLocalValue(nov, TZ), '2026-11-06T21:06');
  assert.equal(parseDatetimeLocal('2026-11-06T21:06', TZ), nov);
  assert.ok(Number.isNaN(parseDatetimeLocal('garbage', TZ)));
});

test('day count uses local calendar days, surgery day is Day 0', () => {
  const surgery = '2026-11-06';
  assert.equal(daysSinceSurgery(surgery, zonedToUtc('2026-11-06', '23:59', TZ), TZ), 0);
  assert.equal(daysSinceSurgery(surgery, zonedToUtc('2026-11-07', '00:01', TZ), TZ), 1);
  // 2026-11-07T07:30Z is still Nov 6 at 23:30 in LA
  assert.equal(daysSinceSurgery(surgery, Date.parse('2026-11-07T07:30:00Z'), TZ), 0);
  assert.equal(dayLabel(0), 'Surgery day');
  assert.equal(dayLabel(1), 'Day 1 after surgery');
  assert.equal(dayLabel(-2), 'Surgery in 2 days');
  assert.equal(daysBetween('2026-11-06', '2026-12-18'), 42);
  assert.equal(addDays('2026-11-06', 42), '2026-12-18');
});

test('next/previous occurrence of a wall-clock time', () => {
  const now = zonedToUtc('2026-11-07', '19:00', TZ);
  const n = nextOccurrence('08:00', now, TZ);
  assert.equal(n.date, '2026-11-08');
  assert.equal(n.isToday, false);
  const p = previousOccurrence('18:00', now, TZ);
  assert.equal(p.date, '2026-11-07');
  assert.equal(now - p.ms, 3600 * 1000);
  // across fall-back: 2026-11-01 — the previous 01:30 is well defined
  const afterFallBack = zonedToUtc('2026-11-01', '10:00', TZ);
  const prev = previousOccurrence('08:00', afterFallBack, TZ);
  assert.equal(prev.date, '2026-11-01');
});

test('greeting and relative description are time-zone aware', () => {
  assert.equal(greeting(zonedToUtc('2026-11-06', '21:00', TZ), TZ), 'Good evening');
  assert.equal(greeting(zonedToUtc('2026-11-06', '07:00', TZ), TZ), 'Good morning');
  const now = zonedToUtc('2026-11-07', '09:00', TZ);
  assert.equal(describeWhen(zonedToUtc('2026-11-07', '08:05', TZ), now, TZ), '8:05 AM today');
  assert.equal(describeWhen(zonedToUtc('2026-11-06', '22:00', TZ), now, TZ), '10:00 PM yesterday');
});
