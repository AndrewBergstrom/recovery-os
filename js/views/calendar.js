// views/calendar.js — the main screen: a day strip, an hour-by-hour timeline of
// "pills" (one per planned item), and a 7-day grid on wide screens. Tap a pill to
// answer its questions; it turns green (done), yellow (in progress) or red (not
// recorded after its time passed). PRN medicines sit in their own row and are
// never red.

import { el, chip, button, field, icon, openSheet, confirmDialog, toast } from '../ui.js';
import { buildDaySlots, deriveStatuses, dayCompletion, nextActionable, prnPills, routineFrom, STATUS_LABELS, GRACE_MINUTES } from '../schedule.js';
import { daysSinceSurgery, dayLabel, greeting, localDateString, fromIso, formatTime, formatDateLong, formatDateStr, describeWhen, addDays, daysBetween, zonedToUtc, relativeAgo, DEFAULT_TZ } from '../time.js';
import { describeEvent } from '../events.js';
import { lastConfirmedDose, isScheduleConfirmed } from '../medications.js';
import { partitionExercises } from '../exercises.js';
import { HIGH_PRIORITY_SYMPTOMS, ESCALATION_TEXT, PRODUCT_BOUNDARY, weightBearingState, interactionNotices } from '../safety-rules.js';
import { openCorrectionSheet } from './shared.js';

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
  return deriveStatuses(buildDaySlots(state, dateStr, { tz, routine }), { events: state.events, slotStates: state.slotStates || [], now: ctx.now(), tz });
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

function legend() {
  const item = (status, label) => el('span', { class: `legend-item` }, el('span', { class: `legend-dot pill-${status}` }), label);
  return el('div', { class: 'legend', 'aria-label': 'Colour key' }, item('done', 'Done'), item('in_progress', 'In progress'), item('todo', 'Not recorded'), item('due', 'Due now'), item('upcoming', 'Upcoming'));
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

function hourLabel(h) {
  const hh = h % 24;
  return `${hh === 0 ? 12 : hh > 12 ? hh - 12 : hh} ${hh < 12 ? 'AM' : 'PM'}`;
}

function dayTimeline(ctx, slots, { selected, today, routine }) {
  const { state } = ctx;
  const now = ctx.now();
  const tz = state.profile.timezone || DEFAULT_TZ;
  const wrap = el('div', { class: 'cal-day' });
  const allDay = slots.filter((s) => s.allDay);
  if (allDay.length) wrap.append(el('div', { class: 'cal-row cal-row-allday' }, el('span', { class: 'cal-time', text: 'All day' }), el('div', { class: 'cal-pills' }, allDay.map((s) => pill(ctx, s)))));
  const timed = slots.filter((s) => !s.allDay);
  const startH = routine.day_start_hour ?? 7;
  const endH = routine.day_end_hour ?? 22;
  const nowHour = selected === today ? Number(localDateString(now, tz) && new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now))) : null;
  const byHour = new Map();
  for (const s of timed) {
    const h = Number((s.time || '00:00').slice(0, 2));
    const key = h < startH ? 'early' : h > endH ? 'late' : h;
    if (!byHour.has(key)) byHour.set(key, []);
    byHour.get(key).push(s);
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
  if (byHour.has('early')) wrap.append(rowFor('early', 'Early'));
  for (let h = startH; h <= endH; h++) wrap.append(rowFor(h, hourLabel(h)));
  if (byHour.has('late')) wrap.append(rowFor('late', 'Late'));
  if (!slots.length) wrap.append(el('p', { class: 'muted', text: selected < state.profile.surgery_date ? 'Before surgery — nothing planned.' : 'Nothing planned for this day.' }));
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
    const col = el('div', { class: `cal-col${d === today ? ' is-today' : ''}${d === selected ? ' is-selected' : ''}` });
    col.append(el('button', { type: 'button', class: 'cal-col-head', onclick: () => { u.selectedDate = d; actions.quietRender(); } },
      el('span', { class: 'cal-col-wd', text: formatDateStr(d, { weekday: 'short' }) }),
      el('span', { class: 'cal-col-num', text: String(Number(d.slice(8))) }),
      el('span', { class: 'cal-col-day', text: n === 0 ? 'Surgery day' : n > 0 ? `Day ${n}` : '' }),
      comp.total ? el('span', { class: 'cal-col-comp', text: `${comp.done}/${comp.total}` }) : null
    ));
    const list = el('div', { class: 'cal-col-pills' });
    for (const s of slots) list.append(pill(ctx, s, { compact: true, showTime: true }));
    if (!slots.length) list.append(el('span', { class: 'muted small', text: d < state.profile.surgery_date ? '—' : 'Nothing planned' }));
    col.append(list);
    cols.append(col);
  }
  grid.append(cols);
  return grid;
}

