// sample-data.js — de-identified demo entries, loaded ONLY on explicit request from
// Settings. Every entry is tagged created_by: "sample" and labelled in the UI.
// Deliberately contains NO medication doses, so "last confirmed dose" is never faked.

import { createEvent } from './events.js';

export const SAMPLE_CREATOR = 'sample';

export function sampleEvents({ nowMs = Date.now(), tz }) {
  const h = 3600 * 1000;
  const common = { created_by: SAMPLE_CREATOR, source: 'sample', notes: 'SAMPLE — not a real entry' };
  return [
    createEvent({ ...common, event_type: 'ice_elevate', status: 'completed', kind: 'both', duration_minutes: 20, barrier_confirmed: true, occurred_ms: nowMs - 2 * h }, { nowMs, tz }),
    createEvent({ ...common, event_type: 'checkin', status: 'recorded', pain: 4, swelling: 'same', symptoms: [], occurred_ms: nowMs - 3 * h }, { nowMs, tz }),
    createEvent({ ...common, event_type: 'note', status: 'recorded', category: 'question_for_surgeon', text: 'Sample question: which weight-bearing duration applies, 2 or 6 weeks?', occurred_ms: nowMs - 5 * h }, { nowMs, tz }),
    createEvent({ ...common, event_type: 'ice_elevate', status: 'completed', kind: 'ice', duration_minutes: 25, barrier_confirmed: true, occurred_ms: nowMs - 7 * h }, { nowMs, tz }),
  ];
}

export function isSample(ev) {
  return ev?.created_by === SAMPLE_CREATOR;
}
