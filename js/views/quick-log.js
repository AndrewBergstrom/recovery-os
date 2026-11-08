// views/quick-log.js — the Quick Log bottom sheet. Nothing is stored until the
// patient presses the final Record button; closing the sheet creates no event.

import { el, chip, button, field, icon, openSheet, segmented, radioCards, uid } from '../ui.js';
import { createEvent, validateEvent } from '../events.js';
import { activeOrders, isPrn, statusLabel, totalMg, lastConfirmedDose } from '../medications.js';
import { partitionExercises, SYMPTOM_RESPONSES, SESSION_OUTCOMES } from '../exercises.js';
import { acetaminophenCheck, orderRollingCheck, duplicateCheck, intervalCheck, perDoseCheck, interactionNotices, HIGH_PRIORITY_SYMPTOMS, escalationFor, acetaminophenIds } from '../safety-rules.js';
import { fromIso, describeWhen, formatTime, DEFAULT_TZ } from '../time.js';
import { timePicker, enteredBy, exerciseGuideBlock } from './shared.js';

const TYPES = [
  { id: 'medication', label: 'Medication', icon: 'meds' },
  { id: 'exercise', label: 'Exercise', icon: 'move' },
  { id: 'ice_elevate', label: 'Ice / elevate', icon: 'ice' },
  { id: 'checkin', label: 'Pain / check-in', icon: 'pulse' },
  { id: 'note', label: 'Note', icon: 'note' },
];

export function openQuickLog(ctx, initial = {}) {
  const sheet = openSheet({ title: 'Quick log', content: null });
  const showChooser = () => {
    sheet.setTitle('Quick log');
    sheet.setContent(
      el(
        'div',
        { class: 'form' },
        el('p', { class: 'muted', text: 'What do you want to record? Nothing is saved until you confirm.' }),
        el(
          'div',
          { class: 'choice-grid' },
          TYPES.map((t, i) => el('button', { type: 'button', class: `choice${i === TYPES.length - 1 ? ' choice-wide' : ''}`, onclick: () => showForm(t.id, {}) }, icon(t.icon), el('span', { text: t.label })))
        )
      )
    );
  };
  const showForm = (type, init) => {
    const t = TYPES.find((x) => x.id === type);
    sheet.setTitle(`Log ${t.label.toLowerCase()}`);
    const form = FORMS[type](ctx, init, {
      onRecord: async (ev, toastText) => {
        await ctx.actions.addEvent(ev, { toastText });
        sheet.close('recorded');
      },
      onBack: showChooser,
    });
    sheet.setContent(form);
  };
  if (initial.type && FORMS[initial.type]) showForm(initial.type, initial);
  else showChooser();
  return sheet;
}

function errorsBox() {
  const box = el('div', { class: 'error-box hidden', role: 'alert' });
  return {
    node: box,
    show(msgs) {
      box.replaceChildren(el('strong', { text: 'Please check:' }), el('ul', {}, (Array.isArray(msgs) ? msgs : [msgs]).map((m) => el('li', { text: m }))));
      box.classList.remove('hidden');
    },
    hide() {
      box.classList.add('hidden');
    },
  };
}

function footer({ onBack, submitLabel, submitButton }) {
  return el('div', { class: 'btn-row' }, button('Back', { icon: 'back', onClick: onBack }), submitButton || button(submitLabel, { variant: 'primary', type: 'submit' }));
}