function prnRow(ctx, selected) {
  const { state, actions } = ctx;
  const tz = state.profile.timezone || DEFAULT_TZ;
  const pills = prnPills(state, selected, { tz });
  const row = el('div', { class: 'cal-prn' });
  row.append(el('h2', { class: 'section-title', text: 'As needed' }), el('p', { class: 'muted small', text: 'Tap to log if taken. Never due, never red.' }));
  row.append(
    el('div', { class: 'cal-pills' },
      pills.map((p) =>
        el('button', { type: 'button', class: `pill pill-prn${p.flagged ? ' pill-flagged' : ''}`, 'aria-label': `${p.title}, as needed, ${p.count} today`, onclick: () => openPrnSheet(ctx, p) },
          icon('meds', 'icon icon-sm'),
          el('span', { class: 'pill-title', text: cap(p.short) }),
          el('span', { class: 'pill-meta', text: p.count ? `×${p.count} today · ${formatTime(fromIso(p.last.occurred_at), tz)}` : p.last ? `last ${describeWhen(fromIso(p.last.occurred_at), ctx.now(), tz)}` : 'not recorded' }),
          p.flagged ? icon('alert', 'icon icon-sm pill-flag') : null
        )
      )
    )
  );
  return row;
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
  switch (slot.status) {
    case 'done':
      meta = slot.event ? `Done ${formatTime(fromIso(slot.event.occurred_at), tz)}` : 'Done';
      break;
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
    default:
      meta = slot.at ? formatTime(slot.at, tz) : slot.sub || '';
  }
  const b = el('button', {
    type: 'button',
    class: `pill pill-${slot.status}${slot.unconfirmed && !['done', 'skipped', 'in_progress'].includes(slot.status) ? ' pill-unconfirmed' : ''}${slot.optional ? ' pill-optional' : ''}${compact ? ' pill-compact' : ''}${big ? ' pill-big' : ''}`,
    'aria-label': `${slot.title}${slot.at ? `, ${formatTime(slot.at, tz)}` : ''}, ${STATUS_LABELS[slot.status] || slot.status}`,
    onclick: () => openSlotSheet(ctx, slot),
  });
  b.append(el('span', { class: 'pill-dot', 'aria-hidden': 'true' }, slot.status === 'done' ? icon('check', 'icon icon-sm') : slot.status === 'in_progress' ? icon('pulse', 'icon icon-sm') : icon(slot.icon, 'icon icon-sm')));
  const text = el('span', { class: 'pill-text' });
  text.append(el('span', { class: 'pill-title', text: compact ? cap(slot.short) : slot.label || slot.title }));
  if (compact && showTime && slot.at) text.append(el('span', { class: 'pill-meta', text: `${formatTime(slot.at, tz)}${slot.status === 'done' ? ' ✓' : slot.status === 'todo' ? ' · not recorded' : slot.status === 'in_progress' ? ' · in progress' : ''}` }));
  else text.append(el('span', { class: 'pill-meta', text: meta }));
  b.append(text);
  return b;
}

// ---------- Slot sheet: tap a pill, answer the questions ----------

export function openSlotSheet(ctx, slot) {
  const { state, actions } = ctx;
  const tz = state.profile.timezone || DEFAULT_TZ;
  const now = ctx.now();
  const sheet = openSheet({ title: slot.title, content: null });
  const body = el('div', { class: 'form' });
  const statusLine = el('div', { class: 'row-between' }, el('span', { class: 'muted' }, slot.at ? `${formatDateStr(slot.date)} · ${formatTime(slot.at, tz)}` : formatDateStr(slot.date)), chip(STATUS_LABELS[slot.status] || slot.status, { done: 'ok', in_progress: 'warning', todo: 'danger', due: 'neutral', skipped: 'muted', upcoming: 'muted', open: 'muted', info: 'muted' }[slot.status] || 'muted'));
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
      if (slot.unconfirmed) body.append(el('div', { class: 'banner banner-warning' }, icon('alert'), el('span', {}, el('strong', { text: 'Placeholder time. ' }), 'The schedule has not been confirmed yet — confirm the course start and exact times from Medications, or just record what you took.')));
      if (slot.status === 'todo') body.append(el('p', { class: 'muted small', text: 'Nothing was recorded for this slot. If you are not sure whether you took it, check the label or ask the pharmacist — never double up.' }));
      body.append(el('p', { class: 'strong', text: `Did you take ${m.name} ${m.display_strength}?` }));
      body.append(el('div', { class: 'btn-row' }, button('Yes — record it', { variant: 'primary', icon: 'check', onClick: () => recordThen(initFor(slot, defaultOccurred)) })));
      body.append(el('div', { class: 'btn-row' }, slot.unconfirmed ? el('a', { class: 'btn btn-secondary', href: '#medications', onclick: () => sheet.close('nav') }, 'Confirm schedule') : null, button('Skip this dose', { variant: 'ghost', onClick: skip }), button('Not now', { variant: 'ghost', onClick: () => sheet.close('later') })));
      break;
    }
    case 'ice_elevate':
    case 'exercise': {
      if (slot.kind === 'exercise') body.append(el('div', { class: 'banner banner-info' }, icon('alert'), el('span', {}, el('strong', { text: 'Guardrail: ' }), slot.order.guardrail)), el('p', { class: 'muted small', text: `${slot.order.how_to} ${slot.order.parameters}` }));
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
  if (m.schedule?.min_interval_hours && p.last) {
    const since = now - fromIso(p.last.occurred_at);
    const minMs = m.schedule.min_interval_hours * 3600 * 1000;
    body.append(el('p', { class: 'muted small', text: since < minMs ? `The label interval is every ${m.schedule.min_interval_hours}${m.schedule.max_interval_hours ? `–${m.schedule.max_interval_hours}` : ''} hours; the last recorded dose was ${relativeAgo(fromIso(p.last.occurred_at), now)}.` : `Last recorded dose was ${relativeAgo(fromIso(p.last.occurred_at), now)}.` }));
  }
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
    el('div', { class: 'card-actions' }, button('Import backup', { variant: 'primary', onClick: () => actions.openImport() }), button('Start fresh', { onClick: () => actions.dismissDataLoss() }))
  );
}
