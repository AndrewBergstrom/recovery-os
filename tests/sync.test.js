import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClient, createSync, planPull, outboxEntry, shouldSync } from '../js/sync.js';
import { MemoryStore } from '../js/db.js';
import { seedItems } from '../js/seed.js';
import { confirmSchedule } from '../js/medications.js';
import { createFakeSupabase, memoryStorage } from './fake-supabase.js';
import { seededStore, la, dose, TZ } from './helpers.js';
import { toIso } from '../js/time.js';

/** A "device": seeded store + client + engine, with its own clock. */
async function device(server, { clockStart = la('2026-11-07', '08:00') } = {}) {
  const store = await seededStore();
  let t = clockStart;
  const now = () => (t += 1000);
  const client = createSupabaseClient({ url: 'https://example.supabase.co', anonKey: 'anon-key', fetchImpl: server.fetchImpl, storage: memoryStorage(), now });
  const changes = [];
  const sync = createSync({ store, client, now, seedDocs: () => seedItems(toIso(now())), onChange: (c) => changes.push(c), online: () => true });
  return { store, client, sync, changes, now, setTime: (ms) => (t = ms) };
}

async function signIn(d, email = 'andrew@example.com') {
  await d.client.signInStart(email);
  await d.client.signInVerify(email, '123456');
  return d.sync.afterSignIn();
}

/** Write locally the way the app does: store.put + enqueue. */
async function write(d, storeName, obj, opts) {
  await d.store.put(storeName, obj);
  await d.sync.enqueue(storeName, obj, opts);
}

test('seed rows and excluded meta keys are never queued; events use recorded_at as updated_at', () => {
  assert.equal(shouldSync('meta', { key: 'seed' }), false);
  assert.equal(shouldSync('meta', { key: 'last_export' }), false);
  assert.equal(shouldSync('meta', { key: 'sync' }), false);
  assert.equal(shouldSync('meta', { key: 'profile' }), true);
  assert.equal(shouldSync('outbox', { id: 'x' }), false);
  const ev = dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:00'));
  const e = outboxEntry('events', ev, { now: la('2026-11-07', '09:00') });
  assert.equal(e.id, `events:${ev.id}`);
  assert.equal(e.updated_at, ev.recorded_at);
  assert.equal(e.deleted, false);
  const tomb = outboxEntry('slot_states', { slot_id: 'ice:ice:2026-11-07:09:00' }, { deleted: true });
  assert.equal(tomb.payload, null);
  assert.equal(tomb.deleted, true);
});

test('planPull: remote wins unless a pending local change is newer; tombstones delete', () => {
  const rows = [
    { store: 'contacts', key: 'pharmacy', payload: { id: 'pharmacy', name: 'Remote', updated_at: '2026-11-07T10:00:00Z' }, deleted: false, updated_at: '2026-11-07T10:00:00Z' },
    { store: 'contacts', key: 'surgeon-office', payload: { id: 'surgeon-office', name: 'Remote older', updated_at: '2026-11-07T09:00:00Z' }, deleted: false, updated_at: '2026-11-07T09:00:00Z' },
    { store: 'slot_states', key: 's1', payload: {}, deleted: true, updated_at: '2026-11-07T10:00:00Z' },
    { store: 'events', key: 'e1', payload: { id: 'e1' }, deleted: false, updated_at: '2026-11-07T08:00:00Z' },
  ];
  const localDocs = new Map([
    ['contacts:pharmacy', { id: 'pharmacy', name: 'Local (already synced)', updated_at: '2026-11-07T11:00:00Z' }],
    ['contacts:surgeon-office', { id: 'surgeon-office', name: 'Local pending', updated_at: '2026-11-07T09:30:00Z' }],
    ['slot_states:s1', { slot_id: 's1' }],
    ['events:e1', { id: 'e1' }],
  ]);
  const pending = new Map([['contacts:surgeon-office', { updated_at: '2026-11-07T09:30:00Z' }]]);
  const plan = planPull(rows, { localDocs, pending });
  assert.deepEqual(plan.puts.map((p) => p.obj.name), ['Remote'], 'non-pending local doc takes the remote version even with a newer local timestamp');
  assert.deepEqual(plan.deletes, [{ store: 'slot_states', key: 's1' }]);
  assert.deepEqual(plan.dropPending, []);
  const plan2 = planPull([{ store: 'contacts', key: 'surgeon-office', payload: { id: 'surgeon-office', name: 'Remote newer' }, deleted: false, updated_at: '2026-11-07T12:00:00Z' }], { localDocs, pending });
  assert.deepEqual(plan2.dropPending, ['contacts:surgeon-office']);
  assert.equal(plan2.puts[0].obj.name, 'Remote newer');
});

