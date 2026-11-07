// reminders-due.js — which reminders to send right now, from the same pill schedule the
// calendar draws. Pure; shared by the app's tests and the Supabase Edge Function.
//
// kinds:
//   due     — a required pill just became due (within `windowMs` of its time)
//   missed  — a required pill passed its grace window with nothing recorded (sent once)
// Optional pills (check-in) and as-needed medicines never produce reminders.

import { buildDaySlots, deriveStatuses, routineFrom, GRACE_MINUTES } from './schedule.js';
import { localDateString, localTimeString, formatTime, addDays, zonedToUtc, DEFAULT_TZ } from './time.js';

export const DEFAULT_PREFS = { meds: true, exercise: true, ice: false, checkin: false, missed: true, quiet_from: '22:00', quiet_to: '07:00' };

const KIND_PREF = { medication: 'meds', exercise: 'exercise', ice_elevate: 'ice', checkin: 'checkin' };

export function inQuietHours(now, prefs, tz) {
  if (!prefs?.quiet_from || !prefs?.quiet_to) return false;
  const t = localTimeString(now, tz);
  const { quiet_from: from, quiet_to: to } = prefs;
  return from <= to ? t >= from && t < to : t >= from || t < to;
}

/**
 * Compute reminders for one owner at `now`.
 * @param state   { profile, meta, orders, events, slotStates, milestones, appointments }
 * @param lastSent Set of `${slot_id}|${kind}` already sent
 */
export function computeReminders({ state, now = Date.now(), lastSent = new Set(), windowMs = 10 * 60 * 1000 }) {
  const tz = state.profile?.timezone || DEFAULT_TZ;
  const routine = routineFrom(state.meta);
  const today = localDateString(now, tz);
  const days = [addDays(today, -1), today];
  const out = [];
  for (const d of days) {
    const slots = deriveStatuses(buildDaySlots(state, d, { tz, routine, now }), { events: state.events, slotStates: state.slotStates || [], now, tz });
    for (const slot of slots) {
      if (slot.optional || !slot.at || !KIND_PREF[slot.kind]) continue;
      const sinceDue = now - slot.at;
      if (slot.status === 'due' && sinceDue >= 0 && sinceDue <= windowMs) {
        const key = `${slot.id}|due`;
        if (!lastSent.has(key)) out.push({ slot_id: slot.id, kind: 'due', pref: KIND_PREF[slot.kind], title: `Time for ${slot.label || slot.title}`, body: `${formatTime(slot.at, tz)} · ${slot.sub || ''}`.trim(), at: slot.at });
      }
      const graceMs = (GRACE_MINUTES[slot.kind] || 60) * 60000;
      if (slot.status === 'todo' && sinceDue >= graceMs && sinceDue <= graceMs + windowMs) {
        const key = `${slot.id}|missed`;
        if (!lastSent.has(key)) out.push({ slot_id: slot.id, kind: 'missed', pref: 'missed', title: `Not logged yet: ${slot.label || slot.title}`, body: `Planned ${formatTime(slot.at, tz)}. Nothing recorded — worth a check-in.`, at: slot.at });
      }
    }
  }
  return out;
}

/** Which of the computed reminders a given subscriber should receive. */
export function filterForSubscriber(reminders, { prefs = {}, isOwner, now, tz }) {
  const p = { ...DEFAULT_PREFS, ...prefs };
  if (inQuietHours(now, p, tz)) return [];
  return reminders.filter((r) => {
    if (r.kind === 'missed') return p.missed !== false && !isOwner; // the owner already sees red pills; partners get the nudge
    return p[r.pref] !== false;
  });
}

/**
 * Rebuild an app-like state object from `records` rows (as the Edge Function sees them).
 * Untouched seed rows are never uploaded, so the seed is the base and cloud rows override by key.
 */
export function stateFromRecords(rows, seedItems = []) {
  const state = { profile: null, meta: {}, orders: [], events: [], slotStates: [], milestones: [], appointments: [], questions: [], contacts: [] };
  const docs = new Map();
  for (const i of seedItems) docs.set(`${i.store}:${i.obj.key || i.obj.id || i.obj.slot_id}`, { store: i.store, payload: i.obj, deleted: false });
  for (const r of rows) docs.set(`${r.store}:${r.key}`, r);
  for (const r of docs.values()) {
    if (r.deleted) continue;
    const doc = r.payload;
    switch (r.store) {
      case 'events':
        state.events.push(doc);
        break;
      case 'orders':
        state.orders.push(doc);
        break;
      case 'slot_states':
        state.slotStates.push(doc);
        break;
      case 'milestones':
        state.milestones.push(doc);
        break;
      case 'appointments':
        state.appointments.push(doc);
        break;
      case 'questions':
        state.questions.push(doc);
        break;
      case 'contacts':
        state.contacts.push(doc);
        break;
      case 'meta':
        state.meta[r.key] = doc;
        break;
      default:
        break;
    }
  }
  state.profile = state.meta.profile || null;
  return state;
}

export { zonedToUtc };
