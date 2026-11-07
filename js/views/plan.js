// views/plan.js — source of truth: surgery details, restrictions, open questions,
// milestones, appointments, care team, source documents.

import { el, chip, button, field, icon, openSheet, segmented } from '../ui.js';
import { addDays, formatDateStr, localDateString, daysSinceSurgery, fromIso, describeWhen, isValidDateStr, parseDatetimeLocal, DEFAULT_TZ } from '../time.js';
import { currentEvents, sortByOccurred, newId } from '../events.js';
import { restrictions as seedRestrictions, sourceDocuments } from '../seed.js';
import { activeOrders } from '../medications.js';
import { weightBearingState } from '../safety-rules.js';
import { milestoneDate } from '../schedule.js';
import { statusChipFor, eventList, kv } from './shared.js';

export { milestoneDate };

export function renderPlan(ctx) {
  const { state, actions } = ctx;
  const now = ctx.now();
  const tz = state.profile.timezone || DEFAULT_TZ;
  const day = daysSinceSurgery(state.profile.surgery_date, now, tz);
  const view = el('section', { class: 'view' });
  view.append(el('h1', { text: 'Plan' }));

  // Surgery
  view.append(
    el('div', { class: 'card' },
      el('h2', { class: 'card-title', text: 'Surgery' }),
      kv([
        ['Date', formatDateStr(state.profile.surgery_date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })],
        ['Side', `${state.profile.surgical_side} ${state.profile.joint || 'knee'}`],
        ['Procedures', el('ul', {}, (state.profile.procedures || []).map((p) => el('li', { text: p })))],
        ['Day count', `Day ${day}`],
        ['Source', state.profile.source || '—'],
      ]),
      el('div', { class: 'card-actions' }, button('Edit surgery details', { onClick: () => actions.openProfileEditor() }))
    )
  );

  // Open questions
  const open = state.questions.filter((q) => q.status === 'needs_clinician_confirmation');
  const resolved = state.questions.filter((q) => q.status !== 'needs_clinician_confirmation');
  view.append(el('h2', { class: 'section-title', text: `Questions for your clinicians (${open.length} open)` }));
  if (!open.length) view.append(el('p', { class: 'muted', text: 'No open discrepancies.' }));
  view.append(
    el('div', { class: 'card-stack' },
      open.map((q) =>
        el('div', { class: 'card card-warning' },
          el('div', { class: 'card-title' }, q.topic, statusChipFor(q.status)),
          el('div', { class: 'card-meta' }, el('span', { text: `Ask: ${q.ask}` }), el('span', {}, el('strong', { text: 'Paperwork says: ' }), q.conflicting_values.join('  vs.  ')), q.note ? el('span', { text: q.note }) : null),
          el('div', { class: 'card-actions' }, button('Record the answer', { variant: 'primary', onClick: () => openResolveSheet(ctx, q) }))
        )
      )
    )
  );
  if (resolved.length) {
    view.append(
      el('details', {}, el('summary', { text: `Resolved (${resolved.length})` }),
        el('div', { class: 'details-body' },
          resolved.map((q) =>
            el('div', { class: 'list' },
              el('div', {}, el('strong', { text: q.topic }), ' ', statusChipFor(q.status)),
              el('div', { class: 'small' }, `Answer: ${q.resolution?.value || '—'} · confirmed by ${q.resolution?.confirmed_by || '?'} on ${q.resolution?.confirmed_on || '?'}${q.resolution?.source ? ` · source: ${q.resolution.source}` : ''}`),
              el('div', {}, button('Reopen', { variant: 'ghost', cls: 'small', onClick: () => actions.reopenQuestion(q) }))
            )
          )
        )
      )
    );
  }

  // Patient questions (notes)
  const myQs = sortByOccurred(currentEvents(state.events).filter((e) => e.event_type === 'note' && e.category && e.category !== 'journal'), 'desc');
  view.append(
    el('div', { class: 'card' },
      el('div', { class: 'section-head' }, el('h2', { class: 'card-title', text: 'Your questions for the visit' }), button('Add', { icon: 'plus', cls: 'small', onClick: () => actions.openQuickLog({ type: 'note', category: 'question_for_surgeon' }) })),
      eventList(ctx, myQs, { showDate: true, emptyText: 'No questions written down yet. Add them as they come to you.' })
    )
  );

  // Restrictions
  const wb = weightBearingState(state.questions, day);
  view.append(el('h2', { class: 'section-title', text: 'Current restrictions' }));
  view.append(
    el('div', { class: 'card' },
      el('ul', { class: 'list plain-list' },
        seedRestrictions.map((r) => {
          const q = r.question_id ? state.questions.find((x) => x.id === r.question_id) : null;
          const st = q && q.status !== 'needs_clinician_confirmation' ? 'confirmed' : r.status;
          return el('li', {}, el('div', {}, el('strong', { text: `${r.topic}: ` }), r.id === 'weight-bearing' ? wb.restriction : r.current, ' ', statusChipFor(st)), el('div', { class: 'muted small', text: q && q.resolution ? `Confirmed: ${q.resolution.value}` : r.detail }));
        })
      ),
      wb.note ? el('div', { class: 'banner banner-warning' }, icon('alert'), el('span', { text: wb.note })) : null,
      el('p', { class: 'muted small', text: 'Restrictions change only when a clinician confirms it and you record who, when and the source above. Preferences never waive them.' })
    )
  );

  // Milestones
  view.append(el('h2', { class: 'section-title', text: 'Milestones' }));
  view.append(
    el('div', { class: 'card' },
      el('ul', { class: 'timeline' },
        state.milestones
          .map((m) => ({ m, d: milestoneDate(m, state.profile.surgery_date) }))
          .sort((a, b) => {
            const da = a.d?.from || '9999';
            const db = b.d?.from || '9999';
            if (da !== db) return da < db ? -1 : 1;
            return roadRank(a.m.id) - roadRank(b.m.id);
          })
          .map(({ m, d }) => el('li', { class: d ? '' : 'is-unset' }, el('span', { class: 'when', text: d ? d.label : 'Date not set yet' }), el('div', { class: 'what' }, el('span', {}, el('strong', { text: m.title }), ' ', statusChipFor(m.status)), m.note ? el('span', { class: 'muted small', text: m.note }) : null, el('span', {}, button(m.status === 'confirmed' ? 'Edit date' : 'Confirm date', { variant: 'ghost', cls: 'small', onClick: () => openMilestoneSheet(ctx, m) })))))
      ),
      el('p', { class: 'muted small', text: 'Milestones are informational until an appointment is actually confirmed. The undated ones are the road back: each gets its date only when a clinician sets it.' })
    )
  );

  // Appointments
  const appts = [...state.appointments].sort((a, b) => (a.at < b.at ? -1 : 1));
  view.append(
    el('div', { class: 'card' },
      el('div', { class: 'section-head' }, el('h2', { class: 'card-title', text: 'Appointments' }), button('Add', { icon: 'plus', cls: 'small', onClick: () => openAppointmentSheet(ctx) })),
      appts.length
        ? el('ul', { class: 'timeline' }, appts.map((a) => el('li', {}, el('span', { class: 'when', text: a.at ? describeWhen(fromIso(a.at), now, tz) : '—' }), el('div', { class: 'what' }, el('span', {}, el('strong', { text: a.title }), ' ', statusChipFor(a.status || 'confirmed')), a.with ? el('span', { class: 'muted small', text: `With: ${a.with}` }) : null, a.notes ? el('span', { class: 'muted small', text: a.notes }) : null, el('span', {}, button('Edit', { variant: 'ghost', cls: 'small', onClick: () => openAppointmentSheet(ctx, a) }))))))
        : el('p', { class: 'muted', text: 'No appointments recorded yet.' })
    )
  );

  // Care team
  view.append(
    el('div', { class: 'card' },
      el('h2', { class: 'card-title', text: 'Care team' }),
      el('div', { class: 'list' },
        state.contacts.map((c) =>
          el('div', { class: 'row-between' },
            el('div', {}, el('strong', { text: c.role }), el('div', { class: 'muted small' }, c.name || c.phone ? `${c.name || ''}${c.name && c.phone ? ' · ' : ''}${c.phone || ''}` : 'Not filled in'), c.notes ? el('div', { class: 'muted small', text: c.notes }) : null),
            el('div', { class: 'btn-row' }, c.phone ? el('a', { class: 'btn btn-secondary small', href: `tel:${c.phone.replace(/[^+\d]/g, '')}`, text: 'Call' }) : null, button('Edit', { variant: 'ghost', cls: 'small', onClick: () => openContactSheet(ctx, c) }))
          )
        )
      ),
      el('p', { class: 'muted small', text: 'Stored only on this device. The phone number is shown as text so you can dial it yourself if tapping doesn’t work.' })
    )
  );

  // Original wording & sources
  const meds = activeOrders(state.orders, 'medication');
  view.append(
    el('details', {}, el('summary', { text: 'Original prescription wording' }),
      el('div', { class: 'details-body' }, el('ul', {}, meds.map((m) => el('li', {}, el('strong', { text: `${m.name} ${m.display_strength}: ` }), m.directions, el('span', { class: 'muted small', text: ` — ${m.source}` })))))
    )
  );
  view.append(
    el('details', {}, el('summary', { text: 'Source documents' }),
      el('div', { class: 'details-body' }, el('ul', {}, sourceDocuments.map((s) => el('li', { text: s }))), el('p', { class: 'muted small', text: 'When two documents disagree, the item stays “needs confirmation” until a clinician settles it.' }))
    )
  );

  // Journal
  const journal = sortByOccurred(currentEvents(state.events).filter((e) => e.event_type === 'note' && (!e.category || e.category === 'journal')), 'desc').slice(0, 10);
  view.append(
    el('div', { class: 'card' },
      el('div', { class: 'section-head' }, el('h2', { class: 'card-title', text: 'Journal' }), button('Add', { icon: 'plus', cls: 'small', onClick: () => actions.openQuickLog({ type: 'note', category: 'journal' }) })),
      eventList(ctx, journal, { showDate: true, emptyText: 'No journal entries yet.' })
    )
  );
  return view;
}