test('two devices: entries, order versions, activation and slot states flow both ways', async () => {
  const server = createFakeSupabase();
  const A = await device(server);
  const B = await device(server, { clockStart: la('2026-11-07', '08:30') });
  await signIn(A);
  await write(A, 'meta', { key: 'activation', activated_at: toIso(A.now()), reviewed_seed_version: 1 });
  const d1 = dose('med-oxycodone-5', 5, 1, la('2026-11-07', '04:55'));
  await write(A, 'events', d1);
  await write(A, 'slot_states', { slot_id: 'ice:ice:2026-11-07:09:00', status: 'in_progress', at: toIso(A.now()) });
  let r = await A.sync.syncNow();
  assert.equal(r.pushed, 3);
  assert.equal(A.sync.status.pending, 0);

  await signIn(B);
  assert.equal((await B.store.get('events', d1.id)).medication_id, 'med-oxycodone-5', 'B received the dose');
  assert.ok(await B.store.get('meta', 'activation'), 'B skips onboarding because activation synced');
  assert.equal((await B.store.get('slot_states', 'ice:ice:2026-11-07:09:00')).status, 'in_progress');
  assert.equal(B.changes.length, 1);

  // B confirms the aspirin schedule → new version + closed v1
  const asp = (await B.store.getAll('orders')).find((o) => o.id === 'med-aspirin-81');
  const { newVersion, previous } = confirmSchedule(asp, { times: ['08:00', '20:00'], course_start: '2026-11-06', confirmed_by: 'Pharmacist', confirmed_on: '2026-11-07', todayStr: '2026-11-07' });
  for (const o of [previous, newVersion]) await write(B, 'orders', { ...o, updated_at: toIso(B.now()) });
  // B finishes the ice session: entry + tombstone for the in-progress state
  const ice = { ...dose('med-oxycodone-5', 5, 1, la('2026-11-07', '09:30')), event_type: 'ice_elevate', status: 'completed', kind: 'both', duration_minutes: 20, slot_id: 'ice:ice:2026-11-07:09:00' };
  delete ice.medication_id;
  await write(B, 'events', ice);
  await B.store.delete('slot_states', 'ice:ice:2026-11-07:09:00');
  await B.sync.enqueue('slot_states', { slot_id: 'ice:ice:2026-11-07:09:00' }, { deleted: true });
  r = await B.sync.syncNow();
  assert.equal(r.pushed, 4);

  r = await A.sync.syncNow();
  assert.ok(r.applied >= 3);
  const versions = (await A.store.getAll('orders')).filter((o) => o.id === 'med-aspirin-81').sort((a, b) => a.version - b.version);
  assert.deepEqual(versions.map((v) => [v.version, v.status, v.valid_to]), [[1, 'needs_schedule_confirmation', '2026-11-07'], [2, 'confirmed', null]]);
  assert.equal(await A.store.get('slot_states', 'ice:ice:2026-11-07:09:00'), undefined, 'tombstone removed the in-progress state on A');
  assert.equal((await A.store.get('events', ice.id)).event_type, 'ice_elevate');
  // Idempotent: another sync applies nothing new
  r = await A.sync.syncNow();
  assert.equal(r.applied, 0);
  assert.equal(r.pushed, 0);
});

test('a pending local edit that is newer than the cloud survives a pull and then wins on push', async () => {
  const server = createFakeSupabase();
  const A = await device(server);
  const B = await device(server);
  await signIn(A);
  await signIn(B);
  await write(B, 'contacts', { id: 'pharmacy', role: 'Pharmacy', name: 'B wrote first', updated_at: '2026-11-07T09:00:00.000Z' });
  await B.sync.syncNow();
  // A edits later but is offline for a while
  await write(A, 'contacts', { id: 'pharmacy', role: 'Pharmacy', name: 'A wrote later', updated_at: '2026-11-07T09:30:00.000Z' });
  await A.sync.syncNow();
  assert.equal((await A.store.get('contacts', 'pharmacy')).name, 'A wrote later');
  await B.sync.syncNow();
  assert.equal((await B.store.get('contacts', 'pharmacy')).name, 'A wrote later', 'B received the newer edit');
  // An older write arriving late loses on the server
  await write(B, 'contacts', { id: 'pharmacy', role: 'Pharmacy', name: 'stale', updated_at: '2026-11-07T08:00:00.000Z' });
  await B.sync.syncNow();
  await A.sync.syncNow();
  assert.equal((await A.store.get('contacts', 'pharmacy')).name, 'A wrote later');
});

