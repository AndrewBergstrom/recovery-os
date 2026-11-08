// safety-rules.js — pure, testable guardrails. Warnings are never a substitute
// for clinician or pharmacist review, and the app never blocks the patient from
// recording what actually happened.

import { fromIso } from './time.js';
import { currentEvents } from './events.js';
import { activeOrders, isPrn } from './medications.js';
import { isCleared } from './exercises.js';

export const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ACETAMINOPHEN_ROLLING_MAX_MG = 3000;
export const DUPLICATE_WINDOW_MINUTES = 60;

/** Sum of recorded mg for the given medication ids in the 24 h ending at `now` (rolling, not midnight-reset). */
export function rollingTotalMg(events, medicationIds, now, windowMs = ROLLING_WINDOW_MS) {
  const ids = new Set(medicationIds);
  let total = 0;
  for (const e of currentEvents(events)) {
    if (e.event_type !== 'medication' || e.status !== 'taken' || !ids.has(e.medication_id)) continue;
    const t = fromIso(e.occurred_at);
    if (t > now - windowMs && t <= now) total += Number(e.total_mg) || 0;
  }
  return total;
}

/** Ids of every order that counts toward the acetaminophen total. */
export function acetaminophenIds(orders) {
  return activeOrders(orders, 'medication')
    .filter((o) => o.counts_as === 'acetaminophen' || o.id === 'med-acetaminophen-500')
    .map((o) => o.id);
}

/**
 * Check an attempted acetaminophen amount against the rolling 24-hour maximum.
 * `attemptMg` is what the patient is about to record; `attemptAt` its timestamp.
 */
export function acetaminophenCheck(events, orders, attemptMg, attemptAt, maxMg = ACETAMINOPHEN_ROLLING_MAX_MG) {
  const ids = acetaminophenIds(orders);
  const recorded = rollingTotalMg(events, ids, attemptAt);
  const projected = recorded + (Number(attemptMg) || 0);
  return {
    recorded_mg: recorded,
    attempted_mg: Number(attemptMg) || 0,
    projected_mg: projected,
    max_mg: maxMg,
    exceeds: projected > maxMg,
    near: !(projected > maxMg) && projected >= maxMg * 0.8,
    message:
      projected > maxMg
        ? `This would bring recorded acetaminophen to ${projected.toLocaleString('en-US')} mg in the preceding 24 hours — above the ${maxMg.toLocaleString('en-US')} mg label maximum. Check with a pharmacist or clinician before taking more.`
        : projected >= maxMg * 0.8
          ? `Recorded acetaminophen would be ${projected.toLocaleString('en-US')} mg of the ${maxMg.toLocaleString('en-US')} mg 24-hour maximum.`
          : null,
  };
}

/** Rolling total for any order that declares its own rolling_24h_max_mg (e.g. ibuprofen). */
export function orderRollingCheck(events, order, attemptMg, attemptAt) {
  if (!order?.rolling_24h_max_mg) return null;
  const recorded = rollingTotalMg(events, [order.id], attemptAt);
  const projected = recorded + (Number(attemptMg) || 0);
  return { recorded_mg: recorded, projected_mg: projected, max_mg: order.rolling_24h_max_mg, exceeds: projected > order.rolling_24h_max_mg };
}

/** Gentle possible-duplicate warning: same medication recorded within the window. Never a block. */
export function duplicateCheck(events, medicationId, occurredAt, windowMinutes = DUPLICATE_WINDOW_MINUTES) {
  const windowMs = windowMinutes * 60 * 1000;
  let closest = null;
  for (const e of currentEvents(events)) {
    if (e.event_type !== 'medication' || e.medication_id !== medicationId || e.status !== 'taken') continue;
    const gap = Math.abs(fromIso(e.occurred_at) - occurredAt);
    if (gap <= windowMs && (!closest || gap < closest.gap_ms)) closest = { event: e, gap_ms: gap };
  }
  return closest ? { possible: true, prior: closest.event, minutes_apart: Math.round(closest.gap_ms / 60000) } : { possible: false };
}

/**
 * Too-soon check against the label interval. PRN orders use their minimum interval
 * ("every 4–6 hours" → 4 h); scheduled orders use half the dosing interval as a
 * data-entry sanity check (twice daily → 6 h). Returns the most recent prior dose
 * inside that window, or null. A warning, never a block: what was taken gets recorded.
 */