// ---------- Medication ----------
function medicationForm(ctx, init, { onRecord, onBack }) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const meds = activeOrders(ctx.state.orders, 'medication');
  const errs = errorsBox();
  let selected = meds.find((m) => m.id === init.medication_id) || null;
  let quantity = selected ? selected.default_quantity || 1 : null;

  const options = meds.map((m) => {
    const st = statusLabel(m);
    const last = lastConfirmedDose(ctx.state.events, m.id);
    const notices = interactionNotices(m, ctx.state.orders);
    return {
      id: m.id,
      label: `${m.name} ${m.display_strength}`,
      chip: { text: st.text, tone: st.tone },
      description: `${m.directions}. Last confirmed: ${last ? describeWhen(fromIso(last.occurred_at), ctx.now(), tz) : 'Not recorded'}`,
      warning: notices.length ? notices[0].message : null,
    };
  });
  const qtyWrap = el('div', { class: 'field' });
  const summary = el('div', { class: 'summary-box' });
  const warnings = el('div', { class: 'form' });
  const ackDup = el('input', { type: 'checkbox' });
  const ackMax = el('input', { type: 'checkbox' });
  const ackSoon = el('input', { type: 'checkbox' });
  const ackQty = el('input', { type: 'checkbox' });
  const time = timePicker(ctx, init.occurred_ms || ctx.now(), { label: 'Taken at', hint: 'The actual time you took it, not the scheduled time.' });
  const pain = segmented(
    [{ id: '', label: 'Skip' }, ...Array.from({ length: 11 }, (_, i) => ({ id: String(i), label: String(i) }))],
    '',
    null,
    { label: 'Pain right now, 0–10 (optional)' }
  );
  pain.node.classList.add('scale');
  const note = el('textarea', { placeholder: 'Optional note (e.g. with breakfast)' });
  const by = enteredBy(ctx);
  const submit = button('Record dose', { variant: 'primary', type: 'submit' });

  const renderQty = () => {
    qtyWrap.replaceChildren();
    if (!selected) return;
    const allowed = selected.quantity_options?.length ? selected.quantity_options : [1];
    const opts = [...new Set([...allowed, Math.max(...allowed) + 1])].sort((a, b) => a - b).map((q) => ({ id: String(q), label: `${q} ${selected.unit || 'tablet'}${q === 1 ? '' : 's'}${allowed.includes(q) ? '' : ' (above the order)'}` }));
    const seg = segmented(opts, String(quantity), (v) => {
      quantity = Number(v);
      renderSummary();
    }, { label: 'Amount' });
    qtyWrap.append(el('span', { class: 'field-label', text: `Amount (prescribed: ${selected.directions.split(' orally')[0]})` }), seg.node);
  };

  const renderSummary = () => {
    warnings.replaceChildren();
    summary.replaceChildren();
    if (!selected) {
      summary.append(el('span', { class: 'muted', text: 'Choose a medication to see the summary.' }));
      submit.disabled = true;
      return;
    }
    const ms = time.get();
    const mg = totalMg(selected, quantity);
    summary.append(el('span', { class: 'muted small', text: 'You are recording' }), el('strong', { text: `${selected.name} ${selected.display_strength} × ${quantity} ${selected.unit || 'tablet'}${quantity === 1 ? '' : 's'} (${selected.strength_display_unit === 'g' ? `${mg / 1000} g` : `${mg.toLocaleString('en-US')} mg`}) at ${Number.isFinite(ms) ? describeWhen(ms, ctx.now(), tz) : '—'}` }));
    let needAck = false;
    if (Number.isFinite(ms)) {
      if (acetaminophenIds(ctx.state.orders).includes(selected.id)) {
        const check = acetaminophenCheck(ctx.state.events, ctx.state.orders, mg, ms);
        if (check.exceeds) {
          needAck = true;
          warnings.append(el('div', { class: 'warning-box', role: 'alert' }, el('strong', {}, icon('alert', 'icon icon-sm'), ' Above the 24-hour acetaminophen maximum'), el('span', { text: check.message }), el('span', { class: 'small', text: `Recorded in the preceding 24 h: ${check.recorded_mg.toLocaleString('en-US')} mg (recorded entries only).` }), el('label', { class: 'check' }, ackMax, el('span', { text: 'I understand — record what I actually took anyway' }))));
        } else {
          warnings.append(el('p', { class: 'muted small', text: `Recorded acetaminophen in the preceding 24 h: ${check.recorded_mg.toLocaleString('en-US')} mg → ${check.projected_mg.toLocaleString('en-US')} mg with this dose (label max ${check.max_mg.toLocaleString('en-US')} mg).${check.near ? ' Getting close to the maximum.' : ''}` }));
        }
      } else if (selected.rolling_24h_max_mg) {
        const r = orderRollingCheck(ctx.state.events, selected, mg, ms);
        if (r?.exceeds) {
          needAck = true;
          warnings.append(el('div', { class: 'warning-box', role: 'alert' }, el('strong', {}, icon('alert', 'icon icon-sm'), ' Above the 24-hour maximum on the label'), el('span', { text: `Recorded ${selected.name} would be ${r.projected_mg.toLocaleString('en-US')} mg in the preceding 24 h (label max ${r.max_mg.toLocaleString('en-US')} mg). Check with a pharmacist or clinician.` }), el('label', { class: 'check' }, ackMax, el('span', { text: 'I understand — record what I actually took anyway' }))));
        }
      }
      const soon = intervalCheck(ctx.state.events, selected, ms);
      const dupNow = duplicateCheck(ctx.state.events, selected.id, ms);
      if (soon && !dupNow.possible) {
        needAck = true;
        warnings.append(el('div', { class: 'warning-box', role: 'alert' }, el('strong', {}, icon('alert', 'icon icon-sm'), soon.prn ? ' Sooner than the label interval' : ' Closer together than scheduled'), el('span', { text: `${selected.name} was recorded at ${formatTime(fromIso(soon.prior.occurred_at), tz)}. The label says every ${soon.label_hours} h${soon.prn ? '' : ' (twice-daily spacing)'}, so the earliest next dose is ${formatTime(soon.earliest, tz)} — this one is ${soon.minutes_early} min early. Check with a pharmacist or clinician before taking it.` }), el('label', { class: 'check' }, ackSoon, el('span', { text: 'I understand — record what I actually took anyway' }))));
      } else ackSoon.checked = false;
      const over = perDoseCheck(selected, quantity);
      if (over) {
        needAck = true;
        warnings.append(el('div', { class: 'warning-box', role: 'alert' }, el('strong', {}, icon('alert', 'icon icon-sm'), ' More than the order allows per dose'), el('span', { text: `The order says up to ${over.max_quantity} ${selected.unit || 'tablet'}${over.max_quantity === 1 ? '' : 's'} per dose; this records ${over.attempted}. Check with a pharmacist or clinician.` }), el('label', { class: 'check' }, ackQty, el('span', { text: 'I understand — record what I actually took anyway' }))));
      } else ackQty.checked = false;
      const dup = dupNow;
      if (dup.possible) {
        warnings.append(el('div', { class: 'warning-box' }, el('strong', {}, icon('alert', 'icon icon-sm'), ' Possible duplicate'), el('span', { text: `${selected.name} was already recorded ${dup.minutes_apart} min from this time (${formatTime(fromIso(dup.prior.occurred_at), tz)}). If this is the same dose, go back and cancel.` }), el('label', { class: 'check' }, ackDup, el('span', { text: 'This is a separate dose' }))));
      } else ackDup.checked = false;
    }
    for (const n of interactionNotices(selected, ctx.state.orders)) {
      warnings.append(el('div', { class: 'banner banner-warning' }, icon('alert'), el('span', { text: n.message })));
    }
    if (selected.status === 'needs_schedule_confirmation') warnings.append(el('p', { class: 'muted small', text: 'This records a dose you took. It does not confirm the schedule — do that from Medications.' }));
    submit.disabled = false;
    submit.dataset.needAck = needAck ? '1' : '';
  };

  const cards = radioCards('medication', options, selected?.id || null, (id) => {
    selected = meds.find((m) => m.id === id);
    quantity = selected.default_quantity || 1;
    renderQty();
    renderSummary();
  });
  // When a medication was chosen from a card, show it compactly so "Record" is within reach.
  const medWrap = el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Medication' }));
  if (selected) {
    const st = statusLabel(selected);
    medWrap.append(
      el('div', { class: 'summary-box' },
        el('div', { class: 'row-between' },
          el('div', {}, el('strong', { text: `${selected.name} ${selected.display_strength}` }), el('div', { class: 'small muted', text: selected.directions }), chip(st.text, st.tone)),
          button('Change', { variant: 'ghost', cls: 'small', onClick: () => medWrap.replaceChildren(el('span', { class: 'field-label', text: 'Medication' }), cards.node) })
        )
      )
    );
  } else medWrap.append(cards.node);
  time.input.addEventListener('input', renderSummary);
  renderQty();
  renderSummary();

  return el(
    'form',
    { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      errs.hide();
      try {
        if (!selected) throw new Error('Choose a medication.');
        const ms = time.get();
        if (!Number.isFinite(ms)) throw new Error('Enter a valid time.');
        if (ms > ctx.now() + 60 * 60 * 1000) throw new Error('That time is in the future.');
        const mg = totalMg(selected, quantity);
        const isAcet = acetaminophenIds(ctx.state.orders).includes(selected.id);
        const exceeds = isAcet ? acetaminophenCheck(ctx.state.events, ctx.state.orders, mg, ms).exceeds : orderRollingCheck(ctx.state.events, selected, mg, ms)?.exceeds;
        if (exceeds && !ackMax.checked) throw new Error('Tick the acknowledgement to record a dose above the 24-hour maximum, or go back.');
        if (duplicateCheck(ctx.state.events, selected.id, ms).possible && !ackDup.checked) throw new Error('Possible duplicate: tick “This is a separate dose” or go back.');
        if (intervalCheck(ctx.state.events, selected, ms) && !duplicateCheck(ctx.state.events, selected.id, ms).possible && !ackSoon.checked) throw new Error('This dose is sooner than the label interval: tick the acknowledgement to record it anyway, or go back.');
        if (perDoseCheck(selected, quantity) && !ackQty.checked) throw new Error('This is more than the order allows per dose: tick the acknowledgement to record it anyway, or go back.');
        const ev = createEvent(
          {
            event_type: 'medication',
            status: 'taken',
            medication_id: selected.id,
            order_version: selected.version,
            strength_mg: selected.strength_mg,
            quantity,
            total_mg: mg,
            pain: pain.value === '' ? undefined : Number(pain.value),
            occurred_ms: ms,
            notes: note.value,
            created_by: by.get(),
            source: init.source || 'quick_log',
            slot_id: init.slot_id,
          },
          { nowMs: ctx.now(), tz }
        );
        const problems = validateEvent(ev);
        if (problems.length) throw new Error(problems.join(' '));
        await onRecord(ev, `Recorded ${selected.short_name || selected.name} ${selected.display_strength} × ${quantity}`);
      } catch (err) {
        errs.show(err.message);
      }
    } },
    medWrap,
    qtyWrap,
    time.node,
    el('details', { class: 'plain' }, el('summary', { text: 'Add pain score or note (optional)' }),
      el('div', { class: 'details-body' },
        el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Pain right now, 0–10' }), pain.node),
        by.node,
        field('Note', note)
      )
    ),
    summary,
    warnings,
    errs.node,
    footer({ onBack, submitButton: submit })
  );
}

