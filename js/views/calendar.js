// views/calendar.js — the main screen: a day strip, an hour-by-hour timeline of
// "pills" (one per planned item), and a 7-day grid on wide screens. Tap a pill to
// answer its questions; it turns green (done), yellow (in progress) or red (not
// recorded after its time passed). PRN medicines sit in their own row and are
// never red.

import { el, chip, button, field, icon, openSheet, confirmDialog, toast } from '../ui.js';
import { buildDaySlots, deriveStatuses, dayCompletion, nextActionable, prnPills, routineFrom, STATUS_LABELS, GRACE_MINUTES } from '../schedule.js';
import { daysSinceSurgery, dayLabel, greeting, localDateString, localTimeString, fromIso, formatTime, formatDateLong, formatDateStr, describeWhen, addDays, daysBetween, zonedToUtc, relativeAgo, DEFAULT_TZ } from '../time.js';
import { describeEvent, currentEvents } from '../events.js';
import { lastConfirmedDose, isScheduleConfirmed } from '../medications.js';
import { partitionExercises } from '../exercises.js';
import { HIGH_PRIORITY_SYMPTOMS, ESCALATION_TEXT, PRODUCT_BOUNDARY, weightBearingState, interactionNotices } from '../safety-rules.js';
import { openCorrectionSheet, exerciseGuideBlock } from './shared.js';
import { memberBanner } from './care-ui.js';

let tick = null;
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');

function ui(ctx) {
  if (!ctx.state.ui) ctx.state.ui = {};
  return ctx.state.ui;
}

function slotsFor(ctx, dateStr) {
  const { state } = ctx;
  const tz = state.profile.timezone || DEFAULT_TZ;
  const routine = routineFrom(state.meta);
  return deriveStatuses(buildDaySlots(state, dateStr, { tz, routine, now: ctx.now() }), { events: state.events, slotStates: state.slotStates || [], now: ctx.now(), tz });
}

export function renderCalendar(ctx) {
  const { state, actions } = ctx;
  const now = ctx.now();
  const tz = state.profile.timezone || DEFAULT_TZ;
  const today = localDateString(now, tz);
  const u = ui(ctx);
  if (!u.selectedDate) u.selectedDate = today;
  const selected = u.selectedDate;
  const lowEnergy = !!state.prefs.lowEnergy;
  const openQs = state.questions.filter((q) => q.status === 'needs_clinician_confirmation');
  const slots = slotsFor(ctx, selected);
  const routine = routineFrom(state.meta);

  clearTimeout(tick);
  if (selected === today && slots.some((s) => s.status === 'in_progress')) tick = setTimeout(() => actions.quietRender(), 30000);

  const view = el('section', { class: 'view view-calendar' });

  if (state.storeVolatile) view.append(el('div', { class: 'banner banner-danger', role: 'alert' }, icon('alert'), el('span', {}, el('strong', { text: 'Storage unavailable. ' }), 'Entries will not survive closing this page. Export anything important from Settings.')));
  if (state.dataLossSuspected) view.append(dataLossPanel(ctx));
  const banner = memberBanner(ctx);
  if (banner) view.append(banner);
  if (openQs.length) view.append(el('a', { class: 'banner banner-warning banner-compact', href: '#plan' }, icon('alert'), el('span', {}, el('strong', { text: `${openQs.length} to confirm with clinicians` }), ` · ${openQs.map((q) => q.short || q.topic).join(' · ')}`)));

  if (lowEnergy) {
    view.append(lowEnergyPanel(ctx, slots, today));
    view.append(el('div', { class: 'btn-row' }, button('Quick log', { variant: 'primary', icon: 'plus', cls: 'btn-large', onClick: () => actions.openQuickLog() }), button('Back to full view', { variant: 'secondary', icon: 'calm', cls: 'btn-large', onClick: () => actions.toggleLowEnergy() })));
    view.append(el('p', { class: 'footer-note', text: PRODUCT_BOUNDARY }));
    return view;
  }

  // ----- Day strip (phones) -----
  view.append(dayStrip(ctx, { selected, today }));

  // ----- Day header -----
  const dayN = daysSinceSurgery(state.profile.surgery_date, zonedToUtc(selected, '12:00', tz), tz);
  const comp = dayCompletion(slots);
  view.append(
    el('div', { class: 'cal-head' },
      el('div', {},
        el('p', { class: 'eyebrow', text: `${selected === today ? `${greeting(now, tz)} · ` : ''}${dayLabel(dayN)}` }),
        el('h1', { class: 'cal-title', text: selected === today ? 'Today' : formatDateStr(selected, { weekday: 'long', month: 'long', day: 'numeric' }) })
      ),
      el('div', { class: 'cal-head-actions' },
        selected !== today ? button('Today', { cls: 'small', onClick: () => { u.selectedDate = today; actions.quietRender(); } }) : null,
        comp.total ? el('span', { class: 'muted small', text: `${comp.done}/${comp.total} done` }) : null
      )
    )
  );

  // ----- At a glance: what is still to do (today and future days) -----
  if (selected >= today) view.append(glancePanel(ctx, slots, { selected, today }));

  view.append(legend());

  // ----- Day timeline (phones) and week grid (wide screens) -----
  view.append(dayTimeline(ctx, slots, { selected, today, routine }));
  view.append(weekGrid(ctx, { selected, today }));

  // ----- As needed -----
  view.append(prnRow(ctx, selected));

  // ----- Waiting on clearance -----
  const { pending } = partitionExercises(state.orders);
  if (pending.length) {
    view.append(el('div', { class: 'cal-note' }, icon('move', 'icon icon-sm'), el('span', {}, `${pending.length} exercise${pending.length === 1 ? '' : 's'} from your paperwork ${pending.length === 1 ? 'is' : 'are'} waiting on clinician clearance and won't appear here until cleared. `, el('a', { href: '#movement', text: 'Movement' }))));
  }

  view.append(el('div', { class: 'btn-row' }, button('Quick log', { variant: 'primary', icon: 'plus', cls: 'btn-large', onClick: () => actions.openQuickLog() }), button('I feel overwhelmed', { variant: 'secondary', icon: 'calm', cls: 'btn-large', onClick: () => actions.toggleLowEnergy() })));

  const wb = weightBearingState(state.questions, daysSinceSurgery(state.profile.surgery_date, now, tz));
  view.append(
    el('details', {}, el('summary', { text: 'Current restrictions' }),
      el('div', { class: 'details-body' }, el('ul', { class: 'small' }, el('li', { text: wb.label }), el('li', { text: 'Knee flexion 0–90° until formally cleared' }), el('li', { text: 'Brace locked at 0° for walking' })), wb.note ? el('p', { class: 'banner banner-warning small' }, icon('alert'), el('span', { text: wb.note })) : null)
    )
  );
  view.append(safetyDetails());
  view.append(el('p', { class: 'footer-note', text: PRODUCT_BOUNDARY }));
  return view;
}

