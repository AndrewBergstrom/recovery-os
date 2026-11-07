// events.js — the event model. Events are append-only; changes are corrections
// that reference the prior event. The current view is derived, never edited in place.

import { DEFAULT_TZ, toIso, fromIso, datetimeLocalValue, localDateString, formatTime } from './time.js';

export const EVENT_TYPES = ['medication', 'exercise', 'ice_elevate', 'checkin', 'note'];

export const STATUSES = {
  medication: ['taken', 'skipped', 'voided'],
  exercise: ['completed', 'stopped_early', 'not_today', 'voided'],
  ice_elevate: ['completed', 'voided'],
  checkin: ['recorded', 'voided'],
  note: ['recorded', 'voided'],
};

const TYPE_FIELDS = {
  medication: ['medication_id', 'strength_mg', 'quantity', 'total_mg', 'pain'],
  exercise: [
    'exercise_id',
    'sets',
    'reps',
    'duration_seconds',
    'hold_seconds',
    'max_bend_deg',
    'brace_on',
    'symptom_response',
    'completed',
    'cleared_at_time',
  ],
  ice_elevate: ['kind', 'duration_minutes', 'barrier_confirmed'],
  checkin: ['pain', 'swelling', 'symptoms'],
  note: ['category', 'text'],
};

export const CORRECTION_REASONS = [
  { id: 'wrong_time', label: 'Wrong time', voids: false },
  { id: 'wrong_amount', label: 'Wrong amount or details', voids: false },
  { id: 'not_taken', label: "Didn't actually do or take this", voids: true },
  { id: 'duplicate', label: 'Duplicate entry', voids: true },
  { id: 'other', label: 'Other (explain in note)', voids: false },
];

export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback: time + random, never used for security.
  return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a complete event object. Nothing is persisted here — the caller stores
 * it only after the patient explicitly confirms.
 */
export function createEvent(input, { nowMs = Date.now(), tz = DEFAULT_TZ } = {}) {
  const type = input.event_type;
  const occurredMs = Number.isFinite(input.occurred_ms) ? input.occurred_ms : nowMs;
  const ev = {
    id: input.id || newId(),
    event_type: type,
    occurred_at: toIso(occurredMs),
    occurred_local: datetimeLocalValue(occurredMs, tz),
    recorded_at: toIso(nowMs),
    timezone: tz,
    created_by: input.created_by || 'patient',
    source: input.source || 'quick_log',
    order_version: input.order_version ?? null,
    status: input.status,
    notes: typeof input.notes === 'string' ? input.notes.trim() : '',
    corrects: input.corrects || null,
    correction_reason: input.correction_reason || null,
  };
  for (const f of TYPE_FIELDS[type] || []) {
    if (input[f] !== undefined) ev[f] = input[f];
  }
  return ev;
}

export function validateEvent(ev) {
  const errors = [];
  if (!ev || typeof ev !== 'object') return ['Event must be an object.'];
  if (typeof ev.id !== 'string' || !ev.id) errors.push('Missing id.');
  if (!EVENT_TYPES.includes(ev.event_type)) errors.push(`Unknown event_type "${ev.event_type}".`);
  if (!Number.isFinite(fromIso(ev.occurred_at))) errors.push('occurred_at must be an ISO-8601 timestamp.');
  if (!Number.isFinite(fromIso(ev.recorded_at))) errors.push('recorded_at must be an ISO-8601 timestamp.');
  if (typeof ev.timezone !== 'string' || !ev.timezone) errors.push('Missing timezone.');
  if (typeof ev.created_by !== 'string' || !ev.created_by) errors.push('Missing created_by.');
  if (typeof ev.source !== 'string' || !ev.source) errors.push('Missing source.');
  const allowed = STATUSES[ev.event_type];
  if (allowed && !allowed.includes(ev.status)) errors.push(`Invalid status "${ev.status}" for ${ev.event_type}.`);
  if (ev.status !== 'voided') {
    if (ev.event_type === 'medication') {
      if (typeof ev.medication_id !== 'string') errors.push('Medication event needs medication_id.');
      if (!(Number(ev.quantity) > 0)) errors.push('Medication quantity must be greater than zero.');
      if (!(Number(ev.total_mg) >= 0)) errors.push('Medication total_mg must be a number.');
    }
    if (ev.event_type === 'exercise' && typeof ev.exercise_id !== 'string') errors.push('Exercise event needs exercise_id.');
    if (ev.event_type === 'ice_elevate' && !['ice', 'elevate', 'both'].includes(ev.kind)) errors.push('Ice/elevate kind must be ice, elevate or both.');
    if (ev.event_type === 'checkin' && ev.pain != null && !(ev.pain >= 0 && ev.pain <= 10)) errors.push('Pain must be 0–10.');
    if (ev.event_type === 'note' && (typeof ev.text !== 'string' || !ev.text.trim())) errors.push('Note text is required.');
  }
  if (ev.corrects != null && typeof ev.corrects !== 'string') errors.push('corrects must reference an event id.');
  return errors;
}

/** Ids of events that a later correction references. */
export function supersededIds(events) {
  const ids = new Set();
  for (const e of events) if (e.corrects) ids.add(e.corrects);
  return ids;
}