// ---------- Exercise ----------
function exerciseForm(ctx, init, { onRecord, onBack }) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const { cleared, pending } = partitionExercises(ctx.state.orders);
  const all = [...cleared, ...pending];
  const errs = errorsBox();
  let selected = all.find((x) => x.id === init.exercise_id) || null;
  const options = all.map((x) => ({
    id: x.id,
    label: x.name,
    chip: cleared.includes(x) ? { text: 'Cleared', tone: 'ok' } : { text: 'Not cleared', tone: 'warning' },
    description: cleared.includes(x) ? x.parameters : `${x.parameters}. Not cleared yet — this would be recorded as patient-reported, not as a prescribed task.`,
  }));
  const guard = el('div', { class: 'banner banner-info hidden' });
  const sets = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', placeholder: 'e.g. 2' });
  const reps = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', placeholder: 'e.g. 10' });
  const minutes = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', placeholder: 'minutes', value: init.duration_minutes ? String(init.duration_minutes) : '' });
  const hold = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', placeholder: 'seconds' });
  const bend = el('input', { type: 'number', min: '0', max: '90', step: '1', inputmode: 'numeric', placeholder: 'degrees, if measured' });
  const brace = el('input', { type: 'checkbox', checked: true });
  const fieldsWrap = el('div', { class: 'form' });
  const comfort = segmented(SYMPTOM_RESPONSES, null, null, { label: 'How did it feel?' });
  const outcome = segmented(SESSION_OUTCOMES, init.stopped_early ? 'stopped_early' : 'completed', null, { label: 'Outcome' });
  const time = timePicker(ctx, init.occurred_ms || ctx.now(), { label: 'When' });
  const note = el('textarea', { placeholder: 'Optional note' });
  const by = enteredBy(ctx);

  const renderFields = () => {
    fieldsWrap.replaceChildren();
    guard.classList.toggle('hidden', !selected);
    if (!selected) return;
    guard.replaceChildren(icon('alert'), el('span', {}, el('strong', { text: 'Guardrail: ' }), selected.guardrail));
    fieldsWrap.append(exerciseGuideBlock(selected, { compact: true, showGuardrail: false }));
    const tr = selected.tracking || [];
    const grid = el('div', { class: 'inline-fields' });
    if (tr.includes('sets')) grid.append(field('Sets', sets));
    if (tr.includes('reps')) grid.append(field('Reps', reps));
    if (tr.includes('hold_seconds')) grid.append(field('Hold (s)', hold));
    if (tr.includes('duration_minutes')) grid.append(field('Duration (min)', minutes));
    if (tr.includes('max_bend_deg')) grid.append(field('Max bend (°)', bend, { hint: 'Never past the authorized 90°.' }));
    fieldsWrap.append(grid);
    if (tr.includes('brace_on')) fieldsWrap.append(el('label', { class: 'check' }, brace, el('span', { text: 'Brace on and locked' })));
  };
  const cards = radioCards('exercise', options, selected?.id || null, (id) => {
    selected = all.find((x) => x.id === id);
    renderFields();
  });
  renderFields();

  return el(
    'form',
    { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      errs.hide();
      try {
        if (!selected) throw new Error('Choose an exercise.');
        const ms = time.get();
        if (!Number.isFinite(ms)) throw new Error('Enter a valid time.');
        const out = SESSION_OUTCOMES.find((o) => o.id === outcome.value);
        if (out.id !== 'not_today' && !comfort.value) throw new Error('Choose how it felt.');
        if (bend.value && Number(bend.value) > 90) throw new Error('Max bend above 90° is outside the current restriction — record it only after clinician clearance.');
        const ev = createEvent(
          {
            event_type: 'exercise',
            status: out.id,
            completed: out.completed,
            exercise_id: selected.id,
            order_version: selected.version,
            cleared_at_time: cleared.includes(selected),
            sets: sets.value ? Number(sets.value) : undefined,
            reps: reps.value ? Number(reps.value) : undefined,
            duration_seconds: minutes.value ? Number(minutes.value) * 60 : undefined,
            hold_seconds: hold.value ? Number(hold.value) : undefined,
            max_bend_deg: bend.value ? Number(bend.value) : undefined,
            brace_on: (selected.tracking || []).includes('brace_on') ? brace.checked : undefined,
            symptom_response: comfort.value || undefined,
            occurred_ms: ms,
            notes: note.value,
            created_by: by.get(),
            source: init.source || 'quick_log',
            slot_id: init.slot_id,
          },
          { nowMs: ctx.now(), tz }
        );
        const problems = validateEvent(ev);
        if (problems.length) throw new Error(problems.join(' '));
        await onRecord(ev, out.id === 'not_today' ? `Marked ${selected.name}: not today — no penalty` : `Recorded ${selected.name}`);
      } catch (err) {
        errs.show(err.message);
      }
    } },
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Exercise' }), cards.node),
    guard,
    fieldsWrap,
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'How did it feel?' }), comfort.node),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Outcome' }), outcome.node, el('p', { class: 'field-hint', text: 'Stopping early or skipping is fine. A timer finishing is never counted as completion — you confirm it.' })),
    time.node,
    by.node,
    field('Note', note),
    errs.node,
    footer({ onBack, submitLabel: 'Record session' })
  );
}

