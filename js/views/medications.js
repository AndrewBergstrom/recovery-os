// views/medications.js — order cards (not doses), last confirmed, history with corrections,
// schedule confirmation as a new order version.

import { el, chip, button, field, icon, openSheet, segmented } from '../ui.js';
import { activeOrders, statusLabel, lastConfirmedDose, isPrn, isScheduled, isScheduleConfirmed, nextScheduledDose, confirmSchedule, versionsOf } from '../medications.js';
import { acetaminophenIds, rollingTotalMg, interactionNotices, ACETAMINOPHEN_ROLLING_MAX_MG } from '../safety-rules.js';
import { currentEvents, sortByOccurred } from '../events.js';
import { fromIso, describeWhen, formatTime, localDateString, isValidDateStr, zonedToUtc, DEFAULT_TZ } from '../time.js';
import { REMINDER_POLICY, osReminderSuggestions } from '../reminders.js';
import { eventList } from './shared.js';

export function renderMedications(ctx) {
  const { state, actions } = ctx;
  const now = ctx.now();
  const tz = state.profile.timezone || DEFAULT_TZ;
  const meds = activeOrders(state.orders, 'medication');
  const view = el('section', { class: 'view' });
  view.append(el('h1', { text: 'Medications' }));
  view.append(el('p', { class: 'muted', text: 'These are your orders as written on the paperwork. A dose only counts when you record it.' }));

  const acetIds = acetaminophenIds(state.orders);
  const acetTotal = rollingTotalMg(state.events, acetIds, now);

  view.append(
    el('div', { class: 'card-stack' },
      meds.map((m) => {
        const st = statusLabel(m);
        const last = lastConfirmedDose(state.events, m.id);
        const card = el('div', { class: `card${st.tone === 'warning' ? ' card-warning' : ''}` });
        card.append(el('div', { class: 'card-title' }, `${m.name} ${m.display_strength}`, chip(st.text, st.tone)));
        const meta = el('div', { class: 'card-meta' });
        meta.append(el('span', {}, el('strong', { text: 'Prescribed: ' }), m.directions));
        if (m.why) meta.append(el('span', { text: m.why }));
        meta.append(el('span', {}, el('strong', { text: 'Last confirmed taken: ' }), last ? describeWhen(fromIso(last.occurred_at), now, tz) : 'Not recorded'));
        if (isScheduleConfirmed(m)) {
          const next = nextScheduledDose(m, now, tz);
          meta.append(el('span', {}, el('strong', { text: 'Schedule: ' }), `${m.schedule.times.map((t) => formatTime(zonedToUtc('2026-01-01', t, tz), tz)).join(' · ')} · ${m.schedule.course_start} → ${m.schedule.course_end || '?'}`, next ? ` · next ${formatTime(next.ms, tz)} ${next.isToday ? 'today' : 'tomorrow'}` : ''));
          meta.append(el('span', { class: 'small', text: `Confirmed by ${m.confirmed_by} on ${m.confirmed_on}` }));
        }
        if (isPrn(m)) meta.append(el('span', { class: 'small', text: 'As needed: available to log if taken. Never shown as due or missed.' }));
        if (acetIds.includes(m.id)) meta.append(el('span', {}, el('strong', { text: 'Recorded in the preceding 24 h: ' }), `${acetTotal.toLocaleString('en-US')} mg of ${ACETAMINOPHEN_ROLLING_MAX_MG.toLocaleString('en-US')} mg (rolling, recorded entries only)`));
        card.append(meta);
        for (const n of interactionNotices(m, state.orders)) card.append(el('div', { class: 'banner banner-warning' }, icon('alert'), el('span', { text: n.message })));
        if (m.notes?.length) card.append(el('details', { class: 'plain' }, el('summary', { text: 'Notes and safeguards' }), el('div', { class: 'details-body' }, el('ul', { class: 'small' }, m.notes.map((n) => el('li', { text: n }))))));
        const actionsRow = el('div', { class: 'card-actions' });
        if (isScheduled(m)) actionsRow.append(button(isScheduleConfirmed(m) ? 'Edit schedule' : 'Confirm schedule', { variant: isScheduleConfirmed(m) ? 'secondary' : 'warning', onClick: () => openScheduleSheet(ctx, m) }));
        actionsRow.append(button(`Log ${m.short_name || m.name}`, { variant: 'primary', onClick: () => actions.openQuickLog({ type: 'medication', medication_id: m.id, source: 'medications_view' }) }));
        card.append(actionsRow);
        const versions = versionsOf(state.orders, m.id);
        if (versions.length > 1) card.append(el('details', { class: 'plain' }, el('summary', { text: `Order history (${versions.length} versions)` }), el('div', { class: 'details-body' }, el('ul', { class: 'small' }, versions.map((v) => el('li', { text: `v${v.version}: ${v.status.replace(/_/g, ' ')} · valid ${v.valid_from || '?'} → ${v.valid_to || 'now'}${v.confirmed_by ? ` · confirmed by ${v.confirmed_by} on ${v.confirmed_on}` : ''}` }))))));
        return card;
      })
    )
  );

  // Reminders policy
  const suggestions = osReminderSuggestions(meds, tz);
  view.append(
    el('details', {}, el('summary', { text: 'Reminders (what this app can and cannot do)' }),
      el('div', { class: 'details-body' },
        el('ul', { class: 'small' }, REMINDER_POLICY.map((p) => el('li', { text: p }))),
        suggestions.length ? el('div', { class: 'list' }, el('strong', { text: 'Suggested operating-system reminders' }), suggestions.map((s) => el('div', { class: 'summary-box' }, el('strong', { text: s.title }), el('span', { text: s.line }), el('span', { class: 'small muted', text: s.howto })))) : el('p', { class: 'muted small', text: 'Confirm a schedule above to get reminder suggestions you can set up in your phone’s Reminders or Clock app.' })
      )
    )
  );

  // History
  const all = state.events.filter((e) => e.event_type === 'medication');
  const today = localDateString(now, tz);
  const todayEvents = sortByOccurred(all.filter((e) => localDateString(fromIso(e.occurred_at), tz) === today), 'desc');
  const earlier = sortByOccurred(all.filter((e) => localDateString(fromIso(e.occurred_at), tz) !== today), 'desc');
  view.append(el('h2', { class: 'section-title', text: 'Medication history' }));
  view.append(el('div', { class: 'card' }, el('h3', { text: 'Today' }), eventList(ctx, todayEvents, { emptyText: 'No doses recorded today. “Not recorded” is not “not taken”.' })));
  if (earlier.length) view.append(el('details', {}, el('summary', { text: `Earlier (${earlier.length})` }), el('div', { class: 'details-body' }, eventList(ctx, earlier, { showDate: true }))));
  view.append(el('p', { class: 'muted small', text: 'Corrections keep the original entry visible. Nothing is edited silently.' }));
  return view;
}

