// export-import.js — canonical JSON export, validated/previewed import, and the
// Markdown visit summary. JSON is the exchange format; Markdown is generated.

import { EVENT_TYPES, STATUSES, currentEvents, describeEvent, sortByOccurred, supersededIds } from './events.js';
import { DEFAULT_TZ, fromIso, localDateString, formatDateStr, formatTime, daysSinceSurgery, addDays, isValidDateStr } from './time.js';
import { activeOrders, ordersById, lastConfirmedDose } from './medications.js';
import { KEY_PATHS } from './db.js';
import { weightBearingState } from './safety-rules.js';

export const SCHEMA_VERSION = '1.0.0';

const COLLECTIONS = [
  { store: 'events', field: 'events' },
  { store: 'orders', field: 'care_orders' },
  { store: 'questions', field: 'unresolved_questions' },
  { store: 'milestones', field: 'milestones' },
  { store: 'appointments', field: 'appointments' },
  { store: 'contacts', field: 'contacts' },
  { store: 'slot_states', field: 'slot_states' },
];

export function orderKeyOf(o) {
  return o.key || `${o.id}@v${o.version || 1}`;
}

function keyFor(store, obj) {
  return store === 'orders' ? orderKeyOf(obj) : obj[KEY_PATHS[store]];
}

export function buildExport(state, { nowIso = new Date().toISOString(), appVersion = 'dev' } = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    app_version: appVersion,
    exported_at: nowIso,
    timezone: state.profile?.timezone || DEFAULT_TZ,
    profile: { ...state.profile },
    activation: state.meta?.activation ? { ...state.meta.activation } : null,
    care_orders: state.orders.map((o) => ({ ...o, key: orderKeyOf(o) })),
    events: [...state.events],
    unresolved_questions: [...state.questions],
    milestones: [...(state.milestones || [])],
    appointments: [...(state.appointments || [])],
    contacts: [...(state.contacts || [])],
    slot_states: [...(state.slotStates || [])],
    proposals: [],
    note: 'events contains only entries the patient explicitly confirmed. No entry means "not recorded", never "not taken".',
  };
}

function isIso(s) {
  return typeof s === 'string' && Number.isFinite(fromIso(s));
}