// ---------- Ice / elevate ----------
function iceForm(ctx, init, { onRecord, onBack }) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const errs = errorsBox();
  const kind = segmented([{ id: 'ice', label: 'Ice' }, { id: 'elevate', label: 'Elevate' }, { id: 'both', label: 'Both' }], init.kind || 'ice', () => renderBarrier(), { label: 'What' });
  const preset = init.duration_minutes ? ([20, 25, 30].includes(init.duration_minutes) ? String(init.duration_minutes) : 'other') : '20';
  const duration = segmented([{ id: '20', label: '20 min' }, { id: '25', label: '25 min' }, { id: '30', label: '30 min' }, { id: 'other', label: 'Other' }], preset, (v) => other.classList.toggle('hidden', v !== 'other'), { label: 'Duration' });
  const other = el('input', { type: 'number', min: '1', max: '180', step: '1', inputmode: 'numeric', placeholder: 'minutes', class: preset === 'other' ? '' : 'hidden', value: preset === 'other' ? String(init.duration_minutes) : '' });
  const barrier = el('input', { type: 'checkbox' });
  const barrierRow = el('label', { class: 'check' }, barrier, el('span', { text: 'Dry barrier between the entire cold pad and skin' }));
  const time = timePicker(ctx, init.occurred_ms || ctx.now(), { label: 'Started at' });
  const note = el('textarea', { placeholder: 'Optional note' });
  const by = enteredBy(ctx);
  const renderBarrier = () => barrierRow.classList.toggle('hidden', kind.value === 'elevate');
  renderBarrier();
  return el(
    'form',
    { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      errs.hide();
      try {
        const ms = time.get();
        if (!Number.isFinite(ms)) throw new Error('Enter a valid time.');
        const mins = duration.value === 'other' ? Number(other.value) : Number(duration.value);
        if (!(mins > 0)) throw new Error('Enter the duration in minutes.');
        if (kind.value !== 'elevate' && !barrier.checked) throw new Error('Confirm the dry barrier between the cold pad and skin (per the handout), or choose Elevate only.');
        const ev = createEvent(
          { event_type: 'ice_elevate', status: 'completed', kind: kind.value, duration_minutes: mins, barrier_confirmed: kind.value === 'elevate' ? undefined : barrier.checked, occurred_ms: ms, notes: note.value, created_by: by.get(), source: init.source || 'quick_log', slot_id: init.slot_id },
          { nowMs: ctx.now(), tz }
        );
        const problems = validateEvent(ev);
        if (problems.length) throw new Error(problems.join(' '));
        await onRecord(ev, `Recorded ${kind.value === 'both' ? 'ice + elevation' : kind.value === 'ice' ? 'ice' : 'elevation'} · ${mins} min`);
      } catch (err) {
        errs.show(err.message);
      }
    } },
    el('div', { class: 'banner banner-info' }, icon('ice'), el('span', { text: 'Handout: 20–30 minutes, at least four times daily in early recovery. Don’t leave ice on continuously. Elevate with the heel supported — no sustained pillow pressure behind the knee.' })),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'What' }), kind.node),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Duration' }), duration.node, other),
    barrierRow,
    time.node,
    by.node,
    field('Note', note),
    errs.node,
    footer({ onBack, submitLabel: 'Record session' })
  );
}