// ---------- Pieces ----------

/**
 * "At a glance": everything still to do on the day, grouped by kind, each time a
 * tappable chip in its status colour. Exercises get an explicit line even when
 * none are cleared, so an empty calendar never reads as "no exercises today".
 */
function glancePanel(ctx, slots, { selected, today }) {
  const { state } = ctx;
  const tz = state.profile.timezone || DEFAULT_TZ;
  const now = ctx.now();
  const isToday = selected === today;
  const planned = slots.filter((s) => ['medication', 'exercise', 'ice_elevate', 'checkin'].includes(s.kind));
  const isLeft = (s) => ['todo', 'due', 'upcoming', 'in_progress', 'open'].includes(s.status);
  const left = planned.filter(isLeft);
  const done = planned.filter((s) => s.status === 'done' || s.status === 'skipped');
  const { cleared, pending } = partitionExercises(state.orders);

  const panel = el('div', { class: 'glance', 'aria-label': 'At a glance' });
  const head = el('div', { class: 'glance-head' }, el('span', { class: 'eyebrow', text: isToday ? (left.length ? 'Still to do today' : 'Today') : 'Planned' }));
  const next = isToday ? nextActionable(slots, now) : null;
  if (next && next.at) {
    const mins = Math.round((next.at - now) / 60000);
    const when = mins > 1 ? `in ${mins >= 90 ? `${Math.round(mins / 60)} h` : `${mins} min`}` : mins < -1 ? `${-mins >= 90 ? `${Math.round(-mins / 60)} h` : `${-mins} min`} ago` : 'now';
    head.append(el('span', { class: 'muted small', text: `${next.status === 'in_progress' ? 'In progress' : next.status === 'todo' ? 'Not recorded' : 'Next'}: ${cap(next.short)} · ${formatTime(next.at, tz)} (${when})` }));
  }
  panel.append(head);

  const chipFor = (s, withName) => {
    const b = el('button', { type: 'button', class: `glance-chip pill-${s.status}${s.unconfirmed && !['done', 'skipped', 'in_progress'].includes(s.status) ? ' pill-unconfirmed' : ''}`, 'aria-label': `${s.title}, ${formatTime(s.at, tz)}, ${STATUS_LABELS[s.status] || s.status}`, onclick: () => openSlotSheet(ctx, s) });
    b.append(el('span', { class: 'glance-chip-dot', 'aria-hidden': 'true' }));
    b.append(`${withName ? `${cap(s.short)} ` : ''}${formatTime(s.at, tz)}`);
    if (s.status === 'done') b.append(' ✓');
    return b;
  };
  const row = (iconName, label, content) => el('div', { class: 'glance-row' }, el('span', { class: 'glance-label' }, icon(iconName, 'icon icon-sm'), label), el('div', { class: 'glance-chips' }, ...(Array.isArray(content) ? content : [content])));
  const allDoneNote = (what) => el('span', { class: 'glance-ok', text: `${what} done ✓` });

  // Scheduled medicines, by medicine
  const medsLeft = left.filter((s) => s.kind === 'medication');
  const medsDone = done.filter((s) => s.kind === 'medication');
  if (medsLeft.length) panel.append(row('meds', 'Meds', medsLeft.map((s) => chipFor(s, true))));
  else if (medsDone.length) panel.append(row('meds', 'Meds', allDoneNote(medsDone.length === 1 ? 'Scheduled dose' : 'All scheduled doses')));

  // As-needed medicines: every PRN medicine with its earliest-next window, today's count.
  if (isToday) {
    const prn = prnPills(state, selected, { tz, now });
    if (prn.length) {
      panel.append(row('meds', 'As needed', prn.map((p) => {
        const pred = p.prediction;
        const waiting = pred && !pred.available;
        const b = el('button', { type: 'button', class: `glance-chip pill-${waiting ? 'window' : pred ? 'available' : 'open'}`, 'data-icon': 'meds', 'aria-label': `${p.title}, as needed, ${p.count} today${pred ? (waiting ? `, not before ${formatTime(pred.at, tz)}` : ', available now') : ''}`, onclick: () => openPrnSheet(ctx, p) });
        b.append(el('span', { class: 'glance-chip-dot', 'aria-hidden': 'true' }));
        b.append(`${cap(p.short)}${p.count ? ` ×${p.count}` : ''} · ${pred ? (waiting ? `not before ${formatTime(pred.at, tz)}` : 'ok now') : 'if needed'}`);
        if (p.flagged) b.append(icon('alert', 'icon icon-sm pill-flag'));
        return b;
      })));
    }
  }

  // Exercises: one chip per session time ("9:30 AM · 1/4"); tapping it lists that session's exercises.
  const exAll = planned.filter((s) => s.kind === 'exercise');
  const exLeft = exAll.filter(isLeft);
  const exDone = done.filter((s) => s.kind === 'exercise');
  if (exLeft.length) {
    const sessions = new Map();
    for (const s of exAll) {
      if (!sessions.has(s.time)) sessions.set(s.time, []);
      sessions.get(s.time).push(s);
    }
    const chips = [...sessions.entries()]
      .filter(([, group]) => group.some(isLeft))
      .map(([time, group]) => {
        const rank = { in_progress: 0, due: 1, todo: 2, upcoming: 3, open: 4 };
        const doneN = group.filter((s) => s.status === 'done').length;
        const worst = group.filter(isLeft).sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))[0].status;
        const status = worst === 'in_progress' ? 'in_progress' : doneN ? 'partial' : worst;
        const at = group[0].at;
        const b = el('button', { type: 'button', class: `glance-chip pill-${status}`, 'aria-label': `Exercise session ${formatTime(at, tz)}, ${doneN} of ${group.length} done`, onclick: () => openSessionSheet(ctx, group, at) });
        b.append(el('span', { class: 'glance-chip-dot', 'aria-hidden': 'true' }), `${formatTime(at, tz)} · ${doneN}/${group.length}`);
        return b;
      });
    panel.append(row('move', 'Exercises', chips));
  } else if (exDone.length) panel.append(row('move', 'Exercises', allDoneNote('Cleared exercises')));
  else if (!cleared.length) panel.append(row('move', 'Exercises', el('span', { class: 'muted small' }, pending.length ? `None cleared yet — ${pending.length} from your paperwork ${pending.length === 1 ? 'is' : 'are'} waiting on a clinician's OK. ` : 'None cleared yet. ', el('a', { href: '#movement', text: 'Mark cleared in Movement' }))));

  // Ice + elevate
  const iceLeft = left.filter((s) => s.kind === 'ice_elevate');
  const iceDone = done.filter((s) => s.kind === 'ice_elevate');
  if (iceLeft.length) panel.append(row('ice', 'Ice', iceLeft.map((s) => chipFor(s, false))));
  else if (iceDone.length) panel.append(row('ice', 'Ice', allDoneNote('Ice sessions')));

  // Evening check-in (optional)
  const ci = planned.filter((s) => s.kind === 'checkin');
  if (ci.some(isLeft)) panel.append(row('pulse', 'Check-in', ci.filter(isLeft).map((s) => chipFor(s, false))));
  else if (ci.some((s) => s.status === 'done')) panel.append(row('pulse', 'Check-in', allDoneNote('Check-in')));

  // Appointments and milestones on this day
  const visits = slots.filter((s) => s.kind === 'appointment' || s.kind === 'milestone');
  if (visits.length) {
    panel.append(row('plan', 'Visits', visits.map((s) => {
      const b = el('button', { type: 'button', class: `glance-chip pill-${s.kind === 'appointment' ? 'info' : 'open'}`, 'aria-label': `${s.title}${s.at ? `, ${formatTime(s.at, tz)}` : ''}`, onclick: () => openSlotSheet(ctx, s) });
      b.append(el('span', { class: 'glance-chip-dot', 'aria-hidden': 'true' }), `${s.kind === 'appointment' && s.appointment?.with ? `${s.title} · ` : `${s.title}${s.at ? ' · ' : ''}`}${s.at ? formatTime(s.at, tz) : ''}`);
      return b;
    })));
  }

  if (!left.length && planned.length) panel.append(el('p', { class: 'glance-ok', text: isToday ? 'Everything planned for today is recorded.' : 'Nothing planned.' }));
  if (!planned.length && !visits.length) panel.append(el('p', { class: 'muted small', text: 'Nothing scheduled for this day.' }));
  return panel;
}