/** Structural validation. Returns { ok, errors } with at most 25 messages. Never throws. */
export function validateExport(obj) {
  const errors = [];
  const err = (m) => {
    if (errors.length < 25) errors.push(m);
  };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['Backup must be a JSON object.'] };
  if (typeof obj.schema_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(obj.schema_version)) err('schema_version must look like 1.0.0.');
  else if (obj.schema_version.split('.')[0] !== SCHEMA_VERSION.split('.')[0]) err(`Unsupported schema version ${obj.schema_version} (this app reads ${SCHEMA_VERSION.split('.')[0]}.x).`);
  if (typeof obj.timezone !== 'string' || !obj.timezone) err('timezone is required.');
  if (!obj.profile || typeof obj.profile !== 'object') err('profile is required.');
  else {
    if (!isValidDateStr(obj.profile.surgery_date)) err('profile.surgery_date must be YYYY-MM-DD.');
    if (!['left', 'right', 'both'].includes(obj.profile.surgical_side)) err('profile.surgical_side must be left, right or both.');
  }
  for (const c of COLLECTIONS) {
    const arr = obj[c.field];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) {
      err(`${c.field} must be an array.`);
      continue;
    }
    const seen = new Set();
    arr.forEach((item, i) => {
      if (!item || typeof item !== 'object') return err(`${c.field}[${i}] is not an object.`);
      const key = keyFor(c.store, item);
      if (key === undefined || key === null || key === '') return err(`${c.field}[${i}] is missing its ${KEY_PATHS[c.store]}.`);
      if (seen.has(key)) err(`${c.field} has a duplicate id "${key}".`);
      seen.add(key);
      if (c.store === 'events') {
        if (!EVENT_TYPES.includes(item.event_type)) err(`events[${i}] has unknown event_type "${item.event_type}".`);
        else if (STATUSES[item.event_type] && !STATUSES[item.event_type].includes(item.status)) err(`events[${i}] has invalid status "${item.status}".`);
        if (!isIso(item.occurred_at)) err(`events[${i}].occurred_at is not an ISO timestamp.`);
        if (!isIso(item.recorded_at)) err(`events[${i}].recorded_at is not an ISO timestamp.`);
        if (typeof item.timezone !== 'string') err(`events[${i}] is missing timezone.`);
        if (typeof item.created_by !== 'string') err(`events[${i}] is missing created_by.`);
        if (item.event_type === 'medication' && item.status !== 'voided') {
          if (typeof item.medication_id !== 'string') err(`events[${i}] medication event is missing medication_id.`);
          if (!(Number(item.quantity) > 0)) err(`events[${i}] medication quantity must be > 0.`);
          if (!(Number(item.total_mg) >= 0)) err(`events[${i}] medication total_mg must be a number.`);
        }
        if (item.event_type === 'exercise' && item.status !== 'voided' && typeof item.exercise_id !== 'string') err(`events[${i}] exercise event is missing exercise_id.`);
      }
      if (c.store === 'orders') {
        if (!['medication', 'exercise'].includes(item.type)) err(`care_orders[${i}] has unknown type "${item.type}".`);
        if (typeof item.id !== 'string') err(`care_orders[${i}] is missing id.`);
        if (!(Number.isInteger(item.version) && item.version >= 1)) err(`care_orders[${i}] needs an integer version ≥ 1.`);
        if (typeof item.status !== 'string') err(`care_orders[${i}] is missing status.`);
      }
      if (c.store === 'questions' && typeof item.status !== 'string') err(`unresolved_questions[${i}] is missing status.`);
      if (c.store === 'slot_states' && !['in_progress', 'skipped'].includes(item.status)) err(`slot_states[${i}] has invalid status "${item.status}".`);
    });
  }
  return { ok: errors.length === 0, errors };
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Compare an incoming (already validated) backup with the current state.
 * Existing entries are never overwritten; conflicts are listed for the patient.
 */
export function diffImport(state, incoming) {
  const sections = {};
  for (const c of COLLECTIONS) {
    const existingList = c.store === 'slot_states' ? state.slotStates || [] : state[c.store] || [];
    const existing = new Map(existingList.map((o) => [keyFor(c.store, o), o]));
    const section = { field: c.field, store: c.store, new: [], identical: 0, conflicts: [] };
    for (const item of incoming[c.field] || []) {
      const obj = c.store === 'orders' ? { ...item, key: orderKeyOf(item) } : item;
      const key = keyFor(c.store, obj);
      const cur = existing.get(key);
      if (!cur) section.new.push(obj);
      else if (deepEqual(cur, obj)) section.identical += 1;
      else section.conflicts.push({ key, existing: cur, incoming: obj });
    }
    sections[c.store] = section;
  }
  const noLocalHistory = (state.events || []).length === 0 && !state.meta?.activation;
  let profile = { status: 'none' };
  if (incoming.profile) {
    if (noLocalHistory) profile = { status: 'adopt', incoming: incoming.profile };
    else if (deepEqual({ ...state.profile, key: 'profile' }, { ...incoming.profile, key: 'profile' })) profile = { status: 'same' };
    else profile = { status: 'conflict', existing: state.profile, incoming: incoming.profile };
  }
  const activation = incoming.activation && noLocalHistory ? { status: 'adopt', incoming: incoming.activation } : { status: 'none' };
  const totalNew = Object.values(sections).reduce((n, s) => n + s.new.length, 0);
  const totalConflicts = Object.values(sections).reduce((n, s) => n + s.conflicts.length, 0);
  return { sections, profile, activation, totalNew, totalConflicts };
}

/** Write every new entry in ONE transaction. Conflicts are skipped (existing kept). */
export async function applyImport(store, diff) {
  const items = [];
  for (const s of Object.values(diff.sections)) for (const obj of s.new) items.push({ store: s.store, obj });
  if (diff.profile.status === 'adopt') items.push({ store: 'meta', obj: { ...diff.profile.incoming, key: 'profile' } });
  if (diff.activation.status === 'adopt') items.push({ store: 'meta', obj: { ...diff.activation.incoming, key: 'activation' } });
  if (!items.length) return { written: 0 };
  await store.bulkPut(items);
  return { written: items.length };
}