export function intervalCheck(events, order, attemptAt) {
  if (!order?.schedule) return null;
  const prn = order.schedule.kind === 'prn';
  const labelHours = prn ? order.schedule.min_interval_hours : SCHEDULED_HOURS[order.schedule.frequency];
  if (!labelHours) return null;
  const windowHours = prn ? labelHours : labelHours / 2;
  const windowMs = windowHours * 3600 * 1000;
  let prior = null;
  for (const e of currentEvents(events)) {
    if (e.event_type !== 'medication' || e.medication_id !== order.id || e.status !== 'taken') continue;
    const t = fromIso(e.occurred_at);
    if (t <= attemptAt && attemptAt - t < windowMs && (!prior || t > fromIso(prior.occurred_at))) prior = e;
  }
  if (!prior) return null;
  const earliest = fromIso(prior.occurred_at) + labelHours * 3600 * 1000;
  return { prior, label_hours: labelHours, earliest, minutes_early: Math.round((earliest - attemptAt) / 60000), prn };
}
const SCHEDULED_HOURS = { 'once daily': 24, 'twice daily': 12, 'three times daily': 8, 'four times daily': 6 };

/**
 * Per-dose check against the order's allowed quantities ("1–2 tablets" → max 2).
 * Returns null when within the order, otherwise the maximum the order allows.
 */
export function perDoseCheck(order, quantity) {
  const allowed = order?.quantity_options?.length ? Math.max(...order.quantity_options) : null;
  if (!allowed || !(Number(quantity) > allowed)) return null;
  return { max_quantity: allowed, attempted: Number(quantity) };
}

/** Interaction notices declared on an order (e.g. ibuprofen → aspirin). Shown on the flagged order only. */
export function interactionNotices(order, orders) {
  const active = activeOrders(orders, 'medication');
  const out = [];
  for (const flag of order?.interaction_flags || []) {
    const other = active.find((o) => o.id === flag.with);
    if (other) out.push({ with: other, message: flag.message });
  }
  return out;
}

/** Orders that declare an interaction with this one (for a softer cross-reference note). */
export function flaggedBy(order, orders) {
  return activeOrders(orders, 'medication').filter((o) => (o.interaction_flags || []).some((f) => f.with === order?.id));
}

/** PRN medicines are never "due" or "missed". */
export function prnNeverOverdue(order) {
  return isPrn(order) ? { overdue: false, reason: 'As needed — never counted as missed.' } : null;
}

/** Uncleared exercises are never presented as prescribed due tasks. */
export function exerciseIsDue(exercise) {
  return isCleared(exercise);
}

/**
 * Weight-bearing progression is never advanced by the app. While the duration
 * question is open, the conservative restriction stays, regardless of day count.
 */
export function weightBearingState(questions, dayCount) {
  const q = (questions || []).find((x) => x.id === 'weight-bearing-duration');
  const open = !q || q.status === 'needs_clinician_confirmation';
  return {
    restriction: 'Toe-touch weight-bearing',
    auto_advance: false,
    needs_confirmation: open,
    label: open
      ? `Toe-touch weight-bearing — duration needs surgeon confirmation (day ${dayCount})`
      : `Toe-touch weight-bearing — confirmed ${q.resolution?.value || ''}`.trim(),
    note: open && dayCount >= 14 ? 'Day 14 reached, but the 2-vs-6-week discrepancy is unresolved: keep the conservative restriction and contact the surgeon.' : null,
  };
}

/** Missing data is "Not recorded" — never "missed" and never "taken". */
export function recordedLabel(value, formatter = (v) => String(v)) {
  return value == null || value === '' ? 'Not recorded' : formatter(value);
}

export const HIGH_PRIORITY_SYMPTOMS = [
  { id: 'chest_pain', label: 'Chest pain', level: 'emergency' },
  { id: 'shortness_of_breath', label: 'Shortness of breath', level: 'emergency' },
  { id: 'calf_pain_swelling', label: 'Severe calf pain or swelling', level: 'clinician_now' },
  { id: 'fever', label: 'Fever', level: 'clinician_now' },
  { id: 'wound_changes', label: 'Concerning wound changes (spreading redness, drainage, opening)', level: 'clinician_now' },
  { id: 'uncontrolled_pain', label: 'Pain that is not controlled', level: 'clinician_now' },
];

export const ESCALATION_TEXT = {
  emergency: 'Chest pain or shortness of breath: call emergency services (911 in the US) now. Do not wait for the app.',
  clinician_now: 'Contact your surgeon or clinic now (or the after-hours line). This app does not assess symptoms.',
};

/** Explicit care-seeking instruction for flagged symptoms; never a reassuring score. */
export function escalationFor(symptomIds = []) {
  const flagged = HIGH_PRIORITY_SYMPTOMS.filter((s) => symptomIds.includes(s.id));
  if (!flagged.length) return { level: null, message: null, flagged };
  const level = flagged.some((s) => s.level === 'emergency') ? 'emergency' : 'clinician_now';
  return { level, message: ESCALATION_TEXT[level], flagged };
}

export const PRODUCT_BOUNDARY =
  'Recovery OS organizes your own entries. It does not give medical advice, diagnose complications or change your orders. A clinician’s confirmed directions control medications, exercises, restrictions and progression.';