/** One exercise session (all cleared exercises at one routine time) as a list of pills. */
function openSessionSheet(ctx, group, at) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const doneN = group.filter((s) => s.status === 'done').length;
  const sheet = openSheet({
    title: `Exercises · ${formatTime(at, tz)}`,
    content: el('div', { class: 'form' },
      el('p', { class: 'muted small', text: `${doneN} of ${group.length} recorded. Tap an exercise to start it or record it; stopping early or "not today" never counts against you.` }),
      el('div', { class: 'cal-pills cal-pills-big' }, ...group.map((s) => pill(ctx, s, { big: true, showTime: false }))),
      el('div', { class: 'btn-row' }, button('Close', { onClick: () => sheet.close('close') }))
    ),
  });
  // Pills open their own sheet on top; close this one so the stack stays shallow.
  sheet.panel.addEventListener('click', (e) => {
    if (e.target.closest('.pill')) sheet.close('handoff');
  }, true);
}

function legend() {
  const item = (status, label) => el('span', { class: `legend-item` }, el('span', { class: `legend-dot pill-${status}` }), label);
  return el('div', { class: 'legend', 'aria-label': 'Colour key' }, item('done', 'Done'), item('in_progress', 'In progress / partly done'), item('todo', 'Not recorded'), item('due', 'Due now'), item('upcoming', 'Upcoming'), item('window', 'As-needed window'));
}

