import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDaySlots, deriveStatuses, dayCompletion, nextActionable, prnPills, routineFrom, DEFAULT_ROUTINE, milestoneDate } from '../js/schedule.js';
import { confirmSchedule } from '../js/medications.js';
import { markCleared } from '../js/exercises.js';
import { createEvent } from '../js/events.js';
import { baseState, la, dose, TZ } from './helpers.js';

const D = '2026-11-07';

test('a day has aspirin placeholders (dashed), ice sessions and an optional check-in — never PRN medicines', () => {
  const state = baseState();
  const slots = buildDaySlots(state, D, { tz: TZ });
  const kinds = slots.map((s) => s.kind);
  assert.equal(kinds.filter((k) => k === 'medication').length, 2, 'two aspirin placeholders');
  assert.ok(slots.filter((s) => s.kind === 'medication').every((s) => s.unconfirmed === true));
  assert.equal(kinds.filter((k) => k === 'ice_elevate').length, DEFAULT_ROUTINE.ice_times.length);
  assert.equal(kinds.filter((k) => k === 'checkin').length, 1);
  assert.ok(!slots.some((s) => s.ref_id === 'med-oxycodone-5' || s.ref_id === 'med-ibuprofen-400'), 'PRN medicines are never slots');
  assert.equal(kinds.filter((k) => k === 'exercise').length, 0, 'uncleared exercises never appear');
});

test('confirmed schedule replaces placeholders and respects the course window', () => {
  const state = baseState();
  const asp = state.orders.find((o) => o.id === 'med-aspirin-81');
  const { newVersion, previous } = confirmSchedule(asp, { times: ['07:30', '19:30'], course_start: '2026-11-06', confirmed_by: 'Pharmacist', confirmed_on: '2026-11-06', todayStr: '2026-11-06' });
  state.orders = [...state.orders.filter((o) => o.id !== 'med-aspirin-81'), previous, newVersion];
  const meds = buildDaySlots(state, D, { tz: TZ }).filter((s) => s.kind === 'medication');
  assert.deepEqual(meds.map((s) => s.time), ['07:30', '19:30']);
  assert.ok(meds.every((s) => !s.unconfirmed));
  const afterCourse = buildDaySlots(state, '2027-01-10', { tz: TZ }).filter((s) => s.kind === 'medication');
  assert.equal(afterCourse.length, 0);
});

test('cleared exercises get routine slots from their clearance date on', () => {
  const state = baseState();
  const heel = state.orders.find((o) => o.id === 'ex-heel-slides');
  const { newVersion, previous } = markCleared(heel, { cleared_by: 'Physical therapist', cleared_on: '2026-11-12', instructions_version: 'PT visit 1', todayStr: '2026-11-12' });
  state.orders = [...state.orders.filter((o) => o.id !== 'ex-heel-slides'), previous, newVersion];
  assert.equal(buildDaySlots(state, '2026-11-11', { tz: TZ }).filter((s) => s.kind === 'exercise').length, 0);
  assert.equal(buildDaySlots(state, '2026-11-12', { tz: TZ }).filter((s) => s.kind === 'exercise').length, DEFAULT_ROUTINE.exercise_times.length);
});

test('statuses: upcoming → due → red (not recorded); optional items never turn red', () => {
  const state = baseState();
  const slots = buildDaySlots(state, D, { tz: TZ });
  const at = (t) => deriveStatuses(slots, { events: [], slotStates: [], now: la(D, t), tz: TZ });
  const aspirinAm = (list) => list.find((s) => s.ref_id === 'med-aspirin-81' && s.time === '08:00');
  assert.equal(aspirinAm(at('07:00')).status, 'upcoming');
  assert.equal(aspirinAm(at('08:30')).status, 'due');
  assert.equal(aspirinAm(at('09:30')).status, 'todo');
  const checkin = (list) => list.find((s) => s.kind === 'checkin');
  assert.equal(checkin(at('23:59')).status, 'open', 'optional check-in stays grey, not red');
  // a whole future day is all upcoming
  const tomorrow = deriveStatuses(buildDaySlots(state, '2026-11-08', { tz: TZ }), { now: la(D, '23:00'), tz: TZ });
  assert.ok(tomorrow.filter((s) => s.kind !== 'milestone').every((s) => s.status === 'upcoming' || s.status === 'open'));
});

