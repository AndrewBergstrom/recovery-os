import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClient, createSync } from '../js/sync.js';
import { seedItems } from '../js/seed.js';
import { createFakeSupabase, memoryStorage } from './fake-supabase.js';
import { seededStore, la, dose, TZ, baseState } from './helpers.js';
import { toIso } from '../js/time.js';
import { computeReminders, filterForSubscriber, stateFromRecords, inQuietHours, DEFAULT_PREFS } from '../js/reminders-due.js';
import { createEvent } from '../js/events.js';

async function device(server, { clockStart = la('2026-11-07', '08:00') } = {}) {
  const store = await seededStore();
  let t = clockStart;
  const now = () => (t += 1000);
  const client = createSupabaseClient({ url: 'https://example.supabase.co', anonKey: 'anon-key', fetchImpl: server.fetchImpl, storage: memoryStorage(), now });
  const sync = createSync({ store, client, now, seedDocs: () => seedItems(toIso(now())), online: () => true });
  await sync.loadScope();
  return { store, client, sync, now };
}
async function signIn(d, email = 'andrew@example.com') {
  await d.client.signInStart(email);
  await d.client.signInVerify(email, '123456');
  return d.sync.afterSignIn();
}
async function write(d, storeName, obj) {
  await d.store.put(storeName, obj);
  await d.sync.enqueue(storeName, obj);
}

test('care partner: invite → anonymous sign-in → accept → sees and writes the owner\'s records under their own name', async () => {
  const server = createFakeSupabase();
  const owner = await device(server);
  await signIn(owner);
  await write(owner, 'meta', { key: 'activation', activated_at: toIso(owner.now()) });
  const d1 = dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:05'));
  await write(owner, 'events', d1);
  await owner.sync.syncNow();
  // owner creates an invite
  const invite = await owner.client.insert('care_circle', { owner_id: owner.client.userId, owner_name: 'Andrew', member_name: 'Lindsay', invite_token: 'tok-123' });
  assert.equal(invite.owner_id, owner.client.userId);

  // partner's phone: anonymous sign-in, accept, scope to the owner
  const partner = await device(server);
  await partner.client.signInAnonymously();
  assert.equal(partner.client.isAnonymous, true);
  const [accepted] = await partner.client.rpc('accept_invite', { p_token: 'tok-123', p_name: 'Lindsay' });
  assert.equal(accepted.owner_id, owner.client.userId);
  assert.equal(accepted.owner_name, 'Andrew');
  assert.equal(accepted.owner_profile.surgery_date, '2026-11-06', 'profile is always backfilled, so the invitee gets it');
  await partner.sync.setScope({ mode: 'member', ownerId: accepted.owner_id, ownerName: 'Andrew', memberName: 'Lindsay' });
  partner.sync.status.signedIn = true;
  let r = await partner.sync.syncNow();
  assert.ok(r.applied >= 2, 'owner data pulled');
  assert.ok(await partner.store.get('events', d1.id));
  assert.ok(await partner.store.get('meta', 'activation'), 'partner skips onboarding');

  // partner logs a dose for the owner; it lands in the owner's rows and shows who entered it
  const byLindsay = createEvent({ event_type: 'medication', status: 'taken', medication_id: 'med-oxycodone-5', strength_mg: 5, quantity: 1, total_mg: 5, occurred_ms: la('2026-11-07', '12:00'), created_by: 'Lindsay' }, { tz: TZ });
  await write(partner, 'events', byLindsay);
  r = await partner.sync.syncNow();
  assert.equal(r.pushed, 1);
  assert.equal(server.rows.get(`${owner.client.userId}|events|${byLindsay.id}`).user_id, owner.client.userId, 'stored under the owner, not the partner');
  await owner.sync.syncNow();
  assert.equal((await owner.store.get('events', byLindsay.id)).created_by, 'Lindsay');

  // single-use link; revoke cuts access
  await assert.rejects(partner.client.rpc('accept_invite', { p_token: 'tok-123', p_name: 'Lindsay' }), /invalid, already used or revoked/);
  await owner.client.patch('care_circle', `id=eq.${invite.id}`, { revoked_at: toIso(owner.now()) });
  r = await partner.sync.syncNow();
  assert.ok(r.error || r.applied === 0, 'revoked partner no longer reads the owner');
  const stranger = await device(server);
  await stranger.client.signInAnonymously();
  const rowsSeen = await stranger.client.fetchRows({ ownerId: owner.client.userId });
  assert.equal(rowsSeen.length, 0, 'an unrelated anonymous user sees nothing');
});