function confirmerFields(defaultRole = 'surgeon') {
  const role = segmented(
    [
      { id: 'surgeon', label: 'Surgeon / PA-C' },
      { id: 'physical_therapist', label: 'Physical therapist' },
      { id: 'pharmacist', label: 'Pharmacist / prescriber' },
      { id: 'other', label: 'Other' },
    ],
    defaultRole,
    null,
    { label: 'Confirmed by' }
  );
  const name = el('input', { type: 'text', placeholder: 'Name (optional)', autocomplete: 'off' });
  const date = el('input', { type: 'date', value: localDateString(Date.now()) });
  const source = el('input', { type: 'text', placeholder: 'e.g. phone call, clinic visit, portal message', autocomplete: 'off' });
  return {
    node: el('div', { class: 'form' }, el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Confirmed by' }), role.node), field('Their name', name), field('Date confirmed', date, { required: true }), field('How / source', source, { required: true })),
    get() {
      if (!isValidDateStr(date.value)) throw new Error('Enter the date it was confirmed.');
      if (!source.value.trim()) throw new Error('Record how it was confirmed (source).');
      const roleLabel = { surgeon: 'Surgeon / PA-C', physical_therapist: 'Physical therapist', pharmacist: 'Pharmacist / prescriber', other: 'Other' }[role.value];
      return { confirmed_by: name.value.trim() ? `${roleLabel} (${name.value.trim()})` : roleLabel, confirmed_on: date.value, source: source.value.trim() };
    },
  };
}

function openResolveSheet(ctx, q) {
  const answer = el('input', { type: 'text', placeholder: 'The confirmed instruction, in their words', autocomplete: 'off' });
  const who = confirmerFields(q.ask.toLowerCase().includes('pharm') ? 'pharmacist' : 'surgeon');
  const errors = el('div', { class: 'error-box hidden' });
  const sheet = openSheet({
    title: 'Record the clinician’s answer',
    content: el(
      'form',
      { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        errors.classList.add('hidden');
        try {
          if (!answer.value.trim()) throw new Error('Write the confirmed instruction.');
          const c = who.get();
          await ctx.actions.resolveQuestion(q, { value: answer.value.trim(), ...c });
          sheet.close('saved');
        } catch (err) {
          errors.textContent = err.message;
          errors.classList.remove('hidden');
        }
      } },
      el('div', { class: 'summary-box' }, el('strong', { text: q.topic }), el('span', { class: 'small', text: `Paperwork: ${q.conflicting_values.join(' vs. ')}` })),
      field('Confirmed instruction', answer, { required: true }),
      who.node,
      errors,
      el('p', { class: 'muted small', text: 'This records what a clinician told you. The app never resolves a discrepancy on its own.' }),
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Save answer', { variant: 'primary', type: 'submit' }))
    ),
  });
}