/** Events that are current: not superseded by a correction, and not void tombstones. */
export function currentEvents(events) {
  const superseded = supersededIds(events);
  return events.filter((e) => !superseded.has(e.id) && e.status !== 'voided');
}

/**
 * Create a correction event for `original`. The original is preserved; the
 * correction references it. A voiding correction is a tombstone.
 */
export function createCorrection(original, changes, { reason, note, nowMs = Date.now(), tz = DEFAULT_TZ, created_by = 'patient' } = {}) {
  const reasonDef = CORRECTION_REASONS.find((r) => r.id === reason);
  if (!reasonDef) throw new Error('A correction reason is required.');
  const base = {};
  for (const f of TYPE_FIELDS[original.event_type] || []) if (original[f] !== undefined) base[f] = original[f];
  const occurredMs = Number.isFinite(changes.occurred_ms) ? changes.occurred_ms : fromIso(original.occurred_at);
  return createEvent(
    {
      ...base,
      ...changes,
      event_type: original.event_type,
      occurred_ms: occurredMs,
      status: reasonDef.voids ? 'voided' : changes.status || original.status,
      source: 'correction',
      created_by,
      order_version: original.order_version ?? null,
      notes: note != null ? note : original.notes,
      corrects: original.id,
      correction_reason: reason,
    },
    { nowMs, tz }
  );
}

export function sortByOccurred(events, direction = 'desc') {
  const sign = direction === 'asc' ? 1 : -1;
  return [...events].sort((a, b) => sign * (fromIso(a.occurred_at) - fromIso(b.occurred_at)));
}

export function eventsOnLocalDate(events, dateStr, tz = DEFAULT_TZ) {
  return events.filter((e) => localDateString(fromIso(e.occurred_at), tz) === dateStr);
}

export function latestEvent(events) {
  let best = null;
  for (const e of events) if (!best || fromIso(e.occurred_at) > fromIso(best.occurred_at)) best = e;
  return best;
}

const SYMPTOM_LABELS = { comfortable: 'comfortable', mild_discomfort: 'mild discomfort', stopped_symptoms: 'stopped due to symptoms' };

/** Format a milligram amount for display; grams when the order is dosed in grams. */
export function formatMg(mg, displayUnit = 'mg') {
  const n = Number(mg) || 0;
  if (displayUnit === 'g') return `${Number((n / 1000).toFixed(2))} g`;
  return `${Number(n.toFixed(2)).toLocaleString('en-US')} mg`;
}

/** Short human description of an event, for lists and summaries. */
export function describeEvent(ev, ordersById = {}, tz = DEFAULT_TZ) {
  const order = ordersById[ev.medication_id || ev.exercise_id];
  switch (ev.event_type) {
    case 'medication': {
      const name = order ? order.name : ev.medication_id;
      const qty = ev.quantity;
      const unit = order ? order.unit || 'tablet' : 'tablet';
      const strength = order?.display_strength || `${ev.strength_mg} mg`;
      const total = formatMg(ev.total_mg, order?.strength_display_unit);
      return `${name} ${strength} × ${qty} ${unit}${qty === 1 ? '' : 's'} (${total})${ev.status === 'skipped' ? ' — skipped' : ''}`;
    }
    case 'exercise': {
      const name = order ? order.name : ev.exercise_id;
      const bits = [];
      if (ev.sets && ev.reps) bits.push(`${ev.sets}×${ev.reps}`);
      else if (ev.reps) bits.push(`${ev.reps} reps`);
      if (ev.duration_seconds) bits.push(`${Math.round(ev.duration_seconds / 60)} min`);
      if (ev.symptom_response) bits.push(SYMPTOM_LABELS[ev.symptom_response] || ev.symptom_response);
      if (ev.status === 'stopped_early') bits.push('stopped early');
      if (ev.status === 'not_today') bits.push('not today');
      return `${name}${bits.length ? ' · ' + bits.join(' · ') : ''}`;
    }
    case 'ice_elevate': {
      const kind = ev.kind === 'both' ? 'Ice + elevate' : ev.kind === 'ice' ? 'Ice' : 'Elevate';
      return `${kind}${ev.duration_minutes ? ` ${ev.duration_minutes} min` : ''}`;
    }
    case 'checkin': {
      const bits = [];
      if (ev.pain != null) bits.push(`pain ${ev.pain}/10`);
      if (ev.swelling) bits.push(`swelling ${ev.swelling}`);
      if (Array.isArray(ev.symptoms) && ev.symptoms.length) bits.push(`${ev.symptoms.length} symptom flag${ev.symptoms.length === 1 ? '' : 's'}`);
      return `Check-in${bits.length ? ' · ' + bits.join(' · ') : ''}`;
    }
    case 'note': {
      const cat = ev.category && ev.category !== 'journal' ? `${ev.category.replace(/_/g, ' ')}: ` : 'Note: ';
      const text = (ev.text || '').trim();
      return cat + (text.length > 70 ? text.slice(0, 67) + '…' : text);
    }
    default:
      return ev.event_type;
  }
}

export function eventTimeLabel(ev, tz = DEFAULT_TZ) {
  return formatTime(fromIso(ev.occurred_at), tz);
}