test('push subscriptions are tied to the subscriber and limited to owners they may follow', async () => {
  const server = createFakeSupabase();
  const owner = await device(server);
  await signIn(owner);
  const sub = { subscriber_id: owner.client.userId, owner_id: owner.client.userId, subscriber_name: 'patient', endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a', device: 'iPhone', prefs: DEFAULT_PREFS };
  await owner.client.upsertRows('push_subscriptions', [sub], 'endpoint');
  assert.equal(server.pushSubs.size, 1);
  const stranger = await device(server);
  await stranger.client.signInAnonymously();
  await assert.rejects(stranger.client.upsertRows('push_subscriptions', [{ ...sub, endpoint: 'https://push.example/xyz', owner_id: owner.client.userId }], 'endpoint'), /row-level security/);
});

test('reminders: due pills within the window, missed nudges after grace, prefs and quiet hours respected', () => {
  const state = baseState({ events: [dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:05'))] });
  // 09:03 — the 09:00 ice session just became due; 08:00 aspirin is done
  let rs = computeReminders({ state, now: la('2026-11-07', '09:03') });
  assert.deepEqual(rs.map((r) => [r.kind, r.slot_id]), [['due', 'ice:ice:2026-11-07:09:00']]);
  assert.equal(rs[0].title, 'Time for Ice + elevate');
  // same slot, already sent → nothing
  assert.equal(computeReminders({ state, now: la('2026-11-07', '09:03'), lastSent: new Set(['ice:ice:2026-11-07:09:00|due']) }).length, 0);
  // 10:35 — ice 09:00 passed its 90-min grace at 10:30 → missed nudge
  rs = computeReminders({ state, now: la('2026-11-07', '10:35') });
  assert.deepEqual(rs.map((r) => r.kind), ['missed']);
  // The evening aspirin placeholder slid to 20:05 (12 h after the 08:05 dose): due at 20:08, missed after its 60-min grace.
  rs = computeReminders({ state, now: la('2026-11-07', '19:04') });
  assert.equal(rs.length, 0, 'nothing due at 19:04; the optional check-in never reminds');
  rs = computeReminders({ state, now: la('2026-11-07', '20:08') });
  assert.deepEqual(rs.map((r) => [r.kind, r.pref]), [['due', 'meds']]);
  assert.equal(rs[0].title, 'Time for Aspirin 81 mg');
  rs = computeReminders({ state, now: la('2026-11-07', '21:08') });
  assert.deepEqual(rs.map((r) => [r.kind, r.pref]), [['missed', 'missed'], ['due', 'ice']], 'aspirin missed nudge plus the 21:00 ice session coming due');
  // subscriber filtering
  const tz = TZ;
  const due = [{ kind: 'due', pref: 'ice' }, { kind: 'due', pref: 'meds' }, { kind: 'missed', pref: 'missed' }];
  assert.deepEqual(filterForSubscriber(due, { prefs: { ice: false }, isOwner: true, now: la('2026-11-07', '12:00'), tz }).map((r) => r.pref), ['meds']);
  assert.deepEqual(filterForSubscriber(due, { prefs: { ice: true }, isOwner: false, now: la('2026-11-07', '12:00'), tz }).map((r) => r.pref), ['ice', 'meds', 'missed']);
  assert.equal(filterForSubscriber(due, { prefs: {}, isOwner: false, now: la('2026-11-07', '23:30'), tz }).length, 0, 'quiet hours');
  assert.equal(inQuietHours(la('2026-11-07', '06:59'), DEFAULT_PREFS, tz), true);
  assert.equal(inQuietHours(la('2026-11-07', '07:00'), DEFAULT_PREFS, tz), false);
});

test('stateFromRecords rebuilds the schedule inputs from cloud rows on top of the seed', () => {
  const owner = 'u1';
  const d = dose('med-aspirin-81', 81, 1, la('2026-11-07', '08:05'));
  const rows = [
    { store: 'meta', key: 'profile', payload: { key: 'profile', surgery_date: '2026-11-06', surgical_side: 'left', timezone: TZ }, deleted: false },
    { store: 'events', key: d.id, payload: d, deleted: false },
    { store: 'slot_states', key: 's1', payload: { slot_id: 's1', status: 'skipped' }, deleted: true },
    { store: 'meta', key: 'routine', payload: { key: 'routine', ice_times: ['10:00'] }, deleted: false },
  ];
  const state = stateFromRecords(rows, seedItems('2026-11-07T00:00:00Z'));
  assert.equal(state.profile.surgery_date, '2026-11-06');
  assert.equal(state.events.length, 1);
  assert.equal(state.slotStates.length, 0, 'tombstoned');
  assert.ok(state.orders.find((o) => o.id === 'med-aspirin-81'), 'seed orders present even though never uploaded');
  assert.deepEqual(state.meta.routine.ice_times, ['10:00']);
  const rs = computeReminders({ state, now: la('2026-11-07', '10:02') });
  assert.deepEqual(rs.map((r) => r.slot_id), ['ice:ice:2026-11-07:10:00']);
});

test('reminder fan-out drops subscriptions of revoked or never-accepted members', async () => {
  const { partitionSubscribers } = await import('../js/reminders-due.js');
  const subs = [
    { id: 'a', subscriber_id: 'owner', endpoint: 'o1' },
    { id: 'b', subscriber_id: 'lindsay', endpoint: 'l1' },
    { id: 'c', subscriber_id: 'revoked-partner', endpoint: 'r1' },
    { id: 'd', subscriber_id: 'stranger', endpoint: 's1' },
  ];
  const { keep, drop } = partitionSubscribers(subs, 'owner', ['lindsay']);
  assert.deepEqual(keep.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(drop.map((s) => s.id), ['c', 'd']);
  assert.deepEqual(partitionSubscribers([], 'owner', []), { keep: [], drop: [] });
});