function openMilestoneSheet(ctx, m) {
  const date = el('input', { type: 'date', value: m.confirmed_date || '' });
  const time = el('input', { type: 'time', value: m.confirmed_time || '' });
  const note = el('input', { type: 'text', value: m.confirmed_note || '', placeholder: 'e.g. confirmed by clinic phone call' });
  const errors = el('div', { class: 'error-box hidden' });
  const sheet = openSheet({
    title: m.title,
    content: el(
      'form',
      { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        try {
          if (!isValidDateStr(date.value)) throw new Error('Enter the confirmed date.');
          await ctx.actions.putMilestone({ ...m, status: 'confirmed', confirmed_date: date.value, confirmed_time: time.value || null, confirmed_note: note.value.trim(), confirmed_at: new Date(ctx.now()).toISOString() });
          sheet.close('saved');
        } catch (err) {
          errors.textContent = err.message;
          errors.classList.remove('hidden');
        }
      } },
      el('p', { class: 'muted small', text: m.note || '' }),
      el('div', { class: 'inline-fields' }, field('Confirmed date', date, { required: true }), field('Time', time)),
      field('How it was confirmed', note),
      errors,
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Mark confirmed', { variant: 'primary', type: 'submit' }))
    ),
  });
}

// Undated "road back" milestones are listed in rehab order, not alphabetically.
const ROAD_ORDER = ['rtp-brace-off', 'rtp-full-weight-bearing', 'rtp-flexion-past-90', 'rtp-bike', 'rtp-running', 'rtp-agility', 'rtp-soccer'];
function roadRank(id) {
  const i = ROAD_ORDER.indexOf(id);
  return i === -1 ? ROAD_ORDER.length : i;
}

