// views/movement.js — exercises split into Cleared / Pending clinician confirmation / Completed.
// Uncleared exercises are never presented as due tasks.

import { el, chip, button, field, icon, openSheet, segmented } from '../ui.js';
import { partitionExercises, markCleared, exerciseSessions } from '../exercises.js';
import { sortByOccurred } from '../events.js';
import { fromIso, localDateString, isValidDateStr, DEFAULT_TZ } from '../time.js';
import { eventList } from './shared.js';

export function renderMovement(ctx) {
  const { state, actions } = ctx;
  const now = ctx.now();
  const tz = state.profile.timezone || DEFAULT_TZ;
  const { cleared, pending } = partitionExercises(state.orders);
  const ptQ = state.questions.find((q) => q.id === 'pt-start');
  const view = el('section', { class: 'view' });
  view.append(el('h1', { text: 'Movement' }));
  if (ptQ && ptQ.status === 'needs_clinician_confirmation') {
    view.append(el('a', { class: 'banner banner-warning', href: '#plan' }, icon('alert'), el('span', {}, el('strong', { text: 'PT start needs surgeon confirmation. ' }), 'Exercises below come from your paperwork but are not shown as due until a clinician clears them.')));
  }

  const exerciseCard = (x, isCleared) => {
    const card = el('div', { class: `card${isCleared ? '' : ' card-warning'}` });
    card.append(el('div', { class: 'card-title' }, x.name, chip(isCleared ? 'Cleared' : 'Pending clinician confirmation', isCleared ? 'ok' : 'warning')));
    const meta = el('div', { class: 'card-meta' });
    meta.append(el('span', { text: x.how_to }));
    meta.append(el('span', {}, el('strong', { text: 'Parameters: ' }), x.parameters));
    meta.append(el('span', {}, el('strong', { text: 'Guardrail: ' }), x.guardrail));
    if (isCleared) meta.append(el('span', { class: 'small', text: `Cleared by ${x.cleared_by} on ${x.cleared_on} · ${x.instructions_version}` }));
    card.append(meta);
    const row = el('div', { class: 'card-actions' });
    if (isCleared) row.append(button(`Start ${x.name.toLowerCase()}`, { variant: 'primary', onClick: () => actions.openQuickLog({ type: 'exercise', exercise_id: x.id, source: 'movement_view' }) }));
    else {
      row.append(button('Mark as cleared', { variant: 'warning', onClick: () => openClearanceSheet(ctx, x) }));
      row.append(button('Log anyway (patient-reported)', { onClick: () => actions.openQuickLog({ type: 'exercise', exercise_id: x.id, source: 'movement_view' }) }));
    }
    card.append(row);
    return card;
  };

  view.append(el('h2', { class: 'section-title', text: `Cleared (${cleared.length})` }));
  if (cleared.length) view.append(el('div', { class: 'card-stack' }, cleared.map((x) => exerciseCard(x, true))));
  else view.append(el('p', { class: 'muted', text: 'No exercises cleared yet. When your PT or surgeon clears one, record it below with who, when and which instructions.' }));

  view.append(el('h2', { class: 'section-title', text: `Pending clinician confirmation (${pending.length})` }));
  if (pending.length) view.append(el('div', { class: 'card-stack' }, pending.map((x) => exerciseCard(x, false))));
  else view.append(el('p', { class: 'muted', text: 'Nothing pending.' }));

  const sessions = exerciseSessions(state.events);
  const today = localDateString(now, tz);
  const todays = sortByOccurred(sessions.filter((e) => localDateString(fromIso(e.occurred_at), tz) === today), 'desc');
  const earlier = sortByOccurred(sessions.filter((e) => localDateString(fromIso(e.occurred_at), tz) !== today), 'desc');
  view.append(el('h2', { class: 'section-title', text: 'Completed' }));
  view.append(el('div', { class: 'card' }, el('h3', { text: 'Today' }), eventList(ctx, todays, { emptyText: 'No sessions recorded today.' })));
  if (earlier.length) view.append(el('details', {}, el('summary', { text: `Earlier (${earlier.length})` }), el('div', { class: 'details-body' }, eventList(ctx, earlier, { showDate: true }))));
  view.append(el('p', { class: 'muted small', text: 'Stopping early or choosing “Not today” never counts against you. A timer finishing is not proof of completion — you confirm it.' }));
  return view;
}

function openClearanceSheet(ctx, x) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const todayStr = localDateString(ctx.now(), tz);
  const role = segmented(
    [
      { id: 'Physical therapist', label: 'Physical therapist' },
      { id: 'Surgeon / PA-C', label: 'Surgeon / PA-C' },
      { id: 'Other', label: 'Other' },
    ],
    'Physical therapist',
    null,
    { label: 'Cleared by' }
  );
  const name = el('input', { type: 'text', placeholder: 'Name (optional)', autocomplete: 'off' });
  const date = el('input', { type: 'date', value: todayStr });
  const version = el('input', { type: 'text', placeholder: 'e.g. PT visit 1 handout, 2026-11-12', autocomplete: 'off' });
  const params = el('input', { type: 'text', value: x.parameters, placeholder: 'Sets, reps, hold, frequency as assigned', autocomplete: 'off' });
  const errors = el('div', { class: 'error-box hidden' });
  const sheet = openSheet({
    title: `Clear: ${x.name}`,
    content: el(
      'form',
      { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        errors.classList.add('hidden');
        try {
          if (!isValidDateStr(date.value)) throw new Error('Enter the clearance date.');
          const { newVersion, previous } = markCleared(x, { cleared_by: role.value, cleared_by_name: name.value.trim(), cleared_on: date.value, instructions_version: version.value.trim(), parameters: params.value.trim(), todayStr });
          await ctx.actions.putOrderVersion(newVersion, previous);
          sheet.close('saved');
        } catch (err) {
          errors.textContent = err.message;
          errors.classList.remove('hidden');
        }
      } },
      el('div', { class: 'banner banner-info' }, icon('alert'), el('span', { text: 'Record this only after a clinician actually cleared the exercise. The app never clears exercises on its own.' })),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Cleared by' }), role.node),
      field('Their name', name),
      field('Date cleared', date, { required: true }),
      field('Instructions version / source', version, { required: true }),
      field('Assigned parameters', params),
      errors,
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Record clearance', { variant: 'primary', type: 'submit' }))
    ),
  });
}