test('an entry recorded from a pill (slot_id) marks it done; loose entries attach to the nearest slot within the window', () => {
  const state = baseState();
  const slots = buildDaySlots(state, D, { tz: TZ });
  const fromPill = dose('med-aspirin-81', 81, 1, la(D, '08:10'), { slot_id: 'med:med-aspirin-81:2026-11-07:08:00' });
  const loose = dose('med-aspirin-81', 81, 1, la(D, '18:40'));
  const ice = createEvent({ event_type: 'ice_elevate', status: 'completed', kind: 'both', duration_minutes: 20, barrier_confirmed: true, occurred_ms: la(D, '13:20') }, { tz: TZ });
  const out = deriveStatuses(slots, { events: [fromPill, loose, ice], now: la(D, '22:00'), tz: TZ });
  const am = out.find((s) => s.ref_id === 'med-aspirin-81' && s.time === '08:00');
  const pm = out.find((s) => s.ref_id === 'med-aspirin-81' && s.time === '18:00');
  assert.equal(am.status, 'done');
  assert.equal(am.event.id, fromPill.id);
  assert.equal(pm.status, 'done');
  assert.equal(pm.event.id, loose.id);
  const iceSlots = out.filter((s) => s.kind === 'ice_elevate');
  assert.equal(iceSlots.find((s) => s.time === '13:00').status, 'done');
  assert.equal(iceSlots.filter((s) => s.status === 'done').length, 1, 'one entry fills one slot only');
  assert.equal(iceSlots.find((s) => s.time === '09:00').status, 'todo');
  assert.equal(iceSlots.find((s) => s.time === '21:00').status, 'due');
});

test('in-progress and skipped slot states colour the pill without inventing an entry', () => {
  const state = baseState();
  const slots = buildDaySlots(state, D, { tz: TZ });
  const states = [
    { slot_id: 'ice:ice:2026-11-07:09:00', status: 'in_progress', at: new Date(la(D, '09:05')).toISOString() },
    { slot_id: 'med:med-aspirin-81:2026-11-07:08:00', status: 'skipped', at: new Date(la(D, '08:30')).toISOString() },
  ];
  const out = deriveStatuses(slots, { events: [], slotStates: states, now: la(D, '09:20'), tz: TZ });
  assert.equal(out.find((s) => s.id === 'ice:ice:2026-11-07:09:00').status, 'in_progress');
  assert.equal(out.find((s) => s.id === 'med:med-aspirin-81:2026-11-07:08:00').status, 'skipped');
  assert.ok(out.every((s) => s.status !== 'done'), 'no entry was fabricated');
});

test('day completion counts only required, already-due slots; next actionable prefers in-progress, then due, then red', () => {
  const state = baseState();
  const slots = buildDaySlots(state, D, { tz: TZ });
  const states = [{ slot_id: 'ice:ice:2026-11-07:13:00', status: 'in_progress', at: new Date(la(D, '13:05')).toISOString() }];
  const out = deriveStatuses(slots, { events: [dose('med-aspirin-81', 81, 1, la(D, '08:00'))], slotStates: states, now: la(D, '13:30'), tz: TZ });
  const comp = dayCompletion(out);
  // due/past by 13:30: aspirin 08:00 (done), ice 09:00 (todo), ice 13:00 (in progress) → 3 counted, 1 done, 1 red
  assert.equal(comp.total, 3);
  assert.equal(comp.done, 1);
  assert.equal(comp.red, 1);
  assert.equal(nextActionable(out, la(D, '13:30')).id, 'ice:ice:2026-11-07:13:00');
});

test('PRN pills report today’s count and last time, and ibuprofen is flagged', () => {
  const state = baseState({ events: [dose('med-oxycodone-5', 5, 1, la(D, '02:00')), dose('med-oxycodone-5', 5, 1, la(D, '08:00')), dose('med-oxycodone-5', 5, 1, la('2026-11-06', '23:00'))] });
  const pills = prnPills(state, D, { tz: TZ });
  const oxy = pills.find((p) => p.ref_id === 'med-oxycodone-5');
  assert.equal(oxy.count, 2);
  assert.equal(pills.find((p) => p.ref_id === 'med-ibuprofen-400').flagged, true);
  assert.ok(!pills.some((p) => p.ref_id === 'med-aspirin-81'));
});