function dayStrip(ctx, { selected, today }) {
  const { state, actions } = ctx;
  const u = ui(ctx);
  const surgery = state.profile.surgery_date;
  const from = addDays(surgery < today ? surgery : today, -1);
  const to = addDays(today > selected ? today : selected, 14);
  const strip = el('div', { class: 'day-strip', role: 'tablist', 'aria-label': 'Days' });
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const n = daysBetween(surgery, d);
    const isPast = d < today;
    const comp = isPast || d === today ? dayCompletion(slotsFor(ctx, d)) : null;
    const btn = el('button', { type: 'button', role: 'tab', class: `day-chip${d === selected ? ' is-selected' : ''}${d === today ? ' is-today' : ''}`, 'aria-selected': String(d === selected), 'aria-label': `${formatDateStr(d, { weekday: 'long', month: 'long', day: 'numeric' })}, ${dayLabel(n)}`, onclick: () => { u.selectedDate = d; actions.quietRender(); } },
      el('span', { class: 'day-chip-wd', text: formatDateStr(d, { weekday: 'short' }) }),
      el('span', { class: 'day-chip-num', text: String(Number(d.slice(8))) }),
      el('span', { class: 'day-chip-day', text: n === 0 ? 'Surgery' : n > 0 ? `D${n}` : '' }),
      ring(comp)
    );
    strip.append(btn);
  }
  requestAnimationFrame(() => {
    const sel = strip.querySelector('.is-selected');
    if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
  return el('div', { class: 'day-strip-wrap' },
    el('button', { type: 'button', class: 'btn btn-ghost btn-icon day-nav', 'aria-label': 'Previous day', onclick: () => { u.selectedDate = addDays(selected, -1); actions.quietRender(); } }, icon('back')),
    strip,
    el('button', { type: 'button', class: 'btn btn-ghost btn-icon day-nav day-nav-next', 'aria-label': 'Next day', onclick: () => { u.selectedDate = addDays(selected, 1); actions.quietRender(); } }, icon('back'))
  );
}

/** Tiny completion ring. Green arc = done share; red arc = not recorded share. */
function ring(comp) {
  if (!comp || !comp.total) return el('span', { class: 'ring-placeholder', 'aria-hidden': 'true' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ring');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const r = 8;
  const c = 2 * Math.PI * r;
  const base = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  base.setAttribute('cx', '10'); base.setAttribute('cy', '10'); base.setAttribute('r', String(r));
  base.setAttribute('class', 'ring-base');
  svg.append(base);
  {
    const seg = (frac, cls, offsetFrac) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      p.setAttribute('cx', '10'); p.setAttribute('cy', '10'); p.setAttribute('r', String(r));
      p.setAttribute('class', `ring-seg ${cls}`);
      p.setAttribute('stroke-dasharray', `${c * frac} ${c}`);
      p.setAttribute('stroke-dashoffset', String(-c * offsetFrac));
      p.setAttribute('transform', 'rotate(-90 10 10)');
      svg.append(p);
    };
    seg(comp.done / comp.total, 'ring-done', 0);
    seg(comp.red / comp.total, 'ring-red', comp.done / comp.total);
  }
  return svg;
}


/** Everything to draw for a day: planned pills (done ones move to the time they actually happened) plus a green pill for every other entry recorded that day. */
function dayItems(ctx, dateStr, slots) {
  const { state } = ctx;
  const tz = state.profile.timezone || DEFAULT_TZ;
  const byId = ctx.ordersById();
  const placed = slots
    .filter((s) => s.kind !== 'exercise')
    .map((s) => {
      if (s.status === 'done' && s.event) {
        const at = fromIso(s.event.occurred_at);
        return { ...s, at, time: localTimeString(at, tz), allDay: false };
      }
      return s;
    });
  // All cleared exercises at one routine time are drawn as a single "Exercises" pill
  // (4 exercises × 3 sessions as 12 look-alike pills was unreadable). Tapping it lists
  // the session's exercises; statuses and completion still count each exercise.
  placed.push(...exerciseSessions(slots.filter((s) => s.kind === 'exercise'), tz));
  const used = new Set(slots.filter((s) => s.event).map((s) => s.event.id));
  const records = currentEvents(state.events)
    .filter((e) => !used.has(e.id) && localDateString(fromIso(e.occurred_at), tz) === dateStr)
    .map((e) => {
      const at = fromIso(e.occurred_at);
      const order = byId[e.medication_id || e.exercise_id];
      let title;
      let sub = '';
      switch (e.event_type) {
        case 'medication':
          title = order ? `${cap(order.short_name || order.name)} ${order.display_strength}${e.quantity !== 1 ? ` × ${e.quantity}` : ''}` : e.medication_id;
          sub = order && order.schedule?.kind === 'prn' ? 'as needed' : 'extra dose';
          break;
        case 'ice_elevate':
          title = e.kind === 'both' ? 'Ice + elevate' : e.kind === 'ice' ? 'Ice' : 'Elevate';
          sub = e.duration_minutes ? `${e.duration_minutes} min` : '';
          break;
        case 'exercise':
          title = order ? order.name : e.exercise_id;
          sub = e.status === 'not_today' ? 'not today' : e.status === 'stopped_early' ? 'stopped early' : 'session';
          break;
        case 'checkin':
          title = 'Check-in';
          sub = e.pain != null ? `pain ${e.pain}/10` : '';
          break;
        default:
          title = e.category && e.category !== 'journal' ? 'Question' : 'Note';
          sub = (e.text || '').slice(0, 40);
      }
      return { id: `rec:${e.id}`, kind: 'record', record_type: e.event_type, event: e, status: e.status === 'not_today' ? 'skipped' : 'done', date: dateStr, at, time: localTimeString(at, tz), title, label: title, short: title, sub, icon: { medication: 'meds', ice_elevate: 'ice', exercise: 'move', checkin: 'pulse', note: 'note' }[e.event_type] || 'note', optional: true, unplanned: true };
    });
  return [...placed, ...records].sort((a, b) => {
    if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
    return (a.at || 0) - (b.at || 0) || a.title.localeCompare(b.title);
  });
}

/** One composite item per (date, planned time) for the exercise slots of that day. */
function exerciseSessions(exSlots, tz) {
  const groups = new Map();
  for (const x of exSlots) {
    const key = `${x.date}|${x.time}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  return [...groups.values()].map((group) => {
    const planned = group[0];
    const doneN = group.filter((x) => x.status === 'done').length;
    const closed = group.every((x) => x.status === 'done' || x.status === 'skipped');
    const status = group.some((x) => x.status === 'in_progress') ? 'in_progress'
      : closed ? (doneN ? 'done' : 'skipped')
      : doneN ? 'partial'
      : group.some((x) => x.status === 'due') ? 'due'
      : group.some((x) => x.status === 'todo') ? 'todo'
      : group.some((x) => x.status === 'upcoming') ? 'upcoming'
      : 'open';
    let at = planned.at;
    let time = planned.time;
    if (closed) {
      const last = Math.max(...group.map((x) => (x.event ? fromIso(x.event.occurred_at) : 0)));
      if (Number.isFinite(last) && last > 0) {
        at = last;
        time = localTimeString(last, tz);
      }
    }
    const progress = `${doneN}/${group.length}`;
    return { id: `session:${planned.date}:${planned.time}`, kind: 'exercise_session', group, status, date: planned.date, at, time, title: 'Exercises', label: `Exercises · ${progress}`, short: 'exercises', sub: `${progress} done`, progress, doneN, total: group.length, optional: false, startable: true, icon: 'move' };
  });
}

function hourLabel(h) {
  const hh = h % 24;
  return `${hh === 0 ? 12 : hh > 12 ? hh - 12 : hh} ${hh < 12 ? 'AM' : 'PM'}`;
}

function dayTimeline(ctx, slots, { selected, today, routine }) {
  const { state } = ctx;
  const now = ctx.now();
  const tz = state.profile.timezone || DEFAULT_TZ;
  const wrap = el('div', { class: 'cal-day' });
  const items = dayItems(ctx, selected, slots);
  const allDay = items.filter((s) => s.allDay);
  if (allDay.length) wrap.append(el('div', { class: 'cal-row cal-row-allday' }, el('span', { class: 'cal-time', text: 'All day' }), el('div', { class: 'cal-pills' }, allDay.map((s) => pill(ctx, s)))));
  const timed = items.filter((s) => !s.allDay);
  const nowHour = selected === today ? Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now))) : null;
  const hours = timed.map((s) => Number((s.time || '00:00').slice(0, 2)));
  const startH = Math.min(routine.day_start_hour ?? 7, ...hours, nowHour ?? 24);
  const endH = Math.max(routine.day_end_hour ?? 22, ...hours, nowHour ?? -1);
  const byHour = new Map();
  for (const s of timed) {
    const h = Number((s.time || '00:00').slice(0, 2));
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h).push(s);
  }
  const rowFor = (key, label) => {
    const items = byHour.get(key) || [];
    const row = el('div', { class: `cal-row${items.length ? ' has-pills' : ''}${key === nowHour ? ' is-now' : ''}` });
    row.append(el('span', { class: 'cal-time', text: label }));
    const pills = el('div', { class: 'cal-pills' });
    if (key === nowHour) pills.append(el('div', { class: 'now-line', 'aria-label': `Now, ${formatTime(now, tz)}` }, el('span', { class: 'now-label', text: formatTime(now, tz) })));
    for (const s of items) pills.append(pill(ctx, s));
    row.append(pills);
    return row;
  };
  for (let h = startH; h <= endH; h++) wrap.append(rowFor(h, hourLabel(h)));
  if (!items.length) wrap.append(el('p', { class: 'muted', text: selected < state.profile.surgery_date ? 'Before surgery — nothing planned.' : 'Nothing planned for this day.' }));
  return wrap;
}

function weekGrid(ctx, { selected, today }) {
  const { state, actions } = ctx;
  const u = ui(ctx);
  const tz = state.profile.timezone || DEFAULT_TZ;
  // Week starts Monday
  const dow = new Date(zonedToUtc(selected, '12:00', tz)).getUTCDay(); // 0..6 (Sun..Sat) — date-only, safe
  const monday = addDays(selected, -((dow + 6) % 7));
  const grid = el('div', { class: 'cal-week' });
  const head = el('div', { class: 'cal-week-nav' },
    button('Previous week', { cls: 'small', icon: 'back', onClick: () => { u.selectedDate = addDays(selected, -7); actions.quietRender(); } }),
    el('strong', { text: `${formatDateStr(monday, { month: 'short', day: 'numeric' })} – ${formatDateStr(addDays(monday, 6), { month: 'short', day: 'numeric', year: 'numeric' })}` }),
    button('Next week', { cls: 'small', onClick: () => { u.selectedDate = addDays(selected, 7); actions.quietRender(); } })
  );
  grid.append(head);
  const cols = el('div', { class: 'cal-week-cols' });
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const n = daysBetween(state.profile.surgery_date, d);
    const slots = slotsFor(ctx, d);
    const comp = dayCompletion(slots);
    const col = el('div', { class: `cal-col${d === today ? ' is-today' : ''}${d === selected ? ' is-selected' : ''}${d < today ? ' is-past' : ''}` });
    col.append(el('button', { type: 'button', class: 'cal-col-head', onclick: () => { u.selectedDate = d; actions.quietRender(); } },
      el('span', { class: 'cal-col-wd', text: formatDateStr(d, { weekday: 'short' }) }),
      el('span', { class: 'cal-col-num', text: String(Number(d.slice(8))) }),
      el('span', { class: 'cal-col-day', text: n === 0 ? 'Surgery day' : n > 0 ? `Day ${n}` : '' }),
      comp.total ? el('span', { class: 'cal-col-comp', text: `${comp.done}/${comp.total}` }) : null
    ));
    const list = el('div', { class: 'cal-col-pills' });
    const items = dayItems(ctx, d, slots);
    let band = null;
    for (const s of items) {
      const b = s.allDay || !s.time ? 'All day' : Number(s.time.slice(0, 2)) < 12 ? 'Morning' : Number(s.time.slice(0, 2)) < 17 ? 'Afternoon' : 'Evening';
      if (b !== band) {
        list.append(el('span', { class: 'cal-band', text: b }));
        band = b;
      }
      list.append(pill(ctx, s, { compact: true, showTime: true }));
    }
    if (!items.length) list.append(el('span', { class: 'muted small', text: d < state.profile.surgery_date ? '—' : 'Nothing planned' }));
    col.append(list);
    cols.append(col);
  }
  grid.append(cols);
  return grid;
}

function prnRow(ctx, selected) {
  const { state, actions } = ctx;
  const tz = state.profile.timezone || DEFAULT_TZ;
  const pills = prnPills(state, selected, { tz, now: ctx.now() });
  const row = el('div', { class: 'cal-prn' });
  row.append(el('h2', { class: 'section-title', text: 'As needed' }), el('p', { class: 'muted small', text: 'Tap to log if taken. Never due, never red.' }));
  row.append(
    el('div', { class: 'cal-pills' },
      pills.map((p) =>
        el('button', { type: 'button', class: `pill pill-prn${p.flagged ? ' pill-flagged' : ''}`, 'aria-label': `${p.title}, as needed, ${p.count} today`, onclick: () => openPrnSheet(ctx, p) },
          icon('meds', 'icon icon-sm'),
          el('span', { class: 'pill-title', text: cap(p.short) }),
          el('span', { class: 'pill-meta', text: prnMeta(ctx, p) }),
          p.flagged ? icon('alert', 'icon icon-sm pill-flag') : null
        )
      )
    )
  );
  return row;
}

function prnMeta(ctx, p) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const now = ctx.now();
  const bits = [];
  if (p.count) bits.push(`×${p.count} today`);
  if (p.last) bits.push(`last ${formatTime(fromIso(p.last.occurred_at), tz)}${localDateString(fromIso(p.last.occurred_at), tz) === localDateString(now, tz) ? '' : ' ' + formatDateStr(localDateString(fromIso(p.last.occurred_at), tz), { month: 'short', day: 'numeric' })}`);
  if (p.prediction) bits.push(p.prediction.available ? `next: available now` : `next: not before ${describeWhen(p.prediction.at, now, tz)}`);
  return bits.length ? bits.join(' · ') : 'not recorded';
}

function lowEnergyPanel(ctx, slots, today) {
  const { state, actions } = ctx;
  const tz = state.profile.timezone || DEFAULT_TZ;
  const now = ctx.now();
  const next = nextActionable(slots, now);
  const panel = el('div', { class: 'card low-energy-card' });
  panel.append(el('p', { class: 'eyebrow', text: `${formatDateLong(now, tz)} · ${dayLabel(daysSinceSurgery(state.profile.surgery_date, now, tz))}` }));
  panel.append(el('h1', { class: 'greeting', text: `${greeting(now, tz)}. One thing at a time.` }));
  if (next) {
    panel.append(el('p', { class: 'muted', text: next.status === 'upcoming' ? 'Nothing is waiting. Next up:' : 'One safe thing you can do now:' }));
    panel.append(el('div', { class: 'cal-pills cal-pills-big' }, pill(ctx, next, { big: true, showTime: true })));
  } else panel.append(el('p', { text: 'Nothing is waiting on you right now. Resting counts.' }));
  const comp = dayCompletion(slots);
  if (comp.done) panel.append(el('p', { class: 'muted small', text: `${comp.done} thing${comp.done === 1 ? '' : 's'} done today.` }));
  return panel;
}

export function pill(ctx, slot, { compact = false, big = false, showTime = false } = {}) {
  const { state } = ctx;
  const tz = state.profile.timezone || DEFAULT_TZ;
  const now = ctx.now();
  let meta;
  if (slot.kind === 'exercise_session') {
    const when = slot.at ? formatTime(slot.at, tz) : '';
    const left = slot.total - slot.doneN;
    meta = slot.status === 'done' ? `All ${slot.total} done · ${when}` : slot.status === 'skipped' ? 'Skipped' : slot.status === 'in_progress' ? `In progress · ${slot.progress} done` : slot.status === 'partial' ? `${slot.progress} done · ${left} left` : slot.status === 'todo' ? `Not recorded · ${when}` : slot.status === 'due' ? `Due now · ${when}` : `${when} · ${slot.total} exercise${slot.total === 1 ? '' : 's'}`;
  } else switch (slot.status) {
    case 'done': {
      const verb = slot.kind === 'medication' || slot.record_type === 'medication' ? 'Taken' : 'Done';
      meta = slot.event ? `${verb} ${formatTime(fromIso(slot.event.occurred_at), tz)}${slot.sub && slot.unplanned ? ` · ${slot.sub}` : ''}` : 'Done';
      break;
    }
    case 'in_progress': {
      const started = fromIso(slot.slotState?.at || slot.slotState?.started_at);
      meta = Number.isFinite(started) ? `In progress · ${Math.max(0, Math.round((now - started) / 60000))} min` : 'In progress';
      break;
    }
    case 'todo':
      meta = `Not recorded · ${slot.time ? formatTime(slot.at, tz) : ''}`.trim();
      break;
    case 'due':
      meta = `Due now · ${formatTime(slot.at, tz)}`;
      break;
    case 'skipped':
      meta = 'Skipped';
      break;
    case 'info':
      meta = slot.sub || '';
      break;
    case 'open':
      meta = `Optional${slot.time ? ` · ${formatTime(slot.at, tz)}` : ''}`;
      break;
    case 'window':
      meta = `Not before ${formatTime(slot.at, tz)} · only if needed`;
      break;
    case 'available':
      meta = `Available since ${formatTime(slot.at, tz)} · only if needed`;
      break;
    default:
      meta = slot.at ? formatTime(slot.at, tz) : slot.sub || '';
  }
  const b = el('button', {
    type: 'button',
    class: `pill pill-${slot.status}${slot.unconfirmed && !['done', 'skipped', 'in_progress'].includes(slot.status) ? ' pill-unconfirmed' : ''}${slot.optional ? ' pill-optional' : ''}${compact ? ' pill-compact' : ''}${big ? ' pill-big' : ''}`,
    'aria-label': `${slot.title}${slot.at ? `, ${formatTime(slot.at, tz)}` : ''}${slot.progress ? `, ${slot.doneN} of ${slot.total} done` : ''}, ${STATUS_LABELS[slot.status] || slot.status}`,
    'data-icon': slot.icon || 'note',
    onclick: () => openSlotSheet(ctx, slot),
  });
  b.append(el('span', { class: 'pill-dot', 'aria-hidden': 'true' }, slot.status === 'done' ? icon('check', 'icon icon-sm') : slot.status === 'in_progress' ? icon('pulse', 'icon icon-sm') : icon(slot.icon, 'icon icon-sm')));
  const text = el('span', { class: 'pill-text' });
  text.append(el('span', { class: 'pill-title', text: compact ? cap(slot.short) : slot.label || slot.title }));
  if (compact && showTime && slot.at) text.append(el('span', { class: 'pill-meta', text: `${formatTime(slot.at, tz)}${slot.progress ? ` · ${slot.progress}` : ''}${slot.status === 'done' ? ' ✓' : slot.status === 'todo' ? ' · not recorded' : slot.status === 'in_progress' ? ' · in progress' : ''}` }));
  else text.append(el('span', { class: 'pill-meta', text: meta }));
  b.append(text);
  return b;
}

// ---------- Slot sheet: tap a pill, answer the questions ----------

export function openSlotSheet(ctx, slot) {
  const { state, actions } = ctx;
  const tz = state.profile.timezone || DEFAULT_TZ;
  const now = ctx.now();
  if (slot.kind === 'prn_next') {
    const p = prnPills(state, slot.date, { tz, now }).find((x) => x.ref_id === slot.ref_id);
    if (p) return openPrnSheet(ctx, p);
  }
  if (slot.kind === 'exercise_session') return openSessionSheet(ctx, slot.group, slot.at);
  const sheet = openSheet({ title: slot.title, content: null });
  const body = el('div', { class: 'form' });
  const statusLine = el('div', { class: 'row-between' }, el('span', { class: 'muted' }, slot.at ? `${formatDateStr(slot.date)} · ${formatTime(slot.at, tz)}` : formatDateStr(slot.date)), chip(STATUS_LABELS[slot.status] || slot.status, { done: 'ok', in_progress: 'warning', partial: 'warning', todo: 'danger', due: 'neutral', skipped: 'muted', upcoming: 'muted', open: 'muted', info: 'muted' }[slot.status] || 'muted'));
  body.append(statusLine);

  const defaultOccurred = slot.at && slot.at <= now && now - slot.at < 6 * 3600 * 1000 ? slot.at : now;
  const recordThen = (init) => {
    sheet.close('handoff');
    actions.openQuickLog({ ...init, slot_id: slot.id, source: 'calendar' });
  };
  const skip = async () => {
    const ok = await confirmDialog({ title: `Skip ${slot.short}?`, message: slot.kind === 'medication' ? 'This marks the slot as skipped on purpose (not taken). It is recorded as your decision and can be undone.' : 'Marks this slot as skipped for today. No penalty; you can undo it.', confirmText: 'Mark skipped' });
    if (!ok) return;
    await actions.setSlotState({ slot_id: slot.id, status: 'skipped', at: new Date(now).toISOString(), kind: slot.kind, ref_id: slot.ref_id, date: slot.date });
    sheet.close('skipped');
  };
  const undo = async () => {
    await actions.clearSlotState(slot.id);
    sheet.close('undo');
  };

  if (slot.event) {
    body.append(el('div', { class: 'summary-box' }, el('span', { class: 'muted small', text: 'Recorded' }), el('strong', { text: `${describeWhen(fromIso(slot.event.occurred_at), now, tz)} — ${describeEvent(slot.event, ctx.ordersById(), tz)}` }), slot.event.notes ? el('span', { class: 'small', text: slot.event.notes }) : null));
    body.append(el('div', { class: 'btn-row' }, button('Correct this entry', { onClick: () => { sheet.close('correct'); openCorrectionSheet(ctx, slot.event); } }), button('Close', { variant: 'primary', onClick: () => sheet.close('close') })));
    sheet.setContent(body);
    return sheet;
  }

  if (slot.status === 'skipped') {
    body.append(el('p', { class: 'muted', text: 'You marked this as skipped.' }));
    body.append(el('div', { class: 'btn-row' }, button('Undo skip', { onClick: undo }), button(slot.kind === 'medication' ? 'Record a dose anyway' : 'Record anyway', { variant: 'primary', onClick: () => recordThen(initFor(slot, defaultOccurred)) })));
    sheet.setContent(body);
    return sheet;
  }

  switch (slot.kind) {
    case 'medication': {
      const m = slot.order;
      body.append(el('p', {}, el('strong', { text: 'Prescribed: ' }), m.directions));
      const last = lastConfirmedDose(state.events, m.id);
      body.append(el('p', { class: 'muted small', text: `Last confirmed taken: ${last ? describeWhen(fromIso(last.occurred_at), now, tz) : 'Not recorded'}` }));
      for (const n of interactionNotices(m, state.orders)) body.append(el('div', { class: 'banner banner-warning' }, icon('alert'), el('span', { text: n.message })));
      if (slot.unconfirmed) body.append(el('div', { class: 'banner banner-warning' }, icon('alert'), el('span', {}, el('strong', { text: 'Placeholder time. ' }), slot.shifted_from ? `Moved from ${formatTime(zonedToUtc(slot.date, slot.shifted_from, tz), tz)} because ${slot.sub}. ` : '', 'The schedule has not been confirmed yet — confirm the course start and exact times from Medications, or just record what you took.')));
      if (slot.status === 'todo') body.append(el('p', { class: 'muted small', text: 'Nothing was recorded for this slot. If you are not sure whether you took it, check the label or ask the pharmacist — never double up.' }));
      body.append(el('p', { class: 'strong', text: `Did you take ${m.name} ${m.display_strength}?` }));
      body.append(el('div', { class: 'btn-row' }, button('Yes — record it', { variant: 'primary', icon: 'check', onClick: () => recordThen(initFor(slot, defaultOccurred)) })));
      body.append(el('div', { class: 'btn-row' }, slot.unconfirmed ? el('a', { class: 'btn btn-secondary', href: '#medications', onclick: () => sheet.close('nav') }, 'Confirm schedule') : null, button('Skip this dose', { variant: 'ghost', onClick: skip }), button('Not now', { variant: 'ghost', onClick: () => sheet.close('later') })));
      break;
    }
    case 'ice_elevate':
    case 'exercise': {
      if (slot.kind === 'exercise') body.append(exerciseGuideBlock(slot.order, { compact: slot.status === 'in_progress' }));
      else body.append(el('p', { class: 'muted small', text: 'Handout: 20–30 minutes with a dry barrier between the whole cold pad and skin. Elevate with the heel supported, nothing behind the knee.' }));
      if (slot.status === 'in_progress') {
        const started = fromIso(slot.slotState.at);
        const mins = Math.max(0, Math.round((now - started) / 60000));
        body.append(el('div', { class: 'summary-box' }, el('strong', { text: `In progress · started ${formatTime(started, tz)} · ${mins} min so far` }), el('span', { class: 'small muted', text: 'A timer is not completion — confirm what you actually did when you finish.' })));
        body.append(el('div', { class: 'btn-row' }, button('Finish & record', { variant: 'primary', icon: 'check', onClick: () => recordThen({ ...initFor(slot, started), duration_minutes: Math.max(1, mins) }) })));
        body.append(el('div', { class: 'btn-row' }, button('Stopped early — record', { onClick: () => recordThen({ ...initFor(slot, started), duration_minutes: Math.max(1, mins), stopped_early: true }) }), button('Cancel timer', { variant: 'ghost', onClick: undo })));
      } else {
        body.append(el('div', { class: 'btn-row' }, button('Start now', { variant: 'primary', icon: 'pulse', onClick: async () => { await actions.setSlotState({ slot_id: slot.id, status: 'in_progress', at: new Date(now).toISOString(), kind: slot.kind, ref_id: slot.ref_id, date: slot.date }); sheet.close('started'); toast(`${slot.title} started — tap the pill when you finish`); } }), button('Already did it — record', { onClick: () => recordThen(initFor(slot, defaultOccurred)) })));
        body.append(el('div', { class: 'btn-row' }, button(slot.kind === 'exercise' ? 'Not today' : 'Skip this one', { variant: 'ghost', onClick: skip }), button('Not now', { variant: 'ghost', onClick: () => sheet.close('later') })));
      }
      break;
    }
    case 'checkin':
      body.append(el('p', { class: 'muted', text: 'About 15 seconds: pain, swelling, a note. Optional, never scored.' }));
      body.append(el('div', { class: 'btn-row' }, button('Start check-in', { variant: 'primary', icon: 'pulse', onClick: () => recordThen(initFor(slot, now)) }), button('Not now', { variant: 'ghost', onClick: () => sheet.close('later') })));
      break;
    case 'milestone':
      body.append(el('p', { text: slot.milestone.note || '' }));
      body.append(el('p', { class: 'muted small', text: 'Milestones are informational until the appointment is actually confirmed in Plan.' }));
      body.append(el('div', { class: 'btn-row' }, el('a', { class: 'btn btn-primary', href: '#plan', onclick: () => sheet.close('nav') }, 'Open Plan'), button('Close', { onClick: () => sheet.close('close') })));
      break;
    case 'appointment':
      body.append(el('p', {}, slot.appointment.with ? `With ${slot.appointment.with}. ` : '', slot.appointment.notes || ''));
      body.append(el('div', { class: 'btn-row' }, el('a', { class: 'btn btn-primary', href: '#plan', onclick: () => sheet.close('nav') }, 'Open Plan'), button('Close', { onClick: () => sheet.close('close') })));
      break;
    default:
      body.append(button('Close', { onClick: () => sheet.close('close') }));
  }
  sheet.setContent(body);
  return sheet;
}

function initFor(slot, occurredMs) {
  switch (slot.kind) {
    case 'medication':
      return { type: 'medication', medication_id: slot.ref_id, occurred_ms: occurredMs };
    case 'ice_elevate':
      return { type: 'ice_elevate', kind: 'both', occurred_ms: occurredMs };
    case 'exercise':
      return { type: 'exercise', exercise_id: slot.ref_id, occurred_ms: occurredMs };
    case 'checkin':
      return { type: 'checkin', occurred_ms: occurredMs };
    default:
      return { type: 'note', occurred_ms: occurredMs };
  }
}

function openPrnSheet(ctx, p) {
  const { state, actions } = ctx;
  const tz = state.profile.timezone || DEFAULT_TZ;
  const now = ctx.now();
  const m = p.order;
  const sheet = openSheet({ title: `${m.name} ${m.display_strength}`, content: null });
  const body = el('div', { class: 'form' });
  body.append(el('div', { class: 'row-between' }, el('span', { class: 'muted', text: 'As needed' }), chip(p.count ? `×${p.count} today` : 'none today', 'muted')));
  body.append(el('p', {}, el('strong', { text: 'Prescribed: ' }), m.directions));
  body.append(el('p', { class: 'muted small', text: `Last confirmed taken: ${p.last ? describeWhen(fromIso(p.last.occurred_at), now, tz) : 'Not recorded'}` }));
  if (p.prediction) {
    const pr = p.prediction;
    body.append(el('div', { class: pr.available ? 'summary-box' : 'warning-box' }, el('strong', { text: pr.available ? `Next dose: available now (if needed)` : `Next dose: not before ${describeWhen(pr.at, now, tz)}` }), el('span', { class: 'small', text: `Label interval: every ${pr.hours}${pr.max_hours ? `–${pr.max_hours}` : ''} hours. Last recorded dose ${relativeAgo(fromIso(pr.basis.occurred_at), now)} (${formatTime(fromIso(pr.basis.occurred_at), tz)}). Recorded entries only — if you took one you didn't log, add it first.` })));
  } else if (!p.last) body.append(el('p', { class: 'muted small', text: `No dose recorded yet. Once you log one, the next earliest time (${m.schedule?.min_interval_hours || '?'} h later) appears on the calendar.` }));
  for (const n of interactionNotices(m, state.orders)) body.append(el('div', { class: 'banner banner-warning' }, icon('alert'), el('span', { text: n.message })));
  body.append(el('div', { class: 'btn-row' }, button(`Log ${p.short}`, { variant: 'primary', icon: 'check', onClick: () => { sheet.close('handoff'); actions.openQuickLog({ type: 'medication', medication_id: m.id, source: 'calendar' }); } }), button('Not now', { variant: 'ghost', onClick: () => sheet.close('later') })));
  sheet.setContent(body);
  return sheet;
}

// ---------- Routine editor (Settings) ----------

export function openRoutineSheet(ctx) {
  const routine = routineFrom(ctx.state.meta);
  const timesList = (label, times, hint) => {
    const box = el('div', { class: 'field' }, el('span', { class: 'field-label', text: label }));
    const list = el('div', { class: 'list' });
    const inputs = [];
    const add = (v) => {
      const inp = el('input', { type: 'time', value: v, 'aria-label': `${label} time` });
      const row = el('div', { class: 'row-between' }, inp, button('Remove', { variant: 'ghost', cls: 'small', onClick: () => { row.remove(); inputs.splice(inputs.indexOf(inp), 1); } }));
      inputs.push(inp);
      list.append(row);
    };
    times.forEach(add);
    box.append(list, button('Add time', { cls: 'small', icon: 'plus', onClick: () => add('12:00') }), hint ? el('p', { class: 'field-hint', text: hint }) : null);
    return { node: box, get: () => inputs.map((i) => i.value).filter(Boolean).sort() };
  };
  const ice = timesList('Ice + elevate sessions', routine.ice_times, 'Handout: at least four times daily in early recovery.');
  const ex = timesList('Exercise sessions (cleared exercises only)', routine.exercise_times, 'Packet suggests three times daily for some exercises, subject to clinician confirmation.');
  const checkin = el('input', { type: 'time', value: routine.checkin_time });
  const asp = timesList('Aspirin placeholder times (until the schedule is confirmed)', routine.placeholder_med_times['med-aspirin-81'] || ['08:00', '18:00'], 'Placeholders only. Confirming the schedule in Medications replaces them.');
  const startH = el('input', { type: 'number', min: '0', max: '12', value: routine.day_start_hour });
  const endH = el('input', { type: 'number', min: '12', max: '23', value: routine.day_end_hour });
  const errors = el('div', { class: 'error-box hidden' });
  const sheet = openSheet({
    title: 'Daily routine',
    content: el(
      'form',
      { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        try {
          const iceT = ice.get();
          const exT = ex.get();
          if (!iceT.length) throw new Error('Keep at least one ice session.');
          if (!checkin.value) throw new Error('Set a check-in time.');
          await ctx.actions.putMeta({ ...routine, key: 'routine', ice_times: iceT, exercise_times: exT.length ? exT : routine.exercise_times, checkin_time: checkin.value, placeholder_med_times: { ...routine.placeholder_med_times, 'med-aspirin-81': asp.get().length ? asp.get() : ['08:00', '18:00'] }, day_start_hour: Number(startH.value), day_end_hour: Number(endH.value), updated_at: new Date(ctx.now()).toISOString() });
          sheet.close('saved');
        } catch (err) {
          errors.textContent = err.message;
          errors.classList.remove('hidden');
        }
      } },
      el('p', { class: 'muted small', text: 'These times only place pills on the calendar. They never change an order or a restriction.' }),
      ice.node,
      ex.node,
      field('Daily check-in', checkin),
      asp.node,
      el('div', { class: 'inline-fields' }, field('Timeline starts (hour)', startH), field('Timeline ends (hour)', endH)),
      errors,
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Save routine', { variant: 'primary', type: 'submit' }))
    ),
  });
  return sheet;
}

// ---------- Shared panels ----------

function safetyDetails() {
  const emergency = HIGH_PRIORITY_SYMPTOMS.filter((s) => s.level === 'emergency');
  const clinician = HIGH_PRIORITY_SYMPTOMS.filter((s) => s.level === 'clinician_now');
  return el(
    'details',
    { class: 'safety' },
    el('summary', { text: 'If something feels wrong' }),
    el('div', { class: 'details-body' },
      el('div', { class: 'danger-box' }, icon('alert'), el('span', { text: ESCALATION_TEXT.emergency })),
      el('ul', {}, emergency.map((s) => el('li', { text: s.label }))),
      el('p', { text: ESCALATION_TEXT.clinician_now }),
      el('ul', {}, clinician.map((s) => el('li', { text: s.label }))),
      el('p', { class: 'muted small', text: 'This app does not assess symptoms or give reassurance scores. When in doubt, call.' })
    )
  );
}

function dataLossPanel(ctx) {
  const { actions } = ctx;
  return el(
    'div',
    { class: 'card card-warning', role: 'alert' },
    el('div', { class: 'card-title' }, icon('alert'), ' Your earlier entries aren’t on this device'),
    el('p', { text: 'This browser had Recovery OS entries before, but its storage is now empty — browser data was cleared, or this is a different browser or profile. Your history is not shown as complete; restore it from a backup if you have one.' }),
    el('div', { class: 'card-actions' }, button('Import backup', { variant: 'primary', onClick: () => actions.openImport() }), ctx.state.sync?.configured && !ctx.state.sync?.signedIn ? button('Sign in to sync', { onClick: () => actions.openSignIn() }) : null, button('Start fresh', { onClick: () => actions.dismissDataLoss() }))
  );
}
