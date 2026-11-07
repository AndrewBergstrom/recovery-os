import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeOrders, isPrn, isScheduleConfirmed, lastConfirmedDose, nextScheduledDose, recentScheduledWithoutDose, dueState, confirmSchedule, statusLabel, versionsOf, predictNextDose, intervalHoursFor } from '../js/medications.js';
import { orders } from '../js/seed.js';
import { la, dose, TZ } from './helpers.js';
import { formatTime } from '../js/time.js';

const aspirin = () => orders.find((o) => o.id === 'med-aspirin-81');

test('PRN medicines are PRN; oxycodone and ibuprofen are never scheduled tasks', () => {
  const meds = activeOrders(orders, 'medication');
  const oxy = meds.find((m) => m.id === 'med-oxycodone-5');
  const ibu = meds.find((m) => m.id === 'med-ibuprofen-400');
  assert.ok(isPrn(oxy));
  assert.ok(isPrn(ibu));
  assert.equal(nextScheduledDose(oxy, Date.now(), TZ), null);
  assert.equal(nextScheduledDose(ibu, Date.now(), TZ), null);
  assert.equal(dueState(oxy, [], Date.now(), TZ).kind, 'prn');
  assert.equal(dueState(ibu, [], Date.now(), TZ).label, 'Available to log if taken');
  assert.equal(statusLabel(ibu).text, 'Prescriber confirmation required');
});

test('no log means "Not recorded", never "missed" or "taken"', () => {
  assert.equal(lastConfirmedDose([], 'med-aspirin-81'), null);
  const a = aspirin();
  assert.equal(isScheduleConfirmed(a), false);
  const st = dueState(a, [], la('2026-11-07', '20:00'), TZ);
  assert.equal(st.kind, 'unconfirmed');
  assert.notEqual(st.label, 'Missed');
});

test('confirming a schedule creates a new order version and keeps the old one', () => {
  const a = aspirin();
  const { newVersion, previous } = confirmSchedule(a, { times: ['18:00', '08:00'], course_start: '2026-11-06', confirmed_by: 'Pharmacist', confirmed_on: '2026-11-07', source: 'phone call', todayStr: '2026-11-07' });
  assert.equal(newVersion.version, 2);
  assert.equal(newVersion.status, 'confirmed');
  assert.deepEqual(newVersion.schedule.times, ['08:00', '18:00']);
  assert.equal(newVersion.schedule.course_end, '2026-12-18');
  assert.equal(newVersion.key, 'med-aspirin-81@v2');
  assert.equal(previous.version, 1);
  assert.equal(previous.valid_to, '2026-11-07');
  const all = [...orders, previous, newVersion];
  assert.equal(activeOrders(all, 'medication').find((m) => m.id === 'med-aspirin-81').version, 2);
  assert.equal(versionsOf(all, 'med-aspirin-81').length, 3); // seed v1, closed v1 copy, v2 (same key v1 de-dupes in a real store)
});

test('confirmSchedule requires times, start, confirmer and date', () => {
  const a = aspirin();
  assert.throws(() => confirmSchedule(a, { times: [], course_start: '2026-11-06', confirmed_by: 'x', confirmed_on: '2026-11-07', todayStr: '2026-11-07' }), /time/);
  assert.throws(() => confirmSchedule(a, { times: ['08:00'], course_start: '', confirmed_by: 'x', confirmed_on: '2026-11-07', todayStr: '2026-11-07' }), /start/);
  assert.throws(() => confirmSchedule(a, { times: ['08:00'], course_start: '2026-11-06', confirmed_by: '', confirmed_on: '2026-11-07', todayStr: '2026-11-07' }), /who/);
});

test('next scheduled dose and "scheduled but not recorded" are computed in the profile time zone', () => {
  const { newVersion } = confirmSchedule(aspirin(), { times: ['08:00', '18:00'], course_start: '2026-11-06', confirmed_by: 'Patient', confirmed_on: '2026-11-06', todayStr: '2026-11-06' });
  const now = la('2026-11-07', '19:00');
  const next = nextScheduledDose(newVersion, now, TZ);
  assert.equal(formatTime(next.ms, TZ), '8:00 AM');
  assert.equal(next.isToday, false);
  // 18:00 passed an hour ago with no dose → not recorded (never "take now")
  const missing = recentScheduledWithoutDose(newVersion, [], now, TZ);
  assert.equal(formatTime(missing.ms, TZ), '6:00 PM');
  // a dose near 18:00 clears it
  const taken = dose('med-aspirin-81', 81, 1, la('2026-11-07', '18:20'));
  assert.equal(recentScheduledWithoutDose(newVersion, [taken], now, TZ), null);
  assert.equal(dueState(newVersion, [taken], now, TZ).kind, 'upcoming');
  // after the course end, nothing is scheduled
  assert.equal(nextScheduledDose(newVersion, la('2027-01-15', '09:00'), TZ), null);
});

test('last confirmed dose ignores voided and superseded entries', () => {
  const d1 = dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:00'));
  const d2 = dose('med-aspirin-81', 81, 1, la('2026-11-07', '18:00'));
  const voidD2 = { ...dose('med-aspirin-81', 81, 1, la('2026-11-07', '18:00')), status: 'voided', corrects: d2.id, correction_reason: 'not_taken' };
  assert.equal(lastConfirmedDose([d1, d2, voidD2], 'med-aspirin-81').id, d1.id);
});

test('predictNextDose anchors on the last recorded dose and respects confirmed schedules', () => {
  const oxy = orders.find((o) => o.id === 'med-oxycodone-5');
  assert.equal(predictNextDose(oxy, [], la('2026-11-07', '09:00'), TZ), null, 'no dose yet → no prediction');
  const taken = dose('med-oxycodone-5', 5, 1, la('2026-11-07', '04:55'));
  const p = predictNextDose(oxy, [taken], la('2026-11-07', '06:00'), TZ);
  assert.equal(formatTime(p.at, TZ), '8:55 AM');
  assert.equal(p.hours, 4);
  assert.equal(p.available, false);
  assert.equal(predictNextDose(oxy, [taken], la('2026-11-07', '09:00'), TZ).available, true);
  assert.equal(intervalHoursFor(aspirin()), 12, 'twice daily → 12 h while unconfirmed');
  const { newVersion } = confirmSchedule(aspirin(), { times: ['08:00', '18:00'], course_start: '2026-11-06', confirmed_by: 'Patient', confirmed_on: '2026-11-06', todayStr: '2026-11-06' });
  assert.equal(intervalHoursFor(newVersion), null, 'confirmed times win over interval guesses');
  const sched = predictNextDose(newVersion, [dose('med-aspirin-81', 81, 1, la('2026-11-07', '11:00'))], la('2026-11-07', '12:00'), TZ);
  assert.equal(sched.kind, 'scheduled');
  assert.equal(formatTime(sched.at, TZ), '6:00 PM');
});
