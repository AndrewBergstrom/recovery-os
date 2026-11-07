// schedule.js — turns orders + routine into the day's "pills" (slots) and derives
// each pill's status from recorded events. Pure functions; no DOM.
//
// Status vocabulary (what the calendar colours):
//   done         green   — an entry was recorded for this slot
//   in_progress  yellow  — the patient tapped Start and hasn't finished
//   todo         red     — the slot time passed (plus a grace window) with nothing recorded
//   due          indigo  — the slot time has arrived; inside the grace window
//   upcoming     grey    — later today or a future day
//   open         grey, dashed — optional item (check-in) not done yet
//   skipped      grey, struck — the patient explicitly skipped it
//   info         grey    — milestone / appointment (never red)
//
// PRN medicines never become slots: they are offered, never due.

import { activeOrders, isScheduled, isScheduleConfirmed, lastConfirmedDose, medicationEventsFor, predictNextDose, intervalHoursFor } from './medications.js';
import { partitionExercises } from './exercises.js';
import { currentEvents } from './events.js';
import { zonedToUtc, localDateString, localTimeString, fromIso, addDays, formatDateStr, DEFAULT_TZ } from './time.js';

export const DEFAULT_ROUTINE = {
  key: 'routine',
  ice_times: ['09:00', '13:00', '17:00', '21:00'],
  checkin_time: '20:00',
  exercise_times: ['09:30', '14:30', '19:30'],
  placeholder_med_times: { 'med-aspirin-81': ['08:00', '18:00'] },
  day_start_hour: 7,
  day_end_hour: 22,
};

/** Minutes after the slot time before an unrecorded slot turns red. */
export const GRACE_MINUTES = { medication: 60, ice_elevate: 90, exercise: 120, checkin: 240 };

/** How far (ms) from the slot time a loose entry (logged without a slot) may be to count for it. */
export const MATCH_WINDOW_MS = { medication: 4 * 3600 * 1000, ice_elevate: 3 * 3600 * 1000, exercise: 4 * 3600 * 1000, checkin: 24 * 3600 * 1000 };

export function routineFrom(meta) {
  const r = meta?.routine || {};
  return {
    ...DEFAULT_ROUTINE,
    ...r,
    ice_times: Array.isArray(r.ice_times) && r.ice_times.length ? r.ice_times : DEFAULT_ROUTINE.ice_times,
    exercise_times: Array.isArray(r.exercise_times) && r.exercise_times.length ? r.exercise_times : DEFAULT_ROUTINE.exercise_times,
    placeholder_med_times: { ...DEFAULT_ROUTINE.placeholder_med_times, ...(r.placeholder_med_times || {}) },
  };
}

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');

export function slotId(kind, refId, dateStr, time) {
  return `${kind}:${refId}:${dateStr}:${time}`;
}

/** Resolve a milestone's date window from the surgery date. */
export function milestoneDate(m, surgeryDate) {
  const w = m.when || {};
  if (m.confirmed_date) return { from: m.confirmed_date, to: m.confirmed_date, label: formatDateStr(m.confirmed_date) };
  if (w.kind === 'offset_hours') {
    const d = addDays(surgeryDate, Math.floor(w.hours / 24));
    return { from: d, to: d, label: `~${formatDateStr(d)} (${w.hours} h after surgery)` };
  }
  if (w.kind === 'offset_days') {
    const d = addDays(surgeryDate, w.days);
    return { from: d, to: d, label: `~${formatDateStr(d)}` };
  }
  if (w.kind === 'range_days') {
    const a = addDays(surgeryDate, w.from);
    const b = addDays(surgeryDate, w.to);
    return { from: a, to: b, label: `${formatDateStr(a)} – ${formatDateStr(b)}` };
  }
  return null;
}

const timeSort = (a, b) => {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title);
};