test('milestones and appointments appear as info pills on their days', () => {
  const state = baseState({ appointments: [{ id: 'a1', title: 'First clinic visit', at: new Date(la('2026-11-16', '10:30')).toISOString(), with: 'Surgeon' }] });
  const dressing = buildDaySlots(state, '2026-11-08', { tz: TZ }).find((s) => s.kind === 'milestone');
  assert.equal(dressing.ref_id, 'dressing-check');
  assert.equal(deriveStatuses([dressing], { now: la('2026-11-09', '10:00'), tz: TZ })[0].status, 'info', 'milestones never turn red');
  const appt = buildDaySlots(state, '2026-11-16', { tz: TZ }).find((s) => s.kind === 'appointment');
  assert.equal(appt.time, '10:30');
  assert.deepEqual(milestoneDate({ when: { kind: 'offset_days', days: 42 } }, '2026-11-06').from, '2026-12-18');
});

test('routine from meta falls back to defaults for missing or empty lists', () => {
  assert.deepEqual(routineFrom({}).ice_times, DEFAULT_ROUTINE.ice_times);
  assert.deepEqual(routineFrom({ routine: { ice_times: [], checkin_time: '21:00' } }).ice_times, DEFAULT_ROUTINE.ice_times);
  assert.equal(routineFrom({ routine: { checkin_time: '21:00' } }).checkin_time, '21:00');
});

test('a logged PRN dose predicts the earliest next dose for that medicine (never red)', () => {
  const state = baseState({ events: [dose('med-oxycodone-5', 5, 1, la(D, '04:55')), dose('med-acetaminophen-500', 500, 2, la(D, '04:55'))] });
  const slots = buildDaySlots(state, D, { tz: TZ, now: la(D, '06:00') });
  const oxyNext = slots.find((s) => s.kind === 'prn_next' && s.ref_id === 'med-oxycodone-5');
  const tylNext = slots.find((s) => s.kind === 'prn_next' && s.ref_id === 'med-acetaminophen-500');
  assert.equal(oxyNext.time, '08:55', '4 h label interval');
  assert.equal(tylNext.time, '12:55', '8 h label interval');
  const before = deriveStatuses(slots, { events: state.events, now: la(D, '07:00'), tz: TZ });
  assert.equal(before.find((s) => s.id === oxyNext.id).status, 'window');
  const after = deriveStatuses(slots, { events: state.events, now: la(D, '23:00'), tz: TZ });
  assert.equal(after.find((s) => s.id === oxyNext.id).status, 'available', 'as-needed predictions never become red');
  // a newer dose moves the prediction
  const state2 = baseState({ events: [...state.events, dose('med-oxycodone-5', 5, 1, la(D, '09:30'))] });
  const next2 = buildDaySlots(state2, D, { tz: TZ, now: la(D, '10:00') }).filter((s) => s.kind === 'prn_next' && s.ref_id === 'med-oxycodone-5');
  assert.deepEqual(next2.map((s) => s.time), ['13:30']);
  // MiraLAX 24 h → lands on the next day
  const state3 = baseState({ events: [dose('med-peg-3350', 17000, 1, la(D, '08:00'))] });
  assert.equal(buildDaySlots(state3, D, { tz: TZ }).filter((s) => s.ref_id === 'med-peg-3350').length, 0);
  assert.equal(buildDaySlots(state3, '2026-11-08', { tz: TZ }).find((s) => s.ref_id === 'med-peg-3350').time, '08:00');
});

test('an unconfirmed aspirin placeholder slides to ~12 h after the dose actually taken', () => {
  const state = baseState({ events: [dose('med-aspirin-81', 81, 1, la(D, '11:00'))] });
  const out = deriveStatuses(buildDaySlots(state, D, { tz: TZ }), { events: state.events, now: la(D, '12:00'), tz: TZ });
  const am = out.find((s) => s.ref_id === 'med-aspirin-81' && s.id.endsWith(':08:00'));
  const pm = out.find((s) => s.ref_id === 'med-aspirin-81' && s.id.endsWith(':18:00'));
  assert.equal(am.status, 'done', '11:00 dose matched the morning placeholder');
  assert.equal(pm.time, '23:00', 'evening placeholder moved to 12 h after the 11:00 dose');
  assert.equal(pm.shifted_from, '18:00');
  assert.equal(pm.status, 'upcoming');
  // an early dose does not move the evening placeholder (13 h gap is fine)
  const early = baseState({ events: [dose('med-aspirin-81', 81, 1, la(D, '04:55'))] });
  const out2 = deriveStatuses(buildDaySlots(early, D, { tz: TZ }), { events: early.events, now: la(D, '06:00'), tz: TZ });
  assert.equal(out2.find((s) => s.id.endsWith(':18:00')).time, '18:00');
});
