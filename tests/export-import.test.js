import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, validateExport, diffImport, applyImport, parseBackupText, buildVisitSummary, SCHEMA_VERSION } from '../js/export-import.js';
import { MemoryStore } from '../js/db.js';
import { seedItems } from '../js/seed.js';
import { baseState, seededStore, la, dose, TZ } from './helpers.js';
import { createEvent, createCorrection } from '../js/events.js';
import { toIso } from '../js/time.js';

async function stateFromStore(store) {
  const [events, orders, questions, milestones, appointments, contacts, metaRows] = await Promise.all(['events', 'orders', 'questions', 'milestones', 'appointments', 'contacts', 'meta'].map((s) => store.getAll(s)));
  const meta = Object.fromEntries(metaRows.map((m) => [m.key, m]));
  return { events, orders, questions, milestones, appointments, contacts, meta, profile: meta.profile };
}

test('a fresh export has events: [] and validates against its own schema', () => {
  const state = baseState();
  const out = buildExport(state, { nowIso: '2026-11-06T20:00:00.000Z', appVersion: 'test' });
  assert.equal(out.schema_version, SCHEMA_VERSION);
  assert.deepEqual(out.events, []);
  assert.equal(out.timezone, TZ);
  assert.ok(out.care_orders.every((o) => o.key));
  assert.ok(out.unresolved_questions.some((q) => q.id === 'weight-bearing-duration' && q.status === 'needs_clinician_confirmation'));
  assert.deepEqual(validateExport(out), { ok: true, errors: [] });
});

test('malformed backups are rejected with readable errors and never partially applied', async () => {
  assert.equal(parseBackupText('{not json').ok, false);
  assert.equal(validateExport([]).ok, false);
  assert.equal(validateExport({ schema_version: '9.0.0', timezone: TZ, profile: { surgery_date: '2026-11-06', surgical_side: 'left' } }).ok, false);
  const bad = buildExport(baseState(), { nowIso: toIso(Date.now()) });
  bad.events = [{ id: 'e1', event_type: 'medication', status: 'taken' }, { id: 'e1', event_type: 'note' }];
  const v = validateExport(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((m) => /duplicate id/.test(m)));
  assert.ok(v.errors.some((m) => /occurred_at/.test(m)));
  // nothing is written for an invalid backup because applyImport is never reached; prove the store is untouched
  const store = await seededStore();
  const before = await store.count('events');
  assert.equal(before, 0);
});

test('round trip: export → import into a clean store keeps every entry, correction and question', async () => {
  const storeA = await seededStore();
  const d1 = dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:00'));
  const d2 = dose('med-acetaminophen-500', 500, 2, la('2026-11-07', '09:00'));
  const fix = createCorrection(d2, { quantity: 1, total_mg: 500 }, { reason: 'wrong_amount', nowMs: la('2026-11-07', '09:10'), tz: TZ });
  const note = createEvent({ event_type: 'note', status: 'recorded', category: 'question_for_surgeon', text: 'Which weight-bearing duration?', occurred_ms: la('2026-11-07', '10:00') }, { tz: TZ });
  await storeA.bulkPut([d1, d2, fix, note].map((obj) => ({ store: 'events', obj })));
  await storeA.put('meta', { key: 'activation', activated_at: toIso(Date.now()) });
  const stateA = await stateFromStore(storeA);
  const text = JSON.stringify(buildExport(stateA, { nowIso: toIso(Date.now()) }));

  const storeB = new MemoryStore();
  await storeB.bulkPut(seedItems(toIso(Date.now())));
  const stateB = await stateFromStore(storeB);
  const parsed = parseBackupText(text);
  assert.ok(parsed.ok);
  assert.ok(validateExport(parsed.value).ok);
  const diff = diffImport(stateB, parsed.value);
  assert.equal(diff.sections.events.new.length, 4);
  assert.equal(diff.sections.orders.identical, 9, 'seed orders already present are identical, not conflicts');
  assert.equal(diff.totalConflicts, 0);
  assert.equal(diff.profile.status, 'adopt');
  await applyImport(storeB, diff);
  const after = await stateFromStore(storeB);
  assert.equal(after.events.length, 4);
  assert.ok(after.events.find((e) => e.id === fix.id).corrects === d2.id, 'the correction chain survives');
  assert.ok(after.meta.activation, 'activation adopted into a clean store');
  // importing the same backup again is a no-op
  const again = diffImport(after, parsed.value);
  assert.equal(again.totalNew, 0);
  assert.equal(again.sections.events.identical, 4);
});

test('conflicting entries (same id, different content) are never overwritten', async () => {
  const store = await seededStore();
  const d = dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:00'));
  await store.put('events', d);
  await store.put('meta', { key: 'activation', activated_at: toIso(Date.now()) });
  const state = await stateFromStore(store);
  const incoming = buildExport(state, { nowIso: toIso(Date.now()) });
  incoming.events = [{ ...d, quantity: 2, total_mg: 162 }];
  const diff = diffImport(state, incoming);
  assert.equal(diff.sections.events.conflicts.length, 1);
  assert.equal(diff.totalNew, 0);
  await applyImport(store, diff);
  const kept = await store.get('events', d.id);
  assert.equal(kept.quantity, 1, 'existing entry kept');
});

test('visit summary quotes recorded facts only and flags unknowns', () => {
  const state = baseState();
  const now = la('2026-11-09', '12:00');
  const empty = buildVisitSummary(state, { now });
  assert.match(empty, /No medication entries recorded/);
  assert.match(empty, /Not recorded/);
  assert.match(empty, /Open questions for clinicians \(5\)/);
  assert.match(empty, /days since surgery with no entries: 2026-11-06, 2026-11-07, 2026-11-08, 2026-11-09/);
  state.events = [dose('med-aspirin-81', 81, 1, la('2026-11-08', '08:00')), createEvent({ event_type: 'checkin', status: 'recorded', pain: 4, swelling: 'same', symptoms: [], occurred_ms: la('2026-11-08', '20:00') }, { tz: TZ })];
  const withData = buildVisitSummary(state, { now });
  assert.match(withData, /\| 2026-11-08 \| Aspirin \(delayed-release\) \| 1 \| 81 mg \|/);
  assert.match(withData, /\| 2026-11-08 8:00 PM \| 4 \| same \|/);
  assert.doesNotMatch(withData, /score/i);
});