test('erasing local data and syncing again restores everything from the cloud', async () => {
  const server = createFakeSupabase();
  const A = await device(server);
  await signIn(A);
  await write(A, 'meta', { key: 'activation', activated_at: toIso(A.now()) });
  for (let i = 0; i < 5; i++) await write(A, 'events', dose('med-acetaminophen-500', 500, 1, la('2026-11-07', `0${i + 1}:00`)));
  await A.sync.syncNow();
  await A.store.clear();
  await A.store.bulkPut(seedItems(toIso(A.now())));
  await A.sync.resetCursor();
  const r = await A.sync.syncNow();
  assert.ok(r.applied >= 6);
  assert.equal(await A.store.count('events'), 5);
  assert.ok(await A.store.get('meta', 'activation'));
});

test('expired access tokens are refreshed transparently; a dead refresh token signs out cleanly', async () => {
  const server = createFakeSupabase();
  const A = await device(server);
  await signIn(A);
  await write(A, 'events', dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:00')));
  server.state.expireNext = true; // next REST call returns 401
  const r = await A.sync.syncNow();
  assert.equal(r.error, undefined, 'refresh + retry succeeded');
  assert.equal(server.count(A.client.userId), 2, 'the dose plus the backfilled profile');
  assert.ok(server.state.calls.includes('POST /auth/v1/token'));
  // wrong code is a readable error, not a crash
  await assert.rejects(A.client.signInVerify('andrew@example.com', '000000'), /expired or is invalid/);
});

test('sync is a no-op when not configured or signed out, and never touches the outbox', async () => {
  const store = new MemoryStore();
  const client = createSupabaseClient({ url: '', anonKey: '', storage: memoryStorage() });
  const sync = createSync({ store, client, online: () => true });
  assert.equal(client.configured, false);
  assert.deepEqual(await sync.syncNow(), { skipped: 'not signed in' });
  await sync.enqueue('events', dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:00')));
  assert.equal(await store.count('outbox'), 1, 'writes still queue, ready for when sync is configured');
});

test('link sign-in: pasted magic link and redirect hash both produce a working session', async () => {
  const server = createFakeSupabase();
  const A = await device(server);
  await A.client.signInStart('andrew@example.com', { redirectTo: 'https://andrewbergstrom.github.io/recovery-os/' });
  assert.match(server.state.lastLink, /verify\?token=hash-\d+&type=magiclink&redirect_to=https%3A%2F%2Fandrewbergstrom/);
  await A.client.signInVerifyLink(server.state.lastLink);
  assert.equal(A.client.email, 'andrew@example.com');
  await assert.rejects(A.client.signInVerifyLink(server.state.lastLink), /invalid or has expired/, 'links are single-use');
  await assert.rejects(A.client.signInVerifyLink('not a link'), /does not look like/);
  const B = await device(server);
  assert.equal(await B.client.adoptSessionFromHash('#today'), false);
  assert.equal(await B.client.adoptSessionFromHash(server.implicitHash('andrew@example.com')), true);
  assert.equal(B.client.userId, A.client.userId, 'same account on both devices');
  assert.equal(B.client.hashError('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), 'Email link is invalid or has expired');
  await B.sync.afterSignIn();
  await write(B, 'events', dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:00')));
  await B.sync.syncNow();
  assert.equal(server.count(B.client.userId), 2, 'the dose plus the backfilled profile');
});

test('first sync backfills entries that predate sync, but not untouched seed rows', async () => {
  const server = createFakeSupabase();
  const A = await device(server);
  // Data written before sync existed: straight to the store, nothing queued.
  const d = dose('med-oxycodone-5', 5, 1, la('2026-11-07', '04:55'));
  await A.store.put('events', d);
  await A.store.put('meta', { key: 'activation', activated_at: '2026-11-06T06:00:00.000Z' });
  await A.store.put('slot_states', { slot_id: 'ice:ice:2026-11-07:09:00', status: 'skipped', at: '2026-11-07T17:00:00.000Z' });
  const q = (await A.store.getAll('questions')).find((x) => x.id === 'pt-start');
  await A.store.put('questions', { ...q, status: 'resolved', resolution: { value: 'week 1', confirmed_by: 'Surgeon', confirmed_on: '2026-11-07' } });
  assert.equal(await A.store.count('outbox'), 0);
  await signIn(A);
  const uploaded = server.count(A.client.userId);
  assert.equal(uploaded, 5, 'event + activation + profile + slot state + resolved question; untouched seed orders/questions/milestones/contacts skipped');
  const stores = new Set([...server.rows.values()].map((r) => r.store));
  assert.deepEqual([...stores].sort(), ['events', 'meta', 'questions', 'slot_states']);
  // backfill runs once; a later sync does not re-queue everything
  const r = await A.sync.syncNow();
  assert.equal(r.pushed, 0);
  // a second device receives the backfilled history
  const B = await device(server);
  await signIn(B);
  assert.ok(await B.store.get('events', d.id));
  assert.equal((await B.store.get('questions', 'pt-start')).status, 'resolved');
});
