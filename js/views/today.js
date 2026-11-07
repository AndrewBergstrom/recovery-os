// views/today.js — the command center: what needs attention, what's done, one safe next thing.

import { el, chip, button, icon } from '../ui.js';
import { daysSinceSurgery, dayLabel, greeting, localDateString, fromIso, formatTime, formatDateLong, describeWhen, daysBetween, DEFAULT_TZ } from '../time.js';
import { currentEvents, eventsOnLocalDate, sortByOccurred, latestEvent } from '../events.js';
import { activeOrders, isPrn, isScheduled, isScheduleConfirmed, lastConfirmedDose, nextScheduledDose, recentScheduledWithoutDose } from '../medications.js';
import { partitionExercises } from '../exercises.js';
import { HIGH_PRIORITY_SYMPTOMS, ESCALATION_TEXT, PRODUCT_BOUNDARY, weightBearingState } from '../safety-rules.js';
import { eventList } from './shared.js';
import { milestoneDate } from './plan.js';

export function renderToday(ctx) {
  const { state, actions } = ctx;
  const now = ctx.now();
  const tz = state.profile.timezone || DEFAULT_TZ;
  const today = localDateString(now, tz);
  const day = daysSinceSurgery(state.profile.surgery_date, now, tz);
  const current = currentEvents(state.events);
  const todays = eventsOnLocalDate(current, today, tz);
  const meds = activeOrders(state.orders, 'medication');
  const { cleared, pending } = partitionExercises(state.orders);
  const openQs = state.questions.filter((q) => q.status === 'needs_clinician_confirmation');
  const lowEnergy = !!state.prefs.lowEnergy;

  const cards = buildUpNext(ctx, { now, tz, todays, current, meds, cleared }).slice(0, lowEnergy ? 1 : 3);

  const counts = {
    meds: todays.filter((e) => e.event_type === 'medication' && e.status === 'taken').length,
    movement: todays.filter((e) => e.event_type === 'exercise' && e.status !== 'not_today').length,
    ice: todays.filter((e) => e.event_type === 'ice_elevate').length,
  };

  const recent = sortByOccurred(todays, 'desc').slice(0, 5);
  const last = latestEvent(current);
  const gapDays = last ? daysBetween(localDateString(fromIso(last.occurred_at), tz), today) : 0;

  const view = el('section', { class: 'view view-today' });

  view.append(
    el('div', { class: 'day-banner' }, el('p', { class: 'eyebrow', text: `${formatDateLong(now, tz)} · ${dayLabel(day)}` }), el('h1', { class: 'greeting', text: `${greeting(now, tz)}. One thing at a time.` }))
  );

  if (state.storeVolatile) {
    view.append(el('div', { class: 'banner banner-danger', role: 'alert' }, icon('alert'), el('span', {}, el('strong', { text: 'Storage unavailable. ' }), 'Entries will not survive closing this page. Export anything important from Settings.')));
  }
  if (state.dataLossSuspected) view.append(dataLossPanel(ctx));

  if (openQs.length) {
    view.append(
      el('a', { class: 'banner banner-warning', href: '#plan' }, icon('alert'), el('span', {}, el('strong', { text: 'Needs confirmation' }), ` · ${openQs.map((q) => q.short || q.topic).join(' · ')}`))
    );
  }

  view.append(el('h2', { class: 'section-title', text: lowEnergy ? 'One safe thing' : 'Up next' }));
  if (cards.length) view.append(el('div', { class: 'card-stack' }, cards.map(actionCard)));
  else view.append(el('p', { class: 'muted', text: 'Nothing is waiting on you right now. Resting counts.' }));

  if (!lowEnergy) view.append(laterSection(ctx, { now, tz, meds, pending, cleared }));

  view.append(
    el('div', { class: 'hide-low-energy' },
      el('h2', { class: 'section-title', text: 'Today at a glance' }),
      el('div', { class: 'tiles' },
        tile(counts.meds, 'Meds logged', '#medications'),
        tile(counts.movement, 'Movement', '#movement'),
        tile(counts.ice, 'Ice / elevate', '#progress')
      )
    )
  );

  view.append(
    el('div', { class: 'btn-row' },
      button('Quick log', { variant: 'primary', icon: 'plus', cls: 'btn-large', onClick: () => actions.openQuickLog() }),
      button(lowEnergy ? 'Back to full view' : 'I feel overwhelmed', { variant: 'secondary', icon: 'calm', cls: 'btn-large', onClick: () => actions.toggleLowEnergy() })
    )
  );
  if (lowEnergy) view.append(el('p', { class: 'muted', text: 'Low-energy mode: bigger text, fewer choices, one task at a time. Doing nothing right now is also fine.' }));

  view.append(el('h2', { class: 'section-title', text: 'Recently done' }));
  if (recent.length) view.append(el('div', { class: 'card' }, eventList(ctx, recent, { allowCorrect: !lowEnergy })));
  else if (last && gapDays >= 1) view.append(el('div', { class: 'card' }, el('p', { text: 'Nothing recorded yet today. You can pick up here — there is no backlog to clear.' }), el('p', { class: 'muted small', text: `Last entry: ${describeWhen(fromIso(last.occurred_at), now, tz)}.` })));
  else view.append(el('div', { class: 'card' }, el('p', { class: 'muted', text: 'Nothing recorded yet today.' })));

  view.append(safetyDetails());
  view.append(el('p', { class: 'footer-note', text: PRODUCT_BOUNDARY }));
  return view;
}

