import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollingTotalMg, acetaminophenCheck, duplicateCheck, interactionNotices, flaggedBy, exerciseIsDue, weightBearingState, escalationFor, recordedLabel, prnNeverOverdue, orderRollingCheck } from '../js/safety-rules.js';
import { orders, questions } from '../js/seed.js';
import { partitionExercises, markCleared } from '../js/exercises.js';
import { la, dose, TZ } from './helpers.js';
import { tzOffsetMs, localDateString } from '../js/time.js';

const ACET = 'med-acetaminophen-500';

test('acetaminophen total is a ROLLING 24 h window, not a midnight reset', () => {
  const events = [
    dose(ACET, 500, 2, la('2026-11-07', '22:30')), // 1000 mg
    dose(ACET, 500, 2, la('2026-11-08', '06:30')), // 1000 mg, after midnight
  ];
  const now = la('2026-11-08', '14:00');
  assert.equal(rollingTotalMg(events, [ACET], now), 2000, 'both doses are within the last 24 h despite the midnight boundary');
  const later = la('2026-11-08', '22:31');
  assert.equal(rollingTotalMg(events, [ACET], later), 1000, 'the 22:30 dose has aged out after 24 h');
  const check = acetaminophenCheck(events, orders, 1000, now);
  assert.equal(check.projected_mg, 3000);
  assert.equal(check.exceeds, false);
  const over = acetaminophenCheck(events, orders, 1500, now);
  assert.equal(over.exceeds, true);
  assert.match(over.message, /3,500 mg/);
});

test('rolling window is 24 real hours across the fall-back DST transition (Nov 1 2026)', () => {
  // 2026-11-01 01:30 PDT happens before the clocks fall back; wall-clock day is 25 h long.
  const before = la('2026-10-31', '23:30'); // PDT
  const after = la('2026-11-01', '23:00'); // PST — 24 h 30 min later in real time
  assert.equal(tzOffsetMs(before, TZ), -7 * 3600 * 1000);
  assert.equal(tzOffsetMs(after, TZ), -8 * 3600 * 1000);
  assert.equal(after - before, 24.5 * 3600 * 1000);
  const events = [dose(ACET, 500, 2, before)];
  assert.equal(rollingTotalMg(events, [ACET], after), 0, 'a dose 24.5 real hours ago is outside the window even though it is "yesterday 23:30" on the wall clock');
  assert.equal(rollingTotalMg(events, [ACET], before + 23.9 * 3600 * 1000), 1000);
});

test('rolling window across the spring-forward DST transition (Mar 8 2026)', () => {
  const before = la('2026-03-07', '23:00'); // PST
  const after = la('2026-03-08', '22:30'); // PDT — 22.5 real hours later (23.5 on the wall clock)
  assert.equal(after - before, 22.5 * 3600 * 1000);
  const events = [dose(ACET, 500, 1, before)];
  assert.equal(rollingTotalMg(events, [ACET], after), 500);
  assert.equal(localDateString(after, TZ), '2026-03-08');
});

test('ibuprofen has its own rolling label maximum and an aspirin interaction notice', () => {
  const ibu = orders.find((o) => o.id === 'med-ibuprofen-400');
  const events = [dose('med-ibuprofen-400', 400, 1, la('2026-11-07', '08:00')), dose('med-ibuprofen-400', 400, 1, la('2026-11-07', '16:00'))];
  const r = orderRollingCheck(events, ibu, 400, la('2026-11-07', '23:00'));
  assert.equal(r.projected_mg, 1200);
  assert.equal(r.exceeds, false);
  const notices = interactionNotices(ibu, orders);
  assert.equal(notices.length, 1);
  assert.match(notices[0].message, /Aspirin–ibuprofen interaction/);
  // aspirin itself carries no alarming notice (it is the clot-prevention medicine); ibuprofen is the flagged one
  const asp = orders.find((o) => o.id === 'med-aspirin-81');
  assert.equal(interactionNotices(asp, orders).length, 0);
  assert.deepEqual(flaggedBy(asp, orders).map((o) => o.id), ['med-ibuprofen-400']);
});