/** All pills for one local date. Contains no statuses yet. */
export function buildDaySlots(state, dateStr, { tz = DEFAULT_TZ, routine = routineFrom(state.meta), now = Date.now() } = {}) {
  const slots = [];
  const surgery = state.profile?.surgery_date;
  if (!surgery) return slots;

  // Scheduled medications (never PRN). Unconfirmed schedules get dashed placeholder slots.
  for (const m of activeOrders(state.orders, 'medication')) {
    if (!isScheduled(m)) continue;
    const confirmed = isScheduleConfirmed(m);
    if (confirmed) {
      if (m.schedule.course_start && dateStr < m.schedule.course_start) continue;
      if (m.schedule.course_end && dateStr > m.schedule.course_end) continue;
    } else if (dateStr < surgery) continue;
    const times = confirmed ? m.schedule.times : routine.placeholder_med_times[m.id] || ['08:00', '18:00'];
    for (const t of times) {
      slots.push({
        id: slotId('med', m.id, dateStr, t),
        kind: 'medication',
        ref_id: m.id,
        order: m,
        date: dateStr,
        time: t,
        at: zonedToUtc(dateStr, t, tz),
        title: `${m.name} ${m.display_strength}`,
        label: `${(m.short_name || m.name).charAt(0).toUpperCase()}${(m.short_name || m.name).slice(1)} ${m.display_strength}`,
        short: m.short_name || m.name,
        sub: confirmed ? m.directions : 'time unconfirmed — tap to confirm or record',
        unconfirmed: !confirmed,
        optional: false,
        icon: 'meds',
      });
    }
  }

  // As-needed medicines: a predicted "earliest next" pill anchored on the last recorded dose. Never due, never red.
  for (const m of activeOrders(state.orders, 'medication')) {
    if (isScheduled(m)) continue;
    const pred = predictNextDose(m, state.events, now, tz);
    if (!pred || pred.kind !== 'prn' || localDateString(pred.at, tz) !== dateStr) continue;
    const t = localTimeString(pred.at, tz);
    slots.push({ id: slotId('prn', m.id, dateStr, t), kind: 'prn_next', ref_id: m.id, order: m, date: dateStr, time: t, at: pred.at, title: `${m.name} ${m.display_strength}`, label: `${cap(m.short_name || m.name)} — next`, short: `${cap(m.short_name || m.name)} next`, sub: `earliest ${pred.hours} h after your ${localTimeString(fromIso(pred.basis.occurred_at), tz)} dose`, prediction: pred, optional: true, prn: true, icon: 'meds' });
  }

  if (dateStr >= surgery) {
    for (const t of routine.ice_times) {
      slots.push({ id: slotId('ice', 'ice', dateStr, t), kind: 'ice_elevate', ref_id: 'ice', date: dateStr, time: t, at: zonedToUtc(dateStr, t, tz), title: 'Ice + elevate', short: 'ice', sub: '20–30 min · dry barrier', optional: false, startable: true, icon: 'ice' });
    }
    const { cleared } = partitionExercises(state.orders);
    for (const x of cleared) {
      if (x.cleared_on && dateStr < x.cleared_on) continue;
      for (const t of routine.exercise_times) {
        slots.push({ id: slotId('ex', x.id, dateStr, t), kind: 'exercise', ref_id: x.id, order: x, date: dateStr, time: t, at: zonedToUtc(dateStr, t, tz), title: x.name, short: x.name, sub: x.parameters, optional: false, startable: true, icon: 'move' });
      }
    }
    slots.push({ id: slotId('checkin', 'checkin', dateStr, routine.checkin_time), kind: 'checkin', ref_id: 'checkin', date: dateStr, time: routine.checkin_time, at: zonedToUtc(dateStr, routine.checkin_time, tz), title: 'Check-in', short: 'check-in', sub: 'pain · swelling · note', optional: true, icon: 'pulse' });
  }

  for (const m of state.milestones || []) {
    const d = milestoneDate(m, surgery);
    if (!d) continue;
    const hit = m.confirmed_date ? m.confirmed_date === dateStr : d.from <= dateStr && dateStr <= d.to;
    if (!hit) continue;
    slots.push({ id: `milestone:${m.id}:${dateStr}`, kind: 'milestone', ref_id: m.id, date: dateStr, time: m.confirmed_time || null, at: m.confirmed_time ? zonedToUtc(dateStr, m.confirmed_time, tz) : null, title: m.title, short: m.title, sub: m.status === 'needs_confirmation' ? 'needs confirmation' : m.status === 'confirmed' ? 'confirmed' : 'planned', allDay: !m.confirmed_time, optional: true, icon: 'plan', milestone: m });
  }
  for (const a of state.appointments || []) {
    const ms = fromIso(a.at);
    if (!Number.isFinite(ms) || localDateString(ms, tz) !== dateStr) continue;
    slots.push({ id: `appt:${a.id}`, kind: 'appointment', ref_id: a.id, date: dateStr, time: localTimeString(ms, tz), at: ms, title: a.title, short: a.title, sub: a.with ? `with ${a.with}` : 'appointment', optional: true, icon: 'plan', appointment: a });
  }
  // Surgery day: the home routine cannot be expected around the operation itself, so
  // nothing that day is required — slots stay loggable but never turn red or count.
  if (dateStr === surgery) {
    for (const s of slots) {
      if (['medication', 'ice_elevate', 'exercise', 'checkin'].includes(s.kind) && !s.optional) {
        s.optional = true;
        s.surgeryDay = true;
        s.sub = 'surgery day — only if instructed';
      }
    }
  }
  return slots.sort(timeSort);
}