// ---------- Check-in ----------
function checkinForm(ctx, init, { onRecord, onBack }) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const errs = errorsBox();
  const pain = segmented(Array.from({ length: 11 }, (_, i) => ({ id: String(i), label: String(i) })), null, null, { label: 'Pain, 0–10' });
  pain.node.classList.add('scale');
  const swelling = segmented([{ id: 'less', label: 'Less' }, { id: 'same', label: 'Same' }, { id: 'more', label: 'More' }, { id: 'unsure', label: 'Unsure' }], null, null, { label: 'Swelling compared with yesterday' });
  const symptomBoxes = HIGH_PRIORITY_SYMPTOMS.map((s) => ({ s, input: el('input', { type: 'checkbox', value: s.id }) }));
  const escalation = el('div', { class: 'danger-box hidden', role: 'alert' });
  const renderEscalation = () => {
    const ids = symptomBoxes.filter((b) => b.input.checked).map((b) => b.s.id);
    const esc = escalationFor(ids);
    escalation.classList.toggle('hidden', !esc.level);
    if (esc.level) escalation.replaceChildren(icon('alert'), el('span', { text: esc.message }));
  };
  symptomBoxes.forEach((b) => b.input.addEventListener('change', renderEscalation));
  const time = timePicker(ctx, init.occurred_ms || ctx.now(), { label: 'When' });
  const note = el('textarea', { placeholder: 'Anything else (sleep, side effects, bowel movement, how the day went)' });
  const by = enteredBy(ctx);
  return el(
    'form',
    { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      errs.hide();
      try {
        const ms = time.get();
        if (!Number.isFinite(ms)) throw new Error('Enter a valid time.');
        const symptoms = symptomBoxes.filter((b) => b.input.checked).map((b) => b.s.id);
        if (pain.value == null && !swelling.value && !symptoms.length && !note.value.trim()) throw new Error('Record at least one thing — pain, swelling, a symptom flag or a note.');
        const ev = createEvent(
          { event_type: 'checkin', status: 'recorded', pain: pain.value == null ? undefined : Number(pain.value), swelling: swelling.value || undefined, symptoms, occurred_ms: ms, notes: note.value, created_by: by.get(), source: init.source || 'quick_log', slot_id: init.slot_id },
          { nowMs: ctx.now(), tz }
        );
        const problems = validateEvent(ev);
        if (problems.length) throw new Error(problems.join(' '));
        const esc = escalationFor(symptoms);
        await onRecord(ev, esc.level ? 'Check-in recorded — please act on the care-seeking instruction' : 'Check-in recorded');
        if (esc.level) ctx.actions.showEscalation(esc);
      } catch (err) {
        errs.show(err.message);
      }
    } },
    el('p', { class: 'muted', text: 'About 15 seconds. Everything is optional; nothing here is scored.' }),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Pain, 0–10' }), pain.node),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Swelling compared with yesterday' }), swelling.node),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Any of these right now?' }), symptomBoxes.map((b) => el('label', { class: 'check' }, b.input, el('span', { text: b.s.label })))),
    escalation,
    time.node,
    by.node,
    field('Note', note),
    errs.node,
    footer({ onBack, submitLabel: 'Record check-in' })
  );
}