test('duplicate check is a gentle warning within 60 minutes, never a block', () => {
  const events = [dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:00'))];
  const d = duplicateCheck(events, 'med-aspirin-81', la('2026-11-07', '08:20'));
  assert.equal(d.possible, true);
  assert.equal(d.minutes_apart, 20);
  assert.equal(duplicateCheck(events, 'med-aspirin-81', la('2026-11-07', '10:00')).possible, false);
  assert.equal(duplicateCheck(events, 'med-oxycodone-5', la('2026-11-07', '08:05')).possible, false);
});

test('PRN medicines are never overdue', () => {
  const oxy = orders.find((o) => o.id === 'med-oxycodone-5');
  assert.deepEqual(prnNeverOverdue(oxy), { overdue: false, reason: 'As needed — never counted as missed.' });
  assert.equal(prnNeverOverdue(orders.find((o) => o.id === 'med-aspirin-81')), null);
});

test('uncleared exercises are never due; clearance needs who/when/instructions', () => {
  const { cleared, pending } = partitionExercises(orders);
  assert.equal(cleared.length, 0);
  assert.equal(pending.length, 4);
  for (const x of pending) assert.equal(exerciseIsDue(x), false);
  const heel = pending.find((x) => x.id === 'ex-heel-slides');
  assert.throws(() => markCleared(heel, { cleared_by: '', cleared_on: '2026-11-12', instructions_version: 'x', todayStr: '2026-11-12' }), /who/);
  const { newVersion } = markCleared(heel, { cleared_by: 'Physical therapist', cleared_on: '2026-11-12', instructions_version: 'PT visit 1', todayStr: '2026-11-12' });
  assert.equal(exerciseIsDue(newVersion), true);
  assert.equal(newVersion.version, 2);
  assert.equal(partitionExercises([...orders, newVersion]).cleared.length, 1);
});

test('day 14 does not auto-advance weight-bearing while the 2-vs-6-week question is open', () => {
  const s = weightBearingState(questions, 14);
  assert.equal(s.auto_advance, false);
  assert.equal(s.needs_confirmation, true);
  assert.match(s.note, /unresolved/);
  const resolved = questions.map((q) => (q.id === 'weight-bearing-duration' ? { ...q, status: 'resolved', resolution: { value: '2 weeks', confirmed_by: 'Surgeon', confirmed_on: '2026-11-20' } } : q));
  const r = weightBearingState(resolved, 14);
  assert.equal(r.auto_advance, false, 'even when resolved the app never advances on its own');
  assert.equal(r.needs_confirmation, false);
});

test('high-priority symptoms give explicit care-seeking instructions, not a score', () => {
  assert.equal(escalationFor([]).level, null);
  assert.equal(escalationFor(['fever']).level, 'clinician_now');
  assert.equal(escalationFor(['fever', 'chest_pain']).level, 'emergency');
  assert.match(escalationFor(['shortness_of_breath']).message, /911/);
});

test('missing values are labelled "Not recorded"', () => {
  assert.equal(recordedLabel(null), 'Not recorded');
  assert.equal(recordedLabel(''), 'Not recorded');
  assert.equal(recordedLabel(4, (v) => `${v}/10`), '4/10');
});

test('too-soon check: PRN uses the label minimum interval, scheduled uses half the dosing interval', async () => {
  const { intervalCheck, perDoseCheck } = await import('../js/safety-rules.js');
  const { orders } = await import('../js/seed.js');
  const oxy = orders.find((o) => o.id === 'med-oxycodone-5');
  const asp = orders.find((o) => o.id === 'med-aspirin-81');
  const ibu = orders.find((o) => o.id === 'med-ibuprofen-400');
  const t0 = Date.parse('2026-11-07T18:00:00.000Z');
  const taken = (id, at) => ({ id: `e-${id}-${at}`, event_type: 'medication', status: 'taken', medication_id: id, occurred_at: new Date(at).toISOString(), total_mg: 5 });
  const events = [taken('med-oxycodone-5', t0), taken('med-aspirin-81', t0)];
  // oxycodone every 4–6 h: 2 h later is too soon, 4 h later is fine
  const soon = intervalCheck(events, oxy, t0 + 2 * 3600e3);
  assert.ok(soon && soon.prn && soon.label_hours === 4 && soon.minutes_early === 120);
  assert.equal(intervalCheck(events, oxy, t0 + 4 * 3600e3), null);
  // aspirin twice daily: 3 h later is closer than scheduled, 7 h later is not flagged
  const close = intervalCheck(events, asp, t0 + 3 * 3600e3);
  assert.ok(close && !close.prn && close.label_hours === 12);
  assert.equal(intervalCheck(events, asp, t0 + 7 * 3600e3), null);
  // a dose recorded before the prior one is never "too soon" relative to it
  assert.equal(intervalCheck(events, oxy, t0 - 3600e3), null);
  // per-dose: ibuprofen is 1 tablet per dose, oxycodone allows 2
  assert.deepEqual(perDoseCheck(ibu, 2), { max_quantity: 1, attempted: 2 });
  assert.equal(perDoseCheck(oxy, 2), null);
  assert.deepEqual(perDoseCheck(oxy, 3), { max_quantity: 2, attempted: 3 });
});