function tile(value, label, href) {
  return el('a', { class: 'tile', href }, el('span', { class: 'tile-value', text: String(value) }), el('span', { class: 'tile-label', text: label }));
}

function actionCard(c) {
  const card = el('div', { class: `card${c.tone === 'warning' ? ' card-warning' : ''}` });
  card.append(el('div', { class: 'card-title' }, c.title, c.chip ? chip(c.chip.text, c.chip.tone) : null));
  const meta = el('div', { class: 'card-meta' });
  if (c.why) meta.append(el('span', { text: c.why }));
  if (c.when) meta.append(el('span', {}, el('strong', { text: c.when })));
  if (c.last) meta.append(el('span', { text: c.last }));
  card.append(meta);
  const actions = el('div', { class: 'card-actions' });
  if (c.secondary) actions.append(c.secondary.href ? el('a', { class: 'btn btn-secondary', href: c.secondary.href }, c.secondary.label) : button(c.secondary.label, { onClick: c.secondary.onClick }));
  if (c.primary) actions.append(button(c.primary.label, { variant: 'primary', onClick: c.primary.onClick }));
  card.append(actions);
  return card;
}

function buildUpNext(ctx, { now, tz, todays, current, meds, cleared }) {
  const { actions } = ctx;
  const cards = [];
  for (const m of meds.filter(isScheduled)) {
    const last = lastConfirmedDose(current, m.id);
    const lastText = `Last confirmed: ${last ? describeWhen(fromIso(last.occurred_at), now, tz) : 'Not recorded'}`;
    if (!isScheduleConfirmed(m)) {
      cards.push({
        title: `${m.name} ${m.display_strength}`,
        chip: { text: 'Schedule needs confirmation', tone: 'warning' },
        tone: 'warning',
        why: `${m.why} · ${m.directions}`,
        when: 'Confirm the course start and exact times before this is shown as scheduled.',
        last: lastText,
        secondary: { label: 'Review', href: '#medications' },
        primary: { label: `Log ${m.short_name || m.name}`, onClick: () => actions.openQuickLog({ type: 'medication', medication_id: m.id }) },
      });
      continue;
    }
    const missing = recentScheduledWithoutDose(m, current, now, tz);
    const next = nextScheduledDose(m, now, tz);
    cards.push({
      title: `${m.name} ${m.display_strength}`,
      chip: missing ? { text: 'Not recorded', tone: 'warning' } : { text: 'Scheduled', tone: 'ok' },
      tone: missing ? 'warning' : null,
      why: `${m.why} · ${m.directions}`,
      when: missing
        ? `Scheduled ${formatTime(missing.ms, tz)} today — not recorded. If you're unsure whether you took it, check the label or pharmacist; never double up.`
        : next
          ? `Next: ${formatTime(next.ms, tz)} ${next.isToday ? 'today' : 'tomorrow'}`
          : 'Course end date has passed — confirm with your clinician.',
      last: lastText,
      secondary: { label: 'Review', href: '#medications' },
      primary: { label: `Log ${m.short_name || m.name}`, onClick: () => actions.openQuickLog({ type: 'medication', medication_id: m.id }) },
    });
  }
  const iceToday = todays.filter((e) => e.event_type === 'ice_elevate').length;
  cards.push({
    title: 'Ice / elevate',
    why: 'Handout: 20–30 min, at least four times daily in early recovery · dry barrier between pad and skin',
    when: `Logged today: ${iceToday}`,
    primary: { label: 'Log ice / elevate', onClick: () => actions.openQuickLog({ type: 'ice_elevate' }) },
  });
  if (cleared.length) {
    const doneIds = new Set(todays.filter((e) => e.event_type === 'exercise' && e.status === 'completed').map((e) => e.exercise_id));
    const nextEx = cleared.find((x) => !doneIds.has(x.id));
    if (nextEx) {
      cards.push({
        title: nextEx.name,
        chip: { text: 'Cleared', tone: 'ok' },
        why: nextEx.how_to,
        when: nextEx.parameters,
        last: `Guardrail: ${nextEx.guardrail}`,
        secondary: { label: 'Details', href: '#movement' },
        primary: { label: `Start ${nextEx.name.toLowerCase()}`, onClick: () => actions.openQuickLog({ type: 'exercise', exercise_id: nextEx.id }) },
      });
    }
  }
  if (!todays.some((e) => e.event_type === 'checkin')) {
    cards.push({
      title: 'Quick check-in',
      chip: { text: 'Optional', tone: 'muted' },
      why: 'About 15 seconds: pain, swelling, a note. Helps the visit summary.',
      when: 'Any time today',
      primary: { label: 'Start check-in', onClick: () => actions.openQuickLog({ type: 'checkin' }) },
    });
  }
  return cards;
}