// ---------- Note ----------
function noteForm(ctx, init, { onRecord, onBack }) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const errs = errorsBox();
  const category = segmented(
    [
      { id: 'journal', label: 'Journal' },
      { id: 'question_for_surgeon', label: 'Question for surgeon' },
      { id: 'question_for_pt', label: 'Question for PT' },
      { id: 'question_for_pharmacist', label: 'Question for pharmacist' },
    ],
    init.category || 'journal',
    null,
    { label: 'Type' }
  );
  const text = el('textarea', { placeholder: 'Write it down while you remember it', required: true });
  const time = timePicker(ctx, init.occurred_ms || ctx.now(), { label: 'When' });
  const by = enteredBy(ctx);
  return el(
    'form',
    { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      errs.hide();
      try {
        const ms = time.get();
        if (!Number.isFinite(ms)) throw new Error('Enter a valid time.');
        if (!text.value.trim()) throw new Error('Write something first.');
        const ev = createEvent({ event_type: 'note', status: 'recorded', category: category.value, text: text.value.trim(), occurred_ms: ms, created_by: by.get(), source: init.source || 'quick_log' }, { nowMs: ctx.now(), tz });
        const problems = validateEvent(ev);
        if (problems.length) throw new Error(problems.join(' '));
        await onRecord(ev, category.value === 'journal' ? 'Note saved' : 'Question saved to your Plan');
      } catch (err) {
        errs.show(err.message);
      }
    } },
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Type' }), category.node),
    field('Text', text, { required: true }),
    time.node,
    by.node,
    errs.node,
    footer({ onBack, submitLabel: 'Save note' })
  );
}

const FORMS = { medication: medicationForm, exercise: exerciseForm, ice_elevate: iceForm, checkin: checkinForm, note: noteForm };