function eventMatchesSlot(e, slot, tz) {
  if (localDateString(fromIso(e.occurred_at), tz) !== slot.date) return false;
  switch (slot.kind) {
    case 'medication':
      return e.event_type === 'medication' && e.medication_id === slot.ref_id && (e.status === 'taken' || e.status === 'skipped');
    case 'ice_elevate':
      return e.event_type === 'ice_elevate';
    case 'exercise':
      return e.event_type === 'exercise' && e.exercise_id === slot.ref_id;
    case 'checkin':
      return e.event_type === 'checkin';
    default:
      return false;
  }
}

/**
 * Attach a status (and the matching event, if any) to each slot.
 * Entries recorded from a pill carry slot_id; loose entries are assigned to the
 * nearest unfilled slot of the same kind on the same day, within a window.
 */
export function deriveStatuses(slots, { events = [], slotStates = [], now = Date.now(), tz = DEFAULT_TZ } = {}) {
  const current = currentEvents(events);
  const states = new Map(slotStates.map((s) => [s.slot_id, s]));
  const matched = new Map();
  const used = new Set();
  for (const e of current) {
    if (e.slot_id && !matched.has(e.slot_id)) {
      matched.set(e.slot_id, e);
      used.add(e.id);
    }
  }
  const ordered = [...slots].sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const slot of ordered) {
    if (matched.has(slot.id) || !slot.at || !MATCH_WINDOW_MS[slot.kind]) continue;
    let best = null;
    for (const e of current) {
      if (used.has(e.id) || !eventMatchesSlot(e, slot, tz)) continue;
      const gap = Math.abs(fromIso(e.occurred_at) - slot.at);
      if (gap <= MATCH_WINDOW_MS[slot.kind] && (!best || gap < best.gap)) best = { e, gap };
    }
    if (best) {
      matched.set(slot.id, best.e);
      used.add(best.e.id);
    }
  }
  const today = localDateString(now, tz);
  // Unconfirmed placeholder times adapt to what was actually taken: the next placeholder
  // never comes sooner than the stated interval after the last recorded dose that day.
  const shifted = new Map();
  for (const slot of ordered) {
    if (slot.kind !== 'medication' || !slot.unconfirmed || matched.has(slot.id)) continue;
    const hours = intervalHoursFor(slot.order);
    if (!hours) continue;
    let lastMs = null;
    for (const e of current) {
      if (e.event_type !== 'medication' || e.medication_id !== slot.ref_id || e.status !== 'taken') continue;
      const t = fromIso(e.occurred_at);
      if (localDateString(t, tz) === slot.date && t < slot.at + MATCH_WINDOW_MS.medication && (lastMs == null || t > lastMs)) lastMs = t;
    }
    if (lastMs == null) continue;
    const earliest = lastMs + hours * 3600 * 1000;
    if (earliest > slot.at + 60 * 60 * 1000) {
      if (localDateString(earliest, tz) !== slot.date) shifted.set(slot.id, { drop: true });
      else shifted.set(slot.id, { at: earliest, time: localTimeString(earliest, tz), shifted_from: slot.time, sub: `~${hours} h after your ${localTimeString(lastMs, tz)} dose · placeholder` });
    }
  }
  return slots.filter((slot) => !shifted.get(slot.id)?.drop).map((slot0) => {
    const slot = shifted.has(slot0.id) ? { ...slot0, ...shifted.get(slot0.id) } : slot0;
    const event = matched.get(slot.id) || null;
    const slotState = states.get(slot.id) || null;
    let status;
    if (slot.kind === 'prn_next') status = now >= slot.at ? 'available' : 'window';
    else if (event) {
      status = event.status === 'skipped' || event.status === 'not_today' ? 'skipped' : 'done';
    } else if (slotState?.status === 'skipped') status = 'skipped';
    else if (slotState?.status === 'in_progress') status = 'in_progress';
    else if (slot.kind === 'milestone' || slot.kind === 'appointment') status = 'info';
    else if (!slot.at || slot.date > today || slot.at > now) status = 'upcoming';
    else if (now - slot.at <= (GRACE_MINUTES[slot.kind] || 60) * 60000) status = slot.optional ? 'open' : 'due';
    else status = slot.optional ? 'open' : 'todo';
    return { ...slot, status, event, slotState };
  });
}

