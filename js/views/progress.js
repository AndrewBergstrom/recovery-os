// views/progress.js — chartless, week-over-week patterns from recorded facts.
// No health scores, no predictions. Missing data is "Not recorded".

import { el, chip, button, icon } from '../ui.js';
import { currentEvents, sortByOccurred } from '../events.js';
import { fromIso, localDateString, addDays, formatDateStr, DEFAULT_TZ } from '../time.js';
import { HIGH_PRIORITY_SYMPTOMS, ESCALATION_TEXT } from '../safety-rules.js';
import { eventList } from './shared.js';

export function renderProgress(ctx) {
  const { state, actions } = ctx;
  const now = ctx.now();
  const tz = state.profile.timezone || DEFAULT_TZ;
  const current = currentEvents(state.events);
  const today = localDateString(now, tz);
  const view = el('section', { class: 'view' });
  view.append(el('h1', { text: 'Progress' }));
  view.append(el('p', { class: 'muted', text: 'Patterns from what you recorded — nothing is scored or predicted.' }));

  view.append(
    el('div', { class: 'btn-row' },
      button('Quick check-in', { variant: 'primary', icon: 'pulse', onClick: () => actions.openQuickLog({ type: 'checkin', source: 'progress_view' }) }),
      button('Prepare follow-up summary', { icon: 'note', onClick: () => actions.exportSummary() })
    )
  );

  // Last 7 days table
  const rows = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    if (d < state.profile.surgery_date) continue;
    const evs = current.filter((e) => localDateString(fromIso(e.occurred_at), tz) === d);
    const meds = evs.filter((e) => e.event_type === 'medication' && e.status === 'taken').length;
    const ice = evs.filter((e) => e.event_type === 'ice_elevate').length;
    const move = evs.filter((e) => e.event_type === 'exercise' && e.status !== 'not_today').length;
    const checkins = sortByOccurred(evs.filter((e) => e.event_type === 'checkin'), 'desc');
    const pains = checkins.map((c) => c.pain).filter((p) => p != null);
    const painText = pains.length ? (pains.length === 1 ? `${pains[0]}` : `${Math.min(...pains)}–${Math.max(...pains)}`) : null;
    const swelling = checkins.find((c) => c.swelling)?.swelling || null;
    rows.push({ d, any: evs.length > 0, meds, ice, move, painText, swelling });
  }
  const cell = (v, recorded) => el('td', { class: 'num' + (v == null || !recorded ? ' muted' : ''), text: v == null ? 'Not recorded' : String(v) });
  view.append(el('h2', { class: 'section-title', text: 'Last 7 days' }));
  view.append(
    el('div', { class: 'table-wrap' },
      el('table', {},
        el('thead', {}, el('tr', {}, el('th', { text: 'Day' }), el('th', { text: 'Meds logged' }), el('th', { text: 'Ice / elevate' }), el('th', { text: 'Movement' }), el('th', { text: 'Pain' }), el('th', { text: 'Swelling' }))),
        el('tbody', {},
          rows.map((r) =>
            el('tr', {},
              el('td', { text: r.d === today ? 'Today' : formatDateStr(r.d) }),
              r.any ? cell(r.meds, true) : cell(null),
              r.any ? cell(r.ice, true) : cell(null),
              r.any ? cell(r.move, true) : cell(null),
              cell(r.painText, true),
              cell(r.swelling, true)
            )
          )
        )
      )
    )
  );
  view.append(el('p', { class: 'muted small', text: 'A day with no entries shows “Not recorded” — it does not mean nothing happened.' }));

  // Check-in history
  const checkins = sortByOccurred(current.filter((e) => e.event_type === 'checkin'), 'desc').slice(0, 14);
  view.append(el('h2', { class: 'section-title', text: 'Recent check-ins' }));
  view.append(el('div', { class: 'card' }, eventList(ctx, checkins, { showDate: true, emptyText: 'No check-ins yet. They take about 15 seconds and make the visit summary much more useful.' })));

  // Flags
  const flagged = sortByOccurred(current.filter((e) => e.event_type === 'checkin' && Array.isArray(e.symptoms) && e.symptoms.length), 'desc').slice(0, 5);
  if (flagged.length) {
    view.append(
      el('div', { class: 'card card-warning' },
        el('div', { class: 'card-title' }, icon('alert'), ' Symptom flags you recorded'),
        el('ul', {}, flagged.map((c) => el('li', { text: `${formatDateStr(localDateString(fromIso(c.occurred_at), tz))}: ${c.symptoms.map((id) => HIGH_PRIORITY_SYMPTOMS.find((s) => s.id === id)?.label || id).join(', ')}` }))),
        el('p', { class: 'small', text: `${ESCALATION_TEXT.emergency} ${ESCALATION_TEXT.clinician_now}` })
      )
    );
  }

  // Ice / elevation and movement recent lists
  const ice = sortByOccurred(current.filter((e) => e.event_type === 'ice_elevate'), 'desc').slice(0, 8);
  view.append(el('details', {}, el('summary', { text: 'Ice / elevation sessions' }), el('div', { class: 'details-body' }, eventList(ctx, ice, { showDate: true, emptyText: 'None recorded yet.' }))));
  return view;
}