function laterSection(ctx, { now, tz, meds, pending, cleared }) {
  const { state, actions } = ctx;
  const prn = meds.filter(isPrn);
  const body = el('div', { class: 'details-body' });
  body.append(el('h3', { text: 'As-needed medicines' }), el('p', { class: 'muted small', text: 'Available to log if taken. Never shown as due or missed.' }));
  body.append(
    el('div', { class: 'list' },
      prn.map((m) => {
        const last = lastConfirmedDose(state.events, m.id);
        return el('div', { class: 'row-between' },
          el('div', {}, el('strong', { text: `${m.name} ${m.display_strength}` }), el('div', { class: 'muted small', text: `Last confirmed: ${last ? describeWhen(fromIso(last.occurred_at), now, tz) : 'Not recorded'}` })),
          button(`Log ${m.short_name || m.name}`, { onClick: () => actions.openQuickLog({ type: 'medication', medication_id: m.id }) })
        );
      })
    )
  );
  body.append(el('h3', { text: 'Movement' }));
  body.append(
    el('p', { class: 'muted small' },
      cleared.length ? `${cleared.length} cleared exercise${cleared.length === 1 ? '' : 's'}. ` : '',
      pending.length ? `${pending.length} exercise${pending.length === 1 ? '' : 's'} waiting on clinician confirmation — not shown as due. ` : '',
      el('a', { href: '#movement', text: 'Open Movement' })
    )
  );
  const upcoming = state.milestones
    .map((m) => ({ m, date: milestoneDate(m, state.profile.surgery_date) }))
    .filter((x) => x.date && x.date.from >= localDateString(now, tz))
    .sort((a, b) => (a.date.from < b.date.from ? -1 : 1))[0];
  if (upcoming) {
    body.append(el('h3', { text: 'Next milestone' }), el('p', { class: 'muted small' }, `${upcoming.m.title} — ${upcoming.date.label} `, chip(upcoming.m.status === 'needs_confirmation' ? 'needs confirmation' : upcoming.m.status, upcoming.m.status === 'needs_confirmation' ? 'warning' : 'neutral'), ' ', el('a', { href: '#plan', text: 'Plan' })));
  }
  const wb = weightBearingState(state.questions, daysSinceSurgery(state.profile.surgery_date, now, tz));
  body.append(el('h3', { text: 'Current restrictions' }), el('ul', { class: 'small' }, el('li', { text: wb.label }), el('li', { text: 'Knee flexion 0–90° until formally cleared' }), el('li', { text: 'Brace locked at 0° for walking' })));
  if (wb.note) body.append(el('p', { class: 'banner banner-warning small' }, icon('alert'), el('span', { text: wb.note })));
  return el('details', { class: 'hide-low-energy' }, el('summary', { text: 'Later and as needed' }), body);
}

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