export const STATUS_LABELS = {
  done: 'Done',
  in_progress: 'In progress',
  todo: 'Not recorded',
  due: 'Due now',
  upcoming: 'Upcoming',
  open: 'Optional',
  skipped: 'Skipped',
  info: 'Info',
  window: 'As needed · not before',
  available: 'As needed · available',
};

/** Fraction of required, already-due slots that are done (for the day strip rings). */
export function dayCompletion(slotsWithStatus) {
  const counted = slotsWithStatus.filter((s) => !s.optional && s.kind !== 'milestone' && s.kind !== 'appointment' && s.status !== 'upcoming');
  const done = counted.filter((s) => s.status === 'done').length;
  const skipped = counted.filter((s) => s.status === 'skipped').length;
  const red = counted.filter((s) => s.status === 'todo').length;
  return { total: counted.length, done, skipped, red, fraction: counted.length ? done / counted.length : null };
}

/** The one pill to put in front of a tired person: in progress, then due, then not recorded, then next upcoming. */
export function nextActionable(slotsWithStatus, now = Date.now()) {
  const rank = { in_progress: 0, due: 1, todo: 2, upcoming: 3 };
  const candidates = slotsWithStatus.filter((s) => rank[s.status] != null && !s.optional);
  candidates.sort((a, b) => rank[a.status] - rank[b.status] || (a.at || 0) - (b.at || 0));
  return candidates[0] || null;
}

/** PRN medicines as "available" pills with today's count and last time. */
export function prnPills(state, dateStr, { tz = DEFAULT_TZ, now = Date.now() } = {}) {
  return activeOrders(state.orders, 'medication')
    .filter((m) => !isScheduled(m))
    .map((m) => {
      const doses = medicationEventsFor(state.events, m.id);
      const todayDoses = doses.filter((e) => localDateString(fromIso(e.occurred_at), tz) === dateStr);
      const last = lastConfirmedDose(state.events, m.id);
      const prediction = predictNextDose(m, state.events, now, tz);
      return { id: `prn:${m.id}`, kind: 'prn', ref_id: m.id, order: m, title: `${m.name} ${m.display_strength}`, short: m.short_name || m.name, count: todayDoses.length, last, prediction, flagged: !!(m.interaction_flags && m.interaction_flags.length) || m.status === 'needs_prescriber_confirmation' };
    });
}
