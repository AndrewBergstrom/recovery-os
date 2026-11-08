// medications.js — medication ORDER helpers. Orders are versioned; events are separate.
// Nothing here ever records a dose.

import { DEFAULT_TZ, fromIso, nextOccurrence, previousOccurrence, addDays, localDateString } from './time.js';
import { currentEvents } from './events.js';
import { orderKey } from './seed.js';

export { orderKey };

/** Latest version of every order (optionally filtered by type). */
export function activeOrders(orders, type = null) {
  const byId = new Map();
  for (const o of orders) {
    if (type && o.type !== type) continue;
    const prev = byId.get(o.id);
    if (!prev || (o.version || 1) > (prev.version || 1)) byId.set(o.id, o);
  }
  return [...byId.values()];
}

export function ordersById(orders) {
  return Object.fromEntries(activeOrders(orders).map((o) => [o.id, o]));
}

export function isPrn(order) {
  return order?.schedule?.kind === 'prn';
}

export function isScheduled(order) {
  return order?.schedule?.kind === 'scheduled';
}

export function isScheduleConfirmed(order) {
  return isScheduled(order) && order.status === 'confirmed' && Array.isArray(order.schedule.times) && order.schedule.times.length > 0;
}

export const STATUS_LABELS = {
  needs_schedule_confirmation: { text: 'Schedule needs confirmation', tone: 'warning' },
  needs_prescriber_confirmation: { text: 'Prescriber confirmation required', tone: 'warning' },
  prn: { text: 'As needed · available to log if taken', tone: 'neutral' },
  confirmed: { text: 'Scheduled · confirmed', tone: 'ok' },
};

/**
 * Status chip for an order. A prescriber-confirmation hold that hangs on a linked
 * question (ibuprofen ↔ aspirin) lifts once the patient has recorded the answer.
 */
export function statusLabel(order, questions = []) {
  if (order.status === 'needs_prescriber_confirmation' && prescriberHoldResolved(order, questions)) {
    return { text: 'As needed · confirmed with prescriber', tone: 'ok' };
  }
  return STATUS_LABELS[order.status] || { text: order.status, tone: 'neutral' };
}

export function prescriberHoldResolved(order, questions = []) {
  const ids = (order.interaction_flags || []).map((f) => f.question_id).filter(Boolean);
  if (!ids.length) return false;
  return ids.every((id) => (questions || []).find((q) => q.id === id)?.status === 'resolved');
}

/** Most recent current medication event with status "taken" for a medication. */
export function lastConfirmedDose(events, medicationId) {
  let best = null;
  for (const e of currentEvents(events)) {
    if (e.event_type !== 'medication' || e.medication_id !== medicationId || e.status !== 'taken') continue;
    if (!best || fromIso(e.occurred_at) > fromIso(best.occurred_at)) best = e;
  }
  return best;
}

export function medicationEventsFor(events, medicationId) {
  return currentEvents(events).filter((e) => e.event_type === 'medication' && e.medication_id === medicationId && e.status === 'taken');
}

/** Next scheduled occurrence for a confirmed scheduled order; null for PRN/unconfirmed. */
export function nextScheduledDose(order, now, tz = DEFAULT_TZ) {
  if (!isScheduleConfirmed(order)) return null;
  if (order.schedule.course_end && localDateString(now, tz) > order.schedule.course_end) return null;
  let best = null;
  for (const t of order.schedule.times) {
    const occ = nextOccurrence(t, now, tz);
    if (occ && (!best || occ.ms < best.ms)) best = { ...occ, time: t };
  }
  return best;
}

/**
 * The most recent scheduled time (within `windowHours`) with no dose recorded
 * near it. Used only to show "Scheduled 6:00 PM · Not recorded" — never to
 * recommend taking a dose now.
 */
export function recentScheduledWithoutDose(order, events, now, tz = DEFAULT_TZ, windowHours = 3) {
  if (!isScheduleConfirmed(order)) return null;
  let latest = null;
  for (const t of order.schedule.times) {
    const occ = previousOccurrence(t, now, tz);
    if (occ && (!latest || occ.ms > latest.ms)) latest = { ...occ, time: t };
  }
  if (!latest) return null;
  if (now - latest.ms > windowHours * 3600 * 1000) return null;
  const doses = medicationEventsFor(events, order.id);
  const near = doses.some((e) => Math.abs(fromIso(e.occurred_at) - latest.ms) <= windowHours * 3600 * 1000);
  return near ? null : latest;
}