export function parseBackupText(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${e.message}`] };
  }
}

// ---------- Visit summary (Markdown, generated from recorded facts only) ----------

const SWELLING = { less: 'less', same: 'same', more: 'more', unsure: 'unsure' };

export function buildVisitSummary(state, { now = Date.now(), days = 14 } = {}) {
  const tz = state.profile?.timezone || DEFAULT_TZ;
  const byId = ordersById(state.orders);
  const current = currentEvents(state.events);
  const todayStr = localDateString(now, tz);
  const fromStr = addDays(todayStr, -(days - 1));
  const inRange = current.filter((e) => {
    const d = localDateString(fromIso(e.occurred_at), tz);
    return d >= fromStr && d <= todayStr;
  });
  const dayCount = daysSinceSurgery(state.profile.surgery_date, now, tz);
  const lines = [];
  const push = (s = '') => lines.push(s);

  push('# Recovery OS — visit summary');
  push();
  push(`Generated ${formatDateStr(todayStr, { month: 'long', day: 'numeric', year: 'numeric' })} · Day ${dayCount} after ${state.profile.surgical_side} ${state.profile.joint || 'knee'} surgery (${formatDateStr(state.profile.surgery_date, { month: 'long', day: 'numeric', year: 'numeric' })}) · Time zone ${tz}`);
  push();
  push('> Generated from entries recorded in the app only. **Not recorded** means no entry exists; it does not mean not taken or not done. Nothing here is a clinical assessment.');
  push();
  push('## Procedures (as documented)');
  for (const p of state.profile.procedures || []) push(`- ${p}`);
  push();

  const open = state.questions.filter((q) => q.status === 'needs_clinician_confirmation');
  push(`## Open questions for clinicians (${open.length})`);
  if (!open.length) push('- None open.');
  for (const q of open) push(`- **${q.topic}** — ask ${q.ask}. Paperwork says: ${q.conflicting_values.join(' vs. ')}.`);
  const resolved = state.questions.filter((q) => q.status === 'resolved');
  if (resolved.length) {
    push();
    push('### Resolved');
    for (const q of resolved) push(`- ${q.topic}: ${q.resolution?.value || ''} (confirmed by ${q.resolution?.confirmed_by || '?'} on ${q.resolution?.confirmed_on || '?'})`);
  }
  push();
  const wb = weightBearingState(state.questions, dayCount);
  push('## Current restrictions (as recorded)');
  push(`- ${wb.label}`);
  push('- Knee flexion limited to 0–90° until formally cleared');
  push('- Brace locked at 0° for walking; sleeping/showering instruction unresolved unless noted above');
  push();

  const userQuestions = current.filter((e) => e.event_type === 'note' && e.category && e.category !== 'journal');
  push(`## Patient questions (${userQuestions.length})`);
  if (!userQuestions.length) push('- None recorded.');
  for (const n of sortByOccurred(userQuestions, 'asc')) push(`- [${n.category.replace(/_/g, ' ')}] ${n.text}`);
  push();

  push(`## Medication entries — last ${days} days`);
  const medOrders = activeOrders(state.orders, 'medication');
  const medEvents = inRange.filter((e) => e.event_type === 'medication' && e.status === 'taken');
  if (!medEvents.length) push('- No medication entries recorded in this period.');
  else {
    push('| Date | Medication | Doses recorded | Total |');
    push('|---|---|---|---|');
    const groups = new Map();
    for (const e of medEvents) {
      const d = localDateString(fromIso(e.occurred_at), tz);
      const k = `${d}|${e.medication_id}`;
      const g = groups.get(k) || { date: d, id: e.medication_id, doses: 0, total: 0 };
      g.doses += 1;
      g.total += Number(e.total_mg) || 0;
      groups.set(k, g);
    }
    for (const g of [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)))) {
      const o = byId[g.id];
      const total = o?.strength_display_unit === 'g' ? `${g.total / 1000} g` : `${g.total.toLocaleString('en-US')} mg`;
      push(`| ${g.date} | ${o ? o.name : g.id} | ${g.doses} | ${total} |`);
    }
  }
  push();
  push('Last confirmed dose per order:');
  for (const o of medOrders) {
    const last = lastConfirmedDose(state.events, o.id);
    push(`- ${o.name} ${o.display_strength} (${o.schedule?.kind === 'prn' ? 'as needed' : o.status.replace(/_/g, ' ')}): ${last ? `${formatDateStr(localDateString(fromIso(last.occurred_at), tz))} ${formatTime(fromIso(last.occurred_at), tz)}` : 'Not recorded'}`);
  }
  push();

  const sessions = inRange.filter((e) => e.event_type === 'exercise');
  push(`## Movement sessions — last ${days} days (${sessions.length})`);
  if (!sessions.length) push('- None recorded.');
  for (const s of sortByOccurred(sessions, 'asc')) push(`- ${localDateString(fromIso(s.occurred_at), tz)} ${formatTime(fromIso(s.occurred_at), tz)}: ${describeEvent(s, byId, tz)}${s.cleared_at_time === false ? ' (exercise not cleared at the time — patient-reported)' : ''}`);
  push();

  const ice = inRange.filter((e) => e.event_type === 'ice_elevate');
  push(`## Ice / elevation — last ${days} days (${ice.length} sessions)`);
  const iceByDay = new Map();
  for (const e of ice) {
    const d = localDateString(fromIso(e.occurred_at), tz);
    iceByDay.set(d, (iceByDay.get(d) || 0) + 1);
  }
  if (!ice.length) push('- None recorded.');
  for (const [d, n] of [...iceByDay.entries()].sort()) push(`- ${d}: ${n} session${n === 1 ? '' : 's'}`);
  push();

  const checkins = inRange.filter((e) => e.event_type === 'checkin');
  push(`## Check-ins — last ${days} days (${checkins.length})`);
  if (!checkins.length) push('- None recorded.');
  else {
    push('| When | Pain (0–10) | Swelling | Symptom flags | Note |');
    push('|---|---|---|---|---|');
    for (const c of sortByOccurred(checkins, 'asc')) {
      const when = `${localDateString(fromIso(c.occurred_at), tz)} ${formatTime(fromIso(c.occurred_at), tz)}`;
      const flags = Array.isArray(c.symptoms) && c.symptoms.length ? c.symptoms.join(', ') : '—';
      push(`| ${when} | ${c.pain ?? 'Not recorded'} | ${c.swelling ? SWELLING[c.swelling] || c.swelling : 'Not recorded'} | ${flags} | ${(c.notes || '').replace(/\|/g, '/') || '—'} |`);
    }
  }
  push();

  const journal = inRange.filter((e) => e.event_type === 'note' && (!e.category || e.category === 'journal'));
  push(`## Journal notes — last ${days} days (${journal.length})`);
  for (const n of sortByOccurred(journal, 'asc')) push(`- ${localDateString(fromIso(n.occurred_at), tz)}: ${n.text}`);
  if (!journal.length) push('- None recorded.');
  push();

  const corrections = state.events.filter((e) => e.corrects);
  const voided = state.events.filter((e) => e.status === 'voided');
  push('## Data completeness');
  const daysWithEntries = new Set(inRange.map((e) => localDateString(fromIso(e.occurred_at), tz)));
  const missingDays = [];
  for (let d = fromStr; d <= todayStr; d = addDays(d, 1)) if (d >= state.profile.surgery_date && !daysWithEntries.has(d)) missingDays.push(d);
  push(`- Entries in period: ${inRange.length}; days since surgery with no entries: ${missingDays.length ? missingDays.join(', ') : 'none'}`);
  push(`- Corrections recorded: ${corrections.length} (${voided.length} voided entries); originals are preserved in the audit trail`);
  push(`- Superseded entries excluded from counts above: ${supersededIds(state.events).size}`);
  push();
  push('_Recovery OS organizes patient-entered information. It does not replace individualized medical advice._');
  return lines.join('\n');
}