function openScheduleSheet(ctx, order) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const todayStr = localDateString(ctx.now(), tz);
  const existing = order.schedule?.times || [];
  const start = el('input', { type: 'date', value: order.schedule?.course_start || ctx.state.profile.surgery_date });
  const t1 = el('input', { type: 'time', value: existing[0] || '08:00' });
  const t2 = el('input', { type: 'time', value: existing[1] || '18:00' });
  const role = segmented(
    [
      { id: 'Patient, from the prescription label', label: 'Me, from the label' },
      { id: 'Pharmacist', label: 'Pharmacist' },
      { id: "Surgeon's office", label: 'Surgeon’s office' },
      { id: 'Other', label: 'Other' },
    ],
    'Patient, from the prescription label',
    null,
    { label: 'Confirmed by' }
  );
  const name = el('input', { type: 'text', placeholder: 'Name (optional)', autocomplete: 'off' });
  const date = el('input', { type: 'date', value: todayStr });
  const source = el('input', { type: 'text', placeholder: 'e.g. label says with breakfast and dinner', autocomplete: 'off' });
  const errors = el('div', { class: 'error-box hidden' });
  const sheet = openSheet({
    title: `${order.name} schedule`,
    content: el(
      'form',
      { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        errors.classList.add('hidden');
        try {
          if (!isValidDateStr(start.value)) throw new Error('Enter the course start date.');
          const times = [t1.value, t2.value].filter(Boolean);
          const { newVersion, previous } = confirmSchedule(order, { times, course_start: start.value, confirmed_by: role.value, confirmed_by_name: name.value.trim(), confirmed_on: date.value, source: source.value.trim(), todayStr });
          await ctx.actions.putOrderVersion(newVersion, previous);
          sheet.close('saved');
        } catch (err) {
          errors.textContent = err.message;
          errors.classList.remove('hidden');
        }
      } },
      el('div', { class: 'summary-box' }, el('strong', { text: `Prescribed: ${order.directions}` }), el('span', { class: 'small', text: 'Confirming the schedule creates a new order version. It does not record any dose.' })),
      field('Course start date', start, { required: true, hint: order.schedule?.course_weeks ? `Course length on the prescription: ${order.schedule.course_weeks} weeks.` : undefined }),
      el('div', { class: 'inline-fields' }, field('First dose time', t1, { required: true }), field('Second dose time', t2)),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Confirmed by' }), role.node),
      field('Their name', name),
      field('Date confirmed', date, { required: true }),
      field('Source / note', source),
      errors,
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Save schedule', { variant: 'primary', type: 'submit' }))
    ),
  });
}
