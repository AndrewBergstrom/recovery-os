import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, validateEvent, createCorrection, currentEvents, supersededIds, describeEvent } from '../js/events.js';
import { MemoryStore } from '../js/db.js';
import { seededStore, la, dose, TZ } from './helpers.js';
import { ordersById } from '../js/medications.js';
import { orders as seedOrders } from '../js/seed.js';

test('seed contains orders and questions but NO events', async () => {
  const store = await seededStore();
  assert.equal(await store.count('events'), 0);
  assert.ok((await store.count('orders')) >= 9);
  assert.ok((await store.count('questions')) >= 4);
  const profile = await store.get('meta', 'profile');
  assert.equal(profile.surgery_date, '2026-11-06');
});

test('building an event does not persist it; only an explicit put does (cancel = nothing stored)', async () => {
  const store = await seededStore();
  const ev = dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:05'));
  assert.deepEqual(validateEvent(ev), []);
  assert.equal(await store.count('events'), 0); // "cancel" path
  await store.put('events', ev);
  assert.equal(await store.count('events'), 1);
});

test('a stored dose round-trips with identical timestamp and amount', async () => {
  const store = await seededStore();
  const at = la('2026-11-07', '18:10');
  const ev = dose('med-aspirin-81', 81, 1, at);
  await store.put('events', ev);
  const back = await store.get('events', ev.id);
  assert.equal(back.occurred_at, new Date(at).toISOString());
  assert.equal(back.occurred_local, '2026-11-07T18:10');
  assert.equal(back.timezone, TZ);
  assert.equal(back.total_mg, 81);
  assert.equal(back.quantity, 1);
});

test('validation rejects fabricated or malformed events', () => {
  assert.ok(validateEvent({}).length > 0);
  const bad = createEvent({ event_type: 'medication', status: 'taken', medication_id: 'x', quantity: 0, total_mg: 0 }, { tz: TZ });
  assert.ok(validateEvent(bad).some((m) => /quantity/.test(m)));
  const badType = createEvent({ event_type: 'teleport', status: 'taken' }, { tz: TZ });
  assert.ok(validateEvent(badType).some((m) => /event_type/.test(m)));
  const note = createEvent({ event_type: 'note', status: 'recorded', category: 'journal', text: '   ' }, { tz: TZ });
  assert.ok(validateEvent(note).some((m) => /Note text/.test(m)));
});

test('corrections preserve the original and supersede it in the current view', () => {
  const original = dose('med-acetaminophen-500', 500, 2, la('2026-11-07', '09:00'));
  const corrected = createCorrection(original, { quantity: 1, total_mg: 500 }, { reason: 'wrong_amount', nowMs: la('2026-11-07', '09:30'), tz: TZ });
  const all = [original, corrected];
  assert.equal(corrected.corrects, original.id);
  assert.equal(corrected.correction_reason, 'wrong_amount');
  assert.equal(corrected.status, 'taken');
  assert.equal(corrected.total_mg, 500);
  const current = currentEvents(all);
  assert.deepEqual(current.map((e) => e.id), [corrected.id]);
  assert.ok(supersededIds(all).has(original.id));
  assert.ok(all.find((e) => e.id === original.id), 'original is still in the log');
});

test('voiding keeps the original in the log and removes it from the current view', () => {
  const original = dose('med-oxycodone-5', 5, 1, la('2026-11-07', '02:00'));
  const voided = createCorrection(original, {}, { reason: 'duplicate', nowMs: la('2026-11-07', '02:05'), tz: TZ });
  assert.equal(voided.status, 'voided');
  const current = currentEvents([original, voided]);
  assert.equal(current.length, 0);
});

test('correction reason is mandatory', () => {
  const original = dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:00'));
  assert.throws(() => createCorrection(original, {}, { reason: '', tz: TZ }), /reason/);
});

test('bulkPut is all-or-nothing in the memory store', async () => {
  const store = new MemoryStore();
  const good = dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:00'));
  await assert.rejects(store.bulkPut([{ store: 'events', obj: good }, { store: 'events', obj: { event_type: 'medication' } }]), /missing its key/);
  assert.equal(await store.count('events'), 0);
});

test('describeEvent renders amounts in the order unit (mg vs g) and PRN names', () => {
  const byId = ordersById(seedOrders);
  const peg = dose('med-peg-3350', 17000, 1, la('2026-11-07', '08:00'));
  assert.match(describeEvent(peg, byId, TZ), /Polyethylene glycol 3350 \(MiraLAX\) 17 g × 1 packet \(17 g\)/);
  const tyl = dose('med-acetaminophen-500', 500, 2, la('2026-11-07', '08:00'));
  assert.match(describeEvent(tyl, byId, TZ), /Acetaminophen \(Tylenol\) 500 mg × 2 tablets \(1,000 mg\)/);
});