/** PRN medicines never produce a "due" or "overdue" state. */
export function dueState(order, events, now, tz = DEFAULT_TZ) {
  if (isPrn(order)) return { kind: 'prn', label: 'Available to log if taken' };
  if (!isScheduleConfirmed(order)) return { kind: 'unconfirmed', label: 'Schedule needs confirmation' };
  const missing = recentScheduledWithoutDose(order, events, now, tz);
  if (missing) return { kind: 'not_recorded', label: 'Not recorded', at: missing };
  const next = nextScheduledDose(order, now, tz);
  return next ? { kind: 'upcoming', label: 'Upcoming', at: next } : { kind: 'course_complete', label: 'Course end date passed' };
}

export function totalMg(order, quantity) {
  return Math.round(Number(order.strength_mg) * Number(quantity) * 1000) / 1000;
}

/**
 * Create a confirmed schedule as a NEW order version. The previous version is
 * closed (valid_to) but kept, so historical events keep the version in effect.
 */
export function confirmSchedule(order, { times, course_start, confirmed_by, confirmed_by_name, confirmed_on, source, note, todayStr }) {
  if (!Array.isArray(times) || !times.length || times.some((t) => !/^\d{2}:\d{2}$/.test(t))) throw new Error('Enter at least one valid time.');
  if (!course_start) throw new Error('Enter the course start date.');
  if (!confirmed_by) throw new Error('Record who confirmed the schedule.');
  if (!confirmed_on) throw new Error('Record the confirmation date.');
  const weeks = order.schedule?.course_weeks || null;
  const newVersion = {
    ...order,
    version: (order.version || 1) + 1,
    status: 'confirmed',
    schedule: { ...order.schedule, times: [...times].sort(), course_start, course_end: weeks ? addDays(course_start, weeks * 7) : order.schedule?.course_end || null },
    confirmed_by: confirmed_by_name ? `${confirmed_by} (${confirmed_by_name})` : confirmed_by,
    confirmed_on,
    confirmation_note: note || '',
    source: source || order.source,
    valid_from: todayStr,
    valid_to: null,
  };
  newVersion.key = orderKey(newVersion);
  const previous = { ...order, valid_to: todayStr };
  return { newVersion, previous };
}

export function versionsOf(orders, id) {
  return orders.filter((o) => o.id === id).sort((a, b) => (a.version || 1) - (b.version || 1));
}

const FREQUENCY_HOURS = { 'once daily': 24, 'twice daily': 12, 'three times daily': 8, 'four times daily': 6 };

/** Hours between doses used for predictions: PRN label interval, or the stated frequency for an unconfirmed schedule. */
export function intervalHoursFor(order) {
  if (!order?.schedule) return null;
  if (order.schedule.kind === 'prn') return order.schedule.min_interval_hours || null;
  if (isScheduleConfirmed(order)) return null; // fixed, clinician-confirmed times win
  return FREQUENCY_HOURS[order.schedule.frequency] || null;
}

/**
 * Predict the next dose for one medication from what was actually recorded.
 * PRN: earliest = last recorded dose + label interval (never a "due" time).
 * Confirmed schedule: the next fixed time. Unconfirmed schedule: last dose + stated interval.
 */
export function predictNextDose(order, events, now, tz = DEFAULT_TZ) {
  if (!order) return null;
  if (isScheduleConfirmed(order)) {
    const next = nextScheduledDose(order, now, tz);
    return next ? { kind: 'scheduled', at: next.ms, basis: lastConfirmedDose(events, order.id) } : null;
  }
  const last = lastConfirmedDose(events, order.id);
  const hours = intervalHoursFor(order);
  if (!last || !hours) return null;
  const earliest = fromIso(last.occurred_at) + hours * 3600 * 1000;
  return { kind: isPrn(order) ? 'prn' : 'interval', at: earliest, hours, basis: last, available: now >= earliest, max_hours: order.schedule.max_interval_hours || null };
}
