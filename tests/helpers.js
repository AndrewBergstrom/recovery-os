// tests/helpers.js — shared fixtures. De-identified; no real patient data.

import { MemoryStore } from '../js/db.js';
import { seedItems, profile, orders, questions, milestones } from '../js/seed.js';
import { createEvent } from '../js/events.js';
import { zonedToUtc, toIso } from '../js/time.js';

export const TZ = 'America/Los_Angeles';

/** A fresh in-memory store with the care-plan seed loaded (no events). */
export async function seededStore() {
  const store = new MemoryStore();
  await store.bulkPut(seedItems(toIso(Date.now())));
  return store;
}

/** Minimal app-like state object for pure functions. */
export function baseState(overrides = {}) {
  return {
    profile: { ...profile },
    meta: {},
    orders: orders.map((o) => ({ ...o })),
    questions: questions.map((q) => ({ ...q })),
    milestones: milestones.map((m) => ({ ...m })),
    appointments: [],
    contacts: [],
    events: [],
    ...overrides,
  };
}

/** Local LA wall-clock → epoch ms. */
export function la(dateStr, timeStr) {
  return zonedToUtc(dateStr, timeStr, TZ);
}

export function dose(medication_id, strength_mg, quantity, occurredMs, extra = {}) {
  return createEvent(
    { event_type: 'medication', status: 'taken', medication_id, strength_mg, quantity, total_mg: strength_mg * quantity, occurred_ms: occurredMs, ...extra },
    { nowMs: occurredMs + 1000, tz: TZ }
  );
}