function openAppointmentSheet(ctx, a = null) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const title = el('input', { type: 'text', value: a?.title || '', placeholder: 'e.g. First clinic visit', autocomplete: 'off' });
  const at = el('input', { type: 'datetime-local', value: a?.at_local || '' });
  const withWhom = el('input', { type: 'text', value: a?.with || '', placeholder: 'Surgeon, PT, pharmacy…', autocomplete: 'off' });
  const notes = el('textarea', { value: a?.notes || '', placeholder: 'Address, what to bring, questions' });
  const errors = el('div', { class: 'error-box hidden' });
  const sheet = openSheet({
    title: a ? 'Edit appointment' : 'Add appointment',
    content: el(
      'form',
      { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        try {
          if (!title.value.trim()) throw new Error('Give the appointment a title.');
          const ms = parseDatetimeLocal(at.value, tz);
          if (!Number.isFinite(ms)) throw new Error('Enter the date and time.');
          await ctx.actions.putAppointment({ id: a?.id || newId(), title: title.value.trim(), at: new Date(ms).toISOString(), at_local: at.value, timezone: tz, with: withWhom.value.trim(), notes: notes.value.trim(), status: 'confirmed', updated_at: new Date(ctx.now()).toISOString() });
          sheet.close('saved');
        } catch (err) {
          errors.textContent = err.message;
          errors.classList.remove('hidden');
        }
      } },
      field('Title', title, { required: true }),
      field('Date and time', at, { required: true }),
      field('With', withWhom),
      field('Notes', notes),
      errors,
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Save appointment', { variant: 'primary', type: 'submit' }))
    ),
  });
}

function openContactSheet(ctx, c) {
  const name = el('input', { type: 'text', value: c.name || '', placeholder: 'Clinic or person', autocomplete: 'off' });
  const phone = el('input', { type: 'tel', value: c.phone || '', placeholder: 'Phone', autocomplete: 'off' });
  const notes = el('textarea', { value: c.notes || '', placeholder: 'After-hours line, portal, address…' });
  const sheet = openSheet({
    title: c.role,
    content: el(
      'form',
      { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        await ctx.actions.putContact({ ...c, name: name.value.trim(), phone: phone.value.trim(), notes: notes.value.trim() });
        sheet.close('saved');
      } },
      field('Name', name),
      field('Phone', phone),
      field('Notes', notes),
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Save', { variant: 'primary', type: 'submit' }))
    ),
  });
}
